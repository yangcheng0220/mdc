/**
 * Server-side handoff session state.
 *
 * A single global active session at a time: the user hands a doc to an agent,
 * the agent blocks on the SSE event stream (`/api/handoff/events`), the user
 * clicks Hand off / End session (`/api/handoff/done`) to fire the signal. The
 * agent connecting IS the "agent is watching" presence signal — sessions can
 * exist with zero watchers, so the UI reports "watching" only when a watcher
 * is actually connected (honest presence).
 *
 * This owns the SERVER side of the handoff; the CLIENT side (an agent waiting
 * on the stream) lives in `handoff.ts`.
 */

import { randomUUID } from "node:crypto";

const SESSION_TTL_MS = 3600_000; // 1h; older sessions reaped on access
// A session opened but never attached within this window may be superseded —
// long enough for a healthy client to reach /events, short enough that a
// client that died between open and attach doesn't wedge the next open.
const ATTACH_GRACE_MS = 10_000;
// A Hand off fired while the agent was between poll chunks (watcher momentarily
// gone) is remembered this long and handed to the next session opened on the
// same file — so a click landing in the re-arm gap isn't silently lost. Short:
// it only bridges one poll gap, not a walk-away.
const LATCH_TTL_MS = 15_000;

export interface HandoffSession {
  sessionId: string;
  file: string;
  createdAt: number; // epoch ms
  intent: string | null;
  watcherCount: number;
  /** A watcher attached at least once — so count 0 now means it left. */
  hadWatcher: boolean;
  done: boolean;
  /** Resolves when the session is signaled done; awaited by event streams. */
  readonly signal: Promise<void>;
  /** Fires `signal` once (idempotent). */
  fire(intent: string): void;
}

function makeSession(file: string): HandoffSession {
  let resolveSignal!: () => void;
  const signal = new Promise<void>((res) => {
    resolveSignal = res;
  });
  const s: HandoffSession = {
    sessionId: randomUUID().replace(/-/g, ""),
    file,
    createdAt: Date.now(),
    intent: null,
    watcherCount: 0,
    hadWatcher: false,
    done: false,
    signal,
    fire(intent: string) {
      if (this.done) return;
      this.intent = intent;
      this.done = true;
      resolveSignal();
    },
  };
  return s;
}

/** A Hand off that fired with no watcher attached, awaiting the next session. */
interface PendingLatch {
  file: string;
  intent: string;
  at: number; // epoch ms
}

/** In-memory registry of handoff sessions (process-global, single active). */
export class HandoffRegistry {
  private sessions = new Map<string, HandoffSession>();
  /** At most one latched handoff (single active session ⇒ single latch). */
  private latch: PendingLatch | null = null;

  private reap(): void {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(sid);
    }
    if (this.latch && now - this.latch.at > LATCH_TTL_MS) this.latch = null;
  }

  /**
   * Record a Hand off that fired with no watcher attached (the agent was between
   * poll chunks). The next session opened on the SAME file within LATCH_TTL_MS
   * consumes it. Only ever called for a real, existing session's `done` — so the
   * "no agent ever" case (which never reaches `done`) can't latch.
   */
  recordLatch(file: string, intent: string): void {
    this.latch = { file, intent, at: Date.now() };
  }

  get(sessionId: string): HandoffSession | undefined {
    this.reap();
    return this.sessions.get(sessionId);
  }

  /** The single currently-live (not-done) session, or null. */
  active(): HandoffSession | null {
    this.reap();
    for (const s of this.sessions.values()) {
      if (!s.done) return s;
    }
    return null;
  }

  /**
   * A live-looking session nobody is actually waiting on: its watcher attached
   * and disconnected (timeout poll, Ctrl-C, crash), or it never attached within
   * the grace window. Such sessions must not block the next open — an agent
   * polling with `watch --timeout` abandons one per chunk.
   */
  private abandoned(s: HandoffSession): boolean {
    if (s.watcherCount > 0) return false;
    if (s.hadWatcher) return true;
    return Date.now() - s.createdAt > ATTACH_GRACE_MS;
  }

  /**
   * Open a new session, superseding any abandoned one. Throws 409 only when a
   * session with a live (or still-arriving) watcher holds the slot.
   */
  open(file: string): HandoffSession {
    this.reap();
    for (const [sid, s] of this.sessions) {
      if (!s.done && this.abandoned(s)) this.sessions.delete(sid);
    }
    const existing = this.active();
    if (existing) {
      const err = new Error(
        `another session is live on '${existing.file}'; wait for it to finish`,
      );
      (err as Error & { status?: number }).status = 409;
      throw err;
    }
    const s = makeSession(file);
    this.sessions.set(s.sessionId, s);
    // Consume a latched handoff for this file: the previous session's Hand off
    // fired in the poll gap and never reached a watcher. Deliver it on this
    // reconnect so the user's click isn't lost. Same-file only — a latch never
    // crosses to a different doc.
    if (this.latch && this.latch.file === file) {
      const { intent } = this.latch;
      this.latch = null;
      s.fire(intent);
    }
    return s;
  }
}
