import { describe, expect, it } from "vitest";
import { absolutePath, filename } from "../web/src/copyTargets.js";

describe("absolutePath", () => {
  it.each([
    ["/Users/you/code/mdc", "specs/TECH.md", "/Users/you/code/mdc/specs/TECH.md"],
    // A trailing separator on the root must not double up.
    ["/Users/you/code/mdc/", "specs/TECH.md", "/Users/you/code/mdc/specs/TECH.md"],
    ["/Users/you/code/mdc//", "specs/TECH.md", "/Users/you/code/mdc/specs/TECH.md"],
    // POSIX filesystem root: the separator IS the path, so it survives trimming.
    ["/", "README.md", "/README.md"],
    // A file at the top level of the workspace.
    ["/Users/you/code/mdc", "README.md", "/Users/you/code/mdc/README.md"],
  ])("joins %s + %s", (root, relative, expected) => {
    expect(absolutePath(root, relative)).toBe(expected);
  });

  it.each([
    ["C:\\Users\\you\\mdc", "specs/TECH.md", "C:\\Users\\you\\mdc\\specs/TECH.md"],
    ["C:\\Users\\you\\mdc\\", "specs/TECH.md", "C:\\Users\\you\\mdc\\specs/TECH.md"],
    // Windows drive root — trimming leaves "C:", which the separator completes.
    ["C:\\", "README.md", "C:\\README.md"],
  ])("joins the Windows root %s + %s", (root, relative, expected) => {
    expect(absolutePath(root, relative)).toBe(expected);
  });

  it("returns the relative path when the root is unknown", () => {
    // `index.root` is "" until the first index response lands.
    expect(absolutePath("", "specs/TECH.md")).toBe("specs/TECH.md");
  });

  it("returns the root itself when the relative path is empty", () => {
    expect(absolutePath("/Users/you/code/mdc", "")).toBe("/Users/you/code/mdc");
  });
});

describe("filename", () => {
  it.each([
    ["specs/doc-actions-menu/TECH.md", "TECH.md"],
    ["README.md", "README.md"],
    ["drawings/diagram.excalidraw.json", "diagram.excalidraw.json"],
    ["a/b/c/deeply nested name.md", "deeply nested name.md"],
  ])("takes the last segment of %s", (path, expected) => {
    expect(filename(path)).toBe(expected);
  });
});
