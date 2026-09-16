/**
 * UCP checkout sessions translated to the Store's cart, quote and payment.
 *
 * The session is the platform-facing state machine; the Store stays the source of truth
 * for prices and totals. A session is priced from the catalog on create, quoted by the Store
 * once a delivery destination exists (physical goods) and completed only after a rail
 * reports settlement with a reference (hard rule 3). Every response is the full object.
 */
import { createHash, randomUUID } from "node:crypto";
import { estimateCostUsdMicros, type Guardian } from "@agentpos-alexa/agents";
import { markFirstVoicePurchase } from "../onboarding/service.js";
import { AgentPosStoreClient, StoreRequestError, type CartQuote, type CatalogItem } from "@agentpos-alexa/store-client";
import { BridgeError } from "../errors.js";
import type { Logger } from "../logging.js";
import type { RailRegistry, SessionInternal } from "../rails/rail.js";
import type { Storage } from "../storage/sqlite.js";
import type { RegisteredStore } from "../storage/store-registry.js";
import { PROTOCOL_VERSIONS } from "../versions.js";
import { SESSION_CURRENCY, usdcMinorToCents } from "./money.js";
import type {
  CheckoutSession,
  CompleteRequest,
  FulfillmentMethod,
  LineItem,
  Link,
  Message,
  MessageError,
  SessionRequest,
  ShippingDestination,
  Total,
  UcpBlock,
} from "./types.js";

export interface CheckoutServiceDeps {
  storage: Storage;
  rails: RailRegistry;
  /** Policy guardian, consulted once per session at complete. Omitted: no guard. */
  guardian?: Guardian;
  bridgeBaseUrl: string;
  now?: () => Date;
  ttlHours?: number;
  storeFetch?: typeof fetch;
}

export interface CallContext {
  store: RegisteredStore;
  traceId: string;
  log: Logger;
}

const UCP_VERSION = PROTOCOL_VERSIONS.ucpCheckout.version;

export function sessionLinks(store: RegisteredStore): Link[] {
  // AgentPOS stores publish no policy URLs yet; the onboarding agent (#13) fills these in.
  return [{ type: "refund_policy", title: "Refund policy", url: `${store.origin}/` }];
}

function err(code: string, content: string, severity: MessageError["severity"], path?: string): MessageError {
  const m: MessageError = { type: "error", code, content, severity };
  if (path) m.path = path;
  return m;
}

export class CheckoutService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(private readonly deps: CheckoutServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.ttlMs = (deps.ttlHours ?? PROTOCOL_VERSIONS.ucpCheckout.sessionTtlHours) * 3_600_000;
  }

  private client(ctx: CallContext): AgentPosStoreClient {
    const opts = this.deps.storeFetch ? { fetchImpl: this.deps.storeFetch, traceId: ctx.traceId } : { traceId: ctx.traceId };
    return new AgentPosStoreClient(ctx.store, opts);
  }

  private ucpBlock(store: RegisteredStore): UcpBlock {
    return {
      version: UCP_VERSION,
      capabilities: { "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }] },
      payment_handlers: this.deps.rails.declarations(store),
    };
  }

  private load(ctx: CallContext, id: string): { session: CheckoutSession; internal: SessionInternal } {
    const stored = this.deps.storage.checkout.get(id);
    if (!stored || stored.internal.slug !== ctx.store.slug) {
      throw new BridgeError(404, { code: "SESSION_NOT_FOUND", message: `No checkout session ${id}`, hint: "Create one with POST /checkout-sessions." });
    }
    const { session, internal } = stored;
    if (session.status !== "completed" && session.status !== "canceled" && new Date(session.expires_at).getTime() <= this.now().getTime()) {
      session.status = "canceled";
      session.messages = [{ type: "info", code: "expired", content: "This checkout session expired." }];
      this.deps.storage.checkout.save(session, internal);
    }
    return { session, internal };
  }

  async create(ctx: CallContext, req: SessionRequest): Promise<CheckoutSession> {
    const id = `cs_${randomUUID()}`;
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    const internal: SessionInternal = { slug: ctx.store.slug, lineIndex: {} };
    const session: CheckoutSession = {
      ucp: this.ucpBlock(ctx.store),
      id,
      status: "incomplete",
      currency: SESSION_CURRENCY,
      line_items: [],
      totals: [],
      messages: [],
      links: sessionLinks(ctx.store),
      expires_at: expiresAt,
    };
    await this.price(ctx, session, internal, req);
    this.deps.storage.checkout.save(session, internal);
    return session;
  }

  get(ctx: CallContext, id: string): CheckoutSession {
    return this.load(ctx, id).session;
  }

  async update(ctx: CallContext, id: string, req: SessionRequest): Promise<CheckoutSession> {
    const { session, internal } = this.load(ctx, id);
    this.assertMutable(session);
    session.ucp = this.ucpBlock(ctx.store);
    session.status = "incomplete";
    session.messages = [];
    delete session.order;
    delete session.continue_url;
    delete internal.cartId;
    delete internal.cartExpiresAt;
    delete internal.checkoutUrl;
    delete internal.quoteTotalMinor;
    await this.price(ctx, session, internal, req);
    this.deps.storage.checkout.save(session, internal);
    return session;
  }

  cancel(ctx: CallContext, id: string): CheckoutSession {
    const { session, internal } = this.load(ctx, id);
    if (session.status === "completed") {
      throw new BridgeError(409, { code: "SESSION_IMMUTABLE", message: "Completed sessions cannot be canceled here", hint: "Cancel the order through the Store." });
    }
    session.status = "canceled";
    session.messages = [];
    this.deps.storage.checkout.save(session, internal);
    return session;
  }

  async complete(ctx: CallContext, id: string, req: CompleteRequest): Promise<CheckoutSession> {
    const { session, internal } = this.load(ctx, id);
    if (session.status === "completed" && internal.settlementReference) return session; // idempotent by settlement
    if (session.status === "canceled") {
      throw new BridgeError(409, { code: "SESSION_CANCELED", message: "This session is canceled or expired", hint: "Create a new session." });
    }
    const instruments = req.payment?.instruments ?? [];
    if (instruments.length !== 1) {
      throw new BridgeError(400, { code: "INSTRUMENT_REQUIRED", message: "complete needs exactly one payment instrument", hint: "Send payment.instruments with one entry." });
    }
    const instrument = instruments[0]!;
    const rail = this.deps.rails.find(ctx.store, instrument.handler_id);
    if (!rail) {
      session.status = "incomplete";
      session.messages = [err("payment_failed", `No payment handler ${instrument.handler_id} is available for this store.`, "recoverable", "$.payment.instruments[0].handler_id")];
      this.deps.storage.checkout.save(session, internal);
      return session;
    }
    // A decline leaves the session incomplete with only the payment message; the quote is
    // still good, so a retry with another instrument is allowed. Anything else must be
    // resolved through update first.
    const retryAfterDecline =
      session.status === "incomplete" && internal.cartId !== undefined && session.messages.every((m) => m.type === "error" && (m.code === "payment_failed" || m.severity === "requires_buyer_review"));
    if (session.status !== "ready_for_complete" && !retryAfterDecline) {
      session.messages = [...session.messages.filter((m) => m.type !== "error" || m.code !== "payment_failed"), err("not_ready", "The session is not ready to complete; resolve the messages first.", "recoverable")];
      this.deps.storage.checkout.save(session, internal);
      return session;
    }
    const storeClient = this.client(ctx);
    // The Store's quote is short-lived; re-quote silently before paying if it lapsed.
    if (internal.cartExpiresAt && new Date(internal.cartExpiresAt).getTime() <= this.now().getTime()) {
      const priced = await this.quote(ctx, session, internal, storeClient);
      if (!priced) {
        this.deps.storage.checkout.save(session, internal);
        return session;
      }
    }
    // The guardian runs once per session, before any money moves. Its review asks the buyer;
    // the next complete on the same session is the buyer's answer.
    if (this.deps.guardian && !internal.guardianAcknowledged) {
      const verdict = await this.guard(ctx, session, internal);
      if (verdict.decision !== "allow") {
        internal.guardianAcknowledged = verdict.decision === "review";
        session.status = "incomplete";
        session.messages = [err(verdict.code, verdict.reason, verdict.decision === "review" ? "requires_buyer_review" : "unrecoverable")];
        ctx.log.log(verdict.fallbackReason ? "warn" : "info", "guardian", { sessionId: session.id, decision: verdict.decision, code: verdict.code, findings: verdict.findings, modelUsed: verdict.modelUsed, ...(verdict.fallbackReason ? { fallbackReason: verdict.fallbackReason } : {}) });
        this.deps.storage.checkout.save(session, internal);
        return session;
      }
    }
    session.status = "complete_in_progress";
    this.deps.storage.checkout.save(session, internal);
    const started = performance.now();
    const outcome = await rail.settle({ store: ctx.store, storeClient, session, internal, instrument, traceId: ctx.traceId, log: ctx.log });
    const latencyMs = Math.round(performance.now() - started);
    this.deps.storage.usageEvents.record({
      traceId: ctx.traceId,
      source: "bridge.checkout",
      storeOrigin: ctx.store.origin,
      checkoutSessionId: session.id,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      estimatedCostUsdMicros: 0,
      paymentHandler: `${rail.namespace}/${rail.id}`,
      simulated: rail.pspMode === "simulated",
      purchaseOrigin: "own",
      pspMode: rail.pspMode,
    });
    if (outcome.kind === "settled") {
      internal.settlementReference = outcome.settlementReference;
      internal.storeOrderId = outcome.storeOrderId;
      session.status = "completed";
      session.order = { id: outcome.storeOrderId, permalink_url: outcome.permalinkUrl };
      session.messages = outcome.simulated
        ? [{ type: "info", code: "simulated_psp", content: "SIMULATED payment handler: no money moved. Labeled per the Alexa+ preview." }]
        : [];
      session.payment = { instruments: [redactInstrument(instrument)] };
      // The onboarding timer's last stage: the first settled order after publication.
      if (markFirstVoicePurchase(this.deps.storage, ctx.store.origin, ctx.traceId, this.now().toISOString())) {
        ctx.log.log("info", "onboarding first_voice_purchase", { sessionId: session.id });
      }
    } else if (outcome.kind === "parked") {
      internal.approvalId = outcome.approvalId;
      session.status = "incomplete";
      session.messages = [err("merchant_review", "The merchant is reviewing this order before it is confirmed. Nothing was charged.", "requires_buyer_review")];
    } else {
      session.status = "incomplete";
      session.messages = [err(outcome.code, outcome.content, "recoverable", "$.payment.instruments[0]")];
    }
    ctx.log.log("info", "checkout complete", { sessionId: session.id, outcome: outcome.kind, handler: rail.id, pspMode: rail.pspMode, latencyMs });
    this.deps.storage.checkout.save(session, internal);
    return session;
  }

  /** Asks the guardian with this buyer's recent orders at this Store; every model call is recorded. */
  private async guard(ctx: CallContext, session: CheckoutSession, internal: SessionInternal): Promise<Awaited<ReturnType<Guardian["review"]>>> {
    const guardian = this.deps.guardian!;
    const since = new Date(this.now().getTime() - 30 * 86_400_000).toISOString();
    const recent = internal.buyerKey ? this.deps.storage.checkout.listCompletedByBuyer(ctx.store.slug, internal.buyerKey, since) : [];
    const started = performance.now();
    const verdict = await guardian.review({
      storeName: new URL(ctx.store.origin).hostname,
      language: session.context?.language === "es-CL" ? "es-CL" : "en-US",
      lines: session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
      totalCents: session.totals.find((t) => t.type === "total")?.amount ?? 0,
      currency: session.currency,
      recentOrders: recent.map((r) => ({
        orderId: r.session.order?.id ?? r.session.id,
        at: r.updatedAt,
        lines: r.session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
        totalCents: r.session.totals.find((t) => t.type === "total")?.amount ?? 0,
      })),
      now: this.now(),
    });
    // Rows only when a rule fired: an allow costs nothing and calls no model.
    if (verdict.findings.length > 0) {
      const u = verdict.usage;
      this.deps.storage.usageEvents.record({
        traceId: ctx.traceId,
        source: "agent.guardian",
        storeOrigin: ctx.store.origin,
        checkoutSessionId: session.id,
        model: u?.modelId ?? null,
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - started),
        estimatedCostUsdMicros: u ? estimateCostUsdMicros(u.modelId, u.inputTokens, u.outputTokens).micros : 0,
        simulated: false,
      });
    }
    return verdict;
  }

  private assertMutable(session: CheckoutSession): void {
    if (session.status === "completed") {
      throw new BridgeError(409, { code: "SESSION_IMMUTABLE", message: "Completed sessions are immutable", hint: "Create a new session for a new purchase." });
    }
    if (session.status === "canceled") {
      throw new BridgeError(409, { code: "SESSION_CANCELED", message: "This session is canceled or expired", hint: "Create a new session." });
    }
  }

  /** Prices the request from the catalog, then asks the Store for a quote when it can. */
  private async price(ctx: CallContext, session: CheckoutSession, internal: SessionInternal, req: SessionRequest): Promise<void> {
    const lines = Array.isArray(req.line_items) ? req.line_items : [];
    if (lines.length === 0) {
      session.line_items = [];
      session.totals = [{ type: "subtotal", amount: 0 }, { type: "total", amount: 0 }];
      session.messages = [err("missing", "At least one line item is required", "recoverable", "$.line_items")];
      return;
    }
    if (req.buyer?.email) internal.buyerKey = createHash("sha256").update(req.buyer.email.trim().toLowerCase()).digest("hex");
    else delete internal.buyerKey;
    if (req.buyer) session.buyer = req.buyer;
    else delete session.buyer;
    if (req.context) session.context = req.context;
    else delete session.context;

    const storeClient = this.client(ctx);
    let catalog: Map<string, CatalogItem>;
    try {
      catalog = new Map((await storeClient.catalog()).items.map((it) => [it.id, it]));
    } catch (e) {
      session.messages = [err("store_unavailable", storeMessage(e), "unrecoverable")];
      return;
    }

    const messages: Message[] = [];
    const lineItems: LineItem[] = [];
    internal.lineIndex = {};
    let subtotal = 0;
    let physical = false;
    lines.forEach((l, i) => {
      const it = catalog.get(l.item?.id);
      const lineId = l.id && /^li_\d+$/.test(l.id) ? l.id : `li_${i + 1}`;
      if (!it) {
        messages.push(err("not_found", `Item ${l.item?.id ?? "?"} is not in the store's catalog`, "recoverable", `$.line_items[${i}].item.id`));
        return;
      }
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        messages.push(err("invalid_quantity", "Quantity must be a whole number of at least 1", "recoverable", `$.line_items[${i}].quantity`));
        return;
      }
      let price: number;
      try {
        price = usdcMinorToCents(it.price.minor);
      } catch {
        messages.push(err("item_unavailable", `${it.title} cannot be priced in ${SESSION_CURRENCY} cents`, "unrecoverable", `$.line_items[${i}]`));
        return;
      }
      const lineTotal = price * l.quantity;
      subtotal += lineTotal;
      physical = physical || it.physical;
      const item: LineItem["item"] = { id: it.id, title: it.title, price };
      if (it.imageUrl) item.image_url = it.imageUrl;
      lineItems.push({ id: lineId, item, quantity: l.quantity, totals: [{ type: "subtotal", amount: lineTotal }, { type: "total", amount: lineTotal }] });
      internal.lineIndex[lineId] = it.id;
    });
    session.line_items = lineItems;
    session.totals = [{ type: "subtotal", amount: subtotal }, { type: "total", amount: subtotal }];

    const destination = physical ? this.selectedDestination(req, lineItems) : undefined;
    if (physical) {
      const fm: FulfillmentMethod[] = req.fulfillment?.methods ?? [];
      session.fulfillment = { methods: fm };
      if (!destination) {
        messages.push(err("missing", "Delivery address is required", "recoverable", "$.fulfillment.methods[0].selected_destination_id"));
      }
      if (!req.buyer?.email) {
        messages.push(err("missing", "Buyer email is required for delivery", "recoverable", "$.buyer.email"));
      }
    } else {
      delete session.fulfillment;
    }
    session.messages = messages;
    if (messages.length > 0 || lineItems.length === 0) return;

    const priced = await this.quote(ctx, session, internal, storeClient, destination);
    if (priced) session.status = "ready_for_complete";
    // Stored payment methods the household may pick (Alexa+: returned on create and update).
    const offered = this.deps.rails.offeredInstruments(ctx.store);
    if (offered.length) session.payment = { instruments: offered };
    else delete session.payment;
  }

  private selectedDestination(req: SessionRequest, lines: LineItem[]): ShippingDestination | undefined {
    const method = req.fulfillment?.methods?.find((m) => m.type === "shipping" && m.selected_destination_id);
    if (!method) return undefined;
    const dest = method.destinations?.find((d) => d.id === method.selected_destination_id);
    if (!dest) return undefined;
    void lines;
    return dest;
  }

  /** Asks the Store for its quote; returns false (with messages set) when it cannot. */
  private async quote(ctx: CallContext, session: CheckoutSession, internal: SessionInternal, storeClient: AgentPosStoreClient, destination?: ShippingDestination): Promise<boolean> {
    const dest = destination ?? this.selectedDestination({ line_items: [], fulfillment: session.fulfillment ?? {} }, session.line_items);
    const cart: Parameters<AgentPosStoreClient["createCart"]>[0] = {
      items: session.line_items.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
    };
    if (session.buyer?.email) {
      cart.buyer = { email: session.buyer.email, name: [session.buyer.first_name, session.buyer.last_name].filter(Boolean).join(" ") || "Customer" };
    }
    if (dest) {
      cart.shipping = {
        name: [dest.first_name ?? session.buyer?.first_name, dest.last_name ?? session.buyer?.last_name].filter(Boolean).join(" ") || "Customer",
        line1: dest.street_address ?? "",
        city: dest.address_locality ?? "",
        postalCode: dest.postal_code ?? "",
        country: dest.address_country ?? "",
      };
      if (dest.extended_address) cart.shipping.line2 = dest.extended_address;
      if (dest.address_region) cart.shipping.region = dest.address_region;
      if (dest.phone_number ?? session.buyer?.phone_number) cart.shipping.phone = (dest.phone_number ?? session.buyer?.phone_number)!;
    }
    let q: CartQuote;
    try {
      q = await storeClient.createCart(cart);
    } catch (e) {
      if (e instanceof StoreRequestError && e.code === "STORE_REFUSED") {
        session.messages = [err("merchant_policy", storeMessage(e), "requires_buyer_review")];
      } else if (e instanceof StoreRequestError && e.code === "STORE_VALIDATION") {
        session.messages = [err("invalid", storeMessage(e), "recoverable")];
      } else {
        session.messages = [err("store_unavailable", storeMessage(e), "unrecoverable")];
      }
      session.status = "incomplete";
      return false;
    }
    internal.cartId = q.cartId;
    internal.cartExpiresAt = q.expiresAt;
    internal.checkoutUrl = q.checkout;
    internal.quoteTotalMinor = q.quote.totalMinor;
    const subtotal = session.totals.find((t) => t.type === "subtotal")?.amount ?? 0;
    let total: number;
    try {
      total = usdcMinorToCents(q.quote.totalMinor);
    } catch {
      session.messages = [err("item_unavailable", "The store's quote cannot be expressed in cents", "unrecoverable")];
      session.status = "incomplete";
      return false;
    }
    const totals: Total[] = [{ type: "subtotal", amount: subtotal }];
    if (total > subtotal) totals.push({ type: "fulfillment", amount: total - subtotal, display_text: "Delivery and fees" });
    totals.push({ type: "total", amount: total });
    session.totals = totals;
    if (q.policy?.decision === "review") {
      session.messages = [{ type: "info", code: "merchant_review", content: "The merchant may review this order before confirming it." }];
    }
    return true;
  }
}

function storeMessage(e: unknown): string {
  if (e instanceof StoreRequestError) {
    const se = e.storeError as { message?: unknown } | undefined;
    if (se && typeof se.message === "string") return se.message;
    return e.hint || e.message;
  }
  return "The store did not answer.";
}

/** What of the instrument survives in the session: never a credential. */
function redactInstrument(i: CheckoutSession["payment"] extends { instruments: Array<infer T> } | undefined ? T : never): CheckoutSession["payment"] extends { instruments: Array<infer T> } | undefined ? T : never {
  const out = { id: i.id, handler_id: i.handler_id, type: i.type } as typeof i;
  if (i.display) out.display = i.display;
  return out;
}
