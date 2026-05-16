---
name: read_process_output
category: read
requires_approval: false
---

## Purpose
Read accumulated stdout/stderr from a background process started with
`run_command_background`.

## When to use
- After starting a background process, to see what it printed.
- Periodically, to monitor whether a watcher is still healthy.
- To capture the output of a long-running test or build.

## When NOT to use
- For processes you did not start. There is no way to attach to arbitrary PIDs.
- As a substitute for `run_command` for one-shot commands.

## Input
- `processId` (string, required) — the id returned by
  `run_command_background`.
- `sinceCursor` (number, optional) — opaque cursor from a previous read.
  Returns only new output past that point. Omit for the first read.
- `maxBytes` (number, optional) — cap on returned bytes. Defaults to a
  reasonable size.

## Behavior
- Returns `{output, cursor, exited}`. `cursor` is opaque — pass it back to
  the next call. `exited` is true once the process has terminated.
- The ring buffer holds the last 256KB of combined stdout/stderr. Earlier
  output is dropped. Read often if the process is chatty.
- Output is retained for 5 minutes after the process exits, then garbage
  collected.

## Examples

```json
{"processId": "p-abc"}
```

First read for a process.

```json
{"processId": "p-abc", "sinceCursor": 4096}
```

Incremental read using the cursor from the previous call.
