---
name: write-tech-spec
description: Write a TECH.md spec for a significant mdc feature after researching the codebase. Use when the user asks for a technical spec, implementation plan, architecture plan, or module breakdown tied to product behavior.
---

# write-tech-spec

Write a `TECH.md` spec for a significant mdc feature.

## Overview

The tech spec is the implementation approach as scannable bullets grounded in real code, plus the test plan. A reviewer should be able to scan it in under a minute and spot the risky decision. It is not a build log or a tutorial: every bullet either names a change to make or a decision a reviewer might push back on.

Prefer a sibling `PRODUCT.md` first (`write-product-spec`). Reference its flows instead of restating user-facing behavior.

Write specs to `specs/<feature>/TECH.md`, matching the sibling product spec's feature name. `specs/` should contain only feature-named directories as direct children.

Only create a GitHub issue when the user explicitly asks. Issue tracker conventions are in `docs/agents/issue-tracker.md`.

## When To Use

Use for changes that span multiple modules, touch the backend and frontend together, or introduce new data flow. Skip for single-file UI fixes.

## Research Before Writing

Read the product spec, then inspect the actual code. Do not guess about architecture when the code can be read:

- `CONTEXT.md` for domain terms and relevant `docs/adr/*` for constraints.
- The affected source. mdc is one package with two build targets: `src/` (core sidecar/anchoring, the `mdc` CLI, and the Hono server under `src/server/`) and `web/src/` (the React frontend). See `DESIGN.md` for frontend conventions.
- Existing helpers and primitives that already do part of the job. Naming an existing unused helper beats proposing a new one.

## Structure

1. **Approach** — the core of the spec. Bullets stating what changes where, each grounded in real code: `New helper classifyHref(href) used in three places: ...`, `No parser/serializer changes; links round-trip as-is`, `Reuse resolveSidecarPath from src/sidecar.ts (exists but unused here)`. Group by concern (backend `src/`, frontend `web/src/`) when the change spans layers. Explicitly call out what does NOT change when a reviewer would expect it to. State a tradeoff in one line only where more than one approach is plausible.
2. **Test plan** — required. Derive it from the `PRODUCT.md` flows:
   - Live browser verification for any frontend change: the exact flow to drive in the `8099` dev server — the doc/workspace state to open, the actions to perform, and the visible result to confirm. Name screens and controls, not "manually test the UI". Build the dev output first (`npm run build:web:dev`), serve the working tree (`node dist/cli.js serve <root> --port 8099 --static-dir web/dist-dev`); if the change touches `src/`, also `npm run build` and restart. For file-mutating features, use a disposable workspace and tear it down.
   - Unit/integration tests (vitest) worth writing, named by module.
   - Sign-off before commit: `npm run typecheck:web`, `npm run typecheck`, `npm test`, `npm run knip`.

Optional, only when they earn their lines:

- **Risks** — real regressions or data-loss hazards, one bullet each with the mitigation.
- **Diagram** — Mermaid only when it explains data flow faster than prose.
- **Follow-ups** — deferred slices.

Do not include boilerplate sections: no affected-file inventories, module-architecture essays, step-by-step build ordering, or parallelization plans. If a module matters, it shows up naturally in the Approach bullets' file paths.

## Writing Guidance

- Ground every bullet in code you read: name files, functions, and existing patterns. Prefer local paths with line numbers; use commit-pinned GitHub links only when the spec will be read outside a checkout.
- Use project vocabulary from `CONTEXT.md`.
- Reuse existing design-system primitives and nearby patterns before proposing new ones.
- Target 30-80 lines total. If a bullet doesn't change what the implementer types or what the reviewer checks, cut it.

## Keep Current

Update `TECH.md` in the same PR when the approach, risks, or test plan changes. The checked-in spec should describe what ships.

## Related Skills

- `write-product-spec`
- `to-tickets`
- `grill-with-docs`
