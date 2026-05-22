package scratchpad

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMissingReturnsEmpty(t *testing.T) {
	root := t.TempDir()
	body, err := Load(root, "conv-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if body != "" {
		t.Fatalf("expected empty body, got %q", body)
	}
}

func TestSaveThenLoadRoundTrip(t *testing.T) {
	root := t.TempDir()
	want := "hello\nworld\n"
	if err := Save(root, "conv-1", want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := Load(root, "conv-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != want {
		t.Fatalf("Load mismatch: got %q want %q", got, want)
	}
	p, _ := Path(root, "conv-1")
	if !strings.Contains(filepath.ToSlash(p), ".loom/scratchpad/conv-1.md") {
		t.Fatalf("unexpected path: %s", p)
	}
}

func TestClearRemovesFile(t *testing.T) {
	root := t.TempDir()
	if err := Save(root, "conv-1", "x"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := Clear(root, "conv-1"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	p, _ := Path(root, "conv-1")
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("expected file removed, stat err = %v", err)
	}
	// Clear on a missing file is a no-op.
	if err := Clear(root, "conv-1"); err != nil {
		t.Fatalf("Clear (missing): %v", err)
	}
}

func TestSaveRejectsOversize(t *testing.T) {
	root := t.TempDir()
	body := strings.Repeat("a", MaxBytes+1)
	if err := Save(root, "conv-1", body); err == nil {
		t.Fatalf("expected error for oversize body")
	}
}

func TestPathRejectsBadID(t *testing.T) {
	root := t.TempDir()
	for _, id := range []string{"", "..", "foo/bar", `foo\bar`} {
		if _, err := Path(root, id); err == nil {
			t.Fatalf("expected error for id %q", id)
		}
	}
}

func TestStorageDirEnvOverridesWorkspaceRoot(t *testing.T) {
	root := t.TempDir()
	storage := t.TempDir()
	t.Setenv("LOOM_STORAGE_DIR", storage)

	if err := Save(root, "conv-1", "hello"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	p, err := Path(root, "conv-1")
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	wantPrefix := filepath.Join(storage, "scratchpad")
	if !strings.HasPrefix(p, wantPrefix) {
		t.Fatalf("scratchpad path %q not under %q", p, wantPrefix)
	}
	if strings.Contains(filepath.ToSlash(p), "/.loom/scratchpad/") {
		t.Fatalf("scratchpad path %q still uses .loom fallback", p)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("expected file at %s: %v", p, err)
	}

	got, err := Load(root, "conv-1")
	if err != nil || got != "hello" {
		t.Fatalf("Load via env-storage round-trip: got=%q err=%v", got, err)
	}
}

func TestStorageDirEnvEmptyFallsBack(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOOM_STORAGE_DIR", "   ")
	p, err := Path(root, "conv-1")
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if !strings.Contains(filepath.ToSlash(p), ".loom/scratchpad/conv-1.md") {
		t.Fatalf("empty env should fall back to .loom path, got %s", p)
	}
}
