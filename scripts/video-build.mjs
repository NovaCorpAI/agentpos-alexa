#!/usr/bin/env node
/**
 * Builds the submission video: the recorded screen (scripts/video-record.mjs) plus the Polly
 * narration (scripts/video-narration.mjs), laid on one audio track at the shot times, encoded
 * as H.264 and AAC for YouTube.
 *
 *   node scripts/video-build.mjs [in.webm] [out.mp4]
 *
 * ffmpeg comes from the ffmpeg-static package; pass FFMPEG_PATH to use another binary.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const input = resolve(root, process.argv[2] ?? ".data/video/demo.webm");
const output = resolve(root, process.argv[3] ?? ".data/video/agentpos-alexa-demo.mp4");
const manifestFile = resolve(root, ".data/video/narration/manifest.json");

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const base of [root, process.env.FFMPEG_MODULES ?? ""]) {
    try {
      return createRequire(resolve(base || root, "package.json"))("ffmpeg-static");
    } catch {}
  }
  throw new Error("ffmpeg not found: set FFMPEG_PATH or install ffmpeg-static");
}

if (!existsSync(input)) throw new Error(`no recording at ${input}; run scripts/video-record.mjs first`);
if (!existsSync(manifestFile)) throw new Error(`no narration at ${manifestFile}; run scripts/video-narration.mjs first`);

const { lines } = JSON.parse(readFileSync(manifestFile, "utf8"));
/**
 * When each line starts, in seconds. The recorder holds every shot for the line's own length
 * plus its pause, so the same numbers place the audio: each line starts where the last shot
 * ended, and the pauses are the room between them.
 */
const starts = [];
let t = 0;
const EXTRA = { 1: 1.5, 2: 6, 3: 4, 4: 6, 5: 5, 6: 6, 7: 6, 8: 6, 9: 4, 10: 6, 11: 3, 12: 3, 13: 3 };
for (const l of lines) {
  starts.push({ ...l, start: Math.round(t * 100) / 100 });
  t += l.seconds + (EXTRA[l.line] ?? 2);
  if (l.line === 5) t += 6; // the organic question has no narration of its own
  if (l.line === 9) t += 8; // the yes, plus the fresh conversation before "the same as last week"
}
writeFileSync(resolve(root, ".data/video/timeline.json"), JSON.stringify(starts, null, 2));

const args = ["-y", "-i", input];
for (const l of starts) args.push("-i", l.file);
const delays = starts.map((l, i) => `[${i + 1}:a]adelay=${Math.round(l.start * 1000)}|${Math.round(l.start * 1000)}[a${i}]`).join(";");
const mix = `${delays};${starts.map((_, i) => `[a${i}]`).join("")}amix=inputs=${starts.length}:normalize=0[voice]`;
args.push(
  "-filter_complex",
  mix,
  "-map",
  "0:v",
  "-map",
  "[voice]",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "21",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "160k",
  "-movflags",
  "+faststart",
  "-shortest",
  output,
);

console.log(`building ${output}`);
const r = spawnSync(ffmpegPath(), args, { encoding: "utf8" });
if (r.status !== 0) {
  console.error(`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1500));
  process.exit(1);
}
console.log(`done: ${output}`);
console.log(`narration starts at ${starts.map((s) => `${s.line}@${s.start}s`).join(", ")}`);
