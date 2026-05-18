package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, dir, rel, body string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func TestReadFileFull(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "hello.txt", "alpha\nbeta\ngamma\n")

	out, err := ReadFile(root, "hello.txt", 0, 0)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(out, "// Lines 1-3 of 3 in hello.txt") {
		t.Errorf("missing/incorrect header: %q", out)
	}
	if !strings.Contains(out, "alpha\nbeta\ngamma\n") {
		t.Errorf("expected full body, got: %q", out)
	}
}

func TestReadFileOffsetLimit(t *testing.T) {
	root := t.TempDir()
	var lines []string
	for i := 1; i <= 10; i++ {
		lines = append(lines, fmt.Sprintf("line %d", i))
	}
	writeFile(t, root, "many.txt", strings.Join(lines, "\n")+"\n")

	out, err := ReadFile(root, "many.txt", 4, 3)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(out, "// Lines 4-6") {
		t.Errorf("expected window 4-6, got header in %q", out)
	}
	if !strings.Contains(out, "line 4\nline 5\nline 6") {
		t.Errorf("unexpected body window: %q", out)
	}
	if strings.Contains(out, "line 7") {
		t.Errorf("limit not respected: %q", out)
	}
	if !strings.Contains(out, "Truncated by limit") {
		t.Errorf("expected truncation note, got: %q", out)
	}
}

func TestReadFileOffsetOnly(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "x.txt", "a\nb\nc\nd\n")
	out, err := ReadFile(root, "x.txt", 3, 0)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(out, "// Lines 3-4 of 4 in x.txt") {
		t.Errorf("unexpected header: %q", out)
	}
	if !strings.Contains(out, "c\nd\n") {
		t.Errorf("unexpected body: %q", out)
	}
}

func TestReadFileSoftCap(t *testing.T) {
	root := t.TempDir()
	// Build a file just over the soft size limit. Each line is short, so
	// we need many of them to exceed 256KB; pick a length and count so the
	// total comfortably exceeds the threshold but the line count exceeds
	// the soft line cap.
	const lineLen = 80
	const totalLines = readSoftLineCap + 1500 // 3500 lines
	var b strings.Builder
	row := strings.Repeat("a", lineLen)
	for i := 0; i < totalLines; i++ {
		b.WriteString(row)
		b.WriteByte('\n')
	}
	if b.Len() <= readSoftSizeLimit {
		t.Fatalf("test fixture too small: %d bytes, need > %d", b.Len(), readSoftSizeLimit)
	}
	writeFile(t, root, "big.txt", b.String())

	out, err := ReadFile(root, "big.txt", 0, 0)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(out, "soft size limit") {
		t.Errorf("expected soft-cap note, got: %q", firstN(out, 200))
	}
	emittedLines := strings.Count(out, "\n") - strings.Count(headerOf(out), "\n")
	if emittedLines > readSoftLineCap+5 {
		t.Errorf("soft cap not enforced: emitted %d lines", emittedLines)
	}
}

func TestReadFileMissing(t *testing.T) {
	root := t.TempDir()
	_, err := ReadFile(root, "does-not-exist.txt", 0, 0)
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestReadFileRejectsAbsolute(t *testing.T) {
	root := t.TempDir()
	abs, _ := filepath.Abs(root)
	_, err := ReadFile(root, abs, 0, 0)
	if err == nil {
		t.Fatal("expected error for absolute path")
	}
}

func TestFindFilesBasic(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "src/a.ts", "")
	writeFile(t, root, "src/b.ts", "")
	writeFile(t, root, "src/c.go", "")
	writeFile(t, root, "test/d.ts", "")

	out, err := FindFiles(root, FindFilesInput{Pattern: "**/*.ts"})
	if err != nil {
		t.Fatalf("FindFiles: %v", err)
	}
	for _, want := range []string{"src/a.ts", "src/b.ts", "test/d.ts"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in: %q", want, out)
		}
	}
	if strings.Contains(out, "c.go") {
		t.Errorf("unexpected .go match: %q", out)
	}
}

func TestFindFilesScopedPath(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a/x.tsx", "")
	writeFile(t, root, "b/y.tsx", "")

	out, err := FindFiles(root, FindFilesInput{Pattern: "**/*.tsx", Path: "a"})
	if err != nil {
		t.Fatalf("FindFiles: %v", err)
	}
	if !strings.Contains(out, "a/x.tsx") {
		t.Errorf("missing a/x.tsx: %q", out)
	}
	if strings.Contains(out, "b/y.tsx") {
		t.Errorf("scope leaked: %q", out)
	}
}

func TestFindFilesMaxResults(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 30; i++ {
		writeFile(t, root, fmt.Sprintf("pkg/file%02d.go", i), "")
	}
	out, err := FindFiles(root, FindFilesInput{Pattern: "**/*.go", MaxResults: 5})
	if err != nil {
		t.Fatalf("FindFiles: %v", err)
	}
	// Each match is its own line; the trailing footer adds one more.
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("unexpected output: %q", out)
	}
	matches := lines[:len(lines)-1]
	if len(matches) > 5 {
		t.Errorf("maxResults not honored: got %d matches", len(matches))
	}
	if !strings.Contains(out, "truncated") && !strings.Contains(out, "matches; truncated") {
		t.Errorf("expected truncation note, got: %q", out)
	}
}

func TestFindFilesEmptyPattern(t *testing.T) {
	root := t.TempDir()
	_, err := FindFiles(root, FindFilesInput{Pattern: ""})
	if err == nil {
		t.Fatal("expected error for empty pattern")
	}
}

func headerOf(s string) string {
	nl := strings.IndexByte(s, '\n')
	if nl < 0 {
		return s
	}
	return s[:nl+1]
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
