package eval

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/your-org/loom/internal/llm"
)

func TestApplyEvalDiffUniqueReplacement(t *testing.T) {
	root := t.TempDir()
	if err := writeScenarioFiles(root, map[string]string{"src/a.txt": "alpha\nbeta\n"}); err != nil {
		t.Fatal(err)
	}
	state := &runState{root: root, touched: map[string]bool{}}
	raw := mustJSON(t, map[string]any{
		"path": "src/a.txt",
		"edits": []map[string]string{{
			"oldText": "beta",
			"newText": "gamma",
		}},
	})
	out := applyEvalDiff(state, raw)
	if !strings.Contains(out, "applied diff") {
		t.Fatalf("unexpected output: %s", out)
	}
	b, err := os.ReadFile(filepath.Join(root, "src", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(b); got != "alpha\ngamma\n" {
		t.Fatalf("unexpected file contents: %q", got)
	}
	if !state.touched["src/a.txt"] {
		t.Fatal("expected touched file to be recorded")
	}
}

func TestApplyEvalDiffRejectsAmbiguousOldText(t *testing.T) {
	root := t.TempDir()
	if err := writeScenarioFiles(root, map[string]string{"src/a.txt": "same\nsame\n"}); err != nil {
		t.Fatal(err)
	}
	state := &runState{root: root, touched: map[string]bool{}}
	out := applyEvalDiff(state, mustJSON(t, map[string]any{
		"path": "src/a.txt",
		"edits": []map[string]string{{
			"oldText": "same",
			"newText": "next",
		}},
	}))
	if !strings.Contains(out, "matched 2 times") {
		t.Fatalf("expected ambiguity error, got %q", out)
	}
}

func TestAssertions(t *testing.T) {
	state := &runState{
		toolCalls: []RecordedToolCall{{Name: "read_file"}, {Name: "load_skill"}},
		touched:   map[string]bool{"src/a.ts": true},
		loaded:    map[string]bool{"go-conventions": true},
	}
	scenario := Scenario{Assertions: []Assertion{
		{Type: "called_tool", Tool: "read_file"},
		{Type: "not_called_tool", Tool: "apply_diff"},
		{Type: "touched_file", Path: "src/a.ts"},
		{Type: "loaded_skill", Skill: "go-conventions"},
		{Type: "assistant_contains", Text: "done"},
	}}
	if failures := checkAssertions(scenario, state, "Done."); len(failures) != 0 {
		t.Fatalf("unexpected failures: %v", failures)
	}
}

func TestExecuteLoadSkillRecordsSkills(t *testing.T) {
	state := &runState{loaded: map[string]bool{}}
	out := executeTool(state, llm.ToolCall{Name: "load_skill", Input: mustJSON(t, map[string][]string{"ids": {"go-conventions", "error-handling"}})})
	if !strings.Contains(out, "go-conventions") {
		t.Fatalf("unexpected output: %s", out)
	}
	if !state.loaded["go-conventions"] || !state.loaded["error-handling"] {
		t.Fatalf("skills were not recorded: %#v", state.loaded)
	}
}

func TestExecuteRunCommandUsesScriptedOutput(t *testing.T) {
	state := &runState{commands: map[string][]string{"npm test": {"fail\n", "ok\n"}}}
	out := executeTool(state, llm.ToolCall{Name: "run_command", Input: mustJSON(t, map[string]string{"command": "npm test"})})
	if out != "fail\n" {
		t.Fatalf("unexpected first command output: %q", out)
	}
	out = executeTool(state, llm.ToolCall{Name: "run_command", Input: mustJSON(t, map[string]string{"command": "npm test"})})
	if out != "ok\n" {
		t.Fatalf("unexpected second command output: %q", out)
	}
}

func TestExecuteRunCommandCanReturnPostEditPass(t *testing.T) {
	state := &runState{
		commands: map[string][]string{"npm test": {"FAIL test\n", "PASS test\n"}},
		touched:  map[string]bool{"src/a.ts": true},
	}
	out := executeTool(state, llm.ToolCall{Name: "run_command", Input: mustJSON(t, map[string]string{"command": "npm test"})})
	if out != "PASS test\n" {
		t.Fatalf("unexpected post-edit command output: %q", out)
	}
}

func TestWriteTranscript(t *testing.T) {
	root := t.TempDir()
	path := writeTranscript(root, transcript{Scenario: "demo"})
	if path == "" {
		t.Fatal("expected transcript path")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected transcript file: %v", err)
	}
}

func TestScenarioByName(t *testing.T) {
	if _, ok := ScenarioByName("code-simple-edit"); !ok {
		t.Fatal("expected bundled scenario")
	}
	if _, ok := ScenarioByName("missing"); ok {
		t.Fatal("did not expect missing scenario")
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
