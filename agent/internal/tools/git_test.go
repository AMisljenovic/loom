package tools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func newGitRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH")
	}
	dir := t.TempDir()
	runGit := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Tester",
			"GIT_AUTHOR_EMAIL=tester@example.com",
			"GIT_COMMITTER_NAME=Tester",
			"GIT_COMMITTER_EMAIL=tester@example.com",
			"GIT_CONFIG_GLOBAL="+os.DevNull,
			"GIT_CONFIG_SYSTEM="+os.DevNull,
		)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	runGit("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "seed.txt"), []byte("seed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "seed.txt")
	runGit("commit", "-q", "-m", "seed")
	return dir
}

func TestGitStatusClean(t *testing.T) {
	dir := newGitRepo(t)
	out, err := GitStatusCtx(context.Background(), dir, gitStatusInput{})
	if err != nil {
		t.Fatalf("GitStatusCtx: %v", err)
	}
	if !strings.Contains(out, "Branch: main") {
		t.Fatalf("missing branch line:\n%s", out)
	}
	if !strings.Contains(out, "Working tree clean.") {
		t.Fatalf("expected clean message, got:\n%s", out)
	}
}

func TestGitStatusReportsAllGroups(t *testing.T) {
	dir := newGitRepo(t)
	// Staged modification.
	if err := os.WriteFile(filepath.Join(dir, "seed.txt"), []byte("seed-mod\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runOk(t, dir, "git", "add", "seed.txt")
	// Unstaged change to a tracked file.
	if err := os.WriteFile(filepath.Join(dir, "seed.txt"), []byte("seed-mod-2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Untracked file.
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := GitStatusCtx(context.Background(), dir, gitStatusInput{})
	if err != nil {
		t.Fatalf("GitStatusCtx: %v", err)
	}
	for _, want := range []string{"Staged", "Unstaged", "Untracked", "seed.txt", "new.txt"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "Working tree clean.") {
		t.Fatalf("unexpected clean marker:\n%s", out)
	}
}

func TestGitDiffStagedAndUnstaged(t *testing.T) {
	dir := newGitRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "seed.txt"), []byte("seed-mod\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runOk(t, dir, "git", "add", "seed.txt")
	if err := os.WriteFile(filepath.Join(dir, "seed.txt"), []byte("seed-unstaged\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	staged := true
	out, err := GitDiffCtx(context.Background(), dir, gitDiffInput{Staged: &staged})
	if err != nil {
		t.Fatalf("GitDiffCtx staged: %v", err)
	}
	if !strings.Contains(out, "Diff (staged)") || !strings.Contains(out, "seed-mod") {
		t.Fatalf("staged diff missing markers:\n%s", out)
	}
	if strings.Contains(out, "seed-unstaged") {
		t.Fatalf("staged diff should not contain unstaged text:\n%s", out)
	}

	out, err = GitDiffCtx(context.Background(), dir, gitDiffInput{})
	if err != nil {
		t.Fatalf("GitDiffCtx unstaged: %v", err)
	}
	if !strings.Contains(out, "Diff (unstaged)") || !strings.Contains(out, "seed-unstaged") {
		t.Fatalf("unstaged diff missing markers:\n%s", out)
	}
}

func TestGitDiffNoChanges(t *testing.T) {
	dir := newGitRepo(t)
	out, err := GitDiffCtx(context.Background(), dir, gitDiffInput{})
	if err != nil {
		t.Fatalf("GitDiffCtx: %v", err)
	}
	if !strings.Contains(out, "(no changes)") {
		t.Fatalf("expected no-changes marker:\n%s", out)
	}
}

func TestGitDiffTruncates(t *testing.T) {
	dir := newGitRepo(t)
	// Create a large change.
	var sb strings.Builder
	for i := 0; i < 5000; i++ {
		sb.WriteString("a line of text that is reasonably long to ensure quick growth past the cap\n")
	}
	if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	runOk(t, dir, "git", "add", "big.txt")
	staged := true
	out, err := GitDiffCtx(context.Background(), dir, gitDiffInput{Staged: &staged, MaxBytes: 4096})
	if err != nil {
		t.Fatalf("GitDiffCtx: %v", err)
	}
	if !strings.Contains(out, "Diff truncated at 4096 bytes") {
		t.Fatalf("expected truncation marker:\n%s", out[:min(2000, len(out))])
	}
}

func TestGitDiffPathFilter(t *testing.T) {
	dir := newGitRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("A\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("B\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := GitDiffCtx(context.Background(), dir, gitDiffInput{Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatalf("GitDiffCtx: %v", err)
	}
	if !strings.Contains(out, "for paths: a.txt") {
		t.Fatalf("missing path header:\n%s", out)
	}
	// b.txt is untracked, but the path filter restricts the diff to a.txt; the
	// diff body should not reference b.txt.
	if strings.Contains(out, "b.txt") {
		t.Fatalf("path-restricted diff should not mention other files:\n%s", out)
	}
}

func runOk(t *testing.T, dir string, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Tester",
		"GIT_AUTHOR_EMAIL=tester@example.com",
		"GIT_COMMITTER_NAME=Tester",
		"GIT_COMMITTER_EMAIL=tester@example.com",
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_CONFIG_SYSTEM="+os.DevNull,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %v: %v\n%s", name, args, err, out)
	}
}
