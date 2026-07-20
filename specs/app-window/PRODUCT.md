# App window

## Summary

mdc can present as a standalone app window instead of a browser tab, two ways: an opt-in that makes `mdc serve` / `mdc open` launch a chromeless Chrome app-mode window, and a server-generated web-app manifest so each workspace installs as its own distinctly named PWA.

## Flows

### Opt in to the app window

The user enables the app window durably with `app_window = true` in `.mdc.toml`, or per-invocation with `mdc serve --app-window`.

- Enabled + Chrome installed: `mdc serve` opens the workspace in a chromeless app-mode window (no tabs, no URL bar) instead of a browser tab. The window carries Chrome's Dock icon while running; closing it leaves nothing behind.
- Enabled + Chrome not found: silent fallback to the current behavior — a tab in the default browser. No error, no prompt.
- Disabled (default): behavior is unchanged — `mdc serve` opens a tab in the default browser.
- `--no-open` suppresses the launch either way.
- `mdc open <file>` is unaffected when a client is already connected (it switches the file in place, wherever the client is — tab, app window, or installed PWA). Only its no-client fallback honors the setting: it spawns an app-mode window instead of a tab.
- Chrome is used when *installed*, not only when it is the default browser.
- The opt-in is independent of PWA install: an installed mdc app and the app-window setting can coexist; users who launch from the Dock simply also pass `--no-open` or ignore the extra window.

### Install a workspace as a named app

The user opens the workspace in a normal Chrome tab and clicks the URL-bar install icon (or Safari File → Add to Dock).

- The install prompt, window title, Dock icon label, and Spotlight entry read "mdc — \<workspace folder name\>" (e.g. "mdc — personal"), not a bare "mdc".
- Two workspaces served on different ports install as two separate apps, each with its own workspace name in the Dock.
- The icon stays the shared mdc icon for every workspace.
- Apps installed before this change pick up the new name whenever the browser next refreshes the manifest; no user action required or offered.

## Out of scope

- App-mode launch on Windows and Linux — they keep the default-browser tab; the opt-in only takes effect on macOS.
- Detecting or launching other Chromium browsers (Edge, Brave, Dia) in app mode.
- Per-workspace icons or icon customization.
- Routing externally clicked `localhost` links into the installed PWA (that's a Chrome per-app user setting, not mdc behavior).
- An Electron or otherwise packaged desktop distribution.
