/**
 * The Bridge's HTTP app. Pure over its dependencies so tests run it in memory with
 * `app.request()`; `main.ts` wires the real storage and the listener.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { AgentPosStoreClient } from "@agentpos-alexa/store-client";
import { BridgeError, storeNotFound } from "./errors.js";
import type { Logger } from "./logging.js";
import { bearerGate, staticTokenVerifier } from "./mcp/auth.js";
import { createStoreMcpServer } from "./mcp/server.js";
import { buildServedProfile } from "./profile/serve.js";
import type { Storage } from "./storage/sqlite.js";
import { BRIDGE_VERSION } from "./versions.js";

export interface AppDeps {
  storage: Storage;
  logger: Logger;
  /** Public base URL of this Bridge, e.g. https://bridge.example. */
  bridgeBaseUrl: string;
  /** Static bearer accepted on the MCP endpoint until the OAuth issuer lands (#7). */
  bearerToken: string;
  /** fetch used to reach Stores; tests route it into an in-memory fixture. */
  storeFetch?: typeof fetch;
}

/** Header that carries the traceId end to end; the UCP checkout contract already defines it. */
export const TRACE_HEADER = "Request-Id";

type Env = { Variables: { traceId: string; log: Logger } };

export function createApp({ storage, logger, bridgeBaseUrl, bearerToken, storeFetch }: AppDeps): Hono<Env> {
  const app = new Hono<Env>();
  const gate = bearerGate(staticTokenVerifier(bearerToken));

  app.use("*", async (c, next) => {
    const traceId = c.req.header(TRACE_HEADER) ?? randomUUID();
    const log = logger.child({ traceId });
    c.set("traceId", traceId);
    c.set("log", log);
    const started = performance.now();
    await next();
    c.header(TRACE_HEADER, traceId);
    log.log("info", "request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - started),
    });
  });

  app.onError((err, c) => {
    if (err instanceof BridgeError) {
      return c.json(err.toJSON(), err.status as 404);
    }
    c.get("log").log("error", "unhandled", { error: err.message });
    return c.json(
      { code: "INTERNAL", message: "Unexpected error", hint: "Check the Bridge logs by traceId." },
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      { code: "NOT_FOUND", message: `No route for ${c.req.method} ${c.req.path}`, hint: "See README." },
      404,
    ),
  );

  app.get("/health", (c) =>
    c.json({ status: "ok", bridgeVersion: BRIDGE_VERSION, stores: storage.stores.list().length }),
  );

  app.get("/stores", (c) =>
    c.json({
      stores: storage.stores.list().map((s) => ({
        slug: s.slug,
        origin: s.origin,
        ucpVersion: s.ucpVersion,
        paymentHandlers: s.paymentHandlers,
        mcp: `${bridgeBaseUrl}/stores/${s.slug}/mcp`,
      })),
    }),
  );

  app.get("/stores/:slug/.well-known/ucp", (c) => {
    const slug = c.req.param("slug");
    const store = storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    return c.json(buildServedProfile(store));
  });

  /**
   * MCP for Alexa+: Streamable HTTP, stateless, one server per request. Bearer first, so an
   * unauthenticated caller learns nothing about which slugs exist.
   */
  app.all("/stores/:slug/mcp", async (c) => {
    const auth = await gate(c.req.raw);
    if (auth instanceof Response) return auth;
    const slug = c.req.param("slug");
    const store = storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    const traceId = c.get("traceId");
    const clientOpts = storeFetch ? { fetchImpl: storeFetch, traceId } : { traceId };
    const server = createStoreMcpServer({
      store,
      client: new AgentPosStoreClient(store, clientOpts),
      bridgeBaseUrl,
      traceId,
      log: c.get("log").child({ slug, mcp: true }),
      record: (e) => storage.usageEvents.record(e),
    });
    // Stateless and JSON-bodied: one request, one server, one plain JSON response. No SSE
    // stream to keep open, so nothing outlives the request.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw, { authInfo: auth });
  });

  return app;
}
