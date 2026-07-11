# Suggestions

## Summary

An agent can attach a proposed edit — a concrete replacement for a quoted span — to a comment or reply. The user reads it as a diff on the thread card and accepts (the file updates), rejects (nothing changes), or replies to refine. The propose → decide → apply loop stays inside mdc instead of detouring through chat.

## Flows

### Agent proposes a suggestion (CLI)

- `mdc comment` and `mdc reply` accept an optional suggested replacement alongside the body. A suggestion always targets one contiguous quoted span; a suggestion in a reply carries its own quote (it may target a wider span than the thread's original anchor).
- An empty replacement proposes deleting the target; the card renders the proposed side as an explicit "(deleted)" state.
- A suggestion thread appears everywhere a comment thread does today: margin card, in-text mark (both modes, standard comment-mark grammar), file-tree badges, dashboard, `list-pending` / `get-thread` / `watch`.
- When a thread contains multiple suggestions, only the latest is actionable; earlier ones render as superseded — diff still readable, no action buttons.
- The agent instructions shipped by `mdc setup` change in the same release: a thread asking for a doc change is answered with a suggestion — never a direct edit to the `.md`, and never a prose-only proposal of an edit.
- A suggestion comment can be edited and deleted like any comment. Editing changes the prose body only — the proposed text is immutable; to change a proposal, post a new suggestion in the thread (it supersedes) or reply. Deleting the comment carrying the actionable suggestion makes the latest surviving one actionable; if none remain, the thread continues as an ordinary comment thread.

### User reviews and decides (thread card, both modes)

- The card shows the suggestion as a diff: the current text and the proposed text as stacked blocks, with word-level changes highlighted inside each. Below it: **Accept**, **Reject**, and the standard reply composer.
- **Accept** (view mode): the file is written immediately, the doc re-renders in place — no reload banner, no confirm dialog (the diff is the confirmation surface). The thread resolves and its card shows an Applied indicator.
- **Accept** (edit mode): the change lands in the editor buffer as if the user typed it — undoable with ⌘Z, persisted by autosave. Thread resolves the same way.
- **Reject**: the thread resolves, the doc is untouched, the card shows a Dismissed indicator. Resolved suggestion cards always show which of the two happened.
- Accept and resolve are one act: applying replaces the quoted text, which would orphan the thread's anchor, so the thread closes with its record (quote, diff, decision) intact instead of lingering as an orphaned open thread.
- A suggestion is decided at most once. Reopening a decided thread reopens the conversation only — the file is never reverted, and the decided suggestion keeps its Applied/Dismissed indicator without regaining Accept/Reject. Re-proposing (or accepting after all, following a dismissal) takes a fresh suggestion in the thread.
- **Refine**: the user replies in the composer; the thread flips back to awaiting-agent and surfaces to the agent like any pending thread. The agent answers with a revised suggestion in the same thread, which becomes the actionable one.
- A toast confirms Accept; Reject needs none.

### Stale and conflicting suggestions

- If the target text has changed since the suggestion was made and can no longer be *cleanly* located — even whitespace-only drift near it counts — the card shows the existing orphaned treatment with Accept disabled; Reject and reply remain available, and the agent re-proposes against the current text.
- Accept re-verifies the target against the file on disk at click time. If the file changed underneath and the target no longer matches, nothing is written and the card flips to the orphaned state with a notice — never a partial or misplaced write.
- Accepting one suggestion may orphan another whose target overlapped; the other card takes the orphaned state through the normal mechanism.

## Out of scope

- Inline in-doc diff preview (rendering the change in place in the doc) — the thread card is the v1 review surface; inline preview is the planned follow-up.
- Human-authored suggestions from the browser — v1 is agent-proposes, human-decides.
- Accepting or rejecting via CLI — deciding is deliberately a human act in the browser.
- Pure insertions at a point (no quoted span) — the agent quotes adjacent text and includes it in the replacement.
- Batch operations (accept-all / reject-all).
