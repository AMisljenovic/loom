---
description: Cross-compile, package per-platform VSIX, prepare a release
argument-hint: <version>
---

Prepare a release of version `$1`.

Use the `release-engineer` subagent for this work.

Steps:

1. Update `version` in `package.json` to `$1`.
2. Run `bash scripts/build-agent.sh` to cross-compile all Go targets.
3. Run `bash scripts/package.sh` to produce one VSIX per platform.
4. Verify each VSIX is under 25 MB and contains exactly one binary (its own).
5. Print a summary:
   - VSIX files produced and their sizes
   - Total artifact size
   - Anything that looks off (oversized binaries, missing platforms)
6. Do **not** run `vsce publish`. Stop after producing the artifacts and
   tell me the suggested next commands to publish to Marketplace.

If any step fails, stop and report the failure clearly with the relevant
command output.
