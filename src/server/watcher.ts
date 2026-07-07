/**
 * Live-reload change source.
 *
 * An event-driven chokidar watch on the root: changes push the instant they
 * land, at no idle CPU cost. Consumers get `doc-changed` / `sidecar-changed`
 * events keyed by the relative posix path of the affected doc.
 *
 * One watcher per server, shared by every SSE connection (the SSE route fans a
 * single change stream out to all connected clients). Connections subscribe for
 * the set of files they care about and filter locally.
 */

import chokidar, { type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";
import { SIDECAR_SUFFIX } from "../sidecar.js";
import { DEFAULT_DENY } from "./walk.js";

/** True when a changed path is a sidecar file (vs a doc). */
function isSidecarPath(path: string): boolean {
  return path.endsWith(SIDECAR_SUFFIX);
}

export type ChangeKind = "doc-changed" | "sidecar-changed";
export type ChangeListener = (kind: ChangeKind, relPath: string) => void;

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

export class RootWatcher {
  private watcher: FSWatcher;
  private listeners = new Set<ChangeListener>();

  constructor(
    root: string,
    deny: Set<string> = DEFAULT_DENY,
  ) {
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      // Prune denied dirs (.git, node_modules, …) so we don't fire on their
      // churn — same deny list the index walk uses, so the two stay in sync.
      ignored: (path: string) => {
        const rel = relative(root, path);
        if (!rel) return false;
        return rel.split(sep).some((seg) => deny.has(seg));
      },
    });
    // add/change/unlink all count as "moved" (deletion fires a change too, just
    // like the poll treated a vanished file as mtime 0.0). Events are ALWAYS
    // keyed by the DOC's relative path — clients subscribe by doc path, so a
    // sidecar change reports its doc (suffix stripped), not the sidecar file.
    for (const ev of ["add", "change", "unlink"] as const) {
      this.watcher.on(ev, (path: string) => {
        const rel = toPosix(relative(root, path));
        if (isSidecarPath(path)) {
          this.dispatch("sidecar-changed", rel.slice(0, -SIDECAR_SUFFIX.length));
        } else {
          this.dispatch("doc-changed", rel);
        }
      });
    }
  }

  private dispatch(kind: ChangeKind, relPath: string): void {
    for (const l of this.listeners) l(kind, relPath);
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.watcher.close();
  }
}
