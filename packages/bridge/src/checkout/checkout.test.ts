import { Guardian } from "@agentpos-alexa/agents";
import { FakeModel } from "@agentpos-alexa/agents/testing";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createLogger, memorySink } from "../logging.js";
import { RailRegistry, type PaymentRail } from "../rails/rail.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import { loadUcpConformance, type Conformance } from "./conformance.js";
import type { CheckoutSession } from "./types.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "test-bearer";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

/** A rail that pays the fixture bakery with a fixture signature. Labeled simulated. */
const testRail: PaymentRail = {
  namespace: "test.rail",
  id: "test-rail",
  version: "2026-04-08",
  availableInstruments: [{ type: "card" }],
  pspMode: "simulated",
  supports: () => true,
  async settle({ storeClient, internal, instrument }) {
    if (instrument.credential?.type === "decline-me") return { kind: "declined", code: "payment_failed", content: "Test decline.", simulated: true };
    const outcome = await storeClient.checkout(internal.cartId!, `test-signature:${internal.cartId}`);
    if (outcome.kind === "parked") return { kind: "parked", approvalId: outcome.result.approvalId, poll: outcome.result.poll, expiresAt: outcome.result.expiresAt };
    if (outcome.kind !== "paid") throw new Error("unexpected challenge");
    const order = await storeClient.order(outcome.result.orderId);
    return { kind: "settled", settlementReference: String((order.payment as { txHash: string }).txHash), storeOrderId: order.orderId, permalinkUrl: `${STORE}/orders/${order.orderId}`, simulated: true };
  },
};

const createBody = {
  line_items: [
    { item: { id: "sourdough-loaf", title: "ignored", price: 1 }, quantity: 2 },
    { item: { id: "baguette" }, quantity: 1 },
  ],
  buyer: { first_name: "Alex", last_name: "Demo", email: "alex.demo@example.com" },
  context: { language: "en-US", address_country: "CL" },
};

const updateBody = {
  ...createBody,
  fulfillment: {
    methods: [
      {
        id: "shipping_1",
        type: "shipping",
        selected_destination_id: "addr_001",
        line_item_ids: ["li_1", "li_2"],
        destinations: [{ id: "addr_001", street_address: "1 Fixture Street", address_locality: "Santiago", address_region: "RM", postal_code: "8320000", address_country: "CL" }],
      },
    ],
  },
};

describe("UCP checkout sessions", () => {
  let conformance: Conformance;
  let storage: Storage;
  let app: Hono;
  let fixture: ReturnType<typeof createFixtureStore>;
  let clock: Date;

  beforeAll(() => {
    conformance = loadUcpConformance("2026-04-08");
  });

  beforeEach(async () => {
    clock = new Date("2026-09-16T10:00:00Z");
    fixture = createFixtureStore({ baseUrl: STORE, policy: { reviewAboveMinor: 500_000_000n }, now: () => clock });
    storage = openStorage({ path: ":memory:" });
    const profile = await (await fixture.app.request("/.well-known/ucp")).json();
    storage.stores.register("bakery", parseStoreProfile(STORE, profile));
    app = createApp({
      storage,
      logger: createLogger(memorySink().sink),
      bridgeBaseUrl: BRIDGE,
      bearerToken: TOKEN,
      rails: new RailRegistry().register(testRail),
      storeFetch: fetchInto(fixture.app),
      now: () => clock,
    }) as unknown as Hono;
  });
  afterEach(() => storage.close());

  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "UCP-Agent": 'profile="https://alexa.amazon.com/.well-known/ucp"',
    "Request-Id": "req_test",
    ...extra,
  });
  const post = (path: string, body: unknown, key: string) => app.request(path, { method: "POST", headers: headers({ "Idempotency-Key": key }), body: JSON.stringify(body) });
  const put = (path: string, body: unknown, key: string) => app.request(path, { method: "PUT", headers: headers({ "Idempotency-Key": key }), body: JSON.stringify(body) });
  const get = (path: string) => app.request(path, { headers: headers() });
  const assertConformant = (s: CheckoutSession) => {
    const r = conformance.validate("shopping/checkout.json", s);
    expect(r.ok ? [] : r.errors).toEqual([]);
  };

  it("create prices from the catalog, ignores client prices, asks for the address, and conforms to the schema", async () => {
    const res = await post("/stores/bakery/checkout-sessions", createBody, "k-create-1");
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("request-id")).toBe("req_test");
    const s = (await res.json()) as CheckoutSession;
    assertConformant(s);
    expect(s.status).toBe("incomplete");
    expect(s.currency).toBe("USD");
    expect(s.line_items.map((l) => [l.id, l.item.price, l.quantity])).toEqual([["li_1", 650, 2], ["li_2", 280, 1]]);
    expect(s.totals).toEqual([{ type: "subtotal", amount: 1580 }, { type: "total", amount: 1580 }]);
    expect(s.messages).toContainEqual({ type: "error", code: "missing", path: "$.fulfillment.methods[0].selected_destination_id", content: "Delivery address is required", severity: "recoverable" });
    expect(s.ucp.payment_handlers).toEqual({ "test.rail": [{ id: "test-rail", version: "2026-04-08", available_instruments: [{ type: "card" }], simulated: true }] });
    expect(s.links[0]).toMatchObject({ type: "refund_policy", title: "Refund policy" });
    expect(s.expires_at).toBe("2026-09-16T16:00:00.000Z");
  });

  it("update with a destination gets the Store's quote and becomes ready_for_complete; complete settles through the rail", async () => {
    const created = (await (await post("/stores/bakery/checkout-sessions", createBody, "k1")).json()) as CheckoutSession;
    const updated = (await (await put(`/stores/bakery/checkout-sessions/${created.id}`, updateBody, "k2")).json()) as CheckoutSession;
    assertConformant(updated);
    expect(updated.status).toBe("ready_for_complete");
    expect(updated.messages).toEqual([]);
    expect(updated.totals.at(-1)).toEqual({ type: "total", amount: 1580 });
    expect(fixture.state.carts.size).toBe(1);

    const completeBody = { payment: { instruments: [{ id: "instr_1", handler_id: "test-rail", type: "card", credential: { type: "test", secret: "never-stored" }, display: { brand: "visa", last_digits: "4242" } }] } };
    const done = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, completeBody, "k3")).json()) as CheckoutSession;
    assertConformant(done);
    expect(done.status).toBe("completed");
    expect(done.order?.id).toMatch(/^ord_/);
    expect(JSON.stringify(done)).not.toContain("never-stored");
    expect(done.messages[0]).toMatchObject({ type: "info", code: "simulated_psp" });

    const again = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, completeBody, "k4")).json()) as CheckoutSession;
    expect(again.order?.id).toBe(done.order?.id);
    expect(fixture.state.orders.size).toBe(1);

    const events = storage.usageEvents.list({ source: "bridge.checkout" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ checkoutSessionId: created.id, paymentHandler: "test.rail/test-rail", simulated: true });

    const put409 = await put(`/stores/bakery/checkout-sessions/${created.id}`, updateBody, "k5");
    expect(put409.status).toBe(409);
    expect(await put409.json()).toMatchObject({ code: "SESSION_IMMUTABLE" });
  });

  it("the guardian asks once about a duplicate order; the buyer's next complete is the answer", async () => {
    const model = new FakeModel([{ text: JSON.stringify({ decision: "review", reason: "You ordered the same bread today. Order it again?" }) }]);
    const guardian = new Guardian({ model, modelId: "fake.strong" });
    app = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails: new RailRegistry().register(testRail), guardian, storeFetch: fetchInto(fixture.app), now: () => clock }) as unknown as Hono;
    const completeBody = { payment: { instruments: [{ id: "instr_1", handler_id: "test-rail", type: "card", credential: { type: "test" } }] } };
    const buy = async (key: string) => {
      const created = (await (await post("/stores/bakery/checkout-sessions", createBody, `${key}-c`)).json()) as CheckoutSession;
      await put(`/stores/bakery/checkout-sessions/${created.id}`, updateBody, `${key}-u`);
      return { id: created.id, done: (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, completeBody, `${key}-x`)).json()) as CheckoutSession };
    };
    // First order of the day: no rule fires, no model call, no guardian row.
    expect((await buy("g1")).done.status).toBe("completed");
    expect(model.calls).toHaveLength(0);
    expect(storage.usageEvents.list({ source: "agent.guardian" })).toHaveLength(0);

    // Same lines, same buyer, an hour later: the guardian speaks and the session waits for the buyer.
    clock = new Date(clock.getTime() + 3_600_000);
    const second = await buy("g2");
    assertConformant(second.done);
    expect(second.done.status).toBe("incomplete");
    expect(second.done.messages).toEqual([{ type: "error", code: "duplicate_order", content: "You ordered the same bread today. Order it again?", severity: "requires_buyer_review" }]);
    expect(fixture.state.orders.size).toBe(1);
    expect(storage.usageEvents.list({ source: "agent.guardian" })).toMatchObject([{ checkoutSessionId: second.id, model: "fake.strong", simulated: false }]);
    expect(JSON.stringify(model.calls)).not.toContain("alex.demo@example.com");

    // The buyer says yes: the same session completes without asking again.
    const yes = (await (await post(`/stores/bakery/checkout-sessions/${second.id}/complete`, completeBody, "g2-y")).json()) as CheckoutSession;
    expect(yes.status).toBe("completed");
    expect(fixture.state.orders.size).toBe(2);
    expect(model.calls).toHaveLength(1);
  });

  it("without a model, the guardian's rule decides with a fixed sentence", async () => {
    app = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails: new RailRegistry().register(testRail), guardian: new Guardian(), storeFetch: fetchInto(fixture.app), now: () => clock }) as unknown as Hono;
    const completeBody = { payment: { instruments: [{ id: "instr_1", handler_id: "test-rail", type: "card", credential: { type: "test" } }] } };
    for (const key of ["r1", "r2"]) {
      const created = (await (await post("/stores/bakery/checkout-sessions", createBody, `${key}-c`)).json()) as CheckoutSession;
      await put(`/stores/bakery/checkout-sessions/${created.id}`, updateBody, `${key}-u`);
      const done = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, completeBody, `${key}-x`)).json()) as CheckoutSession;
      if (key === "r1") expect(done.status).toBe("completed");
      else expect(done.messages[0]).toMatchObject({ code: "duplicate_order", severity: "requires_buyer_review", content: expect.stringMatching(/^You already ordered .* today[.] Do you want to order it again[?]$/) });
    }
    expect(storage.usageEvents.list({ source: "agent.guardian" })).toMatchObject([{ model: null, inputTokens: 0 }]);
  });

  it("counts a purchase as a third party's unless the platform says it is ours, and publishes only totals", async () => {
    const completeBody = { payment: { instruments: [{ id: "instr_1", handler_id: "test-rail", type: "card", credential: { type: "test" } }] } };
    const buy = async (key: string, origin?: string, itemId = "sourdough-loaf") => {
      const body = { ...createBody, line_items: [{ item: { id: itemId }, quantity: 1 }] };
      const created = (await (await post("/stores/bakery/checkout-sessions", body, `${key}-c`)).json()) as CheckoutSession;
      await put(`/stores/bakery/checkout-sessions/${created.id}`, { ...updateBody, line_items: body.line_items, fulfillment: { methods: [{ ...updateBody.fulfillment.methods[0]!, line_item_ids: ["li_1"] }] } }, `${key}-u`);
      const extra = origin ? { "AgentPOS-Purchase-Origin": origin } : {};
      const res = await app.request(`/stores/bakery/checkout-sessions/${created.id}/complete`, { method: "POST", headers: headers({ "Idempotency-Key": `${key}-x`, ...extra }), body: JSON.stringify(completeBody) });
      return (await res.json()) as CheckoutSession;
    };
    expect((await buy("o1", "own")).status).toBe("completed");
    expect((await buy("o2", undefined, "baguette")).status).toBe("completed");
    expect((await buy("o3", "third_party", "rye-loaf")).status).toBe("completed");
    expect(storage.usageEvents.list({ source: "bridge.checkout" }).map((e) => e.purchaseOrigin)).toEqual(["own", "third_party", "third_party"]);
    const stats = await app.request("/stats");
    expect(stats.status).toBe(200);
    expect(await stats.json()).toEqual({ purchases: { own: 1, thirdParty: 2 }, thisRelease: { own: 1, thirdParty: 2 }, stores: 1 });

    // A release starts with an empty disk, so the public total is what earlier releases counted
    // plus what this one has counted; the export says what to hand over.
    const csv = await app.request("/admin/usage-events.csv", { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(csv.headers.get("X-Completed-Own")).toBe("1");
    expect(csv.headers.get("X-Completed-Third-Party")).toBe("2");
    const next = createApp({
      storage,
      logger: createLogger(memorySink().sink),
      bridgeBaseUrl: BRIDGE,
      bearerToken: TOKEN,
      priorPurchases: { own: 4, thirdParty: 9 },
    }) as unknown as Hono;
    expect(await (await next.request("/stats")).json()).toMatchObject({ purchases: { own: 5, thirdParty: 11 }, thisRelease: { own: 1, thirdParty: 2 } });
  });

  it("replays the same Idempotency-Key and refuses it with a different body", async () => {
    const first = await post("/stores/bakery/checkout-sessions", createBody, "same-key");
    const replay = await post("/stores/bakery/checkout-sessions", createBody, "same-key");
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(((await replay.json()) as CheckoutSession).id).toBe(((await first.json()) as CheckoutSession).id);
    const conflict = await post("/stores/bakery/checkout-sessions", { ...createBody, buyer: { email: "other@example.com" } }, "same-key");
    expect(conflict.status).toBe(409);
    const missing = await app.request("/stores/bakery/checkout-sessions", { method: "POST", headers: headers(), body: JSON.stringify(createBody) });
    expect(missing.status).toBe(400);
  });

  it("declines stay 200 with payment_failed, not-ready sessions say so, unknown handlers are refused softly", async () => {
    const created = (await (await post("/stores/bakery/checkout-sessions", createBody, "d1")).json()) as CheckoutSession;
    const notReady = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, { payment: { instruments: [{ id: "i", handler_id: "test-rail", type: "card" }] } }, "d2")).json()) as CheckoutSession;
    expect(notReady.status).toBe("incomplete");
    expect(notReady.messages.some((m) => m.type === "error" && m.code === "not_ready")).toBe(true);

    await put(`/stores/bakery/checkout-sessions/${created.id}`, updateBody, "d3");
    const declined = await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, { payment: { instruments: [{ id: "i", handler_id: "test-rail", type: "card", credential: { type: "decline-me" } }] } }, "d4");
    expect(declined.status).toBe(200);
    const ds = (await declined.json()) as CheckoutSession;
    assertConformant(ds);
    expect(ds.status).toBe("incomplete");
    expect(ds.messages[0]).toMatchObject({ type: "error", code: "payment_failed", severity: "recoverable" });

    const unknown = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, { payment: { instruments: [{ id: "i", handler_id: "nope", type: "card" }] } }, "d5")).json()) as CheckoutSession;
    expect(unknown.messages[0]).toMatchObject({ code: "payment_failed", path: "$.payment.instruments[0].handler_id" });
  });

  it("parks orders the merchant wants to review", async () => {
    const big = { ...updateBody, line_items: [{ item: { id: "cinnamon-rolls-4" }, quantity: 6 }] };
    const created = (await (await post("/stores/bakery/checkout-sessions", big, "p1")).json()) as CheckoutSession;
    expect(created.status).toBe("ready_for_complete");
    expect(created.messages[0]).toMatchObject({ type: "info", code: "merchant_review" });
    const parked = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/complete`, { payment: { instruments: [{ id: "i", handler_id: "test-rail", type: "card" }] } }, "p2")).json()) as CheckoutSession;
    assertConformant(parked);
    expect(parked.status).toBe("incomplete");
    expect(parked.messages[0]).toMatchObject({ code: "merchant_review", severity: "requires_buyer_review" });
  });

  it("cancel, expiry, unknown session, unknown item and auth", async () => {
    const created = (await (await post("/stores/bakery/checkout-sessions", createBody, "c1")).json()) as CheckoutSession;
    const canceled = (await (await post(`/stores/bakery/checkout-sessions/${created.id}/cancel`, {}, "c2")).json()) as CheckoutSession;
    assertConformant(canceled);
    expect(canceled.status).toBe("canceled");

    const other = (await (await post("/stores/bakery/checkout-sessions", createBody, "c3")).json()) as CheckoutSession;
    clock = new Date("2026-09-16T16:00:01Z");
    const expired = (await (await get(`/stores/bakery/checkout-sessions/${other.id}`)).json()) as CheckoutSession;
    expect(expired.status).toBe("canceled");
    expect(expired.messages[0]).toMatchObject({ type: "info", code: "expired" });

    expect((await get("/stores/bakery/checkout-sessions/cs_nope")).status).toBe(404);
    const bad = (await (await post("/stores/bakery/checkout-sessions", { line_items: [{ item: { id: "unicorn" }, quantity: 1 }] }, "c4")).json()) as CheckoutSession;
    assertConformant(bad);
    expect(bad.messages[0]).toMatchObject({ code: "not_found", path: "$.line_items[0].item.id" });

    const noAuth = await app.request("/stores/bakery/checkout-sessions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "x" }, body: "{}" });
    expect(noAuth.status).toBe(401);
  });

  it("issues OAuth client credentials tokens that the checkout and MCP gates accept", async () => {
    storage.oauth.registerClient("alexa-sim", "s3cret");
    const tok = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from("alexa-sim:s3cret").toString("base64")}` },
      body: "grant_type=client_credentials&scope=checkout",
    });
    expect(tok.status).toBe(200);
    const body = (await tok.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    const res = await app.request("/stores/bakery/checkout-sessions", { method: "POST", headers: { ...headers({ "Idempotency-Key": "o1" }), Authorization: `Bearer ${body.access_token}` }, body: JSON.stringify(createBody) });
    expect(res.status).toBe(201);
    const wrong = await app.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=alexa-sim&client_secret=nope" });
    expect(wrong.status).toBe(401);
  });

  it("serves the Alexa+ shaped profile with the checkout service rooted at the store path", async () => {
    const res = await app.request("/stores/bakery/.well-known/ucp");
    const p = (await res.json()) as { ucp: { services: Record<string, unknown[]>; capabilities: Record<string, unknown[]>; payment_handlers: Record<string, unknown> } };
    expect(p.ucp.services["dev.ucp.shopping"]?.[0]).toMatchObject({ transport: "rest", endpoint: `${BRIDGE}/stores/bakery`, version: "2026-04-08" });
    expect(p.ucp.capabilities["dev.ucp.shopping.checkout"]?.[0]).toMatchObject({ version: "2026-04-08" });
    expect(Object.keys(p.ucp.payment_handlers)).toEqual(expect.arrayContaining(["org.x402.stellar", "test.rail"]));
    expect(p.ucp.services["com.novacorplabs.agentpos"]).toBeDefined();
    const r = conformance.validate("ucp.json", p.ucp);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});
