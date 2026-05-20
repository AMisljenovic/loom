// Package familycfg holds the canonical mapping from an LLM provider family
// ("anthropic", "openai", "gemini") to the workspace-relative directories
// and files that family conventionally uses for agent context (rules,
// skills, sub-agent presets).
//
// Three call sites — internal/rules, internal/skills, and internal/loop —
// previously duplicated the same `switch family { ... }` block. Putting the
// table here keeps the order of the fallback chain in one place and makes
// adding a new provider family a single-line edit.
//
// Order matters: the rules envelope, skills catalogue, and preset list are
// concatenated in the order this package emits, and any reordering would
// break the byte-stable prompt prefix (and therefore the LLM prompt cache).
// Tests in package callers pin the exact ordering against a snapshot.
package familycfg

// Convention describes the per-family conventions for agent context files.
// Paths are workspace-relative and use forward slashes — the rules/skills
// loaders handle OS-specific conversion when reading from disk.
type Convention struct {
	Family    string
	RulesFile string // top-level rules file, e.g. "CLAUDE.md"
	RulesDir  string // directory of additional .md rules, e.g. ".claude/rules"
	SkillsDir string // directory of skill subfolders, e.g. ".claude/skills"
	AgentsDir string // directory of preset .md files, e.g. ".claude/agents"
}

// canonical is the master list. Order here defines fallback order for
// foreign families (e.g. when anthropic is native, the fallback chain
// walks the remaining entries in this order — openai, then gemini).
var canonical = []Convention{
	{Family: "anthropic", RulesFile: "CLAUDE.md", RulesDir: ".claude/rules", SkillsDir: ".claude/skills", AgentsDir: ".claude/agents"},
	{Family: "openai", RulesFile: "AGENTS.md", RulesDir: ".codex/rules", SkillsDir: ".codex/skills", AgentsDir: ".codex/agents"},
	{Family: "gemini", RulesFile: "GEMINI.md", RulesDir: ".gemini/rules", SkillsDir: ".gemini/skills", AgentsDir: ".gemini/agents"},
}

// For returns the convention for the given family. The second return is
// false when family is empty or not recognised — callers handle that as
// "no native convention" (the universal fallback chain takes over).
func For(family string) (Convention, bool) {
	for _, c := range canonical {
		if c.Family == family {
			return c, true
		}
	}
	return Convention{}, false
}

// Native returns the family's own convention or a zero Convention if the
// family is unknown. Convenience for call sites that don't need the bool.
func Native(family string) Convention {
	c, _ := For(family)
	return c
}

// Fallbacks returns the conventions of the other families in canonical
// order, omitting the native family. Used by the rules, skills, and
// preset loaders to build the universal fallback chain when the native
// directory contributed nothing.
//
// For an unknown family, all canonical entries are returned in order so
// the caller still gets a deterministic, non-empty fallback.
func Fallbacks(family string) []Convention {
	out := make([]Convention, 0, len(canonical))
	for _, c := range canonical {
		if c.Family == family {
			continue
		}
		out = append(out, c)
	}
	return out
}

// FallbackSkillsDirs returns just the SkillsDir of each non-native family,
// in canonical order. Equivalent to mapping Fallbacks(family) → SkillsDir.
func FallbackSkillsDirs(family string) []string {
	fb := Fallbacks(family)
	out := make([]string, 0, len(fb))
	for _, c := range fb {
		out = append(out, c.SkillsDir)
	}
	return out
}

// FallbackAgentsDirs returns just the AgentsDir of each non-native family,
// in canonical order.
func FallbackAgentsDirs(family string) []string {
	fb := Fallbacks(family)
	out := make([]string, 0, len(fb))
	for _, c := range fb {
		out = append(out, c.AgentsDir)
	}
	return out
}
