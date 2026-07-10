/**
 * Loads the file index and keeps it fresh. The index backs the file nav,
 * wikilink resolution, and command-K — anything that needs the set of known
 * files (and their open-thread counts).
 *
 * Two refresh paths, both gated by a fingerprint so the nav only re-renders
 * on a real change (a file added/removed/renamed, or a count shift):
 *  - a 5s poll, so on-disk file changes outside the open tabs (e.g. a deleted
 *    .md) show up without a manual reload;
 *  - `reload()`, for an immediate refresh after a known mutation (a sidecar
 *    change → updated open-thread counts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIndex, type IndexResponse } from "./api.js";
import { TABS_KEY } from "./useTabs.js";

const POLL_MS = 5000;

export interface IndexState {
  index: IndexResponse | null;
  reload: () => void;
}

/** Path list + open-thread counts + dirs + images + htmls + pdfs — changes on any
 *  add/remove/rename, a count shift, or an (empty) folder created/removed. */
function fingerprint(idx: IndexResponse): string {
  const files = idx.files.map((f) => `${f.path}:${f.openThreadCount}`).sort();
  const dirs = [...idx.dirs].sort();
  const images = [...idx.images].sort();
  const htmls = [...idx.htmls].sort();
  const pdfs = [...idx.pdfs].sort();
  return (
    `${idx.mdcVersion}\n--files--\n${files.join("\n")}\n--dirs--\n${dirs.join("\n")}` +
    `\n--images--\n${images.join("\n")}\n--htmls--\n${htmls.join("\n")}` +
    `\n--pdfs--\n${pdfs.join("\n")}`
  );
}

export function useIndex(): IndexState {
  const [index, setIndex] = useState<IndexResponse | null>(null);
  const fp = useRef("");
  // The root this session mounted against. When a later fetch reports a
  // different root, the served folder was switched underneath us (a `serve
  // --force` to a new root, same port — the live-reload stream reconnects on its
  // own). Everything root-scoped — the active file (`?file=`), the open tabs
  // (`mdc-tabs`) — still points at the OLD tree, so we clear it and reload to a
  // clean URL. A plain reload would resurrect the old file from the query string
  // (→ "file not in index") and restore old-root tabs from localStorage. Global
  // prefs (theme, pane, panels) are NOT root-scoped and deliberately survive.
  const mountedRoot = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchIndex();
      if (mountedRoot.current === null) {
        mountedRoot.current = next.root;
      } else if (next.root !== mountedRoot.current) {
        try {
          localStorage.removeItem(TABS_KEY);
        } catch {
          /* localStorage unavailable — the reload to a clean URL still resets the view */
        }
        window.location.replace(window.location.pathname);
        return;
      }
      const sig = fingerprint(next);
      if (sig !== fp.current) {
        fp.current = sig;
        setIndex(next);
      }
    } catch {
      // Keep the last good index on a transient failure; retry next cycle.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { index, reload: refresh };
}
