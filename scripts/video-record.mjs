#!/usr/bin/env node
/**
 * Records the demo, driving a real browser over the hosted playground (docs/VIDEO.md) and
 * capturing the screen as a series of stills with the moment each one was taken.
 *
 * Stills rather than the browser's own screencast: that recorder buffers frames in memory,
 * writes them with timings of its own and drops whole takes on a busy machine, which put the
 * wrong page on screen more than once. A frame every second and a half is plenty here, where
 * the picture changes at the pace of a conversation.
 *
 *   node scripts/video-record.mjs [simulator url] [frames dir]
 *
 * Needs `agent-browser` on PATH. On Windows run it from PowerShell: the CLI does not return
 * under Git Bash. Frames land outside the project (the CLI does not quote paths with spaces);
 * the index is written to .data/video/frames.json for scripts/video-build.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SIM = (process.argv[2] ?? "https://ag-7e67cc0a076f402c969b806381d31b43.ecs.us-east-1.on.aws").replace(/\/+$/, "");
const dir = process.argv[3] ? resolve(root, process.argv[3]) : resolve(tmpdir(), "agentpos-video", "frames");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
mkdirSync(resolve(root, ".data/video"), { recursive: true });

const ab = (args, { allowFail = false } = {}) => {
  const r = spawnSync("agent-browser", args, { encoding: "utf8", shell: true, timeout: 120_000 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0 && !allowFail) throw new Error(`agent-browser ${args[0]} failed: ${text.slice(0, 300)}`);
  return text;
};
const evaluate = (js) => ab(["eval", JSON.stringify(js)], { allowFail: true });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const started = Date.now();
const frames = [];
const shots = [];
const elapsed = () => Math.round(((Date.now() - started) / 1000) * 100) / 100;

/** One frame, timestamped. Failures are skipped: a missing frame only shortens a still. */
function frame() {
  const file = resolve(dir, `f${String(frames.length + 1).padStart(4, "0")}.png`);
  ab(["screenshot", file], { allowFail: true });
  if (existsSync(file) && statSync(file).size > 5_000) frames.push({ file, at: elapsed() });
}

/** Holds the picture for a while, taking frames as it goes. */
async function hold(seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    frame();
    await sleep(0.4);
  }
}

/** Marks the narration line that belongs to this moment. */
const shot = (line) => {
  shots.push({ line, at: elapsed() });
  console.log(`shot ${line} at ${elapsed()}s`);
};

const clickByText = (text) =>
  evaluate(`(() => { const t = ${JSON.stringify(text)}; const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().toLowerCase().startsWith(t.toLowerCase())); if (!el) return 'not found: ' + t; el.click(); return 'clicked: ' + el.textContent.trim().slice(0, 40); })()`);

const runScene = (title) =>
  evaluate(`(() => { const t = ${JSON.stringify(title)}; const scene = [...document.querySelectorAll('.scene')].find((s) => s.textContent.toLowerCase().includes(t.toLowerCase())); if (!scene) return 'no scene ' + t; const b = scene.querySelector('button'); if (!b || b.disabled) return 'not runnable ' + t; b.click(); return 'running ' + t; })()`);

const sceneBusy = () => evaluate(`[...document.querySelectorAll('.scene button')].some((b) => b.textContent.trim() === 'Running')`).includes("true");

/** Waits for the playing Scene, filming while it runs. */
async function filmScene(maxSeconds) {
  const until = Date.now() + maxSeconds * 1000;
  await hold(3);
  while (Date.now() < until) {
    frame();
    if (!sceneBusy()) return;
    await sleep(0.5);
  }
}

async function openPage(url, expect) {
  ab(["open", url], { allowFail: true });
  for (let i = 0; i < 25; i++) {
    await sleep(1);
    if (evaluate(`document.body.innerText.includes(${JSON.stringify(expect)})`).includes("true")) return true;
  }
  console.log(`  page did not show ${JSON.stringify(expect)}: ${evaluate("location.href")}`);
  return false;
}

console.log(`filming ${SIM} into ${dir}`);
try {
  await openPage(`${SIM}/`, "Scenes");
  shot(1);
  await hold(6);

  // The merchant side: scan, draft, confirm.
  await openPage(`${SIM}/#/merchant`, "Merchant console");
  shot(2);
  console.log(clickByText("Scan and draft"));
  await hold(14);
  shot(3);
  console.log(clickByText("Confirm and publish"));
  await hold(9);

  // The household side, through the Scenes the simulator ships with.
  await openPage(`${SIM}/`, "Scenes");
  shot(4);
  console.log(runScene("first voice purchase"));
  await hold(5);
  shot(6);
  await filmScene(70);
  shot(7);
  await hold(6);

  shot(5);
  console.log(runScene("gluten free"));
  await filmScene(60);
  await hold(4);

  shot(8);
  console.log(runScene("duplicate order"));
  await hold(16);
  shot(9);
  await filmScene(60);
  await hold(4);

  shot(10);
  console.log(runScene("same as last week"));
  await filmScene(60);
  await hold(4);

  // What it costs, what it cost us, where the code lives.
  await openPage("https://github.com/NovaCorpAI/agentpos-alexa/blob/main/docs/COSTS.md", "Unit costs");
  shot(11);
  await hold(7);
  await openPage("https://github.com/NovaCorpAI/agentpos-alexa/blob/main/docs/FRICTION-LOG.md", "Friction log");
  shot(12);
  await hold(7);
  await openPage("https://github.com/NovaCorpAI/agentpos-alexa", "agentpos-alexa");
  shot(13);
  await hold(7);
} finally {
  writeFileSync(resolve(root, ".data/video/frames.json"), JSON.stringify({ seconds: elapsed(), dir, frames, shots }, null, 2));
  console.log(`filmed ${frames.length} frames over ${elapsed()}s, ${shots.length} shots marked`);
}
