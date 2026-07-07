/**
 * Registry-level handoff state, focused on the poll-gap latch: a Hand off that
 * fires while the agent is between `watch --timeout` chunks (no watcher
 * attached) must be delivered to the next session opened on the same file,
 * rather than lost in the re-arm gap.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { HandoffRegistry } from "../src/server/handoff-state.js";

afterEach(() => {
  vi.useRealTimers();
});

/** Simulate the poll gap: a session fired its handoff with no watcher attached. */
function firedWithNoWatcher(reg: HandoffRegistry, file: string, intent: string) {
  const s = reg.open(file);
  // No `/events` connection ⇒ watcherCount stays 0 ⇒ delivered would be false.
  expect(s.watcherCount).toBe(0);
  s.fire(intent);
  reg.recordLatch(file, intent); // app.ts records the latch on the delivered:false branch
  return s;
}

describe("handoff latch (poll-gap delivery)", () => {
  it("delivers a latched handoff to the next session on the same file", () => {
    const reg = new HandoffRegistry();
    firedWithNoWatcher(reg, "a.md", "mdc-review");

    // The prior session is done; the agent re-arms → opens a fresh session.
    const next = reg.open("a.md");
    // The latch fired the new session immediately: the reconnecting agent gets it.
    expect(next.done).toBe(true);
    expect(next.intent).toBe("mdc-review");
  });

  it("does NOT cross to a different file", () => {
    const reg = new HandoffRegistry();
    firedWithNoWatcher(reg, "a.md", "mdc-review");

    // The agent re-arms on a different doc — the latch must not leak onto it.
    const next = reg.open("b.md");
    expect(next.done).toBe(false);
    expect(next.intent).toBe(null);
  });

  it("expires after the latch TTL (a walk-away, not a poll gap)", () => {
    vi.useFakeTimers();
    const reg = new HandoffRegistry();
    firedWithNoWatcher(reg, "a.md", "mdc-review");

    // Past the latch window: this is no longer a re-arm gap, it's a stale intent.
    vi.advanceTimersByTime(20_000);
    const next = reg.open("a.md");
    expect(next.done).toBe(false);
    expect(next.intent).toBe(null);
  });

  it("is consumed once — a second session on the same file does not re-fire", () => {
    const reg = new HandoffRegistry();
    firedWithNoWatcher(reg, "a.md", "mdc-review");

    const first = reg.open("a.md");
    expect(first.done).toBe(true);
    first.fire("done"); // end that session

    // A subsequent open must not resurrect the already-consumed latch.
    const second = reg.open("a.md");
    expect(second.done).toBe(false);
    expect(second.intent).toBe(null);
  });

  it("no latch when no handoff was recorded (plain session lifecycle)", () => {
    // The 'no agent ever' path never calls done → never records a latch, so a
    // fresh session opens clean. Guards against latching an unrelated open.
    const reg = new HandoffRegistry();
    const s = reg.open("a.md");
    expect(s.done).toBe(false);
    expect(s.intent).toBe(null);
  });

  it("a fresh open still supersedes an abandoned prior session (latch aside)", () => {
    const reg = new HandoffRegistry();
    // A session that attached then dropped (poll timeout) is abandoned; opening
    // again must not 409 — unchanged behavior, verified alongside the latch.
    const a = reg.open("a.md");
    a.hadWatcher = true; // attached at least once
    a.watcherCount = 0; // then left
    const b = reg.open("a.md");
    expect(b.sessionId).not.toBe(a.sessionId);
  });
});
