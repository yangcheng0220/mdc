#!/usr/bin/env bash
#
# Promote the running mdc server to the current code, on demand.
#
# The frontend builds into two separate outputs: `web/dist-dev` for the
# iteration loop (rebuilt constantly) and `web/dist` for the server you
# actually keep open. Building no longer moves the running server — this script
# is the only thing that does, so a test rebuild can never re-skin it.
#
# It rebuilds the whole product (frontend `web/dist` + the CLI) from the current
# code, then restarts the server on it. Building both means the restart picks up
# frontend AND backend changes together — never a new UI on a stale backend.
# Safe to run any time, however many times: `serve --restart` stops any server
# on the port and starts fresh, or starts clean if none is running.
#
# Usage:  scripts/ship.sh <root> [port]
#   <root>  the directory to serve (defaults to the current directory)
#   <port>  the port to serve on (defaults to the server's default port)
#
# Does NOT touch git — merge/commit when you mean to, separately.

set -euo pipefail

ROOT="${1:-.}"
PORT="${2:-8000}"

# Resolve relative to where this script lives, so it works from any cwd.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

echo "building the product (web/dist + CLI) ..."
npm run build

echo "restarting the mdc server on: $ROOT (port $PORT)"
node dist/cli.js serve "$ROOT" --port "$PORT" --restart

echo "done — the server is now on the current build."
