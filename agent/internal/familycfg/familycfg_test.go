package familycfg

import (
	"reflect"
	"testing"
)

func TestForKnownFamilies(t *testing.T) {
	cases := []struct {
		family    string
		rulesFile string
		rulesDir  string
		skillsDir string
		agentsDir string
	}{
		{"anthropic", "CLAUDE.md", ".claude/rules", ".claude/skills", ".claude/agents"},
		{"openai", "AGENTS.md", ".codex/rules", ".codex/skills", ".codex/agents"},
		{"gemini", "GEMINI.md", ".gemini/rules", ".gemini/skills", ".gemini/agents"},
	}
	for _, tc := range cases {
		c, ok := For(tc.family)
		if !ok {
			t.Fatalf("For(%q) returned !ok", tc.family)
		}
		if c.RulesFile != tc.rulesFile || c.RulesDir != tc.rulesDir ||
			c.SkillsDir != tc.skillsDir || c.AgentsDir != tc.agentsDir {
			t.Fatalf("For(%q) = %+v; want files %s/%s skills %s agents %s",
				tc.family, c, tc.rulesFile, tc.rulesDir, tc.skillsDir, tc.agentsDir)
		}
	}
}

func TestForUnknown(t *testing.T) {
	if _, ok := For(""); ok {
		t.Fatal("expected For(\"\") to return false")
	}
	if _, ok := For("vertex"); ok {
		t.Fatal("expected For(\"vertex\") to return false")
	}
}

func TestFallbackOrdering(t *testing.T) {
	// Order MUST stay byte-stable with the previous switch-statement
	// behaviour — these slices feed the rules envelope, skills catalogue,
	// and preset list, all of which are read into the LLM prompt cache.
	cases := map[string][]string{
		"anthropic": {".codex/skills", ".gemini/skills"},
		"openai":    {".claude/skills", ".gemini/skills"},
		"gemini":    {".claude/skills", ".codex/skills"},
		// Unknown family yields all three in canonical order — same as
		// the previous default-case behaviour.
		"":      {".claude/skills", ".codex/skills", ".gemini/skills"},
		"other": {".claude/skills", ".codex/skills", ".gemini/skills"},
	}
	for family, want := range cases {
		got := FallbackSkillsDirs(family)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("FallbackSkillsDirs(%q) = %v; want %v", family, got, want)
		}
	}
}

func TestFallbackAgentsDirsMirrorsSkills(t *testing.T) {
	// Agents fallback chain must walk the same families in the same order
	// as the skills chain — the loaders rely on this symmetry.
	cases := map[string][]string{
		"anthropic": {".codex/agents", ".gemini/agents"},
		"openai":    {".claude/agents", ".gemini/agents"},
		"gemini":    {".claude/agents", ".codex/agents"},
	}
	for family, want := range cases {
		got := FallbackAgentsDirs(family)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("FallbackAgentsDirs(%q) = %v; want %v", family, got, want)
		}
	}
}
