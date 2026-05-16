---
name: run_command_background
category: execute
requires_approval: true
---

## Purpose
Start a shell command as a background process and return immediately with a
`processId`.

## When to use
- Long-running processes: dev servers, file watchers, test runners with
  `--watch`.
- Anything whose useful output appears over time, not at exit.

## When NOT to use
- For one-shot commands that finish quickly. Use `run_command` for those —
  you get the full output back without polling.
- To replace `apply_diff`. This tool runs commands; it does not edit files
  for you.

## Input
- `command` (string, required) — the command to start.
- `cwd` (string, optional) — workspace-relative working directory. Defaults
  to the workspace root.

## Behavior
- Returns immediately with `{processId}`. The command keeps running until you
  call `kill_process` or it exits on its own.
- Output is buffered in a 256KB ring buffer per process and retained 5
  minutes after exit. Poll `read_process_output` with the returned cursor.
- The TS host owns the process; it survives across turns but not across
  extension restarts.
- Requires user approval unless the `execute` category is auto-approved.

## Examples

```json
{"command": "npm run watch"}
```

Start the TS watcher.

```json
{"command": "go test ./... -watch", "cwd": "agent"}
```

Run Go tests in watch mode from the agent directory.
