package loop

import (
	"strings"
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestWireMessages_KeepsRecentToolResults(t *testing.T) {
	largeBody := strings.Repeat("x", minElideToolResultBytes+512)
	var msgs []llm.Message
	for i := 0; i < keepRecentToolResults+3; i++ {
		msgs = append(msgs, llm.Message{Role: llm.RoleTool, Content: largeBody})
	}

	out := wireMessages(append([]llm.Message(nil), msgs...))
	if len(out) != len(msgs) {
		t.Fatalf("expected same message count, got %d vs %d", len(out), len(msgs))
	}
	// First three (oldest) tool results elided; last six kept.
	for i, m := range out {
		if i < 3 {
			if !strings.HasPrefix(m.Content, "<tool-result elided") {
				t.Errorf("msg %d expected elision, got %q", i, m.Content[:min(40, len(m.Content))])
			}
		} else if m.Content != largeBody {
			t.Errorf("msg %d expected full body, got %q", i, m.Content[:min(40, len(m.Content))])
		}
	}
}

func TestWireMessages_SmallResultsNotElided(t *testing.T) {
	small := "ok"
	var msgs []llm.Message
	for i := 0; i < keepRecentToolResults+5; i++ {
		msgs = append(msgs, llm.Message{Role: llm.RoleTool, Content: small})
	}
	out := wireMessages(msgs)
	for i, m := range out {
		if m.Content != small {
			t.Errorf("msg %d: small content should not be elided, got %q", i, m.Content)
		}
	}
}

func TestWireMessages_LeavesNonToolMessagesAlone(t *testing.T) {
	big := strings.Repeat("y", minElideToolResultBytes+128)
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: big},
		{Role: llm.RoleAssistant, Content: big},
		{Role: llm.RoleTool, Content: big}, // newest, kept verbatim
	}
	out := wireMessages(msgs)
	for i, m := range out {
		if m.Content != big {
			t.Errorf("msg %d (role=%s) was unexpectedly rewritten", i, m.Role)
		}
	}
}

func TestWireMessages_EmptyInput(t *testing.T) {
	out := wireMessages(nil)
	if len(out) != 0 {
		t.Fatalf("expected nil, got %v", out)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
