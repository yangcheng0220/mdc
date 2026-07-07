#!/usr/bin/env bash
#
# Build a disposable workspace for exercising the comment dashboard (the cross-doc
# review inbox). Seeds threads in every state the dashboard groups, sorts, and
# filters by, so the embedded inbox can be verified end to end:
#
#   - threads across MULTIPLE docs + folders   → file grouping
#   - an OPEN thread awaiting YOU (agent spoke last)   → floats to the top
#   - an OPEN thread awaiting the AGENT (you spoke last)
#   - a RESOLVED thread                          → Open / Resolved / Both filter
#   - one doc with SEVERAL threads               → within-group sort
#   - an ORPHANED sidecar (its .md deleted)      → the "doc deleted" group
#
# Usage:  scripts/make-dashboard-workspace.sh <output-dir>
# Re-running wipes and rebuilds <output-dir>, so it doubles as a reset.
# Then:   node dist/cli.js serve <output-dir> --port 8099 --no-open --force
# Tear down when done:  node dist/cli.js stop --port 8099  &&  rm -rf <output-dir>
#
# Requires the CLI to be built (dist/cli.js):  npm run build:cli  (or npm run build)
#
# Identity note: a thread shows "awaiting you" when an AGENT author spoke last
# (ball in the user's court) and "awaiting agent" when THE CONFIGURED USER spoke
# last. To make "awaiting agent" reproducible regardless of any ~/.mdc.toml, this
# script PINS the user identity via MDC_USER (precedence #1) for seeding — and
# the printed serve command pins the SAME value, so the human-side author matches
# what mdc treats as "the user".

set -euo pipefail

OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "usage: $0 <output-dir>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # ts/mdc
CLI="$HERE/dist/cli.js"
if [ ! -f "$CLI" ]; then
  echo "error: $CLI not found — run 'npm run build:cli' first." >&2
  exit 1
fi

OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"  # absolutise
find "$OUT" -mindepth 1 -delete
mkdir -p "$OUT/specs" "$OUT/notes"

# Pin the identity so awaiting-state is reproducible. The human side is authored
# as $USER_NAME and the server must be started with MDC_USER=$USER_NAME so the two
# agree (the printed serve command does this).
USER_NAME="user"
AGENT_NAME="agent"
export MDC_USER="$USER_NAME"
echo "seeding as user=\"$USER_NAME\", agent=\"$AGENT_NAME\" (serve with MDC_USER=$USER_NAME)"

cat > "$OUT/overview.md" <<'EOF'
# Overview

The landing doc. Carries several threads so the dashboard's within-group sort
has something to order.

- A point about scope that needs review.
- A second point, still open.
- A third point, already settled.
EOF

cat > "$OUT/specs/design.md" <<'EOF'
# Design spec

A separate doc in its own folder, so the dashboard groups by file.

The data model is append-only.
EOF

cat > "$OUT/notes/scratch.md" <<'EOF'
# Scratch

A throwaway note whose sidecar will outlive it (we delete this .md after
seeding a comment, to make an orphaned sidecar).

This line gets a comment, then the doc is removed.
EOF

# Helper: comment, printing the new thread id (first 12-hex token).
new_thread() {  # <author> <file> <quote> <body>
  node "$CLI" --author "$1" comment "$2" --quote "$3" --body "$4" | grep -oE '[0-9a-f]{12}' | head -1
}

OVERVIEW="$OUT/overview.md"
DESIGN="$OUT/specs/design.md"
SCRATCH="$OUT/notes/scratch.md"

# overview.md — three threads spanning the states, so one group has variety.
# (1) Open, awaiting YOU: user asks, agent answers last → ball in user's court.
T1=$(new_thread "$USER_NAME" "$OVERVIEW" "A point about scope that needs review." "Is this in scope for the milestone?")
node "$CLI" --author "$AGENT_NAME" reply "$OVERVIEW" "$T1" --body "I think so — it fits the section contract." >/dev/null

# (2) Open, awaiting the AGENT: user spoke last → ball in agent's court.
new_thread "$USER_NAME" "$OVERVIEW" "A second point, still open." "Needs a decision before we build." >/dev/null

# (3) Resolved.
T3=$(new_thread "$USER_NAME" "$OVERVIEW" "A third point, already settled." "Confirming we agreed on this.")
node "$CLI" --author "$AGENT_NAME" reply "$OVERVIEW" "$T3" --body "Agreed — settled." >/dev/null
node "$CLI" resolve "$OVERVIEW" "$T3" >/dev/null

# design.md — a single open thread awaiting YOU, in a different folder/group.
T4=$(new_thread "$USER_NAME" "$DESIGN" "The data model is append-only." "Worth calling out the tradeoff here.")
node "$CLI" --author "$AGENT_NAME" reply "$DESIGN" "$T4" --body "Added a note on it." >/dev/null

# scratch.md — seed a thread, then delete the .md so its sidecar is orphaned.
new_thread "$USER_NAME" "$SCRATCH" "This line gets a comment, then the doc is removed." "Stranded once the doc goes." >/dev/null
rm -f "$SCRATCH"

echo "Dashboard workspace ready: $OUT"
echo "Serve it: MDC_USER=$USER_NAME node dist/cli.js serve \"$OUT\" --port 8099 --static-dir web/dist-dev --no-open --force"
echo "Tear down: node dist/cli.js stop --port 8099 && rm -rf \"$OUT\""
