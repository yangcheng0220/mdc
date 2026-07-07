/**
 * Markdown → HTML for the document view.
 *
 * Wraps `marked` with a heading renderer that assigns GitHub-style
 * slug IDs to every heading, so same-page `[text](#slug)` and cross-doc
 * `[[file#section]]` links can scroll to the right heading. Slug counts reset
 * per render so duplicate headings dedupe consistently within one document.
 */

import { Marked, type Tokens } from "marked";
import hljs from "highlight.js";

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const DOUBLE_TILDE_DEL = /^~~(?=\S)([\s\S]*?\S)~~(?!~)/;

/** Escape text for safe embedding in HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A heading's text → URL slug (lowercase, punctuation stripped, spaces → -). */
export function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // keep word chars, whitespace, hyphen
    .replace(/\s+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse repeats
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphen
}

/** Render markdown to HTML, assigning deduped slug IDs to headings. */
export function renderMarkdown(md: string): string {
  // Per-render slug counts: repeated heading text → slug, slug-1, slug-2.
  const slugCounts = new Map<string, number>();
  // breaks: a single newline inside a paragraph renders as a line break (not a
  // collapsed space), matching how notes are typically authored and read.
  const marked = new Marked({ breaks: true });
  marked.use({
    tokenizer: {
      del(src: string) {
        const match = DOUBLE_TILDE_DEL.exec(src);
        if (!match) return undefined;
        const raw = match[0];
        const text = match[1]!;
        return {
          type: "del",
          raw,
          text,
          tokens: this.lexer.inlineTokens(text),
        };
      },
    },
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
        const depth = token.depth;
        const inner = this.parser.parseInline(token.tokens);
        let slug = slugify(token.text) || "section";
        const n = slugCounts.get(slug) ?? 0;
        slugCounts.set(slug, n + 1);
        const id = n === 0 ? slug : `${slug}-${n}`;
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      code(token: Tokens.Code) {
        const code = token.text || "";
        const lang = (token.lang || "").trim().split(/\s+/)[0] ?? "";
        // Mermaid: emit a holder with the raw source; it's turned into a diagram
        // after render (see the doc step that runs mermaid).
        if (lang === "mermaid") {
          return `<div class="mermaid">${escapeHtml(code)}</div>`;
        }
        // Syntax-highlight known languages; fall back to a plain block otherwise.
        if (lang && hljs.getLanguage(lang)) {
          const highlighted = hljs.highlight(code, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        }
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href ?? "";
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        // External links (http/https/mailto/…) open in a new browser tab so the
        // app isn't replaced; internal links (relative/.md/#anchor) are left for
        // the in-app click handler to intercept.
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
        }
        return `<a href="${escapeHtml(href)}"${title}>${inner}</a>`;
      },
    },
  });
  const html = marked.parse(md, { async: false });
  return wrapTables(tagTaskListItems(renderHtmlComments(closeSelfClosingNonVoidTags(html))));
}

/**
 * Render block-level `<!-- ... -->` HTML comments as visible muted "note"
 * blocks. mdc is a review tool, so authoring notes (in templates, roadmaps)
 * should be visible for review, not hidden the way browsers normally hide HTML
 * comments. Other raw HTML passes through unchanged. (Inline mid-paragraph
 * comments aren't caught — marked only emits a standalone comment token for
 * block-level ones, which is where authoring notes live.)
 */
function renderHtmlComments(html: string): string {
  return html.replace(/<!--([\s\S]*?)-->/g, (_full, body: string) => {
    const text = escapeHtml(String(body).trim());
    return `<div class="md-note">${text}</div>`;
  });
}

/**
 * HTML treats self-closing syntax as valid only for void elements. Normalize
 * the other tags so a raw embed cannot absorb the rendered content after it.
 */
function closeSelfClosingNonVoidTags(html: string): string {
  return html.replace(
    /<([A-Za-z][\w:-]*)((?:\s+[^<>]*?)?)\s*\/>/g,
    (match: string, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase();
      if (VOID_HTML_TAGS.has(name)) return match;
      return `<${rawName}${attrs}></${rawName}>`;
    },
  );
}

/**
 * Tag GFM task-list items so CSS can suppress their bullet and align the
 * checkbox. marked emits `<li><input type="checkbox"> …` for `- [ ]` / `- [x]`
 * but (unlike GitHub) adds no class, so the `<li>` keeps its default list
 * bullet AND shows the checkbox — a doubled "• ☐" marker. Adding the class lets
 * `.task-list-item` styling drop the bullet. A checked item also gets
 * `task-list-item-checked` so CSS can strike its text through.
 */
function tagTaskListItems(html: string): string {
  // Loose lists (multi-line items) wrap content in <p>, so the checkbox may be
  // <li><p><input…> not <li><input…> — allow an optional <p> between them.
  return html.replace(
    /<li>(\s*(?:<p>\s*)?<input ([^>]*type="checkbox"[^>]*)>)/g,
    (_match, captured: string, attrs: string) => {
      const cls = /\bchecked\b/.test(attrs)
        ? "task-list-item task-list-item-checked"
        : "task-list-item";
      return `<li class="${cls}">${captured}`;
    },
  );
}

/**
 * Wrap each top-level `<table>` in a `.table-wrap` div for horizontal overflow.
 * marked emits bare tables; this gives content tables their scroll container and
 * the class the table styles are scoped to (keeping them off other tables).
 */
function wrapTables(html: string): string {
  return html.replace(
    /<table>([\s\S]*?)<\/table>/g,
    '<div class="table-wrap"><table>$1</table></div>',
  );
}
