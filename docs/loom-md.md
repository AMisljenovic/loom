# `LOOM.md`

Loom loads project instructions from your workspace before each task. Add a
`LOOM.md` file at the root of your workspace when you want Loom to follow
local conventions that are not obvious from the code alone.

This is the only project-rules file Loom reads. Foreign-format files
(`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/`, `.codex/`, `.gemini/`,
`.cursor/`, `.cursorrules`, `.github/copilot-instructions.md`,
`.github/instructions/`) are intentionally **not** loaded — this keeps the
prompt prefix small and provider-neutral. If you want to share content
across tools, symlink or generate `LOOM.md` from your other instruction
file.

## File Format

`LOOM.md` is plain Markdown. There is no required front matter or section
structure. Keep it short, concrete, and focused on instructions that should
apply to every Loom mode.

Good topics:

- How to run tests in this repo
- Architecture boundaries that must not be crossed
- Code style rules that differ from common defaults
- Safety rules for migrations, generated files, secrets, and releases

Avoid putting secrets, private credentials, or large pasted documents in
`LOOM.md`; the file is copied into the model system prompt.

## Prompt Envelope

The model sees `LOOM.md` in a system-prompt block like this:

```xml
<rules source="LOOM.md">
...your file contents...
</rules>
```

Rules layer on top of the active mode prompt; they do not replace the
mode's baseline behavior or tool restrictions.

## Size Cap

The rules body is capped at 32 KB. Content beyond the cap is truncated and
the envelope ends with a marker:

```text
<truncated: N byte(s) omitted>
```

Keep high-priority instructions near the top of the file so they survive
truncation.

## Examples

Example rule files live in `examples/loom-md/`:

- `monorepo.md`
- `legacy-codebase.md`
- `strict-tests.md`

They are starting points, not schemas. Copy the patterns that match your repo
and delete anything that is not actually true.
