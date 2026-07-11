import { findTargetStrict } from "./anchor.js";
import type { Suggestion } from "./threads.js";

export type ApplySuggestionResult =
  | { ok: true; content: string }
  | { ok: false; reason: "target-not-found" };

/** Apply a suggestion only when its raw target fingerprint still matches once. */
export function applySuggestion(
  rawText: string,
  suggestion: Suggestion,
): ApplySuggestionResult {
  const match = findTargetStrict(suggestion.target, rawText);
  if (!match) return { ok: false, reason: "target-not-found" };
  return {
    ok: true,
    content:
      rawText.slice(0, match.startIdx) +
      suggestion.replacement +
      rawText.slice(match.startIdx + match.length),
  };
}
