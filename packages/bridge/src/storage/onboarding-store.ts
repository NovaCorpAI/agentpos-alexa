/**
 * Onboarding state per Store: the Voice overlay (draft and published) and the proposed voice
 * policies. Kept by the Bridge, never written to the Store (CONTEXT.md). A published overlay
 * line is valid only while the item's hash matches the catalog; a changed item goes back to
 * the catalog's own words until the Merchant confirms a new line.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { OverlayEntry, PolicyDraft } from "@agentpos-alexa/agents";
import type { CatalogItem } from "@agentpos-alexa/store-client";

export type OnboardingStatus = "draft" | "published";

export interface OverlayLine extends OverlayEntry {
  spokenName: string;
  summary: string;
  synonyms: string[];
  /** Hash of the item as it was when this line was written. */
  itemHash: string;
}

export interface OnboardingRecord {
  slug: string;
  status: OnboardingStatus;
  language: "en-US" | "es-CL";
  overlay: OverlayLine[];
  policies: PolicyDraft;
  /** Whether a model wrote the draft (false: the deterministic drafter). */
  modelUsed: boolean;
  draftedAt: string;
  publishedAt: string | null;
}

export interface OnboardingRepo {
  saveDraft(rec: Omit<OnboardingRecord, "status" | "publishedAt">): OnboardingRecord;
  publish(slug: string, overlay: OverlayLine[], policies: PolicyDraft, at: string): OnboardingRecord;
  get(slug: string): OnboardingRecord | undefined;
  /** Published lines whose hash still matches the catalog, and the ids of the stale ones. */
  overlayFor(slug: string, items: CatalogItem[]): { overlay: OverlayLine[]; stale: string[] };
}

export const ONBOARDING_DDL = `
CREATE TABLE IF NOT EXISTS onboarding (
  slug         TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  language     TEXT NOT NULL,
  overlay      TEXT NOT NULL,
  policies     TEXT NOT NULL,
  model_used   INTEGER NOT NULL,
  drafted_at   TEXT NOT NULL,
  published_at TEXT
);
`;

/** Changes when the Store changes the item: title, description, price or attributes. */
export function itemHash(it: CatalogItem): string {
  return createHash("sha256").update(JSON.stringify([it.title, it.description, it.price.minor, it.price.asset, it.attributes ?? {}])).digest("hex").slice(0, 32);
}

interface Row {
  slug: string;
  status: string;
  language: string;
  overlay: string;
  policies: string;
  model_used: number;
  drafted_at: string;
  published_at: string | null;
}

function rowToRecord(r: Row): OnboardingRecord {
  return {
    slug: r.slug,
    status: r.status as OnboardingStatus,
    language: r.language === "es-CL" ? "es-CL" : "en-US",
    overlay: JSON.parse(r.overlay) as OverlayLine[],
    policies: JSON.parse(r.policies) as PolicyDraft,
    modelUsed: r.model_used === 1,
    draftedAt: r.drafted_at,
    publishedAt: r.published_at,
  };
}

export class SqliteOnboardingRepo implements OnboardingRepo {
  constructor(private readonly db: DatabaseSync) {}

  saveDraft(rec: Omit<OnboardingRecord, "status" | "publishedAt">): OnboardingRecord {
    // A new draft never unpublishes: the published overlay keeps serving until the Merchant
    // confirms the new one, so status stays "published" and only the draft columns move.
    const existing = this.get(rec.slug);
    const status: OnboardingStatus = existing?.status === "published" ? "published" : "draft";
    this.db
      .prepare(
        `INSERT INTO onboarding (slug, status, language, overlay, policies, model_used, drafted_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET language = excluded.language, overlay = excluded.overlay, policies = excluded.policies, model_used = excluded.model_used, drafted_at = excluded.drafted_at`,
      )
      .run(rec.slug, status, rec.language, JSON.stringify(rec.overlay), JSON.stringify(rec.policies), rec.modelUsed ? 1 : 0, rec.draftedAt, existing?.publishedAt ?? null);
    if (status === "published") this.db.prepare(`UPDATE onboarding SET status = 'draft' WHERE slug = ?`).run(rec.slug);
    return this.get(rec.slug)!;
  }

  publish(slug: string, overlay: OverlayLine[], policies: PolicyDraft, at: string): OnboardingRecord {
    const res = this.db.prepare(`UPDATE onboarding SET status = 'published', overlay = ?, policies = ?, published_at = ? WHERE slug = ?`).run(JSON.stringify(overlay), JSON.stringify(policies), at, slug);
    if (Number(res.changes) === 0) throw new RangeError(`No onboarding draft for ${slug}`);
    return this.get(slug)!;
  }

  get(slug: string): OnboardingRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM onboarding WHERE slug = ?`).get(slug) as unknown as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  overlayFor(slug: string, items: CatalogItem[]): { overlay: OverlayLine[]; stale: string[] } {
    const rec = this.get(slug);
    if (!rec || rec.status !== "published") return { overlay: [], stale: [] };
    const hashes = new Map(items.map((it) => [it.id, itemHash(it)]));
    const overlay: OverlayLine[] = [];
    const stale: string[] = [];
    for (const line of rec.overlay) {
      const h = hashes.get(line.itemId);
      if (h === undefined) continue;
      if (h === line.itemHash) overlay.push(line);
      else stale.push(line.itemId);
    }
    return { overlay, stale };
  }
}
