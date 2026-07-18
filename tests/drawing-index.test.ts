import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveIndexedDrawing } from "../src/server/paths.js";
import { buildDrawingIndex, buildImageIndex, isDrawingName } from "../src/server/walk.js";

let dir: string;

function writeFixture(rel: string): void {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), "{}");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-drawing-index-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("drawing index", () => {
  it("recognizes Excalidraw scene suffixes without claiming exported images", () => {
    expect(isDrawingName("sketch.excalidraw")).toBe(true);
    expect(isDrawingName("sketch.excalidraw.json")).toBe(true);
    expect(isDrawingName("sketch.excalidraw.png")).toBe(false);
    expect(isDrawingName("sketch.excalidraw.svg")).toBe(false);
  });

  it("indexes scenes separately while exported PNG and SVG files stay images", () => {
    writeFixture("drawings/a.excalidraw");
    writeFixture("drawings/b.excalidraw.json");
    writeFixture("drawings/a.excalidraw.png");
    writeFixture("drawings/a.excalidraw.svg");

    expect([...buildDrawingIndex(dir, new Set())].sort()).toEqual([
      "drawings/a.excalidraw",
      "drawings/b.excalidraw.json",
    ]);
    expect([...buildImageIndex(dir, new Set())].sort()).toEqual([
      "drawings/a.excalidraw.png",
      "drawings/a.excalidraw.svg",
    ]);
  });

  it("prunes denied directories and rejects unindexed drawing paths", () => {
    writeFixture("drawings/a.excalidraw");
    writeFixture("private/hidden.excalidraw");
    const index = buildDrawingIndex(dir, new Set(["private"]));

    expect([...index]).toEqual(["drawings/a.excalidraw"]);
    expect(resolveIndexedDrawing(index, "drawings/a.excalidraw")).toBe("drawings/a.excalidraw");
    expect(resolveIndexedDrawing(index, "private/hidden.excalidraw")).toBeNull();
  });
});
