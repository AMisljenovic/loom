# Roadmap

A versioned plan from the current scaffold to a polished, shippable agent.
Each iteration is sized to be a focused chunk of work — small enough to
finish, large enough to feel like progress.

## Where you are

**v0.1 — Scaffold complete.** Extension activates, webview renders, Go binary
spawns, JSON-RPC round-trips, stub streams a canned response. Foundation is
solid.

---

## v0.2 — Working LLM agent (the big one)

**Goal:** Replace the stub with a real provider-agnostic LLM loop. After this,
you have an actual coding agent.

**Scope:**
- Provider interface in `agent/internal/llm/llm.go`
- OpenAI implementation (`openai.go`) with streaming + tool calls
- Real agent loop: build tool list from registry, stream, dispatch tool calls,
  feed results back, loop until `end_turn`
- Wire `read_file` and `list_dir` (Go-side) end-to-end with the model
- Wire `write_file` (TS-side) through the approval flow
- Conversation history kept in memory per task

**Success test:** Ask "What does this project do?" — agent reads `README.md`
and answers. Ask "Create a file `hello.txt` with the word hi" — approval
prompt appears, file is created.

**Sizing:** ~1 week. The OpenAI streaming format (incremental tool-call
argument deltas) is the trickiest piece.

---

## v0.3 — Real tools, observable behavior

**Goal:** The agent becomes genuinely useful for common tasks.

**Scope:**
- **`search` tool** — Go-side, wraps ripgrep if installed, falls back to
  native walk. Returns file:line:snippet matches.
- **`run_command` output capture** — TS-side terminal integration that
  captures stdout/stderr and feeds it back to the model. Use VS Code's
  `Pseudoterminal` API.
- **`get_diagnostics`** — TS-side, reads `vscode.languages.getDiagnostics()`
  so the agent can see lint errors and type errors.
- **`apply_diff` instead of `write_file`** — show users a real diff before
  approval. Use VS Code's `vscode.diff` command.
- **Activity log** — every tool call appears in the webview with input,
  output, and timing. Click to expand.

**Success test:** "Find all places that import `lodash` and tell me which
files use which functions." Agent searches, reads matches, summarizes.

**Sizing:** ~1 week.

---

## v0.4 — Context and conversation management

**Goal:** Handle real-world tasks that exceed a single prompt.

**Scope:**
- **Context window management** — track token count, drop or summarize
  oldest messages when approaching limit
- **Conversation persistence** — save/restore tasks across VS Code reloads
  (use `vscode.ExtensionContext.workspaceState`)
- **Multi-turn UX** — user can interrupt mid-stream, send a follow-up, or
  branch off a previous task
- **Cancel button works** — Go-side `task.cancel` actually cancels the
  in-flight LLM stream via `context.Context`
- **Cost / token tracking** — show cumulative tokens and approximate cost
  in the UI

**Success test:** Have a 30-message conversation about a real bug. Close
VS Code. Reopen. Conversation is still there.

**Sizing:** ~1 week.

---

## v0.5 — Multiple providers + configuration

**Goal:** Don't lock to one vendor; let users bring their own keys and pick
models.

**Scope:**
- **Anthropic provider** alongside OpenAI (or whichever you didn't do first)
- **Local provider** via Ollama or llama.cpp HTTP API for testing without
  paying
- **Provider selection UI** — dropdown in webview, persisted per workspace
- **Model selection** — list of known models per provider, plus "custom"
  input
- **Settings UI** — proper VS Code settings tree, not just
  `loom.anthropicApiKey`
- **Key storage** — use `vscode.SecretStorage` instead of plaintext settings

**Success test:** Switch from GPT-4 to Claude Opus to a local Llama
mid-session. Same conversation, different brains.

**Sizing:** ~1 week.

---

## v0.6 — Approval UX overhaul

**Goal:** Approvals stop feeling like friction.

**Scope:**
- **Diff preview** for `write_file` and `apply_diff` — render inline with
  syntax highlighting
- **"Always allow" memory** — per-tool, per-workspace ("always allow
  `read_file`", "always allow `run_command` for `npm test`")
- **Bulk approval** — when the agent queues 5 file writes, approve them as
  a batch
- **Approval allowlist patterns** — regex on command strings, glob on file
  paths
- **Auto-approve mode** with a clear visual indicator (red banner) for
  full-trust workflows

**Success test:** Refactor across 10 files. One approval click handles all
of them.

**Sizing:** ~1 week.

---

## v0.7 — MCP integration

**Goal:** Your agent uses the same tool ecosystem as Cline, Claude Code,
Cursor.

**Scope:**
- **MCP client in Go** — implement the
  [Model Context Protocol](https://modelcontextprotocol.io) client side
- **Connect to local MCP servers** via stdio — config in workspace settings
- **Tool merging** — MCP tools appear in the agent's tool list alongside
  built-in ones
- **MCP server discovery** — read `.vscode/mcp.json` or
  `~/.config/mcp/servers.json`
- **Optionally: expose your agent's tools as an MCP server** so other agents
  can use them

**Success test:** Point the agent at the official `filesystem` MCP server
and have it use those tools instead of built-ins. Then point at GitHub's
MCP server and ask "what issues are open?"

**Sizing:** ~1.5 weeks. The MCP spec is straightforward but the testing
surface is wide.

---

## v0.8 — Modes and prompts

**Goal:** Different tasks need different agent personalities. Roo Code's
biggest delta over Cline.

**Scope:**
- **Built-in modes:** Code (default), Architect (planning, no writes), Ask
  (no tools, just discussion), Debug (focused on diagnostics + run_command)
- **Mode switcher in UI** — dropdown above the input
- **Per-mode system prompts** — files in `agent/prompts/{mode}.md`
- **Per-mode tool restrictions** — Architect mode can't `write_file`
- **Custom modes** — users define their own in workspace config with system
  prompt + tool allowlist
- **Slash commands** — `/explain`, `/test`, `/refactor` as quick
  mode-and-prompt presets

**Success test:** Switch to Architect mode, ask for a plan. No files get
modified. Switch to Code mode, the plan executes.

**Sizing:** ~1 week.

---

## v0.9 — Performance and polish

**Goal:** This is where the Go-vs-TypeScript investment pays off concretely.

**Scope:**
- **Workspace indexer** — Go-side background job that builds a file tree +
  symbol index on startup. Tools like `find_symbol`, `find_references`.
- **Embeddings + semantic search** — local embeddings via Ollama or hosted
  via provider. Vector store in SQLite. Tool: `semantic_search`.
- **Parallel tool execution** — when the model returns multiple tool calls
  in one turn, run them concurrently in Go.
- **Prompt caching** — for Anthropic, use prompt cache to reduce cost on
  long conversations.
- **Telemetry** (opt-in) — anonymous usage stats: latency p50/p99, errors,
  tool frequencies. Helps you prioritize.

**Success test:** Index a 5,000-file repo in under 10 seconds. Semantic
search returns results in under 100ms.

**Sizing:** ~2 weeks.

---

## v1.0 — Distribution

**Goal:** Real people can install and use it without you holding their hand.

**Scope:**
- **Marketplace listing** — icon, screenshots, demo GIF, clear description
- **Per-platform VSIX published** for all five targets
- **Code signing** — macOS notarization and Windows EV cert. Or document
  the workaround clearly.
- **First-run experience** — welcome panel, key setup wizard, sample task
- **Error reporting** — catch panics in Go, send to a Sentry-like service
  (opt-in)
- **Auto-update aware** — clean handling when VSIX updates while a task is
  in flight
- **Documentation site** — basic usage, troubleshooting, contributing

**Sizing:** ~2 weeks.

---

## Beyond v1.0 — Optional directions

These are where the project stops being "Cline-but-mine" and finds its own
identity. Pick based on what you actually want this to be.

**Sub-agents** — Cline-style task delegation, where the main agent spawns
specialized agents for sub-tasks (research, refactor, test-runner) with
their own context windows.

**Checkpoints** — Git-style snapshots of the workspace before each tool
call. Lets users roll back any agent action.

**Browser tool** — agent controls a headless browser for web tasks.
Significant complexity; consider only if your users actually need it.

**Voice mode** — speech-to-text input via Whisper, TTS output. Niche but
distinctive.

**Team mode** — shared agent sessions, conversation handoff between
teammates. Requires hosting.

**Fine-tuning loop** — log accepted vs rejected suggestions, build a
feedback dataset, fine-tune a model on your team's preferences.

**Multi-repo awareness** — agent that understands relationships across
multiple repos, not just the current workspace.

---

## How to actually use this plan

A few realistic notes:

**Don't follow it religiously.** This is a default ordering, not a contract.
If users complain about something at v0.3 that is slotted for v0.6, jump.

**v0.2 is the only one that's required.** Everything after that is
genuinely optional. A focused agent with five great tools beats a
feature-spread agent with thirty mediocre ones.

**Each iteration should be shippable.** At the end of v0.3 you should have
something you'd actually demo, even if it's not on the Marketplace yet. If
an iteration doesn't end in a demo, the scope is wrong.

**Dogfood between iterations.** Spend a week using whatever you just
shipped before starting the next thing. You'll find what's actually missing
— which is rarely what you'd guess.

**The "honest minimum viable agent" is v0.2 + v0.3.** Real tools, real
LLM, decent UX. If you ship there and stop, you have something useful.
Everything after is polish and ambition.

**Be willing to throw work away.** If at v0.5 you realize Anthropic's API
is better for your use case, rip out OpenAI. Sunk-cost fallacy is the
biggest risk in side projects.
