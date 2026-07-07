/**
 * Tests for the handoff client — openSession + the SSE wait loop — exercised
 * against a real local HTTP server.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  HandoffError,
  openSession,
  waitForDone,
} from "../src/handoff.js";

const servers: Server[] = [];

function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      res(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((res) => {
          s.closeAllConnections();
          s.close(() => res());
        }),
    ),
  );
});

describe("openSession", () => {
  it("returns the session on 200", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "s1", file: "doc.md" }));
    });
    const s = await openSession("doc.md", base);
    expect(s.sessionId).toBe("s1");
    expect(s.file).toBe("doc.md");
  });

  it("409 (session already live) raises HandoffError", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(409);
      res.end("busy");
    });
    await expect(openSession("doc.md", base)).rejects.toThrow(HandoffError);
  });

  it("non-200 raises HandoffError", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    await expect(openSession("doc.md", base)).rejects.toThrow(HandoffError);
  });
});

describe("waitForDone", () => {
  it("returns the intent from a done event, ignoring heartbeats", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": heartbeat\n\n");
      res.write("event: ping\ndata: {}\n\n");
      res.write('event: done\ndata: {"intent": "review"}\n\n');
    });
    const intent = await waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base });
    expect(intent).toBe("review");
  });

  it("empty done data returns empty intent", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: done\ndata:\n\n");
    });
    const intent = await waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base });
    expect(intent).toBe("");
  });

  it("stream closed without done is fatal, not retried", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": heartbeat\n\n");
      res.end();
    });
    await expect(
      waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base }),
    ).rejects.toThrow(HandoffError);
  });

  it("a data line without a preceding done event does not resolve", async () => {
    // The done event must be named; bare data (or other events) keeps waiting.
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"intent": "review"}\n\n');
      res.write('event: other\ndata: {"intent": "review"}\n\n');
      res.write('event: done\ndata: {"intent": "done"}\n\n');
    });
    const intent = await waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base });
    expect(intent).toBe("done");
  });

  it("resolves to the timeout sentinel when no done arrives within the deadline", async () => {
    // Stream stays open (heartbeats only) — the client-side deadline must
    // abort it and resolve "timeout" rather than wait forever.
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": heartbeat\n\n");
    });
    const intent = await waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base }, 5, 150);
    expect(intent).toBe("timeout");
  });

  it("a done arriving before the deadline still wins", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: done\ndata: {"intent": "review"}\n\n');
    });
    const intent = await waitForDone({ sessionId: "s1", file: "f.md", baseUrl: base }, 5, 5000);
    expect(intent).toBe("review");
  });
});
