# Doc actions menu

## Summary

A single ⋮ menu at the end of the doc toolbar collects the actions that act on the open file — copy its filename, its path, or its contents — and absorbs the existing End session item, so the toolbar carries one overflow menu instead of a kebab that appears only while an agent is watching. The same copy actions appear on file-tree right-click.

## Flows

### Copying from the open document

The user clicks the ⋮ at the right end of the doc toolbar. A dropdown (`DropdownMenu`) opens beneath it, right-aligned. Picking an item copies to the clipboard and shows a toast.

- The menu items are **Copy filename**, **Copy path**, **Copy contents**, in that order, each with a leading icon.
- **Copy filename** copies the basename with extension (`TECH.md`).
- **Copy path** copies the absolute filesystem path (`/Users/you/code/mdc/specs/doc-actions-menu/TECH.md`), the same form the Handoff prompt uses — an agent's working directory may differ from the workspace root.
- **Copy contents** copies the file's raw text, frontmatter included — never rendered HTML or visible-text-only.
- In edit mode with unsaved changes, **Copy contents** copies what is on screen, not the last-saved file. For markdown this is the editor buffer; for an `.excalidraw` file it is a serialization of the live canvas, including a change still waiting for autosave.
- While markdown conflict review shows the disk version beside the user's version, **Copy contents** copies the editable right-hand **Your version**, including merge edits not yet saved — never the left-hand disk version.
- While an agent suggestion is previewed in markdown edit mode, **Copy contents** includes the proposed replacement currently visible in the complete editor buffer even though it has not been accepted, and treats that previewed value as unsaved.
- If view mode shows **This doc changed on disk**, **Copy contents** copies the source snapshot still displayed, not the newer unseen disk value. Its toast meta ends with `· reload pending`; after **Reload**, the new source copies without that suffix.
- The ⋮ is present for every open file and never disabled; only its item list varies.
- **Copy contents** is shown for files that are text — markdown, `.excalidraw` / `.excalidraw.json` (their JSON), and HTML. It is hidden, not disabled, for images and PDFs, leaving a two-item menu.
- Escape or an outside click dismisses the menu, matching every other dropdown.

### Ending an agent session

While an agent is watching the open file, **End session…** appears as the last item of the same ⋮ menu, below a separator, in the danger color. Picking it opens the existing confirm dialog.

- This replaces the separate session ⋯ menu; there is no second kebab in the toolbar.
- The item is absent when no agent is watching *this* file — including when an agent is busy on another file — so the menu is copy-only in those states.
- The confirm dialog, its copy, and what ending a session does are unchanged.

### Where the ⋮ sits

The doc toolbar's right-hand cluster runs `[presence pill] [Handoff] [Comments] [⋮]`, with the ⋮ always last.

- For markdown, the Comments button still appears only when the comments sidebar is collapsed, and now sits before the ⋮ rather than after it. Non-markdown files do not show it.
- The presence pill and Handoff button still appear only for markdown files; the ⋮ remains for all file types, so for an image the ⋮ is the only right-side control.
- All toolbar items keep the toolbar's single uniform gap; no item gets bespoke spacing.

### Copying from the file tree

The user right-clicks a row in the files pane. The existing `ContextMenu` opens with the copy actions above a separator and **Delete** below.

- A file row offers **Copy filename**, **Copy path**, and — for text files only — **Copy contents**, matching what the toolbar ⋮ shows for that file.
- A folder row offers **Copy path**, added below its existing New file / New drawing / New folder items and above **Delete**. Folders offer neither Copy filename nor Copy contents.
- Copying acts on the right-clicked row, which need not be the open file.
- If the right-clicked row is the currently open text file, **Copy contents** matches the toolbar action: markdown and drawings use their live working version, while HTML uses the disk source loaded into the visible HTML surface. An inactive row is read from disk. HTML has no unsaved-buffer state, but its active displayed snapshot can be `· reload pending` after an external change.
- Every item in this menu carries a leading icon, including the three New … items that currently have none. New file / New drawing / New folder reuse the tree's own file, drawing, and folder icons; the copy actions use their own action icons.

### Confirming a copy

Each successful copy shows the existing toast: a title naming what was copied, and a dim meta line echoing the value.

- Titles are **Copied filename**, **Copied path**, **Copied contents**. The meta line carries the copied value; for contents it carries the filename and size (`TECH.md · 4.2 KB`), since the payload itself is too long to echo.
- Contents size is the UTF-8 payload size in decimal units: `0–999 B` uses whole bytes, KB uses one decimal, and `1 MB+` uses one decimal. Values round to one decimal and promote to the next unit rather than displaying `1000 KB`; a trailing `.0` is omitted (`4 KB`, not `4.0 KB`).
- When contents came from an unsaved markdown buffer or an Excalidraw canvas whose latest state has not completed saving, the meta line ends with `· unsaved`. There is no separate toast style for it.
- When view mode copies a displayed snapshot after a disk-change banner appears, the meta line instead ends with `· reload pending`.
- A meta line too long for the toast truncates from the **left**, keeping the filename end visible (`…/specs/doc-actions-menu/TECH.md`). Absolute paths routinely exceed the width, so this is the normal case for **Copy path**, not an edge case. The clipboard always receives the untruncated value.
- If the clipboard write fails, the toast reads **Copy failed** with `Clipboard access is unavailable.`
- If **Copy contents** cannot read the requested source, the toast reads **Copy failed** with `Couldn’t read TECH.md. It may have moved or been deleted.`, substituting the requested filename. Failure never replaces the clipboard with a partial or fallback value.

## Out of scope

- Keyboard shortcuts for the copy actions — the menu is the only entry point in this slice.
- Copying a folder's contents or a recursive file listing.
- Copying rendered/formatted output (HTML, or markdown with frontmatter stripped) — one raw-text form only.
- A separate workspace-relative path action — **Copy path** yields one form, the absolute one.
- Multi-select copy in the file tree; the tree acts on one row at a time.
- Comment threads or sidecar data in **Copy contents** — the doc text only, consistent with the sidecar never touching the doc.
