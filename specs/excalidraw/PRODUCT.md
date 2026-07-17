# Excalidraw drawings

## Summary

mdc renders `.excalidraw` files as drawings: a read-only canvas in view mode, the full Excalidraw editor in edit mode, with create and delete available from the files pane like any other file.

## Flows

### Viewing a drawing

The user clicks a `.excalidraw` file in the files pane (or reaches it via tabs / Cmd-K). The doc area shows the drawing on a read-only canvas.

- Recognized extensions: `.excalidraw` and `.excalidraw.json`. `.excalidraw.png` / `.excalidraw.svg` keep rendering as plain images, unchanged.
- View mode is interactive but non-mutating: pan, zoom, and select work; no action changes the file.
- The canvas follows mdc's light/dark theme.
- Drawings appear in the files pane, tabs, and Cmd-K palette like other viewable non-md files, with a distinct drawing icon in the files pane.
- Rendering and editing work fully offline — no network fetches.
- A file that isn't valid Excalidraw JSON shows an error state in the doc area (file name + "can't read this drawing"), not a crash.
- An empty scene renders as a blank canvas.
- When the file changes on disk while viewing, the canvas reloads to the new content automatically (same live-reload behavior as other views).

### Editing a drawing

The user flips the same edit toggle used for markdown docs. The canvas becomes the full Excalidraw editor — draw, add/edit shapes, text, arrows, images, styling, delete elements.

- Changes autosave to the `.excalidraw` file (debounced); there is no dirty state or explicit save action.
- Toggling back to view mode shows the saved drawing, read-only again.
- If the file changes on disk while editing, the existing "changed on disk" banner appears with a Reload action; Reload replaces the canvas with the disk content.

### Creating a drawing

The user opens the files-pane context menu (root or a folder) and picks **New drawing**, next to **New file**.

- The existing inline-create row appears with placeholder `name.excalidraw`; a bare name gets `.excalidraw` appended (the drawing counterpart of New file appending `.md`). Confirming creates an empty drawing at that path and opens it in edit mode.
- The plain **New file** inline create (context menu or the `+` button) keeps its `name.md` placeholder and still appends `.md` to bare names, but a name typed with an `.excalidraw` (or `.excalidraw.json`) ending creates an empty drawing instead.
- `mdc open` accepts `.excalidraw` paths like other viewable files.

### Deleting a drawing

The existing file delete flow (context menu → confirm dialog) applies to drawings unchanged.

## Out of scope

- Comment threads on drawings — anchors are text spans; commenting on a canvas is its own future feature.
- Rendering drawings embedded in markdown docs (` ```excalidraw ` fences or image-syntax references to `.excalidraw` files).
- Export to PNG/SVG from within mdc.
- Real-time collaboration on the same drawing.
- CLI or `window.mdc` bridge commands specific to drawings.
