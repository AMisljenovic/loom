package normalize

import (
	"strings"
	"testing"
)

func TestOrigin(t *testing.T) {
	cases := []struct {
		source string
		want   string
	}{
		{".loomrules", OriginLoom},
		{".loom/skills/x/SKILL.md", OriginLoom},
		{"CLAUDE.md", OriginClaude},
		{".claude/rules/style.md", OriginClaude},
		{"AGENTS.md", OriginCodex},
		{".codex/rules/style.md", OriginCodex},
		{".github/copilot-instructions.md", OriginCopilot},
		{".github/instructions/api.md", OriginCopilot},
		{".cursorrules", OriginCursor},
		{".cursor/rules/r.md", OriginCursor},
		{"GEMINI.md", OriginGemini},
		{".gemini/rules/r.md", OriginGemini},
		{"README.md", ""},
		{".github/workflows/ci.yml", ""}, // not the instructions path
	}
	for _, c := range cases {
		if got := Origin(c.source); got != c.want {
			t.Errorf("Origin(%q) = %q, want %q", c.source, got, c.want)
		}
	}
}

func TestRule_CopilotStripsFrontmatter(t *testing.T) {
	raw := "---\napplyTo: \"**\"\ndescription: ignore me\n---\n# Use tabs.\nKeep PRs small.\n"
	body, origin := Rule(".github/copilot-instructions.md", []byte(raw))
	if origin != OriginCopilot {
		t.Fatalf("origin = %q, want copilot", origin)
	}
	got := string(body)
	if strings.Contains(got, "applyTo") {
		t.Errorf("frontmatter not stripped:\n%s", got)
	}
	if !strings.HasPrefix(got, "# Use tabs.") {
		t.Errorf("body should start with H1, got:\n%s", got)
	}
}

func TestRule_CursorStripsFrontmatter(t *testing.T) {
	raw := "---\ndescription: x\nglobs: [\"**/*.ts\"]\nalwaysApply: true\n---\nuse semicolons\n"
	body, origin := Rule(".cursor/rules/style.md", []byte(raw))
	if origin != OriginCursor {
		t.Fatalf("origin = %q, want cursor", origin)
	}
	if string(body) != "use semicolons\n" {
		t.Errorf("expected only body, got %q", string(body))
	}
}

func TestRule_CopilotWithoutFrontmatterUnchanged(t *testing.T) {
	raw := "# Use tabs.\nKeep PRs small.\n"
	body, _ := Rule(".github/copilot-instructions.md", []byte(raw))
	if string(body) != raw {
		t.Errorf("unexpected change:\n%s", string(body))
	}
}

func TestRule_ClaudeDropsMatchingH1(t *testing.T) {
	raw := "# CLAUDE.md\n\nProject instructions.\n"
	body, origin := Rule("CLAUDE.md", []byte(raw))
	if origin != OriginClaude {
		t.Fatalf("origin = %q", origin)
	}
	if strings.Contains(string(body), "# CLAUDE.md") {
		t.Errorf("H1 not dropped:\n%s", string(body))
	}
	if !strings.Contains(string(body), "Project instructions") {
		t.Errorf("body lost:\n%s", string(body))
	}
}

func TestRule_ClaudePreservesNonMatchingH1(t *testing.T) {
	raw := "# Project rules\n\nuse tabs\n"
	body, _ := Rule("CLAUDE.md", []byte(raw))
	if !strings.HasPrefix(string(body), "# Project rules") {
		t.Errorf("non-matching H1 should be preserved:\n%s", string(body))
	}
}

func TestRule_GeminiDropsMatchingH1(t *testing.T) {
	raw := "# GEMINI.md\n\nProject context for Gemini.\n"
	body, origin := Rule("GEMINI.md", []byte(raw))
	if origin != OriginGemini {
		t.Fatalf("origin = %q, want gemini", origin)
	}
	if strings.Contains(string(body), "# GEMINI.md") {
		t.Errorf("H1 not dropped:\n%s", string(body))
	}
	if !strings.Contains(string(body), "Project context for Gemini") {
		t.Errorf("body lost:\n%s", string(body))
	}
}

func TestRule_GeminiRulesDirGetsSameTransform(t *testing.T) {
	raw := "# GEMINI.md\n\nrule body\n"
	body, origin := Rule(".gemini/rules/style.md", []byte(raw))
	if origin != OriginGemini {
		t.Fatalf("origin = %q, want gemini", origin)
	}
	if strings.Contains(string(body), "# GEMINI.md") {
		t.Errorf("expected H1 dropped for .gemini/rules entries too:\n%s", string(body))
	}
}

func TestRule_GeminiPreservesNonMatchingH1(t *testing.T) {
	raw := "# Project rules\n\nuse 2-space indent\n"
	body, _ := Rule("GEMINI.md", []byte(raw))
	if !strings.HasPrefix(string(body), "# Project rules") {
		t.Errorf("non-matching H1 should be preserved:\n%s", string(body))
	}
}

func TestRule_CodexDropsMatchingH1(t *testing.T) {
	raw := "# AGENTS.md\n\nproject conventions\n"
	body, origin := Rule("AGENTS.md", []byte(raw))
	if origin != OriginCodex {
		t.Fatalf("origin = %q", origin)
	}
	if strings.Contains(string(body), "# AGENTS.md") {
		t.Errorf("H1 not dropped:\n%s", string(body))
	}
}

func TestRule_LoomPassesThrough(t *testing.T) {
	raw := "---\nfoo: bar\n---\n# something\nbody\n"
	body, origin := Rule(".loomrules", []byte(raw))
	if origin != OriginLoom {
		t.Fatalf("origin = %q", origin)
	}
	if string(body) != raw {
		t.Errorf("loom content should be byte-identical, got %q", string(body))
	}
}

func TestRule_UnknownOriginPassesThrough(t *testing.T) {
	raw := "---\nfoo: bar\n---\nbody\n"
	body, origin := Rule("README.md", []byte(raw))
	if origin != "" {
		t.Errorf("origin should be empty for unknown source, got %q", origin)
	}
	if string(body) != raw {
		t.Errorf("unknown origin should pass through")
	}
}

func TestRule_Idempotent(t *testing.T) {
	inputs := map[string]string{
		"CLAUDE.md":                       "# CLAUDE.md\n\nrule body\n",
		"AGENTS.md":                       "# AGENTS.md\n\nrule body\n",
		"GEMINI.md":                       "# GEMINI.md\n\nrule body\n",
		".gemini/rules/r.md":              "# GEMINI.md\n\nrule body\n",
		".github/copilot-instructions.md": "---\napplyTo: \"**\"\n---\nbody\n",
		".cursor/rules/r.md":              "---\nglobs: [\"*\"]\n---\ncursor body\n",
		".loomrules":                      "loom body\n",
	}
	for src, raw := range inputs {
		first, _ := Rule(src, []byte(raw))
		second, _ := Rule(src, first)
		if string(first) != string(second) {
			t.Errorf("not idempotent for %s: first=%q second=%q", src, first, second)
		}
	}
}

func TestRule_OpenFrontmatterLeftAlone(t *testing.T) {
	// Missing closing `---` — must not eat the body.
	raw := "---\napplyTo: \"**\"\nbody continues here\n"
	body, _ := Rule(".github/copilot-instructions.md", []byte(raw))
	if string(body) != raw {
		t.Errorf("malformed frontmatter should be left untouched, got %q", string(body))
	}
}

func TestSkillBody_StripsClaudeH1(t *testing.T) {
	got := SkillBody(OriginClaude, "# foo\n\nbody\n")
	if strings.Contains(got, "# foo") {
		t.Errorf("expected H1 stripped, got %q", got)
	}
}

func TestSkillBody_StripsGeminiH1(t *testing.T) {
	got := SkillBody(OriginGemini, "# foo\n\nbody\n")
	if strings.Contains(got, "# foo") {
		t.Errorf("expected gemini H1 stripped, got %q", got)
	}
}

func TestSkillBody_PassesThroughLoom(t *testing.T) {
	in := "# loom skill\nbody\n"
	if got := SkillBody(OriginLoom, in); got != in {
		t.Errorf("loom skill body should pass through")
	}
}

func TestPresetBody_StripsClaudeH1(t *testing.T) {
	got := PresetBody(OriginClaude, "# Researcher\n\nyou are a researcher\n")
	if strings.Contains(got, "# Researcher") {
		t.Errorf("preset H1 not stripped:\n%s", got)
	}
}
