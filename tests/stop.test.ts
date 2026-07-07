/**
 * Tests for the `stop` command's probe-guarded decisions, driven through
 * main(["stop", ...]) against real bound servers on ephemeral ports.
 *
 * Coverage is the DECISION layer (free / foreign / refuse), not the kill of a
 * separate process: stopServerOnPort filters out its own PID, so an in-process
 * server can't be killed from the same process — the actual terminate + restart
 * is covered by live verification. Here we assert that stop:
 *   - no-ops with success when nothing is listening,
 *   - refuses (and leaves untouched) a foreign occupant of the port.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let stdout: string;
let stderr: string;

async function run(argv: string[]): Promise<[number, string]> {
  stdout = "";
  stderr = "";
  const code = await main(argv);
  return [code, stdout];
}

/** Bind a Hono app to an ephemeral port; resolve with the port + a closer. */
function bind(app: Hono): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve({
        port: info.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout += a.join(" ") + "\n";
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr += a.join(" ") + "\n";
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stop", () => {
  it("no-ops with success when nothing is listening", async () => {
    // An ephemeral port we never bind. Bind-then-close to pick a free one.
    const { port, close } = await bind(new Hono());
    await close();
    const [code, out] = await run(["stop", "--port", String(port)]);
    expect(code).toBe(0);
    expect(out).toContain("nothing to stop");
  });

  it("refuses a foreign occupant and leaves it running", async () => {
    // A server that answers but isn't mdc-shaped (/api/index lacks {root,files}).
    const app = new Hono();
    app.get("/api/index", (c) => c.json({ not: "an mdc server" }));
    const { port, close } = await bind(app);
    try {
      const [code] = await run(["stop", "--port", String(port)]);
      expect(code).toBe(1);
      expect(stderr).toContain("isn't an mdc server");
      // Still alive — we must not have killed a stranger.
      const r = await fetch(`http://127.0.0.1:${port}/api/index`);
      expect(r.ok).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("serve --restart", () => {
  it("is a registered flag and still refuses a foreign port (guard runs first)", async () => {
    // The foreign-occupant guard runs before the restart branch, so `serve
    // --restart` against a foreign server refuses rather than trying to stop it.
    const app = new Hono();
    app.get("/api/index", (c) => c.json({ not: "an mdc server" }));
    const { port, close } = await bind(app);
    try {
      const [code] = await run(["serve", ".", "--port", String(port), "--restart", "--no-open"]);
      expect(code).toBe(1);
      expect(stderr).toContain("isn't an mdc");
      const r = await fetch(`http://127.0.0.1:${port}/api/index`);
      expect(r.ok).toBe(true);
    } finally {
      await close();
    }
  });
});
