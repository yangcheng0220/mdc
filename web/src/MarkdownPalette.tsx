/**
 * Markdown command palette (⌘/). A centered modal — the editing counterpart to
 * the ⌘K file-jump — that lists the markdown commands, filters as you type, and
 * applies the chosen one to the editor's current selection (wrap) or caret
 * (insert). One surface covers both insert-then-type and select-then-format, so
 * no per-command shortcuts are needed: the only thing to learn is ⌘/.
 *
 * The shared palette shell supplies the backdrop, input, list, and footer
 * structure; this component supplies the markdown command registry.
 */

import { PaletteShell } from "./PaletteShell.js";
import { commands, type MarkdownCommand } from "./editor/commands.js";

function filterCommands(items: readonly MarkdownCommand[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.id.includes(q) ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  );
}

export function MarkdownPalette({
  onClose,
  onRun,
}: {
  onClose: () => void;
  /** Apply a command to the editor, then the palette closes. */
  onRun: (cmd: MarkdownCommand) => void;
}) {
  return (
    <PaletteShell
      items={commands}
      filterItems={filterCommands}
      getKey={(cmd) => cmd.id}
      renderItem={(cmd) => <span className="cmdk-item-name">{cmd.label}</span>}
      emptyMessage={(query) => `No commands match "${query}"`}
      footer={
        <>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> apply
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </>
      }
      placeholder="Insert markdown..."
      hintBadge="⌘/"
      ariaLabel="Insert markdown"
      onClose={onClose}
      onPick={onRun}
    />
  );
}
