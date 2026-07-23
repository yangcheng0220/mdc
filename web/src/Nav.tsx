/**
 * Left sidebar frame: brand + collapse toggle, a pane switcher (Files / Outline
 * / +) as top-level chrome, the active pane, and a footer that opens the review
 * dashboard. The open-tabs strip lives inside the Files pane (not the frame), so
 * the switcher stays pinned at the top and the Outline pane gets full height.
 *
 * This frame owns the file-tree *interaction* state for create/delete: the open
 * context menu and where an inline create input sits. The actual disk mutations
 * (create/delete + index refresh + toast) and the copy actions are App-provided
 * callbacks — this frame only identifies the right-clicked row and builds the
 * menu's sections. The "+" switcher segment is a root-create action button, not
 * a pane.
 */

import { useCallback, useState } from "react";
import { ContextMenu, type MenuItem, type MenuState } from "./ContextMenu.js";
import { resolveCreateName } from "./createName.js";
import { FilesPane, type CreateTarget } from "./FilesPane.js";
import {
  CopyContentsIcon,
  CopyFilenameIcon,
  CopyPathIcon,
  DrawingIcon,
  FileIcon,
  FolderIcon,
  GearIcon,
  PanelLeftIcon,
  TrashIcon,
} from "./icons.js";
import { OutlinePane } from "./OutlinePane.js";
import type { PaneId } from "./usePane.js";
import type { Tabs as TabsState } from "./useTabs.js";

interface Segment {
  id: PaneId;
  label: string;
}

const SEGMENTS: Segment[] = [
  { id: "files", label: "Files" },
  { id: "outline", label: "Outline" },
];

/** Join a parent folder and a name into a root-relative path. */
function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function Nav({
  root,
  paths,
  images,
  htmls,
  pdfs,
  drawings,
  dirs,
  activeFile,
  activeContent,
  canScrollDoc,
  tabs,
  pane,
  onSelectPane,
  onToggle,
  onOpenFile,
  onOpenInNewTab,
  onScrollToHeading,
  onOpenSettings,
  onCreateFile,
  onCreateFolder,
  onRequestDeleteFile,
  onRequestDeleteFolder,
  onRequestMove,
  onCopyFilename,
  onCopyPath,
  onCopyContents,
  offersCopyContents,
}: {
  root: string;
  /** Openable files in the tree — markdown docs, image files, and HTML files. */
  paths: string[];
  /** Which of `paths` are image files (for the row icon). */
  images: string[];
  /** Which of `paths` are HTML files (for the row icon). */
  htmls: string[];
  /** Which of `paths` are PDF files (for the row icon). */
  pdfs: string[];
  /** Which of `paths` are Excalidraw scenes (for the row icon). */
  drawings: string[];
  dirs: string[];
  activeFile: string | null;
  /** Live markdown of the active doc (editor text in edit mode), for the outline. */
  activeContent: string | null;
  /** Can the outline scroll the doc? False in edit mode — nothing rendered to scroll. */
  canScrollDoc: boolean;
  tabs: TabsState;
  /** Which sidebar pane is showing (lifted to App so a shortcut can toggle it). */
  pane: PaneId;
  /** Show a specific pane (tab click / "+" jump to Files). */
  onSelectPane: (id: PaneId) => void;
  onToggle: () => void;
  onOpenFile: (file: string) => void;
  onOpenInNewTab: (file: string) => void;
  onScrollToHeading: (slug: string) => void;
  onOpenSettings: () => void;
  /** Create at a root-relative path, then (file only) open it. Returns success. */
  onCreateFile: (path: string) => Promise<boolean>;
  onCreateFolder: (path: string) => Promise<boolean>;
  onRequestDeleteFile: (path: string) => void;
  onRequestDeleteFolder: (path: string) => void;
  /** Request moving a doc/folder into a destination folder ("" = root). */
  onRequestMove: (from: string, destFolder: string) => void;
  // Copy actions act on the path handed to them — the right-clicked row, which
  // need not be the open file. App owns the read, clipboard write, and toast.
  onCopyFilename: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyContents: (path: string) => void;
  /** Whether a file has text to copy — false for images and PDFs. */
  offersCopyContents: (path: string | null) => boolean;
}) {
  // Tree/outline fold state is owned HERE, not in the panes, because each pane
  // unmounts when the user switches to the other — local state would reset, so
  // opened folders (and folded headings) would snap back every switch.
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const expandDir = useCallback((path: string) => {
    if (!path) return;
    setExpandedDirs((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);
  const [foldedHeadings, setFoldedHeadings] = useState<Set<string>>(() => new Set());
  const toggleFold = useCallback((slug: string) => {
    setFoldedHeadings((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  // --- Create / delete interaction state ------------------------------------
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);

  // Start an inline create inside `parent` (root if ""), expanding it so the
  // input is visible. Switching to the Files pane is the caller's job (the "+"
  // path does it; a contextual menu is already on the Files pane).
  const startCreate = useCallback(
    (kind: CreateTarget["kind"], parent: string) => {
      expandDir(parent);
      setCreateTarget({ kind, parent });
    },
    [expandDir],
  );

  const cancelCreate = useCallback(() => setCreateTarget(null), []);

  // A drop expands the destination folder so the moved file is visible where it
  // landed (mirrors create-folder's auto-open), then delegates the actual move —
  // preview + confirm + execute — to App. Expanding here keeps fold state owned
  // by the Nav; if the user cancels the confirm, an already-open folder is a
  // harmless no-op.
  const handleMove = useCallback(
    (from: string, destFolder: string) => {
      expandDir(destFolder);
      onRequestMove(from, destFolder);
    },
    [expandDir, onRequestMove],
  );

  const commitCreate = useCallback(
    async (name: string) => {
      const target = createTarget;
      setCreateTarget(null);
      if (!target) return;
      const path = joinPath(target.parent, name);
      if (target.kind === "file" || target.kind === "drawing") {
        await onCreateFile(resolveCreateName(target.kind, path));
      } else {
        const ok = await onCreateFolder(path);
        if (ok) expandDir(path); // show the new (empty) folder open
      }
    },
    [createTarget, onCreateFile, onCreateFolder, expandDir],
  );

  // Right-click a row → menu whose items depend on what was clicked. Folder rows
  // and empty root space can create; everything offers delete (except root). The
  // copy actions target the clicked row, matching what the toolbar ⋮ offers for
  // that file — a folder copies only its path.
  const openContextMenu = useCallback(
    (e: React.MouseEvent, t: { kind: "folder" | "file" | "root"; path: string }) => {
      e.preventDefault();
      e.stopPropagation();
      const items: MenuItem[] =
        t.kind === "file"
          ? [
              {
                type: "action",
                label: "Copy filename",
                icon: <CopyFilenameIcon />,
                onSelect: () => onCopyFilename(t.path),
              },
              {
                type: "action",
                label: "Copy path",
                icon: <CopyPathIcon />,
                onSelect: () => onCopyPath(t.path),
              },
              ...(offersCopyContents(t.path)
                ? [
                    {
                      type: "action" as const,
                      label: "Copy contents",
                      icon: <CopyContentsIcon />,
                      onSelect: () => onCopyContents(t.path),
                    },
                  ]
                : []),
              { type: "separator" },
              {
                type: "action",
                label: "Delete",
                icon: <TrashIcon />,
                danger: true,
                onSelect: () => onRequestDeleteFile(t.path),
              },
            ]
          : t.kind === "folder"
            ? [
                {
                  type: "action",
                  label: "New file",
                  icon: <FileIcon />,
                  onSelect: () => startCreate("file", t.path),
                },
                {
                  type: "action",
                  label: "New drawing",
                  icon: <DrawingIcon />,
                  onSelect: () => startCreate("drawing", t.path),
                },
                {
                  type: "action",
                  label: "New folder",
                  icon: <FolderIcon />,
                  onSelect: () => startCreate("folder", t.path),
                },
                { type: "separator" },
                {
                  type: "action",
                  label: "Copy path",
                  icon: <CopyPathIcon />,
                  onSelect: () => onCopyPath(t.path),
                },
                { type: "separator" },
                {
                  type: "action",
                  label: "Delete",
                  icon: <TrashIcon />,
                  danger: true,
                  onSelect: () => onRequestDeleteFolder(t.path),
                },
              ]
            : [
                {
                  type: "action",
                  label: "New file",
                  icon: <FileIcon />,
                  onSelect: () => startCreate("file", ""),
                },
                {
                  type: "action",
                  label: "New drawing",
                  icon: <DrawingIcon />,
                  onSelect: () => startCreate("drawing", ""),
                },
                {
                  type: "action",
                  label: "New folder",
                  icon: <FolderIcon />,
                  onSelect: () => startCreate("folder", ""),
                },
              ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [
      startCreate,
      onRequestDeleteFile,
      onRequestDeleteFolder,
      onCopyFilename,
      onCopyPath,
      onCopyContents,
      offersCopyContents,
    ],
  );

  // The "+" action: jump to the Files pane, then start a root-level new file —
  // the inline input lives in the file tree and must be visible to type into.
  const onRootCreate = useCallback(() => {
    onSelectPane("files");
    startCreate("file", "");
  }, [onSelectPane, startCreate]);

  return (
    <div className="nav-inner">
      <div className="nav-header">
        <span className="brand">mdc</span>
        <button
          type="button"
          className="panel-hdr-toggle"
          title="Hide files (⌘\)"
          aria-label="Hide files"
          onClick={onToggle}
        >
          <PanelLeftIcon />
        </button>
      </div>

      <div className="pane-switcher" role="tablist">
        {SEGMENTS.map((seg) => (
          <button
            key={seg.id}
            type="button"
            role="tab"
            className={`pane-tab${pane === seg.id ? " active" : ""}`}
            aria-selected={pane === seg.id}
            title={seg.label}
            onClick={() => onSelectPane(seg.id)}
          >
            {seg.label}
          </button>
        ))}
        <button
          type="button"
          className="pane-new-btn"
          title="New file at root"
          aria-label="New file"
          onClick={onRootCreate}
        >
          +
        </button>
      </div>

      <div className="nav-content">
        {pane === "files" && (
          <FilesPane
            root={root}
            paths={paths}
            images={images}
            htmls={htmls}
            pdfs={pdfs}
            drawings={drawings}
            dirs={dirs}
            activeFile={activeFile}
            tabs={tabs}
            expanded={expandedDirs}
            onToggleDir={toggleDir}
            onOpenFile={onOpenFile}
            onOpenInNewTab={onOpenInNewTab}
            actions={{
              onContextMenu: openContextMenu,
              createTarget,
              onCommitCreate: commitCreate,
              onCancelCreate: cancelCreate,
              onMove: handleMove,
            }}
          />
        )}
        {pane === "outline" && (
          <OutlinePane
            content={activeContent}
            hasFile={!!activeFile}
            canScroll={canScrollDoc}
            folded={foldedHeadings}
            onToggleFold={toggleFold}
            onScrollToHeading={onScrollToHeading}
          />
        )}
      </div>

      <button
        className="nav-footer"
        type="button"
        title="Settings"
        onClick={onOpenSettings}
      >
        <span className="icon">
          <GearIcon />
        </span>
        <span className="nav-footer-root">{root}</span>
      </button>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
