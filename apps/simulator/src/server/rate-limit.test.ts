import { describe, expect, it } from "vitest";
import { limitsFromEnv, TurnLimiter } from "./rate-limit.js";

describe("TurnLimiter", () => {
  it("caps turns per visitor in a sliding window and globally per hour", () => {
    let now = 0;
    const l = new TurnLimiter({ perVisitor: 2, windowMs: 60_000, globalPerHour: 3 }, () => now);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a")).toEqual({ ok: false, scope: "visitor", retryAfterS: 60 });
    expect(l.take("b").ok).toBe(true);
    expect(l.take("c")).toMatchObject({ ok: false, scope: "global" });
    now = 61_000;
    expect(l.take("a")).toMatchObject({ ok: false, scope: "global" });
    now = 3_600_001;
    expect(l.take("a").ok).toBe(true);
  });

  it("reads limits from the environment and can be switched off", () => {
    expect(limitsFromEnv({ NODE_ENV: "production", SIMULATOR_TURNS_PER_VISITOR: "5", SIMULATOR_TURN_WINDOW_S: "30", SIMULATOR_TURNS_PER_HOUR: "100" })).toEqual({ perVisitor: 5, windowMs: 30_000, globalPerHour: 100 });
    expect(limitsFromEnv({ SIMULATOR_TURN_LIMITS: "on" })).toEqual({ perVisitor: 40, windowMs: 600_000, globalPerHour: 600 });
    expect(limitsFromEnv({})).toBeUndefined();
    expect(limitsFromEnv({ NODE_ENV: "production", SIMULATOR_TURN_LIMITS: "off" })).toBeUndefined();
  });
});
