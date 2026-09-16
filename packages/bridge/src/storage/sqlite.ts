/**
 * Storage adapter over node:sqlite. Opening it applies every DDL, so a judge needs no
 * migration step: one command, no services to create.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteStoreRegistry, STORES_DDL, type StoreRegistry } from "./store-registry.js";
import { SqliteUsageEventsRepo, type UsageEventsRepo } from "./usage-events-repo.js";
import { USAGE_EVENTS_DDL } from "./usage-events.js";

export interface Storage {
  readonly stores: StoreRegistry;
  readonly usageEvents: UsageEventsRepo;
  close(): void;
}

export interface OpenStorageOptions {
  /** File path, or ":memory:" for tests. */
  path: string;
}

export function openStorage(opts: OpenStorageOptions): Storage {
  if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(STORES_DDL);
  db.exec(USAGE_EVENTS_DDL);
  return {
    stores: new SqliteStoreRegistry(db),
    usageEvents: new SqliteUsageEventsRepo(db),
    close: () => db.close(),
  };
}
