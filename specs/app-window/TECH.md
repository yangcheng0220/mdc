# App window — tech spec

Implements [PRODUCT.md](PRODUCT.md). Two independent slices: the opt-in Chrome app-mode launch (CLI only) and the workspace-named web app manifest (server only). "Web app manifest" throughout — bare "manifest" already means the mini-app manifest (`src/apps/manifest.ts`).

## Approach

### App-mode launch (`src/`)

- New module `src/launch.ts` owning both launchers, with injectable spawn for tests (pattern: `IdentityEnv` in `src/identity.ts:32`):
  - `openInBrowser(url)` moves here unchanged from `src/cli.ts:394`.
  - New `openWorkspaceWindow(url, { appWindow })` — when `appWindow` and on darwin and `open -Ra "Google Chrome"` exits 0, spawn `open -na "Google Chrome" --args --app=<url>`; every other case (flag off, non-darwin, Chrome missing, spawn failure) falls through to `openInBrowser`. Same gate roughdraft uses, minus their default-browser check.
- New `readAppWindowConfig(root)` in `src/launch.ts`: reads `app_window` (boolean) from `<root>/.mdc.toml` via `smol-toml`, best-effort like `readConfigUser` (`src/identity.ts:44`) — missing/malformed → false. Root config only, no `~/.mdc.toml` fallback: it's a workspace preference, unlike identity which follows the user.
- `mdc serve` gains `--app-window`; effective value = flag OR config. The three serve-path `openInBrowser` call sites (`src/cli.ts:680` adopt, `:715` foreground, `:759` background) become `openWorkspaceWindow(baseUrl, { appWindow })`. `--no-open` short-circuits before any of them, unchanged.
- `cmdOpen`'s no-client fallback (`src/cli.ts:541`) resolves the served root from the probe it already makes (`probeServer` returns `{ kind: "mdc", root }`, `src/server-client.ts:94`) and passes `readAppWindowConfig(root)`. No new flag on `mdc open`.
- The in-place switch path (`POST /api/open`) is untouched — connected clients keep receiving file switches regardless of window kind.

### Workspace-named web app manifest (`src/server/`)

- Replace the `"/manifest.webmanifest"` entry in the `rootStatics` table (`src/server/app.ts:158`) with a dedicated route that builds the JSON in the handler: `name: "mdc — " + basename(cfg.root)`, `short_name: basename(cfg.root)`, and the same `start_url`/`display`/colors/icon list the static file has today. Icon paths still resolve through `rootStatics`.
- Delete `web/public/manifest.webmanifest` — the server route is now the only source; a stale copy in `web/dist` would shadow nothing (the route wins) but would mislead readers. The `<link rel="manifest">` in `web/index.html` is unchanged.
- Tradeoff: theme colors get duplicated between `web/index.html` meta tags and the route's constants. Accepted — one more copy of two hex values beats a build-time templating step.

### Keep-in-sync docs

- `.mdc.toml.example`: new `app_window` section (config contract).
- `docs/agent-setup.md`: `--app-window` is a CLI-surface change, so the contract requires it. Add the flag + `app_window` config to the serve bullet, and one line that an installed app or app-mode window is a normal connected client — `mdc open` and the review loop behave identically, so agents shouldn't expect a browser tab. No install walkthrough (that's README territory).
- `README.md`: a short "Run it as an app" section — the browser install path (Chrome install icon / Safari Add to Dock, shipped in 0.5.0 but not yet documented) plus the `app_window` opt-in. Draft goes to Odie for review before merge (user-facing doc).

## Test plan

Vitest:

- `tests/launch.test.ts` — `openWorkspaceWindow` with injected spawn: appWindow on + Chrome detected → `open -na … --app=<url>`; Chrome probe fails → default opener; non-darwin → default opener; flag off → default opener. `readAppWindowConfig`: true / false / absent key / missing file / malformed TOML.
- `tests/app-api.test.ts` (existing server-app suite) — GET `/manifest.webmanifest` returns 200 `application/manifest+json` with `name` ending in the fixture root's basename; icons array paths all resolve to 200s.

Live verification (`npm run build && npm run build:web:dev`, disposable fixture workspace):

1. `node dist/cli.js serve <fixture> --port 8099 --static-dir web/dist-dev --app-window --no-open` — then re-run without `--no-open`: a chromeless Chrome window opens showing the fixture's file tree; the Dock shows Chrome's icon.
2. `curl localhost:8099/manifest.webmanifest` — `name` is `mdc — <fixture folder>`; confirm installability via CDP `Page.getInstallabilityErrors` = `[]` and `Page.getAppManifest` showing the workspace name.
3. With `app_window = true` in the fixture's `.mdc.toml` and no flag, close all clients, `node dist/cli.js open <fixture doc>` — the fallback spawns an app-mode window, not a tab.
4. Teardown: `node dist/cli.js stop --port 8099`, delete the fixture.

Sign-off before commit: `npm run typecheck:web && npm run typecheck && npm test && npm run knip`.

## Risks

- `open -na` starts a full Chrome instance when Chrome isn't already running (session restore and all). Accepted: identical to roughdraft's behavior, and the opt-in gate means the user chose Chrome-based launching.
