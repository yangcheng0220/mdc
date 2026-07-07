/**
 * Handoff client for the mdc watch loop — the agent-side of the turn-taking.
 *
 * The server hosts /api/handoff/{open,events,done}. This module opens a session
 * and blocks on the SSE event stream until the user signals, parsing the stream
 * by hand — global fetch speaks streaming responses, no extra deps. The general
 * "is the server up / what's pending" queries live in server-client.ts.
 */

import { DEFAULT_BASE_URL } from "./server-client.js";

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

export interface HandoffSession {
  sessionId: string;
  file: string;
  baseUrl: string;
}

/**
 * Open a new handoff session for `file`. Throws HandoffError if the server
 * rejects (e.g., another session is already live).
 */
export async function openSession(
  file: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<HandoffSession> {
  const r = await fetch(`${baseUrl}/api/handoff/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  });
  if (r.status === 409) {
    throw new HandoffError(`another session is already live: ${await r.text()}`);
  }
  if (r.status !== 200) {
    throw new HandoffError(`open failed (${r.status}): ${await r.text()}`);
  }
  const data = (await r.json()) as { sessionId: string; file: string };
  return { sessionId: data.sessionId, file: data.file, baseUrl };
}

/**
 * Block until the server fires `done`. Returns the intent string.
 *
 * Reconnects on transient stream drops up to `reconnectMax` times. Only
 * returns when a real `done` event arrives; heartbeats are ignored. A stream
 * the server closes cleanly without a done event is fatal, not retried.
 */
export async function waitForDone(
  session: HandoffSession,
  reconnectMax = 5,
  timeoutMs?: number,
): Promise<string> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    try {
      return await streamUntilDone(session, deadline);
    } catch (e) {
      if (e instanceof HandoffError) throw e; // clean close without done — fatal
      attempts += 1;
      if (attempts > reconnectMax) {
        throw new HandoffError(`SSE stream failed after ${attempts} attempts: ${String(e)}`);
      }
      await sleep(Math.min(2 ** attempts, 10) * 1000);
    }
  }
}

/**
 * Stream the session's SSE events until `done` fires — or until `deadline`
 * (epoch ms) passes, in which case it resolves to the sentinel intent
 * `"timeout"`. Aborting the fetch closes the stream, so the server drops the
 * session the same way it does on any client disconnect.
 */
async function streamUntilDone(session: HandoffSession, deadline?: number): Promise<string> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (deadline !== undefined) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "timeout";
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, remaining);
  }
  try {
    return await streamEvents(session, ctrl.signal);
  } catch (e) {
    if (timedOut) return "timeout";
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function streamEvents(session: HandoffSession, signal: AbortSignal): Promise<string> {
  const url = new URL(`${session.baseUrl}/api/handoff/events`);
  url.searchParams.set("sessionId", session.sessionId);
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`events stream failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) {
        event = null;
        continue;
      }
      if (line.startsWith(":")) continue; // heartbeat comment
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:") && event === "done") {
        const data = line.slice("data:".length).trim();
        const payload = (data ? JSON.parse(data) : {}) as { intent?: string };
        void reader.cancel().catch(() => {});
        return payload.intent ?? "";
      }
    }
  }
  throw new HandoffError("SSE stream closed without a done event");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The browser still sends the legacy 'mdc-review' intent (the live mdc-session
// skill keys off it). Treat it as an alias for 'review' so the watch loop
// accepts the same Hand off click.
const INTENT_ALIASES: Record<string, string> = { "mdc-review": "review" };

export function normalizeIntent(intent: string | null): string | null {
  if (intent === null) return null;
  return INTENT_ALIASES[intent] ?? intent;
}

/**
 * Open a handoff session for `fileRel` and block until the server fires
 * `done`, returning the normalized intent — or null on handoff failure.
 */
export async function waitForSignal(
  fileRel: string,
  baseUrl: string,
  timeoutMs?: number,
): Promise<string | null> {
  try {
    const session = await openSession(fileRel, baseUrl);
    const intent = await waitForDone(session, undefined, timeoutMs);
    return normalizeIntent(intent);
  } catch (e) {
    if (e instanceof HandoffError) return null;
    throw e;
  }
}
