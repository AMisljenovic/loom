// Package skills implements an on-demand context registry. Each skill has a
// short synopsis (advertised in the system prompt) and a body (injected only
// after the model calls the load_skill tool). Skills come from Loom-native
// sources and provider-family external conventions:
//
//   - builtin/*.md, embedded via embed.FS
//   - <workspace>/.loom/skills/<id>/SKILL.md
//   - <workspace>/.claude/skills/<id>/SKILL.md or .codex/skills/<id>/SKILL.md
//
// Loom-native entries win over external entries. Workspace .loom skills win
// over builtins, preserving the existing user override behavior.
package skills

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/your-org/loom/internal/normalize"
)

//go:embed builtin/*.md
var builtinFS embed.FS

// Skill is one entry in the catalogue.
type Skill struct {
	ID       string
	Synopsis string
	Triggers []string // optional: topics that suggest loading the skill
	Body     string
	Source   string // "builtin" or workspace-relative path
	Origin   string // normalize.Origin* (loom/claude/codex/...); "loom" for builtins
}

// Catalogue holds the available skills, keyed by ID, plus the sorted order.
type Catalogue struct {
	Skills map[string]Skill
	Order  []string // ascending by id
}

// Load builds the catalogue for the workspace. workspaceRoot may be empty
// (only builtins will be loaded). Errors reading individual files are
// silently ignored; a malformed user skill should never break the agent.
func Load(workspaceRoot, family string) Catalogue {
	cat := Catalogue{Skills: map[string]Skill{}}

	if workspaceRoot != "" {
		nativeRead := loadExternalSkills(&cat, workspaceRoot, nativeSkillsDir(family))
		if nativeRead == 0 {
			for _, dir := range fallbackSkillsDirs(family) {
				loadExternalSkills(&cat, workspaceRoot, dir)
			}
		}
	}

	// Builtin skills override external skills of the same id.
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
			s.Origin = normalize.OriginLoom
			cat.Skills[s.ID] = s
		}
	}

	// Workspace skills override builtins and external skills of the same id.
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
				s.Origin = normalize.OriginLoom
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

func loadExternalSkills(cat *Catalogue, workspaceRoot, relDir string) int {
	if relDir == "" {
		return 0
	}
	base := filepath.Join(workspaceRoot, filepath.FromSlash(relDir))
	entries, err := os.ReadDir(base)
	if err != nil {
		return 0
	}
	read := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(relDir, e.Name(), "SKILL.md"))
		data, err := os.ReadFile(filepath.Join(workspaceRoot, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		s, ok := parseExternalSkill(string(data), rel)
		if !ok {
			continue
		}
		cat.Skills[s.ID] = s
		read++
	}
	return read
}

func nativeSkillsDir(family string) string {
	switch family {
	case "anthropic":
		return ".claude/skills"
	case "openai":
		return ".codex/skills"
	default:
		return ""
	}
}

func fallbackSkillsDirs(family string) []string {
	switch family {
	case "anthropic":
		return []string{".codex/skills"}
	case "openai":
		return []string{".claude/skills"}
	default:
		return []string{".claude/skills", ".codex/skills"}
	}
}

// CatalogueLines returns the "id: synopsis [triggers: a, b]" lines for the
// prompt prefix in stable (sorted) order. Triggers are appended only when
// present so existing skills without them render unchanged.
func (c Catalogue) CatalogueLines() []string {
	withSource := c.HasExternal()
	out := make([]string, 0, len(c.Order))
	for _, id := range c.Order {
		s := c.Skills[id]
		synopsis := strings.ReplaceAll(s.Synopsis, "\n", " ")
		if synopsis == "" {
			synopsis = "(no synopsis)"
		}
		line := fmt.Sprintf("- %s: %s", id, synopsis)
		if len(s.Triggers) > 0 {
			line += fmt.Sprintf(" [triggers: %s]", strings.Join(s.Triggers, ", "))
		}
		if withSource && s.Source != "" && s.Source != "builtin" {
			line += fmt.Sprintf(" [source: %s]", s.Source)
		}
		out = append(out, line)
	}
	return out
}

// HasExternal reports whether the catalogue includes imported non-Loom skills.
func (c Catalogue) HasExternal() bool {
	for _, s := range c.Skills {
		if IsExternalSource(s.Source) {
			return true
		}
	}
	return false
}

// IsExternalSource reports whether source belongs to a non-Loom convention.
func IsExternalSource(source string) bool {
	return strings.HasPrefix(source, ".claude/") || strings.HasPrefix(source, ".codex/")
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
		s := c.Skills[id]
		if s.Origin != "" && s.Origin != normalize.OriginLoom {
			b.WriteString(fmt.Sprintf("<skill id=\"%s\" origin=\"%s\">\n", id, s.Origin))
		} else {
			b.WriteString(fmt.Sprintf("<skill id=\"%s\">\n", id))
		}
		b.WriteString(strings.TrimSpace(s.Body))
		b.WriteString("\n</skill>")
	}
	return b.String()
}

func parseSkill(text, source string) (Skill, bool) {
	frontMatter, body, ok := splitFrontmatter(text)
	if !ok {
		return Skill{}, false
	}

	var id, synopsis string
	var triggers []string
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
		case "triggers":
			triggers = parseTriggers(val)
		}
	}
	if id == "" {
		return Skill{}, false
	}
	return Skill{ID: id, Synopsis: synopsis, Triggers: triggers, Body: body, Source: source}, true
}

// parseExternalSkill parses Claude/Codex-format SKILL.md (name: → id,
// description: → synopsis) and normalises the body for the detected origin.
func parseExternalSkill(text, source string) (Skill, bool) {
	frontMatter, body, ok := splitFrontmatter(text)
	if !ok {
		return Skill{}, false
	}
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
		case "name":
			id = val
		case "description":
			synopsis = val
		}
	}
	if id == "" {
		return Skill{}, false
	}
	origin := normalize.Origin(source)
	return Skill{
		ID:       id,
		Synopsis: synopsis,
		Body:     normalize.SkillBody(origin, body),
		Source:   source,
		Origin:   origin,
	}, true
}

func splitFrontmatter(text string) (frontMatter, body string, ok bool) {
	const delim = "---"
	trim := strings.TrimLeft(text, "\r\n ")
	if !strings.HasPrefix(trim, delim) {
		return "", "", false
	}
	rest := strings.TrimPrefix(trim, delim)
	end := strings.Index(rest, delim)
	if end < 0 {
		return "", "", false
	}
	return rest[:end], strings.TrimLeft(rest[end+len(delim):], "\r\n"), true
}

// parseTriggers accepts either a bracketed list (`[a, b, c]`) or a plain
// comma-separated value (`a, b, c`). Whitespace is trimmed and empty entries
// dropped.
func parseTriggers(val string) []string {
	v := strings.TrimSpace(val)
	v = strings.TrimPrefix(v, "[")
	v = strings.TrimSuffix(v, "]")
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
