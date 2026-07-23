import { describe, expect, it } from "vitest";
import {
  absolutePath,
  byteSize,
  filename,
  formatSize,
  offersCopyContents,
} from "../web/src/copyTargets.js";

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

describe("byteSize", () => {
  it("counts ASCII as one byte per character", () => {
    expect(byteSize("hello")).toBe(5);
  });

  it("counts the UTF-8 payload, not UTF-16 units", () => {
    // "é" is 1 JS char but 2 UTF-8 bytes; the emoji is 2 JS chars but 4 bytes.
    expect("é".length).toBe(1);
    expect(byteSize("é")).toBe(2);
    expect("🎉".length).toBe(2);
    expect(byteSize("🎉")).toBe(4);
    // 5 ASCII ("hllo" + space) + 2 for "é" + 4 for the emoji.
    expect(byteSize("héllo 🎉")).toBe(11);
  });

  it("is zero for empty content", () => {
    expect(byteSize("")).toBe(0);
  });
});

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [999, "999 B"],
    // Decimal units: 1 KB is 1,000 bytes, not 1,024.
    [1000, "1 KB"],
    [1500, "1.5 KB"],
    [4200, "4.2 KB"],
    // A trailing ".0" is dropped.
    [4000, "4 KB"],
    [999_000, "999 KB"],
    // Rounding happens before the unit is picked, so this promotes rather than
    // rendering "1000 KB".
    [999_950, "1 MB"],
    [1_000_000, "1 MB"],
    [1_500_000, "1.5 MB"],
    [4_240_000, "4.2 MB"],
    [1_000_000_000, "1 GB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it("never displays a value at the unit ceiling", () => {
    // Any byte count whose rounded value would read "1000 <unit>" must promote.
    for (const n of [999_949, 999_950, 999_999, 999_949_999]) {
      expect(formatSize(n)).not.toMatch(/^1000 /);
    }
  });
});

describe("offersCopyContents", () => {
  it.each([
    ["a markdown file", "notes.md"],
    // Non-markdown, but still text: a drawing copies its scene JSON and an HTML
    // file its source. "Is this text" is the predicate, not "is this markdown".
    ["a drawing", "diagram.excalidraw"],
    ["a .excalidraw.json drawing", "diagram.excalidraw.json"],
    ["an HTML file", "page.html"],
  ])("offers contents for %s once its type is known", (_label, file) => {
    expect(offersCopyContents({ file, typeKnown: true, isImage: false, isPdf: false })).toBe(true);
  });

  it("withholds contents for an image", () => {
    expect(
      offersCopyContents({ file: "pic.png", typeKnown: true, isImage: true, isPdf: false }),
    ).toBe(false);
  });

  it("withholds contents for a PDF", () => {
    expect(
      offersCopyContents({ file: "paper.pdf", typeKnown: true, isImage: false, isPdf: true }),
    ).toBe(false);
  });

  it("withholds contents until the index resolves the type", () => {
    // Before the index lands every path looks like markdown, so a deep-linked
    // image would otherwise be offered a copy that fails on read.
    for (const file of ["pic.png", "paper.pdf", "notes.md"]) {
      expect(offersCopyContents({ file, typeKnown: false, isImage: false, isPdf: false })).toBe(
        false,
      );
    }
  });

  it("withholds contents when no file is open", () => {
    expect(offersCopyContents({ file: null, typeKnown: true, isImage: false, isPdf: false })).toBe(
      false,
    );
  });
});
