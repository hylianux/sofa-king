'use strict';

// The controller in mpv: the app reads it and tells mpv what to do (mpv doesn't read it itself),
// which makes these possible:
//
//   - The trigger menu: while L2 or R2 is held, a panel shows every button, and they do what
//     Settings → Controller → In mpv says (pause, stop, skip and so on); ▲ ▼ change the volume.
//     Letting go hides it. Pressing both together is the trigger lock: the buttons keep working
//     that way with nothing held and no panel; both again turns it off.
//   - Otherwise, any button opens the menu along the bottom: ◀ ▶ choose, A picks, B closes. Its
//     Playhead moves through the film with ◀ ▶ (A jumps there, B puts it back); Subtitles, Audio,
//     Speakers and Picture open a short list (▲ ▼, A); QR codes shows the title's TMDB and IMDb pages.
//
// Everything is drawn with mpv's osd-overlay on a 1280×720 canvas, in the style of the button panel.

const QRCode = require('qrcode');
const { escapeAss, roundRect, C, panel, scrim, icon } = require('./osd');

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
//   showTrigger(on)  the trigger menu's panel: show it (true) or hide it (false)
//   toast(lines)     a short note at the top
//   title()          what's playing, for the menu's top line
//   motion           false: nothing slides (Settings → General → Animations off)
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

  const triggerOn = () => locked || held.size > 0;
  let shown = false; // the trigger menu's panel is up
  function updateTrigger() {
    const show = held.size > 0 && !locked && mode === 'normal';
    if (show === shown) return;
    shown = show;
    if (opts.showTrigger) opts.showTrigger(show);
  }
  const draw = (id, data) => send(data ? { name: 'osd-overlay', id, format: 'ass-events', res_x: 1280, res_y: 720, data } : { name: 'osd-overlay', id, format: 'none', data: '' });
  const say = (text) => send(['show-text', text, 1200]);

  // ---- the menu along the bottom
  const LABEL = {
    playhead: 'Playhead', skip: 'Skip intro', whatson: 'What\'s on', prev: 'Previous', next: 'Next', subs: 'Subtitles',
    audio: 'Audio', speakers: 'Speakers', picture: 'Picture', qr: 'QR codes', stop: 'Stop',
  };
  const labelOf = (id) => (id === 'pause' ? (state.paused ? 'Play' : 'Pause') : LABEL[id]);
  // The highlight slides from item to item (unless Animations is off): where it's drawn now.
  let glide = null; // { x, w } of the highlight as drawn
  let glideTimer = null;
  const ICON_OF = { playhead: 'playhead', pause: null, skip: 'skip', whatson: 'whatson', prev: 'prev', next: 'next', subs: 'subs', audio: 'audio', speakers: 'speakers', picture: 'picture', qr: 'qr', stop: 'stop' };
  function drawMenu(fromGlide = false) {
    if (mode === 'normal') { draw(MENU_ID, null); glide = null; return; }
    const X0 = 60; const W = 1160; const H = MENU_H; const Y0 = 720 - 40 - H;
    const out = [scrim(380, 1), panel(X0, Y0, W, H, 22, 1, 0x30)];
    // What's playing, and where it's got to.
    const pos = mode === 'playhead' && target != null ? target : state.position || 0;
    const dur = state.duration || 0;
    out.push(`{\\an4\\pos(${X0 + 28},${Y0 + 30})\\bord0\\shad0\\fs22\\b1\\1c&H${C.text}&}${escapeAss(String(opts.title() || '').slice(0, 70))}`);
    if (dur > 0 && kind !== 'live' && kind !== 'station') {
      out.push(`{\\an6\\pos(${X0 + W - 28},${Y0 + 30})\\bord0\\shad0\\fs20\\1c&H${C.muted}&}${clock(state.position)} / ${clock(dur)}`);
      const bx = X0 + 28; const bw = W - 56; const by = Y0 + 56;
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.line}&\\p1}${roundRect(bx, by, bw, 6, 3)}{\\p0}`);
      const now = Math.max(0, Math.min(1, (state.position || 0) / dur));
      // (The part played glows a little.)
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\blur4\\1c&H${C.accent}&\\1a&H90&\\p1}${roundRect(bx, by - 1, Math.max(6, bw * now), 8, 4)}{\\p0}`);
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.accent}&\\p1}${roundRect(bx, by, Math.max(6, bw * now), 6, 3)}{\\p0}`);
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.text}&\\p1}${roundRect(bx + Math.max(6, bw * now) - 6, by - 3, 12, 12, 6)}{\\p0}`);
      if (mode === 'playhead' && target != null) {
        const tx = bx + bw * Math.max(0, Math.min(1, target / dur));
        const d = target - (state.position || 0);
        out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\blur3\\1c&H${C.gold}&\\1a&H70&\\p1}${roundRect(tx - 5, by - 11, 10, 28, 5)}{\\p0}`);
        out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.gold}&\\p1}${roundRect(tx - 3, by - 9, 6, 24, 3)}{\\p0}`);
        const label = `${clock(target)}  (${d >= 0 ? '+' : '−'}${clock(Math.abs(d))})`;
        const lx = Math.max(bx + textWidth(label, 20) / 2, Math.min(bx + bw - textWidth(label, 20) / 2, tx));
        out.push(`{\\an2\\pos(${Math.round(lx)},${by - 12})\\bord2\\3c&H${C.bg}&\\shad0\\fs20\\b1\\1c&H${C.gold}&}${escapeAss(label)}`);
      }
    }
    // The items: each with a small icon, the chosen one lit (the light slides between them).
    const iconOf = (id) => (id === 'pause' ? (state.paused ? 'play' : 'pause') : ICON_OF[id]);
    const measure = (fs, pad, iw, gap) => items.map((id) => textWidth(labelOf(id), fs) + pad * 2 + (iconOf(id) ? iw + 7 : 0)).reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    // As big as fits across the menu (a long list of items gets a little smaller).
    const fit = Math.min(1, (W - 56) / measure(20, 16, 18, 10));
    const FS = Math.round(20 * Math.max(0.8, fit)); const sc = FS / 20;
    const PAD = 16 * fit; const GAP = 10 * fit; const PH = 44; const IW = Math.round(18 * sc);
    const widths = items.map((id) => textWidth(labelOf(id), FS) + PAD * 2 + (iconOf(id) ? IW + 7 : 0));
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
    const xs = []; let x = 640 - total / 2; const y = Y0 + 86;
    items.forEach((id, i) => { xs[i] = x; x += widths[i] + GAP; });
    items.x = xs.map((v, i) => v + widths[i] / 2);
    const want = { x: xs[pick], w: widths[pick] };
    if (!glide || opts.motion === false) glide = { ...want };
    else if (!fromGlide && (glide.x !== want.x || glide.w !== want.w)) {
      // Move there over a few frames.
      clearInterval(glideTimer);
      const from = { ...glide }; let f = 0;
      glideTimer = setInterval(() => {
        f += 1; const t = 1 - (1 - f / 4) ** 2; // (eases out)
        glide = { x: from.x + (want.x - from.x) * t, w: from.w + (want.w - from.w) * t };
        if (f >= 4) { clearInterval(glideTimer); glide = { ...want }; }
        if (mode !== 'normal') drawMenu(true);
      }, 30);
    }
    const dimAll = mode !== 'menu';
    items.forEach((id, i) => {
      if (!(i === pick)) out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.surface}&\\1a&H${dimAll ? 'A0' : '30'}&\\p1}${roundRect(xs[i], y, widths[i], PH, 13)}{\\p0}`);
    });
    // The light: a soft glow, then the pill.
    out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\blur8\\1c&H${C.focus}&\\1a&HA0&\\p1}${roundRect(glide.x - 3, y - 3, glide.w + 6, PH + 6, 16)}{\\p0}`);
    out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.focus}&\\p1}${roundRect(glide.x - 2, y - 2, glide.w + 4, PH + 4, 15)}{\\p0}`);
    items.forEach((id, i) => {
      const on = i === pick; const dim = dimAll && !on;
      const col = on ? C.onFocus : C.text; const a = dim ? '&H90&' : '&H00&';
      const ic = iconOf(id);
      const tx = xs[i] + PAD + (ic ? IW + 7 : 0);
      if (ic) out.push(icon(ic, xs[i] + PAD, y + (PH - IW) / 2, col, a, IW / 20));
      out.push(`{\\an4\\pos(${Math.round(tx)},${y + PH / 2})\\bord0\\shad0\\fs${FS}\\b1\\1c&H${col}&\\alpha${a}}${escapeAss(labelOf(id))}`);
    });
    const hint = mode === 'playhead' ? '◀ ▶ move (hold to go faster)   A  jump there   B  put it back'
      : mode === 'list' ? '▲ ▼ choose   A  pick   B  back' : mode === 'qr' ? 'B  back'
        : '◀ ▶ choose   A  pick   B  close   ·   hold L2 / R2 for every control';
    out.push(`{\\an5\\pos(640,${Y0 + H - 24})\\bord0\\shad0\\fs16\\1c&H${C.muted}&}${escapeAss(hint)}`);
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
    const out = [panel(x0, y0, w, h, 18, 1, 0x10)];
    out.push(`{\\an4\\pos(${x0 + 22},${y0 + 26})\\bord0\\shad0\\fs18\\1c&H${C.muted}&}${escapeAss(list.title)}`);
    list.options.forEach((o, i) => {
      const y = y0 + 46 + i * LINE;
      const on = i === list.at;
      if (on) out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.focus}&\\p1}${roundRect(x0 + 10, y, w - 20, LINE - 4, 10)}{\\p0}`);
      // The one in use: a dot in the accent colour.
      if (o.on) out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${on ? C.onFocus : C.accent}&\\p1}${roundRect(x0 + 24, y + (LINE - 4) / 2 - 4, 8, 8, 4)}{\\p0}`);
      out.push(`{\\an4\\pos(${x0 + 42},${y + (LINE - 4) / 2})\\bord0\\shad0\\fs${FS}${on ? '\\b1' : ''}\\1c&H${on ? C.onFocus : C.text}&}${escapeAss(o.label)}`);
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
    const out = [panel(x0, y0, w, h, 20, 1, 0x08),
      `{\\an5\\pos(640,${y0 + 26})\\bord0\\shad0\\fs19\\1c&H${C.muted}&}Open on your phone: point its camera at a code`];
    links.forEach((l, i) => {
      const x = x0 + 40 + i * (SIZE + GAP);
      out.push(qrDrawing(l.url, x, y0 + 48, SIZE));
      out.push(`{\\an5\\pos(${x + SIZE / 2},${y0 + 48 + SIZE + 26})\\bord0\\shad0\\fs22\\b1\\1c&H${C.text}&}${escapeAss(l.name)}`);
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
    drawMenu();
    // (The time moves along while it's up.)
    clearInterval(timer);
    timer = setInterval(() => { if (mode === 'menu' || mode === 'playhead') drawMenu(); }, 1000);
  }
  function close() {
    mode = 'normal'; list = null; qr = null; target = null;
    clearInterval(timer); timer = null; clearInterval(glideTimer); glide = null;
    draw(MENU_ID, null); draw(POP_ID, null);
  }

  // ---- a button: phase 'down' (just pressed), 'repeat' (held: the D-pad repeats) or 'up'
  function input(button, phase) {
    if (metaButtons().includes(button)) {
      if (phase === 'down') {
        held.add(button);
        if (mode !== 'normal') close(); // (a trigger while the menu's up: the trigger menu instead)
        // Both together: the trigger lock, on or off.
        if (held.size === 2) {
          locked = !locked;
          if (opts.toast) opts.toast(locked ? ['Trigger lock on', 'The buttons work as if L2 or R2 were held · both again to turn it off'] : ['Trigger lock off']);
        }
      } else if (phase === 'up') {
        held.delete(button);
      }
      updateTrigger();
      return;
    }
    if (phase === 'up') return;

    if (mode === 'normal') {
      // Nothing held: any button brings up the menu (and does nothing else).
      if (!triggerOn()) { if (phase === 'down') open(); return; }
      // The trigger menu: each button does what it's set to. ▲ and ▼ (unless set to something
      // else) change the volume.
      const action = actionOf(button);
      if ((button === DPAD.up || button === DPAD.down) && (!action || ['menu', 'menu2', 'time'].includes(action))) {
        send(`add volume ${button === DPAD.up ? 5 : -5}`); send('show-text "Volume: ${volume}%" 900');
        return;
      }
      if (!action || action === 'menu' || action === 'menu2') return;
      if (phase === 'repeat' && !/^(back|fwd|vol)/.test(action)) return; // (only skipping and volume repeat)
      if (action === 'time') { send('show-progress'); return; }
      if (['stop', 'skip', 'sound', 'visual'].includes(action)) { opts.run(action); return; }
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
    get trigger() { return triggerOn(); },
    open,
    close,
    // Pause changed: the menu's Pause / Play follows.
    refresh: () => { if (mode !== 'normal') drawMenu(); },
    stop: () => { clearInterval(timer); clearInterval(glideTimer); },
  };
}

module.exports = { createControls, MENU_ITEMS };
