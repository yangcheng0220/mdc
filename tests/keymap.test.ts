/**
 * Unit tests for the keymap matcher. `matchEvent` is the shared correctness
 * point — both the global key handler and (indirectly) the cheatsheet depend on
 * the table — so pin its modifier-exactness and case rules.
 */

import { describe, expect, it } from "vitest";
import { combo, matchEvent, SHORTCUTS, type Combo } from "../web/src/keymap.js";

// A minimal KeyboardEvent stand-in — matchEvent only reads these fields.
function ev(key: string, mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">> = {}): KeyboardEvent {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent;
}

describe("matchEvent", () => {
  it("matches a mod+letter combo on ⌘ and on Ctrl", () => {
    const c: Combo = { mod: true, key: "k", display: "⌘K" };
    expect(matchEvent(ev("k", { metaKey: true }), c)).toBe(true);
    expect(matchEvent(ev("k", { ctrlKey: true }), c)).toBe(true);
  });

  it("matches letters case-insensitively (Shift uppercases event.key)", () => {
    const c: Combo = { mod: true, key: "k", display: "⌘K" };
    expect(matchEvent(ev("K", { metaKey: true }), c)).toBe(true);
  });

  it("requires the modifier — a bare key does not match", () => {
    expect(matchEvent(ev("k"), { mod: true, key: "k", display: "⌘K" })).toBe(false);
  });

  it("is exact on shift — ⌘⇧O does not fire on ⌘O and vice-versa", () => {
    const shifted: Combo = { mod: true, shift: true, key: "o", display: "⌘⇧O" };
    expect(matchEvent(ev("o", { metaKey: true }), shifted)).toBe(false);
    expect(matchEvent(ev("o", { metaKey: true, shiftKey: true }), shifted)).toBe(true);

    const plain: Combo = { mod: true, key: "\\", display: "⌘\\" };
    expect(matchEvent(ev("\\", { metaKey: true, shiftKey: true }), plain)).toBe(false);
  });

  it("matches an alt+named-key combo (⌥→) and rejects the wrong arrow", () => {
    const next: Combo = { alt: true, key: "ArrowRight", display: "⌥→" };
    expect(matchEvent(ev("ArrowRight", { altKey: true }), next)).toBe(true);
    expect(matchEvent(ev("ArrowLeft", { altKey: true }), next)).toBe(false);
    expect(matchEvent(ev("ArrowRight"), next)).toBe(false); // alt required
  });
});

describe("combo() lookup", () => {
  it("returns the combo for a known id", () => {
    expect(combo("switch-pane").display).toBe("⌘⇧O");
  });

  it("throws on an unknown id (guards typos in App wiring)", () => {
    expect(() => combo("nope")).toThrow();
  });
});

describe("SHORTCUTS table", () => {
  it("has unique ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
