package loop

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	maxReferenceFileBytes    = 12 * 1024
	maxReferenceTotalBytes   = 32 * 1024
	maxReferenceFolderItems  = 120
	maxReferenceReadFileSize = 2 * 1024 * 1024
)

// Reference mirrors src/shared/protocol.ts ReferenceAttachment.
type Reference struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

// RenderReferences converts per-turn file/folder references into a bounded
// prompt block. It validates every path against the workspace root.
func RenderReferences(workspaceRoot string, refs []Reference) (string, error) {
	if len(refs) == 0 {
		return "", nil
	}
	root, err := filepath.Abs(workspaceRoot)
	if err != nil || root == "" {
		return "", fmt.Errorf("references: workspace root is required")
	}
	var b strings.Builder
	b.WriteString("<references>\n")
	remaining := maxReferenceTotalBytes
	for _, ref := range refs {
		full, rel, err := resolveReferencePath(root, ref.Path)
		if err != nil {
			return "", err
		}
		switch ref.Kind {
		case "file":
			rendered, used := renderFileReference(full, rel, remaining)
			b.WriteString(rendered)
			remaining -= used
		case "folder":
			rendered := renderFolderReference(full, rel)
			b.WriteString(rendered)
		default:
			return "", fmt.Errorf("references: unsupported kind %q for %s", ref.Kind, ref.Path)
		}
		if remaining <= 0 {
			b.WriteString("<truncated reason=\"reference total byte cap reached\" />\n")
			break
		}
	}
	b.WriteString("</references>")
	return b.String(), nil
}

func resolveReferencePath(root, rel string) (string, string, error) {
	rel = strings.TrimSpace(strings.ReplaceAll(rel, "\\", "/"))
	if rel == "" {
		return "", "", fmt.Errorf("references: path is required")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(clean) {
		return "", "", fmt.Errorf("references: absolute path %q is not allowed", rel)
	}
	full, err := filepath.Abs(filepath.Join(root, clean))
	if err != nil {
		return "", "", fmt.Errorf("references: resolve %q: %w", rel, err)
	}
	if full != root && !strings.HasPrefix(full, root+string(filepath.Separator)) {
		return "", "", fmt.Errorf("references: path %q escapes workspace", rel)
	}
	slashRel, err := filepath.Rel(root, full)
	if err != nil {
		return "", "", fmt.Errorf("references: relative %q: %w", rel, err)
	}
	if slashRel == "." {
		return full, ".", nil
	}
	return full, filepath.ToSlash(slashRel), nil
}

func renderFileReference(full, rel string, remaining int) (string, int) {
	var b strings.Builder
	fmt.Fprintf(&b, "<reference kind=\"file\" path=\"%s\">\n", escapeAttr(rel))
	info, err := os.Stat(full)
	if err != nil {
		fmt.Fprintf(&b, "<error>%s</error>\n</reference>\n", escapeText(err.Error()))
		return b.String(), 0
	}
	if info.IsDir() {
		b.WriteString("<error>expected file, got directory</error>\n</reference>\n")
		return b.String(), 0
	}
	if info.Size() > maxReferenceReadFileSize {
		fmt.Fprintf(&b, "<truncated reason=\"file too large\" size=\"%d\" />\n</reference>\n", info.Size())
		return b.String(), 0
	}
	data, err := os.ReadFile(full)
	if err != nil {
		fmt.Fprintf(&b, "<error>%s</error>\n</reference>\n", escapeText(err.Error()))
		return b.String(), 0
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		fmt.Fprintf(&b, "<binary size=\"%d\" />\n</reference>\n", len(data))
		return b.String(), 0
	}
	limit := maxReferenceFileBytes
	if remaining < limit {
		limit = remaining
	}
	if limit < 0 {
		limit = 0
	}
	text := string(data)
	truncated := false
	if len(data) > limit {
		text = string(data[:limit])
		truncated = true
	}
	if truncated {
		fmt.Fprintf(&b, "<content truncated=\"true\" bytes=\"%d\" shown=\"%d\">\n", len(data), len(text))
	} else {
		fmt.Fprintf(&b, "<content bytes=\"%d\">\n", len(data))
	}
	b.WriteString(text)
	if !strings.HasSuffix(text, "\n") {
		b.WriteString("\n")
	}
	b.WriteString("</content>\n</reference>\n")
	return b.String(), len(text)
}

func renderFolderReference(full, rel string) string {
	var entries []string
	truncated := false
	err := filepath.WalkDir(full, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == full {
			return nil
		}
		name := d.Name()
		if d.IsDir() && shouldSkipReferenceDir(name) {
			return filepath.SkipDir
		}
		itemRel, relErr := filepath.Rel(full, path)
		if relErr != nil {
			return nil
		}
		prefix := rel
		if prefix == "." {
			prefix = ""
		}
		display := filepath.ToSlash(filepath.Join(prefix, itemRel))
		if d.IsDir() {
			display += "/"
		}
		entries = append(entries, display)
		if len(entries) >= maxReferenceFolderItems {
			truncated = true
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(entries)
	var b strings.Builder
	fmt.Fprintf(&b, "<reference kind=\"folder\" path=\"%s\">\n", escapeAttr(rel))
	if err != nil {
		fmt.Fprintf(&b, "<error>%s</error>\n</reference>\n", escapeText(err.Error()))
		return b.String()
	}
	fmt.Fprintf(&b, "<listing truncated=\"%t\">\n", truncated)
	for _, entry := range entries {
		b.WriteString(entry)
		b.WriteString("\n")
	}
	b.WriteString("</listing>\n</reference>\n")
	return b.String()
}

func shouldSkipReferenceDir(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "bin", ".loom":
		return true
	default:
		return false
	}
}

func escapeAttr(s string) string {
	return strings.NewReplacer("&", "&amp;", "\"", "&quot;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func escapeText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
