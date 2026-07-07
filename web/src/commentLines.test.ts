import { describe, expect, it } from "vitest";
import type { DisplayThread } from "./commentData.js";
import { resolveCommentLines } from "./commentLines.js";

function thread(
  id: string,
  quote: string,
  author = "user",
  resolved = false,
): DisplayThread {
  return {
    top: {
      id,
      anchor: { quote },
      author,
      body: "",
      deleted: false,
    },
    replies: [],
    resolved,
  };
}

describe("resolveCommentLines", () => {
  it("maps open anchored threads to raw markdown lines and drops orphans", () => {
    const raw = [
      "# Title",
      "",
      "First anchored sentence.",
      "",
      "- list item",
      "- Second anchored sentence.",
    ].join("\n");

    expect(
      resolveCommentLines(raw, [
        thread("c1", "First anchored sentence."),
        thread("c2", "Second anchored sentence.", "agent"),
        thread("orphan", "missing text"),
        thread("done", "Title", "user", true),
      ]),
    ).toEqual([
      { line: 3, from: 9, to: 33, commentId: "c1" },
      { line: 6, from: 49, to: 74, commentId: "c2" },
    ]);
  });

  it("returns lines in thread order even when that is not document order", () => {
    // Threads authored out of line order (later line first). The gutter builder
    // sorts by position before adding to its RangeSet — this documents that the
    // mapping itself does NOT sort, so that contract stays visible.
    const raw = ["Line one anchor.", "Line two anchor.", "Line three anchor."].join("\n");
    const out = resolveCommentLines(raw, [
      thread("late", "Line three anchor."),
      thread("early", "Line one anchor."),
    ]);
    expect(out.map((c) => c.line)).toEqual([3, 1]);
  });
});
