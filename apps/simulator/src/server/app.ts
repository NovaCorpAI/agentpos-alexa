/**
 * The Simulator's server: serves the web app and a small API the browser uses. The bearer
 * for the Bridge stays here. Pure over its dependencies so tests run it in memory.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { BridgeClient, ToolCallRecord } from "./bridge-client.js";
import { inspectTurn, type InspectionLog, type RenderTiming } from "./inspection.js";
import { route } from "./router.js";

export const SIMULATOR_VERSION = "0.0.1";

export interface SimulatorDeps {
  bridge: BridgeClient;
  inspection: InspectionLog;
  /** Where the served static web build lives; undefined in tests. */
  webDir?: string;
}

interface KnownItem {
  id: string;
  title: string;
}

export interface TurnResponse {
  turnId: string;
  traceId: string;
  brain: "scripted-router" | "agent" | "recorded";
  /** What the assistant says, in order. */
  speak: string[];
  toolCalls: Array<Omit<ToolCallRecord, "result"> & { result: ToolCallRecord["result"] }>;
  /** A view to render, when the last tool asked for one. */
  view: { resourceUri: string; toolName: string; arguments: Record<string, unknown>; result: ToolCallRecord["result"] } | null;
}

export function createSimulatorApp(deps: SimulatorDeps): Hono {
  const app = new Hono();
  /** Items the Household has heard about per add-on, so "tell me about the baguette" resolves. */
  const known = new Map<string, KnownItem[]>();

  app.get("/api/health", (c) => c.json({ status: "ok", simulatorVersion: SIMULATOR_VERSION }));

  app.get("/api/addons", async (c) => {
    try {
      return c.json({ addons: await deps.bridge.listAddons() });
    } catch (e) {
      return c.json({ code: "BRIDGE_UNREACHABLE", message: String(e), hint: "Start the Bridge first (pnpm dev:bridge)." }, 502);
    }
  });

  app.post("/api/turn", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { addon?: string; text?: string };
    if (!body.addon || typeof body.text !== "string") {
      return c.json({ code: "BAD_TURN", message: "addon and text are required", hint: "" }, 400);
    }
    const turnId = `turn_${randomUUID()}`;
    const traceId = `sim-${turnId.slice(5, 13)}`;
    const intent = route(body.text, known.get(body.addon) ?? []);
    const calls: ToolCallRecord[] = [];
    const speak: string[] = [];
    if (intent.tool === null) {
      speak.push(intent.reply);
    } else {
      try {
        const rec = await deps.bridge.callTool(body.addon, intent.tool, intent.arguments, traceId);
        calls.push(rec);
        const first = rec.result.content[0] as { type?: string; text?: string } | undefined;
        if (first?.type === "text" && first.text) speak.push(first.text);
        const sc = rec.result.structuredContent as { items?: KnownItem[]; item?: KnownItem } | undefined;
        if (Array.isArray(sc?.items)) known.set(body.addon, sc!.items!.map((i) => ({ id: i.id, title: i.title })));
        if (sc?.item) known.set(body.addon, [...(known.get(body.addon) ?? []).filter((k) => k.id !== sc.item!.id), { id: sc.item.id, title: sc.item.title }]);
      } catch (e) {
        speak.push("I could not reach the store right now.");
        c.status(502);
        return c.json({ turnId, traceId, brain: "scripted-router", speak, toolCalls: [], view: null, error: String(e) });
      }
    }
    deps.inspection.add(inspectTurn(turnId, body.addon, body.text, "scripted-router", calls));
    const last = calls.at(-1);
    const view = last?.resourceUri && !last.result.isError ? { resourceUri: last.resourceUri, toolName: last.name, arguments: last.arguments, result: last.result } : null;
    const res: TurnResponse = { turnId, traceId, brain: "scripted-router", speak, toolCalls: calls, view };
    return c.json(res);
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
