/**
 * Tests for the server backend — every route exercised in-process via
 * `app.fetch`, with the two SSE streams (live-reload + handoff) driven against
 * a real bound port. Each route's effect is checked against the sidecar it
 * writes, so the wire contract and the on-disk format are both pinned.
 */

import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";
import { createApp } from "../src/server/app.js";
import type { RootWatcher } from "../src/server/watcher.js";
import { appendEntry, deriveThreads, readSidecar, sidecarPathFor } from "../src/sidecar.js";
import type { Entry } from "../src/threads.js";

let dir: string;
let staticDir: string;
let app: ReturnType<typeof createApp>["app"];
let watcher: RootWatcher;

const USER = "dana";

/** Write a file under the root, creating it fresh each test. */
function writeDoc(rel: string, content: string): void {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

/** Read a file back from the root. */
function readDoc(rel: string): string {
  return readFileSync(join(dir, rel), "utf8");
}

/** A request against the in-process app. */
function req(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://test${path}`, init)));
}

/** POST JSON helper. */
function post(path: string, body: unknown): Promise<Response> {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-server-test-"));
  staticDir = mkdtempSync(join(tmpdir(), "mdc-static-test-"));
  // A minimal built frontend so GET / + /assets/* have something to serve —
  // shaped like a Vite build (index.html referencing hashed assets, no tokens).
  writeFileSync(
    join(staticDir, "index.html"),
    `<!doctype html><title>mdc</title>` +
      `<script type="module" src="/assets/index-abc123.js"></script>` +
      `<link rel="stylesheet" href="/assets/index-def456.css">`,
  );
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "assets", "index-abc123.js"), "// app");
  writeFileSync(join(staticDir, "assets", "index-def456.css"), "/* css */");

  writeDoc("doc.md", "# Doc\n\nThe quick brown fox.\n");

  const built = createApp({ root: dir, staticDir, denyRaw: "", user: USER });
  app = built.app;
  watcher = built.watcher;
});

afterEach(async () => {
  await watcher.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(staticDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Index page + static assets
// ---------------------------------------------------------------------------

describe("index page + assets", () => {
  it("GET / serves the built index.html as-is", async () => {
    const html = await (await req("/")).text();
    expect(html).toContain(`/assets/index-abc123.js`);
    expect(html).toContain(`/assets/index-def456.css`);
  });

  it("GET /api/status reports no tab connected when none is listening", async () => {
    const r = await req("/api/status");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tabConnected: false });
  });

  it("serves hashed assets with the right content-type + immutable cache", async () => {
    const js = await req("/assets/index-abc123.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    const css = await req("/assets/index-def456.css");
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("404s an unknown asset and blocks traversal", async () => {
    expect((await req("/assets/nope.js")).status).toBe(404);
    expect((await req("/assets/../secret")).status).toBe(404);
  });

  it("GET / injects the workspace title, matching the manifest name exactly", async () => {
    const html = await (await req("/")).text();
    expect(html).toContain(`<title>mdc — ${basename(dir)}</title>`);
    expect(html).not.toContain("<title>mdc</title>");
    // The dedup Chrome applies depends on these being identical.
    const manifest = (await (await req("/manifest.webmanifest")).json()) as { name: string };
    expect(html).toContain(`<title>${manifest.name}</title>`);
  });

  it("GET /manifest.webmanifest is generated and named after the served root", async () => {
    const r = await req("/manifest.webmanifest");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/manifest+json");
    const manifest = (await r.json()) as {
      name: string;
      short_name: string;
      display: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.name).toBe(`mdc — ${basename(dir)}`);
    expect(manifest.short_name).toBe(basename(dir));
    expect(manifest.display).toBe("standalone");
    // Every icon the manifest points at must actually be servable.
    for (const icon of manifest.icons) {
      writeFileSync(join(staticDir, icon.src.slice(1)), "stub");
      expect((await req(icon.src)).status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------

describe("read routes", () => {
  it("GET /api/index lists indexed .md files with open-thread counts", async () => {
    writeDoc("two.md", "# Two\n");
    const data = (await (await req("/api/index")).json()) as {
      root: string;
      user: string;
      mdcVersion: string;
      files: { path: string; openThreadCount: number }[];
    };
    expect(data.root).toBe(dir);
    expect(data.user).toBe(USER);
    expect(data.mdcVersion).toBe(VERSION);
    expect(data.files.map((f) => f.path).sort()).toEqual(["doc.md", "two.md"]);
    expect(data.files.every((f) => f.openThreadCount === 0)).toBe(true);
  });

  it("GET /api/md returns content + filename + version, 404s unindexed", async () => {
    const data = (await (await req("/api/md?file=doc.md")).json()) as {
      content: string;
      filename: string;
      path: string;
      version: string;
    };
    expect(data.content).toContain("quick brown fox");
    expect(data.filename).toBe("doc.md");
    expect(typeof data.version).toBe("string");
    expect(data.version.length).toBeGreaterThan(0);
    expect((await req("/api/md?file=missing.md")).status).toBe(404);
  });

  it("PUT /api/md with a matching baseVersion writes and returns the new version", async () => {
    const { version } = (await (await req("/api/md?file=doc.md")).json()) as { version: string };
    const res = await req("/api/md?file=doc.md", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Edited\n", baseVersion: version }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { version: string };
    expect(readDoc("doc.md")).toBe("# Edited\n");
    // The returned version must chain: it is the baseVersion of the new content.
    const next = (await (await req("/api/md?file=doc.md")).json()) as { version: string };
    expect(data.version).toBe(next.version);
  });

  it("PUT /api/md with a stale baseVersion 409s and leaves the file untouched", async () => {
    const { version, content } = (await (await req("/api/md?file=doc.md")).json()) as {
      version: string;
      content: string;
    };
    writeDoc("doc.md", "# Changed underneath\n");
    const res = await req("/api/md?file=doc.md", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content + "mine\n", baseVersion: version }),
    });
    expect(res.status).toBe(409);
    expect(readDoc("doc.md")).toBe("# Changed underneath\n");
  });

  it("PUT /api/md without a baseVersion still blind-writes", async () => {
    writeDoc("doc.md", "# Changed underneath\n");
    const res = await req("/api/md?file=doc.md", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Forced\n" }),
    });
    expect(res.status).toBe(200);
    expect(readDoc("doc.md")).toBe("# Forced\n");
  });

  it("GET /api/comments returns the sidecar entries", async () => {
    await post("/api/comments?file=doc.md", {
      author: USER,
      body: "hi",
      anchor: { quote: "fox", line: 3 },
    });
    const data = (await (await req("/api/comments?file=doc.md")).json()) as {
      entries: unknown[];
    };
    expect(data.entries.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Image files (standalone, openable-but-not-commentable)
// ---------------------------------------------------------------------------

describe("image files", () => {
  // A minimal valid 1×1 PNG, enough for the index + serve routes (they don't
  // decode it — they key on extension and stream the bytes back).
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  function writeImage(rel: string): void {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), PNG_1x1);
  }

  it("GET /api/index lists image files in a separate `images` channel, not `files`", async () => {
    writeImage("pics/cat.png");
    const data = (await (await req("/api/index")).json()) as {
      files: { path: string }[];
      images: string[];
    };
    expect(data.images).toContain("pics/cat.png");
    // Images must NOT leak into `files` (which drives comment/anchor resolution).
    expect(data.files.map((f) => f.path)).not.toContain("pics/cat.png");
  });

  it("GET /api/image-file serves an indexed image by its own path", async () => {
    writeImage("pics/cat.png");
    await req("/api/index"); // rescan so the image is indexed
    const r = await req("/api/image-file?path=pics/cat.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect((await r.arrayBuffer()).byteLength).toBe(PNG_1x1.byteLength);
  });

  it("GET /api/image-file 404s an unindexed path and a non-image", async () => {
    expect((await req("/api/image-file?path=pics/missing.png")).status).toBe(404);
    expect((await req("/api/image-file?path=doc.md")).status).toBe(404);
  });

  it("POST /api/open accepts an image path (not just a doc)", async () => {
    writeImage("pics/cat.png");
    await req("/api/index"); // rescan so the image is indexed
    // No SSE listener connected, so it's a 409 (nothing to deliver to) rather
    // than a 404 (unknown file) — the path was accepted, which is the point.
    const r = await post("/api/open", { file: "pics/cat.png" });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { delivered: boolean; reason: string };
    expect(body.delivered).toBe(false);
    expect(body.reason).toBe("no browser tab listening");
    // A genuinely unknown path still 404s.
    expect((await post("/api/open", { file: "pics/ghost.png" })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Image asset uploads
// ---------------------------------------------------------------------------

describe("image asset uploads", () => {
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  async function upload(doc: string, name: string, body: BodyInit = PNG_1x1): Promise<Response> {
    const query = new URLSearchParams({ doc, name });
    return req(`/api/asset?${query.toString()}`, { method: "POST", body });
  }

  it("creates a sibling assets folder and returns doc-relative and root-relative paths", async () => {
    writeDoc("guides/setup.md", "# Setup\n");
    await req("/api/index");

    const response = await upload("guides/setup.md", "x.png");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "guides/assets/x.png",
      ref: "assets/x.png",
    });
    expect(readFileSync(join(dir, "guides/assets/x.png"))).toEqual(PNG_1x1);

    const index = (await (await req("/api/index")).json()) as { images: string[]; dirs: string[] };
    expect(index.images).toContain("guides/assets/x.png");
    expect(index.dirs).toContain("guides/assets");
  });

  it("dedupes a taken filename without overwriting existing bytes", async () => {
    const first = await upload("doc.md", "same.PNG", new Uint8Array([1]));
    const second = await upload("doc.md", "same.PNG", new Uint8Array([2]));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ ref: "assets/same.PNG" });
    expect(await second.json()).toMatchObject({ ref: "assets/same-1.PNG" });
    expect([...readFileSync(join(dir, "assets/same.PNG"))]).toEqual([1]);
    expect([...readFileSync(join(dir, "assets/same-1.PNG"))]).toEqual([2]);
  });

  it("rejects unsupported extensions, traversal names, and unindexed docs", async () => {
    expect((await upload("doc.md", "notes.txt")).status).toBe(400);
    expect((await upload("doc.md", "../outside.png")).status).toBe(404);
    expect((await upload("missing.md", "x.png")).status).toBe(404);
    expect(existsSync(join(dir, "outside.png"))).toBe(false);
  });

  it("rejects a body over 25 MB", async () => {
    const response = await upload("doc.md", "large.png", new Uint8Array(25 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(existsSync(join(dir, "assets/large.png"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Excalidraw scenes (standalone, interactive, openable-but-not-commentable)
// ---------------------------------------------------------------------------

describe("drawing files", () => {
  const SCENE = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "test",
    elements: [],
    appState: {},
    files: {},
  });

  it("lists drawings in a separate channel and reads their original JSON", async () => {
    writeDoc("drawings/scene.excalidraw", SCENE);
    writeDoc("drawings/scene.excalidraw.json", SCENE);
    const data = (await (await req("/api/index")).json()) as {
      files: { path: string }[];
      drawings: string[];
    };
    expect(data.drawings).toEqual([
      "drawings/scene.excalidraw",
      "drawings/scene.excalidraw.json",
    ]);
    expect(data.files.map((file) => file.path)).not.toContain("drawings/scene.excalidraw");

    const drawing = (await (
      await req("/api/drawing?file=drawings%2Fscene.excalidraw")
    ).json()) as { content: string; filename: string; path: string; version: string };
    expect(drawing).toMatchObject({
      content: SCENE,
      filename: "scene.excalidraw",
      path: "drawings/scene.excalidraw",
    });
    expect(drawing.version.length).toBeGreaterThan(0);
  });

  it("rejects non-drawing paths and accepts drawings for open", async () => {
    writeDoc("scene.excalidraw", SCENE);
    await req("/api/index");
    expect((await req("/api/drawing?file=doc.md")).status).toBe(404);
    expect((await req("/api/drawing?file=missing.excalidraw")).status).toBe(404);

    const opened = await post("/api/open", { file: "scene.excalidraw" });
    expect(opened.status).toBe(409);
    expect(await opened.json()).toMatchObject({ reason: "no browser tab listening" });
  });

  it("writes drawings with a matching version and chains the returned version", async () => {
    writeDoc("scene.excalidraw", SCENE);
    const initial = (await (await req("/api/drawing?file=scene.excalidraw")).json()) as {
      version: string;
    };
    const edited = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "test",
      elements: [{ id: "rectangle" }],
      appState: {},
      files: {},
    });

    const response = await req("/api/drawing?file=scene.excalidraw", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: edited, baseVersion: initial.version }),
    });

    expect(response.status).toBe(200);
    const saved = (await response.json()) as { version: string };
    expect(readDoc("scene.excalidraw")).toBe(edited);
    const reread = (await (await req("/api/drawing?file=scene.excalidraw")).json()) as {
      version: string;
    };
    expect(saved.version).toBe(reread.version);
  });

  it("rejects a stale drawing write and preserves the external content", async () => {
    writeDoc("scene.excalidraw", SCENE);
    const initial = (await (await req("/api/drawing?file=scene.excalidraw")).json()) as {
      version: string;
    };
    const external = SCENE.replace('"source":"test"', '"source":"external"');
    writeDoc("scene.excalidraw", external);

    const response = await req("/api/drawing?file=scene.excalidraw", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: SCENE + "\n", baseVersion: initial.version }),
    });

    expect(response.status).toBe(409);
    expect(readDoc("scene.excalidraw")).toBe(external);
  });

  it("rejects drawing writes to markdown or unindexed paths", async () => {
    const init = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: SCENE, baseVersion: "stale" }),
    };
    expect((await req("/api/drawing?file=doc.md", init)).status).toBe(404);
    expect((await req("/api/drawing?file=missing.excalidraw", init)).status).toBe(404);
  });

  it("deletes a drawing through the generic file route", async () => {
    writeDoc("scene.excalidraw", SCENE);
    const deleted = await req("/api/file?file=scene.excalidraw", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(existsSync(join(dir, "scene.excalidraw"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTML files (standalone, sandboxed-iframe, openable-but-not-commentable)
// ---------------------------------------------------------------------------

describe("html files", () => {
  function writeHtml(rel: string, body = "<h1>Mockup</h1>"): void {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), `<!doctype html><html><body>${body}</body></html>`);
  }

  it("GET /api/index lists html files in a separate `htmls` channel, not `files`", async () => {
    writeHtml("mock/page.html");
    writeHtml("mock/legacy.htm");
    const data = (await (await req("/api/index")).json()) as {
      files: { path: string }[];
      htmls: string[];
    };
    expect(data.htmls.sort()).toEqual(["mock/legacy.htm", "mock/page.html"]);
    expect(data.files.map((f) => f.path)).not.toContain("mock/page.html");
  });

  it("GET /api/html-file serves the file as text/html with a strict CSP", async () => {
    writeHtml("mock/page.html");
    await req("/api/index"); // rescan so the html is indexed
    const r = await req("/api/html-file?path=mock/page.html");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    // CSP is defense-in-depth behind the iframe sandbox.
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(await r.text()).toContain("Mockup");
  });

  it("GET /api/html-file 404s an unindexed path and a non-html file", async () => {
    expect((await req("/api/html-file?path=mock/missing.html")).status).toBe(404);
    expect((await req("/api/html-file?path=doc.md")).status).toBe(404);
  });

  it("POST /api/open accepts an html path", async () => {
    writeHtml("mock/page.html");
    await req("/api/index"); // rescan so the html is indexed
    const r = await post("/api/open", { file: "mock/page.html" });
    expect(r.status).toBe(409); // accepted, but no browser tab listening
    expect(((await r.json()) as { reason: string }).reason).toBe("no browser tab listening");
    expect((await post("/api/open", { file: "mock/ghost.html" })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PDF files (standalone, native iframe viewer, openable-but-not-commentable)
// ---------------------------------------------------------------------------

describe("pdf files", () => {
  const PDF_BYTES = Buffer.from("%PDF-1.4\n% mdc test pdf\n");

  function writePdf(rel: string): void {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), PDF_BYTES);
  }

  it("GET /api/index lists pdf files in a separate `pdfs` channel, not `files`", async () => {
    writePdf("reports/brief.pdf");
    const data = (await (await req("/api/index")).json()) as {
      files: { path: string }[];
      pdfs: string[];
    };
    expect(data.pdfs).toContain("reports/brief.pdf");
    expect(data.files.map((f) => f.path)).not.toContain("reports/brief.pdf");
  });

  it("GET /api/pdf-file serves an indexed pdf as application/pdf bytes", async () => {
    writePdf("reports/brief.pdf");
    await req("/api/index"); // rescan so the pdf is indexed
    const r = await req("/api/pdf-file?path=reports/brief.pdf");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect((await r.arrayBuffer()).byteLength).toBe(PDF_BYTES.byteLength);
  });

  it("HEAD /api/pdf-file validates an indexed pdf without a body", async () => {
    writePdf("reports/brief.pdf");
    await req("/api/index"); // rescan so the pdf is indexed
    const r = await req("/api/pdf-file?path=reports/brief.pdf", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect((await r.arrayBuffer()).byteLength).toBe(0);
  });

  it("GET /api/pdf-file 404s an unindexed path and a non-pdf file", async () => {
    expect((await req("/api/pdf-file?path=reports/missing.pdf")).status).toBe(404);
    expect((await req("/api/pdf-file?path=doc.md")).status).toBe(404);
  });

  it("POST /api/open accepts a pdf path", async () => {
    writePdf("reports/brief.pdf");
    await req("/api/index"); // rescan so the pdf is indexed
    const r = await post("/api/open", { file: "reports/brief.pdf" });
    expect(r.status).toBe(409); // accepted, but no browser tab listening
    expect(((await r.json()) as { reason: string }).reason).toBe("no browser tab listening");
    expect((await post("/api/open", { file: "reports/ghost.pdf" })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Comment CRUD
// ---------------------------------------------------------------------------

describe("comment CRUD", () => {
  async function topComment(): Promise<string> {
    const r = await post("/api/comments?file=doc.md", {
      author: USER,
      body: "first",
      anchor: { quote: "fox", line: 3 },
    });
    return ((await r.json()) as { id: string }).id;
  }

  it("creates a top-level comment with anchor + author + timestamp", async () => {
    const r = await post("/api/comments?file=doc.md", {
      author: USER,
      body: "first",
      anchor: { quote: "fox", line: 3 },
    });
    const e = (await r.json()) as Record<string, unknown>;
    expect(e.parent_id).toBe(null);
    expect(e.anchor).toEqual({ quote: "fox", line: 3 });
    expect(e.author).toBe(USER);
    expect(typeof e.id).toBe("string");
    expect(typeof e.timestamp).toBe("string");
  });

  it("rejects an empty body and an anchorless top-level comment", async () => {
    expect((await post("/api/comments?file=doc.md", { author: USER, body: "  " })).status).toBe(400);
    expect(
      (await post("/api/comments?file=doc.md", { author: USER, body: "x" })).status,
    ).toBe(400);
  });

  it("creates a reply and rejects an unknown parent", async () => {
    const tid = await topComment();
    const r = await post("/api/comments?file=doc.md", {
      author: "agent",
      body: "reply",
      parent_id: tid,
    });
    expect(((await r.json()) as { parent_id: string }).parent_id).toBe(tid);
    expect(
      (await post("/api/comments?file=doc.md", { author: "x", body: "y", parent_id: "nope" }))
        .status,
    ).toBe(400);
  });

  it("resolve snapshots the anchor; unresolve flips it back", async () => {
    const tid = await topComment();
    const res = (await (
      await post("/api/comments/resolve?file=doc.md", { thread_id: tid, author: USER })
    ).json()) as Record<string, unknown>;
    expect(res.type).toBe("resolved");
    expect(res.anchor_snapshot).toEqual({ quote: "fox", line: 3 });
    const un = (await (
      await post("/api/comments/unresolve?file=doc.md", { thread_id: tid, author: USER })
    ).json()) as { type: string };
    expect(un.type).toBe("unresolved");
  });

  it("dismisses an actionable suggestion without changing the document", async () => {
    const scPath = sidecarPathFor(join(dir, "doc.md"));
    const suggestion: Entry = {
      id: "suggestion-1",
      file: "doc.md",
      parent_id: null,
      anchor: { quote: "quick brown fox", line: 3 },
      author: "agent",
      body: "Tighten this sentence",
      timestamp: "2026-07-11T00:00:00.000Z",
      suggestion: {
        target: {
          quote: "The quick brown fox.",
          context: { before: "# Doc\n\n", after: "\n" },
        },
        replacement: "A quick fox.",
      },
    };
    appendEntry(scPath, suggestion);
    const before = readDoc("doc.md");

    const response = await post("/api/comments/resolve?file=doc.md", {
      thread_id: suggestion.id,
      suggestion_id: suggestion.id,
      resolution: "dismissed",
      author: USER,
    });
    expect(response.status).toBe(200);
    expect(readDoc("doc.md")).toBe(before);
    const entries = readSidecar(scPath);
    expect(entries.slice(-2)).toMatchObject([
      {
        type: "resolved",
        thread_id: suggestion.id,
        suggestion_id: suggestion.id,
        resolution: "dismissed",
      },
      {
        type: "unresolved",
        thread_id: suggestion.id,
      },
    ]);
    expect(deriveThreads(entries, USER)[0]).toMatchObject({
      status: "open",
      awaiting: "agent",
    });

    expect(
      (await post("/api/comments/resolve?file=doc.md", {
        thread_id: suggestion.id,
        resolution: "dismissed",
        author: USER,
      })).status,
    ).toBe(400);
  });

  it("applies a strict suggestion and appends a qualified resolve", async () => {
    const scPath = sidecarPathFor(join(dir, "doc.md"));
    const suggestion: Entry = {
      id: "suggestion-1",
      file: "doc.md",
      parent_id: null,
      anchor: { quote: "quick brown fox", line: 3 },
      author: "agent",
      body: "Tighten this sentence",
      timestamp: "2026-07-11T00:00:00.000Z",
      suggestion: {
        target: {
          quote: "The quick brown fox.",
          context: { before: "# Doc\n\n", after: "\n" },
        },
        replacement: "A quick fox.",
      },
    };
    appendEntry(scPath, suggestion);

    const response = await post("/api/suggestions/apply?file=doc.md", {
      thread_id: suggestion.id,
      suggestion_id: suggestion.id,
      author: USER,
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      content: string;
      version: string;
      entry: Entry;
    };
    expect(result.content).toBe("# Doc\n\nA quick fox.\n");
    expect(result.version).toBeTruthy();
    expect(readDoc("doc.md")).toBe(result.content);
    expect(result.entry).toMatchObject({
      type: "resolved",
      thread_id: suggestion.id,
      resolution: "applied",
      suggestion_id: suggestion.id,
      anchor_snapshot: { quote: "quick brown fox", line: 3 },
    });
    expect(readSidecar(scPath).at(-1)).toEqual(result.entry);
  });

  it("refuses a drifted suggestion without touching the document or sidecar", async () => {
    const scPath = sidecarPathFor(join(dir, "doc.md"));
    const suggestion: Entry = {
      id: "suggestion-1",
      file: "doc.md",
      parent_id: null,
      anchor: { quote: "quick brown fox", line: 3 },
      author: "agent",
      body: "Tighten this sentence",
      timestamp: "2026-07-11T00:00:00.000Z",
      suggestion: {
        target: {
          quote: "The quick brown fox.",
          context: { before: "# Doc\n\n", after: "\n" },
        },
        replacement: "A quick fox.",
      },
    };
    appendEntry(scPath, suggestion);
    writeDoc("doc.md", "# Doc\n\nThe  quick brown fox.\n");
    const beforeDoc = readDoc("doc.md");
    const beforeSidecar = readFileSync(scPath, "utf8");

    const response = await post("/api/suggestions/apply?file=doc.md", {
      thread_id: suggestion.id,
      suggestion_id: suggestion.id,
      author: USER,
    });
    expect(response.status).toBe(409);
    expect(readDoc("doc.md")).toBe(beforeDoc);
    expect(readFileSync(scPath, "utf8")).toBe(beforeSidecar);
  });

  it("system resolve writes system-authored resolve events", async () => {
    const tid = await topComment();
    const r = await post("/api/comments/resolve-system?file=doc.md", { thread_ids: [tid] });
    expect(r.status).toBe(200);

    const entries = readSidecar(sidecarPathFor(join(dir, "doc.md")));
    const resolved = entries.find((e) => e.type === "resolved" && e.thread_id === tid);
    expect(resolved?.author).toBe("system");
    expect(resolved?.anchor_snapshot).toEqual({ quote: "fox", line: 3 });
  });

  it("edit appends an edit event; rejects unknown comment", async () => {
    const tid = await topComment();
    const e = (await (
      await post("/api/comments/edit?file=doc.md", {
        comment_id: tid,
        body: "edited",
        author: USER,
      })
    ).json()) as { type: string; body: string };
    expect(e.type).toBe("edit");
    expect(e.body).toBe("edited");
    expect(
      (await post("/api/comments/edit?file=doc.md", { comment_id: "nope", body: "x", author: USER }))
        .status,
    ).toBe(400);
  });

  it("delete tombstones a comment and prunes the now-empty sidecar", async () => {
    const tid = await topComment();
    const d = (await (
      await post("/api/comments/delete?file=doc.md", { comment_id: tid, author: USER })
    ).json()) as { type: string; sidecar_pruned: boolean };
    expect(d.type).toBe("deleted");
    expect(d.sidecar_pruned).toBe(true);
    // sidecar removed → reading it back is empty
    expect(readSidecar(join(dir, "doc.md.comments.jsonl"))).toEqual([]);
  });

  it("delete-thread removes the parent and all replies in one batch", async () => {
    const tid = await topComment();
    await post("/api/comments?file=doc.md", { author: "agent", body: "r1", parent_id: tid });
    await post("/api/comments?file=doc.md", { author: "agent", body: "r2", parent_id: tid });
    const r = (await (
      await post("/api/comments/delete-thread?file=doc.md", { thread_id: tid, author: USER })
    ).json()) as { deleted: string[]; sidecar_pruned: boolean };
    expect(r.deleted.length).toBe(3); // parent + 2 replies
    expect(r.sidecar_pruned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sidecar delete
// ---------------------------------------------------------------------------

describe("DELETE /api/sidecar", () => {
  it("removes the sidecar file, no-op-success when already gone", async () => {
    await post("/api/comments?file=doc.md", {
      author: USER,
      body: "x",
      anchor: { quote: "fox", line: 3 },
    });
    const first = (await (await req("/api/sidecar?file=doc.md", { method: "DELETE" })).json()) as {
      deleted: boolean;
    };
    expect(first.deleted).toBe(true);
    const second = (await (await req("/api/sidecar?file=doc.md", { method: "DELETE" })).json()) as {
      deleted: boolean;
      reason: string;
    };
    expect(second.deleted).toBe(false);
    expect(second.reason).toBe("no sidecar");
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe("GET /api/dashboard", () => {
  it("aggregates open + resolved thread counts across docs", async () => {
    const r = await post("/api/comments?file=doc.md", {
      author: USER,
      body: "open one",
      anchor: { quote: "fox", line: 3 },
    });
    const tid = ((await r.json()) as { id: string }).id;
    await post("/api/comments/resolve?file=doc.md", { thread_id: tid, author: USER });
    const data = (await (await req("/api/dashboard")).json()) as {
      total_open: number;
      total_resolved: number;
      files: { path: string; open: number; resolved: number; orphaned: boolean }[];
    };
    expect(data.total_resolved).toBe(1);
    expect(data.total_open).toBe(0);
    expect(data.files[0]!.path).toBe("doc.md");
    expect(data.files[0]!.orphaned).toBe(false);
  });

  it("surfaces an orphaned sidecar (deleted .md) as a distinct group", async () => {
    // Comment on a doc, then delete the .md — the sidecar is now orphaned.
    await post("/api/comments?file=doc.md", {
      author: USER,
      body: "stranded",
      anchor: { quote: "fox", line: 3 },
    });
    rmSync(join(dir, "doc.md"));
    const data = (await (await req("/api/dashboard")).json()) as {
      files: { path: string; orphaned: boolean }[];
    };
    const orphan = data.files.find((f) => f.path === "doc.md");
    expect(orphan?.orphaned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSE — live-reload (real bound port)
// ---------------------------------------------------------------------------

/** Bind the app to an ephemeral port; resolve once it's actually listening. */
function bind(): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve({
        base: `http://127.0.0.1:${info.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Read SSE event names from a stream until `predicate` is satisfied or timeout. */
async function collectEvents(
  url: string,
  predicate: (events: string[]) => boolean,
  timeoutMs = 4000,
): Promise<string[]> {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line.startsWith("event:")) events.push(line.slice(6).trim());
      }
      if (predicate(events)) break;
    }
  } finally {
    ctrl.abort();
    await reader.cancel().catch(() => {});
  }
  return events;
}

describe("SSE live-reload", () => {
  it("emits doc-changed and sidecar-changed keyed by the doc path", async () => {
    const { base, close } = await bind();
    try {
      const url = `${base}/api/events?file=doc.md`;
      // Editing the doc → doc-changed; writing a sidecar → sidecar-changed.
      const docChange = collectEvents(url, (e) => e.includes("doc-changed"));
      // Give the watcher a beat to register the subscription before mutating.
      await new Promise((r) => setTimeout(r, 200));
      writeDoc("doc.md", "# Doc\n\nEdited.\n");
      expect(await docChange).toContain("doc-changed");

      const scChange = collectEvents(url, (e) => e.includes("sidecar-changed"));
      await new Promise((r) => setTimeout(r, 200));
      writeFileSync(
        join(dir, "doc.md.comments.jsonl"),
        JSON.stringify({ id: "x", file: "doc.md", author: USER, body: "hi" }) + "\n",
      );
      expect(await scChange).toContain("sidecar-changed");
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Handoff: state + SSE round
// ---------------------------------------------------------------------------

describe("handoff", () => {
  it("open → presence honest → done delivers intent to the watcher", async () => {
    const { base, close } = await bind();
    try {
      const open = (await (
        await fetch(`${base}/api/handoff/open`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file: "doc.md" }),
        })
      ).json()) as { sessionId: string };

      // Before a watcher connects: a session exists but nobody is watching.
      const before = (await (await fetch(`${base}/api/handoff/sessions`)).json()) as {
        active: { watching: boolean };
      };
      expect(before.active.watching).toBe(false);

      // Connect a watcher (the agent), then fire done.
      const events = collectEvents(
        `${base}/api/handoff/events?sessionId=${open.sessionId}`,
        (e) => e.includes("done"),
      );
      await new Promise((r) => setTimeout(r, 200));
      const presence = (await (await fetch(`${base}/api/handoff/sessions`)).json()) as {
        active: { watching: boolean };
      };
      expect(presence.active.watching).toBe(true);

      const done = (await (
        await fetch(`${base}/api/handoff/done`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: open.sessionId, intent: "review" }),
        })
      ).json()) as { delivered: boolean };
      expect(done.delivered).toBe(true);
      expect(await events).toContain("done");
    } finally {
      await close();
    }
  });

  it("rejects a second open while one is live (409)", async () => {
    await post("/api/handoff/open", { file: "doc.md" });
    expect((await post("/api/handoff/open", { file: "doc.md" })).status).toBe(409);
  });

  it("a new open supersedes a session whose watcher disconnected (timeout polling)", async () => {
    const { base, close } = await bind();
    try {
      const open = (await (
        await fetch(`${base}/api/handoff/open`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file: "doc.md" }),
        })
      ).json()) as { sessionId: string };
      // Attach a watcher, then drop it — the client side of a watch --timeout
      // chunk expiring (or a Ctrl-C).
      const ctrl = new AbortController();
      const res = await fetch(`${base}/api/handoff/events?sessionId=${open.sessionId}`, {
        signal: ctrl.signal,
      });
      await res.body!.getReader().read(); // wait for the ready event = watcher counted
      ctrl.abort();
      // Give the server a beat to register the disconnect, then poll the reopen:
      // the abandoned session must not hold the slot.
      let status = 0;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        status = (
          await fetch(`${base}/api/handoff/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file: "doc.md" }),
          })
        ).status;
        if (status === 200) break;
      }
      expect(status).toBe(200);
    } finally {
      await close();
    }
  });

  it("done with no watcher reports delivered:false; unknown session is a no-op", async () => {
    const open = (await (await post("/api/handoff/open", { file: "doc.md" })).json()) as {
      sessionId: string;
    };
    const d = (await (
      await post("/api/handoff/done", { sessionId: open.sessionId, intent: "done" })
    ).json()) as { ok: boolean; delivered: boolean };
    expect(d.ok).toBe(true);
    expect(d.delivered).toBe(false);
    const unknown = (await (
      await post("/api/handoff/done", { sessionId: "nope", intent: "review" })
    ).json()) as { ok: boolean; delivered: boolean };
    expect(unknown).toEqual({ ok: true, delivered: false });
  });

  it("events on an unknown session 404s", async () => {
    expect((await req("/api/handoff/events?sessionId=nope")).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// File / folder create + delete (the tree-mutating routes)
// ---------------------------------------------------------------------------

describe("POST /api/file (create file)", () => {
  it("creates an empty doc at root and indexes it", async () => {
    const r = await post("/api/file", { path: "new.md" });
    expect(r.status).toBe(200);
    expect(existsSync(join(dir, "new.md"))).toBe(true);
    // rescan() ran → it shows in the index.
    const idx = (await (await req("/api/index")).json()) as { files: { path: string }[] };
    expect(idx.files.some((f) => f.path === "new.md")).toBe(true);
  });

  it("mkdir -p's the parent for a nested path", async () => {
    const r = await post("/api/file", { path: "a/b/c.md" });
    expect(r.status).toBe(200);
    expect(existsSync(join(dir, "a", "b", "c.md"))).toBe(true);
  });

  it.each(["scene.excalidraw", "scene.excalidraw.json"])(
    "creates %s as a valid empty drawing and indexes it",
    async (path) => {
      const r = await post("/api/file", { path });
      expect(r.status).toBe(200);
      expect(JSON.parse(readDoc(path))).toEqual({
        type: "excalidraw",
        version: 2,
        source: "mdc",
        elements: [],
        appState: {},
        files: {},
      });
      const response = (await r.json()) as { content: string };
      expect(response.content).toBe(readDoc(path));
      const idx = (await (await req("/api/index")).json()) as { drawings: string[] };
      expect(idx.drawings).toContain(path);
    },
  );

  it("refuses to overwrite an existing file (409)", async () => {
    await post("/api/file", { path: "new.md" });
    expect((await post("/api/file", { path: "new.md" })).status).toBe(409);
  });

  it("rejects a non-.md path and a missing path (400)", async () => {
    expect((await post("/api/file", { path: "notes.txt" })).status).toBe(400);
    expect((await post("/api/file", {})).status).toBe(400);
  });
});

describe("POST /api/folder (create folder)", () => {
  it("creates a folder and refuses to recreate it", async () => {
    expect((await post("/api/folder", { path: "notes" })).status).toBe(200);
    expect(existsSync(join(dir, "notes"))).toBe(true);
    expect((await post("/api/folder", { path: "notes" })).status).toBe(409);
  });

  it("a freshly created EMPTY folder shows in /api/index dirs (so the tree can render it)", async () => {
    await post("/api/folder", { path: "ideas" });
    await post("/api/folder", { path: "ideas/sub" });
    const data = (await (await req("/api/index")).json()) as { dirs: string[] };
    // Both the empty folder and its empty child surface, even with no .md inside.
    expect(data.dirs).toContain("ideas");
    expect(data.dirs).toContain("ideas/sub");
  });
});

describe("GET /api/index (dirs)", () => {
  it("lists directories that hold docs and prunes denied dirs", async () => {
    await post("/api/file", { path: "notes/todo.md" }); // mkdir -p's notes/
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    const data = (await (await req("/api/index")).json()) as { dirs: string[] };
    expect(data.dirs).toContain("notes");
    // Denied dirs are never walked, so they never appear.
    expect(data.dirs).not.toContain("node_modules");
    expect(data.dirs.some((d) => d.startsWith("node_modules"))).toBe(false);
  });
});

describe("DELETE /api/file (doc + sidecar)", () => {
  it("deletes the doc AND its sidecar together", async () => {
    await post("/api/comments?file=doc.md", {
      author: USER,
      body: "x",
      anchor: { quote: "fox", line: 3 },
    });
    expect(existsSync(join(dir, "doc.md.comments.jsonl"))).toBe(true);
    const r = (await (await req("/api/file?file=doc.md", { method: "DELETE" })).json()) as {
      deleted: boolean;
    };
    expect(r.deleted).toBe(true);
    expect(existsSync(join(dir, "doc.md"))).toBe(false);
    expect(existsSync(join(dir, "doc.md.comments.jsonl"))).toBe(false);
  });

  it("no-op-succeeds when the doc is already gone", async () => {
    const r = (await (await req("/api/file?file=ghost.md", { method: "DELETE" })).json()) as {
      deleted: boolean;
    };
    expect(r.deleted).toBe(false);
  });
});

describe("DELETE /api/folder (recursive)", () => {
  it("removes the folder and every descendant doc + sidecar", async () => {
    await post("/api/file", { path: "notes/a.md" });
    await post("/api/file", { path: "notes/sub/b.md" });
    await post("/api/comments?file=notes/a.md", {
      author: USER,
      body: "c",
      anchor: { quote: "", line: 1 },
    });
    expect(existsSync(join(dir, "notes", "a.md.comments.jsonl"))).toBe(true);
    const r = (await (await req("/api/folder?folder=notes", { method: "DELETE" })).json()) as {
      deleted: boolean;
    };
    expect(r.deleted).toBe(true);
    expect(existsSync(join(dir, "notes"))).toBe(false);
  });

  it("404s the summary / no-ops the delete for a missing folder", async () => {
    expect((await req("/api/folder/summary?folder=nope")).status).toBe(404);
    const r = (await (await req("/api/folder?folder=nope", { method: "DELETE" })).json()) as {
      deleted: boolean;
    };
    expect(r.deleted).toBe(false);
  });
});

describe("GET /api/folder/summary", () => {
  it("counts docs and how many carry open comments", async () => {
    await post("/api/file", { path: "f/a.md" });
    await post("/api/file", { path: "f/b.md" });
    await post("/api/comments?file=f/a.md", {
      author: USER,
      body: "open",
      anchor: { quote: "", line: 1 },
    });
    const s = (await (await req("/api/folder/summary?folder=f")).json()) as {
      docs: number;
      withComments: number;
    };
    expect(s.docs).toBe(2);
    expect(s.withComments).toBe(1);
  });
});

describe("POST /api/move — relocate a doc, its sidecar, and fix references", () => {
  async function moveJson(from: string, to: string) {
    const r = await post("/api/move", { from, to });
    return { status: r.status, body: await r.json() };
  }

  // Docs written straight to disk after createApp aren't in the live index;
  // hitting /api/index rescans, the way a real client would before commenting.
  const rescanIndex = () => req("/api/index");

  it("moves a file, relocates its sidecar, and rewrites inbound + outbound links", async () => {
    // index.md links INTO notes/projects/alpha.md; alpha links back OUT.
    writeDoc("index.md", "see [alpha](notes/projects/alpha.md)\n");
    writeDoc("notes/projects/alpha.md", "back to [index](../../index.md)\n");
    writeDoc("notes/projects/beta.md", "sibling [alpha](alpha.md)\n");
    // a comment on alpha so the sidecar exists and must travel
    await rescanIndex();
    await post("/api/comments?file=notes/projects/alpha.md", {
      author: USER,
      body: "keep me",
      anchor: { quote: "alpha", line: 1 },
    });
    expect(existsSync(join(dir, "notes/projects/alpha.md.comments.jsonl"))).toBe(true);

    const { status, body } = await moveJson("notes/projects/alpha.md", "archive/alpha.md");
    expect(status).toBe(200);

    // file + sidecar relocated
    expect(existsSync(join(dir, "archive/alpha.md"))).toBe(true);
    expect(existsSync(join(dir, "notes/projects/alpha.md"))).toBe(false);
    expect(existsSync(join(dir, "archive/alpha.md.comments.jsonl"))).toBe(true);
    expect(readSidecar(join(dir, "archive/alpha.md.comments.jsonl"))).toHaveLength(1);

    // inbound links rewritten to the new path
    expect(readDoc("index.md")).toContain("[alpha](archive/alpha.md)");
    expect(readDoc("notes/projects/beta.md")).toContain("[alpha](../../archive/alpha.md)");
    // outbound link in the moved doc rebased from its new home
    expect(readDoc("archive/alpha.md")).toContain("[index](../index.md)");

    expect(body).toMatchObject({ docsMoved: 1, sidecarsRelocated: 1 });
    expect((body as { linksRewritten: number }).linksRewritten).toBe(3);
  });

  it("leaves a basename wikilink alone but rewrites a path-qualified one", async () => {
    writeDoc("notes/projects/alpha.md", "# alpha\n");
    writeDoc("notes/daily/today.md", "[[alpha]] and [[notes/projects/alpha]]\n");
    await moveJson("notes/projects/alpha.md", "archive/alpha.md");
    const today = readDoc("notes/daily/today.md");
    expect(today).toContain("[[alpha]]"); // basename → untouched
    expect(today).toContain("[[archive/alpha]]"); // qualified → rewritten
  });

  it("moves a whole folder: every doc + sidecar travels and links follow", async () => {
    writeDoc("notes/projects/alpha.md", "[index](../../index.md)\n");
    writeDoc("notes/projects/beta.md", "[alpha](alpha.md)\n");
    writeDoc("index.md", "[a](notes/projects/alpha.md)\n");
    await rescanIndex();
    await post("/api/comments?file=notes/projects/alpha.md", {
      author: USER,
      body: "c",
      anchor: { quote: "index", line: 1 },
    });

    const { status, body } = await moveJson("notes/projects", "archive/projects");
    expect(status).toBe(200);
    expect(existsSync(join(dir, "archive/projects/alpha.md"))).toBe(true);
    expect(existsSync(join(dir, "archive/projects/beta.md"))).toBe(true);
    expect(existsSync(join(dir, "archive/projects/alpha.md.comments.jsonl"))).toBe(true);
    // alpha's own outbound link rebased; beta's intra-folder link unchanged
    expect(readDoc("archive/projects/alpha.md")).toContain("[index](../../index.md)");
    expect(readDoc("archive/projects/beta.md")).toContain("[alpha](alpha.md)");
    // the external inbound linker follows the move
    expect(readDoc("index.md")).toContain("[a](archive/projects/alpha.md)");
    expect((body as { docsMoved: number }).docsMoved).toBe(2);
  });

  it("refuses a destination that already exists (409)", async () => {
    writeDoc("a.md", "a\n");
    writeDoc("b.md", "b\n");
    const { status } = await moveJson("a.md", "b.md");
    expect(status).toBe(409);
    expect(readDoc("a.md")).toBe("a\n"); // unmoved
  });

  it("refuses moving a folder into itself (400)", async () => {
    writeDoc("f/x.md", "x\n");
    const { status } = await moveJson("f", "f/sub");
    expect(status).toBe(400);
  });

  it("refuses ../ escapes and the root itself", async () => {
    writeDoc("a.md", "a\n");
    expect((await post("/api/move", { from: "a.md", to: "../escape.md" })).status).toBe(404);
    expect((await post("/api/move", { from: "..", to: "x" })).status).toBe(404);
    expect((await post("/api/move", { from: ".", to: "x" })).status).toBe(400);
    expect(existsSync(join(dir, "..", "escape.md"))).toBe(false);
  });
});

describe("GET /api/move/preview — blast radius without touching disk", () => {
  it("reports the move counts and changes nothing on disk", async () => {
    writeDoc("index.md", "[alpha](notes/projects/alpha.md)\n");
    writeDoc("notes/projects/alpha.md", "[index](../../index.md)\n");
    writeDoc("notes/projects/beta.md", "[alpha](alpha.md)\n");

    const p = (await (
      await req("/api/move/preview?from=notes/projects/alpha.md&to=archive/alpha.md")
    ).json()) as {
      docsToMove: number;
      sidecarsToRelocate: number;
      docsToRewrite: number;
      linksToRewrite: number;
      collisions: string[];
    };
    expect(p.docsToMove).toBe(1);
    expect(p.docsToRewrite).toBe(3); // index, beta (inbound) + alpha (outbound)
    expect(p.linksToRewrite).toBe(3);
    expect(p.collisions).toEqual([]);
    // nothing moved
    expect(existsSync(join(dir, "notes/projects/alpha.md"))).toBe(true);
    expect(existsSync(join(dir, "archive/alpha.md"))).toBe(false);
  });
});

describe("path-traversal confinement (the security-load-bearing set)", () => {
  it("blocks ../ escapes and the root itself across every mutating route", async () => {
    // Create: ../ escape and empty (root) path.
    expect((await post("/api/file", { path: "../escape.md" })).status).toBe(404);
    expect((await post("/api/folder", { path: ".." })).status).toBe(404);
    expect((await post("/api/folder", { path: "" })).status).toBe(400); // empty → "path required"
    // Delete: ../ escape is blocked; the root itself is refused (400).
    expect((await req("/api/file?file=../escape.md", { method: "DELETE" })).status).toBe(404);
    expect((await req("/api/folder?folder=..", { method: "DELETE" })).status).toBe(404);
    expect((await req("/api/folder?folder=.", { method: "DELETE" })).status).toBe(400);
    // An absolute path must not escape either (resolve() would honor it).
    expect((await post("/api/file", { path: "/tmp/mdc-abs-escape.md" })).status).toBe(404);
    expect(existsSync("/tmp/mdc-abs-escape.md")).toBe(false);
    // Nothing escaped to the parent of the temp root.
    expect(existsSync(join(dir, "..", "escape.md"))).toBe(false);
  });
});
