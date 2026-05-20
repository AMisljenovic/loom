// Package rules loads the project rules file (.loomrules) and produces a
// single bundle the agent system prompt can include. Loom intentionally only
// reads .loomrules — foreign-format files (CLAUDE.md, AGENTS.md, GEMINI.md,
// .cursor/, .github/copilot-instructions.md, ...) are not loaded. Workspaces
// that want to share content across tools can symlink or generate .loomrules
// from another file.
package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// MaxBundleBytes caps the rules body. A larger .loomrules is truncated at
// this boundary with a "<truncated: N byte(s) omitted>" marker so the model
// knows content was elided.
const MaxBundleBytes = 32 * 1024

// Bundle is the result of a Load() call.
type Bundle struct {
	Text    string   // wrapped <rules>…</rules>, empty if .loomrules is absent
	Sources []string // workspace-relative paths actually included
	Hash    string   // SHA-256 of the included body
}

// Load reads .loomrules from workspaceRoot and returns the wrapped bundle.
// Returns the zero Bundle when workspaceRoot is empty or .loomrules is absent.
func Load(workspaceRoot string) Bundle {
	if workspaceRoot == "" {
		return Bundle{}
	}
	const source = ".loomrules"
	data, err := os.ReadFile(filepath.Join(workspaceRoot, source))
	if err != nil {
		return Bundle{}
	}
	body := data
	truncated := 0
	if len(body) > MaxBundleBytes {
		truncated = len(body) - MaxBundleBytes
		body = body[:MaxBundleBytes]
	}

	sum := sha256.Sum256(body)

	var envelope strings.Builder
	envelope.WriteString(`<rules source=".loomrules">`)
	envelope.WriteString("\n")
	envelope.Write(body)
	if truncated > 0 {
		fmt.Fprintf(&envelope, "\n<truncated: %d byte(s) omitted>", truncated)
	}
	envelope.WriteString("\n</rules>")

	return Bundle{
		Text:    envelope.String(),
		Sources: []string{source},
		Hash:    hex.EncodeToString(sum[:]),
	}
}
