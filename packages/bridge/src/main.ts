/**
 * Boot: open storage, register the first Store from AGENTPOS_STORE_URL, listen.
 * One command, no services to create.
 */
import { randomBytes } from "node:crypto";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { serve } from "@hono/node-server";
import { Guardian } from "@agentpos-alexa/agents";
import { BedrockModel } from "@strands-agents/sdk";
import { discoverStore, StoreDiscoveryError } from "@agentpos-alexa/store-client";
import { createApp } from "./app.js";
import { amazonRailsFromMode } from "./rails/amazon-simulated.js";
import { RailRegistry } from "./rails/rail.js";
import { createLogger, stdoutSink } from "./logging.js";
import { openStorage } from "./storage/sqlite.js";
import { slugFromOrigin } from "./storage/store-registry.js";
import { BRIDGE_VERSION } from "./versions.js";
import { resolve } from "node:path";
import { dataDir, loadDotenv } from "./env.js";

// Values from .env fill in what the environment does not set; nothing is ever printed.
loadDotenv();

const logger = createLogger(stdoutSink, { service: "bridge", bridgeVersion: BRIDGE_VERSION });
const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.BRIDGE_DB_PATH ?? resolve(dataDir(), "bridge.sqlite");
const storeUrl = process.env.AGENTPOS_STORE_URL;
const bridgeBaseUrl = (process.env.BRIDGE_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
// A judge without a .env still gets a working, authenticated MCP endpoint: the token is printed once.
const generatedToken = !process.env.BRIDGE_BEARER_TOKEN || process.env.BRIDGE_BEARER_TOKEN === "change-me";
const bearerToken = generatedToken ? randomBytes(24).toString("base64url") : process.env.BRIDGE_BEARER_TOKEN!;

const storage = openStorage({ path: dbPath });

if (storeUrl) {
  try {
    const store = await discoverStore(storeUrl);
    const slug = slugFromOrigin(store.origin);
    storage.stores.register(slug, store);
    logger.log("info", "store registered", { slug, origin: store.origin, ucpVersion: store.ucpVersion });
  } catch (e) {
    if (e instanceof StoreDiscoveryError) {
      logger.log("error", "store discovery failed", { ...e.toJSON(), storeUrl });
    } else {
      throw e;
    }
  }
}

// OAuth client credentials for platforms (the Simulator, a judge's MCP client). Optional.
if (process.env.BRIDGE_OAUTH_CLIENT_ID && process.env.BRIDGE_OAUTH_CLIENT_SECRET) {
  storage.oauth.registerClient(process.env.BRIDGE_OAUTH_CLIENT_ID, process.env.BRIDGE_OAUTH_CLIENT_SECRET);
}

// Payment rails. Amazon handlers are simulated only (hard rule 9); AMAZON_PSP_MODE=off disables them.
const rails = new RailRegistry();
for (const rail of amazonRailsFromMode(process.env.AMAZON_PSP_MODE ?? "simulated")) rails.register(rail);

// Policy guardian: the strong model on Bedrock when credentials resolve, the rule alone otherwise.
// Two strong models: Claude Sonnet needs the Anthropic use case form on new accounts (FL-006),
// so Nova Pro stands in until it is accepted. Every call says which model spoke.
const strongModelId = process.env.BEDROCK_MODEL_STRONG ?? "us.anthropic.claude-sonnet-4-6";
const fallbackModelId = process.env.BEDROCK_MODEL_STRONG_FALLBACK ?? "us.amazon.nova-pro-v1:0";
const region = process.env.AWS_REGION ?? "us-east-1";
let guardian: Guardian;
try {
  await fromNodeProviderChain()();
  const bedrock = (modelId: string) => new BedrockModel({ region, modelId, maxTokens: 300, temperature: 0.1 });
  guardian = new Guardian({
    model: bedrock(strongModelId),
    modelId: strongModelId,
    ...(fallbackModelId && fallbackModelId !== "off" ? { fallbackModel: bedrock(fallbackModelId), fallbackModelId } : {}),
  });
  logger.log("info", "guardian", { mode: "model", modelId: strongModelId, fallbackModelId, region });
} catch {
  guardian = new Guardian();
  logger.log("info", "guardian", { mode: "rules-only", note: "no AWS credentials; the duplicate rule decides with a fixed sentence" });
}

const app = createApp({ storage, logger, bridgeBaseUrl, bearerToken, rails, guardian });
serve({ fetch: app.fetch, port }, (info) => {
  logger.log("info", "listening", {
    port: info.port,
    bridgeBaseUrl,
    stores: storage.stores.list().map((s) => ({ slug: s.slug, mcp: `${bridgeBaseUrl}/stores/${s.slug}/mcp` })),
    dbPath,
    ...(generatedToken ? { bearerToken, note: "BRIDGE_BEARER_TOKEN was not set; this token is valid for this run only" } : {}),
  });
});
