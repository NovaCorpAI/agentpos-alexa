/**
 * `pnpm --filter @agentpos-alexa/bridge usage:export [--out file.csv] [--summary]`
 * Reads BRIDGE_DB_PATH (default ./.data/bridge.sqlite) and writes the CSV to stdout or a
 * file. With --summary, prints the per-source and per-session totals docs/COSTS.md uses.
 */
import { writeFileSync } from "node:fs";
import { openStorage } from "./storage/sqlite.js";
import { summarizeUsage, usageEventsToCsv } from "./storage/usage-export.js";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
const dbPath = process.env.BRIDGE_DB_PATH ?? "./.data/bridge.sqlite";

const storage = openStorage({ path: dbPath });
const events = storage.usageEvents.list({ limit: 1_000_000 });
storage.close();

if (args.includes("--summary")) {
  const s = summarizeUsage(events);
  process.stdout.write(JSON.stringify({ dbPath, events: events.length, ...s }, null, 2) + "\n");
} else {
  const csv = usageEventsToCsv(events);
  if (out) {
    writeFileSync(out, csv);
    process.stderr.write(`wrote ${events.length} events to ${out}\n`);
  } else {
    process.stdout.write(csv);
  }
}
