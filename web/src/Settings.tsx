/**
 * The settings surface: a centered modal over a dimmed backdrop, hosting a
 * left-rail section nav and an inline content panel. It's the entry point
 * features dock into — appearance, the comment inbox, shortcuts, workspace,
 * agent setup — each section filling the panel in place rather than launching
 * its own window. A modal (not a layout takeover) keeps the underlying nav
 * hotkeys irrelevant and reads as "step out, adjust, step back".
 *
 * Open/close state lives in App; this component owns the backdrop, the section
 * nav, and which section is shown. Only the comment-inbox section is live
 * (rendered inline from the embed step on); the rest are placeholders that later
 * features fill in.
 */

import { useState } from "react";
import type { DashboardResponse } from "./api.js";
import { Dashboard } from "./Dashboard.js";
import { CloseIcon } from "./icons.js";
import { SHORTCUTS, type ShortcutGroup } from "./keymap.js";
import { useTheme, type ThemeMode } from "./theme.js";

export interface SettingsProps {
  onClose: () => void;
  /** The currently-served root, shown in the Workspace section. */
  root: string;
  /** The running server's build-injected version. */
  version: string | null;
  /** Cross-doc inbox data (App's useDashboard), rendered in the Comments section. */
  dashboardData: DashboardResponse | null;
  onJump: (file: string, threadId: string, resolved: boolean, newTab: boolean) => void;
  onDeleteThread: (file: string, threadId: string) => void;
  onDeleteSidecar: (file: string, count: number, orphaned: boolean) => void;
}

type SectionId = "appearance" | "inbox" | "shortcuts" | "workspace" | "agent";

interface Section {
  id: SectionId;
  label: string;
}

/** Rail order: daily → occasional → one-time onboarding. */
const SECTIONS: Section[] = [
  { id: "appearance", label: "Appearance" },
  { id: "inbox", label: "Comments" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "workspace", label: "Workspace" },
  { id: "agent", label: "Agent setup" },
];

export function Settings({
  onClose,
  root,
  version,
  dashboardData,
  onJump,
  onDeleteThread,
  onDeleteSidecar,
}: SettingsProps) {
  // Default to the comment inbox — the one live section, so settings opens on
  // something useful rather than a placeholder.
  const [section, setSection] = useState<SectionId>("inbox");

  return (
    <div
      className="settings-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="settings-modal" role="dialog" aria-label="Settings">
        <div className="settings-heading">
          <span className="settings-title">settings</span>
          <button
            type="button"
            className="settings-close"
            title="Close settings"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="settings-main">
          <div className="settings-rail">
            <nav className="settings-nav" role="tablist" aria-label="Settings sections">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={section === s.id}
                  className={`settings-nav-item${section === s.id ? " active" : ""}`}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
            {version && (
              <a
                className="settings-version"
                href="https://github.com/yangcheng0220/mdc/releases"
                target="_blank"
                rel="noopener noreferrer"
              >
                mdc {version}
              </a>
            )}
          </div>

          <div
            className={`settings-content${section === "inbox" ? " is-dashboard" : ""}`}
          >
            <SectionBody
              section={section}
              root={root}
              dashboardData={dashboardData}
              onJump={onJump}
              onDeleteThread={onDeleteThread}
              onDeleteSidecar={onDeleteSidecar}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBody({
  section,
  root,
  dashboardData,
  onJump,
  onDeleteThread,
  onDeleteSidecar,
}: {
  section: SectionId;
  root: string;
  dashboardData: DashboardResponse | null;
  onJump: SettingsProps["onJump"];
  onDeleteThread: SettingsProps["onDeleteThread"];
  onDeleteSidecar: SettingsProps["onDeleteSidecar"];
}) {
  switch (section) {
    case "inbox":
      return (
        <Dashboard
          embedded
          title="Comments"
          subtitle="Every open and resolved comment thread across all docs, in one place."
          data={dashboardData}
          onJump={onJump}
          onDeleteThread={onDeleteThread}
          onDeleteSidecar={onDeleteSidecar}
        />
      );
    case "appearance":
      return <Appearance />;
    case "shortcuts":
      return <Shortcuts />;
    case "workspace":
      return <Workspace root={root} />;
    case "agent":
      return <AgentSetup />;
  }
}

// CLI-guided, like Workspace: a browser can't configure an agent's harness, so
// this section tells the user what to hand their agent rather than doing it.
const SETUP_INSTRUCTION = "Tell your agent: run `mdc setup` and follow it";

function AgentSetup() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(SETUP_INSTRUCTION).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <>
      <h2 className="settings-section-title">Agent setup</h2>
      <p className="settings-section-sub">
        Wire up a coding agent to work in mdc with you — reviewing docs in the
        margin (comment, <strong>Hand off</strong>, and it replies), building mini
        apps over your files, and producing mockups or diagrams you view inline. To
        set one up, hand it the instruction below: it reads mdc's setup doc and
        teaches itself when to reach for mdc.
      </p>

      <div className="workspace-command-row">
        <code className="workspace-command">{SETUP_INSTRUCTION}</code>
        <button type="button" className="workspace-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="settings-section-sub">
        As part of setup the agent will walk you through approving <code>mdc</code>{" "}
        commands — the review loop runs them continuously, so a per-command prompt
        would stall it. Expect to confirm this, and to see approval prompts until
        it's in place.
      </p>
    </>
  );
}

// Cheatsheet rendered straight from the keymap table, so it can't drift from the
// live bindings. Grouped in the table's group order, first-seen wins.
const SHORTCUT_GROUPS: ShortcutGroup[] = SHORTCUTS.reduce<ShortcutGroup[]>((acc, s) => {
  if (!acc.includes(s.group)) acc.push(s.group);
  return acc;
}, []);

function Shortcuts() {
  return (
    <>
      <h2 className="settings-section-title">Shortcuts</h2>
      <p className="settings-section-sub">Keyboard shortcuts for getting around mdc.</p>
      <div className="shortcuts-list">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group} className="shortcuts-group">
            <h3 className="shortcuts-group-title">{group}</h3>
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.id} className="shortcuts-row">
                <span className="shortcuts-label">{s.label}</span>
                <kbd className="shortcuts-key">{s.combo.display}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

function Appearance() {
  const { mode, setMode } = useTheme();
  return (
    <>
      <h2 className="settings-section-title">Appearance</h2>
      <p className="settings-section-sub">
        Theme for mdc. System follows your operating system's setting.
      </p>
      <div className="theme-toggle" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={mode === o.id}
            className={`theme-toggle-option${mode === o.id ? " active" : ""}`}
            onClick={() => setMode(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

// Switching the served root happens in the terminal (a browser page can't run a
// command on the host, and can't learn a folder's real path from a native picker
// — so this section is a guided command builder, not an executor): it shows the
// current root and turns a typed destination into the exact copy-pasteable
// command. `serve --force` stops the server on this port and re-serves the new
// root; the open browser tab reconnects to it on its own.
function Workspace({ root }: { root: string }) {
  const [dest, setDest] = useState("");
  const [copied, setCopied] = useState(false);

  const target = dest.trim();
  // Quote the path so spaces don't break the command.
  const command = target ? `mdc serve "${target}" --force` : "";

  const copy = () => {
    if (!command) return;
    void navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <>
      <h2 className="settings-section-title">Workspace</h2>
      <p className="settings-section-sub">
        Switch the folder mdc serves. Run the command below in your terminal — the
        mdc server restarts on the new root and this tab switches to it automatically.{" "}
        <strong>Submit any in-progress comment first</strong> — the restart drops
        an unsent comment draft (saved edits are safe; the editor autosaves).
      </p>

      <div className="workspace-field">
        <span className="workspace-field-label">Current root</span>
        <code className="workspace-path">{root || "—"}</code>
      </div>

      <label className="workspace-field" htmlFor="workspace-dest">
        <span className="workspace-field-label">Switch to</span>
        <input
          id="workspace-dest"
          className="workspace-input"
          type="text"
          placeholder="/absolute/path/to/folder"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="workspace-command-row">
        <code className="workspace-command">
          {command || <span className="workspace-command-empty">Enter a path above…</span>}
        </code>
        <button
          type="button"
          className="workspace-copy"
          disabled={!command}
          onClick={copy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </>
  );
}
