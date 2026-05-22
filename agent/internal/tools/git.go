package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// gitStatusDefaultBranch is what we report when `git status -b` returns the
// initial-branch placeholder before any commits exist.
const gitStatusInitialBranch = "(unborn)"

// gitDiffDefaultMaxBytes caps the diff payload we hand back to the model.
// Larger diffs are truncated with an explicit marker so the model knows to
// pull a narrower slice via `paths` or fall back to `run_command`.
const gitDiffDefaultMaxBytes = 64 * 1024

// gitDiffHardMaxBytes is the upper bound the caller cannot exceed even when
// they ask for "everything". Keeps a single tool call from blowing the
// context.
const gitDiffHardMaxBytes = 256 * 1024

type gitStatusInput struct {
	Path string `json:"path"`
}

type gitDiffInput struct {
	Staged   *bool    `json:"staged"`
	Paths    []string `json:"paths"`
	MaxBytes int      `json:"maxBytes"`
}

// GitStatusCtx runs `git status --porcelain=v1 -b` rooted at workspaceRoot
// (or a subdirectory) and returns a structured plain-text summary the model
// can parse line-by-line. Read-only; never writes refs or the index.
func GitStatusCtx(ctx context.Context, workspaceRoot string, in gitStatusInput) (string, error) {
	cwd := workspaceRoot
	if in.Path != "" {
		full, err := cleanRelativePath(workspaceRoot, in.Path)
		if err != nil {
			return "", err
		}
		cwd = full
	}
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain=v1", "-b", "--untracked-files=normal")
	cmd.Dir = cwd
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("git status: %s", msg)
	}
	return formatGitStatus(stdout.String()), nil
}

func formatGitStatus(raw string) string {
	branch := ""
	ahead, behind := 0, 0
	var staged, unstaged, untracked []string
	for _, line := range strings.Split(raw, "\n") {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "## ") {
			branch, ahead, behind = parseBranchLine(strings.TrimPrefix(line, "## "))
			continue
		}
		if len(line) < 3 {
			continue
		}
		x, y, path := line[0], line[1], line[3:]
		if x == '?' && y == '?' {
			untracked = append(untracked, path)
			continue
		}
		if x != ' ' && x != '?' {
			staged = append(staged, fmt.Sprintf("%s %s", string(x), path))
		}
		if y != ' ' && y != '?' {
			unstaged = append(unstaged, fmt.Sprintf("%s %s", string(y), path))
		}
	}

	var b strings.Builder
	if branch == "" {
		branch = gitStatusInitialBranch
	}
	fmt.Fprintf(&b, "Branch: %s\n", branch)
	if ahead > 0 || behind > 0 {
		fmt.Fprintf(&b, "Sync: ahead %d, behind %d\n", ahead, behind)
	}
	writeStatusGroup(&b, "Staged", staged)
	writeStatusGroup(&b, "Unstaged", unstaged)
	writeStatusGroup(&b, "Untracked", untracked)
	if len(staged)+len(unstaged)+len(untracked) == 0 {
		b.WriteString("Working tree clean.\n")
	}
	return b.String()
}

func parseBranchLine(s string) (branch string, ahead, behind int) {
	// Examples:
	//   "main"
	//   "main...origin/main"
	//   "main...origin/main [ahead 2, behind 1]"
	//   "No commits yet on main"
	if strings.HasPrefix(s, "No commits yet on ") {
		return strings.TrimPrefix(s, "No commits yet on "), 0, 0
	}
	head := s
	rest := ""
	if i := strings.Index(s, " ["); i >= 0 {
		head = s[:i]
		rest = s[i+2:]
		rest = strings.TrimSuffix(rest, "]")
	}
	if i := strings.Index(head, "..."); i >= 0 {
		branch = head[:i]
	} else {
		branch = head
	}
	for _, part := range strings.Split(rest, ",") {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "ahead "):
			fmt.Sscanf(strings.TrimPrefix(part, "ahead "), "%d", &ahead)
		case strings.HasPrefix(part, "behind "):
			fmt.Sscanf(strings.TrimPrefix(part, "behind "), "%d", &behind)
		}
	}
	return branch, ahead, behind
}

func writeStatusGroup(b *strings.Builder, label string, lines []string) {
	if len(lines) == 0 {
		return
	}
	fmt.Fprintf(b, "%s (%d):\n", label, len(lines))
	for _, l := range lines {
		fmt.Fprintf(b, "  %s\n", l)
	}
}

// GitDiffCtx runs `git diff` (or `git diff --cached`) rooted at workspaceRoot
// and returns the patch, truncated to maxBytes with a clear marker so the
// model knows to narrow `paths` or fall back to `run_command`. Read-only.
func GitDiffCtx(ctx context.Context, workspaceRoot string, in gitDiffInput) (string, error) {
	staged := false
	if in.Staged != nil {
		staged = *in.Staged
	}
	maxBytes := in.MaxBytes
	if maxBytes <= 0 {
		maxBytes = gitDiffDefaultMaxBytes
	}
	if maxBytes > gitDiffHardMaxBytes {
		maxBytes = gitDiffHardMaxBytes
	}

	args := []string{"diff", "--no-color", "--no-ext-diff"}
	if staged {
		args = append(args, "--cached")
	}
	if len(in.Paths) > 0 {
		args = append(args, "--")
		args = append(args, in.Paths...)
	}

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = workspaceRoot
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("git diff: %s", msg)
	}

	out := stdout.Bytes()
	header := "Diff (unstaged)"
	if staged {
		header = "Diff (staged)"
	}
	if len(in.Paths) > 0 {
		header += " for paths: " + strings.Join(in.Paths, ", ")
	}
	if len(out) == 0 {
		return header + "\n(no changes)\n", nil
	}
	truncated := false
	if len(out) > maxBytes {
		out = out[:maxBytes]
		truncated = true
	}
	var b strings.Builder
	b.WriteString(header)
	b.WriteByte('\n')
	b.Write(out)
	if truncated {
		if b.Len() > 0 && out[len(out)-1] != '\n' {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "// Diff truncated at %d bytes. Narrow with `paths`, raise `maxBytes` (cap %d), or use run_command for the full patch.\n", maxBytes, gitDiffHardMaxBytes)
	}
	return b.String(), nil
}

// gitStatusTool / gitDiffTool are the registry entries. They live in tools.go
// alongside the rest of the registry through the constructors below — kept in
// this file so the implementation stays grouped.
func gitStatusTool() Tool {
	return Tool{
		Name: "git_status",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{
					"type":        "string",
					"description": "Optional workspace-relative subdirectory. Defaults to the workspace root.",
				},
			},
		},
		LocalExec: func(ctx context.Context, root string, raw json.RawMessage) (string, error) {
			var in gitStatusInput
			if len(raw) > 0 && string(raw) != "null" {
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
			}
			return GitStatusCtx(ctx, root, in)
		},
	}
}

func gitDiffTool() Tool {
	return Tool{
		Name: "git_diff",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"staged": map[string]any{
					"type":        "boolean",
					"description": "If true, run `git diff --cached`. Defaults to false (unstaged changes).",
				},
				"paths": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "Optional workspace-relative paths to restrict the diff to.",
				},
				"maxBytes": map[string]any{
					"type":        "number",
					"description": "Cap on returned bytes. Default 65536, hard cap 262144.",
				},
			},
		},
		LocalExec: func(ctx context.Context, root string, raw json.RawMessage) (string, error) {
			var in gitDiffInput
			if len(raw) > 0 && string(raw) != "null" {
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", err
				}
			}
			return GitDiffCtx(ctx, root, in)
		},
	}
}
