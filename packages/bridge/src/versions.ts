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
  /** Order of presentation: the merchant chooses the rail (docs/STRATEGY.md). */
  paymentHandlers: {
    /**
     * The merchant's own PSP through the UCP-sanctioned processor tokenizer handler, with Stripe
     * (test mode) as the processor for the demo. The client tokenizes the card with the
     * processor; the store executes the charge behind its PaymentRail; the bridge never holds a
     * key. Spec: https://ucp.dev/specification/examples/processor-tokenizer-payment-handler/
     */
    merchantPsp: "dev.ucp.processor_tokenizer",
    /** Contract-complete, exercised against a simulated PSP while the Alexa+ program is in preview. */
    amazonNetworkToken: "com.amazon.payments.network_token",
    amazonStoredPaymentMethod: "com.amazon.payments.stored_payment_method",
    /** Real: settles USDC on Stellar through the store's x402 checkout, when the agent brings a wallet. */
    x402Stellar: "org.x402.stellar",
  },
} as const;
