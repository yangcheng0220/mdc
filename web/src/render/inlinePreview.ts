import { Marked } from "marked";
import { presentableDiff } from "@codemirror/merge";
import { findTargetStrict } from "../../../src/anchor.js";
import type { Suggestion } from "../../../src/threads.js";
import { renderMarkdown } from "./markdown.js";

interface IndexedToken {
  tokenIndex: number;
  elementIndex: number | null;
  type: string;
  start: number;
  end: number;
}

export interface BlockRange {
  /** Marked token indexes, end-exclusive; includes intervening space tokens. */
  tokenRange: { from: number; to: number };
  /** Top-level rendered-element indexes, end-exclusive. */
  elementRange: { from: number; to: number };
  /** Raw-markdown offsets of the complete affected blocks, end-exclusive. */
  rawRange: { from: number; to: number };
  rawSlice: string;
  tokenTypes: string[];
  elementCount: number;
}

/**
 * Map a non-empty raw-markdown span to the complete top-level blocks that own it.
 * Marked's space tokens consume separators but emit no element; every other
 * token is assigned one element index. Any lexer/source drift refuses the map.
 */
export function blockRangeForSpan(body: string, start: number, end: number): BlockRange | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length) {
    return null;
  }

  const tokens = new Marked({ breaks: true }).lexer(body);
  const indexed: IndexedToken[] = [];
  let rawCursor = 0;
  let elementCursor = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]!;
    const raw = token.raw ?? "";
    if (raw === "" || body.slice(rawCursor, rawCursor + raw.length) !== raw) return null;
    const emitsElement = token.type !== "space";
    indexed.push({
      tokenIndex,
      elementIndex: emitsElement ? elementCursor : null,
      type: token.type,
      start: rawCursor,
      end: rawCursor + raw.length,
    });
    if (emitsElement) elementCursor += 1;
    rawCursor += raw.length;
  }
  if (rawCursor !== body.length) return null;

  const affected = indexed.filter(
    (token) => token.elementIndex !== null && token.start < end && token.end > start,
  );
  const first = affected[0];
  const last = affected[affected.length - 1];
  if (!first || !last || first.elementIndex === null || last.elementIndex === null) return null;
  // A span that ends in an unowned separator cannot be expanded without
  // guessing which adjacent block should absorb that structural whitespace.
  if (start < first.start || end > last.end) return null;

  return {
    tokenRange: { from: first.tokenIndex, to: last.tokenIndex + 1 },
    elementRange: { from: first.elementIndex, to: last.elementIndex + 1 },
    rawRange: { from: first.start, to: last.end },
    rawSlice: body.slice(first.start, last.end),
    tokenTypes: affected.map((token) => token.type),
    elementCount: elementCursor,
  };
}

export function previewBlocksPair(currentTypes: string[], proposedTypes: string[]): boolean {
  return (
    currentTypes.length > 0 &&
    currentTypes.length === proposedTypes.length &&
    currentTypes.every((type, index) => type === proposedTypes[index])
  );
}

interface TextSpan {
  node: Text;
  start: number;
  end: number;
}

function sourceTextSpans(root: HTMLElement): TextSpan[] {
  const spans: TextSpan[] = [];
  // Deleted text is injected into the proposed DOM. Exclude it from subsequent
  // walks so every diff offset stays in the original proposed-text coordinates.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.parentElement?.closest("[data-preview-injected]") ?? null) === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let cursor = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    spans.push({ node: node as Text, start: cursor, end: cursor + text.length });
    cursor += text.length;
    node = walker.nextNode();
  }
  return spans;
}

function changeMark(kind: "add" | "del", text?: string): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = `suggestion-change ${kind}`;
  if (kind === "del") mark.dataset.previewInjected = "";
  if (text !== undefined) mark.textContent = text;
  return mark;
}

function wrapText(root: HTMLElement, start: number, end: number): void {
  const overlaps = sourceTextSpans(root).filter((span) => span.start < end && span.end > start);
  for (let index = overlaps.length - 1; index >= 0; index -= 1) {
    const span = overlaps[index]!;
    const localStart = Math.max(0, start - span.start);
    const localEnd = Math.min(span.end - span.start, end - span.start);
    let changed = span.node;
    if (localEnd < changed.length) changed.splitText(localEnd);
    if (localStart > 0) changed = changed.splitText(localStart);
    const mark = changeMark("add");
    changed.replaceWith(mark);
    mark.appendChild(changed);
  }
}

function insertText(root: HTMLElement, offset: number, text: string): void {
  if (!text) return;
  const spans = sourceTextSpans(root);
  const mark = changeMark("del", text);
  const at = spans.find((span) => offset >= span.start && offset <= span.end);
  if (!at) {
    root.appendChild(mark);
    return;
  }
  const local = offset - at.start;
  if (local === at.node.length) at.node.after(mark);
  else if (local === 0) at.node.before(mark);
  else at.node.splitText(local).before(mark);
}

function markWordDiff(current: HTMLElement, proposed: HTMLElement): void {
  const currentText = current.textContent ?? "";
  const proposedText = proposed.textContent ?? "";
  const changes = presentableDiff(currentText, proposedText);
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index]!;
    if (change.toB > change.fromB) wrapText(proposed, change.fromB, change.toB);
    if (change.toA > change.fromA) {
      insertText(proposed, change.fromB, currentText.slice(change.fromA, change.toA));
    }
  }
}

function renderedContainer(markdown: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdown(markdown);
  return container;
}

function blockTypes(elements: Element[]): string[] {
  return elements.map((element) => element.tagName.toLowerCase());
}

function stackedSide(kind: "current" | "proposed", content: HTMLDivElement): HTMLDivElement {
  const side = document.createElement("div");
  side.className = `suggestion-preview-side ${kind}`;
  const label = document.createElement("div");
  label.className = "suggestion-preview-label";
  label.textContent = kind === "current" ? "Current" : "Proposed";
  side.appendChild(label);
  if (content.children.length === 0) {
    const deleted = document.createElement("div");
    deleted.className = "suggestion-preview-deleted";
    deleted.textContent = "(deleted)";
    side.appendChild(deleted);
  } else {
    side.append(...Array.from(content.childNodes));
  }
  return side;
}

export interface PinnedPreview {
  container: HTMLDivElement;
  sourceElements: HTMLElement[];
}

/** Build a detached preview and identify the source elements it will replace. */
export function buildPinnedPreview(
  root: HTMLElement,
  body: string,
  rawContent: string,
  suggestion: Suggestion,
): PinnedPreview | null {
  const match = findTargetStrict(suggestion.target, rawContent);
  if (!match || !rawContent.endsWith(body)) return null;
  const bodyOffset = rawContent.length - body.length;
  const start = match.startIdx - bodyOffset;
  const end = start + match.length;
  const range = blockRangeForSpan(body, start, end);
  if (!range) return null;

  const bodyElements = Array.from(root.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && !element.classList.contains("fm-block"),
  );
  // Raw HTML can emit more than one top-level element for one lexer token. The
  // token-to-DOM contract is then ambiguous, so preserve the card-only fallback.
  if (bodyElements.length !== range.elementCount) return null;
  const sourceElements = bodyElements.slice(range.elementRange.from, range.elementRange.to);
  if (sourceElements.length !== range.elementRange.to - range.elementRange.from) return null;

  const relativeStart = start - range.rawRange.from;
  const relativeEnd = end - range.rawRange.from;
  const proposedSlice =
    range.rawSlice.slice(0, relativeStart) +
    suggestion.replacement +
    range.rawSlice.slice(relativeEnd);
  const current = renderedContainer(range.rawSlice);
  const proposed = renderedContainer(proposedSlice);
  const currentElements = Array.from(current.children);
  const proposedElements = Array.from(proposed.children);

  const container = document.createElement("div");
  container.className = "suggestion-preview";
  container.dataset.suggestionPreview = "";
  container.setAttribute("aria-label", "Pinned suggestion preview");
  if (previewBlocksPair(blockTypes(currentElements), blockTypes(proposedElements))) {
    container.classList.add("suggestion-preview-word");
    for (let index = 0; index < proposedElements.length; index += 1) {
      markWordDiff(currentElements[index] as HTMLElement, proposedElements[index] as HTMLElement);
    }
    container.append(...Array.from(proposed.childNodes));
  } else {
    container.classList.add("suggestion-preview-stacked");
    container.append(stackedSide("current", current), stackedSide("proposed", proposed));
  }

  return { container, sourceElements };
}
