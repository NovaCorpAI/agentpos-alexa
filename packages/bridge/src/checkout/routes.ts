/**
 * The five checkout operations Alexa+ documents, under /stores/{slug}/checkout-sessions.
 * Bearer first; Idempotency-Key required on state changes, replayed for 24 h and refused
 * with 409 when reused with a different body; Cache-Control: no-store on every answer.
 */
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { BridgeError, storeNotFound } from "../errors.js";
import type { Logger } from "../logging.js";
import type { Storage } from "../storage/sqlite.js";
import { buyerKeyOf, startOfDaysAgo, startOfMonth, summarize } from "./household.js";
import type { CallContext, CheckoutService } from "./service.js";
import type { CompleteRequest, SessionRequest } from "./types.js";

type Env = { Variables: { traceId: string; log: Logger } };

export interface CheckoutRouteDeps {
  storage: Storage;
  service: CheckoutService;
  gate: (req: Request) => Promise<AuthInfo | Response>;
}

const IDEMPOTENCY_HEADER = "Idempotency-Key";

function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function registerCheckoutRoutes(app: Hono<Env>, deps: CheckoutRouteDeps): void {
  const base = "/stores/:slug/checkout-sessions";
  const household = "/stores/:slug/household/purchases";

  app.use(`${base}/*`, async (c, next) => {
    c.header("Cache-Control", "no-store");
    const auth = await deps.gate(c.req.raw);
    if (auth instanceof Response) return auth;
    await next();
  });
  app.use(base, async (c, next) => {
    c.header("Cache-Control", "no-store");
    const auth = await deps.gate(c.req.raw);
    if (auth instanceof Response) return auth;
    await next();
  });

  app.use(household, async (c, next) => {
    c.header("Cache-Control", "no-store");
    const auth = await deps.gate(c.req.raw);
    if (auth instanceof Response) return auth;
    await next();
  });

  const ctxOf = (c: Context<Env>) => {
    const slug = c.req.param("slug")!;
    const store = deps.storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    const origin = c.req.header("AgentPOS-Purchase-Origin");
    const purchaseOrigin: CallContext["purchaseOrigin"] = origin === "own" ? "own" : origin === "third_party" ? "third_party" : undefined;
    return { store, traceId: c.get("traceId"), log: c.get("log").child({ slug, checkout: true }), ...(purchaseOrigin ? { purchaseOrigin } : {}) };
  };

  /** Runs a state-changing handler under the caller's Idempotency-Key. */
  const idempotent = async (c: Context<Env>, scope: string, run: (body: string) => Promise<{ status: 200 | 201; body: unknown }>): Promise<Response> => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      throw new BridgeError(400, { code: "IDEMPOTENCY_KEY_REQUIRED", message: `${IDEMPOTENCY_HEADER} header is required on ${c.req.method} ${c.req.path}`, hint: "Send a unique key per attempt; retries reuse it." });
    }
    const slug = c.req.param("slug")!;
    const raw = await c.req.text();
    const hash = bodyHash(raw);
    const seen = deps.storage.idempotency.lookup(key, slug, scope);
    if (seen) {
      if (seen.bodyHash !== hash) {
        throw new BridgeError(409, { code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used with a different body", hint: "Use a new key for a new request." });
      }
      c.header("Idempotent-Replayed", "true");
      return c.json(seen.body as Record<string, unknown>, seen.status as 200);
    }
    const out = await run(raw);
    deps.storage.idempotency.remember(key, slug, scope, hash, out.status, out.body);
    return c.json(out.body as Record<string, unknown>, out.status);
  };

  const parseJson = <T>(raw: string): T => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new BridgeError(400, { code: "MALFORMED_JSON", message: "Request body is not valid JSON", hint: "Send application/json." });
    }
  };

  app.post(base, (c) =>
    idempotent(c, "create", async (raw) => {
      const ctx = ctxOf(c);
      const session = await deps.service.create(ctx, parseJson<SessionRequest>(raw));
      return { status: 201, body: session };
    }),
  );

  app.get(`${base}/:id`, (c) => {
    const ctx = ctxOf(c);
    return c.json(deps.service.get(ctx, c.req.param("id")!));
  });

  /**
   * The x402 challenge for a session's cart: what the Store wants paid, so the customer's
   * wallet can sign it. Read only, and the Bridge is only the messenger.
   */
  app.post(`${base}/:id/payment-required`, async (c) => {
    const ctx = ctxOf(c);
    const challenge = await deps.service.paymentRequired(ctx, c.req.param("id")!);
    if (!challenge) {
      throw new BridgeError(409, { code: "NO_PAYMENT_CHALLENGE", message: "This session has no cart the Store can be paid for", hint: "Update the session with its line items first." });
    }
    return c.json(challenge);
  });

  app.put(`${base}/:id`, (c) =>
    idempotent(c, `update:${c.req.param("id")}`, async (raw) => {
      const ctx = ctxOf(c);
      return { status: 200, body: await deps.service.update(ctx, c.req.param("id")!, parseJson<SessionRequest>(raw)) };
    }),
  );

  app.post(`${base}/:id/complete`, (c) =>
    idempotent(c, `complete:${c.req.param("id")}`, async (raw) => {
      const ctx = ctxOf(c);
      return { status: 200, body: await deps.service.complete(ctx, c.req.param("id")!, parseJson<CompleteRequest>(raw)) };
    }),
  );

  app.post(`${base}/:id/cancel`, (c) =>
    idempotent(c, `cancel:${c.req.param("id")}`, async () => {
      const ctx = ctxOf(c);
      return { status: 200, body: deps.service.cancel(ctx, c.req.param("id")!) };
    }),
  );

  /**
   * What this household has bought at this Store, for the host to read back. A POST because
   * the buyer's address goes in the body: it never belongs in a URL, and it is hashed here
   * and not stored again. Read only: it adds up sessions that already settled.
   */
  app.post(household, async (c) => {
    const slug = c.req.param("slug")!;
    if (!deps.storage.stores.get(slug)) throw storeNotFound(slug);
    const body = (await c.req.json().catch(() => ({}))) as { buyer?: { email?: string }; period?: string; since?: string; limit?: number };
    const email = body.buyer?.email?.trim();
    if (!email) {
      throw new BridgeError(400, { code: "BUYER_REQUIRED", message: "buyer.email is required to look up a household's purchases", hint: "Send the same buyer the checkout used." });
    }
    const now = new Date();
    const since = body.since ?? (body.period === "last_30_days" ? startOfDaysAgo(now, 30) : body.period === "all_time" ? new Date(0).toISOString() : startOfMonth(now));
    const sessions = deps.storage.checkout.listCompletedByBuyer(slug, buyerKeyOf(email), since, Math.min(body.limit ?? 50, 100));
    return c.json(summarize(sessions, since));
  });
}
