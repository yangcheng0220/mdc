/**
 * App manifest — the `mdc-app` block a trusted HTML app declares inside an HTML
 * comment at the top of the file.
 *
 * An app states its identity and the file scopes it needs:
 *
 *   <!--
 *   mdc-app:
 *     name: Board
 *     permissions:
 *       read:
 *         - board.md
 *       write:
 *         - board.md
 *   -->
 *
 * The block is the app's self-contained declaration: one file, no sidecar
 * manifest. Paths are root-relative (the workspace the server was launched on).
 *
 * When an app omits the block entirely, it still gets a default scope: its own
 * folder and subfolders (the common case — an app co-located with the data it
 * owns). The block exists to declare access BEYOND that folder.
 */

/** An app's declared file scopes, root-relative. */
export interface AppManifest {
  name: string;
  permissions: {
    read: string[];
    write: string[];
  };
}

/** Raised when an `mdc-app` block is present but cannot be parsed. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

// The HTML comment that wraps the manifest. Non-greedy body, dot-all so the
// block can span lines. Only the FIRST such block is considered.
const MANIFEST_BLOCK = /<!--\s*([\s\S]*?)-->/;

/**
 * Extract and parse the `mdc-app` manifest from HTML source.
 *
 * Returns the parsed manifest, or `null` when no `mdc-app` block is present
 * (the app falls back to its same-folder default scope — not an error).
 * Throws {@link ManifestError} when a block exists but is malformed.
 */
export function parseManifest(html: string): AppManifest | null {
  const block = findManifestBlock(html);
  if (block === null) return null;
  return parseManifestBody(block);
}

/**
 * Scan HTML comments for the one whose body starts with `mdc-app:`, returning
 * the lines BELOW that key (the manifest body), or null if none is found.
 */
function findManifestBlock(html: string): string[] | null {
  let rest = html;
  for (;;) {
    const m = MANIFEST_BLOCK.exec(rest);
    if (m === null) return null;
    const body = m[1] ?? "";
    const lines = body.split("\n");
    const idx = lines.findIndex((l) => l.trim() === "mdc-app:" || l.trim().startsWith("mdc-app:"));
    if (idx !== -1) return lines.slice(idx + 1);
    // Not this comment — advance past it and keep looking.
    rest = rest.slice(m.index + m[0].length);
  }
}

/**
 * Parse the indented manifest body into an {@link AppManifest}.
 *
 * A deliberately small reader for the fixed shape above (no general YAML dep):
 * `name:` is a scalar; `permissions:` nests `read:`/`write:`, each a list of
 * `- path` items. Blank lines are ignored. Anything unexpected throws.
 */
function parseManifestBody(lines: string[]): AppManifest {
  let name = "";
  const read: string[] = [];
  const write: string[] = [];

  // Which list a `- item` line currently appends to (set by `read:`/`write:`).
  let listTarget: string[] | null = null;
  // True once inside the `permissions:` block, so `read:`/`write:` are scoped.
  let inPermissions = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;
    const text = line.trim();

    if (text.startsWith("- ")) {
      if (listTarget === null) {
        throw new ManifestError(`unexpected list item outside read/write: ${text}`);
      }
      listTarget.push(stripQuotes(text.slice(2).trim()));
      continue;
    }

    // A `key:` or `key: value` line. Reset list context at a shallow key.
    const colon = text.indexOf(":");
    if (colon === -1) throw new ManifestError(`expected "key: value", got: ${text}`);
    const key = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();

    if (indent === 0) {
      inPermissions = false;
      listTarget = null;
    }

    if (key === "name") {
      name = stripQuotes(value);
    } else if (key === "permissions") {
      inPermissions = true;
      listTarget = null;
    } else if (key === "read" && inPermissions) {
      listTarget = read;
    } else if (key === "write" && inPermissions) {
      listTarget = write;
    } else {
      throw new ManifestError(`unknown manifest key: ${key}`);
    }
  }

  if (!name) throw new ManifestError("manifest is missing a name");
  return { name, permissions: { read, write } };
}

/** Strip matching single/double quotes around a scalar, if present. */
function stripQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}
