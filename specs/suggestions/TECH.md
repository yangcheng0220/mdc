# Suggestions — tech spec

Three bounded slices. **v1 (shipped, #6–#11)**: the Approach / Test plan / Issues / Risks sections below describe the original suggestion implementation. **Dismissal without resolution (#42)**: its compatibility encoding, turn derivation, UI behavior, and tests follow the v1 risks. **Inline preview (in progress)**: its own approach, test plan, and risks are at the end; tickets in *Issues — inline preview*.

Implements [PRODUCT.md](./PRODUCT.md). Grammar decisions are settled in `docs/adr/0001` (self-contained strict targets), `docs/adr/0002` (qualified resolves, decided-at-most-once), and `docs/adr/0004` (dismissal decides without resolving); vocabulary per `CONTEXT.md`.

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

---

# Dismissal without resolution

Implements ADR 0004 and issue #42 without adding an event type that older readers would ignore.

## Approach — compatible decision encoding

- A dismissal appends two existing events in one atomic sidecar write: first a qualified `resolved` event with `resolution: "dismissed"` and `suggestion_id`, then an ordinary `unresolved` event for the same thread. Current readers derive the decision from every qualified resolve and the conversation state from the latest resolve/unresolve event, so the suggestion is permanently dismissed while the thread is open.
- This pair is safe for 0.2.x readers. They already preserve a qualified decision across a later unresolve, so they also derive the suggestion as decided and not actionable while showing the thread open. Both lines use known event types and fields; no mixed-version reader can expose a double-decide path.
- `POST /api/comments/resolve` keeps accepting the existing dismissal payload for compatibility with already-built frontends, but prepares and appends the pair when `resolution` is `dismissed`. Ordinary resolves and applied decisions remain single events. `buildEntries` validates the pair sequentially, preserving the existing actionable-only and decided-at-most-once guards.
- `deriveThreads` treats a qualified suggestion decision as a turn alongside surviving comments and replies. Lifecycle, edit, and delete events do not count as turns. The dismissing user's decision therefore makes the reopened thread `awaiting: "agent"`; a later reply or suggestion becomes the latest turn normally. `list-pending`, file badges, and `watch` inherit this through `openThreadsAwaitingAgent`.

## Approach — review surfaces

- Every Reject entry point continues through `onDismissSuggestion`: margin card, orphaned card, pinned view-mode chip, and edit-mode inline chunk. After the sidecar pair lands, the Open card stays visible with its Dismissed indicator and no decision buttons.
- The app opens the sidebar if necessary and sends a one-shot prompt nonce to that thread card. The card opens and focuses the shared reply composer with `Why? (optional — helps the agent revise)`. Escape, Cancel, or blurring an empty dismissal prompt collapses it without posting a content line; a later ordinary Reply returns to the normal placeholder.
- A successful dismissal has no toast. View and edit mode use the Dismissed indicator plus focused composer as feedback. Accept behavior and its confirmation toast are unchanged.
- `docs/agent-setup.md` describes the receiving protocol: a dismissal followed by a reason is a refine request; a silent dismissal is acknowledged briefly and then resolved; neither path blind-guesses a replacement.

## Test plan — dismissal without resolution

- Core: a qualified dismissal followed by unresolve remains decided and open, changes `awaiting` to the dismissing user, appears in `openThreadsAwaitingAgent`, and keeps the existing second-decision rejection.
- CLI/server: `list-pending` reports the dismissed-open thread with `actionable: null`; the resolve route writes the two-event pair atomically and leaves the document byte-identical.
- Live (both builds, disposable workspace, scratch port): reject from the margin card, pinned chip, edit-mode chunk, and orphaned card; verify each keeps the thread open, removes decision actions, focuses the optional-reason composer, writes no document bytes, and reaches `list-pending`/`watch`. Then resolve and unresolve once to verify the Dismissed indicator persists. Recheck one Accept path for unchanged apply-and-resolve behavior.
- Sign-off: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

---

# Inline preview slice (planned)

Implements the "Inline preview" flow + the card-collapse bullet in [PRODUCT.md](./PRODUCT.md). No sidecar-grammar, CLI, or server changes — this is a rendering/interaction layer over shipped v1; accept/reject reuse the existing `onApplySuggestion`/`onDismissSuggestion` handlers (`web/src/App.tsx`).

## Approach — view mode

- **Locating the affected blocks.** Lex the doc body with `marked`'s lexer (already the renderer, `web/src/render/markdown.ts:53`) and find the top-level token(s) whose raw offsets overlap the target span located by `findTargetStrict` against the raw content the card already holds (`rawContent` plumbing from #16). Top-level tokens map ~1:1 to the body container's element children (skip `space` tokens); a new pure `blockRangeForSpan(body, start, end)` returns `{tokenRange, elementRange, rawSlice}` and is the unit-testable heart. **If alignment can't be established, don't guess — fall back to no preview with the card diff expanded** (mirror of prefer-orphan).
- **The swap never mutates doc DOM** (same philosophy as `render/highlights.ts` overlay rects): pinning hides the affected elements (class, not removal) and inserts a preview container sibling; closing removes the container and unhides. Preview HTML comes from `renderMarkdown` over the current raw slice and the proposed raw slice (`applySuggestion` output cut to the same expanded block range).
- **Word-level marking inside the preview container only** (our DOM — wrapping is safe there): when current/proposed block counts and types pair 1:1, mark per-block via `presentableDiff` (reuse `shapeSuggestionDiff`, `web/src/suggestionDiff.ts`) mapped onto text nodes with the NodeSpan-walk pattern from `highlights.ts`; otherwise render the PRODUCT fallback — stacked current→proposed blocks in place, `--diff-del`/`--diff-add` washes.
- **Preview state** is one `previewedSuggestionId` owned by `App.tsx` (single preview invariant for free); the highlight overlay hides the previewed thread's rects while pinned (they'd float over hidden blocks) and recomputes on close. Esc handling follows the DESIGN.md escape-layering rule; scroll restore captures the doc container's `scrollTop` at pin and restores it on close.
- **Floating decision chip**: dark-chip family (`--toast-*`, like `.sel-toolbar`, `web/src/styles/comments.css:52`) anchored to the preview container — Accept / Reject / close calling the same App handlers; buttons disable while a decision is in flight, mirroring the card.
- **Card collapse** in `SuggestionBlock` (`web/src/Comments.tsx`): when `shapeSuggestionDiff` output exceeds ~10 rendered lines, render a one-line `+X −Y` summary + **Preview in doc** button (the pin action). Threshold constant, not config.
- **Mark-click**: the existing mark-click→card jump (`DESIGN.md` comment-mark grammar) additionally pins the preview when the thread has an actionable suggestion. Superseded/decided/orphaned: no preview entry points (PRODUCT).

## Approach — edit mode

- Pinning dispatches the existing `buildSuggestionEdit` transaction (`web/src/editor/commands.ts`) with a `unifiedMergeView` extension enabled (original = pre-edit buffer; `@codemirror/merge` already a dep and exports `acceptChunk`/`rejectChunk`), so the change renders as an inline chunk with merge controls at the target. Accept = keep the edit + post the qualified resolve (the #17 path, minus the re-splice); Reject/close = `rejectChunk`/undo, buffer restored.
- **Autosave is suspended while a preview is pinned** — otherwise the previewed-but-undecided edit persists to disk. Closing (or navigating away, or the session ending) reverts the buffer first. This is the risky bullet; see Risks.
- **One diff vocabulary across merge views**: theme `unifiedMergeView` *and* the existing conflict `MergeView` (`web/src/Editor.tsx:17`) with the `--diff-add`/`--diff-del` token families — CodeMirror's default ins/del colors would otherwise put a second diff color language on the same surface. The conflict flow's *interaction* (theirs-vs-yours takeover) stays as is; only its colors join the system. DESIGN.md's diff rows gain the merge views in "used for" in the same change.

## Test plan — inline preview

- Vitest: `blockRangeForSpan` alignment on fixture docs (paragraph, list, heading, fenced code, html block, doc-boundary targets; `space`-token skipping; misalignment → null). Pairing decision (1:1 word-marked vs stacked fallback) as a pure function. Collapse threshold logic.
- Live (both builds, disposable workspace, 8099): pin from card → affected paragraph swaps to marked diff, rest of doc untouched; pin from the in-text mark → same + card focused; Esc → doc and scroll position restored (verify on a doc long enough to scroll); structure-changing suggestion (adds a heading) → stacked fallback; decide from the floating chip → same outcome as the card path (Accept writes and resolves; Reject leaves the document untouched and the thread open); section-sized suggestion → card shows `+X −Y` summary and Preview in doc. Edit mode: pin → inline chunk at target, ⌘Z/close restores, disk unchanged while pinned (check mtime/content), Accept → resolve + autosave resumes.
- Sign-off: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Issues — inline preview

Tracer bullets (parent #19); #28 and #29 start immediately, the rest follow their edges:

1. [#28](https://github.com/yangcheng0220/mdc/issues/28) — pin a suggestion's diff in the doc (view mode) — the tracer bullet
2. [#29](https://github.com/yangcheng0220/mdc/issues/29) — merge views speak the design system's diff vocabulary
3. [#30](https://github.com/yangcheng0220/mdc/issues/30) — floating decision chip at the pinned preview (blocked by #28)
4. [#31](https://github.com/yangcheng0220/mdc/issues/31) — mark-click entry + threshold-collapsed card diffs (blocked by #28)
5. [#32](https://github.com/yangcheng0220/mdc/issues/32) — edit-mode preview as an inline merge chunk (blocked by #28, #29)
6. [#33](https://github.com/yangcheng0220/mdc/issues/33) — README + screenshot (HITL; blocked by #30, #31, #32)

## Risks — inline preview

- **Token↔DOM alignment drift** (custom heading renderer, html blocks): mitigated by the unit-tested `blockRangeForSpan`, the no-guess fallback to card-only, and never mutating doc DOM.
- **Edit-mode autosave suspension**: a crash/tab-close while pinned must not leave the previewed edit on disk — the edit exists only in the buffer and autosave is off, so worst case is losing the pin, never persisting an undecided change. Verify by killing the tab mid-preview.
