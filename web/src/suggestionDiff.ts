import { presentableDiff, type Change } from "@codemirror/merge";

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
