/**
 * The Household agent: the "brain" of the simulated Alexa+, on Strands Agents with a
 * Bedrock model. It sees exactly the Bridge's tools (ADR-0001) through our own adapter,
 * because Strands' MCP client drops structuredContent and _meta, and the views need both.
 * Every model call lands in usage_events with tokens, latency, model and estimated cost.
 */
import { Agent, ModelStreamUpdateEvent, tool, type Model } from "@strands-agents/sdk";
import type { NewUsageEvent } from "@agentpos-alexa/bridge";
import type { BridgeClient, ToolCallRecord } from "../bridge-client.js";
import { estimateCostUsdMicros } from "./pricing.js";

export interface HouseholdAgentDeps {
  bridge: BridgeClient;
  addon: string;
  storeOrigin: string;
  model: Model;
  modelId: string;
  language: "en-US" | "es-CL";
  record: (event: NewUsageEvent) => void;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCallRecord[];
  stopReason: string;
}

export function systemPrompt(language: "en-US" | "es-CL", storeName: string): string {
  const lang = language === "es-CL" ? "Spanish (Chile)" : "English (US)";
  return [
    `You are Alexa, the household's shopping assistant, talking to a customer of ${storeName} through a speaker with a screen.`,
    `Speak ${lang}. Answer in one or two short spoken sentences; the screen shows the details.`,
    "Only the store's tools know prices, stock, ingredients and policies. Never invent any of them; if a tool does not say it, say the store has not published it.",
    "Prices returned by tools are exact. Read them as they come, do not round or convert.",
    "When the customer names what to buy, call start_checkout with the exact item ids and quantities, then answer only 'Starting the checkout.' The checkout screen asks for the address and the payment; never ask for them yourself.",
    "When a search matched nothing (matched is false), say so in one sentence and name what the store sells instead.",
    "For a question about an item, call get_item with its id from a previous search. For delivery or payment questions, call get_policies.",
    "For an order the customer placed, call get_order; for a receipt, get_receipt.",
    "Do not describe the tools or the screen. Do not use markdown.",
  ].join(" ");
}

/** Wraps every Bridge tool as a Strands tool, keeping the full MCP result for the host. */
function bridgeTools(deps: HouseholdAgentDeps, tools: Array<{ name: string; description?: string; inputSchema: unknown }>, traceId: () => string, collect: (rec: ToolCallRecord) => void) {
  return tools.map((t) =>
    tool({
      name: t.name,
      description: t.description ?? t.name,
      inputSchema: t.inputSchema as Record<string, unknown>,
      callback: async (input: unknown) => {
        const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
        const rec = await deps.bridge.callTool(deps.addon, t.name, args, traceId());
        collect(rec);
        const first = rec.result.content[0] as { type?: string; text?: string } | undefined;
        let voice = first?.type === "text" ? (first.text ?? "") : "";
        // This host renders checkout natively (address and payment included), so the tool's
        // own "I will need a delivery address" line must not be echoed by the agent.
        if (t.name === "start_checkout" && rec.result.isError !== true) {
          voice = "Checkout started. The checkout screen now collects the address and the payment; say only: Starting the checkout.";
        }
        // The model gets the spoken text plus the structured facts; the host keeps the full result.
        return { spoken: voice, isError: rec.result.isError === true, data: rec.result.structuredContent ?? null };
      },
    }),
  );
}

export class HouseholdAgent {
  private agent: Agent | undefined;
  private collector: ToolCallRecord[] = [];
  private currentTraceId = "sim-agent";

  constructor(private readonly deps: HouseholdAgentDeps) {}

  private async ensure(): Promise<Agent> {
    if (this.agent) return this.agent;
    const tools = await this.deps.bridge.listTools(this.deps.addon, this.currentTraceId);
    const agent = new Agent({
      model: this.deps.model,
      systemPrompt: systemPrompt(this.deps.language, new URL(this.deps.storeOrigin).hostname),
      tools: bridgeTools(this.deps, tools as Array<{ name: string; description?: string; inputSchema: unknown }>, () => this.currentTraceId, (rec) => this.collector.push(rec)),
      printer: false,
    });
    agent.addHook(ModelStreamUpdateEvent, (e) => {
      const ev = e.event as { type: string; usage?: { inputTokens: number; outputTokens: number }; metrics?: { latencyMs: number } };
      if (ev.type !== "modelMetadataEvent") return;
      const input = ev.usage?.inputTokens ?? 0;
      const output = ev.usage?.outputTokens ?? 0;
      const cost = estimateCostUsdMicros(this.deps.modelId, input, output);
      this.deps.record({
        traceId: this.currentTraceId,
        source: "simulator",
        storeOrigin: this.deps.storeOrigin,
        model: this.deps.modelId,
        inputTokens: input,
        outputTokens: output,
        latencyMs: Math.max(0, Math.round(ev.metrics?.latencyMs ?? 0)),
        estimatedCostUsdMicros: cost.micros,
        simulated: false,
      });
    });
    this.agent = agent;
    return agent;
  }

  async turn(text: string, traceId: string): Promise<AgentTurnResult> {
    const agent = await this.ensure();
    this.currentTraceId = traceId;
    this.collector = [];
    const result = await agent.invoke(text);
    const spoken = result.lastMessage.content
      .map((b) => (b.type === "textBlock" ? (b as { text: string }).text : ""))
      .join(" ")
      .trim();
    return { text: spoken, toolCalls: [...this.collector], stopReason: String(result.stopReason) };
  }

  /** Forgets the conversation (a new Scene starts clean). */
  reset(): void {
    this.agent = undefined;
  }
}
