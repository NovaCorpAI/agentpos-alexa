/**
 * Household memory: what the Demo household ordered before, as references only (Store,
 * item ids, quantities, order id), never the order's content or any personal data
 * (docs/STRATEGY.md, decision on household memory). One interface, two runtimes: SQLite
 * locally, AgentCore Memory in the hosted playground (#16).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OrderReference {
  addon: string;
  orderId: string;
  at: string;
  lines: Array<{ itemId: string; title: string; quantity: number }>;
}

export interface HouseholdMemory {
  remember(ref: OrderReference): void;
  /** Newest first. */
  recall(addon: string, limit?: number): OrderReference[];
  close(): void;
}

const DDL = `
CREATE TABLE IF NOT EXISTS household_orders (
  order_id TEXT PRIMARY KEY,
  addon    TEXT NOT NULL,
  at       TEXT NOT NULL,
  lines    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS household_orders_addon ON household_orders (addon, at);
`;

export class SqliteHouseholdMemory implements HouseholdMemory {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(DDL);
  }

  remember(ref: OrderReference): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO household_orders (order_id, addon, at, lines) VALUES (?, ?, ?, ?)`)
      .run(ref.orderId, ref.addon, ref.at, JSON.stringify(ref.lines.map((l) => ({ itemId: l.itemId, title: l.title, quantity: l.quantity }))));
  }

  recall(addon: string, limit = 5): OrderReference[] {
    const rows = this.db.prepare(`SELECT order_id, addon, at, lines FROM household_orders WHERE addon = ? ORDER BY at DESC LIMIT ?`).all(addon, limit) as unknown as Array<{
      order_id: string;
      addon: string;
      at: string;
      lines: string;
    }>;
    return rows.map((r) => ({ orderId: r.order_id, addon: r.addon, at: r.at, lines: JSON.parse(r.lines) as OrderReference["lines"] }));
  }

  close(): void {
    this.db.close();
  }
}
