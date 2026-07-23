/**
 * The pure parts of the copy actions: what an absolute path looks like, and what
 * a file's basename is. Kept free of React and clipboard concerns so the toolbar
 * menu, the file tree, and the handoff prompt all derive the same values — the
 * point being that Copy path and the Handoff prompt cannot drift apart.
 */

/**
 * Join the workspace root to a root-relative POSIX path, yielding the absolute
 * filesystem path an agent would use (its cwd may differ from the root).
 *
 * The root arrives from the server as a real filesystem path, so it may carry a
 * trailing separator or be a Windows drive root; the relative half is always
 * POSIX. Trailing separators are dropped before joining so `/root/` and `/root`
 * agree — except for a bare `/` or `C:\`, where the separator IS the path.
 */
export function absolutePath(root: string, relative: string): string {
  if (!root) return relative;
  if (!relative) return root;

  const sep = root.includes("\\") && !root.startsWith("/") ? "\\" : "/";
  // Strip trailing separators so "/root/" and "/root" agree, then rejoin with a
  // single one. A bare "/" or "C:" trims to a stem the separator completes.
  return root.replace(/[/\\]+$/, "") + sep + relative;
}

/** The filename with extension — the last segment of a root-relative path. */
export function filename(path: string): string {
  return path.split("/").pop() ?? path;
}
