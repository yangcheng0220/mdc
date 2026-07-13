import { describe, expect, it } from "vitest";
import { blockRangeForSpan, previewBlocksPair } from "./inlinePreview.js";

function rangeOf(body: string, quote: string) {
  const start = body.indexOf(quote);
  return blockRangeForSpan(body, start, start + quote.length);
}

describe("blockRangeForSpan", () => {
  it("maps a paragraph target to its rendered element", () => {
    const body = "Before\n\nThe quick brown fox.\n\nAfter\n";
    expect(rangeOf(body, "quick brown")).toMatchObject({
      tokenRange: { from: 2, to: 3 },
      elementRange: { from: 1, to: 2 },
      rawSlice: "The quick brown fox.",
      tokenTypes: ["paragraph"],
      elementCount: 3,
    });
  });

  it.each([
    ["list", "Before\n\n- one\n- two\n\nAfter\n", "one\n- two", "list"],
    ["heading", "# Heading\n\nBody\n", "Heading", "heading"],
    ["fenced code", "Before\n\n```ts\nconst x = 1;\n```\n\nAfter\n", "const x = 1;", "code"],
    ["html block", "Before\n\n<section><p>Raw</p></section>\n\nAfter\n", "Raw", "html"],
  ])("maps a %s target", (_name, body, quote, type) => {
    expect(rangeOf(body, quote)).toMatchObject({ tokenTypes: [type] });
  });

  it("maps targets at both document boundaries", () => {
    const body = "First block.\n\nLast block.";
    expect(rangeOf(body, "First")).toMatchObject({ elementRange: { from: 0, to: 1 } });
    expect(rangeOf(body, "Last block.")).toMatchObject({ elementRange: { from: 1, to: 2 } });
  });

  it("includes every block crossed by a target", () => {
    const body = "First paragraph.\n\n## Middle\n\nLast paragraph.\n";
    expect(rangeOf(body, "paragraph.\n\n## Middle\n\nLast")).toMatchObject({
      tokenRange: { from: 0, to: 5 },
      elementRange: { from: 0, to: 3 },
      tokenTypes: ["paragraph", "heading", "paragraph"],
    });
  });

  it("refuses invalid and separator-only spans", () => {
    const body = "First.\n\nSecond.\n";
    expect(blockRangeForSpan(body, -1, 3)).toBeNull();
    expect(blockRangeForSpan(body, 4, 4)).toBeNull();
    expect(blockRangeForSpan(body, 6, 8)).toBeNull();
    expect(blockRangeForSpan(body, 0, body.length + 1)).toBeNull();
  });
});

describe("previewBlocksPair", () => {
  it("pairs matching block structures for word marking", () => {
    expect(previewBlocksPair(["p", "ul"], ["p", "ul"])).toBe(true);
  });

  it("uses the stacked fallback for changed structure", () => {
    expect(previewBlocksPair(["p"], ["p", "h2"])).toBe(false);
    expect(previewBlocksPair(["h2"], ["h3"])).toBe(false);
    expect(previewBlocksPair([], [])).toBe(false);
  });
});
