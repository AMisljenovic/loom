---
name: spawn_subagent
category: subtasks
requires_approval: false
---

## Purpose
Delegate focused read-only research to a fresh sub-agent with isolated
context.

## Delegate by default for multi-file surveys
Spawn a sub-agent whenever an answer requires reading more than ~2 files,
mapping an unfamiliar area, or holding intermediate notes you don't want
sitting in the parent context. Multiple `spawn_subagent` calls in the same
turn run **in parallel** (cap 8) — prefer parallel sub-agents over a long
serial chain of reads.

## When to use
- A question requires reading several files or surveying an unfamiliar area
  before you can answer.
- You want to keep your main context window focused while side
  investigations happen.
- The investigation is well-scoped enough to brief in a few sentences.

## When NOT to use
- For looking up a single known fact in a single known file — call
  `read_file` directly.
- For tasks that require writing, running commands, or spawning further
  sub-agents (sub-agents are read-only and cannot nest).
- For ambiguous goals. A vague `context` produces a vague summary.

## Input
- `type` (string, required) — currently only `"research"`.
- `task` (string, required) — the specific question the sub-agent must
  answer.
- `context` (string, required) — what the sub-agent needs to know to start:
  (1) the parent goal, (2) what you already know that the sub-agent shouldn't
  re-derive, (3) what specifically to find and return. The sub-agent has no
  memory of this conversation; the context is its only inheritance.
- `files` (array of strings, optional) — starting file paths the sub-agent
  should read first.

## Behavior
- The sub-agent runs in an isolated conversation with a read-only tool
  allowlist. It returns a structured summary (Answer / Evidence / Unverified).
- Multiple `spawn_subagent` calls in the same turn run concurrently (cap 8).
- Sub-agents cannot spawn more sub-agents.
- Per-turn limit is enforced; do not assume unlimited parallelism.

## Examples

```json
{
  "type": "research",
  "task": "Locate every place auth tokens are persisted.",
  "context": "Parent goal: rotate token-storage encryption. I know src/auth/ holds the main flow. Find every other place tokens are read or written, including tests.",
  "files": ["src/auth/store.ts"]
}
```

Two more `spawn_subagent` calls in the same turn — one for "find all callers
of refreshToken" and one for "summarize how cookies are set" — would run
concurrently with the above.
