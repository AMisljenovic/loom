// Package normalize converts external AI-tool context files (Claude, Codex,
// Copilot, Cursor, Gemini) into a uniform shape before they reach the model.
// All transforms are pure functions of (origin, bytes) — deterministic and
// idempotent — so callers can fold the output into a stable cache key.
package normalize

import (
	"path/filepath"
	"strings"
)

// Version is mixed into every rule-bundle hash (regardless of origin mix)
// so a deliberate bump cleanly invalidates cached prompt prefixes after a
// transform change. Bumped to 2 with:
//   - preserve Copilot/Cursor `applyTo` scope as a leading "> Scope: ..."
//     line so file-glob scoping survives frontmatter stripping
//   - rules envelope: cross-family fallback rules now carry
//     loaded-as="fallback", and content-deduped sources surface their alias
//     paths via also="..."
const Version = 2

// Recognised origin identifiers. Empty string ("") means "unknown source".
const (
	OriginLoom    = "loom"
	OriginClaude  = "claude"
	OriginCodex   = "codex"
	OriginCopilot = "copilot"
	OriginCursor  = "cursor"
	OriginGemini  = "gemini"
)

// IsExternalOrigin reports whether the given workspace-relative source path
// belongs to a non-Loom convention (Claude/Codex/Cursor/Copilot/Gemini).
// Used by the catalogue and envelope renderers to decide whether to surface
// the origin annotation; previously duplicated as private predicates in
// skills.IsExternalSource and loop.isExternalPresetSource.
func IsExternalOrigin(source string) bool {
	origin := Origin(source)
	return origin != "" && origin != OriginLoom
}

// Origin maps a workspace-relative source path to one of the known origins.
// Returns "" for paths the table doesn't recognise.
func Origin(source string) string {
	s := filepath.ToSlash(strings.TrimPrefix(source, "./"))
	switch {
	case s == ".loomrules", strings.HasPrefix(s, ".loom/"):
		return OriginLoom
	case s == "CLAUDE.md", strings.HasPrefix(s, ".claude/"):
		return OriginClaude
	case s == "AGENTS.md", strings.HasPrefix(s, ".codex/"):
		return OriginCodex
	case s == ".github/copilot-instructions.md", strings.HasPrefix(s, ".github/instructions/"):
		return OriginCopilot
	case s == ".cursorrules", strings.HasPrefix(s, ".cursor/"):
		return OriginCursor
	case s == "GEMINI.md", strings.HasPrefix(s, ".gemini/"):
		return OriginGemini
	}
	return ""
}

// Rule normalises the body of a rules-file read from `source`. Returns the
// transformed body and the detected origin (empty string when the origin is
// unknown — in that case the raw bytes are returned unchanged).
//
// For Copilot/Cursor origins, the YAML frontmatter is stripped but the
// `applyTo:` field (file-glob scoping) is preserved as a leading
// "> Scope: applies to <glob(s)>" markdown blockquote so the model still
// sees the intent rather than treating the rule as global.
//
// Transforms are idempotent: Rule(src, Rule(src, x)) == Rule(src, x).
func Rule(source string, raw []byte) (body []byte, origin string) {
	origin = Origin(source)
	switch origin {
	case OriginCopilot, OriginCursor:
		stripped, scope := stripYAMLFrontmatterPreservingScope(string(raw))
		if scope != "" {
			return []byte("> Scope: applies to " + scope + "\n\n" + stripped), origin
		}
		return []byte(stripped), origin
	case OriginClaude:
		return []byte(stripLeadingH1(string(raw), "CLAUDE.md")), origin
	case OriginCodex:
		return []byte(stripLeadingH1(string(raw), "AGENTS.md")), origin
	case OriginGemini:
		return []byte(stripLeadingH1(string(raw), "GEMINI.md")), origin
	}
	return raw, origin
}

// SkillBody normalises a skill body. Skills already share Loom's struct shape
// after the parser maps name→id and description→synopsis, so here we only
// strip leading H1 noise for external origins. Kept as a separate entry point
// so callers don't need to know about path-based origin detection.
func SkillBody(origin, body string) string {
	switch origin {
	case OriginClaude, OriginCodex, OriginGemini:
		return stripLeadingH1Generic(body)
	}
	return body
}

// PresetBody normalises a sub-agent preset body. Same shape as SkillBody.
func PresetBody(origin, body string) string {
	switch origin {
	case OriginClaude, OriginCodex, OriginGemini:
		return stripLeadingH1Generic(body)
	}
	return body
}

// stripYAMLFrontmatter removes a leading `---\n…\n---\n` block if present.
// Lines before the first `---` are preserved. The scope-preserving variant
// below is the production path; this name is kept for any external callers
// that don't care about applyTo.
func stripYAMLFrontmatter(s string) string {
	body, _ := stripYAMLFrontmatterPreservingScope(s)
	return body
}

// stripYAMLFrontmatterPreservingScope behaves like stripYAMLFrontmatter but
// also returns the frontmatter's `applyTo:` field (Copilot/Cursor scope) if
// present. The scope string is either a single glob (e.g. "**/*.ts") or a
// comma-joined list when the field was a YAML sequence. Empty string when
// the field is absent.
//
// We deliberately use a tiny line-based parser instead of pulling in a YAML
// library — the field shape is constrained (string or simple list of
// strings) and an idempotency guarantee is easier to keep this way.
func stripYAMLFrontmatterPreservingScope(s string) (body, scope string) {
	trimmed := strings.TrimLeft(s, "\r\n")
	if !strings.HasPrefix(trimmed, "---\n") && !strings.HasPrefix(trimmed, "---\r\n") {
		return s, ""
	}
	rest := trimmed[strings.Index(trimmed, "\n")+1:]
	var fmLines []string
	for {
		nl := strings.Index(rest, "\n")
		if nl < 0 {
			// No closing marker — leave untouched and report no scope.
			return s, ""
		}
		line := strings.TrimRight(rest[:nl], "\r")
		if line == "---" {
			return strings.TrimLeft(rest[nl+1:], "\r\n"), parseApplyTo(fmLines)
		}
		fmLines = append(fmLines, line)
		rest = rest[nl+1:]
	}
}

// parseApplyTo extracts the file-scope from the given frontmatter lines.
// Two field names are recognised so both Copilot and Cursor conventions
// are honoured:
//
//   - `applyTo:` (Copilot)
//   - `globs:`   (Cursor)
//
// Each supports a quoted scalar, an unquoted scalar, or a YAML list:
//
//	applyTo: "**/*.ts"
//	globs:   ["**/*.ts", "**/*.tsx"]
//	applyTo:
//	  - "**/*.ts"
//	  - "**/*.tsx"
//
// Returns the canonical scope string ("**/*.ts" or "**/*.ts, **/*.tsx") or
// "" when neither field is present.
func parseApplyTo(fmLines []string) string {
	for i, line := range fmLines {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		var rest string
		switch {
		case strings.HasPrefix(lower, "applyto:"):
			rest = strings.TrimSpace(trimmed[len("applyto:"):])
		case strings.HasPrefix(lower, "globs:"):
			rest = strings.TrimSpace(trimmed[len("globs:"):])
		default:
			continue
		}
		if rest != "" {
			return parseScopeScalar(rest)
		}
		// Empty inline value — read following list-item lines until we
		// hit a non-list line.
		var items []string
		for j := i + 1; j < len(fmLines); j++ {
			item := strings.TrimSpace(fmLines[j])
			if !strings.HasPrefix(item, "- ") {
				break
			}
			items = append(items, trimYAMLString(strings.TrimSpace(item[2:])))
		}
		return strings.Join(items, ", ")
	}
	return ""
}

// parseScopeScalar handles both `["**/*.ts", "**/*.tsx"]` inline-list and
// a single `"**/*.ts"` scalar. Returned format is a comma-separated string
// suitable for the rendered "> Scope: applies to ..." line.
func parseScopeScalar(v string) string {
	if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") {
		inner := v[1 : len(v)-1]
		parts := strings.Split(inner, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			p = trimYAMLString(strings.TrimSpace(p))
			if p != "" {
				out = append(out, p)
			}
		}
		return strings.Join(out, ", ")
	}
	return trimYAMLString(v)
}

// trimYAMLString strips matching surrounding quotes from a YAML scalar.
func trimYAMLString(v string) string {
	if len(v) >= 2 {
		first, last := v[0], v[len(v)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			return v[1 : len(v)-1]
		}
	}
	return v
}

// stripLeadingH1 drops a leading `# <name>` H1 line iff it matches the given
// filename (case-insensitive). Preserves the rest of the file verbatim.
func stripLeadingH1(s, filename string) string {
	rest := strings.TrimLeft(s, "\r\n")
	nl := strings.Index(rest, "\n")
	var first string
	if nl < 0 {
		first = rest
	} else {
		first = strings.TrimRight(rest[:nl], "\r")
	}
	if !strings.HasPrefix(first, "# ") {
		return s
	}
	heading := strings.TrimSpace(first[2:])
	if !strings.EqualFold(heading, filename) {
		return s
	}
	if nl < 0 {
		return ""
	}
	return strings.TrimLeft(rest[nl+1:], "\r\n")
}

// stripLeadingH1Generic drops any leading `# Something` line. Used for skill
// and preset bodies where the H1 typically duplicates the frontmatter name.
func stripLeadingH1Generic(s string) string {
	rest := strings.TrimLeft(s, "\r\n")
	nl := strings.Index(rest, "\n")
	var first string
	if nl < 0 {
		first = rest
	} else {
		first = strings.TrimRight(rest[:nl], "\r")
	}
	if !strings.HasPrefix(first, "# ") {
		return s
	}
	if nl < 0 {
		return ""
	}
	return strings.TrimLeft(rest[nl+1:], "\r\n")
}
