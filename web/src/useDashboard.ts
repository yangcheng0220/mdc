/**
 * Loads the cross-doc review inbox and keeps it fresh while it's open.
 *
 * Polls `/api/dashboard` every 4s but only updates state when the data actually
 * changed (a fingerprint of every rendered field) so an open filter menu / hover
 * isn't yanked out from under the user, and idle polls cost nothing visible. A
 * few seconds' lag is acceptable — chosen over cross-doc SSE fan-out. `refresh`
 * forces an immediate re-fetch after a mutation (thread / sidecar delete).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboard, type DashboardResponse } from "./api.js";

const POLL_MS = 4000;

/** A compact signature of everything the inbox renders. */
function fingerprint(d: DashboardResponse | null): string {
  if (!d) return "";
  return d.files
    .map(
      (f) =>
        f.path +
        (f.orphaned ? "*" : "") +
        ":" +
        f.threads
          .map((t) => `${t.thread_id}|${t.status}|${t.awaiting}|${t.last_ts}|${t.reply_count}`)
          .join(","),
    )
    .join("\n");
}

export interface DashboardState {
  data: DashboardResponse | null;
  refresh: () => Promise<void>;
}

export function useDashboard(open: boolean): DashboardState {
  const [data, setData] = useState<DashboardResponse | null>(null);
  // Sentinel distinct from any real fingerprint (incl. the empty-inbox "") so the
  // FIRST fetch always commits — otherwise an empty inbox (fingerprint "") would
  // match the initial ref and `data` would stay null, leaving the view headless.
  const NONE = "\0none";
  const fp = useRef(NONE);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDashboard();
      const sig = fingerprint(next);
      if (sig !== fp.current) {
        fp.current = sig;
        setData(next);
      }
    } catch {
      // Transient — keep last data, retry next cycle.
    }
  }, []);

  useEffect(() => {
    if (!open) {
      // Reset so reopening always re-fetches fresh (and re-commits even if the
      // inbox is empty).
      fp.current = NONE;
      return;
    }
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [open, refresh]);

  return { data, refresh };
}
