#!/usr/bin/env node
/**
 * Keeps the playground's measured rows across releases. The hosted services write
 * usage_events to the task's own disk, and ECS Express Mode replaces the task on every
 * deploy (docs/DEPLOY.md), so `pnpm deploy:aws` pulls the Bridge's rows out first and merges
 * them here, into a file that is committed.
 *
 *   node scripts/impact-export.mjs <exported.csv>   merge a CSV fetched by hand
 *
 * By hand, against the live Bridge (the bearer is in the service's configuration, never here):
 *   curl -H "Authorization: Bearer $TOKEN" https://bridge.agentposhq.com/admin/usage-events.csv > rows.csv
 *
 * Rows are deduplicated by their event id, so merging the same export twice changes nothing.
 * Nothing in a usage_events row names a buyer, an order or a card.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const IMPACT_FILE = "docs/impact/playground-usage-events.csv";

/** The id is the first field of every row and never contains a comma or a quote. */
const idOf = (line) => line.slice(0, line.indexOf(","));

/**
 * Merges an exported CSV into the committed one, keeping the existing order and appending
 * only rows that are not there yet. Returns what changed.
 */
export function mergeUsageCsv(exportedCsv, root) {
  const path = resolve(root, IMPACT_FILE);
  const incoming = exportedCsv.trim().split(/\r?\n/).filter(Boolean);
  if (incoming.length === 0) return { added: 0, total: 0, path };
  const header = incoming[0];
  const current = existsSync(path) ? readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean) : [header];
  if (current[0] !== header) throw new Error(`the committed file has different columns:\n  ${current[0]}\n  ${header}`);

  const seen = new Set(current.slice(1).map(idOf));
  const added = incoming.slice(1).filter((line) => !seen.has(idOf(line)));
  const rows = [...current, ...added];
  writeFileSync(path, rows.join("\r\n") + "\r\n");
  return { added: added.length, total: rows.length - 1, path };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: node scripts/impact-export.mjs <exported.csv>\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dirname, "..");
  const { added, total, path } = mergeUsageCsv(readFileSync(file, "utf8"), root);
  process.stdout.write(`${added} new row(s), ${total} in ${path}\n`);
}
