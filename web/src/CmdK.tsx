/**
 * Quick file-jump modal (⌘K): type to filter the file index, arrow-keys to
 * navigate, Enter to open, Escape to close. Works whether or not a file is open.
 */

import { useCallback } from "react";
import { PaletteShell } from "./PaletteShell.js";

export function CmdK({
  paths,
  onClose,
  onPick,
}: {
  paths: string[];
  onClose: () => void;
  onPick: (file: string) => void;
}) {
  const filterPaths = useCallback((items: readonly string[], query: string) => {
    const q = query.trim().toLowerCase();
    const matches = q ? items.filter((p) => p.toLowerCase().includes(q)) : items.slice();
    return matches.sort((a, b) => a.localeCompare(b)).slice(0, 200);
  }, []);

  return (
    <PaletteShell
      items={paths}
      filterItems={filterPaths}
      getKey={(file) => file}
      renderItem={(file) => {
        const parts = file.split("/");
        const name = parts.pop() ?? file;
        const dir = parts.join("/");
        return (
          <>
            <span className="cmdk-item-name">{name}</span>
            {dir && <span className="cmdk-item-dir">{dir}</span>}
          </>
        );
      }}
      emptyMessage={(query) => `No files match "${query}"`}
      footer={
        <>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </>
      }
      placeholder="Jump to file..."
      hintBadge="⌘K"
      ariaLabel="Jump to file"
      onClose={onClose}
      onPick={onPick}
    />
  );
}
