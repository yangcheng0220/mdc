# Changelog

All notable user-facing changes to mdc. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- Settings now shows the running mdc version with a link to release notes.
- `mdc comment` and `mdc reply` can attach a uniquely targeted suggested replacement, including deletions.
- Suggestion comments show stacked current and proposed text with word-level changes, deletions, and superseded revisions.
- Suggestion cards can apply a cleanly matched replacement in view mode and show the resulting Applied state.
- Suggestion cards can reject proposals, preserve Applied or Dismissed decisions when reopened, and surface the next actionable revision to the user and agent.
- Suggestion cards can apply replacements directly in edit mode with undo and autosave support.

### Changed

### Fixed
- `mdc --version` now reports the installed version instead of a stale number.

## [0.1.1] - 2026-07-08

### Changed
- `mdc --help` now describes rendering, editing, and mini apps, not just margin review.

### Fixed
- Comments authored before you set your name stay styled as yours, not an agent's, after you rename yourself.

## [0.1.0]

Initial public release.
