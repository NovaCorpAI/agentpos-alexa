/**
 * Spend guard for a public Simulator: every turn can call paid models, so turns are capped
 * per visitor (sliding window) and globally per hour. In memory; one instance per service.
 */
export interface TurnLimits {
  /** Turns one visitor may take in the window. */
  perVisitor: number;
  windowMs: number;
  /** Turns all visitors together may take per hour. */
  globalPerHour: number;
}

// Room for a visitor to play through every Scene, and for us to film the demo, while the
// hourly cap still protects the model budget.
export const DEFAULT_LIMITS: TurnLimits = { perVisitor: 150, windowMs: 10 * 60_000, globalPerHour: 600 };

export class TurnLimiter {
  private readonly visitors = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly limits: TurnLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a turn and says whether it may run; retryAfterS when it may not. */
  take(visitor: string): { ok: true } | { ok: false; scope: "visitor" | "global"; retryAfterS: number } {
    const t = this.now();
    this.global = this.global.filter((x) => t - x < 3_600_000);
    const mine = (this.visitors.get(visitor) ?? []).filter((x) => t - x < this.limits.windowMs);
    if (this.global.length >= this.limits.globalPerHour) return { ok: false, scope: "global", retryAfterS: Math.ceil((this.global[0]! + 3_600_000 - t) / 1000) };
    if (mine.length >= this.limits.perVisitor) return { ok: false, scope: "visitor", retryAfterS: Math.ceil((mine[0]! + this.limits.windowMs - t) / 1000) };
    mine.push(t);
    this.global.push(t);
    this.visitors.set(visitor, mine);
    if (this.visitors.size > 10_000) this.visitors.delete(this.visitors.keys().next().value!);
    return { ok: true };
  }
}

export function limitsFromEnv(env: NodeJS.ProcessEnv): TurnLimits | undefined {
  // On in production (the image sets NODE_ENV) or when asked; off for local development.
  if (env.SIMULATOR_TURN_LIMITS === "off") return undefined;
  if (env.SIMULATOR_TURN_LIMITS !== "on" && env.NODE_ENV !== "production") return undefined;
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { perVisitor: n(env.SIMULATOR_TURNS_PER_VISITOR, DEFAULT_LIMITS.perVisitor), windowMs: n(env.SIMULATOR_TURN_WINDOW_S, DEFAULT_LIMITS.windowMs / 1000) * 1000, globalPerHour: n(env.SIMULATOR_TURNS_PER_HOUR, DEFAULT_LIMITS.globalPerHour) };
}
