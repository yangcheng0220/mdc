/**
 * Who is "the user"? — config-driven.
 *
 * The sidecar records each entry's `author` as a free-form name (the writing
 * agent or the human). The server/CLI need to know which author is *the user*
 * so they can derive whose turn it is and style the UI by role.
 *
 * Resolution order (first hit wins):
 *   1. MDC_USER env var
 *   2. `user` key in `~/.mdc.toml` (identity follows the user, not the content tree)
 *   3. `user` key in `<root>/.mdc.toml` (per-tree override, when a root is passed)
 *   4. default "user"
 *
 * Home-dir config is checked before the root because "who am I" is a property
 * of the person, not of whatever folder the server happens to be launched on.
 * The per-root file is a deliberate override for that one tree.
 *
 * The default is intentional: an unconfigured clone still works, it just calls
 * the human "user" instead of guessing a name.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export const DEFAULT_USER = "user";
export const CONFIG_FILENAME = ".mdc.toml";
export type IdentitySource = "env" | "home" | "root" | "default";

/** Injectable environment for tests; defaults to the real process/OS. */
export interface IdentityEnv {
  env?: Record<string, string | undefined>;
  home?: string;
}

/**
 * Return the `user` value from `<root>/.mdc.toml`, or null if absent/unreadable.
 *
 * Best-effort: a missing file, malformed TOML, or missing key all fall through
 * to the next resolution step rather than throwing — config should never be
 * able to break a read.
 */
function readConfigUser(root: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_FILENAME), "utf8");
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = parseToml(text);
  } catch {
    return null;
  }
  const user = data.user;
  return typeof user === "string" && user ? user : null;
}

/**
 * The configured name for "the user". See module doc for resolution order.
 *
 * `root` is an optional per-tree override location (the server's launch root).
 * Home-dir config (`~/.mdc.toml`) is always checked, so a caller with no root
 * still resolves the user's identity.
 */
export function currentUser(root?: string | null, deps: IdentityEnv = {}): string {
  return currentUserWithSource(root, deps).name;
}

/** The configured user name plus the source that supplied it. */
export function currentUserWithSource(
  root?: string | null,
  deps: IdentityEnv = {},
): { name: string; source: IdentitySource } {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const fromEnv = env.MDC_USER;
  if (fromEnv) return { name: fromEnv, source: "env" };
  const fromHome = readConfigUser(home);
  if (fromHome) return { name: fromHome, source: "home" };
  if (root != null) {
    const fromRoot = readConfigUser(root);
    if (fromRoot) return { name: fromRoot, source: "root" };
  }
  return { name: DEFAULT_USER, source: "default" };
}

/** The home identity config path for commands that write user-level settings. */
export function homeConfigPath(deps: IdentityEnv = {}): string {
  return join(deps.home ?? homedir(), CONFIG_FILENAME);
}
