# Suggestions — tech spec

Implements [PRODUCT.md](./PRODUCT.md). Grammar decisions are settled in `docs/adr/0001` (self-contained strict targets) and `docs/adr/0002` (qualified resolves, decided-at-most-once); vocabulary per `CONTEXT.md`.

## Approach

### Sidecar grammar (`src/threads.ts`, `src/sidecar.ts`)

- Content lines gain an optional `suggestion: { target: { quote, context: { before, after } }, replacement }` field; `resolved` events gain optional `resolution: "applied" | "dismissed"` + `suggestion_id`. Extra fields only — old readers degrade to plain comments/resolves (ADR 0002), no format version bump.
- `buildEntries` (`src/sidecar.ts:149`) validates: suggestion only on content lines; `target.quote` non-empty; `target.context` **required** (before/after strings, each may be empty); `replacement` a string, may be empty (= deletion). A `resolution` requires a `suggestion_id` referencing a surviving suggestion-carrying line in that thread, rejected if that suggestion is already decided — decided-at-most-once is enforced at append, not just in UI.
- New pure helpers in `src/threads.ts` (browser-safe like the rest): `decidedSuggestions(entries)` → `Map<suggestion_id, resolution>`, and `actionableSuggestion(entries, threadId)` → latest surviving undecided suggestion comment; earlier surviving ones are superseded. Derived on read; `Thread` shape unchanged.
- `deriveThreads`/`awaiting` need no changes — a suggestion comment is an ordinary content line.

### Strict locate + apply (`src/anchor.ts`, new `src/suggest.ts`, `src/server/app.ts`)

- `findTargetStrict(target, rawText)` in `src/anchor.ts`: the exact-fingerprint branch of `matchByContext` only — unique hit, `recovered: false`; no whitespace-normalized, fuzzy, or md-stripped recovery. Highlighting keeps using `findAnchorMatch`; only writes are strict (ADR 0001).
- Extract the grow-until-unique context capture from `web/src/render/createAnchor.ts:68` into `src/anchor.ts` as `captureContext(full, at, quote)`; `createAnchor.ts` imports it back (same cross-import pattern as `web/src/commentLines.ts:7`).
- New pure `applySuggestion(rawText, suggestion)` in `src/suggest.ts`: strict-locate, splice replacement, return new content or a typed refusal. Unit-testable without a server.
- New route `POST /api/suggestions/apply` (file, thread_id, suggestion_id, author): read md → `applySuggestion` → `writeFileSync` → append the qualified `resolved` event with `anchor_snapshot` (mirror `/api/comments/resolve`, `src/server/app.ts:645`) → return `{ content, version, entry }`. Read-splice-write happens synchronously in one handler; a locate refusal returns 409 and writes nothing.
- Extend `POST /api/comments/resolve` with optional `resolution`/`suggestion_id` passthrough (validated as above). Dismiss uses this; edit-mode accept uses it after splicing the buffer client-side.

### CLI (`src/cli.ts`)

- `comment` and `reply` gain `--suggest <replacement>` (empty allowed) and `--target <quote>` (defaults to `--quote` on `comment`; required with `--suggest` on `reply`). The CLI reads the raw md, requires a unique occurrence of the target (error tells the agent to pass a longer quote), and auto-captures the fingerprint via `captureContext` — agents never hand-craft context for targets.
- `get-thread`/`list-pending` output gains decided/actionable info from the new helpers so the agent sees suggestion state. No accept/reject commands (PRODUCT: deciding is browser-only).

### Frontend (`web/src/`)

- **No API-shape changes for reading**: `GET /api/comments` already returns raw entries and `groupThreads` (`web/src/commentData.ts:72`) passes unknown fields through — suggestion payloads reach the card with zero plumbing.
- Card diff: `presentableDiff` from `@codemirror/merge` — already a dependency (`web/src/Editor.tsx:17` uses its `MergeView`) — renders stacked current/proposed blocks with per-change highlights; empty replacement renders the explicit "(deleted)" state. New `SuggestionBlock` inside the thread card in `web/src/Comments.tsx`; Applied/Dismissed chips and the orphaned-for-deciding state reuse the quiet-outline-chip recipe (`DESIGN.md`).
- Accept, view mode: call the apply route, push returned `content` into the `lastWritten` echo-suppression ring (`web/src/App.tsx:203`) and bump the doc reload nonce — in-place re-render, no banner (PRODUCT). A 409/refusal flips the card to the orphaned treatment.
- Accept, edit mode: `findTargetStrict` against the live buffer, dispatch a CM `changes` transaction (undoable, autosaved), then post the qualified resolve. Reject both modes: qualified resolve only.
- `web/src/api.ts`: add `postApplySuggestion`, extend `postResolve` with the optional qualifier.
- `DESIGN.md` + `web/src/styles/tokens.css`: diff add/remove need **new hue semantics** — green and red are already claimed (live-state, danger) and the color table forbids repurposing. Add `--diff-add`/`--diff-del` token families and their table rows in the same change (keep-in-sync contract).

### Shipped docs (same change, per AGENTS.md contracts)

- `docs/agent-setup.md`: the doc-change rule becomes "answer with a suggestion" (PRODUCT), plus the `--suggest` flags. README gains the feature blurb; changelog entry at landing.

## Test plan

- `tests/sidecar.test.ts`: validation — suggestion on a reply accepted; missing `target.context` rejected; empty replacement accepted; `resolution` without valid `suggestion_id` rejected; **second resolution for the same suggestion rejected**. Derivation — actionable/superseded across a supersede chain; decided survives thread unresolve (reopen scenario); deleted actionable suggestion falls back to previous surviving one.
- `tests/anchor.test.ts`: `findTargetStrict` — unique fingerprint hit; whitespace-drift refused; duplicated span refused. `captureContext` — grows until unique, browser path still passes.
- New `tests/suggest.test.ts`: `applySuggestion` splice correctness incl. deletion and target-at-file-boundary; refusal writes nothing.
- `tests/server.test.ts`: apply route — file content + qualified event after accept; 409 on drifted target leaves file and sidecar untouched; extended resolve route validates the qualifier.
- Live (`npm run build && npm run build:web:dev`, disposable workspace on port 8099, torn down after): agent `node dist/cli.js comment --suggest ...` → open doc → card shows stacked diff → **Accept** → doc re-renders in place with no banner, disk content verified, card shows Applied chip → CLI `unresolve` → chip persists, no buttons. Second suggestion in a thread supersedes the first. Whitespace-edit near a target in edit mode → card flips orphaned, Accept gone. **Reject** → Dismissed chip, file untouched. Edit-mode Accept → change lands in buffer, ⌘Z undoes it.
- Sign-off: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Issues

Dependency-ordered tracer bullets (each blocked by the previous unless noted):

1. [#6](https://github.com/yangcheng0220/mdc/issues/6) — sidecar grammar + CLI `--suggest` (propose end-to-end)
2. [#7](https://github.com/yangcheng0220/mdc/issues/7) — render the suggestion diff on the thread card
3. [#8](https://github.com/yangcheng0220/mdc/issues/8) — Accept in view mode: strict locate, apply route, Applied chip
4. [#9](https://github.com/yangcheng0220/mdc/issues/9) — Reject, refine, and the decided/actionable lifecycle
5. [#10](https://github.com/yangcheng0220/mdc/issues/10) — Accept in edit mode (buffer splice)
6. [#11](https://github.com/yangcheng0220/mdc/issues/11) — shipped docs: agent-setup contract, README (blocked by #9 **and** #10)

## Risks

- **Apply writes user files.** Mitigated by strict locate (never writes on a non-unique or recovered match), the synchronous read-splice-write handler, and `applySuggestion` being pure and unit-tested before the route exists.
- **Watcher echo on accept**: the apply write fires `doc-changed` to every client; the accepting client suppresses via `lastWritten`, others correctly get the reload banner. Verify the suppression path live — it's the exact surface under change.
