package loop

import (
	"strings"
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestWireMessages_KeepsOldUniqueReadResults(t *testing.T) {
	body := strings.Repeat("x", 4096)
	msgs := []llm.Message{
		assistantCall("a", "read_file", `{"path":"a.go","offset":1,"limit":40}`),
		{Role: llm.RoleTool, ToolCallID: "a", Content: body},
		assistantCall("b", "read_file", `{"path":"b.go","offset":1,"limit":40}`),
		{Role: llm.RoleTool, ToolCallID: "b", Content: body},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	if out[1].Content != body {
		t.Fatalf("unique old read result was elided: %q", out[1].Content)
	}
	if out[3].Content != body {
		t.Fatalf("latest read result changed: %q", out[3].Content)
	}
}

func TestWireMessages_ElidesOlderDuplicateReadResults(t *testing.T) {
	msgs := []llm.Message{
		assistantCall("old", "read_file", `{"path":"a.go","offset":1,"limit":40}`),
		{Role: llm.RoleTool, ToolCallID: "old", Content: "old content"},
		assistantCall("new", "read_file", `{"limit":40,"offset":1,"path":"a.go"}`),
		{Role: llm.RoleTool, ToolCallID: "new", Content: "new content"},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	if !strings.Contains(out[1].Content, "duplicate tool-result elided") {
		t.Fatalf("older duplicate was not elided: %q", out[1].Content)
	}
	if !strings.Contains(out[1].Content, "new") {
		t.Fatalf("elision marker should point at retained call id, got %q", out[1].Content)
	}
	if out[3].Content != "new content" {
		t.Fatalf("latest duplicate should stay full, got %q", out[3].Content)
	}
}

func TestWireMessages_DoesNotElideWriteOrStateResults(t *testing.T) {
	msgs := []llm.Message{
		assistantCall("a", "apply_diff", `{"path":"a.go"}`),
		{Role: llm.RoleTool, ToolCallID: "a", Content: strings.Repeat("patched", 200)},
		assistantCall("b", "spawn_subagent", `{"type":"research","task":"x","context":"y"}`),
		{Role: llm.RoleTool, ToolCallID: "b", Content: strings.Repeat("summary", 200)},
		assistantCall("c", "apply_diff", `{"path":"a.go"}`),
		{Role: llm.RoleTool, ToolCallID: "c", Content: strings.Repeat("patched", 200)},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	for i, msg := range out {
		if msg.Role == llm.RoleTool && strings.Contains(msg.Content, "elided") {
			t.Fatalf("tool result %d should remain full: %q", i, msg.Content)
		}
	}
}

func TestWireMessages_LeavesMessagesWithoutToolMetadataAlone(t *testing.T) {
	big := strings.Repeat("y", 4096)
	msgs := []llm.Message{
		{Role: llm.RoleUser, Content: big},
		{Role: llm.RoleAssistant, Content: big},
		{Role: llm.RoleTool, Content: big},
	}
	out := wireMessages(cloneMessagesForTest(msgs))
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

func assistantCall(id, name, input string) llm.Message {
	return llm.Message{
		Role: llm.RoleAssistant,
		ToolCalls: []llm.ToolCall{{
			ID:    id,
			Name:  name,
			Input: []byte(input),
		}},
	}
}

func cloneMessagesForTest(in []llm.Message) []llm.Message {
	out := make([]llm.Message, len(in))
	copy(out, in)
	for i := range out {
		out[i].ToolCalls = append([]llm.ToolCall(nil), out[i].ToolCalls...)
	}
	return out
}
