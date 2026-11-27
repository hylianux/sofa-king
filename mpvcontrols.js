'use strict';

// The controller in mpv: the app reads it and tells mpv what to do (mpv doesn't read it itself),
// which makes these possible:
//
//   - Plain presses do what Settings → Controller → In mpv says (pause, stop, skip and so on).
//   - Holding L2 or R2 (the "hold" buttons): ◀ ▶ skip further, ▲ ▼ change the volume. Pressing
//     both together locks that in, so nothing needs holding; B (or both again) unlocks.
//   - Start or ▲ opens a menu along the bottom: ◀ ▶ choose, A picks, B closes. Its Playhead moves
//     through the film with ◀ ▶ (A jumps there, B puts it back); Subtitles, Audio, Speakers and
//     Picture open a short list (▲ ▼, A); QR codes shows the title's TMDB and IMDb pages.
//
// Everything is drawn with mpv's osd-overlay on a 1280×720 canvas, in the style of the button panel.

const QRCode = require('qrcode');
const { escapeAss, roundRect } = require('./osd');

const META_ID = 64;
const MENU_H = 180; // the menu's height (its bottom edge 40 above the screen's)
const MENU_ID = 65;
const POP_ID = 66;
const DPAD = { up: 12, down: 13, left: 14, right: 15 };
const A = 0;
const B = 1;

// Seconds as 1:05:30 or 4:07.
const clock = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const length = (s) => (s < 60 ? `${s} s` : `${s / 60} min`);
// Roughly how wide a line of text is at a size (ASS can't measure).
const textWidth = (t, fs) => [...String(t)].reduce((w, ch) => w + (/[A-Z0-9MW]/.test(ch) ? 0.66 : /[il.,'· ]/.test(ch) ? 0.3 : 0.52), 0) * fs;

// What the menu offers, by what's playing.
const MENU_ITEMS = {
  video: ['playhead', 'pause', 'skip', 'prev', 'next', 'subs', 'audio', 'speakers', 'qr', 'stop'],
  live: ['pause', 'prev', 'next', 'whatson', 'subs', 'audio', 'speakers', 'stop'],
  song: ['playhead', 'pause', 'prev', 'next', 'speakers', 'picture', 'stop'],
  station: ['pause', 'prev', 'next', 'speakers', 'picture', 'stop'],
};

// opts:
//   send(cmd)        an mpv command: an array, or a line as in input.conf
//   ask(cmd)         an mpv question (resolves with the answer, or null)
//   state            { position, duration, paused } as mpv last said
//   kind             'video', 'live', 'song' or 'station'
//   bindings         { action: button } (Settings → Controller → In mpv)
//   seeks            { back10, fwd30, back60, fwd60 } seconds
//   command(action)  what a plain press of an action's button does (an input.conf line), or null
//   run(action)      for actions the player does itself: 'stop', 'skip', 'sound', 'visual', 'help'
//   sounds, sound()  the speaker choices [{ value, name }] and the one in use; setSound(value)
//   visuals, visual() the pictures [{ id, name }] (music only) and the one in use; setVisual(id)
//   links()          promise of [{ name, url }] for the QR codes (or none)
//   hideHelp()       the button panel goes while the menu's up
//   title()          what's playing, for the menu's top line
function createControls(opts) {
  const { send, ask, state, kind, bindings } = opts;
  const seeks = opts.seeks || {};
  const items = (MENU_ITEMS[kind] || MENU_ITEMS.video).filter((x) => x !== 'qr' || opts.links)
    .filter((x) => x !== 'picture' || (opts.visuals && opts.visuals.length));
  const actionOf = (button) => Object.keys(bindings).find((a) => bindings[a] === button) || null;
  const metaButtons = () => [bindings.meta, bindings.meta2].filter((b) => b != null);

  let mode = 'normal'; // normal | menu | playhead | list | qr
  const held = new Set(); // hold buttons down now
  let locked = false;
  let pick = 0; // the menu item highlighted
  let target = null; // playhead: where you'd jump to
  let list = null; // { title, options: [{ label, on, choose }], at }
  let qr = null; // drawing of the QR codes
  let repeats = 0; // playhead: how long ◀ / ▶ has been held, for going faster
  let timer = null;

  const metaOn = () => locked || held.size > 0;
  const draw = (id, data) => send(data ? { name: 'osd-overlay', id, format: 'ass-events', res_x: 1280, res_y: 720, data } : { name: 'osd-overlay', id, format: 'none', data: '' });
  const say = (text) => send(['show-text', text, 1200]);

  // ---- the hold buttons' note at the top
  function drawMeta() {
    if (!metaOn() || mode !== 'normal') { draw(META_ID, null); return; }
    const k = (b) => (b === bindings.meta ? 'L2' : 'R2');
    const lines = [kind === 'live' || kind === 'station' ? '▲ ▼  volume'
      : `◀ ▶  back ${length(seeks.back60 || 60)} / ahead ${length(seeks.fwd60 || 60)}     ▲ ▼  volume`];
    lines.push(locked ? 'Locked on · B, or both hold buttons, to go back to normal' : `Holding ${[...held].map(k).join(' + ')} · press both to lock`);
    const w = Math.max(...lines.map((l, i) => textWidth(l, i ? 17 : 22))) + 60;
    const x0 = (1280 - w) / 2;
    draw(META_ID, [
      `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H1E1814&\\1a&H28&\\p1}${roundRect(x0, 34, w, 82, 18)}{\\p0}`,
      `{\\an5\\pos(640,62)\\bord0\\shad0\\fs22\\b1\\1c&HFFFFFF&}${escapeAss(lines[0])}`,
      `{\\an5\\pos(640,94)\\bord0\\shad0\\fs17\\1c&H${locked ? '66D6FF' : 'BEB0AA'}&}${escapeAss(lines[1])}`,
    ].join('\n'));
  }

  // ---- the menu along the bottom
  const LABEL = {
    playhead: 'Playhead', skip: 'Skip intro', whatson: 'What\'s on', prev: 'Previous', next: 'Next', subs: 'Subtitles',
    audio: 'Audio', speakers: 'Speakers', picture: 'Picture', qr: 'QR codes', stop: 'Stop',
  };
  const labelOf = (id) => (id === 'pause' ? (state.paused ? 'Play' : 'Pause') : LABEL[id]);
  function drawMenu() {
    if (mode === 'normal') { draw(MENU_ID, null); return; }
    const X0 = 60; const W = 1160; const H = MENU_H; const Y0 = 720 - 40 - H;
    const out = [`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H1E1814&\\1a&H20&\\p1}${roundRect(X0, Y0, W, H, 20)}{\\p0}`];
    // What's playing, and where it's got to.
    const pos = mode === 'playhead' && target != null ? target : state.position || 0;
    const dur = state.duration || 0;
    out.push(`{\\an4\\pos(${X0 + 28},${Y0 + 30})\\bord0\\shad0\\fs22\\b1\\1c&HFFFFFF&}${escapeAss(String(opts.title() || '').slice(0, 70))}`);
    if (dur > 0 && kind !== 'live' && kind !== 'station') {
      out.push(`{\\an6\\pos(${X0 + W - 28},${Y0 + 30})\\bord0\\shad0\\fs20\\1c&HBEB0AA&}${clock(state.position)} / ${clock(dur)}`);
      const bx = X0 + 28; const bw = W - 56; const by = Y0 + 56;
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H5A4E48&\\p1}${roundRect(bx, by, bw, 6, 3)}{\\p0}`);
      const now = Math.max(0, Math.min(1, (state.position || 0) / dur));
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HF2EEEC&\\p1}${roundRect(bx, by, Math.max(6, bw * now), 6, 3)}{\\p0}`);
      if (mode === 'playhead' && target != null) {
        const tx = bx + bw * Math.max(0, Math.min(1, target / dur));
        const d = target - (state.position || 0);
        out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HFFD666&\\p1}${roundRect(tx - 3, by - 9, 6, 24, 3)}{\\p0}`);
        const label = `${clock(target)}  (${d >= 0 ? '+' : '−'}${clock(Math.abs(d))})`;
        const lx = Math.max(bx + textWidth(label, 20) / 2, Math.min(bx + bw - textWidth(label, 20) / 2, tx));
        out.push(`{\\an2\\pos(${Math.round(lx)},${by - 12})\\bord1.5\\3c&H1E1814&\\shad0\\fs20\\b1\\1c&H66D6FF&}${escapeAss(label)}`);
      }
    }
    // The items.
    const FS = 20; const PAD = 18; const GAP = 10; const PH = 42;
    const widths = items.map((id) => textWidth(labelOf(id), FS) + PAD * 2);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
    let x = 640 - total / 2; const y = Y0 + 86;
    items.forEach((id, i) => {
      const on = i === pick;
      const dim = mode !== 'menu' && !on;
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${on ? 'F2EEEC' : '3A302C'}&\\1a&H${dim ? '90' : '00'}&\\p1}${roundRect(x, y, widths[i], PH, 12)}{\\p0}`);
      out.push(`{\\an5\\pos(${Math.round(x + widths[i] / 2)},${y + PH / 2})\\bord0\\shad0\\fs${FS}\\b1\\1c&H${on ? '1C1614' : 'FFFFFF'}&\\alpha&H${dim ? '90' : '00'}&}${escapeAss(labelOf(id))}`);
      items.x = items.x || []; items.x[i] = x + widths[i] / 2;
      x += widths[i] + GAP;
    });
    const hint = mode === 'playhead' ? '◀ ▶ move (hold to go faster)   A  jump there   B  put it back'
      : mode === 'list' ? '▲ ▼ choose   A  pick   B  back' : mode === 'qr' ? 'B  back'
        : '◀ ▶ choose   A  pick   B  close';
    out.push(`{\\an5\\pos(640,${Y0 + H - 26})\\bord0\\shad0\\fs16\\1c&HBEB0AA&}${escapeAss(hint)}`);
    draw(MENU_ID, out.join('\n'));
  }

  // ---- a short list over the menu (subtitles, audio, speakers, picture)
  function drawList() {
    if (mode !== 'list' || !list) { if (mode !== 'qr') draw(POP_ID, null); return; }
    const FS = 21; const LINE = 40;
    const w = Math.max(220, ...list.options.map((o) => textWidth(o.label, FS) + 70), textWidth(list.title, 18) + 40);
    const h = 52 + list.options.length * LINE;
    const cx = (items.x && items.x[pick]) || 640;
    const x0 = Math.max(40, Math.min(1240 - w, cx - w / 2));
    const y0 = 720 - 40 - MENU_H - 16 - h;
    const out = [`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H1E1814&\\1a&H18&\\p1}${roundRect(x0, y0, w, h, 18)}{\\p0}`];
    out.push(`{\\an4\\pos(${x0 + 22},${y0 + 26})\\bord0\\shad0\\fs18\\1c&HBEB0AA&}${escapeAss(list.title)}`);
    list.options.forEach((o, i) => {
      const y = y0 + 46 + i * LINE;
      if (i === list.at) out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HF2EEEC&\\p1}${roundRect(x0 + 10, y, w - 20, LINE - 4, 10)}{\\p0}`);
      out.push(`{\\an4\\pos(${x0 + 24},${y + (LINE - 4) / 2})\\bord0\\shad0\\fs${FS}\\1c&H${i === list.at ? '1C1614' : 'FFFFFF'}&}${o.on ? '●  ' : '    '}${escapeAss(o.label)}`);
    });
    draw(POP_ID, out.join('\n'));
  }

  // ---- QR codes: squares drawn as runs along each line of the code
  function qrDrawing(url, x0, y0, size) {
    const q = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = q.modules.size; const data = q.modules.data;
    const cell = Math.floor((size - 24) / n); const off = (size - cell * n) / 2;
    const parts = [];
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!data[r * n + c]) { c++; continue; }
        let e = c; while (e < n && data[r * n + e]) e++;
        const x = x0 + off + c * cell; const y = y0 + off + r * cell; const x2 = x0 + off + e * cell; const y2 = y + cell;
        parts.push(`m ${x} ${y} l ${x2} ${y} l ${x2} ${y2} l ${x} ${y2}`);
        c = e;
      }
    }
    return [`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HFFFFFF&\\p1}${roundRect(x0, y0, size, size, 14)}{\\p0}`,
      `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H100B0B&\\p1}${parts.join(' ')}{\\p0}`].join('\n');
  }
  async function showQr() {
    const links = (await Promise.resolve(opts.links()).catch(() => [])) || [];
    if (mode !== 'menu') return;
    if (!links.length) { say('No TMDB or IMDb page known for this one'); return; }
    const SIZE = 250; const GAP = 60;
    const w = links.length * SIZE + (links.length - 1) * GAP + 80; const h = SIZE + 120;
    const x0 = (1280 - w) / 2; const y0 = 720 - 40 - MENU_H - 16 - h;
    const out = [`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H1E1814&\\1a&H10&\\p1}${roundRect(x0, y0, w, h, 20)}{\\p0}`,
      `{\\an5\\pos(640,${y0 + 26})\\bord0\\shad0\\fs19\\1c&HBEB0AA&}Open on your phone: point its camera at a code`];
    links.forEach((l, i) => {
      const x = x0 + 40 + i * (SIZE + GAP);
      out.push(qrDrawing(l.url, x, y0 + 48, SIZE));
      out.push(`{\\an5\\pos(${x + SIZE / 2},${y0 + 48 + SIZE + 26})\\bord0\\shad0\\fs22\\b1\\1c&HFFFFFF&}${escapeAss(l.name)}`);
    });
    qr = out.join('\n');
    mode = 'qr';
    draw(POP_ID, qr);
    drawMenu();
  }

  // ---- opening lists
  async function openList(id) {
    let title = ''; let options = [];
    if (id === 'subs' || id === 'audio') {
      const tracks = (await ask(['get_property', 'track-list'])) || [];
      const type = id === 'subs' ? 'sub' : 'audio';
      const mine = tracks.filter((t) => t.type === type);
      const name = (t) => [t.title, t.lang && t.lang.toUpperCase(), t.codec && !t.title ? t.codec : ''].filter(Boolean).join(' · ') || `Track ${t.id}`;
      title = id === 'subs' ? 'Subtitles' : 'Audio track';
      if (id === 'subs') options.push({ label: 'Off', on: !mine.some((t) => t.selected), choose: () => send(['set_property', 'sid', 'no']) });
      options.push(...mine.map((t) => ({ label: name(t), on: Boolean(t.selected), choose: () => send(['set_property', id === 'subs' ? 'sid' : 'aid', t.id]) })));
      if (!mine.length && id === 'audio') { say('Only one audio track'); return; }
    } else if (id === 'speakers') {
      title = 'Speakers';
      options = opts.sounds.map((c) => ({ label: c.name, on: c.value === opts.sound(), choose: () => opts.setSound(c.value) }));
    } else if (id === 'picture') {
      title = 'Picture';
      options = opts.visuals.map((v) => ({ label: v.name, on: v.id === opts.visual(), choose: () => opts.setVisual(v.id) }));
    }
    if (mode !== 'menu') return;
    list = { title, options, at: Math.max(0, options.findIndex((o) => o.on)) };
    mode = 'list';
    drawList(); drawMenu();
  }

  // ---- choosing a menu item
  function choose(id) {
    if (id === 'playhead') {
      if (!(state.duration > 0)) { say('Can\'t move through this one'); return; }
      target = state.position || 0; repeats = 0; mode = 'playhead'; drawMenu(); return;
    }
    if (id === 'pause') { send('cycle pause'); setTimeout(drawMenu, 150); return; }
    if (id === 'prev' || id === 'next') { send(id === 'prev' ? 'playlist-prev' : 'playlist-next'); return; }
    if (id === 'skip' || id === 'whatson') { close(); opts.run('skip'); return; }
    if (id === 'stop') { close(); opts.run('stop'); return; }
    if (id === 'qr') { showQr(); return; }
    openList(id);
  }

  function open() {
    mode = 'menu';
    pick = Math.min(pick, items.length - 1);
    if (opts.hideHelp) opts.hideHelp();
    draw(META_ID, null);
    drawMenu();
    // (The time moves along while it's up.)
    clearInterval(timer);
    timer = setInterval(() => { if (mode === 'menu' || mode === 'playhead') drawMenu(); }, 1000);
  }
  function close() {
    mode = 'normal'; list = null; qr = null; target = null;
    clearInterval(timer); timer = null;
    draw(MENU_ID, null); draw(POP_ID, null);
    drawMeta();
  }

  // ---- a button: phase 'down' (just pressed), 'repeat' (held: the D-pad repeats) or 'up'
  function input(button, phase) {
    const isMeta = metaButtons().includes(button);
    if (isMeta) {
      if (phase === 'down') {
        held.add(button);
        // Both together: lock (or unlock).
        if (held.size === 2) { locked = !locked; if (locked) say('Skip and volume: locked on'); }
      } else if (phase === 'up') {
        held.delete(button);
      }
      drawMeta();
      return;
    }
    if (phase === 'up') return;

    if (mode === 'normal') {
      if (metaOn()) {
        // Holding (or locked): the D-pad skips further and changes the volume.
        // (Not live TV or radio: nothing to skip. Not repeated while held: a minute every tenth of a
        // second is far too fast. Volume does repeat.)
        if (button === DPAD.left || button === DPAD.right) {
          if (phase === 'down' && kind !== 'live' && kind !== 'station') send(button === DPAD.left ? `seek -${seeks.back60 || 60}` : `seek ${seeks.fwd60 || 60}`);
          return;
        }
        if (button === DPAD.up) { send('add volume 5'); send('show-text "Volume: ${volume}%" 900'); return; }
        if (button === DPAD.down) { send('add volume -5'); send('show-text "Volume: ${volume}%" 900'); return; }
        if (button === B && locked) { locked = false; drawMeta(); say('Back to normal'); return; }
      }
      const action = actionOf(button);
      if (!action) return;
      if (phase === 'repeat' && !/^(back|fwd)/.test(action)) return; // (only skipping repeats)
      if (action === 'menu' || action === 'menu2') { open(); return; }
      if (['stop', 'skip', 'sound', 'visual', 'time'].includes(action)) { opts.run(action === 'time' ? 'help' : action); return; }
      const cmd = opts.command(action);
      if (cmd) send(cmd);
      return;
    }

    // In the menu.
    const act = actionOf(button);
    if (mode === 'menu') {
      if (button === DPAD.left || button === DPAD.right) {
        pick = Math.max(0, Math.min(items.length - 1, pick + (button === DPAD.right ? 1 : -1)));
        drawMenu();
      } else if (button === A && phase === 'down') choose(items[pick]);
      else if (phase === 'down' && (button === B || act === 'menu' || act === 'menu2')) close();
      return;
    }
    if (mode === 'playhead') {
      if (button === DPAD.left || button === DPAD.right) {
        repeats = phase === 'repeat' ? repeats + 1 : 0;
        const step = repeats > 30 ? 300 : repeats > 15 ? 60 : repeats > 5 ? 30 : 10;
        target = Math.max(0, Math.min((state.duration || 0) - 1, target + (button === DPAD.right ? step : -step)));
        drawMenu();
      } else if (button === A && phase === 'down') {
        send(['seek', target, 'absolute+exact']);
        mode = 'menu'; target = null; setTimeout(drawMenu, 200);
      } else if (button === B && phase === 'down') { mode = 'menu'; target = null; drawMenu(); }
      return;
    }
    if (mode === 'list') {
      if (button === DPAD.up || button === DPAD.down) {
        list.at = Math.max(0, Math.min(list.options.length - 1, list.at + (button === DPAD.down ? 1 : -1)));
        drawList();
      } else if (button === A && phase === 'down') {
        list.options[list.at].choose();
        mode = 'menu'; list = null; drawList(); drawMenu();
      } else if (button === B && phase === 'down') { mode = 'menu'; list = null; drawList(); drawMenu(); }
      return;
    }
    if (mode === 'qr' && phase === 'down' && (button === B || button === A)) { mode = 'menu'; qr = null; draw(POP_ID, null); drawMenu(); }
  }

  return {
    input,
    get mode() { return mode; },
    open,
    close,
    // Pause changed: the menu's Pause / Play follows.
    refresh: () => { if (mode !== 'normal') drawMenu(); },
    stop: () => { clearInterval(timer); },
  };
}

module.exports = { createControls, MENU_ITEMS };
