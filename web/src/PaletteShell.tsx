import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Key,
  type ReactNode,
} from "react";
import { SearchIcon } from "./icons.js";

export function PaletteShell<T>({
  items,
  filterItems,
  getKey,
  renderItem,
  emptyMessage,
  footer,
  placeholder,
  hintBadge,
  ariaLabel,
  onClose,
  onPick,
}: {
  items: readonly T[];
  filterItems: (items: readonly T[], query: string) => readonly T[];
  getKey: (item: T) => Key;
  renderItem: (item: T) => ReactNode;
  emptyMessage: (query: string) => string;
  footer: ReactNode;
  placeholder: string;
  hintBadge: string;
  ariaLabel: string;
  onClose: () => void;
  onPick: (item: T) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterItems(items, query), [filterItems, items, query]);

  useEffect(() => setSelected(0), [query, results]);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    listRef.current?.querySelector(".cmdk-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  const pick = (i: number) => {
    const item = results[i];
    if (item) onPick(item);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk-panel" role="dialog" aria-label={ariaLabel}>
        <div className="cmdk-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="cmdk-hint-badge">{hintBadge}</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmdk-empty">{emptyMessage(query)}</div>
          ) : (
            results.map((item, i) => (
              <div
                key={getKey(item)}
                className={`cmdk-item${i === selected ? " selected" : ""}`}
                onMouseMove={() => setSelected(i)}
                onClick={() => pick(i)}
              >
                {renderItem(item)}
              </div>
            ))
          )}
        </div>
        <div className="cmdk-footer">{footer}</div>
      </div>
    </div>
  );
}
