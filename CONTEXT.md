# mdc

The margin-review domain: humans and coding agents review markdown docs together through anchored comment threads stored in sidecar files, with the doc itself untouched by the review.

## Language

### The sidecar model

**Sidecar**:
The append-only `.comments.jsonl` file next to a `.md` doc; the source of truth for that doc's review threads. Works with or without a server running.

**Entry**:
One line of a sidecar — either a content line or an event line.
_Avoid_: record, row, message

**Comment**:
A content line that starts a thread, anchored to a span of doc text.

**Reply**:
A content line that continues an existing thread. Carries no anchor of its own.

**Event**:
A typed line acting on a thread (resolve, unresolve, acknowledge) or on a single content line (edit, delete). State is derived on read; the latest event wins. Nothing is ever mutated in place.

**Thread**:
A comment plus its surviving replies, in one conversation. Derived status: open or resolved.

**Anchor**:
The quoted doc text (plus surrounding context fingerprint) that locates a comment in the doc. Matching prefers a false orphan over a false match.

**Orphaned**:
An anchor that can no longer be located in the current doc text. The thread survives; it just no longer points anywhere.

**Awaiting**:
Whose turn a thread is — the user's or the agent's — derived from who acted last: spoke, or decided a suggestion. Dismissing a suggestion is a turn; the thread passes to the agent.

### Suggestions

**Suggestion**:
A proposal payload — target text plus replacement text — carried by a content line. Not a kind of entry; a power a comment or reply can have.

**Suggestion comment**:
A comment or reply carrying a suggestion.
_Avoid_: proposal, patch, edit request

**Target**:
The raw-markdown span a suggestion replaces. Every suggestion carries its own target — it is never inherited from the thread's anchor, which locates the conversation, not the edit.
_Avoid_: anchor (that's the thread's), range, selection

**Actionable suggestion**:
The latest surviving suggestion in a thread, provided it is not decided — the only one that can be applied or dismissed. All earlier surviving suggestions in the thread are **superseded**: still readable, no longer decidable.

**Decided**:
A suggestion that has been applied or dismissed. A suggestion is decided at most once — reopening its thread reopens the conversation, never the decision. Re-proposing takes a fresh suggestion.
_Avoid_: spent, consumed

**Applied**:
The outcome where the user accepted a suggestion and its replacement was written into the doc. Applying resolves the thread in the same act.
_Avoid_: accepted (as a thread state — "accept" is the user's action, "applied" is the outcome)

**Dismissed**:
The outcome where the user rejected a suggestion; the doc is untouched. Dismissing decides the suggestion only — the thread stays open, with the ball passing to the agent. Closing the conversation is a separate, explicit resolve (unlike applying, which forces it — see Applied).
_Avoid_: rejected (as a thread state — same action/outcome split as applied)

## Example dialogue

> **Dev:** The user replied to the agent's suggestion comment instead of accepting — what happens to the suggestion?
> **Expert:** The thread flips to awaiting the agent. The suggestion stays actionable until the agent posts a new one in that thread — then the old one is superseded and only the new one can be applied.
> **Dev:** And if the user accepts it, do we resolve the thread too?
> **Expert:** Applying *is* resolving — one act. The replacement lands in the doc, which destroys the anchor's target, so the thread closes with its record intact rather than lingering orphaned.
> **Dev:** Can the user tweak the replacement text before accepting?
> **Expert:** No — suggestions are immutable. Editing a suggestion comment edits its prose body only. To change the proposal, someone posts a new suggestion in the thread.
> **Dev:** And rejecting — does that close the thread like accepting does?
> **Expert:** No. Applying closes the thread because the edit destroys the anchor's target; rejecting destroys nothing. The suggestion is dismissed — decided for good — but the thread stays open and passes to the agent. A reason from the user means refine; silence means "nothing to add," and the agent acknowledges and resolves.
