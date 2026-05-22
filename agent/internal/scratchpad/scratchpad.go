// Package scratchpad persists a per-conversation working-memory note to disk.
// The file lives under $LOOM_STORAGE_DIR/scratchpad/<conversationId>.md when
// the host sets that env var (VS Code routes it to its per-workspace
// ExtensionContext.storageUri, keeping runtime artifacts out of the repo);
// otherwise it falls back to <workspace>/.loom/scratchpad/<conversationId>.md
// for headless tests and pre-upgrade installs. The loop owns in-memory state
// on the conversation.Entry; this package only does file I/O.
package scratchpad

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const dirName = ".loom/scratchpad"

// MaxBytes caps a single scratchpad body. The note rides along in the model's
// context every time it reads, so an unbounded buffer would silently inflate
// token usage.
const MaxBytes = 64 * 1024

// baseDir returns the directory that holds per-conversation scratchpad files.
// When LOOM_STORAGE_DIR is set (the VS Code host's per-workspace storage path)
// the files live under <storage>/scratchpad/. Otherwise they fall back to
// <workspace>/.loom/scratchpad/ so headless callers and existing installs
// keep working unchanged.
func baseDir(workspaceRoot string) string {
	if storage := strings.TrimSpace(os.Getenv("LOOM_STORAGE_DIR")); storage != "" {
		return filepath.Join(storage, "scratchpad")
	}
	return filepath.Join(workspaceRoot, filepath.FromSlash(dirName))
}

// Path returns the absolute file path for the given conversation's scratchpad.
// It does not create the file or its parent directory.
func Path(workspaceRoot, conversationID string) (string, error) {
	id := strings.TrimSpace(conversationID)
	if id == "" {
		return "", fmt.Errorf("scratchpad: empty conversation id")
	}
	// Defensive: keep the filename inside the scratchpad dir even if the
	// caller passed a path-like id.
	if strings.ContainsAny(id, `/\`) || id == "." || id == ".." {
		return "", fmt.Errorf("scratchpad: invalid conversation id %q", id)
	}
	return filepath.Join(baseDir(workspaceRoot), id+".md"), nil
}

// Load reads the persisted scratchpad. A missing file is not an error; it
// returns ("", nil) so the caller can treat first-use the same as empty.
func Load(workspaceRoot, conversationID string) (string, error) {
	p, err := Path(workspaceRoot, conversationID)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// Save overwrites the scratchpad file with body. The parent dir is created
// on demand. Bodies larger than MaxBytes are rejected so a runaway append
// can't grow the note without bound.
func Save(workspaceRoot, conversationID, body string) error {
	if len(body) > MaxBytes {
		return fmt.Errorf("scratchpad: body exceeds %d bytes", MaxBytes)
	}
	p, err := Path(workspaceRoot, conversationID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(body), 0o644)
}

// Clear removes the scratchpad file. Removing a missing file is a no-op.
func Clear(workspaceRoot, conversationID string) error {
	p, err := Path(workspaceRoot, conversationID)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
