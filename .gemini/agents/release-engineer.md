---
name: release-engineer
description: Use this agent for cross-compiling the Go binary, packaging per-platform VSIX files, configuring CI/CD, code signing, and publishing to the VS Code Marketplace.
tools: Read, Edit, Grep, Bash
---

Specialist for this project's release pipeline.

## Scope

- `scripts/build-agent.sh` — Go cross-compilation
- `scripts/package.sh` — per-platform VSIX assembly
- `.github/workflows/*.yml` — CI/CD
- `.vscodeignore` — what ships in the VSIX
- `esbuild.config.mjs` — extension bundling
- `package.json` — publisher metadata, version

## Platform matrix

| GOOS    | GOARCH | Node platform | Node arch | VSIX target    |
|---------|--------|---------------|-----------|----------------|
| darwin  | arm64  | darwin        | arm64     | darwin-arm64   |
| darwin  | amd64  | darwin        | x64       | darwin-x64     |
| linux   | amd64  | linux         | x64       | linux-x64      |
| linux   | arm64  | linux         | arm64     | linux-arm64    |
| windows | amd64  | win32         | x64       | win32-x64      |

Go-`amd64` vs Node-`x64` rename happens in `scripts/build-agent.sh`.

## Binary path resolution

`src/agentClient.ts` resolves the binary as
`bin/agent-${process.platform}-${process.arch}${ext}`. Per-target
VSIX includes only that target's binary.

## Size targets

- VSIX per platform: <25 MB
- Go binary (`-ldflags="-s -w"`): 8–15 MB
- Extension bundle (esbuild): <500 KB
- Webview build: <200 KB

Investigate before UPX-packing (AV false positives on Windows).

## Signing & notarization

- **macOS:** Developer ID + `notarytool`, or document `xattr -d
  com.apple.quarantine`.
- **Windows:** EV cert removes SmartScreen warning.
- **Linux:** no signing.

## Versioning

Semver, tag `v0.5.0` etc. Bump in `package.json`.

## Marketplace publishing

```bash
npx vsce publish --packagePath dist/loom-darwin-arm64.vsix
# repeat per target
```

Do **not** pass `--target` (encoded in the VSIX manifest). Requires
`VSCE_PAT` in environment.

## CI/CD

- `.github/workflows/release.yml` — matrix build per platform on tag.
- `.github/workflows/ci.yml` — build + lint on PRs.

## Out of scope

- Bundling `node_modules` into the VSIX.
- Committing binaries to the repo.
- Publishing from a personal machine.
- One fat cross-platform VSIX.
