//go:build cgo

package index

import (
	"os"
	"strings"
	"testing"
)

// TestParseFileSmokeGo verifies that tree-sitter extraction picks up Go
// function and type definitions from a real source file in this repo.
func TestParseFileSmokeGo(t *testing.T) {
	const path = "indexer.go"
	content, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("read %s: %v", path, err)
	}
	syms, refs := parseFile(path, path, content)
	if len(syms) == 0 {
		t.Fatalf("expected symbols, got 0 (engine=%s)", engineName)
	}
	var names []string
	for _, s := range syms {
		names = append(names, s.Name)
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{"New", "Start", "Indexer"} {
		if !strings.Contains(joined, want) {
			t.Errorf("expected to find %q among extracted symbols, got: %s", want, joined)
		}
	}
	if len(refs) == 0 {
		t.Error("expected at least some identifier references")
	}
}
