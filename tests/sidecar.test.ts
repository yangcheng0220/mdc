/**
 * Tests for the sidecar core: read/append, thread derivation + fold, the
 * status lifecycle, prune-if-empty, and batch validation.
 */

import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as sidecar from "../src/sidecar.js";
import type { Entry } from "../src/sidecar.js";

const USER = "dana"; // the configured user name in these fixtures

function comment(id: string, quote: string, author = USER, line = 1): Entry {
  return {
    id,
    anchor: { quote, line },
    parent_id: null,
    author,
    body: `c-${id}`,
    timestamp: `2026-06-12T00:00:0${id[id.length - 1]}Z`,
  };
}

function reply(id: string, parentId: string, author: string, ts = "2026-06-12T00:01:00Z"): Entry {
  return { id, anchor: null, parent_id: parentId, author, body: `r-${id}`, timestamp: ts };
}

function event(type: string, kw: Record<string, unknown> = {}): Entry {
  return {
    id: "ev" + type.slice(0, 2),
    type,
    author: USER,
    timestamp: "2026-06-12T00:02:00Z",
    ...kw,
  };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "mdc-test-"));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("paths", () => {
  it("sidecar path appends suffix, does not replace", () => {
    // PROJECT.md (dotted name) must keep the .md, not lose it.
    const p = sidecar.sidecarPathFor("/x/PROJECT.md");
    expect(p).toBe("/x/PROJECT.md.comments.jsonl");
  });

  it("md path round trip", () => {
    const sc = sidecar.sidecarPathFor("/x/a.b.md");
    expect(sidecar.mdPathFor(sc)).toBe("/x/a.b.md");
  });

  it("md path rejects non-sidecar", () => {
    expect(() => sidecar.mdPathFor("/x/a.md")).toThrow();
  });
});

describe("raw I/O", () => {
  it("round trip and missing file", () => {
    const sc = join(tempDir(), "f.md.comments.jsonl");
    expect(sidecar.readSidecar(sc)).toEqual([]); // missing -> []
    const e1 = comment("c1", "q1");
    const e2 = comment("c2", "q2");
    sidecar.appendEntries(sc, [e1, e2]);
    expect(sidecar.readSidecar(sc)).toEqual([e1, e2]);
  });

  it("append is additive", () => {
    const sc = join(tempDir(), "f.md.comments.jsonl");
    sidecar.appendEntry(sc, comment("c1", "q1"));
    sidecar.appendEntry(sc, comment("c2", "q2"));
    expect(sidecar.readSidecar(sc)).toHaveLength(2);
  });

  it("blank lines skipped", () => {
    const sc = join(tempDir(), "f.md.comments.jsonl");
    writeFileSync(sc, '{"id":"c1"}\n\n  \n{"id":"c2"}\n');
    expect(sidecar.readSidecar(sc)).toHaveLength(2);
  });
});

describe("deriveThreads", () => {
  it("open thread awaiting agent", () => {
    const entries = [comment("c1", "q1", USER)];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect(t.status).toBe("open");
    expect(t.awaiting).toBe("agent"); // user spoke last -> agent's turn
    expect(t.lifecycle).toBe("pending");
  });

  it("agent reply flips awaiting to you", () => {
    const entries = [comment("c1", "q1", USER), reply("r1", "c1", "claude")];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect(t.awaiting).toBe("you");
    expect(t.reply_count).toBe(1);
  });

  it("resolved thread kept and flagged", () => {
    const entries = [comment("c1", "q1"), event("resolved", { thread_id: "c1" })];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect(t.status).toBe("resolved");
    expect(t.lifecycle).toBe("resolved");
  });

  it("unresolve reopens", () => {
    const entries = [
      comment("c1", "q1"),
      event("resolved", { thread_id: "c1" }),
      event("unresolved", { thread_id: "c1" }),
    ];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect(t.status).toBe("open");
    expect(t.lifecycle).toBe("pending"); // never acked
  });

  it("deleted parent with no replies drops thread", () => {
    const entries = [comment("c1", "q1"), event("deleted", { comment_id: "c1" })];
    expect(sidecar.deriveThreads(entries, USER)).toEqual([]);
  });

  it("deleted parent with reply survives", () => {
    const entries = [
      comment("c1", "q1"),
      reply("r1", "c1", "claude"),
      event("deleted", { comment_id: "c1" }),
    ];
    const threads = sidecar.deriveThreads(entries, USER);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.reply_count).toBe(1);
  });

  it("deleted reply drops from thread", () => {
    const entries = [
      comment("c1", "q1", USER),
      reply("r1", "c1", "claude"),
      event("deleted", { comment_id: "r1" }),
    ];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect(t.reply_count).toBe(0);
    expect(t.awaiting).toBe("agent"); // last surviving entry is user's c1
  });

  it("awaiting uses configured user, not hardcoded", () => {
    // With a DIFFERENT user, the same data flips awaiting.
    const entries = [comment("c1", "q1", "alice")];
    expect(sidecar.deriveThreads(entries, "alice")[0]!.awaiting).toBe("agent");
    expect(sidecar.deriveThreads(entries, "dana")[0]!.awaiting).toBe("you");
  });
});

describe("lifecycle", () => {
  it("pending then acknowledged", () => {
    const entries = [comment("c1", "q1")];
    expect(sidecar.deriveThreads(entries, USER)[0]!.lifecycle).toBe("pending");
    entries.push(event("acknowledged", { thread_id: "c1" }));
    expect(sidecar.deriveThreads(entries, USER)[0]!.lifecycle).toBe("acknowledged");
  });

  it("acknowledged then resolved", () => {
    const entries = [
      comment("c1", "q1"),
      event("acknowledged", { thread_id: "c1" }),
      event("resolved", { thread_id: "c1" }),
    ];
    expect(sidecar.deriveThreads(entries, USER)[0]!.lifecycle).toBe("resolved");
  });

  it("unresolve after ack returns to acknowledged", () => {
    const entries = [
      comment("c1", "q1"),
      event("acknowledged", { thread_id: "c1" }),
      event("resolved", { thread_id: "c1" }),
      event("unresolved", { thread_id: "c1" }),
    ];
    expect(sidecar.deriveThreads(entries, USER)[0]!.lifecycle).toBe("acknowledged");
  });

  it("backward compat: no lifecycle events reads as pending/open", () => {
    const entries = [comment("c1", "q1")];
    const t = sidecar.deriveThreads(entries, USER)[0]!;
    expect([t.status, t.lifecycle]).toEqual(["open", "pending"]);
  });
});

describe("latestBodyByComment", () => {
  it("maps a comment id to its edited body", () => {
    const entries = [
      comment("c1", "q1"),
      event("edit", { comment_id: "c1", body: "edited body" }),
    ];
    expect(sidecar.latestBodyByComment(entries).get("c1")).toBe("edited body");
  });

  it("last edit wins when a comment is edited more than once", () => {
    const entries = [
      comment("c1", "q1"),
      event("edit", { comment_id: "c1", body: "first edit" }),
      event("edit", { comment_id: "c1", body: "second edit" }),
    ];
    expect(sidecar.latestBodyByComment(entries).get("c1")).toBe("second edit");
  });

  it("is empty when nothing was edited", () => {
    expect(sidecar.latestBodyByComment([comment("c1", "q1")]).size).toBe(0);
  });
});

describe("open-thread helpers", () => {
  it("openThreadsAwaitingAgent", () => {
    const entries = [
      comment("c1", "q1", USER), // awaiting agent
      comment("c2", "q2", USER), // awaiting agent...
      reply("r2", "c2", "claude"), // ...now awaiting you
      comment("c3", "q3", USER),
      event("resolved", { thread_id: "c3" }), // resolved -> excluded
    ];
    const awaiting = sidecar.openThreadsAwaitingAgent(entries, USER);
    expect(new Set(awaiting.map((t) => t.thread_id))).toEqual(new Set(["c1"]));
  });

  it("count and prune", () => {
    const sc = join(tempDir(), "f.md.comments.jsonl");
    sidecar.appendEntries(sc, [comment("c1", "q1", USER)]);
    expect(sidecar.countOpenThreads(sc, USER)).toBe(1);
    // delete the only comment -> no surviving threads -> pruned
    sidecar.appendEntry(sc, event("deleted", { comment_id: "c1" }));
    expect(sidecar.pruneIfEmpty(sc, USER)).toBe(true);
    expect(existsSync(sc)).toBe(false);
  });

  it("prune keeps resolved-only", () => {
    const sc = join(tempDir(), "f.md.comments.jsonl");
    sidecar.appendEntries(sc, [comment("c1", "q1"), event("resolved", { thread_id: "c1" })]);
    expect(sidecar.pruneIfEmpty(sc, USER)).toBe(false); // resolved != gone
    expect(existsSync(sc)).toBe(true);
  });
});

describe("buildEntries", () => {
  it("fills fields for top-level", () => {
    const out = sidecar.buildEntries(
      [{ anchor: { quote: "hi" }, body: "hello" }],
      [],
      "f.md",
      "claude",
    );
    const e = out[0]!;
    expect(e.author).toBe("claude");
    expect(e.file).toBe("f.md");
    expect(e.body).toBe("hello");
    expect(e.id).toBeDefined();
    expect(e.timestamp).toBeDefined();
  });

  it("reply requires existing parent", () => {
    expect(() =>
      sidecar.buildEntries([{ parent_id: "nope", body: "x" }], [], "f.md", "claude"),
    ).toThrow(sidecar.ValidationError);
  });

  it("accepts a suggestion on a reply", () => {
    const suggestion = {
      target: { quote: "old", context: { before: "", after: " text" } },
      replacement: "new",
    };
    const out = sidecar.buildEntries(
      [{ parent_id: "c1", body: "tighten this", suggestion }],
      [comment("c1", "q1")],
      "f.md",
      "claude",
    );
    expect(out[0]!.suggestion).toEqual(suggestion);
  });

  it("requires both suggestion target context strings", () => {
    expect(() =>
      sidecar.buildEntries(
        [{
          parent_id: "c1",
          body: "tighten this",
          suggestion: { target: { quote: "old", context: { before: "" } }, replacement: "new" },
        }],
        [comment("c1", "q1")],
        "f.md",
        "claude",
      ),
    ).toThrow(/context\.after/);
  });

  it("rejects a missing suggestion target context", () => {
    expect(() =>
      sidecar.buildEntries(
        [{
          parent_id: "c1",
          body: "tighten this",
          suggestion: { target: { quote: "old" }, replacement: "new" },
        }],
        [comment("c1", "q1")],
        "f.md",
        "claude",
      ),
    ).toThrow(/target\.context/);
  });

  it("accepts an empty suggestion replacement", () => {
    const out = sidecar.buildEntries(
      [{
        anchor: { quote: "q" },
        body: "delete this",
        suggestion: {
          target: { quote: "old", context: { before: "", after: "" } },
          replacement: "",
        },
      }],
      [],
      "f.md",
      "claude",
    );
    expect(out[0]!.suggestion!.replacement).toBe("");
  });

  it("rejects a suggestion on an event line", () => {
    expect(() =>
      sidecar.buildEntries(
        [{
          type: "resolved",
          thread_id: "c1",
          suggestion: {
            target: { quote: "old", context: { before: "", after: "" } },
            replacement: "new",
          },
        }],
        [comment("c1", "q1")],
        "f.md",
        "claude",
      ),
    ).toThrow(/only valid on a comment or reply/);
  });

  it("empty body rejected", () => {
    expect(() =>
      sidecar.buildEntries([{ anchor: { quote: "q" }, body: "  " }], [], "f.md", "claude"),
    ).toThrow(sidecar.ValidationError);
  });

  it("both anchor and parent rejected", () => {
    expect(() =>
      sidecar.buildEntries(
        [{ anchor: { quote: "q" }, parent_id: "c1", body: "x" }],
        [comment("c1", "q1")],
        "f.md",
        "claude",
      ),
    ).toThrow(sidecar.ValidationError);
  });

  it("acknowledged requires existing thread", () => {
    expect(() =>
      sidecar.buildEntries([{ type: "acknowledged", thread_id: "nope" }], [], "f.md", "claude"),
    ).toThrow(sidecar.ValidationError);
  });

  it("acknowledged event built", () => {
    const existing = [comment("c1", "q1")];
    const out = sidecar.buildEntries(
      [{ type: "acknowledged", thread_id: "c1" }],
      existing,
      "f.md",
      "claude",
    );
    expect(out[0]!.type).toBe("acknowledged");
    expect(out[0]!.thread_id).toBe("c1");
  });

  it("resolved snapshots anchor", () => {
    const existing = [comment("c1", "the quote", USER, 5)];
    const out = sidecar.buildEntries(
      [{ type: "resolved", thread_id: "c1" }],
      existing,
      "f.md",
      "claude",
    );
    expect(out[0]!.anchor_snapshot!.quote).toBe("the quote");
    expect(out[0]!.anchor_snapshot!.line).toBe(5);
  });

  it("unknown type rejected", () => {
    expect(() =>
      sidecar.buildEntries(
        [{ type: "bogus", thread_id: "c1" }],
        [comment("c1", "q1")],
        "f.md",
        "claude",
      ),
    ).toThrow(sidecar.ValidationError);
  });

  it("empty batch rejected", () => {
    expect(() => sidecar.buildEntries([], [], "f.md", "claude")).toThrow(
      sidecar.ValidationError,
    );
  });
});
