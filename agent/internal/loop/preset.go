package loop

import (
	"fmt"

	agentprompts "github.com/your-org/loom/internal/prompts"
)

const (
	subAgentMaxDepth       = 2
	subAgentMaxPerTurn     = 5
	subAgentMaxPerTaskTree = 30
	subAgentMaxTurns       = 30
	subAgentMaxInputTokens = int64(50000)
	taskTreeMaxInputTokens = int64(500000)
)

type Preset struct {
	Name           string
	SystemPrompt   string
	AllowedTools   []string
	AutoApprove    []string
	MaxTurns       int
	MaxInputTokens int64
}

func Presets() []Preset {
	p, err := researchPreset()
	if err != nil {
		return nil
	}
	return []Preset{p}
}

func PresetFor(name string) (Preset, error) {
	p, err := researchPreset()
	if err != nil {
		return Preset{}, err
	}
	if name == p.Name {
		return p, nil
	}
	return Preset{}, fmt.Errorf("unknown sub-agent type %q", name)
}

func researchPreset() (Preset, error) {
	prompt, err := agentprompts.Load("research")
	if err != nil {
		return Preset{}, err
	}
	return Preset{
		Name:         "research",
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
	}, nil
}
