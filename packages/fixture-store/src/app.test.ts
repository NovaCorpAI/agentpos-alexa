import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import type { Hono } from "hono";
import { parseCartQuote, parseCatalog, parsePaymentRequired, parseStoreProfile } from "@agentpos-alexa/store-client";
import { describe, expect, it } from "vitest";
import { createFixtureStore, PAYMENT_REQUIRED_HEADER, PAYMENT_SIGNATURE_HEADER } from "./app.js";

const here = new URL(".", import.meta.url);
const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, here), "utf8")) as unknown;
const openapi = read("../vendor/agentpos-openapi.json") as {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>>;
};

const ajv = new Ajv({ strict: false });
function responseSchema(path: string, method: string, status: string) {
  const schema = openapi.paths[path]?.[method]?.responses[status]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`no schema for ${method.toUpperCase()} ${path} ${status}`);
  return ajv.compile(schema);
}

const BASE = "http://bakery.test";
const buyer = { email: "alex.demo@example.com", name: "Alex Demo" };
const shipping = { name: "Alex Demo", line1: "1 Fixture Street", city: "Santiago", postalCode: "8320000", country: "CL" };

async function postJson(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("recorded demo store responses parse with the same client", () => {
  it("UCP profile", () => {
    const s = parseStoreProfile("https://demo.agentposhq.com", read("../recorded/demo-ucp-profile.json"));
    expect(s.restBase).toBe("https://demo.agentposhq.com/agentpos");
    expect(s.paymentHandlers).toEqual(["x402-stellar"]);
  });
  it("catalog", () => {
    const cat = parseCatalog(read("../recorded/demo-catalog.json"));
    expect(cat.items.length).toBeGreaterThan(0);
    expect(cat.items[0]?.price.minor).toMatch(/^[0-9]+$/);
  });
  it("cart quote", () => {
    const q = parseCartQuote(read("../recorded/demo-cart-201.json"));
    expect(q.quote.totalMinor).toBe("10000000");
  });
  it("x402 challenge", () => {
    const raw = read("../recorded/demo-checkout-402-payment-required.json");
    const pr = parsePaymentRequired(Buffer.from(JSON.stringify(raw)).toString("base64"));
    expect(pr.accepts[0]?.scheme).toBe("exact");
  });
});

describe("fixture bakery conforms to the vendored AgentPOS OpenAPI", () => {
  const { app } = createFixtureStore({ baseUrl: BASE });

  it("catalog: 200 shape, physical goods, integer minor prices, q filter", async () => {
    const res = await app.request("/agentpos/catalog");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(responseSchema("/agentpos/catalog", "get", "200")(body)).toBe(true);
    const cat = parseCatalog(body);
    expect(cat.items.every((i) => i.physical)).toBe(true);
    const gf = await (await app.request("/agentpos/catalog?q=gluten-free")).json();
    expect(parseCatalog(gf).items.map((i) => i.id)).toEqual(["gluten-free-loaf"]);
  });

  it("health: 200 shape", async () => {
    const body = await (await app.request("/agentpos/health")).json();
    expect(responseSchema("/agentpos/health", "get", "200")(body)).toBe(true);
    expect(body).toMatchObject({ ok: true, fixture: true });
  });

  it("UCP profile is discoverable by the store client", async () => {
    const body = await (await app.request("/.well-known/ucp")).json();
    const s = parseStoreProfile(BASE, body);
    expect(s.restBase).toBe(`${BASE}/agentpos`);
    expect(s.mcpEndpoint).toBe(`${BASE}/agentpos/mcp`);
  });

  it("cart: physical items without shipping are refused; with shipping a 201 quote", async () => {
    const missing = await postJson(app, "/agentpos/cart", { items: [{ itemId: "sourdough-loaf", quantity: 2 }] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: "SHIPPING_REQUIRED" } });

    const res = await postJson(app, "/agentpos/cart", { items: [{ itemId: "sourdough-loaf", quantity: 2 }], buyer, shipping });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(responseSchema("/agentpos/cart", "post", "201")(body)).toBe(true);
    const q = parseCartQuote(body);
    expect(q.quote.totalMinor).toBe("130000000");
    expect(q.quote.total).toBe("13");
    expect(q.quote.requiresShipping).toBe(true);
    expect(q.policy?.decision).toBe("allowed");
  });

  it("checkout: 402 with an x402 v2 challenge, then 200 with a payment signature, then order and receipt", async () => {
    const q = parseCartQuote(await (await postJson(app, "/agentpos/cart", { items: [{ itemId: "baguette", quantity: 1 }], buyer, shipping })).json());
    const path = new URL(q.checkout).pathname + new URL(q.checkout).search;

    const challenge = await app.request(path, { method: "POST" });
    expect(challenge.status).toBe(402);
    const pr = parsePaymentRequired(challenge.headers.get(PAYMENT_REQUIRED_HEADER) ?? "");
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: "stellar:testnet", amount: "28000000" });

    const paid = await app.request(path, { method: "POST", headers: { [PAYMENT_SIGNATURE_HEADER]: "fixture-payload-1" } });
    expect(paid.status).toBe(200);
    const paidBody = (await paid.json()) as { orderId: string; status: string };
    expect(responseSchema("/agentpos/checkout", "post", "200")(paidBody)).toBe(true);

    const again = await app.request(path, { method: "POST", headers: { [PAYMENT_SIGNATURE_HEADER]: "fixture-payload-1" } });
    expect(((await again.json()) as { orderId: string }).orderId).toBe(paidBody.orderId);

    const order = await (await app.request(`/agentpos/orders/${paidBody.orderId}`)).json();
    expect(responseSchema("/agentpos/orders/{orderId}", "get", "200")(order)).toBe(true);
    expect(order).toMatchObject({ status: "paid", payment: { fixture: true } });

    const receipt = await (await app.request(`/agentpos/orders/${paidBody.orderId}/receipt`)).json();
    expect(responseSchema("/agentpos/orders/{orderId}/receipt", "get", "200")(receipt)).toBe(true);
    expect(receipt).toMatchObject({ verification: { mode: "fixture" } });

    expect((await app.request("/agentpos/orders/nope")).status).toBe(404);
    expect((await app.request(`/agentpos/checkout?cart=nope`, { method: "POST" })).status).toBe(409);
  });
});

describe("fixture merchant policy", () => {
  it("parks large carts for a human (202) and refuses forbidden items (403)", async () => {
    const { app } = createFixtureStore({ baseUrl: BASE, policy: { reviewAboveMinor: 100_000_000n, refuseItemIds: ["rye-loaf"] } });
    const big = parseCartQuote(await (await postJson(app, "/agentpos/cart", { items: [{ itemId: "cinnamon-rolls-4", quantity: 2 }], buyer, shipping })).json());
    expect(big.policy?.decision).toBe("review");
    const parked = await app.request(new URL(big.checkout).pathname + new URL(big.checkout).search, { method: "POST", headers: { [PAYMENT_SIGNATURE_HEADER]: "x" } });
    expect(parked.status).toBe(202);
    expect(responseSchema("/agentpos/checkout", "post", "202")(await parked.json())).toBe(true);

    const refused = await postJson(app, "/agentpos/cart", { items: [{ itemId: "rye-loaf", quantity: 1 }], buyer, shipping });
    expect(refused.status).toBe(403);
    expect(responseSchema("/agentpos/cart", "post", "403")(await refused.json())).toBe(true);
  });

  it("expired carts must be re-quoted (409)", async () => {
    let t = new Date("2026-09-16T10:00:00Z");
    const { app } = createFixtureStore({ baseUrl: BASE, now: () => t });
    const q = parseCartQuote(await (await postJson(app, "/agentpos/cart", { items: [{ itemId: "focaccia", quantity: 1 }], buyer, shipping })).json());
    t = new Date("2026-09-16T10:20:00Z");
    const res = await app.request(new URL(q.checkout).pathname + new URL(q.checkout).search, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CART_EXPIRED" } });
  });
});
