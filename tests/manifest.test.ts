/**
 * Tests for the app manifest parser — the `mdc-app` HTML-comment block that a
 * trusted app uses to declare its name and read/write file scopes.
 *
 * Absent block -> null (caller applies the same-folder default). Present but
 * malformed -> ManifestError.
 */

import { describe, expect, it } from "vitest";
import { ManifestError, parseManifest } from "../src/apps/manifest.js";

const FULL = `<!DOCTYPE html>
<!--
mdc-app:
  name: Board
  permissions:
    read:
      - board.md
      - notes/extra.md
    write:
      - board.md
-->
<html><body>app</body></html>`;

describe("parseManifest", () => {
  it("parses name + read/write scopes", () => {
    const m = parseManifest(FULL);
    expect(m).not.toBeNull();
    expect(m?.name).toBe("Board");
    expect(m?.permissions.read).toEqual(["board.md", "notes/extra.md"]);
    expect(m?.permissions.write).toEqual(["board.md"]);
  });

  it("returns null when no mdc-app block is present", () => {
    expect(parseManifest("<html><!-- just a normal comment --></html>")).toBeNull();
    expect(parseManifest("<html>no comments at all</html>")).toBeNull();
  });

  it("parses a manifest with only a name (default scopes empty)", () => {
    const m = parseManifest("<!--\nmdc-app:\n  name: Tiny\n-->");
    expect(m?.name).toBe("Tiny");
    expect(m?.permissions.read).toEqual([]);
    expect(m?.permissions.write).toEqual([]);
  });

  it("declares a cross-folder read scope", () => {
    const m = parseManifest(
      "<!--\nmdc-app:\n  name: Dash\n  permissions:\n    read:\n      - tasks/a.md\n      - tasks/b.md\n-->",
    );
    expect(m?.permissions.read).toEqual(["tasks/a.md", "tasks/b.md"]);
    expect(m?.permissions.write).toEqual([]);
  });

  it("strips quotes around scalars and list items", () => {
    const m = parseManifest(`<!--\nmdc-app:\n  name: "My App"\n  permissions:\n    read:\n      - "a b.md"\n-->`);
    expect(m?.name).toBe("My App");
    expect(m?.permissions.read).toEqual(["a b.md"]);
  });

  it("finds the mdc-app block even when an unrelated comment precedes it", () => {
    const html = "<!-- license header -->\n<!--\nmdc-app:\n  name: X\n-->";
    expect(parseManifest(html)?.name).toBe("X");
  });

  it("throws on a manifest missing a name", () => {
    expect(() => parseManifest("<!--\nmdc-app:\n  permissions:\n    read:\n      - a.md\n-->")).toThrow(
      ManifestError,
    );
  });

  it("throws on an unknown key", () => {
    expect(() => parseManifest("<!--\nmdc-app:\n  name: X\n  bogus: y\n-->")).toThrow(ManifestError);
  });

  it("throws on a list item outside read/write", () => {
    expect(() => parseManifest("<!--\nmdc-app:\n  name: X\n  - stray.md\n-->")).toThrow(ManifestError);
  });
});
