/**
 * Outline pane: the active document's heading hierarchy as a collapsible tree,
 * click-to-scroll. A custom view (not the file tree) because every node is both
 * a scroll target and possibly a fold parent, and nesting is by heading depth,
 * not path — but it borrows the nav's row vocabulary so it reads as a sibling.
 *
 * Headings come from the live source text, so the outline tracks edits as you
 * type. Scrolling targets the rendered doc by `#slug`; in edit mode there's no
 * rendered doc to scroll, so rows are inert there (the outline still updates).
 */

import { useMemo } from "react";
import { CaretIcon } from "./icons.js";
import { buildOutlineTree, extractHeadings, type OutlineNode } from "./outline.js";

export function OutlinePane({
  content,
  hasFile,
  canScroll,
  folded,
  onToggleFold,
  onScrollToHeading,
}: {
  /** Live markdown source of the active doc, or null when none is open. */
  content: string | null;
  hasFile: boolean;
  /** Whether clicking a row can scroll (false in edit mode — no rendered doc). */
  canScroll: boolean;
  /** Folded-heading set (by slug), owned by Nav so it survives pane switches. */
  folded: Set<string>;
  onToggleFold: (slug: string) => void;
  onScrollToHeading: (slug: string) => void;
}) {
  const tree = useMemo(
    () => (content ? buildOutlineTree(extractHeadings(content)) : []),
    [content],
  );

  if (!hasFile) {
    return <div className="outline-empty">Open a doc to see its outline</div>;
  }
  if (tree.length === 0) {
    return <div className="outline-empty">No headings</div>;
  }

  return (
    <div className="outline-tree">
      <OutlineLevel
        nodes={tree}
        depth={0}
        folded={folded}
        canScroll={canScroll}
        onToggleFold={onToggleFold}
        onScrollToHeading={onScrollToHeading}
      />
    </div>
  );
}

function OutlineLevel({
  nodes,
  depth,
  folded,
  canScroll,
  onToggleFold,
  onScrollToHeading,
}: {
  nodes: OutlineNode[];
  depth: number;
  folded: Set<string>;
  canScroll: boolean;
  onToggleFold: (slug: string) => void;
  onScrollToHeading: (slug: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isFolded = folded.has(node.slug);
        return (
          <div key={node.slug}>
            <div
              className={`outline-row${canScroll ? "" : " inert"}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={canScroll ? node.text : "Switch to view mode to jump to a heading"}
              onClick={() => canScroll && onScrollToHeading(node.slug)}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className={`outline-caret${isFolded ? " folded" : ""}`}
                  aria-label={isFolded ? "Expand" : "Collapse"}
                  onClick={(e) => {
                    e.stopPropagation(); // fold only — don't also scroll
                    onToggleFold(node.slug);
                  }}
                >
                  <CaretIcon size={11} />
                </button>
              ) : (
                <span className="outline-caret-spacer" />
              )}
              <span className="outline-text">{node.text}</span>
            </div>
            {hasChildren && !isFolded && (
              <OutlineLevel
                nodes={node.children}
                depth={depth + 1}
                folded={folded}
                canScroll={canScroll}
                onToggleFold={onToggleFold}
                onScrollToHeading={onScrollToHeading}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
