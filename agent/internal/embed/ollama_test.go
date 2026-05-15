package embed

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestOllamaEmbedMockServer drives the Ollama provider against a fake HTTP
// server. It verifies the request body shape (model + input fields) and that
// the response is correctly decoded into the [][]float32 return slot.
func TestOllamaEmbedMockServer(t *testing.T) {
	var seenReqs []ollamaEmbedRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/embeddings" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var req ollamaEmbedRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		seenReqs = append(seenReqs, req)
		_ = json.NewEncoder(w).Encode(ollamaEmbedResponse{
			Embedding: []float32{float32(len(req.Input)), 0.1, 0.2, 0.3},
		})
	}))
	defer srv.Close()

	p := newOllama(srv.URL, "test-model")
	vecs, err := p.Embed(context.Background(), []string{"hello", "world!"})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vecs) != 2 || len(vecs[0]) != 4 {
		t.Fatalf("unexpected vectors: %+v", vecs)
	}
	if vecs[0][0] != 5 || vecs[1][0] != 6 { // "hello"=5, "world!"=6
		t.Errorf("unexpected first components: %+v", vecs)
	}
	if len(seenReqs) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(seenReqs))
	}
	if seenReqs[0].Model != "test-model" {
		t.Errorf("unexpected model: %s", seenReqs[0].Model)
	}
	if !strings.EqualFold(seenReqs[1].Input, "world!") {
		t.Errorf("unexpected input forwarded: %q", seenReqs[1].Input)
	}
	if got := p.Dim(); got != 4 {
		t.Errorf("Dim() = %d, want 4", got)
	}
	if got := p.Model(); got != "test-model" {
		t.Errorf("Model() = %s", got)
	}
}
