---
name: run_command
category: execute
requires_approval: true
---

## Purpose
Run a short, blocking shell command in the workspace terminal.

## When to use
- Run tests (`go test ./...`, `npx vitest run`).
- Run a build or linter (`npm run build`, `go vet ./...`).
- Quick scripts that finish within ~120 seconds.

## When NOT to use
- For long-running processes (dev servers, watchers, REPLs). Use
  `run_command_background` and poll `read_process_output` instead.
- To "see what happens" — be deliberate about which command and why; the user
  approves each one unless `execute` is auto-approved.

## Input
- `command` (string, required) — the exact command to run. No shell
  interpolation is done by the agent; the user's shell handles it.

## Behavior
- Blocks until the command exits or 120 seconds elapse (whichever is first).
  A timeout returns the partial output and a non-zero exit code.
- Exit code, stdout, and stderr are returned together. Read stderr — error
  messages often live there.
- Runs in the workspace root unless the user's shell config changes that.
- Requires user approval unless the `execute` category is auto-approved.

## Examples

```json
{"command": "go test ./..."}
```

Run Go tests.

```json
{"command": "npm run build"}
```

Build the extension.
