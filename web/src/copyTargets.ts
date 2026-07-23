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

/**
 * Whether a file offers Copy contents — i.e. whether it has raw text a user
 * could paste. Markdown, drawings (their JSON), and HTML do; images and PDFs
 * don't.
 *
 * The predicate is "is this text", NOT "is this markdown": a drawing and an
 * HTML file are both non-markdown yet both copy their source. Only the two
 * binary surfaces are excluded, so they are what the caller names.
 *
 * `typeKnown` is not a detail: the file index is what resolves a path's type,
 * and until it arrives every file looks like markdown. Offering Copy contents
 * in that window puts the action on a deep-linked image, where it fails.
 */
export function offersCopyContents(opts: {
  file: string | null;
  typeKnown: boolean;
  isImage: boolean;
  isPdf: boolean;
}): boolean {
  return opts.file !== null && opts.typeKnown && !opts.isImage && !opts.isPdf;
}

/**
 * The UTF-8 byte length of what actually reaches the clipboard — not
 * `string.length`, which counts UTF-16 units and under-reports any non-ASCII
 * text.
 */
export function byteSize(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

/**
 * Human-readable payload size in decimal units (1 KB = 1,000 bytes), for the
 * copy toast's meta line.
 *
 * Whole bytes below 1 KB; one decimal above, with a trailing `.0` dropped so it
 * reads `4 KB` rather than `4.0 KB`. Rounding is applied *before* the unit is
 * chosen, so a value that would render as `1000 KB` promotes to `1 MB` instead.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  // Rounding first is what makes the promotion correct: 999,950 bytes rounds to
  // 1000.0 KB, which must become 1 MB, not a unit that never displays.
  while (Math.round(value * 10) / 10 >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${units[unit]}`;
}
