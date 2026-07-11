# mdc

mdc is a local markdown workspace where humans and coding agents review docs together — margin comments anchored to the text, stored in sidecar files, that both can read, reply to, and resolve. It renders a whole working folder — markdown (view and edit modes), images, HTML, PDFs — and trusted HTML files can run as mini apps that read and write workspace files through the `window.mdc` bridge. One package, two build targets: `src/` (core sidecar/anchoring, the `mdc` CLI, the Hono server under `src/server/`) and `web/src/` (the React frontend).

## The sidecar model

Comments live in an append-only `.comments.jsonl` sidecar next to each `.md`; open/resolved state is derived on read, never mutated. **The sidecar is the source of truth — the server is just a view and writer over it.** Read and write threads via the `mdc` CLI or the file directly; no server needs to be running to participate in a review.

## Workflow

Work flows through the skills in `.agents/skills/`. Two flows:

**Feature pipeline (PR flow)** — for significant features:

1. `write-product-spec` — settle the user-facing behavior (`specs/<feature>/PRODUCT.md`).
2. `write-tech-spec` — the implementation approach + test plan (`specs/<feature>/TECH.md`). Use `grill-with-docs` to stress-test a plan against the domain model before committing to it.
3. `to-tickets` — break the spec into tracer-bullet GitHub issues with blocking edges.
4. `implement` — take one issue end-to-end: inspect, change, verify, open a PR, report back on the issue.
5. A human reviews the PR (see below); merging closes the issue.

**Local flow** — for small changes worked directly with a human on a branch: build and verify as usual, then `done` closes out (changelog entry, atomic commits, merge to main, close the issue, push).

Cross-cutting:

- `changelog` — record every user-facing change under `[Unreleased]` as it lands (`create-pr` and `done` both invoke it).
- `release` — bump, promote the changelog, tag; the pushed tag triggers the npm publish.
- `triage` — move inbound issues through the triage-label state machine.
- `handoff` — compact a long session into a doc the next agent can pick up.

### Reviewing a PR

- `gh pr checkout <n>`, read the PR body — especially its verification section.
- Run the sign-off chain (below).
- Live-verify the claimed behavior on the dev server (below), matching the check to the claim: measure precise-quantity claims, screenshot categorical ones.
- If the PR reports a check it could **not** verify, reproduce that check before merging — never merge with "will eyeball it later." An unverified check on the exact surface under change is where the bugs are.

## Running mdc locally

Always run the working tree via `node dist/cli.js` — never a globally installed `mdc` (that resolves to the published release, so it silently tests the wrong code).

```
npm run build                                # dist/cli.js (server + CLI)
npm run build:web:dev                        # web/dist-dev (frontend)
node dist/cli.js serve <root> --port 8099 --static-dir web/dist-dev --no-open
node dist/cli.js stop --port 8099
```

- Default scratch port `8099`; if occupied, take the next free one. Never `8000` — that's the user's live server.
- Rebuild after every change (`build:web:dev` for `web/src/`, `npm run build` for `src/`) and reload the open tab — otherwise you're measuring the old bundle.
- For file-mutating features (move/delete/rename), use a disposable workspace and tear it down: stop the server, delete the fixture dir.
- Sign-off before any commit: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Keep-in-sync contracts

Update these docs in the same change that alters what they describe — each is the contract the next agent builds from:

- **`.mdc.toml.example`** — whenever a section is added or changed in `.mdc.toml` handling.
- **`docs/mini-app-guide.md`** — whenever the `window.mdc` bridge, manifest format, sandbox limits, or trust model changes. It ships to users.
- **`docs/agent-setup.md`** — whenever the `mdc` CLI surface or the review-loop contract changes (commands, flags, watch/hand-off semantics, what an agent does with a thread). It ships to users via `mdc setup` and is the agent's operating manual.
- **`DESIGN.md`** — whenever a UI change introduces visual vocabulary the doc doesn't already name (a color semantic, token recipe, or component pattern); reuse-only changes need no update. Litmus: after the change, the next agent could build a matching UI from `DESIGN.md` alone.

## Skill config

### Issue tracker

Issues and PRDs live in this repo's **GitHub Issues** (via the `gh` CLI). External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
