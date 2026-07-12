/**
 * Keeps a bare dash in the middle of typing from restyling the preceding
 * paragraph as a setext heading. Once text follows the dash, the regular
 * Markdown list parser takes over; longer underlines keep CommonMark's
 * setext-heading behavior.
 */

import type {
  BlockContext,
  BlockParser,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownExtension,
} from "@lezer/markdown";

const transientSetextHeading: BlockParser = {
  name: "TransientSetextHeading",
  before: "SetextHeading",
  leaf(): LeafBlockParser {
    return {
      nextLine(cx: BlockContext, line: Line, leaf: LeafBlock) {
        if (!/^-[ \t]*$/.test(line.text.slice(line.pos))) return false;

        const markerFrom = cx.lineStart + line.pos;
        const children = [
          ...cx.parser.parseInline(leaf.content, leaf.start),
          cx.elt("ListMark", markerFrom, markerFrom + 1),
        ];

        cx.nextLine();
        cx.addLeafElement(leaf, cx.elt("Paragraph", leaf.start, cx.prevLineEnd(), children));
        return true;
      },
      finish() {
        return false;
      },
    };
  },
};

export const transientSetextHeadingExtension: MarkdownExtension = {
  parseBlock: [transientSetextHeading],
};
