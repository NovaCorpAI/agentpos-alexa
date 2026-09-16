/**
 * Boot: connect to the Bridge, serve the web build and the API. One command.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createSimulatorApp, SIMULATOR_VERSION } from "./app.js";
import { BridgeCheckoutClient, BridgeClient } from "./bridge-client.js";
import { CheckoutFlow } from "./checkout.js";
import { InspectionLog } from "./inspection.js";

const port = Number(process.env.SIMULATOR_PORT ?? 8788);
const bridgeUrl = (process.env.BRIDGE_URL ?? process.env.BRIDGE_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const bearerToken = process.env.BRIDGE_BEARER_TOKEN;
if (!bearerToken || bearerToken === "change-me") {
  process.stderr.write("BRIDGE_BEARER_TOKEN is required: copy the token the Bridge printed at boot, or set the same value in both .env files.\n");
  process.exit(1);
}

const webDir = resolve(import.meta.dirname, "../../dist/web");
const bridge = new BridgeClient({ url: bridgeUrl, bearerToken });
const inspection = new InspectionLog(resolve(process.env.SIMULATOR_DATA_DIR ?? "./.data", "inspection-summary.json"), SIMULATOR_VERSION);
const checkout = new CheckoutFlow(new BridgeCheckoutClient({ url: bridgeUrl, bearerToken }));
const app = createSimulatorApp({ bridge, checkout, inspection, webDir });

if (existsSync(webDir)) {
  app.use("/*", serveStatic({ root: relativeToCwd(webDir) }));
  app.get("*", serveStatic({ root: relativeToCwd(webDir), path: "index.html" }));
} else {
  process.stderr.write(`Web build not found at ${webDir}; run pnpm --filter @agentpos-alexa/simulator build:web\n`);
}

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(JSON.stringify({ service: "simulator", msg: "listening", port: info.port, bridgeUrl, webDir, url: `http://127.0.0.1:${info.port}/` }) + "\n");
});

function relativeToCwd(abs: string): string {
  const rel = abs.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
  return rel ? `./${rel}` : "./";
}
