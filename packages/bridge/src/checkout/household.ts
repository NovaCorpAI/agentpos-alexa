/**
 * What one household has actually bought at one Store through this Bridge, read back from
 * the sessions that settled. The host asks for it to answer "what have I ordered" and "how
 * much have I spent this month"; the Store stays the merchant of record and the Bridge adds
 * nothing to what it already had to keep.
 *
 * The buyer is identified the same way the guardian identifies them: the hash of the email
 * the host sent at checkout. No address is stored here, and none is returned.
 */
import { createHash } from "node:crypto";
import type { StoredSession } from "../storage/checkout-store.js";

export interface PurchaseLine {
  itemId: string;
  title: string;
  quantity: number;
}

export interface Purchase {
  orderId: string;
  at: string;
  totalCents: number;
  lines: PurchaseLine[];
}

export interface PurchaseSummary {
  since: string;
  currency: string;
  orders: Purchase[];
  totals: { orders: number; amountCents: number };
  /** What the household buys most in the window, most bought first. */
  top: PurchaseLine[];
}

/** The same key the checkout stores with a session: sha256 of the lowercased email. */
export function buyerKeyOf(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** The first instant of the current month, in UTC, as the period a household means by "this month". */
export function startOfMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function startOfDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

const totalOf = (s: StoredSession): number => s.session.totals.find((t) => t.type === "total")?.amount ?? 0;

/** Rolls settled sessions into what a person would say back: the orders, the total, the habit. */
export function summarize(sessions: StoredSession[], since: string): PurchaseSummary {
  const orders: Purchase[] = sessions
    .filter((s) => s.session.order)
    .map((s) => ({
      orderId: s.session.order!.id,
      at: s.updatedAt,
      totalCents: totalOf(s),
      lines: s.session.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
    }));

  const counts = new Map<string, PurchaseLine>();
  for (const order of orders) {
    for (const line of order.lines) {
      const seen = counts.get(line.itemId);
      if (seen) seen.quantity += line.quantity;
      else counts.set(line.itemId, { ...line });
    }
  }

  return {
    since,
    currency: sessions[0]?.session.currency ?? "USD",
    orders,
    totals: { orders: orders.length, amountCents: orders.reduce((sum, o) => sum + o.totalCents, 0) },
    top: [...counts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3),
  };
}
