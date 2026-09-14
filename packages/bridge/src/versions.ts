/**
 * Pinned protocol versions. Update ONLY here and document the change in docs/ARCHITECTURE.md.
 * Everything the bridge emits carries `bridgeVersion`.
 */
export const BRIDGE_VERSION = "0.0.1";

export const PROTOCOL_VERSIONS = {
  mcp: {
    /** Alexa+ for Builders supports the 2025-11-25 version of the MCP specification. */
    spec: "2025-11-25",
    sdk: ">=1.30.0",
    transport: "streamable-http",
    checkedAt: "2026-09-14",
    source: "https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html",
  },
  ucpCheckout: {
    /** UCP release the Alexa+ checkout integration reference is grounded in. */
    version: "2026-04-08",
    endpoints: [
      "POST /checkout-sessions",
      "GET /checkout-sessions/{id}",
      "PUT /checkout-sessions/{id}",
      "POST /checkout-sessions/{id}/complete",
      "POST /checkout-sessions/{id}/cancel",
    ],
    idempotencyRetentionHours: 24,
    sessionTtlHours: 6,
    checkedAt: "2026-09-14",
    source: "https://developer.amazon.com/docs/alexaplus/add-ons/checkout-integration.html",
  },
  paymentHandlers: {
    /** Real: settles USDC on Stellar through the store's x402 checkout. */
    x402Stellar: "org.x402.stellar",
    /** Contract-complete, exercised against a simulated PSP while the Alexa+ program is in preview. */
    amazonNetworkToken: "com.amazon.payments.network_token",
    amazonStoredPaymentMethod: "com.amazon.payments.stored_payment_method",
  },
} as const;
