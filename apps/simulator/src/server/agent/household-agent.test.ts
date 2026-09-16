import { createApp, createLogger, memorySink, openStorage, type Storage } from "@agentpos-alexa/bridge";
import { createFixtureStore } from "@agentpos-alexa/fixture-store";
import { parseStoreProfile } from "@agentpos-alexa/store-client";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../bridge-client.js";
import { AgentBrain } from "./brain.js";
import { FakeModel } from "@agentpos-alexa/agents/testing";

const STORE = "http://bakery.test";
const BRIDGE = "http://bridge.test";
const TOKEN = "t";

function fetchInto(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

describe("Household agent on Strands (scripted model)", () => {
  let storage: Storage;
  let bridge: BridgeClient;

  beforeEach(async () => {
    const fixture = createFixtureStore({ baseUrl: STORE });
    storage = openStorage({ path: ":memory:" });
    storage.stores.register("bakery", parseStoreProfile(STORE, await (await fixture.app.request("/.well-known/ucp")).json()));
    const app = createApp({ storage, logger: createLogger(memorySink().sink), bridgeBaseUrl: BRIDGE, bearerToken: TOKEN, storeFetch: fetchInto(fixture.app) }) as unknown as Hono;
    bridge = new BridgeClient({ url: BRIDGE, bearerToken: TOKEN }, fetchInto(app));
  });
  afterEach(async () => {
    await bridge.close();
    storage.close();
  });

  it("calls the Bridge's tools through our adapter, keeps the full result for the host, and records usage", async () => {
    const model = new FakeModel([
      { toolUse: { name: "search_items", input: { query: "loaf", limit: 3 } } },
      { text: "I found three loaves. The sourdough is six and a half USDC." },
    ]);
    const events: Parameters<AgentBrain["turn"]>[1][] = [];
    void events;
    const recorded: Array<{ model: string | null; inputTokens: number; estimatedCostUsdMicros: number }> = [];
    const brain = new AgentBrain({ bridge, modelId: "amazon.nova-2-lite-v1:0", region: "us-east-1", model, record: (e) => recorded.push(e) });

    const turn = await brain.turn("What loaves do you have?", { addon: "bakery", storeOrigin: STORE, traceId: "trace-agent-1", language: "en-US", known: [] });
    expect(turn.brain).toBe("agent");
    expect(turn.speak).toEqual(["I found three loaves. The sourdough is six and a half USDC."]);
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: "search_items", arguments: { query: "loaf", limit: 3 }, resourceUri: "ui://agentpos-alexa/carousel.html", traceId: "trace-agent-1" });
    expect((turn.toolCalls[0]!.result.structuredContent as { items: unknown[] }).items.length).toBeLessThanOrEqual(3);

    // The model saw the Bridge's six tools with their schemas and the voice-first system prompt.
    const first = model.calls[0]!.options!;
    expect(first.toolSpecs?.map((t) => t.name).sort()).toEqual(["ask_catalog", "get_item", "get_order", "get_policies", "get_receipt", "search_items", "start_checkout"]);
    expect(JSON.stringify(first.systemPrompt)).toContain("Never invent");

    // Two model calls, two usage rows with tokens and an estimated cost.
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ model: "amazon.nova-2-lite-v1:0", inputTokens: 120 });
    expect(recorded[0]!.estimatedCostUsdMicros).toBeGreaterThan(0);
    expect(storage.usageEvents.list({ source: "bridge.mcp" })).toHaveLength(1);
  });

  it("keeps the conversation per add-on and language, and resets on demand", async () => {
    const model = new FakeModel([{ text: "Hello." }, { text: "Still here." }, { text: "Fresh start." }]);
    const brain = new AgentBrain({ bridge, modelId: "fake", region: "us-east-1", model, record: () => undefined });
    const ctx = { addon: "bakery", storeOrigin: STORE, traceId: "t", language: "en-US" as const, known: [] };
    await brain.turn("Hi", ctx);
    await brain.turn("Are you there?", ctx);
    expect(model.calls[1]!.messages.length).toBeGreaterThan(model.calls[0]!.messages.length);
    brain.reset("bakery");
    await brain.turn("Hi again", ctx);
    expect(model.calls[2]!.messages).toHaveLength(1);
  });
});
