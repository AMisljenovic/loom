# Changelog

## 0.4.1

Loom 0.4.1 is a navigation, edit-speed, and readability release. The agent
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
