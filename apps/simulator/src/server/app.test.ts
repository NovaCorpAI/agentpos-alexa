import { createApp, createLogger, memorySink, openStorage, type Storage } from "@agentpos-alexa/bridge";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSimulatorApp } from "./app.js";
import { BridgeClient } from "./bridge-client.js";
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
    expect(route("", [])).toMatchObject({ tool: null });
    expect(matchItem("seeded loaf", known)).toBe("gluten-free-loaf");
  });
});

describe("Simulator server against an in-memory Bridge and fixture bakery", () => {
  let storage: Storage;
  let sim: Hono;
  let inspection: InspectionLog;
  let bridgeClient: BridgeClient;

  beforeEach(async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    bridgeClient = new BridgeClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(bridge));
    inspection = new InspectionLog(":memory:/never-written.json", "test");
    sim = createSimulatorApp({ bridge: bridgeClient, inspection });
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
    const res = await sim.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addon: "bakery", text: "What bread do you have?" }) });
    expect(res.status).toBe(200);
    const turn = (await res.json()) as { turnId: string; speak: string[]; view: { resourceUri: string } | null; toolCalls: Array<{ name: string; latencyMs: number }> };
    expect(turn.speak[0]).toMatch(/^I found 5 items/);
    expect(turn.view?.resourceUri).toBe("ui://agentpos-alexa/carousel.html");
    expect(turn.toolCalls[0]?.name).toBe("search_items");

    const resource = (await (await sim.request(`/api/resource?addon=bakery&uri=${encodeURIComponent(turn.view!.resourceUri)}`)).json()) as { html: string; mimeType: string };
    expect(resource.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.html).toContain('id="root"');

    const timing = await sim.request(`/api/inspection/${turn.turnId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewInitializedMs: 120, firstItemMs: 140, displayMode: "inline", component: "carousel" }) });
    expect(timing.status).toBe(200);
    const summary = (await (await sim.request("/api/inspection")).json()) as { totals: { turns: number; failedChecks: number }; turns: Array<{ checks: Record<string, boolean | null> }> };
    expect(summary.totals.turns).toBe(1);
    expect(summary.turns[0]?.checks).toEqual({ voiceFirst: true, carouselSizeOk: true, firstItemUnder500ms: true, typedErrors: true });
    expect(summary.totals.failedChecks).toBe(0);
  });

  it("resolves a follow-up about an item heard in the last search", async () => {
    await sim.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addon: "bakery", text: "any gluten-free bread?" }) });
    const res = await sim.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addon: "bakery", text: "Is the gluten-free seeded loaf gluten free?" }) });
    const turn = (await res.json()) as { speak: string[]; view: { resourceUri: string } | null };
    expect(turn.speak[0]).toContain("It is gluten free.");
    expect(turn.view?.resourceUri).toBe("ui://agentpos-alexa/item-card.html");
  });
});
