/**
 * The playground's waitlist: merchants who want their store on Alexa+ and shoppers who want
 * to hear when it ships. Stored with explicit consent, exported only with the admin token.
 * SQLite on the task's disk: the deploy script exports it before every redeploy.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type WaitlistRole = "merchant" | "shopper";

export interface WaitlistEntry {
  email: string;
  role: WaitlistRole;
  storeUrl: string | null;
  at: string;
}

export interface WaitlistInput {
  email?: unknown;
  role?: unknown;
  storeUrl?: unknown;
  consent?: unknown;
}

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i;

/** Validates what a visitor sent; returns the entry or a message fit to show them. */
export function parseWaitlist(input: WaitlistInput, now: Date): { ok: true; entry: WaitlistEntry } | { ok: false; message: string } {
  if (input.consent !== true) return { ok: false, message: "Please tick the box to agree that we email you about AgentPOS for Alexa+." };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { ok: false, message: "That email address does not look right." };
  const role: WaitlistRole = input.role === "merchant" ? "merchant" : "shopper";
  let storeUrl: string | null = null;
  if (typeof input.storeUrl === "string" && input.storeUrl.trim()) {
    try {
      const u = new URL(input.storeUrl.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      storeUrl = u.origin;
    } catch {
      return { ok: false, message: "The store address should be a web address like https://your-store.example." };
    }
  }
  return { ok: true, entry: { email, role, storeUrl, at: now.toISOString() } };
}

export class SqliteWaitlist {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, role TEXT NOT NULL, store_url TEXT, at TEXT NOT NULL)`);
  }

  /** Idempotent by email: joining twice keeps one row and the latest details. */
  add(e: WaitlistEntry): void {
    this.db
      .prepare(`INSERT INTO waitlist (email, role, store_url, at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, store_url = COALESCE(excluded.store_url, waitlist.store_url)`)
      .run(e.email, e.role, e.storeUrl, e.at);
  }

  count(): { merchants: number; shoppers: number } {
    const rows = this.db.prepare(`SELECT role, COUNT(*) AS n FROM waitlist GROUP BY role`).all() as unknown as Array<{ role: string; n: number }>;
    const n = (r: string) => Number(rows.find((x) => x.role === r)?.n ?? 0);
    return { merchants: n("merchant"), shoppers: n("shopper") };
  }

  list(): WaitlistEntry[] {
    return (this.db.prepare(`SELECT email, role, store_url, at FROM waitlist ORDER BY at`).all() as unknown as Array<{ email: string; role: string; store_url: string | null; at: string }>).map((r) => ({
      email: r.email,
      role: r.role === "merchant" ? "merchant" : "shopper",
      storeUrl: r.store_url,
      at: r.at,
    }));
  }

  toCsv(): string {
    const cell = (v: string | null) => (v === null ? "" : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return ["email,role,store_url,at", ...this.list().map((e) => [e.email, e.role, e.storeUrl, e.at].map(cell).join(","))].join("\r\n") + "\r\n";
  }

  close(): void {
    this.db.close();
  }
}
