# mdc — agent setup

This document wires a coding agent into mdc. Print it any time with `mdc setup`.

mdc is a local markdown workspace for humans and coding agents: it serves a folder in the browser, and the file tree opens markdown (with Mermaid diagrams, syntax-highlighted code, task lists, …), images, PDFs, and `.html` files in a sandboxed frame. The HTML surface matters for agents: produce a mockup, report, or diagram anywhere in the workspace and the user views it inline — `mdc open` it; doc edits appear via a live-reload banner, nothing restarts.

Review is the heart of it: the human highlights text in a doc and leaves margin comments; the agent reads and answers them through the `mdc` CLI. Comments live in a `.comments.jsonl` sidecar next to each `.md` file — the doc itself is never touched by commenting, and the sidecar works with or without the server running. **Margin comments are markdown-only:** `.md` files carry the review threads; images, HTML, and PDFs are view-only — don't point the review loop at them.

## How to use this document

1. **Read it now** — everything needed to work with mdc is below.
2. **Persist an activation rule — ask the user how, first.** Before wiring anything, ask the user how they want mdc's instructions kept in this harness (a skill, CLAUDE.md, AGENTS.md, a rules file — whatever applies) — this is their call, not a default to assume. Two ways, both fine:
   - **A pointer** — persist a short rule that says to run `mdc setup` and follow it whenever the user reaches for mdc; the agent re-reads this doc each time, so it always matches the installed version:

     > This workspace uses mdc. Run `mdc setup` and follow it whenever the user:
     > - asks to review a doc together, or says they left comments on a file
     > - asks for a mini app (a small tool over workspace files), or changes to one
     > - asks for a mockup, report, or diagram to view in the workspace

   - **A full skill / instruction block** — copy or distill this doc into the harness instead of pointing at it. Self-contained (no `mdc setup` at use time), but frozen at this version: re-run `mdc setup` to refresh after upgrading.

3. **Set up standing approval for `mdc` commands — with the user, never silently.** The review loop re-runs `mdc watch` every chunk, and a single unnoticed per-command approval prompt stalls the whole session: the user thinks they're being watched while the agent sits waiting for a click. So the whole `mdc` command family should be auto-approved. As part of this setup:
   - **Ask the user first and get explicit OK** — don't configure approvals without it.
   - Configure it through this harness's own permission mechanism — a settings allowlist entry (e.g. `mdc *`), an "always allow" grant, a permissions config file, whatever applies here. Like the persist step: the agent knows its own harness; do the wiring, don't hand the user a manual.
   - **Don't assume it worked** — if an `mdc` command still prompts after you've configured it, tell the user plainly they'll see prompts each session rather than claiming it's handled.
   - If the harness has no durable mechanism, say so plainly and tell the user to expect (and promptly answer) approval prompts during review sessions.

## The basics

- `mdc serve [root]` — serve a folder (defaults to the current directory) and open the browser. If a server already covers the root it just opens the browser; to move a running server to a different root, add `--force`.
- `mdc check` — is a server running?
- `mdc open <file>` — focus a file in the user's browser tab. Use this to put a doc in front of the user instead of pasting a path or URL. It does not start a server.
- Every file argument is an **absolute path**.
- **Ports:** the server defaults to port 8000. Serving elsewhere (`mdc serve <root> --port 8099`) means every server-backed command — `open`, `watch`, `check` — needs the matching `--base-url http://localhost:8099`. The sidecar commands (`list-pending`, `reply`, …) take no server and no port.
- **Identity:** the human's name comes from `user` in `~/.mdc.toml`; set it with `mdc identity <name>`. Entries written by the agent pass `--author <name>` (default `agent`). Never write as the human.

## Reviews start one of two ways

**One-shot — the user already left comments.** "Check my comments on `<file>`" needs no session and no server: run `mdc list-pending <file>`, answer the threads (next section), done. This is the simplest entry — start here if unsure.

**Session — reviewing together, multiple rounds.** The turn-taking loop:

```
mdc watch <file> --timeout 60  →  {intent: "timeout"}?  re-run immediately, silently
                               →  user clicked Hand off?  reply, then re-arm
```

`mdc watch <file> --timeout 60` is a **quick command**: it returns within 60 seconds at the latest — earlier if the user clicks **Hand off** or **End session** — and prints `{intent, file, pending}` as JSON. Its return is the wake-up signal, so:

- **Run it like any ordinary foreground command and read its output when it returns. NEVER run it in the background** or a detached terminal — output that lands in a background log wakes nobody, and the user's Hand off goes unanswered. It is not a long-running process; it is a poll that returns within the timeout.
- **`timeout`** — nobody signaled in this chunk. Re-run the same command **immediately and silently** (no status chatter); the chunks add up to one continuous watch. Never treat a timeout as the user being done. Re-arm promptly — a Hand off clicked in the tiny gap between chunks is dropped and the user has to click again.
- Any other intent — act on it (list below), and after a reply round re-arm the same way. The loop ends only when the user clicks **End session**.

Always use `--timeout`. If the tooling still tries to background a 60-second command, drop to `--timeout 15` — short enough to read as the quick command it is.

Arm the watch **before** telling the user to comment — the Hand off button only reaches an agent that is already watching; a click while nothing watches is silently dropped. As the loop starts, tell the user one line: watching `<file>` — leave comments and click **Hand off** (or **End session** to finish).

Switch on `intent`:

- **`timeout`** — nobody signaled within the chunk. Re-run immediately and silently (see above).
- **`review`** — the user handed off. `pending` is the batch of threads awaiting reply: answer them (next section), then re-arm for the next round.
- **`review` with empty `pending`** — do **not** assume a review is wanted. A bare Hand off on a clean doc means either "review my draft" or "I'm done here" — ask which, in one short question, before commenting. (Skip the question only if the user explicitly asked for a draft review this turn.)
- **`done`** — the user ended the session. Say so and stop; post nothing.
- **`server-down` / `unreachable`** — no server, or the file is outside the served root. Ask which root to serve, `mdc serve <root>` (add `--force` to move a running server), `mdc open <file>`, then re-arm.

## Answering threads

Read the threads, then the doc — anchors only make sense in context:

```
mdc list-pending <file>              # threads awaiting reply (JSON: ids, quotes, lines, entries)
mdc get-thread <file> <thread_id>    # one thread's full arc
mdc reply <file> <parent_id> --body "…"
mdc comment <file> --quote "…" --body "…" [--line N]   # new top-level comment (draft reviews)
```

Rules that make the loop work — get these wrong and the review breaks:

- **Content in the margin, status in the chat.** The margin reply is the deliverable. Decide each reply silently and post it with `mdc reply`; the chat gets one status line per thread (`thread <id> — replied`), never the reply text or a preamble narrating what will be posted. A clarifying question is still review content — it goes in the margin as a reply that asks, not in the chat.
- **Reply; don't resolve.** Resolving hides the thread and with it the fresh reply. Resolving is the user's action after reading; only resolve on their explicit request.
- **Every thread gets a reply** — that's the unit of work. If a thread asks for a doc change that is small, local, and unambiguous, make the edit directly in the `.md` and reply noting it was made; if the change is large or could be applied more than one way, reply proposing it instead. Never hand-edit the sidecar — the CLI writes it.
- **Answer questions from what the doc (and the surrounding project) actually says — never fabricate.** If the doc doesn't contain the answer, the reply says so and asks — do not invent an answer, and do not edit new claims into the doc to settle a question. When an inconsistency can be fixed in more than one direction (two numbers disagree, two names conflict), ask which is right instead of picking one.
- **Draft reviews** (user asked for comments on a fresh doc): post local, anchored points via `mdc comment` — one thought per entry, quoting the exact rendered text the user would select; 3–8 anchors is typical. Only feedback with no single anchor (structure, missing pieces, overall judgment) belongs in the chat.
- **Empty `list-pending` when threads were expected** → suspect identity before concluding the doc is clean: a thread is "pending" only when the configured human spoke last, so writing replies under the human's name (or listing as the wrong user) makes pending work invisible.

The sidecar is the source of truth: `list-pending`, `get-thread`, `reply`, `comment` all work with no server running. Only `watch` and `open` need one.

## Mini apps

A trusted HTML file can run as a small app that reads and writes workspace files through a permissioned `window.mdc` bridge — dashboards, boards, and tools the agent can build for the user. The build contract (API, manifest, sandbox limits, design conventions) is `docs/mini-app-guide.md` in this package. A ready-made example ships in the box: `mdc example kanban` copies a markdown-backed kanban board into the workspace's `apps/` folder — open it in the file tree and trust it to run. It doubles as reference code when building a new app.
