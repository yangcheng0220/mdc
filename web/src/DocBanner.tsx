/**
 * Doc-top notice banner (warning family): icon, message, action buttons, and
 * an optional dismiss. Every banner is an opt-in signal — actions are explicit
 * clicks, never auto-applied; that would clobber scroll, selection, and any
 * in-progress composer text. All doc-level notices (doc changed on disk,
 * editor save conflict, orphaned comments) render through this one component.
 */

import { CloseIcon, WarningIcon } from "./icons.js";

export function DocBanner({
  text,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
}: {
  text: string;
  actions: { label: string; onClick: () => void }[];
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  return (
    <div className={className ? `doc-banner ${className}` : "doc-banner"}>
      <span className="doc-banner-icon" aria-hidden="true">
        <WarningIcon />
      </span>
      <span className="doc-banner-text">{text}</span>
      {actions.map((action) => (
        <button key={action.label} className="doc-banner-action" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
      {onDismiss && (
        <button
          className="doc-banner-dismiss"
          type="button"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <CloseIcon size={15} />
        </button>
      )}
    </div>
  );
}
