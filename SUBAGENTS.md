# Sub-agents

Loom can spawn isolated sub-agents through the `spawn_subagent` tool. They
share the agent loop and tool infrastructure but run in their own conversation
with no inheritance from the parent's history.

This document covers what sub-agents are good for, how to brief them, and how
their return value is structured. The implementation lives in
[agent/internal/loop/](agent/internal/loop/) (preset registry and spawn
handler).

## When to spawn one

A `spawn_subagent` call is worth the overhead when:

- The question requires a bounded survey of an unfamiliar area.
- You want to keep your main context focused while a side investigation
  happens.
- The investigation is well-scoped enough to brief in a few sentences.

It is not worth the overhead for:

- Single-file reads or trivial lookups; call the tool directly.
- Tasks that require spawning further sub-agents.
- Ambiguous goals; a vague `context` produces a vague summary.

## Presets

The built-in presets are `research` and `review`. `research` is for bounded
discovery; `review` is for read-only implementation critique and returns
actionable findings for the parent agent. Their system prompts live in
[agent/internal/prompts/](agent/internal/prompts/); both use the same read-only
tool allowlist (file reads, search, diagnostics, skills). The preset registry
is [agent/internal/loop/preset.go](agent/internal/loop/preset.go).

Additional presets may be imported from `.loom/agents/*.md`. Workspace presets
override built-ins with the same name. Imported presets trust their `tools:`
field as written, but write tools still go through the standard approval flow.

## Briefing sub-agents

The parent's `context` field is the sub-agent's only inheritance. It must
include three things:

1. **What the parent is trying to accomplish.** The end goal, not just the
   immediate question. Without this, the sub-agent cannot tell what counts as a
   useful answer.
2. **What you already know.** Findings from the conversation so far that the
   sub-agent should not re-derive.
3. **What specifically to find and return.** The question, framed concretely.
   "Survey the auth code" is too broad; "list every place auth tokens are read
   or written, including tests" is brief-able.

Anti-pattern: dumping the entire prior conversation into `context`. The
briefing should be focused, not exhaustive.

Example brief:

```json
{
  "type": "research",
  "task": "List every place auth tokens are read or written.",
  "context": "Parent goal: rotate token-storage encryption in src/auth/store.ts. I already know that store.ts holds the main read/write path and that tests in src/auth/store.test.ts cover the happy path. Find every OTHER place tokens are touched, including helpers, middleware, telemetry, and any tests that mock the store directly.",
  "files": ["src/auth/store.ts"]
}
```

## Return contract

The sub-agent's summary is the main artifact the parent sees. The built-in
`research` prompt structures it as:

1. **Answer** - the direct response in two or three sentences.
2. **Evidence** - file paths with line numbers backing the answer.
3. **Unverified** - anything the sub-agent could not check, and why.

The built-in `review` prompt structures it as:

1. **Findings** - concrete issues ordered by severity, or `No findings`.
2. **Evidence** - file paths with line numbers backing each finding.
3. **Test Gaps** - missing or weak verification that matters for the change.
4. **Unverified** - anything it could not check, and why.

The full return value to the parent is a JSON object:

```json
{
  "summary": "<Markdown summary above>",
  "files_touched": ["path/a", "path/b"],
  "tool_calls": 12,
  "tokens_used": 3400,
  "truncated": false,
  "truncation_reason": ""
}
```

`truncated: true` indicates the sub-agent hit its turn or token budget before
finishing. The summary is prepended with recovery guidance; narrow the next task
instead of retrying the same broad request.

## Limits

Enforced atomically in `TaskRegistry.Register`. Do not re-introduce pre-checks
outside the registry.

| Limit | Value | Source |
|-------|-------|--------|
| Per-turn spawn cap (parent) | 3 | `subAgentMaxPerTurn` in [preset.go](agent/internal/loop/preset.go) |
| Tree depth | 2 | `subAgentMaxDepth` |
| Total sub-agents in a task tree | 30 | `subAgentMaxPerTaskTree` |
| Sub-agent turn cap | 45 | `subAgentMaxTurns` |
| Sub-agent input-token cap | 100,000 | `subAgentMaxInputTokens` |
| Task-tree input-token cap | 500,000 | `taskTreeMaxInputTokens` |
| Errgroup concurrency cap | 8 | shared with regular parallel tools |

Multiple `spawn_subagent` calls in the same turn run concurrently up to the
per-turn spawn cap, and they also overlap with other independent tools emitted
in that same model turn. The parent receives sub-agent summaries as tool
results, so its next model turn waits for the current tool batch to finish.
Sub-agents cannot spawn further sub-agents.

## See also

- [agent/internal/prompts/research.md](agent/internal/prompts/research.md) - the sub-agent system prompt
- [agent/internal/prompts/review.md](agent/internal/prompts/review.md) - the review sub-agent system prompt
- [agent/internal/tools/descriptions/spawn_subagent.md](agent/internal/tools/descriptions/spawn_subagent.md) - the parent-side tool description
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) - repo-wide architecture invariants for sub-agents
