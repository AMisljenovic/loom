package index

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	ignore "github.com/sabhiram/go-gitignore"
)

// supportedExt returns true for source files we know how to parse.
func supportedExt(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py":
		return true
	}
	return false
}

// LanguageFromPath returns a coarse language tag for the indexer.
func LanguageFromPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return "go"
	case ".ts":
		return "typescript"
	case ".tsx":
		return "tsx"
	case ".js", ".jsx", ".mjs", ".cjs":
		return "javascript"
	case ".py":
		return "python"
	}
	return ""
}

// loadGitignore reads .gitignore at the workspace root. Missing file is fine.
func loadGitignore(root string) (*ignore.GitIgnore, error) {
	gi := filepath.Join(root, ".gitignore")
	if _, err := os.Stat(gi); err != nil {
		return nil, nil
	}
	return ignore.CompileIgnoreFile(gi)
}

// alwaysSkip is a hard list of directories we never descend into, even when
// not present in .gitignore. .loom is reserved for our own SQLite database.
var alwaysSkip = map[string]struct{}{
	".git":         {},
	".loom":        {},
	"node_modules": {},
	"dist":         {},
	"build":        {},
	"out":          {},
	"target":       {},
	"vendor":       {},
	".venv":        {},
	"__pycache__":  {},
}

// walkWorkspace walks root and calls visit for every supported source file,
// honoring .gitignore and the alwaysSkip directory list.
func walkWorkspace(root string, visit func(absPath, relPath string) error) error {
	gi, _ := loadGitignore(root)
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if _, skip := alwaysSkip[d.Name()]; skip {
				return fs.SkipDir
			}
			if gi != nil && gi.MatchesPath(rel) {
				return fs.SkipDir
			}
			return nil
		}
		if gi != nil && gi.MatchesPath(rel) {
			return nil
		}
		if !supportedExt(rel) {
			return nil
		}
		return visit(path, rel)
	})
}
