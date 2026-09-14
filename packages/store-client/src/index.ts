/**
 * Typed client for the public surfaces of an AgentPOS store.
 *
 * The bridge never talks to a store's database or admin: only to what any agent on the
 * internet can already reach. Discovery starts at `/.well-known/ucp`, which every AgentPOS
 * store serves, and falls back to `/openapi.json`.
 */

export interface StoreClientError {
  code: "STORE_UNREACHABLE" | "STORE_PROFILE_INVALID" | "STORE_NOT_AGENTPOS";
  message: string;
  hint: string;
}

export class StoreDiscoveryError extends Error {
  readonly code: StoreClientError["code"];
  readonly hint: string;
  constructor(err: StoreClientError) {
    super(err.message);
    this.name = "StoreDiscoveryError";
    this.code = err.code;
    this.hint = err.hint;
  }
  toJSON(): StoreClientError {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

/** What the bridge needs to know about a store before serving it to Alexa+. */
export interface StoreEndpoints {
  origin: string;
  /** UCP release the store publishes against (YYYY-MM-DD). */
  ucpVersion: string;
  /** REST base of the AgentPOS service, e.g. `https://shop.example/agentpos`. */
  restBase: string;
  /** Per-store MCP endpoint (Streamable HTTP). */
  mcpEndpoint: string;
  /** Payment handler ids declared by the store, e.g. `x402-stellar`. */
  paymentHandlers: string[];
}

interface UcpServiceEntry {
  version?: unknown;
  transport?: unknown;
  endpoint?: unknown;
}

interface UcpProfileShape {
  ucp?: {
    version?: unknown;
    services?: Record<string, unknown>;
    payment_handlers?: Record<string, unknown>;
  };
}

const AGENTPOS_SERVICE = "com.novacorplabs.agentpos";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads a store's UCP business profile and extracts the endpoints the bridge needs.
 * Pure over the fetched JSON, so it is unit-tested without a network.
 */
export function parseStoreProfile(origin: string, profile: unknown): StoreEndpoints {
  const p = profile as UcpProfileShape;
  const ucp = p?.ucp;
  if (!isRecord(ucp) || typeof ucp.version !== "string") {
    throw new StoreDiscoveryError({
      code: "STORE_PROFILE_INVALID",
      message: `The document at ${origin}/.well-known/ucp is not a UCP business profile`,
      hint: "Expected an object with `ucp.version` (YYYY-MM-DD) and `ucp.services`.",
    });
  }
  const services = isRecord(ucp.services) ? ucp.services : {};
  const entries = services[AGENTPOS_SERVICE];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new StoreDiscoveryError({
      code: "STORE_NOT_AGENTPOS",
      message: `${origin} publishes a UCP profile but no ${AGENTPOS_SERVICE} service`,
      hint: "The bridge serves AgentPOS stores. Install AgentPOS on the store first.",
    });
  }
  let restBase: string | undefined;
  let mcpEndpoint: string | undefined;
  for (const raw of entries as UcpServiceEntry[]) {
    if (!isRecord(raw) || typeof raw.endpoint !== "string") continue;
    if (raw.transport === "rest") restBase = raw.endpoint;
    if (raw.transport === "mcp") mcpEndpoint = raw.endpoint;
  }
  if (!restBase || !mcpEndpoint) {
    throw new StoreDiscoveryError({
      code: "STORE_PROFILE_INVALID",
      message: `${origin} declares ${AGENTPOS_SERVICE} without both rest and mcp transports`,
      hint: "Upgrade the store's AgentPOS version; both transports are published by default.",
    });
  }
  const handlers = isRecord(ucp.payment_handlers) ? ucp.payment_handlers : {};
  const paymentHandlers: string[] = [];
  for (const list of Object.values(handlers)) {
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      if (isRecord(h) && typeof h.id === "string") paymentHandlers.push(h.id);
    }
  }
  return { origin, ucpVersion: ucp.version, restBase, mcpEndpoint, paymentHandlers };
}

/** Fetches and parses a store's UCP profile. */
export async function discoverStore(
  storeUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoreEndpoints> {
  const origin = new URL(storeUrl).origin;
  let res: Response;
  try {
    res = await fetchImpl(`${origin}/.well-known/ucp`, {
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new StoreDiscoveryError({
      code: "STORE_UNREACHABLE",
      message: `Could not reach ${origin}: ${String(cause)}`,
      hint: "Check the URL and that the store is online.",
    });
  }
  if (!res.ok) {
    throw new StoreDiscoveryError({
      code: "STORE_NOT_AGENTPOS",
      message: `${origin}/.well-known/ucp responded ${res.status}`,
      hint: "An AgentPOS store always serves its UCP profile at that path.",
    });
  }
  const json: unknown = await res.json();
  return parseStoreProfile(origin, json);
}
