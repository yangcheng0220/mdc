#!/usr/bin/env bash
#
# Build a disposable workspace for VISUAL THEME review (dark mode). Puts every render
# surface on screen so a palette can be swept in one place:
#
#   - headings, body text, bold/italic/strikethrough, links
#   - frontmatter (the Properties block)
#   - inline code + fenced code blocks in several languages (syntax colors)
#   - a mermaid diagram
#   - blockquote, table, ordered/unordered/task lists
#   - wikilinks (resolved + broken) and an image embed
#   - HTML authoring-note comment block (the .md-note style)
#   - a standalone image file and a standalone .html file (their own views)
#   - comment threads: one OPEN + one RESOLVED (margin cards + highlights in dark)
#
# Usage:  scripts/make-theme-workspace.sh <output-dir>
# Re-running wipes and rebuilds <output-dir> (doubles as a reset).
# Serve:  MDC_USER=user node dist/cli.js serve <output-dir> --port 8099 \
#           --static-dir web/dist-dev --no-open --force
# Tear down:  node dist/cli.js stop --port 8099  &&  rm -rf <output-dir>
#
# Requires the CLI built (dist/cli.js): npm run build:cli (or npm run build).

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
mkdir -p "$OUT/assets"

USER_NAME="user"
AGENT_NAME="agent"
export MDC_USER="$USER_NAME"

# A tiny but real PNG (blue 16x16) so the image surfaces have something to show.
python3 - "$OUT/assets/diagram.png" <<'PY'
import sys, struct, zlib
def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))
open(sys.argv[1], 'wb').write(png(16, 16, (37, 99, 235)))
PY

# The main showcase doc — frontmatter + every markdown surface.
cat > "$OUT/showcase.md" <<'EOF'
---
title: Theme Showcase
status: draft
tags: [dark-mode, review]
---

# Theme Showcase

A doc that exercises **every render surface** so the palette can be swept in one
place. Body text with _italic_, **bold**, ~~strikethrough~~, a [real link](https://example.com),
and `inline code`. A code-only link [`linked.code()`](https://example.com) must hover
with no underline stubs at the chip corners; a mixed link [text and `code` together](https://example.com)
keeps its underline.

> A blockquote — check its left border and muted text against the dark surface.

## Code blocks

```ts
// TypeScript — syntax colors should be the dark github theme.
export function greet(name: string): string {
  const greeting = `Hello, ${name}!`;
  return greeting.repeat(2); // numbers, strings, keywords, comments
}
```

```python
# Python — a second language to check token coverage.
def fib(n: int) -> list[int]:
    out = [0, 1]
    while len(out) < n:
        out.append(out[-1] + out[-2])
    return out
```

## Mermaid

```mermaid
flowchart TD
  A[Edit doc] --> B{Theme?}
  B -->|light| C[neutral]
  B -->|dark| D[dark]
```

## Lists and a table

1. Ordered item one
2. Ordered item two
   - nested unordered
   - [ ] an open task
   - [x] a done task

| Surface | Token | Note |
|---------|-------|------|
| body    | --text | primary |
| muted   | --text-muted | secondary |
| accent  | --accent | links/active |

## Links between docs

A resolved wikilink to [[notes]] and a broken one to [[does-not-exist]].

An image embed: ![[assets/diagram.png]]

<!-- An HTML authoring note — should render as a muted dashed note block in mdc. -->

The end.
EOF

cat > "$OUT/notes.md" <<'EOF'
# Notes

A second doc so the wikilink from the showcase resolves, and the file tree has
more than one entry.
EOF

# A standalone HTML file (its own view).
cat > "$OUT/page.html" <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>Standalone HTML</title>
<style>body{font-family:sans-serif;padding:40px}h1{color:#2563eb}</style></head>
<body><h1>Standalone HTML view</h1><p>Rendered in a sandboxed iframe.</p></body></html>
EOF

# Comment threads on the showcase: one OPEN, one RESOLVED — so the margin cards
# and the highlight overlay both show in dark.
new_thread() {  # <author> <file> <quote> <body>
  node "$CLI" --author "$1" comment "$2" --quote "$3" --body "$4" | grep -oE '[0-9a-f]{12}' | head -1
}
SHOW="$OUT/showcase.md"

# Open thread, agent replied last (a margin card with a reply).
T1=$(new_thread "$USER_NAME" "$SHOW" "A doc that exercises" "Does this cover the comment card colors too?")
node "$CLI" --author "$AGENT_NAME" reply "$SHOW" "$T1" --body "Yes — open and resolved cards both render here." >/dev/null

# Resolved thread (check the resolved styling in dark).
T2=$(new_thread "$USER_NAME" "$SHOW" "A blockquote" "Resolved: blockquote border looks fine." )
node "$CLI" resolve "$SHOW" "$T2" >/dev/null

echo "theme workspace ready at: $OUT"
echo "serve: MDC_USER=$USER_NAME node dist/cli.js serve \"$OUT\" --port 8099 --static-dir web/dist-dev --no-open --force"
