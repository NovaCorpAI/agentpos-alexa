/**
 * Storage adapter over node:sqlite. Opening it applies every DDL, so a judge needs no
 * migration step: one command, no services to create.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CHECKOUT_DDL,
  SqliteCheckoutRepo,
  SqliteIdempotencyRepo,
  SqliteOAuthRepo,
  type CheckoutRepo,
  type IdempotencyRepo,
  type OAuthRepo,
} from "./checkout-store.js";
import { ONBOARDING_DDL, SqliteOnboardingRepo, type OnboardingRepo } from "./onboarding-store.js";
import { SqliteStoreRegistry, STORES_DDL, type StoreRegistry } from "./store-registry.js";
import { SqliteUsageEventsRepo, type UsageEventsRepo } from "./usage-events-repo.js";
import { USAGE_EVENTS_DDL } from "./usage-events.js";

export interface Storage {
  readonly stores: StoreRegistry;
  readonly usageEvents: UsageEventsRepo;
  readonly checkout: CheckoutRepo;
  readonly idempotency: IdempotencyRepo;
  readonly oauth: OAuthRepo;
  readonly onboarding: OnboardingRepo;
  close(): void;
}

export interface OpenStorageOptions {
  /** File path, or ":memory:" for tests. */
  path: string;
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function openStorage(opts: OpenStorageOptions): Storage {
  if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(STORES_DDL);
  db.exec(USAGE_EVENTS_DDL);
  db.exec(CHECKOUT_DDL);
  db.exec(ONBOARDING_DDL);
  // Additive migrations for databases created by earlier runs: columns the DDL gained later.
  addColumnIfMissing(db, "usage_events", "psp_mode", "TEXT");
  addColumnIfMissing(db, "usage_events", "cache_read_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "usage_events", "cache_write_tokens", "INTEGER NOT NULL DEFAULT 0");
  return {
    stores: new SqliteStoreRegistry(db),
    usageEvents: new SqliteUsageEventsRepo(db),
    checkout: new SqliteCheckoutRepo(db),
    idempotency: new SqliteIdempotencyRepo(db),
    oauth: new SqliteOAuthRepo(db),
    onboarding: new SqliteOnboardingRepo(db),
    close: () => db.close(),
  };
}
