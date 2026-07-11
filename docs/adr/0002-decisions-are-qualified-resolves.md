# Decisions are qualified resolves; a suggestion is decided at most once

Applying or dismissing a suggestion appends an ordinary `resolved` event carrying a resolution qualifier (applied | dismissed) and the id of the decided suggestion comment — not new event types. Sidecars are shared files read concurrently by whatever mdc versions are in the wild, and the two encodings degrade differently: old readers ignore unknown *fields* (a decided thread reads as plainly resolved — correct), but misread unknown event *types* as no-event (a decided thread comes back as an open thread awaiting the agent — corrupt). A decided suggestion is never decidable again: unresolving a thread reopens the conversation, not the decision.

## Consequences

- Kills the double-apply footgun outright: a replacement that *contains* its target (e.g. an append) stays cleanly locatable after apply, so match strictness alone cannot prevent a second apply on a reopened thread.
- Dismissed-then-changed-my-mind requires the agent to post a fresh suggestion — rare, and one reply away.
- Derivation stays monotonic: a suggestion id referenced by any resolution event is decided, with no latest-event-wins subtleties.
