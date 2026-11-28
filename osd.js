'use strict';

// Drawing on mpv's screen: styled text and shapes in ASS (the subtitle format mpv's osd-overlay
// takes), on a 1280×720 canvas.

// Text inside mpv's styled messages: braces and backslashes would be read as styling.
const escapeAss = (s) => String(s).replace(/\\/g, '\\\\').replace(/[{}]/g, (c) => `\\${c}`);

// A rounded rectangle, as an ASS drawing.
function roundRect(x, y, w, h, r) {
  const R = (n) => Math.round(n);
  return `m ${R(x + r)} ${R(y)} l ${R(x + w - r)} ${R(y)} b ${R(x + w)} ${R(y)} ${R(x + w)} ${R(y)} ${R(x + w)} ${R(y + r)} ` +
    `l ${R(x + w)} ${R(y + h - r)} b ${R(x + w)} ${R(y + h)} ${R(x + w)} ${R(y + h)} ${R(x + w - r)} ${R(y + h)} ` +
    `l ${R(x + r)} ${R(y + h)} b ${R(x)} ${R(y + h)} ${R(x)} ${R(y + h)} ${R(x)} ${R(y + h - r)} ` +
    `l ${R(x)} ${R(y + r)} b ${R(x)} ${R(y)} ${R(x)} ${R(y)} ${R(x + r)} ${R(y)}`;
}
// An ASS alpha (00 solid, FF invisible), part-way faded in.
const alpha = (base, k) => {
  const a = Math.round(255 - (255 - base) * k);
  return `&H${a.toString(16).padStart(2, '0').toUpperCase()}&`;
};
// Roughly how wide a keycap's name is, so the caps fit their names (ASS can't measure text).
const capWidth = (name) => Math.max(34, 18 + [...name].reduce((w, ch) => w + (/[▲▼◀▶]/.test(ch) ? 13 : /[A-Z0-9]/.test(ch) ? 11.5 : 9.5), 0));

// ---- the theme's colours (Settings → Look), so mpv's panels match the rest of the app.
// ASS writes colours blue-green-red: #RRGGBB becomes &HBBGGRR&.
const bgr = (hex) => { const h = String(hex || '').replace('#', ''); return /^[0-9a-f]{6}$/i.test(h) ? (h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase() : null; };
const DEFAULT = { bg: '#14181e', surface: '#2c303a', line: '#484e5a', text: '#ffffff', muted: '#aab0be', focus: '#eceef2', onFocus: '#14161c', accent: '#7cc4ff', gold: '#f2c66d' };
const C = {};
function setColors(colors) {
  const c = { ...DEFAULT, ...(colors || {}) };
  for (const k of Object.keys(DEFAULT)) C[k] = bgr(c[k]) || bgr(DEFAULT[k]);
}
setColors();

// A soft shadow under a panel (a dark shape, blurred), as it fades in (k 0..1).
const shadow = (x, y, w, h, r, k) => `{\\an7\\pos(0,0)\\bord0\\shad0\\blur16\\1c&H000000&\\1a${alpha(0x60, k)}\\p1}${roundRect(x - 4, y + 10, w + 8, h + 4, r + 4)}{\\p0}`;
// A panel: its shadow, the panel, and a thin line of light along the top edge.
const panel = (x, y, w, h, r, k, base = 0x14) => [
  shadow(x, y, w, h, r, k),
  `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.bg}&\\1a${alpha(base, k)}\\p1}${roundRect(x, y, w, h, r)}{\\p0}`,
  `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.text}&\\1a${alpha(0xD0, k)}\\p1}${roundRect(x + r, y, w - 2 * r, 1.5, 0.7)}{\\p0}`,
].join('\n');
// A darkening that rises from the bottom of the screen, behind the menus, so they sit on the
// picture rather than in a box on top of it. (Strips, each a little darker, softened together.)
function scrim(from, k) {
  const out = []; const N = 14; const h = (720 - from) / N;
  for (let i = 0; i < N; i++) {
    const a = Math.round(255 - (i + 1) / N * 150 * k); // (down to about 60 % dark at the bottom)
    out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\blur10\\1c&H000000&\\1a&H${Math.max(0, a).toString(16).padStart(2, '0').toUpperCase()}&\\p1}m -20 ${Math.round(from + i * h)} l 1300 ${Math.round(from + i * h)} l 1300 740 l -20 740{\\p0}`);
  }
  return out.join('\n');
}

// ---- small icons (drawn in a 20×20 box at x, y)
const ICONS = {
  play: 'm 5 3 l 17 10 l 5 17',
  pause: 'm 4 3 l 8 3 l 8 17 l 4 17 m 12 3 l 16 3 l 16 17 l 12 17',
  prev: 'm 3 3 l 6 3 l 6 17 l 3 17 m 17 3 l 17 17 l 7 10',
  next: 'm 14 3 l 17 3 l 17 17 l 14 17 m 3 3 l 13 10 l 3 17',
  skip: 'm 2 3 l 10 10 l 2 17 m 9 3 l 17 10 l 9 17',
  stop: 'm 4 4 l 16 4 l 16 16 l 4 16',
  playhead: 'm 1 9 l 19 9 l 19 11 l 1 11 m 8 4 l 12 4 l 12 16 l 8 16',
  subs: 'm 1 4 l 19 4 l 19 16 l 1 16 l 1 4 m 3 6 l 3 14 l 17 14 l 17 6 m 5 10 l 9 10 l 9 12 l 5 12 m 11 10 l 15 10 l 15 12 l 11 12',
  audio: 'm 2 8 l 4 8 l 4 12 l 2 12 m 6 5 l 8 5 l 8 15 l 6 15 m 10 2 l 12 2 l 12 18 l 10 18 m 14 6 l 16 6 l 16 14 l 14 14',
  speakers: 'm 2 7 l 6 7 l 11 3 l 11 17 l 6 13 l 2 13 m 13 7 l 15 6 b 17 8 17 12 15 14 l 13 13 b 14 11 14 9 13 7',
  picture: 'm 1 3 l 19 3 l 19 17 l 1 17 l 1 3 m 3 5 l 3 15 l 17 15 l 17 5 m 4 14 l 8 9 l 11 12 l 13 10 l 16 14',
  qr: 'm 2 2 l 8 2 l 8 8 l 2 8 m 12 2 l 18 2 l 18 8 l 12 8 m 2 12 l 8 12 l 8 18 l 2 18 m 12 12 l 14 12 l 14 14 l 12 14 m 16 16 l 18 16 l 18 18 l 16 18 m 15 12 l 18 12 l 18 14 l 15 14',
  whatson: 'm 9 3 l 11 3 l 11 5 l 9 5 m 9 8 l 11 8 l 11 17 l 9 17',
};
// The icon's path moved to x, y (ASS drawings can't be moved with \pos when several share a line).
function icon(name, x, y, color, a = '&H00&', scale = 1) {
  const d = ICONS[name];
  if (!d) return '';
  const moved = d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, px, py) => `${Math.round((x + px * scale) * 10) / 10} ${Math.round((y + py * scale) * 10) / 10}`);
  return `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${color}&\\1a${a}\\p1}${moved}{\\p0}`;
}

module.exports = { escapeAss, roundRect, alpha, capWidth, C, setColors, shadow, panel, scrim, icon, ICONS };
