# Changelog

All notable user-facing changes to mdc. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added

### Changed

### Fixed
- Suggestions remain applicable when their display anchor is orphaned but the raw target is still current; the CLI warns when a default target contains Markdown syntax.

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
