/**
 * Collapse state for the two side panels (left file nav, right comment
 * sidebar). Each panel's collapsed flag persists to localStorage so the layout
 * survives reloads.
 *
 * The toggles live in the doc toolbar (when a panel is collapsed) and in each
 * panel's own header (when open), but the state is owned here so the grid tracks
 * animate from one place.
 */

import { useCallback, useState } from "react";

type Panel = "nav" | "sidebar";

const KEY = (which: Panel) => `mdc-${which}-collapsed`;

function storedCollapsed(which: Panel): boolean {
  try {
    return localStorage.getItem(KEY(which)) === "1";
  } catch {
    return false;
  }
}

export interface Panels {
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  toggle: (which: Panel) => void;
}

export function usePanels(): Panels {
  const [navCollapsed, setNav] = useState(() => storedCollapsed("nav"));
  const [sidebarCollapsed, setSidebar] = useState(() => storedCollapsed("sidebar"));

  const toggle = useCallback((which: Panel) => {
    const setter = which === "nav" ? setNav : setSidebar;
    setter((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY(which), next ? "1" : "0");
      } catch {
        // localStorage unavailable (private mode); state still works in-session.
      }
      return next;
    });
  }, []);

  return { navCollapsed, sidebarCollapsed, toggle };
}
