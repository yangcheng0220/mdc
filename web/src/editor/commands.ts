/**
 * Markdown editing commands — the single source of truth for both the slash
 * menu and the direct keyboard shortcuts.
 *
 * The logic lives in pure `(state) => TransactionSpec` builders so it's
 * DOM-free and unit-testable against an `EditorState` alone. Each `run`
 * dispatches the built spec to the live view. A command either wraps the
 * current selection or inserts a scaffold at the caret, then places the
 * caret/selection where typing should continue.
 *
 * Inline marks are toggle-aware: applying bold to already-bold text removes the
 * markers instead of nesting them. Block commands act on the line(s) the
 * selection touches.
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { ChangeSpec, EditorState, Line, TransactionSpec } from "@codemirror/state";

export interface MarkdownCommand {
  id: string;
  label: string;
  /** Searchable aliases for the slash menu (e.g. "h1" for Heading 1). */
  keywords?: string[];
  /** Pure transaction builder — testable without a DOM. */
  build: (state: EditorState) => TransactionSpec;
}

// ── Inline marks (wrap selection / insert at caret, toggle-aware) ──

/**
 * Wrap each selection range in `before…after`, or — if a range is already
 * wrapped in exactly those markers — unwrap it. An empty range inserts the
 * markers and drops the caret between them so typing flows into the mark.
 */
function toggleWrap(before: string, after = before) {
  return (state: EditorState): TransactionSpec => {
    // changeByRange maps positions across each range's own edits, so multi-cursor
    // wrapping stays correct without hand-tracking offsets.
    const tr = state.changeByRange((range) => {
      const { from, to } = range;
      const selected = state.sliceDoc(from, to);

      // Empty selection → insert markers, caret between them.
      if (from === to) {
        const caret = from + before.length;
        return {
          changes: { from, insert: before + after },
          range: EditorSelection.cursor(caret),
        };
      }

      // Markers inside the selection → strip them.
      if (
        selected.startsWith(before) &&
        selected.endsWith(after) &&
        selected.length >= before.length + after.length
      ) {
        const inner = selected.slice(before.length, selected.length - after.length);
        return {
          changes: { from, to, insert: inner },
          range: EditorSelection.range(from, from + inner.length),
        };
      }

      // Markers just outside the selection → strip them.
      const outBefore = state.sliceDoc(Math.max(0, from - before.length), from);
      const outAfter = state.sliceDoc(to, Math.min(state.doc.length, to + after.length));
      if (outBefore === before && outAfter === after) {
        return {
          changes: [
            { from: from - before.length, to: from, insert: "" },
            { from: to, to: to + after.length, insert: "" },
          ],
          range: EditorSelection.range(from - before.length, to - before.length),
        };
      }

      // Plain selection → wrap it.
      return {
        changes: { from, to, insert: before + selected + after },
        range: EditorSelection.range(from + before.length, to + before.length),
      };
    });

    return { ...tr, scrollIntoView: true };
  };
}

/**
 * Like `toggleWrap`, but for marks that don't survive a line break in the
 * rendered output (strikethrough): a `~~a\nb~~` span wraps the whole block in a
 * single pair, which markdown does NOT render as struck-through across lines.
 * So a multi-line selection wraps each non-blank line it touches in its own
 * `before…after` pair. A single-line (or sub-line) selection falls through to
 * the normal single-pair `toggleWrap`, preserving its caret/toggle behavior.
 * Toggle-aware: if every non-blank touched line is already wrapped, strip them.
 */
function toggleWrapPerLine(before: string, after = before) {
  const single = toggleWrap(before, after);
  return (state: EditorState): TransactionSpec => {
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    if (startLine.number === endLine.number) return single(state);

    const lines: Line[] = [];
    for (let n = startLine.number; n <= endLine.number; n++) lines.push(state.doc.line(n));
    const nonBlank = lines.filter((l) => l.text.trim().length > 0);
    if (nonBlank.length === 0) return single(state);

    // Wrap the trimmed span of each line, so leading/trailing whitespace stays
    // outside the markers (`  ~~text~~  `, not `~~  text  ~~`).
    const span = (l: Line) => {
      const lead = l.text.match(/^\s*/)?.[0].length ?? 0;
      const trail = l.text.match(/\s*$/)?.[0].length ?? 0;
      return { from: l.from + lead, to: l.to - trail, text: l.text.slice(lead, l.text.length - trail) };
    };
    const allWrapped = nonBlank.every((l) => {
      const s = span(l);
      return (
        s.text.startsWith(before) &&
        s.text.endsWith(after) &&
        s.text.length >= before.length + after.length
      );
    });

    const changes: ChangeSpec[] = [];
    for (const l of nonBlank) {
      const s = span(l);
      if (allWrapped) {
        changes.push(
          { from: s.from, to: s.from + before.length, insert: "" },
          { from: s.to - after.length, to: s.to, insert: "" },
        );
      } else {
        changes.push({ from: s.from, insert: before }, { from: s.to, insert: after });
      }
    }
    // Keep the whole block selected after the edit so a re-toggle is one keystroke.
    const delta = allWrapped ? -(before.length + after.length) : before.length + after.length;
    return {
      changes,
      selection: { anchor: startLine.from, head: endLine.to + delta * nonBlank.length },
      scrollIntoView: true,
    };
  };
}

// ── Block commands (act on the touched line[s]) ──

/** Prefix every line the main selection touches with `prefix` (toggling it off
 *  if all touched lines already carry it). The marker is inserted AFTER each
 *  line's leading indentation, so nested/indented lines keep their depth.
 *  Ordered lists number incrementally. */
function toggleLinePrefix(prefix: string, ordered = false) {
  return (state: EditorState): TransactionSpec => {
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);

    const lines = [];
    for (let n = startLine.number; n <= endLine.number; n++) lines.push(state.doc.line(n));

    // Match the marker as it appears after any leading whitespace.
    const matcher = ordered ? /^(\s*)\d+\.\s/ : new RegExp("^(\\s*)" + escapeRegExp(prefix));
    const allPrefixed = lines.every((l) => matcher.test(l.text));

    const changes: ChangeSpec[] = [];
    let counter = 1;
    // Net character shift applied to the FIRST line, used to place the caret
    // after the marker so the user can type immediately (the default mapping
    // would otherwise leave the caret before an insertion made at its position).
    let firstDelta = 0;
    let first = true;
    for (const line of lines) {
      const indent = line.text.match(/^\s*/)?.[0].length ?? 0;
      const at = line.from + indent; // insertion point: after indentation
      if (allPrefixed) {
        const m = line.text.match(matcher);
        // m[0] includes the indent; strip only the marker part after it.
        if (m) {
          changes.push({ from: at, to: line.from + m[0].length, insert: "" });
          if (first) firstDelta = -(line.from + m[0].length - at);
        }
      } else {
        const ins = ordered ? `${counter++}. ` : prefix;
        changes.push({ from: at, insert: ins });
        if (first) firstDelta = ins.length;
      }
      first = false;
    }
    // Caret after the (added/removed) marker on the first affected line.
    const firstLine = lines[0]!;
    const firstIndent = firstLine.text.match(/^\s*/)?.[0].length ?? 0;
    const caret = firstLine.from + firstIndent + Math.max(0, firstDelta);
    return { changes, selection: { anchor: caret }, scrollIntoView: true };
  };
}

/** Set the touched lines to an ATX heading of `level`, replacing any existing
 *  heading markers (so H1→H2 doesn't stack `# ##`). */
function setHeading(level: number) {
  return (state: EditorState): TransactionSpec => {
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    const marker = "#".repeat(level) + " ";

    const changes: ChangeSpec[] = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = state.doc.line(n);
      const existing = line.text.match(/^#{1,6}\s/);
      const to = line.from + (existing ? existing[0].length : 0);
      changes.push({ from: line.from, to, insert: marker });
    }
    // Caret after the marker on the first line so typing continues the heading.
    return { changes, selection: { anchor: startLine.from + marker.length }, scrollIntoView: true };
  };
}

/** Insert a fenced code block scaffold, caret on the empty middle line. A
 *  selection becomes the fenced body. */
function insertCodeFence(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const lead = range.from === line.from ? "" : "\n";
  const body = state.sliceDoc(range.from, range.to);
  const insert = `${lead}\`\`\`\n${body}\n\`\`\`\n`;
  const caret = range.from + lead.length + 4; // after the opening "```\n"
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: caret + body.length },
    scrollIntoView: true,
  };
}

// ── Links & embeds (insert scaffold, caret in the useful slot) ──

/** Insert `[text](url)`. A selection becomes the link text and the caret lands
 *  in the url slot; otherwise the caret selects the placeholder text. */
function insertLink(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  if (selected) {
    const insert = `[${selected}](url)`;
    const urlFrom = range.from + selected.length + 3; // after "]("
    return {
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: urlFrom, head: urlFrom + 3 },
      scrollIntoView: true,
    };
  }
  const insert = `[text](url)`;
  const textFrom = range.from + 1;
  return {
    changes: { from: range.from, insert },
    selection: { anchor: textFrom, head: textFrom + 4 },
    scrollIntoView: true,
  };
}

/** Build an `enclosed` insertion (`[[…]]` / `![[…]]`) with the inner text
 *  selected for immediate typing. */
function insertEnclosed(open: string, close: string, placeholder: string) {
  return (state: EditorState): TransactionSpec => {
    const range = state.selection.main;
    const selected = state.sliceDoc(range.from, range.to);
    const inner = selected || placeholder;
    const insert = `${open}${inner}${close}`;
    const from = range.from + open.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: from, head: from + inner.length },
      scrollIntoView: true,
    };
  };
}

/** Insert a horizontal rule (`---`) on its own line below the caret line. */
function insertHorizontalRule(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const insert = `${line.text ? "\n" : ""}---\n`;
  const at = line.to;
  return {
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
  };
}

/** Insert a starter table (header + separator + one body row), caret in the
 *  first header cell. Begins on its own line if the caret line has content. */
function insertTable(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const lead = range.from === line.from ? "" : "\n";
  const head = "| Column | Column |";
  const insert = `${lead}${head}\n| --- | --- |\n|  |  |\n`;
  const cellFrom = range.from + lead.length + 2; // inside the first header cell
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: cellFrom, head: cellFrom + 6 }, // selects "Column"
    scrollIntoView: true,
  };
}

/** Insert a ```mermaid fenced block, caret on the empty middle line. */
function insertMermaid(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const lead = range.from === line.from ? "" : "\n";
  const insert = `${lead}\`\`\`mermaid\n\n\`\`\`\n`;
  const caret = range.from + lead.length + 11; // after "```mermaid\n"
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: caret },
    scrollIntoView: true,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── The command registry ──

export const commands: MarkdownCommand[] = [
  { id: "bold", label: "Bold", keywords: ["strong", "b"], build: toggleWrap("**") },
  { id: "italic", label: "Italic", keywords: ["em", "i"], build: toggleWrap("*") },
  { id: "strikethrough", label: "Strikethrough", keywords: ["strike", "del"], build: toggleWrapPerLine("~~") },
  { id: "code", label: "Inline code", keywords: ["mono"], build: toggleWrap("`") },
  { id: "h1", label: "Heading 1", keywords: ["#", "title"], build: setHeading(1) },
  { id: "h2", label: "Heading 2", keywords: ["##"], build: setHeading(2) },
  { id: "h3", label: "Heading 3", keywords: ["###"], build: setHeading(3) },
  { id: "h4", label: "Heading 4", keywords: ["####"], build: setHeading(4) },
  { id: "h5", label: "Heading 5", keywords: ["#####"], build: setHeading(5) },
  { id: "h6", label: "Heading 6", keywords: ["######"], build: setHeading(6) },
  { id: "bullet", label: "Bullet list", keywords: ["ul", "unordered", "-"], build: toggleLinePrefix("- ") },
  { id: "numbered", label: "Numbered list", keywords: ["ol", "ordered", "1."], build: toggleLinePrefix("1. ", true) },
  { id: "checkbox", label: "Checkbox", keywords: ["task", "todo", "check", "[ ]"], build: toggleLinePrefix("- [ ] ") },
  { id: "quote", label: "Quote", keywords: ["blockquote", ">"], build: toggleLinePrefix("> ") },
  { id: "codeblock", label: "Code block", keywords: ["fence", "```", "pre"], build: insertCodeFence },
  { id: "table", label: "Table", keywords: ["grid", "rows", "columns"], build: insertTable },
  { id: "mermaid", label: "Mermaid diagram", keywords: ["diagram", "flowchart", "chart"], build: insertMermaid },
  { id: "hr", label: "Horizontal rule", keywords: ["divider", "---", "rule", "separator"], build: insertHorizontalRule },
  { id: "link", label: "Link", keywords: ["url", "href"], build: insertLink },
  { id: "wikilink", label: "Wikilink", keywords: ["[[", "internal"], build: insertEnclosed("[[", "]]", "doc") },
  { id: "image", label: "Image", keywords: ["embed", "![[", "img"], build: insertEnclosed("![[", "]]", "path") },
];

/** Apply a command to the live editor: build the spec from current state,
 *  dispatch it, and refocus. */
export function runCommand(cmd: MarkdownCommand, view: EditorView): void {
  view.dispatch(cmd.build(view.state));
  view.focus();
}

/** Filter commands for the slash menu by a typed query (matches label, id, and keywords). */
export function filterCommands(query: string): MarkdownCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.id.includes(q) ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  );
}
