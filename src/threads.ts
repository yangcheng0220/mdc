/**
 * Thread derivation over a doc's comment entries — the pure, dependency-free
 * half of the sidecar model. Everything here is computed from an in-memory
 * `Entry[]`; nothing here touches the filesystem, so it bundles into the browser
 * as well as running server-side. The file I/O that produces those entries lives
 * in `sidecar.ts`, which re-exports this module so existing imports keep working.
 *
 * Model (append-only, derive-on-read):
 *   - A *comment* or *reply* line has no `type` field. Top-level comments carry
 *     an `anchor`; replies carry a `parent_id`.
 *   - An *event* line carries a `type`:
 *       resolved / unresolved  — act on a thread (thread_id)
 *       acknowledged           — act on a thread (thread_id)
 *       edit / deleted         — act on one comment/reply (comment_id)
 *   - "Latest event wins": a thread's status / a comment's body is whatever the
 *     last relevant event says.
 *
 * Status lifecycle (derived, per thread):
 *   pending      -> no acknowledged/resolved events
 *   acknowledged -> latest lifecycle event is `acknowledged`
 *   resolved     -> latest resolve event is `resolved`
 *   (unresolve flips a thread back; its lifecycle status falls to
 *    acknowledged if it was ever acknowledged, else pending.)
 */

// Event lines carry a "type"; comments/replies do not. Every place that
// classifies a line as a comment must skip these.
export const RESOLVE_TYPES = new Set(["resolved", "unresolved"]);
export const LIFECYCLE_TYPES = new Set(["resolved", "unresolved", "acknowledged"]);
export const EVENT_TYPES = new Set([
  "resolved",
  "unresolved",
  "acknowledged",
  "edit",
  "deleted",
]);

export interface AnchorContext {
  before?: string;
  after?: string;
}

export interface Anchor {
  quote: string;
  line?: number | null;
  context?: AnchorContext | null;
  [key: string]: unknown;
}

/** One JSONL line: a comment, a reply, or an event. */
export interface Entry {
  id: string;
  file?: string;
  type?: string;
  parent_id?: string | null;
  anchor?: Anchor | null;
  author?: string;
  body?: string;
  timestamp?: string;
  thread_id?: string;
  comment_id?: string;
  anchor_snapshot?: { quote: string; line?: number | null };
  [key: string]: unknown;
}

export type ThreadStatus = "open" | "resolved";
export type Awaiting = "you" | "agent";
export type Lifecycle = "pending" | "acknowledged" | "resolved";

export interface Thread {
  thread_id: string;
  quote: string;
  /** The BINARY open/resolved contract the frontend + dashboard depend on. */
  status: ThreadStatus;
  awaiting: Awaiting;
  last_author: string | null;
  last_ts: string | null;
  reply_count: number;
  /** Finer pending/acknowledged/resolved state for the watch-loop; additive,
   * never redefines `status`. */
  lifecycle: Lifecycle;
}

export function isEvent(entry: Entry): boolean {
  return entry.type !== undefined && EVENT_TYPES.has(entry.type);
}

/**
 * Top-level comments only — excludes replies (parent_id set) and event lines
 * (which also have no parent_id).
 */
export function topLevelComments(entries: Entry[]): Entry[] {
  return entries.filter((e) => !isEvent(e) && (e.parent_id ?? null) === null);
}

/** Comment/reply ids tombstoned by a `deleted` event. */
export function deletedCommentIds(entries: Entry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.type === "deleted" && e.comment_id) ids.add(e.comment_id);
  }
  return ids;
}

/**
 * comment_id -> latest edited body (last edit event wins). The JSONL keeps every
 * version; this resolves the effective body so an edited comment reads as its
 * newest text. Used wherever a comment is displayed — keep this the one place
 * edits are applied, so every consumer stays consistent.
 */
export function latestBodyByComment(entries: Entry[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const e of entries) {
    if (e.type === "edit" && e.comment_id) latest.set(e.comment_id, e.body ?? "");
  }
  return latest;
}

/**
 * Thread ids whose LATEST resolve/unresolve event is 'resolved'
 * (last-event-wins; unresolve can flip a thread back open).
 */
export function resolvedThreadIds(entries: Entry[]): Set<string> {
  const latest = new Map<string, string>();
  for (const e of entries) {
    if (e.type !== undefined && RESOLVE_TYPES.has(e.type) && e.thread_id !== undefined) {
      latest.set(e.thread_id, e.type);
    }
  }
  const out = new Set<string>();
  for (const [tid, t] of latest) if (t === "resolved") out.add(tid);
  return out;
}

/**
 * thread_id -> derived lifecycle status (pending|acknowledged|resolved).
 *
 * Walks lifecycle events (acknowledged/resolved/unresolved) in file order.
 * - `resolved`     -> resolved
 * - `unresolved`   -> drop back to acknowledged-if-ever-acked, else pending
 * - `acknowledged` -> acknowledged
 *
 * A thread with no lifecycle events is `pending`. Threads not seen here are
 * pending by absence.
 */
export function threadStatusMap(entries: Entry[]): Map<string, Lifecycle> {
  const status = new Map<string, Lifecycle>();
  const everAcked = new Set<string>();
  for (const e of entries) {
    const t = e.type;
    if (t === undefined || !LIFECYCLE_TYPES.has(t)) continue;
    const tid = e.thread_id;
    if (!tid) continue;
    if (t === "acknowledged") {
      everAcked.add(tid);
      status.set(tid, "acknowledged");
    } else if (t === "resolved") {
      status.set(tid, "resolved");
    } else if (t === "unresolved") {
      status.set(tid, everAcked.has(tid) ? "acknowledged" : "pending");
    }
  }
  return status;
}

/** parent_id -> its non-deleted reply entries (unsorted). */
export function survivingRepliesByParent(
  entries: Entry[],
  deleted: Set<string>,
): Map<string, Entry[]> {
  const byParent = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!isEvent(e) && (e.parent_id ?? null) !== null && !deleted.has(e.id)) {
      const parentId = e.parent_id as string;
      const list = byParent.get(parentId);
      if (list) list.push(e);
      else byParent.set(parentId, [e]);
    }
  }
  return byParent;
}

/**
 * One record per surviving thread.
 *
 * Survival: a resolved thread is kept (flagged resolved); a top-level comment
 * deleted with no surviving replies drops entirely (the thread is gone).
 *
 * `user` is the configured "user" name — used to derive `awaiting`: if the
 * last surviving entry's author is the user, the ball is in the agent's court
 * (awaiting: agent); otherwise an agent spoke last (awaiting: you). Derived,
 * not stored.
 */
export function deriveThreads(entries: Entry[], user: string): Thread[] {
  const resolved = resolvedThreadIds(entries);
  const deleted = deletedCommentIds(entries);
  const lifecycleMap = threadStatusMap(entries);
  const byParent = survivingRepliesByParent(entries, deleted);

  const threads: Thread[] = [];
  for (const top of topLevelComments(entries)) {
    const replies = [...(byParent.get(top.id) ?? [])].sort((a, b) =>
      (a.timestamp ?? "") < (b.timestamp ?? "") ? -1 : (a.timestamp ?? "") > (b.timestamp ?? "") ? 1 : 0,
    );
    if (deleted.has(top.id) && replies.length === 0) {
      continue; // parent deleted, no replies left — thread is gone
    }
    const full = [top, ...replies];
    const last = full[full.length - 1] as Entry;
    const anchor = top.anchor ?? {};
    const isResolved = resolved.has(top.id);
    // lifecycle: resolved wins; else the map (acknowledged); else pending.
    // If the map says resolved but the resolve set doesn't, an unresolve
    // flipped it back -> fall to acknowledged-if-ever-acked / pending.
    let lifecycle: Lifecycle;
    if (isResolved) {
      lifecycle = "resolved";
    } else {
      lifecycle = lifecycleMap.get(top.id) ?? "pending";
      if (lifecycle === "resolved") lifecycle = "pending";
    }
    threads.push({
      thread_id: top.id,
      quote: (anchor as Anchor).quote ?? "",
      status: isResolved ? "resolved" : "open",
      awaiting: last.author === user ? "agent" : "you",
      last_author: last.author ?? null,
      last_ts: last.timestamp ?? null,
      reply_count: replies.length,
      lifecycle,
    });
  }
  return threads;
}

/**
 * Surviving, non-resolved threads where the last entry is from `user` —
 * i.e. the ball is in the agent's court.
 */
export function openThreadsAwaitingAgent(entries: Entry[], user: string): Thread[] {
  return deriveThreads(entries, user).filter(
    (t) => t.status !== "resolved" && t.awaiting === "agent",
  );
}
