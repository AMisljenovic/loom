package llm

import (
	"context"
	"encoding/json"
)

// Provider-neutral types. SDK-specific types stay inside per-provider files
// (openai.go, anthropic.go) so internal/loop never imports an SDK directly.

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is one entry in the conversation history.
//
// - RoleUser:      Content holds the prompt.
// - RoleAssistant: Content holds the assistant text (may be empty if the turn
//                  produced only tool calls). ToolCalls holds the calls the
//                  model wants to invoke.
// - RoleTool:      Content holds the tool result. ToolCallID identifies which
//                  assistant tool call this is the answer to.
type Message struct {
	Role       Role
	Content    string
	ToolCalls  []ToolCall
	ToolCallID string
}

type ToolCall struct {
	ID    string
	Name  string
	Input json.RawMessage
}

type ToolDef struct {
	Name        string
	Description string
	// JSON Schema describing the tool's input.
	InputSchema map[string]any
}

// StreamHandler receives streaming events from a Provider during a single
// turn. Both methods are called from the goroutine driving Stream; they
// should be fast and non-blocking. Tool calls returned via OnToolUse are
// fully assembled (arguments deltas are accumulated by the provider).
type StreamHandler interface {
	OnTextDelta(text string)
	OnToolUse(call ToolCall)
}

// Provider abstracts a single LLM backend. Stream blocks until the turn ends
// and returns the stop reason:
//
//   "tool_calls"  — model wants the caller to execute ToolCalls and feed
//                   results back in the next Stream call.
//   "end_turn"    — model is done; the loop should exit.
//
// Any other value is treated as end-of-turn by the loop.
type Provider interface {
	Stream(
		ctx context.Context,
		systemPrompt string,
		messages []Message,
		tools []ToolDef,
		h StreamHandler,
	) (stopReason string, err error)
}
