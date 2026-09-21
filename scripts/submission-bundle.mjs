#!/usr/bin/env node
/**
 * Gathers the evidence a judge would want without cloning the repository: the measured costs
 * and the raw usage rows behind them, the AWS integration with file paths, the friction log,
 * the architecture decisions, and the stills from the recorded demo.
 *
 *   node scripts/submission-bundle.mjs        writes .data/submission/agentpos-alexa-evidence.zip
 *
 * The zip is not committed; it is built from files that are.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stage = resolve(root, ".data/submission/agentpos-alexa-evidence");
const zip = resolve(root, ".data/submission/agentpos-alexa-evidence.zip");
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });

/** What goes in, and under which name, so the folder reads in the order a judge would read it. */
const FILES = [
  ["docs/SUBMISSION.md", "01-submission.md"],
  ["docs/ARCHITECTURE.md", "02-architecture.md"],
  ["docs/AWS-INTEGRATION.md", "03-aws-integration.md"],
  ["docs/COSTS.md", "04-costs.md"],
  ["docs/impact/usage-events.csv", "05-usage-events.csv"],
  ["docs/impact/usage-events-cached.csv", "06-usage-events-with-prompt-caching.csv"],
  ["docs/FRICTION-LOG.md", "07-friction-log.md"],
  ["docs/ALEXA-MCP-DESIGN.md", "08-alexa-mcp-design-rules.md"],
  ["docs/USAGE-EVENTS.md", "09-usage-events-schema.md"],
  ["docs/VIDEO.md", "10-video-shot-list.md"],
  ["docs/DEPLOY.md", "11-deployment.md"],
  ["CONTEXT.md", "12-domain-glossary.md"],
  ["docs/adr/0001-simulator-talks-only-to-the-bridge.md", "13-adr-0001.md"],
  ["docs/adr/0002-demo-household-never-operates-live.md", "14-adr-0002.md"],
  ["docs/assets/simulator-carousel.png", "screens/01-carousel.png"],
  ["docs/assets/simulator-checkout.png", "screens/02-checkout.png"],
  ["docs/assets/simulator-guardian-and-order.png", "screens/03-guardian-and-order.png"],
  ["docs/assets/simulator-cart.png", "screens/04-one-cart.png"],
  ["docs/assets/simulator-history.png", "screens/05-household-history.png"],
  ["docs/assets/simulator-spanish.png", "screens/06-in-spanish.png"],
  ["docs/assets/merchant-console.png", "screens/07-merchant-console.png"],
];

const INDEX = `AgentPOS for Alexa+, evidence pack
==================================

Repository:       https://github.com/NovaCorpAI/agentpos-alexa  (Apache-2.0)
Demo video:       https://youtu.be/MOxcz6SIt6c  (older cut; the 2026-09-21 film is being uploaded)
Playground:       https://alexa.agentposhq.com
Merchant console: https://alexa.agentposhq.com/#/merchant
Bridge:           https://bridge.agentposhq.com

Everything here is a copy of a file in the repository, so a judge can check any claim without
cloning it. Nothing in this pack is written for the pack.

01 submission           what this is, what we built during the window, the evidence table
02 architecture         the decisions and why each was taken
03 aws integration      every AWS service, what it does here, and the file that uses it
04 costs                measured cost per closed checkout session, before and after caching
05 usage events         the raw rows behind those numbers, 63 model and checkout calls
06 usage events cached  the same measurement with Bedrock prompt caching on
07 friction log         twelve obstacles with Amazon and AWS tooling, and what worked
08 mcp design rules     the Alexa+ guidance we built against, quoted
09 usage events schema  the table every model call is recorded in
10 video shot list      what the demo video shows, with the system's own answers
11 deployment           how the playground runs on ECS Express Mode
12 domain glossary      the words this project uses and the ones it avoids
13, 14 decisions        the two architecture decisions worth their own record

screens/                frames of the demo video, filmed against the live playground
`;

mkdirSync(resolve(stage, "screens"), { recursive: true });
writeFileSync(resolve(stage, "00-read-me-first.txt"), INDEX);

const missing = [];
for (const [from, to] of FILES) {
  try {
    copyFileSync(resolve(root, from), resolve(stage, to));
  } catch {
    missing.push(from);
  }
}
if (missing.length) console.log(`skipped (not found): ${missing.join(", ")}`);

const ps = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`],
  { encoding: "utf8" },
);
if (ps.status !== 0) throw new Error(`zip failed: ${`${ps.stdout ?? ""}${ps.stderr ?? ""}`.slice(-400)}`);
console.log(`${zip}  ${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB`);
