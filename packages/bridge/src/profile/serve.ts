/**
 * UCP profile adapter: the document the Bridge serves at /stores/{slug}/.well-known/ucp.
 *
 * It is the Bridge's own business profile for that Store, in the shape Alexa+ documents:
 * the checkout capability, the dev.ucp.shopping REST service rooted at /stores/{slug}, and
 * the payment handlers the Bridge's rails provide. The Store's own services and handlers
 * are kept, so any other agent still finds the Store's native surfaces.
 */
import type { RailRegistry } from "../rails/rail.js";
import type { RegisteredStore } from "../storage/store-registry.js";
import { BRIDGE_VERSION, PROTOCOL_VERSIONS } from "../versions.js";

export const BRIDGE_VENDOR_KEY = "com.novacorplabs.agentpos_alexa";
const UCP = PROTOCOL_VERSIONS.ucpCheckout.version;

export interface ProfileDeps {
  bridgeBaseUrl: string;
  rails: RailRegistry;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildServedProfile(store: RegisteredStore, deps: ProfileDeps): Record<string, unknown> {
  const raw = isRecord(store.profile) ? store.profile : {};
  const storeUcp = isRecord(raw.ucp) ? raw.ucp : {};
  const storeServices = isRecord(storeUcp.services) ? storeUcp.services : {};
  const storeCapabilities = isRecord(storeUcp.capabilities) ? storeUcp.capabilities : {};
  const storeHandlers = isRecord(storeUcp.payment_handlers) ? storeUcp.payment_handlers : {};
  const base = `${deps.bridgeBaseUrl}/stores/${store.slug}`;
  const { ucp: _omit, ...storeVendorBlocks } = raw;
  void _omit;
  return {
    ucp: {
      version: UCP,
      capabilities: {
        ...storeCapabilities,
        "dev.ucp.shopping.checkout": [
          { version: UCP, spec: `https://ucp.dev/${UCP}/specification/checkout/`, schema: `https://ucp.dev/${UCP}/schemas/shopping/checkout.json` },
        ],
      },
      services: {
        ...storeServices,
        "dev.ucp.shopping": [{ version: UCP, transport: "rest", endpoint: base, spec: `https://ucp.dev/${UCP}/services/shopping/rest.openapi.json` }],
      },
      payment_handlers: { ...storeHandlers, ...deps.rails.declarations(store) },
    },
    ...storeVendorBlocks,
    [BRIDGE_VENDOR_KEY]: {
      bridgeVersion: BRIDGE_VERSION,
      slug: store.slug,
      storeOrigin: store.origin,
      storeUcpVersion: store.ucpVersion,
      mcp: { endpoint: `${base}/mcp`, spec: PROTOCOL_VERSIONS.mcp.spec },
      oauth: { tokenEndpoint: `${deps.bridgeBaseUrl}/oauth/token`, grantTypes: ["client_credentials"] },
    },
  };
}
