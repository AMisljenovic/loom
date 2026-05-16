# Prompt Eval Harness

The eval harness is a small regression suite for Loom prompt changes. It runs
scenario prompts against the configured LLM provider, executes tool calls inside
an isolated temporary workspace, and checks behavioral assertions.

Run from the repository root:

```bash
npm run eval
```

Or from the Go module:

```bash
go run ./cmd/eval
```

Configuration uses the same environment variables as the agent:

- `MY_AGENT_PROVIDER=openai|anthropic`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`, `MY_AGENT_MODEL`

The harness intentionally avoids exact-output matching. A scenario passes when
the expected behaviors hold, such as calling `read_file`, touching a file with
`apply_diff`, loading a skill, or briefing sub-agents with useful context.
Transcripts are written to temporary directories and reported in the output.
By default, each scenario can take up to 10 model turns; use `--max-turns` to
tighten or loosen that while dogfooding prompt changes.
