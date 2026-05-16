// Package skills implements an on-demand context registry. Each skill has a
// short synopsis (advertised in the system prompt) and a body (injected only
// after the model calls the load_skill tool). Skills come from two places:
//
//   - builtin/*.md, embedded via embed.FS
//   - <workspace>/.loom/skills/<id>/SKILL.md
//
// Each skill file uses YAML-ish front matter:
//
//	---
//	id: testing-conventions
//	synopsis: how to write and run tests in this repo
//	---
//	<body>
//
// The catalogue is built per task in Load(); it is small enough to keep in
// memory and is sorted by id for byte stability in the prompt prefix.
package skills

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed builtin/*.md
var builtinFS embed.FS

// Skill is one entry in the catalogue.
type Skill struct {
	ID       string
	Synopsis string
	Body     string
	Source   string // "builtin" or workspace-relative path
}

// Catalogue holds the available skills, keyed by ID, plus the sorted order.
type Catalogue struct {
	Skills map[string]Skill
	Order  []string // ascending by id
}

// Load builds the catalogue for the workspace. workspaceRoot may be empty
// (only builtins will be loaded). Errors reading individual files are
// silently ignored — a malformed user skill should never break the agent.
func Load(workspaceRoot string) Catalogue {
	cat := Catalogue{Skills: map[string]Skill{}}

	// Builtin skills.
	entries, err := builtinFS.ReadDir("builtin")
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".md") {
				continue
			}
			data, err := builtinFS.ReadFile("builtin/" + e.Name())
			if err != nil {
				continue
			}
			s, ok := parseSkill(string(data), "builtin")
			if !ok {
				continue
			}
			cat.Skills[s.ID] = s
		}
	}

	// Workspace skills override builtins of the same id.
	if workspaceRoot != "" {
		base := filepath.Join(workspaceRoot, ".loom", "skills")
		entries, err := os.ReadDir(base)
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				path := filepath.Join(base, e.Name(), "SKILL.md")
				data, err := os.ReadFile(path)
				if err != nil {
					continue
				}
				rel := filepath.ToSlash(filepath.Join(".loom/skills", e.Name(), "SKILL.md"))
				s, ok := parseSkill(string(data), rel)
				if !ok {
					continue
				}
				cat.Skills[s.ID] = s
			}
		}
	}

	for id := range cat.Skills {
		cat.Order = append(cat.Order, id)
	}
	sort.Strings(cat.Order)
	return cat
}

// CatalogueLines returns the "id: synopsis" lines for the prompt prefix in
// stable (sorted) order.
func (c Catalogue) CatalogueLines() []string {
	out := make([]string, 0, len(c.Order))
	for _, id := range c.Order {
		s := c.Skills[id]
		synopsis := strings.ReplaceAll(s.Synopsis, "\n", " ")
		if synopsis == "" {
			synopsis = "(no synopsis)"
		}
		out = append(out, fmt.Sprintf("- %s: %s", id, synopsis))
	}
	return out
}

// RenderLoaded returns the concatenated bodies of the given skill ids (in
// sorted order), each prefixed with a stable header. Unknown ids are skipped.
// Empty result if no ids resolve.
func (c Catalogue) RenderLoaded(ids []string) string {
	uniq := map[string]bool{}
	var ordered []string
	for _, id := range ids {
		if !uniq[id] {
			if _, ok := c.Skills[id]; ok {
				uniq[id] = true
				ordered = append(ordered, id)
			}
		}
	}
	if len(ordered) == 0 {
		return ""
	}
	sort.Strings(ordered)
	var b strings.Builder
	for i, id := range ordered {
		if i > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(fmt.Sprintf("<skill id=\"%s\">\n", id))
		b.WriteString(strings.TrimSpace(c.Skills[id].Body))
		b.WriteString("\n</skill>")
	}
	return b.String()
}

func parseSkill(text, source string) (Skill, bool) {
	const delim = "---"
	trim := strings.TrimLeft(text, "\r\n ")
	if !strings.HasPrefix(trim, delim) {
		return Skill{}, false
	}
	rest := strings.TrimPrefix(trim, delim)
	end := strings.Index(rest, delim)
	if end < 0 {
		return Skill{}, false
	}
	frontMatter := rest[:end]
	body := strings.TrimLeft(rest[end+len(delim):], "\r\n")

	var id, synopsis string
	for _, line := range strings.Split(frontMatter, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := strings.TrimSpace(line[:colon])
		val := strings.TrimSpace(line[colon+1:])
		switch strings.ToLower(key) {
		case "id":
			id = val
		case "synopsis":
			synopsis = val
		}
	}
	if id == "" {
		return Skill{}, false
	}
	return Skill{ID: id, Synopsis: synopsis, Body: body, Source: source}, true
}
