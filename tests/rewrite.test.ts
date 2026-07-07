/**
 * Unit tests for the path-rewrite engine. Pure path math, no fs — these pin the
 * core safety property of a move: a reference is rewritten only when the move
 * changes the path it should contain, and basename-resolved wikilinks/embeds are
 * left alone so they keep resolving wherever a file lands.
 */

import { describe, expect, it } from "vitest";
import { linksTo, relinkInbound, relinkOutbound } from "../src/move/rewrite.js";

describe("relinkOutbound — the moved file's own links rebase", () => {
  it("rebases a `../../` link when the file moves down a level", () => {
    // notes/projects/alpha.md → archive/alpha.md
    const content = "see [index](../../index.md)";
    const { content: out, rewrites } = relinkOutbound(
      content,
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("see [index](../index.md)");
    expect(rewrites).toEqual([{ from: "../../index.md", to: "../index.md" }]);
  });

  it("rebases a sibling link when the file moves to a different folder", () => {
    // notes/projects/alpha.md → archive/alpha.md ; [beta](beta.md) targets
    // notes/projects/beta.md, now reachable as ../notes/projects/beta.md
    const { content: out } = relinkOutbound(
      "see [beta](beta.md)",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("see [beta](../notes/projects/beta.md)");
  });

  it("rebases a relative image src but leaves a basename embed alone", () => {
    const content = "![d](../../assets/d.png) and ![[d.png]]";
    const { content: out } = relinkOutbound(
      content,
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("![d](../assets/d.png) and ![[d.png]]");
  });

  it("leaves a same-directory move's sibling links untouched", () => {
    // moving within the same folder doesn't change relative targets
    const content = "see [beta](beta.md) and [index](../../index.md)";
    const { content: out, rewrites } = relinkOutbound(
      content,
      "notes/projects/alpha.md",
      "notes/projects/alpha2.md",
    );
    expect(out).toBe(content);
    expect(rewrites).toEqual([]);
  });

  it("leaves wikilinks untouched when the containing file moves (they're root-relative)", () => {
    // A qualified wikilink resolves by root-relative path-suffix, NOT from the
    // doc's directory — so moving the file that CONTAINS it changes nothing.
    // (Inbound rewrite, where the wikilink's *target* moves, is the case that
    // does touch a qualified wikilink — see relinkInbound tests.)
    const content = "[[notes/projects/beta]] and [[beta]]";
    const { content: out, rewrites } = relinkOutbound(content, "index.md", "sub/index.md");
    expect(out).toBe(content);
    expect(rewrites).toEqual([]);
  });

  it("preserves a #section suffix on a rewritten link", () => {
    const { content: out } = relinkOutbound(
      "[x](../../index.md#intro)",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("[x](../index.md#intro)");
  });

  it("leaves an intra-folder link alone when the sibling co-moves", () => {
    // Folder notes/projects → archive/projects. beta links [alpha](alpha.md);
    // alpha moves with it, so the link stays `alpha.md` (net-zero), NOT rebased
    // back to the vacated old path.
    const moved = new Map([
      ["notes/projects/alpha.md", "archive/projects/alpha.md"],
      ["notes/projects/beta.md", "archive/projects/beta.md"],
    ]);
    const { content: out, rewrites } = relinkOutbound(
      "[alpha](alpha.md)",
      "notes/projects/beta.md",
      "archive/projects/beta.md",
      moved,
    );
    expect(out).toBe("[alpha](alpha.md)");
    expect(rewrites).toEqual([]);
  });

  it("rebases a link to a NON-moving target during a folder move", () => {
    // Same folder move, but beta links UP to a doc outside the moved folder —
    // that target is stationary, so the link must rebase from beta's new home.
    const moved = new Map([["notes/projects/beta.md", "archive/projects/beta.md"]]);
    const { content: out } = relinkOutbound(
      "[index](../../index.md)",
      "notes/projects/beta.md",
      "archive/projects/beta.md",
      moved,
    );
    expect(out).toBe("[index](../../index.md)");
  });

  it("never touches external or root-absolute links", () => {
    const content = "[web](https://x.io/a.md) [abs](/index.md) [mail](mailto:a@b.c)";
    const { content: out, rewrites } = relinkOutbound(
      content,
      "notes/a.md",
      "deep/notes/a.md",
    );
    expect(out).toBe(content);
    expect(rewrites).toEqual([]);
  });
});

describe("relinkInbound — other docs' links to the moved file rewrite", () => {
  it("rewrites a sibling's relative link to the moved file", () => {
    // alpha moves; beta.md (in notes/projects) links [alpha](alpha.md)
    const { content: out, rewrites } = relinkInbound(
      "see [alpha](alpha.md)",
      "notes/projects/beta.md",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("see [alpha](../../archive/alpha.md)");
    expect(rewrites).toEqual([{ from: "alpha.md", to: "../../archive/alpha.md" }]);
  });

  it("rewrites a `../../` inbound link from a deep linking doc", () => {
    // index.md links [alpha](notes/projects/alpha.md); alpha → archive/
    const { content: out } = relinkInbound(
      "[alpha](notes/projects/alpha.md)",
      "index.md",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe("[alpha](archive/alpha.md)");
  });

  it("leaves links that point elsewhere untouched", () => {
    const content = "[beta](beta.md) [alpha](alpha.md)";
    const { content: out } = relinkInbound(
      content,
      "notes/projects/beta.md",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    // only the alpha link changes; the beta self-link is left
    expect(out).toBe("[beta](beta.md) [alpha](../../archive/alpha.md)");
  });

  it("rewrites a path-qualified inbound wikilink to the moved file", () => {
    const { content: out } = relinkInbound(
      "[[notes/projects/alpha]]",
      "notes/daily/today.md",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    // wikilinks stay root-relative (path-suffix resolved), not doc-relative
    expect(out).toBe("[[archive/alpha]]");
  });

  it("leaves a bare inbound wikilink alone (basename still resolves)", () => {
    const content = "[[alpha]] and [[alpha#images|Alpha]]";
    const { content: out, rewrites } = relinkInbound(
      content,
      "notes/daily/today.md",
      "notes/projects/alpha.md",
      "archive/alpha.md",
    );
    expect(out).toBe(content);
    expect(rewrites).toEqual([]);
  });
});

describe("linksTo — inbound-linker predicate for the preview scan", () => {
  it("detects a relative link that resolves to the target", () => {
    expect(linksTo("[a](alpha.md)", "notes/projects/beta.md", "notes/projects/alpha.md")).toBe(true);
  });

  it("detects a deep `../../` link to the target", () => {
    expect(linksTo("[a](../../index.md)", "notes/projects/alpha.md", "index.md")).toBe(true);
  });

  it("is false for a link to a different file", () => {
    expect(linksTo("[b](beta.md)", "notes/projects/x.md", "notes/projects/alpha.md")).toBe(false);
  });

  it("is false for a bare basename wikilink (not path-anchored to the target)", () => {
    expect(linksTo("[[alpha]]", "notes/daily/today.md", "notes/projects/alpha.md")).toBe(false);
  });

  it("detects a path-qualified wikilink to the target", () => {
    expect(
      linksTo("[[notes/projects/alpha]]", "notes/daily/today.md", "notes/projects/alpha.md"),
    ).toBe(true);
  });
});
