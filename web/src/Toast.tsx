/**
 * The transient toast banner pinned to the bottom of the screen. Shows a command
 * or status title plus a meta line; `paste` appends a hint for the clipboard
 * fallback. Dismissal timing is owned by `useToast`.
 */

import type { ToastData } from "./useToast.js";

export function Toast({ toast }: { toast: ToastData }) {
  const meta = toast.paste ? `${toast.meta} · paste into your agent` : toast.meta;
  return (
    <div className="toast">
      <span className="toast-cmd">{toast.title}</span>
      <span className="toast-meta">{meta}</span>
      {toast.hint && <span className="toast-hint">{toast.hint}</span>}
    </div>
  );
}
