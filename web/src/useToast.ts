/**
 * A single transient toast. Showing a new one replaces any current toast and
 * resets the 4s auto-dismiss. `paste` appends a "paste into your agent" hint —
 * used only on the clipboard-fallback path (no live agent to receive a signal).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastData {
  title: string;
  meta: string;
  paste?: boolean;
  /** Optional secondary line, rendered under `meta` (e.g. a follow-up pointer). */
  hint?: string;
  /**
   * Truncate an over-long `meta` from the START, keeping the end visible — used
   * by copy confirmations, where the filename at the tail of a path identifies
   * what was copied. Ordinary prose toasts keep their normal wrapping.
   */
  truncateMetaFromStart?: boolean;
}

export interface ToastState {
  toast: ToastData | null;
  show: (toast: ToastData) => void;
}

const DISMISS_MS = 4000;

export function useToast(): ToastState {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: ToastData) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), DISMISS_MS);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { toast, show };
}
