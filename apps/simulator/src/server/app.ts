/**
 * The Simulator's server: serves the web app and a small API the browser uses. The bearer
 * for the Bridge stays here. Pure over its dependencies so tests run it in memory.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { BridgeClient, ToolCallRecord } from "./bridge-client.js";
import type { CheckoutFlow, CheckoutState } from "./checkout.js";
import type { HouseholdMemory } from "./memory.js";
import { inspectTurn, type InspectionLog, type RenderTiming } from "./inspection.js";
import { route } from "./router.js";

export const SIMULATOR_VERSION = "0.0.1";

export interface SimulatorDeps {
  bridge: BridgeClient;
  checkout: CheckoutFlow;
  inspection: InspectionLog;
  /** Household memory: previous orders as references, for "the same as last week". */
  memory: HouseholdMemory;
  /** Where the served static web build lives; undefined in tests. */
  webDir?: string;
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
  brain: "scripted-router" | "agent" | "recorded";
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

  app.get("/api/health", (c) => c.json({ status: "ok", simulatorVersion: SIMULATOR_VERSION }));

  app.get("/api/addons", async (c) => {
    try {
      return c.json({ addons: await deps.bridge.listAddons() });
    } catch (e) {
      return c.json({ code: "BRIDGE_UNREACHABLE", message: String(e), hint: "Start the Bridge first (pnpm dev:bridge)." }, 502);
    }
  });

  const viewOf = (rec: ToolCallRecord | undefined): TurnView | null =>
    rec?.resourceUri && !rec.result.isError ? { resourceUri: rec.resourceUri, toolName: rec.name, arguments: rec.arguments, result: rec.result } : null;

  const speakOf = (rec: ToolCallRecord): string | undefined => {
    const first = rec.result.content[0] as { type?: string; text?: string } | undefined;
    return first?.type === "text" && first.text ? first.text : undefined;
  };

  app.post("/api/turn", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { addon?: string; text?: string };
    if (!body.addon || typeof body.text !== "string") {
      return c.json({ code: "BAD_TURN", message: "addon and text are required", hint: "" }, 400);
    }
    const addon = body.addon;
    const turnId = `turn_${randomUUID()}`;
    const traceId = `sim-${turnId.slice(5, 13)}`;
    const intent = route(body.text, known.get(addon) ?? [], lastOrder.get(addon), deps.memory.recall(addon, 1)[0]);
    const calls: ToolCallRecord[] = [];
    const speak: string[] = [];
    let checkout: CheckoutState | null = null;
    if (intent.tool === null) {
      speak.push(intent.reply);
    } else {
      try {
        const rec = await deps.bridge.callTool(addon, intent.tool, intent.arguments, traceId);
        calls.push(rec);
        const said = speakOf(rec);
        const sc = rec.result.structuredContent as { items?: KnownItem[]; item?: KnownItem; checkout?: { lineItems: Array<{ itemId: string; title: string; quantity: number }> } } | undefined;
        if (Array.isArray(sc?.items)) known.set(addon, sc!.items!.map((i) => ({ id: i.id, title: i.title })));
        if (sc?.item) known.set(addon, [...(known.get(addon) ?? []).filter((k) => k.id !== sc.item!.id), { id: sc.item.id, title: sc.item.title }]);
        if (intent.tool === "start_checkout" && !rec.result.isError && sc?.checkout) {
          // The host's checkout pattern: open the session right away and read back the quote.
          checkout = await deps.checkout.start(addon, sc.checkout.lineItems, traceId);
          speak.push(checkout.speak);
        } else if (said) {
          speak.push(said);
        }
      } catch (e) {
        speak.push("I could not reach the store right now.");
        c.status(502);
        return c.json({ turnId, traceId, brain: "scripted-router", speak, toolCalls: [], view: null, checkout: null, error: String(e) });
      }
    }
    deps.inspection.add(inspectTurn(turnId, addon, body.text, "scripted-router", calls));
    const res: TurnResponse = { turnId, traceId, brain: "scripted-router", speak, toolCalls: calls, view: checkout ? null : viewOf(calls.at(-1)), checkout };
    return c.json(res);
  });

  /** Confirm a checkout with a payment option; on success the order card follows. */
  app.post("/api/checkout/:id/confirm", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { handlerId?: string; instrumentId?: string };
    if (!body.handlerId) return c.json({ code: "BAD_CONFIRM", message: "handlerId is required", hint: "" }, 400);
    const turnId = `turn_${randomUUID()}`;
    const traceId = `sim-${turnId.slice(5, 13)}`;
    try {
      const state = await deps.checkout.confirm(c.req.param("id"), body.handlerId, body.instrumentId, traceId);
      const calls: ToolCallRecord[] = [];
      const speak = [state.speak];
      let view: TurnView | null = null;
      if (state.session.status === "completed" && state.session.order) {
        lastOrder.set(state.addon, state.session.order.id);
        deps.memory.remember({
          addon: state.addon,
          orderId: state.session.order.id,
          at: new Date().toISOString(),
          lines: state.session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
        });
        const rec = await deps.bridge.callTool(state.addon, "get_order", { orderId: state.session.order.id }, traceId);
        calls.push(rec);
        view = viewOf(rec);
      }
      deps.inspection.add(inspectTurn(turnId, state.addon, `[confirm checkout ${state.sessionId} with ${body.handlerId}]`, "scripted-router", calls));
      const res: TurnResponse = { turnId, traceId, brain: "scripted-router", speak, toolCalls: calls, view, checkout: state.session.status === "completed" ? null : state };
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

  app.get("/api/resource", async (c) => {
    const addon = c.req.query("addon");
    const uri = c.req.query("uri");
    if (!addon || !uri?.startsWith("ui://")) return c.json({ code: "BAD_RESOURCE", message: "addon and a ui:// uri are required", hint: "" }, 400);
    const r = await deps.bridge.readResource(addon, uri, `sim-res-${randomUUID().slice(0, 8)}`);
    return c.json(r);
  });

  app.get("/api/inspection", (c) => c.json(deps.inspection.summary()));

  app.post("/api/inspection/:turnId", async (c) => {
    const render = (await c.req.json().catch(() => null)) as RenderTiming | null;
    if (!render) return c.json({ code: "BAD_RENDER", message: "render timing body required", hint: "" }, 400);
    const turn = deps.inspection.attachRender(c.req.param("turnId"), render);
    if (!turn) return c.json({ code: "TURN_NOT_FOUND", message: "unknown turn", hint: "" }, 404);
    return c.json(turn);
  });

  return app;
}
