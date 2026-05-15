package index

import (
	"context"
	"testing"
)

// TestVectorStoreRoundTrip exercises the SQLite-backed store: insert, replace,
// search. It runs against a fresh temp directory so it's hermetic.
func TestVectorStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenVectorStore(dir, 4)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer store.Close()

	chunks := []Chunk{
		{StartLine: 1, EndLine: 5, Content: "alpha"},
		{StartLine: 6, EndLine: 10, Content: "beta"},
	}
	vectors := [][]float32{
		{1, 0, 0, 0},
		{0, 1, 0, 0},
	}
	if err := store.ReplaceFileChunks("a.go", chunks, vectors); err != nil {
		t.Fatalf("ReplaceFileChunks: %v", err)
	}

	query := []float32{0.9, 0.1, 0, 0}
	hits, err := store.Search(context.Background(), query, 2)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(hits))
	}
	if hits[0].Snippet != "alpha" {
		t.Errorf("expected alpha to rank first, got %q (score=%v)", hits[0].Snippet, hits[0].Score)
	}
	if hits[0].Score <= hits[1].Score {
		t.Errorf("scores should be sorted descending: %v vs %v", hits[0].Score, hits[1].Score)
	}

	// Replace and confirm previous rows are dropped.
	if err := store.ReplaceFileChunks("a.go", []Chunk{{StartLine: 1, EndLine: 3, Content: "gamma"}}, [][]float32{{0, 0, 1, 0}}); err != nil {
		t.Fatalf("replace: %v", err)
	}
	hits, err = store.Search(context.Background(), []float32{0, 0, 1, 0}, 5)
	if err != nil {
		t.Fatalf("Search after replace: %v", err)
	}
	if len(hits) != 1 || hits[0].Snippet != "gamma" {
		t.Errorf("expected only gamma after replace, got %+v", hits)
	}
}

// TestChunkFileOverlap verifies the line-window chunker covers the file with
// a step of (window-overlap).
func TestChunkFileOverlap(t *testing.T) {
	content := ""
	for i := 0; i < 100; i++ {
		content += "line\n"
	}
	chunks := ChunkFile(content, 40, 10)
	if len(chunks) < 3 {
		t.Fatalf("expected multiple chunks, got %d", len(chunks))
	}
	if chunks[0].StartLine != 1 || chunks[0].EndLine != 40 {
		t.Errorf("first chunk wrong: %+v", chunks[0])
	}
	if chunks[1].StartLine != 31 {
		t.Errorf("second chunk should start at 31 (40-step 30), got %d", chunks[1].StartLine)
	}
}
