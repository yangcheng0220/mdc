/**
 * The sticky toolbar atop the document page. Holds the breadcrumb, the handoff
 * cluster (presence pill + Hand off button + session menu), and the two panel
 * toggles that only appear when their panel is collapsed (when a panel is open,
 * its own header carries the collapse control instead).
 */

import { useSyncExternalStore } from "react";
import { HandoffControls } from "./HandoffControls.js";
import { CodeIcon, EyeIcon, PanelLeftIcon } from "./icons.js";
import type { ActiveSession } from "./api.js";
import { isRunningApp, subscribeTrust } from "./trust-state.js";

export function DocToolbar({
  activeFile,
  session,
  onHandoff,
  onEndSession,
  navCollapsed,
  sidebarCollapsed,
  onToggleNav,
  onToggleSidebar,
  editing,
  onToggleEdit,
  saveState,
  isNonMd,
}: {
  activeFile: string | null;
  session: ActiveSession | null;
  onHandoff: () => void;
  onEndSession: () => void;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  onToggleNav: () => void;
  onToggleSidebar: () => void;
  editing: boolean;
  /** Toggle the active file between view and edit; absent when no file is open. */
  onToggleEdit?: () => void;
  /** Editor save status, shown beside the filename while editing. */
  saveState?: "idle" | "saving" | "saved" | "error" | "conflict";
  /** The active file is a non-md surface (image/html) — no handoff (not reviewable). */
  isNonMd?: boolean;
}) {
  // True when the active file is running as a trusted mini app (published by the
  // HTML surface). A UI hint only — the server gates every actual file op.
  const runningApp = useSyncExternalStore(
    subscribeTrust,
    () => isRunningApp(activeFile),
    () => false,
  );
  return (
    <div className="doc-toolbar">
      {navCollapsed && (
        <button
          type="button"
          className="toolbar-toggle"
          title="Show files (⌘\)"
          aria-label="Show files"
          onClick={onToggleNav}
        >
          <PanelLeftIcon />
        </button>
      )}

      {onToggleEdit && (
        <div className="mode-toggle" role="group" aria-label="View or edit">
          <button
            type="button"
            className={!editing ? "is-active" : ""}
            title="View"
            aria-label="View"
            aria-pressed={!editing}
            onClick={() => editing && onToggleEdit()}
          >
            <EyeIcon />
          </button>
          <button
            type="button"
            className={editing ? "is-active" : ""}
            title="Edit"
            aria-label="Edit"
            aria-pressed={editing}
            onClick={() => !editing && onToggleEdit()}
          >
            <CodeIcon />
          </button>
        </div>
      )}

      {activeFile ? (
        <div className="breadcrumb-row">
          <Breadcrumb file={activeFile} />
          {runningApp && (
            <span className="trusted-app-pill" title="This HTML file runs as a trusted app">
              Trusted App
            </span>
          )}
          {editing && saveState && saveState !== "idle" && (
            <span className="toolbar-savestate" data-state={saveState}>
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved"}
              {saveState === "error" && "Save failed"}
              {saveState === "conflict" && "Conflict — autosave paused"}
            </span>
          )}
        </div>
      ) : (
        <span style={{ flex: 1 }} />
      )}

      {activeFile && !isNonMd && (
        <HandoffControls
          activeFile={activeFile}
          session={session}
          onHandoff={onHandoff}
          onEndSession={onEndSession}
        />
      )}

      {sidebarCollapsed && (
        <button
          type="button"
          className="toolbar-comments is-open"
          title="Show comments (⌘⇧\)"
          aria-label="Show comments"
          onClick={onToggleSidebar}
        >
          <span className="dot" />
          Comments
        </button>
      )}
    </div>
  );
}

function Breadcrumb({ file }: { file: string }) {
  const parts = file.split("/");
  return (
    <span className="breadcrumb">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            <span className={isLast ? "breadcrumb-current" : ""}>{part}</span>
          </span>
        );
      })}
    </span>
  );
}
