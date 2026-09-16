import { describe, expect, it } from "vitest";
import { findings, Guardian, type GuardianInput } from "./guardian.js";
import { FakeModel } from "./testing/fake-model.js";

const now = new Date("2026-09-16T12:00:00Z");
const lines = [{ itemId: "sourdough-loaf", title: "Sourdough loaf", quantity: 2 }];
const base: GuardianInput = { storeName: "Sourdough & Co.", language: "en-US", lines, totalCents: 1300, currency: "USD", recentOrders: [], now };

describe("guardian rules", () => {
  it("flags the same lines by the same buyer within seven days, not older or different orders", () => {
    expect(findings(base)).toEqual([]);
    const fiveDays = { ...base, recentOrders: [{ orderId: "ord_1", at: "2026-09-11T12:00:00Z", lines, totalCents: 1300 }] };
    expect(findings(fiveDays)).toEqual([{ code: "duplicate_order", summary: "Same items as order ord_1 placed 5 days ago", previous: fiveDays.recentOrders[0] }]);
    const old = { ...base, recentOrders: [{ orderId: "ord_0", at: "2026-09-01T12:00:00Z", lines, totalCents: 1300 }] };
    expect(findings(old)).toEqual([]);
    const other = { ...base, recentOrders: [{ orderId: "ord_2", at: "2026-09-15T12:00:00Z", lines: [{ ...lines[0]!, quantity: 1 }], totalCents: 650 }] };
    expect(findings(other)).toEqual([]);
  });
});

describe("Guardian", () => {
  const dup = { ...base, recentOrders: [{ orderId: "ord_1", at: "2026-09-11T12:00:00Z", lines, totalCents: 1300 }] };

  it("allows silently when no rule fires", async () => {
    expect(await new Guardian().review(base)).toMatchObject({ decision: "allow", code: "ok", modelUsed: false });
  });

  it("without a model, the rule decides review with a fixed voice sentence", async () => {
    const v = await new Guardian().review(dup);
    expect(v).toMatchObject({ decision: "review", code: "duplicate_order", modelUsed: false });
    expect(v.reason).toBe("You already ordered 2 Sourdough loaf 5 days ago. Do you want to order it again?");
    const es = await new Guardian().review({ ...dup, language: "es-CL" });
    expect(es.reason).toContain("Ya pediste 2 Sourdough loaf hace 5 días");
  });

  it("with a model, takes its decision and sentence and reports usage", async () => {
    const usage: Array<{ inputTokens: number }> = [];
    const model = new FakeModel([{ text: JSON.stringify({ decision: "review", reason: "You ordered two sourdough loaves five days ago; shall I place the same order again?" }) }]);
    const g = new Guardian({ model, modelId: "fake.strong", onUsage: (u) => usage.push(u) });
    const v = await g.review(dup);
    expect(v).toMatchObject({ decision: "review", code: "duplicate_order", modelUsed: true });
    expect(v.reason).toMatch(/five days ago/);
    expect(usage).toHaveLength(1);
    expect(model.calls[0]!.options!.systemPrompt).toBeDefined();
  });

  it("falls back to the rule when the model answers nonsense", async () => {
    const model = new FakeModel([{ text: "I refuse to answer in JSON." }]);
    const v = await new Guardian({ model, modelId: "fake.strong" }).review(dup);
    expect(v).toMatchObject({ decision: "review", modelUsed: false });
  });
});
