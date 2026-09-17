/**
 * The merchant's own PSP through a processor tokenizer (#9, UCP processor tokenizer pattern).
 * The platform tokenizes the card with the processor named in the Store's profile; the Bridge
 * forwards the token to the Store's processor checkout; the Store runs the charge with its own
 * key and creates the order only when it succeeds. The Bridge never sees a processor secret.
 *
 * Test mode only for now: a Store whose handler says `environment: production` is not served,
 * because live card charges through this Bridge are out of scope until a real Store asks.
 */
import type { RegisteredStore } from "../storage/store-registry.js";
import type { PaymentRail, RailOutcome } from "./rail.js";

export const MERCHANT_PSP_NAMESPACE = "com.agentposhq.processor_tokenizer";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Store's own declaration of the handler, when it publishes one in test mode. */
export function storeProcessorDeclaration(store: RegisteredStore): Record<string, unknown> | undefined {
  const ucp = isRecord(store.profile) && isRecord(store.profile.ucp) ? store.profile.ucp : undefined;
  const handlers = ucp && isRecord(ucp.payment_handlers) ? ucp.payment_handlers : undefined;
  const list = handlers?.[MERCHANT_PSP_NAMESPACE];
  const first = Array.isArray(list) ? list.find(isRecord) : undefined;
  const config = first && isRecord(first.config) ? first.config : undefined;
  return config?.environment === "sandbox" ? first : undefined;
}

export const merchantPspRail: PaymentRail = {
  namespace: MERCHANT_PSP_NAMESPACE,
  id: "processor-tokenizer",
  version: "2026-04-08",
  availableInstruments: [{ type: "card", constraints: { brands: ["visa", "mastercard", "amex"] } }],
  pspMode: "test_mode",
  declarationFor(store) {
    const d = storeProcessorDeclaration(store);
    const config = d && isRecord(d.config) ? d.config : {};
    // Only what a platform needs to tokenize: the processor, its environment and the public key.
    return {
      spec: "https://ucp.dev/specification/examples/processor-tokenizer-payment-handler/",
      config: { environment: config.environment, psp: config.psp, publishable_key: config.publishable_key, currency: config.currency ?? "usd" },
      test_mode: true,
    };
  },
  supports: (store) => storeProcessorDeclaration(store) !== undefined,
  async settle(ctx): Promise<RailOutcome> {
    const cred = ctx.instrument.credential;
    const token = isRecord(cred) && cred.type === "token" && typeof cred.token === "string" && cred.token ? cred.token : undefined;
    if (!token) return { kind: "declined", code: "invalid_credential", content: "Expected a token credential from the processor's tokenizer.", simulated: false };
    const outcome = await ctx.storeClient.checkoutWithProcessorToken(ctx.internal.cartId!, token);
    if (outcome.kind === "declined") return { kind: "declined", code: "payment_failed", content: outcome.message, simulated: false };
    if (outcome.kind === "parked") return { kind: "parked", approvalId: outcome.result.approvalId, poll: outcome.result.poll, expiresAt: outcome.result.expiresAt };
    const order = await ctx.storeClient.order(outcome.result.orderId);
    const payment = isRecord(order.payment) ? order.payment : {};
    const reference = typeof payment.reference === "string" ? payment.reference : undefined;
    if (!reference) {
      // No order without a settlement reference (hard rule 3): a paid answer without one is a Store fault.
      return { kind: "declined", code: "payment_failed", content: "The store did not confirm the charge. Nothing was ordered.", simulated: false };
    }
    return { kind: "settled", settlementReference: reference, storeOrderId: order.orderId, permalinkUrl: outcome.result.order ?? `${ctx.store.origin}/orders/${order.orderId}`, simulated: false };
  },
};
