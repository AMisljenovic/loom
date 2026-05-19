// Package rules loads provider-aware project rule files (.loomrules,
// CLAUDE.md/.claude/, AGENTS.md/.codex/) and produces a single bundle the
// agent system prompt can include. When the provider's native convention
// files are absent, a universal fallback chain picks up other common
// conventions (Copilot, Gemini, Cursor, plus the opposite provider's files)
// so Loom respects whatever convention the workspace already uses. Each
// included file is normalised (frontmatter stripped, redundant H1s dropped)
// and wrapped in a per-file <rule source origin> block; the whole body is
// then wrapped in a stable <rules sources origins precedence> envelope and
// capped at MaxBundleBytes so it cannot dominate the prompt.
package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/your-org/loom/internal/normalize"
)

// MaxBundleBytes caps the concatenated rules body. Files beyond this point
// are skipped at file boundaries; a "<truncated: N files omitted>" marker
// is appended so the model knows content was elided.
const MaxBundleBytes = 32 * 1024

// Bundle is the result of a Load() call.
type Bundle struct {
	Text    string   // wrapped <rules>…</rules>, empty if no sources
	Sources []string // workspace-relative paths actually included, in order
	Hash    string   // SHA-256 of the concatenated body (not the envelope)
}

// Load reads the rule files appropriate for the LLM family and returns the
// concatenated bundle. family is "anthropic" or "openai" (other values fall
// through to the universal fallback chain after .loomrules).
//
// Load order (concatenated in this order, duplicates by normalised content
// hash skipped):
//  1. .loomrules                                       (always; top precedence)
//  2. Provider-native:
//     anthropic: CLAUDE.md, then .claude/rules/*.md (sorted)
//     openai:    AGENTS.md, then .codex/rules/*.md  (sorted)
//  3. Universal fallback — appended only if step 2 contributed zero files:
//     the other provider's native files, then
//     .github/copilot-instructions.md, .github/instructions/*.md,
//     GEMINI.md, .gemini/rules/*.md,
//     .cursor/rules/*.md, .cursorrules
func Load(workspaceRoot, family string) Bundle {
	if workspaceRoot == "" {
		return Bundle{}
	}

	always := []string{".loomrules"}
	native := nativeCandidates(workspaceRoot, family)

	seen := make(map[string]bool, 16)
	var (
		bodyB     strings.Builder
		sources   []string
		origins   []string
		seenOrig  = make(map[string]bool, 6)
		truncated int
	)

	appendFile := func(rel string) (read bool) {
		full := filepath.Join(workspaceRoot, rel)
		data, err := os.ReadFile(full)
		if err != nil {
			return false
		}
		body, origin := normalize.Rule(rel, data)
		// Dedupe on normalised content so identical prose across foreign
		// formats (e.g. CLAUDE.md and AGENTS.md with the same text) collapses
		// to one entry.
		sum := sha256.Sum256(body)
		key := hex.EncodeToString(sum[:])
		if seen[key] {
			return false
		}
		seen[key] = true

		if origin == "" {
			origin = "unknown"
		}
		block := fmt.Sprintf("\n<rule source=%q origin=%q>\n", rel, origin)
		closeTag := "\n</rule>"
		if bodyB.Len()+len(block)+len(body)+len(closeTag) > MaxBundleBytes {
			truncated++
			return false
		}
		if bodyB.Len() > 0 {
			bodyB.WriteString("\n")
		}
		bodyB.WriteString(block)
		bodyB.Write(body)
		bodyB.WriteString(closeTag)
		sources = append(sources, rel)
		if !seenOrig[origin] {
			seenOrig[origin] = true
			origins = append(origins, origin)
		}
		return true
	}

	for _, rel := range always {
		appendFile(rel)
	}

	nativeRead := 0
	for _, rel := range native {
		if appendFile(rel) {
			nativeRead++
		}
	}

	if nativeRead == 0 {
		for _, rel := range fallbackCandidates(workspaceRoot, family) {
			appendFile(rel)
		}
	}

	if bodyB.Len() == 0 {
		return Bundle{}
	}

	body := strings.TrimRight(bodyB.String(), "\n")
	if truncated > 0 {
		body += fmt.Sprintf("\n<truncated: %d file(s) omitted>", truncated)
	}

	// Mix the normalisation version into the hash so a future revision of
	// the per-origin transforms deliberately invalidates cached prefixes.
	hashInput := fmt.Sprintf("%s\x00v%d", body, normalize.Version)
	hash := sha256.Sum256([]byte(hashInput))

	sort.Strings(origins)

	var envelope strings.Builder
	envelope.WriteString(`<rules sources="`)
	envelope.WriteString(strings.Join(sources, ","))
	envelope.WriteString(`" origins="`)
	envelope.WriteString(strings.Join(origins, ","))
	envelope.WriteString(`" precedence=".loomrules">`)
	envelope.WriteString("\nOn conflict, rules from .loomrules take precedence over other listed sources.\n")
	envelope.WriteString(body)
	envelope.WriteString("\n</rules>")

	return Bundle{
		Text:    envelope.String(),
		Sources: sources,
		Hash:    hex.EncodeToString(hash[:]),
	}
}

// nativeCandidates returns the provider's own convention files in load order.
func nativeCandidates(workspaceRoot, family string) []string {
	switch family {
	case "anthropic":
		out := []string{"CLAUDE.md"}
		out = append(out, globMarkdown(workspaceRoot, ".claude/rules")...)
		return out
	case "openai":
		out := []string{"AGENTS.md"}
		out = append(out, globMarkdown(workspaceRoot, ".codex/rules")...)
		return out
	}
	return nil
}

// fallbackCandidates returns the universal chain to try when the provider's
// own files are absent. The opposite provider's files come first so a user
// who only has AGENTS.md still gets it under Anthropic (and vice versa).
func fallbackCandidates(workspaceRoot, family string) []string {
	var out []string
	switch family {
	case "anthropic":
		out = append(out, "AGENTS.md")
		out = append(out, globMarkdown(workspaceRoot, ".codex/rules")...)
	case "openai":
		out = append(out, "CLAUDE.md")
		out = append(out, globMarkdown(workspaceRoot, ".claude/rules")...)
	default:
		out = append(out, "CLAUDE.md")
		out = append(out, globMarkdown(workspaceRoot, ".claude/rules")...)
		out = append(out, "AGENTS.md")
		out = append(out, globMarkdown(workspaceRoot, ".codex/rules")...)
	}
	out = append(out, ".github/copilot-instructions.md")
	out = append(out, globMarkdown(workspaceRoot, ".github/instructions")...)
	out = append(out, "GEMINI.md")
	out = append(out, globMarkdown(workspaceRoot, ".gemini/rules")...)
	out = append(out, globMarkdown(workspaceRoot, ".cursor/rules")...)
	out = append(out, ".cursorrules")
	return out
}

// globMarkdown lists *.md under dir (relative to root), returning paths
// relative to the workspace root, sorted ascending. Missing or non-directory
// paths return nil.
func globMarkdown(root, relDir string) []string {
	dir := filepath.Join(root, relDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rels []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			continue
		}
		rels = append(rels, filepath.ToSlash(filepath.Join(relDir, name)))
	}
	sort.Strings(rels)
	return rels
}
