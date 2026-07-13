# Design system

The UI conventions for mdc's frontend (`web/src/`). Consult this before building or changing any UI. If what you're building doesn't fit a convention here, extend this doc in the same change — it describes what's true, and a divergence is either a bug in the code or a missing rule here, never silently both.

`web/src/styles/tokens.css` is the source of truth for color **values**; this doc is the source of truth for what they **mean** and how derived styles are built.

Five sections, one obligation each: what hues **mean** → how derived styles are **built** → how comment marks **behave** → which components to **import** → which looks to **match**.

## Color semantics — one meaning per hue

Every hue carries exactly one meaning. Never repurpose a status hue as a neutral cue, and never introduce a new hue for a meaning an existing one covers.

| Hue | Token family | Means | Never used for |
|---|---|---|---|
| Rust | `--comment`, `--comment-tint` | Comment work: text highlights, quote underlines, gutter dots, card flash, comment-box focus, dashboard open-status | Warnings, errors, generic emphasis |
| Blue | `--accent`, `--selection` | Navigation + app chrome: links, wikilinks, text selection, generic focus, active system chips | Comment marks, status |
| Amber | `--warning-*` | Notice/pending state: doc banners, save-conflict, busy states | Hover cues, decoration |
| Red | `--danger` | Destructive actions and irrecoverable state ("doc deleted") | Emphasis |
| Muted red-brown | `--broken`, `--broken-border` | Broken references and render errors | Destructive actions (that's `--danger`) |
| Green | `--success` | Live/connected state (agent presence) | Confirmation flourishes |
| Teal | `--diff-add`, `--diff-add-tint` | Text added by a suggestion; text present only on the right (added) side of a conflict merge view | Live state, confirmation |
| Violet | `--diff-del`, `--diff-del-tint` | Current text removed by a suggestion; text present only on the left (removed) side of a conflict merge view | Errors, destructive actions |

Authorship is **not** a color: comment marks are one rust regardless of author. Who wrote what shows on the cards (avatars: agent = rust-tinted, user = neutral) and in words, never as a second mark hue.

## Token recipes — how derived styles are built

**No hardcoded chromatic values outside `tokens.css`.** Every color in a style rule is a token or a `color-mix()` derivation of one. (Documented exceptions below.)

Derived washes use `color-mix(in srgb, var(--base) N%, transparent)` with these rungs. Diff tints are the exception: `--diff-*-tint` mixes with `var(--surface)` so the tint stays legible on both themes.

| Rung | % | Used for |
|---|---|---|
| Hover wash | 14 | Highlight/underline hover (both modes), banner action hover |
| Pending band | 18 | Compose-preview highlight |
| Selection | 24 light / 42 dark | `--selection` (needs its own rung — a hover tint is too faint) |
| Link underline | 35 | `text-decoration-color` at rest; full accent on hover |
| Flash | 45 → transparent | Click flash, 1.2s ease-out, both modes |
| Chip emphasis border | 55 | Open-status chip outline |
| Focus ring | 10–12 at 3px | `box-shadow: 0 0 0 3px color-mix(...)`, hue per context |
| Presence pulse glow | 20 at 2px | the live status dot's animated ring (`--success`) — a presence signal, not a focus ring |

Dark theme rungs are **derived relative to the surface they sit on**: light surfaces darken their tints, dark surfaces lighten them (e.g. dark `--code-bg` sits *above* the dark doc surface, not below it).

**Shadows** are neutral black-alpha literals (theme-agnostic), in three informal elevation bands: subtle lift (cards, small chips — `0 1-2px` offset, `2-8px` blur), floating chrome (menus, toolbars, popovers — `0 4-6px` offset, `12-22px` blur), modal/lightbox (`0 8-20px` offset, `40-60px` blur, over a `var(--scrim)` or lightbox backdrop). Don't invent new shadow stacks; copy the nearest existing one in the band.

**Documented exceptions** (allowed literals):
- Neutral black-alpha shadows and overlays (the image lightbox backdrop, image-control chips) — theme-agnostic; see Shadows above.
- White-alpha hover washes on the dark-chip family (`--toast-*` surfaces) — the chip is dark in both themes.
- The HTML-render iframe backdrop is `#fff` — untrusted HTML assumes a white default canvas.
- `hljs-dark.css` — a vendored third-party syntax theme, exempt wholesale.

## Comment marks — one grammar, both modes

A comment's in-text mark behaves identically in the rendered view and the editor. **Any mark behavior added to one mode must land in both in the same change.**

| State | Rendered view (`.hl-rect`) | Editor (`.cm-comment-underline`) |
|---|---|---|
| Rest | 2px rust bottom border | same |
| Hover | 14% wash on **all** rects of the comment (`.hover` class, group-set by JS) | same, group-set on all spans (`data-comment-id`) |
| Click flash | 45% → transparent, 1.2s | same |
| Click | jumps to the card (opens a collapsed sidebar, switches a Resolved filter back to Open) | same |

Group behavior matters because one comment renders as multiple boxes (one per line/span); native `:hover` would tint only the hovered piece. Both modes set a `.hover` class on the whole group.

Rendered-view marks are painted as **overlay rects** — never wrap the doc DOM (see the header comment in `render/highlights.ts`).

## Reusable components — import, don't rebuild

These exist as shared components. Needing one of these behaviors and hand-rolling the markup instead is a bug:

| Component | Use for |
|---|---|
| `ConfirmDialog` | ANY generic blocking confirm (title, message, confirm label, `danger`/`primary` tone; Esc/Enter/click-outside handled). App permission prompts (trust/write-grant cards) are their own card family, not confirms |
| `AppPermissionCard` | App trust and write-grant prompts that need permission framing, scope lists, action rows, footnotes, and Escape-to-cancel behavior |
| `DocBanner` | ANY doc-top notice (warning icon + text + actions + optional dismiss) |
| `ContextMenu` | A floating action menu anchored at a screen point (list-driven; outside-click/Esc/scroll dismissal handled) |
| `DropdownMenu` | A trigger-button anchored dropdown shell (open state, outside-click/Esc dismissal, caller-owned trigger/menu classes and items) |
| `IframeSurface` | Standalone iframe file views (blank loading shell, doc-error state, and full-height frame while callers keep each surface's sandbox/src attributes) |
| `InlineCreate` | An inline name input in a tree/list (Enter commits, Esc/blur cancels) |
| `PaletteShell` | Shared searchable modal palette shell (query state, keyboard navigation, scroll-selected-into-view, backdrop/Esc dismissal, input/list/footer skeleton) for command/file palettes |
| `Toast` + `useToast` | Transient confirmations |
| `icons.tsx` | Every shared glyph (stroke-based, `currentColor`, size prop) |

Rules of the inventory:

- **Check here first.** Before drawing an inline SVG or hand-rolling a dialog/menu/banner, check this table and `icons.tsx` — rebuilding something listed is a bug.
- **Promotion:** a glyph or widget used once may live local to its component; extract/promote it on second use. That's how everything in this table earned its place — when *markup* (not just style) starts duplicating, extract the component.
- **Exception:** imperative CodeMirror widgets can't take React components and may inline an SVG string — keep the geometry identical to the shared glyph.

## Component vocabulary — looks to match

For UI that isn't a shared component, match the established look rather than inventing one:

- **Segmented control** — `pane-switcher`/`pane-tab` vocabulary (nav panes, dashboard filter); the compact view/edit toggle (`.mode-toggle`) is a sibling recipe of the same family. Labels may carry counts — the control doubles as the summary; don't add a separate summary line.
- **Quiet outline chip** — one recipe (11px / 600 / 1px 8px padding / `--border-mid` / radius 8): dashboard status chips, the orphaned tag. Meaning via border/text color only; a filled chip is not a variant of this pattern.
- **Primary button** — solid `--text` background with `--surface` text, compact pill geometry: Hand off, composer submits, `ConfirmDialog` `.primary`, app-trust Run, and affirmative suggestion actions. Pair with the existing neutral outline-cancel treatment when an adjacent action should stay quieter.
- **Parenthetical state** — file-level state ("doc deleted") is a red uppercase parenthetical beside the name, not a chip; the right column belongs to row status.
- **Cards** — comment/thread cards: `--surface`, 1px `--border`, radius 8, wash shadows; flash = 2px rust outline.
- **Composers** — the reply form and new-comment form share one family; extend it, don't fork it.
- **Modals** — the backdrop is `var(--scrim)` for every modal. Shells differ by purpose (settings, confirm, palette) and are not force-unified.
- **Escape layering** — an overlay that consumes Escape (modal, palette, menu, lightbox) calls `preventDefault()`; a surface that cancels on a global Escape listener (permission cards) listens on `window` and skips `defaultPrevented` events, so a stacked overlay's Escape never also cancels what's beneath it.
- **Dark chip** (selection toolbar, toasts, the pinned preview's Reject/Accept/Close actions) — `--toast-*` tokens, never `--text`/`--surface` (those double-invert in dark). The preview chip renders identically in both modes: one dark bar, buttons divided by `--toast-text-dim` hairlines, UI font (forced past the editor's monospace), on its own reserved row directly above the change (the topmost changed list item or block) — never painted over text.
- **Pinned suggestion preview** — one language in both modes, headed by the dark decision chip on its own row. **View mode** temporarily swaps the target's complete rendered blocks for a sibling preview while leaving the source nodes intact and hiding that thread's rust highlight rects; closing removes the preview, unhides the originals, and restores the captured scroll position. **Edit mode** shows the same change as a CodeMirror unified-merge chunk over the live buffer (autosave suspended while pinned; the merge package's own chunk buttons and gutter markers are disabled). The two shapes, in either mode: a word-level change reads as one in-place word diff on plain paper — struck `--diff-del` deletions, `--diff-add` insertions, no line washes; a structure-level change reads as stacked Current/Proposed blocks — clean text on `--diff-del-tint`/`--diff-add-tint` washes with 3px `--diff-del`/`--diff-add` edge bars, no word marks. Pinning brings an offscreen preview to the reader (top-aligned when taller than the viewport, centred otherwise) and never moves the page on a mark click; the pinned thread's margin card keeps its last known position while its quote is absent from the surface.
- **Edit-mode comment indicator** — the comment-colored underline on the anchored quote is the sole in-text indicator and click target; there is no gutter marker.
