/**
 * Path resolution + traversal confinement for the server.
 *
 * Every request that names a file goes through one of these resolvers: the
 * file is validated against the index (or, for orphan-reaching delete paths,
 * just confined to the root) so the server can never read or write outside the
 * root it was launched on.
 */

import { existsSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { SIDECAR_SUFFIX } from "../sidecar.js";
import { IMAGE_EXTS } from "./walk.js";

/** A path error the routes turn into an HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** True if `child` resolves to a path inside `root` (no traversal escape). */
function isUnderRoot(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).includes(".."));
}

/** The sidecar path for an .md absolute path. */
export function sidecarPath(mdPath: string): string {
  return mdPath + SIDECAR_SUFFIX;
}

/**
 * Validate `fileParam` against the index, returning absolute [md, sidecar].
 * 404 if the file is not indexed or escapes the root.
 */
export function resolveFile(
  root: string,
  index: Set<string>,
  fileParam: string,
): { mdPath: string; scPath: string } {
  if (!index.has(fileParam)) {
    throw new HttpError(404, `file not in index: ${fileParam}`);
  }
  const mdPath = resolve(root, fileParam);
  if (!isUnderRoot(root, mdPath)) throw new HttpError(404, "path traversal blocked");
  return { mdPath, scPath: sidecarPath(mdPath) };
}

/**
 * Resolve `fileParam` to its sidecar WITHOUT requiring the .md in the index —
 * for orphaned-sidecar delete paths the dashboard reaches. Confined to root;
 * the sidecar itself must exist.
 */
export function resolveSidecarPath(root: string, fileParam: string): string {
  const mdPath = resolve(root, fileParam);
  if (!isUnderRoot(root, mdPath)) throw new HttpError(404, "path traversal blocked");
  const scPath = sidecarPath(mdPath);
  if (!existsSync(scPath)) throw new HttpError(404, `no sidecar for: ${fileParam}`);
  return scPath;
}

/**
 * Resolve `fileParam` to its sidecar, confined to root, NOT requiring either
 * the .md in the index or the sidecar to exist — for the "delete the whole
 * sidecar" path, which no-op-succeeds when already gone.
 */
export function resolveSidecarForDelete(root: string, fileParam: string): string {
  const mdPath = resolve(root, fileParam);
  if (!isUnderRoot(root, mdPath)) throw new HttpError(404, "path traversal blocked");
  return sidecarPath(mdPath);
}

/**
 * Confine an arbitrary relative path to root, returning its absolute path —
 * WITHOUT requiring it (or its parent) to be indexed. For mutation routes
 * (create/delete a file or folder): a file being created isn't indexed yet, and
 * a folder being deleted has no single index entry. The only invariant the index
 * resolvers give us for free — that the target is inside root — is enforced here
 * directly, and the root itself is refused so a stray empty path can't target it.
 */
export function resolveWithinRoot(root: string, relParam: string): string {
  const abs = resolve(root, relParam);
  if (!isUnderRoot(root, abs)) throw new HttpError(404, "path traversal blocked");
  if (abs === resolve(root)) throw new HttpError(400, "refusing to operate on the root itself");
  return abs;
}

/**
 * Resolve an image reference to a root-relative posix path, or null.
 *
 * Fallback chain (the lookup order the frontend relies on):
 *   1. literal ref relative to the doc's directory   (![[images/x.png]])
 *   2. literal ref relative to root                  (![](knowledge/.../x.png))
 *   3. basename search over the image index          (![](image_1.png))
 * Every candidate must be in the image index (extension + deny enforced).
 * Step 3 picks the match nearest the doc, then shortest path.
 */
export function resolveImage(
  imageIndex: Set<string>,
  docPath: string,
  rawRef: string,
): string | null {
  const ext = (p: string): string => {
    const i = p.lastIndexOf(".");
    return i <= 0 ? "" : p.slice(i).toLowerCase();
  };
  const ref = rawRef.trim().replace(/^\/+/, "");
  const docDir = posix.dirname(docPath);

  // 1. relative to the doc's directory
  let cand = posix.normalize(posix.join(docDir, ref));
  if (!cand.startsWith("..") && imageIndex.has(cand)) return cand;

  // 2. relative to root
  cand = posix.normalize(ref);
  if (!cand.startsWith("..") && imageIndex.has(cand)) return cand;

  // 3. basename search: nearest-to-doc, then shortest path, then lexical
  const base = posix.basename(ref);
  if (!IMAGE_EXTS.has(ext(base))) return null;
  const matches = [...imageIndex].filter((p) => posix.basename(p) === base);
  if (matches.length === 0) return null;

  const docParts = docDir.split("/").filter(Boolean);
  const sharedPrefix = (p: string): number => {
    const pp = p.split("/").filter(Boolean);
    let n = 0;
    for (let i = 0; i < Math.min(docParts.length, pp.length); i++) {
      if (docParts[i] !== pp[i]) break;
      n++;
    }
    return n;
  };
  matches.sort((a, b) => {
    const sp = sharedPrefix(b) - sharedPrefix(a);
    if (sp !== 0) return sp;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return matches[0] ?? null;
}

/**
 * Validate an image by its OWN indexed path (not a doc-relative ref) — for the
 * standalone image view, which opens an image directly with no referencing doc.
 * The path must be in the image index (extension + deny enforced there); returns
 * the absolute path. 404 if not indexed.
 */
export function resolveIndexedImage(imageIndex: Set<string>, pathParam: string): string | null {
  return imageIndex.has(pathParam) ? pathParam : null;
}

/** Validate that an image rel path is under root and on disk; returns absolute. */
export function resolveImageFile(root: string, rel: string): string {
  const imgPath = resolve(root, rel);
  if (!isUnderRoot(root, imgPath)) throw new HttpError(404, "path traversal blocked");
  if (!existsSync(imgPath)) throw new HttpError(404, `image not found on disk: ${rel}`);
  return imgPath;
}

/**
 * Validate an HTML file by its OWN indexed path — for the sandboxed HTML view,
 * which opens an .html directly. The path must be in the html index (extension
 * + deny enforced there); returns the absolute path, or null if not indexed.
 */
export function resolveIndexedHtml(htmlIndex: Set<string>, pathParam: string): string | null {
  return htmlIndex.has(pathParam) ? pathParam : null;
}

/** Validate that an HTML rel path is under root and on disk; returns absolute. */
export function resolveHtmlFile(root: string, rel: string): string {
  const htmlPath = resolve(root, rel);
  if (!isUnderRoot(root, htmlPath)) throw new HttpError(404, "path traversal blocked");
  if (!existsSync(htmlPath)) throw new HttpError(404, `html not found on disk: ${rel}`);
  return htmlPath;
}

/**
 * Validate a PDF file by its OWN indexed path — for the browser-native PDF
 * iframe view. The path must be in the pdf index (extension + deny enforced
 * there); returns the absolute path, or null if not indexed.
 */
export function resolveIndexedPdf(pdfIndex: Set<string>, pathParam: string): string | null {
  return pdfIndex.has(pathParam) ? pathParam : null;
}

/** Validate that a PDF rel path is under root and on disk; returns absolute. */
export function resolvePdfFile(root: string, rel: string): string {
  const pdfPath = resolve(root, rel);
  if (!isUnderRoot(root, pdfPath)) throw new HttpError(404, "path traversal blocked");
  if (!existsSync(pdfPath)) throw new HttpError(404, `pdf not found on disk: ${rel}`);
  return pdfPath;
}

/** Validate a drawing by its own indexed path. */
export function resolveIndexedDrawing(drawingIndex: Set<string>, pathParam: string): string | null {
  return drawingIndex.has(pathParam) ? pathParam : null;
}

/** Validate that a drawing path stays under root and exists on disk. */
export function resolveDrawingFile(root: string, rel: string): string {
  const drawingPath = resolve(root, rel);
  if (!isUnderRoot(root, drawingPath)) throw new HttpError(404, "path traversal blocked");
  if (!existsSync(drawingPath)) throw new HttpError(404, `drawing not found on disk: ${rel}`);
  return drawingPath;
}

/** posix basename of a path (for tombstone `file` fields). */
export function baseName(p: string): string {
  return posix.basename(toPosix(p));
}
