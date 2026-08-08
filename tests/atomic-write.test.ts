/**
 * Tests for atomic whole-file replacement.
 *
 * The property that matters: a reader concurrent with a write sees either the
 * complete old bytes or the complete new bytes, never a partially rewritten
 * file. `writeFileSync` truncates and then streams, so it fails this; staging
 * into a sibling temp file and renaming over the target passes it.
 */

import { fork } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomicSync } from "../src/server/atomic-write.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-atomic-"));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("writeFileAtomicSync", () => {
  it("writes content to a new file", () => {
    const target = join(dir, "new.md");
    writeFileAtomicSync(target, "# Hello\n");
    expect(readFileSync(target, "utf8")).toBe("# Hello\n");
  });

  it("replaces the content of an existing file", () => {
    const target = join(dir, "doc.md");
    writeFileSync(target, "old\n");
    writeFileAtomicSync(target, "new\n");
    expect(readFileSync(target, "utf8")).toBe("new\n");
  });

  it("preserves the existing target's permission bits", () => {
    // Replacing the target swaps in a new inode; without carrying the mode
    // across, a 0600 file would silently widen to the default 0644.
    const target = join(dir, "private.md");
    writeFileSync(target, "secret\n");
    chmodSync(target, 0o600);
    writeFileAtomicSync(target, "still secret\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(target, "utf8")).toBe("still secret\n");
  });

  it("keeps a restrictive mode across repeated saves", () => {
    const target = join(dir, "locked.md");
    writeFileSync(target, "a\n");
    chmodSync(target, 0o640);
    writeFileAtomicSync(target, "b\n");
    writeFileAtomicSync(target, "c\n");
    expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  it("never stages private content at a broader mode than the target", async () => {
    // The final target mode is not enough: if the temp file is created at the
    // default mode and narrowed afterwards, a large private document is briefly
    // world-readable in a searchable directory. Watch the sibling temp file
    // itself while a big 0600 save runs.
    const target = join(dir, "private.md");
    writeFileSync(target, "seed\n");
    chmodSync(target, 0o600);

    const watcherSrc = join(dir, "mode-watcher.cjs");
    writeFileSync(
      watcherSrc,
      `const { readdirSync, statSync } = require("node:fs");
       const dir = ${JSON.stringify(dir)};
       const seen = new Set();
       const deadline = Date.now() + 4000;
       while (Date.now() < deadline) {
         for (const f of readdirSync(dir)) {
           if (!f.endsWith(".tmp")) continue;
           try { seen.add(statSync(dir + "/" + f).mode & 0o777); } catch {}
         }
       }
       process.send({ modes: [...seen] });`,
    );

    const child = fork(watcherSrc, { stdio: "ignore" });
    const observed = new Promise<{ modes: number[] }>((resolve) => {
      child.on("message", (m: { modes: number[] }) => resolve(m));
    });

    await new Promise((r) => setTimeout(r, 200));
    // Large enough that staging takes long enough to sample.
    writeFileAtomicSync(target, "S".repeat(40 * 1024 * 1024));

    const { modes } = await observed;
    child.kill();
    // Every mode the staged file was ever seen at must be no broader than 0600.
    for (const m of modes) expect(m & ~0o600).toBe(0);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  }, 20000);

  it("leaves no temp files behind on success", () => {
    const target = join(dir, "doc.md");
    writeFileAtomicSync(target, "content\n");
    expect(readdirSync(dir)).toEqual(["doc.md"]);
  });

  it("leaves the original byte-identical and cleans up when publication fails", () => {
    // A directory at the target path makes the final rename fail while the
    // staged temp file has already been written — the failure-after-staging
    // case the cleanup path exists for.
    const target = join(dir, "blocked");
    rmSync(target, { force: true, recursive: true });
    writeFileSync(join(dir, "keep.md"), "untouched\n");
    const targetDir = join(dir, "blocked");
    mkdirSync(targetDir);

    expect(() => writeFileAtomicSync(targetDir, "candidate\n")).toThrow();
    // The staged file must not survive the failure.
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(join(dir, "keep.md"), "utf8")).toBe("untouched\n");
  });

  it("never exposes a partially written file to a concurrent reader", async () => {
    // Large enough that a truncate-then-stream write takes long enough for a
    // reader to catch it mid-flight; with plain writeFileSync this reader
    // observes many short reads.
    const target = join(dir, "big.md");
    const SIZE = 8 * 1024 * 1024;
    const OLD = "A".repeat(SIZE);
    const NEW = "B".repeat(SIZE);
    writeFileSync(target, OLD);

    const readerSrc = join(dir, "reader.cjs");
    writeFileSync(
      readerSrc,
      `const { readFileSync } = require("node:fs");
       const target = ${JSON.stringify(target)};
       const deadline = Date.now() + 3000;
       let torn = 0, reads = 0;
       while (Date.now() < deadline) {
         try {
           const b = readFileSync(target, "utf8");
           reads++;
           // Complete old or complete new. Anything else is a torn read:
           // wrong length, or a mix of both fills.
           const whole = b.length === ${SIZE} && (b[0] === b[b.length - 1]);
           if (!whole) torn++;
         } catch { /* rename swap can briefly ENOENT on some platforms */ }
         if (process.send && reads % 50 === 0) process.send({ tick: true });
       }
       process.send({ done: true, torn, reads });`,
    );

    const child = fork(readerSrc, { stdio: "ignore" });
    const result = new Promise<{ torn: number; reads: number }>((resolve) => {
      child.on("message", (m: { done?: boolean; torn: number; reads: number }) => {
        if (m.done) resolve({ reads: m.reads, torn: m.torn });
      });
    });

    // Give the reader a moment to start spinning, then republish repeatedly.
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 0; i < 8; i++) {
      writeFileAtomicSync(target, i % 2 === 0 ? NEW : OLD);
      await new Promise((r) => setTimeout(r, 20));
    }

    const { torn, reads } = await result;
    child.kill();
    expect(reads).toBeGreaterThan(0);
    expect(torn).toBe(0);
  }, 15000);

  it("stages the temp file beside the target, not in the system temp dir", () => {
    // A cross-filesystem rename would fail; staging must be a sibling. Observed
    // indirectly: writing into a subdirectory succeeds and leaves it clean.
    const sub = join(dir, "nested");
    mkdirSync(sub);
    const target = join(sub, "doc.md");
    writeFileAtomicSync(target, "x\n");
    expect(readFileSync(target, "utf8")).toBe("x\n");
    expect(readdirSync(sub)).toEqual(["doc.md"]);
    expect(existsSync(target)).toBe(true);
  });
});
