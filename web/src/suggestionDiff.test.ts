import { describe, expect, it } from "vitest";
import {
  shapeSuggestionDiff,
  shouldCollapseSuggestionDiff,
  suggestionDiffLineCounts,
} from "./suggestionDiff.js";

describe("shapeSuggestionDiff", () => {
  it("marks changed words while preserving shared text", () => {
    expect(shapeSuggestionDiff("The quick brown fox", "The swift brown fox")).toEqual({
      current: [
        { text: "The ", changed: false },
        { text: "quick", changed: true },
        { text: " brown fox", changed: false },
      ],
      proposed: [
        { text: "The ", changed: false },
        { text: "swift", changed: true },
        { text: " brown fox", changed: false },
      ],
    });
  });

  it("represents a deletion as a changed current side and an empty proposed side", () => {
    expect(shapeSuggestionDiff("delete this", "")).toEqual({
      current: [{ text: "delete this", changed: true }],
      proposed: [],
    });
  });

  it("counts source and proposed lines for the compact summary", () => {
    expect(suggestionDiffLineCounts("one\ntwo", "a\nb\nc")).toEqual({
      added: 3,
      removed: 2,
      total: 5,
    });
    expect(suggestionDiffLineCounts("remove", "")).toEqual({
      added: 0,
      removed: 1,
      total: 1,
    });
  });

  it("collapses only diffs over the ten-line threshold", () => {
    expect(shouldCollapseSuggestionDiff("1\n2\n3\n4\n5", "a\nb\nc\nd\ne")).toBe(false);
    expect(shouldCollapseSuggestionDiff("1\n2\n3\n4\n5\n6", "a\nb\nc\nd\ne")).toBe(true);
  });
});
