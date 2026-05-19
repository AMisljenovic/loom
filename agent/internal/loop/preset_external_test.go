package loop

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestImportedPresetTrustsToolsAsWritten(t *testing.T) {
	root := t.TempDir()
	writePresetFile(t, root, ".claude/agents/foo.md", "foo", "Foo agent", "read_file, apply_diff")

	reg := LoadPresets(root, "anthropic")
	p, err := reg.For("foo")
	if err != nil {
		t.Fatalf("For(foo): %v", err)
	}
	if !reflect.DeepEqual(p.AllowedTools, []string{"read_file", "apply_diff"}) {
		t.Fatalf("allowed tools = %#v", p.AllowedTools)
	}
}

func TestBuiltinPresetWinsOverExternal(t *testing.T) {
	root := t.TempDir()
	writePresetFile(t, root, ".claude/agents/research.md", "research", "External research", "apply_diff")

	reg := LoadPresets(root, "anthropic")
	p, err := reg.For("research")
	if err != nil {
		t.Fatalf("For(research): %v", err)
	}
	if p.Source != "builtin" {
		t.Fatalf("expected builtin research to win over external, got %#v", p)
	}
}

func TestLoomPresetWinsOverBuiltin(t *testing.T) {
	root := t.TempDir()
	writePresetFile(t, root, ".loom/agents/research.md", "research", "Workspace research", "read_file")

	reg := LoadPresets(root, "anthropic")
	p, err := reg.For("research")
	if err != nil {
		t.Fatalf("For(research): %v", err)
	}
	if p.Source != ".loom/agents/research.md" || p.Description != "Workspace research" {
		t.Fatalf("expected .loom research to win, got %#v", p)
	}
}

func TestPresetFamilyFlipSwapsDirectory(t *testing.T) {
	root := t.TempDir()
	writePresetFile(t, root, ".claude/agents/claude.md", "claude", "Claude agent", "read_file")
	writePresetFile(t, root, ".codex/agents/codex.md", "codex", "Codex agent", "read_file")

	if _, err := LoadPresets(root, "anthropic").For("claude"); err != nil {
		t.Fatalf("expected anthropic family to load .claude agent: %v", err)
	}
	if _, err := LoadPresets(root, "anthropic").For("codex"); err == nil {
		t.Fatal("did not expect .codex agent when .claude contributed")
	}
	if _, err := LoadPresets(root, "openai").For("codex"); err != nil {
		t.Fatalf("expected openai family to load .codex agent: %v", err)
	}
	if _, err := LoadPresets(root, "openai").For("claude"); err == nil {
		t.Fatal("did not expect .claude agent when .codex contributed")
	}
}

func TestPresetGeminiFamilyLoadsGeminiAgents(t *testing.T) {
	root := t.TempDir()
	writePresetFile(t, root, ".gemini/agents/gem.md", "gem", "Gemini agent", "read_file")
	writePresetFile(t, root, ".claude/agents/claude.md", "claude", "Claude agent", "read_file")

	reg := LoadPresets(root, "gemini")
	if _, err := reg.For("gem"); err != nil {
		t.Fatalf("expected gemini family to load .gemini agent: %v", err)
	}
	if _, err := reg.For("claude"); err == nil {
		t.Fatal("did not expect .claude agent when .gemini contributed")
	}
}

func TestIsExternalPresetSource_RecognisesGemini(t *testing.T) {
	if !isExternalPresetSource(".gemini/agents/foo.md") {
		t.Fatal("expected .gemini agent path to be external")
	}
}

func writePresetFile(t *testing.T, root, rel, name, description, tools string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	text := "---\nname: " + name + "\ndescription: " + description + "\ntools: " + tools + "\n---\nPrompt"
	if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}
