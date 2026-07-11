import { describe, expect, it } from "vitest";
import { shapeSuggestionDiff } from "./suggestionDiff.js";

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
});
