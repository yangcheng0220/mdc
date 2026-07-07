/**
 * One shared live-reload stream for every open document.
 *
 * A single `EventSource` watches the union of all open files; the server
 * multiplexes change events tagged with `{file}`, and each is routed to its
 * file's callback. Why one stream and not one-per-file: an SSE connection never
 * closes, and the browser caps ~6 connections per host (HTTP/1.1) — one stream
 * per open tab would exhaust the cap and wedge the frontend once ~6 docs are open.
 *
 * The stream is rebuilt only when the watched file *set* changes (idempotent on
 * unrelated re-renders), and reconnects with a short backoff on error. Callbacks
 * are read through a ref so changing them never forces a reconnect.
 */

import { useEffect, useRef } from "react";

export interface LiveReloadHandlers {
  onSidecarChanged: (file: string) => void;
  onDocChanged: (file: string) => void;
  /** `mdc open` asked the frontend to switch/add this file (no new tab). */
  onOpenFile: (file: string) => void;
}

export function useLiveReload(files: string[], handlers: LiveReloadHandlers): void {
  // Latest handlers, read by the event listeners without re-binding the stream.
  const cb = useRef(handlers);
  cb.current = handlers;

  // A stable key for the watched set: reconnect only when this changes.
  const key = [...files].sort().join("\n");

  useEffect(() => {
    const watched = key ? key.split("\n") : [];

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const route = (kind: "sidecar" | "doc", raw: string) => {
      let file: string;
      try {
        file = (JSON.parse(raw) as { file: string }).file;
      } catch {
        return;
      }
      if (kind === "sidecar") cb.current.onSidecarChanged(file);
      else cb.current.onDocChanged(file);
    };

    const connect = () => {
      if (closed) return;
      // Always connect — even with no files watched yet — so `open-file`
      // commands reach a freshly-served frontend that has nothing open.
      const qs = watched.map((f) => "file=" + encodeURIComponent(f)).join("&");
      const src = new EventSource("/api/events?" + qs);
      es = src;
      src.addEventListener("sidecar-changed", (e) => route("sidecar", (e as MessageEvent).data));
      src.addEventListener("doc-changed", (e) => route("doc", (e as MessageEvent).data));
      src.addEventListener("open-file", (e) => {
        try {
          cb.current.onOpenFile((JSON.parse((e as MessageEvent).data) as { file: string }).file);
        } catch {
          /* ignore malformed */
        }
      });
      src.onerror = () => {
        src.close();
        if (es === src) es = null;
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [key]);
}
