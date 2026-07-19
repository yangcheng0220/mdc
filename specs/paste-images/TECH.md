# Paste and drop images — tech spec

Product behavior: [PRODUCT.md](./PRODUCT.md).

## Approach

### Backend (`src/server/`)

- New `POST /api/asset?doc=<root-rel>&name=<suggested>` taking the raw image bytes as the request body (`await c.req.arrayBuffer()` — no multipart). Validates: `doc` is in `state.index` (pasting only targets a real doc), `name`'s extension ∈ `IMAGE_EXTS` (`walk.ts:26`), and the resolved target stays under root via `resolveWithinRoot` (`paths.ts:90`) — which also rejects `../` smuggled in `name`.
- The server owns placement and dedupe (atomic against concurrent writers): target dir is `dirname(doc) + "/assets"` (mkdir recursive), a taken name gets `-1`, `-2`… before the extension. Responds `{ path, ref }` — `path` root-relative for the index, `ref` the doc-relative `assets/<final>` the client inserts.
- Body cap ~25 MB → 413; a retina screenshot is single-digit MB.
- Ends with `rescan()` so the new file and (possibly new) `assets/` dir are indexed immediately.
- **No change**: `resolveImage` and the render pipeline (the inserted ref resolves via the existing doc-relative step), watcher, sidecar/anchoring.

### Frontend (`web/src/`)

- The client owns naming intent: clipboard images get `pasted-YYYYMMDD-HHMMSS.<ext>` (mime→ext map, unknown → `.png`) from a pure helper `pastedImageName(now, mime)` in a new `web/src/editor/imagePaste.ts`; dragged files send their own name. Server only dedupes.
- `api.ts`: `uploadAsset(doc, name, blob)` → `{ ref }`.
- New editor extension in `imagePaste.ts`, registered in `createEditorExtensions` (`editor/extensions.ts`), following the `EditorView.domEventHandlers` pattern already used for comment markers (`Editor.tsx:321`):
  - `paste`: if `clipboardData.getData("text/plain")` is non-empty → return false (default text paste untouched — this guard protects the editor's most-used gesture). Else the first `image/*` item uploads; on resolve, dispatch `![](ref)` at the captured selection with the cursor placed between the alt brackets.
  - `drop` + `dragover`: `preventDefault`; files filtered by `IMAGE_EXTS`-style extension check; insertion point from `view.posAtCoords`; one `![](ref)` per line for multi-file drops; a drop with zero image files fires the error callback ("Only images can be dropped into a doc") and inserts nothing.
  - Tradeoff, stated: insertion dispatches after the async upload at the captured position clamped to doc length — a mid-upload edit can shift the insert by its delta. Upload is a localhost round-trip (ms); placeholder-tracking machinery isn't worth it for v1.
- `Editor.tsx` gains two callback props wired in App: `onAssetError` → `toast.show` (toast lives in App only, per current pattern) and `onAssetCreated` → `reloadIndex()` so `assets/` and the image appear in the files pane without waiting for the 5 s poll.
- View mode: handlers on App's doc-area container, active when the file is a non-editing doc — an image-bearing paste (no text) or any file drop shows the toast "Switch to Edit to add images" and inserts nothing. Text paste/selection in view mode untouched.

## Test plan

- **Unit (vitest)**: server route — writes `guides/assets/x.png` beside `guides/setup.md`, creates `assets/` on first use, dedupes to `x-1.png`, 400 on `.txt` name, 404 on unindexed doc, 404/blocked on `name` containing `../`, 413 over cap, response `ref` matches disk; `pastedImageName` — timestamp format + mime map.
- **Live (8099, disposable workspace, torn down after)**: build both targets, serve; then in the editor of a nested doc:
  1. Synthetic `ClipboardEvent` carrying a PNG `File` (constructed `DataTransfer`) → file lands at `assets/pasted-*.png` with matching bytes, editor shows `![](assets/pasted-*.png)` with cursor inside `[]`, files pane shows the new `assets/` folder without a manual refresh.
  2. Toggle to view → image renders inline.
  3. Synthetic drop of two image files at a line's coords → two refs, one per line, at the drop point; original names kept; second drop of a same-named file → `-1` suffix on disk and in the ref.
  4. Synthetic drop of a `.txt` → toast, doc text unchanged, nothing written.
  5. Paste with clipboard carrying text + image → plain text pasted, no upload request fired (network tab).
  6. In view mode, image paste and file drop → toast "Switch to Edit to add images", doc bytes unchanged.
- **Sign-off**: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Risks

- **Regressing ordinary paste** is the real hazard: the interception must engage only when the clipboard has an image and no `text/plain`. Live step 5 guards it; the unit of decision is one early-return at the top of the handler.
- **Binary write surface**: first route that writes request bytes to disk — extension allowlist + root confinement + size cap are all asserted in server tests.

## Follow-ups

- README/user-docs mention (user-facing docs are maintainer-reviewed — split per the drawings-arc pattern, decide at ticketing).
- View-mode drop-onto-block insertion if edit-only proves limiting (per PRODUCT.md).
