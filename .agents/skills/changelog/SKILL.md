---
name: changelog
description: Record a user-facing change in CHANGELOG.md as it lands. Use when finishing a feature or fix, wrapping up work, or recording what changed for the next release.
---

# Changelog

Record what shipped as it lands. Do not scrape commits at release time — write the entry now, while the change is fresh.

## How

1. **Is the change user-facing?** If it only affects internals — a refactor, a dependency bump, CI, tests — with no effect a user would notice, skip it. The changelog is release notes, not a commit log.
2. Open the repo-root `CHANGELOG.md`.
3. Add one bullet under `## [Unreleased]`, in the right subhead:
   - `Added` — new capabilities the user can see or use.
   - `Changed` — behavior changes to existing features.
   - `Fixed` — bug fixes.
4. Write it for a user reading release notes, not as a commit message:
   - One line, present tense.
   - Describe the effect, not the implementation or file paths.

Create a subhead only when it has at least one entry. Leave the empty scaffold subheads in place for the next entry.

## Example

```markdown
## [Unreleased]

### Added
- Open and run trusted HTML files as mini apps that read and write workspace files.

### Fixed
- Comments authored before an identity change keep their original author styling.
```

Entries stay under `[Unreleased]` until the `release` skill promotes them to a dated version heading. See `.agents/skills/release`.
