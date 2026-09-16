import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { OnboardingStage, PurchaseOrigin, UsageEvent } from "./usage-events.js";

export type NewUsageEvent = Omit<UsageEvent, "id" | "at"> & { id?: string; at?: string };

export interface UsageEventsRepo {
  record(event: NewUsageEvent): UsageEvent;
  /** Newest last. */
  list(filter?: { traceId?: string; source?: UsageEvent["source"]; storeOrigin?: string; limit?: number }): UsageEvent[];
}

interface Row {
  id: string;
  trace_id: string;
  at: string;
  source: string;
  store_origin: string;
  checkout_session_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  estimated_cost_usd_micros: number;
  onboarding_stage: string | null;
  purchase_origin: string | null;
  payment_handler: string | null;
  simulated: number;
  psp_mode: string | null;
}

function rowToEvent(r: Row): UsageEvent {
  const e: UsageEvent = {
    id: r.id,
    traceId: r.trace_id,
    at: r.at,
    source: r.source as UsageEvent["source"],
    storeOrigin: r.store_origin,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    latencyMs: r.latency_ms,
    estimatedCostUsdMicros: r.estimated_cost_usd_micros,
    simulated: r.simulated === 1,
  };
  if (r.checkout_session_id) e.checkoutSessionId = r.checkout_session_id;
  if (r.onboarding_stage) e.onboardingStage = r.onboarding_stage as OnboardingStage;
  if (r.purchase_origin) e.purchaseOrigin = r.purchase_origin as PurchaseOrigin;
  if (r.payment_handler) e.paymentHandler = r.payment_handler;
  if (r.psp_mode) e.pspMode = r.psp_mode as UsageEvent["pspMode"] & string;
  return e;
}

export class SqliteUsageEventsRepo implements UsageEventsRepo {
  constructor(private readonly db: DatabaseSync) {}

  record(event: NewUsageEvent): UsageEvent {
    const full: UsageEvent = { ...event, id: event.id ?? randomUUID(), at: event.at ?? new Date().toISOString() };
    for (const [k, v] of [["inputTokens", full.inputTokens], ["outputTokens", full.outputTokens], ["latencyMs", full.latencyMs], ["estimatedCostUsdMicros", full.estimatedCostUsdMicros]] as const) {
      if (!Number.isInteger(v) || v < 0) throw new RangeError(`usage_events.${k} must be a non-negative integer`);
    }
    this.db
      .prepare(
        `INSERT INTO usage_events (id, trace_id, at, source, store_origin, checkout_session_id, model, input_tokens, output_tokens,
           latency_ms, estimated_cost_usd_micros, onboarding_stage, purchase_origin, payment_handler, simulated, psp_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.traceId,
        full.at,
        full.source,
        full.storeOrigin,
        full.checkoutSessionId ?? null,
        full.model,
        full.inputTokens,
        full.outputTokens,
        full.latencyMs,
        full.estimatedCostUsdMicros,
        full.onboardingStage ?? null,
        full.purchaseOrigin ?? null,
        full.paymentHandler ?? null,
        full.simulated ? 1 : 0,
        full.pspMode ?? null,
      );
    return full;
  }

  list(filter: { traceId?: string; source?: UsageEvent["source"]; storeOrigin?: string; limit?: number } = {}): UsageEvent[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.traceId) {
      where.push("trace_id = ?");
      params.push(filter.traceId);
    }
    if (filter.source) {
      where.push("source = ?");
      params.push(filter.source);
    }
    if (filter.storeOrigin) {
      where.push("store_origin = ?");
      params.push(filter.storeOrigin);
    }
    const sql = `SELECT * FROM usage_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at, rowid LIMIT ?`;
    params.push(filter.limit ?? 1000);
    const rows = this.db.prepare(sql).all(...params) as unknown as Row[];
    return rows.map(rowToEvent);
  }
}
