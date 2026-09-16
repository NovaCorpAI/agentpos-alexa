/**
 * Boot: open storage, register the first Store from AGENTPOS_STORE_URL, listen.
 * One command, no services to create.
 */
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { discoverStore, StoreDiscoveryError } from "@agentpos-alexa/store-client";
import { createApp } from "./app.js";
import { createLogger, stdoutSink } from "./logging.js";
import { openStorage } from "./storage/sqlite.js";
import { slugFromOrigin } from "./storage/store-registry.js";
import { BRIDGE_VERSION } from "./versions.js";

const logger = createLogger(stdoutSink, { service: "bridge", bridgeVersion: BRIDGE_VERSION });
const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.BRIDGE_DB_PATH ?? "./.data/bridge.sqlite";
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

const app = createApp({ storage, logger, bridgeBaseUrl, bearerToken });
serve({ fetch: app.fetch, port }, (info) => {
  logger.log("info", "listening", {
    port: info.port,
    bridgeBaseUrl,
    stores: storage.stores.list().map((s) => ({ slug: s.slug, mcp: `${bridgeBaseUrl}/stores/${s.slug}/mcp` })),
    dbPath,
    ...(generatedToken ? { bearerToken, note: "BRIDGE_BEARER_TOKEN was not set; this token is valid for this run only" } : {}),
  });
});
