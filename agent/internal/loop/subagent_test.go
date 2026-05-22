package loop

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/your-org/loom/internal/skills"
	"github.com/your-org/loom/internal/tools"
)

func TestResearchPresetAllowedTools(t *testing.T) {
	assertReadOnlyBuiltinPreset(t, "research")
}

func TestReviewPresetAllowedTools(t *testing.T) {
	assertReadOnlyBuiltinPreset(t, "review")
}

func TestTestScoutPresetAllowedTools(t *testing.T) {
	assertReadOnlyBuiltinPreset(t, "test-scout")
}

func TestArchitectureMapperPresetAllowedTools(t *testing.T) {
	assertReadOnlyBuiltinPreset(t, "architecture-mapper")
}

func TestScoutPresetAllowedTools(t *testing.T) {
	assertReadOnlyBuiltinPreset(t, "scout")
}

func assertReadOnlyBuiltinPreset(t *testing.T, name string) {
	t.Helper()
	preset, err := LoadPresets("").For(name)
	if err != nil {
		t.Fatalf("For(%s): %v", name, err)
	}
	allowed := map[string]bool{}
	for _, name := range preset.AllowedTools {
		allowed[name] = true
	}
	if strings.TrimSpace(preset.SystemPrompt) == "" {
		t.Fatalf("%s SystemPrompt is empty", name)
	}
	if !reflect.DeepEqual(preset.AutoApprove, preset.AllowedTools) {
		t.Fatalf("%s AutoApprove = %#v, want AllowedTools %#v", name, preset.AutoApprove, preset.AllowedTools)
	}
	for _, disallowed := range []string{"apply_diff", "run_command", "run_command_background", "kill_process", "spawn_subagent"} {
		if allowed[disallowed] {
			t.Fatalf("research preset should not allow %s", disallowed)
		}
	}
	for _, required := range []string{"read_file", "list_dir", "search", "find_files", "get_diagnostics", "load_skill"} {
		if !allowed[required] {
			t.Fatalf("research preset missing %s", required)
		}
	}
}

func TestBuiltInPresetBudgets(t *testing.T) {
	for _, name := range []string{"research", "review", "test-scout", "architecture-mapper"} {
		preset, err := LoadPresets("").For(name)
		if err != nil {
			t.Fatalf("For(%s): %v", name, err)
		}
		if preset.MaxTurns != 45 {
			t.Fatalf("%s MaxTurns = %d, want 45", name, preset.MaxTurns)
		}
		if preset.MaxInputTokens != 100000 {
			t.Fatalf("%s MaxInputTokens = %d, want 100000", name, preset.MaxInputTokens)
		}
	}
}

func TestScoutPresetBudget(t *testing.T) {
	preset, err := LoadPresets("").For("scout")
	if err != nil {
		t.Fatalf("For(scout): %v", err)
	}
	if preset.MaxTurns != scoutMaxTurns {
		t.Fatalf("scout MaxTurns = %d, want %d", preset.MaxTurns, scoutMaxTurns)
	}
	if preset.MaxInputTokens != scoutMaxInputTokens {
		t.Fatalf("scout MaxInputTokens = %d, want %d", preset.MaxInputTokens, scoutMaxInputTokens)
	}
}

func TestSpawnSubAgentSchemaIncludesBuiltInPresets(t *testing.T) {
	schema := spawnSubAgentInputSchema(LoadPresets("").All())
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("properties missing: %#v", schema["properties"])
	}
	typeSchema, ok := properties["type"].(map[string]any)
	if !ok {
		t.Fatalf("type schema missing: %#v", properties["type"])
	}
	enum, ok := typeSchema["enum"].([]string)
	if !ok {
		t.Fatalf("enum missing: %#v", typeSchema["enum"])
	}
	if want := []string{"architecture-mapper", "research", "review", "scout", "test-scout"}; !reflect.DeepEqual(enum, want) {
		t.Fatalf("enum = %#v, want %#v", enum, want)
	}
}

func TestStableSystemListsBuiltInPresets(t *testing.T) {
	presets := LoadPresets("")
	registry := withSubAgentPresetSchema(tools.Registry(), presets.All())
	stable := BuildStableSystem(&ModeDefinition{ID: "code", Label: "Code"}, registry, skills.Catalogue{}, presets.All())
	for _, want := range []string{
		"- research: isolated read-only research; pass task, context, and optional files",
		"- review: read-only implementation review; return actionable findings for the parent agent",
		"- test-scout: read-only test coverage scout; map existing coverage, missing scenarios, and risk for a change surface",
		"- architecture-mapper: read-only structural mapper; return layers, public surface, import edges, and cycles for a named target tree",
		"- scout: read-only repo surveyor; given a task, return the relevant folder map, hot files with line ranges, and suggested next reads",
	} {
		if !strings.Contains(stable, want) {
			t.Fatalf("stable prompt missing %q", want)
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
	out := driver.execSpawnSubAgent(context.Background(), "grandchild", "conv", input, LoadPresets(""))
	if out.err == nil || !strings.Contains(out.err.Error(), "depth limit") {
		t.Fatalf("expected depth limit error, got %#v", out.err)
	}
}

func TestSpawnSubAgentRequiresTaskAndContext(t *testing.T) {
	registry := NewTaskRegistry()
	registry.Register("root", "", "main", "root", func() {})
	driver := &Driver{Tasks: registry}

	out := driver.execSpawnSubAgent(context.Background(), "root", "conv", mustJSON(t, map[string]string{"type": "research", "context": "ctx"}), LoadPresets(""))
	if out.err == nil || !strings.Contains(out.err.Error(), "task is required") {
		t.Fatalf("expected task validation error, got %#v", out.err)
	}

	out = driver.execSpawnSubAgent(context.Background(), "root", "conv", mustJSON(t, map[string]string{"type": "research", "task": "task"}), LoadPresets(""))
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
