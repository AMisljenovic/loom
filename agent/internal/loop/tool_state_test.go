package loop

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/rpc"
	"github.com/your-org/loom/internal/rules"
	"github.com/your-org/loom/internal/skills"
	"github.com/your-org/loom/internal/tools"
)

func TestReadOnlyToolCacheReturnsDuplicateWithoutRereading(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a.txt")
	if err := os.WriteFile(path, []byte("first\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	driver := &Driver{Conn: rpc.New(strings.NewReader(""), io.Discard), WorkspaceRoot: root, Tasks: NewTaskRegistry()}
	registry := toolMap(tools.Registry())
	state := newTaskToolState()
	tc := llm.ToolCall{ID: "a", Name: "read_file", Input: json.RawMessage(`{"path":"a.txt","offset":1,"limit":20}`)}

	first := driver.execOneTool(context.Background(), "task", "conv", tc, registry, nil, nil, nil, state)
	if first.err != nil || !strings.Contains(first.content, "first") {
		t.Fatalf("first read failed: content=%q err=%v", first.content, first.err)
	}
	if err := os.WriteFile(path, []byte("second\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tc.ID = "b"
	second := driver.execOneTool(context.Background(), "task", "conv", tc, registry, nil, nil, nil, state)
	if second.err != nil {
		t.Fatalf("cached read errored: %v", second.err)
	}
	if !strings.HasPrefix(second.content, "[cached duplicate]") || !strings.Contains(second.content, "first") {
		t.Fatalf("expected cached first content, got %q", second.content)
	}
}

func TestReadOnlyToolCacheWarnsAfterThreeRepeats(t *testing.T) {
	state := newTaskToolState()
	tc := llm.ToolCall{ID: "a", Name: "search", Input: json.RawMessage(`{"query":"x"}`)}
	state.Finish(tc, toolOutcome{content: "result"})
	for i := 0; i < 2; i++ {
		if content, handled := state.Begin(tc); !handled || strings.Contains(content, "warning") {
			t.Fatalf("repeat %d handled=%v content=%q", i+1, handled, content)
		}
	}
	content, handled := state.Begin(tc)
	if !handled || !strings.Contains(content, "cached duplicate warning") {
		t.Fatalf("third repeat should warn, handled=%v content=%q", handled, content)
	}
}

func TestReadFileDistinctSliceBudget(t *testing.T) {
	state := newTaskToolState()
	for i := 0; i < readFileDistinctSlicesPerPath; i++ {
		tc := llm.ToolCall{ID: "r", Name: "read_file", Input: json.RawMessage(`{"path":"a.go","offset":` + strconv.Itoa(i+1) + `,"limit":1}`)}
		if content, handled := state.Begin(tc); handled {
			t.Fatalf("slice %d should be allowed, got %q", i+1, content)
		}
	}
	tc := llm.ToolCall{ID: "overflow", Name: "read_file", Input: json.RawMessage(`{"path":"a.go","offset":99,"limit":1}`)}
	content, handled := state.Begin(tc)
	if !handled || !strings.Contains(content, "budget exhausted") {
		t.Fatalf("expected budget exhaustion, handled=%v content=%q", handled, content)
	}
}

func TestReadNavigationLoopGuardOnlyForExecutionModesWithoutEdits(t *testing.T) {
	state := newTaskToolState()
	for i := 0; i < readNavigationLoopLimit; i++ {
		state.Begin(llm.ToolCall{ID: "s", Name: "search", Input: json.RawMessage(`{"query":"x"}`)})
	}
	if !state.ShouldStopReadNavigationLoop(&ModeDefinition{ID: "code"}) {
		t.Fatal("code mode should stop after excessive read/navigation calls and no edits")
	}
	if state.ShouldStopReadNavigationLoop(&ModeDefinition{ID: "architect"}) {
		t.Fatal("architect mode should not use the edit-progress guard")
	}
	state.Begin(llm.ToolCall{ID: "w", Name: "apply_diff", Input: json.RawMessage(`{"path":"a.go","edits":[]}`)})
	if state.ShouldStopReadNavigationLoop(&ModeDefinition{ID: "debug"}) {
		t.Fatal("debug mode should not stop once an apply_diff was attempted")
	}
}

func TestBuildVolatileSystemIncludesRuntimeContext(t *testing.T) {
	got := BuildVolatileSystem("C:/repo", skills.Catalogue{}, nil, rules.Bundle{}, &runtimeContext{
		IndexState:            "ready",
		IndexEngine:           "fallback",
		IndexFilesScanned:     12,
		IndexSymbolsCount:     0,
		SemanticSearchEnabled: false,
	})
	for _, want := range []string{"Workspace root: C:/repo", "Workspace index: state=ready, engine=fallback, files=12, symbols=0", "Semantic search: disabled"} {
		if !strings.Contains(got, want) {
			t.Fatalf("volatile system missing %q in:\n%s", want, got)
		}
	}
}

func toolMap(registry []tools.Tool) map[string]tools.Tool {
	out := make(map[string]tools.Tool, len(registry))
	for _, tool := range registry {
		out[tool.Name] = tool
	}
	return out
}
