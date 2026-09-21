import { describe, expect, it } from "vitest";
import { buyerKeyOf, startOfMonth, summarize } from "./household.js";
import type { StoredSession } from "../storage/checkout-store.js";

const session = (orderId: string | undefined, total: number, lines: Array<[string, string, number]>, at: string): StoredSession =>
  ({
    session: {
      id: `cs_${orderId ?? "open"}`,
      status: orderId ? "completed" : "ready_for_complete",
      currency: "USD",
      line_items: lines.map(([id, title, quantity], i) => ({ id: `li_${i}`, item: { id, title, price: 0 }, quantity })),
      totals: [{ type: "total", amount: total }],
      ...(orderId ? { order: { id: orderId, permalink_url: "" } } : {}),
    },
    internal: {},
    createdAt: at,
    updatedAt: at,
  }) as unknown as StoredSession;

describe("a household's own purchases at one store", () => {
  it("adds up what settled, and names what it buys most", () => {
    const summary = summarize(
      [
        session("ord_2", 930, [["baguette", "Baguette", 1], ["sourdough-loaf", "Sourdough loaf", 1]], "2026-09-18T10:00:00.000Z"),
        session("ord_1", 560, [["baguette", "Baguette", 2]], "2026-09-04T10:00:00.000Z"),
      ],
      "2026-09-01T00:00:00.000Z",
    );

    expect(summary.totals).toEqual({ orders: 2, amountCents: 1490 });
    expect(summary.top[0]).toEqual({ itemId: "baguette", title: "Baguette", quantity: 3 });
    expect(summary.orders.map((o) => o.orderId)).toEqual(["ord_2", "ord_1"]);
  });

  it("leaves out a session that never became an order", () => {
    const summary = summarize([session(undefined, 5000, [["baguette", "Baguette", 20]], "2026-09-19T10:00:00.000Z")], "2026-09-01T00:00:00.000Z");
    expect(summary.totals).toEqual({ orders: 0, amountCents: 0 });
    expect(summary.orders).toEqual([]);
  });

  it("identifies the buyer the way the checkout did, and starts the month in UTC", () => {
    expect(buyerKeyOf(" Alex.Demo@Example.com ")).toBe(buyerKeyOf("alex.demo@example.com"));
    expect(startOfMonth(new Date("2026-09-21T18:30:00.000Z"))).toBe("2026-09-01T00:00:00.000Z");
  });
});
