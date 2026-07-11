# Suggestions are self-contained payloads with strict raw-markdown targets

A suggestion rides as a payload on an ordinary comment or reply line — not a new kind of sidecar entry — and always carries its own target: a raw-markdown quote with a **required** context fingerprint. The target is never inherited from the thread's anchor, because that anchor is typically the user's quote captured from rendered text — safe to highlight against, unsafe to write over (a rendered quote matched into raw markdown can span formatting markers that a plain-text replacement would destroy). Applying additionally requires a clean, non-fuzzy match: highlighting may use the matcher's fuzzy recovery ladder, writing may not — prefer a refused apply over a wrong write, the write-path corollary of the anchor model's prefer-a-false-orphan doctrine.

## Consequences

- A top-level suggestion comment stores its thread anchor and a usually-identical target — accepted duplication in an append-only log.
- Whitespace-only reflow near a target disables Accept even though the "real" text survives; recovery is the agent re-proposing against the current text, one round trip.
- The in-doc mark stays where the *thread* anchors; a suggestion's target may be a wider span, shown by the card's diff.
