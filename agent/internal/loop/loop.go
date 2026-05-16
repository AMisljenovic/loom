package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/embed"
	"github.com/your-org/loom/internal/index"
	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/mcp"
	agentprompts "github.com/your-org/loom/internal/prompts"
	"github.com/your-org/loom/internal/rpc"
	"github.com/your-org/loom/internal/rules"
	"github.com/your-org/loom/internal/skills"
	"github.com/your-org/loom/internal/telemetry"
	"github.com/your-org/loom/internal/tools"
)

// parallelToolCap bounds concurrent tool execution per turn.
const parallelToolCap = 8

// Driver runs the agent loop for a single task.
type Driver struct {
	Conn          *rpc.Conn
	WorkspaceRoot string
	Model         string
	LLM           llm.Provider
	Conversations *conversation.Store
	MCP           *mcp.Manager
	Telemetry     *telemetry.Client // may be nil
	Index         *index.Indexer    // may be nil
	Embedder      embed.Provider    // may be nil
	Tasks         *TaskRegistry     // shared task tree registry
}

// ModeDefinition mirrors the TypeScript ModeDefinition in src/shared/protocol.ts.
type ModeDefinition struct {
	ID               string   `json:"id"`
	Label            string   `json:"label"`
	SystemPromptPath string   `json:"systemPromptPath,omitempty"`
	SystemPrompt     string   `json:"systemPrompt,omitempty"`
	ToolDenylist     []string `json:"toolDenylist,omitempty"`
	ToolAllowlist    []string `json:"toolAllowlist"`
}

type StartParams struct {
	TaskID         string          `json:"taskId"`
	ConversationID string          `json:"conversationId"`
	Prompt         string          `json:"prompt"`
	WorkspaceRoot  string          `json:"workspaceRoot"`
	CWD            string          `json:"cwd"`
	Mode           *ModeDefinition `json:"mode,omitempty"`
}

func (d *Driver) Run(ctx context.Context, p StartParams) error {
	return d.run(ctx, p, runOptions{})
}

type runOptions struct {
	Registry       []tools.Tool
	MaxTurns       int
	MaxInputTokens int64
	IsSubAgent     bool
}

func (d *Driver) run(ctx context.Context, p StartParams, opts runOptions) error {
	if d.Tasks == nil {
		d.Tasks = NewTaskRegistry()
	}
	if p.ConversationID == "" {
		p.ConversationID = "default"
	}
	if d.MCP != nil {
		if err := d.MCP.Start(ctx); err != nil {
			return fmt.Errorf("start MCP servers: %w", err)
		}
	}
	registry := opts.Registry
	if registry == nil {
		registry = applyMode(d.registry(), p.Mode)
	}
	toolDefs := buildToolDefs(registry)

	// Skills catalogue is workspace-scoped and frozen at task start so the
	// stable prompt prefix can advertise the same set across all turns.
	skillsCatalogue := skills.Load(p.WorkspaceRoot)

	// Provider family decides which rule files to autoload. Captured once
	// per task; the bundle hash is pinned to the conversation so mid-task
	// file edits do not invalidate the running cache.
	family := ""
	if d.LLM != nil {
		family = d.LLM.Family()
	}
	rulesBundle := rules.Load(p.WorkspaceRoot, family)

	entry := d.Conversations.Get(p.ConversationID)
	entry.Lock()
	defer entry.Unlock()
	entry.RulesHash = rulesBundle.Hash

	entry.Append(llm.Message{Role: llm.RoleUser, Content: p.Prompt})
	d.notifyConversationUpdated(p.ConversationID, entry)

	stableSystem := buildStableSystem(p.Mode, registry, skillsCatalogue, Presets())

	done := func(reason string) {
		d.Conn.Notify("task.done", map[string]any{
			"taskId": p.TaskID,
			"reason": reason,
		})
	}

	maxTurns := opts.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 32
	}
	for turn := 0; turn < maxTurns; turn++ {
		if ctx.Err() != nil {
			done("cancelled")
			return nil
		}
		// Volatile system tail rebuilt each turn so loaded-skill bodies
		// flow in immediately after the model calls load_skill. The cached
		// stable prefix is unaffected.
		volatileSystem := buildVolatileSystem(p.WorkspaceRoot, skillsCatalogue, entry.LoadedSkills, rulesBundle)
		sysPrompt := llm.SystemPrompt{Stable: stableSystem, Volatile: volatileSystem}
		if err := d.maybeSummarize(ctx, p.TaskID, p.ConversationID, sysPrompt.String(), entry); err != nil {
			if ctx.Err() != nil {
				done("cancelled")
				return nil
			}
			return err
		}

		h := &streamHandler{
			conn:   d.Conn,
			taskID: p.TaskID,
		}

		result, err := d.LLM.Stream(ctx, sysPrompt, entry.Snapshot().Messages, toolDefs, h)
		assistantText, toolCalls := h.finish()
		if err != nil {
			if ctx.Err() != nil {
				if assistantText != "" {
					entry.Append(llm.Message{
						Role:    llm.RoleAssistant,
						Content: assistantText + " [interrupted]",
					})
					d.notifyConversationUpdated(p.ConversationID, entry)
				}
				done("cancelled")
				return nil
			}
			return fmt.Errorf("llm stream: %w", err)
		}

		entry.AddUsage(result.Usage)
		d.Tasks.RecordUsage(p.TaskID, result.Usage.InputTokens, result.Usage.OutputTokens)
		d.notifyUsage(p.TaskID, entry, result.Usage)
		if opts.MaxInputTokens > 0 && entry.CumulativeInput > opts.MaxInputTokens {
			d.notifyConversationUpdated(p.ConversationID, entry)
			done("error")
			return fmt.Errorf("input token budget exceeded")
		}

		entry.Append(llm.Message{
			Role:      llm.RoleAssistant,
			Content:   assistantText,
			ToolCalls: toolCalls,
		})
		d.notifyConversationUpdated(p.ConversationID, entry)

		if result.StopReason != "tool_calls" || len(toolCalls) == 0 {
			d.Telemetry.Emit("task_completed", map[string]any{
				"turns":               turn + 1,
				"inputTokens":         entry.CumulativeInput,
				"outputTokens":        entry.CumulativeOutput,
				"cacheReadTokens":     result.Usage.CacheReadTokens,
				"cacheCreationTokens": result.Usage.CacheCreationTokens,
			})
			done("completed")
			return nil
		}

		toolResults, err := d.execToolsParallel(ctx, p.TaskID, p.ConversationID, toolCalls, registry, entry, skillsCatalogue)
		if err != nil {
			if ctx.Err() != nil {
				done("cancelled")
				return nil
			}
			return err
		}
		if ctx.Err() != nil {
			done("cancelled")
			return nil
		}
		// Append in original call order so the LLM sees a deterministic
		// transcript regardless of completion order.
		var followups []string
		for _, tc := range toolCalls {
			r := toolResults[tc.ID]
			entry.Append(llm.Message{
				Role:       llm.RoleTool,
				Content:    r.content,
				ToolCallID: tc.ID,
			})
			if r.followup != "" {
				followups = append(followups, r.followup)
			}
			d.notifyConversationUpdated(p.ConversationID, entry)
		}
		// Diagnostics-feedback follow-up: if any tool reported new errors
		// introduced by its action (currently apply_diff), surface them as a
		// synthetic user message so the next turn sees them. Empty means
		// "clean run"; we emit nothing in that case.
		if len(followups) > 0 {
			var b strings.Builder
			b.WriteString("<diagnostics-followup>\n")
			for i, f := range followups {
				if i > 0 {
					b.WriteString("\n")
				}
				b.WriteString(f)
			}
			b.WriteString("\n</diagnostics-followup>")
			entry.Append(llm.Message{Role: llm.RoleUser, Content: b.String()})
			d.notifyConversationUpdated(p.ConversationID, entry)
		}
	}

	if opts.IsSubAgent {
		done("error")
	}
	return fmt.Errorf("turn limit exceeded")
}

func (d *Driver) maybeSummarize(ctx context.Context, taskID, conversationID, systemPrompt string, entry *conversation.Entry) error {
	limit := d.LLM.MaxContextTokens()
	if limit <= 0 || entry.LastInputTokens <= 0 || entry.LastInputTokens < int64(float64(limit)*0.75) {
		return nil
	}
	if len(entry.Messages) < 8 {
		return nil
	}

	cut := int(float64(len(entry.Messages)) * 0.6)
	if keepFrom := len(entry.Messages) - 4; cut > keepFrom {
		cut = keepFrom
	}
	for cut > 0 && entry.Messages[cut-1].Role == llm.RoleAssistant && len(entry.Messages[cut-1].ToolCalls) > 0 {
		cut--
	}
	if cut <= 0 {
		return nil
	}

	summaryPrompt := "Summarize the conversation so far for context continuity. Preserve file paths, decisions, and open questions."
	summary, usage, err := d.LLM.Complete(ctx, summaryPrompt, entry.Messages[:cut])
	if err != nil {
		return fmt.Errorf("summarize conversation: %w", err)
	}
	entry.AddUsage(usage)
	d.notifyUsage(taskID, entry, usage)

	rest := append([]llm.Message(nil), entry.Messages[cut:]...)
	entry.Messages = append([]llm.Message{{
		Role:    llm.RoleUser,
		Content: "<summary>\n" + strings.TrimSpace(summary),
	}}, rest...)
	entry.LastSummarizedLen = len(entry.Messages)
	_ = d.Conn.Notify("task.summarized", map[string]any{
		"taskId":         taskID,
		"conversationId": conversationID,
		"droppedCount":   cut,
	})
	d.notifyConversationUpdated(conversationID, entry)
	return nil
}

func (d *Driver) notifyUsage(taskID string, entry *conversation.Entry, usage llm.TokenUsage) {
	rootID := taskID
	if node := d.Tasks.Node(taskID); node != nil && node.RootID != "" {
		rootID = node.RootID
	}
	subInput, subOutput, subCount := d.Tasks.TreeUsage(rootID)
	_ = d.Conn.Notify("task.usage", map[string]any{
		"taskId":               taskID,
		"inputTokens":          usage.InputTokens,
		"outputTokens":         usage.OutputTokens,
		"cacheCreationTokens":  usage.CacheCreationTokens,
		"cacheReadTokens":      usage.CacheReadTokens,
		"cumulativeInput":      entry.CumulativeInput,
		"cumulativeOutput":     entry.CumulativeOutput,
		"cumulativeCacheRead":  entry.CumulativeCacheRead,
		"cumulativeCacheWrite": entry.CumulativeCacheWrite,
		"subAgentInputTokens":  subInput,
		"subAgentOutputTokens": subOutput,
		"subAgentCount":        subCount,
		"model":                d.LLM.Model(),
	})
}

func (d *Driver) notifyConversationUpdated(conversationID string, entry *conversation.Entry) {
	snap := entry.Snapshot()
	_ = d.Conn.Notify("conversation.updated", map[string]any{
		"conversationId":       conversationID,
		"messages":             snap.Messages,
		"cumulativeInput":      snap.CumulativeInput,
		"cumulativeOutput":     snap.CumulativeOutput,
		"cumulativeCacheRead":  snap.CumulativeCacheRead,
		"cumulativeCacheWrite": snap.CumulativeCacheWrite,
		"lastInputTokens":      snap.LastInputTokens,
		"lastOutputTokens":     snap.LastOutputTokens,
		"model":                d.LLM.Model(),
	})
}

// streamHandler buffers assistant text and tool calls produced during a
// single Stream call, and forwards text deltas to the webview in real time.
type streamHandler struct {
	conn   *rpc.Conn
	taskID string

	mu        sync.Mutex
	text      strings.Builder
	toolCalls []llm.ToolCall
}

func (h *streamHandler) OnTextDelta(text string) {
	h.mu.Lock()
	h.text.WriteString(text)
	h.mu.Unlock()
	h.conn.Notify("message.delta", map[string]any{
		"taskId": h.taskID,
		"text":   text,
	})
}

func (h *streamHandler) OnToolUse(call llm.ToolCall) {
	h.mu.Lock()
	h.toolCalls = append(h.toolCalls, call)
	h.mu.Unlock()
}

func (h *streamHandler) finish() (string, []llm.ToolCall) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.text.String(), h.toolCalls
}

// toolOutcome is the result of executing a single tool call.
type toolOutcome struct {
	content  string
	err      error
	followup string // optional next-turn user message (e.g. diagnostics diff)
}

// execToolsParallel runs a turn's tool calls concurrently. For Go-side tools
// requiring approval, a single tool.approveBatch RPC collects decisions before
// any execution starts. TS-side tools (no LocalExec) handle their own
// approval through tool.call, so they are simply dispatched in parallel.
func (d *Driver) execToolsParallel(
	ctx context.Context,
	taskID string,
	conversationID string,
	calls []llm.ToolCall,
	registry []tools.Tool,
	entry *conversation.Entry,
	skillsCatalogue skills.Catalogue,
) (map[string]toolOutcome, error) {
	if len(calls) == 0 {
		return nil, nil
	}
	spawnCalls := 0
	for _, tc := range calls {
		if tc.Name == "spawn_subagent" {
			spawnCalls++
		}
	}
	if spawnCalls > subAgentMaxPerTurn {
		results := make(map[string]toolOutcome, len(calls))
		for _, tc := range calls {
			if tc.Name == "spawn_subagent" {
				results[tc.ID] = toolOutcome{content: "error: sub-agent per-turn limit exceeded", err: fmt.Errorf("sub-agent per-turn limit exceeded")}
			}
		}
		return results, nil
	}

	byName := make(map[string]tools.Tool, len(registry))
	for _, t := range registry {
		byName[t.Name] = t
	}

	approvals, err := d.gatherApprovals(taskID, calls, byName)
	if err != nil {
		return nil, err
	}

	results := make(map[string]toolOutcome, len(calls))
	if spawnCalls > 0 {
		for _, tc := range calls {
			out := d.execOneTool(ctx, taskID, conversationID, tc, byName, approvals, entry, skillsCatalogue)
			results[tc.ID] = out
		}
		return results, nil
	}

	var mu sync.Mutex

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(parallelToolCap)
	for _, tc := range calls {
		tc := tc
		g.Go(func() error {
			if gctx.Err() != nil {
				return gctx.Err()
			}
			out := d.execOneTool(gctx, taskID, conversationID, tc, byName, approvals, entry, skillsCatalogue)
			mu.Lock()
			results[tc.ID] = out
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait()
	return results, nil
}

func (d *Driver) execOneTool(
	ctx context.Context,
	taskID string,
	conversationID string,
	tc llm.ToolCall,
	byName map[string]tools.Tool,
	approvals map[string]bool,
	entry *conversation.Entry,
	skillsCatalogue skills.Catalogue,
) toolOutcome {
	t, ok := byName[tc.Name]
	var out toolOutcome
	switch {
	case !ok:
		out = toolOutcome{err: fmt.Errorf("unknown tool: %s", tc.Name)}
	case tc.Name == "load_skill":
		out = execLoadSkill(entry, skillsCatalogue, tc.Input)
	case tc.Name == "spawn_subagent":
		out = d.execSpawnSubAgent(ctx, taskID, conversationID, tc.Input)
	case t.LocalExec != nil && t.RequiresApproval && !approvals[tc.ID]:
		out = toolOutcome{err: fmt.Errorf("user rejected")}
	default:
		d.Tasks.RecordToolCall(taskID, tc.Name, tc.Input)
		startedAt := time.Now()
		content, followup, err := d.execToolNoApprovalGate(taskID, tc.ID, t, tc.Input)
		out = toolOutcome{content: content, err: err, followup: followup}
		d.Telemetry.Emit("tool_call", map[string]any{
			"name":       tc.Name,
			"durationMs": time.Since(startedAt).Milliseconds(),
			"ok":         err == nil,
		})
	}
	if out.err != nil && out.content == "" {
		out.content = "error: " + out.err.Error()
	}
	return out
}

type spawnSubAgentInput struct {
	Type    string   `json:"type"`
	Task    string   `json:"task"`
	Context string   `json:"context"`
	Files   []string `json:"files,omitempty"`
}

type spawnSubAgentResult struct {
	Summary      string   `json:"summary"`
	FilesTouched []string `json:"files_touched"`
	ToolCalls    int      `json:"tool_calls"`
	TokensUsed   int64    `json:"tokens_used"`
	Truncated    bool     `json:"truncated"`
}

func (d *Driver) execSpawnSubAgent(ctx context.Context, parentTaskID, parentConversationID string, input json.RawMessage) toolOutcome {
	var in spawnSubAgentInput
	if err := json.Unmarshal(input, &in); err != nil {
		return toolOutcome{err: fmt.Errorf("spawn_subagent: %w", err)}
	}
	in.Type = strings.TrimSpace(in.Type)
	in.Task = strings.TrimSpace(in.Task)
	in.Context = strings.TrimSpace(in.Context)
	if in.Type == "" {
		in.Type = "research"
	}
	if in.Task == "" {
		return toolOutcome{err: fmt.Errorf("spawn_subagent: task is required")}
	}
	if in.Context == "" {
		return toolOutcome{err: fmt.Errorf("spawn_subagent: context is required")}
	}
	preset, err := PresetFor(in.Type)
	if err != nil {
		return toolOutcome{err: err}
	}

	parent := d.Tasks.Node(parentTaskID)
	if parent == nil {
		return toolOutcome{err: fmt.Errorf("parent task not registered")}
	}
	if parent.Depth >= subAgentMaxDepth {
		return toolOutcome{err: fmt.Errorf("depth limit exceeded")}
	}
	if d.Tasks.CountDescendants(parent.RootID) >= subAgentMaxPerTaskTree {
		return toolOutcome{err: fmt.Errorf("sub-agent task-tree limit exceeded")}
	}
	subInput, _, _ := d.Tasks.TreeUsage(parent.RootID)
	if subInput >= taskTreeMaxInputTokens {
		return toolOutcome{err: fmt.Errorf("task-tree token ceiling exceeded")}
	}

	subTaskID := fmt.Sprintf("%s-sub-%d", parentTaskID, time.Now().UnixNano())
	subCtx, cancel := context.WithCancel(ctx)
	d.Tasks.Register(subTaskID, parentTaskID, preset.Name, in.Task, cancel)
	defer cancel()

	_ = d.Conn.Notify("subagent.spawn", map[string]any{
		"parentTaskId": parentTaskID,
		"subTaskId":    subTaskID,
		"type":         preset.Name,
		"task":         in.Task,
	})

	subRegistry := filterToolsByAllowlist(d.registry(), preset.AllowedTools)
	mode := &ModeDefinition{
		ID:            preset.Name,
		Label:         "Research",
		SystemPrompt:  preset.SystemPrompt,
		ToolAllowlist: preset.AllowedTools,
	}
	userPrompt := buildSubAgentPrompt(in)
	subConversationID := parentConversationID + ":" + subTaskID

	err = d.run(subCtx, StartParams{
		TaskID:         subTaskID,
		ConversationID: subConversationID,
		Prompt:         userPrompt,
		WorkspaceRoot:  d.WorkspaceRoot,
		CWD:            d.WorkspaceRoot,
		Mode:           mode,
	}, runOptions{
		Registry:       subRegistry,
		MaxTurns:       preset.MaxTurns,
		MaxInputTokens: preset.MaxInputTokens,
		IsSubAgent:     true,
	})

	node := d.Tasks.Node(subTaskID)
	summary := d.lastAssistantMessage(subConversationID)
	status := "completed"
	truncated := false
	if subCtx.Err() != nil {
		status = "cancelled"
		if summary == "" {
			summary = "Sub-agent cancelled by user."
		}
		err = fmt.Errorf("sub-agent cancelled by user")
	} else if err != nil {
		status = "error"
		truncated = strings.Contains(err.Error(), "turn limit") || strings.Contains(err.Error(), "token budget")
		if summary == "" {
			summary = err.Error()
		}
	}
	if node != nil {
		switch status {
		case "completed":
			d.Tasks.Complete(subTaskID, TaskCompleted)
		case "cancelled":
			d.Tasks.Complete(subTaskID, TaskCancelled)
		default:
			d.Tasks.Complete(subTaskID, TaskError)
		}
	}
	if summary == "" {
		summary = "Sub-agent completed without a written summary."
	}
	files := []string{}
	if node != nil {
		for file := range node.FilesInspected {
			files = append(files, file)
		}
	}
	files = append(files, in.Files...)
	sort.Strings(files)
	files = compactStrings(files)

	inputTokens, outputTokens, toolCalls := int64(0), int64(0), 0
	if node != nil {
		inputTokens = node.InputTokens
		outputTokens = node.OutputTokens
		toolCalls = node.ToolCalls
	}
	result := spawnSubAgentResult{
		Summary:      summary,
		FilesTouched: files,
		ToolCalls:    toolCalls,
		TokensUsed:   inputTokens + outputTokens,
		Truncated:    truncated,
	}
	_ = d.Conn.Notify("subagent.done", map[string]any{
		"subTaskId":    subTaskID,
		"status":       status,
		"summary":      summary,
		"toolCalls":    toolCalls,
		"tokensUsed":   inputTokens + outputTokens,
		"inputTokens":  inputTokens,
		"outputTokens": outputTokens,
		"truncated":    truncated,
	})
	if err != nil {
		return toolOutcome{content: "error: " + err.Error(), err: err}
	}
	b, _ := json.Marshal(result)
	return toolOutcome{content: string(b)}
}

func buildSubAgentPrompt(in spawnSubAgentInput) string {
	var b strings.Builder
	b.WriteString("<subagent_task>\n")
	b.WriteString(in.Task)
	b.WriteString("\n</subagent_task>\n\n<context>\n")
	b.WriteString(in.Context)
	b.WriteString("\n</context>")
	if len(in.Files) > 0 {
		b.WriteString("\n\n<starting_files>\n")
		for _, file := range in.Files {
			if strings.TrimSpace(file) != "" {
				b.WriteString("- ")
				b.WriteString(strings.TrimSpace(file))
				b.WriteString("\n")
			}
		}
		b.WriteString("</starting_files>")
	}
	return b.String()
}

func (d *Driver) lastAssistantMessage(conversationID string) string {
	entry := d.Conversations.Get(conversationID)
	snap := entry.Snapshot()
	for i := len(snap.Messages) - 1; i >= 0; i-- {
		if snap.Messages[i].Role == llm.RoleAssistant && strings.TrimSpace(snap.Messages[i].Content) != "" {
			return strings.TrimSpace(snap.Messages[i].Content)
		}
	}
	return ""
}

func filterToolsByAllowlist(registry []tools.Tool, allowlist []string) []tools.Tool {
	allowed := make(map[string]bool, len(allowlist))
	for _, name := range allowlist {
		allowed[name] = true
	}
	filtered := make([]tools.Tool, 0, len(allowlist))
	for _, t := range registry {
		if allowed[t.Name] {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

func compactStrings(values []string) []string {
	out := values[:0]
	last := ""
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == last {
			continue
		}
		out = append(out, value)
		last = value
	}
	return out
}

// gatherApprovals batches all Go-side tools requiring approval into a single
// tool.approveBatch RPC. Returns a map callID -> approved.
func (d *Driver) gatherApprovals(
	taskID string,
	calls []llm.ToolCall,
	byName map[string]tools.Tool,
) (map[string]bool, error) {
	type item struct {
		CallID string          `json:"callId"`
		Name   string          `json:"name"`
		Input  json.RawMessage `json:"input"`
	}
	var items []item
	for _, tc := range calls {
		t, ok := byName[tc.Name]
		if !ok || t.LocalExec == nil || !t.RequiresApproval {
			continue
		}
		items = append(items, item{CallID: tc.ID, Name: tc.Name, Input: tc.Input})
	}
	if len(items) == 0 {
		return map[string]bool{}, nil
	}
	var resp struct {
		Decisions map[string]string `json:"decisions"`
	}
	err := d.Conn.Request("tool.approveBatch", map[string]any{
		"taskId":  taskID,
		"batchId": fmt.Sprintf("%s-%d", taskID, time.Now().UnixNano()),
		"items":   items,
	}, &resp)
	if err != nil {
		return nil, fmt.Errorf("tool.approveBatch: %w", err)
	}
	out := make(map[string]bool, len(items))
	for _, it := range items {
		out[it.CallID] = resp.Decisions[it.CallID] == "approved"
	}
	return out, nil
}

// execToolNoApprovalGate executes a tool without consulting approval (the
// approval gate has already been satisfied or is not required). Returns the
// content for the tool message plus an optional follow-up string that the
// loop appends as a synthetic user message on the next turn (currently used
// by apply_diff to surface fresh diagnostics).
func (d *Driver) execToolNoApprovalGate(
	taskID, callID string,
	t tools.Tool,
	input json.RawMessage,
) (string, string, error) {
	if t.LocalExec != nil {
		_ = d.Conn.Notify("tool.localCall", map[string]any{
			"callId":           callID,
			"taskId":           taskID,
			"name":             t.Name,
			"input":            input,
			"requiresApproval": false,
		})
		startedAt := time.Now()
		result, err := t.LocalExec(d.WorkspaceRoot, input)
		if err != nil {
			_ = d.Conn.Notify("tool.localResult", map[string]any{
				"callId":     callID,
				"ok":         false,
				"error":      err.Error(),
				"durationMs": time.Since(startedAt).Milliseconds(),
			})
			return "", "", err
		}
		_ = d.Conn.Notify("tool.localResult", map[string]any{
			"callId":     callID,
			"ok":         true,
			"content":    result,
			"durationMs": time.Since(startedAt).Milliseconds(),
		})
		return result, "", nil
	}
	var result struct {
		CallID    string         `json:"callId"`
		OK        bool           `json:"ok"`
		Content   string         `json:"content"`
		Error     string         `json:"error"`
		Followups []toolFollowup `json:"followups,omitempty"`
	}
	err := d.Conn.Request("tool.call", map[string]any{
		"callId":           callID,
		"taskId":           taskID,
		"name":             t.Name,
		"input":            input,
		"requiresApproval": t.RequiresApproval,
	}, &result)
	if err != nil {
		return "", "", err
	}
	if !result.OK {
		return "", "", fmt.Errorf("%s", result.Error)
	}
	return result.Content, renderFollowups(result.Followups), nil
}

// toolFollowup mirrors src/shared/protocol.ts ToolFollowup. Only the
// "diagnostics" kind is consumed today, but the wire format is extensible.
type toolFollowup struct {
	Kind  string                `json:"kind"`
	Path  string                `json:"path,omitempty"`
	Diags []toolFollowupDiagRow `json:"diags,omitempty"`
}

type toolFollowupDiagRow struct {
	Line     int    `json:"line"`
	Col      int    `json:"col"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

func renderFollowups(fs []toolFollowup) string {
	if len(fs) == 0 {
		return ""
	}
	var b strings.Builder
	for _, f := range fs {
		if f.Kind != "diagnostics" || len(f.Diags) == 0 {
			continue
		}
		for _, d := range f.Diags {
			if b.Len() > 0 {
				b.WriteString("\n")
			}
			fmt.Fprintf(&b, "%s:%d:%d [%s] %s", f.Path, d.Line, d.Col, d.Severity, d.Message)
		}
	}
	return b.String()
}

// execLoadSkill records the requested skill ids on the conversation entry so
// the next turn's volatile system tail includes the bodies. Unknown ids are
// reported in the tool response so the model can correct itself.
func execLoadSkill(entry *conversation.Entry, cat skills.Catalogue, input json.RawMessage) toolOutcome {
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return toolOutcome{err: fmt.Errorf("load_skill: %w", err)}
	}
	if len(in.IDs) == 0 {
		return toolOutcome{content: "no skill ids supplied"}
	}
	var known, unknown []string
	for _, id := range in.IDs {
		if _, ok := cat.Skills[id]; ok {
			known = append(known, id)
		} else {
			unknown = append(unknown, id)
		}
	}
	added := entry.LoadSkills(known)
	var parts []string
	if len(added) > 0 {
		parts = append(parts, "loaded: "+strings.Join(added, ", "))
	}
	already := len(known) - len(added)
	if already > 0 {
		parts = append(parts, fmt.Sprintf("already loaded: %d", already))
	}
	if len(unknown) > 0 {
		parts = append(parts, "unknown ids: "+strings.Join(unknown, ", "))
	}
	if len(parts) == 0 {
		parts = append(parts, "no skills loaded")
	}
	return toolOutcome{content: strings.Join(parts, "; ")}
}

// ExecTool dispatches a single tool, going through the full approval gate.
// Retained for compatibility with any callers outside the loop. The loop
// itself uses execToolsParallel.
func (d *Driver) ExecTool(taskID, callID, name string, input json.RawMessage) (string, error) {
	for _, t := range d.registry() {
		if t.Name != name {
			continue
		}
		if t.LocalExec != nil && t.RequiresApproval {
			var approval struct {
				Approved bool `json:"approved"`
			}
			err := d.Conn.Request("tool.approve", map[string]any{
				"callId":           callID,
				"taskId":           taskID,
				"name":             name,
				"input":            input,
				"requiresApproval": true,
			}, &approval)
			if err != nil {
				return "", err
			}
			if !approval.Approved {
				return "", fmt.Errorf("user rejected")
			}
		}
		content, _, err := d.execToolNoApprovalGate(taskID, callID, t, input)
		return content, err
	}
	return "", fmt.Errorf("unknown tool: %s", name)
}

func (d *Driver) registry() []tools.Tool {
	registry := tools.Registry()
	registry = append(registry, tools.IndexTools(d.Index)...)
	if d.Embedder != nil && d.Index != nil {
		registry = append(registry, tools.SemanticSearchTool(d.Embedder, d.Index.Vectors()))
	}
	if d.MCP != nil {
		// Sort MCP tools by name so the cache prefix (system + tools) is
		// stable across turns even if MCP map iteration reorders them.
		mcpTools := d.MCP.Tools()
		sort.Slice(mcpTools, func(i, j int) bool { return mcpTools[i].Name < mcpTools[j].Name })
		registry = append(registry, mcpTools...)
	}
	return registry
}

func buildToolDefs(registry []tools.Tool) []llm.ToolDef {
	defs := make([]llm.ToolDef, len(registry))
	for i, t := range registry {
		defs[i] = llm.ToolDef{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		}
	}
	return defs
}

// applyMode filters the registry according to the mode's allowlist or denylist.
// A non-nil ToolAllowlist (even if empty) restricts tools to only those listed.
// A non-empty ToolDenylist removes the named tools.
// nil mode returns the registry unchanged.
func applyMode(registry []tools.Tool, mode *ModeDefinition) []tools.Tool {
	if mode == nil {
		return registry
	}
	if mode.ToolAllowlist != nil {
		allowed := make(map[string]bool, len(mode.ToolAllowlist))
		for _, name := range mode.ToolAllowlist {
			allowed[name] = true
		}
		filtered := make([]tools.Tool, 0, len(mode.ToolAllowlist))
		for _, t := range registry {
			if allowed[t.Name] {
				filtered = append(filtered, t)
			}
		}
		return filtered
	}
	if len(mode.ToolDenylist) > 0 {
		denied := make(map[string]bool, len(mode.ToolDenylist))
		for _, name := range mode.ToolDenylist {
			denied[name] = true
		}
		filtered := make([]tools.Tool, 0, len(registry))
		for _, t := range registry {
			if !denied[t.Name] {
				filtered = append(filtered, t)
			}
		}
		return filtered
	}
	return registry
}

// buildStableSystem returns the cache-friendly prefix of the system prompt:
// mode base prompt, tool catalogue, skills catalogue. Byte-identical across
// turns for a given (mode, registry, skills) tuple.
//
//	[A] mode base prompt
//	[B] tool catalogue
//	[C] skills catalogue
//
// The provider places its cache_control breakpoint at the end of this block.
func buildStableSystem(mode *ModeDefinition, registry []tools.Tool, cat skills.Catalogue, presets []Preset) string {
	base := loadModeBase(mode)
	var b strings.Builder
	b.WriteString(strings.TrimRight(base, "\n"))
	b.WriteString("\n\n")
	if len(registry) > 0 {
		b.WriteString("Available tools:\n")
		for _, t := range registry {
			fmt.Fprintf(&b, "- %s: %s\n", t.Name, t.Description)
		}
	} else {
		b.WriteString("No tools are available in this mode.\n")
	}
	if lines := cat.CatalogueLines(); len(lines) > 0 {
		b.WriteString("\nAvailable skills (load with the load_skill tool):\n")
		for _, line := range lines {
			b.WriteString(line)
			b.WriteString("\n")
		}
	}
	if hasTool(registry, "spawn_subagent") && len(presets) > 0 {
		b.WriteString("\nAvailable sub-agents (spawn with the spawn_subagent tool):\n")
		for _, p := range presets {
			fmt.Fprintf(&b, "- %s: isolated read-only research; pass task, context, and optional files\n", p.Name)
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func hasTool(registry []tools.Tool, name string) bool {
	for _, t := range registry {
		if t.Name == name {
			return true
		}
	}
	return false
}

// buildVolatileSystem returns the part of the system prompt that may change
// turn-to-turn: workspace path, loaded-skill bodies, project rules.
//
//	[D] workspace block
//	[E] loaded-skill bodies
//	[F] rules bundle
//
// Anything here sits *after* the provider's cache breakpoint, so changes do
// not invalidate the cached prefix.
func buildVolatileSystem(workspaceRoot string, cat skills.Catalogue, loadedSkills []string, bundle rules.Bundle) string {
	var b strings.Builder
	if workspaceRoot != "" {
		fmt.Fprintf(&b, "Workspace root: %s\n", workspaceRoot)
	}
	if loaded := cat.RenderLoaded(loadedSkills); loaded != "" {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(loaded)
	}
	if bundle.Text != "" {
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(bundle.Text)
	}
	return b.String()
}

func loadModeBase(mode *ModeDefinition) string {
	if mode != nil && mode.SystemPrompt != "" {
		return mode.SystemPrompt
	}
	id := "code"
	if mode != nil && mode.ID != "" {
		id = mode.ID
	}
	if content, err := agentprompts.Load(id); err == nil {
		return content
	}
	return "You are an AI coding assistant running inside a VS Code extension. " +
		"You have access to tools to inspect, edit with diffs, diagnose, search, and run commands in the user's workspace."
}
