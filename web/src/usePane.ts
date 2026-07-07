/**
 * Which left-sidebar pane is showing — Files or Outline. Lifted out of the
 * Nav so the global key handler (App) can toggle it with a shortcut; the
 * Nav still drives it via clicks. Selection persists in localStorage so the
 * pane survives a reload.
 */

import { useCallback, useState } from "react";

export type PaneId = "files" | "outline";

const PANE_KEY = "mdc-left-pane";

function storedPane(): PaneId {
  try {
    const v = localStorage.getItem(PANE_KEY);
    if (v === "files" || v === "outline") return v;
  } catch {
    // localStorage unavailable; fall through to default.
  }
  return "files";
}

export interface Pane {
  pane: PaneId;
  /** Show a specific pane (Nav tab click). */
  select: (id: PaneId) => void;
  /** Flip Files ⇄ Outline (the ⌘⇧O shortcut). */
  toggle: () => void;
}

export function usePane(): Pane {
  const [pane, setPane] = useState<PaneId>(storedPane);
  const select = useCallback((id: PaneId) => {
    setPane(id);
    try {
      localStorage.setItem(PANE_KEY, id);
    } catch {
      // localStorage unavailable; selection still works in-session.
    }
  }, []);
  const toggle = useCallback(() => {
    setPane((p) => {
      const next: PaneId = p === "files" ? "outline" : "files";
      try {
        localStorage.setItem(PANE_KEY, next);
      } catch {
        // localStorage unavailable; selection still works in-session.
      }
      return next;
    });
  }, []);
  return { pane, select, toggle };
}
