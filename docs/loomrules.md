# `.loomrules`

Loom can load project instructions from your workspace before each task. Use a
`.loomrules` file when you want Loom to follow local conventions that are not
obvious from the code alone.

## File Format

`.loomrules` is plain Markdown. There is no required front matter or section
structure. Keep it short, concrete, and focused on instructions that should
apply to every Loom mode.

Good topics:

- How to run tests in this repo
- Architecture boundaries that must not be crossed
- Code style rules that differ from common defaults
- Safety rules for migrations, generated files, secrets, and releases

Avoid putting secrets, private credentials, or large pasted documents in
`.loomrules`; the file is copied into the model system prompt.

## Precedence

Loom always considers `.loomrules` first. It then adds provider-specific agent
instruction files based on the active LLM family:

- Anthropic: `CLAUDE.md`, then `.claude/rules/*.md` sorted by filename
- OpenAI: `AGENTS.md`, then `.codex/rules/*.md` sorted by filename

Duplicate files by exact content hash are skipped. All included sources are
concatenated in that order.

## Prompt Envelope

The model sees the rules in a system-prompt block like this:

```xml
<rules sources=".loomrules,AGENTS.md">
--- .loomrules ---
...
</rules>
```

The `sources` attribute lists the files that fit inside the bundle. Rules layer
on top of the active mode prompt; they do not replace the mode's baseline
behavior or tool restrictions.

## Size Cap

The rules bundle is capped at 32 KB. Loom only includes complete files. If a
file would exceed the cap, it is omitted and the bundle ends with a marker:

```text
<truncated: N file(s) omitted>
```

This tells the model that additional rule files existed but were not loaded.
Keep high-priority instructions in `.loomrules` or near the start of the
provider-specific file order.

## Examples

Example rule files live in `examples/loomrules/`:

- `monorepo.md`
- `legacy-codebase.md`
- `strict-tests.md`

They are starting points, not schemas. Copy the patterns that match your repo
and delete anything that is not actually true.
