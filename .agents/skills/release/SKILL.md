---
name: release
description: Prepare an mdc release — bump the version, promote the changelog, tag, and push. Use when preparing or cutting a release, bumping the version, tagging, or explaining how mdc ships to npm.
---

# Release

mdc ships to npm on a **pushed git tag**. This skill prepares and tags a release; GitHub Actions (`.github/workflows/release.yml`) does the actual publish once the tag lands.

Tag a commit that's on `main` and green — CI (`ci.yml`) runs the sign-off on every push to `main`, so a released commit is already verified.

## Flow

1. **Bump the version** in the repo-root `package.json` (e.g. `0.1.0` → `0.1.1`). Follow semver: patch for fixes, minor for backward-compatible features, major for breaking changes.

2. **Promote the changelog.** In `CHANGELOG.md`, move the entire current `## [Unreleased]` section into a new `## [x.y.z] - YYYY-MM-DD` heading (today's date), carrying every non-empty `Added` / `Changed` / `Fixed` subhead. Drop only the empty subheads. Then add a fresh empty `## [Unreleased]` scaffold above the new version heading.

3. **Inspect the changelog diff before tagging.** The new version section must contain every bullet that was under `[Unreleased]`. The release notes come straight from this section — no commit scraping — so if a shipped change is missing a line, add it (via the `changelog` skill) before continuing.

4. **Commit** the version bump + changelog together, with a short message: `release x.y.z`.

5. **Tag** the commit with an annotated tag: `git tag -a vx.y.z -m "vx.y.z"`. The tag version MUST match the `package.json` version — the release workflow validates this and fails the publish if they disagree.

6. **Push** the commit and the tag: `git push && git push origin vx.y.z`. (Release from `main` in the normal case — see the top of this skill.)

GitHub Actions then validates the tag against `package.json`, builds, publishes `mdc-workspace@x.y.z` to npm, and creates a GitHub Release whose notes are the matching `CHANGELOG.md` section.

## After pushing

Watch the release run (`gh run watch`, or the repo's Actions tab). When it's green, confirm the result:

- `npm view mdc-workspace@x.y.z version` returns the new version.
- The GitHub Release exists with the changelog section as its notes.

If the run fails on the version-match validation, the tag and `package.json` disagree — delete the tag (`git push origin :vx.y.z` and `git tag -d vx.y.z`), fix the mismatch, and re-tag.
