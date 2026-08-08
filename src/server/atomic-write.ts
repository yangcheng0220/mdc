/**
 * Atomic whole-file replacement.
 *
 * `writeFileSync` truncates the target and then streams into it, so a reader
 * that opens the file mid-write sees a partial document — neither the complete
 * old bytes nor the complete new ones. That window is not hypothetical: a 50MB
 * write takes tens of milliseconds, and a concurrent reader observes the file
 * at intermediate sizes throughout.
 *
 * Staging the content in a sibling temp file and renaming it over the target
 * closes the window. `rename(2)` is atomic within a filesystem, so a reader
 * sees either the old file or the new one and never a torn state.
 *
 * The temp file is a sibling (not in the system temp dir) so the rename stays
 * within one filesystem — a cross-device rename would fail, and copying back
 * would reintroduce the very tear this avoids.
 *
 * This protects readers from partial files. It does NOT make the caller's
 * check-then-write sequence a filesystem-level compare-and-swap: a process
 * writing the target directly, outside this helper, is still outside mdc's
 * optimistic-concurrency protection.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Write `content` to `abs`, replacing it atomically.
 *
 * Throws if the content cannot be staged or published; on failure the staged
 * temp file is removed and the target is left byte-identical to what it was.
 */
export function writeFileAtomicSync(abs: string, content: string): void {
  const dir = dirname(abs);
  // A unique name per attempt: two concurrent writers must never stage into
  // the same temp path, or one would publish the other's half-written bytes.
  const tmp = join(dir, `.${basename(abs)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);

  // Replacing the target swaps in a new inode, so the old file's permission
  // bits go with it. Carry them over, or a private file (0600) silently
  // widens to the default 0644 on its next save. A file that doesn't exist yet
  // keeps the normal default-mode behaviour.
  let mode: number | null = null;
  try {
    mode = statSync(abs).mode & 0o777;
  } catch {
    mode = null;
  }

  try {
    writeFileSync(tmp, content, "utf8");
    if (mode !== null) chmodSync(tmp, mode);
    // Flush the staged bytes before publishing, so a crash can't leave the
    // target pointing at a file whose contents never reached the disk.
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, abs);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone, or never created — nothing to clean up.
    }
    throw err;
  }
}
