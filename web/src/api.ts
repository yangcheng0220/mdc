/**
 * Thin client for the backend API. Every call returns parsed JSON or throws;
 * callers handle the error shape. Paths are root-relative (the same keys the
 * index returns).
 */

import type { Entry } from "../../src/threads.js";

interface IndexEntry {
  path: string;
  openThreadCount: number;
}
export interface IndexResponse {
  root: string;
  /** The configured user name — drives user-vs-agent role styling. */
  user: string;
  /** The version of the mdc server serving this frontend. */
  mdcVersion: string;
  files: IndexEntry[];
  /** Every directory under root, so the tree can render folders with no .md yet. */
  dirs: string[];
  /** Image files under root — openable (tree, tabs, jump) but not commentable,
   *  so kept separate from `files` which drives comment/anchor resolution. */
  images: string[];
  /** HTML files under root — openable (rendered in a sandboxed iframe) but not
   *  commentable; same separate-channel reasoning as `images`. */
  htmls: string[];
  /** PDF files under root — openable through the browser's native PDF viewer,
   *  but not commentable; same separate-channel reasoning as `images`. */
  pdfs: string[];
  /** Excalidraw scenes under root — openable and interactive, but not commentable. */
  drawings: string[];
}

export interface DocResponse {
  content: string;
  filename: string;
  path: string;
  /** Content hash for conflict-safe writes — pass back as saveDoc's baseVersion. */
  version: string;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return (await r.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The file index (nav + open-thread counts). */
export function fetchIndex(): Promise<IndexResponse> {
  return getJson<IndexResponse>("/api/index");
}

/** A document's raw markdown content. */
export function fetchDoc(file: string): Promise<DocResponse> {
  return getJson<DocResponse>(`/api/md?file=${encodeURIComponent(file)}`);
}

/** Raw Excalidraw scene JSON for a standalone drawing surface. */
export function fetchDrawing(file: string): Promise<DocResponse> {
  return getJson<DocResponse>(`/api/drawing?file=${encodeURIComponent(file)}`);
}

/** Persist an Excalidraw scene without overwriting a newer disk version. */
export async function saveDrawing(
  file: string,
  content: string,
  baseVersion: string,
): Promise<string> {
  const r = await fetch(`/api/drawing?file=${encodeURIComponent(file)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, baseVersion }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return ((await r.json()) as { version: string }).version;
}

/** Image URL with an optional cache-buster for standalone image surfaces. */
export function imageFileViewUrl(path: string, nonce = 0): string {
  const params = new URLSearchParams({ path });
  if (nonce > 0) params.set("v", String(nonce));
  return `/api/image-file?${params.toString()}`;
}

/** Raw HTML text of an .html file (for the sandboxed iframe's srcdoc). */
export async function fetchHtmlFile(path: string): Promise<string> {
  const r = await fetch(`/api/html-file?path=${encodeURIComponent(path)}`);
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return r.text();
}

/** Backend URL that serves a PDF file by its own root-relative path. */
export function pdfFileUrl(path: string, nonce = 0): string {
  const params = new URLSearchParams({ path });
  if (nonce > 0) params.set("v", String(nonce));
  return `/api/pdf-file?${params.toString()}`;
}

// --- Trusted apps ----------------------------------------------------------

export interface AppInfo {
  appPath: string;
  rootName: string;
  permissions: { read: string[]; write: string[] };
  name: string | null;
  trusted: boolean;
}

/** An HTML file's app manifest + current trust state (drives the trust prompt). */
export function fetchAppInfo(app: string): Promise<AppInfo> {
  return getJson<AppInfo>(`/api/app/info?app=${encodeURIComponent(app)}`);
}

/** Trust an app to run with file access (persists its content hash). */
export async function trustApp(
  app: string,
): Promise<{ trusted: true; permissions: { read: string[]; write: string[] } }> {
  const r = await fetch("/api/app/trust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return (await r.json()) as { trusted: true; permissions: { read: string[]; write: string[] } };
}

/** Overwrite a document's content on disk. With `baseVersion` the write is
 *  conflict-safe: it throws an ApiError with status 409 (and writes nothing)
 *  if the file changed since that version was read. Without it, blind write.
 *  Returns the saved content's version — the baseVersion for the next save. */
export async function saveDoc(file: string, content: string, baseVersion?: string): Promise<string> {
  const r = await fetch(`/api/md?file=${encodeURIComponent(file)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(baseVersion === undefined ? { content } : { content, baseVersion }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return ((await r.json()) as { version: string }).version;
}

export interface AnchorContext {
  before: string;
  after: string;
}
export interface NewAnchor {
  quote: string;
  line?: number | null;
  context?: AnchorContext;
}

/** Create a top-level comment (with anchor) or a reply (with parent_id). */
export async function postComment(
  file: string,
  payload: {
    author: string;
    body: string;
    anchor?: NewAnchor | null;
    parent_id?: string | null;
  },
): Promise<void> {
  const r = await fetch(`/api/comments?file=${encodeURIComponent(file)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

async function post(path: string, file: string, body: unknown): Promise<void> {
  const r = await fetch(`${path}?file=${encodeURIComponent(file)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

/** Resolve a thread, optionally recording an applied suggestion. */
export function postResolve(
  file: string,
  threadId: string,
  author: string,
  resolution?: "applied",
  suggestionId?: string,
): Promise<void> {
  return post("/api/comments/resolve", file, {
    thread_id: threadId,
    author,
    ...(resolution === undefined ? {} : { resolution }),
    ...(suggestionId === undefined ? {} : { suggestion_id: suggestionId }),
  });
}

/** Decide a suggestion as dismissed while leaving its conversation open. */
export function postDismissSuggestion(
  file: string,
  threadId: string,
  suggestionId: string,
  author: string,
): Promise<void> {
  return post("/api/comments/resolve", file, {
    thread_id: threadId,
    author,
    resolution: "dismissed",
    suggestion_id: suggestionId,
  });
}

export interface ApplySuggestionResponse {
  content: string;
  version: string;
  entry: Entry;
}

/** Apply a suggestion to the file and resolve its thread in one server action. */
export async function postApplySuggestion(
  file: string,
  threadId: string,
  suggestionId: string,
  author: string,
): Promise<ApplySuggestionResponse> {
  const r = await fetch(`/api/suggestions/apply?file=${encodeURIComponent(file)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId, suggestion_id: suggestionId, author }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return (await r.json()) as ApplySuggestionResponse;
}

/** Mark orphaned threads resolved as a system action. */
export function postResolveOrphans(file: string, threadIds: string[]): Promise<void> {
  return post("/api/comments/resolve-system", file, { thread_ids: threadIds });
}

/** Reopen a resolved thread. */
export function postUnresolve(file: string, threadId: string, author: string): Promise<void> {
  return post("/api/comments/unresolve", file, { thread_id: threadId, author });
}

/** Edit a comment or reply body. */
export function postEdit(
  file: string,
  commentId: string,
  body: string,
  author: string,
): Promise<void> {
  return post("/api/comments/edit", file, { comment_id: commentId, body, author });
}

/** Delete a comment or reply. */
export function postDelete(file: string, commentId: string, author: string): Promise<void> {
  return post("/api/comments/delete", file, { comment_id: commentId, author });
}

// --- File tree mutation ---------------------------------------------------

/** Create an empty doc at a root-relative path (must end in .md). */
export async function createFile(path: string): Promise<void> {
  const r = await fetch("/api/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

/** Create a folder at a root-relative path. */
export async function createFolder(path: string): Promise<void> {
  const r = await fetch("/api/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

/** Delete a doc and its sidecar together. */
export async function deleteFile(path: string): Promise<void> {
  const r = await fetch(`/api/file?file=${encodeURIComponent(path)}`, { method: "DELETE" });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

/** Recursively delete a folder and everything under it. */
export async function deleteFolder(path: string): Promise<void> {
  const r = await fetch(`/api/folder?folder=${encodeURIComponent(path)}`, { method: "DELETE" });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

export interface FolderSummary {
  docs: number;
  withComments: number;
}

/** Pre-flight counts for a folder-delete confirm: docs under it, how many carry comments. */
export function fetchFolderSummary(path: string): Promise<FolderSummary> {
  return getJson<FolderSummary>(`/api/folder/summary?folder=${encodeURIComponent(path)}`);
}

export interface MovePreview {
  from: string;
  to: string;
  docsToMove: number;
  sidecarsToRelocate: number;
  docsToRewrite: number;
  linksToRewrite: number;
  collisions: string[];
}

/** Pre-flight blast radius for a move: docs/sidecars relocated, links rewritten, collisions. */
export function fetchMovePreview(from: string, to: string): Promise<MovePreview> {
  return getJson<MovePreview>(
    `/api/move/preview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export interface MoveResult {
  moved: { from: string; to: string };
  docsMoved: number;
  sidecarsRelocated: number;
  docsRewritten: number;
  linksRewritten: number;
}

/** Relocate a doc or folder; relocates sidecars and rewrites broken references. */
export async function moveFile(from: string, to: string): Promise<MoveResult> {
  const r = await fetch("/api/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return (await r.json()) as MoveResult;
}

// --- Dashboard ------------------------------------------------------------

import type { Thread } from "../../src/threads.js";

export interface DashFile {
  path: string;
  open: number;
  resolved: number;
  /** The source .md was deleted; the sidecar's comments are stranded. */
  orphaned: boolean;
  threads: Thread[];
}
export interface DashboardResponse {
  root: string;
  total_open: number;
  total_resolved: number;
  files: DashFile[];
}

/** Every open/resolved thread across all docs (the cross-doc review inbox). */
export function fetchDashboard(): Promise<DashboardResponse> {
  return getJson<DashboardResponse>("/api/dashboard");
}

/** Delete a whole thread (parent + replies) in an arbitrary file. */
export function deleteThreadInFile(
  file: string,
  threadId: string,
  author: string,
): Promise<void> {
  return post("/api/comments/delete-thread", file, { thread_id: threadId, author });
}

/** Permanently delete a doc's entire sidecar (.comments.jsonl). */
export async function deleteSidecar(file: string): Promise<void> {
  const r = await fetch(`/api/sidecar?file=${encodeURIComponent(file)}`, { method: "DELETE" });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
}

// --- Handoff --------------------------------------------------------------

export interface ActiveSession {
  sessionId: string;
  file: string;
  /** Whether an agent is actually connected to the session's event stream. */
  watching: boolean;
}

/** Current handoff session (an agent listening on some file), or null. */
export function fetchActiveSession(): Promise<ActiveSession | null> {
  return getJson<{ active: ActiveSession | null }>("/api/handoff/sessions").then((r) => r.active);
}

/**
 * Fire the handoff signal for a session. `intent` is `mdc-review` for a normal
 * hand off (the agent reviews) or `done` to end the session (its watch exits).
 * Returns whether an agent was actually connected to receive it.
 */
export async function postHandoffDone(sessionId: string, intent: string): Promise<boolean> {
  const r = await fetch("/api/handoff/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, intent }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(r.status, detail || r.statusText);
  }
  return ((await r.json()) as { delivered?: boolean }).delivered ?? false;
}
