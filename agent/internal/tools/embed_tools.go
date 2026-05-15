package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/your-org/loom/internal/embed"
	"github.com/your-org/loom/internal/index"
)

// SemanticSearchTool returns the semantic_search tool, backed by the given
// embeddings provider and vector store. Either being nil disables the tool
// with a clear error message so the LLM can fall back to plain search.
func SemanticSearchTool(provider embed.Provider, store *index.VectorStore) Tool {
	return Tool{
		Name:        "semantic_search",
		Description: "Semantic code search. Returns the top-k indexed chunks ranked by similarity to the query. Falls back to an error if embeddings are not configured.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string"},
				"k":     map[string]any{"type": "number"},
			},
			"required": []string{"query"},
		},
		LocalExec: func(root string, raw json.RawMessage) (string, error) {
			if provider == nil || store == nil {
				return "", fmt.Errorf("semantic_search not configured: set loom.embeddings.provider")
			}
			var in struct {
				Query string `json:"query"`
				K     int    `json:"k"`
			}
			if err := json.Unmarshal(raw, &in); err != nil {
				return "", err
			}
			if in.K <= 0 {
				in.K = 10
			}
			vecs, err := provider.Embed(context.Background(), []string{in.Query})
			if err != nil {
				return "", fmt.Errorf("embed query: %w", err)
			}
			hits, err := store.Search(context.Background(), vecs[0], in.K)
			if err != nil {
				return "", err
			}
			if len(hits) == 0 {
				return "no matches", nil
			}
			var b strings.Builder
			for _, h := range hits {
				fmt.Fprintf(&b, "%s:%d-%d  score=%.3f\n", h.Path, h.StartLine, h.EndLine, h.Score)
				b.WriteString(truncate(h.Snippet, 400))
				b.WriteString("\n---\n")
			}
			return b.String(), nil
		},
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
