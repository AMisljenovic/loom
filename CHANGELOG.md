# Changelog

## 0.6.5

### Fixed

- **Git co-author trailer now resolves to a real GitHub account.** The
  trailer the agent appends to commit messages was previously
  `Co-Authored-By: Loom <noreply@loom.dev>`, which GitHub could not link
  to any user, so commits rendered "Loom" as plain text with no avatar.
  The trailer now uses the GitHub-noreply form for the dedicated bot
  account: `Co-Authored-By: Loom <274610884+loom-code-ai@users.noreply.github.com>`.
  Updated in the Code and Debug mode prompts.

## 0.6.4

Loom 0.6.4 moves runtime artifacts out of the repo by default and expands Loom's built-in workspace assets.

### Added

- **Host-controlled agent storage.** The VS Code host now passes a
  `LOOM_STORAGE_DIR` path to the Go agent so persisted scratchpads and
  the semantic-search SQLite index live under VS Code's per-workspace
  storage area instead of the repository checkout. Existing headless and
  pre-upgrade installs still fall back to `<workspace>/.loom/`.
- **Built-in Loom workspace assets under `.loom/`.** This release adds
  reusable command stubs (`build-check`, `docs-sync`, `protocol-sync`,
  `release-prep`, `test-fix`), two read-only sub-agent presets
  (`prompt-prefix-checker`, `protocol-auditor`), and four bundled skills
  (`add-loom-tool`, `prompt-prefix-stability`, `webview-host-message`,
  `wire-protocol-message`).

### Changed

- **Scratchpad storage/docs now match the new storage model.** The Go
  scratchpad package resolves its on-disk path from `LOOM_STORAGE_DIR`
  when present, the tool description no longer hard-codes a repo-local
  file path, and `ChatPanel` mirrors the existing session-storage
  fallback logic when choosing the agent storage directory.
- **Vector index database follows the same storage routing.** The
  semantic-search vector store now opens `index.db` under the host-
  supplied storage directory when available, falling back to
  `<workspace>/.loom/index.db` only when no storage override is set.
- **Git ignore rules now target only fallback runtime artifacts.**
  Curated `.loom/commands`, `.loom/skills`, and `.loom/agents` content
  remains tracked, while legacy `.loom/scratchpad/` and `.loom/index.db*`
  artifacts stay ignored.

### Internal

- Added Go tests covering `LOOM_STORAGE_DIR` override and whitespace-only
  fallback behavior for scratchpad persistence.
- Updated prompt/change documentation in `docs/prompt-changelog.md`,
  `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`.

## 0.6.3

## 0.6.3

Loom 0.6.3 signs its commits.

### Added

- **`Co-Authored-By: Loom` trailer on git commits.** Code and Debug
  modes now instruct the agent to append
  `Co-Authored-By: Loom <noreply@loom.dev>` (preceded by a blank line)
  to every commit message it constructs via `run_command` — covering
  `-m`, heredoc, and `--amend` shapes. Existing trailers are not
  duplicated and no extra co-authors are invented. Loom now appears
  alongside the human author on GitHub's commit page and Contributors
  list when it drives the commit.

## 0.6.2

Loom 0.6.2 adds a live diff-summary card above the chat composer.

### Added

- **Diff-stats card.** A collapsible card now sits above the composer
  whenever `apply_diff` runs in the current turn. Header shows
  aggregated `+added -removed` totals and a file count; expand to see
  per-file `+/-` deltas and click any row to open the file's unified
  diff in a read-only editor tab. Auto-resets at the start of every new
  user turn and on conversation switch.
- **Keep / Undo on the diff-stats card.** Once the agent finishes the
  turn (`!busy`), the card surfaces **Keep** (dismiss the summary;
  changes stay on disk) and **Undo** (revert every file touched this
  turn back to its pre-turn snapshot via one `WorkspaceEdit`; created
  files are deleted). Undo prompts for confirmation and lists every
  file that will be reverted.

### Changed

- **`diffPreview` is now emitted for every `apply_diff`.** Previously
  the host only computed and posted the unified diff when an
  `apply_diff` was awaiting approval UI, which meant the diff-stats
  pipeline went silent under write auto-approve. The host now always
  calls `prepareApplyDiff` for `apply_diff` calls and posts the
  `diffPreview` wire message; the VS Code side-by-side diff editor
  still only opens when approval is required.

### Internal

- New `WebviewToHost` message `{ type: "undoDiffTurn" }`.
- New `turnSnapshots` map on `ChatPanel` captures the first pre-edit
  content per file per turn; cleared on every `runTask` start,
  `newConversation`, `switchSession`, and the agent dispose path.
- `webview-ui/src/util/diffStats.ts` parses unified diff into
  added/removed counts and aggregates by path; new
  `webview-ui/src/components/DiffStatsCard.tsx` renders the card.
- `.panel` grid now has eight rows: `.diff-stats-card` lives at row 6;
  `.input-area` moves to row 7 and `.toolbar-shell` to row 8.
- `.loom/` (per-workspace local state — scratchpad, index, workspace
  skills/agents/commands) is now in `.gitignore`.

## 0.6.1

Loom 0.6.1 is a token-spend reduction release for OpenAI reasoning models.
Four workstreams land together — three default-on quick wins plus an
opt-in transport migration that's the biggest single saving for
high-reasoning workloads (gpt-5.x at medium/high effort).

### Added

- **OpenAI Responses API transport (experimental, opt-in).** Settings →
  Advanced → "Use OpenAI Responses API" (or `OPENAI_USE_RESPONSES=1`)
  routes calls for `gpt-5*` / `o3*` / `o4*` / `o5*` models through
  `/v1/responses`. Subsequent turns chain via `previous_response_id` so
  the server retains reasoning state instead of re-billing assistant
  reasoning blocks every turn — typically cuts per-turn input by 60-80%
  on high-reasoning workloads. The adapter falls back to Chat
  Completions automatically on adapter errors. `openai-compatible`
  providers always stay on Chat Completions.
- **Per-mode reasoning effort defaults.** `ModeDefinition.reasoningEffort`
  threaded end-to-end. Built-in modes ship sensible defaults:
  `code` / `ask` / `debug` → `low`, `architect` → `medium`, read-only
  sub-agent presets → `low`. Trivial follow-up turns no longer inherit
  a globally-set "high" reasoning effort. The provider-wide Advanced
  "Reasoning effort" setting is now the fallback (used when a mode has
  no opinion); custom modes under `loom.modes` and
  `.loom/agents/*.md` presets (`reasoning_effort:` frontmatter) may
  override per-mode.
- **Index-tool descriptions.** New markdown bodies for `find_symbol`,
  `find_references`, and `semantic_search` (previously hardcoded one-
  liners with no body in the stable prefix). Each leads with "use
  before regex search for identifier hunts." Mode prompts (`code.md`,
  `debug.md`) gained a "Snipe, don't browse" rule naming the index
  tools first.
- **`gpt-5.4` context window** registered at 400K in `ModelContextLimit`.
  Unknown `gpt-5*` / `gpt-6*` / `o5*` variants now fall back to 400K via
  a prefix-match rather than the 200K default — keeps summarization
  from firing too early on newly-released model names.

### Changed

- **Tool registry reorder.** Read-family ordering is now `search` →
  `find_files` → `read_file` → `list_dir` (was `read_file` → `list_dir`
  → `search` → `find_files`), steering the catalogue toward navigation
  over browsing.
- **`list_dir` description.** Added a "Don't browse with this tool"
  section that names `search` / `find_files` / `find_symbol` /
  `semantic_search` as the preferred exploration tools.
- **`wireMessages` elision policy.** In addition to exact-input
  duplicate dedup, an older `read_file` whose `(offset, limit)` range is
  fully covered by a later broader read on the same path collapses to a
  short superseded marker. Only the 3 most-recent unique `search`
  queries stay full; older unique queries collapse.
- **`read_file` per-file slice cap** lowered from 25 → 10 distinct
  `(offset, limit)` windows. The guard message now steers toward
  `search` or committing to an `apply_diff` rather than slicing further.

### Notes

This release is opt-in for the largest saving (Responses API) and
default-on for the rest (mode reasoning defaults, exploration steering,
smarter elision, `gpt-5.x` context limit). To see the full reduction on
gpt-5.x with high reasoning, flip the Responses API checkbox in Settings
Advanced.

## 0.6.0

Loom 0.6.0 adds two new built-in sub-agent presets — `test-scout` and
`architecture-mapper` — bringing the read-only sub-agent roster to four
(`research`, `review`, `test-scout`, `architecture-mapper`).

### Added

- **Built-in `test-scout` sub-agent.** Read-only test-coverage triage for a
  change surface. Returns four sections: Existing Coverage (with file:line
  citations), Missing Scenarios (ranked by risk), Risk (where a bug would
  land), and Unverified. Pairs with `review` — call before writing a fix to
  see what's already tested. System prompt at
  [agent/internal/prompts/test-scout.md](agent/internal/prompts/test-scout.md).
- **Built-in `architecture-mapper` sub-agent.** Read-only structural scoping
  of a named target tree before a cross-module refactor. Returns six
  sections: Target (path + file count), Layers, Public Surface (exported
  symbols per file), Dependencies (compact `a/foo -> b/bar` edge list +
  external imports), Cycles (detected import cycles), Unverified. System
  prompt at
  [agent/internal/prompts/architecture-mapper.md](agent/internal/prompts/architecture-mapper.md).
- **`find_files` in the read-only sub-agent allowlist.** All four read-only
  presets can now use the filename-glob tool, which makes locating tests,
  package entry points, and target subtrees practical without leaning on
  content search.

### Changed

- **`spawn_subagent` description and mode prompts** now brief the new
  presets in `code.md`, `architect.md`, and `debug.md` — when each is
  appropriate and how it composes with `research`/`review` calls in the
  same turn.

## 0.5.82

Loom 0.5.82 tightens the read/search loop and adds a built-in `review`
sub-agent preset alongside `research`.

### Fixed

- **Read/search loop regression.** Loom now keeps unique read/navigation tool
  results visible to the model, elides only older duplicate read/navigation
  outputs, caches exact duplicate read/search calls per task, and stops
  Code/Debug read loops that make no edit progress before they can burn
  hundreds of tool calls.

### Added

- **Built-in review sub-agent.** `spawn_subagent` now exposes a built-in
  `review` preset alongside `research` for read-only implementation critique,
  focused on regressions, missing tests, compatibility risks, and unverified
  assumptions.

## 0.5.81

Loom 0.5.81 fixes OpenAI/Azure task continuation after an interrupted tool
batch. If a task stops after the assistant requests tools but before every
tool result is recorded, Loom now repairs the transcript before the next model
request so Continue no longer fails with a missing `tool_call_id` error.

### Fixed

- **OpenAI/Azure continuation after interrupted tools.** The conversation
  store can now heal in-memory orphaned assistant `tool_calls`, and the loop
  runs that repair before streaming a resumed task. Persisted-session healing
  still works as before. ([agent/internal/conversation/store.go](agent/internal/conversation/store.go),
  [agent/internal/loop/loop.go](agent/internal/loop/loop.go))

## 0.5.8

Loom 0.5.8 is a token-spend and context-pollution pass. Loom now reads
`.loomrules` and `.loom/<kind>/` only — foreign-format files (CLAUDE.md,
AGENTS.md, GEMINI.md, `.claude/`, `.codex/`, `.gemini/`, `.cursor/`,
`.cursorrules`, `.github/copilot-instructions.md`, `.github/instructions/`) are
no longer loaded into the system prompt. On top of that, OpenAI-compatible
providers now ship the stable prefix and volatile tail as separate system
messages so prefix-based prompt caching hits across turns, and stale tool
results are elided on the wire so per-turn payload size stops growing with
task length.

### Changed

- **Project context is Loom-only.** `agent/internal/rules/` reads
  `.loomrules` and nothing else; `agent/internal/skills/` reads builtin
  skills plus `.loom/skills/<id>/SKILL.md`; `agent/internal/loop/preset.go`
  reads the builtin `research` preset plus `.loom/agents/*.md`;
  `src/commands/loader.ts` reads `.loom/commands/*.md`. Foreign-format
  files are no longer parsed, normalised, or shipped in the prompt.
  Workspaces that share content with other tools should symlink or
  generate `.loomrules` from their other instruction file.
  ([agent/internal/rules/rules.go](agent/internal/rules/rules.go),
  [agent/internal/skills/skills.go](agent/internal/skills/skills.go),
  [agent/internal/loop/preset.go](agent/internal/loop/preset.go),
  [src/commands/loader.ts](src/commands/loader.ts))
- **OpenAI-compatible providers now hit prefix cache.** The OpenAI adapter
  sends `system.Stable` and `system.Volatile` as separate system messages
  instead of concatenating them, so OpenAI/GPT-5's automatic prefix
  caching matches across turns even when the volatile tail (workspace
  path, loaded-skill bodies, `.loomrules`) shifts. Anthropic continues to
  set explicit `cache_control` breakpoints. ([agent/internal/llm/openai.go](agent/internal/llm/openai.go))
- **Stale tool results are elided on the wire.** Before each LLM call,
  `wireMessages()` replaces the content of `RoleTool` messages older than
  the most recent six (when the original exceeded 1 KB) with a short
  placeholder. The conversation `Entry` still retains the full content so
  the webview transcript shows the original output. Per-turn input tokens
  stop growing with task length. ([agent/internal/loop/loop.go](agent/internal/loop/loop.go),
  [agent/internal/loop/wire_test.go](agent/internal/loop/wire_test.go))
- **Webview file watcher narrowed.** `ChatPanel` watches only
  `**/.loom/commands/*.md` for command-catalogue invalidation. Foreign-
  format command folders are no longer watched. ([src/panel/ChatPanel.ts](src/panel/ChatPanel.ts))

### Removed

- **`agent/internal/familycfg/` package.** The provider-family table
  (anthropic/openai/gemini → file/dir mappings) is gone because no caller
  needs it anymore.
- **`agent/internal/normalize/` package.** Frontmatter strippers,
  H1-strippers, and origin detection for Claude/Codex/Copilot/Cursor/
  Gemini files are gone — there are no foreign files to normalise.
- **`Skill.Origin` and `Preset.Origin` fields plus all "external"
  bookkeeping** (`HasExternal`, `IsExternalSource`, `presetsHaveExternal`,
  `loadExternalSkills`, `loadExternalPresets`, `nativeCommandsDir`,
  `fallbackCommandsDirs`, `providerFamily`, the `<rules sources origins
  precedence>` envelope attributes, `loaded-as="fallback"` per-rule tags,
  `also="..."` alias attributes, `origin="..."` on `<skill>` tags). The
  rules envelope is now the minimal `<rules source=".loomrules">…</rules>`.

## 0.5.7

Loom 0.5.7 is a plan-handoff, transcript, and sub-agent reliability pass:
Architect-to-Code execution keeps the selected plan checklist intact,
diagnostics render as proper transcript cards, session timestamps show creation
age, and research sub-agents get more room plus clearer concurrency guidance.
This release also includes provider-parity agent/command assets and sharper
`apply_diff` recovery guidance.

### Added

- **Provider-parity rules, agent presets, and commands.** Added universal
  `.loomrules`, Codex/Gemini provider assets, and GitHub instruction files so
  OpenAI/Codex and Gemini sessions load family-native guidance instead of
  falling back to Claude-targeted prose.
  ([.codex/](.codex/), [.gemini/](.gemini/),
  [.github/instructions/](.github/instructions/), [.loomrules](.loomrules))
- **Diagnostics transcript cards.** Raw model-emitted `<error file=...>`
  diagnostics now render as compact Diagnostics cards instead of leaking as
  plain reasoning text.
  ([webview-ui/src/components/thread/Thread.tsx](webview-ui/src/components/thread/Thread.tsx),
  [webview-ui/src/styles/components.css](webview-ui/src/styles/components.css))
- **Proactive sub-agent eval coverage.** Added an eval scenario that requires
  Code mode to use a research sub-agent for a multi-file read-only survey.
  ([agent/internal/eval/scenarios.go](agent/internal/eval/scenarios.go))

### Changed

- **Plan handoff todos are authoritative.** Implement-plan handoff now parses
  only actionable top-level plan items, folds nested detail bullets into the
  parent todo label, strips Markdown from labels, and injects hidden
  `<implementation_todos>` guidance so Code mode updates statuses instead of
  replacing the checklist.
  ([src/shared/plans.ts](src/shared/plans.ts),
  [webview-ui/src/components/PlanHandoff.tsx](webview-ui/src/components/PlanHandoff.tsx),
  [src/panel/ChatPanel.ts](src/panel/ChatPanel.ts))
- **Sub-agent budget and concurrency guidance.** The built-in research preset
  now allows 45 turns and 100k input tokens, and prompts/tool docs explain
  that sub-agents overlap with other tool calls emitted in the same model
  turn while the parent waits for the batch result before its next turn.
  ([agent/internal/loop/preset.go](agent/internal/loop/preset.go),
  [agent/internal/tools/descriptions/spawn_subagent.md](agent/internal/tools/descriptions/spawn_subagent.md),
  [SUBAGENTS.md](SUBAGENTS.md))
- **Prompt guidance tightened.** Code/Debug prompts now push focused
  sub-agent delegation for unfamiliar multi-file research, seeded todo
  completion before final summaries, and clearer `apply_diff` recovery when
  `newText` is malformed.
  ([agent/internal/prompts/code.md](agent/internal/prompts/code.md),
  [agent/internal/prompts/debug.md](agent/internal/prompts/debug.md),
  [agent/internal/tools/descriptions/apply_diff.md](agent/internal/tools/descriptions/apply_diff.md))

### Fixed

- **Previous sessions showed "now" after opening.** Session rows still sort by
  last activity, but the visible age now reflects `createdAt`.
  ([webview-ui/src/components/conversations/ConversationList.tsx](webview-ui/src/components/conversations/ConversationList.tsx))
- **Transcript could stop above the final summary.** The thread now uses a
  bottom sentinel and completion/plan-ready pin signal so final summaries and
  plan handoff UI stay in view unless the user intentionally scrolled away.
  ([webview-ui/src/App.tsx](webview-ui/src/App.tsx),
  [webview-ui/src/components/thread/Thread.tsx](webview-ui/src/components/thread/Thread.tsx))
- **Tool cards leaked oversized/raw output.** Tool card rendering and activity
  summaries were tightened so command output and tool details stay compact and
  readable.
  ([webview-ui/src/components/thread/ToolCardMinimal.tsx](webview-ui/src/components/thread/ToolCardMinimal.tsx),
  [webview-ui/src/util/activity.ts](webview-ui/src/util/activity.ts))

## 0.5.6

Loom 0.5.6 is a transcript-readability and command-execution pass:
`run_command` / `run_command_background` now pick a platform-native shell
(PowerShell on Windows, `/bin/bash` or `/bin/sh` on macOS/Linux) and accept
explicit `shell` + `cwd` inputs; the tool-card OUT pane no longer dumps the
raw JSON envelope returned by background-process tools; the Processes panel
auto-prunes exited rows; reasoning/summary cards no longer overflow the
panel; and a handful of webview layout glitches around the plan handoff,
session switching, and summary card are fixed.

### Added

- **Shell-aware command execution.** New
  [src/tools/commandShell.ts](src/tools/commandShell.ts) resolves `shell`
  (`auto` / `powershell` / `cmd` / `bash` / `sh`) and `cwd` (workspace-
  relative) per call, with a deterministic platform-aware default. Both
  `run_command` and `run_command_background` accept the new inputs and
  surface the chosen shell in `ProcessSnapshot` so the Processes panel and
  the model see the same picture. Output channels print a `[shell: …]`
  + `[cwd: …]` header on spawn for transparency. Tool descriptions and
  the Code/Debug mode prompts gained a one-line guidance not to blindly
  rerun a command that failed with shell-specific syntax — retry once
  with an explicit `shell` instead.
  ([src/tools/processes.ts](src/tools/processes.ts),
  [src/tools/index.ts](src/tools/index.ts),
  [src/shared/protocol.ts](src/shared/protocol.ts),
  [agent/internal/tools/descriptions/run_command.md](agent/internal/tools/descriptions/run_command.md),
  [agent/internal/tools/descriptions/run_command_background.md](agent/internal/tools/descriptions/run_command_background.md),
  [agent/internal/prompts/code.md](agent/internal/prompts/code.md),
  [agent/internal/prompts/debug.md](agent/internal/prompts/debug.md))
- **"Clear completed" affordance in the Processes panel.** Background
  processes carry an `exitedAt` timestamp; the webview auto-hides exited
  rows 30 s after they terminate (host log retention stays at 5 min) and
  exposes a one-click button to flush them. The host owns a new
  `disposeExitedProcesses()` export wired through a `processesClearCompleted`
  message.
  ([src/tools/processes.ts](src/tools/processes.ts),
  [src/panel/ChatPanel.ts](src/panel/ChatPanel.ts),
  [webview-ui/src/App.tsx](webview-ui/src/App.tsx))

### Fixed

- **Tool-card OUT pane leaked raw JSON for background-process tools.**
  `run_command_background` returned `{"processId":…,"pid":…,"command":…}`
  and `read_process_output` returned `{"output":"…\r\n…","cursor":…,…}`
  verbatim into the transcript. A new shared formatter normalises both at
  render time — the spawn collapses to `Started pid <pid> — <command>`,
  reads show the decoded program output (real newlines, not `\r\n`
  escapes) plus a small `[exit N]` / `[…running, N bytes streamed]`
  footer. The wire content the model sees is unchanged.
  ([webview-ui/src/util/parseToolOutput.ts](webview-ui/src/util/parseToolOutput.ts),
  [webview-ui/src/components/thread/ToolCardMinimal.tsx](webview-ui/src/components/thread/ToolCardMinimal.tsx))
- **Reasoning and Summary cards overflowed past the right edge.** Long
  code blocks and URLs stretched the cards out of the panel because the
  flex chain lacked `min-width: 0`; the inner `<pre>` couldn't trigger
  its own `overflow-x: auto`. The transcript card wrappers
  (`.intent-line`, `.summary-card`, `.summary-body`, `.tc-pane`,
  `.tc-expand`, `.tc-pane-body`, `.markdown-body pre`) all carry the
  constraint now, with a CSS regression test pinning the rule.
  ([webview-ui/src/styles/components.css](webview-ui/src/styles/components.css))
- **Summary card body disappeared behind the composer.** `.summary-card`
  was missing `flex-shrink: 0` — the invariant ToolCardMinimal and
  IntentLine already document — so the flex column transcript would
  collapse it to just the "SUMMARY" head when the body was tall. Added
  the missing constraint; removed an over-eager `overflow: hidden` that
  was clipping vertical content.
  ([webview-ui/src/styles/components.css](webview-ui/src/styles/components.css))
- **Plan handoff "Implement selected" button could scroll out of reach.**
  The handoff card was a single scroll container, so head and footer
  scrolled away with the step list on long plans. The list is now the
  only scroll region; head and foot are pinned. The whole card caps at
  `min(50vh, 480px)` so it never pushes the composer off-screen on short
  windows.
  ([webview-ui/src/styles/components.css](webview-ui/src/styles/components.css))
- **Processes panel held stale entries with unresponsive buttons.** The
  host retains exited process logs for 5 min, but the webview never
  pruned its row, leaving Open/Stop buttons that no-op against a reaped
  process. The webview now auto-prunes exited rows after 30 s, the
  `restore` handler clears the in-memory list on every session switch,
  and a "Clear completed" button flushes the host-side map on demand.
  ([webview-ui/src/App.tsx](webview-ui/src/App.tsx),
  [src/panel/ChatPanel.ts](src/panel/ChatPanel.ts),
  [src/tools/processes.ts](src/tools/processes.ts))
- **`pendingApprovalBatches` survived a session switch.** Only the
  single-call approval maps were cleared, so a batch raised in one
  session could resolve into the next. `switchSession()` /
  `newConversation()` / cancel paths now all flow through
  `cancelPendingApprovals()`, which correctly resolves the batch
  promises and clears the map.
  ([src/panel/ChatPanel.ts](src/panel/ChatPanel.ts))
- **Model-emitted `<path>` / `<file>` tags surfaced as literal text in
  reasoning and summary cards.** Some reasoning-heavy providers wrap
  file paths in XML-style tags. Loom does not instruct this — the model
  produces it on its own — and ReactMarkdown without `rehype-raw`
  escapes unknown HTML so the markers leaked through. The structural-
  tag stripper now also drops `path`, `file`, `filename`, `dir`,
  `function`, `class`, `command`, and `code_ref` wrappers; the inner
  content survives.
  ([webview-ui/src/util/markdown.ts](webview-ui/src/util/markdown.ts))
- **`Bash` label was hard-coded for every command tool.** The tool card
  now reflects the resolved shell (`PowerShell` / `Command` / `Bash` /
  `Sh` / `Shell` fallback) so the transcript matches what actually ran.
  ([webview-ui/src/util/activity.ts](webview-ui/src/util/activity.ts))

## 0.5.5

Loom 0.5.5 is a Go-backend hardening pass: a latent deadlock between the
scratchpad tool and the per-task lock is gone, RPC handler panics no
longer wedge the connection, user cancels now propagate into long-running
tools, and the rules envelope tells the model the difference between a
native CLAUDE.md and one picked up via the fallback chain.

### Fixed

- **`Entry.Lock()` held across the entire LLM stream.** The per-task lock
  in `Driver.run()` wrapped every turn — including `LLM.Stream(...)` and
  `maybeSummarize` — so any concurrent path that touched the same
  conversation (notably `Store.Hydrate()` on session reload) blocked for
  the lifetime of the task. Worse, the `scratchpad` interceptor took its
  own `Entry.Lock()` from inside an errgroup child goroutine while the
  parent goroutine sat in `errgroup.Wait()` holding the task lock — a
  latent deadlock that would trip the first time the model called
  `scratchpad` mid-turn. `conversation.Entry`'s mutating methods now
  self-lock; the task lock is gone; `Hydrate` no longer blocks on a
  running task and the scratchpad deadlock dissolves.
  ([agent/internal/conversation/store.go](agent/internal/conversation/store.go),
  [agent/internal/loop/loop.go](agent/internal/loop/loop.go))
- **RPC dispatch goroutine died silently on handler panic.** A panicking
  JSON-RPC handler killed the dispatch goroutine; `Serve()` kept reading
  but the awaiting peer blocked forever waiting for a response that
  would never come. `dispatch` now wraps the handler call in a recovery
  shim that logs a stack to stderr and replies with a generic
  internal-error (`-32603`) carrying the original request id, so the
  connection stays usable.
  ([agent/internal/rpc/rpc.go](agent/internal/rpc/rpc.go))
- **RPC frame could desync on partial write.** The previous codec wrote
  the `Content-Length` header and the body as two separate `Write`
  calls; a failure between them left the peer reading `Content-Length: N`
  followed by fewer than N bytes. The frame is now assembled into one
  buffer and written in a single call.
  ([agent/internal/rpc/rpc.go](agent/internal/rpc/rpc.go))
- **User cancel didn't propagate into long-running tools.** `Tool.LocalExec`
  had no `ctx` parameter, so `search`, `find_files`, `semantic_search`,
  and every MCP tool internally used `context.Background()` and ran to
  completion even after the task was cancelled. The signature now takes
  `ctx`; the ripgrep subprocess, the directory walker, the embeddings
  call, and `mcp.Manager.call` all honour it. A dead `Driver.ExecTool`
  method (no callers) was removed.
  ([agent/internal/tools/tools.go](agent/internal/tools/tools.go),
  [agent/internal/tools/search.go](agent/internal/tools/search.go),
  [agent/internal/tools/find_files.go](agent/internal/tools/find_files.go),
  [agent/internal/mcp/manager.go](agent/internal/mcp/manager.go))
- **MCP retry loops survived agent shutdown.** After a crashed MCP
  server, `monitorRuntime`/`retryAfterFailure` slept on bare
  `time.Sleep` and then called `startRuntime(context.Background(), ...)`,
  so a `Close()` during the back-off would leave goroutines napping
  through delays and trying to respawn subprocesses against a tearing
  process. `Manager` now owns a `lifeCtx` that `Close()` cancels; a new
  `sleepCtx` helper makes the retry waits short-circuit on shutdown and
  all respawn paths use the same context.
  ([agent/internal/mcp/manager.go](agent/internal/mcp/manager.go))
- **Vector store silently truncated on iteration error.** The
  `SELECT … FROM chunks JOIN vectors` loop in
  `agent/internal/index/vector.go` decoded rows and skipped bad blobs,
  but never called `rows.Err()` after iteration. A mid-stream DB error
  was returned as a (possibly empty) partial result with no signal that
  anything went wrong. Added `rows.Err()` and an early `ctx.Err()`
  check before the unbounded post-loop sort so a cancelled query
  doesn't waste CPU on results nobody will read.

### Added

- **Rules envelope tells the model what's native vs. fallback.** When a
  workspace has only `CLAUDE.md` and Loom runs under OpenAI, the file
  used to land as `<rule source="CLAUDE.md" origin="claude">` with no
  hint that it came via the universal fallback chain — Claude-specific
  prose ("you are Claude…") could leak into an OpenAI conversation as
  authoritative. Per-rule tags now carry `loaded-as="fallback"` when the
  origin doesn't match the active family, and the envelope adds a
  one-line directive telling the model to apply the substance of those
  rules and ignore any model-specific identity claims. Native bundles
  are unaffected.
  ([agent/internal/rules/rules.go](agent/internal/rules/rules.go))
- **Content-dedup preserves source attribution.** When two rule files
  shared identical normalised content (e.g. `CLAUDE.md` and a copilot
  file with the same prose), the dedup silently dropped the second
  path. The user couldn't see why their copilot rule "didn't apply" —
  it had, just rendered as the first file. The kept block now carries
  an `also="alt1,alt2"` attribute and the alias paths surface in
  `Bundle.Sources`.
  ([agent/internal/rules/rules.go](agent/internal/rules/rules.go))
- **Copilot / Cursor `applyTo:` and `globs:` scope survives
  frontmatter stripping.** A file scoped to `**/*.ts` used to land in
  the prompt as a global rule because the whole YAML block was stripped.
  `normalize.Rule` now parses the two scope fields (Copilot's `applyTo`
  and Cursor's `globs`, both scalar or list) and prepends a leading
  `> Scope: applies to **/*.ts` markdown blockquote so the model still
  sees the intent.
  ([agent/internal/normalize/normalize.go](agent/internal/normalize/normalize.go))
- **`agent/internal/familycfg/` is now the canonical table mapping a
  provider family to its convention directories.** The same
  `switch family { … }` block was previously triplicated across
  `rules.nativeCandidates` / `fallbackCandidates`,
  `skills.nativeSkillsDir` / `fallbackSkillsDirs`, and
  `loop.nativeAgentsDir` / `fallbackAgentsDirs`. Adding a fourth
  provider family is now a single entry in `canonical`.
- **`localInterceptor` map replaces the hard-coded special-case switch
  for state-mutating tools.** `load_skill`, `scratchpad`, and
  `spawn_subagent` used to live as three string-comparison branches in
  `execOneTool`; they now register in a map (see
  [agent/internal/loop/interceptors.go](agent/internal/loop/interceptors.go))
  so adding another state-mutating tool doesn't touch the dispatcher.

### Changed

- **`normalize.Version` bumped 1 → 2.** Mixed unconditionally into
  `Bundle.Hash`, so the deliberate envelope-shape changes above produce
  a one-shot cache miss after upgrade and re-stabilise. See
  [docs/prompt-changelog.md](docs/prompt-changelog.md) for the full
  byte-level diff.
- **`Tool.LocalExec` signature added a `ctx` parameter.** Internal
  change; all in-tree tools, the MCP adapter, and any tests were
  updated. Tools that don't need cancellation may continue to ignore
  the parameter.
- **`normalize.IsExternalOrigin` is the single source of truth for "is
  this path a non-Loom convention?"** Replaces the same predicate
  open-coded in `skills.IsExternalSource` and
  `loop.isExternalPresetSource`.
- **`cleanRelativePath` error messages now name the offending path** and
  show where it resolved relative to the workspace root, so a user who
  hits the "escapes workspace root" path gets enough context to fix it.

## 0.5.4

Loom 0.5.4 stops Azure/OpenAI tasks from crashing after long context
windows, treats Gemini as a first-class provider family for project
context, keeps the chat scrollbar pinned to the bottom during streaming,
and lets you double the per-task turn cap each time you press Continue.

### Fixed

- **Azure/OpenAI `messages.[N].role: tool` 400 after long sessions.**
  When the conversation grew past 75 % of the model window, the
  `maybeSummarize` compactor could cut the message slice in the middle
  of a tool batch — leaving the kept tail starting with an orphan
  `tool` message whose parent `assistant(tool_calls)` had just been
  folded into the `<summary>` user message. OpenAI/Azure rejected the
  request shape. The new pure helper `safeCutBoundary`
  ([agent/internal/loop/summarize.go](agent/internal/loop/summarize.go))
  walks the proposed cut back so the kept tail never starts with
  `RoleTool` and the summarized prefix never ends on an
  `assistant(tool_calls)` whose results live in the tail.
- **Transcript scrollbar falling behind streaming responses.** The old
  auto-scroll keyed off `[messages, pendingOutputs]` React commits, so
  late-rendering markdown / code / images and tool-card output streams
  grew the content height after the scroll fired and stalled
  auto-follow once the user-scroll handler tripped past the threshold.
  `Thread.tsx` now pins to the bottom via a `ResizeObserver` +
  `MutationObserver` on the thread and its children, and suppresses the
  user-scroll detector for one event after each programmatic pin so
  layout shifts can't flip `stuckRef` off mid-stream.

### Added

- **Gemini as a first-class rule / skill / preset family.** Gemini was
  previously demoted to the universal fallback chain, so `GEMINI.md` and
  `.gemini/rules/*.md` were ignored whenever any other native file
  existed. `openaiProvider.Family()` now detects Gemini from the model
  id (`gemini-*`, including `models/gemini-*`) regardless of which
  preset routed it, and `agent/internal/rules`, `agent/internal/skills`,
  and `agent/internal/loop/preset.go` each grew a `gemini` native
  branch (`GEMINI.md`, `.gemini/rules/`, `.gemini/skills/`,
  `.gemini/agents/`). Falling back to other providers' files still
  works when the workspace doesn't ship Gemini-shaped conventions.
- **Continue doubles the per-task turn cap.** Long tasks still stop
  after the default 32 model/tool turns, but the stop card's Continue
  button now resumes with the cap doubled (32 → 64 → 128 → …) instead
  of restarting at 32. The doubled value is shown next to the button so
  you can see what you're requesting before you press it.
  `Msg.maxTurns` rides the stop card through to `submit.maxTurns`,
  through `TaskStartParams.maxTurns` on the wire, and is read by
  `Driver.Run` via `StartParams.MaxTurns`. Other stop reasons (error,
  cancellation) keep the default cap.

## 0.5.3

Loom 0.5.3 normalises external AI-tool context before the model sees it,
isolates chat sessions per workspace, and adds a marketplace auto-publish
workflow. (0.5.1 and 0.5.2 were tagged for publish but never reached the
marketplace — first a CI toolchain mismatch, then a `vsce publish` flag
conflict. This release rolls those changes forward with the workflow fix
that finally unblocks the upload.)

### Added

- **In-memory normalization of external context.** A new
  `agent/internal/normalize/` package detects the origin of each rule,
  skill, and sub-agent preset file (`loom`, `claude`, `codex`, `copilot`,
  `cursor`, `gemini`) and applies deterministic, idempotent transforms
  before the content reaches the prompt. Copilot and Cursor frontmatter
  is stripped, redundant `# CLAUDE.md` / `# AGENTS.md` / `# GEMINI.md`
  H1s are dropped, and `.loomrules` / `.loom/` content passes through
  verbatim. Nothing is written to disk.
- **Per-file rule envelopes with origin tagging.** The rules bundle now
  wraps each included file in `<rule source="..." origin="...">…</rule>`
  blocks (replacing the legacy `--- path ---` text marker) and the outer
  `<rules>` tag advertises a sorted, deduped `origins="..."` list so the
  model can see the format mix at a glance. Skill bodies render with
  `<skill id="..." origin="...">` only when the origin is non-loom;
  native skill rendering stays byte-stable.
- **Auto-publish workflow.** A new `.github/workflows/publish.yml`
  triggers on push to `main` and publishes a new VS Code Marketplace
  release whenever `package.json` introduces a version that isn't already
  tagged. Bump the version + add a `## X.Y.Z` CHANGELOG section in a PR
  and the workflow tags, drafts a GitHub Release, and runs `vsce publish`
  per platform. Requires a `VSCE_PAT` repository secret. The existing
  tag-driven `release.yml` remains as a manual escape hatch.

### Fixed

- **Sessions leaking across workspaces.** When `ExtensionContext.storageUri`
  was unavailable (folderless windows, very early activation), session
  bodies fell back to `workspaceState`, which VS Code backs with shared
  empty-workbench storage — so a single folderless run could seed an
  index that other windows then inherited. Bodies now write to
  `globalStorageUri/fallback-sessions/<workspaceFingerprint>/` instead;
  the `SessionsIndex` carries a `workspaceFingerprint` (16-char SHA-1 of
  the workspace identity); and `loadSessions()` discards any index whose
  fingerprint differs from the active workspace.

### Changed

- **Rules bundle hash mixes the normalization version.**
  `normalize.Version` is folded into `Bundle.Hash`; bumping the constant
  deliberately invalidates cached prompt prefixes after a transform
  change. Dedupe of rule bodies now hashes the *normalised* content, so
  identical prose across foreign formats (e.g. `CLAUDE.md` and
  `AGENTS.md` with the same text) collapses to one entry.
- **`Skill` and `Preset` carry an `Origin` field.** External skills are
  parsed through a unified `parseExternalSkill()` (the
  Claude/Codex-format reader, now origin-aware) and presets thread the
  origin alongside `Source` for downstream rendering.
- **esbuild dev-dep bumped to `^0.28.0`** so it satisfies the peer-dep
  vite 8 imposes via vitest 4. No source changes; build and tests
  behave identically.

## 0.5.0

Loom 0.5.0 adds a per-conversation scratchpad so the agent can keep
working notes across turns, repairs sessions that were reloaded
mid-tool-call, and tightens transcript card wrapping for long file paths.

### Added

- **Scratchpad tool.** A new `scratchpad` tool gives the agent a single
  per-conversation markdown buffer with `read`, `write`, `append`, and
  `clear` actions. Notes are persisted at
  `<workspace>/.loom/scratchpad/<conversationId>.md`, lazy-loaded into
  `conversation.Entry` on first call, and capped at 64 KB so the buffer
  stays bounded. The tool follows the existing `load_skill` pattern:
  `LocalExec: nil` in the registry, intercepted in the loop's tool
  dispatch (`execScratchpad`) so it can mutate the conversation entry
  alongside the on-disk file. Distinct from `update_todos` (user-facing
  progress) and skills (curated static knowledge). Mode prompts for
  Code, Architect, and Debug each gain a short pointer at the new tool.

### Changed

- Tool catalogue order is now `update_todos`, `scratchpad`,
  `spawn_subagent`. Stable system prefix cache misses once on first
  load, then re-stabilizes.
- Markdown rendering inside transcript cards now breaks long inline
  `code` spans (file paths, qualified identifiers) instead of pushing
  past the card width. Fenced code blocks keep their horizontal scroll
  behavior via an explicit override on `.markdown-body pre code`.

### Fixed

- Reloading the window mid-tool-call no longer wedges the conversation.
  Previously, the persisted state contained an assistant message with
  `tool_calls` but no matching tool result messages, and OpenAI's API
  rejected the next turn with a 400 ("tool_calls must be followed by
  tool messages responding to each tool_call_id"). `conversation.Hydrate`
  now runs `healOrphanToolCalls` over the incoming snapshot, injecting a
  synthetic tool response for every unanswered `tool_call_id` so resumed
  sessions reach the LLM in a valid state.

## 0.4.3

Loom 0.4.3 brings slash commands, image attachments, broader external
convention imports, and tighter sub-agent guardrails. The composer can now
expand workspace-defined commands, paste screenshots, and pick references
from a fast quick-pick index, while sub-agents are scoped narrower so they
fail less often on broad surveys.

### Added

- **Slash commands.** Type `/` in the composer to expand workspace commands
  before sending. Commands live in `.loom/commands/`, `.claude/commands/`,
  or `.codex/commands/` (each `*.md` file is one command, with optional
  frontmatter `description` and `argumentHint`). Loaded provider-family
  first; the opposite family is a fallback when the native folder is empty;
  `.loom/commands/` always wins. Command catalogue is hot-reloaded via a
  file-system watcher.
- **Image attachments.** Paste an image into the composer (PNG, JPEG,
  WebP, or GIF, up to 5 MB, max 4 per turn) and it is forwarded as a
  base64 image block to Anthropic and OpenAI providers. Per-turn images
  attach to the live `LlmMessage` and are persisted with the conversation
  entry.
- **External skill and sub-agent catalogues.** Skills now load from
  `.claude/skills/<id>/SKILL.md` (Anthropic) or `.codex/skills/<id>/SKILL.md`
  (OpenAI, OpenAI-compatible, local) in addition to `.loom/skills/` and
  builtins. Sub-agent presets imported from `.claude/agents/` or
  `.codex/agents/` are exposed via `spawn_subagent` alongside the built-in
  `research` preset. The opposite provider folder is a fallback only when
  the family-native folder contributes nothing.
- **Quick-pick reference picker.** The "Add references" action now opens a
  workspace-indexed quick pick instead of the OS file dialog. Folders are
  listed before files; existing selections stay checked.

### Changed

- Sub-agent guardrails. Per-turn cap is now **3** (was 5). Architect, Ask,
  and the `spawn_subagent` tool description now lead with "search first;
  delegate only for narrow, terminating questions" and explicitly warn
  about the ~50k-token input budget. After a sub-agent returns truncated,
  the prompts steer the model to narrow the next task instead of retrying
  the same broad question.
- Stable-prefix prompt assembly. Skills, sub-agent presets, and the
  external-convention envelope are advertised in the cacheable stable
  prefix when present; the prefix stays byte-identical for workspaces that
  carry no external entries.
- Reference rendering. `RenderReferences` now also returns image payloads;
  workspace paths are validated only when at least one path-style
  reference is present.

### Fixed

- The OS open dialog blocked the composer for multi-second roundtrips on
  large workspaces; the new quick-pick avoids that.
- Anthropic prompt-cache breakpoint is placed on the trailing image block
  when an image was the last user content; previously cache-control could
  miss image-tail turns.

## 0.4.2

Loom 0.4.2 is a navigation, edit-speed, and readability release. The agent
now searches first and reads narrowly, edits large files without rewriting
them whole, and delegates broader investigations to parallel sub-agents
that stand out in the transcript.

### Added

- `find_files` agent tool — locate files by name glob (e.g.
  `webview-ui/src/**/*.tsx`) via ripgrep with a pure-Go walker fallback.
- `read_file` now accepts optional `offset` and `limit` parameters and
  soft-caps files over ~256 KB to the first 2000 lines when no `limit` is
  given. The result header reports the line window and whether more
  content remains.
- `apply_diff` now accepts a second edit shape:
  `{startLine, endLine, newText}` (1-based inclusive). Range edits skip
  string matching entirely and replace the named lines directly. Mixed
  arrays are fine — range edits apply first in descending `startLine`
  order so earlier line numbers stay valid; anchor edits apply after.
- Multi-tab navigation in the question-answering form, with keyboard
  shortcuts for moving between questions.

### Changed

- Code, Architect, and Ask mode prompts now lead with "search first, read
  narrowly" and explicitly encourage parallel sub-agent delegation for any
  investigation spanning more than ~2 files.
- Sub-agent cards in the transcript are now visually distinct — a clear
  "Sub-agent" tag, thicker accent rail, halo on the running pip, and a
  card-entry animation. Wiring was already complete; the styling now
  matches.
- Inter-tool reasoning prose renders as a low-key reasoning card with a
  small "Reasoning" tag, instead of borderless italic. Easier to read on
  long reasoning passages.
- `update_todos` now moves an updated todo card to the end of the
  transcript so the latest checklist is always nearest the composer.
- `apply_diff` recovery from a failed `oldText` match no longer instructs
  the model to re-emit the entire file. The error now lists every matched
  line number (on ambiguous matches) and steers the model to a tight
  range edit via `{startLine, endLine, newText}`. On 1000+ line files
  this turns multi-minute edit cycles into seconds.
- Tool descriptions for `read_file`, `search`, `list_dir`, and
  `spawn_subagent` rewritten to lead with "search first, read narrowly"
  and "delegate by default" guidance.

### Fixed

- The model previously read whole files where a targeted `search` plus a
  narrow slice would have done; new `offset`/`limit` parameters and
  rewritten prompts close that gap.
- Sub-agent cards were correctly wired end-to-end but rarely appeared
  because the model wasn't prompted to spawn them — and when they did
  appear they looked like ordinary tool cards. Both fixed.

## 0.4.0

Loom 0.4.0 is a workflow and reliability release for longer coding sessions.

### Added

- Live task todos with an `update_todos` agent tool and in-place transcript
  rendering.
- Architect-to-Code plan handoff that can seed implementation todos from
  selected plan steps.
- Stop cards for cancelled, errored, and turn-limited tasks, including elapsed
  time when available and a Continue action to resume from the same context.
- UI entry points for approval batches, background processes, reference packs,
  session search/branch/export/import, MCP status, and semantic search.

### Changed

- Settings now use a compact provider selector and dense full-width fields for
  narrower VS Code sidebars.
- Assistant transcripts now strip internal structural wrappers such as
  `affected-files` and `diagnostics` while keeping their contents visible.
- OpenAI-compatible configuration is refreshed before each task, and Azure-style
  OpenAI endpoints use API-key header authentication.

### Fixed

- `apply_diff` exact-match failures now return a recoverable instruction to read
  the current file and retry once with a full-file replacement through
  `apply_diff`.
- Task turn-limit stops now report a specific reason instead of surfacing only
  as a generic task error.
- Marketplace resource metadata now points at the active GitHub repository.
