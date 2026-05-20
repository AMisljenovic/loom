package eval

func Scenarios() []Scenario {
	return []Scenario{
		{
			Name: "code-simple-edit",
			Mode: "code",
			Files: map[string]string{
				"src/greet.ts": "export function greet(name: string) {\n  return `Hello, ${name}`;\n}\n",
			},
			Prompt: "Change greet so it returns `Hi, ${name}` instead of `Hello, ${name}`.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "called_tool", Tool: "apply_diff"},
				{Type: "touched_file", Path: "src/greet.ts"},
				{Type: "assistant_contains", Text: "Iteration summary"},
			},
		},
		{
			Name: "code-multifile-refactor",
			Mode: "code",
			Files: map[string]string{
				"src/math.ts":      "export function add(a: number, b: number) { return a + b; }\n",
				"src/math.test.ts": "import { add } from './math';\nconsole.log(add(1, 2));\n",
			},
			Prompt: "Rename add to sum in the implementation and its usage.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "called_tool", Tool: "apply_diff"},
				{Type: "touched_file", Path: "src/math.ts"},
				{Type: "touched_file", Path: "src/math.test.ts"},
			},
		},
		{
			Name: "code-diff-recovery-guidance",
			Mode: "code",
			Files: map[string]string{
				"src/stale.ts": "export const label = 'alpha';\n",
			},
			Prompt: "Change src/stale.ts so label is 'gamma'. If an apply_diff exact-match edit fails, recover by reading the current file and replacing the whole file once.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "called_tool", Tool: "apply_diff"},
				{Type: "touched_file", Path: "src/stale.ts"},
			},
		},
		{
			Name: "code-go-error-handling-skill",
			Mode: "code",
			Files: map[string]string{
				"agent/internal/example/read.go": "package example\n\nfunc Read(path string) string {\n\treturn \"\"\n}\n",
				"agent/go.mod":                   "module example.test/agent\n\ngo 1.22\n",
			},
			Prompt: "In agent/internal/example/read.go, rewrite Read so it reads a file and returns useful errors instead of swallowing failures. Make the code edit now; no test addition is needed for this eval fixture.",
			Assertions: []Assertion{
				{Type: "loaded_skill", Skill: "error-handling"},
				{Type: "called_tool", Tool: "apply_diff"},
			},
		},
		{
			Name: "architect-design-plan",
			Mode: "architect",
			Files: map[string]string{
				"src/session.ts": "export interface Session { id: string; messages: string[] }\n",
			},
			Prompt: "Plan how to add archived sessions. Do not edit files.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "not_called_tool", Tool: "apply_diff"},
				{Type: "assistant_contains", Text: "plan"},
			},
		},
		{
			Name: "architect-refactor-proposal",
			Mode: "architect",
			Files: map[string]string{
				"src/tools/index.ts": "export async function runTool(name: string) { return name; }\n",
			},
			Prompt: "Propose a refactor that separates tool validation from execution.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "not_called_tool", Tool: "run_command"},
			},
		},
		{
			Name: "architect-questions-before-plan",
			Mode: "architect",
			Files: map[string]string{
				"README.md": "Legacy calculator demo with no audience guidance yet.\n",
			},
			Prompt: "Plan a README rewrite, but the audience and positioning are undecided. Ask me the necessary questions first, then produce the final plan after I answer.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "ask_questions"},
				{Type: "assistant_contains", Text: "<proposed_plan>"},
			},
		},
		{
			Name: "ask-code-explanation",
			Mode: "ask",
			Files: map[string]string{
				"src/shared/modeIntent.ts": "export function detectModeSwitchIntent(value: string) { return value.startsWith('/'); }\n",
			},
			Prompt: "Explain what modeIntent.ts is responsible for.",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "not_called_tool", Tool: "apply_diff"},
			},
		},
		{
			Name: "ask-where-handled",
			Mode: "ask",
			Files: map[string]string{
				"src/panel/ChatPanel.ts": "export class ChatPanel { handleUsage() {} }\n",
				"src/agentClient.ts":     "export class AgentClient { startTask() {} }\n",
			},
			Prompt: "Where is token usage handled?",
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "search"},
				{Type: "assistant_contains", Text: "ChatPanel"},
			},
		},
		{
			Name: "debug-failing-test",
			Mode: "debug",
			Files: map[string]string{
				"package.json":     "{\"scripts\":{\"test\":\"vitest run\"}}\n",
				"src/calc.ts":      "export const divide = (a: number, b: number) => a / b;\n",
				"src/calc.test.ts": "import { divide } from './calc';\nif (divide(1, 0) !== 0) throw new Error('expected zero');\n",
			},
			Prompt: "The divide test is failing. Diagnose and fix it.",
			CommandResults: []ScriptedCommand{
				{Command: "npm test -- --runInBand", Output: "FAIL src/calc.test.ts expected zero\n"},
				{Command: "npm test -- --runInBand", Output: "PASS src/calc.test.ts\n"},
				{Command: "npm test", Output: "FAIL src/calc.test.ts expected zero\n"},
				{Command: "npm test", Output: "PASS src/calc.test.ts\n"},
				{Command: "npm run test", Output: "FAIL src/calc.test.ts expected zero\n"},
				{Command: "npm run test", Output: "PASS src/calc.test.ts\n"},
				{Command: "npx vitest run", Output: "FAIL src/calc.test.ts expected zero\n"},
				{Command: "npx vitest run", Output: "PASS src/calc.test.ts\n"},
				{Command: "npx vitest run --reporter verbose", Output: "FAIL src/calc.test.ts expected zero\n"},
				{Command: "npx vitest run --reporter verbose", Output: "PASS src/calc.test.ts\n"},
			},
			Assertions: []Assertion{
				{Type: "command_called"},
				{Type: "called_tool", Tool: "apply_diff"},
				{Type: "assistant_contains", Text: "Iteration summary"},
			},
		},
		{
			Name: "debug-runtime-error",
			Mode: "debug",
			Files: map[string]string{
				"package.json":       "{\"scripts\":{\"test\":\"vitest run\"},\"devDependencies\":{\"vitest\":\"latest\"}}\n",
				"src/config.ts":      "export function port(value?: string) { return Number(value); }\n",
				"src/config.test.ts": "import { describe, expect, it } from 'vitest';\nimport { port } from './config';\n\ndescribe('port', () => {\n  it('defaults missing PORT to 3000', () => {\n    expect(port()).toBe(3000);\n  });\n});\n",
			},
			Prompt: "npm test is failing because missing PORT leads to NaN at runtime. Reproduce it, then patch the parser so missing PORT defaults to 3000.",
			CommandResults: []ScriptedCommand{
				{Command: "npm test", Output: "FAIL src/config.test.ts > port > defaults missing PORT to 3000\nexpected NaN to be 3000\n"},
				{Command: "npm test", Output: "PASS src/config.test.ts\n"},
				{Command: "npm run test", Output: "FAIL src/config.test.ts > port > defaults missing PORT to 3000\nexpected NaN to be 3000\n"},
				{Command: "npm run test", Output: "PASS src/config.test.ts\n"},
				{Command: "npx vitest run", Output: "FAIL src/config.test.ts > port > defaults missing PORT to 3000\nexpected NaN to be 3000\n"},
				{Command: "npx vitest run", Output: "PASS src/config.test.ts\n"},
			},
			Assertions: []Assertion{
				{Type: "called_tool", Tool: "read_file"},
				{Type: "called_tool", Tool: "apply_diff"},
			},
		},
		{
			Name: "research-subagent-briefing",
			Mode: "code",
			Files: map[string]string{
				"src/auth.ts":    "export function authenticate() { return true; }\n",
				"src/session.ts": "export function loadSession() { return null; }\n",
			},
			Prompt: "Use two research sub-agents in parallel: one should find the auth logic, and the other should find the session logic. Brief each with the parent goal and what to return, then summarize the split.",
			Assertions: []Assertion{
				{Type: "subagent_count_at_least", Count: 2},
				{Type: "subagent_context_nontrivial"},
			},
		},
		{
			Name: "code-proactive-subagent-survey",
			Mode: "code",
			Files: map[string]string{
				"src/panel/ChatPanel.ts":               "export function postMessage() { return 'host'; }\n",
				"webview-ui/src/App.tsx":               "export function handleMessage() { return 'webview'; }\n",
				"webview-ui/src/components/Thread.tsx": "export function Thread() { return null; }\n",
				"webview-ui/src/util/activity.ts":      "export function label() { return 'activity'; }\n",
				"src/shared/protocol.ts":               "export interface Msg { role: string }\n",
			},
			Prompt: "Investigate how transcript messages flow from the extension host into the webview before changing anything. Summarize the relevant files and responsibilities; do not edit yet.",
			Assertions: []Assertion{
				{Type: "subagent_count_at_least", Count: 1},
				{Type: "subagent_context_nontrivial"},
			},
		},
	}
}

func ScenarioByName(name string) (Scenario, bool) {
	for _, s := range Scenarios() {
		if s.Name == name {
			return s, true
		}
	}
	return Scenario{}, false
}
