import { createFixtureStore, type MerchantProcessor } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadUcpConformance } from "../checkout/conformance.js";
import type { CheckoutSession } from "../checkout/types.js";
import { createLogger, memorySink } from "../logging.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import { amazonRailsFromMode } from "./amazon-simulated.js";
import { merchantPspRail, MERCHANT_PSP_NAMESPACE } from "./merchant-psp.js";
import { RailRegistry } from "./rail.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "test-bearer";
const fetchInto = (app: Hono): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;

function fakeStripe(): MerchantProcessor & { tokens: string[] } {
  const tokens: string[] = [];
  return {
    psp: "stripe",
    environment: "sandbox",
    publishableKey: "pk_test_fixture",
    tokens,
    async charge(input) {
      tokens.push(input.token);
      return input.token === "pm_card_chargeDeclined" ? { status: "declined", code: "generic_decline", message: "Your card was declined." } : { status: "succeeded", reference: `pi_test_${input.idempotencyKey.slice(-6)}`, livemode: false };
    },
  };
}

describe("merchant PSP rail: the Store charges with its own processor, the Bridge forwards a token", () => {
  let storage: Storage;
  let app: Hono;
  let stripe: ReturnType<typeof fakeStripe>;
  const headers = (key?: string) => ({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) });

  const setup = async (withProcessor: boolean) => {
    stripe = fakeStripe();
    const fixture = createFixtureStore({ baseUrl: STORE, ...(withProcessor ? { processor: stripe } : {}) });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const rails = new RailRegistry().register(merchantPspRail);
    for (const r of amazonRailsFromMode("simulated")) rails.register(r);
    app = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
  };
  beforeEach(() => setup(true));
  afterEach(() => storage.close());

  const readySession = async (k: string) => {
    const body = { line_items: [{ item: { id: "sourdough-loaf" }, quantity: 2 }], buyer: { email: `${k}@example.com` }, context: { language: "en-US" } };
    const created = (await (await app.request("/stores/bakery/checkout-sessions", { method: "POST", headers: headers(`${k}-c`), body: JSON.stringify(body) })).json()) as CheckoutSession;
    const dest = { id: "d", street_address: "1 Fixture Street", address_locality: "Santiago", address_region: "RM", postal_code: "8320000", address_country: "CL" };
    const updated = await app.request(`/stores/bakery/checkout-sessions/${created.id}`, { method: "PUT", headers: headers(`${k}-u`), body: JSON.stringify({ ...body, fulfillment: { methods: [{ id: "s", type: "shipping", selected_destination_id: "d", line_item_ids: ["li_1"], destinations: [dest] }] } }) });
    return (await updated.json()) as CheckoutSession;
  };
  const complete = async (id: string, token: string, key: string) =>
    (await (await app.request(`/stores/bakery/checkout-sessions/${id}/complete`, { method: "POST", headers: headers(key), body: JSON.stringify({ payment: { instruments: [{ id: "instr_1", handler_id: "processor-tokenizer", type: "card", display: { brand: "visa", last_digits: "4242" }, credential: { type: "token", token } }] } }) })).json()) as CheckoutSession;

  it("declares the handler with the Store's public tokenizer config, first, and in test mode", async () => {
    const s = await readySession("decl");
    expect(Object.keys(s.ucp.payment_handlers)[0]).toBe(MERCHANT_PSP_NAMESPACE);
    expect(s.ucp.payment_handlers[MERCHANT_PSP_NAMESPACE]).toEqual([
      expect.objectContaining({ id: "processor-tokenizer", test_mode: true, config: { environment: "sandbox", psp: "stripe", publishable_key: "pk_test_fixture", currency: "usd" } }),
    ]);
    const profile = await (await app.request("/stores/bakery/.well-known/ucp")).text();
    expect(profile).toContain("pk_test_fixture");
    expect(profile).not.toMatch(/sk_(test|live)_/);
    expect(loadUcpConformance("2026-04-08").validate("shopping/checkout.json", s)).toMatchObject({ ok: true });
  });

  it("settles through the Store's charge, keeps the charge id as the settlement reference, and never stores the token", async () => {
    const s = await readySession("pay");
    expect(s.status).toBe("ready_for_complete");
    const declined = await complete(s.id, "pm_card_chargeDeclined", "k-declined");
    expect(declined.status).toBe("incomplete");
    expect(declined.messages[0]).toMatchObject({ type: "error", code: "payment_failed", content: "Your card was declined." });

    const done = await complete(s.id, "pm_card_visa", "k-paid");
    expect(done.status).toBe("completed");
    expect(done.order?.id).toMatch(/^ord_/);
    expect(done.messages).toEqual([]);
    expect(stripe.tokens).toEqual(["pm_card_chargeDeclined", "pm_card_visa"]);
    const stored = storage.checkout.get(s.id)!;
    expect(stored.internal.settlementReference).toMatch(/^pi_test_/);
    expect(JSON.stringify(stored)).not.toContain("pm_card_visa");
    expect(storage.usageEvents.list({ source: "bridge.checkout" }).at(-1)).toMatchObject({ paymentHandler: `${MERCHANT_PSP_NAMESPACE}/processor-tokenizer`, pspMode: "test_mode", simulated: false });

    const replay = await complete(s.id, "pm_card_visa", "k-paid-again");
    expect(replay.order?.id).toBe(done.order?.id);
    expect(stripe.tokens).toHaveLength(2);
  });

  it("is not offered for a Store that publishes no processor", async () => {
    storage.close();
    await setup(false);
    const s = await readySession("none");
    expect(Object.keys(s.ucp.payment_handlers)).not.toContain(MERCHANT_PSP_NAMESPACE);
  });
});
