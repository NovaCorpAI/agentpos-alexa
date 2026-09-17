/**
 * REST client for one AgentPOS Store. Only public surfaces; every request carries the
 * Request-Id that is the trace id across the Bridge, the Store and the settlement.
 */
import {
  parseCartQuote,
  parseCatalog,
  parsePaymentRequired,
  type CartQuote,
  type CartRequest,
  type Catalog,
  type CatalogItem,
  type CheckoutPaid,
  type CheckoutParked,
  type Order,
  type PaymentRequired,
  type ReceiptChain,
  type StoreHealth,
} from "./agentpos.js";
import type { StoreEndpoints } from "./index.js";

export interface StoreRequestErrorBody {
  code:
    | "STORE_UNREACHABLE"
    | "STORE_BAD_RESPONSE"
    | "STORE_REFUSED"
    | "STORE_NOT_FOUND"
    | "STORE_REQUOTE"
    | "STORE_VALIDATION";
  message: string;
  hint: string;
  /** HTTP status the Store answered, when it answered. */
  status?: number;
  /** The Store's own error object, when it sent one. */
  storeError?: unknown;
}

export class StoreRequestError extends Error {
  readonly code: StoreRequestErrorBody["code"];
  readonly hint: string;
  readonly status: number | undefined;
  readonly storeError: unknown;
  constructor(body: StoreRequestErrorBody) {
    super(body.message);
    this.name = "StoreRequestError";
    this.code = body.code;
    this.hint = body.hint;
    this.status = body.status;
    this.storeError = body.storeError;
  }
  toJSON(): StoreRequestErrorBody {
    const out: StoreRequestErrorBody = { code: this.code, message: this.message, hint: this.hint };
    if (this.status !== undefined) out.status = this.status;
    if (this.storeError !== undefined) out.storeError = this.storeError;
    return out;
  }
}

export type CheckoutOutcome =
  | { kind: "payment_required"; challenge: PaymentRequired }
  | { kind: "paid"; result: CheckoutPaid }
  | { kind: "parked"; result: CheckoutParked };

export interface StoreClientOptions {
  fetchImpl?: typeof fetch;
  /** Trace id sent as Request-Id on every call. */
  traceId?: string;
  timeoutMs?: number;
}

export const PAYMENT_REQUIRED_HEADER = "Payment-Required";
export const PAYMENT_SIGNATURE_HEADER = "Payment-Signature";

export class AgentPosStoreClient {
  private readonly fetchImpl: typeof fetch;
  private readonly traceId: string | undefined;
  private readonly timeoutMs: number;

  constructor(
    readonly endpoints: Pick<StoreEndpoints, "origin" | "restBase">,
    opts: StoreClientOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.traceId = opts.traceId;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.endpoints.restBase}${path}`;
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (this.traceId) headers.set("Request-Id", this.traceId);
    try {
      return await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      throw new StoreRequestError({
        code: "STORE_UNREACHABLE",
        message: `Could not reach ${url}: ${String(cause)}`,
        hint: "Check that the Store is online.",
      });
    }
  }

  private async json(res: Response, what: string): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new StoreRequestError({
        code: "STORE_BAD_RESPONSE",
        message: `The Store's ${what} response was not JSON`,
        hint: "The Store may be behind a proxy returning HTML.",
        status: res.status,
      });
    }
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.json().catch(() => undefined);
    const storeError = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : body;
    const map: Record<number, StoreRequestErrorBody["code"]> = { 400: "STORE_VALIDATION", 403: "STORE_REFUSED", 404: "STORE_NOT_FOUND", 409: "STORE_REQUOTE" };
    throw new StoreRequestError({
      code: map[res.status] ?? "STORE_BAD_RESPONSE",
      message: `The Store answered ${res.status} to ${what}`,
      hint: res.status === 403 ? "The merchant policy refused this sale." : res.status === 409 ? "Quote the cart again." : "See storeError.",
      status: res.status,
      storeError,
    });
  }

  async health(): Promise<StoreHealth> {
    const res = await this.call("/health");
    if (!res.ok && res.status !== 503) return this.fail(res, "health");
    return (await this.json(res, "health")) as StoreHealth;
  }

  async catalog(q?: string): Promise<Catalog> {
    const res = await this.call(q ? `/catalog?q=${encodeURIComponent(q)}` : "/catalog");
    if (!res.ok) return this.fail(res, "catalog");
    return parseCatalog(await this.json(res, "catalog"));
  }

  /** AgentPOS has no per-item route; the item comes from the catalog. */
  async item(itemId: string): Promise<CatalogItem | undefined> {
    const cat = await this.catalog();
    return cat.items.find((it) => it.id === itemId);
  }

  async createCart(req: CartRequest): Promise<CartQuote> {
    const res = await this.call("/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status !== 201) return this.fail(res, "cart");
    return parseCartQuote(await this.json(res, "cart"));
  }

  /**
   * One checkout round trip. Without a payment signature the Store answers the x402
   * challenge; with one it answers paid (200) or parked for a human (202).
   */
  async checkout(cartId: string, paymentSignature?: string): Promise<CheckoutOutcome> {
    const headers: Record<string, string> = {};
    if (paymentSignature) headers[PAYMENT_SIGNATURE_HEADER] = paymentSignature;
    const res = await this.call(`/checkout?cart=${encodeURIComponent(cartId)}`, { method: "POST", headers });
    if (res.status === 402) {
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      if (!header) {
        throw new StoreRequestError({
          code: "STORE_BAD_RESPONSE",
          message: "402 without a Payment-Required header",
          hint: "The Store must send the x402 challenge in the Payment-Required header.",
          status: 402,
        });
      }
      return { kind: "payment_required", challenge: parsePaymentRequired(header) };
    }
    if (res.status === 200) return { kind: "paid", result: (await this.json(res, "checkout")) as CheckoutPaid };
    if (res.status === 202) return { kind: "parked", result: (await this.json(res, "checkout")) as CheckoutParked };
    return this.fail(res, "checkout");
  }

  /**
   * Checkout through the merchant's own PSP: the processor token in, the Store's charge out.
   * Proposed extension of the AgentPOS API (the PaymentRail upstream), served by the fixture.
   */
  async checkoutWithProcessorToken(cartId: string, token: string): Promise<{ kind: "paid"; result: CheckoutPaid } | { kind: "parked"; result: CheckoutParked } | { kind: "declined"; code: string; message: string }> {
    const res = await this.call(`/checkout/processor?cart=${encodeURIComponent(cartId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (res.status === 200) return { kind: "paid", result: (await this.json(res, "processor checkout")) as CheckoutPaid };
    if (res.status === 202) return { kind: "parked", result: (await this.json(res, "processor checkout")) as CheckoutParked };
    if (res.status === 402) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      return { kind: "declined", code: body.error?.code ?? "PAYMENT_DECLINED", message: body.error?.message ?? "The card was declined." };
    }
    return this.fail(res, "processor checkout");
  }

  async order(orderId: string): Promise<Order> {
    const res = await this.call(`/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) return this.fail(res, "order");
    return (await this.json(res, "order")) as Order;
  }

  async receipt(orderId: string): Promise<ReceiptChain> {
    const res = await this.call(`/orders/${encodeURIComponent(orderId)}/receipt`);
    if (!res.ok) return this.fail(res, "receipt");
    return (await this.json(res, "receipt")) as ReceiptChain;
  }
}
