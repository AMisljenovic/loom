# Prompt Changelog

Reverse-chronological notes for meaningful Loom prompt-layer changes.

## 2026-05-16 - User-selected references in prompts

- Affected files: `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/loop/references.go`.
- Rationale: make file/folder references attached in the composer explicit
  starting context while preserving tool-based verification for deeper reads.
- Eval impact: prompt snapshots change; existing evals should continue to
  pass because references are only added when supplied by the UI.

## 2026-05-16 - Structured planning questions and proposed plans

- Affected files: `agent/internal/prompts/architect.md`,
  `agent/internal/tools/descriptions/ask_questions.md`,
  `agent/internal/eval/scenarios.go`.
- Rationale: replace plain-text open questions with a structured UI question
  flow, then make final Architect plans detectable as Markdown documents.
- Eval impact: adds an Architect scenario that must call `ask_questions` and
  finish with a `<proposed_plan>` block.

## 2026-05-16 - Enforce iteration summaries after tool work

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/debug.md`,
  `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/eval/scenarios.go`.
- Rationale: keep the final response from dropping what changed, what was
  verified, and what remains after multi-step tool iterations.
- Eval impact: Code and Debug scenarios now assert the final answer contains
  `Iteration summary`.

## 2026-05-16 - v0.2.0 prompt version, eval harness, and rules docs

- Affected files: `agent/internal/eval/`, `agent/cmd/eval/`,
  `agent/internal/prompts/version.go`, `docs/loomrules.md`,
  `docs/prompt-changelog.md`.
- Rationale: make prompt changes measurable and traceable across usage events.
- Eval impact: adds `npm run eval`; full provider-backed run requires API
  credentials.

## 2026-05-16 - Skills library expansion

- Affected files: `agent/internal/skills/builtin/*.md`,
  `agent/internal/skills/skills.go`.
- Rationale: make skill loading useful for Go, testing, VS Code, React,
  TypeScript, error handling, Git workflow, and performance investigation.
- Eval impact: adds a scenario expecting Go and error-handling skills before
  code changes.

## 2026-05-16 - Sub-agent briefing contract

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/architect.md`, `agent/internal/prompts/research.md`,
  `SUBAGENTS.md`.
- Rationale: make parent prompts brief research sub-agents with enough context
  and make sub-agent summaries useful to the parent.
- Eval impact: adds a scenario that checks multiple non-trivial sub-agent
  contexts.

## 2026-05-16 - Tool descriptions moved to Markdown

- Affected files: `agent/internal/tools/descriptions/*.md`,
  `agent/internal/tools/descriptions.go`, `agent/internal/tools/tools.go`.
- Rationale: keep rich model-facing tool guidance versioned beside the tools
  without burying prose in Go literals.
- Eval impact: existing tool-description tests validate files and registry
  coverage.

## 2026-05-16 - Shared output conventions

- Affected files: `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/prompts/prompts.go`, `agent/internal/loop/loop.go`.
- Rationale: give every mode the same citation, code block, brevity, and
  uncertainty rules.
- Eval impact: prompt snapshots capture the stable prefix with the shared
  conventions included.

## 2026-05-16 - Mode prompt template and rewrites

- Affected files: `agent/internal/prompts/_template.md`,
  `agent/internal/prompts/code.md`, `architect.md`, `ask.md`, `debug.md`,
  `research.md`.
- Rationale: make mode differences intentional while retaining one house style.
- Eval impact: prompt snapshots updated for all built-in modes and research.

## 2026-05-16 - Prompt snapshot baseline

- Affected files: `agent/cmd/prompt-snapshot/`,
  `docs/prompt-snapshots/*.txt`, `docs/v0.2.0/prompt-audit.md`.
- Rationale: preserve stable-prefix baselines before further prompt changes.
- Eval impact: `go -C agent run ./cmd/prompt-snapshot --out ../docs/prompt-snapshots --check`
  verifies snapshot drift.
