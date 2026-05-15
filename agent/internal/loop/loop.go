package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

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
}

type StartParams struct {
	TaskID        string `json:"taskId"`
	Prompt        string `json:"prompt"`
	WorkspaceRoot string `json:"workspaceRoot"`
	CWD           string `json:"cwd"`
}

func (d *Driver) Run(ctx context.Context, p StartParams) error {
	registry := tools.Registry()
	toolDefs := buildToolDefs(registry)
	systemPrompt := buildSystemPrompt(registry, p.WorkspaceRoot)

	history := []llm.Message{
		{Role: llm.RoleUser, Content: p.Prompt},
	}

	for turn := 0; turn < 32; turn++ {
		h := &streamHandler{
			conn:   d.Conn,
			taskID: p.TaskID,
		}

		stopReason, err := d.LLM.Stream(ctx, systemPrompt, history, toolDefs, h)
		if err != nil {
			return fmt.Errorf("llm stream: %w", err)
		}

		assistantText, toolCalls := h.finish()

		history = append(history, llm.Message{
			Role:      llm.RoleAssistant,
			Content:   assistantText,
			ToolCalls: toolCalls,
		})

		if stopReason != "tool_calls" || len(toolCalls) == 0 {
			d.Conn.Notify("task.done", map[string]any{
				"taskId": p.TaskID,
				"reason": "completed",
			})
			return nil
		}

		for _, tc := range toolCalls {
			result, err := d.ExecTool(p.TaskID, tc.ID, tc.Name, tc.Input)
			content := result
			if err != nil {
				content = "error: " + err.Error()
			}
			history = append(history, llm.Message{
				Role:       llm.RoleTool,
				Content:    content,
				ToolCallID: tc.ID,
			})
		}
	}

	return fmt.Errorf("turn limit exceeded")
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
			return t.LocalExec(d.WorkspaceRoot, input)
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
	b.WriteString("You have access to tools to read, write, and run commands in the user's workspace.\n\n")
	fmt.Fprintf(&b, "Workspace root: %s\n\n", workspaceRoot)
	b.WriteString("Available tools:\n")
	for _, t := range registry {
		fmt.Fprintf(&b, "- %s: %s\n", t.Name, t.Description)
	}
	return b.String()
}
