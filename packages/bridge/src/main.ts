/**
 * Boot: open storage, register the first Store from AGENTPOS_STORE_URL, listen.
 * One command, no services to create.
 */
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

const app = createApp({ storage, logger });
serve({ fetch: app.fetch, port }, (info) => {
  logger.log("info", "listening", {
    port: info.port,
    stores: storage.stores.list().map((s) => s.slug),
    dbPath,
  });
});
