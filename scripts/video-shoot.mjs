#!/usr/bin/env node
/**
 * Shoots the demo video as real screen motion, one take per beat, against the live playground.
 *
 *   node scripts/video-shoot.mjs [simulator url] [takes dir]
 *
 * agent-browser records the page itself (WebM, 10 fps), so nothing of the operator's desktop
 * is captured and the machine stays usable. Each take is a beat of docs/VIDEO.md; a bad one
 * is reshot on its own. Every take carries marks in wall clock milliseconds from the moment
 * recording started: when the household finished typing, and when the answer landed. The
 * build uses them to keep the typing and the answer at speed and to run the model's thinking
 * time fast, so the cut has no dead air without ever speeding up what is being shown.
 *
 * Needs `agent-browser` on PATH. On Windows run it from PowerShell: the CLI does not return
 * under Git Bash. Takes land outside the project (the CLI does not quote paths with spaces).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SIM = (positional[0] ?? "https://alexa.agentposhq.com").replace(/\/+$/, "");
const dir = positional[1] ? resolve(root, positional[1]) : resolve(tmpdir(), "agentpos-video", "takes");
mkdirSync(dir, { recursive: true });
mkdirSync(resolve(root, ".data/video"), { recursive: true });

const ab = (args, { allowFail = false } = {}) => {
  const r = spawnSync("agent-browser", args, { encoding: "utf8", shell: true, timeout: 180_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0 && !allowFail) throw new Error(`agent-browser ${args[0]} failed: ${out.slice(0, 300)}`);
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg, extra = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

/** Runs JavaScript in the page and returns its value as text. */
const evalJs = (js) => ab(["eval", JSON.stringify(js)], { allowFail: true });

/**
 * How many answers are on screen. The thinking bubble wears the same class, so it is excluded:
 * counting it made every take think the answer had landed in two hundred milliseconds.
 */
const answerCount = () => Number((evalJs("document.querySelectorAll('.bubble.alexa:not(.thinking)').length").match(/\d+/) ?? ["0"])[0]);

/** Waits until the page says so, or gives up; returns how long it took. */
async function waitFor(check, { timeoutMs = 60_000, everyMs = 500 } = {}) {
  const started = Date.now();
  for (;;) {
    if (await check()) return Date.now() - started;
    if (Date.now() - started > timeoutMs) return Date.now() - started;
    await sleep(everyMs);
  }
}

const takes = [];
/** `--only hello,pay` reshoots those beats and leaves the rest of the take list alone. */
const only = new Set(
  (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);
let ordinal = 0;

/**
 * One beat: start recording, open the page in the language of the film, run it, stop.
 *
 * Recording starts a fresh browsing context, with empty storage, so the language has to be
 * set inside the take or the app falls back to the operating system's and the film comes out
 * in the wrong one. What carries between takes is what the server holds: the open cart, the
 * household's memory, its orders.
 */
async function take(name, run, { lang = "en", path = "/" } = {}) {
  ordinal += 1;
  const file = resolve(dir, `${String(ordinal).padStart(2, "0")}-${name}.webm`);
  if (only.size && !only.has(name)) return;
  ab(["record", "start", JSON.stringify(file)]);
  evalJs(`try { localStorage.setItem('agentpos.lang', '${lang}'); } catch (e) {}`);
  ab(["open", JSON.stringify(`${SIM}${path}?take=${ordinal}`)]);
  await sleep(3200);
  const t0 = Date.now();
  const marks = { name, file, typedMs: null, answeredMs: null };
  await run({ t0, mark: (key) => (marks[key] = Date.now() - t0) });
  await sleep(1800);
  marks.endMs = Date.now() - t0;
  ab(["record", "stop"]);
  await sleep(1500);
  // The recorder drops a take now and then, writing a file of a tenth of a second (FL-013).
  const size = existsSync(file) ? statSync(file).size : 0;
  if (size < 60_000) {
    log("take dropped by the recorder, shooting it again", { name, bytes: size });
    ordinal -= 1;
    await take(name, run, { lang, path });
    return;
  }
  takes.push(marks);
  log("take", { ...marks, bytes: size });
}

/** Says something to the store and waits for the answer, marking both moments. */
async function say(text, mark, { timeoutMs = 45_000 } = {}) {
  const before = answerCount();
  ab(["click", JSON.stringify(".inputbar input")], { allowFail: true });
  ab(["type", JSON.stringify(".inputbar input"), JSON.stringify(text)]);
  await sleep(400);
  ab(["press", "Enter"]);
  mark("typedMs");
  await waitFor(async () => answerCount() > before, { timeoutMs });
  mark("answeredMs");
  await sleep(2600);
}

/** Presses a button in the checkout card and waits for whatever the assistant answers. */
async function press(label, { timeoutMs = 45_000 } = {}) {
  const before = answerCount();
  clickText(label);
  const waited = await waitFor(async () => answerCount() > before, { timeoutMs });
  await sleep(2400);
  return waited;
}

/** The same click, used before the first take to leave the playground tidy. */
const clickTextNow = (text) => clickText(text);

/** Clicks a button by the text it shows, the way a person would find it. */
const clickText = (text) =>
  evalJs(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (b) { b.click(); return 'clicked'; } return 'not found'; })()`,
  );

ab(["set", "viewport", "1600", "900"]);
ab(["set", "media", "dark"], { allowFail: true });

// A cart left open by an earlier run would be on screen from the first frame.
ab(["open", JSON.stringify(`${SIM}/?clean=1`)]);
await sleep(3000);
clickTextNow("Cancel");
await sleep(2000);

await take("hello", async ({ mark }) => {
  await sleep(2200); // the idle screen, breathing
  await say("What bread do you have?", mark);
});

await take(
  "merchant",
  async ({ mark }) => {
    const origin = evalJs("document.querySelector('.merchant input')?.value || ''").replace(/^"|"$/g, "");
    ab(["click", JSON.stringify(".merchant input")], { allowFail: true });
    mark("typedMs");
    clickText("Read it and draft");
    await sleep(1800); // let the button say "Reading the store" before watching for it to stop
    await waitFor(async () => /Read it and draft/.test(evalJs("[...document.querySelectorAll('.merchant button')].map((b) => b.textContent).join(' ')")), { timeoutMs: 150_000 });
    mark("answeredMs");
    log("merchant scanned", { origin });
    await sleep(2600);
    evalJs("window.scrollTo({ top: 640, behavior: 'smooth' })");
    await sleep(3000);
  },
  { path: "/#/merchant" },
);

await take("buy", async ({ mark }) => {
  await say("Buy one rosemary focaccia", mark);
});

await take("pay", async ({ mark }) => {
  await sleep(2000); // the payment list, read: her Stripe first, the Amazon handlers labeled
  mark("typedMs");
  await press("Confirm");
  mark("answeredMs");
});

await take("guardian", async ({ mark }) => {
  await say("Buy one rosemary focaccia", mark);
  await press("Confirm"); // the guardian answers here, in the conversation and on the card
  await press("Yes, order it again");
});

await take("cart", async ({ mark }) => {
  await say("Buy one baguette", mark);
  await say("Add a butter croissant", () => undefined);
  clickText("Cancel");
  await sleep(1500);
});

await take("memory", async ({ mark }) => {
  await say("The same as last week", mark);
});

await take("history", async ({ mark }) => {
  await say("How much have I spent this month?", mark);
  clickText("Cancel");
  await sleep(1200);
});

await take("spanish", async ({ mark }) => {
  await say("What bread do you have?", () => undefined);
  mark("typedMs");
  clickText("ES");
  await sleep(1200);
  mark("answeredMs");
  await sleep(3200);
});

// A reshoot keeps the takes it did not touch: the index is merged, never replaced.
const indexFile = resolve(root, ".data/video/takes.json");
const previous = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")).takes ?? []) : [];
const merged = [...previous.filter((t) => !takes.some((fresh) => fresh.name === t.name)), ...takes].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(indexFile, `${JSON.stringify({ sim: SIM, dir, takes: merged }, null, 2)}\n`);
log("shot", { reshot: takes.length, takes: merged.length, dir });
