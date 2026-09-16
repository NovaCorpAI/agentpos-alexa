import { OnboardingAgent } from "@agentpos-alexa/agents";
import { FakeModel } from "@agentpos-alexa/agents/testing";
import { BAKERY_ITEMS, createFixtureStore } from "@agentpos-alexa/fixture-store";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { CheckoutSession } from "../checkout/types.js";
import { createLogger, memorySink } from "../logging.js";
import { RailRegistry, type PaymentRail } from "../rails/rail.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import type { OnboardingState } from "./service.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "test-bearer";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

const rail: PaymentRail = {
  namespace: "test.rail",
  id: "test-rail",
  version: "2026-04-08",
  availableInstruments: [{ type: "card" }],
  pspMode: "simulated",
  supports: () => true,
  async settle({ storeClient, internal }) {
    const outcome = await storeClient.checkout(internal.cartId!, `test-signature:${internal.cartId}`);
    if (outcome.kind !== "paid") throw new Error("unexpected");
    const order = await storeClient.order(outcome.result.orderId);
    return { kind: "settled", settlementReference: String((order.payment as { txHash: string }).txHash), storeOrderId: order.orderId, permalinkUrl: `${STORE}/orders/${order.orderId}`, simulated: true };
  },
};

describe("Onboarding: URL to Voice overlay, confirmed by a human, timed in usage_events", () => {
  let storage: Storage;
  let app: Hono;
  let fixture: ReturnType<typeof createFixtureStore>;
  let clock: Date;
  let model: FakeModel;
  let items: typeof BAKERY_ITEMS;

  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Request-Id": "trace-onb" };
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const get = (path: string) => app.request(path, { headers });

  beforeEach(async () => {
    clock = new Date("2026-09-16T10:00:00Z");
    items = structuredClone(BAKERY_ITEMS);
    fixture = createFixtureStore({ baseUrl: STORE, policy: {}, now: () => clock, items });
    storage = openStorage({ path: ":memory:" });
    model = new FakeModel([
      {
        text: JSON.stringify({
          overlay: [{ itemId: "gluten-free-loaf", spokenName: "Seeded gluten free loaf", summary: "A buckwheat and sunflower loaf from a dedicated gluten-free oven.", synonyms: ["seeded loaf", "gf loaf"] }],
          policies: { voiceIntro: "Sourdough and Co bakes every morning.", deliveryNote: "Orders are delivered; the checkout asks for an address.", reviewNote: "The bakery may review an order first; nothing is charged until then." },
        }),
      },
    ]);
    app = createApp({
      storage,
      logger: createLogger(memorySink().sink),
      bridgeBaseUrl: BRIDGE,
      bearerToken: TOKEN,
      rails: new RailRegistry().register(rail),
      onboardingAgent: new OnboardingAgent({ model, modelId: "fake.strong" }),
      storeFetch: fetchInto(fixture.app),
      now: () => clock,
    }) as unknown as Hono;
  });
  afterEach(() => storage.close());

  const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));

  it("scans, drafts with the model, publishes what the Merchant edited, times every stage, and serves the overlay", async () => {
    expect((await get("/onboarding/bakery-test")).status).toBe(404);

    const scanned = await post("/onboarding/scan", { storeUrl: STORE });
    expect(scanned.status).toBe(201);
    const draft = (await scanned.json()) as OnboardingState;
    expect(draft).toMatchObject({ slug: "bakery-test", origin: STORE, status: "draft", modelUsed: true });
    expect(draft.overlay).toHaveLength(items.length);
    expect(draft.overlay.find((o) => o.itemId === "gluten-free-loaf")).toMatchObject({ spokenName: "Seeded gluten free loaf", synonyms: ["seeded loaf", "gf loaf"] });
    expect(draft.overlay.find((o) => o.itemId === "oat-cookies-6")).toMatchObject({ spokenName: "Oat cookies" });
    expect(draft.policies?.voiceIntro).toMatch(/every morning/);
    expect(draft.stages).toMatchObject({ scan: clock.toISOString(), catalog_draft: clock.toISOString(), policies_draft: clock.toISOString() });
    expect(draft.elapsedMs).toEqual({ scanToPublished: null, scanToFirstVoicePurchase: null });
    expect(JSON.stringify(model.calls[0]!.messages)).toContain("physicalGoods");
    const rows = storage.usageEvents.list({ source: "agent.onboarding" });
    expect(rows.map((r) => [r.onboardingStage, r.model])).toEqual([["scan", null], ["catalog_draft", "fake.strong"], ["policies_draft", null]]);

    // Before publication the tools speak the Store's own titles.
    const mcp = new Client({ name: "t", version: "0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BRIDGE}/stores/bakery-test/mcp`), { fetch: fetchInto(app), requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
    const before = await mcp.callTool({ name: "get_item", arguments: { itemId: "gluten-free-loaf" } });
    expect((before.content[0] as { text: string }).text).toMatch(/^Gluten-free seeded loaf,/);

    // The Merchant edits one line and confirms 9 minutes later.
    tick(9 * 60_000);
    const edited = draft.overlay.map((o) => (o.itemId === "sourdough-loaf" ? { ...o, spokenName: "Sourdough", synonyms: ["masa madre"] } : o));
    const published = (await (await post("/onboarding/bakery-test/confirm", { overlay: edited, policies: draft.policies })).json()) as OnboardingState;
    expect(published.status).toBe("published");
    expect(published.elapsedMs.scanToPublished).toBe(9 * 60_000);
    expect(published.stages.human_confirm).toBe(clock.toISOString());
    expect(published.stale).toEqual([]);

    // Published: spoken names replace titles, synonyms reach ask_catalog.
    const after = await mcp.callTool({ name: "get_item", arguments: { itemId: "gluten-free-loaf" } });
    expect((after.content[0] as { text: string }).text).toMatch(/^Seeded gluten free loaf,/);
    const ask = await mcp.callTool({ name: "ask_catalog", arguments: { question: "Is the masa madre gluten free?" } });
    expect((ask.content[0] as { text: string }).text).toBe("No, Sourdough contains gluten.");

    // The first settled order after publication closes the timer, once.
    tick(60_000);
    const createRes = await app.request("/stores/bakery-test/checkout-sessions", { method: "POST", headers: { ...headers, "Idempotency-Key": "k1" }, body: JSON.stringify({ line_items: [{ item: { id: "sourdough-loaf" }, quantity: 1 }], buyer: { email: "a@b.c" }, context: { language: "en-US" } }) });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CheckoutSession;
    await app.request(`/stores/bakery-test/checkout-sessions/${created.id}`, {
      method: "PUT",
      headers: { ...headers, "Idempotency-Key": "u1" },
      body: JSON.stringify({ line_items: [{ item: { id: "sourdough-loaf" }, quantity: 1 }], buyer: { email: "a@b.c" }, context: { language: "en-US" }, fulfillment: { methods: [{ id: "s", type: "shipping", selected_destination_id: "d", line_item_ids: ["li_1"], destinations: [{ id: "d", street_address: "1 Fixture Street", address_locality: "Santiago", address_region: "RM", postal_code: "8320000", address_country: "CL" }] }] } }),
    });
    const done = await app.request(`/stores/bakery-test/checkout-sessions/${created.id}/complete`, { method: "POST", headers: { ...headers, "Idempotency-Key": "c1" }, body: JSON.stringify({ payment: { instruments: [{ id: "i", handler_id: "test-rail", type: "card", credential: { type: "test" } }] } }) });
    expect(((await done.json()) as CheckoutSession).status).toBe("completed");
    const timed = (await (await get("/onboarding/bakery-test")).json()) as OnboardingState;
    expect(timed.elapsedMs.scanToFirstVoicePurchase).toBe(10 * 60_000);
    expect(storage.usageEvents.list({ source: "agent.onboarding" }).filter((r) => r.onboardingStage === "first_voice_purchase")).toHaveLength(1);

    // The Store changes an item: its line goes stale and the tool speaks the Store's words again.
    items.find((it) => it.id === "gluten-free-loaf")!.description += " Now with more seeds.";
    const stale = (await (await get("/onboarding/bakery-test")).json()) as OnboardingState;
    expect(stale.stale).toEqual(["gluten-free-loaf"]);
    const again = await mcp.callTool({ name: "get_item", arguments: { itemId: "gluten-free-loaf" } });
    expect((again.content[0] as { text: string }).text).toMatch(/^Gluten-free seeded loaf,/);
    await mcp.close();
  });

  it("refuses a confirm without a draft and a scan without a URL", async () => {
    expect((await post("/onboarding/scan", {})).status).toBe(400);
    storage.stores.register("bakery-test", { origin: STORE, ucpVersion: "2026-08-25", restBase: `${STORE}/agentpos`, mcpEndpoint: `${STORE}/agentpos/mcp`, paymentHandlers: [], profile: null });
    const res = await post("/onboarding/bakery-test/confirm", { overlay: [], policies: { voiceIntro: "", deliveryNote: "", reviewNote: "" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NO_DRAFT" });
  });
});
