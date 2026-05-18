---
name: spawn_subagent
category: subtasks
requires_approval: false
---

## Purpose
Delegate focused read-only research to a fresh sub-agent with isolated
context.

Sub-agents have a ~50k-token input budget and ~30-turn cap. Broad tasks will
fail with `input token budget exceeded`. Brief with: (1) a single concrete
question, (2) exact files or symbols to start from, (3) a stopping condition.
Do not re-spawn after a truncation with the same task; narrow it first.

## Delegate narrow, terminating questions
Spawn a sub-agent only for a bounded survey of an unfamiliar area that would
otherwise take a long serial chain of reads. Prefer one well-scoped sub-agent
over several broad ones.

## When to use
- You want to keep your main context focused while side investigations happen.
- The investigation is well-scoped enough to brief in a few sentences.

## When NOT to use
- For looking up a single known fact in a single known file; call `read_file`.
- For tasks that require writing, running commands, or spawning further
  sub-agents.
- For ambiguous goals. A vague `context` produces a vague summary.

## Input
- `type` (string, required) - the sub-agent preset to use. `"research"` is
  always available; workspaces may import additional presets.
- `task` (string, required) - the specific question the sub-agent must answer.
- `context` (string, required) - parent goal, known facts, what to find, and
  what to return. The sub-agent has no memory of this conversation.
- `files` (array of strings, optional) - starting file paths the sub-agent
  should read first.

## Behavior
- The sub-agent runs in an isolated conversation with the preset's tool
  allowlist. It returns a structured summary.
- Multiple `spawn_subagent` calls in the same turn run concurrently up to the
  per-turn limit.
- Sub-agents cannot spawn more sub-agents.

## Example

```json
{
  "type": "research",
  "task": "Locate every place auth tokens are persisted.",
  "context": "Parent goal: rotate token-storage encryption. I know src/auth/ holds the main flow. Find other token reads/writes and return file paths plus evidence.",
  "files": ["src/auth/store.ts"]
}
```

If this returns truncated, narrow the next task to one file, symbol, or call
chain instead of repeating the same request.
