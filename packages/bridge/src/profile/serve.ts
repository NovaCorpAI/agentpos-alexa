/**
 * UCP profile adapter: the document the Bridge serves at /stores/{slug}/.well-known/ucp.
 *
 * Today it re-publishes the Store's own UCP business profile unchanged, so that whatever the
 * Store declares (services, capabilities, payment handlers) is what Alexa+ sees, and adds the
 * Bridge's version under a vendor key. The Alexa+ checkout service and the Bridge's own
 * payment handler list land here with the checkout module (ticket #7).
 */
import type { RegisteredStore } from "../storage/store-registry.js";
import { BRIDGE_VERSION, PROTOCOL_VERSIONS } from "../versions.js";

export const BRIDGE_VENDOR_KEY = "com.novacorplabs.agentpos_alexa";

export function buildServedProfile(store: RegisteredStore): Record<string, unknown> {
  const profile = (store.profile ?? {}) as Record<string, unknown>;
  return {
    ...profile,
    [BRIDGE_VENDOR_KEY]: {
      bridgeVersion: BRIDGE_VERSION,
      slug: store.slug,
      storeOrigin: store.origin,
      mcp: PROTOCOL_VERSIONS.mcp.spec,
      ucpCheckout: PROTOCOL_VERSIONS.ucpCheckout.version,
    },
  };
}
