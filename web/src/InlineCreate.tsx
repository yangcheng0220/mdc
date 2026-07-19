/**
 * An inline name input dropped into the file tree at a create target — Enter
 * commits the name, Esc (or blur) cancels. Used for both new-file and new-folder;
 * the icon mirrors the kind so the row reads like the item it'll become.
 */

import { useEffect, useRef, useState } from "react";
import type { FileCreateKind } from "./createName.js";
import { DrawingIcon, FileIcon, FolderIcon } from "./icons.js";

export function InlineCreate({
  kind,
  depth,
  onCommit,
  onCancel,
}: {
  kind: FileCreateKind | "folder";
  depth: number;
  /** The typed name (trimmed, non-empty). The parent resolves it to a full path. */
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // A commit fires onCommit then the parent unmounts us; guard so the blur that
  // follows the unmount doesn't also fire onCancel and stomp a toast/refresh.
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    const name = value.trim();
    if (!name) {
      onCancel();
      return;
    }
    done.current = true;
    onCommit(name);
  };

  return (
    <div
      className="nav-row inline-create"
      style={depth ? { paddingLeft: 8 + depth * 16 } : undefined}
    >
      <span className="nav-file-icon">
        {kind === "folder" ? <FolderIcon /> : kind === "drawing" ? <DrawingIcon /> : <FileIcon />}
      </span>
      <input
        ref={ref}
        className="inline-create-input"
        value={value}
        placeholder={
          kind === "folder" ? "folder name" : kind === "drawing" ? "name.excalidraw" : "name.md"
        }
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (!done.current) onCancel();
        }}
      />
    </div>
  );
}
