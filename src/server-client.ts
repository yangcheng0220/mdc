/**
 * Thin HTTP client for the running server — the queries the CLI makes against
 * it that aren't part of the handoff turn-taking: is it up, what's its root,
 * what's pending for a file. Best-effort: every call swallows network errors
 * and returns a null/false/empty answer rather than throwing, because "the
 * server isn't reachable" is a normal state the caller handles, not an error.
 */

import { dirname, resolve as resolvePath } from "node:path";
import { currentUser } from "./identity.js";
import {
  openThreadsAwaitingAgent,
  readSidecar,
  sidecarPathFor,
  type Thread,
} from "./sidecar.js";

// MDC_BASE_URL lets a caller (e.g. the CLI's `watch`) point at a non-default
// server port without threading --base-url through every call.
export const DEFAULT_BASE_URL = process.env.MDC_BASE_URL ?? "http://localhost:8000";

/**
 * The active handoff session info ({file, sessionId, ...}) or null. Useful for
 * callers that want to check "is anything listening" before opening.
 */
export async function activeSession(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${baseUrl}/api/handoff/sessions`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { active?: Record<string, unknown> | null };
    return data.active ?? null;
  } catch {
    return null;
  }
}

/** Quick check that the server is running. */
export async function serverAlive(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/api/index`, { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Whether a browser tab is currently connected to the server (an open live SSE
 * stream). Lets the CLI skip spawning a redundant tab when one is already live.
 * Best-effort: false if the server is unreachable or doesn't answer.
 */
export async function serverTabConnected(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const data = (await r.json()) as { tabConnected?: boolean };
    return data.tabConnected === true;
  } catch {
    return false;
  }
}

/** The server's /api/index payload ({root, files}), or null if unreachable. */
export async function serverIndex(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${baseUrl}/api/index`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * What a probe finds at a base URL:
 * - `free`     — nothing answered (the port is open for us to bind).
 * - `foreign`  — something answered, but it isn't an mdc server (its /api/index
 *                payload doesn't have the {root, files} shape). A real conflict.
 * - otherwise  — an mdc server is running; `root` is the absolute root it serves.
 */
export type ProbeResult =
  | { kind: "free" }
  | { kind: "foreign" }
  | { kind: "mdc"; root: string };

/**
 * Identify what (if anything) is serving at `baseUrl`. Distinguishes an mdc server
 * from an unrelated server on the same port by checking the /api/index shape,
 * so a caller about to bind the port can adopt an existing server, refuse a
 * foreign occupant, or proceed when the port is free.
 */
export async function probeServer(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<ProbeResult> {
  let payload: unknown;
  try {
    const r = await fetch(`${baseUrl}/api/index`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { kind: "foreign" };
    payload = await r.json();
  } catch {
    return { kind: "free" };
  }
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).root === "string" &&
    Array.isArray((payload as Record<string, unknown>).files)
  ) {
    return { kind: "mdc", root: (payload as Record<string, unknown>).root as string };
  }
  return { kind: "foreign" };
}

/**
 * Pending-agent threads for a root-relative file path. Resolves the absolute
 * path via the served root, then reads the sidecar through the core.
 */
export async function pendingFor(fileRel: string, baseUrl: string): Promise<Thread[]> {
  const index = await serverIndex(baseUrl);
  const root = index?.root;
  if (typeof root !== "string" || !root) return [];
  const mdPath = resolvePath(root, fileRel);
  const entries = readSidecar(sidecarPathFor(mdPath));
  return openThreadsAwaitingAgent(entries, currentUser(dirname(mdPath)));
}
