/**
 * CSV export of usage_events, in the documented column order (docs/USAGE-EVENTS.md), so
 * spreadsheets built on it do not break when fields are added at the end.
 */
import type { UsageEvent } from "./usage-events.js";
import { USAGE_EVENTS_CSV_COLUMNS } from "./usage-events.js";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const FIELD_BY_COLUMN: Record<(typeof USAGE_EVENTS_CSV_COLUMNS)[number], (e: UsageEvent) => unknown> = {
  id: (e) => e.id,
  trace_id: (e) => e.traceId,
  at: (e) => e.at,
  source: (e) => e.source,
  store_origin: (e) => e.storeOrigin,
  checkout_session_id: (e) => e.checkoutSessionId,
  model: (e) => e.model,
  input_tokens: (e) => e.inputTokens,
  output_tokens: (e) => e.outputTokens,
  latency_ms: (e) => e.latencyMs,
  estimated_cost_usd_micros: (e) => e.estimatedCostUsdMicros,
  onboarding_stage: (e) => e.onboardingStage,
  purchase_origin: (e) => e.purchaseOrigin,
  payment_handler: (e) => e.paymentHandler,
  simulated: (e) => e.simulated,
  psp_mode: (e) => e.pspMode,
};

export function usageEventsToCsv(events: UsageEvent[]): string {
  const header = USAGE_EVENTS_CSV_COLUMNS.join(",");
  const rows = events.map((e) => USAGE_EVENTS_CSV_COLUMNS.map((c) => cell(FIELD_BY_COLUMN[c](e))).join(","));
  return [header, ...rows].join("\r\n") + "\r\n";
}

/** Totals the cost report needs: per source and per closed checkout session. */
export function summarizeUsage(events: UsageEvent[]): {
  bySource: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsdMicros: number }>;
  perSession: Array<{ checkoutSessionId: string; calls: number; costUsdMicros: number; simulated: boolean }>;
} {
  const bySource: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsdMicros: number }> = {};
  const sessions = new Map<string, { checkoutSessionId: string; calls: number; costUsdMicros: number; simulated: boolean }>();
  for (const e of events) {
    const s = (bySource[e.source] ??= { calls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 });
    s.calls += 1;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.costUsdMicros += e.estimatedCostUsdMicros;
    if (e.checkoutSessionId) {
      const p = sessions.get(e.checkoutSessionId) ?? { checkoutSessionId: e.checkoutSessionId, calls: 0, costUsdMicros: 0, simulated: false };
      p.calls += 1;
      p.costUsdMicros += e.estimatedCostUsdMicros;
      p.simulated = p.simulated || e.simulated;
      sessions.set(e.checkoutSessionId, p);
    }
  }
  return { bySource, perSession: [...sessions.values()] };
}
