/**
 * The sidecar: read, append, and derive over a doc's `.comments.jsonl`.
 *
 * The rules here are authoritative; clients import them rather than
 * reproducing them.
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

import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  deriveThreads,
  EVENT_TYPES,
  openThreadsAwaitingAgent,
  type Anchor,
  type Entry,
  type Suggestion,
} from "./threads.js";

// The pure thread-derivation half lives in `threads.js` (no Node deps, so it
// also bundles into the browser). Re-export it here so existing imports of the
// types/constants/derivation functions from `sidecar.js` keep working.
export * from "./threads.js";

export const SIDECAR_SUFFIX = ".comments.jsonl";

/** A batch entry failed validation. Carries a human-readable message. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// --------------------------------------------------------------------------
// Paths
// --------------------------------------------------------------------------

/**
 * The sidecar path for a `.md` file: `<name>.md` -> `<name>.md.comments.jsonl`.
 *
 * Appends the suffix to the full name (NOT a suffix replacement, which would
 * lose the `.md` — and `.md` names can themselves contain dots, e.g.
 * `PROJECT.md`).
 */
export function sidecarPathFor(mdPath: string): string {
  return join(dirname(mdPath), basename(mdPath) + SIDECAR_SUFFIX);
}

/** Inverse of sidecarPathFor: strip the literal suffix to get the `.md`. */
export function mdPathFor(sidecarPath: string): string {
  const name = basename(sidecarPath);
  if (!name.endsWith(SIDECAR_SUFFIX)) {
    throw new Error(`not a sidecar filename: ${name}`);
  }
  return join(dirname(sidecarPath), name.slice(0, -SIDECAR_SUFFIX.length));
}

// --------------------------------------------------------------------------
// Raw I/O
// --------------------------------------------------------------------------

/** All entries in file order. Missing file -> []. Blank lines skipped. */
export function readSidecar(sidecarPath: string): Entry[] {
  if (!existsSync(sidecarPath)) return [];
  const entries: Entry[] = [];
  for (const raw of readFileSync(sidecarPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (line) entries.push(JSON.parse(line) as Entry);
  }
  return entries;
}

/** Atomically append entries: one write so all land or none do. */
export function appendEntries(sidecarPath: string, entries: Entry[]): void {
  mkdirSync(dirname(sidecarPath), { recursive: true });
  const payload = entries.map((e) => JSON.stringify(e) + "\n").join("");
  appendFileSync(sidecarPath, payload);
}

/** Convenience single-entry append. */
export function appendEntry(sidecarPath: string, entry: Entry): void {
  appendEntries(sidecarPath, [entry]);
}

/** Count of threads awaiting the agent — for file-tree badges. */
export function countOpenThreads(sidecarPath: string, user: string): number {
  return openThreadsAwaitingAgent(readSidecar(sidecarPath), user).length;
}

/**
 * Remove the sidecar if it has zero surviving threads (all tombstoned).
 * Resolved-only files are KEPT (resolved != gone). Returns true if removed.
 *
 * `user` is threaded through only because deriveThreads requires it; survival
 * doesn't depend on the user name.
 */
export function pruneIfEmpty(sidecarPath: string, user: string): boolean {
  if (!existsSync(sidecarPath)) return false;
  if (deriveThreads(readSidecar(sidecarPath), user).length > 0) return false;
  unlinkSync(sidecarPath);
  return true;
}

// --------------------------------------------------------------------------
// Building + validating entries
// --------------------------------------------------------------------------

/** ISO-8601 timestamp for a new entry. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A fresh 12-hex-char entry id. */
export function newId(): string {
  return randomBytes(6).toString("hex");
}

function validateSuggestion(value: unknown, entryIndex: number): Suggestion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`entry ${entryIndex}: suggestion must be an object`);
  }
  const suggestion = value as Record<string, unknown>;
  const targetValue = suggestion.target;
  if (typeof targetValue !== "object" || targetValue === null || Array.isArray(targetValue)) {
    throw new ValidationError(`entry ${entryIndex}: suggestion.target must be an object`);
  }
  const target = targetValue as Record<string, unknown>;
  if (typeof target.quote !== "string" || !target.quote) {
    throw new ValidationError(`entry ${entryIndex}: suggestion.target.quote must be non-empty string`);
  }
  const contextValue = target.context;
  if (typeof contextValue !== "object" || contextValue === null || Array.isArray(contextValue)) {
    throw new ValidationError(`entry ${entryIndex}: suggestion.target.context must be an object`);
  }
  const context = contextValue as Record<string, unknown>;
  for (const key of ["before", "after"] as const) {
    if (!(key in context) || typeof context[key] !== "string") {
      throw new ValidationError(
        `entry ${entryIndex}: suggestion.target.context.${key} must be a string`,
      );
    }
  }
  if (typeof suggestion.replacement !== "string") {
    throw new ValidationError(`entry ${entryIndex}: suggestion.replacement must be a string`);
  }
  return {
    target: {
      quote: target.quote,
      context: { before: context.before as string, after: context.after as string },
    },
    replacement: suggestion.replacement,
  };
}

/**
 * Validate a batch and return prepared entries (with id/file/author/timestamp
 * filled), ready to append. Throws ValidationError on the first bad entry.
 *
 * `existing` is the current sidecar contents (for id/thread lookups);
 * `fileName` is the .md's name (recorded on each entry); `author` is the
 * writer.
 */
export function buildEntries(
  batch: unknown,
  existing: Entry[],
  fileName: string,
  author: string,
): Entry[] {
  if (!Array.isArray(batch)) {
    throw new ValidationError("batch must be a JSON array");
  }
  if (batch.length === 0) {
    throw new ValidationError("batch is empty — nothing to append");
  }

  const existingIds = new Set(existing.map((e) => e.id));
  const commentIds = new Set(
    existing.filter((e) => !(e.type !== undefined && EVENT_TYPES.has(e.type))).map((e) => e.id),
  );
  const topLevelById = new Map<string, Entry>();
  for (const e of existing) {
    if (!(e.type !== undefined && EVENT_TYPES.has(e.type)) && (e.parent_id ?? null) === null) {
      topLevelById.set(e.id, e);
    }
  }

  const prepared: Entry[] = [];
  for (let i = 0; i < batch.length; i++) {
    const e = batch[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new ValidationError(`entry ${i}: must be an object`);
    }
    const entry = e as Record<string, unknown>;
    const etype = entry.type;

    if (etype !== undefined && etype !== null && "suggestion" in entry) {
      throw new ValidationError(`entry ${i}: suggestion is only valid on a comment or reply`);
    }

    if (etype === "resolved" || etype === "unresolved" || etype === "acknowledged") {
      const threadId = entry.thread_id;
      if (typeof threadId !== "string" || !threadId) {
        throw new ValidationError(`entry ${i}: ${etype} must have a non-empty thread_id`);
      }
      const top = topLevelById.get(threadId);
      if (!top) {
        throw new ValidationError(
          `entry ${i}: thread_id '${threadId}' is not a top-level comment in sidecar`,
        );
      }
      const event: Entry = {
        id: newId(),
        file: fileName,
        type: etype,
        thread_id: threadId,
        author,
        timestamp: nowIso(),
      };
      if (etype === "resolved") {
        const anchor = top.anchor ?? ({} as Anchor);
        event.anchor_snapshot = {
          quote: anchor.quote ?? "",
          line: anchor.line ?? null,
        };
      }
      prepared.push(event);
      continue;
    }

    if (etype === "edit" || etype === "deleted") {
      const commentId = entry.comment_id;
      if (typeof commentId !== "string" || !commentId) {
        throw new ValidationError(`entry ${i}: ${etype} must have a non-empty comment_id`);
      }
      if (!commentIds.has(commentId)) {
        throw new ValidationError(
          `entry ${i}: comment_id '${commentId}' is not a comment or reply in sidecar`,
        );
      }
      const event: Entry = {
        id: newId(),
        file: fileName,
        type: etype,
        comment_id: commentId,
        author,
        timestamp: nowIso(),
      };
      if (etype === "edit") {
        const ebody = entry.body ?? "";
        if (typeof ebody !== "string" || !ebody.trim()) {
          throw new ValidationError(`entry ${i}: edit must have a non-empty body`);
        }
        event.body = ebody;
      }
      prepared.push(event);
      continue;
    }

    if (etype !== undefined && etype !== null) {
      throw new ValidationError(`entry ${i}: unknown type '${String(etype)}'`);
    }

    // Comment or reply.
    const body = entry.body ?? "";
    if (typeof body !== "string" || !body.trim()) {
      throw new ValidationError(`entry ${i}: body must be a non-empty string`);
    }
    const parentId = (entry.parent_id ?? null) as string | null;
    const anchor = (entry.anchor ?? null) as Anchor | null;
    const suggestion = "suggestion" in entry ? validateSuggestion(entry.suggestion, i) : undefined;
    if (parentId === null && anchor === null) {
      throw new ValidationError(
        `entry ${i}: must have either parent_id (reply) or anchor (top-level)`,
      );
    }
    if (parentId !== null && anchor !== null) {
      throw new ValidationError(`entry ${i}: cannot have both parent_id and anchor`);
    }
    if (parentId !== null) {
      if (!existingIds.has(parentId)) {
        throw new ValidationError(`entry ${i}: parent_id '${parentId}' not found in sidecar`);
      }
    } else {
      if (typeof anchor !== "object" || anchor === null || Array.isArray(anchor)) {
        throw new ValidationError(`entry ${i}: anchor must be an object`);
      }
      if (!("quote" in anchor)) {
        throw new ValidationError(`entry ${i}: anchor missing key 'quote'`);
      }
      if (typeof anchor.quote !== "string" || !anchor.quote) {
        throw new ValidationError(`entry ${i}: anchor.quote must be non-empty string`);
      }
      const ctx = anchor.context ?? null;
      if (ctx !== null) {
        if (typeof ctx !== "object" || Array.isArray(ctx)) {
          throw new ValidationError(`entry ${i}: anchor.context must be an object`);
        }
        for (const k of ["before", "after"] as const) {
          if (k in ctx && typeof ctx[k] !== "string") {
            throw new ValidationError(`entry ${i}: anchor.context.${k} must be a string`);
          }
        }
      }
    }

    const content: Entry = {
      id: newId(),
      file: fileName,
      anchor,
      parent_id: parentId,
      author,
      body,
      timestamp: nowIso(),
    };
    if (suggestion !== undefined) content.suggestion = suggestion;
    prepared.push(content);
  }

  return prepared;
}
