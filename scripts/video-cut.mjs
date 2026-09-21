#!/usr/bin/env node
/**
 * Cuts the takes from scripts/video-shoot.mjs into the demo video.
 *
 *   node scripts/video-cut.mjs [out.mp4]
 *
 * Each take is real screen motion, so nothing is a slide. What the cut does is take the dead
 * air out: a take is three parts, the typing, the model thinking, and the answer landing, and
 * only the middle one is sped up, by exactly as much as it takes for the beat to last as long
 * as its line of narration. Typing and answers always play at their own speed.
 *
 * A title card opens and an end card closes, both from the project's own palette.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require_ = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const out = process.argv[2] ? resolve(root, process.argv[2]) : resolve(root, ".data/video/agentpos-alexa-demo.mp4");
const work = resolve(root, ".data/video/cut");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const FFMPEG = process.env.FFMPEG_PATH ?? (() => {
  try {
    return require_("ffmpeg-static");
  } catch {
    return "ffmpeg";
  }
})();

const W = 1920;
const H = 1080;
const FPS = 30;
const FONT = "C\\:/Windows/Fonts/segoeui.ttf";
const INK = "0x080B12";
const EMBER = "0xD9813C";
const BONE = "0xE8E1D4";

const run = (args, what) => {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg ${what} failed:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1200)}`);
};

/** Seconds of a media file, read from ffmpeg's own report. */
function seconds(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (!m) throw new Error(`no duration for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const takes = JSON.parse(readFileSync(resolve(root, ".data/video/takes.json"), "utf8"));
const narration = JSON.parse(readFileSync(resolve(root, ".data/video/narration/manifest.json"), "utf8"));
const line = (n) => narration.lines.find((l) => l.line === n);

/** The beat each take carries, in order, against the line of narration that speaks over it. */
const BEATS = [
  { take: "hello", narration: 2 },
  { take: "merchant", narration: 3 },
  { take: "buy", narration: 4 },
  { take: "pay", narration: 5 },
  { take: "guardian", narration: 6 },
  { take: "cart", narration: 7 },
  { take: "memory", narration: 8 },
  { take: "history", narration: 9 },
  { take: "spanish", narration: 10 },
];

/** A still card: the project's ink, one line in ember, one in bone, fading in and out. */
function card(file, top, bottom, durationS) {
  const esc = (s) => s.replace(/:/g, "\\:").replace(/'/g, "\\'");
  const filters = [
    `drawtext=fontfile='${FONT}':text='${esc(top)}':fontcolor=${EMBER}:fontsize=64:x=(w-text_w)/2:y=(h/2)-90`,
    `drawtext=fontfile='${FONT}':text='${esc(bottom)}':fontcolor=${BONE}:fontsize=36:x=(w-text_w)/2:y=(h/2)+10`,
    `fade=t=in:st=0:d=0.5`,
    `fade=t=out:st=${(durationS - 0.5).toFixed(2)}:d=0.5`,
  ].join(",");
  run(["-y", "-f", "lavfi", "-i", `color=c=${INK}:s=${W}x${H}:r=${FPS}:d=${durationS.toFixed(2)}`, "-vf", filters, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", file], `card ${file}`);
  return durationS;
}

/**
 * One beat, cut to the length of its narration: the typing and the answer at their own speed,
 * the waiting in between compressed to fit. Never the other way round.
 */
function beat(file, take, targetS) {
  const total = seconds(take.file);
  const typed = Math.min(((take.typedMs ?? 1500) + 700) / 1000, total - 0.5);
  const answered = Math.min(Math.max((take.answeredMs ?? take.typedMs ?? 2000) / 1000, typed + 0.2), total);
  const headS = typed;
  const tailS = Math.max(total - answered, 0.5);
  const waitS = Math.max(answered - typed, 0.1);
  // What the beat needs to last, minus what plays at its own speed, is what the wait has to fit into.
  const room = Math.max(targetS - headS - tailS, 0.35);
  const speed = Math.min(Math.max(waitS / room, 1), 16);

  const filter = [
    `[0:v]trim=start=0:end=${headS.toFixed(3)},setpts=PTS-STARTPTS[h]`,
    `[0:v]trim=start=${headS.toFixed(3)}:end=${answered.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[w]`,
    `[0:v]trim=start=${answered.toFixed(3)},setpts=PTS-STARTPTS[t]`,
    `[h][w][t]concat=n=3:v=1:a=0,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${INK},fps=${FPS},format=yuv420p[v]`,
  ].join(";");
  run(["-y", "-i", take.file, "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", file], `beat ${take.name}`);
  return seconds(file);
}

const segments = [];
let clock = 0;
/** Where each line of narration starts, in the finished cut. */
const voice = [];

const titleS = line(1).seconds + 1.6;
const titleFile = resolve(work, "00-title.mp4");
card(titleFile, "AgentPOS for Alexa+", "the bridge a corner store can afford", titleS);
segments.push({ file: titleFile, seconds: titleS });
voice.push({ file: line(1).file, atS: 0.6 });
clock += titleS;

for (const [i, b] of BEATS.entries()) {
  const take = takes.takes.find((t) => t.name === b.take);
  if (!take || !existsSync(take.file) || statSync(take.file).size < 60_000 || seconds(take.file) < 2) {
    console.log(JSON.stringify({ msg: "take missing or too short, skipped", beat: b.take }));
    continue;
  }
  const spoken = line(b.narration);
  const target = spoken.seconds + 1.8;
  const file = resolve(work, `${String(i + 1).padStart(2, "0")}-${b.take}.mp4`);
  const actual = beat(file, take, target);
  segments.push({ file, seconds: actual });
  voice.push({ file: spoken.file, atS: clock + 0.5 });
  clock += actual;
}

const endS = line(11).seconds + 2.2;
const endFile = resolve(work, "99-end.mp4");
card(endFile, "alexa.agentposhq.com", "github.com/NovaCorpAI/agentpos-alexa, Apache-2.0", endS);
segments.push({ file: endFile, seconds: endS });
voice.push({ file: line(11).file, atS: clock + 0.6 });
clock += endS;

// The picture, end to end.
const listFile = resolve(work, "segments.txt");
writeFileSync(listFile, segments.map((s) => `file '${s.file.replace(/\\/g, "/")}'`).join("\n") + "\n");
const picture = resolve(work, "picture.mp4");
run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", picture], "concat");

// The voice over, each line where its beat starts.
const args = ["-y", "-i", picture];
for (const v of voice) args.push("-i", v.file);
const delays = voice.map((v, i) => `[${i + 1}:a]adelay=${Math.round(v.atS * 1000)}|${Math.round(v.atS * 1000)}[a${i}]`).join(";");
const mix = `${delays};${voice.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voice.length}:normalize=0,volume=1.8[voice]`;
args.push("-filter_complex", mix, "-map", "0:v", "-map", "[voice]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out);
run(args, "mux");

console.log(JSON.stringify({ msg: "cut", out, seconds: Number(seconds(out).toFixed(1)), segments: segments.length, sizeMb: Number((statSync(out).size / 1024 / 1024).toFixed(1)) }, null, 2));
