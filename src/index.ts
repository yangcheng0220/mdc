// Public API of the mdc core. Modules land here as they are built:
// sidecar (storage + thread derivation), identity, anchor (resolution), handoff.

// Replaced at build time with the package.json version (see tsup.config.ts).
// The fallback covers running unbuilt source (e.g. tests), where the token
// isn't substituted.
declare const __MDC_VERSION__: string | undefined;
export const VERSION =
  typeof __MDC_VERSION__ === "string" ? __MDC_VERSION__ : "0.0.0-dev";

export * from "./sidecar.js";
export * from "./identity.js";
export * from "./anchor.js";
export * as handoff from "./handoff.js";
export * as serverClient from "./server-client.js";
