/**
 * Tests for the app trust store — per-root `[apps]` table in `<root>/.mdc.toml`,
 * keyed by app path -> content hash.
 *
 * Trust = "I trust this exact version": an edited file (new hash) reads as
 * untrusted. Writes preserve the `user` identity key.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, currentUser } from "../src/identity.js";
import { isTrusted, revokeApp, trustApp } from "../src/apps/trust.js";

const roots: string[] = [];
function tempRoot(tomlText?: string): string {
  const d = mkdtempSync(join(tmpdir(), "mdc-trust-test-"));
  roots.push(d);
  if (tomlText !== undefined) writeFileSync(join(d, CONFIG_FILENAME), tomlText);
  return d;
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const APP = "apps/board/board.html";
const HTML = "<html>v1</html>";

describe("trust store", () => {
  it("untrusted by default", () => {
    expect(isTrusted(tempRoot(), APP, HTML)).toBe(false);
  });

  it("trust then verify-match", () => {
    const root = tempRoot();
    trustApp(root, APP, HTML);
    expect(isTrusted(root, APP, HTML)).toBe(true);
  });

  it("edited file (new bytes) reads as untrusted", () => {
    const root = tempRoot();
    trustApp(root, APP, HTML);
    expect(isTrusted(root, APP, "<html>v2 edited</html>")).toBe(false);
  });

  it("trust is per-path", () => {
    const root = tempRoot();
    trustApp(root, APP, HTML);
    expect(isTrusted(root, "apps/other/other.html", HTML)).toBe(false);
  });

  it("preserves the user identity key when writing trust", () => {
    const root = tempRoot('user = "odie"\n');
    trustApp(root, APP, HTML);
    // identity still resolves from this root's config
    expect(currentUser(root, { env: {}, home: tempRoot() })).toBe("odie");
    // and the raw file still carries the user line
    expect(readFileSync(join(root, CONFIG_FILENAME), "utf8")).toContain('user = "odie"');
  });

  it("revoke removes trust", () => {
    const root = tempRoot();
    trustApp(root, APP, HTML);
    expect(revokeApp(root, APP)).toBe(true);
    expect(isTrusted(root, APP, HTML)).toBe(false);
    expect(revokeApp(root, APP)).toBe(false); // already gone
  });

  it("malformed config reads as untrusted (never throws)", () => {
    const root = tempRoot("this is = not = valid = toml ===");
    expect(isTrusted(root, APP, HTML)).toBe(false);
  });

  it("trusting a second app keeps the first", () => {
    const root = tempRoot();
    trustApp(root, APP, HTML);
    trustApp(root, "apps/two/two.html", "<html>two</html>");
    expect(isTrusted(root, APP, HTML)).toBe(true);
    expect(isTrusted(root, "apps/two/two.html", "<html>two</html>")).toBe(true);
  });
});
