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
				var in struct{ Path string `json:"path"` }
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
				var in struct{ Path string `json:"path"` }
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
			Name:             "write_file",
			Description:      "Write content to a file relative to the workspace root.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string"},
					"content": map[string]any{"type": "string"},
				},
				"required": []string{"path", "content"},
			},
			// No LocalExec — executed on the TS side.
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
