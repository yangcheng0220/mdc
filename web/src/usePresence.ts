/**
 * Polls for the current handoff session so the toolbar knows whether an agent is
 * listening (and on which file). Cheap; a 4s interval is responsive enough for
 * human click timing without spamming the server. `refresh` forces an immediate
 * re-poll after an action (hand off / end session) changes presence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchActiveSession, type ActiveSession } from "./api.js";

const POLL_MS = 4000;

export interface PresenceState {
  active: ActiveSession | null;
  refresh: () => void;
}

export function usePresence(): PresenceState {
  const [active, setActive] = useState<ActiveSession | null>(null);
  // Compare-and-set so presence only changes identity when it actually changes,
  // keeping the toolbar from re-rendering every tick.
  const last = useRef<string>("null");

  const poll = useCallback(async () => {
    try {
      const next = await fetchActiveSession();
      const key = JSON.stringify(next);
      if (key !== last.current) {
        last.current = key;
        setActive(next);
      }
    } catch {
      // Network hiccup — keep last known state, retry next tick.
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { active, refresh: poll };
}
