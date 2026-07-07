/**
 * Tests for identity — config-driven "who is the user".
 *
 * Resolution: MDC_USER env -> ~/.mdc.toml -> <root>/.mdc.toml -> "user".
 * Home is injected as a temp dir in every test so the developer's real
 * ~/.mdc.toml never leaks in.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, currentUser, currentUserWithSource } from "../src/identity.js";

const tempDirs: string[] = [];
function tempDir(tomlText?: string): string {
  const d = mkdtempSync(join(tmpdir(), "mdc-id-test-"));
  tempDirs.push(d);
  if (tomlText !== undefined) writeFileSync(join(d, CONFIG_FILENAME), tomlText);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("identity", () => {
  it("default when nothing set", () => {
    expect(currentUser(null, { env: {}, home: tempDir() })).toBe("user");
    expect(currentUserWithSource(null, { env: {}, home: tempDir() })).toEqual({
      name: "user",
      source: "default",
    });
  });

  it("env wins over everything", () => {
    const home = tempDir('user = "bob"');
    const root = tempDir('user = "carol"');
    expect(currentUser(root, { env: { MDC_USER: "alice" }, home })).toBe("alice");
    expect(currentUserWithSource(root, { env: { MDC_USER: "alice" }, home })).toEqual({
      name: "alice",
      source: "env",
    });
  });

  it("home config used", () => {
    expect(currentUser(null, { env: {}, home: tempDir('user = "dana"') })).toBe("dana");
    expect(currentUserWithSource(null, { env: {}, home: tempDir('user = "dana"') })).toEqual({
      name: "dana",
      source: "home",
    });
  });

  it("home wins over root", () => {
    const home = tempDir('user = "dana"');
    const root = tempDir('user = "rooty"');
    expect(currentUser(root, { env: {}, home })).toBe("dana");
  });

  it("root used when no home config", () => {
    const home = tempDir(); // no ~/.mdc.toml
    const root = tempDir('user = "rooty"');
    expect(currentUser(root, { env: {}, home })).toBe("rooty");
    expect(currentUserWithSource(root, { env: {}, home })).toEqual({
      name: "rooty",
      source: "root",
    });
  });

  it("default when config missing everywhere", () => {
    expect(currentUser(tempDir(), { env: {}, home: tempDir() })).toBe("user");
  });

  it("malformed config falls through", () => {
    const home = tempDir("this is not = valid = toml ===");
    expect(currentUser(null, { env: {}, home })).toBe("user");
  });

  it("empty user in config falls through", () => {
    expect(currentUser(null, { env: {}, home: tempDir('user = ""') })).toBe("user");
  });
});
