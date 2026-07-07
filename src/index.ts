// Public API of the mdc core. Modules land here as they are built:
// sidecar (storage + thread derivation), identity, anchor (resolution), handoff.

export const VERSION = "0.1.0";

export * from "./sidecar.js";
export * from "./identity.js";
export * from "./anchor.js";
export * as handoff from "./handoff.js";
export * as serverClient from "./server-client.js";
