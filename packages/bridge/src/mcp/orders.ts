/**
 * get_order and get_receipt: what happened after checkout, in the Store's own words.
 * The Bridge adds only what it knows first hand: which handler paid and whether it was
 * simulated, from its own checkout sessions. Nothing here invents status or amounts.
 */
import type { AgentPosStoreClient } from "@agentpos-alexa/store-client";
import type { CheckoutRepo } from "../storage/checkout-store.js";
import type { RegisteredStore } from "../storage/store-registry.js";

export interface OrderView {
  orderId: string;
  externalOrderId: string | null;
  status: string;
  lines: Array<{ itemId: string; title: string; quantity: number; lineTotalMinor: string }>;
  totalMinor: string | null;
  asset: string;
  payment: {
    handler: string | null;
    pspMode: "live" | "test_mode" | "simulated" | null;
    simulated: boolean;
    settlementReference: string | null;
    network: string | null;
  };
  checkoutSessionId: string | null;
  permalinkUrl: string | null;
  store: { name: string; origin: string };
}

export interface ReceiptView {
  orderId: string;
  receipts: Array<{ type: string; issuedAt: string | null; totalMinor: string | null; txHash: string | null; signer: string | null; signed: boolean }>;
  verification: { valid: boolean; mode: string | null; note: string | null };
  payment: OrderView["payment"];
  store: { name: string; origin: string };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export async function loadOrderView(store: RegisteredStore, client: AgentPosStoreClient, checkout: CheckoutRepo, orderId: string): Promise<OrderView> {
  const [order, receipt] = await Promise.all([client.order(orderId), client.receipt(orderId).catch(() => null)]);
  const stored = checkout.findByStoreOrderId(store.slug, orderId);
  const payment = order.payment ?? {};
  const handlerFromSession = stored?.session.payment?.instruments[0]?.handler_id ?? null;
  const first = receipt?.receipts[0] ?? {};
  const lines = Array.isArray(first.lines)
    ? (first.lines as Array<Record<string, unknown>>).map((l) => ({ itemId: String(l.itemId ?? ""), title: String(l.title ?? ""), quantity: Number(l.quantity ?? 0), lineTotalMinor: String(l.lineTotalMinor ?? "0") }))
    : stored
      ? stored.session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity, lineTotalMinor: "" }))
      : [];
  // The Bridge's own settlement reference is the source of truth for how it paid; the Store's
  // payment block describes the Store's rail (x402 on the fixture) and says nothing about ours.
  const reference = stored?.internal.settlementReference ?? str(payment.txHash) ?? null;
  const simulated = reference?.startsWith("simulated:") === true;
  const handlerEvent = stored ? handlerFromSession : null;
  return {
    orderId: order.orderId,
    externalOrderId: str(order.externalOrderId),
    status: order.status,
    lines,
    totalMinor: str(first.totalMinor) ?? str(payment.amountMinor) ?? stored?.internal.quoteTotalMinor ?? null,
    asset: str(payment.asset) ?? "USDC",
    payment: {
      handler: handlerEvent,
      pspMode: simulated ? "simulated" : handlerEvent ? "test_mode" : null,
      simulated,
      settlementReference: reference,
      network: simulated ? null : str(payment.network),
    },
    checkoutSessionId: stored?.session.id ?? null,
    permalinkUrl: stored?.session.order?.permalink_url ?? null,
    store: { name: new URL(store.origin).hostname, origin: store.origin },
  };
}

export async function loadReceiptView(store: RegisteredStore, client: AgentPosStoreClient, checkout: CheckoutRepo, orderId: string): Promise<ReceiptView> {
  const [chain, order] = await Promise.all([client.receipt(orderId), loadOrderView(store, client, checkout, orderId)]);
  const verification = chain.verification ?? {};
  return {
    orderId,
    receipts: chain.receipts.map((r) => ({
      type: str(r.type) ?? "receipt",
      issuedAt: str(r.issuedAt),
      totalMinor: str(r.totalMinor),
      txHash: str(r.txHash),
      signer: str(r.signer),
      signed: typeof r.signature === "string" && r.signature.length > 0,
    })),
    verification: { valid: verification.valid === true, mode: str(verification.mode), note: str(verification.note) },
    payment: order.payment,
    store: order.store,
  };
}
