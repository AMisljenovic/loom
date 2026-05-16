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
			Description:      "Run a shell command in the workspace terminal. Blocking; for long-running processes (dev servers, watchers) use run_command_background instead.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
				},
				"required": []string{"command"},
			},
		},
		{
			Name:             "run_command_background",
			Description:      "Start a shell command as a background process and return immediately with a processId. Use for dev servers, watchers, or anything that should outlive the turn. Read incremental output with read_process_output and terminate with kill_process.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
					"cwd":     map[string]any{"type": "string"},
				},
				"required": []string{"command"},
			},
		},
		{
			Name:        "read_process_output",
			Description: "Read accumulated stdout/stderr from a background process started with run_command_background. Returns the chunk since the optional cursor plus a new cursor for the next read.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"processId":   map[string]any{"type": "string"},
					"sinceCursor": map[string]any{"type": "number"},
					"maxBytes":    map[string]any{"type": "number"},
				},
				"required": []string{"processId"},
			},
		},
		{
			Name:             "kill_process",
			Description:      "Terminate a background process started with run_command_background.",
			RequiresApproval: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"processId": map[string]any{"type": "string"},
				},
				"required": []string{"processId"},
			},
		},
		{
			Name:        "load_skill",
			Description: "Load one or more skills by id. Each skill is a short Markdown guide for a specific topic; the skill catalogue is listed in the system prompt. Loaded skill bodies are injected into the system prompt for the rest of the conversation and inform later answers.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"ids": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
				},
				"required": []string{"ids"},
			},
			// LocalExec is intentionally nil — the loop intercepts this tool
			// in execToolNoApprovalGate so it can mutate the conversation
			// Entry (LoadedSkills) without expanding the generic LocalExec
			// signature with state-mutating dependencies.
		},
	}
}
