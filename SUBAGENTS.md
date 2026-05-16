# Sub-agents

Loom can spawn isolated read-only sub-agents through the `spawn_subagent`
tool. They share the agent loop and tool infrastructure but run in their own
conversation with no inheritance from the parent's history.

This document covers what sub-agents are good for, how to brief them, and
how their return value is structured. The implementation lives in
[agent/internal/loop/](agent/internal/loop/) (preset, registry, spawn handler).

## When to spawn one

A `spawn_subagent` call is worth the overhead when:

- The question requires reading multiple files or surveying an unfamiliar
  area before you can answer.
- You want to keep your main context window focused while a side
  investigation happens.
- The investigation is well-scoped enough to brief in a few sentences.

It is NOT worth the overhead for:

- Single-file reads or trivial lookups — call the tool directly.
- Tasks that require writing, running commands, or spawning further
  sub-agents (sub-agents are read-only and cannot nest).
- Ambiguous goals — a vague `context` produces a vague summary.

## Presets

The only built-in preset is `research`. Its system prompt is
[agent/internal/prompts/research.md](agent/internal/prompts/research.md);
its tool allowlist is read-only (file reads, search, diagnostics, skills).
The preset registry is [agent/internal/loop/preset.go](agent/internal/loop/preset.go);
do not add new presets without updating this document and the eval suite.

## Briefing sub-agents

The parent's `context` field is the sub-agent's only inheritance. It must
include three things:

1. **What the parent is trying to accomplish.** The end goal, not just the
   immediate question. Without this, the sub-agent cannot tell what counts
   as a useful answer.
2. **What you already know.** Findings from the conversation so far that the
   sub-agent should not re-derive. Skip this and the sub-agent will redo
   work you already paid for.
3. **What specifically to find and return.** The question, framed
   concretely. "Survey the auth code" is too broad; "list every place auth
   tokens are read or written, including tests" is brief-able.

Anti-pattern: dumping the entire prior conversation into `context`. The
briefing should be focused, not exhaustive. If the brief is longer than the
expected answer, the parent has not done enough thinking yet.

Example brief:

```json
{
  "type": "research",
  "task": "List every place auth tokens are read or written.",
  "context": "Parent goal: rotate token-storage encryption in src/auth/store.ts. I already know that store.ts holds the main read/write path and that tests in src/auth/store.test.ts cover the happy path. Find every OTHER place tokens are touched — including helpers, middleware, telemetry, and any tests that mock the store directly.",
  "files": ["src/auth/store.ts"]
}
```

## Return contract

The sub-agent's summary is the only artifact the parent sees. It is
structured as three Markdown sections in this order:

1. **Answer** — the direct response in two or three sentences.
2. **Evidence** — file paths with line numbers backing the answer.
3. **Unverified** — anything the sub-agent could not check, and why.

This contract lives in `research.md` and is also enforced by the parent's
prompt guidance. If a sub-agent returns prose without this structure, the
prompt is drifting and should be tightened.

The full return value to the parent is a JSON object:

```
{
  "summary": "<Markdown summary above>",
  "filesTouched": ["path/a", "path/b"],
  "toolCalls": 12,
  "tokensUsed": 3400,
  "truncated": false
}
```

`truncated: true` indicates the sub-agent hit its turn or token budget
before finishing. Treat that summary as incomplete.

## Limits

Enforced atomically in `TaskRegistry.Register`. Do not re-introduce
pre-checks outside the registry.

| Limit | Value | Source |
|-------|-------|--------|
| Per-turn spawn cap (parent) | 5 | `subAgentMaxPerTurn` in [preset.go](agent/internal/loop/preset.go) |
| Tree depth | 2 | `subAgentMaxDepth` |
| Total sub-agents in a task tree | 30 | `subAgentMaxPerTaskTree` |
| Sub-agent turn cap | 30 | `subAgentMaxTurns` |
| Sub-agent input-token cap | 50,000 | `subAgentMaxInputTokens` |
| Task-tree input-token cap | 500,000 | `taskTreeMaxInputTokens` |
| Errgroup concurrency cap | 8 | shared with regular parallel tools |

Multiple `spawn_subagent` calls in the same turn run concurrently (`errgroup`
cap 8). Sub-agents cannot spawn further sub-agents.

## See also

- [agent/internal/prompts/research.md](agent/internal/prompts/research.md) — the sub-agent system prompt
- [agent/internal/tools/descriptions/spawn_subagent.md](agent/internal/tools/descriptions/spawn_subagent.md) — the parent-side tool description
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — repo-wide architecture invariants for sub-agents
