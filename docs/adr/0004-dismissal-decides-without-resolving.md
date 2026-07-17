# Dismissal decides without resolving

Rejecting a suggestion dismisses it — decided at most once, as ever — but no longer resolves the thread. v1 made both decisions one act ("deciding is resolving"), but the symmetry was only aesthetic: applying must close the thread because the edit destroys the anchor's target, while rejecting destroys nothing — and auto-resolving on reject silently closed still-live concerns (user comments "this paragraph buries the point," agent suggests a rewrite, user rejects the rewrite → the user's own unresolved complaint vanished from the open margin). Decision and resolution are orthogonal: the decision belongs to the suggestion, resolution belongs to the conversation.

Supersedes the dismissal half of [ADR 0002](0002-decisions-are-qualified-resolves.md); decided-at-most-once and the double-apply analysis stand.

## Consequences

- A dismissal is a turn: the thread flips to awaiting-agent, so a watching agent receives it as ordinary pending work (`suggestion_state`: dismissed, nothing actionable) — no new notification channel.
- The agent protocol (shipped via `mdc setup`) disambiguates by the presence of a reason: a dismissal with a user reply is a refine (engage, re-propose); a silent dismissal means "no, and nothing to add" — the agent acknowledges briefly and resolves the thread itself rather than blind-guessing a second version. The agent is the sweeper; no Reject-&-close composite action exists (Reject then Resolve composes from existing acts).
- Encoding constraint carried forward from ADR 0002: sidecars are read by whatever mdc versions are in the wild, and 0.2.x readers corrupt on unknown event *types* (a dismissed suggestion would read as still actionable, inviting a mixed-version double-decide). The chosen encoding must degrade safely on 0.2.x readers — e.g. 0.2.x already derives "decided survives thread unresolve," which an encoding can lean on. Settled in the tech spec, not here.
- Applying is unchanged: accept still applies and resolves in one act, for the mechanical reason above. The asymmetry is deliberate.
