/**
 * The cross-doc review inbox: every open/resolved comment thread across all
 * docs in one view, grouped by file, so pending review work can be triaged and
 * jumped to without opening each file. Also the home for bulk deletion — a whole
 * thread, or a doc's entire sidecar (including stranded sidecars whose source
 * .md was deleted, shown under a "doc deleted" divider).
 *
 * Data + polling live in `useDashboard`; this component is presentation + local
 * UI state (the Open/Resolved/Both filter and which file groups are collapsed).
 */

import { useState } from "react";
import type { DashFile, DashboardResponse } from "./api.js";
import { relativeTime } from "./commentData.js";
import { CaretIcon, CloseIcon, TrashIcon } from "./icons.js";
import type { Thread } from "../../src/threads.js";

type Filter = "open" | "resolved" | "both";
const FILTER_LABELS: Record<Filter, string> = { open: "Open", resolved: "Resolved", both: "Both" };

export interface DashboardProps {
  data: DashboardResponse | null;
  onJump: (file: string, threadId: string, resolved: boolean, newTab: boolean) => void;
  onDeleteThread: (file: string, threadId: string) => void;
  onDeleteSidecar: (file: string, count: number, orphaned: boolean) => void;
  /** Standalone overlay only — the heading close button. Omitted when embedded. */
  onClose?: () => void;
  /** Rendered inside another surface (the settings panel): drop the overlay's
   *  root/close chrome, keep the filter + thread list. */
  embedded?: boolean;
  /** Embedded only — section title + sub shown on the heading row, left of the
   *  filter + count summary. */
  title?: string;
  subtitle?: string;
}

/** open before resolved, then awaiting-you floats up, then most-recent first. */
function sortThreads(threads: Thread[]): Thread[] {
  return threads.slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "open" && a.awaiting !== b.awaiting) return a.awaiting === "you" ? -1 : 1;
    return (b.last_ts ?? "").localeCompare(a.last_ts ?? "");
  });
}

export function Dashboard({
  data,
  onJump,
  onDeleteThread,
  onDeleteSidecar,
  onClose,
  embedded = false,
  title,
  subtitle,
}: DashboardProps) {
  const [filter, setFilter] = useState<Filter>("open");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const matches = (t: Thread) => filter === "both" || t.status === filter;
  const groups = (data?.files ?? [])
    .map((f) => ({ ...f, threads: sortThreads(f.threads.filter(matches)) }))
    .filter((g) => g.threads.length > 0);
  const live = groups.filter((g) => !g.orphaned);
  const orphaned = groups.filter((g) => g.orphaned);

  // The heading and the segmented filter ALWAYS render — even before the first
  // fetch resolves or when the inbox is empty — so the view is always
  // switchable. The segments carry the counts, so there is no separate summary.
  return (
    <div className={`dashboard-body${embedded ? " is-embedded" : ""}`}>
      {embedded ? (
        <div className="dashboard-heading dashboard-heading-embedded">
          <div className="dashboard-embedded-titles">
            {title && <h2 className="settings-section-title">{title}</h2>}
            {subtitle && <p className="settings-section-sub">{subtitle}</p>}
          </div>
        </div>
      ) : (
        <div className="dashboard-heading">
          <span className="dashboard-title">inbox</span>
          <span className="dashboard-root">{data?.root ?? ""}</span>
          <div className="dashboard-actions">
            <button
              type="button"
              className="dashboard-close"
              title="Close inbox"
              aria-label="Close inbox"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      <DashSegments
        filter={filter}
        onChange={setFilter}
        openCount={data?.total_open}
        resolvedCount={data?.total_resolved}
      />

      {!data ? null : groups.length === 0 ? (
        <div className="dashboard-empty">
          No {filter === "both" ? "" : `${filter} `}comments across any doc.
        </div>
      ) : (
        <>
          {live.map((g) => (
            <DashFileGroup
              key={g.path}
              group={g}
              collapsed={collapsed.has(g.path)}
              onToggle={() => toggleCollapse(g.path)}
              onJump={onJump}
              onDeleteThread={onDeleteThread}
              onDeleteSidecar={onDeleteSidecar}
            />
          ))}
          {/* Orphaned files (their .md deleted) — marked per-file by a struck
              filename + a badge, so no separate divider is needed. */}
          {orphaned.map((g) => (
            <DashFileGroup
              key={g.path}
              group={g}
              collapsed={collapsed.has(g.path)}
              onToggle={() => toggleCollapse(g.path)}
              onJump={onJump}
              onDeleteThread={onDeleteThread}
              onDeleteSidecar={onDeleteSidecar}
            />
          ))}
        </>
      )}
    </div>
  );
}

function DashFileGroup({
  group,
  collapsed,
  onToggle,
  onJump,
  onDeleteThread,
  onDeleteSidecar,
}: {
  group: DashFile;
  collapsed: boolean;
  onToggle: () => void;
  onJump: DashboardProps["onJump"];
  onDeleteThread: DashboardProps["onDeleteThread"];
  onDeleteSidecar: DashboardProps["onDeleteSidecar"];
}) {
  const total = group.open + group.resolved;
  const cls = `dash-file${collapsed ? " collapsed" : ""}${group.orphaned ? " is-orphan" : ""}`;
  return (
    <section className={cls}>
      <header className="dash-file-hdr" onClick={onToggle}>
        <span className="dash-caret">
          <CaretIcon />
        </span>
        <span className="dash-file-name">{group.path}</span>
        {/* File-level state reads beside the filename, not in the right-hand
            column where row status lives. */}
        {group.orphaned && (
          <span
            className="dash-orphan-badge"
            title="The source .md was deleted; these comments are stranded"
          >
            (doc deleted)
          </span>
        )}
        <span className="dash-file-spacer" />
        <button
          type="button"
          className="dash-file-del"
          title="Delete all comments"
          aria-label="Delete all comments on this doc"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSidecar(group.path, total, group.orphaned);
          }}
        >
          <TrashIcon />
        </button>
      </header>
      {!collapsed && (
        <div className="dash-rows">
          {group.threads.map((t) => (
            <InboxRow
              key={t.thread_id}
              file={group.path}
              thread={t}
              orphaned={group.orphaned}
              onJump={onJump}
              onDeleteThread={onDeleteThread}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InboxRow({
  file,
  thread,
  orphaned,
  onJump,
  onDeleteThread,
}: {
  file: string;
  thread: Thread;
  orphaned: boolean;
  onJump: DashboardProps["onJump"];
  onDeleteThread: DashboardProps["onDeleteThread"];
}) {
  const resolved = thread.status === "resolved";
  const cls = `dash-row${resolved ? " is-resolved" : ""}${orphaned ? " is-orphan" : ""}`;
  return (
    <div
      className={cls}
      // Orphan rows have no live doc to jump to — only delete is actionable.
      onClick={orphaned ? undefined : (e) => onJump(file, thread.thread_id, resolved, e.metaKey || e.ctrlKey)}
    >
      <span className="dash-quote">
        {thread.quote ? `“${thread.quote}”` : <span className="dash-noquote">(no anchor)</span>}
      </span>
      <span className="dash-meta">
        {/* One chip design for every status; open threads carry the comment
            rust as an outline (rust = open comment work, whose turn is in the
            words), resolved is neutral. */}
        {thread.status === "open" ? (
          <span className="dash-status is-open">awaiting {thread.awaiting}</span>
        ) : (
          <span className="dash-status">resolved</span>
        )}
        <span className="dash-when">{relativeTime(thread.last_ts)}</span>
        <button
          type="button"
          className="dash-row-del"
          title="Delete thread"
          aria-label="Delete this thread"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteThread(file, thread.thread_id);
          }}
        >
          <TrashIcon />
        </button>
      </span>
    </div>
  );
}

/** The Open/Resolved/Both filter — a segmented control carrying the counts, so
 *  it doubles as the summary and always shows which view is active. */
function DashSegments({
  filter,
  onChange,
  openCount,
  resolvedCount,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  openCount?: number;
  resolvedCount?: number;
}) {
  const countFor = (v: Filter) =>
    v === "open" ? openCount : v === "resolved" ? resolvedCount : undefined;
  return (
    <div className="dash-seg" role="tablist" aria-label="Filter inbox">
      {(["open", "resolved", "both"] as const).map((v) => {
        const count = countFor(v);
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={filter === v}
            className={`dash-seg-tab${filter === v ? " active" : ""}`}
            onClick={() => onChange(v)}
          >
            {FILTER_LABELS[v]}
            {count !== undefined && <span className="dash-seg-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
