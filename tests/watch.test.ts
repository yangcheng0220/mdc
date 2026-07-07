/**
 * Tests for the watch command + intent normalization. The HTTP-facing seams
 * are mocked at their module boundaries: waitForSignal lives in handoff;
 * serverAlive / pendingFor are server-client queries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import * as handoff from "../src/handoff.js";
import * as serverClient from "../src/server-client.js";

vi.mock("../src/handoff.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/handoff.js")>();
  return { ...orig, waitForSignal: vi.fn() };
});

vi.mock("../src/server-client.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/server-client.js")>();
  return { ...orig, serverAlive: vi.fn(), pendingFor: vi.fn(), serverIndex: vi.fn() };
});

// watch takes an absolute .md path and resolves it relative to the server's
// root (mocked here); the file must live under the root to be reachable.
const ROOT = "/srv/docs";
const FILE = `${ROOT}/f.md`;

let stdout: string;

async function run(argv: string[]): Promise<[number, string]> {
  stdout = "";
  const code = await main(argv);
  return [code, stdout];
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout += a.join(" ") + "\n";
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("watch", () => {
  it("server down returns fallback, not hang", async () => {
    // Dead server -> immediate server-down result, no blocking.
    vi.mocked(serverClient.serverAlive).mockResolvedValue(false);
    const [code, out] = await run([
      "watch",
      "some/file.md",
      "--base-url",
      "http://localhost:9999",
    ]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.intent).toBe("server-down");
    expect(data.pending).toEqual([]);
  });

  it("review intent attaches pending", async () => {
    // Server "up", signal returns review, pending computed -> full shape.
    vi.mocked(serverClient.serverAlive).mockResolvedValue(true);
    vi.mocked(serverClient.serverIndex).mockResolvedValue({ root: ROOT });
    vi.mocked(handoff.waitForSignal).mockResolvedValue("review");
    vi.mocked(serverClient.pendingFor).mockResolvedValue([
      { thread_id: "t1" } as never,
    ]);
    const [code, out] = await run(["watch", FILE]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.intent).toBe("review");
    expect(data.pending).toEqual([{ thread_id: "t1" }]);
  });

  it("done intent", async () => {
    vi.mocked(serverClient.serverAlive).mockResolvedValue(true);
    vi.mocked(serverClient.serverIndex).mockResolvedValue({ root: ROOT });
    vi.mocked(handoff.waitForSignal).mockResolvedValue("done");
    vi.mocked(serverClient.pendingFor).mockResolvedValue([]);
    const [, out] = await run(["watch", FILE]);
    expect(JSON.parse(out).intent).toBe("done");
  });

  it("timeout intent passes --timeout through and reports cleanly", async () => {
    vi.mocked(serverClient.serverAlive).mockResolvedValue(true);
    vi.mocked(serverClient.serverIndex).mockResolvedValue({ root: ROOT });
    vi.mocked(handoff.waitForSignal).mockResolvedValue("timeout");
    const [code, out] = await run(["watch", FILE, "--timeout", "60"]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.intent).toBe("timeout");
    expect(data.pending).toEqual([]);
    // The deadline reaches waitForSignal in milliseconds.
    expect(vi.mocked(handoff.waitForSignal)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      60000,
    );
  });

  it("signal failure returns error", async () => {
    vi.mocked(serverClient.serverAlive).mockResolvedValue(true);
    vi.mocked(serverClient.serverIndex).mockResolvedValue({ root: ROOT });
    vi.mocked(handoff.waitForSignal).mockResolvedValue(null);
    const [code, out] = await run(["watch", FILE]);
    expect(code).toBe(1);
    expect(JSON.parse(out).intent).toBe("error");
  });

  it("file outside the server root reports unreachable as JSON", async () => {
    vi.mocked(serverClient.serverAlive).mockResolvedValue(true);
    vi.mocked(serverClient.serverIndex).mockResolvedValue({ root: ROOT });
    const [code, out] = await run(["watch", "/elsewhere/f.md"]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.intent).toBe("unreachable");
    expect(data.pending).toEqual([]);
  });

  it("intent alias mdc-review normalizes to review", async () => {
    // The browser still sends 'mdc-review'; watch must treat it as 'review'.
    const { normalizeIntent } = await vi.importActual<
      typeof import("../src/handoff.js")
    >("../src/handoff.js");
    expect(normalizeIntent("mdc-review")).toBe("review");
    expect(normalizeIntent("review")).toBe("review");
    expect(normalizeIntent("done")).toBe("done");
    expect(normalizeIntent(null)).toBeNull();
  });
});
