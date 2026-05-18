# Changelog

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
