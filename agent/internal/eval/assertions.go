package eval

import (
	"encoding/json"
	"fmt"
	"strings"
)

func checkAssertions(s Scenario, state *runState, assistantText string) []string {
	var failures []string
	for _, a := range s.Assertions {
		if err := checkAssertion(a, state, assistantText); err != nil {
			if a.Description != "" {
				failures = append(failures, a.Description+": "+err.Error())
			} else {
				failures = append(failures, err.Error())
			}
		}
	}
	return failures
}

func checkAssertion(a Assertion, state *runState, assistantText string) error {
	switch a.Type {
	case "called_tool":
		if !state.calledTool(a.Tool) {
			return fmt.Errorf("expected tool %q to be called", a.Tool)
		}
	case "not_called_tool":
		if state.calledTool(a.Tool) {
			return fmt.Errorf("expected tool %q not to be called", a.Tool)
		}
	case "touched_file":
		if !state.touched[a.Path] {
			return fmt.Errorf("expected file %q to be touched", a.Path)
		}
	case "loaded_skill":
		if !state.loaded[a.Skill] {
			return fmt.Errorf("expected skill %q to be loaded", a.Skill)
		}
	case "assistant_contains":
		if !strings.Contains(strings.ToLower(assistantText), strings.ToLower(a.Text)) {
			return fmt.Errorf("expected assistant text to contain %q", a.Text)
		}
	case "command_called":
		if !state.calledTool("run_command") && !state.calledTool("run_command_background") {
			return fmt.Errorf("expected a command tool to be called")
		}
	case "subagent_count_at_least":
		if len(state.subagents) < a.Count {
			return fmt.Errorf("expected at least %d sub-agents, got %d", a.Count, len(state.subagents))
		}
	case "subagent_context_nontrivial":
		for _, call := range state.subagents {
			var in struct {
				Task    string `json:"task"`
				Context string `json:"context"`
			}
			if err := json.Unmarshal(call.Input, &in); err != nil {
				return fmt.Errorf("sub-agent input was not valid JSON: %w", err)
			}
			if wordCount(in.Context) < 12 || strings.EqualFold(strings.TrimSpace(in.Context), strings.TrimSpace(in.Task)) {
				return fmt.Errorf("sub-agent context is too thin: %q", in.Context)
			}
		}
	default:
		return fmt.Errorf("unknown assertion type %q", a.Type)
	}
	return nil
}

func wordCount(s string) int {
	return len(strings.Fields(s))
}
