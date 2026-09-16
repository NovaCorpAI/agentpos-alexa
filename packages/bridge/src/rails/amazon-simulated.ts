/**
 * SIMULATED Amazon payment handlers (hard rule 9).
 *
 * The Alexa+ program is in preview and publishes no sandbox for its handlers (FL-003), so
 * these two rails implement the published contract, com.amazon.payments.network_token and
 * com.amazon.payments.stored_payment_method, against a simulated PSP that lives in this
 * file. They validate the credential shapes Alexa+ documents, "authorize" deterministically,
 * and hand the Store a settlement reference prefixed `simulated:amazon:`. No money moves.
 * The word SIMULATED appears in the handler declaration, in every session response that
 * completes through them, in logs and in usage_events. There is no configuration that turns
 * them into a real PSP: a real Amazon handler is a different module with a different name.
 */
import type { PaymentInstrument } from "../checkout/types.js";
import type { PaymentRail, RailContext, RailOutcome } from "./rail.js";

export const SIMULATED_LABEL = "SIMULATED";
const VERSION = "2026-04-08";

/** Saved cards the simulated wallet returns for the linked user. Clearly fake. */
export const SIMULATED_SAVED_CARDS: PaymentInstrument[] = [
  { id: "pm_sim_visa_4242", handler_id: "partner_card_on_file", type: "card", display: { brand: "visa", last_digits: "4242", expiry_month: "09", expiry_year: "2028", simulated: true } },
  { id: "pm_sim_mc_1234", handler_id: "partner_card_on_file", type: "card", display: { brand: "mastercard", last_digits: "1234", expiry_month: "12", expiry_year: "2027", simulated: true } },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The simulated PSP: declines when the display says last digits 0002 (the classic test
 * decline) or when the credential carries `simulate: "decline"`. Everything else authorizes.
 */
function simulatedPsp(instrument: PaymentInstrument, amountMinor: string): { authorized: true; chargeId: string } | { authorized: false; code: string; content: string } {
  const last = String(instrument.display?.last_digits ?? "");
  const cred: Record<string, unknown> = instrument.credential ?? {};
  if (last === "0002" || cred.simulate === "decline") {
    return { authorized: false, code: "payment_failed", content: `${SIMULATED_LABEL}: the card was declined. Please try a different payment method.` };
  }
  const seed = `${instrument.handler_id}:${instrument.id}:${amountMinor}:${Date.now()}`;
  let h = 0;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return { authorized: true, chargeId: `sim_ch_${h.toString(16).padStart(8, "0")}` };
}

async function settleThroughStore(ctx: RailContext, chargeId: string): Promise<RailOutcome> {
  if (!ctx.internal.cartId) {
    return { kind: "declined", code: "not_ready", content: "The store has not quoted this order yet.", simulated: true };
  }
  const reference = `simulated:amazon:${chargeId}`;
  const outcome = await ctx.storeClient.checkout(ctx.internal.cartId, reference);
  if (outcome.kind === "parked") {
    return { kind: "parked", approvalId: outcome.result.approvalId, poll: outcome.result.poll, expiresAt: outcome.result.expiresAt };
  }
  if (outcome.kind !== "paid") {
    return { kind: "declined", code: "payment_failed", content: `${SIMULATED_LABEL}: the store did not accept the settlement.`, simulated: true };
  }
  ctx.log.log("info", "simulated amazon settlement", { simulated: true, handler: ctx.instrument.handler_id, chargeId, storeOrderId: outcome.result.orderId });
  return {
    kind: "settled",
    settlementReference: reference,
    storeOrderId: outcome.result.orderId,
    permalinkUrl: outcome.result.order ?? `${ctx.store.origin}/orders/${outcome.result.orderId}`,
    simulated: true,
  };
}

export const amazonNetworkTokenSimulated: PaymentRail = {
  namespace: "com.amazon.payments.network_token",
  id: "amazon_pay_network_token",
  version: VERSION,
  availableInstruments: [{ type: "card", constraints: { brands: ["visa", "mastercard"] } }],
  pspMode: "simulated",
  declarationExtras: { note: `${SIMULATED_LABEL}: contract-complete, exercised against a simulated PSP while the Alexa+ program is in preview.` },
  supports: () => true,
  async settle(ctx): Promise<RailOutcome> {
    const cred = ctx.instrument.credential;
    const ok =
      isRecord(cred) &&
      cred.type === "encrypted_network_token" &&
      typeof cred.encrypted_token === "string" &&
      typeof cred.encrypted_cryptogram === "string" &&
      typeof cred.eci === "string" &&
      typeof cred.expiry_month === "string" &&
      typeof cred.expiry_year === "string";
    if (!ok) {
      return { kind: "declined", code: "invalid_credential", content: "Expected an encrypted_network_token credential with encrypted_token, encrypted_cryptogram, eci, expiry_month and expiry_year.", simulated: true };
    }
    const psp = simulatedPsp(ctx.instrument, ctx.internal.quoteTotalMinor ?? "0");
    if (!psp.authorized) return { kind: "declined", code: psp.code, content: psp.content, simulated: true };
    return settleThroughStore(ctx, psp.chargeId);
  },
};

export const amazonStoredPaymentMethodSimulated: PaymentRail = {
  namespace: "com.amazon.payments.stored_payment_method",
  id: "partner_card_on_file",
  version: VERSION,
  availableInstruments: [{ type: "card" }],
  pspMode: "simulated",
  declarationExtras: { note: `${SIMULATED_LABEL}: saved cards are fake and belong to the demo household.` },
  supports: () => true,
  offeredInstruments: () => SIMULATED_SAVED_CARDS,
  async settle(ctx): Promise<RailOutcome> {
    const cred = ctx.instrument.credential;
    const ref = isRecord(cred) && cred.type === "payment_method_reference" ? cred.payment_method_id : undefined;
    if (typeof ref !== "string") {
      return { kind: "declined", code: "invalid_credential", content: "Expected a payment_method_reference credential with payment_method_id.", simulated: true };
    }
    // Alexa+: the id must belong to the linked user and have been offered in this session.
    const offered = ctx.session.payment?.instruments ?? [];
    const saved = SIMULATED_SAVED_CARDS.find((c) => c.id === ref);
    if (!saved || !offered.some((i) => i.id === ref)) {
      return { kind: "declined", code: "payment_failed", content: "That saved card is not available for this account.", simulated: true };
    }
    const psp = simulatedPsp(saved, ctx.internal.quoteTotalMinor ?? "0");
    if (!psp.authorized) return { kind: "declined", code: psp.code, content: psp.content, simulated: true };
    return settleThroughStore(ctx, psp.chargeId);
  },
};

/** Registers both simulated handlers. Refuses any mode other than "simulated" by construction. */
export function amazonRailsFromMode(mode: string | undefined): PaymentRail[] {
  if (mode === undefined || mode === "off") return [];
  if (mode !== "simulated") {
    throw new Error(`AMAZON_PSP_MODE=${mode} is not allowed: the Amazon handlers in this bridge are simulated only (hard rule 9).`);
  }
  return [amazonNetworkTokenSimulated, amazonStoredPaymentMethodSimulated];
}
