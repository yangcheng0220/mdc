/**
 * Unit tests for outline derivation. Two invariants matter most: the slugs the
 * outline generates must match the ids the renderer puts on headings (so a row
 * scrolls to the right place), and depth-folding must nest correctly including
 * skipped heading levels.
 */

import { describe, expect, it } from "vitest";
import { buildOutlineTree, extractHeadings } from "../web/src/outline.js";
import { renderMarkdown } from "../web/src/render/markdown.js";

/** Pull the id attributes the renderer assigns to headings, in order. */
function renderedHeadingIds(md: string): string[] {
  const html = renderMarkdown(md);
  return [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1]!);
}

describe("extractHeadings", () => {
  it("returns headings in document order with depth and text", () => {
    const md = "# Title\n\nintro\n\n## Section A\n\n### Sub\n\n## Section B\n";
    expect(extractHeadings(md)).toEqual([
      { depth: 1, text: "Title", slug: "title" },
      { depth: 2, text: "Section A", slug: "section-a" },
      { depth: 3, text: "Sub", slug: "sub" },
      { depth: 2, text: "Section B", slug: "section-b" },
    ]);
  });

  it("ignores non-heading content (paragraphs, lists, code, # inside fences)", () => {
    const md = "para\n\n- a\n- b\n\n```\n# not a heading\n```\n\n# Real\n";
    expect(extractHeadings(md).map((h) => h.text)).toEqual(["Real"]);
  });

  it("dedupes repeated heading text the same way the renderer does", () => {
    const md = "# Notes\n\n## Notes\n\n## Notes\n";
    const slugs = extractHeadings(md).map((h) => h.slug);
    expect(slugs).toEqual(["notes", "notes-1", "notes-2"]);
    // The invariant: slugs match the rendered heading ids exactly.
    expect(slugs).toEqual(renderedHeadingIds(md));
  });

  it("slugs match rendered ids for punctuation and mixed case", () => {
    const md = "# Hello, World!\n\n## C++ & Rust\n\n### A  B   C\n";
    expect(extractHeadings(md).map((h) => h.slug)).toEqual(renderedHeadingIds(md));
  });

  it("returns no headings for empty content", () => {
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("buildOutlineTree", () => {
  it("nests deeper headings under the nearest shallower one", () => {
    const tree = buildOutlineTree(extractHeadings("# A\n\n## B\n\n### C\n\n## D\n"));
    expect(tree).toHaveLength(1);
    expect(tree[0]!.text).toBe("A");
    expect(tree[0]!.children.map((c) => c.text)).toEqual(["B", "D"]);
    expect(tree[0]!.children[0]!.children.map((c) => c.text)).toEqual(["C"]);
  });

  it("handles skipped levels (h1 -> h3) by attaching to the open shallower node", () => {
    const tree = buildOutlineTree(extractHeadings("# A\n\n### C\n"));
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.text)).toEqual(["C"]);
  });

  it("treats sibling-or-shallower headings as new branches, not children", () => {
    const tree = buildOutlineTree(extractHeadings("## A\n\n## B\n\n# C\n"));
    // A and B are siblings at the root; C is shallower so also a root.
    expect(tree.map((n) => n.text)).toEqual(["A", "B", "C"]);
  });

  it("returns an empty tree for no headings", () => {
    expect(buildOutlineTree([])).toEqual([]);
  });
});
