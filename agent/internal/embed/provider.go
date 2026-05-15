// Package embed defines a provider-neutral interface for text embeddings,
// and bundles Ollama (local) and Voyage AI (hosted) implementations. The
// llm.Provider abstraction is the prior art and shape this mirrors.
package embed

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// Provider abstracts a text embeddings backend.
type Provider interface {
	// Embed returns one vector per input text. Vectors are L2-norm comparable
	// across calls (i.e. cosine similarity is meaningful).
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	// Dim is the embedding dimensionality.
	Dim() int
	// Model identifies the backend model for telemetry / logging.
	Model() string
}

// NewFromEnv constructs a Provider from environment variables, or returns
// (nil, nil) if embeddings are disabled. Selection:
//
//	LOOM_EMBED_PROVIDER  "ollama" | "voyage"  (empty = disabled)
//	LOOM_EMBED_MODEL     provider-specific default if empty
//	OLLAMA_HOST          default http://localhost:11434
//	VOYAGE_API_KEY       required when provider=voyage
func NewFromEnv() (Provider, error) {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("LOOM_EMBED_PROVIDER")))
	if provider == "" || provider == "disabled" {
		return nil, nil
	}
	model := os.Getenv("LOOM_EMBED_MODEL")
	switch provider {
	case "ollama":
		host := os.Getenv("OLLAMA_HOST")
		if host == "" {
			host = "http://localhost:11434"
		}
		if model == "" {
			model = "nomic-embed-text"
		}
		return newOllama(host, model), nil
	case "voyage":
		key := os.Getenv("VOYAGE_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("VOYAGE_API_KEY required when LOOM_EMBED_PROVIDER=voyage")
		}
		if model == "" {
			model = "voyage-code-3"
		}
		return newVoyage(key, model), nil
	}
	return nil, fmt.Errorf("unknown LOOM_EMBED_PROVIDER %q", provider)
}
