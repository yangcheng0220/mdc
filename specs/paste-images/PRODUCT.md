# Paste and drop images into docs

## Summary

An image on the clipboard or dragged from the file manager lands in the workspace and its reference lands in the doc, in one gesture — no manual file moving or path typing. The screenshot-to-doc flow becomes: screenshot, ⌘V.

## Flows

### Pasting a screenshot (edit mode)

The user copies or screenshots an image, places the cursor in the editor, and presses ⌘V. The image file is written into the workspace, a markdown image reference is inserted at the cursor, and the file appears in the files pane.

- Storage: an `assets/` folder beside the doc (`guides/setup.md` → `guides/assets/`), created on first use.
- Naming: `pasted-YYYYMMDD-HHMMSS.png` (clipboard image format preserved when it isn't PNG).
- Inserted text: `![](assets/pasted-….png)` with the cursor placed inside the alt brackets, so typing immediately after pasting writes the alt text.
- A clipboard holding plain text pastes as text, exactly as today; the image path only engages when the clipboard carries an image and no text.
- Toggling to view mode renders the image inline; the new file shows in the files pane under `assets/` with the image icon.
- If writing the file fails, a toast reports it and nothing is inserted into the doc.

### Dragging image files in (edit mode)

The user drags one or more image files from the file manager onto the editor. Each file is copied into the same `assets/` convention and a reference per image is inserted at the drop point, one per line.

- Dragged files keep their original names; a taken name gets a `-1`, `-2`… suffix.
- Only image files (the extensions mdc already renders) are accepted; a drop containing none shows a toast — "Only images can be dropped into a doc" — and changes nothing.
- Dragging files within the files pane still moves them (unchanged); this flow is about files from outside the workspace.

### View mode

- Pasting an image or dropping a file in view mode inserts nothing; a toast says "Switch to Edit to add images". Text selection, comments, and everything else about view mode are unchanged.

### After insertion

- References resolve through the existing image lookup, so images keep rendering if they are later reorganized into other folders; only renaming the file breaks a reference.

## Out of scope

- View-mode insertion (drop-onto-rendered-block) — needs rendered-to-source mapping; revisit if edit-mode-only proves limiting.
- Renaming images and rewriting references — link maintenance is its own feature; today, asking an agent to rename-and-fix-refs is the workaround.
- A `.mdc.toml` setting for the storage location — one fixed convention first; make it configurable only on demand.
- Pasting images into drawings — Excalidraw's own image tool covers that surface.
- Image resizing, compression, or markdown size syntax.
- Uploads via the mini-app bridge.
