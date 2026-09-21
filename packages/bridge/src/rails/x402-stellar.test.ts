import { createFixtureStore, type StellarRail } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { CheckoutSession } from "../checkout/types.js";
import { createLogger, memorySink } from "../logging.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import { RailRegistry } from "./rail.js";
import { x402StellarRail, X402_NAMESPACE } from "./x402-stellar.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "test-bearer";
const TX = "c80f8d33147b0d06f54c9acd2b7ea6e6fcedb432febc3cac7e5dc450851acf9d";
const fetchInto = (app: Hono): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;

/**
 * A Store that settles, without a network: the protocol's shapes, our own answers. What the
 * live testnet proves is in scripts/x402-testnet.mjs; what this proves is the wiring.
 */
function fakeRail(): StellarRail & { signed: unknown[] } {
  const signed: unknown[] = [];
  return {
    network: "stellar:testnet",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    payTo: "GDF4SYP2HNHQWSNYPVFJ762AKXVKQBLOWDVHCYCF27HCPRBVCWHL7QQS",
    signed,
    async requirements(amountMinor) {
      return [{ scheme: "exact", network: "stellar:testnet", amount: amountMinor, asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", payTo: "GDF4SYP2HNHQWSNYPVFJ762AKXVKQBLOWDVHCYCF27HCPRBVCWHL7QQS" }];
    },
    async verify(payload) {
      signed.push(payload);
      return { isValid: (payload as { signature?: string }).signature === "good", invalidReason: "the authorisation does not match this cart" };
    },
    async settle() {
      return { success: true, transaction: TX };
    },
  };
}

describe("x402 on Stellar: the household's wallet pays the Store, the Bridge carries the payload", () => {
  let storage: Storage;
  let app: Hono;
  let rail: ReturnType<typeof fakeRail>;
  const headers = (key?: string) => ({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) });

  const setup = async (settles: boolean) => {
    rail = fakeRail();
    const fixture = createFixtureStore({ baseUrl: STORE, ...(settles ? { stellar: rail } : {}) });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const rails = new RailRegistry().register(x402StellarRail);
    app = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
  };

  const DESTINATION = { id: "addr_demo_home", street_address: "1 Fixture Street", address_locality: "Santiago", address_region: "RM", postal_code: "8320000", address_country: "CL" };

  /** A session with an address, which is what makes the Store quote a cart to be paid for. */
  const session = async (): Promise<CheckoutSession> => {
    const created = await app.request("/stores/bakery/checkout-sessions", {
      method: "POST",
      headers: headers("create-1"),
      body: JSON.stringify({ line_items: [{ item: { id: "focaccia" }, quantity: 1 }], buyer: { email: "alex.demo@example.com" } }),
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as CheckoutSession;
    const updated = await app.request(`/stores/bakery/checkout-sessions/${first.id}`, {
      method: "PUT",
      headers: headers("update-1"),
      body: JSON.stringify({
        line_items: first.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
        buyer: { email: "alex.demo@example.com" },
        fulfillment: { methods: [{ id: "shipping_1", type: "shipping", selected_destination_id: DESTINATION.id, line_item_ids: first.line_items.map((l) => l.id), destinations: [DESTINATION] }] },
      }),
    });
    expect(updated.status).toBe(200);
    return (await updated.json()) as CheckoutSession;
  };

  beforeEach(() => undefined);
  afterEach(() => storage?.close());

  it("can be chosen only when the Store says it settles, and then says what a wallet needs", async () => {
    // A Store that cannot settle still publishes the handler; what it cannot do is be paid
    // through this Bridge, so the session it opens does not offer the rail at all.
    await setup(false);
    const quiet = await session();
    expect(quiet.ucp.payment_handlers[X402_NAMESPACE]).toBeUndefined();

    await setup(true);
    const served = await session();
    const declaration = (served.ucp.payment_handlers[X402_NAMESPACE] as Array<{ config: Record<string, unknown>; test_mode: boolean }> | undefined)?.[0];
    expect(declaration?.config).toMatchObject({ protocol: "x402", scheme: "exact", network: "stellar:testnet", payTo: rail.payTo, settles: true });
    expect(declaration?.test_mode).toBe(true);
  });

  it("hands the Store's own challenge to the host, which is where the wallet lives", async () => {
    await setup(true);
    const created = await session();
    const res = await app.request(`/stores/bakery/checkout-sessions/${created.id}/payment-required`, { method: "POST", headers: headers() });
    expect(res.status).toBe(200);
    const challenge = (await res.json()) as { x402Version: number; accepts: Array<{ amount: string; payTo: string }> };
    expect(challenge.x402Version).toBe(2);
    expect(challenge.accepts[0]).toMatchObject({ amount: "55000000", payTo: rail.payTo });
  });

  it("settles with the transaction the network recorded, and refuses anything that is not a signed payload", async () => {
    await setup(true);
    const created = await session();

    const wrong = await app.request(`/stores/bakery/checkout-sessions/${created.id}/complete`, {
      method: "POST",
      headers: headers("complete-wrong"),
      body: JSON.stringify({ payment: { instruments: [{ id: "i1", handler_id: "x402-stellar", type: "stellar_wallet", credential: { type: "token", token: "pm_card_visa" } }] } }),
    });
    const refused = (await wrong.json()) as CheckoutSession;
    expect(refused.status).toBe("incomplete");
    expect(refused.messages.some((m) => m.type === "error")).toBe(true);
    expect(refused.order).toBeUndefined();

    const paid = await app.request(`/stores/bakery/checkout-sessions/${created.id}/complete`, {
      method: "POST",
      headers: headers("complete-good"),
      body: JSON.stringify({ payment: { instruments: [{ id: "i2", handler_id: "x402-stellar", type: "stellar_wallet", credential: { type: "x402_payload", payload: { signature: "good" } } }] } }),
    });
    const settled = (await paid.json()) as CheckoutSession;
    expect(settled.status).toBe("completed");
    expect(settled.order?.id).toMatch(/^ord_/);
    // The order is idempotent by what the network recorded, not by anything we invented.
    const stored = storage.checkout.get(settled.id);
    expect(stored?.internal.settlementReference).toBe(TX);
  });
});
