/**
 * The Bridge's HTTP app. Pure over its dependencies so tests run it in memory with
 * `app.request()`; `main.ts` wires the real storage and the listener.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { requireBearerAuth, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { AgentPosStoreClient } from "@agentpos-alexa/store-client";
import type { CatalogAgent, Guardian, OnboardingAgent } from "@agentpos-alexa/agents";
import { registerOnboardingRoutes } from "./onboarding/routes.js";
import { OnboardingService } from "./onboarding/service.js";
import { anyOf, staticTokenVerifier, storedTokenVerifier, tokenEndpoint } from "./auth/oauth.js";
import { registerCheckoutRoutes } from "./checkout/routes.js";
import { CheckoutService } from "./checkout/service.js";
import { BridgeError, storeNotFound } from "./errors.js";
import type { Logger } from "./logging.js";
import { createStoreMcpServer } from "./mcp/server.js";
import { buildServedProfile } from "./profile/serve.js";
import { RailRegistry } from "./rails/rail.js";
import type { Storage } from "./storage/sqlite.js";
import { usageEventsToCsv } from "./storage/usage-export.js";
import { BRIDGE_VERSION } from "./versions.js";

export interface AppDeps {
  storage: Storage;
  logger: Logger;
  /** Public base URL of this Bridge, e.g. https://bridge.example. */
  bridgeBaseUrl: string;
  /** Static bearer accepted next to OAuth-issued tokens (tests, first run). */
  bearerToken: string;
  /** Payment rails available to Stores. Empty until #9, #10 and #17 register theirs. */
  rails?: RailRegistry;
  /** Policy guardian at checkout completion (#15). */
  guardian?: Guardian;
  /** Catalog agent behind ask_catalog (#14). Omitted: facts only, no model. */
  catalogAgent?: CatalogAgent;
  /** Onboarding agent behind /onboarding/scan (#13). Omitted: the deterministic drafter. */
  onboardingAgent?: OnboardingAgent;
  /**
   * Purchases counted on earlier releases. Every release starts with an empty disk, so without
   * this the public counter would go back to zero each time the playground is deployed. The
   * deploy reads the running total out of the release it is replacing and hands it to the next
   * one; `docs/impact/purchases.json` is the committed audit trail of those handovers.
   */
  priorPurchases?: { own: number; thirdParty: number };
  /** fetch used to reach Stores; tests route it into an in-memory fixture. */
  storeFetch?: typeof fetch;
  now?: () => Date;
}

/** Header that carries the traceId end to end; the UCP checkout contract already defines it. */
export const TRACE_HEADER = "Request-Id";

type Env = { Variables: { traceId: string; log: Logger } };

export function createApp({ storage, logger, bridgeBaseUrl, bearerToken, rails = new RailRegistry(), guardian, catalogAgent, onboardingAgent, priorPurchases, storeFetch, now }: AppDeps): Hono<Env> {
  const app = new Hono<Env>();
  const verifier = anyOf(storedTokenVerifier(storage.oauth), staticTokenVerifier(bearerToken));
  const gate = requireBearerAuth({ verifier });
  const checkout = new CheckoutService({ storage, rails, bridgeBaseUrl, ...(guardian ? { guardian } : {}), ...(storeFetch ? { storeFetch } : {}), ...(now ? { now } : {}) });

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

  app.post("/oauth/token", (c) => tokenEndpoint(c, storage.oauth));

  // Public counters for the playground (#21): totals only, nothing about any order or buyer.
  app.get("/stats", (c) => {
    c.header("Cache-Control", "public, max-age=15");
    const thisRelease = storage.checkout.countCompletedByOrigin();
    const prior = priorPurchases ?? { own: 0, thirdParty: 0 };
    return c.json({
      purchases: { own: prior.own + thisRelease.own, thirdParty: prior.thirdParty + thisRelease.thirdParty },
      thisRelease,
      stores: storage.stores.list().length,
    });
  });

  /**
   * The measured rows, for the operator only. The playground's disk is recreated on every
   * redeploy (docs/DEPLOY.md), so a release pulls the rows out first and commits them under
   * docs/impact/. Same bearer as MCP; nothing here names a buyer or an order.
   */
  app.get("/admin/usage-events.csv", async (c) => {
    const auth = await gate(c.req.raw);
    if (auth instanceof Response) return auth;
    const since = c.req.query("since") ?? "";
    const events = storage.usageEvents.list({ limit: 1_000_000 }).filter((e) => e.at >= since);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Cache-Control", "no-store");
    c.header("X-Closed-Sessions", String(storage.checkout.countByStatus("completed", since)));
    // What this release counted, so the next one can carry the public total forward.
    const completed = storage.checkout.countCompletedByOrigin();
    c.header("X-Completed-Own", String(completed.own));
    c.header("X-Completed-Third-Party", String(completed.thirdParty));
    return c.body(usageEventsToCsv(events));
  });

  app.get("/stores", (c) =>
    c.json({
      stores: storage.stores.list().map((s) => ({
        slug: s.slug,
        name: s.displayName || new URL(s.origin).hostname,
        origin: s.origin,
        ucpVersion: s.ucpVersion,
        paymentHandlers: s.paymentHandlers,
        mcp: `${bridgeBaseUrl}/stores/${s.slug}/mcp`,
        checkout: `${bridgeBaseUrl}/stores/${s.slug}/checkout-sessions`,
        profile: `${bridgeBaseUrl}/stores/${s.slug}/.well-known/ucp`,
      })),
    }),
  );

  app.get("/stores/:slug/.well-known/ucp", (c) => {
    const slug = c.req.param("slug");
    const store = storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    c.header("Cache-Control", "public, max-age=900");
    return c.json(buildServedProfile(store, { bridgeBaseUrl, rails }));
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
      checkout: storage.checkout,
      ...(catalogAgent ? { catalogAgent } : {}),
      onboarding: storage.onboarding,
    });
    // Stateless and JSON-bodied: one request, one server, one plain JSON response. No SSE
    // stream to keep open, so nothing outlives the request.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw, { authInfo: auth });
  });

  registerCheckoutRoutes(app, { storage, service: checkout, gate });
  registerOnboardingRoutes(app, { service: new OnboardingService({ storage, ...(onboardingAgent ? { agent: onboardingAgent } : {}), ...(storeFetch ? { storeFetch } : {}), ...(now ? { now } : {}) }), gate });

  return app;
}
