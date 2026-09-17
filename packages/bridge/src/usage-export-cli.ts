/**
 * `pnpm --filter @agentpos-alexa/bridge usage:export [--db file]... [--since ISO] [--out file.csv] [--summary]`
 *
 * Reads one or more usage_events databases (default: the Bridge's and the Simulator's under
 * .data/), keeps rows at or after --since, and writes the CSV to stdout or a file. With
 * --summary, prints the per-source totals and the inference cost per closed checkout
 * session that docs/COSTS.md publishes. Closed sessions are counted in the Bridge databases.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir, loadDotenv } from "./env.js";
import { openStorage } from "./storage/sqlite.js";
import { costPerClosedSession, summarizeUsage, usageEventsToCsv } from "./storage/usage-export.js";
import type { UsageEvent } from "./storage/usage-events.js";

loadDotenv();

const args = process.argv.slice(2);
const valuesOf = (flag: string): string[] => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!] : []));
const out = valuesOf("--out")[0];
const since = valuesOf("--since")[0] ?? "";
const dbs = valuesOf("--db");
const dbPaths = dbs.length
  ? dbs
  : [process.env.BRIDGE_DB_PATH ?? resolve(dataDir(), "bridge.sqlite"), resolve(dataDir(), "simulator.sqlite")].filter((p) => existsSync(p));

let events: UsageEvent[] = [];
let closedSessions = 0;
for (const path of dbPaths) {
  const storage = openStorage({ path });
  events = events.concat(storage.usageEvents.list({ limit: 1_000_000 }).filter((e) => e.at >= since));
  closedSessions += storage.checkout.countByStatus("completed", since);
  storage.close();
}
events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

if (args.includes("--summary")) {
  const s = summarizeUsage(events);
  process.stdout.write(JSON.stringify({ dbPaths, since: since || null, events: events.length, bySource: s.bySource, closedSession: costPerClosedSession(events, closedSessions) }, null, 2) + "\n");
} else {
  const csv = usageEventsToCsv(events);
  if (out) {
    writeFileSync(out, csv);
    process.stderr.write(`wrote ${events.length} events from ${dbPaths.length} database(s) to ${out}\n`);
  } else {
    process.stdout.write(csv);
  }
}
