package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExternalSkillsFollowProviderFamily(t *testing.T) {
	root := t.TempDir()
	writeSkillFile(t, root, ".claude/skills/claude/SKILL.md", "claude-skill", "Claude skill")
	writeSkillFile(t, root, ".codex/skills/codex/SKILL.md", "codex-skill", "Codex skill")

	anthropic := Load(root, "anthropic")
	if _, ok := anthropic.Skills["claude-skill"]; !ok {
		t.Fatal("expected anthropic family to load .claude skill")
	}
	if _, ok := anthropic.Skills["codex-skill"]; ok {
		t.Fatal("did not expect .codex skill when .claude contributed")
	}

	openai := Load(root, "openai")
	if _, ok := openai.Skills["codex-skill"]; !ok {
		t.Fatal("expected openai family to load .codex skill")
	}
	if _, ok := openai.Skills["claude-skill"]; ok {
		t.Fatal("did not expect .claude skill when .codex contributed")
	}
}

func TestLoomSkillWinsOverExternal(t *testing.T) {
	root := t.TempDir()
	writeSkillFile(t, root, ".claude/skills/foo/SKILL.md", "foo", "External")
	writeLoomSkillFile(t, root, ".loom/skills/foo/SKILL.md", "foo", "Loom")

	cat := Load(root, "anthropic")
	got := cat.Skills["foo"]
	if got.Synopsis != "Loom" || got.Source != ".loom/skills/foo/SKILL.md" {
		t.Fatalf("expected .loom skill to win, got %#v", got)
	}
}

func TestBuiltinSkillWinsOverExternal(t *testing.T) {
	root := t.TempDir()
	writeSkillFile(t, root, ".claude/skills/testing/SKILL.md", "testing", "External testing")

	cat := Load(root, "anthropic")
	got := cat.Skills["testing"]
	if got.Source != "builtin" {
		t.Fatalf("expected builtin testing skill to win over external, got %#v", got)
	}
}

func TestMalformedExternalSkillSkipped(t *testing.T) {
	root := t.TempDir()
	writeRawFile(t, root, ".claude/skills/bad/SKILL.md", "---\ndescription: Missing name\n---\nBody")

	cat := Load(root, "anthropic")
	if _, ok := cat.Skills["bad"]; ok {
		t.Fatal("malformed external skill should be skipped")
	}
}

func TestExternalSkillFallbackOnlyWhenNativeEmpty(t *testing.T) {
	root := t.TempDir()
	writeSkillFile(t, root, ".codex/skills/codex/SKILL.md", "codex-skill", "Codex fallback")

	cat := Load(root, "anthropic")
	if _, ok := cat.Skills["codex-skill"]; !ok {
		t.Fatal("expected .codex fallback when .claude is empty")
	}

	writeSkillFile(t, root, ".claude/skills/claude/SKILL.md", "claude-skill", "Claude native")
	cat = Load(root, "anthropic")
	if _, ok := cat.Skills["claude-skill"]; !ok {
		t.Fatal("expected .claude native skill")
	}
	if _, ok := cat.Skills["codex-skill"]; ok {
		t.Fatal("did not expect fallback when native contributed")
	}
}

func TestExternalSkill_RenderLoadedTagsOrigin(t *testing.T) {
	root := t.TempDir()
	writeSkillFile(t, root, ".claude/skills/foo/SKILL.md", "foo", "External foo")

	cat := Load(root, "anthropic")
	out := cat.RenderLoaded([]string{"foo"})
	if !contains(out, `<skill id="foo" origin="claude">`) {
		t.Fatalf("expected origin attribute on external skill, got:\n%s", out)
	}
}

func TestLoomSkill_RenderLoadedOmitsOriginAttr(t *testing.T) {
	root := t.TempDir()
	writeLoomSkillFile(t, root, ".loom/skills/bar/SKILL.md", "bar", "Local bar")

	cat := Load(root, "anthropic")
	out := cat.RenderLoaded([]string{"bar"})
	if !contains(out, `<skill id="bar">`) {
		t.Fatalf("expected bare <skill id> for loom-native skill, got:\n%s", out)
	}
	if contains(out, "origin=") {
		t.Fatalf("did not expect origin attribute on loom skill:\n%s", out)
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		(haystack == needle || indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func writeSkillFile(t *testing.T, root, rel, name, description string) {
	t.Helper()
	writeRawFile(t, root, rel, "---\nname: "+name+"\ndescription: "+description+"\n---\nBody")
}

func writeLoomSkillFile(t *testing.T, root, rel, id, synopsis string) {
	t.Helper()
	writeRawFile(t, root, rel, "---\nid: "+id+"\nsynopsis: "+synopsis+"\n---\nBody")
}

func writeRawFile(t *testing.T, root, rel, text string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}
