/**
 * Open-document tabs. A tab is just an open file path; the active tab's file IS
 * the active file (it drives `?file=`).
 *
 *  - persistence: open paths + the active file in localStorage (`mdc-tabs`), so
 *    the tab set survives a reload. Tab ids are NOT persisted (regenerated each
 *    load) — we match the stored active *file* back on restore.
 *  - focus history: an MRU stack so closing the active tab falls back to the
 *    most-recently-used remaining tab, not just the neighbour.
 *  - plain click on a file already open → focus its tab; cmd/ctrl-click → open
 *    in a new tab. Opening a not-yet-open file reuses the active tab (navigate
 *    in place), keeping single-pane navigation.
 *
 * Restore is reconciled against the known file set + the URL's `?file=`: a
 * deep-linked file joins the set and wins active even if it wasn't stored, and
 * stored paths that no longer exist are dropped.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Tab {
  id: string;
  file: string;
  /** Background activity (doc or sidecar changed) since last focus → tab dot. */
  unread?: boolean;
  /** A doc-changed arrived while backgrounded → reload its content on focus. */
  docStale?: boolean;
}

export const TABS_KEY = "mdc-tabs";
let _seq = 0;
const newId = () => `tab-${Date.now()}-${_seq++}`;

interface StoredTabs {
  openPaths: string[];
  activeFile: string | null;
}

/**
 * Pure reorder: return `tabs` with `draggedId` removed and re-inserted
 * before/after `targetId`. Returns the input unchanged if dragged === target or
 * either id is missing. Extracted from the hook so it's unit-testable.
 */
export function reorderTabs(tabs: Tab[], draggedId: string, targetId: string, before: boolean): Tab[] {
  if (draggedId === targetId) return tabs;
  const from = tabs.findIndex((t) => t.id === draggedId);
  if (from === -1) return tabs;
  const dragged = tabs[from]!;
  const without = tabs.filter((t) => t.id !== draggedId);
  const targetIdx = without.findIndex((t) => t.id === targetId);
  if (targetIdx === -1) return tabs;
  const insertAt = before ? targetIdx : targetIdx + 1;
  const next = [...without];
  next.splice(insertAt, 0, dragged);
  return next;
}

/**
 * The index to focus when cycling from `activeIdx` by `dir` (+1 next / -1 prev)
 * across `count` tabs, wrapping at both ends. Returns -1 when there's nothing to
 * cycle (fewer than 2 tabs). A missing active tab (`activeIdx === -1`) cycles
 * from the first tab. Extracted from the hook so the wrap math is unit-testable.
 */
export function nextTabIndex(count: number, activeIdx: number, dir: 1 | -1): number {
  if (count < 2) return -1;
  const from = activeIdx === -1 ? 0 : activeIdx;
  return (from + dir + count) % count;
}

/**
 * Rewrite a tab's file path after a move. A file move remaps an exact match; a
 * folder move (`from` with no `.md`) remaps every tab under it. Returns the same
 * path when nothing matched, so callers can detect a change by identity.
 */
export function remapTabFile(file: string, from: string, to: string): string {
  if (file === from) return to;
  if (file.startsWith(from + "/")) return to + file.slice(from.length);
  return file;
}

function readStored(): StoredTabs | null {
  try {
    return JSON.parse(localStorage.getItem(TABS_KEY) || "null");
  } catch {
    return null;
  }
}

export interface Tabs {
  tabs: Tab[];
  activeId: string | null;
  /** Open `file`, reusing its tab if already open, else replacing the active tab. */
  open: (file: string) => void;
  /** Open `file` in a new tab (cmd/ctrl-click), or focus it if already open. */
  openInNewTab: (file: string) => void;
  focus: (id: string) => void;
  /** Focus the next (`1`) or previous (`-1`) tab, wrapping; no-op on 0/1 tabs. */
  cycle: (dir: 1 | -1) => void;
  close: (id: string) => void;
  /** Move the dragged tab to sit before/after the target tab (drag-to-reorder). */
  reorder: (draggedId: string, targetId: string, before: boolean) => void;
  /** Rewrite open tabs after a file/folder move so none point at the old path. */
  remap: (from: string, to: string) => void;
  /** Light a background tab's unread dot (live change while it wasn't active). */
  markUnread: (file: string) => void;
  /** Mark a background tab's doc stale so focusing it reloads the content. */
  markStale: (file: string) => void;
  /** Clear the active tab's stale flag once its reload has been consumed. */
  clearStale: (file: string) => void;
}

export function useTabs(
  knownFiles: string[] | null,
  activeFile: string | null,
  setActiveFile: (file: string | null) => void,
): Tabs {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // MRU stack of tab ids (last = most recent). Mirrors state.focusHistory.
  const focusHistory = useRef<string[]>([]);
  const restored = useRef(false);

  const touch = useCallback((id: string) => {
    focusHistory.current = focusHistory.current.filter((x) => x !== id);
    focusHistory.current.push(id);
  }, []);

  // One-time restore, once the file index is known (so we can validate paths).
  useEffect(() => {
    if (restored.current || !knownFiles) return;
    restored.current = true;

    const known = new Set(knownFiles);
    const stored = readStored();
    const paths: string[] = [];
    if (stored && Array.isArray(stored.openPaths)) {
      for (const p of stored.openPaths) {
        if (known.has(p) && !paths.includes(p)) paths.push(p);
      }
    }
    // A deep-linked ?file= joins the set (and wins active) even if not stored.
    if (activeFile && known.has(activeFile) && !paths.includes(activeFile)) {
      paths.push(activeFile);
    }

    const restoredTabs = paths.map((file) => ({ id: newId(), file }));
    setTabs(restoredTabs);
    focusHistory.current = restoredTabs.map((t) => t.id);

    if (restoredTabs.length === 0) {
      setActiveId(null);
      return;
    }
    const wantFile =
      activeFile && known.has(activeFile)
        ? activeFile
        : stored && stored.activeFile && known.has(stored.activeFile)
          ? stored.activeFile
          : paths[0];
    const active = restoredTabs.find((t) => t.file === wantFile) ?? restoredTabs[0];
    if (!active) return; // restoredTabs is non-empty here, but narrow for the checker
    setActiveId(active.id);
    touch(active.id);
    // Keep the URL in step with the restored active tab (e.g. no ?file= but
    // tabs were stored → adopt the stored active file).
    if (active.file !== activeFile) setActiveFile(active.file);
  }, [knownFiles, activeFile, setActiveFile, touch]);

  // Reconcile the tab strip to `activeFile` when it changes outside the tab
  // methods — notably browser back/forward (popstate updates the URL → activeFile,
  // but not the tabs). Without this the strip shows a stale file/highlight.
  //   - a tab already holds activeFile → focus it.
  //   - otherwise the active tab adopts activeFile (mirrors in-place navigation:
  //     a plain link click mutates the current tab's file, so back/forward must
  //     too, or the single tab and the URL drift apart).
  useEffect(() => {
    if (!restored.current || !activeFile) return;
    const current = tabs.find((t) => t.id === activeId);
    if (current && current.file === activeFile) return; // already in sync
    const match = tabs.find((t) => t.file === activeFile);
    if (match) {
      if (match.id !== activeId) {
        setActiveId(match.id);
        touch(match.id);
      }
    } else if (current) {
      // No tab holds it → the active tab adopts it (in-place nav semantics).
      setTabs((prev) => prev.map((t) => (t.id === current.id ? { ...t, file: activeFile } : t)));
    }
  }, [activeFile, tabs, activeId, touch]);

  // Persist on every change (after restore).
  useEffect(() => {
    if (!restored.current) return;
    try {
      const active = tabs.find((t) => t.id === activeId);
      const payload: StoredTabs = {
        openPaths: tabs.map((t) => t.file),
        activeFile: active ? active.file : null,
      };
      localStorage.setItem(TABS_KEY, JSON.stringify(payload));
    } catch {
      // best-effort
    }
  }, [tabs, activeId]);

  const focus = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      setActiveId(id);
      touch(id);
      // Focusing clears the unread dot; a stale doc reloads via the active-file
      // effect in App (which sees docStale and consumes it).
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
      setActiveFile(tab.file);
    },
    [tabs, touch, setActiveFile],
  );

  const open = useCallback(
    (file: string) => {
      const existing = tabs.find((t) => t.file === file);
      if (existing) {
        if (existing.id !== activeId) focus(existing.id);
        return;
      }
      const active = tabs.find((t) => t.id === activeId);
      if (active) {
        // Navigate the active tab in place (single-pane behaviour).
        setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, file } : t)));
        touch(active.id);
        setActiveFile(file);
      } else {
        const tab = { id: newId(), file };
        setTabs((prev) => [...prev, tab]);
        setActiveId(tab.id);
        touch(tab.id);
        setActiveFile(file);
      }
    },
    [tabs, activeId, focus, touch, setActiveFile],
  );

  const openInNewTab = useCallback(
    (file: string) => {
      const existing = tabs.find((t) => t.file === file);
      if (existing) {
        focus(existing.id);
        return;
      }
      const tab = { id: newId(), file };
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      touch(tab.id);
      setActiveFile(file);
    },
    [tabs, focus, touch, setActiveFile],
  );

  // Cycle focus to the neighbouring tab, wrapping at the ends. Order follows the
  // visible strip (`tabs[]`), not the MRU history. No-op with fewer than 2 tabs.
  const cycle = useCallback(
    (dir: 1 | -1) => {
      const idx = tabs.findIndex((t) => t.id === activeId);
      const next = nextTabIndex(tabs.length, idx, dir);
      if (next === -1) return;
      const target = tabs[next];
      if (target && target.id !== activeId) focus(target.id);
    },
    [tabs, activeId, focus],
  );

  const close = useCallback(
    (id: string) => {
      focusHistory.current = focusHistory.current.filter((x) => x !== id);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId) {
          // Fall back to the most-recently-used remaining tab.
          const fallbackId = [...focusHistory.current]
            .reverse()
            .find((x) => next.some((t) => t.id === x));
          const fallback = next.find((t) => t.id === fallbackId) ?? next[0] ?? null;
          setActiveId(fallback ? fallback.id : null);
          setActiveFile(fallback ? fallback.file : null);
        }
        return next;
      });
    },
    [activeId, setActiveFile],
  );

  const markUnread = useCallback((file: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.file === file && !t.unread ? { ...t, unread: true } : t)),
    );
  }, []);

  const markStale = useCallback((file: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.file === file && !t.docStale ? { ...t, docStale: true } : t)),
    );
  }, []);

  const clearStale = useCallback((file: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.file === file && t.docStale ? { ...t, docStale: false } : t)),
    );
  }, []);

  // Drag-to-reorder: pull the dragged tab out and re-insert it before/after the
  // target. Pure order change — activeId and focus history are untouched (the
  // persistence effect saves the new order). No-op if dragged === target.
  const reorder = useCallback((draggedId: string, targetId: string, before: boolean) => {
    setTabs((prev) => reorderTabs(prev, draggedId, targetId, before));
  }, []);

  // Follow a move: rewrite the file path of any open tab on the moved doc (or
  // under the moved folder), so a tab never points at a now-vacated path. If the
  // active tab moved, sync the active file + URL to the new path.
  const remap = useCallback(
    (from: string, to: string) => {
      setTabs((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          const file = remapTabFile(t.file, from, to);
          if (file === t.file) return t;
          changed = true;
          return { ...t, file };
        });
        if (!changed) return prev;
        const active = next.find((t) => t.id === activeId);
        if (active) setActiveFile(active.file);
        return next;
      });
    },
    [activeId, setActiveFile],
  );

  return {
    tabs,
    activeId,
    open,
    openInNewTab,
    focus,
    cycle,
    close,
    markUnread,
    markStale,
    clearStale,
    reorder,
    remap,
  };
}
