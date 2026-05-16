---
name: kill_process
category: execute
requires_approval: true
---

## Purpose
Terminate a background process started with `run_command_background`.

## When to use
- You are done with a watcher or dev server and want to free its resources.
- The user asked you to stop a running process.
- A background process is hanging or producing unbounded output.

## When NOT to use
- To kill arbitrary system processes. Only background processes you (or the
  user) started through this agent are reachable.
- To restart a process — kill, then call `run_command_background` again.

## Input
- `processId` (string, required) — the id returned by
  `run_command_background`.

## Behavior
- Sends a terminate signal; the process may take a moment to exit. Subsequent
  `read_process_output` calls will eventually report `exited: true`.
- Killing a process you do not own (wrong id) returns an error.
- Requires user approval unless the `execute` category is auto-approved.

## Examples

```json
{"processId": "p-abc"}
```

Stop the process with id `p-abc`.
