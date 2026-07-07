/**
 * Loads a document's comment entries and exposes the grouped display threads.
 * Fetches on file change; `reload` re-fetches in place — the app calls it after
 * comment write-backs and when the live-reload stream reports a sidecar change.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchComments, groupThreads, type DisplayThread } from "./commentData.js";
import type { Entry } from "../../src/threads.js";

export interface CommentsState {
  threads: DisplayThread[];
  /** Raw entries — for resolved-view details (who/when resolved, snapshot). */
  entries: Entry[];
  reload: () => void;
}

export function useComments(file: string | null): CommentsState {
  const [threads, setThreads] = useState<DisplayThread[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!file) {
      setThreads([]);
      setEntries([]);
      return;
    }
    let cancelled = false;
    fetchComments(file)
      .then((raw) => {
        if (cancelled) return;
        setEntries(raw);
        setThreads(groupThreads(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [file, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { threads, entries, reload };
}
