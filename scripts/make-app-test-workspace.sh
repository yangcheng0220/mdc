#!/usr/bin/env bash
#
# Build a disposable workspace for exercising aggregator mini apps — apps that read
# and roll up a tree of project/task/session markdown by frontmatter (e.g. a
# work-browser-style dashboard). Unlike make-test-workspace.sh (which targets the
# file-move/rename link surfaces), this seeds a realistic structure-and-scale
# tree so an app's discovery, grouping, and live-update behaviour can be tested:
#
#   - several projects (PROJECT.md + ROADMAP.md), each a project "key"
#   - many tasks across projects/milestones/statuses (enough to feel real)
#   - many sessions linked to projects/tasks
#   - a couple of edge rows: a task with no project, a session with no task
#
# Usage:  scripts/make-app-test-workspace.sh <output-dir> [app.html ...]
# Re-running wipes and rebuilds <output-dir>, so it doubles as a reset.
# Any [app.html] paths are copied into <output-dir>/apps/ (the app under test).
# Then:   node dist/cli.js serve <output-dir> --port 8099 --static-dir web/dist-dev --no-open --force
# Live-update test: add/edit/delete a file under tasks/ or sessions/ while the
# app is open and watch it refresh.

set -euo pipefail

OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "usage: $0 <output-dir> [app.html ...]" >&2
  exit 2
fi
shift

OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"  # absolutise
find "$OUT" -mindepth 1 -delete
mkdir -p "$OUT/projects" "$OUT/tasks" "$OUT/sessions" "$OUT/apps"

# --- projects -------------------------------------------------------------
# Three projects so grouping has something to spread across.
for proj in alpha:Alpha:active beta:Beta:active gamma:Gamma:paused; do
  key="${proj%%:*}"; rest="${proj#*:}"; name="${rest%%:*}"; status="${rest#*:}"
  mkdir -p "$OUT/projects/$key"
  cat > "$OUT/projects/$key/PROJECT.md" <<EOF
---
type: project
name: $name
project_status: $status
---
# $name
EOF
  cat > "$OUT/projects/$key/ROADMAP.md" <<EOF
---
type: roadmap
project: $key
---
# $name Roadmap
EOF
done

# --- tasks ----------------------------------------------------------------
# A spread across projects, milestones, and statuses; enough rows to be
# representative of a real workspace (not the 8-file fixture that hid the
# serial-read perf bug).
mk_task() { # name project milestone status created
  # Realistic task shape: frontmatter (incl. priority + due) → ## Goal → ## Plan,
  # matching a real task file (no bare H1 title) so apps that read/rewrite the
  # goal body or frontmatter are tested against a true-to-life structure.
  cat > "$OUT/tasks/$1.md" <<EOF
---
type: task
task_status: $4
priority: normal
project: $2
milestone: $3
created: $5
due:
---

## Goal

Placeholder goal for $1.

---

## Plan

- [ ] first step
- [ ] second step

---

## Context

Seeded context for $1.
EOF
}
i=1
for p in alpha beta gamma; do
  for n in $(seq 1 8); do
    case $(( (i + n) % 3 )) in 0) st=done;; 1) st=wip;; *) st=todo;; esac
    mk_task "$p-task-$n" "$p" "p1/m$(( (n % 2) + 1 ))" "$st" "2026-06-$(printf '%02d' $(( (i + n) % 28 + 1 )))"
  done
  i=$(( i + 1 ))
done
# Edge: a task with no project (orphan bucket).
mk_task "loose-task" "" "" "todo" "2026-06-15"

# --- sessions -------------------------------------------------------------
mk_session() { # filename project task date
  cat > "$OUT/sessions/$1.md" <<EOF
---
type: session
project: $2
task: $3
date: $4
---
# $1
EOF
}
for p in alpha beta gamma; do
  for n in $(seq 1 6); do
    mk_session "2026-06-$(printf '%02d' $(( n + 1 )))-1${n}-00-$p-s$n" "$p" "$p-task-$n" "2026-06-$(printf '%02d' $(( n + 1 )))"
  done
done
# Edge: a session with a project but no task.
mk_session "2026-06-20-09-00-alpha-loose" "alpha" "" "2026-06-20"

# --- apps under test ------------------------------------------------------
for app in "$@"; do
  if [ -f "$app" ]; then
    cp "$app" "$OUT/apps/$(basename "$app")"
  else
    echo "warning: app not found, skipped: $app" >&2
  fi
done

echo "workspace ready: $OUT"
echo "  projects=$(find "$OUT/projects" -name PROJECT.md | wc -l | tr -d ' ')" \
     "tasks=$(find "$OUT/tasks" -name '*.md' | wc -l | tr -d ' ')" \
     "sessions=$(find "$OUT/sessions" -name '*.md' | wc -l | tr -d ' ')" \
     "apps=$(find "$OUT/apps" -name '*.html' | wc -l | tr -d ' ')"
