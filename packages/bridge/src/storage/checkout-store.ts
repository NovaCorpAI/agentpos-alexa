/**
 * Checkout persistence: sessions, idempotency keys (24 h), OAuth clients and tokens.
 * Session bodies hold the buyer's data because the Store needs it; they are never logged.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CheckoutSession } from "../checkout/types.js";
import type { SessionInternal } from "../rails/rail.js";

export const CHECKOUT_DDL = `
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  status      TEXT NOT NULL,
  body        TEXT NOT NULL,
  internal    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_sessions_slug ON checkout_sessions (slug, created_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT NOT NULL,
  slug        TEXT NOT NULL,
  scope       TEXT NOT NULL,
  body_hash   TEXT NOT NULL,
  status      INTEGER NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (key, slug, scope)
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id   TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  scopes      TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
`;

export interface StoredSession {
  session: CheckoutSession;
  internal: SessionInternal;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotentResponse {
  status: number;
  body: unknown;
  bodyHash: string;
}

export interface CheckoutRepo {
  save(session: CheckoutSession, internal: SessionInternal): void;
  get(id: string): StoredSession | undefined;
  /** Newest last. */
  listBySlug(slug: string, limit?: number): StoredSession[];
}

export interface IdempotencyRepo {
  lookup(key: string, slug: string, scope: string): IdempotentResponse | undefined;
  remember(key: string, slug: string, scope: string, bodyHash: string, status: number, body: unknown): void;
  /** Drops keys older than the retention window. */
  prune(olderThanIso: string): number;
}

export interface OAuthRepo {
  registerClient(clientId: string, secret: string): void;
  verifyClient(clientId: string, secret: string): boolean;
  issueToken(clientId: string, scopes: string[], ttlSeconds: number): { token: string; expiresAt: number };
  lookupToken(token: string): { clientId: string; scopes: string[]; expiresAt: number } | undefined;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class SqliteCheckoutRepo implements CheckoutRepo {
  constructor(private readonly db: DatabaseSync) {}

  save(session: CheckoutSession, internal: SessionInternal): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO checkout_sessions (id, slug, status, body, internal, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body, internal = excluded.internal,
           updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
      )
      .run(session.id, internal.slug, session.status, JSON.stringify(session), JSON.stringify(internal), now, now, session.expires_at);
  }

  get(id: string): StoredSession | undefined {
    const row = this.db.prepare(`SELECT * FROM checkout_sessions WHERE id = ?`).get(id) as unknown as
      | { body: string; internal: string; created_at: string; updated_at: string }
      | undefined;
    if (!row) return undefined;
    return { session: JSON.parse(row.body) as CheckoutSession, internal: JSON.parse(row.internal) as SessionInternal, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listBySlug(slug: string, limit = 100): StoredSession[] {
    const rows = this.db.prepare(`SELECT * FROM checkout_sessions WHERE slug = ? ORDER BY created_at LIMIT ?`).all(slug, limit) as unknown as Array<{
      body: string;
      internal: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({ session: JSON.parse(row.body) as CheckoutSession, internal: JSON.parse(row.internal) as SessionInternal, createdAt: row.created_at, updatedAt: row.updated_at }));
  }
}

export class SqliteIdempotencyRepo implements IdempotencyRepo {
  constructor(private readonly db: DatabaseSync) {}

  lookup(key: string, slug: string, scope: string): IdempotentResponse | undefined {
    const row = this.db.prepare(`SELECT body_hash, status, response FROM idempotency_keys WHERE key = ? AND slug = ? AND scope = ?`).get(key, slug, scope) as unknown as
      | { body_hash: string; status: number; response: string }
      | undefined;
    if (!row) return undefined;
    return { status: row.status, body: JSON.parse(row.response) as unknown, bodyHash: row.body_hash };
  }

  remember(key: string, slug: string, scope: string, bodyHash: string, status: number, body: unknown): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO idempotency_keys (key, slug, scope, body_hash, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(key, slug, scope, bodyHash, status, JSON.stringify(body), new Date().toISOString());
  }

  prune(olderThanIso: string): number {
    const r = this.db.prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`).run(olderThanIso);
    return Number(r.changes);
  }
}

export class SqliteOAuthRepo implements OAuthRepo {
  constructor(private readonly db: DatabaseSync) {}

  registerClient(clientId: string, secret: string): void {
    this.db
      .prepare(`INSERT INTO oauth_clients (client_id, secret_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET secret_hash = excluded.secret_hash`)
      .run(clientId, sha256(secret), new Date().toISOString());
  }

  verifyClient(clientId: string, secret: string): boolean {
    const row = this.db.prepare(`SELECT secret_hash FROM oauth_clients WHERE client_id = ?`).get(clientId) as unknown as { secret_hash: string } | undefined;
    return row !== undefined && row.secret_hash === sha256(secret);
  }

  issueToken(clientId: string, scopes: string[], ttlSeconds: number): { token: string; expiresAt: number } {
    const token = `bt_${cryptoRandom(32)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    this.db.prepare(`INSERT INTO oauth_tokens (token_hash, client_id, scopes, expires_at) VALUES (?, ?, ?, ?)`).run(sha256(token), clientId, scopes.join(" "), expiresAt);
    return { token, expiresAt };
  }

  lookupToken(token: string): { clientId: string; scopes: string[]; expiresAt: number } | undefined {
    const row = this.db.prepare(`SELECT client_id, scopes, expires_at FROM oauth_tokens WHERE token_hash = ?`).get(sha256(token)) as unknown as
      | { client_id: string; scopes: string; expires_at: number }
      | undefined;
    if (!row) return undefined;
    return { clientId: row.client_id, scopes: row.scopes.split(" ").filter(Boolean), expiresAt: Number(row.expires_at) };
  }
}

function cryptoRandom(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
