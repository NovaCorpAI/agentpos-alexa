/**
 * Onboarding: from a Store URL to a Voice overlay and voice policies the Merchant confirms,
 * with every stage timestamped in usage_events (docs/USAGE-EVENTS.md). The timer a judge
 * sees ("URL to first voice purchase") is computed from those rows, never from a clock in
 * memory: scan, catalog_draft, policies_draft, human_confirm, published, first_voice_purchase.
 */
import { estimateCostUsdMicros, OnboardingAgent, type PolicyDraft } from "@agentpos-alexa/agents";
import { AgentPosStoreClient, discoverStore, type CatalogItem } from "@agentpos-alexa/store-client";
import { BridgeError, storeNotFound } from "../errors.js";
import type { Logger } from "../logging.js";
import { speakPrice } from "../mcp/voice.js";
import { itemHash, type OnboardingRecord, type OverlayLine } from "../storage/onboarding-store.js";
import type { Storage } from "../storage/sqlite.js";
import { slugFromOrigin } from "../storage/store-registry.js";
import type { OnboardingStage } from "../storage/usage-events.js";

export interface OnboardingServiceDeps {
  storage: Storage;
  agent?: OnboardingAgent;
  storeFetch?: typeof fetch;
  now?: () => Date;
}

/** An overlay line as the Merchant sends it back: every field optional, blanks allowed. */
export interface OverlayInput {
  itemId: string;
  spokenName?: string | undefined;
  summary?: string | undefined;
  synonyms?: string[] | undefined;
}

export interface OnboardingState {
  slug: string;
  origin: string;
  status: "none" | "draft" | "published";
  language: "en-US" | "es-CL";
  overlay: OverlayLine[];
  policies: PolicyDraft | null;
  modelUsed: boolean;
  /** Published lines whose item changed in the Store since: served in the catalog's own words. */
  stale: string[];
  /** ISO timestamp of the latest row per stage. */
  stages: Partial<Record<OnboardingStage, string>>;
  /** Milliseconds between stage rows of the latest run; null until both ends exist. */
  elapsedMs: { scanToPublished: number | null; scanToFirstVoicePurchase: number | null };
}

export class OnboardingService {
  private readonly agent: OnboardingAgent;
  private readonly now: () => Date;

  constructor(private readonly deps: OnboardingServiceDeps) {
    this.agent = deps.agent ?? new OnboardingAgent();
    this.now = deps.now ?? (() => new Date());
  }

  private mark(storeOrigin: string, traceId: string, stage: OnboardingStage, extra: { model?: string | null; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; latencyMs?: number; costMicros?: number } = {}): void {
    this.deps.storage.usageEvents.record({
      traceId,
      at: this.now().toISOString(),
      source: "agent.onboarding",
      storeOrigin,
      model: extra.model ?? null,
      inputTokens: extra.inputTokens ?? 0,
      outputTokens: extra.outputTokens ?? 0,
      cacheReadTokens: extra.cacheReadTokens ?? 0,
      cacheWriteTokens: extra.cacheWriteTokens ?? 0,
      latencyMs: extra.latencyMs ?? 0,
      estimatedCostUsdMicros: extra.costMicros ?? 0,
      onboardingStage: stage,
      simulated: false,
    });
  }

  /** Discovers and registers the Store, reads its catalog, drafts overlay and policies. */
  async scan(storeUrl: string, language: "en-US" | "es-CL", traceId: string, log: Logger): Promise<OnboardingState> {
    const started = performance.now();
    const store = await discoverStore(storeUrl, this.deps.storeFetch);
    const slug = slugFromOrigin(store.origin);
    const registered = this.deps.storage.stores.register(slug, store);
    const client = new AgentPosStoreClient(registered, this.deps.storeFetch ? { fetchImpl: this.deps.storeFetch, traceId } : { traceId });
    const catalog = await client.catalog();
    this.mark(store.origin, traceId, "scan", { latencyMs: Math.round(performance.now() - started) });
    log.log("info", "onboarding scan", { slug, origin: store.origin, items: catalog.items.length });

    const draftStarted = performance.now();
    const draft = await this.agent.draft({
      storeName: catalog.site.name,
      language,
      physicalGoods: catalog.items.some((it) => it.physical),
      items: catalog.items.map((it) => ({ id: it.id, title: it.title, description: it.description, priceDisplay: speakPrice(it.price.minor, it.price.asset), attributes: it.attributes ?? {} })),
    });
    if (draft.fallbackReason) log.log("warn", "onboarding agent fell back to the drafter", { fallbackReason: draft.fallbackReason });
    const u = draft.usage;
    this.mark(store.origin, traceId, "catalog_draft", {
      model: u?.modelId ?? null,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      cacheReadTokens: u?.cacheReadTokens ?? 0,
      cacheWriteTokens: u?.cacheWriteTokens ?? 0,
      latencyMs: Math.round(performance.now() - draftStarted),
      costMicros: u ? estimateCostUsdMicros(u.modelId, u.inputTokens, u.outputTokens, { readTokens: u.cacheReadTokens, writeTokens: u.cacheWriteTokens }).micros : 0,
    });
    // Policies come out of the same model call; their stage row carries no second cost.
    this.mark(store.origin, traceId, "policies_draft");

    const hashes = new Map(catalog.items.map((it) => [it.id, itemHash(it)]));
    const overlay: OverlayLine[] = draft.overlay.map((o) => ({
      itemId: o.itemId,
      spokenName: o.spokenName ?? o.itemId,
      summary: o.summary ?? "",
      synonyms: o.synonyms ?? [],
      itemHash: hashes.get(o.itemId) ?? "",
    }));
    this.deps.storage.onboarding.saveDraft({ slug, language, overlay, policies: draft.policies, modelUsed: draft.modelUsed, draftedAt: this.now().toISOString() });
    return this.state(slug, catalog.items);
  }

  /** The Merchant's confirmation, with the lines as edited: this is what gets published. */
  async confirm(slug: string, overlay: OverlayInput[], policies: PolicyDraft, traceId: string, log: Logger): Promise<OnboardingState> {
    const store = this.deps.storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    const rec = this.deps.storage.onboarding.get(slug);
    if (!rec) throw new BridgeError(409, { code: "NO_DRAFT", message: `No onboarding draft for ${slug}`, hint: "Run the scan first." });
    const client = new AgentPosStoreClient(store, this.deps.storeFetch ? { fetchImpl: this.deps.storeFetch, traceId } : { traceId });
    const catalog = await client.catalog();
    const hashes = new Map(catalog.items.map((it) => [it.id, itemHash(it)]));
    const lines: OverlayLine[] = overlay
      .filter((o) => hashes.has(o.itemId))
      .map((o) => ({ itemId: o.itemId, spokenName: (o.spokenName ?? "").trim() || o.itemId, summary: (o.summary ?? "").trim(), synonyms: (o.synonyms ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean), itemHash: hashes.get(o.itemId)! }));
    this.mark(store.origin, traceId, "human_confirm");
    const at = this.now().toISOString();
    this.deps.storage.onboarding.publish(slug, lines, policies, at);
    this.mark(store.origin, traceId, "published");
    log.log("info", "onboarding published", { slug, lines: lines.length });
    return this.state(slug, catalog.items);
  }

  async get(slug: string, traceId: string): Promise<OnboardingState> {
    const store = this.deps.storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    const client = new AgentPosStoreClient(store, this.deps.storeFetch ? { fetchImpl: this.deps.storeFetch, traceId } : { traceId });
    const catalog = await client.catalog().catch(() => null);
    return this.state(slug, catalog?.items ?? null);
  }

  private state(slug: string, items: CatalogItem[] | null): OnboardingState {
    const store = this.deps.storage.stores.get(slug);
    if (!store) throw storeNotFound(slug);
    const rec: OnboardingRecord | undefined = this.deps.storage.onboarding.get(slug);
    const stale = rec && items ? this.deps.storage.onboarding.overlayFor(slug, items).stale : [];
    const stages = this.stages(store.origin);
    const scan = stages.scan ? Date.parse(stages.scan) : null;
    const diff = (end: string | undefined) => (scan !== null && end && Date.parse(end) >= scan ? Date.parse(end) - scan : null);
    return {
      slug,
      origin: store.origin,
      status: rec?.status ?? "none",
      language: rec?.language ?? "en-US",
      overlay: rec?.overlay ?? [],
      policies: rec?.policies ?? null,
      modelUsed: rec?.modelUsed ?? false,
      stale,
      stages,
      elapsedMs: { scanToPublished: diff(stages.published), scanToFirstVoicePurchase: diff(stages.first_voice_purchase) },
    };
  }

  /** Latest timestamp per stage for the latest run (rows after the last scan). */
  private stages(storeOrigin: string): Partial<Record<OnboardingStage, string>> {
    const rows = this.deps.storage.usageEvents.list({ source: "agent.onboarding", storeOrigin, limit: 10_000 });
    const lastScan = rows.filter((r) => r.onboardingStage === "scan").at(-1);
    const out: Partial<Record<OnboardingStage, string>> = {};
    for (const r of rows) {
      if (!r.onboardingStage) continue;
      if (lastScan && r.at < lastScan.at) continue;
      out[r.onboardingStage] = r.at;
    }
    return out;
  }
}

/** Called by the checkout service on the first settled session after publication. */
export function markFirstVoicePurchase(storage: Storage, storeOrigin: string, traceId: string, at: string): boolean {
  const rows = storage.usageEvents.list({ source: "agent.onboarding", storeOrigin, limit: 10_000 });
  const lastScan = rows.filter((r) => r.onboardingStage === "scan").at(-1);
  if (!lastScan) return false;
  const since = rows.filter((r) => r.at >= lastScan.at);
  if (!since.some((r) => r.onboardingStage === "published")) return false;
  if (since.some((r) => r.onboardingStage === "first_voice_purchase")) return false;
  storage.usageEvents.record({ traceId, at, source: "agent.onboarding", storeOrigin, model: null, inputTokens: 0, outputTokens: 0, latencyMs: 0, estimatedCostUsdMicros: 0, onboardingStage: "first_voice_purchase", simulated: false });
  return true;
}
