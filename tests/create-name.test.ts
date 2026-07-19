import { describe, expect, it } from "vitest";
import { resolveCreateName } from "../web/src/createName.js";

describe("resolveCreateName", () => {
  it.each([
    ["file", "notes", "notes.md"],
    ["file", "notes.md", "notes.md"],
    ["file", "diagram.excalidraw", "diagram.excalidraw"],
    ["file", "diagram.excalidraw.json", "diagram.excalidraw.json"],
    ["file", "notes.txt", "notes.txt.md"],
    ["drawing", "diagram", "diagram.excalidraw"],
    ["drawing", "diagram.excalidraw", "diagram.excalidraw"],
    ["drawing", "diagram.excalidraw.json", "diagram.excalidraw.json"],
  ] as const)("resolves %s create name %s to %s", (kind, name, expected) => {
    expect(resolveCreateName(kind, name)).toBe(expected);
  });
});
