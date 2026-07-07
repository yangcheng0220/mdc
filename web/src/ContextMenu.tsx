/**
 * A small floating menu anchored at a screen point — opened on right-click of a
 * tree row. List-driven so callers ship just the actions they have today and add
 * more later without touching this component. Click-outside, Escape, scroll, and
 * resize all dismiss it; a destructive item renders in the danger color.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click point, then nudge inward if the menu would overflow the
  // viewport (measured after mount, before paint).
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - width - pad);
    const y = Math.min(menu.y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // Any click (even inside — items close themselves), scroll, or resize dismisses.
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
