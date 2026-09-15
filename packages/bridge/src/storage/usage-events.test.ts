import { describe, expect, it } from "vitest";
import { USAGE_EVENTS_CSV_COLUMNS, USAGE_EVENTS_DDL } from "./usage-events.js";

describe("usage_events schema", () => {
  it("every CSV column exists in the DDL", () => {
    for (const col of USAGE_EVENTS_CSV_COLUMNS) {
      // Each column is declared on its own line, indented by two spaces.
      expect(USAGE_EVENTS_DDL).toContain("\n  " + col + " ");
    }
  });

  it("stores cost and tokens as integers, never real", () => {
    expect(USAGE_EVENTS_DDL).not.toMatch(/REAL|FLOAT|DOUBLE/);
    expect(USAGE_EVENTS_DDL).toMatch(/estimated_cost_usd_micros INTEGER/);
  });
});
