// Package normalize converts external AI-tool context files (Claude, Codex,
// Copilot, Cursor, Gemini) into a uniform shape before they reach the model.
// All transforms are pure functions of (origin, bytes) — deterministic and
// idempotent — so callers can fold the output into a stable cache key.
package normalize

import (
	"path/filepath"
	"strings"
)

// Version is mixed into rule-bundle hashes when at least one non-loom origin
// contributes content. Bump it to deliberately invalidate cached prefixes
// after a normalization change.
const Version = 1

// Recognised origin identifiers. Empty string ("") means "unknown source".
const (
	OriginLoom    = "loom"
	OriginClaude  = "claude"
	OriginCodex   = "codex"
	OriginCopilot = "copilot"
	OriginCursor  = "cursor"
	OriginGemini  = "gemini"
)

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
// Transforms are idempotent: Rule(src, Rule(src, x)) == Rule(src, x).
func Rule(source string, raw []byte) (body []byte, origin string) {
	origin = Origin(source)
	switch origin {
	case OriginCopilot, OriginCursor:
		return []byte(stripYAMLFrontmatter(string(raw))), origin
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
// Lines before the first `---` are preserved.
func stripYAMLFrontmatter(s string) string {
	trimmed := strings.TrimLeft(s, "\r\n")
	if !strings.HasPrefix(trimmed, "---\n") && !strings.HasPrefix(trimmed, "---\r\n") {
		return s
	}
	// Find closing `---` on its own line.
	rest := trimmed[strings.Index(trimmed, "\n")+1:]
	for {
		nl := strings.Index(rest, "\n")
		if nl < 0 {
			// No closing marker — leave untouched.
			return s
		}
		line := strings.TrimRight(rest[:nl], "\r")
		if line == "---" {
			return strings.TrimLeft(rest[nl+1:], "\r\n")
		}
		rest = rest[nl+1:]
	}
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
