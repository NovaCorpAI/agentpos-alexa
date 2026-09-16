import { CatalogAgent } from "@agentpos-alexa/agents";
import { FakeModel } from "@agentpos-alexa/agents/testing";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createLogger, memorySink } from "../logging.js";
import { openStorage, type Storage } from "../storage/sqlite.js";
import { MCP_TOOL_NAMES } from "./server.js";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "test-bearer";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

describe("Store MCP server over Streamable HTTP", () => {
  let storage: Storage;
  let bridge: Hono;
  let client: Client;
  let logs: ReturnType<typeof memorySink>;
  let fixture: ReturnType<typeof createFixtureStore>;

  beforeEach(async () => {
    fixture = createFixtureStore({ baseUrl: STORE, policy: {} });
    storage = openStorage({ path: ":memory:" });
    logs = memorySink();
    const profile = await (await fixture.app.request("/.well-known/ucp")).json();
    storage.stores.register("bakery", parseStoreProfile(STORE, profile));
    bridge = createApp({
      storage,
      logger: createLogger(logs.sink),
      bridgeBaseUrl: BRIDGE,
      bearerToken: TOKEN,
      storeFetch: fetchInto(fixture.app),
    }) as unknown as Hono;
    client = new Client({ name: "test-host", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${BRIDGE}/stores/bakery/mcp`), {
        fetch: fetchInto(bridge),
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, "Request-Id": "trace-mcp-1" } },
      }),
    );
  });

  afterEach(async () => {
    await client.close();
    storage.close();
  });

  it("lists exactly the intent tools, each with a description and schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it("search_items speaks first and returns structured items with minor-unit prices", async () => {
    const res = await client.callTool({ name: "search_items", arguments: { query: "loaf", limit: 3 } });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text?: string }>)[0];
    expect(text?.type).toBe("text");
    expect(text?.text).toMatch(/^For loaf, I found/);
    const sc = res.structuredContent as { items: Array<{ id: string; price: { minor: string; display: string } }>; total: number };
    expect(sc.items.length).toBeLessThanOrEqual(3);
    expect(sc.items[0]?.price.minor).toMatch(/^[0-9]+$/);
    expect(sc.items[0]?.price.display).toMatch(/USDC$/);
  });

  it("search_items with no match lists what the store sells and says matched false", async () => {
    const res = await client.callTool({ name: "search_items", arguments: { query: "bread", limit: 5 } });
    expect(res.isError).toBeFalsy();
    expect((res.content as Array<{ text: string }>)[0]?.text).toMatch(/^I did not find anything for bread\. The store sells/);
    const sc = res.structuredContent as { matched: boolean; items: unknown[] };
    expect(sc.matched).toBe(false);
    expect(sc.items).toHaveLength(5);
  });

  it("get_item states the gluten fact from the catalog and fails typed on unknown ids", async () => {
    const gf = await client.callTool({ name: "get_item", arguments: { itemId: "gluten-free-loaf" } });
    expect((gf.content as Array<{ text: string }>)[0]?.text).toContain("It is gluten free.");
    const missing = await client.callTool({ name: "get_item", arguments: { itemId: "unicorn-cake" } });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
    expect((missing.content as Array<{ text: string }>)[0]?.text.length).toBeGreaterThan(0);
  });

  it("ask_catalog answers from the published attributes without a model and says when a fact is not published", async () => {
    const gf = await client.callTool({ name: "ask_catalog", arguments: { question: "Is the seeded loaf gluten free?" } });
    expect(gf.content[0]).toEqual({ type: "text", text: "Yes, Gluten-free seeded loaf is gluten free." });
    expect(gf.structuredContent).toMatchObject({ grounded: true, itemIds: ["gluten-free-loaf"], modelUsed: false, model: null });
    const organic = await client.callTool({ name: "ask_catalog", arguments: { question: "Is the seeded loaf organic?" } });
    expect((organic.content[0] as { text: string }).text).toMatch(/^The store has not published whether it is organic/);
    expect(organic.structuredContent).toMatchObject({ grounded: false });
    expect(storage.usageEvents.list({ source: "agent.catalog" })).toHaveLength(0);
  });

  it("ask_catalog with a model records one agent.catalog row with the model that answered", async () => {
    const model = new FakeModel([{ text: JSON.stringify({ answer: "Yes, the seeded loaf is gluten free.", grounded: true, itemIds: ["gluten-free-loaf"] }) }]);
    bridge = createApp({ storage, logger: createLogger(logs.sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, storeFetch: fetchInto(fixture.app), catalogAgent: new CatalogAgent({ model, modelId: "fake.fast" }) }) as unknown as Hono;
    const c2 = new Client({ name: "test-host", version: "0.0.0" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${BRIDGE}/stores/bakery/mcp`), { fetch: fetchInto(bridge), requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, "Request-Id": "trace-mcp-2" } } }));
    const res = await c2.callTool({ name: "ask_catalog", arguments: { question: "Is the seeded loaf gluten free?" } });
    expect(res.content[0]).toEqual({ type: "text", text: "Yes, the seeded loaf is gluten free." });
    expect(res.structuredContent).toMatchObject({ grounded: true, modelUsed: true, model: "fake.fast" });
    expect(storage.usageEvents.list({ source: "agent.catalog" })).toMatchObject([{ traceId: "trace-mcp-2", model: "fake.fast", storeOrigin: STORE }]);
    await c2.close();
  });

  it("get_policies reports payment, shipping and human review from what the Store publishes", async () => {
    const res = await client.callTool({ name: "get_policies", arguments: {} });
    expect(res.structuredContent).toMatchObject({
      payment: { handlers: ["x402-stellar"], network: "stellar:testnet", asset: "USDC" },
      fulfillment: { physicalGoods: true, shippingAddressRequired: true },
      orders: { createdOnlyAfterSettlement: true },
    });
  });

  it("start_checkout sums integers and hands off to the checkout service", async () => {
    const res = await client.callTool({
      name: "start_checkout",
      arguments: { items: [{ itemId: "sourdough-loaf", quantity: 2 }, { itemId: "baguette", quantity: 1 }] },
    });
    expect(res.isError).toBeFalsy();
    expect((res.content as Array<{ text: string }>)[0]?.text).toContain("Estimated total 15.8 USDC");
    expect(res.structuredContent).toMatchObject({
      checkout: {
        service: `${BRIDGE}/stores/bakery/checkout-sessions`,
        estimatedTotalMinor: "158000000",
        requiresShipping: true,
      },
    });
    const bad = await client.callTool({ name: "start_checkout", arguments: { items: [{ itemId: "nope", quantity: 1 }] } });
    expect(bad.isError).toBe(true);
  });

  it("get_order and get_receipt describe a settled order in the Store's words and label fixture receipts", async () => {
    const { app: fixtureApp } = fixture;
    const buyer = { email: "alex.demo@example.com", name: "Alex Demo" };
    const shipping = { name: "Alex Demo", line1: "1 Fixture Street", city: "Santiago", postalCode: "8320000", country: "CL" };
    const quote = (await (await fixtureApp.request("/agentpos/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ itemId: "baguette", quantity: 2 }], buyer, shipping }) })).json()) as { cartId: string };
    const paid = (await (await fixtureApp.request(`/agentpos/checkout?cart=${quote.cartId}`, { method: "POST", headers: { "Payment-Signature": "sig-1" } })).json()) as { orderId: string };

    const order = await client.callTool({ name: "get_order", arguments: { orderId: paid.orderId } });
    expect(order.isError).toBeFalsy();
    expect((order.content as Array<{ text: string }>)[0]?.text).toMatch(/^Order 1000 is paid: 2 Baguette\. Total 5\.6 USDC\./);
    expect(order.structuredContent).toMatchObject({ order: { orderId: paid.orderId, status: "paid", asset: "USDC", payment: { simulated: false, network: "stellar:testnet" } } });

    const receipt = await client.callTool({ name: "get_receipt", arguments: { orderId: paid.orderId } });
    expect((receipt.content as Array<{ text: string }>)[0]?.text).toMatch(/^This is a fixture receipt, unsigned\./);
    expect(receipt.structuredContent).toMatchObject({ receipt: { verification: { valid: true, mode: "fixture" }, receipts: [{ type: "order.paid", signed: false }] } });

    const missing = await client.callTool({ name: "get_order", arguments: { orderId: "ord_nope" } });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ error: { code: "ORDER_NOT_FOUND" } });
  });

  it("records one usage_events row per tool call with the trace id", async () => {
    await client.callTool({ name: "search_items", arguments: {} });
    const rows = storage.usageEvents.list({ source: "bridge.mcp" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.at(-1)).toMatchObject({ traceId: "trace-mcp-1", model: null, simulated: false, storeOrigin: STORE });
  });
});

describe("MCP endpoint auth", () => {
  it("answers 401 with a bearer challenge and reveals nothing about slugs", async () => {
    const storage = openStorage({ path: ":memory:" });
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN });
    const res = await bridge.request("/stores/whatever/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const wrong = await bridge.request("/stores/whatever/mcp", { method: "POST", headers: { Authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" });
    expect(wrong.status).toBe(401);
    storage.close();
  });
});

describe("MCP Apps views", () => {
  it("lists ui:// resources with the MCP Apps mime type, tools point at them, and the HTML is self-contained", async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    const storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const bridge = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    const client = new Client({ name: "test-host", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BRIDGE}/stores/bakery/mcp`), { fetch: fetchInto(bridge), requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));

    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["ui://agentpos-alexa/carousel.html", "ui://agentpos-alexa/item-card.html", "ui://agentpos-alexa/order-card.html", "ui://agentpos-alexa/receipt-card.html"]);
    expect(resources.every((r) => r.mimeType === "text/html;profile=mcp-app")).toBe(true);

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect((byName.get("search_items")?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe("ui://agentpos-alexa/carousel.html");
    expect((byName.get("get_item")?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe("ui://agentpos-alexa/item-card.html");
    for (const t of tools) {
      const uri = (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
      if (uri) expect(uris).toContain(uri);
    }

    const read = await client.readResource({ uri: "ui://agentpos-alexa/carousel.html" });
    const content = read.contents[0] as { text?: string; mimeType?: string; _meta?: { ui?: { csp?: { resourceDomains?: string[] } } } };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain('id="root"');
    expect(content.text).not.toMatch(/<script[^>]*src="https?:/);
    expect(content._meta?.ui?.csp?.resourceDomains).toEqual([STORE]);

    await client.close();
    storage.close();
  });
});
