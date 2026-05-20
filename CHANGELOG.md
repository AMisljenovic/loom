# Changelog

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
