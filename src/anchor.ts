/**
 * Edit-aware anchor resolution — where a stored anchor lives in the current
 * text, if anywhere.
 *
 * Priority:
 *   (0) anchor.context present → match quote+context as a unique fingerprint.
 *       Unique hit → live there. Zero or multiple → orphan. No line tiebreak,
 *       no nearest-twin fallback: the fingerprint either pins the right
 *       occurrence or the comment orphans. This is the drift-proof path.
 *   (1) unique exact quote match → use it.
 *   (2) legacy multi-occurrence (no context) → nearest anchor.line, but ONLY
 *       within LEGACY_DRIFT_CEILING lines; beyond that → orphan (so even old
 *       comments fail safe instead of jumping to a far twin).
 *   (3) no exact match → bounded fuzzy recovery (whitespace-normalized, then
 *       markdown-stripped) if it yields a UNIQUE near-match; else null.
 *
 * Conservative by design — prefer a false orphan over a false match, since a
 * mis-anchored comment is worse than a missing one.
 *
 * The text being matched against is the caller's choice: the CLI resolves
 * against the raw markdown (exact line counting); a rendered view can inject
 * its own offset→line mapper via `lineOf`.
 */

import type { Anchor } from "./sidecar.js";

/**
 * Max line distance a legacy (no-context) multi-occurrence match may sit from
 * its stored anchor.line before we treat it as drift and orphan instead. Only
 * applies to old comments saved without a context fingerprint; new comments
 * disambiguate by context and never reach this branch.
 */
export const LEGACY_DRIFT_CEILING = 25;

export interface AnchorMatch {
  startIdx: number;
  length: number;
  /** True when the match needed fuzzy/normalized recovery (text changed). */
  recovered: boolean;
}

export interface MatchOptions {
  /** Offset→1-indexed-line mapper; defaults to exact newline counting. */
  lineOf?: (text: string, offset: number) => number;
}

/** Every index where `needle` occurs in `hay`. */
export function allIndexesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/** Exact 1-indexed line of a character offset in raw text. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Strip inline markdown (links, bold, italics, code) from a quote. */
export function stripInlineMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^_])_([^_]+)_/g, "$1$2");
}

/** The marker forms stripMdMapped removes: [regex, length of the marker
 *  prefix before the kept capture group]. A regex either has exactly ONE
 *  capture group (kept content) at a fixed offset from the match start, or no
 *  group at all (the whole match is deleted). */
const MD_STRIP_PATTERNS: Array<[RegExp, number]> = [
  // Line-leading BLOCK markers first (checkbox before plain list — it's a
  // superset). Rendered text never contains them, and a quote that spans two
  // blocks joins them with just a newline — so the raw side must drop the
  // next block's marker prefix for the join to line up. No capture group =
  // pure deletion.
  [/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, 0],
  [/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, 0],
  [/^[ \t]*#{1,6}[ \t]+/gm, 0],
  [/^[ \t]*>[ \t]?/gm, 0],
  // Inline markers. \n excluded everywhere: an inline span never crosses a
  // line here, and a multi-line class would pair a lone marker (the _ in a
  // snake_case word) with an unrelated one far down the doc, mangling
  // everything between.
  [/\[([^\]\n]+)\]\([^)\n]*\)/g, 1], // [text](url) → text
  [/\*\*([^*\n]+)\*\*/g, 2],
  [/(?<!\*)\*([^*\n]+)\*/g, 1],
  [/`([^`\n]+)`/g, 1],
  [/(?<!_)_([^_\n]+)_/g, 1],
];

/** One marker-unwrapping pass: replace each match of `re` with its capture
 *  group, tracking map[outIdx] = originalIdx (with an end sentinel). */
function replaceMapped(s: string, re: RegExp, prefixLen: number): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    const start = m.index;
    for (let i = last; i < start; i++) {
      map.push(i);
      out += s[i];
    }
    const kept = m[1] ?? "";
    for (let i = 0; i < kept.length; i++) {
      map.push(start + prefixLen + i);
      out += kept[i];
    }
    last = start + m[0].length;
  }
  for (let i = last; i < s.length; i++) {
    map.push(i);
    out += s[i];
  }
  map.push(s.length); // sentinel for end mapping
  return { text: out, map };
}

/**
 * Strip markdown decoration (inline markers + line-leading block markers) from
 * a FULL text, returning the stripped string plus a map from stripped-offset →
 * original-offset — so a match found in the stripped view converts back to a
 * range in the original text. Runs passes to a fixpoint so nested markers
 * (bold wrapping code, etc.) unwrap fully.
 */
export function stripMdMapped(s: string): { text: string; map: number[] } {
  let text = s;
  let map: number[] | null = null; // null = identity so far
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [re, prefixLen] of MD_STRIP_PATTERNS) {
      const r = replaceMapped(text, re, prefixLen);
      if (r.text === text) continue;
      changed = true;
      const prev: number[] | null = map;
      map = prev === null ? r.map : r.map.map((idx) => prev[idx]!);
      text = r.text;
    }
    if (!changed) break;
  }
  if (map === null) map = Array.from({ length: s.length + 1 }, (_, i) => i);
  return { text, map };
}

/**
 * Collapse runs of whitespace to single spaces, returning the transformed
 * string plus a map from transformed-offset → original-offset.
 */
export function collapseWs(s: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = []; // map[transformedIndex] = originalIndex
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const isSpace = /\s/.test(s[i]!);
    if (isSpace) {
      if (prevSpace) continue;
      map.push(i);
      out += " ";
      prevSpace = true;
    } else {
      map.push(i);
      out += s[i];
      prevSpace = false;
    }
  }
  map.push(s.length); // sentinel for end mapping
  return { text: out, map };
}

/**
 * Bounded fuzzy match: whitespace-normalize both sides, require a UNIQUE hit,
 * then map the normalized hit back to original full-text offsets. Also tries a
 * markdown-stripped variant of the quote. Returns a match against the ORIGINAL
 * fullText (so range offsets stay valid) or null.
 */
export function fuzzyFind(fullText: string, quote: string): AnchorMatch | null {
  const { text: ftNorm, map } = collapseWs(fullText);

  for (const candidate of [quote, stripInlineMd(quote)]) {
    const qNorm = collapseWs(candidate).text.trim();
    if (!qNorm) continue;
    const hits = allIndexesOf(ftNorm, qNorm);
    if (hits.length !== 1) continue; // ambiguous or none → don't guess
    const startIdx = map[hits[0]!];
    const endIdx = map[hits[0]! + qNorm.length];
    if (startIdx == null || endIdx == null || endIdx <= startIdx) continue;
    return { startIdx, length: endIdx - startIdx, recovered: true };
  }
  return null;
}

/**
 * Match an anchor by its stored context fingerprint (before + quote + after).
 * Returns the range of the QUOTE within the unique fingerprint hit, or null.
 * Tries an exact fingerprint match first, then a whitespace-normalized one (so
 * edits that only reflow whitespace near the quote still match). Requires a
 * UNIQUE hit at every stage — anything ambiguous orphans rather than guesses.
 */
function matchByContext(anchor: Anchor, fullText: string): AnchorMatch | null {
  const q = anchor.quote;
  const before = anchor.context?.before ?? "";
  const after = anchor.context?.after ?? "";
  const fingerprint = before + q + after;

  // Exact fingerprint.
  const exact = allIndexesOf(fullText, fingerprint);
  if (exact.length === 1) {
    const startIdx = exact[0]! + before.length;
    return { startIdx, length: q.length, recovered: false };
  }
  if (exact.length > 1) return null; // duplicated region incl. context → orphan

  // Whitespace-normalized fingerprint (mirrors fuzzyFind's tolerance). Map the
  // normalized hit back to original offsets, then re-locate the quote inside.
  const { text: ftNorm, map } = collapseWs(fullText);
  const fpNorm = collapseWs(fingerprint).text.trim();
  if (!fpNorm) return null;
  const hits = allIndexesOf(ftNorm, fpNorm);
  if (hits.length !== 1) return null;
  const fpStart = map[hits[0]!];
  const fpEnd = map[hits[0]! + fpNorm.length];
  if (fpStart == null || fpEnd == null || fpEnd <= fpStart) return null;
  // Find the quote within the recovered fingerprint span. The span is ORIGINAL
  // text (may carry reflowed whitespace), so re-search on its normalized form
  // and map back — a plain indexOf would miss a whitespace-drifted quote.
  const span = fullText.slice(fpStart, fpEnd);
  const { text: spanNorm, map: spanMap } = collapseWs(span);
  const qNorm = collapseWs(q).text.trim();
  if (!qNorm) return null;
  const within = allIndexesOf(spanNorm, qNorm);
  if (within.length !== 1) return null;
  const qStart = spanMap[within[0]!];
  const qEnd = spanMap[within[0]! + qNorm.length];
  if (qStart == null || qEnd == null || qEnd <= qStart) return null;
  return { startIdx: fpStart + qStart, length: qEnd - qStart, recovered: true };
}

/**
 * Edit-aware anchor matching. Returns { startIdx, length, recovered } or null
 * (the anchor is orphaned in this text).
 *
 * Quotes are captured from RENDERED text, so when the text being searched is
 * raw markdown, inline markers (**bold**, `code`, links) inside the quoted
 * span defeat every direct stage. If direct matching fails, retry against a
 * marker-stripped view of the text and map the hit back to original offsets —
 * same uniqueness discipline, so it stays prefer-orphan-over-mis-anchor.
 */
export function findAnchorMatch(
  anchor: Anchor,
  fullText: string,
  opts: MatchOptions = {},
): AnchorMatch | null {
  const direct = matchInText(anchor, fullText, opts);
  if (direct) return direct;
  const { text: stripped, map } = stripMdMapped(fullText);
  if (stripped === fullText) return null;
  const m = matchInText(anchor, stripped, opts);
  if (!m || m.length === 0) return null;
  // End maps from the LAST included character (+1), not the next stripped
  // offset — the next offset sits past any closing marker, which would drag a
  // trailing ** or ` into the range.
  const startIdx = map[m.startIdx];
  const lastIdx = map[m.startIdx + m.length - 1];
  if (startIdx == null || lastIdx == null || lastIdx < startIdx) return null;
  return { startIdx, length: lastIdx + 1 - startIdx, recovered: true };
}

function matchInText(
  anchor: Anchor,
  fullText: string,
  opts: MatchOptions = {},
): AnchorMatch | null {
  const q = anchor.quote;
  if (!q) return null;

  // (0) Context fingerprint — the drift-proof path for new comments.
  if (anchor.context && (anchor.context.before || anchor.context.after)) {
    return matchByContext(anchor, fullText);
  }

  const exact = allIndexesOf(fullText, q);
  if (exact.length === 1) {
    return { startIdx: exact[0]!, length: q.length, recovered: false };
  }
  if (exact.length > 1) {
    // Legacy multi-occurrence: disambiguate by stored line. Without a line we
    // can't tell them apart, so fall back to the first (prior behavior).
    if (typeof anchor.line !== "number") {
      return { startIdx: exact[0]!, length: q.length, recovered: false };
    }
    const lineOf = opts.lineOf ?? lineOfOffset;
    let best = exact[0]!;
    let bestDelta = Infinity;
    for (const idx of exact) {
      const delta = Math.abs(lineOf(fullText, idx) - anchor.line);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = idx;
      }
    }
    // Drift ceiling: if even the nearest surviving occurrence is far from
    // where this comment was placed, the anchored copy was likely edited away
    // and we're about to jump to an unrelated twin. Orphan instead.
    if (bestDelta > LEGACY_DRIFT_CEILING) return null;
    return { startIdx: best, length: q.length, recovered: false };
  }

  // No exact match — the text changed. Try bounded fuzzy recovery against a
  // whitespace-collapsed view of the doc.
  return fuzzyFind(fullText, q);
}
