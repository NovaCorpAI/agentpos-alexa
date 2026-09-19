#!/usr/bin/env node
/**
 * Records the demo as a video, driving a real browser over the hosted playground
 * (docs/VIDEO.md). The shots and their pauses follow the narration timings written by
 * scripts/video-narration.mjs, so the picture and the voice line up without hand editing.
 *
 *   node scripts/video-record.mjs [simulator url] [out.webm]
 *
 * Needs `agent-browser` on PATH and a browser it can start. Output under .data/video/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SIM = (process.argv[2] ?? "https://ag-7e67cc0a076f402c969b806381d31b43.ecs.us-east-1.on.aws").replace(/\/+$/, "");
const out = resolve(root, process.argv[3] ?? ".data/video/demo.webm");
const narration = resolve(root, ".data/video/narration/manifest.json");
mkdirSync(resolve(out, ".."), { recursive: true });

const lines = existsSync(narration) ? JSON.parse(readFileSync(narration, "utf8")).lines : [];
/** Seconds the picture holds for line n, always a little longer than the words. */
const hold = (n, extra = 1.5) => (lines.find((l) => l.line === n)?.seconds ?? 3) + extra;

const ab = (...args) => {
  const r = spawnSync("agent-browser", args, { encoding: "utf8", shell: true, timeout: 120_000 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${text.slice(0, 300)}`);
  return text;
};
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** Types into the simulator's input and sends it, the way a person would. */
async function say(text, seconds) {
  ab("fill", "input[placeholder]", text);
  ab("press", "Enter");
  await wait(seconds);
}

console.log(`recording ${SIM} to ${out}`);
ab("record", "start", out);
try {
  ab("resize", "1280", "800");
  ab("open", `${SIM}/#/merchant`);
  await wait(hold(1));

  // Shots 2 and 3: the merchant console drafts and publishes.
  ab("click", "text=Scan and draft");
  await wait(hold(2, 6));
  ab("click", "text=Confirm and publish");
  await wait(hold(3, 4));

  // Shots 4 to 10: the household side.
  ab("open", `${SIM}/`);
  await wait(2);
  await say("What bread do you have?", hold(4, 6));
  await say("Is the gluten free seeded loaf gluten free?", hold(5, 5));
  await say("Is the gluten free seeded loaf organic?", 6);
  await say("Buy one baguette", hold(6, 6));
  ab("click", "text=/^(Confirm|Yes, order it again)/");
  await wait(hold(7, 6));
  await say("Buy one baguette", hold(8, 6));
  ab("click", "text=/^(Confirm|Yes, order it again)/");
  await wait(hold(9, 4));
  ab("click", "text=/^(Confirm|Yes, order it again)/");
  await wait(4);
  await say("The same as last week", hold(10, 6));

  // Shots 11 to 13: what it costs, what it cost us, where the code lives.
  ab("open", "https://github.com/NovaCorpAI/agentpos-alexa/blob/main/docs/COSTS.md");
  await wait(hold(11, 3));
  ab("open", "https://github.com/NovaCorpAI/agentpos-alexa/blob/main/docs/FRICTION-LOG.md");
  await wait(hold(12, 3));
  ab("open", "https://github.com/NovaCorpAI/agentpos-alexa");
  await wait(hold(13, 3));
} finally {
  console.log(ab("record", "stop"));
}
console.log(`video at ${out}`);
