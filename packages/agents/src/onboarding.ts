/**
 * The onboarding agent: from a Store's published catalog to a Voice overlay draft (spoken
 * name, one-sentence summary, synonyms per item) and proposed voice policies. It drafts; a
 * human confirms (hard rule 4). A deterministic drafter runs first and is the whole agent
 * without a model; the strong model, when present, improves the wording and never adds a
 * fact the catalog does not carry.
 */
import { Agent, ModelStreamUpdateEvent, type Model } from "@strands-agents/sdk";
import { z } from "zod";
import { spokenText } from "./spoken.js";
import type { CatalogFact, Language, OverlayEntry } from "./catalog.js";

export interface PolicyDraft {
  /** One spoken sentence introducing the store. */
  voiceIntro: string;
  /** What to say about delivery, from what the catalog implies (physical goods or not). */
  deliveryNote: string;
  /** What to say when the merchant holds an order for a human check. */
  reviewNote: string;
}

export interface OnboardingInput {
  storeName: string;
  language: Language;
  items: CatalogFact[];
  /** True when at least one item is delivered (physical). */
  physicalGoods: boolean;
}

export interface OnboardingUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from and written to the prompt cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface OnboardingDraft {
  overlay: OverlayEntry[];
  policies: PolicyDraft;
  modelUsed: boolean;
  usage?: OnboardingUsage;
  fallbackReason?: string;
}

const UNITS = /,?\s*(?:\d+\s*(?:g|kg|ml|l|cl|oz|lb)\b|box of \d+|bag of \d+|pack of \d+|\d+\s*(?:pieces|units|pcs))\.?/gi;

/** "Oat cookies, bag of 6" becomes "Oat cookies"; the ear does not need the packaging. */
export function spokenName(title: string): string {
  const s = title.replace(UNITS, "").replace(/\s{2,}/g, " ").replace(/[,;:]\s*$/, "").trim();
  return s.length >= 3 ? s : title.trim();
}

/** The first sentence of the description, without the weight, as one spoken line. */
export function spokenSummary(description: string): string {
  const first = description.split(/(?<=[.!?])\s+/)[0] ?? description;
  const s = first.replace(UNITS, "").replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Simple synonyms a household might say: the name without hyphens, the last word, the plural. */
export function synonymsFor(title: string): string[] {
  const name = spokenName(title).toLowerCase();
  const out = new Set<string>();
  if (name.includes("-")) out.add(name.replace(/-/g, " "));
  const words = name.split(/\s+/);
  const head = words.at(-1)!;
  if (words.length > 1 && head.length >= 4) out.add(head);
  if (!/s$/.test(name)) out.add(`${name}s`);
  out.delete(name);
  return [...out];
}

/** The deterministic draft: from the catalog alone, ready for a human to correct. */
export function draftFromCatalog(input: OnboardingInput): OnboardingDraft {
  const es = input.language === "es-CL";
  const overlay = input.items.map((it) => ({ itemId: it.id, spokenName: spokenName(it.title), summary: spokenSummary(it.description), synonyms: synonymsFor(it.title) }));
  const count = input.items.length;
  const policies: PolicyDraft = {
    voiceIntro: es ? `${input.storeName} vende ${count} productos; los precios son exactos y vienen de la tienda.` : `${input.storeName} sells ${count} items; prices are exact and come from the store.`,
    deliveryNote: input.physicalGoods
      ? es
        ? "Los pedidos se entregan a domicilio; el pago pide una dirección de entrega."
        : "Orders are delivered; the checkout asks for a delivery address."
      : es
        ? "Los productos son digitales; no hace falta dirección."
        : "Items are digital; no address is needed.",
    reviewNote: es
      ? "La tienda puede revisar un pedido antes de confirmarlo; no se cobra nada hasta entonces."
      : "The store may review an order before confirming it; nothing is charged until then.",
  };
  return { overlay, policies, modelUsed: false };
}

const ModelDraft = z.object({
  overlay: z.array(z.object({ itemId: z.string(), spokenName: z.string().min(1).max(80), summary: z.string().min(1).max(200), synonyms: z.array(z.string().max(40)).max(6) })).max(200),
  policies: z.object({ voiceIntro: z.string().min(1).max(240), deliveryNote: z.string().min(1).max(240), reviewNote: z.string().min(1).max(240) }),
});

export interface OnboardingAgentOptions {
  /** Strong model; omit for the deterministic-only drafter. */
  model?: Model;
  modelId?: string;
  fallbackModel?: Model;
  fallbackModelId?: string;
  onUsage?: (u: OnboardingUsage) => void;
}

export class OnboardingAgent {
  constructor(private readonly opts: OnboardingAgentOptions = {}) {}

  async draft(input: OnboardingInput): Promise<OnboardingDraft> {
    const rule = draftFromCatalog(input);
    if (!this.opts.model) return rule;
    const candidates: Array<[Model, string]> = [[this.opts.model, this.opts.modelId ?? "unknown"]];
    if (this.opts.fallbackModel) candidates.push([this.opts.fallbackModel, this.opts.fallbackModelId ?? "unknown"]);
    const reasons: string[] = [];
    for (const [model, modelId] of candidates) {
      try {
        const d = await this.ask(model, modelId, input, rule);
        return reasons.length ? { ...d, fallbackReason: reasons.join(" | ") } : d;
      } catch (e) {
        const err = e as Error;
        reasons.push(`${modelId}: ${err.name}: ${err.message}`.slice(0, 300));
      }
    }
    return { ...rule, fallbackReason: reasons.join(" | ") };
  }

  private async ask(model: Model, modelId: string, input: OnboardingInput, rule: OnboardingDraft): Promise<OnboardingDraft> {
    const lang = input.language === "es-CL" ? "Spanish (Chile)" : "English (US)";
    const agent = new Agent({
      model,
      printer: false,
      systemPrompt: [
        `You prepare the voice overlay of ${input.storeName}, an online store, for a voice assistant with a screen. A human merchant will review and confirm every line before it is published.`,
        `For each item, write in ${lang}: spokenName (short, pronounceable, no packaging sizes, no punctuation), summary (one spoken sentence from the description, no weights), synonyms (up to 4 words or phrases a customer might say for it, lowercase).`,
        "Write three policy sentences: voiceIntro (one sentence introducing the store), deliveryNote (from physicalGoods only), reviewNote (the store may review an order before confirming it; nothing is charged until then).",
        "Never use dashes as punctuation. Use only the catalog given. Never add ingredients, origins, prices or claims that are not in it. Keep every itemId exactly as given and cover every item.",
        'Answer with one JSON object only: {"overlay":[{"itemId":"...","spokenName":"...","summary":"...","synonyms":["..."]}],"policies":{"voiceIntro":"...","deliveryNote":"...","reviewNote":"..."}}.',
      ].join(" "),
    });
    let usage: OnboardingUsage | undefined;
    agent.addHook(ModelStreamUpdateEvent, (e) => {
      const ev = e.event as { type: string; usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number }; metrics?: { latencyMs: number } };
      if (ev.type !== "modelMetadataEvent") return;
      usage = { modelId, inputTokens: ev.usage?.inputTokens ?? 0, outputTokens: ev.usage?.outputTokens ?? 0, cacheReadTokens: ev.usage?.cacheReadInputTokens ?? 0, cacheWriteTokens: ev.usage?.cacheWriteInputTokens ?? 0, latencyMs: Math.round(ev.metrics?.latencyMs ?? 0) };
      this.opts.onUsage?.(usage);
    });
    const payload = {
      storeName: input.storeName,
      physicalGoods: input.physicalGoods,
      items: input.items.map((it) => ({ id: it.id, title: it.title, description: it.description, price: it.priceDisplay, attributes: it.attributes })),
      draft: { overlay: rule.overlay, policies: rule.policies },
    };
    const result = await agent.invoke(`Input: ${JSON.stringify(payload)}`);
    const parsed = ModelDraft.safeParse(tryJson(result.toString()));
    if (!parsed.success) throw new Error("onboarding: unparseable draft");
    // Every item keeps a line: the model's when it wrote one, the rule's otherwise.
    const byId = new Map(parsed.data.overlay.map((o) => [o.itemId, o]));
    const overlay: OverlayEntry[] = rule.overlay.map((r) => {
      const m = byId.get(r.itemId);
      return m ? { itemId: r.itemId, spokenName: spokenText(m.spokenName), summary: spokenText(m.summary), synonyms: m.synonyms.map((s) => s.trim().toLowerCase()).filter(Boolean) } : r;
    });
    const p = parsed.data.policies;
    const policies = { voiceIntro: spokenText(p.voiceIntro), deliveryNote: spokenText(p.deliveryNote), reviewNote: spokenText(p.reviewNote) };
    return { overlay, policies, modelUsed: true, ...(usage ? { usage } : {}) };
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
