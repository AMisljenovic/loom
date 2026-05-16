package eval

import (
	"encoding/json"
	"time"

	"github.com/your-org/loom/internal/llm"
)

// Scenario describes one prompt-regression case. Scenarios score observable
// behavior such as tool use and touched files, not exact assistant prose.
type Scenario struct {
	Name           string
	Mode           string
	Files          map[string]string
	Prompt         string
	CommandResults []ScriptedCommand
	Assertions     []Assertion
}

// ScriptedCommand is the deterministic output for a run_command call.
type ScriptedCommand struct {
	Command string
	Output  string
}

// Assertion is one behavioral expectation checked after a scenario run.
type Assertion struct {
	Type        string
	Tool        string
	Path        string
	Skill       string
	Text        string
	Count       int
	Description string
}

type Options struct {
	MaxTurns int
}

// RunResult is the stable, serializable result for a scenario.
type RunResult struct {
	Name           string             `json:"name"`
	Passed         bool               `json:"passed"`
	DurationMillis int64              `json:"durationMillis"`
	TranscriptPath string             `json:"transcriptPath"`
	Failures       []string           `json:"failures,omitempty"`
	ToolCalls      []RecordedToolCall `json:"toolCalls,omitempty"`
	LoadedSkills   []string           `json:"loadedSkills,omitempty"`
	TouchedFiles   []string           `json:"touchedFiles,omitempty"`
	AssistantText  string             `json:"assistantText,omitempty"`
}

type RecordedToolCall struct {
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type transcript struct {
	Scenario     string             `json:"scenario"`
	Mode         string             `json:"mode"`
	StartedAt    time.Time          `json:"startedAt"`
	SystemStable string             `json:"systemStable"`
	SystemTail   string             `json:"systemTail"`
	Messages     []llm.Message      `json:"messages"`
	ToolCalls    []RecordedToolCall `json:"toolCalls"`
	Failures     []string           `json:"failures,omitempty"`
}
