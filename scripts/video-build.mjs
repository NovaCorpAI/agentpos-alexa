#!/usr/bin/env node
/**
 * Builds the submission video from the frames filmed by scripts/video-record.mjs and the
 * Polly narration from scripts/video-narration.mjs.
 *
 * Every frame is shown for exactly the time that passed before the next one was taken, so the
 * picture runs at the pace of the real session; the whole thing is then sped up just enough to
 * fit the limit, and each narration line starts where its shot began. H.264 and AAC for YouTube.
 *
 *   node scripts/video-build.mjs [out.mp4] [--max-seconds 170]
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const output = resolve(root, positional[0] ?? ".data/video/agentpos-alexa-demo.mp4");
const maxSeconds = Number(process.argv[process.argv.indexOf("--max-seconds") + 1]) || 170;
const narrationFile = resolve(root, ".data/video/narration/manifest.json");
const framesFile = resolve(root, ".data/video/frames.json");
const work = resolve(tmpdir(), "agentpos-video", "build");
mkdirSync(work, { recursive: true });
mkdirSync(resolve(output, ".."), { recursive: true });

const require_ = createRequire(resolve(root, "package.json"));
const bin = (which, envVar) => {
  if (process.env[envVar]) return process.env[envVar];
  try {
    return which === "ffmpeg" ? require_("ffmpeg-static") : require_("ffprobe-static").path;
  } catch {
    throw new Error(`${which} not found: set ${envVar} or install ffmpeg-static and ffprobe-static`);
  }
};
const FFMPEG = bin("ffmpeg", "FFMPEG_PATH");
const FFPROBE = bin("ffprobe", "FFPROBE_PATH");
const run = (exe, args, what) => {
  const r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${what} failed: ${`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-900)}`);
  return `${r.stdout ?? ""}`.trim();
};
const duration = (file) => Number(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], "ffprobe")) || 0;

for (const [what, file] of [["narration", narrationFile], ["frames", framesFile]]) {
  if (!existsSync(file)) throw new Error(`no ${what} at ${file}; run the other script first`);
}
const { lines } = JSON.parse(readFileSync(narrationFile, "utf8"));
const { seconds: filmed, frames, shots } = JSON.parse(readFileSync(framesFile, "utf8"));
const usable = frames.filter((f) => existsSync(f.file) && statSync(f.file).size > 5_000);
if (usable.length < 10) throw new Error(`only ${usable.length} frames; film again`);

// A frame lasts until the next one was taken, capped so a pause does not become a freeze.
// That cap makes the film shorter than the session, so the shot marks are carried over onto
// the picture's own clock rather than the wall clock.
let pictureClock = 0;
const clock = [];
const list = usable
  .map((f, i) => {
    const until = i + 1 < usable.length ? usable[i + 1].at : filmed;
    const seconds = Math.min(6, Math.max(0.25, Math.round((until - f.at) * 100) / 100));
    clock.push({ at: f.at, pictureAt: Math.round(pictureClock * 100) / 100 });
    pictureClock += seconds;
    return `file '${f.file.replace(/\\/g, "/")}'\nduration ${seconds}`;
  })
  .join("\n");

/** Where a moment of the session lands in the film. */
const onPicture = (at) => {
  let last = clock[0];
  for (const c of clock) {
    if (c.at > at) break;
    last = c;
  }
  return last.pictureAt;
};
const listFile = resolve(work, "frames.txt");
// The concat demuxer ignores the last duration unless the file is named once more.
writeFileSync(listFile, `${list}\nfile '${usable.at(-1).file.replace(/\\/g, "/")}'\n`);

const silent = resolve(work, "picture.mp4");
run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "scale=1280:-2,format=yuv420p", "-r", "24", "-c:v", "libx264", "-preset", "medium", "-crf", "23", silent], "picture");
const pictureSeconds = duration(silent);

// Speed up only as much as the limit demands, and place each line where its shot began.
const speed = Math.max(1, pictureSeconds / maxSeconds);
const timeline = shots
  .map((s) => {
    const line = lines.find((l) => l.line === s.line);
    return line ? { line: s.line, start: Math.round((onPicture(s.at) / speed) * 100) / 100, seconds: line.seconds, file: line.file, text: line.text } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.start - b.start);
for (let i = 1; i < timeline.length; i++) {
  const prev = timeline[i - 1];
  if (timeline[i].start < prev.start + prev.seconds + 0.3) timeline[i].start = Math.round((prev.start + prev.seconds + 0.3) * 100) / 100;
}
writeFileSync(resolve(root, ".data/video/timeline.json"), JSON.stringify({ speed: Math.round(speed * 100) / 100, pictureSeconds, timeline }, null, 2));

const args = ["-y", "-i", silent];
for (const t of timeline) args.push("-i", t.file);
const delays = timeline.map((t, i) => `[${i + 1}:a]adelay=${Math.round(t.start * 1000)}|${Math.round(t.start * 1000)}[a${i}]`).join(";");
const filter = `[0:v]setpts=PTS/${speed.toFixed(4)}[v];${delays};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,volume=2[voice]`;
args.push("-filter_complex", filter, "-map", "[v]", "-map", "[voice]", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output);
run(FFMPEG, args, "mux");

console.log(`done: ${output}`);
console.log(`${usable.length} frames, ${pictureSeconds.toFixed(1)}s filmed, ${speed.toFixed(2)}x, final ${duration(output).toFixed(1)}s, ${(statSync(output).size / 1024 / 1024).toFixed(1)} MB`);
console.log(timeline.map((t) => `${t.line}@${t.start}s`).join(", "));
