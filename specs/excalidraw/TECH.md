# Excalidraw drawings — tech spec

Product behavior: [PRODUCT.md](./PRODUCT.md). Drawings become a fourth non-md file class alongside images/htmls/pdfs, following the same separate-channel pattern end to end.

## Approach

### Backend (`src/server/`)

- `walk.ts`: new `isDrawingName(name)` — `endsWith(".excalidraw") || endsWith(".excalidraw.json")` — and `buildDrawingIndex` beside `buildImageIndex` (`walk.ts:115`). Can't use `extOf` (last-dot) for the double extension. `.excalidraw.png`/`.svg` already classify as images via `IMAGE_EXTS`; unchanged.
- Server state + `rescan()` gain `drawingIndex`; `/api/index` response gains `drawings` (mirror `images`).
- New `GET /api/drawing?file=` → `{ content, version }` and `PUT /api/drawing` with `{ content, baseVersion }` → 409 on mismatch — mirrors `PUT /api/md` (`app.ts:247`) incl. `fileVersion`, but resolves against `drawingIndex` (that's why `/api/md` can't be reused: `resolveFile` checks the md-only index).
- `POST /api/file` (`app.ts:879`): accept drawing names; write an empty-scene constant (`{"type":"excalidraw","version":2,"source":"mdc","elements":[],"appState":{},"files":{}}`) instead of `""`. Other non-`.md` extensions still 400.
- `POST /api/open` (`app.ts:1085`): add `drawingIndex` to the openable check. That alone makes `mdc open <file>.excalidraw` work; update the CLI `open` help text (`cli.ts:1026`) and `docs/agent-setup.md` per the keep-in-sync contract.
- **No change**: `DELETE /api/file` (already extension-agnostic), watcher (chokidar watches the whole root — `doc-changed` already fires for `.excalidraw` paths), sidecar/anchoring core.

### Frontend (`web/src/`)

- New dep `@excalidraw/excalidraw@^0.18.1` (peer-supports React 19). Loaded with `React.lazy` inside the new view so the main chunk is untouched; the ~1 MB excalidraw chunk fetches only when a drawing opens.
- **Offline assets (the risky bullet)**: excalidraw runtime-loads fonts from a CDN unless `window.EXCALIDRAW_ASSET_PATH` points elsewhere. Copy `node_modules/@excalidraw/excalidraw/dist/prod/fonts/` into the web build (vite static-copy step in `web/vite.config.ts`) and set the global before mount. Also needs `import "@excalidraw/excalidraw/index.css"` and the documented `define: { "process.env.IS_PREACT": "false" }`.
- New `ExcalidrawView.tsx` — props `{ file, editing, reloadNonce, onSaveStateChange }`:
  - view: `viewModeEnabled`; edit: `onChange` → debounce `AUTOSAVE_MS` (600 ms, same as `Editor.tsx:32`) → `PUT /api/drawing` with `baseVersion` chained through saves; 409 → `conflict` saveState.
  - unparseable JSON → broken-file placeholder (reuse the `ImageView` broken pattern); theme from `theme.ts`.
- `App.tsx`: `isDrawing` beside `isImage` (`App.tsx:103`); render branch before the editor/doc branches (`App.tsx:1275`) passing `editing={editingFiles.has(activeFile)}` — the existing `editingFiles` set is the drawing's view⇄edit state too. Drawings **join `isNonMd`** (keeps comments pane, `useComments` gate at `App.tsx:120`, and pending-comment UI off) but the `onToggleEdit` gate (`App.tsx:1247`) becomes "md or drawing" so the mode toggle shows.
- Changed-on-disk: view mode reloads via the existing `docReloadNonce` bump; edit mode routes the `onDocChanged` branch (`App.tsx:235`) to the existing `DocBanner` + Reload instead of `notifyExternalChange`. Self-saves must not trigger the banner — compare the echoed save `version`, same trick as `Editor`'s `onDirtyChange(savedContent)` path.
- `Nav.tsx`: "New drawing" in both context menus (`Nav.tsx:176,181`); `CreateTarget.kind` gains `"drawing"`. Extract the name rule from `commitCreate` (`Nav.tsx:149`) into a pure `resolveCreateName(kind, name)`: kind drawing → append `.excalidraw` to bare names; kind file → drawing extensions pass through, else append `.md`. Fresh-create-opens-in-edit already works (`App.tsx:1087` adds the new path to `editingFiles`).
- `InlineCreate.tsx`: kind `"drawing"` → placeholder `name.excalidraw` + `DrawingIcon` (new, in `icons.tsx`).
- Plumbing, each mirroring `images`: `api.ts` (`IndexResponse.drawings`, `fetchDrawing`/`saveDrawing`), `useIndex.ts` fingerprint (`useIndex.ts:27`), `FilesPane.tsx` `drawings` prop + icon, `openablePaths` for Cmd-K (`App.tsx:1376`), delete-confirm kind label (`App.tsx:1440`).

## Docs to update

**`README.md` and `docs/agent-setup.md` land as their own human-reviewed ticket after the feature slices** (wording and screenshots decided with the maintainer), deliberately deviating from the same-change keep-in-sync default:

- **`README.md`** — the supported-types enumerations (`README.md:7`, `:50`) gain drawings; the feature list gains a "draw diagrams" bullet with the create flow; screenshot candidate.
- **`docs/agent-setup.md`** — three touches: the file-types line (`:5`); the "margin comments are markdown-only" list (`:7`) gains drawings among the view-only types; and a new short section telling the agent how to work with drawings: **a `.excalidraw` file is Excalidraw scene JSON — create or edit one by writing the file directly with your own file tools** (the empty-scene shape from this spec, elements per the standard Excalidraw schema), then `mdc open` it; the canvas live-reloads like any doc. No new CLI commands — the file *is* the interface, same as the sidecar model.

Same-PR as their code (keep-in-sync applies as usual):

- **CLI `open` help text** (`cli.ts:1026`) — with the `/api/open` change.
- **`CHANGELOG.md`** — at land time via the `changelog` skill, as usual.
- **Not needed**: `docs/mini-app-guide.md` (bridge untouched), `.mdc.toml.example` (no config), `DESIGN.md` only if the icon/error-placeholder ends up introducing vocabulary rather than reusing the image-view patterns (expected: reuse-only).

## Test plan

- **Unit (vitest)**: `walk` — drawing classification (`.excalidraw`, `.excalidraw.json`, `.excalidraw.png` stays image); server — GET/PUT `/api/drawing` round-trip, PUT 409 on stale `baseVersion`, create writes the empty scene for drawing names and still 400s `.txt`; `resolveCreateName` — the extension table from PRODUCT.md's create flows.
- **Live (8099, disposable workspace, torn down after)**: `npm run build && npm run build:web:dev`, `node dist/cli.js serve <tmp root> --port 8099 --static-dir web/dist-dev --no-open`, then:
  1. Files pane → right-click folder → **New drawing** → bare name → file lands as `name.excalidraw`, opens in edit mode; draw a rectangle, wait 1 s, `cat` the file — element persisted.
  2. Toggle **View**: pan/zoom work, file bytes unchanged; toggle back — content intact.
  3. `+` → type `d2.excalidraw` → drawing; type `notes` → `notes.md` still.
  4. Append a shape to the file from the shell while in view mode → canvas updates; touch it while in edit mode → "changed on disk" banner, Reload replaces canvas.
  5. Write `not json` to a `.excalidraw` file → error placeholder, no crash.
  6. Context-menu delete removes it; `node dist/cli.js open <abs>.excalidraw` focuses the tab.
  7. Devtools Network while drawing: zero requests to external hosts (fonts load from the served build).
- **Sign-off**: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Risks

- **Autosave ↔ watcher loop**: our own PUT fires `doc-changed`; without the version-echo guard the edit session banners itself on every stroke. Covered by live step 4 plus drawing while watching for the banner.
- **Silent CDN fallback**: if the asset path is wrong, excalidraw quietly fetches fonts online and the offline requirement fails unnoticed — live step 7 is the guard.
- **knip** may flag the static-copied font assets or the lazy chunk; configure rather than suppress.
