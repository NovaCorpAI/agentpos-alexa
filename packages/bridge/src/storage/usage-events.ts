/**
 * usage_events: one row per model call and per measured stage.
 *
 * Defined before any module writes to it, so that onboarding timing, per-session cost and the
 * own-versus-third-party split are consistent across bridge, agents and simulator.
 * Documented in docs/USAGE-EVENTS.md. Money and tokens are integers; cost is in USD micros.
 */

/** Which component produced the event. */
export type UsageSource =
  | "bridge.mcp"
  | "bridge.checkout"
  | "agent.onboarding"
  | "agent.catalog"
  | "agent.guardian"
  | "simulator";

/** Stages of the onboarding run, timed from URL to first voice purchase. */
export type OnboardingStage =
  | "scan"
  | "catalog_draft"
  | "policies_draft"
  | "human_confirm"
  | "published"
  | "first_voice_purchase";

/** Who is buying: our own team (demo, tests) or a third party from the public simulator. */
export type PurchaseOrigin = "own" | "third_party";

export interface UsageEvent {
  /** ULID or UUID, assigned by the writer. */
  id: string;
  /** Crosses MCP call, checkout session, store request and settlement. */
  traceId: string;
  /** ISO 8601, UTC. */
  at: string;
  source: UsageSource;
  /** Store origin, e.g. https://demo.agentposhq.com. */
  storeOrigin: string;
  /** Checkout session id when the event belongs to one. */
  checkoutSessionId?: string;
  /** Bedrock model id; null for events that are not model calls (stage marks, rail calls). */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Estimated cost in USD micros (1 USD = 1_000_000). Integer, never a float. */
  estimatedCostUsdMicros: number;
  /** Set on onboarding stage marks only. */
  onboardingStage?: OnboardingStage;
  /** Set on checkout events only. */
  purchaseOrigin?: PurchaseOrigin;
  /** Payment handler id on rail events, e.g. dev.ucp.processor_tokenizer. */
  paymentHandler?: string;
  /** True when the rail or PSP behind this event is simulated. Never inferred; always written. */
  simulated: boolean;
}

/** DDL for node:sqlite. Applied by the storage adapter on open. */
export const USAGE_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS usage_events (
  id                        TEXT PRIMARY KEY,
  trace_id                  TEXT NOT NULL,
  at                        TEXT NOT NULL,
  source                    TEXT NOT NULL,
  store_origin              TEXT NOT NULL,
  checkout_session_id       TEXT,
  model                     TEXT,
  input_tokens              INTEGER NOT NULL DEFAULT 0,
  output_tokens             INTEGER NOT NULL DEFAULT 0,
  latency_ms                INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  onboarding_stage          TEXT,
  purchase_origin           TEXT,
  payment_handler           TEXT,
  simulated                 INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_events_trace ON usage_events (trace_id);
CREATE INDEX IF NOT EXISTS usage_events_session ON usage_events (checkout_session_id);
CREATE INDEX IF NOT EXISTS usage_events_store_at ON usage_events (store_origin, at);
`;

/** Column order of the CSV export, stable so spreadsheets built on it do not break. */
export const USAGE_EVENTS_CSV_COLUMNS = [
  "id",
  "trace_id",
  "at",
  "source",
  "store_origin",
  "checkout_session_id",
  "model",
  "input_tokens",
  "output_tokens",
  "latency_ms",
  "estimated_cost_usd_micros",
  "onboarding_stage",
  "purchase_origin",
  "payment_handler",
  "simulated",
] as const;
