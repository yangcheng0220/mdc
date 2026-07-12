#!/usr/bin/env node
/**
 * mdc CLI — the human/script interface to the sidecar.
 *
 * Each subcommand maps to one core operation. Everything goes through the core
 * modules (sidecar/identity/handoff) — the CLI adds no logic of its own, it
 * just parses args and shapes output. Output is JSON wherever an agent or
 * script consumes it (list-pending, get-thread, watch), and plain text for
 * human-facing status.
 */

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  allIndexesOf,
  captureContext,
  findAnchorMatch,
  lineOfOffset,
  stripMdMapped,
} from "./anchor.js";
import { VERSION } from "./index.js";
import { basename, dirname, join, relative, resolve as resolvePath, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { waitForSignal } from "./handoff.js";
import { currentUser, currentUserWithSource, homeConfigPath, type IdentityEnv } from "./identity.js";
import { serverAlive, serverIndex, pendingFor, probeServer, serverTabConnected } from "./server-client.js";
import {
  actionableSuggestion,
  ValidationError,
  appendEntries,
  buildEntries,
  deletedCommentIds,
  decidedSuggestions,
  latestBodyByComment,
  openThreadsAwaitingAgent,
  readSidecar,
  sidecarPathFor,
  survivingRepliesByParent,
  topLevelComments,
  type Anchor,
  type Entry,
  type Suggestion,
} from "./sidecar.js";

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_PORT = 8000;

/** A command failed with a clean user-facing message. */
class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * (mdPath, sidecarPath, existing entries) for a file arg. The .md need not
 * exist (an orphaned sidecar is still operable); the sidecar may be empty.
 */
function resolveFile(fileArg: string): { mdPath: string; scPath: string; entries: Entry[] } {
  const mdPath = resolvePath(fileArg);
  const scPath = sidecarPathFor(mdPath);
  return { mdPath, scPath, entries: readSidecar(scPath) };
}

/**
 * Validate + append a batch via the core. Returns prepared entries. Throws a
 * CliError with a clean message on validation failure.
 */
function write(
  scPath: string,
  batch: unknown[],
  existing: Entry[],
  fileName: string,
  author: string,
): Entry[] {
  let prepared: Entry[];
  try {
    prepared = buildEntries(batch, existing, fileName, author);
  } catch (e) {
    if (e instanceof ValidationError) throw new CliError(e.message);
    throw e;
  }
  appendEntries(scPath, prepared);
  return prepared;
}

/**
 * Full arc (parent + surviving replies, folded) for one thread, or null if the
 * thread doesn't survive. Uses core helpers so no folding is duplicated.
 */
function threadArc(entries: Entry[], threadId: string): Record<string, unknown> | null {
  const deleted = deletedCommentIds(entries);
  const edited = latestBodyByComment(entries);
  const tops = new Map(topLevelComments(entries).map((t) => [t.id, t]));
  const top = tops.get(threadId);
  if (!top) return null;
  const byParent = survivingRepliesByParent(entries, deleted);
  const replies = [...(byParent.get(threadId) ?? [])].sort((a, b) =>
    (a.timestamp ?? "") < (b.timestamp ?? "") ? -1 : (a.timestamp ?? "") > (b.timestamp ?? "") ? 1 : 0,
  );
  if (deleted.has(threadId) && replies.length === 0) {
    return null; // parent deleted, no replies — thread gone
  }
  // Effective body: a tombstoned comment reads "[deleted]"; otherwise the latest
  // edit wins, falling back to the original body.
  const bodyOf = (e: Entry): string =>
    deleted.has(e.id) ? "[deleted]" : edited.get(e.id) ?? e.body ?? "";
  const anchor = (top.anchor ?? {}) as Anchor;
  return {
    thread_id: threadId,
    quote: anchor.quote ?? "",
    line: anchor.line ?? null,
    suggestion_state: threadSuggestionState(entries, threadId),
    entries: [top, ...replies].map((e) => ({
      id: e.id,
      author: e.author ?? null,
      body: bodyOf(e),
      timestamp: e.timestamp ?? null,
      ...(e.suggestion === undefined ? {} : { suggestion: e.suggestion }),
    })),
  };
}

function threadSuggestionState(entries: Entry[], threadId: string): Record<string, unknown> {
  const ids = new Set(
    entries
      .filter(
        (entry) =>
          entry.suggestion !== undefined &&
          (entry.id === threadId || entry.parent_id === threadId),
      )
      .map((entry) => entry.id),
  );
  const decided = Object.fromEntries(
    [...decidedSuggestions(entries)].filter(([suggestionId]) => ids.has(suggestionId)),
  );
  return {
    actionable: actionableSuggestion(entries, threadId)?.id ?? null,
    decided,
  };
}

/**
 * The configured user, resolved relative to the file's location as a root hint
 * (home config still wins; see identity resolution).
 */
function userFor(mdPath: string): string {
  return currentUser(dirname(mdPath));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function resolveServeRoot(root?: string): string {
  return root ?? process.cwd();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdListPending(file: string): number {
  const { mdPath, entries } = resolveFile(file);
  const awaiting = openThreadsAwaitingAgent(entries, userFor(mdPath)).map((thread) => ({
    ...thread,
    suggestion_state: threadSuggestionState(entries, thread.thread_id),
  }));
  printJson({ file: mdPath, pending: awaiting });
  return 0;
}

function cmdGetThread(file: string, threadId: string): number {
  const { entries } = resolveFile(file);
  const arc = threadArc(entries, threadId);
  if (arc === null) {
    console.error(`error: thread '${threadId}' not found or not surviving`);
    return 1;
  }
  printJson(arc);
  return 0;
}

interface CommentOpts {
  quote: string;
  body: string;
  line?: number;
  contextBefore?: string;
  contextAfter?: string;
  suggest?: string;
  target?: string;
  author: string;
}

interface ReplyOpts {
  body: string;
  suggest?: string;
  target?: string;
  author: string;
}

function buildSuggestion(
  mdPath: string,
  replacement: string | undefined,
  target: string | undefined,
): Suggestion | undefined {
  if (replacement === undefined) {
    if (target !== undefined) throw new CliError("--target requires --suggest");
    return undefined;
  }
  if (target === undefined) throw new CliError("--target is required with --suggest");

  let full: string;
  try {
    full = readFileSync(mdPath, "utf8");
  } catch {
    throw new CliError(`could not read suggestion target from '${mdPath}'`);
  }
  const occurrences = allIndexesOf(full, target);
  if (occurrences.length !== 1) {
    throw new CliError(
      "suggestion target must occur exactly once in the document; pass a longer target",
    );
  }
  const captured = captureContext(full, occurrences[0]!, target);
  return {
    target: {
      quote: target,
      context: {
        before: captured?.before ?? "",
        after: captured?.after ?? "",
      },
    },
    replacement,
  };
}

function cmdComment(file: string, opts: CommentOpts): number {
  const { mdPath, scPath, entries } = resolveFile(file);
  const anchor: Anchor = { quote: opts.quote };
  if (opts.line !== undefined) anchor.line = opts.line;
  if (opts.contextBefore !== undefined || opts.contextAfter !== undefined) {
    // Anti-drift fingerprint: pins the right occurrence of a repeated quote
    // (before + quote + after must be unique) so the anchor orphans rather
    // than silently drifting when that copy is edited away.
    anchor.context = { before: opts.contextBefore ?? "", after: opts.contextAfter ?? "" };
  }
  if (
    opts.suggest !== undefined &&
    opts.target === undefined &&
    stripMdMapped(opts.quote).text !== opts.quote
  ) {
    console.warn(
      "warning: --quote contains Markdown syntax; use rendered text for --quote and exact raw Markdown for --target, or the margin anchor may orphan",
    );
  }
  const suggestion = buildSuggestion(
    mdPath,
    opts.suggest,
    opts.target ?? (opts.suggest === undefined ? undefined : opts.quote),
  );
  const prepared = write(
    scPath,
    [{ anchor, body: opts.body, ...(suggestion === undefined ? {} : { suggestion }) }],
    entries,
    basename(mdPath),
    opts.author,
  );
  console.log(`commented: ${prepared[0]!.id}`);
  return 0;
}

function cmdReply(file: string, parentId: string, opts: ReplyOpts): number {
  const { mdPath, scPath, entries } = resolveFile(file);
  const suggestion = buildSuggestion(mdPath, opts.suggest, opts.target);
  const prepared = write(
    scPath,
    [{ parent_id: parentId, body: opts.body, ...(suggestion === undefined ? {} : { suggestion }) }],
    entries,
    basename(mdPath),
    opts.author,
  );
  console.log(`replied: ${prepared[0]!.id}`);
  return 0;
}

function cmdThreadEvent(file: string, threadId: string, etype: string, author: string): number {
  const { mdPath, scPath, entries } = resolveFile(file);
  const prepared = write(
    scPath,
    [{ type: etype, thread_id: threadId }],
    entries,
    basename(mdPath),
    author,
  );
  console.log(`${etype}: thread ${threadId} (${prepared[0]!.id})`);
  return 0;
}

function cmdEdit(file: string, commentId: string, body: string, author: string): number {
  const { mdPath, scPath, entries } = resolveFile(file);
  const prepared = write(
    scPath,
    [{ type: "edit", comment_id: commentId, body }],
    entries,
    basename(mdPath),
    author,
  );
  console.log(`edited: ${commentId} (${prepared[0]!.id})`);
  return 0;
}

function cmdDelete(file: string, commentId: string, author: string): number {
  const { mdPath, scPath, entries } = resolveFile(file);
  const prepared = write(
    scPath,
    [{ type: "deleted", comment_id: commentId }],
    entries,
    basename(mdPath),
    author,
  );
  console.log(`deleted: ${commentId} (${prepared[0]!.id})`);
  return 0;
}

/**
 * Resolve where a thread's anchor lives in the .md right now — without a
 * browser. Prints {thread_id, quote, found, ...} as JSON; an unfound anchor is
 * an orphan (found: false), exit 0 either way (orphaned is an answer, not an
 * error).
 */
function cmdLocate(file: string, threadId: string): number {
  const { mdPath, entries } = resolveFile(file);
  const tops = new Map(topLevelComments(entries).map((t) => [t.id, t]));
  const top = tops.get(threadId);
  if (!top) {
    console.error(`error: thread '${threadId}' not found`);
    return 1;
  }
  let text: string;
  try {
    text = readFileSync(mdPath, "utf8");
  } catch {
    console.error(`error: cannot read ${mdPath}`);
    return 1;
  }
  const anchor = (top.anchor ?? { quote: "" }) as Anchor;
  const match = findAnchorMatch(anchor, text);
  const result: Record<string, unknown> = {
    thread_id: threadId,
    quote: anchor.quote ?? "",
    found: match !== null,
  };
  if (match) {
    result.start = match.startIdx;
    result.length = match.length;
    result.line = lineOfOffset(text, match.startIdx);
    result.recovered = match.recovered;
  }
  printJson(result);
  return 0;
}

function readWritableHomeConfig(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    throw new CliError(`could not parse ${path}`);
  }
}

function cmdIdentity(nameArg?: string, deps: IdentityEnv = {}): number {
  if (nameArg === undefined) {
    const identity = currentUserWithSource(process.cwd(), deps);
    console.log(`identity: ${identity.name} (source: ${identity.source})`);
    return 0;
  }

  const name = nameArg.trim();
  if (!name) throw new CliError("identity name must not be empty");

  const path = homeConfigPath(deps);
  const config = readWritableHomeConfig(path);
  config.user = name;
  writeFileSync(path, stringifyToml(config), "utf8");
  console.log(`identity: ${name} (saved to ${path})`);
  return 0;
}

async function cmdCheck(baseUrl: string): Promise<number> {
  const alive = await serverAlive(baseUrl);
  console.log(alive ? "alive" : "down");
  return alive ? 0 : 1;
}

/** Spawn the OS's default URL opener (browser) for `url`. */
async function openInBrowser(url: string): Promise<void> {
  const opener =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  await new Promise<void>((res, rej) => {
    const p = spawn(opener[0]!, opener.slice(1), { stdio: "ignore" });
    p.on("error", rej);
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
  });
}

/**
 * Resolve an absolute .md path to the path the server knows it by — relative to
 * the served root. Returns null with a reason printed to stderr when
 * the server is unreachable (`down`) or the file is outside its root
 * (`unreachable`), so the caller can map those to exit codes.
 */
async function relForServer(
  file: string,
  baseUrl: string,
): Promise<{ rel: string } | { error: "down" | "unreachable" }> {
  const index = await serverIndex(baseUrl);
  if (index === null) {
    console.error("down");
    return { error: "down" };
  }
  const root = resolvePath(String(index.root ?? ""));
  const target = resolvePath(file);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    console.error(`unreachable: ${target} is outside the served root ${root}`);
    return { error: "unreachable" };
  }
  return { rel };
}

/**
 * Block until the user signals (Handoff / End session), then return the typed
 * intent + the threads pending for the agent. The turn-taking primitive.
 *
 * `file` is an absolute path; it's resolved to the root-relative path the
 * handoff session and pending lookup use.
 *
 * Server-down fallback: if the server isn't reachable there is no live signal
 * to wait on. Rather than hang, return {intent: "server-down"} so the agent
 * knows to review the sidecar file directly (it's just a file — no server
 * needed to read).
 */
async function cmdWatch(file: string, baseUrl: string, timeoutSec?: number): Promise<number> {
  // Every exit prints a {intent, file, pending} JSON object so a caller can act
  // on one consistent shape — no stderr/exit-code parsing for the non-happy
  // paths.
  if (!(await serverAlive(baseUrl))) {
    printJson({
      intent: "server-down",
      file,
      pending: [],
      note:
        "mdc server not reachable — review the sidecar directly " +
        "(mdc list-pending / get-thread work without the server)",
    });
    return 0;
  }

  const resolved = await relForServer(file, baseUrl);
  if ("error" in resolved) {
    if (resolved.error === "down") {
      // Server vanished between the alive check and resolving the file.
      printJson({
        intent: "server-down",
        file,
        pending: [],
        note: "mdc server not reachable — review the sidecar directly",
      });
      return 0;
    }
    // File is outside the served root — nothing to watch here.
    printJson({
      intent: "unreachable",
      file,
      pending: [],
      note: "file is outside the served root — serve a root that covers it",
    });
    return 0;
  }
  const rel = resolved.rel;

  const intent = await waitForSignal(rel, baseUrl, timeoutSec ? timeoutSec * 1000 : undefined);
  if (intent === null) {
    printJson({ intent: "error", file, pending: [], note: "handoff wait failed" });
    return 1;
  }
  if (intent === "timeout") {
    printJson({
      intent: "timeout",
      file,
      pending: [],
      note: `no signal within ${timeoutSec}s — re-run watch to keep waiting`,
    });
    return 0;
  }

  // Attach the pending batch (only meaningful for a review intent, but
  // harmless to compute for done).
  const pending = await pendingFor(rel, baseUrl);
  printJson({ intent, file, pending });
  return 0;
}

/**
 * Open a .md in the running server. Mechanics only — it does NOT start the
 * server or decide review intent. Reports `down` if no server is running, or `unreachable`
 * if the file is outside the served root, so the caller can decide what to do.
 *
 * Prefers switching the file IN the open browser tab (POST /api/open → the app
 * adds/focuses it as a tab) so repeated opens don't pile up browser tabs. Falls
 * back to spawning a browser tab only when no browser tab is listening (e.g. the
 * server was just started and no browser tab is connected yet).
 */
async function cmdOpen(file: string, baseUrl: string): Promise<number> {
  const resolved = await relForServer(file, baseUrl);
  if ("error" in resolved) return resolved.error === "down" ? 1 : 2;

  // Try the in-tab switch first.
  try {
    const r = await fetch(`${baseUrl}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: resolved.rel }),
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      console.log(`opened: ${resolved.rel}`);
      return 0;
    }
    // 409 = no browser tab connected yet → fall through to spawn one.
    // Other non-OK (e.g. 404 unknown file) shouldn't happen post-relForServer.
  } catch {
    // network hiccup — fall through to the browser-spawn fallback
  }

  // Fallback: open a browser tab pointed at the file.
  const url = `${baseUrl}/?file=${encodeURIComponent(resolved.rel)}`;
  try {
    await openInBrowser(url);
  } catch (e) {
    console.error(`error: could not open browser: ${String(e)}`);
    return 1;
  }
  console.log(`opened: ${resolved.rel}`);
  return 0;
}

const execFileAsync = promisify(execFile);

/**
 * Stop whatever process is listening on `port` by terminating it, then wait for
 * the port to free. Returns true once nothing answers there. Used by `serve
 * --force` to switch the server to a different root. macOS/Linux (lsof).
 */
async function stopServerOnPort(port: number, baseUrl: string): Promise<boolean> {
  let pids: number[] = [];
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`]);
    pids = stdout
      .split(/\s+/)
      .map((s) => Number(s.trim()))
      // Only real, other-process PIDs. Guard against 0/NaN/negatives (a bad
      // parse) and our own PID — process.kill(0) or a negative would signal the
      // whole process group and take this command down with it.
      .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
  } catch {
    // lsof exits non-zero when nothing is listening — nothing to stop.
    pids = [];
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone / not ours to kill — fall through to the readiness wait
    }
  }
  // Wait for the port to actually free (probe says nothing's there).
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await probeServer(baseUrl)).kind === "free") return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return (await probeServer(baseUrl)).kind === "free";
}

/**
 * Stop the server on a port. Probe-guarded: only stops an actual mdc server
 * — if something foreign holds the port, refuse rather than kill a stranger's
 * process; if nothing is listening, it's already stopped (a no-op success). So
 * the command is safe to run blindly, however many times.
 */
async function cmdStop(port: number): Promise<number> {
  const baseUrl = `http://localhost:${port}`;
  const probe = await probeServer(baseUrl);
  if (probe.kind === "free") {
    console.log(`nothing to stop on port ${port}`);
    return 0;
  }
  if (probe.kind === "foreign") {
    console.error(
      `error: port ${port} is held by something that isn't an mdc server — ` +
        `refusing to stop it`,
    );
    return 1;
  }
  if (await stopServerOnPort(port, baseUrl)) {
    console.log(`stopped the mdc server on port ${port}`);
    return 0;
  }
  console.error(`error: could not free port ${port} — the mdc server is still running`);
  return 1;
}

/**
 * Serve on a root, then open the browser to it. Idempotent on the
 * port: if a server already serves the same root, adopt it (just open the
 * browser, don't start a second one). If it serves a DIFFERENT root, refuse —
 * opening the wrong root would mislead — and point at `--force` to switch. With
 * `--force`, stop the running server first, then serve the requested root. With
 * `--restart`, stop any mdc server on the port first (even same-root) and start a
 * fresh process — so a rebuilt backend is actually picked up, where a same-root
 * adopt would keep the stale one. A
 * non-mdc process on the port is always a hard conflict.
 *
 * When the port is free, start the server in the background by default — the
 * command returns once the server answers, leaving it running detached so the
 * caller isn't blocked. `--foreground` instead runs the server in this process
 * and blocks until interrupted (for watching logs / Ctrl-C).
 */
async function cmdServe(
  root: string,
  opts: {
    port: number;
    deny: string;
    staticDir?: string;
    open: boolean;
    force: boolean;
    restart: boolean;
    foreground: boolean;
  },
): Promise<number> {
  const baseUrl = `http://localhost:${opts.port}`;
  const wantRoot = resolvePath(root);
  // True when we --force-stopped a server to take its port. The old server's
  // browser tab is still open and reconnects to the new server on its own, so
  // we must NOT open a second browser tab in that case.
  let switched = false;

  const probe = await probeServer(baseUrl);
  if (probe.kind === "foreign") {
    console.error(
      `error: port ${opts.port} is in use by something that isn't an mdc ` +
        `server — stop it or choose another --port`,
    );
    return 1;
  }
  if (probe.kind === "mdc") {
    const sameRoot = resolvePath(probe.root) === wantRoot;
    if (opts.restart) {
      // --restart: stop whatever's running (same root or not) and start fresh,
      // so a rebuilt frontend/backend is actually picked up — a same-root adopt
      // would keep the stale process. The old server's tab reconnects on its own.
      console.log(`restarting the mdc server on ${baseUrl}`);
      if (!(await stopServerOnPort(opts.port, baseUrl))) {
        console.error(
          `error: could not free port ${opts.port} — the existing mdc server is ` +
            `still running`,
        );
        return 1;
      }
      switched = true;
    } else if (sameRoot) {
      // Already serving what was asked — adopt it. Only open a browser tab if
      // none is connected; if a tab is already live, opening another would just
      // pile up duplicates (it would already show this server).
      console.log(`already running: ${probe.root} on ${baseUrl}`);
      if (opts.open && !(await serverTabConnected(baseUrl))) {
        await openInBrowser(baseUrl).catch(() => {});
      }
      return 0;
    } else if (!opts.force) {
      // Different root: don't open the wrong one — name the fix and stop.
      console.error(
        `error: an mdc server is already running on ${baseUrl}, serving ` +
          `${probe.root} — not ${wantRoot}. Re-run with --force to stop it and ` +
          `serve ${wantRoot} instead.`,
      );
      return 1;
    } else {
      // --force: stop the running server, then fall through to start the new root.
      console.log(`stopping the mdc server on ${probe.root} to switch to ${wantRoot}`);
      if (!(await stopServerOnPort(opts.port, baseUrl))) {
        console.error(
          `error: could not free port ${opts.port} — the existing mdc server is ` +
            `still running`,
        );
        return 1;
      }
      switched = true;
    }
  }

  // Port is free (or just freed by --force) — start the server.
  if (opts.foreground) {
    // Run the server in THIS process and block until interrupted.
    const { startServer } = await import("./server/serve.js");
    await startServer(root, {
      port: opts.port,
      deny: opts.deny,
      staticDir: opts.staticDir,
    });
    // Skip on a --force switch: the prior server's tab reconnects to this one.
    if (opts.open && !switched) await openInBrowser(baseUrl).catch(() => {});
    // Keep the process alive; the HTTP server + watcher hold it open, but make
    // intent explicit so commander's action promise doesn't resolve & exit.
    await new Promise<void>(() => {});
    return 0;
  }

  // Default: detach the server into the background so this command returns and
  // the caller stays free. Re-run ourselves with --foreground as a detached
  // child; the server keeps running after this process exits.
  const cliPath = process.argv[1];
  if (!cliPath) {
    console.error("error: cannot locate the mdc executable to background it");
    return 1;
  }
  const childArgs = [cliPath, "serve", root, "--port", String(opts.port), "--foreground", "--no-open"];
  if (opts.deny) childArgs.push("--deny", opts.deny);
  if (opts.staticDir) childArgs.push("--static-dir", opts.staticDir);
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait until it answers, so a failure to start surfaces here instead of
  // silently leaving nothing running.
  const deadline = Date.now() + 10_000;
  let up = false;
  while (Date.now() < deadline) {
    if ((await probeServer(baseUrl)).kind === "mdc") {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!up) {
    console.error(`error: mdc server did not come up on ${baseUrl} within 10s`);
    return 1;
  }
  console.log(`serving ${wantRoot} on ${baseUrl} (pid ${child.pid})`);
  if (currentUserWithSource(wantRoot).source === "default") {
    console.log('tip: comments are attributed as "user" — set your name: mdc identity <name>');
  }
  // Skip on a --force switch: the prior server's tab reconnects to this one.
  if (opts.open && !switched) await openInBrowser(baseUrl).catch(() => {});
  return 0;
}


// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

export function buildProgram(setExit: (code: number) => void): Command {
  const program = new Command();
  program
    .name("mdc")
    .description(
      "mdc — a local markdown workspace for you and your coding agent. Serves a " +
        "folder in the browser: renders markdown, images, PDFs, and HTML; review " +
        "docs together in the margin (threads — including suggested edits the " +
        "human accepts or rejects — stored next to each file in a " +
        ".comments.jsonl sidecar); edit in place; and run trusted HTML files as " +
        "mini apps over your workspace.",
    )
    .version(VERSION)
    .option("--author <name>", "who is writing these entries", "agent")
    .addHelpText(
      "after",
      `
typical review loop:
  mdc check                          # is the mdc server running?
  mdc watch  /abs/doc.md             # block until the user hands off
  mdc list-pending /abs/doc.md       # threads awaiting you (JSON)
  mdc reply  /abs/doc.md <tid> --body "..."
             [--suggest "new text" --target "exact raw text"]   # propose an edit
  mdc watch  /abs/doc.md             # re-arm for the next round
                                     # (resolving and accepting/rejecting
                                     #  suggestions are the human's actions)

new to mdc? \`mdc setup\` prints the agent setup doc — the full loop and
how to wire an agent in. \`file\` is an absolute path for every file command
(watch, list-pending, get-thread, comment, reply, *resolve). thread/parent
ids come from list-pending's output. Run \`mdc <command> -h\` for detail.`,
    );

  const author = (cmd: Command): string => cmd.optsWithGlobals().author as string;

  program
    .command("list-pending")
    .summary("threads awaiting the agent (JSON)")
    .description(
      "List the comment threads on a doc that are awaiting your reply — the " +
        "user spoke last and the thread isn't resolved. Prints {file, pending: " +
        "[thread summaries]} as JSON; each summary carries the thread_id you " +
        "pass to reply/resolve, plus suggestion_state — the actionable " +
        "suggestion id and past applied/dismissed decisions.",
    )
    .argument("<file>", "absolute path to the .md")
    .action(function (this: Command, file: string) {
      setExit(cmdListPending(file));
    });

  program
    .command("get-thread")
    .summary("one thread's full arc (JSON)")
    .description(
      "Print one thread's full arc — parent comment plus surviving replies, " +
        "with edits and deletes already folded in, plus suggestion_state " +
        "(actionable/decided suggestions). Errors if the thread " +
        "doesn't survive (parent deleted, no replies).",
    )
    .argument("<file>", "absolute path to the .md")
    .argument("<thread_id>", "top-level comment id (from list-pending)")
    .action(function (this: Command, file: string, threadId: string) {
      setExit(cmdGetThread(file, threadId));
    });

  program
    .command("comment")
    .summary("add a top-level comment")
    .description(
      "Add a new top-level comment anchored to --quote (exact text copied " +
        "from the doc). --line pins which occurrence when the quote repeats. " +
        "With --suggest it also carries a proposed replacement for the --target " +
        "span (exact raw markdown; defaults to --quote) that the user accepts " +
        "or rejects on the card. Prints the new comment id.",
    )
    .argument("<file>", "absolute path to the .md")
    .requiredOption("--quote <text>", "exact text from the doc to anchor the comment to")
    .requiredOption("--body <text>", "the comment text")
    .option("--suggest <replacement>", "attach a suggested replacement (empty means delete)")
    .option("--target <quote>", "raw markdown target (defaults to --quote with --suggest)")
    .option(
      "--line <n>",
      "pin the occurrence when --quote appears more than once",
      (v: string) => parseInt(v, 10),
    )
    .option(
      "--context-before <text>",
      "text just before the quote (anti-drift fingerprint for repeated quotes; " +
        "pair with --context-after)",
    )
    .option("--context-after <text>", "text just after the quote (see --context-before)")
    .action(function (this: Command, file: string, opts: Omit<CommentOpts, "author">) {
      setExit(cmdComment(file, { ...opts, author: author(this) }));
    });

  program
    .command("reply")
    .summary("reply to a thread")
    .description(
      "Reply to an existing thread (parent_id = the top-level comment id from " +
        "list-pending). With --suggest/--target the reply carries a proposed " +
        "edit the user accepts or rejects on the card. Prints the new reply " +
        "id.\n\n" +
        "If you have a QUESTION for the user about the doc, ask it here, in " +
        "the margin — anchored, persistent review discussion is what reply is " +
        "for; the user answers next turn. Use the terminal only for urgent / " +
        'out-of-band signals that don\'t belong on a line ("this will delete ' +
        'X — confirm?", "the file won\'t parse"), not ordinary review questions.',
    )
    .argument("<file>", "absolute path to the .md")
    .argument("<parent_id>", "top-level comment id being replied to")
    .requiredOption("--body <text>", "the reply text")
    .option("--suggest <replacement>", "attach a suggested replacement (empty means delete)")
    .option("--target <quote>", "raw markdown target (required with --suggest)")
    .action(function (this: Command, file: string, parentId: string, opts: Omit<ReplyOpts, "author">) {
      setExit(cmdReply(file, parentId, { ...opts, author: author(this) }));
    });

  const statusBlurb: Record<string, string> = {
    acknowledge:
      "Mark a thread acknowledged ('seen, working on it') without replying " +
      "yet — distinct from resolved. Prints the event id.",
    resolve:
      "Mark a thread resolved (done) so it drops out of the pending / " +
      "list-pending view. Prints the event id.",
    unresolve:
      "Re-open a previously resolved thread so it shows as pending again. " +
      "Prints the event id.",
  };
  for (const [name, etype] of [
    ["acknowledge", "acknowledged"],
    ["resolve", "resolved"],
    ["unresolve", "unresolved"],
  ] as const) {
    program
      .command(name)
      .summary(`mark a thread ${name}d`)
      .description(statusBlurb[name]!)
      .argument("<file>", "absolute path to the .md")
      .argument("<thread_id>", "top-level comment id (from list-pending)")
      .action(function (this: Command, file: string, threadId: string) {
        setExit(cmdThreadEvent(file, threadId, etype, author(this)));
      });
  }

  program
    .command("edit")
    .summary("edit a comment or reply body")
    .description(
      "Replace the displayed body of one comment OR reply (comment_id = any " +
        "comment/reply id, not an event). Append-only and last-edit-wins — " +
        "every version stays in the jsonl, the UI shows the newest. " +
        "Prints the edit event id.",
    )
    .argument("<file>", "absolute path to the .md")
    .argument("<comment_id>", "id of the comment/reply to edit")
    .requiredOption("--body <text>", "the replacement text (non-empty)")
    .action(function (this: Command, file: string, commentId: string, opts: { body: string }) {
      setExit(cmdEdit(file, commentId, opts.body, author(this)));
    });

  program
    .command("delete")
    .summary("delete a comment or reply")
    .description(
      "Tombstone one comment OR reply (comment_id = any comment/reply id). A " +
        "deleted top-level shows [deleted] but keeps its replies and anchor; " +
        "a deleted reply is hidden. Append-only and recoverable in the file. " +
        "Prints the delete event id.",
    )
    .argument("<file>", "absolute path to the .md")
    .argument("<comment_id>", "id of the comment/reply to delete")
    .action(function (this: Command, file: string, commentId: string) {
      setExit(cmdDelete(file, commentId, author(this)));
    });

  program
    .command("locate")
    .summary("where a thread's anchor lives in the doc now (JSON)")
    .description(
      "Resolve a thread's anchor against the current text of the .md — " +
        "context-fingerprint match first, then exact, then bounded fuzzy " +
        "recovery. Prints {thread_id, quote, found, start, length, line, " +
        "recovered} as JSON; found: false means the anchor is orphaned (its " +
        "text was edited away). Conservative: ambiguity orphans, never guesses.",
    )
    .argument("<file>", "absolute path to the .md")
    .argument("<thread_id>", "top-level comment id (from list-pending)")
    .action(function (this: Command, file: string, threadId: string) {
      setExit(cmdLocate(file, threadId));
    });

  program
    .command("check")
    .summary("server alive/down")
    .description(
      "Probe whether the mdc server is running (exit 0 = alive, 1 = down). " +
        "The live `watch` turn-taking needs it; if it's down, review the " +
        "sidecar directly via list-pending / get-thread — those work with no " +
        "server.",
    )
    .option("--base-url <url>", "server base URL", DEFAULT_BASE_URL)
    .action(async function (this: Command, opts: { baseUrl: string }) {
      setExit(await cmdCheck(opts.baseUrl));
    });

  program
    .command("watch")
    .summary("block until the user signals; return intent + pending")
    .description(
      "Block until the user signals a turn (Hand off / End session in the " +
        "browser), then print {intent, file, pending} as JSON. The turn-taking " +
        "primitive: call it, act on the result, then call it again for the " +
        "next round. Run it as a normal FOREGROUND command and read its output " +
        "when it returns — never in the background, where its result wakes " +
        "nobody. With --timeout it returns within N seconds, so it's just a " +
        "quick poll.\n\n" +
        "Always prints {intent, file, pending} as JSON — switch on `intent`:\n" +
        "  review       the user handed off — reply to `pending`, then watch again.\n" +
        "  done         the user ended the session — stop the loop.\n" +
        "  timeout      --timeout elapsed with no signal — re-run watch to keep waiting.\n" +
        "  server-down  mdc server not reachable — review the sidecar directly, don't retry.\n" +
        "  unreachable  the file is outside the served root — nothing to watch.",
    )
    .argument("<file>", "absolute path to the .md")
    .option("--base-url <url>", "server base URL", DEFAULT_BASE_URL)
    .option(
      "--timeout <seconds>",
      "stop waiting after N seconds and print {intent: 'timeout'} — for environments " +
        "that cap command duration; re-run watch to keep waiting",
      (v: string) => parseInt(v, 10),
    )
    .action(async function (this: Command, file: string, opts: { baseUrl: string; timeout?: number }) {
      setExit(await cmdWatch(file, opts.baseUrl, opts.timeout));
    });

  program
    .command("open")
    .summary("open a .md in the browser")
    .description(
      "Open a .md in the browser tab of the running mdc server (does not start it; " +
        "use `mdc serve` first). Exits non-zero with `down` if no server is running, or " +
        "`unreachable` if the file is outside the served root, so the caller " +
        "decides what to do.\n\n" +
        "Takes one file and focuses it. To open several, run it once per file — " +
        "each call adds the file as a tab and focuses it, so the last one opened " +
        "is active and the earlier ones stay open in the tab strip.",
    )
    .argument("<file>", "absolute path to the .md")
    .option("--base-url <url>", "server base URL", DEFAULT_BASE_URL)
    .action(async function (this: Command, file: string, opts: { baseUrl: string }) {
      setExit(await cmdOpen(file, opts.baseUrl));
    });

  program
    .command("serve")
    .summary("serve a root directory in the browser")
    .description(
      "Serve the browser UI + comment API on a root directory: renders any " +
        ".md under it, with margin comments, live-reload, and the handoff loop, " +
        "then opens it in the browser. Runs in the background by default — the " +
        "command returns once the server is up and the server keeps running, so " +
        "the caller isn't blocked. Use --foreground to run it in this process " +
        "and block until interrupted (e.g. to watch logs).\n\n" +
        "This is the single way to get the server up — no need to `check` first. " +
        "If an mdc server already serves THIS root, it just opens the browser to it. " +
        "If one is running on a DIFFERENT root it exits non-zero without opening " +
        "anything (opening the wrong root would mislead); re-run with --force to " +
        "stop that server and serve this root instead.",
    )
    .argument("[root]", "directory to serve .md files from (default: current directory)")
    .option("--port <n>", "port to serve on", (v: string) => parseInt(v, 10), DEFAULT_PORT)
    .option("--deny <dirs>", "comma-separated extra dirs to exclude (adds to the built-in deny list)", "")
    .option("--static-dir <dir>", "override the bundled static/ frontend dir")
    .option("--no-open", "don't open the browser after the server is up")
    .option("--force", "if an mdc server is running on a different root, stop it and serve this root", false)
    .option("--restart", "stop any mdc server on the port (even same-root) and start fresh — picks up a rebuilt frontend/backend", false)
    .option("--foreground", "run the server in this process and block (default: background)", false)
    .action(async function (
      this: Command,
      root: string | undefined,
      opts: {
        port: number;
        deny: string;
        staticDir?: string;
        open: boolean;
        force: boolean;
        restart: boolean;
        foreground: boolean;
      },
    ) {
      setExit(await cmdServe(resolveServeRoot(root), opts));
    });

  program
    .command("stop")
    .summary("stop the mdc server running on a port")
    .description(
      "Stop the mdc server listening on a port. Only stops an actual mdc server — if " +
        "something foreign holds the port it refuses (won't kill a stranger's " +
        "process), and if nothing is listening it's a no-op success. Safe to run " +
        "blindly.",
    )
    .option("--port <n>", "port to stop", (v: string) => parseInt(v, 10), DEFAULT_PORT)
    .action(async function (this: Command, opts: { port: number }) {
      setExit(await cmdStop(opts.port));
    });

  program
    .command("identity")
    .summary("show or set the user identity")
    .description(
      "Show the configured human user name and where it came from, or set it " +
        "in ~/.mdc.toml. This identity is used for turn-taking and UI role styling.",
    )
    .argument("[name]", "name to save in ~/.mdc.toml")
    .action(function (name: string | undefined) {
      setExit(cmdIdentity(name));
    });

  program
    .command("setup")
    .summary("print the agent setup doc")
    .description(
      "Print the agent setup doc (docs/agent-setup.md): what mdc is, the " +
        "review loop, the comment commands, and how to persist the " +
        "instructions in an agent's own harness. Meant to be read by a " +
        "coding agent — tell yours to run `mdc setup` and follow it.",
    )
    .action(function () {
      console.log(readFileSync(resolveSetupDoc(), "utf8").trimEnd());
    });

  program
    .command("example")
    .summary("copy a packaged example app into the workspace")
    .description(
      "Copy a packaged example mini app into the workspace: `mdc example kanban` " +
        "copies it to <root>/apps/kanban (run from the workspace root, or pass " +
        "--into). Open the copied .html in mdc and trust it to run. Run with no " +
        "name to list the available examples.",
    )
    .argument("[name]", "example to copy (omit to list)")
    .option("--into <dir>", "workspace root to copy into", ".")
    .action(function (name: string | undefined, opts: { into: string }) {
      const root = resolveExamplesRoot();
      const names = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      if (!name) {
        console.log("available examples:");
        for (const n of names) console.log("  " + n);
        console.log("copy one into the workspace: mdc example <name>");
        return;
      }
      if (!names.includes(name)) {
        throw new CliError(`unknown example '${name}' — available: ${names.join(", ")}`);
      }
      const dest = join(resolvePath(opts.into), "apps", name);
      if (existsSync(dest)) {
        throw new CliError(`already exists: ${dest} — remove it to re-copy`);
      }
      cpSync(join(root, name), dest, { recursive: true });
      console.log(`copied ${name} to ${dest}`);
      console.log("open it in mdc and trust it to run.");
    });

  return program;
}

/**
 * Locate the packaged example apps (`examples/apps/`). Same upward walk as the
 * setup-doc resolution, so it works from `dist/` or the source tree.
 */
function resolveExamplesRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "examples", "apps");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError("could not locate examples/apps in the package");
}

/**
 * Locate the packaged agent setup doc. Walks up from this module looking for
 * `docs/agent-setup.md`, so it resolves whether the compiled CLI runs from
 * `dist/` or the source tree (same approach as the static-dir resolution).
 */
function resolveSetupDoc(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "docs", "agent-setup.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError("could not locate docs/agent-setup.md in the package");
}

/** Run the CLI with an argv list (no node/script prefix). Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  let exitCode = 0;
  const program = buildProgram((code) => {
    exitCode = code;
  });
  program.exitOverride();
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      // Help/version display exits 0; usage errors carry commander's code.
      return e.exitCode;
    }
    if (e instanceof CliError) {
      console.error(`error: ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
  return exitCode;
}

// Only run when invoked as a script, not when imported by tests. realpath
// resolves the npm bin symlink so the comparison survives `npx mdc`.
const isDirectRun = (() => {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
