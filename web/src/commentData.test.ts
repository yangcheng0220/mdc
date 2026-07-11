import { describe, expect, it } from "vitest";
import { groupThreads } from "./commentData.js";

describe("groupThreads", () => {
  it("preserves suggestion payloads on content entries", () => {
    const suggestion = {
      target: { quote: "old", context: { before: "", after: " text" } },
      replacement: "new",
    };
    const threads = groupThreads([
      {
        id: "c1",
        anchor: { quote: "old" },
        parent_id: null,
        author: "agent",
        body: "tighten this",
        timestamp: "2026-07-11T00:00:00Z",
        suggestion,
      },
    ]);

    expect(threads[0]!.top.suggestion).toEqual(suggestion);
  });
});
