/**
 * Unit tests for tab drag-to-reorder. The reorder is a pure list operation
 * (extracted from useTabs); these pin its placement rules and no-op guards so a
 * drag can never lose or duplicate a tab.
 */

import { describe, expect, it } from "vitest";
import { nextTabIndex, remapTabFile, reorderTabs, type Tab } from "../web/src/useTabs.js";

const tabs = (...ids: string[]): Tab[] => ids.map((id) => ({ id, file: `${id}.md` }));
const ids = (ts: Tab[]) => ts.map((t) => t.id);

describe("reorderTabs", () => {
  it("moves a tab before the target", () => {
    expect(ids(reorderTabs(tabs("a", "b", "c"), "c", "a", true))).toEqual(["c", "a", "b"]);
  });

  it("moves a tab after the target", () => {
    expect(ids(reorderTabs(tabs("a", "b", "c"), "a", "c", false))).toEqual(["b", "c", "a"]);
  });

  it("moves a tab into the middle", () => {
    expect(ids(reorderTabs(tabs("a", "b", "c", "d"), "d", "b", true))).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when dropped on itself", () => {
    const t = tabs("a", "b", "c");
    expect(reorderTabs(t, "b", "b", true)).toBe(t); // same reference — unchanged
  });

  it("is a no-op when an id is missing", () => {
    const t = tabs("a", "b");
    expect(reorderTabs(t, "x", "a", true)).toBe(t);
    expect(reorderTabs(t, "a", "x", false)).toBe(t);
  });

  it("never loses or duplicates a tab", () => {
    const out = reorderTabs(tabs("a", "b", "c", "d"), "a", "d", false);
    expect(ids(out).sort()).toEqual(["a", "b", "c", "d"]);
    expect(out).toHaveLength(4);
  });
});

describe("nextTabIndex — cycle focus with wraparound", () => {
  it("moves to the next tab", () => {
    expect(nextTabIndex(3, 0, 1)).toBe(1);
    expect(nextTabIndex(3, 1, 1)).toBe(2);
  });

  it("moves to the previous tab", () => {
    expect(nextTabIndex(3, 2, -1)).toBe(1);
    expect(nextTabIndex(3, 1, -1)).toBe(0);
  });

  it("wraps forward off the end to the first", () => {
    expect(nextTabIndex(3, 2, 1)).toBe(0);
  });

  it("wraps backward off the start to the last", () => {
    expect(nextTabIndex(3, 0, -1)).toBe(2);
  });

  it("returns -1 when there is nothing to cycle (0 or 1 tabs)", () => {
    expect(nextTabIndex(0, -1, 1)).toBe(-1);
    expect(nextTabIndex(1, 0, 1)).toBe(-1);
    expect(nextTabIndex(1, 0, -1)).toBe(-1);
  });

  it("cycles from the first tab when there is no active tab", () => {
    expect(nextTabIndex(3, -1, 1)).toBe(1);
    expect(nextTabIndex(3, -1, -1)).toBe(2); // (0 - 1 + 3) % 3
  });
});

describe("remapTabFile — a tab follows a move", () => {
  it("remaps an exact file match", () => {
    expect(remapTabFile("notes/a.md", "notes/a.md", "archive/a.md")).toBe("archive/a.md");
  });

  it("remaps a file under a moved folder", () => {
    expect(remapTabFile("notes/projects/a.md", "notes/projects", "archive/projects")).toBe(
      "archive/projects/a.md",
    );
  });

  it("leaves an unrelated tab untouched (same reference back)", () => {
    expect(remapTabFile("other/b.md", "notes/a.md", "archive/a.md")).toBe("other/b.md");
  });

  it("does not remap a prefix that isn't a folder boundary", () => {
    // "notes/ab.md" must not match a move of folder "notes/a"
    expect(remapTabFile("notes/ab.md", "notes/a", "x/a")).toBe("notes/ab.md");
  });
});
