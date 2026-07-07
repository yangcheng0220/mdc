/**
 * App permission scope — can this app read / write this target path?
 *
 * Two independent gates, both of which a target must pass:
 *
 *   1. Confinement: the target resolves to a path inside the served root, with
 *      no traversal escape. (The route layer also runs this, but scope checks
 *      it first so a malformed target never reaches the filesystem.)
 *   2. Declared scope: the target falls within what the app is allowed to touch.
 *
 * An app's effective scope is its OWN FOLDER (and subfolders) — the home it is
 * co-located with — PLUS any paths its manifest declares. The folder default is
 * the common case; the manifest extends reach beyond it (e.g. a dashboard that
 * reads a sibling folder). Write is always a subset of read: an app can only
 * write paths it is also allowed to read.
 *
 * All paths here are root-relative posix strings.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { AppManifest } from "./manifest.js";

/**
 * A version token for a file's current bytes — the sha256 hex digest of its
 * content. `readText` returns it; `writeText` may carry it back so the server
 * writes only if the file still matches (optimistic concurrency). Hashing the
 * content (not mtime) is rename/clock-safe and treats an edit that reverts to
 * identical bytes as no conflict. Mirrors the trust-store hash (trust.ts).
 */
export function fileVersion(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** A normalized, root-relative posix path, or null if it escapes the root. */
function normalizeRel(p: string): string | null {
  // Drop any leading slash (treat as root-relative), normalize `.`/`..`.
  const cleaned = posix.normalize(p.replace(/^\/+/, ""));
  if (cleaned === ".." || cleaned.startsWith("../")) return null;
  return cleaned;
}

/** The folder an app lives in (root-relative), e.g. `apps/board`. */
function appFolder(appPath: string): string {
  const dir = posix.dirname(appPath);
  return dir === "." ? "" : dir;
}

/** True if `target` is `prefix` itself or sits underneath it. */
function isWithin(prefix: string, target: string): boolean {
  if (prefix === "") return true; // root-level app: its folder is the whole root
  return target === prefix || target.startsWith(prefix + "/");
}

/**
 * True if `target` is covered by one of the manifest's declared `scopes`.
 * Each scope entry is matched as a path prefix, so a declared folder grants its
 * whole subtree and a declared file grants just that file.
 */
function inDeclaredScopes(scopes: string[], target: string): boolean {
  for (const raw of scopes) {
    const scope = normalizeRel(raw);
    if (scope === null) continue; // a manifest scope that escapes root grants nothing
    if (isWithin(scope, target)) return true;
  }
  return false;
}

/**
 * Can the app at `appPath` read `targetPath`, given its `manifest` (or null for
 * the same-folder default)? Read scope = own folder ∪ manifest.read.
 */
export function canRead(
  appPath: string,
  targetPath: string,
  manifest: AppManifest | null,
): boolean {
  const app = normalizeRel(appPath);
  const target = normalizeRel(targetPath);
  if (app === null || target === null) return false;

  if (isWithin(appFolder(app), target)) return true;
  if (manifest && inDeclaredScopes(manifest.permissions.read, target)) return true;
  return false;
}

/**
 * Can the app at `appPath` write `targetPath`? Write scope = own folder ∪
 * manifest.write — AND must also be readable (write is a subset of read).
 */
export function canWrite(
  appPath: string,
  targetPath: string,
  manifest: AppManifest | null,
): boolean {
  const app = normalizeRel(appPath);
  const target = normalizeRel(targetPath);
  if (app === null || target === null) return false;
  if (!canRead(appPath, targetPath, manifest)) return false;

  if (isWithin(appFolder(app), target)) return true;
  if (manifest && inDeclaredScopes(manifest.permissions.write, target)) return true;
  return false;
}
