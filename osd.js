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


module.exports = { escapeAss, roundRect, alpha, capWidth };
