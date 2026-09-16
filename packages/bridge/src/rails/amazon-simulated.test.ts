import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadUcpConformance, type Conformance } from "../checkout/conformance.js";
import type { CheckoutSession } from "../checkout/types.js";
import { createLogger, memorySink } from "../logging.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import { amazonRailsFromMode, SIMULATED_SAVED_CARDS } from "./amazon-simulated.js";
import { RailRegistry } from "./rail.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "t";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

const body = {
  line_items: [{ item: { id: "baguette" }, quantity: 2 }],
  buyer: { first_name: "Alex", last_name: "Demo", email: "alex.demo@example.com" },
  fulfillment: {
    methods: [{ id: "shipping_1", type: "shipping", selected_destination_id: "addr_001", line_item_ids: ["li_1"], destinations: [{ id: "addr_001", street_address: "1 Fixture Street", address_locality: "Santiago", postal_code: "8320000", address_country: "CL" }] }],
  },
};

const networkToken = (extra: Record<string, unknown> = {}) => ({
  payment: {
    instruments: [
      {
        id: "instr_1",
        handler_id: "amazon_pay_network_token",
        type: "card",
        billing_address: { street_address: "123 Main St", address_locality: "Anytown", address_region: "CA", address_country: "US", postal_code: "12345" },
        credential: { type: "encrypted_network_token", encrypted_token: "eyJ...", encrypted_cryptogram: "eyJ...", eci: "05", expiry_month: "09", expiry_year: "2028", ...extra },
        display: { brand: "visa", last_digits: "4242" },
      },
    ],
  },
});

describe("SIMULATED Amazon payment handlers", () => {
  let conformance: Conformance;
  let storage: Storage;
  let app: Hono;
  let logs: ReturnType<typeof memorySink>;

  beforeAll(() => {
    conformance = loadUcpConformance("2026-04-08");
  });
  beforeEach(async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    logs = memorySink();
    const rails = new RailRegistry();
    for (const r of amazonRailsFromMode("simulated")) rails.register(r);
    app = createApp({ storage, logger: createLogger(logs.sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
  });
  afterEach(() => storage.close());

  const headers = (key: string) => ({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": key });
  const post = async (path: string, b: unknown, key: string) => (await app.request(path, { method: "POST", headers: headers(key), body: JSON.stringify(b) })).json() as Promise<CheckoutSession>;

  it("declares both handlers in the profile and every session, labeled simulated, and offers fake saved cards", async () => {
    const profile = (await (await app.request("/stores/bakery/.well-known/ucp")).json()) as { ucp: { payment_handlers: Record<string, Array<Record<string, unknown>>> } };
    expect(profile.ucp.payment_handlers["com.amazon.payments.network_token"]?.[0]).toMatchObject({ id: "amazon_pay_network_token", version: "2026-04-08", simulated: true });
    expect(profile.ucp.payment_handlers["com.amazon.payments.stored_payment_method"]?.[0]).toMatchObject({ id: "partner_card_on_file", simulated: true });
    expect(JSON.stringify(profile)).toContain("SIMULATED");

    const s = await post("/stores/bakery/checkout-sessions", body, "a1");
    expect(s.status).toBe("ready_for_complete");
    expect(s.ucp.payment_handlers["com.amazon.payments.network_token"]?.[0]?.simulated).toBe(true);
    expect(s.payment?.instruments.map((i) => i.id)).toEqual(SIMULATED_SAVED_CARDS.map((c) => c.id));
    const r = conformance.validate("shopping/checkout.json", s);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("network token: completes through the simulated PSP with a labeled settlement reference", async () => {
    const s = await post("/stores/bakery/checkout-sessions", body, "n1");
    const done = await post(`/stores/bakery/checkout-sessions/${s.id}/complete`, networkToken(), "n2");
    expect(done.status).toBe("completed");
    expect(done.order?.id).toMatch(/^ord_/);
    expect(done.messages[0]).toMatchObject({ type: "info", code: "simulated_psp" });
    expect(done.messages[0]?.content).toContain("SIMULATED");
    expect(JSON.stringify(done)).not.toContain("encrypted_cryptogram");
    const ev = storage.usageEvents.list({ source: "bridge.checkout" })[0];
    expect(ev).toMatchObject({ simulated: true, pspMode: "simulated", paymentHandler: "com.amazon.payments.network_token/amazon_pay_network_token" });
    expect(storage.checkout.get(s.id)?.internal.settlementReference).toMatch(/^simulated:amazon:sim_ch_/);
    expect(logs.records.some((r) => r.msg === "simulated amazon settlement" && r.simulated === true)).toBe(true);
    const r = conformance.validate("shopping/checkout.json", done);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("network token: declines are 200 with payment_failed, bad credentials are typed", async () => {
    const s = await post("/stores/bakery/checkout-sessions", body, "d1");
    const declined = await post(`/stores/bakery/checkout-sessions/${s.id}/complete`, networkToken({ simulate: "decline" }), "d2");
    expect(declined.status).toBe("incomplete");
    expect(declined.messages[0]).toMatchObject({ type: "error", code: "payment_failed", severity: "recoverable" });
    expect(declined.messages[0]?.content).toContain("SIMULATED");
    const bad = await post(`/stores/bakery/checkout-sessions/${s.id}/complete`, { payment: { instruments: [{ id: "i", handler_id: "amazon_pay_network_token", type: "card", credential: { type: "card", number: "4242" } }] } }, "d3");
    expect(bad.messages[0]).toMatchObject({ code: "invalid_credential" });
  });

  it("stored payment method: accepts an offered card, refuses an unknown one", async () => {
    const s = await post("/stores/bakery/checkout-sessions", body, "s1");
    const ok = await post(`/stores/bakery/checkout-sessions/${s.id}/complete`, { payment: { instruments: [{ id: "instr_2", handler_id: "partner_card_on_file", type: "card", credential: { type: "payment_method_reference", payment_method_id: "pm_sim_visa_4242" } }] } }, "s2");
    expect(ok.status).toBe("completed");
    const s2 = await post("/stores/bakery/checkout-sessions", body, "s3");
    const no = await post(`/stores/bakery/checkout-sessions/${s2.id}/complete`, { payment: { instruments: [{ id: "instr_3", handler_id: "partner_card_on_file", type: "card", credential: { type: "payment_method_reference", payment_method_id: "pm_someone_else" } }] } }, "s4");
    expect(no.status).toBe("incomplete");
    expect(no.messages[0]).toMatchObject({ code: "payment_failed" });
  });

  it("cannot be configured into a real PSP", () => {
    expect(amazonRailsFromMode("off")).toEqual([]);
    expect(amazonRailsFromMode(undefined)).toEqual([]);
    expect(() => amazonRailsFromMode("live")).toThrow(/simulated only/);
    expect(() => amazonRailsFromMode("real")).toThrow();
  });
});
