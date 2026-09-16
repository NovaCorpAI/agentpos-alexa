/**
 * Shapes of the AgentPOS REST surface (adapter version 0.2.0), as published in the store's
 * OpenAPI (`packages/fixture-store/vendor/agentpos-openapi.json`) and observed on
 * demo.agentposhq.com. Where the OpenAPI leaves an object opaque (quote, policy, payment),
 * the shape here is the one the demo store returns today; parsers only require what the
 * bridge needs and keep the rest.
 *
 * Money: `minor` strings are integers in the asset's minor units (USDC: 7 decimals).
 */
import { StoreDiscoveryError } from "./index.js";

export interface CatalogPrice {
  /** Human amount, e.g. "1.5". Display only. */
  amount: string;
  asset: string;
  /** Integer minor units as a string, e.g. "15000000" for 1.5 USDC. */
  minor: string;
}

export interface CatalogItem {
  id: string;
  type: string;
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  attributes?: Record<string, unknown>;
  price: CatalogPrice;
  physical: boolean;
  stockMode?: string;
}

export interface Catalog {
  adapterVersion: string;
  site: { name: string; url: string };
  payment: { protocol: string; network: string; asset: string; assetAddress?: string; checkout: string };
  items: CatalogItem[];
}

export interface CartLineRequest {
  itemId: string;
  quantity: number;
  note?: string;
}

export interface CartRequest {
  items: CartLineRequest[];
  buyer?: { email: string; name?: string };
  shipping?: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
}

export interface QuoteLine {
  itemId: string;
  externalId?: string;
  title: string;
  quantity: number;
  /** Integer minor units. */
  unitPriceUsdc: string;
  lineTotalUsdc: string;
  physical: boolean;
  unitPrice: string;
  lineTotal: string;
}

export interface Quote {
  lines: QuoteLine[];
  total: string;
  /** Integer minor units. */
  totalMinor: string;
  asset: string;
  network: string;
  payTo: string;
  requiresShipping: boolean;
}

export type PolicyDecision = "allowed" | "review" | "refused";

export interface CartQuote {
  cartId: string;
  expiresAt: string;
  quote: Quote;
  checkout: string;
  protocol?: string;
  policy?: { decision: PolicyDecision; reason?: string; evaluatedAt?: string };
  agent?: { authenticated: boolean; attested: boolean };
  traceId?: string;
}

export interface CheckoutPaid {
  orderId: string;
  status: string;
  order?: string;
}

export interface CheckoutParked {
  status: string;
  approvalId: string;
  poll: string;
  expiresAt: string;
}

export interface Order {
  orderId: string;
  status: string;
  total?: string;
  payment?: Record<string, unknown>;
  externalOrderId?: string;
}

export interface ReceiptChain {
  receipts: Record<string, unknown>[];
  verification?: Record<string, unknown>;
}

export interface StoreHealth {
  ok: boolean;
  name?: string;
  network?: string;
  [key: string]: unknown;
}

/** x402 version 2 challenge, carried base64-encoded in the `Payment-Required` header. */
export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: Array<{
    scheme: string;
    network: string;
    /** Integer minor units. */
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const MINOR = /^[0-9]+$/;

function invalid(what: string, hint: string): StoreDiscoveryError {
  return new StoreDiscoveryError({
    code: "STORE_PROFILE_INVALID",
    message: `The store's ${what} does not have the AgentPOS shape`,
    hint,
  });
}

export function parseCatalog(json: unknown): Catalog {
  if (!isRecord(json) || !Array.isArray(json.items) || !isRecord(json.site) || !isRecord(json.payment)) {
    throw invalid("catalog", "Expected { adapterVersion, site, payment, items[] }.");
  }
  for (const it of json.items) {
    if (!isRecord(it) || typeof it.id !== "string" || typeof it.title !== "string" || !isRecord(it.price)) {
      throw invalid("catalog item", "Each item needs id, title and price.");
    }
    if (typeof it.price.minor !== "string" || !MINOR.test(it.price.minor)) {
      throw invalid("catalog price", "price.minor must be an integer string in minor units.");
    }
  }
  return json as unknown as Catalog;
}

export function parseCartQuote(json: unknown): CartQuote {
  if (!isRecord(json) || typeof json.cartId !== "string" || typeof json.checkout !== "string" || !isRecord(json.quote)) {
    throw invalid("cart", "Expected { cartId, expiresAt, quote, checkout }.");
  }
  const q = json.quote;
  if (typeof q.totalMinor !== "string" || !MINOR.test(q.totalMinor) || !Array.isArray(q.lines)) {
    throw invalid("quote", "quote.totalMinor must be an integer string and quote.lines an array.");
  }
  return json as unknown as CartQuote;
}

export function parsePaymentRequired(headerValue: string): PaymentRequired {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
  } catch {
    throw invalid("Payment-Required header", "Expected base64-encoded JSON (x402 version 2).");
  }
  if (!isRecord(json) || typeof json.x402Version !== "number" || !Array.isArray(json.accepts)) {
    throw invalid("Payment-Required header", "Expected { x402Version, resource, accepts[] }.");
  }
  return json as unknown as PaymentRequired;
}
