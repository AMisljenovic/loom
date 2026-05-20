package loop

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/rpc"
)

type healingProbeProvider struct {
	messages []llm.Message
}

func (p *healingProbeProvider) Model() string           { return "test-model" }
func (p *healingProbeProvider) MaxContextTokens() int64 { return 0 }
func (p *healingProbeProvider) Family() string          { return "openai" }
func (p *healingProbeProvider) Complete(context.Context, string, []llm.Message) (string, llm.TokenUsage, error) {
	return "", llm.TokenUsage{}, nil
}
func (p *healingProbeProvider) Stream(
	_ context.Context,
	_ llm.SystemPrompt,
	messages []llm.Message,
	_ []llm.ToolDef,
	_ llm.StreamHandler,
) (llm.StreamResult, error) {
	p.messages = append([]llm.Message(nil), messages...)
	return llm.StreamResult{StopReason: "end_turn"}, nil
}

func TestRunHealsInMemoryOrphanToolCallsBeforeStreaming(t *testing.T) {
	store := conversation.NewStore()
	entry := store.Get("c1")
	entry.Append(llm.Message{
		Role: llm.RoleAssistant,
		ToolCalls: []llm.ToolCall{{
			ID:    "call_a",
			Name:  "read_file",
			Input: json.RawMessage(`{"path":"a.txt"}`),
		}},
	})

	provider := &healingProbeProvider{}
	driver := &Driver{
		Conn:          rpc.New(strings.NewReader(""), io.Discard),
		LLM:           provider,
		Conversations: store,
	}
	if err := driver.Run(context.Background(), StartParams{
		TaskID:         "t1",
		ConversationID: "c1",
		Prompt:         "continue",
	}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}

	if len(provider.messages) != 3 {
		t.Fatalf("expected assistant, synthetic tool, user; got %d messages: %#v", len(provider.messages), provider.messages)
	}
	if provider.messages[0].Role != llm.RoleAssistant || len(provider.messages[0].ToolCalls) != 1 {
		t.Fatalf("expected original assistant tool call first, got %#v", provider.messages[0])
	}
	if provider.messages[1].Role != llm.RoleTool || provider.messages[1].ToolCallID != "call_a" {
		t.Fatalf("expected synthetic tool response second, got %#v", provider.messages[1])
	}
	if provider.messages[2].Role != llm.RoleUser || provider.messages[2].Content != "continue" {
		t.Fatalf("expected new user prompt after repair, got %#v", provider.messages[2])
	}
}
