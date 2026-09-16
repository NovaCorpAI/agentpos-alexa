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
  /** ISO 8601, UTC. */
  registeredAt: string;
}

export interface StoreRegistry {
  register(slug: string, store: StoreEndpoints): RegisteredStore;
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
  registered_at    TEXT NOT NULL
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
    registeredAt: r.registered_at,
  };
}

export class SqliteStoreRegistry implements StoreRegistry {
  constructor(private readonly db: DatabaseSync) {}

  register(slug: string, store: StoreEndpoints): RegisteredStore {
    if (!isValidSlug(slug)) {
      throw new RangeError(`Invalid store slug ${JSON.stringify(slug)}`);
    }
    const registeredAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO stores (slug, origin, ucp_version, rest_base, mcp_endpoint, payment_handlers, profile, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           origin = excluded.origin, ucp_version = excluded.ucp_version, rest_base = excluded.rest_base,
           mcp_endpoint = excluded.mcp_endpoint, payment_handlers = excluded.payment_handlers,
           profile = excluded.profile`,
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
