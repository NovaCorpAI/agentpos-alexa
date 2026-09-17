/**
 * Household memory on Amazon Bedrock AgentCore Memory (the hosted runtime of #16). Same
 * contract as the SQLite runtime: order references only (Store add-on, order id, item ids,
 * titles, quantities), never an address, a name, an email or a payment detail.
 *
 * Mapping: one actor (the Demo household), one session per add-on, one JSON event per order
 * reference. Short-term memory only: no extraction strategies, so nothing is summarized or
 * inferred from the references, and events expire with the memory's event expiry.
 */
import { BedrockAgentCoreClient, CreateEventCommand, ListEventsCommand } from "@aws-sdk/client-bedrock-agentcore";
import { BedrockAgentCoreControlClient, CreateMemoryCommand, GetMemoryCommand, ListMemoriesCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import type { HouseholdMemory, OrderReference } from "./memory.js";

export const MEMORY_NAME = "agentpos_alexa_household";
const ACTOR = "demo-household";
const KIND = "agentpos.order_reference.v1";

/** The two calls this adapter makes, so tests can run it without AWS. */
export interface AgentCoreEvents {
  createEvent(input: { memoryId: string; actorId: string; sessionId: string; eventTimestamp: Date; payload: Array<{ json: { content: unknown } }> }): Promise<unknown>;
  listEvents(input: { memoryId: string; actorId: string; sessionId: string; includePayloads: boolean; maxResults: number; nextToken?: string }): Promise<{ events?: Array<{ eventTimestamp?: Date; payload?: Array<Record<string, unknown>> }>; nextToken?: string }>;
}

export function sdkEvents(region: string): AgentCoreEvents {
  const client = new BedrockAgentCoreClient({ region });
  return {
    createEvent: (input) => client.send(new CreateEventCommand(input as ConstructorParameters<typeof CreateEventCommand>[0])),
    listEvents: async (input) => (await client.send(new ListEventsCommand(input))) as Awaited<ReturnType<AgentCoreEvents["listEvents"]>>,
  };
}

/** Keeps only what a reference may hold; anything else in the input is dropped here. */
function reference(ref: OrderReference): OrderReference {
  return { addon: ref.addon, orderId: ref.orderId, at: ref.at, lines: ref.lines.map((l) => ({ itemId: l.itemId, title: l.title, quantity: l.quantity })) };
}

function sessionFor(addon: string): string {
  // Session ids allow letters, digits, hyphens and underscores; add-on slugs already do.
  return `orders-${addon}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
}

function parsePayload(p: Record<string, unknown>): OrderReference | undefined {
  // JSON events come back as { json: { content } }; blobs as a document or a string.
  const raw = p.json && typeof p.json === "object" && "content" in (p.json as object) ? (p.json as { content: unknown }).content : "blob" in p ? p.blob : undefined;
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return undefined;
  const v = value as { kind?: string; ref?: OrderReference };
  return v.kind === KIND && v.ref && typeof v.ref.orderId === "string" ? reference(v.ref) : undefined;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export class AgentCoreHouseholdMemory implements HouseholdMemory {
  constructor(
    private readonly memoryId: string,
    private readonly events: AgentCoreEvents,
  ) {}

  async remember(ref: OrderReference): Promise<void> {
    const clean = reference(ref);
    // Idempotent by order id: a reference already on record is not written twice.
    const existing = await this.recall(clean.addon, 50);
    if (existing.some((r) => r.orderId === clean.orderId)) return;
    await this.events.createEvent({ memoryId: this.memoryId, actorId: ACTOR, sessionId: sessionFor(clean.addon), eventTimestamp: new Date(clean.at), payload: [{ json: { content: { kind: KIND, ref: clean } } }] });
  }

  async recall(addon: string, limit = 5): Promise<OrderReference[]> {
    const out: OrderReference[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.events.listEvents({ memoryId: this.memoryId, actorId: ACTOR, sessionId: sessionFor(addon), includePayloads: true, maxResults: 100, ...(nextToken ? { nextToken } : {}) });
      for (const e of page.events ?? []) for (const p of e.payload ?? []) {
        const r = parsePayload(p);
        if (r && r.addon === addon) out.push(r);
      }
      nextToken = page.nextToken;
    } while (nextToken && out.length < 500);
    const unique = new Map(out.map((r) => [r.orderId, r]));
    return [...unique.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  }

  close(): void {}
}

/**
 * Finds the household memory by name, or creates it (short-term only, 30-day event expiry)
 * and waits until it is ACTIVE. Returns its id.
 */
export async function ensureMemory(region: string, log: (msg: string) => void = () => undefined): Promise<string> {
  const control = new BedrockAgentCoreControlClient({ region });
  let nextToken: string | undefined;
  do {
    const page = await control.send(new ListMemoriesCommand({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }));
    const found = (page.memories ?? []).find((m) => m.id?.startsWith(`${MEMORY_NAME}-`) && m.status !== "DELETING" && m.status !== "FAILED");
    if (found?.id) return waitActive(control, found.id, log);
    nextToken = page.nextToken;
  } while (nextToken);
  log(`creating AgentCore memory ${MEMORY_NAME}`);
  const created = await control.send(new CreateMemoryCommand({ name: MEMORY_NAME, description: "AgentPOS for Alexa+: Demo household order references only", eventExpiryDuration: 30 }));
  const id = created.memory?.id;
  if (!id) throw new Error("CreateMemory returned no id");
  return waitActive(control, id, log);
}

async function waitActive(control: BedrockAgentCoreControlClient, id: string, log: (msg: string) => void): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const m = await control.send(new GetMemoryCommand({ memoryId: id }));
    const status = m.memory?.status;
    if (status === "ACTIVE") return id;
    if (status === "FAILED" || status === "DELETING") throw new Error(`AgentCore memory ${id} is ${status}`);
    if (i === 0) log(`waiting for AgentCore memory ${id} (${status})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`AgentCore memory ${id} did not become ACTIVE in 5 minutes`);
}
