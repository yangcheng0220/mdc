import { describe, expect, it } from "vitest";
import { applySuggestion } from "../src/suggest.js";
import type { Suggestion } from "../src/threads.js";

function suggestion(
  quote: string,
  replacement: string,
  before = "",
  after = "",
): Suggestion {
  return { target: { quote, context: { before, after } }, replacement };
}

describe("applySuggestion", () => {
  it("splices a strict target", () => {
    expect(applySuggestion("before old after", suggestion("old", "new", "before ", " after")))
      .toEqual({ ok: true, content: "before new after" });
  });

  it("supports deletion and file-boundary targets", () => {
    expect(applySuggestion("old tail", suggestion("old", "", "", " tail"))).toEqual({
      ok: true,
      content: " tail",
    });
    expect(applySuggestion("head old", suggestion("old", "new", "head ", ""))).toEqual({
      ok: true,
      content: "head new",
    });
  });

  it("returns a refusal without replacement content when the target drifted", () => {
    expect(
      applySuggestion("before  old after", suggestion("old", "new", "before ", " after")),
    ).toEqual({ ok: false, reason: "target-not-found" });
  });
});
