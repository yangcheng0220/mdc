/**
 * The handoff cluster in the doc toolbar: a presence pill and a Hand off button.
 *
 * The pill is the truthful presence signal — whether an agent is connected and
 * on which file. The button hands the active doc to a watching agent over the
 * live signal; with no agent connected it falls back to copying the review
 * command so the user can start one. End session now lives in the toolbar's ⋮
 * menu (DocActionsMenu), so the toolbar carries a single kebab.
 */

import type { ActiveSession } from "./api.js";
import { ArrowRightIcon } from "./icons.js";

type PillState = "watching" | "no-agent" | "busy" | "idle";

export function HandoffControls({
  activeFile,
  session,
  onHandoff,
}: {
  activeFile: string;
  session: ActiveSession | null;
  /** Hand off the active doc; resolves to whether an agent received the signal. */
  onHandoff: () => void;
}) {
  const sessionMatches = session !== null && session.file === activeFile;
  const agentWatching = sessionMatches && session.watching;
  const otherFileLive = session !== null && session.file !== activeFile;

  let pillState: PillState;
  let pillText: string;
  if (agentWatching) {
    pillState = "watching";
    pillText = "watching";
  } else if (sessionMatches) {
    pillState = "no-agent";
    pillText = "no agent watching";
  } else if (session) {
    pillState = "busy";
    pillText = `busy on ${session.file.split("/").pop()}`;
  } else {
    pillState = "idle";
    pillText = "idle";
  }

  let btnTitle: string;
  if (otherFileLive) btnTitle = `The agent is working on ${session?.file} — wait for it to finish`;
  else if (agentWatching) btnTitle = `Hand off to the agent (watching ${activeFile})`;
  else btnTitle = "No agent watching — hand off to copy a prompt for your agent";

  return (
    <>
      <span className={`handoff-status handoff-status-${pillState}`}>
        <span className="handoff-status-dot" />
        <span>{pillText}</span>
      </span>

      <button
        type="button"
        className="handoff-btn"
        disabled={otherFileLive}
        title={btnTitle}
        onClick={onHandoff}
      >
        <ArrowRightIcon />
        <span>Handoff</span>
      </button>
    </>
  );
}
