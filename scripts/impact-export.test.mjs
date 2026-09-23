import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPACT_FILE, mergeUsageCsv, purchasesTotal, rememberPurchases } from "./impact-export.mjs";

const HEADER = "id,trace_id,at,source,model";
const row = (id, at) => `${id},trace-${id},${at},household,us.amazon.nova-2-lite-v1:0`;

describe("the playground's measured rows survive a redeploy", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "impact-"));
    mkdirSync(resolve(root, "docs/impact"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const read = () => readFileSync(resolve(root, IMPACT_FILE), "utf8").trim().split("\r\n");

  it("keeps what was already there and appends only what is new", () => {
    mergeUsageCsv([HEADER, row("a", "2026-09-01T00:00:00Z"), row("b", "2026-09-02T00:00:00Z")].join("\r\n"), root);
    const second = mergeUsageCsv([HEADER, row("b", "2026-09-02T00:00:00Z"), row("c", "2026-09-03T00:00:00Z")].join("\r\n"), root);

    expect(second).toMatchObject({ added: 1, total: 3 });
    expect(read()).toEqual([HEADER, row("a", "2026-09-01T00:00:00Z"), row("b", "2026-09-02T00:00:00Z"), row("c", "2026-09-03T00:00:00Z")]);
  });

  it("merging the same export twice changes nothing", () => {
    const csv = [HEADER, row("a", "2026-09-01T00:00:00Z")].join("\r\n");
    mergeUsageCsv(csv, root);
    expect(mergeUsageCsv(csv, root)).toMatchObject({ added: 0, total: 1 });
  });

  it("carries the public purchase counter across releases, and twice over the same one changes nothing", () => {
    expect(purchasesTotal(root)).toEqual({ own: 0, thirdParty: 0 });
    rememberPurchases({ release: "rev-1", own: 2, thirdParty: 7, at: "2026-09-20T00:00:00Z" }, root);
    expect(rememberPurchases({ release: "rev-2", own: 1, thirdParty: 3, at: "2026-09-22T00:00:00Z" }, root)).toMatchObject({ total: { own: 3, thirdParty: 10 }, releases: 2 });

    // An interrupted deploy exports the same release again: its entry is replaced, not added.
    expect(rememberPurchases({ release: "rev-2", own: 1, thirdParty: 4, at: "2026-09-22T00:00:00Z" }, root)).toMatchObject({ total: { own: 3, thirdParty: 11 }, releases: 2 });
    expect(purchasesTotal(root)).toEqual({ own: 3, thirdParty: 11 });
  });

  it("refuses an export whose columns are not the committed ones", () => {
    mergeUsageCsv([HEADER, row("a", "2026-09-01T00:00:00Z")].join("\r\n"), root);
    expect(() => mergeUsageCsv(["id,at", "a,2026-09-01T00:00:00Z"].join("\r\n"), root)).toThrow(/different columns/);
  });
});
