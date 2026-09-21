#!/usr/bin/env node
/**
 * Draws the AgentPOS channel banner (docs/brand/PHILOSOPHY.md: Ledger Frequency).
 *
 * 2560 by 1440, with every word inside YouTube's 1546 by 423 safe area so a phone shows the
 * same wordmark a television does. The field is a band of thin vertical strokes whose lengths
 * come from a fixed seed: read quickly it is a waveform, read slowly it is a day of takings.
 *
 *   node scripts/brand-banner.mjs [out.png]
 *
 * Fonts come from the canvas-design skill; set CANVAS_FONTS to point elsewhere.
 */
import { Resvg } from "@resvg/resvg-js";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, process.argv[2] ?? "docs/assets/youtube-banner.png");
mkdirSync(resolve(out, ".."), { recursive: true });

function fontDir() {
  if (process.env.CANVAS_FONTS) return process.env.CANVAS_FONTS;
  const base = resolve(homedir(), ".claude/skills/synced");
  if (!existsSync(base)) throw new Error("set CANVAS_FONTS to a folder of .ttf files");
  for (const entry of readdirSync(base)) {
    const dir = resolve(base, entry, "canvas-design/canvas-fonts");
    if (existsSync(dir)) return dir;
  }
  throw new Error("canvas-fonts not found; set CANVAS_FONTS");
}

const W = 2560;
const H = 1440;
const SAFE_W = 1546;
const SAFE_H = 423;
const safeX = (W - SAFE_W) / 2;
const safeY = (H - SAFE_H) / 2;

const INK = "#080B12";
const INK_SOFT = "#0E141F";
const BONE = "#E8E1D4";
const EMBER = "#D9813C";

/** One fixed sequence, so the banner is the same drawing every time it is made. */
function* rand(seed = 20260919) {
  let s = seed >>> 0;
  for (;;) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    yield ((s >>> 0) % 1_000_000) / 1_000_000;
  }
}
const r = rand();
const next = () => r.next().value;

/** Eases a value between two edges, for the taper into silence. */
const smooth = (v, a, b) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The band: strokes at an even pitch, length from a slow swell, a speech-like burst pattern
 * and a little noise. The ember marks the few entries that matter, as a ledger does. Around
 * the wordmark the line holds still: the account stops speaking where it signs its name.
 */
function band() {
  const pitch = 6;
  const left = 96;
  const right = W - 96;
  const mid = H / 2;
  const hush = 556; // half-width of the silence the word keeps around itself
  const taper = 236; // and how far the voice takes to fall into it
  const parts = [];
  let i = 0;
  for (let x = left; x <= right; x += pitch, i++) {
    const t = (x - left) / (right - left);
    const swell = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * t * 1.6 + 0.4));
    const syllable = 0.55 + 0.45 * Math.sin(t * 61) * Math.sin(t * 17 + 1.2);
    const grain = 0.86 + next() * 0.28;
    const quiet = smooth(Math.abs(x - W / 2), hush, hush + taper);
    if (quiet <= 0.002) continue;
    const h = Math.max(5, 470 * swell * quiet * Math.abs(syllable) * grain);
    const ember = i % 97 === 11;
    const faint = h < 40;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${(mid - h / 2).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${ember ? EMBER : BONE}" opacity="${(ember ? 0.92 : faint ? 0.18 : 0.34) * (0.35 + 0.65 * quiet)}"/>`,
    );
  }
  // The held line through the silence, drawn once, as thin as the ruling it belongs to.
  parts.push(`<line x1="${W / 2 - hush - taper * 0.6}" y1="${mid}" x2="${W / 2 + hush + taper * 0.6}" y2="${mid}" stroke="${BONE}" stroke-width="1" opacity="0.14"/>`);
  return parts.join("");
}

/** Hairline ruling, the account book under the voice. */
function ruling() {
  const lines = [];
  for (let y = 120; y < H; y += 120) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${BONE}" stroke-width="0.6" opacity="0.05"/>`);
  for (let x = 160; x < W; x += 160) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${BONE}" stroke-width="0.6" opacity="0.035"/>`);
  return lines.join("");
}

/** Registration marks at the corners of the safe area: the plate knows its own frame. */
function marks() {
  const m = [];
  const arm = 26;
  for (const [x, y] of [
    [safeX, safeY],
    [safeX + SAFE_W, safeY],
    [safeX, safeY + SAFE_H],
    [safeX + SAFE_W, safeY + SAFE_H],
  ]) {
    const sx = x === safeX ? 1 : -1;
    const sy = y === safeY ? 1 : -1;
    m.push(`<path d="M ${x} ${y + sy * arm} L ${x} ${y} L ${x + sx * arm} ${y}" stroke="${BONE}" stroke-width="1" opacity="0.22" fill="none"/>`);
  }
  return m.join("");
}

/** Index numbers along the band, the scale of an instrument no one will read. */
function scale() {
  const t = [];
  for (let i = 0; i <= 8; i++) {
    const x = 96 + ((W - 192) / 8) * i;
    t.push(`<line x1="${x}" y1="${H / 2 + 300}" x2="${x}" y2="${H / 2 + 314}" stroke="${BONE}" stroke-width="1" opacity="0.2"/>`);
    t.push(
      `<text x="${x}" y="${H / 2 + 340}" font-family="GeistMono" font-size="15" letter-spacing="3" fill="${BONE}" opacity="0.22" text-anchor="middle">${String(i * 12).padStart(3, "0")}</text>`,
    );
  }
  return t.join("");
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vault" cx="50%" cy="50%" r="72%">
      <stop offset="0%" stop-color="${INK_SOFT}"/>
      <stop offset="100%" stop-color="${INK}"/>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${INK}" stop-opacity="1"/>
      <stop offset="14%" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="86%" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${INK}" stop-opacity="1"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#vault)"/>
  ${ruling()}
  ${band()}
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  ${scale()}
  ${marks()}

  <g text-anchor="middle">
    <text x="${W / 2}" y="${H / 2 - 92}" font-family="GeistMono" font-size="19" letter-spacing="13" fill="${BONE}" opacity="0.56">THE BRIDGE BETWEEN A STORE AND A VOICE</text>
    <text x="${W / 2}" y="${H / 2 + 62}" font-family="Jura" font-weight="300" font-size="188" letter-spacing="14" fill="${BONE}">Agent<tspan fill="${EMBER}">POS</tspan></text>
    <line x1="${W / 2 - 300}" y1="${H / 2 + 112}" x2="${W / 2 + 300}" y2="${H / 2 + 112}" stroke="${BONE}" stroke-width="0.8" opacity="0.28"/>
    <text x="${W / 2}" y="${H / 2 + 158}" font-family="GeistMono" font-size="17" letter-spacing="9" fill="${BONE}" opacity="0.5">OPEN SOURCE COMMERCE FOR AGENTS</text>
  </g>
</svg>`;

/** The same plate at 1:1, for a profile picture: the word, the ember, one held line. */
function avatar() {
  const S = 800;
  const mid = S / 2;
  const strokes = [];
  for (let x = 70; x <= S - 70; x += 7) {
    const t = (x - 70) / (S - 140);
    const quiet = smooth(Math.abs(x - mid), 150, 240);
    if (quiet <= 0.002) continue;
    const h = Math.max(4, 150 * quiet * Math.abs(0.5 + 0.5 * Math.sin(t * 43) * Math.sin(t * 13 + 0.7)) * (0.85 + next() * 0.3));
    strokes.push(`<rect x="${x.toFixed(1)}" y="${(mid + 96 - h / 2).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${BONE}" opacity="${(0.3 * (0.4 + 0.6 * quiet)).toFixed(3)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
    <rect width="${S}" height="${S}" fill="${INK}"/>
    ${[240, 360, 480].map((y) => `<line x1="0" y1="${y}" x2="${S}" y2="${y}" stroke="${BONE}" stroke-width="0.6" opacity="0.05"/>`).join("")}
    ${strokes.join("")}
    <line x1="${mid - 220}" y1="${mid + 96}" x2="${mid + 220}" y2="${mid + 96}" stroke="${BONE}" stroke-width="1" opacity="0.13"/>
    <g text-anchor="middle">
      <text x="${mid}" y="${mid - 78}" font-family="Jura" font-weight="300" font-size="132" letter-spacing="6" fill="${BONE}">Agent</text>
      <text x="${mid}" y="${mid + 46}" font-family="Jura" font-weight="300" font-size="132" letter-spacing="16" fill="${EMBER}">POS</text>
    </g>
  </svg>`;
}

/**
 * The submission thumbnail, 1500 by 1000: the same plate, tighter, with the one line that
 * says who this is for. Nothing here is a screenshot; the picture is the argument.
 */
function thumbnail() {
  const TW = 1500;
  const TH = 1000;
  const mid = TH / 2;
  const strokes = [];
  for (let x = 80; x <= TW - 80; x += 6) {
    const t = (x - 80) / (TW - 160);
    const quiet = smooth(Math.abs(x - TW / 2), 372, 560);
    if (quiet <= 0.002) continue;
    const h = Math.max(5, 300 * quiet * Math.abs(0.5 + 0.5 * Math.sin(t * 57) * Math.sin(t * 15 + 0.9)) * (0.85 + next() * 0.3));
    strokes.push(`<rect x="${x.toFixed(1)}" y="${(mid + 150 - h / 2).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${BONE}" opacity="${(0.3 * (0.4 + 0.6 * quiet)).toFixed(3)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">
    <rect width="${TW}" height="${TH}" fill="${INK}"/>
    ${[160, 320, 480, 640, 800].map((y) => `<line x1="0" y1="${y}" x2="${TW}" y2="${y}" stroke="${BONE}" stroke-width="0.6" opacity="0.045"/>`).join("")}
    ${strokes.join("")}
    <line x1="${TW / 2 - 430}" y1="${mid + 150}" x2="${TW / 2 + 430}" y2="${mid + 150}" stroke="${BONE}" stroke-width="1" opacity="0.13"/>
    <g text-anchor="middle">
      <text x="${TW / 2}" y="${mid - 236}" font-family="GeistMono" font-size="20" letter-spacing="12" fill="${BONE}" opacity="0.5">ALEXA+ ADD-ON FOR AGENTPOS STORES</text>
      <text x="${TW / 2}" y="${mid - 88}" font-family="Jura" font-weight="300" font-size="170" letter-spacing="12" fill="${BONE}">Agent<tspan fill="${EMBER}">POS</tspan></text>
      <text x="${TW / 2}" y="${mid + 26}" font-family="Instrument Serif" font-size="58" fill="${BONE}" opacity="0.88">Alexa+ for Builders is for Priceline.</text>
      <text x="${TW / 2}" y="${mid + 96}" font-family="Instrument Serif" font-size="58" fill="${EMBER}">This is for the corner store.</text>
      <text x="${TW / 2}" y="${mid + 300}" font-family="GeistMono" font-size="18" letter-spacing="7" fill="${BONE}" opacity="0.4">MCP · UCP CHECKOUT · BEDROCK AGENTS · APACHE-2.0</text>
    </g>
  </svg>`;
}

/**
 * The video thumbnail, 1280 by 720: what a person sees in a list of submissions before they
 * press play. Same plate as the rest, one claim, and the three words that place it.
 */
function videoThumbnail() {
  const TW = 1280;
  const TH = 720;
  const mid = TH / 2;
  const strokes = [];
  for (let x = 70; x <= TW - 70; x += 6) {
    const t = (x - 70) / (TW - 140);
    const quiet = smooth(Math.abs(x - TW / 2), 300, 470);
    if (quiet <= 0.002) continue;
    const h = Math.max(5, 230 * quiet * Math.abs(0.5 + 0.5 * Math.sin(t * 57) * Math.sin(t * 15 + 0.9)) * (0.85 + next() * 0.3));
    strokes.push(`<rect x="${x.toFixed(1)}" y="${(mid + 120 - h / 2).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${BONE}" opacity="${(0.3 * (0.4 + 0.6 * quiet)).toFixed(3)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">
    <rect width="${TW}" height="${TH}" fill="${INK}"/>
    ${[120, 240, 360, 480, 600].map((y) => `<line x1="0" y1="${y}" x2="${TW}" y2="${y}" stroke="${BONE}" stroke-width="0.6" opacity="0.045"/>`).join("")}
    ${strokes.join("")}
    <line x1="${TW / 2 - 360}" y1="${mid + 120}" x2="${TW / 2 + 360}" y2="${mid + 120}" stroke="${BONE}" stroke-width="1" opacity="0.13"/>
    <g text-anchor="middle">
      <text x="${TW / 2}" y="${mid - 168}" font-family="GeistMono" font-size="17" letter-spacing="10" fill="${BONE}" opacity="0.5">ALEXA+ ADD-ON FOR AGENTPOS STORES</text>
      <text x="${TW / 2}" y="${mid - 52}" font-family="Jura" font-weight="300" font-size="132" letter-spacing="10" fill="${BONE}">Agent<tspan fill="${EMBER}">POS</tspan></text>
      <text x="${TW / 2}" y="${mid + 34}" font-family="Instrument Serif" font-size="46" fill="${EMBER}">Buy from the corner store, by voice.</text>
      <text x="${TW / 2}" y="${mid + 248}" font-family="GeistMono" font-size="16" letter-spacing="6" fill="${BONE}" opacity="0.4">MCP · UCP CHECKOUT · BEDROCK AGENTS · APACHE-2.0</text>
    </g>
  </svg>`;
}

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: { fontDirs: [fontDir()], loadSystemFonts: false, defaultFontFamily: "Jura" },
  background: INK,
}).render();
writeFileSync(out, png.asPng());
console.log(`wrote ${out}`);

const thumb = resolve(out, "..", "devpost-thumbnail.png");
const thumbPng = new Resvg(thumbnail(), { fitTo: { mode: "width", value: 1500 }, font: { fontDirs: [fontDir()], loadSystemFonts: false, defaultFontFamily: "Jura" }, background: INK }).render();
writeFileSync(thumb, thumbPng.asPng());
console.log(`wrote ${thumb}`);

const videoThumb = resolve(out, "..", "youtube-thumbnail.png");
const videoThumbPng = new Resvg(videoThumbnail(), { fitTo: { mode: "width", value: 1280 }, font: { fontDirs: [fontDir()], loadSystemFonts: false, defaultFontFamily: "Jura" }, background: INK }).render();
writeFileSync(videoThumb, videoThumbPng.asPng());
console.log(`wrote ${videoThumb}`);

const square = resolve(out, "..", "youtube-avatar.png");
const avatarPng = new Resvg(avatar(), { fitTo: { mode: "width", value: 800 }, font: { fontDirs: [fontDir()], loadSystemFonts: false, defaultFontFamily: "Jura" }, background: INK }).render();
writeFileSync(square, avatarPng.asPng());
console.log(`wrote ${square}`);
