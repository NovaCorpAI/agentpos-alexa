/**
 * The MCP server Alexa+ talks to, one per Store, built per request (stateless Streamable
 * HTTP). Four tools, one customer intent each (docs/ALEXA-MCP-DESIGN.md):
 *
 *   search_items    find things to buy                       -> carousel (MCP Apps view)
 *   get_item        one item in detail, voice-ready           -> item card
 *   get_policies    what the Store publishes about payment, shipping and human review
 *   start_checkout  hand the chosen lines to the UCP checkout pattern (#7)
 *
 * Every result puts the spoken text first, then structured content. Every failure is a
 * typed error { code, message, hint } with isError, never an empty result.
 */
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { APP_VIEWS, registerAppViews } from "./apps/index.js";
import { z } from "zod";
import { AgentPosStoreClient, StoreRequestError, type CatalogItem } from "@agentpos-alexa/store-client";
import type { Logger } from "../logging.js";
import type { RegisteredStore } from "../storage/store-registry.js";
import type { NewUsageEvent } from "../storage/usage-events-repo.js";
import { BRIDGE_VERSION } from "../versions.js";
import type { CheckoutRepo } from "../storage/checkout-store.js";
import { loadOrderView, loadReceiptView } from "./orders.js";
import { speakItemDetail, speakOrder, speakPrice, speakReceipt, speakSearch } from "./voice.js";

export interface StoreMcpDeps {
  store: RegisteredStore;
  client: AgentPosStoreClient;
  /** Public base URL of this Bridge, for the checkout handoff. */
  bridgeBaseUrl: string;
  traceId: string;
  log: Logger;
  record: (event: NewUsageEvent) => void;
  /** The Bridge's own checkout sessions, to say how an order was paid. */
  checkout: CheckoutRepo;
}

export const MCP_TOOL_NAMES = ["search_items", "get_item", "get_policies", "start_checkout", "get_order", "get_receipt"] as const;

/** Wire shape of an item in structured content: minor units as strings, never floats. */
export interface ItemView {
  id: string;
  title: string;
  description: string;
  price: { minor: string; asset: string; display: string };
  imageUrl?: string;
  physical: boolean;
  attributes: Record<string, unknown>;
}

export function itemView(it: CatalogItem): ItemView {
  const v: ItemView = {
    id: it.id,
    title: it.title,
    description: it.description,
    price: { minor: it.price.minor, asset: it.price.asset, display: speakPrice(it.price.minor, it.price.asset) },
    physical: it.physical,
    attributes: it.attributes ?? {},
  };
  if (it.imageUrl) v.imageUrl = it.imageUrl;
  return v;
}

function ok(voice: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: voice }], structuredContent: structured };
}

function fail(code: string, message: string, hint: string, voice: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: voice }],
    structuredContent: { error: { code, message, hint } },
  };
}

function fromStoreError(e: unknown): CallToolResult {
  if (e instanceof StoreRequestError) {
    const voice =
      e.code === "STORE_UNREACHABLE"
        ? "The store is not answering right now. Please try again in a moment."
        : e.code === "STORE_REFUSED"
          ? "The store declined that request."
          : "The store answered in a way I could not use.";
    return fail(e.code, e.message, e.hint, voice);
  }
  throw e;
}

const SearchInput = z.object({
  query: z.string().max(200).optional().describe("Free text over titles and descriptions. Omit to list the catalog."),
  limit: z.number().int().min(1).max(5).optional().describe("Items to return, 1 to 5 (carousel size). Default 5."),
});

const GetItemInput = z.object({
  itemId: z.string().min(1).describe("Item id from search_items."),
});

const OrderInput = z.object({
  orderId: z.string().min(1).describe("Order id returned by the store at checkout completion."),
});

const StartCheckoutInput = z.object({
  items: z
    .array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(20)
    .describe("The lines the customer wants to buy."),
  note: z.string().max(500).optional().describe("Free text for the merchant, passed verbatim. Never changes the price."),
});

export function createStoreMcpServer(deps: StoreMcpDeps): McpServer {
  const { store, client, log } = deps;
  const server = new McpServer(
    { name: `agentpos-alexa:${store.slug}`, version: BRIDGE_VERSION },
    { instructions: `Shopping assistant for ${storeName(store)}. Prices are exact and come from the store. Never invent price, stock or ingredients.` },
  );

  const timed = async (tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    const started = performance.now();
    let result: CallToolResult;
    try {
      result = await run();
    } catch (e) {
      result = fromStoreError(e);
    }
    const latencyMs = Math.round(performance.now() - started);
    deps.record({
      traceId: deps.traceId,
      source: "bridge.mcp",
      storeOrigin: store.origin,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      estimatedCostUsdMicros: 0,
      simulated: false,
    });
    log.log("info", "mcp tool", { tool, latencyMs, isError: result.isError === true });
    return result;
  };

  registerAppViews(server, { imageOrigins: [store.origin] });

  registerAppTool(
    server,
    "search_items",
    {
      title: "Search items",
      description: `Find items to buy at ${storeName(store)}. Call when the customer asks what is available or names something to buy. Returns up to 5 items with exact prices, ready for a carousel.`,
      inputSchema: SearchInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: APP_VIEWS.carousel.uri } },
    },
    async ({ query, limit }) =>
      timed("search_items", async () => {
        const catalog = await client.catalog(query);
        const items = catalog.items.slice(0, limit ?? 5);
        return ok(speakSearch(items, query), {
          query: query ?? null,
          total: catalog.items.length,
          items: items.map(itemView),
          store: { name: catalog.site.name, url: catalog.site.url },
        });
      }),
  );

  registerAppTool(
    server,
    "get_item",
    {
      title: "Get item",
      description: "One item in detail: description, price and the attributes the store publishes (allergens, gluten, weight). Call before answering a question about a specific item.",
      inputSchema: GetItemInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: APP_VIEWS["item-card"].uri } },
    },
    async ({ itemId }) =>
      timed("get_item", async () => {
        const it = await client.item(itemId);
        if (!it) {
          return fail("ITEM_NOT_FOUND", `No item ${itemId} at ${store.origin}`, "Use an id returned by search_items.", "I could not find that item in the store's catalog.");
        }
        return ok(speakItemDetail(it), { item: itemView(it) });
      }),
  );

  server.registerTool(
    "get_policies",
    {
      title: "Get store policies",
      description: "What the store publishes about payment, delivery and human review. Call before promising delivery or a payment method.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      timed("get_policies", async () => {
        const catalog = await client.catalog();
        const physical = catalog.items.some((it) => it.physical);
        const policies = {
          store: { name: catalog.site.name, url: catalog.site.url },
          payment: {
            handlers: store.paymentHandlers,
            protocol: catalog.payment.protocol,
            network: catalog.payment.network,
            asset: catalog.payment.asset,
          },
          fulfillment: {
            physicalGoods: physical,
            shippingAddressRequired: physical,
          },
          review: {
            merchantMayReview: true,
            note: "The merchant can park an order for human approval; the customer is told to wait, nothing is charged.",
          },
          orders: { createdOnlyAfterSettlement: true },
        };
        const voice = `${catalog.site.name} accepts ${catalog.payment.asset} on ${catalog.payment.network}. ${
          physical ? "Items are delivered, so a delivery address is needed at checkout." : "Items are digital."
        } The merchant may hold an order for a human check before it is confirmed.`;
        return ok(voice, policies);
      }),
  );

  server.registerTool(
    "start_checkout",
    {
      title: "Start checkout",
      description: "Hand the chosen lines to checkout. Call once the customer has confirmed what to buy. Returns the estimated total and the checkout service to open a checkout session; the exact total comes from that session.",
      inputSchema: StartCheckoutInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ items, note }) =>
      timed("start_checkout", async () => {
        const catalog = await client.catalog();
        const byId = new Map(catalog.items.map((it) => [it.id, it]));
        const missing = items.filter((l) => !byId.has(l.itemId)).map((l) => l.itemId);
        if (missing.length) {
          return fail("ITEM_NOT_FOUND", `Unknown items: ${missing.join(", ")}`, "Use ids returned by search_items.", "One of those items is not in the store's catalog.");
        }
        let total = 0n;
        let requiresShipping = false;
        const lineItems = items.map((l) => {
          const it = byId.get(l.itemId)!;
          const unit = BigInt(it.price.minor);
          total += unit * BigInt(l.quantity);
          requiresShipping = requiresShipping || it.physical;
          return { itemId: it.id, title: it.title, quantity: l.quantity, unitPriceMinor: it.price.minor, asset: it.price.asset };
        });
        const asset = catalog.payment.asset;
        const spoken = lineItems.map((l) => `${l.quantity} ${l.title}`).join(", ");
        const voice = `${spoken}. Estimated total ${speakPrice(total.toString(), asset)}.${
          requiresShipping ? " I will need a delivery address to confirm the exact total." : ""
        }`;
        return ok(voice, {
          checkout: {
            service: `${deps.bridgeBaseUrl}/stores/${store.slug}/checkout-sessions`,
            lineItems,
            note: note ?? null,
            estimatedTotalMinor: total.toString(),
            asset,
            requiresShipping,
          },
        });
      }),
  );

  registerAppTool(
    server,
    "get_order",
    {
      title: "Get order",
      description: "Status of an order placed at this store: what was bought, the total, how it was paid and whether the payment was simulated. Call when the customer asks about an order they placed.",
      inputSchema: OrderInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: APP_VIEWS["order-card"].uri } },
    },
    async ({ orderId }) =>
      timed("get_order", async () => {
        const order = await loadOrderView(store, client, deps.checkout, orderId).catch((e: unknown) => {
          if (e instanceof StoreRequestError && e.code === "STORE_NOT_FOUND") return null;
          throw e;
        });
        if (!order) return fail("ORDER_NOT_FOUND", `No order ${orderId} at ${store.origin}`, "Use the order id from a completed checkout.", "I could not find that order.");
        return ok(speakOrder({ orderId: order.orderId, status: order.status, ...(order.externalOrderId ? { externalOrderId: order.externalOrderId } : {}) }, order.lines, order.totalMinor ?? undefined, order.asset, order.payment.simulated), { order });
      }),
  );

  registerAppTool(
    server,
    "get_receipt",
    {
      title: "Get receipt",
      description: "The store's receipt chain for an order and its verification result. Call when the customer asks for a receipt or proof of purchase.",
      inputSchema: OrderInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: APP_VIEWS["receipt-card"].uri } },
    },
    async ({ orderId }) =>
      timed("get_receipt", async () => {
        const receipt = await loadReceiptView(store, client, deps.checkout, orderId).catch((e: unknown) => {
          if (e instanceof StoreRequestError && e.code === "STORE_NOT_FOUND") return null;
          throw e;
        });
        if (!receipt) return fail("RECEIPT_NOT_FOUND", `No receipt for ${orderId} at ${store.origin}`, "Receipts exist only for settled orders.", "There is no receipt for that order yet.");
        return ok(speakReceipt({ valid: receipt.verification.valid, ...(receipt.verification.mode ? { mode: receipt.verification.mode } : {}) }, receipt.payment.settlementReference ?? undefined, receipt.receipts.length), { receipt });
      }),
  );

  return server;
}

function storeName(store: RegisteredStore): string {
  const p = store.profile as { ucp?: { ["com.novacorplabs.agentpos"]?: unknown } } | undefined;
  void p;
  return new URL(store.origin).hostname;
}
