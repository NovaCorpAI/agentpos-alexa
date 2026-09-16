/**
 * A test double of an AgentPOS Store. Same routes and shapes as the real adapter
 * (vendor/agentpos-openapi.json), physical goods, in-memory state. Clearly not a Store:
 * nothing settles, receipts are unsigned, and the x402 payload is never verified. Every
 * response that would be signed or settled in a real Store says `fixture: true`.
 */
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { CartQuote, CatalogItem, PaymentRequired, QuoteLine } from "@agentpos-alexa/store-client";
import {
  BAKERY_ASSET,
  BAKERY_ASSET_ADDRESS,
  BAKERY_ITEMS,
  BAKERY_NAME,
  BAKERY_NETWORK,
  BAKERY_PAY_TO,
} from "./bakery.js";

export const FIXTURE_ADAPTER_VERSION = "0.2.0";
export const UCP_VERSION = "2026-08-25";
/** Minutes a quoted cart stays valid, as on the demo store. */
export const CART_TTL_MINUTES = 15;
/** Header a real x402 client sends with the signed payment payload (x402 version 2). */
export const PAYMENT_SIGNATURE_HEADER = "Payment-Signature";
export const PAYMENT_REQUIRED_HEADER = "Payment-Required";

/** Merchant policy the fixture applies to every cart. Deterministic, like the real Store's. */
export interface FixturePolicy {
  /** Carts above this total (minor units) are parked for a human (202 at checkout). */
  reviewAboveMinor?: bigint;
  /** Carts above this total are refused outright (403 at cart). */
  refuseAboveMinor?: bigint;
  /** Item ids the merchant will not sell to agents. */
  refuseItemIds?: string[];
}

export interface FixtureStoreOptions {
  /** Public base URL of this fixture, e.g. http://127.0.0.1:8790. */
  baseUrl: string;
  items?: CatalogItem[];
  name?: string;
  policy?: FixturePolicy;
  now?: () => Date;
}

interface StoredCart {
  quote: CartQuote;
  request: { items: Array<{ itemId: string; quantity: number; note?: string }>; buyer?: unknown; shipping?: unknown };
  decision: "allowed" | "review";
}

interface StoredOrder {
  orderId: string;
  cartId: string;
  status: string;
  total: string;
  totalMinor: string;
  payment: Record<string, unknown>;
  externalOrderId: string;
  createdAt: string;
  lines: QuoteLine[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function humanAmount(minor: bigint): string {
  const s = minor.toString().padStart(8, "0");
  const whole = s.slice(0, -7);
  const frac = s.slice(-7).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** The fixture's own view of what it stores, exposed for assertions in tests. */
export interface FixtureState {
  carts: Map<string, StoredCart>;
  orders: Map<string, StoredOrder>;
  approvals: Map<string, { cartId: string; expiresAt: string }>;
}

export function createFixtureStore(opts: FixtureStoreOptions): { app: Hono; state: FixtureState } {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const rest = `${base}/agentpos`;
  const items = opts.items ?? BAKERY_ITEMS;
  const name = opts.name ?? BAKERY_NAME;
  const policy = opts.policy ?? {};
  const now = opts.now ?? (() => new Date());
  const byId = new Map(items.map((it) => [it.id, it]));
  const state: FixtureState = { carts: new Map(), orders: new Map(), approvals: new Map() };

  const app = new Hono();

  app.get("/.well-known/ucp", (c) =>
    c.json({
      ucp: {
        version: UCP_VERSION,
        services: {
          "com.novacorplabs.agentpos": [
            { version: UCP_VERSION, transport: "rest", endpoint: rest, spec: "https://agentpos.novacorplabs.com/spec/agentpos-service" },
            { version: UCP_VERSION, transport: "mcp", endpoint: `${rest}/mcp`, spec: "https://agentpos.novacorplabs.com/spec/agentpos-service" },
          ],
        },
        capabilities: {},
        payment_handlers: {
          "org.x402.stellar": [
            {
              id: "x402-stellar",
              version: UCP_VERSION,
              spec: "https://github.com/x402-foundation/x402",
              available_instruments: [{ type: "stellar_wallet" }],
              config: {
                protocol: "x402",
                x402Version: 2,
                scheme: "exact",
                network: BAKERY_NETWORK,
                asset: BAKERY_ASSET,
                assetAddress: BAKERY_ASSET_ADDRESS,
                payTo: BAKERY_PAY_TO,
                checkout: `${rest}/checkout`,
                cart: `${rest}/cart`,
              },
            },
          ],
        },
        "com.novacorplabs.agentpos": {
          adapterVersion: FIXTURE_ADAPTER_VERSION,
          catalog: `${rest}/catalog`,
          feed: `${rest}/feed`,
        },
        "com.novacorplabs.agentpos_fixture": { fixture: true, note: "Test double. Nothing settles here." },
      },
    }),
  );

  app.get("/agentpos/health", (c) =>
    c.json({
      ok: true,
      name,
      adapterVersion: FIXTURE_ADAPTER_VERSION,
      network: BAKERY_NETWORK,
      asset: BAKERY_ASSET,
      fixture: true,
      facilitator: { ok: true, status: 200, supportsNetwork: true, checkedAt: now().toISOString(), fixture: true },
      orders: { stuck: 0 },
      receipts: { signer: "fixture-unsigned", chainHeight: state.orders.size },
    }),
  );

  app.get("/agentpos/catalog", (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const filtered = (q
      ? items.filter((it) => `${it.title} ${it.description}`.toLowerCase().includes(q))
      : items
    ).map((it) => ({ ...it, url: `${base}/product/${it.id}/`, imageUrl: `${base}/images/${it.id}.svg` }));
    return c.json({
      adapterVersion: FIXTURE_ADAPTER_VERSION,
      site: { name, url: base },
      payment: {
        protocol: "x402",
        network: BAKERY_NETWORK,
        asset: BAKERY_ASSET,
        assetAddress: BAKERY_ASSET_ADDRESS,
        checkout: `${rest}/checkout?cart=<cartId>`,
      },
      items: filtered,
    });
  });

  // Fixture-only: a placeholder image per item, so views have something to show under the Store's own origin.
  app.get("/images/:file", (c) => {
    const id = c.req.param("file").replace(/\.svg$/, "");
    const it = byId.get(id);
    if (!it) return c.text("not found", 404);
    let hue = 0;
    for (const ch of id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" rx="24" fill="hsl(${hue} 45% 55%)"/><circle cx="200" cy="130" r="70" fill="hsl(${hue} 55% 80%)"/><text x="200" y="250" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700" fill="#1a1a1a" text-anchor="middle">${it.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(svg, 200, { "content-type": "image/svg+xml" });
  });

  app.get("/agentpos/feed", (c) =>
    c.json({
      products: items.map((it) => ({
        id: it.id,
        title: it.title,
        description: it.description,
        link: it.url,
        price: `${it.price.amount} ${it.price.asset}`,
        availability: "in_stock",
      })),
    }),
  );

  app.post("/agentpos/cart", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) {
      return c.json({ error: { code: "VALIDATION", message: "items[] is required", hint: "Send at least one { itemId, quantity }." } }, 400);
    }
    const lines: QuoteLine[] = [];
    let total = 0n;
    let physical = false;
    for (const raw of body.items) {
      if (!isRecord(raw) || typeof raw.itemId !== "string" || typeof raw.quantity !== "number" || raw.quantity < 1 || !Number.isInteger(raw.quantity)) {
        return c.json({ error: { code: "VALIDATION", message: "each line needs itemId and an integer quantity >= 1", hint: "" } }, 400);
      }
      const it = byId.get(raw.itemId);
      if (!it) {
        return c.json({ error: { code: "ITEM_NOT_FOUND", message: `No item ${raw.itemId}`, hint: "Use ids from GET /agentpos/catalog." } }, 400);
      }
      if (policy.refuseItemIds?.includes(it.id)) {
        return c.json({ error: { code: "POLICY_REFUSED", message: `The merchant does not sell ${it.title} to agents`, hint: "Remove the item from the cart." } }, 403);
      }
      const unit = BigInt(it.price.minor);
      const lineTotal = unit * BigInt(raw.quantity);
      total += lineTotal;
      physical = physical || it.physical;
      lines.push({
        itemId: it.id,
        externalId: String(it.attributes?.sku ?? it.id),
        title: it.title,
        quantity: raw.quantity,
        unitPriceUsdc: unit.toString(),
        lineTotalUsdc: lineTotal.toString(),
        physical: it.physical,
        unitPrice: humanAmount(unit),
        lineTotal: humanAmount(lineTotal),
      });
    }
    if (physical) {
      const buyer = isRecord(body.buyer) ? body.buyer : undefined;
      const shipping = isRecord(body.shipping) ? body.shipping : undefined;
      const need = ["name", "line1", "city", "postalCode", "country"];
      if (!buyer || typeof buyer.email !== "string" || !shipping || need.some((k) => typeof shipping[k] !== "string")) {
        // Fixture assumption: the OpenAPI documents only 201 and 403 here; a missing address is a 400.
        return c.json({ error: { code: "SHIPPING_REQUIRED", message: "Physical items require buyer.email and shipping", hint: "Send buyer { email } and shipping { name, line1, city, postalCode, country }." } }, 400);
      }
    }
    if (policy.refuseAboveMinor !== undefined && total > policy.refuseAboveMinor) {
      return c.json({ error: { code: "POLICY_REFUSED", message: "Order total above the merchant's limit for agents", hint: "Split the order or ask the merchant." } }, 403);
    }
    const decision = policy.reviewAboveMinor !== undefined && total > policy.reviewAboveMinor ? "review" : "allowed";
    const cartId = id("cart");
    const created = now();
    const quote: CartQuote = {
      cartId,
      expiresAt: new Date(created.getTime() + CART_TTL_MINUTES * 60_000).toISOString(),
      quote: {
        lines,
        total: humanAmount(total),
        totalMinor: total.toString(),
        asset: BAKERY_ASSET,
        network: BAKERY_NETWORK,
        payTo: BAKERY_PAY_TO,
        requiresShipping: physical,
      },
      checkout: `${rest}/checkout?cart=${cartId}`,
      protocol: "x402",
      policy: { decision, evaluatedAt: created.toISOString() },
      agent: { authenticated: false, attested: false },
      traceId: c.req.header("Request-Id") ?? randomBytes(8).toString("hex"),
    };
    state.carts.set(cartId, { quote, request: body as StoredCart["request"], decision });
    return c.json(quote, 201);
  });

  app.post("/agentpos/checkout", (c) => {
    const cartId = c.req.query("cart") ?? "";
    const cart = state.carts.get(cartId);
    if (!cart) {
      return c.json({ error: { code: "CART_NOT_FOUND", message: `No cart ${cartId}`, hint: "Create one at POST /agentpos/cart." } }, 409);
    }
    if (new Date(cart.quote.expiresAt).getTime() < now().getTime()) {
      return c.json({ error: { code: "CART_EXPIRED", message: "The cart must be re-quoted", hint: "POST /agentpos/cart again." } }, 409);
    }
    const signature = c.req.header(PAYMENT_SIGNATURE_HEADER);
    if (!signature) {
      const challenge: PaymentRequired = {
        x402Version: 2,
        error: "Payment required",
        resource: { url: `${rest}/checkout?cart=${cartId}`, description: `${name}: pay for a cart. Create one at ${rest}/cart.`, mimeType: "application/json" },
        accepts: [
          {
            scheme: "exact",
            network: BAKERY_NETWORK,
            amount: cart.quote.quote.totalMinor,
            asset: BAKERY_ASSET_ADDRESS,
            payTo: BAKERY_PAY_TO,
            maxTimeoutSeconds: 300,
            extra: { adapterVersion: FIXTURE_ADAPTER_VERSION, areFeesSponsored: true, fixture: true },
          },
        ],
      };
      c.header(PAYMENT_REQUIRED_HEADER, Buffer.from(JSON.stringify(challenge)).toString("base64"));
      c.header("Cache-Control", "no-store");
      return c.json({}, 402);
    }
    if (cart.decision === "review") {
      const approvalId = id("apr");
      const expiresAt = new Date(now().getTime() + 24 * 3_600_000).toISOString();
      state.approvals.set(approvalId, { cartId, expiresAt });
      return c.json({ status: "pending_approval", approvalId, poll: `${rest}/approvals/${approvalId}`, expiresAt }, 202);
    }
    // FIXTURE: the payload is not verified and nothing settles. The "transaction hash" is a
    // digest of the payload so that idempotency by hash can still be exercised.
    const txHash = `fixture:${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
    const existing = [...state.orders.values()].find((o) => o.payment.txHash === txHash);
    if (existing) return c.json({ orderId: existing.orderId, status: existing.status, order: `${rest}/orders/${existing.orderId}` });
    const orderId = id("ord");
    const createdAt = now().toISOString();
    state.orders.set(orderId, {
      orderId,
      cartId,
      status: "paid",
      total: cart.quote.quote.total,
      totalMinor: cart.quote.quote.totalMinor,
      payment: { protocol: "x402", network: BAKERY_NETWORK, asset: BAKERY_ASSET, amountMinor: cart.quote.quote.totalMinor, txHash, settledAt: createdAt, fixture: true },
      externalOrderId: String(1000 + state.orders.size),
      createdAt,
      lines: cart.quote.quote.lines,
    });
    return c.json({ orderId, status: "paid", order: `${rest}/orders/${orderId}` });
  });

  app.get("/agentpos/approvals/:approvalId", (c) => {
    const a = state.approvals.get(c.req.param("approvalId"));
    if (!a) return c.json({ error: { code: "APPROVAL_NOT_FOUND", message: "No such approval", hint: "" } }, 404);
    return c.json({ status: "pending_approval", cartId: a.cartId, expiresAt: a.expiresAt, fixture: true });
  });

  app.get("/agentpos/orders/:orderId", (c) => {
    const o = state.orders.get(c.req.param("orderId"));
    if (!o) return c.json({ error: { code: "ORDER_NOT_FOUND", message: "No such order", hint: "" } }, 404);
    return c.json({ orderId: o.orderId, status: o.status, total: o.total, payment: o.payment, externalOrderId: o.externalOrderId });
  });

  app.get("/agentpos/orders/:orderId/receipt", (c) => {
    const o = state.orders.get(c.req.param("orderId"));
    if (!o) return c.json({ error: { code: "RECEIPT_NOT_FOUND", message: "No receipt for that order yet", hint: "" } }, 404);
    return c.json({
      receipts: [
        {
          type: "order.paid",
          orderId: o.orderId,
          externalOrderId: o.externalOrderId,
          total: o.total,
          totalMinor: o.totalMinor,
          asset: BAKERY_ASSET,
          txHash: o.payment.txHash,
          issuedAt: o.createdAt,
          lines: o.lines.map((l) => ({ itemId: l.itemId, title: l.title, quantity: l.quantity, lineTotalMinor: l.lineTotalUsdc })),
          signer: "fixture-unsigned",
          signature: null,
        },
      ],
      verification: { valid: true, mode: "fixture", note: "Unsigned fixture receipt. A real Store signs its receipt chain." },
    });
  });

  return { app, state };
}
