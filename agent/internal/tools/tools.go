package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Tool describes a tool exposed to the LLM.
type Tool struct {
	Name             string
	Description      string
	InputSchema      map[string]any
	RequiresApproval bool
	// If LocalExec is non-nil, the agent executes it in-process.
	// If nil, the agent asks the TS host to execute via tool.call RPC.
	//
	// ctx is the task context — implementations should honour cancellation
	// for any long-running work (network calls, large file scans) so the
	// user's Cancel propagates promptly. Pure in-memory tools may ignore it.
	LocalExec func(ctx context.Context, workspaceRoot string, input json.RawMessage) (string, error)
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
					"path":   map[string]any{"type": "string"},
					"offset": map[string]any{"type": "number", "description": "1-based starting line (default 1)."},
					"limit":  map[string]any{"type": "number", "description": "Max lines to return (default unlimited; capped on very large files)."},
				},
				"required": []string{"path"},
			},
			LocalExec: func(_ context.Context, root string, raw json.RawMessage) (string, error) {
				var in struct {
					Path   string `json:"path"`
					Offset int    `json:"offset"`
					Limit  int    `json:"limit"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				return ReadFile(root, in.Path, in.Offset, in.Limit)
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
			LocalExec: func(_ context.Context, root string, raw json.RawMessage) (string, error) {
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
			LocalExec: func(ctx context.Context, root string, raw json.RawMessage) (string, error) {
				var in SearchInput
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				return SearchCtx(ctx, root, in)
			},
		},
		{
			Name: "find_files",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pattern":    map[string]any{"type": "string", "description": "Filename glob, e.g. \"**/*.tsx\" or \"src/**/loop.go\"."},
					"path":       map[string]any{"type": "string", "description": "Optional workspace-relative root (defaults to workspace root)."},
					"maxResults": map[string]any{"type": "number", "description": "Cap returned paths (default 200)."},
				},
				"required": []string{"pattern"},
			},
			LocalExec: func(ctx context.Context, root string, raw json.RawMessage) (string, error) {
				var in FindFilesInput
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
				return FindFilesCtx(ctx, root, in)
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
						"type":        "array",
						"description": "Each edit is either an anchor edit {oldText, newText} or a range edit {startLine, endLine, newText}. Do not mix both shapes in one edit.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"oldText":   map[string]any{"type": "string", "description": "Anchor mode: exact, unique text in the file. Required for anchor edits."},
								"newText":   map[string]any{"type": "string", "description": "Replacement text as a JSON string (required). For multiline content, use literal \\n between lines (e.g. \"line1\\nline2\"). Pass \"\" to delete. Do not pass null, an array, or an object."},
								"startLine": map[string]any{"type": "number", "description": "Range mode: 1-based inclusive start line. Required with endLine."},
								"endLine":   map[string]any{"type": "number", "description": "Range mode: 1-based inclusive end line. Use startLine-1 for pure insert."},
							},
							"required": []string{"newText"},
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
					"cwd":     map[string]any{"type": "string", "description": "Optional workspace-relative working directory. Defaults to the workspace root."},
					"shell":   map[string]any{"type": "string", "enum": []string{"auto", "powershell", "cmd", "bash", "sh"}, "description": "Optional shell override. Defaults to auto."},
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
					"shell":   map[string]any{"type": "string", "enum": []string{"auto", "powershell", "cmd", "bash", "sh"}, "description": "Optional shell override. Defaults to auto."},
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
			Name: "scratchpad",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"action": map[string]any{
						"type":        "string",
						"enum":        []string{"read", "write", "append", "clear"},
						"description": "What to do with the scratchpad note.",
					},
					"content": map[string]any{
						"type":        "string",
						"description": "Body for write/append. Ignored for read/clear.",
					},
				},
				"required": []string{"action"},
			},
			// LocalExec is intentionally nil — the loop intercepts this tool
			// (see execScratchpad) so it can mutate the conversation Entry's
			// in-memory copy alongside the on-disk file without expanding the
			// generic LocalExec signature with state-mutating dependencies.
		},
		{
			Name: "spawn_subagent",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"type":    map[string]any{"type": "string", "enum": []string{"research", "review"}},
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

// Read tuning constants. These are exposed for tests.
const (
	// readSoftSizeLimit is the byte threshold above which read_file applies
	// readSoftLineCap when the caller did not specify a limit. The intent is
	// to keep accidental whole-file reads from blowing up the model's context
	// while still letting the caller opt in to the full body via offset/limit.
	readSoftSizeLimit = 256 * 1024
	readSoftLineCap   = 2000
	// readBufMax keeps long lines (minified bundles, generated JSON) readable
	// without blowing memory on pathological files.
	readBufMax = 1 * 1024 * 1024
)

// ReadFile returns a slice of the file at workspace-relative `rel`. offset is
// 1-based; offset<=0 means start at line 1. limit<=0 means "no caller limit"
// (but the soft cap may still apply for very large files). The returned
// string is prefixed with a single comment header noting the line window and
// truncation status so the model knows whether more content exists.
func ReadFile(root, rel string, offset, limit int) (string, error) {
	full, err := cleanRelativePath(root, rel)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("path is a directory: %s", rel)
	}
	f, err := os.Open(full)
	if err != nil {
		return "", err
	}
	defer f.Close()

	if offset < 1 {
		offset = 1
	}
	softCap := 0
	if limit <= 0 && info.Size() > readSoftSizeLimit {
		softCap = readSoftLineCap
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), readBufMax)

	var b strings.Builder
	startLine := offset
	endLine := offset - 1
	emitted := 0
	totalLines := 0
	more := false

	for lineNo := 1; scanner.Scan(); lineNo++ {
		totalLines = lineNo
		if lineNo < offset {
			continue
		}
		if limit > 0 && emitted >= limit {
			more = true
			break
		}
		if softCap > 0 && emitted >= softCap {
			more = true
			break
		}
		b.WriteString(scanner.Text())
		b.WriteByte('\n')
		emitted++
		endLine = lineNo
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}

	if more {
		// Drain remaining line count so the header can report the true total.
		// Re-open and count rather than buffering — file is on disk.
		if n, ok := countLines(full); ok {
			totalLines = n
		}
	}

	header := fmt.Sprintf("// Lines %d-%d", startLine, endLine)
	if emitted == 0 {
		header = fmt.Sprintf("// Lines %d-%d (empty range)", startLine, startLine)
	}
	if totalLines > 0 {
		header += fmt.Sprintf(" of %d", totalLines)
	}
	header += fmt.Sprintf(" in %s", slashPath(rel))
	if more {
		if softCap > 0 && limit <= 0 {
			header += "\n// File exceeds soft size limit; pass offset/limit to read more, or use search to locate specific lines."
		} else {
			header += "\n// Truncated by limit; pass a higher offset to continue."
		}
	}
	return header + "\n" + b.String(), nil
}

func countLines(full string) (int, bool) {
	f, err := os.Open(full)
	if err != nil {
		return 0, false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), readBufMax)
	n := 0
	for sc.Scan() {
		n++
	}
	if sc.Err() != nil {
		return 0, false
	}
	return n, true
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
