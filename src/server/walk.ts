/**
 * Directory walking + index building for the server.
 *
 * The server confines itself to files discovered under a root, with denied
 * directories PRUNED DURING the walk (never descended into) — descending into
 * `.git`/`node_modules` then filtering after is ~1s+ per call on a large root,
 * and the index is rebuilt on every /api/index + /api/dashboard hit.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SIDECAR_SUFFIX } from "../sidecar.js";

/** Built-in directory names never walked into. */
export const DEFAULT_DENY = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  ".next",
  "dist",
  "build",
  "__pycache__",
]);

export const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]);

const HTML_EXTS = new Set([".html", ".htm"]);
const PDF_EXTS = new Set([".pdf"]);

/** Lowercased extension including the dot, or "" if none. */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

/** A relative path as posix (forward slashes) regardless of platform. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Yield [relativePosixPath, filename] for every file under root, pruning denied
 * directories so the walk never descends into them.
 */
export function* walkFiles(
  root: string,
  deny: Set<string>,
): Generator<[string, string]> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip, don't crash the walk
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!deny.has(ent.name)) stack.push(full);
      } else if (ent.isFile()) {
        yield [toPosix(relative(root, full)), ent.name];
      }
    }
  }
}

/** Relative posix paths of every .md file under root. */
export function buildIndex(root: string, deny: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [rel, name] of walkFiles(root, deny)) {
    if (name.endsWith(".md")) out.add(rel);
  }
  return out;
}

/**
 * Relative posix paths of every directory under root (denied dirs pruned, same
 * as the file walk). Lets the file tree render folders that hold no .md yet — a
 * just-created empty folder would otherwise be invisible, since the file index
 * only surfaces a folder via the files inside it.
 */
export function buildDirIndex(root: string, deny: Set<string>): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip, don't crash the walk
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || deny.has(ent.name)) continue;
      const full = join(dir, ent.name);
      out.add(toPosix(relative(root, full)));
      stack.push(full);
    }
  }
  return out;
}

/** Relative posix paths of every image file (by extension) under root. */
export function buildImageIndex(root: string, deny: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [rel, name] of walkFiles(root, deny)) {
    if (IMAGE_EXTS.has(extOf(name))) out.add(rel);
  }
  return out;
}

/** Relative posix paths of every HTML file (by extension) under root. */
export function buildHtmlIndex(root: string, deny: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [rel, name] of walkFiles(root, deny)) {
    if (HTML_EXTS.has(extOf(name))) out.add(rel);
  }
  return out;
}

/** Relative posix paths of every PDF file (by extension) under root. */
export function buildPdfIndex(root: string, deny: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [rel, name] of walkFiles(root, deny)) {
    if (PDF_EXTS.has(extOf(name))) out.add(rel);
  }
  return out;
}

/**
 * Relative .md posix paths whose sidecar exists but whose .md does NOT — the
 * "doc deleted, comments stranded" case the index can't see. Returns the .md
 * path (not the sidecar path) so callers key orphans like live docs.
 */
export function findOrphanSidecars(root: string, deny: Set<string>): string[] {
  const orphans: string[] = [];
  for (const [rel, name] of walkFiles(root, deny)) {
    if (!name.endsWith(SIDECAR_SUFFIX)) continue;
    // The .md name is the sidecar name minus the literal suffix (NOT a suffix
    // replacement — the .md name itself can contain dots, e.g.
    // "PROJECT.md.comments.jsonl" -> "PROJECT.md").
    const mdRel = rel.slice(0, -SIDECAR_SUFFIX.length);
    if (!existsSync(join(root, mdRel))) orphans.push(mdRel);
  }
  return orphans;
}

/** Parse a comma-separated --deny arg into a set, merged with the defaults. */
export function denyFrom(extraRaw: string): Set<string> {
  const deny = new Set(DEFAULT_DENY);
  for (const s of extraRaw.split(",")) {
    const t = s.trim();
    if (t) deny.add(t);
  }
  return deny;
}
