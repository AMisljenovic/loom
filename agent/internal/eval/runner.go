package eval

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/loop"
	"github.com/your-org/loom/internal/rules"
	"github.com/your-org/loom/internal/skills"
	"github.com/your-org/loom/internal/tools"
)

type Runner struct {
	Provider llm.Provider
	Options  Options
}

type runState struct {
	root        string
	commands    map[string][]string
	toolCalls   []RecordedToolCall
	touched     map[string]bool
	loaded      map[string]bool
	subagents   []RecordedToolCall
	transcript  []llm.Message
	lastSummary string
}

func (s *runState) calledTool(name string) bool {
	for _, c := range s.toolCalls {
		if c.Name == name {
			return true
		}
	}
	return false
}

func (r Runner) Run(ctx context.Context, s Scenario) (RunResult, error) {
	if r.Provider == nil {
		return RunResult{}, errors.New("eval runner requires an LLM provider")
	}
	started := time.Now()
	root, err := os.MkdirTemp("", "loom-eval-*")
	if err != nil {
		return RunResult{}, err
	}
	if err := writeScenarioFiles(root, s.Files); err != nil {
		return RunResult{}, err
	}
	state := &runState{
		root:       root,
		commands:   commandMap(s.CommandResults),
		touched:    map[string]bool{},
		loaded:     map[string]bool{},
		transcript: []llm.Message{{Role: llm.RoleUser, Content: s.Prompt}},
	}

	mode := modeDefinition(s.Mode)
	registry := loop.ApplyMode(evalRegistry(), &mode)
	toolDefs := toolDefs(registry)
	family := r.Provider.Family()
	cat := skills.Load(root, family)
	presetRegistry := loop.LoadPresets(root, family)
	bundle := rules.Load(root, family)
	stable := loop.BuildStableSystem(&mode, registry, cat, presetRegistry.All())
	maxTurns := r.Options.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 10
	}

	for turn := 0; turn < maxTurns; turn++ {
		volatile := loop.BuildVolatileSystem(root, cat, sortedMapKeys(state.loaded), bundle)
		h := &captureHandler{}
		result, err := r.Provider.Stream(ctx, llm.SystemPrompt{Stable: stable, Volatile: volatile}, state.transcript, toolDefs, h)
		assistantText, calls := h.finish()
		if err != nil {
			return RunResult{}, fmt.Errorf("stream turn %d: %w", turn+1, err)
		}
		state.lastSummary += assistantText
		state.transcript = append(state.transcript, llm.Message{Role: llm.RoleAssistant, Content: assistantText, ToolCalls: calls})
		if result.StopReason != "tool_calls" || len(calls) == 0 {
			break
		}
		for _, call := range calls {
			raw := append(json.RawMessage(nil), call.Input...)
			state.toolCalls = append(state.toolCalls, RecordedToolCall{Name: call.Name, Input: raw})
			out := executeTool(state, call)
			state.transcript = append(state.transcript, llm.Message{Role: llm.RoleTool, Content: out, ToolCallID: call.ID})
		}
	}

	failures := checkAssertions(s, state, state.lastSummary)
	path := writeTranscript(root, transcript{
		Scenario:     s.Name,
		Mode:         s.Mode,
		StartedAt:    started,
		SystemStable: stable,
		SystemTail:   loop.BuildVolatileSystem(root, cat, sortedMapKeys(state.loaded), bundle),
		Messages:     state.transcript,
		ToolCalls:    state.toolCalls,
		Failures:     failures,
	})
	return RunResult{
		Name:           s.Name,
		Passed:         len(failures) == 0,
		DurationMillis: time.Since(started).Milliseconds(),
		TranscriptPath: path,
		Failures:       failures,
		ToolCalls:      state.toolCalls,
		LoadedSkills:   sortedMapKeys(state.loaded),
		TouchedFiles:   sortedMapKeys(state.touched),
		AssistantText:  strings.TrimSpace(state.lastSummary),
	}, nil
}

func executeTool(state *runState, call llm.ToolCall) string {
	switch call.Name {
	case "read_file":
		var in struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		b, err := os.ReadFile(filepath.Join(state.root, filepath.FromSlash(in.Path)))
		if err != nil {
			return "error: " + err.Error()
		}
		return string(b)
	case "list_dir":
		var in struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		entries, err := os.ReadDir(filepath.Join(state.root, filepath.FromSlash(in.Path)))
		if err != nil {
			return "error: " + err.Error()
		}
		var b strings.Builder
		for _, e := range entries {
			kind := "file"
			if e.IsDir() {
				kind = "dir"
			}
			fmt.Fprintf(&b, "%s\t%s\n", kind, e.Name())
		}
		return b.String()
	case "search":
		var in tools.SearchInput
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		out, err := tools.Search(state.root, in)
		if err != nil {
			return "error: " + err.Error()
		}
		return out
	case "apply_diff":
		return applyEvalDiff(state, call.Input)
	case "run_command", "run_command_background":
		var in struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		if outs, ok := state.commands[in.Command]; ok && len(outs) > 0 {
			if len(state.touched) > 0 {
				for _, out := range outs {
					if strings.HasPrefix(strings.TrimSpace(out), "PASS") {
						return out
					}
				}
			}
			out := outs[0]
			if len(outs) > 1 {
				state.commands[in.Command] = outs[1:]
			}
			return out
		}
		return "error: command not scripted for eval: " + in.Command
	case "get_diagnostics":
		return "[]"
	case "update_todos":
		return "updated todos"
	case "read_process_output":
		return "process exited; no buffered output"
	case "kill_process":
		return "process killed"
	case "load_skill":
		var in struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		for _, id := range in.IDs {
			if strings.TrimSpace(id) != "" {
				state.loaded[strings.TrimSpace(id)] = true
			}
		}
		return "loaded skills: " + strings.Join(in.IDs, ", ")
	case "ask_questions":
		var in struct {
			Title     string `json:"title"`
			Questions []struct {
				ID       string `json:"id"`
				Question string `json:"question"`
				Kind     string `json:"kind"`
				Options  []struct {
					ID          string `json:"id"`
					Label       string `json:"label"`
					Description string `json:"description"`
				} `json:"options"`
			} `json:"questions"`
		}
		if err := json.Unmarshal(call.Input, &in); err != nil {
			return "error: " + err.Error()
		}
		type answer struct {
			QuestionID        string   `json:"questionId"`
			Question          string   `json:"question"`
			SelectedOptionIDs []string `json:"selectedOptionIds"`
			SelectedLabels    []string `json:"selectedLabels"`
		}
		var answers []answer
		for _, q := range in.Questions {
			a := answer{QuestionID: q.ID, Question: q.Question}
			if len(q.Options) > 0 {
				a.SelectedOptionIDs = []string{q.Options[0].ID}
				a.SelectedLabels = []string{q.Options[0].Label}
			}
			answers = append(answers, a)
		}
		b, err := json.Marshal(map[string]any{
			"title":   in.Title,
			"answers": answers,
		})
		if err != nil {
			return "error: " + err.Error()
		}
		return string(b)
	case "spawn_subagent":
		state.subagents = append(state.subagents, RecordedToolCall{Name: call.Name, Input: append(json.RawMessage(nil), call.Input...)})
		return `{"summary":"Direct answer: the requested area was inspected. Evidence: see the files named in the task/context. Could not verify anything outside this eval workspace.","files_touched":[],"tool_calls":0,"tokens_used":0,"truncated":false}`
	default:
		return "error: eval does not execute tool " + call.Name
	}
}

func applyEvalDiff(state *runState, raw json.RawMessage) string {
	var in struct {
		Path  string `json:"path"`
		Edits []struct {
			OldText string `json:"oldText"`
			NewText string `json:"newText"`
		} `json:"edits"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "error: " + err.Error()
	}
	if in.Path == "" || len(in.Edits) == 0 {
		return "error: apply_diff requires path and edits"
	}
	path := filepath.Join(state.root, filepath.FromSlash(in.Path))
	beforeBytes, err := os.ReadFile(path)
	if err != nil {
		if len(in.Edits) == 1 && in.Edits[0].OldText == "" {
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				return "error: " + err.Error()
			}
			if err := os.WriteFile(path, []byte(in.Edits[0].NewText), 0o644); err != nil {
				return "error: " + err.Error()
			}
			state.touched[in.Path] = true
			return "created " + in.Path
		}
		return "error: " + err.Error()
	}
	after := string(beforeBytes)
	for i, edit := range in.Edits {
		if edit.OldText == "" {
			return fmt.Sprintf("error: edit %d oldText must not be empty for existing files", i+1)
		}
		if count := strings.Count(after, edit.OldText); count != 1 {
			return fmt.Sprintf("error: edit %d oldText matched %d times\nRecovery: call read_file for the same path, then call apply_diff once with oldText set to the full current file contents and newText set to the full desired file contents.\nPath: %s", i+1, count, in.Path)
		}
		after = strings.Replace(after, edit.OldText, edit.NewText, 1)
	}
	if err := os.WriteFile(path, []byte(after), 0o644); err != nil {
		return "error: " + err.Error()
	}
	state.touched[in.Path] = true
	return "applied diff to " + in.Path
}

type captureHandler struct {
	text  strings.Builder
	calls []llm.ToolCall
}

func (h *captureHandler) OnTextDelta(text string) {
	h.text.WriteString(text)
}

func (h *captureHandler) OnToolUse(call llm.ToolCall) {
	h.calls = append(h.calls, call)
}

func (h *captureHandler) finish() (string, []llm.ToolCall) {
	return h.text.String(), h.calls
}

func writeScenarioFiles(root string, files map[string]string) error {
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeTranscript(root string, t transcript) string {
	path := filepath.Join(root, "transcript.json")
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return ""
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return ""
	}
	return path
}

func commandMap(commands []ScriptedCommand) map[string][]string {
	out := make(map[string][]string, len(commands))
	for _, c := range commands {
		out[c.Command] = append(out[c.Command], c.Output)
	}
	return out
}

func sortedMapKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func evalRegistry() []tools.Tool {
	return append(tools.Registry(), tools.IndexTools(nil)...)
}

func toolDefs(registry []tools.Tool) []llm.ToolDef {
	defs := make([]llm.ToolDef, 0, len(registry))
	for _, t := range registry {
		defs = append(defs, llm.ToolDef{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema})
	}
	return defs
}

func modeDefinition(id string) loop.ModeDefinition {
	switch id {
	case "architect":
		return loop.ModeDefinition{ID: "architect", Label: "Architect", ToolDenylist: []string{"apply_diff", "run_command", "run_command_background", "kill_process"}}
	case "ask":
		return loop.ModeDefinition{ID: "ask", Label: "Ask", ToolAllowlist: []string{"read_file", "list_dir", "search", "find_symbol", "find_references", "semantic_search", "get_diagnostics", "load_skill", "ask_questions", "spawn_subagent"}}
	case "debug":
		return loop.ModeDefinition{ID: "debug", Label: "Debug"}
	default:
		return loop.ModeDefinition{ID: "code", Label: "Code"}
	}
}
