/**
 * Tests for the trusted-app bridge routes (/api/app/*).
 *
 * Each route loads the app's manifest + trust state server-side and enforces
 * read/write scope before touching disk. Exercised in-process via app.fetch
 * against a temp root, the same harness as server.test.ts.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import type { RootWatcher } from "../src/server/watcher.js";

let dir: string;
let staticDir: string;
let app: ReturnType<typeof createApp>["app"];
let watcher: RootWatcher;

function write(rel: string, content: string): void {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
function read(rel: string): string {
  return readFileSync(join(dir, rel), "utf8");
}
function req(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://test${path}`, init)));
}
function post(path: string, body: unknown): Promise<Response> {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function put(path: string, body: unknown): Promise<Response> {
  return req(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A minimal app: own folder scope by default, plus a manifest declaring a
// cross-folder read of `data/`.
const APP = "apps/board/board.html";
function appHtml(manifest?: string): string {
  const block = manifest ? `<!--\n${manifest}\n-->\n` : "";
  return `${block}<html><body>board</body></html>`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-appapi-test-"));
  staticDir = mkdtempSync(join(tmpdir(), "mdc-appapi-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html>");
  ({ app, watcher } = createApp({ root: dir, staticDir, denyRaw: "", user: "dana" }));
});
afterEach(() => {
  watcher.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(staticDir, { recursive: true, force: true });
});

/** Trust the app via the route (hashes its current bytes). */
async function trust(appRel = APP): Promise<Response> {
  return post("/api/app/trust", { app: appRel });
}

describe("/api/app/info", () => {
  it("reports untrusted + manifest before trust, trusted after", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - apps/board/board.md\n    write:\n      - apps/board/board.md"));
    let r = await req(`/api/app/info?app=${APP}`);
    expect(r.status).toBe(200);
    let body = await r.json();
    expect(body.trusted).toBe(false);
    expect(body.name).toBe("Board");
    expect(body.permissions.read).toContain("apps/board/board.md");

    await trust();
    r = await req(`/api/app/info?app=${APP}`);
    body = await r.json();
    expect(body.trusted).toBe(true);
  });

  it("404 for an html file not in the index", async () => {
    const r = await req(`/api/app/info?app=apps/board/ghost.html`);
    expect(r.status).toBe(404);
  });
});

describe("trust + read", () => {
  it("reads a file in the app's own folder once trusted", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "# Board\n");
    await trust();
    const r = await req(`/api/app/read?app=${APP}&path=apps/board/board.md`);
    expect(r.status).toBe(200);
    expect((await r.json()).content).toBe("# Board\n");
  });

  it("403 reading before trust", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "# Board\n");
    const r = await req(`/api/app/read?app=${APP}&path=apps/board/board.md`);
    expect(r.status).toBe(403);
  });

  it("403 reading outside the app's folder without a manifest", async () => {
    write(APP, appHtml());
    write("secret/private.md", "shh");
    await trust();
    const r = await req(`/api/app/read?app=${APP}&path=secret/private.md`);
    expect(r.status).toBe(403);
  });

  it("reads a manifest-declared cross-folder path", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "card");
    await trust();
    const r = await req(`/api/app/read?app=${APP}&path=data/cards.md`);
    expect(r.status).toBe(200);
    expect((await r.json()).content).toBe("card");
  });
});

describe("write", () => {
  it("writes within the app's folder and persists to disk", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    await trust();
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, { content: "new" });
    expect(r.status).toBe(200);
    expect((await r.json()).saved).toBe(true);
    expect(read("apps/board/board.md")).toBe("new");
  });

  it("403 writing outside scope", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "x");
    await trust();
    // data is readable but not writable → write denied
    const r = await put(`/api/app/write?app=${APP}&path=data/cards.md`, { content: "y" });
    expect(r.status).toBe(403);
    expect(read("data/cards.md")).toBe("x"); // untouched
  });

  it("403 writing before trust", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, { content: "new" });
    expect(r.status).toBe(403);
    expect(read("apps/board/board.md")).toBe("old");
  });
});

describe("delete", () => {
  const del = (path: string) =>
    req(`/api/app/delete?app=${APP}&path=${encodeURIComponent(path)}`, { method: "DELETE" });
  const exists = (rel: string): boolean => existsSync(join(dir, rel));

  it("deletes a file in the app's own folder (+ its sidecar)", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "x");
    write("apps/board/board.md.comments.jsonl", "{}"); // sidecar cleaned too
    await trust();
    const r = await del("apps/board/board.md");
    expect(r.status).toBe(200);
    expect((await r.json()).deleted).toBe(true);
    expect(exists("apps/board/board.md")).toBe(false);
    expect(exists("apps/board/board.md.comments.jsonl")).toBe(false);
  });

  it("no-op-succeeds when the file is already gone", async () => {
    write(APP, appHtml());
    await trust();
    const r = await del("apps/board/missing.md");
    expect(r.status).toBe(200);
    expect((await r.json()).deleted).toBe(false);
  });

  it("403 deleting outside write scope (read-only scope can't delete)", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "x");
    await trust();
    const r = await del("data/cards.md");
    expect(r.status).toBe(403);
    expect(exists("data/cards.md")).toBe(true); // untouched
  });

  it("403 deleting before trust", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "x");
    const r = await del("apps/board/board.md");
    expect(r.status).toBe(403);
    expect(exists("apps/board/board.md")).toBe(true);
  });
});

describe("conflict-safe write (optimistic concurrency)", () => {
  // read returns the file's version; passing it back to write conflict-checks.
  async function readVersion(rel: string): Promise<string> {
    const r = await req(`/api/app/read?app=${APP}&path=${rel}`);
    return (await r.json()).version as string;
  }

  it("read returns a stable content version", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "# Board\n");
    await trust();
    const v1 = await readVersion("apps/board/board.md");
    expect(typeof v1).toBe("string");
    expect(v1.length).toBeGreaterThan(0);
    // same bytes → same version (deterministic, content-based)
    expect(await readVersion("apps/board/board.md")).toBe(v1);
  });

  it("writes when baseVersion still matches, returns the new version", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    await trust();
    const base = await readVersion("apps/board/board.md");
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, {
      content: "new",
      baseVersion: base,
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.saved).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version).not.toBe(base); // content changed → version changed
    expect(read("apps/board/board.md")).toBe("new");
  });

  it("409 + file untouched when the file changed underneath the base", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    await trust();
    const stale = await readVersion("apps/board/board.md");
    // an external edit lands between the app's read and its write
    write("apps/board/board.md", "edited-elsewhere");
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, {
      content: "app-write",
      baseVersion: stale,
    });
    expect(r.status).toBe(409);
    expect((await r.json()).detail).toMatch(/changed underneath/);
    expect(read("apps/board/board.md")).toBe("edited-elsewhere"); // not clobbered
  });

  it("blind write (no baseVersion) overwrites unconditionally — back-compat", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    await trust();
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, { content: "new" });
    expect(r.status).toBe(200);
    expect(read("apps/board/board.md")).toBe("new");
  });

  it("409 when a baseVersion is given but the file no longer exists", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "old");
    await trust();
    const base = await readVersion("apps/board/board.md");
    rmSync(join(dir, "apps/board/board.md")); // deleted underneath
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/board.md`, {
      content: "resurrect",
      baseVersion: base,
    });
    expect(r.status).toBe(409);
  });

  it("creating a new file needs no baseVersion (writes fresh)", async () => {
    write(APP, appHtml());
    await trust();
    const r = await put(`/api/app/write?app=${APP}&path=apps/board/fresh.md`, { content: "hi" });
    expect(r.status).toBe(200);
    expect(read("apps/board/fresh.md")).toBe("hi");
  });
});

describe("trust is version-specific", () => {
  it("editing the app after trust makes it untrusted again", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "x");
    await trust();
    expect((await req(`/api/app/read?app=${APP}&path=apps/board/board.md`)).status).toBe(200);

    // Swap the app's bytes → stored hash no longer matches.
    write(APP, appHtml() + "<!-- edited -->");
    expect((await req(`/api/app/read?app=${APP}&path=apps/board/board.md`)).status).toBe(403);
  });
});

describe("list", () => {
  it("lists only files the app may read", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "a");
    write("apps/board/notes.md", "b");
    await trust();
    const r = await req(`/api/app/list?app=${APP}&path=apps/board`);
    expect(r.status).toBe(200);
    const paths = (await r.json()).entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("apps/board/board.md");
    expect(paths).toContain("apps/board/notes.md");
  });

  it("one-level (default) does not descend into subfolders", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/top.md", "a");
    write("data/sub/deep.md", "b");
    await trust();
    const r = await req(`/api/app/list?app=${APP}&path=data`);
    const paths = (await r.json()).entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("data/top.md");
    expect(paths).toContain("data/sub"); // the dir surfaces, but not its contents
    expect(paths).not.toContain("data/sub/deep.md");
  });

  it("recursive returns the whole subtree, files only", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/top.md", "a");
    write("data/sub/deep.md", "b");
    write("data/sub/more/deeper.md", "c");
    await trust();
    const r = await req(`/api/app/list?app=${APP}&path=data&recursive=1`);
    const entries = (await r.json()).entries as { path: string; type: string }[];
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("data/top.md");
    expect(paths).toContain("data/sub/deep.md");
    expect(paths).toContain("data/sub/more/deeper.md");
    expect(entries.every((e) => e.type === "file")).toBe(true); // no dir entries
  });

  it("recursive prunes denied dirs and excludes out-of-scope files", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/keep.md", "a");
    write("data/node_modules/junk.md", "b"); // denied dir
    write("outside/secret.md", "c"); // out of scope
    await trust();
    const r = await req(`/api/app/list?app=${APP}&path=data&recursive=1`);
    const paths = (await r.json()).entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("data/keep.md");
    expect(paths).not.toContain("data/node_modules/junk.md");
    expect(paths).not.toContain("outside/secret.md");
  });
});

describe("read-frontmatter", () => {
  type FrontmatterEntry = { path: string; frontmatter: string | null };

  async function readFrontmatter(path: string, recursive = false): Promise<FrontmatterEntry[]> {
    const rec = recursive ? "&recursive=1" : "";
    const r = await req(`/api/app/read-frontmatter?app=${APP}&path=${path}${rec}`);
    expect(r.status).toBe(200);
    return ((await r.json()).entries as FrontmatterEntry[]);
  }

  it("returns raw frontmatter blocks and null for files without one", async () => {
    write(APP, appHtml());
    write("apps/board/a.md", "---\ntitle: Alpha\nstatus: open\n---\n# Alpha\n");
    write("apps/board/b.md", "---\ntitle: Beta\n---\n# Beta\n");
    write("apps/board/plain.md", "# Plain\n");
    await trust();

    const entries = await readFrontmatter("apps/board");
    expect(entries).toContainEqual({
      path: "apps/board/a.md",
      frontmatter: "title: Alpha\nstatus: open",
    });
    expect(entries).toContainEqual({ path: "apps/board/b.md", frontmatter: "title: Beta" });
    expect(entries).toContainEqual({ path: "apps/board/plain.md", frontmatter: null });
  });

  it("includes manifest-declared folders and excludes files outside scope", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "---\ntitle: Cards\n---\n");
    write("secret/x.md", "---\ntitle: Secret\n---\n");
    await trust();

    const entries = await readFrontmatter("", true);
    expect(entries).toContainEqual({ path: "data/cards.md", frontmatter: "title: Cards" });
    expect(entries.map((e) => e.path)).not.toContain("secret/x.md");
  });

  it("403 before trust", async () => {
    write(APP, appHtml());
    write("apps/board/board.md", "---\ntitle: Board\n---\n");

    const r = await req(`/api/app/read-frontmatter?app=${APP}&path=apps/board`);
    expect(r.status).toBe(403);
  });

  it("recursive=1 descends into subfolders", async () => {
    write(APP, appHtml("mdc-app:\n  name: Board\n  permissions:\n    read:\n      - data"));
    write("data/top.md", "---\ntitle: Top\n---\n");
    write("data/sub/deep.md", "---\ntitle: Deep\n---\n");
    await trust();

    const shallow = await readFrontmatter("data");
    expect(shallow.map((e) => e.path)).toContain("data/top.md");
    expect(shallow.map((e) => e.path)).not.toContain("data/sub/deep.md");

    const deep = await readFrontmatter("data", true);
    expect(deep).toContainEqual({ path: "data/sub/deep.md", frontmatter: "title: Deep" });
  });
});

describe("read-only cross-folder app (read scope, empty write scope)", () => {
  // A manifest declaring a cross-folder read scope but no write scope. The
  // cross-folder grant is read-only: the app can read data/ but never write it.
  // (Its OWN folder stays writable by the same-folder default — that's not a
  // cross-folder grant, so it isn't what "read-only" governs here.)
  const RO = "mdc-app:\n  name: Reader\n  permissions:\n    read:\n      - data";

  it("reads the declared cross-folder scope", async () => {
    write(APP, appHtml(RO));
    write("data/cards.md", "x");
    await trust();
    expect((await req(`/api/app/read?app=${APP}&path=data/cards.md`)).status).toBe(200);
  });

  it("cannot write the cross-folder read scope (403, file untouched)", async () => {
    write(APP, appHtml(RO));
    write("data/cards.md", "x");
    await trust();
    const r = await put(`/api/app/write?app=${APP}&path=data/cards.md`, { content: "y" });
    expect(r.status).toBe(403);
    expect(read("data/cards.md")).toBe("x");
  });
});

describe("/api/app/watch (live updates)", () => {
  // Read an SSE stream until `pred` returns true on the accumulated text or the
  // budget elapses; always aborts so the never-closing stream can't hang the
  // test. Each read races a timer so a quiet stream (no further chunks) still
  // resolves at the deadline rather than blocking on a pending read().
  async function collectUntil(path: string, pred: (text: string) => boolean, ms = 2000): Promise<string> {
    const ac = new AbortController();
    const r = await req(path, { signal: ac.signal });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const stop = Date.now() + ms;
    const expired = Symbol("expired");
    try {
      while (!pred(text) && Date.now() < stop) {
        const timer = new Promise<typeof expired>((res) =>
          setTimeout(() => res(expired), Math.max(0, stop - Date.now())),
        );
        const chunk = await Promise.race([reader.read(), timer]);
        if (chunk === expired) break;
        if (chunk.done) break;
        text += dec.decode(chunk.value, { stream: true });
      }
    } catch {
      /* aborted */
    } finally {
      ac.abort();
    }
    return text;
  }

  it("403 before trust", async () => {
    write(APP, appHtml());
    const r = await req(`/api/app/watch?app=${APP}`);
    expect(r.status).toBe(403);
  });

  // The watcher starts when the app is constructed (beforeEach), so any write —
  // setup included — fires an event. To observe ONLY the change under test, lay
  // down all fixtures first and let the watcher drain them before opening the
  // stream, then trigger the one change we're asserting on.
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  it("streams `ready`, then `changed` when an in-scope file changes", async () => {
    write(APP, appHtml("mdc-app:\n  name: Reader\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "x");
    await trust();
    await settle();
    setTimeout(() => write("data/cards.md", "y"), 100); // in-scope change after open
    const text = await collectUntil(`/api/app/watch?app=${APP}`, (t) => t.includes("event: changed"));
    expect(text).toContain("event: ready");
    expect(text).toContain("event: changed");
  });

  it("does NOT fire `changed` for an out-of-scope change", async () => {
    write(APP, appHtml("mdc-app:\n  name: Reader\n  permissions:\n    read:\n      - data"));
    write("data/cards.md", "x");
    await trust();
    await settle();
    setTimeout(() => write("secret/private.md", "shh"), 100); // out-of-scope change
    const text = await collectUntil(`/api/app/watch?app=${APP}`, () => false, 1000);
    expect(text).toContain("event: ready");
    expect(text).not.toContain("event: changed");
  });
});
