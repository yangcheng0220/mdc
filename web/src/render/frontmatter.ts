/**
 * Frontmatter parsing: split a leading `---` block off the document and parse
 * it into key/value rows for the Properties table. Each row carries the source
 * file line so a comment can later anchor to it.
 */

export interface FmRow {
  key: string;
  value: string;
  line: number; // 1-indexed line in the source file
}

export interface ParsedFrontmatter {
  rows: FmRow[];
  body: string; // the document content after the frontmatter block
  /** File lines the frontmatter occupies (opening --- through closing ---). */
  lineCount: number;
}

/** Strip surrounding matching quotes from a scalar value. */
function displayYamlValue(v: string): string {
  if (!v) return v;
  const t = v.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1);
    }
  }
  return v;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The "Properties" block as an HTML string, for injection into the doc root (so
 * its text is selectable, anchorable, and part of the highlight offset map).
 * Each row carries `data-line` for line-anchored comments. The collapse toggle
 * is wired imperatively by the caller (the `.fm-header[data-fm-toggle]` hook).
 */
export function fmBlockHtml(rows: FmRow[], collapsed: boolean): string {
  if (rows.length === 0) return "";
  const chevron =
    `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ` +
    `stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<polyline points="6 9 12 15 18 9"/></svg>`;
  const header =
    `<div class="fm-header" data-fm-toggle>` +
    `<span class="fm-chevron">${chevron}</span>` +
    `<span class="fm-title">Properties</span></div>`;
  const body = rows
    .map(
      (r) =>
        `<tr data-line="${r.line}"><td class="fm-key">${esc(r.key)}</td>` +
        `<td class="fm-val">${esc(displayYamlValue(r.value))}</td></tr>`,
    )
    .join("");
  return (
    `<div class="fm-block${collapsed ? " collapsed" : ""}">` +
    header +
    `<table class="fm-table"><tbody>${body}</tbody></table></div>`
  );
}

/** Parse the text between the opening and closing `---` into key/value rows. */
function parseFrontmatterRows(fmBlock: string): FmRow[] {
  const rows: FmRow[] = [];
  fmBlock.split("\n").forEach((rawLine, i) => {
    const fileLine = i + 2; // +1 for 1-indexing, +1 because opening --- is line 1
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) return;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      rows.push({ key: m[1]!, value: m[2]!, line: fileLine });
    } else if (rows.length > 0) {
      // Continuation line — fold into the previous row's value.
      const prev = rows[rows.length - 1]!;
      prev.value = prev.value ? prev.value + "\n" + line.trim() : line.trim();
    }
  });
  return rows;
}

/** Split a document into its frontmatter rows and the remaining body. */
export function parseFrontmatter(md: string): ParsedFrontmatter {
  if (!md.startsWith("---\n")) return { rows: [], body: md, lineCount: 0 };
  const endIdx = md.indexOf("\n---", 4);
  if (endIdx === -1) return { rows: [], body: md, lineCount: 0 };

  const fmBlock = md.slice(4, endIdx); // between opening --- and closing ---
  const body = md.slice(endIdx + 4).replace(/^\n/, ""); // skip '\n---'
  const lineCount = md.slice(0, endIdx + 1).split("\n").length; // through closing ---
  const rows = parseFrontmatterRows(fmBlock);
  if (rows.length === 0) return { rows: [], body, lineCount };
  return { rows, body, lineCount };
}
