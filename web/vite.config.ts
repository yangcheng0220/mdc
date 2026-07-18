import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const excalidrawFonts = resolve(
  here,
  "../node_modules/@excalidraw/excalidraw/dist/prod/fonts",
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-excalidraw-fonts",
      writeBundle(options) {
        if (!options.dir) return;
        cpSync(excalidrawFonts, resolve(options.dir, "assets/excalidraw/fonts"), {
          recursive: true,
        });
      },
    },
  ],
  define: {
    "process.env.IS_PREACT": "false",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
