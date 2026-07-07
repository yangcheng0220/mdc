/**
 * Boot the mdc server on a root directory.
 *
 * Resolves the root + the `static/` frontend, wires the Hono app to a Node
 * HTTP server, and prints the startup banner. The `mdc serve` CLI command is a
 * thin wrapper over this.
 */

import { serve as honoServe } from "@hono/node-server";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentUserWithSource, type IdentitySource } from "../identity.js";
import { buildImageIndex, buildIndex, denyFrom } from "./walk.js";
import { createApp } from "./app.js";

export interface ServeOptions {
  port: number;
  deny: string;
  /** Override the static dir (mainly for tests/dev). */
  staticDir?: string;
}

/**
 * Locate the built frontend dir (`web/dist`, holding the bundled index.html +
 * assets). Searches upward from this module for `web/dist/index.html`, so it
 * resolves whether the compiled CLI runs from `dist/` or the source tree. An
 * explicit override (or `MDC_STATIC_DIR`) wins.
 */
function resolveStaticDir(override?: string): string {
  const explicit = override ?? process.env.MDC_STATIC_DIR;
  if (explicit) {
    const dir = resolve(explicit);
    if (existsSync(join(dir, "index.html"))) return dir;
    throw new Error(`no index.html in static dir: ${dir}`);
  }
  // Walk up from this file looking for a `web/dist/index.html`.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "web", "dist", "index.html");
    if (existsSync(candidate)) return join(dir, "web", "dist");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "could not locate the built frontend (web/dist) — run `npm run build:web`, " +
      "or set MDC_STATIC_DIR / pass --static-dir",
  );
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function printStartupBanner(args: {
  user: string;
  identitySource: IdentitySource;
  root: string;
  deny: Set<string>;
  markdownCount: number;
  imageCount: number;
  port: number;
}): void {
  console.log(`user: ${args.user}`);
  console.log(`Root:    ${args.root}`);
  console.log(`Deny:    [${[...args.deny].sort().map((d) => `'${d}'`).join(", ")}]`);
  console.log(`Indexed: ${args.markdownCount} markdown file(s), ${args.imageCount} image(s)`);
  console.log(`URL:     http://localhost:${args.port}`);
  if (args.identitySource === "default") {
    console.log('tip: comments are attributed as "user" — set your name: mdc identity <name>');
  }
}

/** Start the server. Returns a handle so tests/callers can shut it down. */
export async function startServer(
  rootArg: string,
  opts: ServeOptions,
): Promise<RunningServer> {
  const root = isAbsolute(rootArg) ? rootArg : resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const staticDir = resolveStaticDir(opts.staticDir);
  const identity = currentUserWithSource(root);
  const user = identity.name;
  const deny = denyFrom(opts.deny);
  const index = buildIndex(root, deny);
  const imageIndex = buildImageIndex(root, deny);

  const { app, watcher } = createApp({ root, staticDir, denyRaw: opts.deny, user });

  printStartupBanner({
    user,
    identitySource: identity.source,
    root,
    deny,
    markdownCount: index.size,
    imageCount: imageIndex.size,
    port: opts.port,
  });

  const server = honoServe({
    fetch: app.fetch,
    port: opts.port,
    hostname: "127.0.0.1",
  });

  return {
    port: opts.port,
    async close() {
      await watcher.close();
      await new Promise<void>((res, rej) =>
        server.close((err) => (err ? rej(err) : res())),
      );
    },
  };
}
