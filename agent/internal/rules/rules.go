// Package rules loads provider-aware project rule files (.loomrules,
// CLAUDE.md/.claude/, AGENTS.md/.codex/, GEMINI.md/.gemini/) and produces a
// single bundle the agent system prompt can include. When the provider's
// native convention files are absent, a universal fallback chain picks up
// other common conventions (Copilot, Cursor, plus the other providers'
// files) so Loom respects whatever convention the workspace already uses.
// Each included file is normalised (frontmatter stripped, redundant H1s
// dropped) and wrapped in a per-file <rule source origin> block; the whole
// body is then wrapped in a stable <rules sources origins precedence>
// envelope and capped at MaxBundleBytes so it cannot dominate the prompt.
package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/your-org/loom/internal/familycfg"
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

// loadedAs values for the per-rule loaded-as attribute. "native" is the
// active family's own convention; "fallback" is anything picked up via the
// universal chain when the native directory contributed nothing.
const (
	loadedAsNative   = "native"
	loadedAsFallback = "fallback"
)

// ruleBlock is the parsed-and-normalised view of one included file. We
// collect blocks first, dedup by content hash with alias bookkeeping,
// then render the envelope. Doing it in two passes keeps the dedup
// alias tracking (§6.3) simple while still emitting a stable byte order.
type ruleBlock struct {
	source   string
	origin   string
	body     []byte
	loadedAs string
	aliases  []string // additional source paths that collapsed into this entry
}

// Load reads the rule files appropriate for the LLM family and returns the
// concatenated bundle. family is "anthropic", "openai", or "gemini" (other
// values fall through to the universal fallback chain after .loomrules).
//
// Load order (concatenated in this order, duplicates by normalised content
// hash skipped — but the dropped paths surface in the kept block's
// also="..." attribute so attribution is preserved):
//  1. .loomrules                                       (always; top precedence)
//  2. Provider-native:
//     anthropic: CLAUDE.md,  then .claude/rules/*.md (sorted)
//     openai:    AGENTS.md,  then .codex/rules/*.md  (sorted)
//     gemini:    GEMINI.md,  then .gemini/rules/*.md (sorted)
//  3. Universal fallback — appended only if step 2 contributed zero files:
//     the other providers' native files, then
//     .github/copilot-instructions.md, .github/instructions/*.md,
//     .cursor/rules/*.md, .cursorrules
//
// Rules picked up via the fallback chain whose origin doesn't match the
// active family are tagged loaded-as="fallback" so the model knows to
// apply the substance rather than any provider-specific identity prose.
func Load(workspaceRoot, family string) Bundle {
	if workspaceRoot == "" {
		return Bundle{}
	}

	always := []string{".loomrules"}
	native := nativeCandidates(workspaceRoot, family)
	fallback := fallbackCandidates(workspaceRoot, family)

	// First pass: read every candidate, dedup by normalised content hash,
	// and stash metadata. Aliases land on the kept block.
	var blocks []*ruleBlock
	byHash := make(map[string]*ruleBlock, 16)

	considerFile := func(rel, loadedAs string) {
		full := filepath.Join(workspaceRoot, rel)
		data, err := os.ReadFile(full)
		if err != nil {
			return
		}
		body, origin := normalize.Rule(rel, data)
		if origin == "" {
			origin = "unknown"
		}
		sum := sha256.Sum256(body)
		key := hex.EncodeToString(sum[:])
		if existing, ok := byHash[key]; ok {
			// Content already included; preserve the dropped path as an
			// alias so the user can still see where the rule "lived".
			existing.aliases = append(existing.aliases, rel)
			return
		}
		b := &ruleBlock{
			source:   rel,
			origin:   origin,
			body:     body,
			loadedAs: loadedAs,
		}
		byHash[key] = b
		blocks = append(blocks, b)
	}

	for _, rel := range always {
		// .loomrules is conceptually "native" — it's Loom's own convention
		// and not part of the foreign-family fallback chain.
		considerFile(rel, loadedAsNative)
	}

	nativeBefore := len(blocks)
	for _, rel := range native {
		considerFile(rel, loadedAsNative)
	}
	nativeRead := len(blocks) - nativeBefore

	if nativeRead == 0 {
		for _, rel := range fallback {
			considerFile(rel, loadedAsFallback)
		}
	}

	if len(blocks) == 0 {
		return Bundle{}
	}

	// Second pass: render. Honour MaxBundleBytes by skipping at block
	// boundaries; the kept blocks remain in original load order.
	var (
		bodyB     strings.Builder
		sources   []string
		origins   []string
		seenOrig  = make(map[string]bool, 6)
		truncated int
	)
	for _, b := range blocks {
		opening := openRuleTag(b)
		closeTag := "\n</rule>"
		if bodyB.Len()+len(opening)+len(b.body)+len(closeTag) > MaxBundleBytes {
			truncated++
			continue
		}
		if bodyB.Len() > 0 {
			bodyB.WriteString("\n")
		}
		bodyB.WriteString(opening)
		bodyB.Write(b.body)
		bodyB.WriteString(closeTag)
		sources = append(sources, b.source)
		sources = append(sources, b.aliases...)
		if !seenOrig[b.origin] {
			seenOrig[b.origin] = true
			origins = append(origins, b.origin)
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

	hasFallback := false
	for _, b := range blocks {
		if b.loadedAs == loadedAsFallback {
			hasFallback = true
			break
		}
	}

	var envelope strings.Builder
	envelope.WriteString(`<rules sources="`)
	envelope.WriteString(strings.Join(sources, ","))
	envelope.WriteString(`" origins="`)
	envelope.WriteString(strings.Join(origins, ","))
	envelope.WriteString(`" precedence=".loomrules">`)
	envelope.WriteString("\nOn conflict, rules from .loomrules take precedence over other listed sources.\n")
	if hasFallback {
		// Fallback rules came from another tool's conventions (e.g.
		// CLAUDE.md under OpenAI). Tell the model to apply the substance
		// and ignore identity claims that wouldn't make sense for the
		// active provider.
		envelope.WriteString("Rules tagged loaded-as=\"fallback\" originated from another tool's conventions — apply their substance, ignore any model-specific identity claims.\n")
	}
	envelope.WriteString(body)
	envelope.WriteString("\n</rules>")

	return Bundle{
		Text:    envelope.String(),
		Sources: sources,
		Hash:    hex.EncodeToString(hash[:]),
	}
}

// openRuleTag formats the per-rule opening tag. Native rules get
// `<rule source origin>`; fallback rules add `loaded-as="fallback"`;
// dedup aliases (one or more) surface in an `also="..."` attribute so
// the kept entry still attributes the dropped files.
func openRuleTag(b *ruleBlock) string {
	var sb strings.Builder
	sb.WriteString("\n<rule source=")
	sb.WriteString(quoteAttr(b.source))
	sb.WriteString(" origin=")
	sb.WriteString(quoteAttr(b.origin))
	if len(b.aliases) > 0 {
		sb.WriteString(" also=")
		sb.WriteString(quoteAttr(strings.Join(b.aliases, ",")))
	}
	if b.loadedAs == loadedAsFallback {
		sb.WriteString(` loaded-as="fallback"`)
	}
	sb.WriteString(">\n")
	return sb.String()
}

// quoteAttr produces a %q-style double-quoted attribute. Kept as a helper
// so the tag formatter reads top-to-bottom without %q noise.
func quoteAttr(v string) string {
	return fmt.Sprintf("%q", v)
}

// nativeCandidates returns the provider's own convention files in load order.
func nativeCandidates(workspaceRoot, family string) []string {
	c, ok := familycfg.For(family)
	if !ok {
		return nil
	}
	return append([]string{c.RulesFile}, globMarkdown(workspaceRoot, c.RulesDir)...)
}

// fallbackCandidates returns the universal chain to try when the provider's
// own files are absent. The other providers' files come first so a user with
// only AGENTS.md still gets it under Anthropic (and vice versa). After the
// foreign-family files, common third-party conventions (Copilot, Cursor)
// round out the chain so any project layout still contributes.
func fallbackCandidates(workspaceRoot, family string) []string {
	var out []string
	// Foreign families in canonical order (when family is unknown, all
	// three are included — matches the previous default-case behaviour).
	for _, c := range familycfg.Fallbacks(family) {
		out = append(out, c.RulesFile)
		out = append(out, globMarkdown(workspaceRoot, c.RulesDir)...)
	}
	out = append(out, ".github/copilot-instructions.md")
	out = append(out, globMarkdown(workspaceRoot, ".github/instructions")...)
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
