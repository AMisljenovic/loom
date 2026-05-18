package tools

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type FindFilesInput struct {
	Pattern    string `json:"pattern"`
	Path       string `json:"path"`
	MaxResults int    `json:"maxResults"`
}

const defaultFindFilesMax = 200

// FindFiles returns workspace-relative paths matching `pattern` under `path`
// (defaulting to the workspace root). The pattern supports `*`, `?`, and `**`
// (recursive). Results are sorted lexically and capped at MaxResults.
func FindFiles(root string, in FindFilesInput) (string, error) {
	if strings.TrimSpace(in.Pattern) == "" {
		return "", errors.New("pattern is required")
	}
	if in.Path == "" {
		in.Path = "."
	}
	if in.MaxResults <= 0 {
		in.MaxResults = defaultFindFilesMax
	}
	if _, err := cleanRelativePath(root, in.Path); err != nil {
		return "", err
	}

	if rg := ripgrepPath(); rg != "" {
		out, err := findFilesWithRipgrep(root, rg, in)
		if err == nil {
			return out, nil
		}
		// Fall through to walk on failure — ripgrep may not be available
		// or may have bailed; the walker is a complete substitute.
	}
	return findFilesWithWalk(root, in)
}

func findFilesWithRipgrep(root, rg string, in FindFilesInput) (string, error) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	args := []string{"--files", "-g", in.Pattern, in.Path}
	cmd := exec.CommandContext(ctx, rg, args...)
	cmd.Dir = root
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	var paths []string
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		p := strings.TrimSpace(sc.Text())
		if p == "" {
			continue
		}
		paths = append(paths, slashPath(p))
		if len(paths) >= in.MaxResults {
			cancel()
			break
		}
	}
	stderrBytes, _ := io.ReadAll(stderr)
	waitErr := cmd.Wait()
	if scErr := sc.Err(); scErr != nil && !errors.Is(scErr, context.Canceled) {
		return "", scErr
	}
	if waitErr != nil && len(paths) == 0 {
		if exitErr, ok := waitErr.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return renderFindFiles(paths, false), nil
		}
		return "", fmt.Errorf("rg: %s", strings.TrimSpace(string(stderrBytes)))
	}
	sort.Strings(paths)
	return renderFindFiles(paths, len(paths) >= in.MaxResults), nil
}

func findFilesWithWalk(root string, in FindFilesInput) (string, error) {
	base, err := cleanRelativePath(root, in.Path)
	if err != nil {
		return "", err
	}
	pattern := slashPath(in.Pattern)
	var paths []string
	truncated := false
	walkErr := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if shouldSkipDir(d.Name()) && path != base {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		rel = slashPath(rel)
		if !matchesAnyGlob(rel, []string{pattern}) {
			return nil
		}
		paths = append(paths, rel)
		if len(paths) >= in.MaxResults {
			truncated = true
			return filepath.SkipAll
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, filepath.SkipAll) {
		return "", walkErr
	}
	sort.Strings(paths)
	return renderFindFiles(paths, truncated), nil
}

func renderFindFiles(paths []string, truncated bool) string {
	var b strings.Builder
	for _, p := range paths {
		b.WriteString(p)
		b.WriteByte('\n')
	}
	if truncated {
		fmt.Fprintf(&b, "(%d matches; truncated — narrow the pattern or raise maxResults)", len(paths))
	} else {
		fmt.Fprintf(&b, "(%d matches)", len(paths))
	}
	return b.String()
}
