/**
 * Theme: light / dark / system, persisted per-browser in localStorage.
 *
 * The chosen MODE is `light | dark | system`; `system` resolves live against the
 * OS `prefers-color-scheme`. The RESOLVED theme (`light | dark`) is written to
 * `document.documentElement.dataset.theme`, which the CSS token overrides key off
 * (`:root[data-theme="dark"]`). Default is `light` when nothing is stored — so an
 * existing user's look never changes on upgrade until they opt in.
 *
 * `applyStoredTheme()` runs once at startup (before React renders) to avoid a
 * light-flash on a dark reload; `startSystemThemeWatcher()` keeps the resolved
 * theme live while the app is running; `useTheme()` is the React hook the
 * settings control binds to.
 */

import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const KEY = "mdc-theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getStoredMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "system" ? v : "light";
}

function resolve(mode: ThemeMode): Resolved {
  if (mode === "system") return mql().matches ? "dark" : "light";
  return mode;
}

const RESOLVED_EVENT = "mdc-theme-resolved";
let systemWatcherStarted = false;

function apply(mode: ThemeMode): void {
  const resolved = resolve(mode);
  const prev = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = resolved;
  // Notify subscribers (e.g. Doc, to re-render mermaid's baked-in SVG theme) when
  // the RESOLVED theme actually changes — not on every mode pick that resolves the
  // same (e.g. switching light→system while the OS is light).
  if (prev !== resolved) window.dispatchEvent(new CustomEvent(RESOLVED_EVENT));
}

/** Run once at startup, before render, so a dark reload paints dark immediately. */
export function applyStoredTheme(): void {
  apply(getStoredMode());
}

/** Keep the resolved system theme current for the lifetime of the app. */
export function startSystemThemeWatcher(): void {
  if (systemWatcherStarted) return;
  systemWatcherStarted = true;
  mql().addEventListener("change", () => {
    if (getStoredMode() === "system") apply("system");
  });
}

/** The current resolved theme (`light | dark`), reactive to changes — for surfaces
 *  that bake the theme in at render time (mermaid SVG) and must re-render on flip. */
export function useResolvedTheme(): Resolved {
  const read = (): Resolved =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const [resolved, setResolved] = useState<Resolved>(read);
  useEffect(() => {
    const onChange = () => setResolved(read());
    window.addEventListener(RESOLVED_EVENT, onChange);
    return () => window.removeEventListener(RESOLVED_EVENT, onChange);
  }, []);
  return resolved;
}

/** React binding for the settings control: current mode + a setter that persists. */
export function useTheme(): { mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);

  const setMode = (m: ThemeMode) => {
    localStorage.setItem(KEY, m);
    apply(m);
    setModeState(m);
  };

  return { mode, setMode };
}
