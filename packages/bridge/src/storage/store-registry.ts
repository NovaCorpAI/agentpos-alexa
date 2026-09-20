/**
 * Store registry: the Stores this Bridge serves, one slug each.
 *
 * Holds only what is public about a Store (its origin, the endpoints it publishes and its
 * UCP profile). Never a secret, never a key (hard rule 1).
 */
import type { DatabaseSync } from "node:sqlite";
import type { StoreEndpoints } from "@agentpos-alexa/store-client";

export interface RegisteredStore extends StoreEndpoints {
  slug: string;
  /** What the Store calls itself, as published in its catalog. Empty until it is read. */
  displayName: string;
  /** ISO 8601, UTC. */
  registeredAt: string;
}

export interface StoreRegistry {
  /** A name that is not given keeps the one already stored, so a re-register never loses it. */
  register(slug: string, store: StoreEndpoints, displayName?: string): RegisteredStore;
  get(slug: string): RegisteredStore | undefined;
  list(): RegisteredStore[];
}

export const STORES_DDL = `
CREATE TABLE IF NOT EXISTS stores (
  slug             TEXT PRIMARY KEY,
  origin           TEXT NOT NULL,
  ucp_version      TEXT NOT NULL,
  rest_base        TEXT NOT NULL,
  mcp_endpoint     TEXT NOT NULL,
  payment_handlers TEXT NOT NULL,
  profile          TEXT NOT NULL,
  registered_at    TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT ''
);
`;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Derives a URL-safe slug from a Store origin: `https://shop.example` becomes `shop-example`. */
export function slugFromOrigin(origin: string): string {
  const host = new URL(origin).hostname.toLowerCase();
  const slug = host.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug.replace(/-+$/g, "") || "store";
}

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

interface Row {
  slug: string;
  origin: string;
  ucp_version: string;
  rest_base: string;
  mcp_endpoint: string;
  payment_handlers: string;
  profile: string;
  registered_at: string;
  display_name: string | null;
}

function rowToStore(r: Row): RegisteredStore {
  return {
    slug: r.slug,
    origin: r.origin,
    ucpVersion: r.ucp_version,
    restBase: r.rest_base,
    mcpEndpoint: r.mcp_endpoint,
    paymentHandlers: JSON.parse(r.payment_handlers) as string[],
    profile: JSON.parse(r.profile) as unknown,
    displayName: r.display_name ?? "",
    registeredAt: r.registered_at,
  };
}

export class SqliteStoreRegistry implements StoreRegistry {
  constructor(private readonly db: DatabaseSync) {}

  register(slug: string, store: StoreEndpoints, displayName?: string): RegisteredStore {
    if (!isValidSlug(slug)) {
      throw new RangeError(`Invalid store slug ${JSON.stringify(slug)}`);
    }
    const registeredAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO stores (slug, origin, ucp_version, rest_base, mcp_endpoint, payment_handlers, profile, registered_at, display_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           origin = excluded.origin, ucp_version = excluded.ucp_version, rest_base = excluded.rest_base,
           mcp_endpoint = excluded.mcp_endpoint, payment_handlers = excluded.payment_handlers,
           profile = excluded.profile,
           display_name = CASE WHEN excluded.display_name = '' THEN stores.display_name ELSE excluded.display_name END`,
      )
      .run(
        slug,
        store.origin,
        store.ucpVersion,
        store.restBase,
        store.mcpEndpoint,
        JSON.stringify(store.paymentHandlers),
        JSON.stringify(store.profile ?? null),
        registeredAt,
        displayName ?? "",
      );
    const saved = this.get(slug);
    if (!saved) throw new Error("store vanished after insert");
    return saved;
  }

  get(slug: string): RegisteredStore | undefined {
    const row = this.db.prepare(`SELECT * FROM stores WHERE slug = ?`).get(slug) as unknown as Row | undefined;
    return row ? rowToStore(row) : undefined;
  }

  list(): RegisteredStore[] {
    const rows = this.db.prepare(`SELECT * FROM stores ORDER BY registered_at, slug`).all() as unknown as Row[];
    return rows.map(rowToStore);
  }
}
