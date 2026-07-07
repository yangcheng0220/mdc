/**
 * A trigger-button anchored dropdown shell: owns the open state and dismissal
 * (outside mousedown, Escape) so call sites ship only their trigger content
 * and menu items. Distinct from ContextMenu, which mounts at a screen point
 * for right-clicks — this one renders inline under its trigger. The trigger
 * stops click propagation (a comment card behind it has its own click-to-jump).
 */

import { type ReactNode, useEffect, useRef, useState } from "react";

type ClassName = string | ((open: boolean) => string);

export function DropdownMenu({
  wrapClassName,
  triggerClassName,
  triggerTitle,
  triggerAriaLabel,
  triggerChildren,
  menuClassName,
  children,
}: {
  wrapClassName: string;
  triggerClassName: ClassName;
  triggerTitle: string;
  triggerAriaLabel: string;
  triggerChildren: ReactNode;
  menuClassName: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [open]);

  const triggerClass =
    typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName;
  const close = () => setOpen(false);

  return (
    <div className={wrapClassName} ref={wrapRef}>
      <button
        type="button"
        className={triggerClass}
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {triggerChildren}
      </button>
      {open && (
        <div className={menuClassName} role="menu">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
