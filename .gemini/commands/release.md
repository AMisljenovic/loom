---
description: Cross-compile, package per-platform VSIX, prepare a release
argument-hint: <version>
---

Prepare a release of version `$1`.

Use the `release-engineer` subagent for this work.

Steps:

1. Update `version` in `package.json` to `$1`.
2. `bash scripts/build-agent.sh` — cross-compile all Go targets.
3. `bash scripts/package.sh` — produce one VSIX per platform.
4. Verify each VSIX is <25 MB and contains exactly its own binary.
5. Print a summary: VSIX files + sizes, total artifact size, anything
   that looks off.
6. Do **not** run `vsce publish`. Report the suggested next commands
   to publish to Marketplace.

Stop on any failure and report it with the relevant command output.
