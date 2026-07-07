import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveIndexedPdf } from "../src/server/paths.js";
import { buildPdfIndex } from "../src/server/walk.js";

let dir: string;

function writeFile(rel: string, content = "data"): void {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-pdf-index-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PDF index", () => {
  it("buildPdfIndex finds .pdf files under root", () => {
    writeFile("docs/guide.pdf");
    writeFile("docs/notes.md");

    expect([...buildPdfIndex(dir, new Set())].sort()).toEqual(["docs/guide.pdf"]);
  });

  it("buildPdfIndex prunes denied dirs", () => {
    writeFile("docs/guide.pdf");
    writeFile("private/hidden.pdf");

    expect([...buildPdfIndex(dir, new Set(["private"]))].sort()).toEqual(["docs/guide.pdf"]);
  });

  it("resolveIndexedPdf returns indexed paths and rejects unindexed ones", () => {
    const index = new Set(["docs/guide.pdf"]);

    expect(resolveIndexedPdf(index, "docs/guide.pdf")).toBe("docs/guide.pdf");
    expect(resolveIndexedPdf(index, "docs/missing.pdf")).toBeNull();
  });
});
