# Changelog

All notable user-facing changes to mdc. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- Suggestion cards in view mode now pin a reversible in-document diff preview, with a stacked fallback when the proposed edit changes block structure.
- Pinned suggestion previews now include floating Accept, Reject, and Close actions for deciding changes in place.
- Large suggestion diffs now collapse to a line summary with a Preview in doc action, and clicking a suggestion mark opens its in-document preview.
- Suggestion cards in edit mode now pin an undoable inline merge chunk; accepting persists the edit, while rejecting or closing restores the buffer without autosaving the preview.

### Changed
- Conflict merge views now use the shared teal/violet diff colors for added and removed text.

### Fixed
- Comment highlights stay within horizontally scrolling code blocks at narrow document widths.
- Suggestions remain applicable when their display anchor is orphaned but the raw target is still current; the CLI warns when a default target contains Markdown syntax.
- The packaged Kanban example now opens with starter columns and stores its first board beside the app.
- Typing an empty bullet after a paragraph no longer makes the previous line appear as a heading in edit mode.

## [0.2.0] - 2026-07-11

### Added
- Settings now shows the running mdc version with a link to release notes.
- Suggestions: an agent can propose an exact edit (including a deletion) on any comment or reply; the thread card shows a word-level diff and the user accepts it into the doc — in rendered view or the editor, where it's a normal undoable edit — rejects it, or replies to refine. Decisions stay on the thread as Applied or Dismissed, a revised proposal supersedes the earlier one, and a suggestion whose target text has drifted orphans safely instead of mis-applying.

### Changed
- `mdc setup` now teaches agents to answer doc-change requests with suggestions — propose the exact edit, let the human decide — instead of editing docs directly or describing edits in prose.

### Fixed
- `mdc --version` now reports the installed version instead of a stale number.

## [0.1.1] - 2026-07-08

### Changed
- `mdc --help` now describes rendering, editing, and mini apps, not just margin review.

### Fixed
- Comments authored before you set your name stay styled as yours, not an agent's, after you rename yourself.

## [0.1.0]

Initial public release.
