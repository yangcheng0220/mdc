/**
 * Unit tests for the app-scope path helpers — the predicate the write-grant
 * confirm keys on (is this write outside the app's own folder?) and the
 * beyond-folder scope summary the trust prompt shows.
 */

import { describe, expect, it } from "vitest";
import { beyondFolder, isBeyondFolder, ownFolder } from "../web/src/app-scope.js";

describe("ownFolder", () => {
  it("returns the app's directory", () => {
    expect(ownFolder("apps/editor/editor.html")).toBe("apps/editor");
    expect(ownFolder("apps/board.html")).toBe("apps");
  });
  it("is the root ('') for a root-level app", () => {
    expect(ownFolder("app.html")).toBe("");
  });
});

describe("isBeyondFolder", () => {
  const APP = "apps/editor/editor.html"; // own folder: apps/editor

  it("own-folder writes are NOT beyond (no confirm)", () => {
    expect(isBeyondFolder(APP, "apps/editor/editor.html")).toBe(false);
    expect(isBeyondFolder(APP, "apps/editor/data.md")).toBe(false);
    expect(isBeyondFolder(APP, "apps/editor/sub/deep.md")).toBe(false);
  });

  it("writes outside the folder ARE beyond (confirm)", () => {
    expect(isBeyondFolder(APP, "tasks/a.md")).toBe(true);
    expect(isBeyondFolder(APP, "apps/other/x.md")).toBe(true);
    // a sibling whose name PREFIXES the folder must not count as inside it
    expect(isBeyondFolder(APP, "apps/editor-notes/x.md")).toBe(true);
  });

  it("a root-level app reaches nowhere beyond (whole root is its folder)", () => {
    expect(isBeyondFolder("app.html", "tasks/a.md")).toBe(false);
    expect(isBeyondFolder("app.html", "anything/at/all.md")).toBe(false);
  });
});

describe("beyondFolder (scope summary)", () => {
  const APP = "apps/board/board.html"; // own folder: apps/board

  it("drops own-folder scopes, keeps cross-folder ones", () => {
    expect(beyondFolder(["apps/board", "data", "tasks"], APP)).toEqual(["data", "tasks"]);
    expect(beyondFolder(["apps/board/notes.md"], APP)).toEqual([]);
  });
});
