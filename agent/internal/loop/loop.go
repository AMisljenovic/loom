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
	if p.ConversationID == "" {
		p.ConversationID = "default"
	}
	if d.MCP != nil {
		if err := d.MCP.Start(ctx); err != nil {
			return fmt.Errorf("start MCP servers: %w", err)
		}
	}
	registry := applyMode(d.registry(), p.Mode)
	toolDefs := buildToolDefs(registry)
	systemPrompt := buildSystemPrompt(p.Mode, registry, p.WorkspaceRoot)

	entry := d.Conversations.Get(p.ConversationID)
	entry.Lock()
	defer entry.Unlock()

	entry.Append(llm.Message{Role: llm.RoleUser, Content: p.Prompt})
	d.notifyConversationUpdated(p.ConversationID, entry)

	done := func(reason string) {
		d.Conn.Notify("task.done", map[string]any{
			"taskId": p.TaskID,
			"reason": reason,
		})
	}

	for turn := 0; turn < 32; turn++ {
		if ctx.Err() != nil {
			done("cancelled")
			return nil
		}
		if err := d.maybeSummarize(ctx, p.TaskID, p.ConversationID, systemPrompt, entry); err != nil {
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

		result, err := d.LLM.Stream(ctx, systemPrompt, entry.Snapshot().Messages, toolDefs, h)
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
		d.notifyUsage(p.TaskID, entry, result.Usage)

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

		toolResults, err := d.execToolsParallel(ctx, p.TaskID, toolCalls, registry)
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
		for _, tc := range toolCalls {
			r := toolResults[tc.ID]
			entry.Append(llm.Message{
				Role:       llm.RoleTool,
				Content:    r.content,
				ToolCallID: tc.ID,
			})
			d.notifyConversationUpdated(p.ConversationID, entry)
		}
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
	_ = d.Conn.Notify("task.usage", map[string]any{
		"taskId":                taskID,
		"inputTokens":           usage.InputTokens,
		"outputTokens":          usage.OutputTokens,
		"cacheCreationTokens":   usage.CacheCreationTokens,
		"cacheReadTokens":       usage.CacheReadTokens,
		"cumulativeInput":       entry.CumulativeInput,
		"cumulativeOutput":      entry.CumulativeOutput,
		"cumulativeCacheRead":   entry.CumulativeCacheRead,
		"cumulativeCacheWrite":  entry.CumulativeCacheWrite,
		"model":                 d.LLM.Model(),
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
	content string
	err     error
}

// execToolsParallel runs a turn's tool calls concurrently. For Go-side tools
// requiring approval, a single tool.approveBatch RPC collects decisions before
// any execution starts. TS-side tools (no LocalExec) handle their own
// approval through tool.call, so they are simply dispatched in parallel.
func (d *Driver) execToolsParallel(
	ctx context.Context,
	taskID string,
	calls []llm.ToolCall,
	registry []tools.Tool,
) (map[string]toolOutcome, error) {
	if len(calls) == 0 {
		return nil, nil
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
	var mu sync.Mutex

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(parallelToolCap)
	for _, tc := range calls {
		tc := tc
		g.Go(func() error {
			if gctx.Err() != nil {
				return gctx.Err()
			}
			t, ok := byName[tc.Name]
			var out toolOutcome
			switch {
			case !ok:
				out = toolOutcome{err: fmt.Errorf("unknown tool: %s", tc.Name)}
			case t.LocalExec != nil && t.RequiresApproval && !approvals[tc.ID]:
				out = toolOutcome{err: fmt.Errorf("user rejected")}
			default:
				startedAt := time.Now()
				content, err := d.execToolNoApprovalGate(taskID, tc.ID, t, tc.Input)
				out = toolOutcome{content: content, err: err}
				d.Telemetry.Emit("tool_call", map[string]any{
					"name":       tc.Name,
					"durationMs": time.Since(startedAt).Milliseconds(),
					"ok":         err == nil,
				})
			}
			if out.err != nil && out.content == "" {
				out.content = "error: " + out.err.Error()
			}
			mu.Lock()
			results[tc.ID] = out
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait()
	return results, nil
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
// approval gate has already been satisfied or is not required).
func (d *Driver) execToolNoApprovalGate(
	taskID, callID string,
	t tools.Tool,
	input json.RawMessage,
) (string, error) {
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
			return "", err
		}
		_ = d.Conn.Notify("tool.localResult", map[string]any{
			"callId":     callID,
			"ok":         true,
			"content":    result,
			"durationMs": time.Since(startedAt).Milliseconds(),
		})
		return result, nil
	}
	var result struct {
		CallID  string `json:"callId"`
		OK      bool   `json:"ok"`
		Content string `json:"content"`
		Error   string `json:"error"`
	}
	err := d.Conn.Request("tool.call", map[string]any{
		"callId":           callID,
		"taskId":           taskID,
		"name":             t.Name,
		"input":            input,
		"requiresApproval": t.RequiresApproval,
	}, &result)
	if err != nil {
		return "", err
	}
	if !result.OK {
		return "", fmt.Errorf("%s", result.Error)
	}
	return result.Content, nil
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
		return d.execToolNoApprovalGate(taskID, callID, t, input)
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

func buildSystemPrompt(mode *ModeDefinition, registry []tools.Tool, workspaceRoot string) string {
	var base string
	if mode != nil && mode.SystemPrompt != "" {
		base = mode.SystemPrompt
	} else {
		id := "code"
		if mode != nil && mode.ID != "" {
			id = mode.ID
		}
		if content, err := agentprompts.Load(id); err == nil {
			base = content
		} else {
			// Fallback to minimal inline prompt if the file is missing.
			base = "You are an AI coding assistant running inside a VS Code extension. " +
				"You have access to tools to inspect, edit with diffs, diagnose, search, and run commands in the user's workspace."
		}
	}
	var b strings.Builder
	b.WriteString(strings.TrimRight(base, "\n"))
	b.WriteString("\n\n")
	fmt.Fprintf(&b, "Workspace root: %s\n\n", workspaceRoot)
	if len(registry) > 0 {
		b.WriteString("Available tools:\n")
		for _, t := range registry {
			fmt.Fprintf(&b, "- %s: %s\n", t.Name, t.Description)
		}
	} else {
		b.WriteString("No tools are available in this mode.\n")
	}
	return b.String()
}
