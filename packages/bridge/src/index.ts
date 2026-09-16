/**
 * @agentpos-alexa/bridge: the Alexa+ add-on for AgentPOS stores.
 *
 * Modules (see CLAUDE.md, "Build order"):
 *   app.ts     the Hono app, pure over its dependencies
 *   main.ts    boot: storage, first Store, listener
 *   mcp/       MCP server for Alexa+ (Streamable HTTP, MCP Apps)            [ticket #4]
 *   profile/   /.well-known/ucp served per Store
 *   checkout/  UCP checkout sessions translated to the store's cart, quote and payment [#7]
 *   rails/     payment handlers: merchant PSP, Amazon (simulated, labeled), x402 [#9, #10, #17]
 *   storage/   node:sqlite adapter: stores, sessions, idempotency keys, usage_events
 */
export { createApp, TRACE_HEADER } from "./app.js";
export type { AppDeps } from "./app.js";
export { BridgeError } from "./errors.js";
export type { BridgeErrorBody } from "./errors.js";
export { createLogger, memorySink, stdoutSink } from "./logging.js";
export type { Logger, LogRecord, LogSink } from "./logging.js";
export { buildServedProfile, BRIDGE_VENDOR_KEY } from "./profile/serve.js";
export { openStorage } from "./storage/sqlite.js";
export type { Storage } from "./storage/sqlite.js";
export { slugFromOrigin, SqliteStoreRegistry } from "./storage/store-registry.js";
export type { RegisteredStore, StoreRegistry } from "./storage/store-registry.js";
export { USAGE_EVENTS_CSV_COLUMNS, USAGE_EVENTS_DDL } from "./storage/usage-events.js";
export type { OnboardingStage, PurchaseOrigin, UsageEvent, UsageSource } from "./storage/usage-events.js";
export { BRIDGE_VERSION, PROTOCOL_VERSIONS } from "./versions.js";
export { discoverStore, parseStoreProfile, StoreDiscoveryError, storeOrigin } from "@agentpos-alexa/store-client";
export type { StoreEndpoints } from "@agentpos-alexa/store-client";
