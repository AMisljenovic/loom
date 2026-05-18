package loop

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/scratchpad"
)

func call(t *testing.T, root string, e *conversation.Entry, id string, payload string) toolOutcome {
	t.Helper()
	return execScratchpad(root, e, id, json.RawMessage(payload))
}

func TestScratchpadReadEmpty(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	out := call(t, root, e, "c1", `{"action":"read"}`)
	if out.err != nil {
		t.Fatalf("read empty: %v", out.err)
	}
	if !strings.Contains(out.content, "empty") {
		t.Fatalf("expected 'empty' marker, got %q", out.content)
	}
}

func TestScratchpadWriteThenRead(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	out := call(t, root, e, "c1", `{"action":"write","content":"hello"}`)
	if out.err != nil {
		t.Fatalf("write: %v", out.err)
	}
	out = call(t, root, e, "c1", `{"action":"read"}`)
	if out.err != nil {
		t.Fatalf("read: %v", out.err)
	}
	if out.content != "hello" {
		t.Fatalf("read content: got %q want %q", out.content, "hello")
	}
}

func TestScratchpadAppendAddsNewlineBetweenChunks(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	if out := call(t, root, e, "c1", `{"action":"write","content":"first"}`); out.err != nil {
		t.Fatalf("write: %v", out.err)
	}
	if out := call(t, root, e, "c1", `{"action":"append","content":"second"}`); out.err != nil {
		t.Fatalf("append: %v", out.err)
	}
	out := call(t, root, e, "c1", `{"action":"read"}`)
	if out.content != "first\nsecond" {
		t.Fatalf("append join: got %q want %q", out.content, "first\nsecond")
	}
}

func TestScratchpadAppendRequiresContent(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	out := call(t, root, e, "c1", `{"action":"append"}`)
	if out.err == nil {
		t.Fatalf("expected error for empty append")
	}
}

func TestScratchpadClearRemovesFile(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	if out := call(t, root, e, "c1", `{"action":"write","content":"x"}`); out.err != nil {
		t.Fatalf("write: %v", out.err)
	}
	if out := call(t, root, e, "c1", `{"action":"clear"}`); out.err != nil {
		t.Fatalf("clear: %v", out.err)
	}
	if e.Scratchpad != "" {
		t.Fatalf("expected in-memory cleared, got %q", e.Scratchpad)
	}
	p, _ := scratchpad.Path(root, "c1")
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("expected file removed, stat err = %v", err)
	}
}

func TestScratchpadLazyLoadsFromDisk(t *testing.T) {
	root := t.TempDir()
	// Simulate a prior conversation having persisted content.
	if err := scratchpad.Save(root, "c1", "from-disk"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	e := &conversation.Entry{} // fresh entry, no in-memory state
	out := call(t, root, e, "c1", `{"action":"read"}`)
	if out.err != nil {
		t.Fatalf("read: %v", out.err)
	}
	if out.content != "from-disk" {
		t.Fatalf("lazy-load: got %q want %q", out.content, "from-disk")
	}
	if !e.ScratchpadLoaded {
		t.Fatalf("expected ScratchpadLoaded to flip to true")
	}
}

func TestScratchpadRejectsUnknownAction(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	out := call(t, root, e, "c1", `{"action":"bogus"}`)
	if out.err == nil {
		t.Fatalf("expected error for unknown action")
	}
}

func TestScratchpadRejectsEmptyAction(t *testing.T) {
	root := t.TempDir()
	e := &conversation.Entry{}
	out := call(t, root, e, "c1", `{"action":""}`)
	if out.err == nil {
		t.Fatalf("expected error for empty action")
	}
}
