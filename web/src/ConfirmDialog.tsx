/**
 * A blocking confirm dialog over a dimmed page — for destructive actions like
 * deleting a comment, or a weighty-but-safe one like moving files. Esc or
 * click-outside cancels; Enter confirms. The confirm button is a solid-red
 * destructive button by default; pass tone="primary" for a neutral action.
 */

import { useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Confirm-button style: destructive red (default) or a neutral primary. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="confirm-backdrop"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="confirm-panel" role="dialog" aria-label={title}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-msg">{message}</div>
        <div className="confirm-btns">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={tone} ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
