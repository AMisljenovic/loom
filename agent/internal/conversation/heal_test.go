package conversation

import (
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestHealNoToolCalls(t *testing.T) {
	in := []llm.Message{
		{Role: llm.RoleUser, Content: "hi"},
		{Role: llm.RoleAssistant, Content: "hello"},
	}
	got := healOrphanToolCalls(in)
	if len(got) != 2 {
		t.Fatalf("expected unchanged, got %d messages", len(got))
	}
}

func TestHealFullySatisfied(t *testing.T) {
	in := []llm.Message{
		{Role: llm.RoleUser, Content: "go"},
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}}},
		{Role: llm.RoleTool, ToolCallID: "a", Content: "ra"},
		{Role: llm.RoleTool, ToolCallID: "b", Content: "rb"},
		{Role: llm.RoleAssistant, Content: "done"},
	}
	got := healOrphanToolCalls(in)
	if len(got) != len(in) {
		t.Fatalf("expected no synthetic messages, got %d (want %d)", len(got), len(in))
	}
}

func TestHealMissingAllToolResponses(t *testing.T) {
	in := []llm.Message{
		{Role: llm.RoleUser, Content: "go"},
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}}},
	}
	got := healOrphanToolCalls(in)
	if len(got) != 4 {
		t.Fatalf("expected 4 messages (user + assistant + 2 synthetic tool), got %d", len(got))
	}
	if got[2].Role != llm.RoleTool || got[2].ToolCallID != "a" {
		t.Fatalf("synthetic[0]: role=%s id=%s", got[2].Role, got[2].ToolCallID)
	}
	if got[3].Role != llm.RoleTool || got[3].ToolCallID != "b" {
		t.Fatalf("synthetic[1]: role=%s id=%s", got[3].Role, got[3].ToolCallID)
	}
}

func TestHealPartialResponses(t *testing.T) {
	in := []llm.Message{
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}, {ID: "c"}}},
		{Role: llm.RoleTool, ToolCallID: "a", Content: "ra"},
	}
	got := healOrphanToolCalls(in)
	if len(got) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(got))
	}
	// Order: assistant, real tool(a), synthetic(b), synthetic(c).
	if got[1].ToolCallID != "a" || got[2].ToolCallID != "b" || got[3].ToolCallID != "c" {
		t.Fatalf("ordering wrong: %s, %s, %s", got[1].ToolCallID, got[2].ToolCallID, got[3].ToolCallID)
	}
}

func TestHealKeepsSubsequentAssistantTurn(t *testing.T) {
	// Reload happens during the *first* tool turn; persisted state somehow
	// also contains a later assistant message (unlikely but the heal must
	// not lose data either way).
	in := []llm.Message{
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}},
		{Role: llm.RoleAssistant, Content: "later"}, // missing tool for a, but later message exists
	}
	got := healOrphanToolCalls(in)
	if len(got) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(got))
	}
	if got[1].Role != llm.RoleTool || got[1].ToolCallID != "a" {
		t.Fatalf("synthetic should be inserted before the later assistant, got role=%s id=%s", got[1].Role, got[1].ToolCallID)
	}
	if got[2].Content != "later" {
		t.Fatalf("later assistant lost, got %q", got[2].Content)
	}
}

func TestHealInsertsBeforeSubsequentUserTurn(t *testing.T) {
	in := []llm.Message{
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}}},
		{Role: llm.RoleUser, Content: "continue"},
	}
	got := healOrphanToolCalls(in)
	if len(got) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(got))
	}
	if got[1].Role != llm.RoleTool || got[1].ToolCallID != "a" {
		t.Fatalf("expected synthetic tool a before user, got role=%s id=%s", got[1].Role, got[1].ToolCallID)
	}
	if got[2].Role != llm.RoleTool || got[2].ToolCallID != "b" {
		t.Fatalf("expected synthetic tool b before user, got role=%s id=%s", got[2].Role, got[2].ToolCallID)
	}
	if got[3].Role != llm.RoleUser || got[3].Content != "continue" {
		t.Fatalf("expected user turn preserved after synthetic tools, got role=%s content=%q", got[3].Role, got[3].Content)
	}
}

func TestEntryHealOrphanToolCallsReportsMutation(t *testing.T) {
	e := &Entry{Messages: []llm.Message{
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}},
	}}
	if !e.HealOrphanToolCalls() {
		t.Fatalf("expected repair to report a mutation")
	}
	if len(e.Messages) != 2 || e.Messages[1].Role != llm.RoleTool || e.Messages[1].ToolCallID != "a" {
		t.Fatalf("expected synthetic tool result, got %#v", e.Messages)
	}
	if e.HealOrphanToolCalls() {
		t.Fatalf("second repair should be a no-op")
	}
}

func TestHydrateRunsHeal(t *testing.T) {
	s := NewStore()
	s.Hydrate("c1", Snapshot{
		Messages: []llm.Message{
			{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}},
		},
	})
	e := s.Get("c1")
	if len(e.Messages) != 2 {
		t.Fatalf("expected Hydrate to inject synthetic tool message, got %d", len(e.Messages))
	}
	if e.Messages[1].Role != llm.RoleTool {
		t.Fatalf("expected synthetic tool message, got role=%s", e.Messages[1].Role)
	}
}
