import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Single source of truth for the version: package.json, injected at build time.
// Avoids a hand-maintained constant drifting from the published version.
const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: { entry: "src/index.ts" },
  define: {
    __MDC_VERSION__: JSON.stringify(version),
  },
});
