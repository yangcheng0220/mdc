# Suggestions

## Summary

An agent can attach a proposed edit — a concrete replacement for a quoted span — to a comment or reply. The user reads it as a diff on the thread card or previewed in place in the doc, and accepts (the file updates), rejects (nothing changes), or replies to refine. The propose → decide → apply loop stays inside mdc instead of detouring through chat.

## Flows

### Agent proposes a suggestion (CLI)

- `mdc comment` and `mdc reply` accept an optional suggested replacement alongside the body. A suggestion always targets one contiguous quoted span; a suggestion in a reply carries its own quote (it may target a wider span than the thread's original anchor).
- An empty replacement proposes deleting the target; the card renders the proposed side as an explicit "(deleted)" state.
- A suggestion thread appears everywhere a comment thread does today: margin card, in-text mark (both modes, standard comment-mark grammar), file-tree badges, dashboard, `list-pending` / `get-thread` / `watch`.
- When a thread contains multiple suggestions, only the latest is actionable; earlier ones render as superseded — diff still readable, no action buttons.
- The agent instructions shipped by `mdc setup` change in the same release: a thread asking for a doc change is answered with a suggestion — never a direct edit to the `.md`, and never a prose-only proposal of an edit. And a dismissal is answered by its reason: dismissed with a reply → engage and re-propose in the thread; dismissed silently → read it as "no, and nothing to add" — acknowledge briefly and resolve the thread, never blind-guess a second version.
- A suggestion comment can be edited and deleted like any comment. Editing changes the prose body only — the proposed text is immutable; to change a proposal, post a new suggestion in the thread (it supersedes) or reply. Deleting the comment carrying the actionable suggestion makes the latest surviving one actionable; if none remain, the thread continues as an ordinary comment thread.

### User reviews and decides (thread card, both modes)

- The card shows the suggestion as a diff: the current text and the proposed text as stacked blocks, with word-level changes highlighted inside each. Below it: **Accept**, **Reject**, and the standard reply composer.
- A card diff longer than a threshold (~10 lines) collapses to a one-line change summary plus a **Preview in doc** affordance — the card stays a compact index; reading a big change happens in the doc (next flow).
- **Accept** (view mode): the file is written immediately, the doc re-renders in place — no reload banner, no confirm dialog (the diff is the confirmation surface). The thread resolves and its card shows an Applied indicator.
- **Accept** (edit mode): the change lands in the editor buffer as if the user typed it — undoable with ⌘Z, persisted by autosave. Thread resolves the same way.
- **Reject**: the suggestion is dismissed — the doc untouched, the card showing a Dismissed indicator — but the thread stays open: rejecting decides the suggestion, not the conversation. The dismissal counts as the user's turn — the thread flips to awaiting-agent and flows to a watching agent like any pending thread — and the card focuses the reply composer with an optional "why" prompt; a reason invites a revised suggestion, silence is fine too. Closing the conversation stays a separate, explicit resolve. Decided suggestion cards always show which of the two happened.
- Accept and resolve are one act: applying replaces the quoted text, which would orphan the thread's anchor, so the thread closes with its record (quote, diff, decision) intact instead of lingering as an orphaned open thread. Reject deliberately does not share this — nothing is destroyed by declining (ADR 0004).
- A suggestion is decided at most once. Reopening a decided thread reopens the conversation only — the file is never reverted, and the decided suggestion keeps its Applied/Dismissed indicator without regaining Accept/Reject. Re-proposing (or accepting after all, following a dismissal) takes a fresh suggestion in the thread.
- **Refine**: the user replies in the composer; the thread flips back to awaiting-agent and surfaces to the agent like any pending thread. The agent answers with a revised suggestion in the same thread, which becomes the actionable one.
- A toast confirms Accept; Reject needs none — the Dismissed indicator and focused composer are the feedback.

### Inline preview — reading the change in the doc

- Clicking a suggestion card (or its **Preview in doc** affordance) pins a preview: the affected doc text swaps to a diff rendering in place — deleted text struck through, inserted text highlighted, surrounding doc untouched. Clicking the suggestion's in-text mark does the same *and* focuses the card (extends today's mark-click-jumps-to-card grammar).
- One preview at a time; pinning another suggestion's preview replaces the current one. **Esc** or clicking outside the previewed region closes it and restores the doc exactly as it was — including scroll position, so a structure-changing preview never leaves the user somewhere else in the document.
- A pinned preview carries a small floating action chip anchored to the previewed region — **Accept**, **Reject**, and close — the same actions as the card, so a long diff is decidable where it was just read, without scrolling back to the margin.
- When the replacement changes block structure (splits a paragraph, adds or removes a heading), the preview falls back to stacked current → proposed blocks rendered in place; word-level marking applies only where the structure survives.
- Only the actionable suggestion previews. Superseded and decided suggestions keep their card diff (no preview); an orphaned suggestion has no locatable target, so its card offers no preview and keeps the orphaned treatment.
- **Edit mode**: focusing a suggestion card shows the change as an inline diff chunk in the editor buffer at the target, with the same accept/reject affordances; closing the preview restores the buffer untouched. Behavior otherwise mirrors view mode.

### Stale and conflicting suggestions

- If the target text has changed since the suggestion was made and can no longer be *cleanly* located — even whitespace-only drift near it counts — the card shows the existing orphaned treatment with Accept disabled; Reject and reply remain available, and the agent re-proposes against the current text.
- Accept re-verifies the target against the file on disk at click time. If the file changed underneath and the target no longer matches, nothing is written and the card flips to the orphaned state with a notice — never a partial or misplaced write.
- Accepting one suggestion may orphan another whose target overlapped; the other card takes the orphaned state through the normal mechanism.

## Out of scope

- Always-on tracked-changes rendering (every pending suggestion permanently visible in the doc) — previews are on-demand and one at a time; the doc stays a clean reading surface.
- Previewing superseded, decided, or orphaned suggestions — the card diff is their record.
- Collapsing long prose comment bodies — unrelated polish; thread folding already exists.
- Human-authored suggestions from the browser — v1 is agent-proposes, human-decides.
- Accepting or rejecting via CLI — deciding is deliberately a human act in the browser.
- Pure insertions at a point (no quoted span) — the agent quotes adjacent text and includes it in the replacement.
- Batch operations (accept-all / reject-all).
