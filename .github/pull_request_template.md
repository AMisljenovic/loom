# Summary

<!-- One or two sentences describing what this PR does. -->

# Changes

<!-- Bullet list of notable changes. -->

# Layer

Which layer(s) are touched?

- [ ] TypeScript extension host (`src/`)
- [ ] React webview (`webview-ui/`)
- [ ] Go agent (`agent/`)
- [ ] Build / packaging / CI
- [ ] Documentation only

# Wire protocol

Does this PR change `src/shared/protocol.ts` or the JSON-RPC handlers?

- [ ] No
- [ ] Yes — both sides updated symmetrically

# Testing

How did you verify this works?

- [ ] `npm run build` succeeds
- [ ] `go vet ./...` clean (from `agent/`)
- [ ] Ran in Extension Development Host (F5)
- [ ] Other: <!-- describe -->

# Checklist

- [ ] Updated `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` if architecture changed (enforced by the `pre-commit` hook — see `scripts/check-docs-sync.mjs`)
- [ ] No `any` introduced in TypeScript
- [ ] No `fmt.Print*` to stdout in Go (logs go to stderr)
- [ ] Conventional commit format (`feat:`, `fix:`, `chore:`, etc.)
