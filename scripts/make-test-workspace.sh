#!/usr/bin/env bash
#
# Build a disposable test workspace for exercising mdc's file operations (move,
# rename, delete) and their reference-rewriting. The workspace covers every link
# surface a path change touches, so a move can be verified end to end:
#
#   - inbound relative links  (other docs linking TO a file: ../../doc.md)
#   - outbound relative links  (a doc's own links, which rebase when it moves)
#   - a bare wikilink           [[doc]]        — resolves by basename, survives
#   - a path-qualified wikilink [[folder/doc]] — resolves by path, rewrites
#   - a relative image src      ![](../img.png) — rebases
#   - a basename image embed    ![[img.png]]    — survives
#   - a sidecar with a comment thread (must travel with its .md)
#   - external + root-absolute links (must NEVER be rewritten)
#
# Usage:  scripts/make-test-workspace.sh <output-dir>
# Re-running wipes and rebuilds <output-dir>, so it doubles as a reset.
# Then:   node dist/cli.js serve <output-dir> --port 8099 --no-open --force
#
# Requires the CLI to be built (dist/cli.js) for the comment-thread step:
#   npm run build:cli   (or npm run build)

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
# Wipe everything (fresh build / reset), then lay out the tree.
find "$OUT" -mindepth 1 -delete
mkdir -p "$OUT/notes/projects" "$OUT/notes/daily" "$OUT/archive" "$OUT/assets"

cat > "$OUT/index.md" <<'EOF'
# Index

Top-level doc. Links *into* the tree via relative paths — inbound links to the
move targets.

- [Alpha](notes/projects/alpha.md) — relative link to the prime move target.
- [Beta](notes/projects/beta.md)
- [Today](notes/daily/today.md)

External link (must NOT be rewritten): [the web](https://example.com/page.md).
Root-absolute link (must NOT be rewritten): [abs](/notes/projects/alpha.md).
EOF

cat > "$OUT/notes/projects/alpha.md" <<'EOF'
# Alpha — the prime move target

Outbound relative links rebase when this file moves; the sidecar travels with
it; images appear both ways.

## Outbound relative links

- Up to the index: [index](../../index.md)
- Sibling: [beta](beta.md)
- Across: [today](../daily/today.md)

## Images

- Relative src (rebases): ![diagram](../../assets/diagram.png)
- Basename embed (survives): ![[diagram.png]]

## External (must NOT rewrite)

- [example](https://example.com/x.md)
EOF

cat > "$OUT/notes/projects/beta.md" <<'EOF'
# Beta

Holds an inbound relative link to alpha — rewrites when alpha moves.

- [alpha](alpha.md) — sibling relative link to the move target.
- [index](../../index.md)
EOF

cat > "$OUT/notes/daily/today.md" <<'EOF'
# Today

Wikilink branches — the subtle ones.

- Bare wikilink (basename → survives a move): [[alpha]]
- Path-qualified wikilink (path → rewrites): [[notes/projects/alpha]]
- Wikilink with section + alias (basename → survives): [[alpha#images|Alpha images]]
- Plain relative link to alpha: [alpha doc](../projects/alpha.md)
EOF

# A 1x1 PNG so image resolution hits a real file.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$OUT/assets/diagram.png"

# A real comment thread on alpha (a comment + a reply), so a move can verify the
# sidecar travels and stays intact. Author names are generic.
ALPHA="$OUT/notes/projects/alpha.md"
RAW=$(node "$CLI" --author user comment "$ALPHA" --quote "the prime move target" --body "Does this survive a move into archive/?")
CID=$(printf '%s' "$RAW" | grep -oE '[0-9a-f]{12}' | head -1)
node "$CLI" --author agent reply "$ALPHA" "$CID" --body "It should — the sidecar travels with the .md." >/dev/null

echo "Test workspace ready: $OUT"
echo "Serve it: node dist/cli.js serve \"$OUT\" --port 8099 --no-open --force"
