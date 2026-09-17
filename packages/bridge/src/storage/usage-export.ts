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

/** Parses a CSV written by usageEventsToCsv back into events (the round trip the submission CSV needs). */
export function csvToUsageEvents(csv: string): UsageEvent[] {
  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const at = (row: string[], col: (typeof USAGE_EVENTS_CSV_COLUMNS)[number]) => row[header.indexOf(col)] ?? "";
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? "") !== "")
    .map((r) => {
      const e: UsageEvent = {
        id: at(r, "id"),
        traceId: at(r, "trace_id"),
        at: at(r, "at"),
        source: at(r, "source") as UsageEvent["source"],
        storeOrigin: at(r, "store_origin"),
        model: at(r, "model") || null,
        inputTokens: Number(at(r, "input_tokens")),
        outputTokens: Number(at(r, "output_tokens")),
        latencyMs: Number(at(r, "latency_ms")),
        estimatedCostUsdMicros: Number(at(r, "estimated_cost_usd_micros")),
        simulated: at(r, "simulated") === "1",
      };
      const optional: Array<[keyof UsageEvent, string]> = [
        ["checkoutSessionId", at(r, "checkout_session_id")],
        ["onboardingStage", at(r, "onboarding_stage")],
        ["purchaseOrigin", at(r, "purchase_origin")],
        ["paymentHandler", at(r, "payment_handler")],
        ["pspMode", at(r, "psp_mode")],
      ];
      for (const [k, v] of optional) if (v !== "") (e as unknown as Record<string, unknown>)[k] = v;
      return e;
    });
}

/** RFC 4180 reader: quoted cells, doubled quotes, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cellText = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cellText += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cellText += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cellText);
      cellText = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cellText);
      rows.push(row);
      row = [];
      cellText = "";
    } else cellText += ch;
  }
  if (cellText !== "" || row.length) {
    row.push(cellText);
    rows.push(row);
  }
  return rows;
}

/**
 * Inference cost of a closed checkout session: every model call of the period (Household
 * agent, catalog, guardian) divided by the checkout sessions that completed in it.
 * Onboarding is per Store, not per session, so it is reported apart.
 */
export function costPerClosedSession(events: UsageEvent[], closedSessions: number): {
  closedSessions: number;
  sessionModelCalls: number;
  sessionCostUsdMicros: number;
  costPerClosedSessionUsdMicros: number | null;
  bySource: Record<string, { calls: number; costUsdMicros: number }>;
  onboarding: { calls: number; costUsdMicros: number };
} {
  const bySource: Record<string, { calls: number; costUsdMicros: number }> = {};
  const onboarding = { calls: 0, costUsdMicros: 0 };
  let calls = 0;
  let cost = 0;
  for (const e of events) {
    if (!e.model) continue;
    if (e.source === "agent.onboarding") {
      onboarding.calls += 1;
      onboarding.costUsdMicros += e.estimatedCostUsdMicros;
      continue;
    }
    const s = (bySource[e.source] ??= { calls: 0, costUsdMicros: 0 });
    s.calls += 1;
    s.costUsdMicros += e.estimatedCostUsdMicros;
    calls += 1;
    cost += e.estimatedCostUsdMicros;
  }
  return { closedSessions, sessionModelCalls: calls, sessionCostUsdMicros: cost, costPerClosedSessionUsdMicros: closedSessions > 0 ? Math.round(cost / closedSessions) : null, bySource, onboarding };
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
