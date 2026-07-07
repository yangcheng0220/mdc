/**
 * The hover-revealed `⋯` menu on a comment or reply: Edit / Delete. Shown in the
 * header; the menu anchors directly under the button. Tombstoned comments get no
 * menu (nothing to edit/delete again).
 */

import { DropdownMenu } from "./DropdownMenu.js";
import { KebabIcon } from "./icons.js";

export function CommentMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu
      wrapClassName="comment-menu-wrap"
      triggerClassName="comment-menu-btn"
      triggerTitle="Edit or delete"
      triggerAriaLabel="Comment actions"
      triggerChildren={<KebabIcon />}
      menuClassName="comment-menu"
    >
      {(close) => (
        <>
          <button
            type="button"
            data-act="edit"
            onClick={(e) => {
              e.stopPropagation();
              close();
              onEdit();
            }}
          >
            Edit
          </button>
          <button
            type="button"
            data-act="delete"
            onClick={(e) => {
              e.stopPropagation();
              close();
              onDelete();
            }}
          >
            Delete
          </button>
        </>
      )}
    </DropdownMenu>
  );
}
