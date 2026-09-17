/**
 * The catalog agent: answers a customer's question about an item from what the Store
 * publishes (catalog attributes and description) plus the Voice overlay, and nothing else.
 * A deterministic answerer runs the facts first and is the whole agent when no model is
 * configured; the fast model, when present, words the answer and must stay grounded: it
 * says "not published" when the facts do not carry the answer.
 */
import { Agent, ModelStreamUpdateEvent, type Model } from "@strands-agents/sdk";
import { z } from "zod";
import { spokenText } from "./spoken.js";

export type Language = "en-US" | "es-CL";

/** One published item, as facts. Prices arrive already spoken; the agent never computes them. */
export interface CatalogFact {
  id: string;
  title: string;
  description: string;
  priceDisplay: string;
  attributes: Record<string, unknown>;
}

/** The Voice overlay for one item (CONTEXT.md): drafted by onboarding, confirmed by the Merchant. */
export interface OverlayEntry {
  itemId: string;
  spokenName?: string;
  summary?: string;
  synonyms?: string[];
}

export interface CatalogQuestion {
  question: string;
  language: Language;
  storeName: string;
  items: CatalogFact[];
  overlay?: OverlayEntry[];
}

export interface CatalogUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from and written to the prompt cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface CatalogAnswer {
  /** One or two spoken sentences. */
  answer: string;
  /** True when the facts carry the answer; false when the Store has not published it. */
  grounded: boolean;
  /** Items the answer is about, from the input only. */
  itemIds: string[];
  modelUsed: boolean;
  usage?: CatalogUsage;
  fallbackReason?: string;
}

// Function words, and the property words a question carries (gluten, vegan...), so that
// "Is the sourdough loaf gluten free?" matches the sourdough, not the gluten-free loaf.
const STOP = new Set([
  "the", "a", "an", "is", "it", "of", "and", "or", "in", "on", "with", "does", "do", "have", "has", "what", "how", "many", "much", "this", "that", "your", "you", "are", "for", "to", "me", "please", "about", "any",
  "gluten", "free", "vegan", "organic", "contain", "contains", "allergens", "allergen", "ingredients", "made", "weigh", "weighs", "nuts", "milk", "egg", "eggs", "sesame", "soy", "dairy", "pieces",
  "el", "la", "los", "las", "un", "una", "es", "de", "del", "con", "sin", "tiene", "lleva", "libre", "contiene", "orgánico", "vegano",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Items named in the question, best title or overlay overlap first. Empty when none is named. */
export function matchItems(question: string, items: CatalogFact[], overlay: OverlayEntry[] = []): CatalogFact[] {
  const q = new Set(words(question));
  const scored = items.map((it) => {
    const ov = overlay.find((o) => o.itemId === it.id);
    const names = [it.title, ov?.spokenName ?? "", ...(ov?.synonyms ?? [])];
    const score = names.reduce((best, name) => Math.max(best, words(name).filter((w) => q.has(w)).length), 0);
    return { it, score };
  });
  const top = Math.max(0, ...scored.map((s) => s.score));
  return top === 0 ? [] : scored.filter((s) => s.score === top).map((s) => s.it);
}

interface Aspect {
  key: string;
  test: RegExp;
  /** Spoken answer from the published value; undefined when the value is not usable. */
  say: (value: unknown, title: string, question: string, lang: Language) => string | undefined;
  label: Record<Language, string>;
}

const list = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);
const join = (xs: string[], lang: Language): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${lang === "es-CL" ? "y" : "and"} ${xs.at(-1)}`);

const ASPECTS: Aspect[] = [
  {
    key: "glutenFree",
    test: /gluten/i,
    label: { "en-US": "whether it is gluten free", "es-CL": "si es libre de gluten" },
    say: (v, title, _q, lang) =>
      v === true ? (lang === "es-CL" ? `Sí, ${title} es libre de gluten.` : `Yes, ${title} is gluten free.`) : v === false ? (lang === "es-CL" ? `No, ${title} contiene gluten.` : `No, ${title} contains gluten.`) : undefined,
  },
  {
    key: "allergens",
    test: /allerg|contain|nuts?|milk|dairy|egg|sesame|soy|peanut|lactose|alerg|contiene|nuez|nueces|leche|huevo|sésamo|soya|maní/i,
    label: { "en-US": "its allergens", "es-CL": "sus alérgenos" },
    say: (v, title, q, lang) => {
      const xs = list(v);
      if (!xs) return undefined;
      const asked = xs.find((a) => new RegExp(`\\b${a}s?\\b`, "i").test(q));
      const said = join(xs, lang);
      if (asked) return lang === "es-CL" ? `Sí, ${title} contiene ${asked}. Sus alérgenos publicados son ${said}.` : `Yes, ${title} contains ${asked}. Its listed allergens are ${said}.`;
      if (/nuts?|peanut|nuez|nueces|maní/i.test(q)) return lang === "es-CL" ? `Los alérgenos publicados de ${title} son ${said}; no aparecen frutos secos.` : `The listed allergens of ${title} are ${said}; nuts are not among them.`;
      return lang === "es-CL" ? `Los alérgenos publicados de ${title} son ${said}.` : `${title} lists these allergens: ${said}.`;
    },
  },
  {
    key: "ingredients",
    test: /ingredient|made (?:of|with|from)|what'?s in|recipe|ingrediente|hecho (?:de|con)/i,
    label: { "en-US": "its ingredients", "es-CL": "sus ingredientes" },
    say: (v, title, _q, lang) => {
      const xs = list(v);
      return xs ? (lang === "es-CL" ? `${title} lleva ${join(xs, lang)}.` : `${title} is made with ${join(xs, lang)}.`) : undefined;
    },
  },
  {
    key: "weightGrams",
    test: /weigh|weight|grams?|how (?:big|heavy)|pesa|peso|gramos/i,
    label: { "en-US": "its weight", "es-CL": "su peso" },
    say: (v, title, _q, lang) => (typeof v === "number" ? (lang === "es-CL" ? `${title} pesa ${v} gramos.` : `${title} weighs ${v} grams.`) : undefined),
  },
  {
    key: "pieces",
    test: /how many|pieces|units|per (?:box|bag)|cuántos|cuántas|piezas|unidades/i,
    label: { "en-US": "how many pieces it has", "es-CL": "cuántas piezas trae" },
    say: (v, title, _q, lang) => (typeof v === "number" ? (lang === "es-CL" ? `${title} trae ${v} unidades.` : `${title} comes with ${v} pieces.`) : undefined),
  },
  {
    key: "vegan",
    test: /vegan|vegano/i,
    label: { "en-US": "whether it is vegan", "es-CL": "si es vegano" },
    say: (v, title, _q, lang) => (v === true ? (lang === "es-CL" ? `Sí, ${title} es vegano.` : `Yes, ${title} is vegan.`) : v === false ? (lang === "es-CL" ? `No, ${title} no es vegano.` : `No, ${title} is not vegan.`) : undefined),
  },
  {
    key: "organic",
    test: /organic|orgánic/i,
    label: { "en-US": "whether it is organic", "es-CL": "si es orgánico" },
    say: (v, title, _q, lang) => (v === true ? (lang === "es-CL" ? `Sí, ${title} es orgánico.` : `Yes, ${title} is organic.`) : v === false ? (lang === "es-CL" ? `No, ${title} no es orgánico.` : `No, ${title} is not organic.`) : undefined),
  },
];

/** The deterministic answer: facts in, one or two sentences out, honest when the fact is missing. */
export function answerFromFacts(q: CatalogQuestion): CatalogAnswer {
  const lang = q.language;
  const matched = matchItems(q.question, q.items, q.overlay);
  if (matched.length === 0) {
    const names = join(q.items.slice(0, 5).map((it) => it.title), lang);
    return {
      answer: lang === "es-CL" ? `¿De qué producto hablas? ${q.storeName} vende ${names}.` : `Which item do you mean? ${q.storeName} sells ${names}.`,
      grounded: false,
      itemIds: [],
      modelUsed: false,
    };
  }
  const it = matched[0]!;
  const ov = q.overlay?.find((o) => o.itemId === it.id);
  const title = ov?.spokenName ?? it.title;
  // The aspect is read from the question without the item's own name, so "gluten-free seeded
  // loaf" does not turn every question about that loaf into a gluten question.
  const asked = [it.title, ov?.spokenName ?? "", ...(ov?.synonyms ?? [])]
    .filter((n) => n.length > 0)
    .reduce((text, n) => text.replace(new RegExp(escapeRegExp(n), "ig"), " "), q.question);
  const aspect = ASPECTS.find((a) => a.test.test(asked));
  if (aspect) {
    const said = aspect.say(it.attributes[aspect.key], title, asked, lang);
    if (said) return { answer: said, grounded: true, itemIds: [it.id], modelUsed: false };
    return {
      answer:
        lang === "es-CL"
          ? `La tienda no ha publicado ${aspect.label["es-CL"]} para ${title}. Lo que dice es: ${it.description}`
          : `The store has not published ${aspect.label["en-US"]} for ${title}. What it says is: ${it.description}`,
      grounded: false,
      itemIds: [it.id],
      modelUsed: false,
    };
  }
  const summary = q.overlay?.find((o) => o.itemId === it.id)?.summary ?? it.description;
  return { answer: `${title}, ${it.priceDisplay}. ${summary}`, grounded: true, itemIds: [it.id], modelUsed: false };
}

const ModelAnswer = z.object({
  answer: z.string().min(1).max(400),
  grounded: z.boolean(),
  itemIds: z.array(z.string()).max(5),
});

export interface CatalogAgentOptions {
  /** Fast model; omit for the deterministic-only agent. */
  model?: Model;
  modelId?: string;
  onUsage?: (u: CatalogUsage) => void;
}

export class CatalogAgent {
  constructor(private readonly opts: CatalogAgentOptions = {}) {}

  get modelId(): string | undefined {
    return this.opts.model ? this.opts.modelId : undefined;
  }

  async answer(q: CatalogQuestion): Promise<CatalogAnswer> {
    const rule = answerFromFacts(q);
    if (!this.opts.model) return rule;
    try {
      const m = await this.ask(this.opts.model, this.opts.modelId ?? "unknown", q, rule);
      return { ...m, modelUsed: true };
    } catch (e) {
      const err = e as Error;
      return { ...rule, fallbackReason: `${err.name}: ${err.message}`.slice(0, 300) };
    }
  }

  private async ask(model: Model, modelId: string, q: CatalogQuestion, rule: CatalogAnswer): Promise<CatalogAnswer> {
    const lang = q.language === "es-CL" ? "Spanish (Chile)" : "English (US)";
    const agent = new Agent({
      model,
      printer: false,
      systemPrompt: [
        `You answer a customer's question about the items of ${q.storeName}, spoken through a speaker. Use only the facts in the input: titles, descriptions, prices as written, attributes and the voice overlay.`,
        `Answer in one or two short spoken sentences in ${lang}, naming the item. Never use dashes as punctuation. No markdown, no ids, no URLs.`,
        "If the facts do not carry the answer, say that the store has not published it and set grounded to false. Never invent price, stock, ingredients, allergens or origin.",
        "If the question names no item, ask which item and name a few the store sells. itemIds are the ids of the items the answer is about, from the input only.",
        'Answer with one JSON object only: {"answer":"...","grounded":true|false,"itemIds":["..."]}.',
      ].join(" "),
    });
    let usage: CatalogUsage | undefined;
    agent.addHook(ModelStreamUpdateEvent, (e) => {
      const ev = e.event as { type: string; usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number }; metrics?: { latencyMs: number } };
      if (ev.type !== "modelMetadataEvent") return;
      usage = { modelId, inputTokens: ev.usage?.inputTokens ?? 0, outputTokens: ev.usage?.outputTokens ?? 0, cacheReadTokens: ev.usage?.cacheReadInputTokens ?? 0, cacheWriteTokens: ev.usage?.cacheWriteInputTokens ?? 0, latencyMs: Math.round(ev.metrics?.latencyMs ?? 0) };
      this.opts.onUsage?.(usage);
    });
    const payload = {
      question: q.question,
      items: q.items.map((it) => ({ id: it.id, title: it.title, description: it.description, price: it.priceDisplay, attributes: it.attributes })),
      overlay: q.overlay ?? [],
      // The rule's reading of the facts, so the model does not contradict what is published.
      factsSay: { itemIds: rule.itemIds, grounded: rule.grounded, answer: rule.answer },
    };
    const result = await agent.invoke(`Input: ${JSON.stringify(payload)}`);
    const parsed = ModelAnswer.safeParse(tryJson(result.toString()));
    if (!parsed.success) throw new Error("catalog: unparseable answer");
    const known = new Set(q.items.map((it) => it.id));
    const itemIds = parsed.data.itemIds.filter((id) => known.has(id));
    // The model may word the answer; it may not claim more than the facts. If the rule found
    // no fact for the asked aspect, the answer stays ungrounded whatever the model said.
    const grounded = parsed.data.grounded && rule.grounded;
    return { answer: spokenText(parsed.data.answer), grounded, itemIds, modelUsed: true, ...(usage ? { usage } : {}) };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
