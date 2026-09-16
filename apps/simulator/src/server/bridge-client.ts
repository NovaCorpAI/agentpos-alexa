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

  /** The Bridge lists its Stores; each one is an add-on the Household can enable. */
  async listAddons(): Promise<EnabledAddon[]> {
    const res = await this.fetchImpl(`${this.config.url}/stores`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Bridge answered ${res.status} to /stores`);
    const body = (await res.json()) as { stores: Array<Omit<EnabledAddon, "name">> };
    return body.stores.map((s) => ({ ...s, name: new URL(s.origin).hostname }));
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

  private async call(method: string, path: string, traceId: string, body?: unknown, idempotencyKey?: string): Promise<SessionCall> {
    const init: RequestInit = { method, headers: this.headers(traceId, idempotencyKey) };
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
  complete(slug: string, id: string, body: unknown, traceId: string, key: string) {
    return this.call("POST", `/stores/${slug}/checkout-sessions/${id}/complete`, traceId, body, key);
  }
  cancel(slug: string, id: string, traceId: string, key: string) {
    return this.call("POST", `/stores/${slug}/checkout-sessions/${id}/cancel`, traceId, {}, key);
  }
}
