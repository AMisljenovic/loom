package rules

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, root, rel, body string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(full), err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", full, err)
	}
}

func TestLoad_EmptyWorkspaceProducesEmptyBundle(t *testing.T) {
	dir := t.TempDir()
	b := Load(dir)
	if b.Text != "" || b.Hash != "" || len(b.Sources) != 0 {
		t.Fatalf("expected empty bundle, got %+v", b)
	}
}

func TestLoad_EmptyRootStringReturnsEmpty(t *testing.T) {
	if b := Load(""); b.Text != "" {
		t.Fatalf("expected empty bundle for empty root, got %+v", b)
	}
}

func TestLoad_LoomMdOnly(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "LOOM.md", "loom rules body")
	// Foreign-format files exist but must be ignored.
	writeFile(t, dir, "CLAUDE.md", "claude body")
	writeFile(t, dir, "AGENTS.md", "agents body")
	writeFile(t, dir, "GEMINI.md", "gemini body")
	writeFile(t, dir, ".github/copilot-instructions.md", "copilot body")
	writeFile(t, dir, ".cursorrules", "cursor body")
	writeFile(t, dir, ".claude/rules/style.md", "claude style")
	writeFile(t, dir, ".codex/rules/style.md", "codex style")

	b := Load(dir)

	if len(b.Sources) != 1 || b.Sources[0] != "LOOM.md" {
		t.Fatalf("expected only LOOM.md in sources, got %v", b.Sources)
	}
	if !strings.Contains(b.Text, "loom rules body") {
		t.Fatalf("expected LOOM.md body in bundle:\n%s", b.Text)
	}
	for _, forbidden := range []string{
		"claude body", "agents body", "gemini body",
		"copilot body", "cursor body", "claude style", "codex style",
	} {
		if strings.Contains(b.Text, forbidden) {
			t.Fatalf("foreign content leaked into bundle: %q in:\n%s", forbidden, b.Text)
		}
	}
}

func TestLoad_NoLoomMdReturnsEmpty(t *testing.T) {
	dir := t.TempDir()
	// Foreign files alone do not produce a bundle.
	writeFile(t, dir, "CLAUDE.md", "claude body")
	writeFile(t, dir, "AGENTS.md", "agents body")

	b := Load(dir)
	if b.Text != "" || b.Hash != "" || len(b.Sources) != 0 {
		t.Fatalf("expected empty bundle when LOOM.md absent, got %+v", b)
	}
}

func TestLoad_EnvelopeWrapsBody(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "LOOM.md", "body line 1\nbody line 2")

	b := Load(dir)
	if !strings.HasPrefix(b.Text, `<rules source="LOOM.md">`) {
		t.Fatalf("expected envelope prefix, got:\n%s", b.Text)
	}
	if !strings.HasSuffix(b.Text, "</rules>") {
		t.Fatalf("expected envelope suffix, got:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, "body line 1\nbody line 2") {
		t.Fatalf("expected body verbatim, got:\n%s", b.Text)
	}
}

func TestLoad_RespectsMaxBundleBytes(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "LOOM.md", strings.Repeat("x", MaxBundleBytes+1024))

	b := Load(dir)
	if !strings.Contains(b.Text, "<truncated:") {
		t.Fatalf("expected truncation marker when LOOM.md exceeds cap")
	}
	// Envelope + body + truncation marker should be within a small overhead
	// of the cap.
	if len(b.Text) > MaxBundleBytes+256 {
		t.Fatalf("bundle exceeded cap with overhead: len=%d", len(b.Text))
	}
}

func TestLoad_HashStableAcrossRuns(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "LOOM.md", "stable body")

	first := Load(dir)
	second := Load(dir)
	if first.Hash == "" || first.Hash != second.Hash {
		t.Fatalf("hash unstable: %q vs %q", first.Hash, second.Hash)
	}
	if first.Text != second.Text {
		t.Fatalf("text not byte-stable across calls")
	}
}

func TestLoad_HashChangesWhenBodyChanges(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "LOOM.md", "before")
	a := Load(dir).Hash
	writeFile(t, dir, "LOOM.md", "after")
	b := Load(dir).Hash
	if a == b {
		t.Fatalf("expected hash to change with body, both %q", a)
	}
}
