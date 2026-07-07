/**
 * Unit tests for the markdown editing commands. The command builders are pure
 * (`EditorState` → `TransactionSpec`), so they're exercised here without a DOM:
 * build a state with a known selection, apply the spec, and assert the
 * resulting document + caret/selection. Covers both the caret (insert) and
 * selection (wrap) paths, plus toggle-off for inline marks.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { commands, filterCommands, type MarkdownCommand } from "../web/src/editor/commands.js";

const byId = (id: string): MarkdownCommand => {
  const c = commands.find((c) => c.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
};

/** Apply a command to `doc` with the selection marked by `|` (caret) or
 *  `[`…`]` (range). Returns the resulting doc and the new main selection. */
function apply(cmd: MarkdownCommand, marked: string) {
  let doc: string;
  let from: number;
  let to: number;
  if (marked.includes("[") && marked.includes("]")) {
    from = marked.indexOf("[");
    to = marked.indexOf("]") - 1;
    doc = marked.replace("[", "").replace("]", "");
  } else {
    from = to = marked.indexOf("|");
    doc = marked.replace("|", "");
  }
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  const spec = cmd.build(state);
  const next = state.update(spec);
  return { doc: next.state.doc.toString(), main: next.state.selection.main };
}

describe("inline marks", () => {
  it("bold wraps a selection", () => {
    expect(apply(byId("bold"), "say [hello] there").doc).toBe("say **hello** there");
  });

  it("bold at a caret inserts markers with the caret between them", () => {
    const { doc, main } = apply(byId("bold"), "say |there");
    expect(doc).toBe("say ****there");
    expect(doc.slice(main.from)).toBe("**there"); // caret sits between the markers
  });

  it("bold toggles OFF when the selection is already bold", () => {
    expect(apply(byId("bold"), "say [**hello**] there").doc).toBe("say hello there");
  });

  it("italic / strikethrough / code wrap correctly", () => {
    expect(apply(byId("italic"), "[x]").doc).toBe("*x*");
    expect(apply(byId("strikethrough"), "[x]").doc).toBe("~~x~~");
    expect(apply(byId("code"), "[x]").doc).toBe("`x`");
  });

  it("strikethrough wraps EACH line of a multi-line selection (markdown can't span ~~ over a newline)", () => {
    expect(apply(byId("strikethrough"), "[a\nb\nc]").doc).toBe("~~a~~\n~~b~~\n~~c~~");
  });

  it("strikethrough skips blank lines and keeps surrounding whitespace outside the markers", () => {
    expect(apply(byId("strikethrough"), "[a\n\n  b  ]").doc).toBe("~~a~~\n\n  ~~b~~  ");
  });

  it("strikethrough toggles a multi-line selection back off", () => {
    expect(apply(byId("strikethrough"), "[~~a~~\n~~b~~]").doc).toBe("a\nb");
  });
});

describe("block commands", () => {
  it("h1 / h2 prefix the line", () => {
    expect(apply(byId("h1"), "Title|").doc).toBe("# Title");
    expect(apply(byId("h2"), "Title|").doc).toBe("## Title");
  });

  it("heading replaces an existing heading rather than stacking", () => {
    expect(apply(byId("h2"), "# Title|").doc).toBe("## Title");
  });

  it("bullet list prefixes; re-applying toggles it off", () => {
    expect(apply(byId("bullet"), "item|").doc).toBe("- item");
    expect(apply(byId("bullet"), "- item|").doc).toBe("item");
  });

  it("places the caret AFTER the marker so typing continues inline", () => {
    // Empty line: caret should land after "- ", not before it.
    const b = apply(byId("bullet"), "|");
    expect(b.doc).toBe("- ");
    expect(b.main.from).toBe(2); // after "- "

    const h = apply(byId("h1"), "|");
    expect(h.doc).toBe("# ");
    expect(h.main.from).toBe(2); // after "# "
  });

  it("bullet inserts AFTER leading indent so nested lines keep their depth", () => {
    expect(apply(byId("bullet"), "  item|").doc).toBe("  - item");
    expect(apply(byId("bullet"), "  - item|").doc).toBe("  item"); // toggle off keeps indent
  });

  it("numbered list numbers each line", () => {
    expect(apply(byId("numbered"), "[a\nb\nc]").doc).toBe("1. a\n2. b\n3. c");
  });

  it("checkbox prefixes with an unchecked box, after indent", () => {
    expect(apply(byId("checkbox"), "todo|").doc).toBe("- [ ] todo");
    expect(apply(byId("checkbox"), "  todo|").doc).toBe("  - [ ] todo");
  });

  it("horizontal rule inserts --- on its own line", () => {
    expect(apply(byId("hr"), "above|").doc).toBe("above\n---\n");
  });

  it("h4/h5/h6 set deeper headings", () => {
    expect(apply(byId("h4"), "x|").doc).toBe("#### x");
    expect(apply(byId("h6"), "x|").doc).toBe("###### x");
  });

  it("table inserts a header + separator + body row", () => {
    expect(apply(byId("table"), "|").doc).toBe("| Column | Column |\n| --- | --- |\n|  |  |\n");
  });

  it("mermaid inserts a fenced mermaid block with caret inside", () => {
    const { doc, main } = apply(byId("mermaid"), "|");
    expect(doc).toBe("```mermaid\n\n```\n");
    expect(doc.slice(0, main.from)).toBe("```mermaid\n"); // caret on the empty middle line
  });

  it("quote prefixes the line", () => {
    expect(apply(byId("quote"), "note|").doc).toBe("> note");
  });

  it("code block fences the caret line", () => {
    const { doc } = apply(byId("codeblock"), "|");
    expect(doc).toBe("```\n\n```\n");
  });
});

describe("links & embeds", () => {
  it("link wraps a selection as the text, caret in the url slot", () => {
    const { doc, main } = apply(byId("link"), "see [here] now");
    expect(doc).toBe("see [here](url) now");
    expect(doc.slice(main.from, main.to)).toBe("url");
  });

  it("link at a caret inserts a full scaffold with text selected", () => {
    const { doc, main } = apply(byId("link"), "|");
    expect(doc).toBe("[text](url)");
    expect(doc.slice(main.from, main.to)).toBe("text");
  });

  it("wikilink and image insert enclosed scaffolds with inner selected", () => {
    const wl = apply(byId("wikilink"), "|");
    expect(wl.doc).toBe("[[doc]]");
    expect(wl.doc.slice(wl.main.from, wl.main.to)).toBe("doc");

    const img = apply(byId("image"), "|");
    expect(img.doc).toBe("![[path]]");
    expect(img.doc.slice(img.main.from, img.main.to)).toBe("path");
  });

  it("wikilink uses the selection as the target when present", () => {
    expect(apply(byId("wikilink"), "[my-note]").doc).toBe("[[my-note]]");
  });
});

describe("filterCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterCommands("")).toHaveLength(commands.length);
  });

  it("matches on label, id, and keywords", () => {
    expect(filterCommands("bold").map((c) => c.id)).toContain("bold");
    expect(filterCommands("h1").map((c) => c.id)).toContain("h1");
    expect(filterCommands("strong").map((c) => c.id)).toContain("bold"); // keyword
    expect(filterCommands("ul").map((c) => c.id)).toContain("bullet"); // keyword
  });
});
