package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/rpc"
	"github.com/your-org/loom/internal/tools"
)

// Driver runs the agent loop for a single task.
type Driver struct {
	Conn          *rpc.Conn
	WorkspaceRoot string
	Model         string
	LLM           llm.Provider
	Conversations *conversation.Store
}

type StartParams struct {
	TaskID         string `json:"taskId"`
	ConversationID string `json:"conversationId"`
	Prompt         string `json:"prompt"`
	WorkspaceRoot  string `json:"workspaceRoot"`
	CWD            string `json:"cwd"`
}

func (d *Driver) Run(ctx context.Context, p StartParams) error {
	if p.ConversationID == "" {
		p.ConversationID = "default"
	}
	registry := tools.Registry()
	toolDefs := buildToolDefs(registry)
	systemPrompt := buildSystemPrompt(registry, p.WorkspaceRoot)

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
			done("completed")
			return nil
		}

		for _, tc := range toolCalls {
			if ctx.Err() != nil {
				done("cancelled")
				return nil
			}
			result, err := d.ExecTool(p.TaskID, tc.ID, tc.Name, tc.Input)
			content := result
			if err != nil {
				content = "error: " + err.Error()
			}
			if ctx.Err() != nil {
				done("cancelled")
				return nil
			}
			entry.Append(llm.Message{
				Role:       llm.RoleTool,
				Content:    content,
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
		"taskId":           taskID,
		"inputTokens":      usage.InputTokens,
		"outputTokens":     usage.OutputTokens,
		"cumulativeInput":  entry.CumulativeInput,
		"cumulativeOutput": entry.CumulativeOutput,
		"model":            d.LLM.Model(),
	})
}

func (d *Driver) notifyConversationUpdated(conversationID string, entry *conversation.Entry) {
	snap := entry.Snapshot()
	_ = d.Conn.Notify("conversation.updated", map[string]any{
		"conversationId":   conversationID,
		"messages":         snap.Messages,
		"cumulativeInput":  snap.CumulativeInput,
		"cumulativeOutput": snap.CumulativeOutput,
		"lastInputTokens":  snap.LastInputTokens,
		"lastOutputTokens": snap.LastOutputTokens,
		"model":            d.LLM.Model(),
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

// ExecTool dispatches a tool either locally or via the TS host.
func (d *Driver) ExecTool(taskID, callID, name string, input json.RawMessage) (string, error) {
	for _, t := range tools.Registry() {
		if t.Name != name {
			continue
		}
		if t.LocalExec != nil {
			_ = d.Conn.Notify("tool.localCall", map[string]any{
				"callId":           callID,
				"taskId":           taskID,
				"name":             name,
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
			"name":             name,
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
	return "", fmt.Errorf("unknown tool: %s", name)
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

func buildSystemPrompt(registry []tools.Tool, workspaceRoot string) string {
	var b strings.Builder
	b.WriteString("You are an AI coding assistant running inside a VS Code extension. ")
	b.WriteString("You have access to tools to inspect, edit with diffs, diagnose, search, and run commands in the user's workspace.\n\n")
	fmt.Fprintf(&b, "Workspace root: %s\n\n", workspaceRoot)
	b.WriteString("Available tools:\n")
	for _, t := range registry {
		fmt.Fprintf(&b, "- %s: %s\n", t.Name, t.Description)
	}
	return b.String()
}
