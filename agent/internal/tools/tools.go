package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Tool describes a tool exposed to the LLM.
type Tool struct {
	Name             string
	Description      string
	InputSchema      map[string]any
	RequiresApproval bool
	// If LocalExec is non-nil, the agent executes it in-process.
	// If nil, the agent asks the TS host to execute via tool.call RPC.
	LocalExec func(workspaceRoot string, input json.RawMessage) (string, error)
}

func Registry() []Tool {
	return []Tool{
		{
			Name:        "read_file",
			Description: "Read a UTF-8 text file relative to the workspace root.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"path"},
			},
			LocalExec: func(root string, raw json.RawMessage) (string, error) {
				var in struct {
					Path string `json:"path"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				full := filepath.Join(root, in.Path)
				b, err := os.ReadFile(full)
				if err != nil {
					return "", err
				}
				return string(b), nil
			},
		},
		{
			Name:        "list_dir",
			Description: "List entries in a directory relative to the workspace root.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"path"},
			},
			LocalExec: func(root string, raw json.RawMessage) (string, error) {
				var in struct {
					Path string `json:"path"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				entries, err := os.ReadDir(filepath.Join(root, in.Path))
				if err != nil {
					return "", err
				}
				out := ""
				for _, e := range entries {
					kind := "file"
					if e.IsDir() {
						kind = "dir"
					}
					out += fmt.Sprintf("%s\t%s\n", kind, e.Name())
				}
				return out, nil
			},
		},
		{
			Name:        "search",
			Description: "Search the codebase with a regex query, optional relative path, include globs, and maxResults; returns path:line:snippet matches.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query":      map[string]any{"type": "string"},
					"path":       map[string]any{"type": "string"},
					"globs":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"maxResults": map[string]any{"type": "number"},
				},
				"required": []string{"query"},
			},
			LocalExec: func(root string, raw json.RawMessage) (string, error) {
				var in SearchInput
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				return Search(root, in)
			},
		},
		{
			Name:        "get_diagnostics",
			Description: "Get VS Code diagnostics for the whole workspace or a relative file path, filtered by severity error, warning, or all.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":     map[string]any{"type": "string"},
					"severity": map[string]any{"type": "string", "enum": []string{"error", "warning", "all"}},
				},
			},
			// No LocalExec - executed on the TS side.
		},
		{
			Name:             "apply_diff",
			Description:      "Modify or create a file relative to the workspace root using edits. For existing files, provide unique oldText/newText pairs. For new files, provide one edit with empty oldText and the full file content as newText.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string"},
					"edits": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"oldText": map[string]any{"type": "string"},
								"newText": map[string]any{"type": "string"},
							},
							"required": []string{"oldText", "newText"},
						},
					},
				},
				"required": []string{"path", "edits"},
			},
			// No LocalExec - executed on the TS side.
		},
		{
			Name:             "run_command",
			Description:      "Run a shell command in the workspace terminal.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
				},
				"required": []string{"command"},
			},
		},
	}
}
