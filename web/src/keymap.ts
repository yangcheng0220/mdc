/**
 * The keymap — one source of truth for every global keyboard shortcut.
 *
 * This table is consumed by BOTH the global key handler (App.tsx, via
 * `matchEvent`) and the Shortcuts cheatsheet (Settings), so the two can never
 * drift: a binding added here shows up in the cheatsheet automatically, and a
 * binding the handler acts on is the same row the cheatsheet renders.
 *
 * Not every entry is dispatched from the central handler — some shortcuts are
 * owned by the component that has the context they need (e.g. the comment
 * shortcut needs the live text selection, so it stays bound in the doc view).
 * Those entries set `handler: false`: still documented, just not matched here.
 */

/** A platform modifier: `mod` = ⌘ on macOS / Ctrl elsewhere (metaKey || ctrlKey). */
export interface Combo {
  /** Requires the platform modifier (⌘/Ctrl). */
  mod?: boolean;
  /** Requires Shift. */
  shift?: boolean;
  /** Requires Alt/Option. */
  alt?: boolean;
  /**
   * The non-modifier key. Matched case-insensitively against `event.key` for
   * letters; for others use the literal `KeyboardEvent.key` value (e.g. `"\\"`,
   * `"ArrowLeft"`, `"."`).
   */
  key: string;
  /** How the combo renders in the cheatsheet, e.g. `"⌘⇧O"` or `"⌥←"`. */
  display: string;
}

export type ShortcutGroup = "Navigation" | "View" | "Comments";

export interface Shortcut {
  id: string;
  combo: Combo;
  label: string;
  group: ShortcutGroup;
  /**
   * False when this shortcut is dispatched by its own component rather than the
   * central App handler — it's still listed in the cheatsheet, just not matched
   * by `matchEvent` in App.
   */
  handler?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  {
    id: "jump-file",
    combo: { mod: true, key: "k", display: "⌘K" },
    label: "Jump to file",
    group: "Navigation",
  },
  {
    id: "tab-prev",
    combo: { alt: true, key: "ArrowLeft", display: "⌥←" },
    label: "Previous tab",
    group: "Navigation",
  },
  {
    id: "tab-next",
    combo: { alt: true, key: "ArrowRight", display: "⌥→" },
    label: "Next tab",
    group: "Navigation",
  },
  {
    id: "switch-pane",
    combo: { mod: true, shift: true, key: "o", display: "⌘⇧O" },
    label: "Switch Files / Outline pane",
    group: "Navigation",
  },
  {
    id: "toggle-nav",
    combo: { mod: true, key: "\\", display: "⌘\\" },
    label: "Toggle file panel",
    group: "View",
  },
  {
    id: "toggle-sidebar",
    combo: { mod: true, shift: true, key: "\\", display: "⌘⇧\\" },
    label: "Toggle sidebar",
    group: "View",
  },
  {
    id: "toggle-edit",
    combo: { mod: true, key: ".", display: "⌘." },
    label: "Toggle view / edit",
    group: "View",
  },
  {
    id: "comment",
    combo: { mod: true, shift: true, key: "u", display: "⌘⇧U" },
    label: "Comment on selection",
    group: "Comments",
    handler: false,
  },
];

/** True when a keyboard event matches `combo` exactly on its modifiers + key. */
export function matchEvent(e: KeyboardEvent, combo: Combo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!!combo.mod !== mod) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  // Letters compare case-insensitively (Shift/CapsLock changes event.key case);
  // named/punctuation keys compare literally.
  const key = combo.key.length === 1 ? combo.key.toLowerCase() : combo.key;
  const evKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return key === evKey;
}

/** Look up a handled shortcut's combo by id (for wiring the App handler). */
export function combo(id: string): Combo {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown shortcut id: ${id}`);
  return s.combo;
}
