// Builds every MCP Apps view (apps/<view>/) to src/mcp/apps/dist/<view>/index.html.
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../apps");
const views = readdirSync(root).filter((n) => statSync(resolve(root, n)).isDirectory() && n !== "shared");
for (const view of views) {
  process.env.APP_VIEW = view;
  await build({ configFile: resolve(root, "vite.config.ts"), logLevel: "warn" });
  console.log(`built ${view}`);
}
