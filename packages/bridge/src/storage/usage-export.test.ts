import { describe, expect, it } from "vitest";
import { openStorage } from "./sqlite.js";
import { summarizeUsage, usageEventsToCsv } from "./usage-export.js";
import { USAGE_EVENTS_CSV_COLUMNS } from "./usage-events.js";

describe("usage_events export", () => {
  it("writes the documented columns in order, quotes what needs quoting, and round-trips through SQLite", () => {
    const storage = openStorage({ path: ":memory:" });
    storage.usageEvents.record({ traceId: "t1", source: "bridge.mcp", storeOrigin: "http://bakery.test", model: null, inputTokens: 0, outputTokens: 0, latencyMs: 12, estimatedCostUsdMicros: 0, simulated: false });
    storage.usageEvents.record({ traceId: "t2", source: "bridge.checkout", storeOrigin: "http://bakery.test", checkoutSessionId: "cs_1", model: null, inputTokens: 0, outputTokens: 0, latencyMs: 7, estimatedCostUsdMicros: 0, paymentHandler: "com.amazon.payments.network_token/amazon_pay_network_token", simulated: true, pspMode: "simulated", purchaseOrigin: "own" });
    storage.usageEvents.record({ traceId: "t3", source: "agent.catalog", storeOrigin: "http://bakery.test", checkoutSessionId: "cs_1", model: "amazon.nova-2-lite-v1:0", inputTokens: 812, outputTokens: 96, latencyMs: 640, estimatedCostUsdMicros: 74, simulated: false, onboardingStage: undefined as never });
    const events = storage.usageEvents.list();
    const csv = usageEventsToCsv(events);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(USAGE_EVENTS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/,1,simulated$/);
    expect(lines[2]).toContain("com.amazon.payments.network_token/amazon_pay_network_token");
    expect(lines[3]).toContain(",amazon.nova-2-lite-v1:0,812,96,640,74,");
    expect(usageEventsToCsv([{ ...events[0]!, traceId: 'a,"b"' }]).split("\r\n")[1]).toContain('"a,""b"""');

    const summary = summarizeUsage(events);
    expect(summary.bySource["agent.catalog"]).toEqual({ calls: 1, inputTokens: 812, outputTokens: 96, costUsdMicros: 74 });
    expect(summary.perSession).toEqual([{ checkoutSessionId: "cs_1", calls: 2, costUsdMicros: 74, simulated: true }]);
    storage.close();
  });
});
