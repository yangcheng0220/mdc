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
      {toast.truncateMetaFromStart ? (
        // `direction: rtl` puts the ellipsis at the start; the <bdi> is required,
        // not decorative — without it RTL reorders a leading "/" to the end
        // ("/Users/…/TECH.md" renders as "Users/…/TECH.md/") whenever the value
        // is short enough not to overflow.
        <span className="toast-meta toast-meta-start-ellipsis">
          <bdi>{meta}</bdi>
        </span>
      ) : (
        <span className="toast-meta">{meta}</span>
      )}
      {toast.hint && <span className="toast-hint">{toast.hint}</span>}
    </div>
  );
}
