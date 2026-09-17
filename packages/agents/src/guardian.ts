/**
 * The policy guardian: runs only at checkout completion, adds context to the Store's
 * deterministic policy, and can hand the order to the buyer for review or to the
 * merchant's human queue. Money and stock decisions stay with the Store; the guardian
 * judges patterns the Store cannot see across sessions, such as a duplicate order.
 *
 * Deterministic first: findings come from rules the Bridge computes (no model). The strong
 * model turns a finding into one voice-ready sentence and a decision; without a model the
 * rule decides with a fixed sentence, so the guard never depends on credentials.
 */
import { Agent, ModelStreamUpdateEvent, type Model } from "@strands-agents/sdk";
import { z } from "zod";
import { spokenText } from "./spoken.js";

export interface GuardianLine {
  itemId: string;
  title: string;
  quantity: number;
}

export interface GuardianOrderRef {
  orderId: string;
  /** ISO 8601. */
  at: string;
  lines: GuardianLine[];
  totalCents: number;
}

export interface GuardianInput {
  storeName: string;
  language: "en-US" | "es-CL";
  lines: GuardianLine[];
  totalCents: number;
  currency: string;
  /** Completed orders by the same buyer at this Store in the lookback window, newest first. */
  recentOrders: GuardianOrderRef[];
  now: Date;
}

export type GuardianDecision = "allow" | "review" | "refuse";

export interface GuardianVerdict {
  decision: GuardianDecision;
  /** One spoken sentence for the buyer; empty when allowed. */
  reason: string;
  /** Machine code for messages[] (e.g. duplicate_order). */
  code: string;
  /** Which rules fired, for the log and the inspection. */
  findings: string[];
  /** Whether a model produced the sentence (false: deterministic fallback). */
  modelUsed: boolean;
  /** Tokens and latency of the model call, when there was one. */
  usage?: GuardianUsage;
  /** Why the rule spoke instead of the model (error name and message), when a model was configured. */
  fallbackReason?: string;
}

export interface GuardianFinding {
  code: string;
  summary: string;
  previous?: GuardianOrderRef;
}

const DAY_MS = 86_400_000;

function sameLines(a: GuardianLine[], b: GuardianLine[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: GuardianLine) => `${l.itemId}:${l.quantity}`;
  const sa = new Set(a.map(key));
  return b.every((l) => sa.has(key(l)));
}

/** Rules the guardian applies before any model is asked. Pure, unit-testable. */
export function findings(input: GuardianInput, lookbackDays = 7): GuardianFinding[] {
  const out: GuardianFinding[] = [];
  const since = input.now.getTime() - lookbackDays * DAY_MS;
  const dup = input.recentOrders.find((o) => new Date(o.at).getTime() >= since && sameLines(o.lines, input.lines));
  if (dup) {
    const days = Math.max(0, Math.round((input.now.getTime() - new Date(dup.at).getTime()) / DAY_MS));
    out.push({ code: "duplicate_order", summary: `Same items as order ${dup.orderId} placed ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`, previous: dup });
  }
  return out;
}

function fallbackSentence(f: GuardianFinding, input: GuardianInput): string {
  const said = input.lines.map((l) => `${l.quantity} ${l.title}`).join(", ");
  const when = f.summary.replace(/^Same items as order \S+ placed /, "");
  return input.language === "es-CL"
    ? `Ya pediste ${said} ${when === "today" ? "hoy" : `hace ${when.replace(" days ago", " días").replace(" day ago", " día")}`}. ¿Quieres pedirlo otra vez?`
    : `You already ordered ${said} ${when}. Do you want to order it again?`;
}

const Verdict = z.object({
  decision: z.enum(["allow", "review", "refuse"]),
  reason: z.string().max(240),
});

export interface GuardianUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from and written to the prompt cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface GuardianOptions {
  /** Strong model; omit for the deterministic-only guardian. */
  model?: Model;
  modelId?: string;
  /** Second strong model tried when the first fails (for example a model gated by an access form). */
  fallbackModel?: Model;
  fallbackModelId?: string;
  /** Receives usage per model call: tokens, latency, model id. */
  onUsage?: (u: GuardianUsage) => void;
  lookbackDays?: number;
}

export class Guardian {
  constructor(private readonly opts: GuardianOptions = {}) {}

  get modelId(): string | undefined {
    return this.opts.model ? this.opts.modelId : undefined;
  }

  async review(input: GuardianInput): Promise<GuardianVerdict> {
    const found = findings(input, this.opts.lookbackDays);
    if (found.length === 0) return { decision: "allow", reason: "", code: "ok", findings: [], modelUsed: false };
    const first = found[0]!;
    const fallback: GuardianVerdict = { decision: "review", reason: fallbackSentence(first, input), code: first.code, findings: found.map((f) => f.code), modelUsed: false };
    if (!this.opts.model) return fallback;
    const candidates: Array<[Model, string]> = [[this.opts.model, this.opts.modelId ?? "unknown"]];
    if (this.opts.fallbackModel) candidates.push([this.opts.fallbackModel, this.opts.fallbackModelId ?? "unknown"]);
    const reasons: string[] = [];
    for (const [model, modelId] of candidates) {
      try {
        const verdict = await this.ask(model, modelId, input, found);
        return { ...fallback, ...verdict, modelUsed: true, ...(reasons.length ? { fallbackReason: reasons.join(" | ") } : {}) };
      } catch (e) {
        const err = e as Error;
        reasons.push(`${modelId}: ${err.name}: ${err.message}`.slice(0, 300));
      }
    }
    return { ...fallback, fallbackReason: reasons.join(" | ") };
  }

  private async ask(model: Model, modelId: string, input: GuardianInput, found: GuardianFinding[]): Promise<{ decision: GuardianDecision; reason: string; usage?: GuardianUsage }> {
    const lang = input.language === "es-CL" ? "Spanish (Chile)" : "English (US)";
    // Plain JSON in the text, not Strands' structured output: it works the same against Bedrock
    // and against the fake model in tests, and the parse below validates the shape either way.
    const agent = new Agent({
      model,
      printer: false,
      systemPrompt: [
        `You are the policy guardian of ${input.storeName}, an online store. A customer is about to pay and a rule fired. Decide: allow, review (ask the customer to confirm in one sentence) or refuse (only for clear abuse).`,
        `Write the reason as one short spoken sentence in ${lang}, addressed to the customer, naming the items and when they ordered them before. Never use dashes as punctuation. No markdown, no ids, no prices unless given.`,
        "A repeated order is usually legitimate: prefer review over refuse. Never invent facts beyond the input.",
        'Answer with one JSON object only, no prose around it: {"decision":"allow"|"review"|"refuse","reason":"..."}.',
      ].join(" "),
    });
    let usage: GuardianUsage | undefined;
    agent.addHook(ModelStreamUpdateEvent, (e) => {
      const ev = e.event as { type: string; usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number }; metrics?: { latencyMs: number } };
      if (ev.type !== "modelMetadataEvent") return;
      usage = { modelId, inputTokens: ev.usage?.inputTokens ?? 0, outputTokens: ev.usage?.outputTokens ?? 0, cacheReadTokens: ev.usage?.cacheReadInputTokens ?? 0, cacheWriteTokens: ev.usage?.cacheWriteInputTokens ?? 0, latencyMs: Math.round(ev.metrics?.latencyMs ?? 0) };
      this.opts.onUsage?.(usage);
    });
    const payload = {
      lines: input.lines,
      totalCents: input.totalCents,
      currency: input.currency,
      findings: found.map((f) => ({ code: f.code, summary: f.summary, previousOrder: f.previous ? { at: f.previous.at, lines: f.previous.lines, totalCents: f.previous.totalCents } : undefined })),
      now: input.now.toISOString(),
    };
    const result = await agent.invoke(`Input: ${JSON.stringify(payload)}`);
    const parsed = Verdict.safeParse(tryJson(result.toString()));
    if (!parsed.success) throw new Error("guardian: unparseable verdict");
    const data = { ...parsed.data, reason: spokenText(parsed.data.reason) };
    return usage ? { ...data, usage } : data;
  }
}

function tryJson(text: string): unknown {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse(m[0]);
  } catch {
    return undefined;
  }
}
