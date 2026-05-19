# Changelog

## 0.5.2

Loom 0.5.2 normalises external AI-tool context before the model sees it,
isolates chat sessions per workspace, and adds a marketplace auto-publish
workflow. (0.5.1 was tagged for publish but never reached the marketplace
due to a transient CI toolchain mismatch; this release rolls those changes
forward together with the dependency bump that unblocked CI.)

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
