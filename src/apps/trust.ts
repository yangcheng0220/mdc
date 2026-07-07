/**
 * App trust store — which HTML apps the user has trusted to run, per workspace.
 *
 * Trust travels with the served workspace, so it lives in `<root>/.mdc.toml`
 * (the same file that may hold the `user` identity key — see identity.ts) under
 * an `[apps]` table mapping the app's root-relative path to a content hash:
 *
 *   [apps]
 *   "apps/board/board.html" = "<sha256 of the file's bytes>"
 *
 * Keying on the hash makes trust mean "I trust THIS EXACT version." If the file
 * is later edited or swapped, its hash no longer matches and it is treated as
 * untrusted — the user is re-prompted, closing the silently-rewritten-app hole.
 *
 * Trust is strictly per-root: there is no home-dir (`~/.mdc.toml`) fallback. An
 * app trusted under one workspace is not trusted under another.
 *
 * Reads are best-effort: a missing or malformed config means "nothing trusted"
 * rather than an error — config must never be able to break the runtime. Writes
 * preserve every other key already in the file (notably `user`).
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { CONFIG_FILENAME } from "../identity.js";

const APPS_TABLE = "apps";

/** The sha256 hex digest of an app file's bytes — the trust key. */
function hashApp(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Parse `<root>/.mdc.toml` into a plain object, or `{}` if absent/malformed. */
function readConfig(root: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_FILENAME), "utf8");
  } catch {
    return {};
  }
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The `[apps]` table from a parsed config (path -> hash), or `{}`. */
function appsTable(config: Record<string, unknown>): Record<string, string> {
  const apps = config[APPS_TABLE];
  if (apps && typeof apps === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(apps as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return {};
}

/**
 * Is the app at `appPath` (root-relative) trusted, given its current bytes?
 *
 * True only when the stored hash for that path matches the hash of the bytes
 * passed in — so an edited or swapped file reads as untrusted.
 */
export function isTrusted(root: string, appPath: string, currentBytes: Buffer | string): boolean {
  const stored = appsTable(readConfig(root))[appPath];
  return stored !== undefined && stored === hashApp(currentBytes);
}

/**
 * Record trust for the app at `appPath` with the given bytes, persisting the
 * `[apps]` entry into `<root>/.mdc.toml`. Every other key in the file (e.g.
 * `user`) is preserved. Returns the stored hash.
 */
export function trustApp(root: string, appPath: string, bytes: Buffer | string): string {
  const config = readConfig(root);
  const apps = appsTable(config);
  const hash = hashApp(bytes);
  apps[appPath] = hash;
  config[APPS_TABLE] = apps;
  writeFileSync(join(root, CONFIG_FILENAME), stringifyToml(config), "utf8");
  return hash;
}

/** Remove an app's trust entry, if present. Returns whether one was removed. */
export function revokeApp(root: string, appPath: string): boolean {
  const config = readConfig(root);
  const apps = appsTable(config);
  if (apps[appPath] === undefined) return false;
  delete apps[appPath];
  config[APPS_TABLE] = apps;
  writeFileSync(join(root, CONFIG_FILENAME), stringifyToml(config), "utf8");
  return true;
}
