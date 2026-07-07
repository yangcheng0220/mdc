/**
 * Tests for app permission scope — the read/write gate enforced on every
 * bridge file operation.
 *
 * Effective scope = the app's own folder (+ subfolders) ∪ manifest scopes.
 * Write ⊆ read. Traversal and root escape are refused.
 */

import { describe, expect, it } from "vitest";
import type { AppManifest } from "../src/apps/manifest.js";
import { canRead, canWrite } from "../src/apps/scope.js";

const APP = "apps/board/board.html";

function manifest(read: string[], write: string[]): AppManifest {
  return { name: "Board", permissions: { read, write } };
}

describe("canRead", () => {
  it("allows the app's own folder and subfolders", () => {
    expect(canRead(APP, "apps/board/board.md", null)).toBe(true);
    expect(canRead(APP, "apps/board/data/cards.md", null)).toBe(true);
  });

  it("denies a sibling folder without a manifest", () => {
    expect(canRead(APP, "apps/other/x.md", null)).toBe(false);
    expect(canRead(APP, "tasks/private.md", null)).toBe(false);
  });

  it("allows a manifest-declared cross-folder read", () => {
    const m = manifest(["tasks"], []);
    expect(canRead(APP, "tasks/a.md", m)).toBe(true);
    expect(canRead(APP, "tasks/sub/b.md", m)).toBe(true);
    expect(canRead(APP, "other/c.md", m)).toBe(false);
  });

  it("treats a declared file scope as just that file", () => {
    const m = manifest(["tasks/a.md"], []);
    expect(canRead(APP, "tasks/a.md", m)).toBe(true);
    expect(canRead(APP, "tasks/b.md", m)).toBe(false);
  });

  it("refuses traversal escape", () => {
    expect(canRead(APP, "../secret.md", null)).toBe(false);
    expect(canRead(APP, "apps/board/../../escape.md", null)).toBe(false);
  });

  it("ignores a manifest scope that itself escapes root", () => {
    const m = manifest(["../outside"], []);
    expect(canRead(APP, "outside/x.md", m)).toBe(false);
  });
});

describe("canWrite", () => {
  it("allows writing within the app's own folder", () => {
    expect(canWrite(APP, "apps/board/board.md", null)).toBe(true);
  });

  it("denies a write outside the read scope", () => {
    expect(canWrite(APP, "tasks/a.md", manifest(["tasks"], []))).toBe(false);
  });

  it("allows a manifest-declared write (which is also readable)", () => {
    const m = manifest(["tasks"], ["tasks/a.md"]);
    expect(canWrite(APP, "tasks/a.md", m)).toBe(true);
    expect(canWrite(APP, "tasks/b.md", m)).toBe(false); // readable but not writable
  });

  it("write requires read even if declared in write scope", () => {
    // write lists a path not in read → still denied (write ⊆ read).
    const m = manifest([], ["other/x.md"]);
    expect(canWrite(APP, "other/x.md", m)).toBe(false);
  });

  it("refuses traversal on write", () => {
    expect(canWrite(APP, "../evil.md", null)).toBe(false);
  });
});
