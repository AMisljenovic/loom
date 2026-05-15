package tools

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/your-org/loom/internal/index"
)

// IndexTools returns find_symbol and find_references tools backed by the
// given indexer. If idx is nil the tools are registered but return a clear
// error so the model knows they are unavailable.
func IndexTools(idx *index.Indexer) []Tool {
	return []Tool{
		{
			Name:        "find_symbol",
			Description: "Find symbol definitions (functions, methods, types, classes) across the indexed workspace by exact name. Optional kind filter (function|method|type|interface|class|variable|constant) and path prefix.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{"type": "string"},
					"kind": map[string]any{"type": "string"},
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"name"},
			},
			LocalExec: func(root string, raw json.RawMessage) (string, error) {
				if idx == nil {
					return "", fmt.Errorf("workspace index is not available")
				}
				var in struct {
					Name string `json:"name"`
					Kind string `json:"kind"`
					Path string `json:"path"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				matches := idx.Store().LookupSymbol(in.Name, index.Kind(in.Kind), in.Path)
				if len(matches) == 0 {
					return "no matches", nil
				}
				var b strings.Builder
				for _, m := range matches {
					fmt.Fprintf(&b, "%s\t%s\t%s:%d-%d\n", m.Kind, m.Name, m.Path, m.StartLine, m.EndLine)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "find_references",
			Description: "Find identifier occurrences across the indexed workspace by exact name (name-based, no semantic scoping). Optional path prefix filter.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{"type": "string"},
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"name"},
			},
			LocalExec: func(root string, raw json.RawMessage) (string, error) {
				if idx == nil {
					return "", fmt.Errorf("workspace index is not available")
				}
				var in struct {
					Name string `json:"name"`
					Path string `json:"path"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				refs := idx.Store().LookupReferences(in.Name, in.Path)
				if len(refs) == 0 {
					return "no references", nil
				}
				var b strings.Builder
				for _, r := range refs {
					fmt.Fprintf(&b, "%s:%d\n", r.Path, r.Line)
				}
				return b.String(), nil
			},
		},
	}
}
