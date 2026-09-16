/**
 * Builds each MCP Apps view to one self-contained HTML file under src/mcp/apps/dist/.
 * The built files are committed so the Bridge runs with no build step; `pnpm --filter
 * @agentpos-alexa/bridge build:apps` regenerates them. One entry per view.
 */
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const view = process.env.APP_VIEW ?? "carousel";

export default defineConfig({
  root: resolve(import.meta.dirname, view),
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(import.meta.dirname, "../src/mcp/apps/dist", view),
    emptyOutDir: true,
    minify: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
