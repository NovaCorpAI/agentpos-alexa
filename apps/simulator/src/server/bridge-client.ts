/**
 * The Simulator's connection to a Bridge: one MCP client per Enabled add-on, bearer held
 * server-side (the browser never sees it). Everything the Simulator knows about a Store
 * arrives through this client, never from the Store directly (ADR-0001).
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";

export interface BridgeConfig {
  /** Public base URL of the Bridge, e.g. http://127.0.0.1:8787. */
  url: string;
  bearerToken: string;
}

export interface EnabledAddon {
  slug: string;
  origin: string;
  name: string;
  mcp: string;
  checkout: string;
  profile: string;
  paymentHandlers: string[];
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: CallToolResult;
  /** ui:// resource the tool asks the host to render, when any. */
  resourceUri: string | null;
  latencyMs: number;
  traceId: string;
}

export class BridgeClient {
  private readonly clients = new Map<string, Promise<Client>>();
  private readonly tools = new Map<string, Tool[]>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Public totals from the Bridge: purchases by origin, Stores served. */
  async stats(): Promise<{ purchases: { own: number; thirdParty: number }; stores: number }> {
    const res = await this.fetchImpl(`${this.config.url}/stats`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Bridge answered ${res.status} to /stats`);
    return (await res.json()) as { purchases: { own: number; thirdParty: number }; stores: number };
  }

  /** The Bridge lists its Stores; each one is an add-on the Household can enable. */
  async listAddons(): Promise<EnabledAddon[]> {
    const res = await this.fetchImpl(`${this.config.url}/stores`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Bridge answered ${res.status} to /stores`);
    const body = (await res.json()) as { stores: Array<Omit<EnabledAddon, "name"> & { name?: string }> };
    // The Store's own name when the Bridge read it; the host only as a last resort.
    return body.stores.map((s) => ({ ...s, name: s.name || new URL(s.origin).hostname }));
  }

  private client(slug: string, traceId: string): Promise<Client> {
    const key = `${slug}:${traceId}`;
    let p = this.clients.get(key);
    if (!p) {
      p = (async () => {
        const c = new Client({ name: "agentpos-alexa-simulator", version: "0.0.1" });
        await c.connect(
          new StreamableHTTPClientTransport(new URL(`${this.config.url}/stores/${slug}/mcp`), {
            fetch: this.fetchImpl,
            requestInit: { headers: { Authorization: `Bearer ${this.config.bearerToken}`, "Request-Id": traceId } },
          }),
        );
        return c;
      })();
      this.clients.set(key, p);
    }
    return p;
  }

  async listTools(slug: string, traceId: string): Promise<Tool[]> {
    const cached = this.tools.get(slug);
    if (cached) return cached;
    const { tools } = await (await this.client(slug, traceId)).listTools();
    this.tools.set(slug, tools);
    return tools;
  }

  async callTool(slug: string, name: string, args: Record<string, unknown>, traceId: string): Promise<ToolCallRecord> {
    const tools = await this.listTools(slug, traceId);
    const tool = tools.find((t) => t.name === name);
    const resourceUri = ((tool?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri as string | undefined) ?? null;
    const started = performance.now();
    const result = await (await this.client(slug, traceId)).callTool({ name, arguments: args });
    return { name, arguments: args, result, resourceUri, latencyMs: Math.round(performance.now() - started), traceId };
  }

  async readResource(slug: string, uri: string, traceId: string): Promise<{ html: string; mimeType: string; meta: unknown }> {
    const res = await (await this.client(slug, traceId)).readResource({ uri });
    const first = res.contents[0] as { text?: string; mimeType?: string; _meta?: unknown } | undefined;
    if (!first?.text) throw new Error(`Resource ${uri} has no text content`);
    return { html: first.text, mimeType: first.mimeType ?? "text/html", meta: first._meta ?? null };
  }

  async close(): Promise<void> {
    for (const p of this.clients.values()) await (await p).close().catch(() => undefined);
    this.clients.clear();
  }
}

/** UCP checkout session calls, the way Alexa+ makes them: bearer, UCP-Agent, Request-Id, Idempotency-Key. */
export interface SessionCall {
  status: number;
  body: Record<string, unknown>;
}

/** What the Merchant console shows: the Bridge's onboarding state, passed through untouched. */
export interface MerchantCall {
  status: number;
  body: Record<string, unknown>;
}

/** The Merchant console's connection to the Bridge's onboarding routes; bearer held server-side. */
export class BridgeOnboardingClient {
  constructor(
    private readonly config: BridgeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, traceId: string, body?: unknown): Promise<MerchantCall> {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${this.config.bearerToken}`, "Content-Type": "application/json", Accept: "application/json", "Request-Id": traceId } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${this.config.url}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json };
  }

  scan(storeUrl: string, language: string, traceId: string) {
    return this.call("POST", "/onboarding/scan", traceId, { storeUrl, language });
  }
  get(slug: string, traceId: string) {
    return this.call("GET", `/onboarding/${slug}`, traceId);
  }
  confirm(slug: string, body: unknown, traceId: string) {
    return this.call("POST", `/onboarding/${slug}/confirm`, traceId, body);
  }
}

export interface PurchaseSummary {
  since: string;
  currency: string;
  orders: Array<{ orderId: string; at: string; totalCents: number; lines: Array<{ itemId: string; title: string; quantity: number }> }>;
  totals: { orders: number; amountCents: number };
  top: Array<{ itemId: string; title: string; quantity: number }>;
}

export class BridgeCheckoutClient {
  constructor(
    private readonly config: BridgeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(traceId: string, idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.config.bearerToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "UCP-Agent": 'profile="https://simulator.agentposhq.com/.well-known/ucp"',
      "Request-Id": traceId,
    };
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    return h;
  }

  private async call(method: string, path: string, traceId: string, body?: unknown, idempotencyKey?: string, extra: Record<string, string> = {}): Promise<SessionCall> {
    const init: RequestInit = { method, headers: { ...this.headers(traceId, idempotencyKey), ...extra } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${this.config.url}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json };
  }

  create(slug: string, body: unknown, traceId: string, key: string) {
    return this.call("POST", `/stores/${slug}/checkout-sessions`, traceId, body, key);
  }
  get(slug: string, id: string, traceId: string) {
    return this.call("GET", `/stores/${slug}/checkout-sessions/${id}`, traceId);
  }
  update(slug: string, id: string, body: unknown, traceId: string, key: string) {
    return this.call("PUT", `/stores/${slug}/checkout-sessions/${id}`, traceId, body, key);
  }
  /** purchaseOrigin tells the Bridge whose purchase this is: ours (Scenes, tests) or a visitor's. */
  complete(slug: string, id: string, body: unknown, traceId: string, key: string, purchaseOrigin?: "own" | "third_party") {
    return this.call("POST", `/stores/${slug}/checkout-sessions/${id}/complete`, traceId, body, key, purchaseOrigin ? { "AgentPOS-Purchase-Origin": purchaseOrigin } : {});
  }
  cancel(slug: string, id: string, traceId: string, key: string) {
    return this.call("POST", `/stores/${slug}/checkout-sessions/${id}/cancel`, traceId, {}, key);
  }

  /** What this household has settled at this Store in a period. The buyer travels in the body. */
  async purchases(slug: string, buyerEmail: string, period: "this_month" | "last_30_days" | "all_time", traceId: string): Promise<PurchaseSummary | null> {
    const res = await this.call("POST", `/stores/${slug}/household/purchases`, traceId, { buyer: { email: buyerEmail }, period });
    return res.status === 200 ? (res.body as unknown as PurchaseSummary) : null;
  }
}
