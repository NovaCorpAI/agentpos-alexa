/**
 * x402 on Stellar (#17): the household's wallet pays the Store directly, and the Bridge only
 * carries the payload.
 *
 * The three roles stay where they belong. The customer's wallet lives in the host and signs;
 * the Store verifies and settles as its own facilitator, sponsoring the fee; the Bridge holds
 * no key, sees no secret, and takes no cut (hard rules 1 and 2). What comes back is the
 * transaction hash the network recorded, which is what the order is idempotent by (hard rule 3).
 *
 * Testnet while the Store says so: a Store whose profile does not say it settles is served as
 * a rail that cannot be chosen, rather than one that pretends.
 */
import type { RegisteredStore } from "../storage/store-registry.js";
import type { PaymentRail, RailOutcome } from "./rail.js";

export const X402_NAMESPACE = "org.x402.stellar";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Store's own x402 declaration, when it publishes one. */
export function storeX402Declaration(store: RegisteredStore): Record<string, unknown> | undefined {
  const ucp = isRecord(store.profile) && isRecord(store.profile.ucp) ? store.profile.ucp : undefined;
  const handlers = ucp && isRecord(ucp.payment_handlers) ? ucp.payment_handlers : undefined;
  const list = handlers?.[X402_NAMESPACE];
  const first = Array.isArray(list) ? list.find(isRecord) : undefined;
  return first;
}

/** Whether that declaration says the Store can actually settle, rather than pretend to. */
export function storeSettlesX402(store: RegisteredStore): boolean {
  const config = storeX402Declaration(store)?.config;
  return isRecord(config) && config.settles === true;
}

export const x402StellarRail: PaymentRail = {
  namespace: X402_NAMESPACE,
  id: "x402-stellar",
  version: "2026-04-08",
  availableInstruments: [{ type: "stellar_wallet" }],
  // Real money on a test network: not a simulation, not a live charge.
  pspMode: "test_mode",
  declarationFor(store) {
    const declaration = storeX402Declaration(store);
    const config = isRecord(declaration?.config) ? declaration.config : {};
    // What a wallet needs to pay, and nothing else: the network, the token, the account.
    return {
      spec: "https://github.com/x402-foundation/x402",
      config: {
        protocol: "x402",
        x402Version: config.x402Version ?? 2,
        scheme: config.scheme ?? "exact",
        network: config.network,
        asset: config.asset,
        assetAddress: config.assetAddress,
        payTo: config.payTo,
        settles: config.settles === true,
      },
      test_mode: String(config.network ?? "").includes("testnet"),
    };
  },
  supports: (store) => storeSettlesX402(store),
  async settle(ctx): Promise<RailOutcome> {
    const credential = ctx.instrument.credential;
    const payload = isRecord(credential) && credential.type === "x402_payload" ? credential.payload : undefined;
    if (!payload) {
      return { kind: "declined", code: "invalid_credential", content: "Expected the x402 payload the customer's wallet signed.", simulated: false };
    }
    const outcome = await ctx.storeClient.checkoutWithX402(ctx.internal.cartId!, payload);
    if (outcome.kind === "declined") return { kind: "declined", code: "payment_failed", content: outcome.message, simulated: false };
    if (outcome.kind === "parked") return { kind: "parked", approvalId: outcome.result.approvalId, poll: outcome.result.poll, expiresAt: outcome.result.expiresAt };
    const order = await ctx.storeClient.order(outcome.result.orderId);
    const payment = isRecord(order.payment) ? order.payment : {};
    const txHash = typeof payment.txHash === "string" ? payment.txHash : undefined;
    if (!txHash) {
      // No order without a settled payment and its reference (hard rule 3).
      return { kind: "declined", code: "payment_failed", content: "The store did not report a transaction. Nothing was ordered.", simulated: false };
    }
    return { kind: "settled", settlementReference: txHash, storeOrderId: order.orderId, permalinkUrl: outcome.result.order ?? `${ctx.store.origin}/orders/${order.orderId}`, simulated: false };
  },
};
