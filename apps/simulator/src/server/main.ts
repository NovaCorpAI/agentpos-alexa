/**
 * Boot: connect to the Bridge, pick the brain, serve the web build and the API. One command.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { dataDir as workspaceDataDir, loadDotenv, openStorage } from "@agentpos-alexa/bridge";
import { AgentBrain, ScriptedRouterBrain, type Brain } from "./agent/brain.js";
import { createSimulatorApp, SIMULATOR_VERSION } from "./app.js";
import { BridgeCheckoutClient, BridgeClient, BridgeOnboardingClient } from "./bridge-client.js";
import { CheckoutFlow } from "./checkout.js";
import { InspectionLog } from "./inspection.js";
import { SqliteHouseholdMemory } from "./memory.js";
import { PollySpeech } from "./speech.js";

// Values from .env fill in what the environment does not set; nothing is ever printed.
loadDotenv();

const port = Number(process.env.SIMULATOR_PORT ?? 8788);
const bridgeUrl = (process.env.BRIDGE_URL ?? process.env.BRIDGE_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const bearerToken = process.env.BRIDGE_BEARER_TOKEN;
if (!bearerToken || bearerToken === "change-me") {
  process.stderr.write("BRIDGE_BEARER_TOKEN is required: copy the token the Bridge printed at boot, or set the same value in both .env files.\n");
  process.exit(1);
}

const dataDir = process.env.SIMULATOR_DATA_DIR ?? workspaceDataDir();
const webDir = resolve(import.meta.dirname, "../../dist/web");
const bridge = new BridgeClient({ url: bridgeUrl, bearerToken });
const inspection = new InspectionLog(resolve(dataDir, "inspection-summary.json"), SIMULATOR_VERSION);
const checkout = new CheckoutFlow(new BridgeCheckoutClient({ url: bridgeUrl, bearerToken }));
const merchant = new BridgeOnboardingClient({ url: bridgeUrl, bearerToken });
const memory = new SqliteHouseholdMemory(resolve(dataDir, "household-memory.sqlite"));
/** The Simulator's own usage_events (same schema as the Bridge's), for the agent's model calls. */
const usage = openStorage({ path: resolve(dataDir, "simulator.sqlite") });

const modelId = process.env.BEDROCK_MODEL_FAST ?? "amazon.nova-2-lite-v1:0";
const region = process.env.AWS_REGION ?? "us-east-1";
const wanted = process.env.SIMULATOR_BRAIN ?? "auto";

async function pickBrain(): Promise<{ brain: Brain; reason: string }> {
  if (wanted === "router") return { brain: new ScriptedRouterBrain(bridge), reason: "SIMULATOR_BRAIN=router" };
  const agent = new AgentBrain({ bridge, modelId, region, record: (e) => usage.usageEvents.record(e) });
  if (wanted === "agent") return { brain: agent, reason: "SIMULATOR_BRAIN=agent" };
  try {
    await fromNodeProviderChain()();
    return { brain: agent, reason: `AWS credentials found; Household agent on ${modelId} in ${region}` };
  } catch {
    return { brain: new ScriptedRouterBrain(bridge), reason: "no AWS credentials in the default provider chain; scripted router, no model" };
  }
}

const { brain, reason } = await pickBrain();
// Polly is tried lazily per phrase; without credentials or permission the browser speaks.
const speech = brain.kind === "agent" || process.env.SIMULATOR_SPEECH === "polly" ? new PollySpeech(region, resolve(dataDir, "polly-cache")) : undefined;
const app = createSimulatorApp({ bridge, brain, checkout, inspection, memory, brainInfo: { modelId, region }, webDir, merchant, ...(speech ? { speech } : {}) });

if (existsSync(webDir)) {
  app.use("/*", serveStatic({ root: relativeToCwd(webDir) }));
  app.get("*", serveStatic({ root: relativeToCwd(webDir), path: "index.html" }));
} else {
  process.stderr.write(`Web build not found at ${webDir}; run pnpm --filter @agentpos-alexa/simulator build:web\n`);
}

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(JSON.stringify({ service: "simulator", msg: "listening", port: info.port, bridgeUrl, brain: brain.kind, brainReason: reason, url: `http://127.0.0.1:${info.port}/` }) + "\n");
});

function relativeToCwd(abs: string): string {
  const rel = abs.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
  return rel ? `./${rel}` : "./";
}
