---
name: implement
description: Implement a fix or feature from a GitHub issue end-to-end — fetch issue context, inspect the codebase, make the change, verify it, open a pull request, and report back on the issue.
disable-model-invocation: true
---

# Implement

Implement the issue named in the prompt and open a GitHub pull request with the fix or feature. Expect one issue reference (number, URL, or `#id`); if the prompt doesn't name exactly one, ask before changing code.

mdc is one package with two build targets: `src/` (core sidecar/anchoring, the `mdc` CLI, and the Hono server under `src/server/`) and `web/src/` (the React frontend). Run all builds and git from inside your checkout/worktree, never the folder above it.

**Branch before touching code — always from up-to-date main:** `git fetch origin && git switch -c feat/<short-title> origin/main` (or `fix/…`). Never base on another PR's branch: when that PR merges and its branch is deleted, GitHub auto-closes yours and it cannot be reopened retargeted. If you share a machine with the primary checkout, do this in your own worktree (`git worktree add ../mdc-<issue> origin/main`) and never switch the primary checkout's branch — it stays on `main`.

## Workflow

### 1. Fetch issue context

Read the issue with `gh issue view <n> --comments` (conventions in `docs/agents/issue-tracker.md`). Read the full title, body, comments, labels, acceptance criteria, and any linked issues. Do not implement from the title alone. If critical detail is missing, post a concise blocker comment naming what's missing and stop rather than guessing.

Post a short comment that an agent has started implementing, so the issue reflects that work is underway. Keep it to one line.

### 2. Inspect the codebase

Read the code before changing it. Understand the affected behavior, the likely files, existing patterns to follow, and edge cases. Use the domain vocabulary from `CONTEXT.md` (if it exists) and respect any `docs/adr/*` in the area you're touching.

- **Inspect the DOM before writing structure-dependent code.** When a change assumes the shape of rendered markup (a CSS selector, a render transform), dump the rendered HTML and read it first rather than assuming the structure.
- **Any UI work follows the design system — read `DESIGN.md` BEFORE writing CSS or component markup.** It defines the color semantics, token recipes (`color-mix` rungs — never hardcode rgba/hex), the shared component vocabulary, and view/edit mark-parity. Reuse what it names; if the change genuinely needs something the doc doesn't cover, extend the doc in the same change rather than inventing ad-hoc styling.

### 3. Make the change

Make the smallest cohesive change that satisfies the issue. Follow existing style and architecture. Update tests, fixtures, or docs when they're part of the expected behavior. Do not bundle unrelated refactors, formatting churn, or opportunistic cleanup into the change.

**Open-source-clean — hard rule.** `src/` and `web/src/` are public product code. In code, comments, AND commit messages: no project-management vocabulary, no personal names (use the generic `user` default), no implementation-history references. Describe what the code *does*. Commit titles are what-it-does ("Require double tildes for strikethrough"), never a reference to internal process.

If the issue turns out much larger or more ambiguous than expected, stop and comment with a concise recommendation rather than shipping a risky partial change.

### 4. Verify

Passing typechecks and unit tests is not sufficient for user-facing changes — verify end-to-end.

**Sign-off — always run before committing:**

```
npm run typecheck:web && npm run typecheck && npm test && npm run knip
```

If a sandboxed environment restricts localhost or file descriptors, `npm test` can fail on limits unrelated to your code:
- `listen EPERM ... 127.0.0.1` — the suite starts local test servers; grant local-network permission for the run.
- `EMFILE: too many open files, watch` — chokidar's watcher exceeds the fd limit.

Use the polling / non-parallel invocation if you hit these:

```
npm run typecheck:web && npm run typecheck && env CHOKIDAR_USEPOLLING=1 npm test -- --no-file-parallelism && npm run knip
```

**Verify rendered / layout outcomes in a browser.** The frontend serves from a built bundle, so build before serving and **rebuild after every code/CSS change** — otherwise you measure the OLD output. From inside your checkout:

```
npm run build                                # dist/cli.js (server) + web bundle — a fresh checkout has neither
npm run build:web:dev                        # web/dist-dev (frontend) — RE-RUN after each frontend/CSS change
node dist/cli.js serve <root> --port <PORT> --static-dir web/dist-dev --no-open
# ... put your fixture in a .md under <root>, open it, verify ...
node dist/cli.js stop --port <PORT>          # stop the server
rm -rf <root>                                # delete the fixture dir — teardown isn't done until both are gone
```

- **Pick `<PORT>`: default `8099`; if it's occupied, use the next free port (`8100`, `8101`, …).** Never `8000` (that's the user's live server; a test must not touch it). Check occupancy with `node dist/cli.js check --base-url http://localhost:8099` (or `serve`'s `EADDRINUSE` bind failure — the definitive tiebreaker); a stale server from a prior run, or a second agent's server, can hold `8099`. Use the same port for `serve` and `stop`. Re-run `build:web:dev` after any frontend/CSS change; rebuild the CLI too if you changed `src/`. After a rebuild, reload any open tab before measuring — it's serving the cached bundle. Teardown (stop server + delete fixture dir) is part of the check, not optional.
- **Match the check to the claim.** A precise-quantity claim (positions equal within Npx, an exact offset) — **measure** it: read `getBoundingClientRect()` / computed styles and assert the relationship; report the actual numbers, not just "passed". A categorical claim (renders vs. shows raw, right color, nothing overlaps) — a **screenshot** verifies it. An objective outcome verified by the fitting method is done; a genuinely aesthetic judgement (does the spacing *feel* right) is left for the human PR review — verify what you objectively can, then say what's left.

If end-to-end verification isn't possible in the current environment (the app can't launch), say so explicitly in the PR with what was attempted; do not imply the flow was exercised.

Before opening the PR, apply the `review-readiness` skill.

### 5. Open the pull request

You are already on the branch you cut from `origin/main` at the start; confirm with `git branch --show-current` before committing. Commit only the intended changes with a clear what-it-does message.

Open the PR with the `create-pr` skill (it runs `changelog` and uses `.github/pull_request_template.md`). Fill the template: link the issue, summarize the change, list the verification you ran and its results, and note any known limitations or verification gaps. Use `Closes #<n>` if the change fully resolves the issue, or `Related to #<n>` with the remaining work if it's partial.

If `gh pr create` fails, do not report success — fix it, or post a blocker comment saying the branch exists but PR creation failed.

### 6. Report back on the issue

Only after the PR is open, post a final comment on the issue with the PR link, a brief summary, the verification performed, and any reviewer notes. The final comment must include the PR URL — "a PR will be opened later" is not acceptable.

A human reviews the PR before merge. Do not merge, rebase, or push to `main` yourself; do not close, assign, or relabel the issue unless asked.

## Guardrails

- Do not implement without reading the issue and inspecting the codebase.
- Do not expose secrets, tokens, or credentials in comments or the PR.
- Do not make unrelated code changes.
- Do not claim verification passed if it was not run or failed.
- Do not post a success comment unless the PR is open and the comment includes its URL.
- Post progress sparingly: the started comment, then at most a couple of updates before the final PR link unless blocked.
