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
//   - RoleUser:      Content holds the prompt.
//   - RoleAssistant: Content holds the assistant text (may be empty if the turn
//     produced only tool calls). ToolCalls holds the calls the
//     model wants to invoke.
//   - RoleTool:      Content holds the tool result. ToolCallID identifies which
//     assistant tool call this is the answer to.
type Message struct {
	Role       Role       `json:"role"`
	Content    string     `json:"content"`
	Images     []Image    `json:"images,omitempty"`
	ToolCalls  []ToolCall `json:"toolCalls,omitempty"`
	ToolCallID string     `json:"toolCallId,omitempty"`
}

type Image struct {
	ID       string `json:"id,omitempty"`
	Label    string `json:"label,omitempty"`
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
	Size     int64  `json:"size,omitempty"`
}

type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
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

type TokenUsage struct {
	InputTokens         int64 `json:"inputTokens"`
	OutputTokens        int64 `json:"outputTokens"`
	CacheCreationTokens int64 `json:"cacheCreationTokens,omitempty"`
	CacheReadTokens     int64 `json:"cacheReadTokens,omitempty"`
}

type StreamResult struct {
	StopReason string     `json:"stopReason"`
	Usage      TokenUsage `json:"usage"`
}

// SystemPrompt carries a split system prompt for prompt caching. Stable is
// byte-identical across turns for a given (mode, registry, provider) and is
// where the provider places its cache_control breakpoint. Volatile follows
// the breakpoint and may change every turn (workspace path, loaded skills,
// rules). Providers without per-block caching concatenate the two.
type SystemPrompt struct {
	Stable   string
	Volatile string
}

// String returns the concatenation suitable for providers that do not split
// system content into blocks.
func (s SystemPrompt) String() string {
	if s.Stable == "" {
		return s.Volatile
	}
	if s.Volatile == "" {
		return s.Stable
	}
	return s.Stable + "\n\n" + s.Volatile
}

// Provider abstracts a single LLM backend. Stream blocks until the turn ends
// and returns the stop reason:
//
//	"tool_calls"  — model wants the caller to execute ToolCalls and feed
//	                results back in the next Stream call.
//	"end_turn"    — model is done; the loop should exit.
//
// Any other value is treated as end-of-turn by the loop.
type Provider interface {
	Model() string
	MaxContextTokens() int64
	// Family identifies the model family ("anthropic", "openai", or "gemini")
	// so the rules loader can pick the right convention files (CLAUDE.md vs
	// AGENTS.md vs GEMINI.md).
	Family() string
	Stream(
		ctx context.Context,
		system SystemPrompt,
		messages []Message,
		tools []ToolDef,
		h StreamHandler,
	) (StreamResult, error)
	Complete(ctx context.Context, systemPrompt string, messages []Message) (string, TokenUsage, error)
}
