/**
 * The CodeMirror extension stack for edit mode: markdown language + syntax
 * highlighting, 4-space indent, line wrapping, and the keybindings that must
 * win over CodeMirror's defaults.
 */

import { indentWithTab } from "@codemirror/commands";
import { insertNewlineContinueMarkup, deleteMarkupBackward, markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdownHighlightExtension } from "./markdownHighlight.js";

export function createEditorExtensions(openPalette: () => void) {
  return [
    EditorView.lineWrapping,
    // 4-space indent: markdown needs 4 spaces to nest ORDERED lists (2 nests
    // bullets but flattens numbered lists in the renderer). Tab/continuation
    // both follow this unit, so nesting in the editor matches view mode.
    indentUnit.of("    "),
    markdown(),
    markdownHighlightExtension,
    // Prec.highest so ⌘/ opens the palette instead of CodeMirror's default
    // Mod-/ = toggleComment (which otherwise shadows it).
    Prec.highest(
      keymap.of([
        {
          key: "Mod-/",
          preventDefault: true,
          run: () => {
            openPalette();
            return true;
          },
        },
      ]),
    ),
    keymap.of([
      // Enter continues a list/quote marker (numbered lists auto-increment);
      // Backspace on an empty marker removes it.
      { key: "Enter", run: insertNewlineContinueMarkup },
      { key: "Backspace", run: deleteMarkupBackward },
      indentWithTab,
    ]),
  ];
}
