---
name: build-check
description: Run the full Loom build + tests + go vet, report the first failure without auto-fixing.
argument-hint: optional area to focus on (ts, go, webview)
---
Run Loom's standard build verification in this order, stopping at the first failure: $ARGUMENTS

Steps:
1. `run_command` → `npm run test:ts` (vitest, fastest signal).
2. `run_command` → `npm run build` (TS extension + webview + Go agent cross-compile for host).
3. From `agent/`: `run_command` → `go test ./...`.
4. From `agent/`: `run_command` → `go vet ./...`.

On any failure:
- Report the failing step, the exact error excerpt, and the file:line if available.
- Do NOT edit code to "fix" the failure unless the user explicitly asks. Surfacing the failure is the whole job.
- If the failure looks like a flake (network, port, stale binary), say so and suggest a rerun rather than diagnosing.

On full success:
- Print one line per step with elapsed time and "ok".
- No prose summary needed.

Rules:
- `run_command` is one-shot, ≤120 s. If `go test` looks like it will exceed that on a slow box, switch to `run_command_background` and poll with `read_process_output`.
- Never run `npm install` or `go mod tidy` as part of this check; those are deliberate actions.
