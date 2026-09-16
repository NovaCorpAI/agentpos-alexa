/**
 * The Brain behind a turn. Two implementations, one interface, chosen at boot and switched
 * at runtime if Bedrock credentials turn out to be missing (the Simulator says so on screen):
 *
 *   agent            Strands on Bedrock, the real thing.
 *   scripted-router  deterministic text to tool mapping, no model. Keeps every demo runnable
 *                    without AWS credentials and is the fallback of the agent.
 */
import { BedrockModel, ModelError, type Model } from "@strands-agents/sdk";
import type { NewUsageEvent } from "@agentpos-alexa/bridge";
import type { BridgeClient, ToolCallRecord } from "../bridge-client.js";
import { route, type RememberedOrder } from "../router.js";
import { HouseholdAgent } from "./household-agent.js";

export type BrainKind = "agent" | "scripted-router" | "recorded";

export interface TurnContext {
  addon: string;
  storeOrigin: string;
  traceId: string;
  language: "en-US" | "es-CL";
  known: Array<{ id: string; title: string }>;
  lastOrderId?: string;
  remembered?: RememberedOrder;
}

export interface BrainTurn {
  brain: BrainKind;
  /** What the assistant says before any checkout takes over. */
  speak: string[];
  toolCalls: ToolCallRecord[];
  /** Set when the brain fell back to the router during this turn. */
  fallbackReason?: string;
}

export interface Brain {
  readonly kind: BrainKind;
  turn(text: string, ctx: TurnContext): Promise<BrainTurn>;
  reset(addon: string): void;
}

export class ScriptedRouterBrain implements Brain {
  readonly kind = "scripted-router" as const;
  constructor(private readonly bridge: BridgeClient) {}

  async turn(text: string, ctx: TurnContext): Promise<BrainTurn> {
    const intent = route(text, ctx.known, ctx.lastOrderId, ctx.remembered);
    if (intent.tool === null) return { brain: this.kind, speak: [intent.reply], toolCalls: [] };
    const rec = await this.bridge.callTool(ctx.addon, intent.tool, intent.arguments, ctx.traceId);
    const first = rec.result.content[0] as { type?: string; text?: string } | undefined;
    return { brain: this.kind, speak: first?.type === "text" && first.text ? [first.text] : [], toolCalls: [rec] };
  }

  reset(): void {
    // Stateless.
  }
}

export interface AgentBrainOptions {
  bridge: BridgeClient;
  modelId: string;
  region: string;
  record: (event: NewUsageEvent) => void;
  /** Injected in tests; defaults to a BedrockModel for modelId in region. */
  model?: Model;
}

export class AgentBrain implements Brain {
  readonly kind = "agent" as const;
  private readonly agents = new Map<string, HouseholdAgent>();
  private readonly fallback: ScriptedRouterBrain;
  private disabledReason: string | undefined;

  constructor(private readonly opts: AgentBrainOptions) {
    this.fallback = new ScriptedRouterBrain(opts.bridge);
  }

  get degradedReason(): string | undefined {
    return this.disabledReason;
  }

  private agentFor(ctx: TurnContext): HouseholdAgent {
    const key = `${ctx.addon}:${ctx.language}`;
    let a = this.agents.get(key);
    if (!a) {
      const model = this.opts.model ?? new BedrockModel({ region: this.opts.region, modelId: this.opts.modelId, maxTokens: 600, temperature: 0.2 });
      a = new HouseholdAgent({ bridge: this.opts.bridge, addon: ctx.addon, storeOrigin: ctx.storeOrigin, model, modelId: this.opts.modelId, language: ctx.language, record: this.opts.record });
      this.agents.set(key, a);
    }
    return a;
  }

  async turn(text: string, ctx: TurnContext): Promise<BrainTurn> {
    if (this.disabledReason) {
      const t = await this.fallback.turn(text, ctx);
      return { ...t, fallbackReason: this.disabledReason };
    }
    try {
      // The checkout completes outside the conversation, so the agent is told what it missed.
      const note = ctx.lastOrderId ? `\n\n(Context, not spoken: the customer's most recent order at this store has id ${ctx.lastOrderId}; use it for get_order and get_receipt.)` : "";
      const r = await this.agentFor(ctx).turn(`${text}${note}`, ctx.traceId);
      return { brain: "agent", speak: r.text ? [r.text] : [], toolCalls: r.toolCalls };
    } catch (e) {
      const cause = (e as { cause?: { name?: string } }).cause;
      if (e instanceof ModelError && cause?.name === "CredentialsProviderError") {
        this.disabledReason = "No AWS credentials for Bedrock; using the scripted router.";
        const t = await this.fallback.turn(text, ctx);
        return { ...t, fallbackReason: this.disabledReason };
      }
      throw e;
    }
  }

  reset(addon: string): void {
    for (const [key, a] of this.agents) if (key.startsWith(`${addon}:`)) a.reset();
  }
}
