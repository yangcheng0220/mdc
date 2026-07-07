/**
 * Path-rewrite engine for moving a document.
 *
 * Pure and dependency-free (posix path math only, no fs) so it runs identically
 * in the server route and in unit tests. All paths here are **root-relative
 * posix** — the same form the file index uses.
 *
 * What a move can break, and what this engine does about it:
 *
 *  - **Relative markdown links** `[text](../../foo.md)` and **relative image
 *    srcs** `![](../img.png)` are path-anchored: they resolve from the directory
 *    of the file they live in. They break when the file at *either* end of the
 *    link moves. These are rewritten.
 *  - **Wikilinks** `[[doc]]` and **image embeds** `![[img]]` resolve by
 *    *basename* (see `resolveWikilink` / `resolveImage`), so they keep resolving
 *    wherever a file lands — they are left untouched. The exception is a
 *    **path-qualified** wikilink `[[folder/doc]]`, which resolves by path and so
 *    is rewritten like a relative link.
 *  - **External** links (`https:`, `mailto:`…) and **root-absolute** links
 *    (`/foo.md`) are never path-anchored to the doc, so they are never touched.
 *
 * The rule throughout: rewrite a reference only when the move changes the path
 * that reference *should* contain — never blindly rewrite every mention.
 */

import { posix } from "node:path";

const { dirname, join, normalize, relative } = posix;

export interface Rewrite {
  /** The link text as it appeared, e.g. `../../foo.md`. */
  from: string;
  /** What it was rewritten to, e.g. `../foo.md`. */
  to: string;
}

export interface RewriteResult {
  content: string;
  rewrites: Rewrite[];
}

// A relative link is one we resolve from the doc's own directory. Anything with
// a URL scheme (http:, mailto:, …) or a leading slash (root-absolute) is not.
function isRelativeRef(ref: string): boolean {
  if (!ref) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false; // scheme → external
  if (ref.startsWith("/")) return false; // root-absolute
  if (ref.startsWith("#")) return false; // same-doc anchor
  return true;
}

// Split a link target into its path and a trailing #section / ?query, so we
// rewrite the path part and preserve the suffix verbatim.
function splitSuffix(ref: string): { path: string; suffix: string } {
  const m = ref.match(/^([^#?]*)([#?].*)?$/);
  return { path: m?.[1] ?? ref, suffix: m?.[2] ?? "" };
}

/** Resolve a doc-relative ref to a root-relative posix path (collapsing `..`). */
function resolveFrom(docPath: string, ref: string): string {
  return normalize(join(dirname(docPath), ref));
}

/** The relative ref that points from `docPath`'s directory to `target`. */
function relativeTo(docPath: string, target: string): string {
  const rel = relative(dirname(docPath), target);
  // A sibling/descendant comes back bare (`foo.md`, `sub/foo.md`); marked and
  // the wikilink resolver both accept that, so we don't force a `./` prefix.
  return rel === "" ? "." : rel;
}

// ---------------------------------------------------------------------------
// Link scanners. Each yields [fullMatch, refText, replaceFn] so a caller can
// decide whether to rewrite and splice the new ref back into the exact match.
// ---------------------------------------------------------------------------

type LinkHit = {
  /** `md` = `[..](ref)` / `![..](ref)`; `wikilink` = path-qualified `[[a/b]]`. */
  kind: "md" | "wikilink";
  /** The raw ref inside the link (path + any #section/?query). */
  ref: string;
  /** Rebuild the full match with a new ref substituted in. */
  rebuild: (newRef: string) => string;
  /** Char offset of the full match in the source. */
  index: number;
  /** Length of the full match. */
  length: number;
};

// `[text](ref)` and `![alt](ref)` — markdown links and images share this form.
// We capture the optional leading `!`, the bracketed text, and the paren ref.
const MD_LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

// Path-qualified wikilink `[[folder/doc...]]` (and `![[folder/img]]`). Only
// targets that CONTAIN a slash are path-anchored; a bare `[[doc]]` is basename-
// resolved and must not be touched, so the inner pattern requires a `/`.
const QUALIFIED_WIKILINK = /(!?)\[\[([^[\]\n|#]*\/[^[\]\n|#]*)((?:#[^[\]\n|]*)?(?:\|[^[\]\n]*)?)\]\]/g;

function* scanLinks(content: string): Generator<LinkHit> {
  MD_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK.exec(content)) !== null) {
    const [full, bang, text, ref, title = ""] = m;
    yield {
      kind: "md",
      ref: ref!,
      rebuild: (nr) => `${bang}[${text}](${nr}${title})`,
      index: m.index,
      length: full.length,
    };
  }
  QUALIFIED_WIKILINK.lastIndex = 0;
  while ((m = QUALIFIED_WIKILINK.exec(content)) !== null) {
    const [full, bang, target, suffix = ""] = m;
    yield {
      kind: "wikilink",
      ref: target!,
      rebuild: (nr) => `${bang}[[${nr}${suffix}]]`,
      index: m.index,
      length: full.length,
    };
  }
}

// Apply a set of decided rewrites (by offset) to the source in one pass. We
// collect all hits first, then splice right-to-left so earlier offsets stay
// valid. A wikilink target carries no extension; a markdown ref does — the
// per-link decision functions handle that and hand us final ref strings.
function applyRewrites(
  content: string,
  edits: Array<{ index: number; length: number; replacement: string; from: string; to: string }>,
): RewriteResult {
  const rewrites: Rewrite[] = [];
  let out = content;
  for (const e of [...edits].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, e.index) + e.replacement + out.slice(e.index + e.length);
    rewrites.push({ from: e.from, to: e.to });
  }
  rewrites.reverse(); // report in document order
  return { content: out, rewrites };
}

// Resolve a hit's ref to its root-relative target `.md` path. The two link
// kinds resolve DIFFERENTLY, matching how the renderer resolves them:
//   - markdown `[..](ref)` is doc-relative — resolve from the doc's directory.
//   - path-qualified wikilink `[[a/b]]` resolves by path-SUFFIX against the
//     index, i.e. it behaves as a root-relative path, independent of the doc.
// Returns the root-relative `.md` target.
function resolveTarget(hit: LinkHit, refPath: string, docPath: string): string {
  if (hit.kind === "wikilink") {
    const withExt = refPath.endsWith(".md") ? refPath : refPath + ".md";
    return normalize(withExt); // root-relative; doc location irrelevant
  }
  return resolveFrom(docPath, refPath);
}

// Recompute a ref pointing at `target` for a link living in `docPath`, in the
// same form the original used (doc-relative for markdown, root-relative for a
// qualified wikilink; wikilinks carry no `.md`).
function refFor(hit: LinkHit, target: string, docPath: string): string {
  if (hit.kind === "wikilink") {
    return target.endsWith(".md") ? target.slice(0, -3) : target;
  }
  return relativeTo(docPath, target);
}

// Decide a rewrite for one link, given a function that maps an OLD resolved
// target to its NEW resolved target (or null to leave it). Returns an edit or
// null. `resolveDocPath` is whose directory a doc-relative ref resolves from;
// `newDocPath` is whose directory the rewritten ref is computed from (they
// differ for an outbound rebase: resolve from the old location, emit from the
// new one).
function decide(
  hit: LinkHit,
  resolveDocPath: string,
  newDocPath: string,
  remap: (resolvedOld: string) => string | null,
): { index: number; length: number; replacement: string; from: string; to: string } | null {
  const { path: refPath, suffix } = splitSuffix(hit.ref);
  if (!isRelativeRef(refPath)) return null;

  const resolvedOld = resolveTarget(hit, refPath, resolveDocPath);
  const resolvedNew = remap(resolvedOld);
  if (resolvedNew === null) return null;

  const newRef = refFor(hit, resolvedNew, newDocPath) + suffix;
  if (newRef === hit.ref) return null; // resolution unchanged → leave it

  return {
    index: hit.index,
    length: hit.length,
    replacement: hit.rebuild(newRef),
    from: hit.ref,
    to: newRef,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rebase the MOVED file's OWN outbound relative links so they still point at the
 * same targets from its new location.
 *
 * For each relative link/image (and path-qualified wikilink) in `content`,
 * resolve it from `oldPath` to its target, then ask where that target lives
 * after the move: a target inside the moved set (e.g. a sibling in a folder that
 * moves together) goes to its OWN destination via `moved`; a target outside the
 * move stays put. Recompute the ref from `newPath`'s directory. Links whose
 * computed ref is unchanged (a sibling co-moving within the same folder) are
 * left untouched.
 *
 * `moved` maps every co-moving doc's old root-relative path to its new one. For
 * a single-file move it's just `{ oldPath → newPath }`; for a folder move it
 * carries every doc under the folder, so intra-folder links resolve correctly.
 */
export function relinkOutbound(
  content: string,
  oldPath: string,
  newPath: string,
  moved?: Map<string, string>,
): RewriteResult {
  const map = moved ?? new Map([[oldPath, newPath]]);
  const edits = [];
  for (const hit of scanLinks(content)) {
    const edit = decide(hit, oldPath, newPath, (resolvedOld) => map.get(resolvedOld) ?? resolvedOld);
    if (edit) edits.push(edit);
  }
  return applyRewrites(content, edits);
}

/**
 * Rewrite OTHER docs' inbound relative links that point AT the moved file.
 *
 * `content` belongs to `linkingDocPath` (which is NOT moving). For each relative
 * link that resolves to `oldPath`, recompute it to `newPath`. Links pointing
 * elsewhere are left untouched. This is the common case for cross-doc references
 * like `[task](../../tasks/foo.md)`.
 */
export function relinkInbound(
  content: string,
  linkingDocPath: string,
  oldPath: string,
  newPath: string,
): RewriteResult {
  const edits = [];
  for (const hit of scanLinks(content)) {
    const edit = decide(
      hit,
      linkingDocPath,
      linkingDocPath,
      (resolvedOld) => (resolvedOld === oldPath ? newPath : null),
    );
    if (edit) edits.push(edit);
  }
  return applyRewrites(content, edits);
}

/**
 * Does `content` (belonging to `linkingDocPath`) contain any relative link that
 * resolves to `target`? Cheap predicate for the preview scan to decide which
 * docs are inbound linkers before computing the full rewrite.
 */
export function linksTo(content: string, linkingDocPath: string, target: string): boolean {
  for (const hit of scanLinks(content)) {
    const { path: refPath } = splitSuffix(hit.ref);
    if (!isRelativeRef(refPath)) continue;
    if (resolveTarget(hit, refPath, linkingDocPath) === target) return true;
  }
  return false;
}
