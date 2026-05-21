package conversation

import (
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestResponseChainRoundTrip(t *testing.T) {
	e := &Entry{}
	if id, n := e.ResponseChain(); id != "" || n != 0 {
		t.Fatalf("fresh entry should have empty chain, got (%q, %d)", id, n)
	}
	e.MarkResponseStored("resp_abc", 5)
	if id, n := e.ResponseChain(); id != "resp_abc" || n != 5 {
		t.Fatalf("MarkResponseStored not reflected: got (%q, %d)", id, n)
	}
	e.ResetResponseChain()
	if id, n := e.ResponseChain(); id != "" || n != 0 {
		t.Fatalf("ResetResponseChain did not clear: got (%q, %d)", id, n)
	}
}

func TestHydrateClearsResponseChain(t *testing.T) {
	s := NewStore()
	id := "conv-1"
	e := s.Get(id)
	e.MarkResponseStored("resp_stale", 9)

	// Hydrate replays a persisted session. The previous_response_id (if
	// any) belongs to a process that no longer exists, so it must be
	// dropped or the next Responses call will reference a vanished chain.
	s.Hydrate(id, Snapshot{
		Messages: []llm.Message{{Role: llm.RoleUser, Content: "x"}},
	})

	if rid, n := s.Get(id).ResponseChain(); rid != "" || n != 0 {
		t.Fatalf("Hydrate did not clear chain: got (%q, %d)", rid, n)
	}
}

func TestHealOrphanClearsChainOnRepair(t *testing.T) {
	e := &Entry{}
	// Pre-seed: assistant emitted two tool_calls but only one response
	// landed before the previous task was cancelled.
	e.Messages = []llm.Message{
		{Role: llm.RoleUser, Content: "go"},
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}, {ID: "b"}}},
		{Role: llm.RoleTool, ToolCallID: "a", Content: "ra"},
	}
	e.MarkResponseStored("resp_pre_heal", len(e.Messages))

	changed := e.HealOrphanToolCalls()
	if !changed {
		t.Fatalf("expected HealOrphanToolCalls to report a change")
	}
	if id, n := e.ResponseChain(); id != "" || n != 0 {
		t.Fatalf("healing should clear chain: got (%q, %d)", id, n)
	}
}

func TestHealOrphanLeavesChainAloneWhenNoRepairNeeded(t *testing.T) {
	e := &Entry{}
	e.Messages = []llm.Message{
		{Role: llm.RoleUser, Content: "go"},
		{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "a"}}},
		{Role: llm.RoleTool, ToolCallID: "a", Content: "ra"},
	}
	e.MarkResponseStored("resp_clean", len(e.Messages))

	changed := e.HealOrphanToolCalls()
	if changed {
		t.Fatalf("HealOrphanToolCalls should be a no-op on satisfied tool calls")
	}
	if id, n := e.ResponseChain(); id != "resp_clean" || n != len(e.Messages) {
		t.Fatalf("clean entry should keep its chain anchor: got (%q, %d)", id, n)
	}
}
