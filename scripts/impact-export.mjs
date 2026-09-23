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

export const PURCHASES_FILE = "docs/impact/purchases.json";

/**
 * The playground's public purchase counter, carried across releases. Each release counts on
 * its own disk, which the next release replaces, so the deploy reads the outgoing release's
 * total and writes it here under that release's id. Writing the same release twice replaces
 * its entry instead of adding to it, which is what makes an interrupted deploy harmless.
 * Nothing here names a buyer, an order or a Store: two integers per release.
 */
export function rememberPurchases(entry, root) {
  const path = resolve(root, PURCHASES_FILE);
  const ledger = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { releases: [] };
  const releases = (ledger.releases ?? []).filter((r) => r.release !== entry.release);
  releases.push({ release: entry.release, own: Number(entry.own) || 0, thirdParty: Number(entry.thirdParty) || 0, at: entry.at ?? new Date().toISOString(), ...(entry.note ? { note: entry.note } : {}) });
  releases.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const total = releases.reduce((acc, r) => ({ own: acc.own + r.own, thirdParty: acc.thirdParty + r.thirdParty }), { own: 0, thirdParty: 0 });
  writeFileSync(path, JSON.stringify({ total, releases }, null, 2) + "\n");
  return { total, releases: releases.length, path };
}

/** The running total to hand to the next release, without writing anything. */
export function purchasesTotal(root) {
  const path = resolve(root, PURCHASES_FILE);
  if (!existsSync(path)) return { own: 0, thirdParty: 0 };
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  return { own: Number(ledger.total?.own) || 0, thirdParty: Number(ledger.total?.thirdParty) || 0 };
}

/** Where each service keeps its rows, and which of its own tokens opens them. */
const EXPORTS = {
  "agentpos-alexa-bridge": { path: "/admin/usage-events.csv", tokenVar: "BRIDGE_BEARER_TOKEN" },
  "agentpos-alexa-sim": { path: "/api/usage-events.csv", tokenVar: "SIMULATOR_ADMIN_TOKEN" },
};

/** A deployed service's public endpoint and its own token, read from its configuration. */
async function liveService(service = "agentpos-alexa-bridge") {
  const { DescribeExpressGatewayServiceCommand, ECSClient } = await import("@aws-sdk/client-ecs");
  const { GetCallerIdentityCommand, STSClient } = await import("@aws-sdk/client-sts");
  const region = process.env.AWS_REGION || "us-east-1";
  const account = (await new STSClient({ region }).send(new GetCallerIdentityCommand({}))).Account;
  const ecs = new ECSClient({ region });
  const s = (await ecs.send(new DescribeExpressGatewayServiceCommand({ serviceArn: `arn:aws:ecs:${region}:${account}:service/default/${service}` }))).service;
  const configs = [...(s?.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const env = Object.fromEntries((configs[0]?.primaryContainer?.environment ?? []).map((e) => [e.name, e.value]));
  const ingress = configs.map((c) => c.ingressPaths?.find((i) => i.accessType === "PUBLIC") ?? c.ingressPaths?.[0]).find((i) => i?.endpoint);
  const known = EXPORTS[service];
  if (!known) throw new Error(`${service} is not one of ${Object.keys(EXPORTS).join(", ")}`);
  if (!ingress?.endpoint || !env[known.tokenVar]) throw new Error(`${service} has no public endpoint or no ${known.tokenVar} in its configuration`);
  const host = ingress.endpoint.replace(/\/+$/, "");
  return { url: host.startsWith("http") ? host : `https://${host}`, bearer: env[known.tokenVar], path: known.path };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, "..");
  const envFile = resolve(root, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^(AWS_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write("usage: node scripts/impact-export.mjs --live | <exported.csv>\n");
    process.exit(2);
  }
  let csv;
  if (arg === "--live") {
    const service = process.argv[3] ?? undefined;
    const { url, bearer, path } = await liveService(service);
    const res = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${service ?? "the Bridge"} answered ${res.status} to ${path}`);
    // A single page app answers 200 with its own HTML for a path it does not know.
    if (!(res.headers.get("content-type") ?? "").includes("csv")) {
      throw new Error(`${service ?? "the Bridge"} answered ${path} with ${res.headers.get("content-type") ?? "no content type"}, not CSV; is the running version the one that serves it?`);
    }
    const closed = res.headers.get("X-Closed-Sessions");
    if (closed) process.stdout.write(`${closed} closed checkout session(s) on the live Bridge\n`);
    csv = await res.text();
  } else {
    csv = readFileSync(arg, "utf8");
  }
  const { added, total, path } = mergeUsageCsv(csv, root);
  process.stdout.write(`${added} new row(s), ${total} in ${path}\n`);
}
