import { describe, expect, it } from "vitest";
import { AgentCoreHouseholdMemory, type AgentCoreEvents } from "./agentcore-memory.js";
import { SqliteHouseholdMemory, type HouseholdMemory, type OrderReference } from "./memory.js";

/** An in-memory stand-in for AgentCore's CreateEvent and ListEvents, paging by 2. */
function fakeEvents(): AgentCoreEvents & { written: unknown[] } {
  const store = new Map<string, Array<{ eventTimestamp: Date; payload: Array<Record<string, unknown>> }>>();
  const written: unknown[] = [];
  return {
    written,
    async createEvent(input) {
      written.push(input);
      const key = `${input.memoryId}/${input.actorId}/${input.sessionId}`;
      // AgentCore returns JSON payloads as documents; one of them comes back as a string to cover both.
      const payload = input.payload.map((p, i) => (i === 0 && (store.get(key)?.length ?? 0) === 1 ? { json: JSON.stringify(p.json) } : { json: p.json }));
      store.set(key, [...(store.get(key) ?? []), { eventTimestamp: input.eventTimestamp, payload }]);
      return {};
    },
    async listEvents(input) {
      const all = store.get(`${input.memoryId}/${input.actorId}/${input.sessionId}`) ?? [];
      const start = Number(input.nextToken ?? 0);
      const events = all.slice(start, start + 2);
      return start + 2 < all.length ? { events, nextToken: String(start + 2) } : { events };
    },
  };
}

const refs: OrderReference[] = [
  { addon: "bakery", orderId: "ord_1", at: "2026-09-10T10:00:00Z", lines: [{ itemId: "sourdough-loaf", title: "Sourdough loaf", quantity: 2 }] },
  { addon: "bakery", orderId: "ord_2", at: "2026-09-12T10:00:00Z", lines: [{ itemId: "baguette", title: "Baguette", quantity: 1 }] },
  { addon: "bakery", orderId: "ord_3", at: "2026-09-11T10:00:00Z", lines: [{ itemId: "rye-loaf", title: "Dark rye loaf", quantity: 1 }] },
  { addon: "other", orderId: "ord_9", at: "2026-09-13T10:00:00Z", lines: [{ itemId: "x", title: "X", quantity: 1 }] },
];

describe.each<[string, () => HouseholdMemory & { written?: unknown[] }]>([
  ["SQLite", () => new SqliteHouseholdMemory(":memory:")],
  [
    "AgentCore",
    () => {
      const events = fakeEvents();
      return Object.assign(new AgentCoreHouseholdMemory("agentpos_alexa_household-abc123", events), { written: events.written });
    },
  ],
])("household memory on %s", (_name, make) => {
  it("recalls references newest first per add-on, once per order, and holds nothing but references", async () => {
    const memory = make();
    for (const r of refs) await memory.remember(r);
    // Personal data smuggled into a reference never reaches storage.
    await memory.remember({ ...refs[0]!, email: "alex@example.com", address: "1 Fixture Street" } as OrderReference);
    const recalled = await memory.recall("bakery", 5);
    expect(recalled.map((r) => r.orderId)).toEqual(["ord_2", "ord_3", "ord_1"]);
    expect(await memory.recall("bakery", 1)).toEqual([refs[1]]);
    expect((await memory.recall("other")).map((r) => r.orderId)).toEqual(["ord_9"]);
    expect(JSON.stringify(recalled)).not.toMatch(/alex@|Fixture Street/);
    if (memory.written) {
      expect(memory.written).toHaveLength(4);
      expect(JSON.stringify(memory.written)).not.toMatch(/alex@|Fixture Street/);
      expect(memory.written[0]).toMatchObject({ memoryId: "agentpos_alexa_household-abc123", actorId: "demo-household", sessionId: "orders-bakery" });
    }
    memory.close();
  });
});
