package loop

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestResearchPresetAllowedTools(t *testing.T) {
	preset, err := LoadPresets("", "").For("research")
	if err != nil {
		t.Fatalf("For(research): %v", err)
	}
	allowed := map[string]bool{}
	for _, name := range preset.AllowedTools {
		allowed[name] = true
	}
	for _, disallowed := range []string{"apply_diff", "run_command", "run_command_background", "kill_process", "spawn_subagent"} {
		if allowed[disallowed] {
			t.Fatalf("research preset should not allow %s", disallowed)
		}
	}
	for _, required := range []string{"read_file", "list_dir", "search", "get_diagnostics", "load_skill"} {
		if !allowed[required] {
			t.Fatalf("research preset missing %s", required)
		}
	}
}

func TestTaskRegistryCancelCancelsChildren(t *testing.T) {
	registry := NewTaskRegistry()
	rootCtx, rootCancel := context.WithCancel(context.Background())
	childCtx, childCancel := context.WithCancel(rootCtx)
	registry.Register("root", "", "main", "root", rootCancel)
	registry.Register("child", "root", "research", "child", childCancel)

	if !registry.Cancel("root") {
		t.Fatal("expected root cancel to return true")
	}
	if rootCtx.Err() == nil {
		t.Fatal("root context was not cancelled")
	}
	if childCtx.Err() == nil {
		t.Fatal("child context was not cancelled")
	}
}

func TestSpawnSubAgentDepthLimit(t *testing.T) {
	registry := NewTaskRegistry()
	registry.Register("root", "", "main", "root", func() {})
	registry.Register("child", "root", "research", "child", func() {})
	registry.Register("grandchild", "child", "research", "grandchild", func() {})

	driver := &Driver{Tasks: registry}
	input := mustJSON(t, spawnSubAgentInput{Type: "research", Task: "research x", Context: "context"})
	out := driver.execSpawnSubAgent(context.Background(), "grandchild", "conv", input, LoadPresets("", ""))
	if out.err == nil || !strings.Contains(out.err.Error(), "depth limit") {
		t.Fatalf("expected depth limit error, got %#v", out.err)
	}
}

func TestSpawnSubAgentRequiresTaskAndContext(t *testing.T) {
	registry := NewTaskRegistry()
	registry.Register("root", "", "main", "root", func() {})
	driver := &Driver{Tasks: registry}

	out := driver.execSpawnSubAgent(context.Background(), "root", "conv", mustJSON(t, map[string]string{"type": "research", "context": "ctx"}), LoadPresets("", ""))
	if out.err == nil || !strings.Contains(out.err.Error(), "task is required") {
		t.Fatalf("expected task validation error, got %#v", out.err)
	}

	out = driver.execSpawnSubAgent(context.Background(), "root", "conv", mustJSON(t, map[string]string{"type": "research", "task": "task"}), LoadPresets("", ""))
	if out.err == nil || !strings.Contains(out.err.Error(), "context is required") {
		t.Fatalf("expected context validation error, got %#v", out.err)
	}
}

func TestSubAgentTokenBudgetGuidance(t *testing.T) {
	reason := classifySubAgentTruncation(errors.New("input token budget exceeded"))
	if reason != "input_tokens" {
		t.Fatalf("reason = %q", reason)
	}
	summary := subAgentRecoverySummary(reason, 21, "input token budget exceeded")
	for _, want := range []string{
		"Sub-agent stopped: input token budget exceeded.",
		"Tool calls: 21.",
		"narrow the task to a single file/function",
		"do not re-issue the same task",
	} {
		if !strings.Contains(summary, want) {
			t.Fatalf("summary missing %q: %s", want, summary)
		}
	}
}

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
