'use strict';

// Themes (Settings → Look) are made of pieces, each kind in its own folder:
//   colour schemes, fonts, sound packs, effects (snow, film grain... any number at once),
//   backgrounds (one at a time) and layouts (how Home is arranged, chosen separately).
// A *mood* is just a set of those pieces with a name (Christmas, Horror...). Your *saved themes*
// are the same, kept in ten numbered slots. Everything comes from two places:
//   - built in:  <app>/themes/{moods,layouts,colorschemes,fonts,soundpacks,effects,backgrounds}/
//   - your own:  ~/.config/sofa-king/themes/ (the same folders, plus saved/)
// See themes/README.md for the formats.
//
// Themes can come from anyone, so they're checked before use: colours must be colours, and a
// layout's CSS can't load anything from the internet (no @import, no url() other than data:).

const fs = require('fs');
const path = require('path');

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_CSS = 200 * 1024;
const MAX_SAVED = 10;   // saved themes: ten slots
const MAX_EFFECTS = 8;  // effects on at once

// The folders, and what they were called before pieces had folders of their own (your old ones are
// renamed the first time this version runs).
const FOLDERS = ['moods', 'layouts', 'colorschemes', 'fonts', 'soundpacks', 'instruments', 'effects', 'backgrounds', 'saved'];
const OLD_NAMES = { themes: 'moods', colors: 'colorschemes', sounds: 'soundpacks' };

// What a layout can ask the home screen to do (the parts CSS can't).
const BEHAVIOR = {
  featured: false,         // the big panel about whatever's selected (picture, score, where to watch)
  widenSelected: false,    // the selected card becomes a wide picture and moves to the front of its row
  rowKeys: 'free',         // moving between rows: 'free' (whatever's nearest), 'up-down' or 'left-right'
                           //   (straight to the next row, back where you were in it)
  oneRowAtATime: false,    // only the current row is shown (the body gets no extra class; rows get .active)
  sectionBar: false,       // the row names across the top (#xmb-bar), the current one lit up
  widePictures: false,     // cards use the wide (16:9) picture instead of the poster
  bigCards: false,         // start from the big-poster card sizes instead of the smaller "Rows" ones
  rowScroll: 'nearest',    // a row coming into view: 'nearest' (just enough) or 'start' (to the top)
  rowsPerScreen: 0,        // size the cards so exactly this many whole rows fit on screen (0: as they are)
  carousel: false,         // the selected title stays at the front of its row, and the row slides
                           //   past it, looping endlessly (the last title is followed by the first)
  moreAt: 'end',           // where a row's More button is: 'end' (its last stop) or 'title' (beside the
                           //   row's name: up from the row reaches it)
  maxTitles: 0,            // at most this many titles per row (0: all), More after them
  fillRows: 0,             // for rows that wrap into a grid: show just enough titles to fill this many
                           //   lines exactly, with More as the last tile (0: show them all)
  fillScreen: false,       // for rows that wrap into a grid: as many whole lines as fit on screen,
                           //   filled exactly, with More as the last tile
};
const CHOICES = { rowKeys: ['free', 'up-down', 'left-right'], rowScroll: ['nearest', 'start'], moreAt: ['end', 'title'] };

// The colours a scheme sets. Anything left out comes from Midnight (the original colours).
const MIDNIGHT = {
  bg: '#0b0b10', surface: '#16161f', surface2: '#262533', line: '#3a3946',
  text: '#f4f2ee', textSoft: '#c9c6d2', muted: '#9b98a6', faint: '#6c6977',
  focus: '#ffffff', onFocus: '#0b0b10', onFocusSoft: '#4a4855',
  accent: '#7cc4ff', gold: '#f2c66d', good: '#3ddc84', bad: '#ff8a8a',
  glow1: '#2a1d3a', glow2: '#13283a',
};
const VARS = {
  bg: '--bg', surface: '--bg-raised', surface2: '--surface-2', line: '--line-strong',
  text: '--text', textSoft: '--text-soft', muted: '--muted', faint: '--faint',
  focus: '--focus', onFocus: '--on-focus', onFocusSoft: '--on-focus-soft',
  accent: '--accent', gold: '--gold', good: '--good', bad: '--bad', glow1: '--glow-1', glow2: '--glow-2',
};
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgbOf(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

// A layout's CSS, made safe: nothing fetched from anywhere, nothing that runs code.
function cleanCss(css) {
  return String(css || '').slice(0, MAX_CSS)
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/@import[^;]*;?/gi, '/* @import removed */')
    // Any url() that isn't a data: one (quoted or not) is removed, and image-set(), which can name
    // a picture without url(), isn't allowed at all.
    .replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'none')
    .replace(/(-webkit-)?image-set\s*\(/gi, 'no-image-set(')
    .replace(/expression\s*\(/gi, '(')
    .replace(/-moz-binding/gi, '');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadLayouts(dir, source, log) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id)) continue;
    const meta = readJson(path.join(dir, id, 'layout.json'));
    if (!meta) { if (fs.existsSync(path.join(dir, id))) log(`theme: layout "${id}" has no readable layout.json`); continue; }
    const behavior = { ...BEHAVIOR };
    for (const [k, def] of Object.entries(BEHAVIOR)) {
      const v = meta.behavior && meta.behavior[k];
      if (v === undefined) continue;
      if (typeof def === 'boolean') behavior[k] = Boolean(v);
      else if (typeof def === 'number') behavior[k] = Number.isInteger(v) && v >= 0 && v <= 60 ? v : def;
      else if (CHOICES[k].includes(v)) behavior[k] = v;
    }
    let css = '';
    try { css = cleanCss(fs.readFileSync(path.join(dir, id, 'layout.css'), 'utf8')); } catch { css = ''; }
    out.push({
      id, source, css, behavior,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 60),
      colors: ID.test(meta.colors || '') ? meta.colors : '',   // a colour scheme that goes with it
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}

function loadColors(dir, source, log) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const f of names) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !ID.test(id)) continue;
    const meta = readJson(path.join(dir, f));
    if (!meta || typeof meta.colors !== 'object') { log(`theme: colours "${f}" couldn't be read`); continue; }
    const colors = { ...MIDNIGHT };
    for (const k of Object.keys(MIDNIGHT)) {
      const v = meta.colors[k];
      if (v === undefined) continue;
      if (typeof v === 'string' && HEX.test(v)) colors[k] = v;
      else log(`theme: colours "${f}": ${k} should be a colour like #1a2b3c`);
    }
    out.push({
      id, source, colors,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 60),
      light: Boolean(meta.light),
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}

// ------------------------------------------------------------ fonts, sounds and whole themes

const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const MAX_FONT = 2 * 1024 * 1024;

// A font: a folder with font.json ({ name, family, files: { "400": "x.woff2", "700": ... }, scale })
// and its files. "system": true means the app's usual font (no files).
function loadFonts(dir, source, log) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id)) continue;
    const meta = readJson(path.join(dir, id, 'font.json'));
    if (!meta) continue;
    const files = {};
    for (const [w, f] of Object.entries(meta.files || {})) {
      const weight = Number(w);
      const file = path.join(dir, id, path.basename(String(f)));
      if (!(weight >= 100 && weight <= 900) || !FONT_EXT.test(file)) continue;
      try { if (fs.statSync(file).size <= MAX_FONT) files[weight] = file; } catch { log(`theme: font "${id}": ${f} is missing`); }
    }
    const system = meta.system === true || !Object.keys(files).length;
    out.push({
      id, source, system, files,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      license: text(meta.license, 40),
      scale: Number(meta.scale) >= 50 && Number(meta.scale) <= 200 ? Number(meta.scale) : 100,
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}

const EVENTS = ['move', 'select', 'back', 'edge', 'open', 'close', 'type', 'screen'];
const AUDIO_EXT = /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|webm|aif|aiff|aifc|wma|ape|caf|wv)$/i;
// (AIFF, WMA, APE, CAF and WavPack, and ALAC inside .m4a, can't be played as they are: with ffmpeg
// installed, the app converts them. See audioconvert.js.)
const MAX_AUDIO = 2 * 1024 * 1024;
const WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'noise'];
const NOTE_NAME = /^[A-Ga-g][#b]?-?\d$/;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

// One note of a recipe, keeping only what the sound engine understands, within sensible limits.
function cleanNote(n) {
  if (!n || typeof n !== 'object') return null;
  const pitch = (v) => (typeof v === 'string' && NOTE_NAME.test(v) ? v : num(v, 20, 20000));
  const out = {
    w: WAVES.includes(n.w) ? n.w : undefined, f: pitch(n.f), to: pitch(n.to),
    at: num(n.at, 0, 3), d: num(n.d, 0.01, 4), v: num(n.v, 0, 0.5), a: num(n.a, 0, 2),
    lp: num(n.lp, 20, 20000), lpTo: num(n.lpTo, 20, 20000), hp: num(n.hp, 20, 20000), q: num(n.q, 0.1, 30),
    det: num(n.det, -1200, 1200), drive: num(n.drive, 0, 1),
    vib: Array.isArray(n.vib) && n.vib.length === 2 ? [num(n.vib[0], 0, 40) || 0, num(n.vib[1], 0, 400) || 0] : undefined,
    trem: Array.isArray(n.trem) && n.trem.length === 2 ? [num(n.trem[0], 0, 60) || 0, num(n.trem[1], 0, 1) || 0] : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out.f || out.w === 'noise' ? out : null;
}

// A sound set: a folder with sound.json. Each event is a list of notes, or the name of an audio
// file in the same folder.
function loadSounds(dir, source, log) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id)) continue;
    const meta = readJson(path.join(dir, id, 'sound.json'));
    if (!meta) { if (fs.existsSync(path.join(dir, id))) log(`theme: sound set "${id}" has no readable sound.json`); continue; }
    const sounds = {};
    const files = {};
    for (const ev of EVENTS) {
      const v = meta.sounds && meta.sounds[ev];
      if (Array.isArray(v)) {
        const notes = v.slice(0, 24).map(cleanNote).filter(Boolean);
        if (notes.length) sounds[ev] = notes;
      } else if (typeof v === 'string') {
        const file = path.join(dir, id, path.basename(v));
        if (!AUDIO_EXT.test(file)) { log(`theme: sound set "${id}": ${v} isn't an audio file`); continue; }
        try { if (fs.statSync(file).size <= MAX_AUDIO) files[ev] = file; else log(`theme: sound set "${id}": ${v} is over 2 MB`); } catch { log(`theme: sound set "${id}": ${v} is missing`); }
      }
    }
    const r = meta.reverb && typeof meta.reverb === 'object' ? meta.reverb : null;
    out.push({
      id, source, sounds, files,
      reverb: r ? { mix: num(r.mix, 0, 1) || 0, time: num(r.time, 0.2, 6) || 1.5, dark: num(r.dark, 0, 0.95) || 0 } : null,
      volume: num(meta.volume, 0, 2) ?? 1,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 60),
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}

// Instruments that play a sound pack's notes instead of its own waves. "synth" ones are made by the
// sound engine itself, "tone" ones by Tone.js; recorded ones are pieces (instruments/<id>/).
const INSTRUMENTS = [
  { id: '', name: 'As designed', kind: 'synth', description: 'The notes as the sound pack wrote them.' },
  { id: 'chime', name: 'Chime', kind: 'synth', description: 'Clear, ringing bells.' },
  { id: 'marimba', name: 'Marimba', kind: 'synth', description: 'A short, woody knock.' },
  { id: 'pluck', name: 'Pluck', kind: 'synth', description: 'A plucked string.' },
  { id: 'organ', name: 'Organ', kind: 'synth', description: 'A soft electric organ.' },
  { id: 'retro', name: '8-bit', kind: 'synth', description: 'Square-wave game console beeps.' },
  { id: 'soft', name: 'Soft', kind: 'synth', description: 'Gentle, rounded tones.' },
  { id: 'bell', name: 'FM bell', kind: 'tone', description: 'A glassy, shimmering bell.' },
  { id: 'e-piano', name: 'Electric piano', kind: 'tone', description: 'A mellow 80s electric piano.' },
  { id: 'duo', name: 'Dreamy lead', kind: 'tone', description: 'Two voices with a slow wobble.' },
  { id: 'string', name: 'Plucked string', kind: 'synth', description: 'A real-sounding string, plucked.' },
  { id: 'drums', name: 'Drums', kind: 'tone', description: 'Low notes are kicks and toms, middle ones snares, high ones cymbals.' },
];
// Effects on the sound as a whole (any number at once).
const SOUND_FX = [
  { id: 'bitcrush', name: 'Bitcrush', description: 'Crunchy, low-resolution, like an old sampler.' },
  { id: 'chorus', name: 'Chorus', description: 'Thicker and shimmering, as if several played at once.' },
  { id: 'phaser', name: 'Phaser', description: 'A slow, swirling sweep.' },
  { id: 'delay', name: 'Echo', description: 'Each sound repeats, fading away.' },
];

// A recorded instrument: a folder with instrument.json ({ name, description, notes: { "C4":
// "C4.ogg", ... }, ring, volume }) and the recordings. Notes in between are the nearest recording,
// pitched up or down.
function loadInstruments(dir, source, log) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id) || INSTRUMENTS.some((x) => x.id === id)) continue;
    const meta = readJson(path.join(dir, id, 'instrument.json'));
    if (!meta) { if (fs.statSync(path.join(dir, id)).isDirectory()) log(`theme: instrument "${id}" has no readable instrument.json`); continue; }
    const notes = {};
    for (const [name, f] of Object.entries(meta.notes || {}).slice(0, 48)) {
      const midi = midiOf(name);
      const file = path.join(dir, id, path.basename(String(f)));
      if (midi == null) { log(`theme: instrument "${id}": "${name}" isn't a note name like C4`); continue; }
      if (!AUDIO_EXT.test(file)) { log(`theme: instrument "${id}": ${f} isn't an audio file`); continue; }
      try { if (fs.statSync(file).size <= MAX_AUDIO) notes[midi] = file; else log(`theme: instrument "${id}": ${f} is over 2 MB`); } catch { log(`theme: instrument "${id}": ${f} is missing`); }
    }
    if (!Object.keys(notes).length) { log(`theme: instrument "${id}" has no notes`); continue; }
    out.push({
      id, source, notes, kind: 'recorded',
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 80),
      license: text(meta.license, 40),
      ring: num(meta.ring, 0.1, 4) ?? 1.2,
      volume: num(meta.volume, 0, 2) ?? 1,
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}
// "A4" -> 69, "C#5" -> 73, "Eb3" -> 51.
function midiOf(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  return base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
// Highlight colours you can put on any scheme ('' keeps the scheme's own).
const ACCENTS = ['', '#7cc4ff', '#4a8fff', '#39d0ff', '#39ff88', '#a3e635', '#ffd23f', '#ff8c2a', '#ff3d00', '#e23b3b', '#ff5c8a', '#ff7ad9', '#b57cff'];

// An effect or a background: a folder with effect.json / background.json ({ name, description,
// author, order }) and its CSS. An effect draws on its own layer, .fx-<id>; a background on
// .bg-<id>. Both layers are put on the page by the app (see applyLook in ui/home.js).
function loadPieces(dir, source, log, kind) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id)) continue;
    const meta = readJson(path.join(dir, id, `${kind}.json`));
    if (!meta) { if (fs.existsSync(path.join(dir, id))) log(`theme: ${kind} "${id}" has no readable ${kind}.json`); continue; }
    let css = '';
    try { css = cleanCss(fs.readFileSync(path.join(dir, id, `${kind}.css`), 'utf8')); } catch { log(`theme: ${kind} "${id}" has no ${kind}.css`); }
    out.push({
      id, source, css,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 60),
      order: Number.isFinite(meta.order) ? meta.order : 100,
    });
  }
  return out;
}
const loadEffects = (dir, source, log) => loadPieces(dir, source, log, 'effect');
const loadBackgrounds = (dir, source, log) => loadPieces(dir, source, log, 'background');

// Themes made before effects had folders of their own kept them in effects.css, written for
// "body.theme-<id>". Such a file becomes an effect of its own ("<id>-extras"), drawn on its layer.
function oldEffects(dir, id, log) {
  let css = '';
  try { css = fs.readFileSync(path.join(dir, id, 'effects.css'), 'utf8'); } catch { return null; }
  const fxId = `${id}-extras`.slice(0, 40);
  // (Matched by any theme name: a theme moved into a saved slot has a new folder name.)
  css = cleanCss(css)
    .replace(/body\.theme-[a-z0-9-]+::/g, `.fx-${fxId}::`)
    .replace(/body\.theme-[a-z0-9-]+/g, `body.with-${fxId}`);
  log(`theme: "${id}" has an old effects.css: it's now the effect "${fxId}"`);
  return { id: fxId, css, name: 'Extras', description: 'Made for an older version of the app.', author: '', order: 200 };
}

// A mood, or a saved theme: a folder with mood.json ({ name, colors, accent, fonts: { display,
// text }, sounds, instrument, effects: [ids], background }). (theme.json is the older name.)
function loadLooks(dir, source, log, extraEffects = []) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const id of names) {
    if (!ID.test(id)) continue;
    const meta = readJson(path.join(dir, id, 'mood.json')) || readJson(path.join(dir, id, 'theme.json'));
    if (!meta) { if (fs.existsSync(path.join(dir, id))) log(`theme: mood "${id}" has no readable mood.json`); continue; }
    const pick = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
    let effects = Array.isArray(meta.effects) ? meta.effects.map(pick).filter(Boolean).slice(0, MAX_EFFECTS) : [];
    const old = oldEffects(dir, id, log);
    if (old) { extraEffects.push({ ...old, source }); if (meta.effects !== false) effects = [...effects, old.id]; }
    let preview = '';
    try { preview = `data:image/png;base64,${fs.readFileSync(path.join(dir, id, 'preview.png')).toString('base64')}`; } catch { preview = ''; }
    out.push({
      id, source, preview,
      name: text(meta.name, 40) || id,
      description: text(meta.description, 160),
      author: text(meta.author, 60),
      order: Number.isFinite(meta.order) ? meta.order : 100,
      look: {
        colors: pick(meta.colors) || 'midnight',
        accent: typeof meta.accent === 'string' && HEX.test(meta.accent) ? meta.accent : '',
        display: pick(meta.fonts && meta.fonts.display) || 'clean',
        text: pick(meta.fonts && meta.fonts.text) || 'clean',
        sounds: pick(meta.sounds) || 'classic',
        instrument: pick(meta.instrument),
        soundFx: Array.isArray(meta.soundFx) ? meta.soundFx.filter((x) => SOUND_FX.some((f) => f.id === x)) : [],
        effects,
        background: pick(meta.background),
      },
    });
  }
  return out;
}

function createThemes({ builtInDir, userDir, log = () => {} }) {
  let layouts = [];
  let colors = [];
  let fonts = [];
  let sounds = [];
  let looks = [];      // moods
  let saved = [];      // your saved themes (slots saved-1 ... saved-10)
  let effects = [];
  let backgrounds = [];
  let instruments = []; // recorded ones
  let playable = (file) => file; // swapped for converted copies (see setPlayable)

  // Your own folder, with the guide and templates in it, so there's somewhere obvious to start.
  function prepareUserDir() {
    try {
      // Folders from before pieces had folders of their own get their new names.
      for (const [was, now] of Object.entries(OLD_NAMES)) {
        const from = path.join(userDir, was);
        const to = path.join(userDir, now);
        if (!fs.existsSync(from)) continue;
        if (!fs.existsSync(to)) { fs.renameSync(from, to); log(`theme: renamed your ${was} folder to ${now}`); continue; }
        // Both exist (an old copy came back): move over whatever isn't there yet.
        for (const f of fs.readdirSync(from)) if (!fs.existsSync(path.join(to, f))) fs.renameSync(path.join(from, f), path.join(to, f));
        if (!fs.readdirSync(from).length) fs.rmdirSync(from);
      }
      for (const d of FOLDERS) fs.mkdirSync(path.join(userDir, d), { recursive: true });
      // Themes the older version saved from Settings become saved themes (while there's room).
      for (const id of fs.readdirSync(path.join(userDir, 'moods'))) {
        const meta = readJson(path.join(userDir, 'moods', id, 'theme.json'));
        if (!meta || meta.description !== 'Made in Settings.') continue;
        let n = 1;
        while (n <= MAX_SAVED && fs.existsSync(path.join(userDir, 'saved', `saved-${n}`))) n++;
        if (n > MAX_SAVED) break;
        fs.renameSync(path.join(userDir, 'moods', id), path.join(userDir, 'saved', `saved-${n}`));
        log(`theme: "${meta.name || id}", saved from Settings, is now saved theme ${n}`);
      }
      const readme = path.join(builtInDir, 'README.md');
      if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(userDir, 'README.md')); // kept up to date
      const tpl = path.join(builtInDir, 'templates');
      if (fs.existsSync(tpl)) {
        // The templates are kept up to date too: ours are copied over the old copies (anything else
        // in that folder is left alone).
        fs.cpSync(tpl, path.join(userDir, 'templates'), { recursive: true, force: true });
      }
    } catch (err) { log(`theme: couldn't set up ${userDir}: ${err.message}`); }
  }

  function reload() {
    prepareUserDir();
    const both = (load, sub) => {
      const m = new Map();
      for (const x of [...load(path.join(builtInDir, sub), 'built-in', log), ...load(path.join(userDir, sub), 'yours', log)]) {
        // Your own can't replace a built-in one with the same name: it gets "-yours" added.
        if (m.has(x.id) && x.source === 'yours') x.id = `${x.id}-yours`;
        if (!m.has(x.id)) m.set(x.id, x);
      }
      return [...m.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    };
    layouts = both(loadLayouts, 'layouts');
    colors = both(loadColors, 'colorschemes');
    fonts = both(loadFonts, 'fonts');
    sounds = both(loadSounds, 'soundpacks');
    backgrounds = both(loadBackgrounds, 'backgrounds');
    instruments = both(loadInstruments, 'instruments');
    const extras = []; // effects from old effects.css files
    looks = both((dir, source, l) => loadLooks(dir, source, l, extras), 'moods');
    saved = loadLooks(path.join(userDir, 'saved'), 'saved', log, extras)
      .filter((t) => /^saved-([1-9]|10)$/.test(t.id))
      .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)));
    effects = both(loadEffects, 'effects');
    for (const x of extras) if (!effects.some((e) => e.id === x.id)) effects.push(x);
    fontData.clear();
    const yours = [layouts, colors, fonts, sounds, looks, effects, backgrounds].reduce((n, l) => n + l.filter((x) => x.source === 'yours').length, 0);
    log(`themes: ${looks.length} moods, ${saved.length} saved themes, ${layouts.length} layouts, ${colors.length} colour schemes, ${fonts.length} fonts, ${sounds.length} sound packs, ${instruments.length} recorded instruments, ${effects.length} effects, ${backgrounds.length} backgrounds (${yours} of your own)`);
  }

  const layout = (id) => layouts.find((l) => l.id === id) || layouts.find((l) => l.id === 'netflix') || layouts[0];
  const scheme = (id) => colors.find((c) => c.id === id) || colors.find((c) => c.id === 'midnight') || { id: 'midnight', colors: MIDNIGHT };
  const font = (id) => fonts.find((f) => f.id === id) || { id: 'clean', system: true, scale: 100, files: {} };
  const soundSet = (id) => sounds.find((x) => x.id === id) || sounds.find((x) => x.id === 'classic') || { id: 'classic', sounds: {}, files: {}, volume: 1 };
  const theme = (id) => looks.find((t) => t.id === id) || saved.find((t) => t.id === id) || null;
  const effect = (id) => effects.find((x) => x.id === id) || null;
  const background = (id) => backgrounds.find((x) => x.id === id) || null;

  // A look (from a theme, or your custom one), with anything unknown swapped for the default.
  function resolve(look) {
    const l = look || {};
    return {
      colors: scheme(l.colors).id,
      accent: typeof l.accent === 'string' && HEX.test(l.accent) ? l.accent : '',
      display: font(l.display).id,
      text: font(l.text).id,
      sounds: soundSet(l.sounds).id,
      instrument: allInstruments().some((x) => x.id === l.instrument) ? l.instrument : '',
      soundFx: [...new Set(Array.isArray(l.soundFx) ? l.soundFx : [])].filter((id) => SOUND_FX.some((f) => f.id === id)),
      // (Only effects that exist, each once, in the order they're listed.)
      effects: [...new Set(Array.isArray(l.effects) ? l.effects : [])].filter((id) => typeof id === 'string' && effect(id)).slice(0, MAX_EFFECTS),
      background: typeof l.background === 'string' && background(l.background) ? l.background : '',
    };
  }

  // The CSS for a look's effects and background, and which layers the page needs for them.
  function piecesCss(look) {
    const l = resolve(look);
    const bg = background(l.background);
    return {
      effects: l.effects, background: l.background,
      css: [bg ? bg.css : '', ...l.effects.map((id) => effect(id).css)].join('\n'),
    };
  }

  // The CSS for a colour scheme: every colour slot, plus the r, g, b versions used for see-through
  // shades. An accent colour, if given, replaces the scheme's.
  function colorsCss(id, accent = '') {
    const c = { ...scheme(id).colors };
    if (accent && HEX.test(accent)) c.accent = accent;
    const lines = Object.entries(VARS).map(([k, v]) => `  ${v}: ${c[k]};`);
    lines.push(`  --bg-rgb: ${rgbOf(c.bg)};`, `  --ink: ${rgbOf(c.text)};`, `  --accent-rgb: ${rgbOf(c.accent)};`,
      `  --gold-rgb: ${rgbOf(c.gold)};`, `  --good-rgb: ${rgbOf(c.good)};`);
    // ":root:root" so the scheme wins over the default colours in ui.css.
    return `:root:root {\n${lines.join('\n')}\n  color-scheme: ${scheme(id).light ? 'light' : 'dark'};\n}\n`;
  }

  // Fonts go in as data, so pages never load anything from outside. Each gets its own family name.
  const fontData = new Map();
  function fontFaces(id) {
    const f = font(id);
    if (f.system) return '';
    if (fontData.has(f.id)) return fontData.get(f.id);
    const faces = Object.entries(f.files).map(([w, file]) => {
      let b64 = '';
      try { b64 = fs.readFileSync(file).toString('base64'); } catch { return ''; }
      const type = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[path.extname(file).slice(1).toLowerCase()];
      const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' }[type];
      return `@font-face { font-family: "tvf-${f.id}"; font-weight: ${w}; font-display: swap; size-adjust: ${f.scale}%; src: url(data:${mime};base64,${b64}) format("${type}"); }`;
    }).join('\n');
    fontData.set(f.id, faces);
    return faces;
  }
  const family = (id) => (font(id).system ? 'var(--font-system)' : `"tvf-${font(id).id}", var(--font-system)`);

  // Everything a screen needs for a look: colours, and its two fonts.
  function lookCss(look) {
    const l = resolve(look);
    const faces = [...new Set([l.display, l.text])].map(fontFaces).join('\n');
    return `${colorsCss(l.colors, l.accent)}${faces}\n:root:root { --font-display: ${family(l.display)}; --font-text: ${family(l.text)}; }\n`;
  }
  // Every font, for the font pickers in Settings (each name shown in its own font).
  const allFontsCss = () => fonts.map((f) => fontFaces(f.id)).join('\n');

  const allInstruments = () => [...INSTRUMENTS, ...instruments];
  // Every audio file in use or on offer (for converting the ones that need it).
  const audioFiles = () => [...sounds.flatMap((x) => Object.values(x.files)), ...instruments.flatMap((x) => Object.values(x.notes))];
  // Converted copies of files that couldn't be played as they were (see audioconvert.js).
  function setPlayable(fn) { playable = typeof fn === 'function' ? fn : (file) => file; }
  const read = (file) => { try { return new Uint8Array(fs.readFileSync(playable(file))); } catch { return null; } };

  // A sound pack as the sound engine wants it, with any audio files read in, and the instrument
  // and sound effects to play it with.
  function soundSpec(look) {
    const l = resolve(look);
    const s = soundSet(l.sounds);
    const files = {};
    for (const [ev, file] of Object.entries(s.files || {})) { const b = read(file); if (b) files[ev] = b; }
    const rec = instruments.find((x) => x.id === l.instrument);
    let instrument = { id: l.instrument, kind: (INSTRUMENTS.find((x) => x.id === l.instrument) || {}).kind || 'synth' };
    if (rec) {
      const samples = {};
      for (const [midi, file] of Object.entries(rec.notes)) { const b = read(file); if (b) samples[midi] = b; }
      instrument = { id: rec.id, kind: 'recorded', samples, ring: rec.ring, volume: rec.volume };
    }
    return { id: s.id, volume: s.volume, reverb: s.reverb, sounds: s.sounds, files, instrument, soundFx: l.soundFx };
  }

  // Save a look in one of your ten slots (1 to 10), with a small square picture of it (PNG bytes,
  // optional). Returns its id, saved-<slot>.
  function saveLook(name, look, slot, png) {
    const n = Number(slot);
    if (!(Number.isInteger(n) && n >= 1 && n <= MAX_SAVED)) throw new Error('no such slot');
    const clean = text(name, 40) || `My theme ${n}`;
    const l = resolve(look);
    const id = `saved-${n}`;
    const dir = path.join(userDir, 'saved', id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      name: clean, description: 'Saved in Settings.', author: 'You',
      colors: l.colors, ...(l.accent ? { accent: l.accent } : {}),
      fonts: { display: l.display, text: l.text }, sounds: l.sounds,
      ...(l.instrument ? { instrument: l.instrument } : {}),
      ...(l.soundFx.length ? { soundFx: l.soundFx } : {}),
      effects: l.effects, background: l.background,
    };
    fs.writeFileSync(path.join(dir, 'mood.json'), `${JSON.stringify(meta, null, 2)}\n`);
    if (png && png.length) fs.writeFileSync(path.join(dir, 'preview.png'), png);
    reload();
    return id;
  }
  // The first empty slot, or 0 when all ten are used.
  function freeSlot() {
    for (let n = 1; n <= MAX_SAVED; n++) if (!saved.some((t) => t.id === `saved-${n}`)) return n;
    return 0;
  }

  function deleteLook(id) {
    if (!saved.some((t) => t.id === id)) return false;
    fs.rmSync(path.join(userDir, 'saved', id), { recursive: true, force: true });
    reload();
    return true;
  }

  function list() {
    const swatch = (id) => { const c = scheme(id).colors; return [c.bg, c.surface, c.accent, c.text, c.gold]; };
    return {
      // (css, behavior and values are for the preview in Settings.)
      themes: looks.map(({ id, name, description, author, source, look }) => ({ id, name, description, author, source, look: resolve(look), swatch: swatch(look.colors) })),
      // Ten slots, empty ones as null.
      saved: Array.from({ length: MAX_SAVED }, (_, i) => {
        const t = saved.find((x) => x.id === `saved-${i + 1}`);
        return t ? { id: t.id, slot: i + 1, name: t.name, look: resolve(t.look), swatch: swatch(t.look.colors), preview: t.preview } : null;
      }),
      layouts: layouts.map(({ id, name, description, author, source, colors: c, css, behavior }) => ({ id, name, description, author, source, colors: c, css, behavior })),
      colors: colors.map(({ id, name, description, author, source, light, colors: values }) => ({ id, name, description, author, source, light, swatch: swatch(id), values })),
      fonts: fonts.map(({ id, name, description, source, system }) => ({ id, name, description, source, family: system ? '' : `tvf-${id}` })),
      sounds: sounds.map(({ id, name, description, author, source, files }) => ({ id, name, description, author, source, files: Object.keys(files).length })),
      effects: effects.map(({ id, name, description, author, source, css }) => ({ id, name, description, author, source, css })),
      backgrounds: backgrounds.map(({ id, name, description, author, source, css }) => ({ id, name, description, author, source, css })),
      instruments: allInstruments().map(({ id, name, description, kind, author, license, source }) => ({ id, name, description, kind, author, license, source })),
      soundFx: SOUND_FX,
      accents: ACCENTS,
      folder: userDir,
    };
  }

  reload();
  return { reload, list, layout, scheme, theme, resolve, colorsCss, lookCss, piecesCss, allFontsCss, soundSpec, audioFiles, setPlayable, saveLook, freeSlot, deleteLook, BEHAVIOR };
}

module.exports = { createThemes, cleanCss, cleanNote, MIDNIGHT, BEHAVIOR };
