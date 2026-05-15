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

// TestVoyageEmbedMockServer points the Voyage provider at a fake server and
// verifies request shape (auth header, model, batched input) and response
// decoding. The provider's URL is normally hard-coded; we override it for
// the test using a customized HTTP client transport.
func TestVoyageEmbedMockServer(t *testing.T) {
	var got struct {
		auth   string
		req    voyageRequest
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.auth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got.req)
		resp := voyageResponse{}
		for i := range got.req.Input {
			resp.Data = append(resp.Data, struct {
				Embedding []float32 `json:"embedding"`
			}{Embedding: []float32{float32(i), 0.5}})
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	p := newVoyage("sk-test", "voyage-code-3").(*voyageProvider)
	// Redirect the HTTP client to our test server.
	p.http = srv.Client()
	// Swap the hard-coded URL by wrapping the client transport.
	origTransport := srv.Client().Transport
	p.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r.URL.Scheme = "http"
		r.URL.Host = srv.Listener.Addr().String()
		r.URL.Path = "/v1/embeddings"
		if origTransport != nil {
			return origTransport.RoundTrip(r)
		}
		return http.DefaultTransport.RoundTrip(r)
	})

	vecs, err := p.Embed(context.Background(), []string{"a", "b", "c"})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vecs) != 3 {
		t.Fatalf("expected 3 vectors, got %d", len(vecs))
	}
	if !strings.HasPrefix(got.auth, "Bearer ") || !strings.Contains(got.auth, "sk-test") {
		t.Errorf("missing or wrong auth header: %q", got.auth)
	}
	if got.req.Model != "voyage-code-3" {
		t.Errorf("model not forwarded: %s", got.req.Model)
	}
	if len(got.req.Input) != 3 {
		t.Errorf("expected batched input of 3, got %d", len(got.req.Input))
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
