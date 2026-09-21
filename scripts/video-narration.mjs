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
  "A store, reached the way Alexa Plus reaches one: over MCP, answering from what it publishes.",
  "The baker pastes her address. An agent reads her catalog and drafts how each item should sound out loud. Nothing is published until she confirms.",
  "Buying is a conversation. The checkout is the host's, not a web page.",
  "Her own Stripe charges the card, in test mode. The bridge never sees the key. The Amazon wallet handlers are simulated, and labeled.",
  "A guardian checks before any money moves, and the household decides, not the agent.",
  "One cart, item by item, like a person would.",
  "Memory holds order references only, on AgentCore Memory. No names, no addresses.",
  "The store answers about its catalog. The host answers about you: what you bought here, and what you have spent this month.",
  "One switch, and the whole thing speaks Spanish. This was built in Chile, for stores like these.",
  "A closed checkout session costs a fifth of a cent in inference. Twelve friction log entries, each with the time it cost and a suggestion. Open source from the first commit, and the playground is live.",
];

/**
 * Duration of an MP3 by summing its frames; no decoder needed. Polly's generative voices
 * answer in MPEG2 at 24 kHz, whose frames hold 576 samples and use a bitrate table of their
 * own: reading them as MPEG1 reports about 40 percent of the real length, and an edit cut to
 * that is an edit cut short.
 */
export function mp3DurationSeconds(buf) {
  const BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  };
  const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const SAMPLES = { 1: 1152, 2: 576 };
  let i = 0;
  let seconds = 0;
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "ID3") {
    i = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const versionBits = (buf[i + 1] >> 3) & 0x03; // 3 MPEG1, 2 MPEG2, 0 MPEG2.5
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 is Layer III
    const rates = SAMPLE_RATES[versionBits];
    if (!rates || layerBits !== 1) {
      i++;
      continue;
    }
    const generation = versionBits === 3 ? 1 : 2;
    const bitrate = BITRATES[generation][(buf[i + 2] & 0xf0) >> 4] * 1000;
    const sampleRate = rates[(buf[i + 2] & 0x0c) >> 2];
    if (!bitrate || !sampleRate) {
      i++;
      continue;
    }
    const samples = SAMPLES[generation];
    const padding = (buf[i + 2] & 0x02) >> 1;
    const frame = Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
    seconds += samples / sampleRate;
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
