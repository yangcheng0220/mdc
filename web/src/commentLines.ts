/**
 * Resolves each comment thread's anchor to a line + character range in the
 * raw markdown — the positions the editor's gutter markers and quote
 * underlines draw from. Threads whose quote no longer matches are skipped.
 */

import { findAnchorMatch, lineOfOffset } from "../../src/anchor.js";
import type { DisplayThread } from "./commentData.js";

export interface CommentLine {
  line: number;
  /** Character range of the anchored quote in the raw text — for the underline
   *  decoration. `to` is exclusive. */
  from: number;
  to: number;
  commentId: string;
}

export interface CommentAnchorY {
  commentId: string;
  /** Y of the anchor line's top edge, relative to the editor's scroll
   *  container — scroll-invariant, re-based by the card layout at place time. */
  y: number;
}

export function resolveCommentLines(rawText: string, threads: DisplayThread[]): CommentLine[] {
  const lines: CommentLine[] = [];
  for (const thread of threads) {
    if (thread.resolved) continue;
    const anchor = thread.top.anchor;
    if (!anchor) continue;
    const match = findAnchorMatch(anchor, rawText);
    if (!match) continue;
    lines.push({
      line: lineOfOffset(rawText, match.startIdx),
      from: match.startIdx,
      to: match.startIdx + match.length,
      commentId: thread.top.id,
    });
  }
  return lines;
}
