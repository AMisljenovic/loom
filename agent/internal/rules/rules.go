// Package rules loads provider-aware project rule files (.loomrules,
// CLAUDE.md/.claude/, AGENTS.md/.codex/) and produces a single bundle the
// agent system prompt can include. The bundle text is wrapped in a stable
// <rules sources="..."> envelope and capped at MaxBundleBytes so it cannot
// dominate the prompt.
package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
// through with only .loomrules considered).
//
// File order (concatenated in this order, duplicates by content hash skipped):
//  1. .loomrules                                  (always)
//  2. anthropic: CLAUDE.md, then .claude/rules/*.md (sorted)
//  3. openai:    AGENTS.md, then .codex/rules/*.md  (sorted)
func Load(workspaceRoot, family string) Bundle {
	if workspaceRoot == "" {
		return Bundle{}
	}

	candidates := []string{".loomrules"}
	switch family {
	case "anthropic":
		candidates = append(candidates, "CLAUDE.md")
		candidates = append(candidates, globMarkdown(workspaceRoot, ".claude/rules")...)
	case "openai":
		candidates = append(candidates, "AGENTS.md")
		candidates = append(candidates, globMarkdown(workspaceRoot, ".codex/rules")...)
	}

	seen := make(map[string]bool, len(candidates))
	var (
		bodyB     strings.Builder
		sources   []string
		truncated int
	)
	for _, rel := range candidates {
		full := filepath.Join(workspaceRoot, rel)
		data, err := os.ReadFile(full)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		key := hex.EncodeToString(sum[:])
		if seen[key] {
			continue
		}
		seen[key] = true

		// Estimate remaining budget: body so far + this file + section header.
		header := fmt.Sprintf("\n--- %s ---\n", rel)
		if bodyB.Len()+len(header)+len(data) > MaxBundleBytes {
			truncated++
			continue
		}
		if bodyB.Len() > 0 {
			bodyB.WriteString("\n")
		}
		bodyB.WriteString(header)
		bodyB.Write(data)
		sources = append(sources, rel)
	}

	if bodyB.Len() == 0 {
		return Bundle{}
	}

	body := strings.TrimRight(bodyB.String(), "\n")
	if truncated > 0 {
		body += fmt.Sprintf("\n<truncated: %d file(s) omitted>", truncated)
	}
	hash := sha256.Sum256([]byte(body))

	var envelope strings.Builder
	envelope.WriteString(`<rules sources="`)
	envelope.WriteString(strings.Join(sources, ","))
	envelope.WriteString("\">\n")
	envelope.WriteString(body)
	envelope.WriteString("\n</rules>")

	return Bundle{
		Text:    envelope.String(),
		Sources: sources,
		Hash:    hex.EncodeToString(hash[:]),
	}
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
