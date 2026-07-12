import { markdown } from "@codemirror/lang-markdown";
import { highlightingFor } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree, tags, type Tag } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { createEditorExtensions } from "./extensions.js";
import { markdownHighlightSpecs, markdownHighlightStyle } from "./markdownHighlight.js";
import { transientSetextHeadingExtension } from "./transientSetextHeading.js";

const editorMarkdownParser = markdown({ extensions: transientSetextHeadingExtension }).language.parser;

const requiredTags = [
  tags.heading1,
  tags.heading2,
  tags.heading3,
  tags.heading4,
  tags.heading5,
  tags.heading6,
  tags.strong,
  tags.emphasis,
  tags.monospace,
  tags.contentSeparator,
  tags.link,
  tags.url,
  tags.quote,
  tags.processingInstruction,
  tags.meta,
];

function specHasTag(tag: Tag) {
  return markdownHighlightSpecs.some((spec) => {
    const specTags = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
    return specTags.includes(tag);
  });
}

function classFor(tag: Tag) {
  const cls = markdownHighlightStyle.style([tag]);
  expect(cls).toBeTruthy();
  return cls!;
}

function hasClass(classList: string, cls: string) {
  return cls.split(/\s+/).every((part) => classList.split(/\s+/).includes(part));
}

describe("markdown editor highlighting", () => {
  it("registers syntax highlighting in the editor extension set", () => {
    const state = EditorState.create({ extensions: createEditorExtensions(() => {}) });

    expect(highlightingFor(state, [tags.heading1])).toBe(classFor(tags.heading1));
  });

  it("covers the markdown tags used by the edit-mode highlight vocabulary", () => {
    for (const tag of requiredTags) {
      expect(specHasTag(tag)).toBe(true);
    }
  });

  it("uses token variables instead of color literals", () => {
    for (const spec of markdownHighlightSpecs) {
      for (const [property, value] of Object.entries(spec)) {
        if (!property.toLowerCase().includes("color")) continue;

        expect(value).toMatch(/^var\(--[a-z-]+\)$/);
        expect(value).not.toMatch(/#|rgb\(|rgba\(|hsl\(|hsla\(/i);
      }
    }
  });

  it("maps parsed markdown tokens to the configured classes", () => {
    const doc = [
      "# Heading",
      "**bold** and *emphasis* with `code`",
      "[link](target.md)",
      "> quote",
      "- item",
      "```",
      "fenced",
      "```",
    ].join("\n");
    const ranges: Array<{ text: string; classes: string }> = [];

    highlightTree(editorMarkdownParser.parse(doc), markdownHighlightStyle, (from, to, classes) => {
      ranges.push({ text: doc.slice(from, to), classes });
    });

    expect(ranges).toContainEqual(expect.objectContaining({ text: " Heading", classes: classFor(tags.heading1) }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: "bold", classes: classFor(tags.strong) }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: "emphasis", classes: classFor(tags.emphasis) }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: "code", classes: classFor(tags.monospace) }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: "link", classes: classFor(tags.link) }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: "target.md", classes: `${classFor(tags.link)} ${classFor(tags.url)}` }));
    expect(ranges).toContainEqual(expect.objectContaining({ text: ">", classes: `${classFor(tags.quote)} ${classFor(tags.processingInstruction)}` }));
    // The list marker gets the punctuation class; tags.list is deliberately
    // unstyled (it spans the whole item, so styling it would dim the item text).
    expect(ranges.some((range) => range.text === "-" && hasClass(range.classes, classFor(tags.processingInstruction)))).toBe(true);
    expect(ranges.some((range) => range.text.includes("fenced") && hasClass(range.classes, classFor(tags.monospace)))).toBe(true);
    expect(ranges.some((range) => range.text === "#" && hasClass(range.classes, classFor(tags.processingInstruction)))).toBe(true);
  });

  it.each(["text\n-", "text\n- "])("keeps a transient empty bullet out of setext heading styling: %j", (doc) => {
    const ranges: Array<{ text: string; classes: string }> = [];
    highlightTree(editorMarkdownParser.parse(doc), markdownHighlightStyle, (from, to, classes) => {
      ranges.push({ text: doc.slice(from, to), classes });
    });

    expect(editorMarkdownParser.parse(doc).toString()).toBe("Document(Paragraph(ListMark))");
    expect(ranges.some((range) => hasClass(range.classes, classFor(tags.heading2)))).toBe(false);
    expect(ranges.some((range) => range.text === "-" && hasClass(range.classes, classFor(tags.processingInstruction)))).toBe(true);
  });

  it("keeps completed lists and setext headings aligned with their final Markdown shape", () => {
    const listDoc = "text\n- x";
    const listTree = editorMarkdownParser.parse(listDoc);
    expect(listTree.toString()).toContain("BulletList");

    const headingDoc = "text\n---";
    const headingTree = editorMarkdownParser.parse(headingDoc);
    expect(headingTree.toString()).toBe("Document(SetextHeading2(HeaderMark))");

    const headingRanges: Array<{ text: string; classes: string }> = [];
    highlightTree(headingTree, markdownHighlightStyle, (from, to, classes) => {
      headingRanges.push({ text: headingDoc.slice(from, to), classes });
    });
    expect(headingRanges.some((range) => hasClass(range.classes, classFor(tags.heading2)))).toBe(true);
  });
});
