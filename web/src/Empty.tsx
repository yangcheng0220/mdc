/**
 * Empty states for when no file is selected: a centered prompt in the doc area
 * and a "no comments" prompt in the sidebar.
 */

export function EmptyDoc() {
  return (
    <div className="doc-placeholder">
      Select a file from the left. Press <kbd>⌘K</kbd> to jump by name.
    </div>
  );
}

export function EmptySidebar({ hasFile }: { hasFile: boolean }) {
  // The hint differs by context: with a file open, point at the doc; with none,
  // tell the user to open one first.
  const sub = hasFile
    ? "Select text in the doc to add one"
    : "Open a file and select text to start a thread";
  return (
    <div className="sidebar-empty">
      <div className="sidebar-empty-icon">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 2C5.58 2 2 5.36 2 9.5c0 1.93.75 3.69 1.97 5.02L3 17.5l3.2-1.03A8.1 8.1 0 0010 17c4.42 0 8-3.36 8-7.5S14.42 2 10 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </div>
      <div className="sidebar-empty-title">No comments yet</div>
      <div className="sidebar-empty-sub">{sub}</div>
    </div>
  );
}
