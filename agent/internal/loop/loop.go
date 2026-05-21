package loop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
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
	// ReasoningEffort optionally overrides the provider's default reasoning
	// effort for tasks run in this mode (OpenAI-only). Empty means "use the
	// provider default". Resolved by the loop at task start and threaded into
	// the LLM call via llm.WithReasoningEffort.
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

type StartParams struct {
	TaskID         string          `json:"taskId"`
	ConversationID string          `json:"conversationId"`
	Prompt         string          `json:"prompt"`
	WorkspaceRoot  string          `json:"workspaceRoot"`
	CWD            string          `json:"cwd"`
	Mode           *ModeDefinition `json:"mode,omitempty"`
	References     []Reference     `json:"references,omitempty"`
	// MaxTurns optionally overrides the default per-task model/tool turn
	// cap (32). Used when the webview clicks Continue on a turn_limit stop
	// to double the budget for the resumed task. Zero means "use default".
	MaxTurns int `json:"maxTurns,omitempty"`
}

func (d *Driver) Run(ctx context.Context, p StartParams) error {
	return d.run(ctx, p, runOptions{MaxTurns: p.MaxTurns})
}

type runOptions struct {
	Registry       []tools.Tool
	MaxTurns       int
	MaxInputTokens int64
	IsSubAgent     bool
}

type runtimeContext struct {
	IndexState            string
	IndexEngine           string
	IndexFilesScanned     int
	IndexSymbolsCount     int
	SemanticSearchEnabled bool
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
		registry = ApplyMode(d.registry(), p.Mode)
	}
	// Skills and sub-agent preset catalogues are workspace-scoped and frozen at
	// task start so the stable prompt prefix advertises the same set all turn.
	skillsCatalogue := skills.Load(p.WorkspaceRoot)
	presetRegistry := LoadPresets(p.WorkspaceRoot)
	registry = withSubAgentPresetSchema(registry, presetRegistry.All())
	toolDefs := buildToolDefs(registry)

	rulesBundle := rules.Load(p.WorkspaceRoot)

	entry := d.Conversations.Get(p.ConversationID)
	entry.SetRulesHash(rulesBundle.Hash)

	userPrompt := p.Prompt
	referenceBlock, referenceImages, err := RenderReferences(p.WorkspaceRoot, p.References)
	if err != nil {
		return err
	}
	if referenceBlock != "" {
		if strings.TrimSpace(userPrompt) == "" {
			userPrompt = "Use the attached references."
		}
		userPrompt = strings.TrimSpace(userPrompt) + "\n\n" + referenceBlock
	}
	entry.Append(llm.Message{Role: llm.RoleUser, Content: userPrompt, Images: referenceImages})
	entry.HealOrphanToolCalls()
	d.notifyConversationUpdated(p.ConversationID, entry)

	stableSystem := BuildStableSystem(p.Mode, registry, skillsCatalogue, presetRegistry.All())
	toolState := newTaskToolState()

	done := func(reason string, fields ...map[string]any) {
		toolCounts, duplicateToolCalls := toolState.Snapshot()
		payload := map[string]any{
			"taskId":             p.TaskID,
			"reason":             reason,
			"toolCounts":         toolCounts,
			"duplicateToolCalls": duplicateToolCalls,
		}
		for _, extra := range fields {
			for k, v := range extra {
				payload[k] = v
			}
		}
		d.Conn.Notify("task.done", payload)
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
		volatileSystem := BuildVolatileSystem(p.WorkspaceRoot, skillsCatalogue, entry.LoadedSkillsCopy(), rulesBundle, d.runtimeContext())
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

		streamCtx := ctx
		if p.Mode != nil && p.Mode.ReasoningEffort != "" {
			streamCtx = llm.WithReasoningEffort(streamCtx, p.Mode.ReasoningEffort)
		}
		// Carry the OpenAI Responses-API anchor when one is available so
		// the adapter can chain via `previous_response_id` and ship only
		// the delta (tool results / new user message since the last
		// response). Empty chain → adapter sends a full first request.
		prevResponseID, deltaStart := entry.ResponseChain()
		if prevResponseID != "" {
			streamCtx = llm.WithResponsesChain(streamCtx, prevResponseID, deltaStart)
		}
		// Snapshot the pre-call message count so we can validate the
		// chain anchor returned by the adapter. If the count differs from
		// expectations (off-by-one, late mutation), drop the chain
		// rather than corrupt it.
		preCallMessageCount := entry.Usage().MessageCount
		result, err := d.LLM.Stream(streamCtx, sysPrompt, wireMessages(entry.MessagesCopy()), toolDefs, h)
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
			return fmt.Errorf("llm request failed: %w (model=%s, provider=%s)", err, d.LLM.Model(), d.LLM.Family())
		}

		entry.AddUsage(result.Usage)
		d.Tasks.RecordUsage(p.TaskID, result.Usage.InputTokens, result.Usage.OutputTokens)
		d.notifyUsage(p.TaskID, entry, result.Usage, toolState)
		usageTotals := entry.Usage()
		if opts.MaxInputTokens > 0 && usageTotals.CumulativeInput > opts.MaxInputTokens {
			d.notifyConversationUpdated(p.ConversationID, entry)
			done("error", map[string]any{"error": "input token budget exceeded"})
			return fmt.Errorf("input token budget exceeded")
		}

		entry.Append(llm.Message{
			Role:      llm.RoleAssistant,
			Content:   assistantText,
			ToolCalls: toolCalls,
		})
		// Persist the Responses-API chain anchor only when the adapter
		// signalled it AND the consumed count matches our pre-call
		// snapshot + 1 (the assistant turn we just appended). A mismatch
		// means the adapter or some other path mutated the entry
		// concurrently; safer to drop the chain than ship a request the
		// server will reject.
		if result.ResponseID != "" {
			expected := preCallMessageCount + 1
			if result.ConsumedMessageCount == expected {
				entry.MarkResponseStored(result.ResponseID, expected)
			} else {
				log.Printf("loop: responses chain mismatch (got %d, want %d); resetting", result.ConsumedMessageCount, expected)
				entry.ResetResponseChain()
			}
		}
		d.notifyConversationUpdated(p.ConversationID, entry)

		if result.StopReason != "tool_calls" || len(toolCalls) == 0 {
			d.Telemetry.Emit("task_completed", map[string]any{
				"turns":               turn + 1,
				"inputTokens":         usageTotals.CumulativeInput,
				"outputTokens":        usageTotals.CumulativeOutput,
				"cacheReadTokens":     result.Usage.CacheReadTokens,
				"cacheCreationTokens": result.Usage.CacheCreationTokens,
			})
			done("completed")
			return nil
		}

		toolResults, err := d.execToolsParallel(ctx, p.TaskID, p.ConversationID, toolCalls, registry, entry, skillsCatalogue, presetRegistry, toolState)
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
		if toolState.ShouldStopReadNavigationLoop(p.Mode) {
			toolCounts, duplicateToolCalls := toolState.Snapshot()
			msg := fmt.Sprintf("Stopped because this task made %d read/search/navigation tool calls with no apply_diff calls. Tool counts: %s. Duplicate read/search calls: %d. Narrow the next step and edit instead of rereading the same context.", toolState.ReadNavigationCalls(), formatToolCounts(toolCounts), duplicateToolCalls)
			d.notifyConversationUpdated(p.ConversationID, entry)
			done("error", map[string]any{"error": msg})
			return nil
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

	msg := fmt.Sprintf("Stopped after %d model/tool turns (turn limit reached). Continue the task to keep working from this conversation state.", maxTurns)
	done("turn_limit", map[string]any{"error": msg, "maxTurns": maxTurns})
	if opts.IsSubAgent {
		return fmt.Errorf("turn limit exceeded")
	}
	return nil
}

func (d *Driver) maybeSummarize(ctx context.Context, taskID, conversationID, systemPrompt string, entry *conversation.Entry) error {
	limit := d.LLM.MaxContextTokens()
	totals := entry.Usage()
	if limit <= 0 || totals.LastInputTokens <= 0 || totals.LastInputTokens < int64(float64(limit)*0.75) {
		return nil
	}
	if totals.MessageCount < 8 {
		return nil
	}

	// Snapshot the messages once so we can compute the cut without racing
	// against concurrent appends. The summarize LLM call runs against this
	// snapshot; the commit below re-acquires the lock to splice the result.
	snap := entry.MessagesCopy()
	cut := int(float64(len(snap)) * 0.6)
	if keepFrom := len(snap) - 4; cut > keepFrom {
		cut = keepFrom
	}
	cut = safeCutBoundary(snap, cut)
	if cut <= 0 {
		return nil
	}

	summaryPrompt := "Summarize the conversation so far for context continuity. Preserve file paths, decisions, and open questions."
	summary, usage, err := d.LLM.Complete(ctx, summaryPrompt, snap[:cut])
	if err != nil {
		return fmt.Errorf("summarize conversation: %w", err)
	}
	entry.AddUsage(usage)
	d.notifyUsage(taskID, entry, usage, nil)

	// Splice the summary in. We hold the lock for the whole replace so a
	// concurrent Append cannot observe a half-replaced log.
	entry.Lock()
	rest := append([]llm.Message(nil), entry.Messages[cut:]...)
	entry.Messages = append([]llm.Message{{
		Role:    llm.RoleUser,
		Content: "<summary>\n" + strings.TrimSpace(summary),
	}}, rest...)
	entry.LastSummarizedLen = len(entry.Messages)
	// Summarisation rewrites the local message log — the server's
	// Responses chain (if any) no longer matches what we'd send as a
	// delta. Drop the anchor so the next Responses call rebuilds from
	// scratch with the new summarised history.
	entry.LastResponseID = ""
	entry.LastResponseConsumedCount = 0
	entry.Unlock()
	_ = d.Conn.Notify("task.summarized", map[string]any{
		"taskId":         taskID,
		"conversationId": conversationID,
		"droppedCount":   cut,
	})
	d.notifyConversationUpdated(conversationID, entry)
	return nil
}

func (d *Driver) notifyUsage(taskID string, entry *conversation.Entry, usage llm.TokenUsage, toolState *taskToolState) {
	rootID := taskID
	if node := d.Tasks.Node(taskID); node != nil && node.RootID != "" {
		rootID = node.RootID
	}
	subInput, subOutput, subCount := d.Tasks.TreeUsage(rootID)
	totals := entry.Usage()
	payload := map[string]any{
		"taskId":               taskID,
		"inputTokens":          usage.InputTokens,
		"outputTokens":         usage.OutputTokens,
		"cacheCreationTokens":  usage.CacheCreationTokens,
		"cacheReadTokens":      usage.CacheReadTokens,
		"cumulativeInput":      totals.CumulativeInput,
		"cumulativeOutput":     totals.CumulativeOutput,
		"cumulativeCacheRead":  totals.CumulativeCacheRead,
		"cumulativeCacheWrite": totals.CumulativeCacheWrite,
		"subAgentInputTokens":  subInput,
		"subAgentOutputTokens": subOutput,
		"subAgentCount":        subCount,
		"model":                d.LLM.Model(),
		"promptVersion":        agentprompts.PROMPT_VERSION,
	}
	if toolState != nil {
		counts, duplicates := toolState.Snapshot()
		payload["toolCounts"] = counts
		payload["duplicateToolCalls"] = duplicates
	}
	_ = d.Conn.Notify("task.usage", payload)
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

const (
	readNavigationLoopLimit = 120
	// readFileDistinctSlicesPerPath caps how many distinct (offset,limit) reads
	// the model can issue against one file before the guard forces it back to
	// search. Lowered from 25 in v0.6.1 — large files split into many narrow
	// slices was the dominant "shooting around" pattern. If a fix legitimately
	// needs more reads from one file, prefer a wider window or a search-then-
	// targeted-read pass.
	readFileDistinctSlicesPerPath = 10
)

var readNavigationTools = map[string]bool{
	"read_file":       true,
	"list_dir":        true,
	"search":          true,
	"find_files":      true,
	"find_symbol":     true,
	"find_references": true,
	"semantic_search": true,
}

type cachedToolResult struct {
	content string
	hits    int
}

type taskToolState struct {
	mu                  sync.Mutex
	cache               map[string]cachedToolResult
	counts              map[string]int
	duplicateToolCalls  int
	readNavigationCalls int
	applyDiffCalls      int
	readFileSlices      map[string]map[string]bool
}

func newTaskToolState() *taskToolState {
	return &taskToolState{
		cache:          make(map[string]cachedToolResult),
		counts:         make(map[string]int),
		readFileSlices: make(map[string]map[string]bool),
	}
}

func (s *taskToolState) Begin(tc llm.ToolCall) (content string, handled bool) {
	if s == nil {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counts[tc.Name]++
	if tc.Name == "apply_diff" {
		s.applyDiffCalls++
	}
	if !readNavigationTools[tc.Name] {
		return "", false
	}
	s.readNavigationCalls++
	key := toolCacheKey(tc)
	if cached, ok := s.cache[key]; ok {
		s.duplicateToolCalls++
		cached.hits++
		s.cache[key] = cached
		msg := "[cached duplicate] " + cached.content
		if cached.hits >= 3 {
			msg += "\n\n[cached duplicate warning] This exact read/search/navigation request has already been answered. Do not call it again unless the file or index changed; use the cached context or make an edit."
		}
		return msg, true
	}
	if tc.Name == "read_file" {
		path, slice := readFilePathSlice(tc.Input)
		if path != "" {
			slices := s.readFileSlices[path]
			if slices == nil {
				slices = make(map[string]bool)
				s.readFileSlices[path] = slices
			}
			if !slices[slice] && len(slices) >= readFileDistinctSlicesPerPath {
				return fmt.Sprintf("[read_file budget exhausted] Already read %d distinct slices from %s in this task. Stop slicing this file — use `search` to find the exact lines you still need, or commit to an `apply_diff` with the context you already have.", readFileDistinctSlicesPerPath, path), true
			}
			slices[slice] = true
		}
	}
	return "", false
}

func (s *taskToolState) Finish(tc llm.ToolCall, out toolOutcome) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if tc.Name == "apply_diff" && out.err == nil {
		s.cache = make(map[string]cachedToolResult)
	}
	if !readNavigationTools[tc.Name] || out.err != nil || out.content == "" {
		return
	}
	s.cache[toolCacheKey(tc)] = cachedToolResult{content: out.content}
}

func (s *taskToolState) Snapshot() (map[string]int, int) {
	if s == nil {
		return map[string]int{}, 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	counts := make(map[string]int, len(s.counts))
	for k, v := range s.counts {
		counts[k] = v
	}
	return counts, s.duplicateToolCalls
}

func (s *taskToolState) ReadNavigationCalls() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readNavigationCalls
}

func (s *taskToolState) ShouldStopReadNavigationLoop(mode *ModeDefinition) bool {
	if s == nil || !isExecutionMode(mode) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readNavigationCalls >= readNavigationLoopLimit && s.applyDiffCalls == 0
}

func isExecutionMode(mode *ModeDefinition) bool {
	if mode == nil || mode.ID == "" {
		return true
	}
	id := strings.ToLower(mode.ID)
	return id == "code" || id == "debug"
}

func toolCacheKey(tc llm.ToolCall) string {
	return tc.Name + ":" + canonicalJSON(tc.Input)
}

func canonicalJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return string(raw)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return string(raw)
	}
	return string(b)
}

func readFilePathSlice(raw json.RawMessage) (string, string) {
	var in struct {
		Path   string `json:"path"`
		Offset int    `json:"offset"`
		Limit  int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", ""
	}
	offset := in.Offset
	if offset < 1 {
		offset = 1
	}
	return in.Path, fmt.Sprintf("%d:%d", offset, in.Limit)
}

func formatToolCounts(counts map[string]int) string {
	if len(counts) == 0 {
		return "none"
	}
	names := make([]string, 0, len(counts))
	for name := range counts {
		names = append(names, name)
	}
	sort.Strings(names)
	var parts []string
	for _, name := range names {
		parts = append(parts, fmt.Sprintf("%s=%d", name, counts[name]))
	}
	return strings.Join(parts, ", ")
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
	presetRegistry Registry,
	toolState *taskToolState,
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

	approvals, err := d.gatherApprovals(ctx, taskID, calls, byName)
	if err != nil {
		return nil, err
	}

	// State-mutating tools (load_skill, scratchpad, spawn_subagent) are
	// dispatched via the interceptor map instead of a hard-coded switch
	// in execOneTool. See interceptors.go.
	interceptors := d.buildInterceptors(skillsCatalogue, presetRegistry)

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
			out := d.execOneTool(gctx, taskID, conversationID, tc, byName, approvals, entry, interceptors, toolState)
			mu.Lock()
			results[tc.ID] = out
			mu.Unlock()
			if out.err != nil && errors.Is(out.err, context.Canceled) {
				return out.err
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return results, err
	}
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
	interceptors map[string]localInterceptor,
	toolState *taskToolState,
) toolOutcome {
	if content, handled := toolState.Begin(tc); handled {
		out := toolOutcome{content: content}
		d.notifySyntheticToolResult(taskID, tc, out)
		return out
	}
	if intercept, ok := interceptors[tc.Name]; ok {
		out := intercept(ctx, taskID, conversationID, entry, tc.Input)
		toolState.Finish(tc, out)
		return out
	}
	t, ok := byName[tc.Name]
	var out toolOutcome
	switch {
	case !ok:
		out = toolOutcome{err: fmt.Errorf("unknown tool: %s", tc.Name)}
	case t.LocalExec != nil && t.RequiresApproval && !approvals[tc.ID]:
		out = toolOutcome{err: fmt.Errorf("user rejected")}
	default:
		d.Tasks.RecordToolCall(taskID, tc.Name, tc.Input)
		startedAt := time.Now()
		content, followup, err := d.execToolNoApprovalGate(ctx, taskID, tc.ID, t, tc.Input)
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
	toolState.Finish(tc, out)
	return out
}

func (d *Driver) notifySyntheticToolResult(taskID string, tc llm.ToolCall, out toolOutcome) {
	_ = d.Conn.Notify("tool.localCall", map[string]any{
		"callId":           tc.ID,
		"taskId":           taskID,
		"name":             tc.Name,
		"input":            tc.Input,
		"requiresApproval": false,
	})
	payload := map[string]any{
		"callId":     tc.ID,
		"ok":         out.err == nil,
		"durationMs": 0,
	}
	if out.err != nil {
		payload["error"] = out.err.Error()
	} else {
		payload["content"] = out.content
	}
	_ = d.Conn.Notify("tool.localResult", payload)
}

type spawnSubAgentInput struct {
	Type    string   `json:"type"`
	Task    string   `json:"task"`
	Context string   `json:"context"`
	Files   []string `json:"files,omitempty"`
}

type spawnSubAgentResult struct {
	Summary          string   `json:"summary"`
	FilesTouched     []string `json:"files_touched"`
	ToolCalls        int      `json:"tool_calls"`
	TokensUsed       int64    `json:"tokens_used"`
	Truncated        bool     `json:"truncated"`
	TruncationReason string   `json:"truncation_reason,omitempty"`
}

func (d *Driver) execSpawnSubAgent(ctx context.Context, parentTaskID, parentConversationID string, input json.RawMessage, presetRegistry Registry) toolOutcome {
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
	preset, err := presetRegistry.For(in.Type)
	if err != nil {
		return toolOutcome{err: err}
	}

	if parent := d.Tasks.Node(parentTaskID); parent == nil {
		return toolOutcome{err: fmt.Errorf("parent task not registered")}
	}

	subTaskID := fmt.Sprintf("%s-sub-%d", parentTaskID, time.Now().UnixNano())
	subCtx, cancel := context.WithCancel(ctx)
	if err := d.Tasks.Register(subTaskID, parentTaskID, preset.Name, in.Task, cancel); err != nil {
		cancel()
		return toolOutcome{err: err}
	}
	defer cancel()

	_ = d.Conn.Notify("subagent.spawn", map[string]any{
		"parentTaskId":  parentTaskID,
		"subTaskId":     subTaskID,
		"type":          preset.Name,
		"task":          in.Task,
		"promptVersion": agentprompts.PROMPT_VERSION,
	})

	subRegistry := filterToolsByAllowlist(d.registry(), preset.AllowedTools)
	mode := &ModeDefinition{
		ID:              preset.Name,
		Label:           "Research",
		SystemPrompt:    preset.SystemPrompt,
		ToolAllowlist:   preset.AllowedTools,
		ReasoningEffort: preset.ReasoningEffort,
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
	truncationReason := ""
	if subCtx.Err() != nil {
		status = "cancelled"
		if summary == "" {
			summary = "Sub-agent cancelled by user."
		}
		err = fmt.Errorf("sub-agent cancelled by user")
	} else if err != nil {
		status = "error"
		truncationReason = classifySubAgentTruncation(err)
		truncated = truncationReason != ""
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
	if truncated {
		summary = subAgentRecoverySummary(truncationReason, toolCalls, summary)
	}
	result := spawnSubAgentResult{
		Summary:          summary,
		FilesTouched:     files,
		ToolCalls:        toolCalls,
		TokensUsed:       inputTokens + outputTokens,
		Truncated:        truncated,
		TruncationReason: truncationReason,
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
	if err != nil && !truncated {
		return toolOutcome{content: "error: " + err.Error(), err: err}
	}
	b, _ := json.Marshal(result)
	return toolOutcome{content: string(b)}
}

func classifySubAgentTruncation(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "token budget"):
		return "input_tokens"
	case strings.Contains(msg, "turn limit"):
		return "turns"
	default:
		return ""
	}
}

func subAgentRecoverySummary(reason string, toolCalls int, summary string) string {
	label := reason
	switch reason {
	case "input_tokens":
		label = "input token budget exceeded"
	case "turns":
		label = "turn limit reached"
	case "":
		label = "truncated"
	}
	guidance := fmt.Sprintf("Sub-agent stopped: %s. Tool calls: %d. To recover, narrow the task to a single file/function and re-spawn with stricter scope — do not re-issue the same task.", label, toolCalls)
	if strings.TrimSpace(summary) == "" {
		return guidance
	}
	return guidance + "\n\n" + summary
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
	ctx context.Context,
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
	err := d.Conn.RequestContext(ctx, "tool.approveBatch", map[string]any{
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
	ctx context.Context,
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
		result, err := t.LocalExec(ctx, d.WorkspaceRoot, input)
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
	err := d.Conn.RequestContext(ctx, "tool.call", map[string]any{
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

func (d *Driver) runtimeContext() *runtimeContext {
	if d.Index == nil {
		return &runtimeContext{IndexState: "disabled", SemanticSearchEnabled: false}
	}
	status := d.Index.Status()
	return &runtimeContext{
		IndexState:            status.State,
		IndexEngine:           status.Engine,
		IndexFilesScanned:     status.FilesScanned,
		IndexSymbolsCount:     status.SymbolsCount,
		SemanticSearchEnabled: d.Embedder != nil && d.Index.Vectors() != nil,
	}
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

func withSubAgentPresetSchema(registry []tools.Tool, presets []Preset) []tools.Tool {
	if len(registry) == 0 {
		return registry
	}
	out := append([]tools.Tool(nil), registry...)
	for i := range out {
		if out[i].Name == "spawn_subagent" {
			out[i].InputSchema = spawnSubAgentInputSchema(presets)
			break
		}
	}
	return out
}

func spawnSubAgentInputSchema(presets []Preset) map[string]any {
	names := make([]string, 0, len(presets))
	for _, p := range presets {
		if p.Name != "" {
			names = append(names, p.Name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		names = []string{"research"}
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"type": map[string]any{
				"type": "string",
				"enum": names,
			},
			"task":    map[string]any{"type": "string"},
			"context": map[string]any{"type": "string"},
			"files": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
		},
		"required": []string{"type", "task", "context"},
	}
}

// ApplyMode filters the registry according to the mode's allowlist or denylist.
// A non-nil ToolAllowlist (even if empty) restricts tools to only those listed.
// A non-empty ToolDenylist removes the named tools.
// nil mode returns the registry unchanged.
func ApplyMode(registry []tools.Tool, mode *ModeDefinition) []tools.Tool {
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

const (
	elidedDuplicateToolResultTemplate  = "<duplicate tool-result elided: same %s input retained later at tool_call_id %s; original was %d bytes>"
	elidedReadOverlapTemplate          = "<read_file result superseded: a later read of %s (tool_call_id %s) covers this range; original was %d bytes>"
	elidedSearchOlderTemplate          = "<search result superseded: only the %d most-recent unique queries are kept full; original was %d bytes>"
	searchKeepLatestUniqueQueries      = 3
)

// wireMessages prepares the message slice for an LLM call. Elision policy
// applies only to read/navigation tools; write/state tool results never
// elide. The original Entry is untouched. Three rules, applied while
// walking newest-to-oldest so a later result can "shadow" an earlier one:
//
//  1. Exact-input dedup: any older RoleTool whose tool+input matches a
//     later one collapses to a short marker pointing at the kept call.
//  2. read_file overlap: an older read_file whose (offset, limit) range
//     is fully covered by a later kept read on the same path is treated
//     as superseded — the later result has all the lines the older one
//     had.
//  3. search recency cap: only the `searchKeepLatestUniqueQueries` most-
//     recent unique search queries stay full. Older unique queries
//     collapse — their lines are already in the model's reasoning, and
//     fresh queries are typically the ones it's acting on.
func wireMessages(msgs []llm.Message) []llm.Message {
	if len(msgs) == 0 {
		return msgs
	}
	callByID := toolCallsByID(msgs)
	latestByKey := make(map[string]string)
	readFileKeptRanges := make(map[string][]keptReadRange)
	searchKeysKeptOrder := make([]string, 0, searchKeepLatestUniqueQueries)
	searchKeysKept := make(map[string]bool)

	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != llm.RoleTool {
			continue
		}
		tc, ok := callByID[msgs[i].ToolCallID]
		if !ok || !readNavigationTools[tc.Name] {
			continue
		}
		key := toolCacheKey(tc)
		if laterID, seen := latestByKey[key]; seen {
			msgs[i].Content = fmt.Sprintf(elidedDuplicateToolResultTemplate, tc.Name, laterID, len(msgs[i].Content))
			continue
		}
		latestByKey[key] = msgs[i].ToolCallID

		switch tc.Name {
		case "read_file":
			if path, rr, parseOK := readFileRange(tc.Input); parseOK {
				if laterID, covered := findCoveringRead(readFileKeptRanges[path], rr); covered {
					msgs[i].Content = fmt.Sprintf(elidedReadOverlapTemplate, path, laterID, len(msgs[i].Content))
					continue
				}
				readFileKeptRanges[path] = append(readFileKeptRanges[path], keptReadRange{
					rng:        rr,
					toolCallID: msgs[i].ToolCallID,
				})
			}
		case "search":
			if searchKeysKept[key] {
				break
			}
			if len(searchKeysKeptOrder) >= searchKeepLatestUniqueQueries {
				msgs[i].Content = fmt.Sprintf(elidedSearchOlderTemplate, searchKeepLatestUniqueQueries, len(msgs[i].Content))
				// Roll the kept-key tracker back so this slot isn't claimed —
				// we don't want a "stale" key squatting in the window.
				continue
			}
			searchKeysKeptOrder = append(searchKeysKeptOrder, key)
			searchKeysKept[key] = true
		}
	}
	return msgs
}

// keptReadRange records a read_file range whose result we're keeping in
// full. The line range is closed-inclusive; `end = math.MaxInt` represents
// "read to end of file" (unbounded `limit`).
type keptReadRange struct {
	rng        readRange
	toolCallID string
}

type readRange struct {
	start int // 1-based first line included
	end   int // 1-based last line included (math.MaxInt for unbounded)
}

func (r readRange) covers(other readRange) bool {
	return r.start <= other.start && r.end >= other.end
}

func readFileRange(raw json.RawMessage) (string, readRange, bool) {
	var in struct {
		Path   string `json:"path"`
		Offset int    `json:"offset"`
		Limit  int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &in); err != nil || in.Path == "" {
		return "", readRange{}, false
	}
	start := in.Offset
	if start < 1 {
		start = 1
	}
	end := math.MaxInt
	if in.Limit > 0 {
		end = start + in.Limit - 1
	}
	return in.Path, readRange{start: start, end: end}, true
}

func findCoveringRead(kept []keptReadRange, rr readRange) (string, bool) {
	for _, k := range kept {
		if k.rng.covers(rr) {
			return k.toolCallID, true
		}
	}
	return "", false
}

func toolCallsByID(msgs []llm.Message) map[string]llm.ToolCall {
	out := make(map[string]llm.ToolCall)
	for _, msg := range msgs {
		if msg.Role != llm.RoleAssistant {
			continue
		}
		for _, tc := range msg.ToolCalls {
			if tc.ID != "" {
				out[tc.ID] = tc
			}
		}
	}
	return out
}

// BuildStableSystem returns the cache-friendly prefix of the system prompt:
// mode base prompt, shared output conventions, tool catalogue + per-tool
// details, skills catalogue. Byte-identical across turns for a given
// (mode, registry, skills) tuple.
//
//	[A]  mode base prompt
//	[A'] shared output conventions
//	[B]  tool catalogue (one-liners)
//	[B'] per-tool description bodies
//	[C]  skills catalogue
//
// The provider places its cache_control breakpoint at the end of this block.
func BuildStableSystem(mode *ModeDefinition, registry []tools.Tool, cat skills.Catalogue, presets []Preset) string {
	base := loadModeBase(mode)
	var b strings.Builder
	b.WriteString(strings.TrimRight(base, "\n"))
	b.WriteString("\n\n")
	if conv := strings.TrimSpace(agentprompts.OutputConventions()); conv != "" {
		b.WriteString(conv)
		b.WriteString("\n\n")
	}
	if len(registry) > 0 {
		b.WriteString("Available tools:\n")
		for _, t := range registry {
			fmt.Fprintf(&b, "- %s: %s\n", t.Name, t.Description)
		}
		if bodies := tools.DescriptionBodies(registry); bodies != "" {
			b.WriteString("\n## Tool details\n")
			b.WriteString(bodies)
			b.WriteString("\n")
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
			desc := strings.ReplaceAll(p.Description, "\n", " ")
			if desc == "" {
				desc = "(no description)"
			}
			fmt.Fprintf(&b, "- %s: %s\n", p.Name, desc)
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

// BuildVolatileSystem returns the part of the system prompt that may change
// turn-to-turn: workspace path, loaded-skill bodies, project rules.
//
//	[D] workspace block
//	[E] loaded-skill bodies
//	[F] rules bundle
//
// Anything here sits *after* the provider's cache breakpoint, so changes do
// not invalidate the cached prefix.
func BuildVolatileSystem(workspaceRoot string, cat skills.Catalogue, loadedSkills []string, bundle rules.Bundle, runtime *runtimeContext) string {
	var b strings.Builder
	if workspaceRoot != "" {
		fmt.Fprintf(&b, "Workspace root: %s\n", workspaceRoot)
	}
	if runtime != nil {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		state := runtime.IndexState
		if state == "" {
			state = "disabled"
		}
		engine := runtime.IndexEngine
		if engine == "" {
			engine = "unknown"
		}
		semantic := "disabled"
		if runtime.SemanticSearchEnabled {
			semantic = "enabled"
		}
		fmt.Fprintf(&b, "Workspace index: state=%s, engine=%s, files=%d, symbols=%d. Semantic search: %s.",
			state, engine, runtime.IndexFilesScanned, runtime.IndexSymbolsCount, semantic)
		if state == "ready" && runtime.IndexSymbolsCount == 0 {
			b.WriteString(" Symbol lookups may return no matches; fall back to search/read when needed.")
		}
		b.WriteString("\n")
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
