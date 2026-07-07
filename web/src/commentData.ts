/**
 * The comment data layer for the frontend: fetch a document's entries and shape
 * them into display threads. Thread grouping, edit-folding, and deletion are
 * computed by the shared core primitives (one canonical implementation); this
 * module only assembles the per-thread display objects the cards render.
 */

import {
  deletedCommentIds,
  isEvent,
  latestBodyByComment,
  resolvedThreadIds,
  type Entry,
} from "../../src/threads.js";

/** A comment/reply prepared for display: edits applied, deletion flagged. */
interface DisplayComment extends Entry {
  body: string;
  deleted: boolean;
}

/** A thread as the sidebar shows it: a top-level comment + its surviving replies. */
export interface DisplayThread {
  top: DisplayComment;
  replies: DisplayComment[];
  resolved: boolean;
}

/**
 * A comment being composed: the selected quote plus what's needed to build its
 * anchor on submit (rendered offset for the context fingerprint, block text for
 * the line-number fallback) and to place its card (anchorY).
 */
export interface PendingComment {
  quote: string;
  anchorY: number;
  blockText: string;
  renderedOffset: number;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || r.statusText);
  return (await r.json()) as T;
}

/** Raw entries for a document's sidecar (file order). */
export function fetchComments(file: string): Promise<Entry[]> {
  return getJson<{ entries: Entry[] }>(`/api/comments?file=${encodeURIComponent(file)}`).then(
    (r) => r.entries,
  );
}

/** Apply the effective edit (latest body) + deletion tombstone to one entry. */
function applyCrud(
  e: Entry,
  edits: Map<string, string>,
  deleted: Set<string>,
): DisplayComment {
  const isDeleted = deleted.has(e.id);
  const body = isDeleted ? "[deleted]" : (edits.get(e.id) ?? e.body ?? "");
  return { ...e, body, deleted: isDeleted };
}

/**
 * Group entries into display threads, tagging each with resolved state.
 *
 * A deleted top-level comment is kept as a tombstone only while it still has
 * surviving replies (so the thread isn't lost); with no replies left the whole
 * thread drops. Deleted replies are removed outright.
 */
export function groupThreads(entries: Entry[]): DisplayThread[] {
  const resolved = resolvedThreadIds(entries);
  const edits = latestBodyByComment(entries);
  const deleted = deletedCommentIds(entries);

  const topLevels = entries
    .filter((e) => !isEvent(e) && (e.parent_id ?? null) === null)
    .map((top) => applyCrud(top, edits, deleted));

  const byParent = new Map<string, DisplayComment[]>();
  for (const e of entries) {
    if (!isEvent(e) && e.parent_id && !deleted.has(e.id)) {
      const list = byParent.get(e.parent_id);
      const shaped = applyCrud(e, edits, deleted);
      if (list) list.push(shaped);
      else byParent.set(e.parent_id, [shaped]);
    }
  }

  return topLevels
    .map((top) => ({
      top,
      replies: (byParent.get(top.id) ?? []).sort((a, b) =>
        (a.timestamp ?? "").localeCompare(b.timestamp ?? ""),
      ),
      resolved: resolved.has(top.id),
    }))
    .filter((t) => !(t.top.deleted && t.replies.length === 0));
}

/**
 * thread_id → the resolve event currently in effect (who resolved it, when, and
 * the anchor snapshot for display). An `unresolved` event clears the entry, so
 * only currently-resolved threads remain. Used by the Resolved view.
 */
export function resolveEventsByThread(entries: Entry[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const e of entries) {
    if (e.type === "resolved" && e.thread_id) out.set(e.thread_id, e);
    else if (e.type === "unresolved" && e.thread_id) out.delete(e.thread_id);
  }
  return out;
}

/** Local time (HH:MM) for a comment timestamp. */
export function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Compact "just now" / "5m ago" / "3d ago" for inbox rows. */
export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
