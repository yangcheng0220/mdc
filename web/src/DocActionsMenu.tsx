/**
 * The ⋮ overflow menu at the right end of the doc toolbar — the single home for
 * actions that act on the open file. It is present for every file type (an image
 * shows it as its only right-side control), so it renders as a sibling of
 * HandoffControls rather than inside it: the handoff cluster is markdown-only.
 *
 * End session lives here too, so the toolbar carries one kebab instead of a
 * second one that appeared only while an agent was watching.
 */

import type { ReactNode } from "react";
import { DropdownMenu } from "./DropdownMenu.js";
import { CopyFilenameIcon, CopyPathIcon, EndSessionIcon, KebabIcon } from "./icons.js";

/** One menu row: closes the menu, then acts. */
function Item({
  close,
  onSelect,
  icon,
  danger,
  children,
}: {
  close: () => void;
  onSelect: () => void;
  icon?: ReactNode;
  /** Destructive tone (End session), matching the comment menu's danger item. */
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "menu-danger" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        close();
        onSelect();
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function DocActionsMenu({
  onCopyFilename,
  onCopyPath,
  onEndSession,
}: {
  onCopyFilename: () => void;
  onCopyPath: () => void;
  /** Present only while an agent is watching this file; absent otherwise. */
  onEndSession?: () => void;
}) {
  return (
    <DropdownMenu
      wrapClassName="comment-menu-wrap doc-menu-wrap"
      triggerClassName="comment-menu-btn doc-menu-btn"
      triggerTitle="Document actions"
      triggerAriaLabel="Document actions"
      triggerChildren={<KebabIcon />}
      menuClassName="comment-menu doc-menu"
    >
      {(close) => (
        <>
          <Item close={close} onSelect={onCopyFilename} icon={<CopyFilenameIcon />}>
            Copy filename
          </Item>
          <Item close={close} onSelect={onCopyPath} icon={<CopyPathIcon />}>
            Copy path
          </Item>
          {onEndSession && (
            <>
              <div className="doc-menu-separator" role="separator" />
              <Item close={close} onSelect={onEndSession} icon={<EndSessionIcon />} danger>
                End session…
              </Item>
            </>
          )}
        </>
      )}
    </DropdownMenu>
  );
}
