# Doc actions menu — tech spec

Implements `specs/doc-actions-menu/PRODUCT.md`. Frontend only; no `src/` or server changes.

## Approach

### The menu component

- New `web/src/DocActionsMenu.tsx`, rendered by `DocToolbar` as a sibling of `HandoffControls` — **not** inside it. `HandoffControls` is suppressed for non-md (`DocToolbar.tsx:111`), but the ⋮ must survive for images and PDFs.
- Build on `DropdownMenu` (`web/src/DropdownMenu.tsx`), which already owns open state, outside-mousedown and Escape dismissal. Reuse the `comment-menu` classes the way `SessionMenu` does today (`HandoffControls.tsx:79-105`) — no new dropdown shell.
- Label the trigger **Document actions** (`title` and `aria-label`), give each action `role="menuitem"`, and render separators with `role="separator"`. Opening by keyboard leaves normal Tab order available; no arrow-key roving-focus work is added in this slice.
- Move **End session…** out of `HandoffControls.SessionMenu` into this menu, gated on the same `agentWatching` condition (`HandoffControls.tsx:31`); delete `SessionMenu` and the now-unused `onEndSession` prop from `HandoffControls`. `App.tsx`'s `onEndSession` and its confirm dialog are untouched.
- Toolbar order: render the ⋮ **after** the collapsed-sidebar Comments button in `DocToolbar`, so the kebab terminates the row. The existing `gap: 10px` on `.doc-toolbar` (`layout.css:115`) already spaces every item uniformly — add no per-item margins.
- Gate the collapsed-sidebar **Comments** button on markdown as well as `sidebarCollapsed`. It is currently gated only on `sidebarCollapsed` (`DocToolbar.tsx:120`), which would contradict PRODUCT's image case where the ⋮ is the only right-side control.
- Styles: reuse `.handoff-menu-wrap` / `.handoff-menu-btn` from `handoff.css:97-113` (they already force the kebab always-visible, overriding `.comment-menu-btn`'s hover-only opacity). Rename to `.doc-menu-*` since it's no longer handoff-scoped; keep the rules.

### What gets copied

- **Path is absolute**: add a pure `absolutePath(root, relative)` helper that removes a trailing `/` or `\` from the root before joining the index's POSIX-relative path, preserving a single leading separator for `/` and producing a slash-tolerant absolute path on Windows. Use the same helper in `reviewPrompt` (`App.tsx:404-406`) so Copy path and Handoff cannot drift. `IndexResponse.root` (`api.ts:14`) is already on the client via `useIndex`; no server change or shell quoting is needed.
- **Filename** is `file.split("/").pop()`.
- **Contents for open markdown** uses `viewRawContent` in view mode and derives `reloadPending` from the existing `docChanged` banner state; it never fetches an unseen replacement behind that banner. In edit mode, extend `Editor` to publish a copy state `{ content, saved }`: seed it with the exact loaded source; update it immediately from the main CodeMirror buffer; and, while conflict review is open, update it from the editable `MergeView.b` document. The merge view therefore copies **Your version** on the right, including chunks pulled from disk and manual merge edits, never the read-only left side. A pinned suggestion preview publishes the complete previewed buffer as unsaved; store the pre-preview saved flag so closing or dismissing the preview republishes the restored original with its prior status, while accepting leaves the proposed buffer unsaved until its exact save completes. Mark any published value saved only when that exact value completes saving and no newer buffer value has replaced it. Keep `editorRawContent` for the existing comments/suggestion consumers; do not infer copy freshness from the coarse toolbar `saveState`. Both raw values include frontmatter (`Editor.tsx:198` reports raw; `onContentChange` is the frontmatter-stripped one and is *not* what we want).
- **Contents for an open drawing** must include unsaved canvas changes. Add a callback from `ExcalidrawView` that publishes the exact disk text immediately after fetch and before parsing (so malformed-but-readable JSON still copies), then the latest `serializeAsJSON(...)` result after each real canvas change, together with whether that exact value has completed saving. App stores this copy state per active drawing and clears it on file switch. In view mode the published value remains the exact disk text; in edit mode it advances immediately with the canvas, before the debounced save. A save completion marks the value saved only if no newer canvas value has replaced it.
- **Contents for open HTML** must match the source loaded into the visible surface when one exists. Add an `onRawContentLoaded` callback through `HtmlSurface` to both `HtmlView` and `AppView`; each publishes the exact `fetchHtmlFile` result it uses for `srcDoc`. App clears that snapshot on file switch. If the trust prompt is still showing and no HTML source has rendered, Copy contents falls back to an on-demand `fetchHtmlFile(file)`. The existing `docChanged` state marks a published HTML snapshot `reloadPending` just like markdown until Reload causes the surface to publish its new source.
- **Contents from the file tree** first compares the target with `activeFile`. For an active text target with a published snapshot/state, reuse the same copy candidate as the toolbar. For an inactive target, or an active target whose source has not loaded yet, fetch on demand through the existing type-specific read: `fetchDoc(file)` for markdown, `fetchDrawing(file)` for `.excalidraw`, and `fetchHtmlFile(file)` for HTML. Tradeoff: one request per fallback/inactive copy rather than caching — the action is rare and caching would need invalidation against live-reload.
- Reuse `copyToClipboard` (`App.tsx:1637`), already used by the handoff fallback. It returns success, which drives the stable `Clipboard access is unavailable.` failure toast; do not expose browser exception text. Wrap each on-demand source read separately so a rejected request instead shows `Couldn’t read <filename>. It may have moved or been deleted.` and never attempts a clipboard write.
- Close the menu before starting an async read. Give copy attempts a monotonically increasing id and ignore a read result unless it is still the latest attempt. Serialize actual clipboard writes through a small App-owned promise queue and re-check the id immediately before each write/toast, so the last invoked action wins even if an earlier read or clipboard promise is slow.

### Which items show

- Item visibility keys off "is this file text", not `isNonMd`. Markdown, `.excalidraw` (`isDrawing`), and HTML (`isHtml`) get **Copy contents**; images and PDFs don't. `isNonMd` (`App.tsx:132`) stays as-is for the existing surface routing and markdown-chrome suppression — do not repurpose it as the text predicate.
- Introduce one predicate in `App.tsx` beside the existing type callbacks (`isImage`/`isHtml`/`isPdf`/`isDrawing`) and pass it down, so the toolbar and the tree agree by construction rather than by two parallel conditionals.

### File-tree menu

- Change the private `MenuItem` model in `web/src/ContextMenu.tsx:10` to a discriminated union of actionable items (`label`, `icon`, `onSelect`, optional `danger`) and separators. Render separators non-interactively with `role="separator"`; render each action's icon before its label. This is required for the copy/Delete sections described in PRODUCT — `ContextMenu` currently supports neither icons nor separators.
- `New file` / `New drawing` / `New folder` reuse `FileIcon` / `DrawingIcon` / `FolderIcon` from `icons.tsx` — the same glyphs the tree puts on rows (`FilesPane.tsx:242-250`). The copy actions use their own action icons; do **not** give `Copy contents` the `FileIcon` (it would read as "a file", not "its text").
- Add dedicated shared glyphs for Copy filename, Copy path, and Copy contents to `icons.tsx`; the toolbar and tree both use them, satisfying the file's second-use promotion rule. Change both menu action rows to flex alignment with the established compact gap, and add separator rules using `var(--border)` rather than an ad-hoc color.
- Add the copy items to `openContextMenu` (`Nav.tsx:171-193`): file rows get filename/path/(contents), then a separator and **Delete**; folder rows get the three create actions, a separator, **Copy path**, another separator, then **Delete**. Root keeps its three create actions with no separator. Give **Delete** the existing `TrashIcon`, since PRODUCT requires an icon on every action.
- `Nav` already receives `root`; add the text-file predicate and an App-owned copy callback as props. App continues to own the async reads, clipboard write, and toast, while `Nav` only identifies the right-clicked target and builds menu sections.

### Toast

- Reuse `useToast` (`web/src/useToast.ts`) and the existing `Toast` (`Toast.tsx`). Titles `Copied filename` / `Copied path` / `Copied contents`; `meta` carries the value, or `` `${name} · ${size}` `` for contents. Append `· unsaved` when the published markdown or drawing value has not completed saving; append `· reload pending` when copying the displayed view-mode snapshot behind a disk-change banner.
- Compute contents size with `TextEncoder().encode(content).byteLength` so non-ASCII text reports its actual UTF-8 clipboard payload. Format with decimal units (1 KB = 1,000 bytes; 1 MB = 1,000,000 bytes), round to one decimal above bytes, promote when rounding would display `1000 KB`, and strip a trailing `.0`.
- Add a semantic `truncateMetaFromStart` flag to `ToastData`, used only by successful copy confirmations. `Toast` applies a block-level overflow class (`min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; direction: rtl`) and wraps the copied value in `<bdi>`. **The `<bdi>` is required** — without it, RTL reorders a leading `/` to the end (`/Users/…/TECH.md` renders as `Users/…/TECH.md/`) whenever the text does *not* overflow. Verified in the design mockup. Failure and ordinary prose toasts keep their current wrapping/direction.
- For contents meta, keep the size/status suffix in a non-shrinking LTR span and apply start-ellipsis only to the filename span, yielding `…long-name.md · 4.2 KB · unsaved` rather than truncating away the filename to preserve only the size. The toast's copy-meta row therefore needs flex layout; filename/path `<bdi>` content remains isolated from the RTL truncation container.

### Docs to update in the same change

- **`CHANGELOG.md`** — an `### Added` entry under `[Unreleased]` (the `changelog` skill, invoked by `create-pr`/`done`).
- **`DESIGN.md`** — two additions, both new vocabulary the doc can't currently supply: (1) start-truncating copied-value meta (`direction: rtl` + `<bdi>`) beside the existing dark-chip/`--toast-*` guidance, including *why* the `<bdi>` is required and how contents keep their size/status suffix fixed while truncating only the filename; (2) a rule under the component-inventory rules — menu items naming a *kind of thing* reuse the tree's type glyphs (`FileIcon`/`DrawingIcon`/`FolderIcon`), items naming an *action* use dedicated action glyphs.
- **Not** `README.md` (capabilities, not menu inventory), `docs/mini-app-guide.md` (no bridge change), or `.mdc.toml.example` (no config). **`docs/agent-setup.md`** needs no change — End session moves but behaves identically, and the doc names the button, not its location (`agent-setup.md:49,53,57`); re-read those lines at implementation time to confirm none describe where it sits.

## Test plan

Build the frontend, prepare a disposable workspace containing markdown with and without frontmatter, HTML, a valid and malformed drawing, an image, a PDF, and a deeply nested path, then serve that fixture with the working-tree CLI:

```
npm run build:web:dev
mdc_actions_fixture="$(mktemp -d)"
# Populate "$mdc_actions_fixture" with the fixture files listed above.
node dist/cli.js serve "$mdc_actions_fixture" --port 8099 --static-dir web/dist-dev --no-open
```

Frontend-only, so `npm run build` is not needed; reload the tab after each rebuild. All typing, paste checks, external rewrites, deletes, and conflict setup happen only in the disposable fixture. After verification, stop the server with `node dist/cli.js stop --port 8099` and remove the fixture directory.

**Live verification**:

- Toolbar ⋮ with no agent: three copy items, no End session. Each item copies and toasts; paste into the editor to confirm the clipboard payload.
- Copy contents on the frontmatter fixture — confirm the leading `---` block is present. Then collapse the frontmatter block in the doc pane and copy again: frontmatter must still be in the clipboard (collapse is a view preference).
- Markdown edit mode: type a change and copy before autosave completes → clipboard has the typed text and the toast meta ends `· unsaved`.
- Markdown conflict review: change the editable right side (including pulling over a disk chunk) and copy before **Save result** → clipboard matches the complete right-hand document, not the left-hand disk version, and the toast ends `· unsaved`.
- Markdown suggestion preview: preview a replacement and copy before deciding it → clipboard contains the complete buffer with the proposed replacement and the toast ends `· unsaved`; dismiss or close the preview and copy again → the original buffer and its prior saved/unsaved status are restored.
- Markdown view mode: change the file externally until **This doc changed on disk** appears, then copy → clipboard matches the still-displayed pre-change source and the toast ends `· reload pending`; choose **Reload** and copy again → clipboard has the new source without the suffix.
- Drawing edit mode: move a shape and copy before autosave completes → clipboard JSON contains the new coordinates and the toast meta ends `· unsaved`. Copy again after that exact value saves → the same current canvas content copies without the suffix.
- Malformed drawing: open an indexed `.excalidraw` whose JSON cannot render → Copy contents still copies its exact raw disk text; rendering failure does not remove a text action.
- Start a watching agent on the open file → **End session…** appears below a separator and opens the existing confirm dialog. Confirm there is exactly one kebab in the toolbar in this state.
- Collapse the comments sidebar → Comments button sits left of the ⋮, all gaps even; the ⋮ remains the last control.
- Open an image and a PDF → ⋮ present with two items, no Copy contents, no Handoff or Comments controls. Open `.excalidraw` and `.excalidraw.json` → three items including Copy contents (JSON), still no markdown-only controls.
- Right-click a tree file row that is *not* active → copy items read that row from disk, not the open file. Right-click the active markdown/drawing while it has an unsaved or preview value → Copy contents matches the toolbar's live payload and `· unsaved` status. Right-click active HTML after an external disk change → it copies the still-rendered HTML snapshot with `· reload pending`. Right-click a folder → it offers Copy path as its only copy action, between the create and Delete sections. Check every `ContextMenu` action has an icon and separators are non-interactive; check the root create-only variant too.
- Long path: open a deeply-nested doc and Copy path → toast truncates on the **left**, filename visible. Then a short path → leading `/` renders correctly (the `<bdi>` regression).
- Deny or stub clipboard access → any copy action shows **Copy failed** / `Clipboard access is unavailable.` Stub an on-demand source read to fail → **Copy contents** shows **Copy failed** / `Couldn’t read <filename>. It may have moved or been deleted.` and does not change the clipboard.
- Delay an inactive row's source response, invoke its **Copy contents**, then invoke **Copy path** on another target before the read resolves → only the later path reaches the clipboard and success toast.
- Open the toolbar menu from its focused trigger; Tab reaches its actions, Escape and outside click close it, its separator never receives focus, and the trigger is announced as **Document actions**. Confirm ContextMenu separators are likewise non-focusable during pointer use.
- Both themes, via the theme toggle.

**Unit tests** (vitest): a `copyTargets`-style module holding the pure parts — absolute path construction, basename, UTF-8 byte-size formatting, status/meta assembly, and which items a given file type yields — tested per file type. Cover POSIX root `/`, a trailing-separator root, and a Windows drive root; 0/999/1,000/near-1,000,000/1,000,000-byte boundaries including unit promotion; trailing-`.0` removal; and a non-ASCII string whose UTF-8 byte count differs from `string.length`. The clipboard call and menu wiring stay untested (DOM/permission-bound); the live checks above cover them.

**Sign-off before commit**: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Risks

- Removing `SessionMenu` touches the live handoff path. Mitigation: `onEndSession` and its dialog are unchanged — only the trigger moves; the watching-state live check above exercises it.
- `knip` will flag `onEndSession` on `HandoffControls` if the prop is left behind after the move. Remove it in the same change.
- Markdown, drawing, and HTML surfaces now publish copy snapshots across async loads/saves. Clear state on every active-file change, tag publications with their file, and accept a saved completion only when its content still equals the latest published value; the live tests exercise stale-file and newer-edit races.
