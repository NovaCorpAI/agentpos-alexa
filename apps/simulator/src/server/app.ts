/**
 * The Simulator's server: serves the web app and a small API the browser uses. The bearer
 * for the Bridge stays here. Pure over its dependencies so tests run it in memory.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Brain, BrainKind } from "./agent/brain.js";
import type { BridgeClient, BridgeOnboardingClient, ToolCallRecord } from "./bridge-client.js";
import type { CheckoutFlow, CheckoutState } from "./checkout.js";
import { inspectTurn, type InspectionLog, type RenderTiming } from "./inspection.js";
import type { HouseholdMemory } from "./memory.js";
import { TurnLimiter, type TurnLimits } from "./rate-limit.js";
import type { DemoMandate } from "./checkout.js";
import { parseWaitlist, type SqliteWaitlist } from "./waitlist.js";
import { SCENES } from "./scenes.js";
import type { PollySpeech, SpeechLanguage } from "./speech.js";

export const SIMULATOR_VERSION = "0.0.1";

export interface SimulatorDeps {
  bridge: BridgeClient;
  brain: Brain;
  checkout: CheckoutFlow;
  inspection: InspectionLog;
  /** Household memory: previous orders as references, for "the same as last week". */
  memory: HouseholdMemory;
  /** Which runtime holds it, for /api/brain. */
  memoryKind?: "sqlite" | "agentcore";
  /** What the /api/brain endpoint reports about the model in use. */
  brainInfo?: { modelId?: string; region?: string };
  /** Where the served static web build lives; undefined in tests. */
  webDir?: string;
  /** Voice output; undefined means the browser speaks. */
  speech?: PollySpeech;
  /** The Merchant console's way to the Bridge's onboarding routes (#13). */
  merchant?: BridgeOnboardingClient;
  /** Spend guard for a public deployment; omitted means unlimited (local use, tests). */
  limits?: TurnLimits;
  /**
   * The public playground (#21): purchases outside Scenes count as third parties', the Demo
   * household's mandate applies, and the waitlist is open. Omitted: local development, every
   * purchase is ours.
   */
  playground?: { mandate: DemoMandate; waitlist: SqliteWaitlist; adminToken?: string };
}

interface KnownItem {
  id: string;
  title: string;
}

export interface TurnView {
  resourceUri: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: ToolCallRecord["result"];
}

export interface TurnResponse {
  turnId: string;
  traceId: string;
  brain: BrainKind;
  fallbackReason?: string;
  /** What the assistant says, in order. */
  speak: string[];
  toolCalls: ToolCallRecord[];
  /** A view to render, when the last tool asked for one. */
  view: TurnView | null;
  /** A checkout to confirm natively, when the turn started one. */
  checkout: CheckoutState | null;
}

export function createSimulatorApp(deps: SimulatorDeps): Hono {
  const app = new Hono();
  /** Items the Household has heard about per add-on, so "tell me about the baguette" resolves. */
  const known = new Map<string, KnownItem[]>();
  /** The last order per add-on, so "show my order" resolves. */
  const lastOrder = new Map<string, string>();
  /** Store origin per add-on slug, for the agent's prompt and usage rows. */
  const origins = new Map<string, string>();

  const originOf = async (addon: string): Promise<string> => {
    const cached = origins.get(addon);
    if (cached) return cached;
    for (const a of await deps.bridge.listAddons()) origins.set(a.slug, a.origin);
    return origins.get(addon) ?? addon;
  };

  app.get("/api/health", (c) => c.json({ status: "ok", simulatorVersion: SIMULATOR_VERSION }));

  // Every route that can call a paid model counts as a turn for the spend guard.
  if (deps.limits) {
    const limiter = new TurnLimiter(deps.limits);
    const guarded = ["/api/turn", "/api/checkout/*", "/api/merchant/scan", "/api/speech", "/api/waitlist"];
    for (const path of guarded) {
      app.use(path, async (c, next) => {
        const visitor = (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";
        const r = limiter.take(visitor);
        if (!r.ok) {
          c.header("Retry-After", String(r.retryAfterS));
          const speak = r.scope === "global" ? "The public demo is very busy right now. Please try again later." : "You have reached the demo's limit for a few minutes. Please try again shortly.";
          return c.json({ code: "RATE_LIMITED", message: speak, hint: `Retry after ${r.retryAfterS} s.`, speak: [speak], toolCalls: [], view: null, checkout: null }, 429);
        }
        await next();
      });
    }
  }

  app.get("/api/brain", (c) =>
    c.json({
      kind: deps.brain.kind,
      degraded: (deps.brain as { degradedReason?: string }).degradedReason ?? null,
      modelId: deps.brainInfo?.modelId ?? null,
      region: deps.brainInfo?.region ?? null,
      memory: deps.memoryKind ?? "sqlite",
    }),
  );

  app.get("/api/addons", async (c) => {
    try {
      const addons = await deps.bridge.listAddons();
      for (const a of addons) origins.set(a.slug, a.origin);
      return c.json({ addons });
    } catch (e) {
      return c.json({ code: "BRIDGE_UNREACHABLE", message: String(e), hint: "Start the Bridge first (pnpm dev:bridge)." }, 502);
    }
  });

  const viewOf = (rec: ToolCallRecord | undefined): TurnView | null =>
    rec?.resourceUri && !rec.result.isError ? { resourceUri: rec.resourceUri, toolName: rec.name, arguments: rec.arguments, result: rec.result } : null;

  const learn = (addon: string, calls: ToolCallRecord[]): void => {
    for (const rec of calls) {
      const sc = rec.result.structuredContent as { items?: KnownItem[]; item?: KnownItem } | undefined;
      if (Array.isArray(sc?.items)) known.set(addon, sc!.items!.map((i) => ({ id: i.id, title: i.title })));
      if (sc?.item) known.set(addon, [...(known.get(addon) ?? []).filter((k) => k.id !== sc.item!.id), { id: sc.item.id, title: sc.item.title }]);
    }
  };

  app.post("/api/turn", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { addon?: string; text?: string; language?: string; scene?: string };
    if (!body.addon || typeof body.text !== "string") {
      return c.json({ code: "BAD_TURN", message: "addon and text are required", hint: "" }, 400);
    }
    const addon = body.addon;
    const language = body.language === "es-CL" ? "es-CL" : "en-US";
    const turnId = `turn_${randomUUID()}`;
    const traceId = `sim-${turnId.slice(5, 13)}`;
    let brainTurn;
    try {
      // Memory is a convenience: if its runtime is unreachable the turn goes on without it.
      const remembered = (await deps.memory.recall(addon, 1).catch(() => []))[0];
      const ctx = { addon, storeOrigin: await originOf(addon), traceId, language, known: known.get(addon) ?? [], remembered } as Parameters<Brain["turn"]>[1];
      const last = lastOrder.get(addon);
      if (last) ctx.lastOrderId = last;
      brainTurn = await deps.brain.turn(body.text, ctx);
    } catch (e) {
      // Say what actually failed: a model rate limit is not the store being down.
      const throttled = /too many requests|throttl|rate exceeded/i.test(String(e));
      c.status(throttled ? 429 : 502);
      const speak = throttled ? "I am getting too many requests right now. Please ask again in a few seconds." : "I could not reach the store right now.";
      return c.json({ turnId, traceId, brain: deps.brain.kind, speak: [speak], toolCalls: [], view: null, checkout: null, error: String(e) });
    }
    learn(addon, brainTurn.toolCalls);
    let checkout: CheckoutState | null = null;
    const started = brainTurn.toolCalls.find((r) => r.name === "start_checkout" && !r.result.isError);
    const sc = started?.result.structuredContent as { checkout?: { lineItems: Array<{ itemId: string; title: string; quantity: number }> } } | undefined;
    // The router's speech for start_checkout is the tool's estimate; the checkout's own line replaces it.
    const speak = started && brainTurn.brain === "scripted-router" ? [] : [...brainTurn.speak];
    if (started && sc?.checkout) {
      // The host's checkout pattern: open the session right away and read back the quote.
      try {
        checkout = await deps.checkout.start(addon, sc.checkout.lineItems, traceId);
        speak.push(checkout.speak);
      } catch (e) {
        speak.push(`I could not open the checkout: ${(e as Error).message}`);
      }
    }
    deps.inspection.add(inspectTurn(turnId, addon, body.text, brainTurn.brain, brainTurn.toolCalls, body.scene));
    const res: TurnResponse = { turnId, traceId, brain: brainTurn.brain, speak, toolCalls: brainTurn.toolCalls, view: checkout ? null : viewOf(brainTurn.toolCalls.at(-1)), checkout };
    if (brainTurn.fallbackReason) res.fallbackReason = brainTurn.fallbackReason;
    return c.json(res);
  });

  /** Confirm a checkout with a payment option; on success the order card follows. */
  app.post("/api/checkout/:id/confirm", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { handlerId?: string; instrumentId?: string; scene?: string };
    if (!body.handlerId) return c.json({ code: "BAD_CONFIRM", message: "handlerId is required", hint: "" }, 400);
    const turnId = `turn_${randomUUID()}`;
    const traceId = `sim-${turnId.slice(5, 13)}`;
    try {
      // A Scene is our demo; anything else on the public playground is a visitor buying.
      const purchaseOrigin = deps.playground && !body.scene ? "third_party" : "own";
      const state = await deps.checkout.confirm(c.req.param("id"), body.handlerId, body.instrumentId, traceId, { purchaseOrigin, ...(deps.playground ? { mandate: deps.playground.mandate } : {}) });
      const calls: ToolCallRecord[] = [];
      const speak = [state.speak];
      let view: TurnView | null = null;
      if (state.session.status === "completed" && state.session.order) {
        lastOrder.set(state.addon, state.session.order.id);
        // The order is placed whatever happens to memory; a failed write only loses the reorder shortcut.
        await deps.memory
          .remember({
            addon: state.addon,
            orderId: state.session.order.id,
            at: new Date().toISOString(),
            lines: state.session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
          })
          .catch((e: unknown) => console.error(JSON.stringify({ service: "simulator", level: "warn", msg: "household memory write failed", error: String(e) })));
        const rec = await deps.bridge.callTool(state.addon, "get_order", { orderId: state.session.order.id }, traceId);
        calls.push(rec);
        view = viewOf(rec);
      }
      deps.inspection.add(inspectTurn(turnId, state.addon, `[confirm checkout ${state.sessionId} with ${body.handlerId}]`, deps.brain.kind, calls, body.scene));
      const res: TurnResponse = { turnId, traceId, brain: deps.brain.kind, speak, toolCalls: calls, view, checkout: state.session.status === "completed" ? null : state };
      return c.json(res);
    } catch (e) {
      return c.json({ code: "CHECKOUT_FAILED", message: String(e), hint: "" }, 502);
    }
  });

  app.post("/api/checkout/:id/cancel", async (c) => {
    const traceId = `sim-${randomUUID().slice(0, 8)}`;
    try {
      const state = await deps.checkout.cancel(c.req.param("id"), traceId);
      return c.json({ speak: [state.speak], checkout: null });
    } catch (e) {
      return c.json({ code: "CHECKOUT_FAILED", message: String(e), hint: "" }, 502);
    }
  });

  /** Forget the conversation with an add-on: a Scene starts clean. */
  app.post("/api/reset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { addon?: string };
    if (body.addon) {
      deps.brain.reset(body.addon);
      known.delete(body.addon);
      lastOrder.delete(body.addon);
    }
    return c.json({ ok: true });
  });

  app.get("/api/resource", async (c) => {
    const addon = c.req.query("addon");
    const uri = c.req.query("uri");
    if (!addon || !uri?.startsWith("ui://")) return c.json({ code: "BAD_RESOURCE", message: "addon and a ui:// uri are required", hint: "" }, 400);
    const r = await deps.bridge.readResource(addon, uri, `sim-res-${randomUUID().slice(0, 8)}`);
    return c.json(r);
  });

  app.get("/api/inspection", (c) => c.json(deps.inspection.summary()));

  app.get("/api/scenes", (c) => c.json({ scenes: SCENES }));

  // Playground counters: purchases by visitors (from the Bridge) and the waitlist size. Totals only.
  app.get("/api/stats", async (c) => {
    const bridge = await deps.bridge.stats().catch(() => null);
    return c.json({ playground: Boolean(deps.playground), purchases: bridge?.purchases ?? null, waitlist: deps.playground?.waitlist.count() ?? null });
  });

  app.post("/api/waitlist", async (c) => {
    if (!deps.playground) return c.json({ code: "NO_WAITLIST", message: "The waitlist is open on the public playground only.", hint: "" }, 404);
    const parsed = parseWaitlist((await c.req.json().catch(() => ({}))) as Record<string, unknown>, new Date());
    if (!parsed.ok) return c.json({ code: "BAD_WAITLIST", message: parsed.message, hint: "" }, 400);
    deps.playground.waitlist.add(parsed.entry);
    return c.json({ ok: true, message: parsed.entry.role === "merchant" ? "Thanks. We will write to you about putting your store on Alexa+." : "Thanks. We will let you know when it ships." }, 201);
  });

  app.get("/api/waitlist/export", (c) => {
    const token = deps.playground?.adminToken;
    if (!deps.playground || !token || c.req.header("Authorization") !== `Bearer ${token}`) return c.json({ code: "FORBIDDEN", message: "Admin token required.", hint: "" }, 403);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Cache-Control", "no-store");
    return c.body(deps.playground.waitlist.toCsv());
  });

  // Merchant console: pass-through to the Bridge, the bearer never reaches the browser.
  const merchantOnly = (c: { json: (b: unknown, s: 503) => Response }) => c.json({ code: "NO_MERCHANT", message: "The Merchant console is not wired to a Bridge.", hint: "Start the Bridge and the Simulator together." }, 503);
  app.post("/api/merchant/scan", async (c) => {
    if (!deps.merchant) return merchantOnly(c);
    const body = (await c.req.json().catch(() => ({}))) as { storeUrl?: string; language?: string };
    if (!body.storeUrl) return c.json({ code: "BAD_SCAN", message: "storeUrl is required", hint: "" }, 400);
    const r = await deps.merchant.scan(body.storeUrl, body.language === "es-CL" ? "es-CL" : "en-US", `merchant-${randomUUID().slice(0, 8)}`);
    return c.json(r.body, r.status as 201);
  });
  app.get("/api/merchant/:slug", async (c) => {
    if (!deps.merchant) return merchantOnly(c);
    const r = await deps.merchant.get(c.req.param("slug"), `merchant-${randomUUID().slice(0, 8)}`);
    return c.json(r.body, r.status as 200);
  });
  app.post("/api/merchant/:slug/confirm", async (c) => {
    if (!deps.merchant) return merchantOnly(c);
    const r = await deps.merchant.confirm(c.req.param("slug"), await c.req.json().catch(() => ({})), `merchant-${randomUUID().slice(0, 8)}`);
    return c.json(r.body, r.status as 200);
  });

  /** Voice output: Polly with a per-phrase cache, or 503 so the browser speaks. */
  app.get("/api/speech", async (c) => {
    const text = (c.req.query("text") ?? "").trim();
    const language: SpeechLanguage = c.req.query("lang") === "es-CL" ? "es-CL" : "en-US";
    if (!text) return c.json({ code: "BAD_SPEECH", message: "text is required", hint: "" }, 400);
    if (!deps.speech) return c.json({ code: "SPEECH_UNAVAILABLE", message: "No voice service configured", hint: "The browser voice is used." }, 503);
    try {
      const r = await deps.speech.synthesize(text, language);
      c.header("Content-Type", r.contentType);
      c.header("Cache-Control", "private, max-age=86400");
      c.header("X-Voice", r.voiceId);
      c.header("X-Cached", r.cached ? "1" : "0");
      c.header("X-Latency-Ms", String(r.latencyMs));
      return c.body(new Uint8Array(r.audio));
    } catch (e) {
      return c.json({ code: "SPEECH_UNAVAILABLE", message: String((e as Error).message).slice(0, 200), hint: "The browser voice is used." }, 503);
    }
  });

  app.post("/api/inspection/:turnId", async (c) => {
    const render = (await c.req.json().catch(() => null)) as RenderTiming | null;
    if (!render) return c.json({ code: "BAD_RENDER", message: "render timing body required", hint: "" }, 400);
    const turn = deps.inspection.attachRender(c.req.param("turnId"), render);
    if (!turn) return c.json({ code: "TURN_NOT_FOUND", message: "unknown turn", hint: "" }, 404);
    return c.json(turn);
  });

  return app;
}
