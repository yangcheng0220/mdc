/**
 * Contract tests for anchor resolution. The behavior contract is the proven
 * client-side matcher this module was extracted from; these cases pin the
 * cascade: context fingerprint → unique exact → line-tiebreak with drift
 * ceiling → bounded fuzzy. Conservative by design — a false orphan beats a
 * false match.
 */

import { describe, expect, it } from "vitest";
import {
  LEGACY_DRIFT_CEILING,
  captureContext,
  collapseWs,
  findAnchorMatch,
  findTargetStrict,
  fuzzyFind,
  lineOfOffset,
  stripInlineMd,
  stripMdMapped,
} from "../src/anchor.js";

describe("findAnchorMatch — context fingerprint (drift-proof path)", () => {
  it("pins the right occurrence of a repeated quote", () => {
    const text = "alpha target beta\ngamma target delta\n";
    const m = findAnchorMatch(
      { quote: "target", context: { before: "gamma ", after: " delta" } },
      text,
    );
    expect(m).not.toBeNull();
    expect(text.slice(m!.startIdx, m!.startIdx + m!.length)).toBe("target");
    expect(m!.startIdx).toBe(text.indexOf("gamma ") + "gamma ".length);
    expect(m!.recovered).toBe(false);
  });

  it("orphans when the fingerprint itself is duplicated", () => {
    const text = "x target y\nx target y\n";
    const m = findAnchorMatch(
      { quote: "target", context: { before: "x ", after: " y" } },
      text,
    );
    expect(m).toBeNull(); // ambiguous → orphan, never guess
  });

  it("orphans when the fingerprinted copy was edited away (no nearest-twin fallback)", () => {
    // The quote still exists elsewhere, but ITS copy (with this context) is gone.
    const text = "alpha target beta\nsomething else entirely\n";
    const m = findAnchorMatch(
      { quote: "target", context: { before: "gamma ", after: " delta" } },
      text,
    );
    expect(m).toBeNull();
  });

  it("survives whitespace-only reflow near the quote", () => {
    const m = findAnchorMatch(
      { quote: "the quote", context: { before: "before ", after: " after" } },
      "xx before  the   quote \n after yy",
    );
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
  });

  it("works with only a before or only an after side", () => {
    const text = "one target two\nthree target four\n";
    const m = findAnchorMatch({ quote: "target", context: { before: "three " } }, text);
    expect(m).not.toBeNull();
    expect(m!.startIdx).toBe(text.indexOf("three ") + "three ".length);
  });
});

describe("findTargetStrict", () => {
  it("returns a unique exact fingerprint hit without recovery", () => {
    const text = "alpha target beta\ngamma target delta\n";
    expect(
      findTargetStrict(
        { quote: "target", context: { before: "gamma ", after: " delta" } },
        text,
      ),
    ).toEqual({
      startIdx: text.indexOf("gamma ") + "gamma ".length,
      length: "target".length,
      recovered: false,
    });
  });

  it("refuses whitespace drift", () => {
    expect(
      findTargetStrict(
        { quote: "the quote", context: { before: "before ", after: " after" } },
        "before  the quote after",
      ),
    ).toBeNull();
  });

  it("refuses a duplicated fingerprint", () => {
    expect(
      findTargetStrict(
        { quote: "target", context: { before: "x ", after: " y" } },
        "x target y\nx target y\n",
      ),
    ).toBeNull();
  });
});

describe("findAnchorMatch — exact and legacy line-tiebreak", () => {
  it("unique exact match lives there", () => {
    const text = "aaa\nthe quote\nbbb\n";
    const m = findAnchorMatch({ quote: "the quote" }, text);
    expect(m).toEqual({ startIdx: 4, length: 9, recovered: false });
  });

  it("empty quote orphans", () => {
    expect(findAnchorMatch({ quote: "" }, "anything")).toBeNull();
  });

  it("multi-occurrence without a line falls back to the first", () => {
    const text = "dup here\nmore\ndup here\n";
    const m = findAnchorMatch({ quote: "dup here" }, text);
    expect(m!.startIdx).toBe(0);
  });

  it("multi-occurrence with a line picks the nearest occurrence", () => {
    const text = "dup\n\n\n\n\ndup\n";
    const m = findAnchorMatch({ quote: "dup", line: 6 }, text);
    expect(m!.startIdx).toBe(text.lastIndexOf("dup"));
  });

  it("orphans beyond the legacy drift ceiling", () => {
    // Two occurrences, both far (> ceiling) from the stored line.
    const pad = "\n".repeat(LEGACY_DRIFT_CEILING + 10);
    const text = `dup${pad}dup\n`;
    const farLine = LEGACY_DRIFT_CEILING + 100;
    expect(findAnchorMatch({ quote: "dup", line: farLine }, text)).toBeNull();
  });
});

describe("findAnchorMatch — fuzzy recovery", () => {
  it("recovers a whitespace-reflowed quote (unique)", () => {
    const text = "intro\nthe  quick\n brown   fox\noutro\n";
    const m = findAnchorMatch({ quote: "the quick brown fox" }, text);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
    expect(text.slice(m!.startIdx, m!.startIdx + m!.length)).toContain("quick");
  });

  it("recovers via the markdown-stripped quote variant", () => {
    // Stored quote carries inline markdown the doc no longer has.
    const text = "see the plain phrase here\n";
    const m = findAnchorMatch({ quote: "the `plain` phrase" }, text);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
    expect(text.slice(m!.startIdx, m!.startIdx + m!.length)).toBe("the plain phrase");
  });

  it("ambiguous fuzzy hits orphan instead of guessing", () => {
    const text = "the  quote\nthe quote\n";
    expect(findAnchorMatch({ quote: "the\tquote" }, text)).toBeNull();
  });

  it("no match at all orphans", () => {
    expect(findAnchorMatch({ quote: "vanished entirely" }, "doc text\n")).toBeNull();
  });
});

describe("helpers", () => {
  it("captureContext grows around an occurrence until its fingerprint is unique", () => {
    const text = "alpha target beta\nalpha target delta\n";
    expect(captureContext(text, text.lastIndexOf("target"), "target")).toEqual({
      before: "a ",
      after: " d",
    });
  });

  it("collapseWs maps transformed offsets back to originals", () => {
    const { text, map } = collapseWs("a  b\n\nc");
    expect(text).toBe("a b c");
    expect(map[0]).toBe(0); // a
    expect(map[2]).toBe(3); // b
    expect(map[4]).toBe(6); // c
  });

  it("lineOfOffset counts exact raw lines (1-indexed)", () => {
    const text = "one\ntwo\nthree\n";
    expect(lineOfOffset(text, 0)).toBe(1);
    expect(lineOfOffset(text, 4)).toBe(2);
    expect(lineOfOffset(text, text.indexOf("three"))).toBe(3);
  });

  it("stripInlineMd strips links, bold, italics, code", () => {
    expect(stripInlineMd("[label](http://x) **b** *i* `c` _u_")).toBe("label b i c u");
  });

  it("fuzzyFind requires a unique hit", () => {
    expect(fuzzyFind("x y\nx  y\n", "x y")).toBeNull();
    expect(fuzzyFind("only x  y here\n", "x y")).not.toBeNull();
  });
});

describe("findAnchorMatch — rendered quote against raw markdown (stripped-view fallback)", () => {
  it("matches a plain quote whose raw span carries bold markers", () => {
    const raw = "- **Outer folder is a SEPARATE git repo** (now history-only) that held it.\n";
    const m = findAnchorMatch(
      { quote: "Outer folder is a SEPARATE git repo (now history-only)" },
      raw,
    );
    expect(m).not.toBeNull();
    // The mapped raw range spans the markers interior to the quote.
    expect(raw.slice(m!.startIdx, m!.startIdx + m!.length)).toBe(
      "Outer folder is a SEPARATE git repo** (now history-only)",
    );
    expect(m!.recovered).toBe(true);
  });

  it("matches across nested bold + code markers", () => {
    const raw = "- **`ts/mdc/` git**: tracks core + CLI + server + `web/` frontend.\n";
    const m = findAnchorMatch({ quote: "ts/mdc/ git: tracks core + CLI" }, raw);
    expect(m).not.toBeNull();
    expect(raw.slice(m!.startIdx, m!.startIdx + m!.length)).toBe("ts/mdc/` git**: tracks core + CLI");
    expect(m!.recovered).toBe(true);
  });

  it("matches a context-fingerprinted anchor whose fingerprint crosses markers", () => {
    const raw = "See the **workspace config** file for identity settings.\n";
    const m = findAnchorMatch(
      { quote: "workspace config", context: { before: "See the ", after: " file for" } },
      raw,
    );
    expect(m).not.toBeNull();
    expect(raw.slice(m!.startIdx, m!.startIdx + m!.length)).toBe("workspace config");
    expect(m!.recovered).toBe(true);
  });

  it("matches a quote spanning a link's label text", () => {
    const raw = "read the [mini-app guide](specs/guide.md) before building\n";
    const m = findAnchorMatch({ quote: "the mini-app guide before" }, raw);
    expect(m).not.toBeNull();
    expect(raw.slice(m!.startIdx, m!.startIdx + m!.length)).toBe(
      "the [mini-app guide](specs/guide.md) before",
    );
    expect(m!.recovered).toBe(true);
  });

  it("still orphans when the fingerprint is duplicated in the stripped view", () => {
    const raw = "x **b** y\nx **b** y\n";
    expect(
      findAnchorMatch({ quote: "b", context: { before: "x ", after: " y" } }, raw),
    ).toBeNull();
  });

  it("prefers a direct raw match over the stripped view", () => {
    const raw = "plain target here **target** there\n";
    const m = findAnchorMatch({ quote: "plain target" }, raw);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(false);
  });
});

describe("stripMdMapped", () => {
  it("maps stripped offsets back to original offsets", () => {
    const raw = "a **b** `c`";
    const { text, map } = stripMdMapped(raw);
    expect(text).toBe("a b c");
    expect(map[0]).toBe(0); // a
    expect(map[2]).toBe(4); // b (inside **)
    expect(map[4]).toBe(9); // c (inside `)
    expect(map[text.length]).toBe(raw.length); // end sentinel
  });

  it("unwraps nested markers to a fixpoint", () => {
    expect(stripMdMapped("**`code` bold**").text).toBe("code bold");
  });

  it("returns identity for marker-free text", () => {
    const { text, map } = stripMdMapped("no markers");
    expect(text).toBe("no markers");
    expect(map[3]).toBe(3);
  });
});

describe("findAnchorMatch — quotes spanning block boundaries", () => {
  it("matches a quote crossing from one list item into the next", () => {
    const raw =
      "- Lives at `x/` (installed: `mdc`). This is what all active work touches.\n" +
      "- **`ts/mdc/` git**: tracks core + CLI + server + `web/` frontend.\n";
    const m = findAnchorMatch(
      { quote: "all active work touches.\nts/mdc/ git: tracks core" },
      raw,
    );
    expect(m).not.toBeNull();
    expect(raw.slice(m!.startIdx, m!.startIdx + m!.length)).toContain("tracks core");
    expect(m!.recovered).toBe(true);
  });

  it("matches a quote crossing into a heading", () => {
    const raw = "closing paragraph line.\n\n## Repository\n\nfirst line after.\n";
    const m = findAnchorMatch({ quote: "closing paragraph line.\nRepository" }, raw);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
  });

  it("matches a quote crossing checkbox list items", () => {
    const raw = "- [ ] first task item\n- [x] second task item\n";
    const m = findAnchorMatch({ quote: "first task item\nsecond task item" }, raw);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
  });

  it("matches a quote starting inside a numbered list item", () => {
    const raw = "intro\n1. alpha step here\n2. beta step here\n";
    const m = findAnchorMatch({ quote: "alpha step here\nbeta step here" }, raw);
    expect(m).not.toBeNull();
    expect(m!.recovered).toBe(true);
  });
});
