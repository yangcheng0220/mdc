import { presentableDiff, type Change } from "@codemirror/merge";

/** A card stays expanded through ten source/proposed lines. */
const SUGGESTION_DIFF_COLLAPSE_THRESHOLD = 10;

export interface DiffPart {
  text: string;
  changed: boolean;
}

function split(
  text: string,
  changes: readonly Change[],
  side: "current" | "proposed",
): DiffPart[] {
  const parts: DiffPart[] = [];
  let cursor = 0;
  for (const change of changes) {
    const from = side === "current" ? change.fromA : change.fromB;
    const to = side === "current" ? change.toA : change.toB;
    if (from > cursor) parts.push({ text: text.slice(cursor, from), changed: false });
    if (to > from) parts.push({ text: text.slice(from, to), changed: true });
    cursor = to;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), changed: false });
  return parts;
}

export function shapeSuggestionDiff(current: string, proposed: string) {
  const changes = presentableDiff(current, proposed);
  return {
    current: split(current, changes, "current"),
    proposed: split(proposed, changes, "proposed"),
  };
}

function lineCount(text: string): number {
  return text === "" ? 0 : text.split(/\r?\n/).length;
}

export interface SuggestionDiffLineCounts {
  added: number;
  removed: number;
  total: number;
}

/** Count the source/proposed lines represented by a suggestion card. */
export function suggestionDiffLineCounts(
  current: string,
  proposed: string,
): SuggestionDiffLineCounts {
  const removed = lineCount(current);
  const added = lineCount(proposed);
  return { added, removed, total: added + removed };
}

/** Large actionable diffs use the compact card summary and in-document preview. */
export function shouldCollapseSuggestionDiff(current: string, proposed: string): boolean {
  return suggestionDiffLineCounts(current, proposed).total > SUGGESTION_DIFF_COLLAPSE_THRESHOLD;
}
