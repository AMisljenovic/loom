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

func TestWireMessages_ElidesReadFullyCoveredByLaterBroaderRead(t *testing.T) {
	narrow := strings.Repeat("n", 1024)
	wide := strings.Repeat("w", 4096)
	msgs := []llm.Message{
		// Older narrow read: lines 10-19 of foo.go
		assistantCall("narrow", "read_file", `{"path":"foo.go","offset":10,"limit":10}`),
		{Role: llm.RoleTool, ToolCallID: "narrow", Content: narrow},
		// Later broader read: lines 1-100 of foo.go — fully covers the narrow window
		assistantCall("wide", "read_file", `{"path":"foo.go","offset":1,"limit":100}`),
		{Role: llm.RoleTool, ToolCallID: "wide", Content: wide},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	if !strings.Contains(out[1].Content, "superseded") {
		t.Fatalf("narrow read should be elided as superseded; got %q", out[1].Content)
	}
	if !strings.Contains(out[1].Content, "wide") {
		t.Fatalf("elision marker should reference the covering tool_call_id; got %q", out[1].Content)
	}
	if out[3].Content != wide {
		t.Fatalf("later broader read should stay full")
	}
}

func TestWireMessages_KeepsNonOverlappingReadsOnSameFile(t *testing.T) {
	first := strings.Repeat("a", 1024)
	second := strings.Repeat("b", 1024)
	msgs := []llm.Message{
		// Lines 1-10 of bar.go
		assistantCall("first", "read_file", `{"path":"bar.go","offset":1,"limit":10}`),
		{Role: llm.RoleTool, ToolCallID: "first", Content: first},
		// Lines 50-60 of bar.go — no overlap with 1-10
		assistantCall("second", "read_file", `{"path":"bar.go","offset":50,"limit":11}`),
		{Role: llm.RoleTool, ToolCallID: "second", Content: second},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	if out[1].Content != first {
		t.Fatalf("non-overlapping older read should stay full; got %q", out[1].Content)
	}
	if out[3].Content != second {
		t.Fatalf("non-overlapping newer read should stay full; got %q", out[3].Content)
	}
}

func TestWireMessages_ElidesReadCoveredByUnboundedLaterRead(t *testing.T) {
	narrow := strings.Repeat("n", 1024)
	whole := strings.Repeat("w", 4096)
	msgs := []llm.Message{
		// Older narrow read
		assistantCall("narrow", "read_file", `{"path":"baz.go","offset":5,"limit":20}`),
		{Role: llm.RoleTool, ToolCallID: "narrow", Content: narrow},
		// Later whole-file read (no offset/limit) — covers everything
		assistantCall("whole", "read_file", `{"path":"baz.go"}`),
		{Role: llm.RoleTool, ToolCallID: "whole", Content: whole},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	if !strings.Contains(out[1].Content, "superseded") {
		t.Fatalf("narrow read should be superseded by whole-file read; got %q", out[1].Content)
	}
}

func TestWireMessages_KeepsOnlyMostRecentUniqueSearchQueries(t *testing.T) {
	body := func(tag string) string { return tag + strings.Repeat("x", 1024) }
	msgs := []llm.Message{
		// Oldest unique query — should be elided as superseded
		assistantCall("q1", "search", `{"query":"alpha"}`),
		{Role: llm.RoleTool, ToolCallID: "q1", Content: body("q1")},
		assistantCall("q2", "search", `{"query":"beta"}`),
		{Role: llm.RoleTool, ToolCallID: "q2", Content: body("q2")},
		assistantCall("q3", "search", `{"query":"gamma"}`),
		{Role: llm.RoleTool, ToolCallID: "q3", Content: body("q3")},
		assistantCall("q4", "search", `{"query":"delta"}`),
		{Role: llm.RoleTool, ToolCallID: "q4", Content: body("q4")},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	// Latest 3 unique queries (q2, q3, q4) keep their content.
	if out[3].Content != body("q2") {
		t.Fatalf("q2 should be kept (within latest 3): %q", out[3].Content)
	}
	if out[5].Content != body("q3") {
		t.Fatalf("q3 should be kept: %q", out[5].Content)
	}
	if out[7].Content != body("q4") {
		t.Fatalf("q4 should be kept: %q", out[7].Content)
	}
	// Oldest (q1) elides.
	if !strings.Contains(out[1].Content, "superseded") {
		t.Fatalf("q1 should be elided as superseded: %q", out[1].Content)
	}
}

func TestWireMessages_SearchRecencyOnlyCountsUniqueQueries(t *testing.T) {
	body := func(tag string) string { return tag + strings.Repeat("x", 1024) }
	// Three of the four are the same query; the cap counts unique keys, so
	// "beta" should also stay full because we've only kept 2 unique queries.
	msgs := []llm.Message{
		assistantCall("q1", "search", `{"query":"alpha"}`),
		{Role: llm.RoleTool, ToolCallID: "q1", Content: body("q1")},
		assistantCall("q2", "search", `{"query":"alpha"}`),
		{Role: llm.RoleTool, ToolCallID: "q2", Content: body("q2")},
		assistantCall("q3", "search", `{"query":"alpha"}`),
		{Role: llm.RoleTool, ToolCallID: "q3", Content: body("q3")},
		assistantCall("q4", "search", `{"query":"beta"}`),
		{Role: llm.RoleTool, ToolCallID: "q4", Content: body("q4")},
	}

	out := wireMessages(cloneMessagesForTest(msgs))
	// q4 (beta) is the latest and stays.
	if out[7].Content != body("q4") {
		t.Fatalf("q4 should be kept: %q", out[7].Content)
	}
	// q3 (alpha) is the freshest alpha and stays.
	if out[5].Content != body("q3") {
		t.Fatalf("q3 should be kept: %q", out[5].Content)
	}
	// q2 (alpha duplicate) elides via exact-input dedup.
	if !strings.Contains(out[3].Content, "duplicate tool-result elided") {
		t.Fatalf("q2 should be exact-dedup elided: %q", out[3].Content)
	}
	// q1 (alpha duplicate) elides via exact-input dedup too.
	if !strings.Contains(out[1].Content, "duplicate tool-result elided") {
		t.Fatalf("q1 should be exact-dedup elided: %q", out[1].Content)
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
