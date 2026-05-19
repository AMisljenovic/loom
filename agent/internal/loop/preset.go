package loop

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/your-org/loom/internal/normalize"
	agentprompts "github.com/your-org/loom/internal/prompts"
)

const (
	subAgentMaxDepth       = 2
	subAgentMaxPerTurn     = 3
	subAgentMaxPerTaskTree = 30
	subAgentMaxTurns       = 30
	subAgentMaxInputTokens = int64(50000)
	taskTreeMaxInputTokens = int64(500000)
)

type Preset struct {
	Name           string
	Description    string
	SystemPrompt   string
	AllowedTools   []string
	AutoApprove    []string
	MaxTurns       int
	MaxInputTokens int64
	Source         string
	Origin         string // normalize.Origin*; "loom" for builtins and .loom/agents
}

type Registry struct {
	byName map[string]Preset
	order  []string
}

func LoadPresets(workspaceRoot, family string) Registry {
	reg := Registry{byName: map[string]Preset{}}
	if workspaceRoot != "" {
		nativeRead := loadExternalPresets(&reg, workspaceRoot, nativeAgentsDir(family))
		if nativeRead == 0 {
			for _, dir := range fallbackAgentsDirs(family) {
				loadExternalPresets(&reg, workspaceRoot, dir)
			}
		}
	}
	if p, err := researchPreset(); err == nil {
		reg.add(p)
	}
	if workspaceRoot != "" {
		loadExternalPresets(&reg, workspaceRoot, ".loom/agents")
	}
	reg.finalize()
	return reg
}

func (r Registry) For(name string) (Preset, error) {
	if p, ok := r.byName[name]; ok {
		return p, nil
	}
	return Preset{}, fmt.Errorf("unknown sub-agent type %q", name)
}

func (r Registry) All() []Preset {
	out := make([]Preset, 0, len(r.order))
	for _, name := range r.order {
		out = append(out, r.byName[name])
	}
	return out
}

func (r Registry) HasExternal() bool {
	for _, p := range r.byName {
		if isExternalPresetSource(p.Source) {
			return true
		}
	}
	return false
}

func (r *Registry) add(p Preset) {
	if r.byName == nil {
		r.byName = map[string]Preset{}
	}
	r.byName[p.Name] = p
}

func (r *Registry) finalize() {
	r.order = r.order[:0]
	for name := range r.byName {
		r.order = append(r.order, name)
	}
	sort.Strings(r.order)
}

func loadExternalPresets(reg *Registry, workspaceRoot, relDir string) int {
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
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".md") {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(relDir, e.Name()))
		data, err := os.ReadFile(filepath.Join(workspaceRoot, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		defaultName := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		p, ok := parseAgentPreset(string(data), rel, defaultName)
		if !ok {
			continue
		}
		reg.add(p)
		read++
	}
	return read
}

func nativeAgentsDir(family string) string {
	switch family {
	case "anthropic":
		return ".claude/agents"
	case "openai":
		return ".codex/agents"
	case "gemini":
		return ".gemini/agents"
	default:
		return ""
	}
}

func fallbackAgentsDirs(family string) []string {
	switch family {
	case "anthropic":
		return []string{".codex/agents", ".gemini/agents"}
	case "openai":
		return []string{".claude/agents", ".gemini/agents"}
	case "gemini":
		return []string{".claude/agents", ".codex/agents"}
	default:
		return []string{".claude/agents", ".codex/agents", ".gemini/agents"}
	}
}

func parseAgentPreset(text, source, defaultName string) (Preset, bool) {
	frontMatter, body, ok := splitMarkdownFrontmatter(text)
	if !ok {
		return Preset{}, false
	}
	name := defaultName
	description := ""
	var tools []string
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
			name = val
		case "description":
			description = val
		case "tools":
			tools = parsePresetTools(val)
		}
	}
	if name == "" || len(tools) == 0 {
		return Preset{}, false
	}
	origin := normalize.Origin(source)
	if origin == "" {
		origin = normalize.OriginLoom
	}
	return Preset{
		Name:           name,
		Description:    description,
		SystemPrompt:   normalize.PresetBody(origin, body),
		AllowedTools:   tools,
		AutoApprove:    nil,
		MaxTurns:       subAgentMaxTurns,
		MaxInputTokens: subAgentMaxInputTokens,
		Source:         source,
		Origin:         origin,
	}, true
}

func parsePresetTools(val string) []string {
	v := strings.NewReplacer("[", " ", "]", " ", ",", " ", "\"", " ", "'", " ").Replace(val)
	parts := strings.Fields(v)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitMarkdownFrontmatter(text string) (frontMatter, body string, ok bool) {
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

func isExternalPresetSource(source string) bool {
	return strings.HasPrefix(source, ".claude/") ||
		strings.HasPrefix(source, ".codex/") ||
		strings.HasPrefix(source, ".gemini/")
}

func researchPreset() (Preset, error) {
	prompt, err := agentprompts.Load("research")
	if err != nil {
		return Preset{}, err
	}
	return Preset{
		Name:         "research",
		Description:  "isolated read-only research; pass task, context, and optional files",
		SystemPrompt: prompt,
		AllowedTools: []string{
			"read_file",
			"list_dir",
			"search",
			"find_symbol",
			"find_references",
			"semantic_search",
			"get_diagnostics",
			"load_skill",
		},
		AutoApprove:    []string{"read_file", "list_dir", "search", "find_symbol", "find_references", "semantic_search", "get_diagnostics", "load_skill"},
		MaxTurns:       subAgentMaxTurns,
		MaxInputTokens: subAgentMaxInputTokens,
		Source:         "builtin",
		Origin:         normalize.OriginLoom,
	}, nil
}
