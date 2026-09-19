#!/usr/bin/env node
/**
 * Synthesizes the demo video's voice over with Amazon Polly (generative Joanna), one file per
 * line of docs/VIDEO.md, and writes a manifest with each line's duration so the edit can be
 * cut to the narration rather than the other way round.
 *
 *   node scripts/video-narration.mjs [out dir]     default: .data/video/narration
 *
 * Nothing here is committed: the audio lands under .data/ (git ignored).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const root = resolve(import.meta.dirname, "..");
for (let dir = root; ; dir = dirname(dir)) {
  const file = resolve(dir, ".env");
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
  if (dirname(dir) === dir) break;
}

/** The voice over of docs/VIDEO.md, in order. Keep both in step. */
export const LINES = [
  "Alexa Plus for Builders is built for Priceline. This is for the corner store.",
  "A baker pastes her store address. The onboarding agent reads the catalog and drafts how each item should sound out loud.",
  "She corrects one name, adds what her customers actually say, and confirms. Nothing is published until she does.",
  "Now the household side.",
  "The catalog agent answers from what the store published, and says so when it has not.",
  "The merchant chooses how to get paid. Her own Stripe comes first, in test mode. The Amazon wallet handlers are simulated and labeled.",
  "The store charges with its own key. The bridge never sees it.",
  "The guardian checks before any money moves.",
  "The household decides, not the agent.",
  "Memory holds order references only, on AgentCore Memory. No names, no addresses.",
  "Every model call is recorded. A closed checkout session costs a fifth of a cent in inference, prompt caching included.",
  "Eleven obstacles with Amazon and AWS tooling, each with the time it cost and a concrete suggestion.",
  "Open source from the first commit. The playground is live.",
];

/** Duration of an MP3 by summing its frames; no decoder needed. */
export function mp3DurationSeconds(buf) {
  const RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const SAMPLE_RATES = [44100, 48000, 32000, 0];
  let i = 0;
  let seconds = 0;
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "ID3") {
    i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  }
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const bitrate = RATES[(buf[i + 2] & 0xf0) >> 4] * 1000;
    const sampleRate = SAMPLE_RATES[(buf[i + 2] & 0x0c) >> 2];
    if (!bitrate || !sampleRate) {
      i++;
      continue;
    }
    const padding = (buf[i + 2] & 0x02) >> 1;
    const frame = Math.floor((144 * bitrate) / sampleRate) + padding;
    seconds += 1152 / sampleRate;
    i += frame > 0 ? frame : 1;
  }
  return seconds;
}

if (import.meta.filename === process.argv[1]) {
  const outDir = resolve(root, process.argv[2] ?? ".data/video/narration");
  mkdirSync(outDir, { recursive: true });
  const polly = new PollyClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const manifest = [];
  for (const [i, text] of LINES.entries()) {
    const file = resolve(outDir, `${String(i + 1).padStart(2, "0")}.mp3`);
    let audio;
    if (existsSync(file)) {
      audio = readFileSync(file);
    } else {
      const res = await polly.send(new SynthesizeSpeechCommand({ Engine: "generative", VoiceId: "Joanna", LanguageCode: "en-US", OutputFormat: "mp3", Text: text }));
      audio = Buffer.from(await res.AudioStream.transformToByteArray());
      writeFileSync(file, audio);
    }
    const seconds = Math.round(mp3DurationSeconds(audio) * 100) / 100;
    manifest.push({ line: i + 1, seconds, file, text });
    console.log(`${String(i + 1).padStart(2, "0")}  ${seconds.toFixed(2)}s  ${text.slice(0, 60)}`);
  }
  const total = manifest.reduce((n, m) => n + m.seconds, 0);
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({ voice: "Joanna generative", total: Math.round(total * 100) / 100, lines: manifest }, null, 2));
  console.log(`total narration ${total.toFixed(1)}s (a three minute video leaves ${(180 - total).toFixed(0)}s of pauses)`);
}
