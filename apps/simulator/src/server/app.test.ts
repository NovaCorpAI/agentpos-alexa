import { amazonRailsFromMode, createApp, createLogger, memorySink, openStorage, RailRegistry, type Storage } from "@agentpos-alexa/bridge";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSimulatorApp, type TurnResponse } from "./app.js";
import { BridgeCheckoutClient, BridgeClient } from "./bridge-client.js";
import { CheckoutFlow } from "./checkout.js";
import { InspectionLog } from "./inspection.js";
import { matchItem, route } from "./router.js";

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
    expect(route("Is the sourdough loaf gluten free?", known)).toEqual({ tool: "get_item", arguments: { itemId: "sourdough-loaf" } });
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
    sim = createSimulatorApp({ bridge: bridgeClient, checkout, inspection });
  });
  afterEach(async () => {
    await bridgeClient.close();
    storage.close();
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
    expect(t.speak[0]).toContain("It is gluten free.");
    expect(t.view?.resourceUri).toBe("ui://agentpos-alexa/item-card.html");
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
