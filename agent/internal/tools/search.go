package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

type SearchInput struct {
	Query      string   `json:"query"`
	Path       string   `json:"path"`
	Globs      []string `json:"globs"`
	MaxResults int      `json:"maxResults"`
}

const (
	defaultMaxResults = 100
	maxSearchFileSize = 1024 * 1024
)

var (
	rgOnce sync.Once
	rgPath string
)

// Search runs a content search without an external cancellation context.
// Equivalent to SearchCtx(context.Background(), root, in); retained for
// callers (notably internal/eval) that don't have a task ctx to thread.
func Search(root string, in SearchInput) (string, error) {
	return SearchCtx(context.Background(), root, in)
}

// SearchCtx is the cancellable variant. The ripgrep subprocess and the
// directory walk both respect ctx so a user cancel propagates promptly.
func SearchCtx(ctx context.Context, root string, in SearchInput) (string, error) {
	if strings.TrimSpace(in.Query) == "" {
		return "", errors.New("query is required")
	}
	if in.Path == "" {
		in.Path = "."
	}
	if in.MaxResults <= 0 {
		in.MaxResults = defaultMaxResults
	}
	if _, err := cleanRelativePath(root, in.Path); err != nil {
		return "", err
	}
	if path := ripgrepPath(); path != "" {
		return searchWithRipgrep(ctx, root, path, in)
	}
	return searchWithWalk(ctx, root, in)
}

func ripgrepPath() string {
	rgOnce.Do(func() {
		p, err := exec.LookPath("rg")
		if err == nil {
			rgPath = p
		}
	})
	return rgPath
}

type searchAccumulator struct {
	lines []string
	files map[string]struct{}
}

func newSearchAccumulator() *searchAccumulator {
	return &searchAccumulator{files: make(map[string]struct{})}
}

func (a *searchAccumulator) add(path string, line int, snippet string) {
	a.lines = append(a.lines, fmt.Sprintf("%s:%d:%s", slashPath(path), line, strings.TrimRight(snippet, "\r\n")))
	a.files[slashPath(path)] = struct{}{}
}

func (a *searchAccumulator) done() string {
	var b strings.Builder
	for _, line := range a.lines {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	fmt.Fprintf(&b, "(%d matches in %d files)", len(a.lines), len(a.files))
	return b.String()
}

func searchWithRipgrep(parent context.Context, root, rg string, in SearchInput) (string, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	args := []string{"--json", fmt.Sprintf("--max-count=%d", in.MaxResults), "-e", in.Query}
	for _, glob := range in.Globs {
		args = append(args, "-g", glob)
	}
	args = append(args, in.Path)

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

	acc := newSearchAccumulator()
	decodeErr := decodeRipgrep(stdout, acc, in.MaxResults, cancel)
	stderrBytes, _ := io.ReadAll(stderr)
	waitErr := cmd.Wait()

	if decodeErr != nil {
		return "", decodeErr
	}
	if waitErr != nil && len(acc.lines) == 0 {
		if exitErr, ok := waitErr.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return acc.done(), nil
		}
		return "", fmt.Errorf("rg: %s", strings.TrimSpace(string(stderrBytes)))
	}
	return acc.done(), nil
}

type rgJSONLine struct {
	Type string `json:"type"`
	Data struct {
		Path struct {
			Text string `json:"text"`
		} `json:"path"`
		LineNumber int `json:"line_number"`
		Lines      struct {
			Text string `json:"text"`
		} `json:"lines"`
	} `json:"data"`
}

func decodeRipgrep(r io.Reader, acc *searchAccumulator, maxResults int, cancel context.CancelFunc) error {
	dec := json.NewDecoder(r)
	for {
		var msg rgJSONLine
		if err := dec.Decode(&msg); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if msg.Type != "match" {
			continue
		}
		acc.add(msg.Data.Path.Text, msg.Data.LineNumber, msg.Data.Lines.Text)
		if len(acc.lines) >= maxResults {
			cancel()
			return nil
		}
	}
}

func searchWithWalk(ctx context.Context, root string, in SearchInput) (string, error) {
	re, err := regexp.Compile(in.Query)
	if err != nil {
		return "", err
	}
	base, err := cleanRelativePath(root, in.Path)
	if err != nil {
		return "", err
	}

	acc := newSearchAccumulator()
	walkErr := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if shouldSkipDir(d.Name()) && path != base {
				return filepath.SkipDir
			}
			return nil
		}
		if len(acc.lines) >= in.MaxResults {
			return filepath.SkipAll
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		if !matchesAnyGlob(slashPath(rel), in.Globs) {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > maxSearchFileSize {
			return nil
		}
		return searchFile(root, path, re, acc, in.MaxResults)
	})
	if walkErr != nil && !errors.Is(walkErr, filepath.SkipAll) {
		return "", walkErr
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return acc.done(), nil
}

func searchFile(root, fullPath string, re *regexp.Regexp, acc *searchAccumulator, maxResults int) error {
	f, err := os.Open(fullPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	head := make([]byte, 512)
	n, err := f.Read(head)
	if err != nil && err != io.EOF {
		return nil
	}
	if containsNUL(head[:n]) {
		return nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}

	rel, err := filepath.Rel(root, fullPath)
	if err != nil {
		return nil
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNo := 1; scanner.Scan(); lineNo++ {
		line := scanner.Text()
		if re.MatchString(line) {
			acc.add(rel, lineNo, line)
			if len(acc.lines) >= maxResults {
				return filepath.SkipAll
			}
		}
	}
	return nil
}

func cleanRelativePath(root, rel string) (string, error) {
	clean := filepath.Clean(rel)
	if filepath.IsAbs(clean) {
		return "", fmt.Errorf("path %q must be relative to workspace root", rel)
	}
	full := filepath.Join(root, clean)
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if fullAbs != rootAbs && !strings.HasPrefix(fullAbs, rootAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("path %q escapes workspace root (resolves to %s, outside %s)", rel, fullAbs, rootAbs)
	}
	return fullAbs, nil
}

func shouldSkipDir(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "out":
		return true
	default:
		return false
	}
}

func containsNUL(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

func matchesAnyGlob(rel string, globs []string) bool {
	if len(globs) == 0 {
		return true
	}
	for _, glob := range globs {
		pattern := slashPath(glob)
		if ok, err := filepath.Match(pattern, rel); err == nil && ok {
			return true
		}
		if !strings.Contains(pattern, "/") {
			if ok, err := filepath.Match(pattern, baseName(rel)); err == nil && ok {
				return true
			}
		}
		if strings.Contains(pattern, "**") && doubleStarGlobMatches(pattern, rel) {
			return true
		}
	}
	return false
}

func doubleStarGlobMatches(pattern, name string) bool {
	re, err := regexp.Compile(globRegexp(pattern))
	if err != nil {
		return false
	}
	return re.MatchString(name)
}

func globRegexp(pattern string) string {
	var b strings.Builder
	b.WriteByte('^')
	for i := 0; i < len(pattern); i++ {
		switch pattern[i] {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				b.WriteString(".*")
				i++
			} else {
				b.WriteString("[^/]*")
			}
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(pattern[i])))
		}
	}
	b.WriteByte('$')
	return b.String()
}

func baseName(p string) string {
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return p
	}
	return p[i+1:]
}

func slashPath(p string) string {
	return filepath.ToSlash(p)
}
