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
	b := Load(dir, "anthropic")
	if b.Text != "" || b.Hash != "" || len(b.Sources) != 0 {
		t.Fatalf("expected empty bundle, got %+v", b)
	}
}

func TestLoad_EmptyRootStringReturnsEmpty(t *testing.T) {
	if b := Load("", "anthropic"); b.Text != "" {
		t.Fatalf("expected empty bundle for empty root, got %+v", b)
	}
}

func TestLoad_AnthropicNativePresent_FallbackSuppressed(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "CLAUDE.md", "claude rules body")
	writeFile(t, dir, ".github/copilot-instructions.md", "copilot body")
	writeFile(t, dir, "GEMINI.md", "gemini body")
	writeFile(t, dir, ".cursorrules", "cursor body")

	b := Load(dir, "anthropic")

	if !containsExact(b.Sources, "CLAUDE.md") {
		t.Fatalf("expected CLAUDE.md in sources, got %v", b.Sources)
	}
	for _, forbidden := range []string{
		".github/copilot-instructions.md",
		"GEMINI.md",
		".cursorrules",
	} {
		if containsExact(b.Sources, forbidden) {
			t.Fatalf("fallback should be suppressed when CLAUDE.md is present; got %s in sources %v", forbidden, b.Sources)
		}
	}
}

func TestLoad_AnthropicFallbackToCopilot(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".github/copilot-instructions.md", "copilot body")

	b := Load(dir, "anthropic")

	if !containsExact(b.Sources, ".github/copilot-instructions.md") {
		t.Fatalf("expected copilot-instructions fallback, got sources %v", b.Sources)
	}
	if !strings.Contains(b.Text, "copilot body") {
		t.Fatalf("expected copilot body in bundle text, got:\n%s", b.Text)
	}
}

func TestLoad_OpenAIFallbackToCursorAndGemini(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".cursor/rules/style.md", "cursor style rules")
	writeFile(t, dir, ".cursorrules", "legacy cursor rules")
	writeFile(t, dir, "GEMINI.md", "gemini rules")

	b := Load(dir, "openai")

	for _, want := range []string{
		".cursor/rules/style.md",
		".cursorrules",
		"GEMINI.md",
	} {
		if !containsExact(b.Sources, want) {
			t.Fatalf("expected %s in sources, got %v", want, b.Sources)
		}
	}
}

func TestLoad_OppositeProviderUsedAsFallback(t *testing.T) {
	// Anthropic family but only AGENTS.md exists — fallback should pick it up.
	dir := t.TempDir()
	writeFile(t, dir, "AGENTS.md", "agents body")

	b := Load(dir, "anthropic")
	if !containsExact(b.Sources, "AGENTS.md") {
		t.Fatalf("expected AGENTS.md as fallback under anthropic, got %v", b.Sources)
	}
}

func TestLoad_GeminiNativePresent_FallbackSuppressed(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "GEMINI.md", "gemini rules body")
	writeFile(t, dir, "CLAUDE.md", "claude rules body")
	writeFile(t, dir, "AGENTS.md", "agents rules body")
	writeFile(t, dir, ".github/copilot-instructions.md", "copilot body")

	b := Load(dir, "gemini")

	if !containsExact(b.Sources, "GEMINI.md") {
		t.Fatalf("expected GEMINI.md in sources under gemini family, got %v", b.Sources)
	}
	for _, forbidden := range []string{"CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"} {
		if containsExact(b.Sources, forbidden) {
			t.Fatalf("fallback should be suppressed when GEMINI.md present; got %s in sources %v", forbidden, b.Sources)
		}
	}
}

func TestLoad_GeminiFallbackPullsClaudeAndAgents(t *testing.T) {
	// Gemini family but no GEMINI.md — the other providers' files come first
	// in the fallback chain.
	dir := t.TempDir()
	writeFile(t, dir, "CLAUDE.md", "claude body")
	writeFile(t, dir, "AGENTS.md", "agents body")

	b := Load(dir, "gemini")
	for _, want := range []string{"CLAUDE.md", "AGENTS.md"} {
		if !containsExact(b.Sources, want) {
			t.Fatalf("expected %s in fallback for gemini, got %v", want, b.Sources)
		}
	}
}

func TestLoad_GeminiRulesDirCountsAsNative(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".gemini/rules/style.md", "gemini style rules")
	writeFile(t, dir, "CLAUDE.md", "claude body")

	b := Load(dir, "gemini")
	if !containsExact(b.Sources, ".gemini/rules/style.md") {
		t.Fatalf("expected .gemini/rules entry, got %v", b.Sources)
	}
	if containsExact(b.Sources, "CLAUDE.md") {
		t.Fatalf("fallback should be suppressed when .gemini/rules contributed; got %v", b.Sources)
	}
}

func TestLoad_LoomrulesAlwaysFirst(t *testing.T) {
	for _, family := range []string{"anthropic", "openai", "gemini", "unknown"} {
		t.Run(family, func(t *testing.T) {
			dir := t.TempDir()
			writeFile(t, dir, ".loomrules", "loom rules")
			writeFile(t, dir, "CLAUDE.md", "claude rules")
			writeFile(t, dir, "AGENTS.md", "agents rules")

			b := Load(dir, family)
			if len(b.Sources) == 0 || b.Sources[0] != ".loomrules" {
				t.Fatalf("family=%s expected .loomrules first, got %v", family, b.Sources)
			}
		})
	}
}

func TestLoad_EnvelopeContainsPrecedenceAttribute(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".loomrules", "loom rules")

	b := Load(dir, "anthropic")
	if !strings.Contains(b.Text, `precedence=".loomrules"`) {
		t.Fatalf("expected precedence attribute in envelope:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, "On conflict, rules from .loomrules take precedence") {
		t.Fatalf("expected precedence note in envelope:\n%s", b.Text)
	}
}

func TestLoad_RespectsMaxBundleBytesWithManyFallbacks(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".github/copilot-instructions.md", "a"+strings.Repeat("x", 20*1024))
	writeFile(t, dir, "GEMINI.md", "b"+strings.Repeat("x", 20*1024))
	writeFile(t, dir, ".cursorrules", "c"+strings.Repeat("x", 20*1024))

	b := Load(dir, "anthropic")

	if len(b.Text) > MaxBundleBytes+512 { // envelope overhead is small
		t.Fatalf("bundle exceeded cap: len=%d", len(b.Text))
	}
	if !strings.Contains(b.Text, "<truncated:") {
		t.Fatalf("expected truncation marker when fallback chain overflows cap:\n%s", b.Text[:min(len(b.Text), 200)])
	}
}

func TestLoad_DedupesByContentHash(t *testing.T) {
	dir := t.TempDir()
	body := "shared body content"
	writeFile(t, dir, ".loomrules", body)
	writeFile(t, dir, "CLAUDE.md", body) // identical content
	writeFile(t, dir, ".claude/rules/a.md", "unique rule")

	b := Load(dir, "anthropic")

	if containsExact(b.Sources, "CLAUDE.md") {
		t.Fatalf("expected CLAUDE.md to be deduped (matches .loomrules), got %v", b.Sources)
	}
	if !containsExact(b.Sources, ".loomrules") {
		t.Fatalf("expected .loomrules in sources, got %v", b.Sources)
	}
	if !containsExact(b.Sources, ".claude/rules/a.md") {
		t.Fatalf("expected unique .claude rule to load even after dedupe, got %v", b.Sources)
	}
}

func TestLoad_ProviderNativeDirCountsAsNotEmpty(t *testing.T) {
	// .claude/rules/x.md alone (no CLAUDE.md) should still count as native present
	// and therefore suppress the fallback chain.
	dir := t.TempDir()
	writeFile(t, dir, ".claude/rules/style.md", "style rules")
	writeFile(t, dir, ".github/copilot-instructions.md", "copilot body")

	b := Load(dir, "anthropic")

	if !containsExact(b.Sources, ".claude/rules/style.md") {
		t.Fatalf("expected .claude rule loaded, got %v", b.Sources)
	}
	if containsExact(b.Sources, ".github/copilot-instructions.md") {
		t.Fatalf("fallback should be suppressed when .claude/rules has content; got %v", b.Sources)
	}
}

func TestLoad_CopilotFrontmatterStripped(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".github/copilot-instructions.md",
		"---\napplyTo: \"**\"\ndescription: ignore me\n---\n# Use tabs.\n")

	b := Load(dir, "anthropic")

	if strings.Contains(b.Text, "applyTo") {
		t.Fatalf("copilot frontmatter should be stripped:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, "# Use tabs.") {
		t.Fatalf("body lost during normalisation:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, `origin="copilot"`) {
		t.Fatalf("expected origin attribute, got:\n%s", b.Text)
	}
}

func TestLoad_PerFileBlockReplacesTextMarker(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".loomrules", "loom body")

	b := Load(dir, "anthropic")

	if strings.Contains(b.Text, "--- .loomrules ---") {
		t.Fatalf("legacy text marker should be gone:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, `<rule source=".loomrules" origin="loom">`) {
		t.Fatalf("expected per-file rule block, got:\n%s", b.Text)
	}
	if !strings.Contains(b.Text, "</rule>") {
		t.Fatalf("expected closing tag, got:\n%s", b.Text)
	}
}

func TestLoad_EnvelopeAdvertisesOrigins(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".loomrules", "loom body")
	writeFile(t, dir, "CLAUDE.md", "claude body")

	b := Load(dir, "anthropic")

	if !strings.Contains(b.Text, `origins="claude,loom"`) {
		t.Fatalf("expected sorted origins attribute, got:\n%s", b.Text)
	}
}

func TestLoad_HashStableAcrossRuns(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".loomrules", "loom body")
	writeFile(t, dir, "CLAUDE.md", "claude body")
	writeFile(t, dir, ".github/copilot-instructions.md",
		"---\napplyTo: \"**\"\n---\ncopilot body\n")

	first := Load(dir, "anthropic")
	second := Load(dir, "anthropic")
	if first.Hash == "" || first.Hash != second.Hash {
		t.Fatalf("hash unstable: %q vs %q", first.Hash, second.Hash)
	}
	if first.Text != second.Text {
		t.Fatalf("text not byte-stable across calls")
	}
}

func TestLoad_DedupeOnNormalizedBody(t *testing.T) {
	// .loomrules and a copilot file produce the same body after frontmatter
	// stripping; the copilot entry should dedupe out.
	dir := t.TempDir()
	body := "shared instructions"
	writeFile(t, dir, ".loomrules", body)
	writeFile(t, dir, ".github/copilot-instructions.md",
		"---\napplyTo: \"**\"\n---\n"+body)

	b := Load(dir, "anthropic")

	if !containsExact(b.Sources, ".loomrules") {
		t.Fatalf("expected .loomrules in sources, got %v", b.Sources)
	}
	if containsExact(b.Sources, ".github/copilot-instructions.md") {
		t.Fatalf("expected copilot entry to dedupe after normalisation, got %v", b.Sources)
	}
}

func containsExact(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
