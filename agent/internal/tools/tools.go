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

// Registry returns the static tool set. Each tool's `Description` is overlaid
// from `descriptions/<name>.md` at call time; a missing description file
// panics loudly because the registry is embedded at build time and a mismatch
// means the build is wrong.
func Registry() []Tool {
	tools := []Tool{
		{
			Name: "read_file",
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
			Name: "list_dir",
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
			Name: "search",
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
			Name: "get_diagnostics",
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
			Name: "read_process_output",
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
			Name: "load_skill",
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
		{
			Name: "ask_questions",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{"type": "string"},
					"questions": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"id":       map[string]any{"type": "string"},
								"question": map[string]any{"type": "string"},
								"kind":     map[string]any{"type": "string", "enum": []string{"single", "multiple"}},
								"options": map[string]any{
									"type": "array",
									"items": map[string]any{
										"type": "object",
										"properties": map[string]any{
											"id":          map[string]any{"type": "string"},
											"label":       map[string]any{"type": "string"},
											"description": map[string]any{"type": "string"},
										},
										"required": []string{"id", "label"},
									},
								},
							},
							"required": []string{"id", "question", "kind", "options"},
						},
					},
				},
				"required": []string{"questions"},
			},
			// No LocalExec - executed interactively on the TS side.
		},
		{
			Name: "update_todos",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{"type": "string"},
					"items": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"id":     map[string]any{"type": "string"},
								"text":   map[string]any{"type": "string"},
								"status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "done", "cancelled"}},
							},
							"required": []string{"id", "text", "status"},
						},
					},
				},
				"required": []string{"items"},
			},
			// No LocalExec - executed on the TS side so the webview can update
			// its transcript todo card in real time.
		},
		{
			Name: "spawn_subagent",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"type":    map[string]any{"type": "string", "enum": []string{"research"}},
					"task":    map[string]any{"type": "string"},
					"context": map[string]any{"type": "string"},
					"files": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
				},
				"required": []string{"type", "task", "context"},
			},
			// Handled specially by the loop so the sub-agent can reuse the
			// same LLM/tool machinery while preserving isolated context.
		},
	}
	if err := overlayDescriptions(tools); err != nil {
		// Fail loud: descriptions are embedded at build time, so this can
		// only happen if a description file was deleted without removing the
		// tool, or the front-matter name drifted from the filename.
		panic(fmt.Sprintf("tools: %v", err))
	}
	return tools
}

func overlayDescriptions(tools []Tool) error {
	descs, err := Descriptions()
	if err != nil {
		return err
	}
	for i := range tools {
		d, ok := descs[tools[i].Name]
		if !ok {
			return fmt.Errorf("missing description for %q", tools[i].Name)
		}
		tools[i].Description = d.Purpose
	}
	return nil
}
