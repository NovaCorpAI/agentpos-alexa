import { AgentPosStoreClient, StoreRequestError } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createFixtureStore } from "./app.js";

const BASE = "http://bakery.test";
const buyer = { email: "alex.demo@example.com", name: "Alex Demo" };
const shipping = { name: "Alex Demo", line1: "1 Fixture Street", city: "Santiago", postalCode: "8320000", country: "CL" };

/** Routes fetch(url, init) calls into the in-memory Hono app. */
function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

function clientFor(app: Hono) {
  return new AgentPosStoreClient(
    { origin: BASE, restBase: `${BASE}/agentpos` },
    { fetchImpl: fetchInto(app), traceId: "trace-rest-1" },
  );
}

describe("AgentPosStoreClient against the fixture bakery", () => {
  it("reads the catalog and one item", async () => {
    const { app } = createFixtureStore({ baseUrl: BASE });
    const client = clientFor(app);
    const cat = await client.catalog("sourdough");
    expect(cat.items.map((i) => i.id)).toEqual(["sourdough-loaf"]);
    expect((await client.item("baguette"))?.title).toBe("Baguette");
    expect(await client.item("nope")).toBeUndefined();
  });

  it("runs cart, challenge, payment, order and receipt end to end", async () => {
    const { app } = createFixtureStore({ baseUrl: BASE });
    const client = clientFor(app);
    const quote = await client.createCart({ items: [{ itemId: "sourdough-loaf", quantity: 2 }], buyer, shipping });
    expect(quote.quote.totalMinor).toBe("130000000");

    const challenge = await client.checkout(quote.cartId);
    expect(challenge.kind).toBe("payment_required");
    if (challenge.kind !== "payment_required") throw new Error("unreachable");
    expect(challenge.challenge.accepts[0]?.amount).toBe("130000000");

    const paid = await client.checkout(quote.cartId, "fixture-signed-payload");
    expect(paid.kind).toBe("paid");
    if (paid.kind !== "paid") throw new Error("unreachable");
    const order = await client.order(paid.result.orderId);
    expect(order.status).toBe("paid");
    const receipt = await client.receipt(paid.result.orderId);
    expect(receipt.receipts).toHaveLength(1);
  });

  it("maps Store refusals and validation to typed errors", async () => {
    const { app } = createFixtureStore({ baseUrl: BASE, policy: { refuseItemIds: ["rye-loaf"] } });
    const client = clientFor(app);
    await expect(client.createCart({ items: [{ itemId: "rye-loaf", quantity: 1 }], buyer, shipping })).rejects.toMatchObject({
      code: "STORE_REFUSED",
      status: 403,
    });
    await expect(client.createCart({ items: [{ itemId: "baguette", quantity: 1 }] })).rejects.toMatchObject({
      code: "STORE_VALIDATION",
      storeError: { code: "SHIPPING_REQUIRED" },
    });
    await expect(client.order("nope")).rejects.toBeInstanceOf(StoreRequestError);
    await expect(client.checkout("nope")).rejects.toMatchObject({ code: "STORE_REQUOTE" });
  });

  it("forwards the trace id as Request-Id", async () => {
    const { app } = createFixtureStore({ baseUrl: BASE });
    const seen: string[] = [];
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("Request-Id") ?? "");
      return app.fetch(new Request(input, init));
    }) as typeof fetch;
    const client = new AgentPosStoreClient({ origin: BASE, restBase: `${BASE}/agentpos` }, { fetchImpl: spy, traceId: "trace-xyz" });
    await client.health();
    expect(seen).toEqual(["trace-xyz"]);
  });
});
