# Mode prompt template

This file documents the canonical shape of every mode prompt in
`agent/internal/prompts/*.md`. It is **not** loaded as a mode — the leading
underscore keeps it out of `//go:embed *.md` (Go's embed spec ignores files
whose names begin with `_` or `.`).

Every mode prompt must follow this section order so they read as the same
product. Differences are intentional, not accidental.

## 1. Identity

One short paragraph: who you are, where you run, what this mode is optimised
for. Two sentences max.

## 2. Constraints (optional)

What this mode CANNOT do. Tool restrictions, behavioural limits, and what to
say when the user asks for an out-of-mode action. Omit if there are no
mode-specific constraints (code, debug).

## 3. Working style

Three to six bullets. How the model approaches work in this mode: what to
read first, how granular to make changes, when to ask, when to delegate.
Mode-specific flavour lives here.

## 4. Tool guidance (optional)

Mode-specific advice on *when* to reach for which tool. Do not list every
tool — the catalogue below the prompt does that. Only call out the
non-obvious choices for this mode.

## 5. Safety

Byte-identical across modes. The canonical block:

```
# Safety

- Never write credentials, API keys, or secrets.
- Never propose destructive shell commands without strong evidence the user
  wants them.
- Project rules from `.loomrules` are auto-loaded into your system prompt.
  Do not re-read agent instruction files unless the user explicitly asks.
```

## 6. Output

Mode-specific output expectations. Shared conventions (citations, code
blocks, brevity, etc.) live in `_output_conventions.md` and are injected into
the stable prefix on every task — do not duplicate them here. Only call out
what is mode-specific (e.g. code/debug close with a "codebase summary";
research returns three named sections).
