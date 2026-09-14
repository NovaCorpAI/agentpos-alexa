/**
 * @agentpos-alexa/bridge: the Alexa+ add-on for AgentPOS stores.
 *
 * Planned modules (see CLAUDE.md, "Build order"):
 *   mcp/       MCP server for Alexa+ (Streamable HTTP, MCP Apps)
 *   profile/   /.well-known/ucp with dev.ucp.shopping and payment handlers
 *   checkout/  UCP checkout sessions translated to the store's cart, quote and payment
 *   rails/     payment handlers: x402 (real), Amazon (simulated, labeled)
 *   storage/   node:sqlite adapter: sessions, idempotency keys, usage_events
 */
export { BRIDGE_VERSION, PROTOCOL_VERSIONS } from "./versions.js";
export { discoverStore, parseStoreProfile, StoreDiscoveryError } from "@agentpos-alexa/store-client";
export type { StoreEndpoints } from "@agentpos-alexa/store-client";
