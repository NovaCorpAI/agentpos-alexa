import { amazonRailsFromMode, createApp, createLogger, memorySink, merchantPspRail, openStorage, RailRegistry, type Storage } from "@agentpos-alexa/bridge";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScriptedRouterBrain } from "./agent/brain.js";
import { createSimulatorApp, type TurnResponse } from "./app.js";
import { BridgeCheckoutClient, BridgeClient } from "./bridge-client.js";
import { CheckoutFlow } from "./checkout.js";
import { InspectionLog } from "./inspection.js";
import { SqliteHouseholdMemory } from "./memory.js";
import { matchItem, route } from "./router.js";
import { SqliteWaitlist } from "./waitlist.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "sim-token";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

describe("scripted router", () => {
  const known = [
    { id: "sourdough-loaf", title: "Sourdough loaf" },
    { id: "gluten-free-loaf", title: "Gluten-free seeded loaf" },
  ];
  it("maps household phrases to one tool each", () => {
    expect(route("What bread do you have?", [])).toEqual({ tool: "search_items", arguments: { limit: 5 } });
    expect(route("Do you have croissants?", [])).toEqual({ tool: "search_items", arguments: { query: "croissants", limit: 5 } });
    expect(route("Do you deliver?", [])).toEqual({ tool: "get_policies", arguments: {} });
    expect(route("Tell me about the gluten-free seeded loaf", known)).toEqual({ tool: "get_item", arguments: { itemId: "gluten-free-loaf" } });
    expect(route("Is the sourdough loaf gluten free?", known)).toEqual({ tool: "ask_catalog", arguments: { question: "Is the sourdough loaf gluten free?" } });
    expect(route("Does the gluten-free seeded loaf contain nuts?", known)).toEqual({ tool: "ask_catalog", arguments: { question: "Does the gluten-free seeded loaf contain nuts?" } });
    expect(route("Is the seeded loaf organic?", known)).toEqual({ tool: "ask_catalog", arguments: { question: "Is the seeded loaf organic?" } });
    expect(route("Buy two sourdough loaf", known)).toEqual({ tool: "start_checkout", arguments: { items: [{ itemId: "sourdough-loaf", quantity: 2 }] } });
    expect(route("buy 3 croissants", known)).toEqual({ tool: "search_items", arguments: { query: "croissants", limit: 5 } });
    expect(route("Show my order", known, "ord_1")).toEqual({ tool: "get_order", arguments: { orderId: "ord_1" } });
    expect(route("Show me the receipt for order ord_abc", known)).toEqual({ tool: "get_receipt", arguments: { orderId: "ord_abc" } });
    expect(route("Show my order", known)).toMatchObject({ tool: null });
    expect(route("", [])).toMatchObject({ tool: null });
    expect(matchItem("seeded loaf", known)).toBe("gluten-free-loaf");
  });
});

describe("Simulator server against an in-memory Bridge and fixture bakery", () => {
  let storage: Storage;
  let sim: Hono;
  let inspection: InspectionLog;
  let memory: SqliteHouseholdMemory;
  let bridgeClient: BridgeClient;

  const post = (path: string, body: unknown) => sim.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const turn = async (text: string) => (await (await post("/api/turn", { addon: "bakery", text })).json()) as TurnResponse;

  beforeEach(async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const rails = new RailRegistry();
    for (const r of amazonRailsFromMode("simulated")) rails.register(r);
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    bridgeClient = new BridgeClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge));
    const checkout = new CheckoutFlow(new BridgeCheckoutClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge)));
    inspection = new InspectionLog(":memory:/never-written.json", "test");
    memory = new SqliteHouseholdMemory(":memory:");
    sim = createSimulatorApp({ bridge: bridgeClient, brain: new ScriptedRouterBrain(bridgeClient), checkout, inspection, memory });
  });
  afterEach(async () => {
    await bridgeClient.close();
    memory.close();
    storage.close();
  });

  it("remembers a completed order as references and reorders it on 'the same as last week'", async () => {
    expect((await turn("The same as last week")).speak[0]).toMatch(/do not have a previous order/);
    await turn("What bread do you have?");
    const started = await turn("Buy two sourdough loaf");
    await post(`/api/checkout/${started.checkout!.sessionId}/confirm`, { handlerId: "amazon_pay_network_token" });
    const remembered = await memory.recall("bakery");
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.lines).toEqual([{ itemId: "sourdough-loaf", title: "Sourdough loaf", quantity: 2 }]);
    expect(JSON.stringify(remembered)).not.toMatch(/alex|demo@|Fixture Street/i);
    const again = await turn("The same as last week");
    expect(again.checkout?.session.line_items.map((l) => [l.item.id, l.quantity])).toEqual([["sourdough-loaf", 2]]);
    expect(again.speak[0]).toContain("Your total is $13.00");
  });

  it("says a model rate limit plainly instead of blaming the store", async () => {
    const throttledBrain = { kind: "agent" as const, reset: () => undefined, turn: async () => { throw new Error("ModelError: Too many requests, please wait before trying again."); } };
    const sim2 = createSimulatorApp({ bridge: bridgeClient, brain: throttledBrain, checkout: new CheckoutFlow(new BridgeCheckoutClient({ url: BRIDGE, bearerToken: TOKEN })), inspection, memory });
    const res = await sim2.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addon: "bakery", text: "Buy one baguette" }) });
    expect(res.status).toBe(429);
    expect(((await res.json()) as TurnResponse).speak).toEqual(["I am getting too many requests right now. Please ask again in a few seconds."]);
  });

  it("lists the Bridge's Stores as Enabled add-ons", async () => {
    const body = (await (await sim.request("/api/addons")).json()) as { addons: Array<{ slug: string; mcp: string }> };
    expect(body.addons).toEqual([expect.objectContaining({ slug: "bakery", mcp: `${BRIDGE}/stores/bakery/mcp` })]);
  });

  it("runs a turn: speaks the tool's text, returns the view to render and records the inspection", async () => {
    const t = await turn("What bread do you have?");
    expect(t.speak[0]).toMatch(/^I found 5 items/);
    expect(t.view?.resourceUri).toBe("ui://agentpos-alexa/carousel.html");
    expect(t.toolCalls[0]?.name).toBe("search_items");

    const resource = (await (await sim.request(`/api/resource?addon=bakery&uri=${encodeURIComponent(t.view!.resourceUri)}`)).json()) as { html: string; mimeType: string };
    expect(resource.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.html).toContain('id="root"');

    const timing = await post(`/api/inspection/${t.turnId}`, { viewInitializedMs: 120, firstItemMs: 140, displayMode: "inline", component: "carousel" });
    expect(timing.status).toBe(200);
    const summary = (await (await sim.request("/api/inspection")).json()) as { totals: { turns: number; failedChecks: number }; turns: Array<{ checks: Record<string, boolean | null> }> };
    expect(summary.totals.turns).toBe(1);
    expect(summary.turns[0]?.checks).toEqual({ voiceFirst: true, carouselSizeOk: true, firstItemUnder500ms: true, typedErrors: true });
    expect(summary.totals.failedChecks).toBe(0);
  });

  it("resolves a follow-up about an item heard in the last search", async () => {
    await turn("any gluten-free bread?");
    const t = await turn("Is the gluten-free seeded loaf gluten free?");
    expect(t.speak[0]).toBe("Yes, Gluten-free seeded loaf is gluten free.");
    expect(t.view).toBeNull();
    const card = await turn("Tell me about the gluten-free seeded loaf");
    expect(card.speak[0]).toContain("It is gluten free.");
    expect(card.view?.resourceUri).toBe("ui://agentpos-alexa/item-card.html");
    const organic = await turn("Is the gluten-free seeded loaf organic?");
    expect(organic.speak[0]).toMatch(/^The store has not published whether it is organic/);
  });

  it("buys end to end with the host's checkout pattern, then shows the order and the receipt", async () => {
    await turn("What bread do you have?");
    const started = await turn("Buy two sourdough loaf");
    expect(started.checkout).not.toBeNull();
    expect(started.view).toBeNull();
    const c = started.checkout!;
    expect(c.session.status).toBe("ready_for_complete");
    expect(c.session.totals.at(-1)).toEqual({ type: "total", amount: 1300 });
    expect(started.speak[0]).toContain("Your total is $13.00");
    expect(c.options.filter((o) => o.available).map((o) => o.handlerId)).toEqual(["amazon_pay_network_token", "partner_card_on_file", "partner_card_on_file"]);
    expect(c.options.every((o) => o.simulated || !o.available)).toBe(true);
    expect(JSON.stringify(c)).not.toContain("encrypted");

    const done = (await (await post(`/api/checkout/${c.sessionId}/confirm`, { handlerId: "amazon_pay_network_token" })).json()) as TurnResponse;
    expect(done.checkout).toBeNull();
    expect(done.speak[0]).toMatch(/^Order placed\. This was a simulated payment/);
    expect(done.view?.resourceUri).toBe("ui://agentpos-alexa/order-card.html");
    expect(done.toolCalls[0]?.name).toBe("get_order");

    const order = await turn("Show my order");
    expect(order.view?.resourceUri).toBe("ui://agentpos-alexa/order-card.html");
    expect(order.speak[0]).toMatch(/^Order 1000 is paid: 2 Sourdough loaf/);
    const receipt = await turn("Show me the receipt");
    expect(receipt.view?.resourceUri).toBe("ui://agentpos-alexa/receipt-card.html");
    expect(receipt.speak[0]).toMatch(/fixture receipt, unsigned/);

    const declinedStart = await turn("Buy one baguette");
    const stored = (await (await post(`/api/checkout/${declinedStart.checkout!.sessionId}/confirm`, { handlerId: "partner_card_on_file", instrumentId: "pm_sim_visa_4242" })).json()) as TurnResponse;
    expect(stored.checkout).toBeNull();
    expect(stored.speak[0]).toMatch(/^Order placed/);

    const events = storage.usageEvents.list({ source: "bridge.checkout" });
    expect(events.map((e) => e.pspMode)).toEqual(["simulated", "simulated"]);
  });

  it("cancels a checkout", async () => {
    await turn("What bread do you have?");
    const started = await turn("Buy one baguette");
    const res = (await (await post(`/api/checkout/${started.checkout!.sessionId}/cancel`, {})).json()) as { speak: string[] };
    expect(res.speak[0]).toContain("Checkout canceled");
  });
});

describe("Public playground (#21)", () => {
  let storage: Storage;
  let sim: Hono;
  let bridgeClient: BridgeClient;
  let memory: SqliteHouseholdMemory;
  let waitlist: SqliteWaitlist;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => sim.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const turn = async (text: string) => (await (await post("/api/turn", { addon: "bakery", text })).json()) as TurnResponse;
  const stats = async () => (await (await sim.request("/api/stats")).json()) as { playground: boolean; purchases: { own: number; thirdParty: number }; waitlist: { merchants: number; shoppers: number } };

  beforeEach(async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const rails = new RailRegistry();
    for (const r of amazonRailsFromMode("simulated")) rails.register(r);
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    bridgeClient = new BridgeClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge));
    memory = new SqliteHouseholdMemory(":memory:");
    waitlist = new SqliteWaitlist(":memory:");
    sim = createSimulatorApp({
      bridge: bridgeClient,
      brain: new ScriptedRouterBrain(bridgeClient),
      checkout: new CheckoutFlow(new BridgeCheckoutClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge))),
      inspection: new InspectionLog(":memory:/never-written.json", "test"),
      memory,
      playground: { mandate: { maxTotalCents: 5000 }, waitlist, adminToken: "admin-test" },
    });
  });
  afterEach(async () => {
    await bridgeClient.close();
    memory.close();
    waitlist.close();
    storage.close();
  });

  it("counts a visitor's simulated purchase as third party and a Scene's as ours", async () => {
    expect(await stats()).toMatchObject({ playground: true, purchases: { own: 0, thirdParty: 0 } });
    await turn("What bread do you have?");
    const visitor = await turn("Buy one baguette");
    const done = (await (await post(`/api/checkout/${visitor.checkout!.sessionId}/confirm`, { handlerId: "amazon_pay_network_token" })).json()) as TurnResponse;
    expect(done.speak[0]).toMatch(/^Order placed\. This was a simulated payment/);
    expect((await stats()).purchases).toEqual({ own: 0, thirdParty: 1 });
    const scene = await turn("Buy one sourdough loaf");
    await post(`/api/checkout/${scene.checkout!.sessionId}/confirm`, { handlerId: "amazon_pay_network_token", scene: "first-voice-purchase" });
    expect((await stats()).purchases).toEqual({ own: 1, thirdParty: 1 });
  });

  it("refuses an order above the Demo household's mandate without reaching the Bridge", async () => {
    await turn("What bread do you have?");
    const big = await turn("Buy 6 cinnamon rolls, box of 4");
    expect(big.checkout?.session.totals.at(-1)?.amount).toBe(5880);
    const res = (await (await post(`/api/checkout/${big.checkout!.sessionId}/confirm`, { handlerId: "amazon_pay_network_token" })).json()) as TurnResponse;
    expect(res.speak[0]).toBe("That is above the demo household's limit of $50.00 per order. Try fewer items.");
    expect(res.checkout?.session.status).toBe("ready_for_complete");
    expect((await stats()).purchases).toEqual({ own: 0, thirdParty: 0 });
  });

  it("takes waitlist sign-ups with consent only, once per email, and exports them with the admin token", async () => {
    expect((await post("/api/waitlist", { email: "shop@example.com", role: "merchant" })).status).toBe(400);
    expect((await post("/api/waitlist", { email: "not-an-email", role: "merchant", consent: true })).status).toBe(400);
    expect((await post("/api/waitlist", { email: "Shop@Example.com", role: "merchant", storeUrl: "https://shop.example/products?x=1", consent: true })).status).toBe(201);
    expect((await post("/api/waitlist", { email: "shop@example.com", role: "merchant", consent: true })).status).toBe(201);
    expect((await post("/api/waitlist", { email: "buyer@example.com", role: "shopper", consent: true })).status).toBe(201);
    expect((await stats()).waitlist).toEqual({ merchants: 1, shoppers: 1 });
    expect((await sim.request("/api/waitlist/export")).status).toBe(403);
    const csv = await (await sim.request("/api/waitlist/export", { headers: { Authorization: "Bearer admin-test" } })).text();
    expect(csv.split("\r\n")[0]).toBe("email,role,store_url,at");
    expect(csv).toContain("shop@example.com,merchant,https://shop.example,");
    expect((await sim.request("/api/stats")).headers.get("content-type")).toMatch(/json/);
  });
});

describe("Merchant PSP on the playground (#9)", () => {
  it("offers the store's Stripe in test mode, lets the Demo household pay with the test card, and counts it", async () => {
    const charges: string[] = [];
    const fixture = createFixtureStore({ baseUrl: STORE, processor: { psp: "stripe", environment: "sandbox", publishableKey: "pk_test_fixture", charge: async (i) => (charges.push(`${i.token}:${i.amountCents}`), { status: "succeeded", reference: "pi_test_sim", livemode: false }) } });
    const storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const rails = new RailRegistry().register(merchantPspRail);
    for (const r of amazonRailsFromMode("simulated")) rails.register(r);
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, rails, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    const bridgeClient = new BridgeClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge));
    const memory = new SqliteHouseholdMemory(":memory:");
    const waitlist = new SqliteWaitlist(":memory:");
    const sim = createSimulatorApp({ bridge: bridgeClient, brain: new ScriptedRouterBrain(bridgeClient), checkout: new CheckoutFlow(new BridgeCheckoutClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge))), inspection: new InspectionLog(":memory:/never-written.json", "test"), memory, playground: { mandate: { maxTotalCents: 5000 }, waitlist } });
    const post = (path: string, body: unknown) => sim.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await post("/api/turn", { addon: "bakery", text: "What bread do you have?" });
    const t = (await (await post("/api/turn", { addon: "bakery", text: "Buy two sourdough loaf" })).json()) as TurnResponse;
    const stripeOption = t.checkout!.options[0]!;
    expect(stripeOption).toMatchObject({ namespace: "com.agentposhq.processor_tokenizer", testMode: true, simulated: false, available: true });
    expect(t.speak.at(-1)).toMatch(/Shall I pay with your Card through the store's Stripe \(test card 4242\), in test mode\?$/);
    const done = (await (await post(`/api/checkout/${t.checkout!.sessionId}/confirm`, { handlerId: stripeOption.handlerId })).json()) as TurnResponse;
    expect(done.speak[0]).toMatch(/^Order placed\. The store charged its Stripe account in test mode, no real money moved\./);
    expect(charges).toEqual(["pm_card_visa:1300"]);
    expect(((await (await sim.request("/api/stats")).json()) as { purchases: { thirdParty: number } }).purchases.thirdParty).toBe(1);
    await bridgeClient.close();
    memory.close();
    waitlist.close();
    storage.close();
  });
});
