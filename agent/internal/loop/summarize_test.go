package loop

import (
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestSafeCutBoundary_NoOpWhenTailStartsCleanly(t *testing.T) {
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: "a"},
		{Role: llm.RoleAssistant, Content: "b"},
		{Role: llm.RoleUser, Content: "c"},
		{Role: llm.RoleAssistant, Content: "d"},
	}
	if got := safeCutBoundary(msgs, 2); got != 2 {
		t.Fatalf("expected unchanged cut=2, got %d", got)
	}
}

func TestSafeCutBoundary_WalksBackWhenTailStartsWithRoleTool(t *testing.T) {
	// Cut lands inside a tool-result batch — the kept tail would start with
	// an orphan tool message. Walk back past the tool result and its parent.
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: "u1"},                                  // 0
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}},      // 1
		{Role: llm.RoleTool, ToolCallID: "a", Content: "r1"},                 // 2 <- cut
		{Role: llm.RoleAssistant, Content: "reply"},                          // 3
	}
	got := safeCutBoundary(msgs, 2)
	if got != 1 {
		t.Fatalf("expected cut walked back to 1 (start of assistant tool_calls), got %d", got)
	}
}

func TestSafeCutBoundary_WalksBackPastChainedToolBatch(t *testing.T) {
	// Two tool results — cut between them should land before the parent.
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: "u1"},                                                  // 0
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}}},           // 1
		{Role: llm.RoleTool, ToolCallID: "a", Content: "r1"},                                 // 2
		{Role: llm.RoleTool, ToolCallID: "b", Content: "r2"},                                 // 3 <- cut
		{Role: llm.RoleAssistant, Content: "reply"},                                          // 4
	}
	got := safeCutBoundary(msgs, 3)
	if got != 1 {
		t.Fatalf("expected cut walked back to 1, got %d", got)
	}
}

func TestSafeCutBoundary_WalksBackWhenLastIsAssistantToolCalls(t *testing.T) {
	// Cut sits right after assistant(tool_calls) — keeping it would orphan
	// its tool results that live in the tail.
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: "u1"},                             // 0
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}}, // 1 <- last summarized
		{Role: llm.RoleTool, ToolCallID: "a", Content: "r1"},            // 2
		{Role: llm.RoleAssistant, Content: "reply"},                     // 3
	}
	got := safeCutBoundary(msgs, 2)
	if got != 1 {
		t.Fatalf("expected cut walked back to 1, got %d", got)
	}
}

func TestSafeCutBoundary_ReturnsZeroWhenNothingSafeToCut(t *testing.T) {
	// Entire prefix is one tool-bound chain — walk-back hits 0 and aborts.
	msgs := []llm.Message{
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}}, // 0
		{Role: llm.RoleTool, ToolCallID: "a", Content: "r1"},            // 1 <- cut
		{Role: llm.RoleAssistant, Content: "reply"},                     // 2
	}
	if got := safeCutBoundary(msgs, 1); got != 0 {
		t.Fatalf("expected cut=0 (abort), got %d", got)
	}
}

func TestSafeCutBoundary_GuardsAgainstOutOfRange(t *testing.T) {
	msgs := []llm.Message{{Role: llm.RoleUser, Content: "u"}}
	if got := safeCutBoundary(msgs, 0); got != 0 {
		t.Fatalf("cut=0 should pass through, got %d", got)
	}
	if got := safeCutBoundary(msgs, 1); got != 1 {
		t.Fatalf("cut at len should pass through (no kept tail to orphan), got %d", got)
	}
}
