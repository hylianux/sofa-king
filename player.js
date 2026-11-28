'use strict';

// Plays Jellyfin files in mpv (Flatpak or regular install), full screen, as a playlist so episodes
// run one after another. The app talks to mpv through its JSON control socket: it hears where you
// are, which file is playing, and button presses mpv passes on; and it can tell mpv to seek, skip,
// pause or show a message.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const visuals = require('./visuals');
const { createControls } = require('./mpvcontrols');

// Standard gamepad button numbers -> mpv's names for them.
const MPV_BUTTON = {
  0: 'GAMEPAD_ACTION_DOWN', 1: 'GAMEPAD_ACTION_RIGHT', 2: 'GAMEPAD_ACTION_LEFT', 3: 'GAMEPAD_ACTION_UP',
  4: 'GAMEPAD_LEFT_SHOULDER', 5: 'GAMEPAD_RIGHT_SHOULDER', 6: 'GAMEPAD_LEFT_TRIGGER', 7: 'GAMEPAD_RIGHT_TRIGGER',
  8: 'GAMEPAD_BACK', 9: 'GAMEPAD_START', 10: 'GAMEPAD_LEFT_STICK', 11: 'GAMEPAD_RIGHT_STICK',
  12: 'GAMEPAD_DPAD_UP', 13: 'GAMEPAD_DPAD_DOWN', 14: 'GAMEPAD_DPAD_LEFT', 15: 'GAMEPAD_DPAD_RIGHT', 16: 'GAMEPAD_GUIDE',
};

// What each mpv action does. "skip" is handled by the app (it knows where intros and credits are).
const MPV_COMMANDS = {
  pause: 'cycle pause',
  stop: 'script-message tv-overlay-stop', // the app asks "are you sure?" first
  subs: 'cycle sub',
  audio: 'cycle audio',
  skip: 'script-message tv-overlay-skip',
  prev: 'playlist-prev',
  next: 'playlist-next',
  back10: 'seek -10',
  fwd30: 'seek 30',
  back60: 'seek -60',
  fwd60: 'seek 60',
  volup: 'add volume 5',
  voldown: 'add volume -5',
  time: 'show-progress; script-message tv-overlay-help', // the time, and the buttons along the bottom
  sound: 'script-message tv-overlay-sound', // speakers: automatic, stereo, 5.1, 7.1
  visual: 'script-message tv-overlay-visual', // music and radio: the next picture (visualiser)
};

// The speaker layouts the sound button steps through (mpv's audio-channels).
const SOUND_CHOICES = [
  { value: 'auto-safe', name: 'Automatic' },
  { value: 'stereo', name: 'Stereo' },
  { value: '5.1', name: '5.1 surround' },
  { value: '7.1', name: '7.1 surround' },
];
const soundName = (v) => (SOUND_CHOICES.find((c) => c.value === v) || SOUND_CHOICES[0]).name;

// Can this mpv read a controller itself? Only builds made with SDL2 have --input-gamepad (Flathub's
// mpv doesn't, and mpv refuses to start at all when given an option it doesn't know). Asked once for
// each way of starting mpv, in the background. When it can't, the app reads the controller and
// passes each button on to mpv by name (see press() below), so your mpv buttons still work.
const gamepadSupport = new Map();
function canGamepad(how) {
  const key = [how.cmd, ...how.args].join(' ');
  if (!gamepadSupport.has(key)) {
    gamepadSupport.set(key, new Promise((resolve) => {
      let out = '';
      let child;
      try { child = spawn(how.cmd, [...how.args, '--list-options'], { stdio: ['ignore', 'pipe', 'ignore'], env: require('./apps').cleanEnv() }); } catch { resolve(false); return; }
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(false); }, 10000);
      child.stdout.on('data', (c) => { out += c; });
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('close', () => { clearTimeout(timer); resolve(/--input-gamepad\b/.test(out)); });
    }));
  }
  return gamepadSupport.get(key);
}

// How far each skip button goes, in seconds (Settings → Servers → When playing in mpv).
const SEEK_DEFAULTS = { back10: 10, fwd30: 30, back60: 60, fwd60: 60 };
const SEEK_STEPS = [5, 10, 15, 20, 30, 45, 60, 120, 300, 600];
const seekCommand = (action, secs) => `seek ${action.startsWith('back') ? '-' : ''}${secs}`;

function inputConf(bindings, seeks = {}) {
  return Object.entries(bindings)
    .filter(([action, b]) => MPV_COMMANDS[action] && MPV_BUTTON[b])
    .map(([action, b]) => `${MPV_BUTTON[b]} ${action in SEEK_DEFAULTS ? seekCommand(action, SEEK_STEPS.includes(seeks[action]) ? seeks[action] : SEEK_DEFAULTS[action]) : MPV_COMMANDS[action]}`)
    .join('\n') + '\n';
}

// A folder both we and mpv can see. Flatpak apps always share $XDG_RUNTIME_DIR/app/<id> with the host.
function sharedDir(via) {
  const runtime = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const dir = via === 'flatpak' ? path.join(runtime, 'app', 'io.mpv.Mpv') : runtime;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const { escapeAss, roundRect, alpha, capWidth, C, setColors, panel, scrim } = require('./osd');

// ------------------------------------------------------------------ the buttons along the bottom
//
// A panel drawn with mpv's osd-overlay (shapes and styled text on a 1280×720 canvas): each button
// as a keycap with what it does beside it, four to a line, and how to bring it back underneath.
// items: [{ keys: ['A'], label: 'Pause' }]. k: 0..1, how far it has faded in.

function helpPanel(items, footer, k) {
  const COLS = 4;
  const CELL = 272;
  const LINE = 46;
  const rows = Math.ceil(items.length / COLS);
  const w = CELL * Math.min(COLS, items.length) + 40;
  const h = 26 + rows * LINE + (footer ? 34 : 6);
  const x0 = (1280 - w) / 2;
  const y0 = 720 - 34 - h + Math.round((1 - k) * 10); // (rises a little as it fades in)
  const out = [panel(x0, y0, w, h, 18, k, 0x28)];
  items.forEach((it, i) => {
    let x = x0 + 22 + (i % COLS) * CELL;
    const y = y0 + 22 + Math.floor(i / COLS) * LINE + 15;
    for (const key of it.keys) {
      const cw = capWidth(key);
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.text}&\\1a${alpha(0x00, k)}\\p1}${roundRect(x, y - 15, cw, 30, 8)}{\\p0}`);
      out.push(`{\\an5\\pos(${Math.round(x + cw / 2)},${y})\\bord0\\shad0\\fs18\\b1\\1c&H${C.bg}&\\alpha${alpha(0x00, k)}}${escapeAss(key)}`);
      x += cw + 6;
    }
    out.push(`{\\an4\\pos(${Math.round(x + 6)},${y})\\bord0\\shad0\\fs21\\1c&H${C.text}&\\alpha${alpha(0x00, k)}}${escapeAss(it.label)}`);
  });
  if (footer) out.push(`{\\an5\\pos(640,${y0 + h - 22})\\bord0\\shad0\\fs17\\1c&H${C.muted}&\\alpha${alpha(0x00, k)}}${escapeAss(footer)}`);
  return out.join('\n');
}

// The trigger menu (while L2 or R2 is held): what's playing and how far in, then every button as a
// keycap with what it does, and how to lock it. Sits on a soft shadow, with a thin line of light
// along its top edge. info: { title, position, duration }.
function triggerPanel(items, footer, info, k) {
  const COLS = 4;
  const CELL = 272;
  const LINE = 46;
  const rows = Math.ceil(items.length / COLS);
  const w = CELL * COLS + 40;
  const head = 64;
  const h = head + 14 + rows * LINE + (footer ? 38 : 10);
  const x0 = (1280 - w) / 2;
  const y0 = 720 - 34 - h + Math.round((1 - k) * 14); // (rises a little as it fades in)
  const clock = (t) => { t = Math.max(0, Math.round(t || 0)); const hh = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = t % 60; return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const out = [scrim(y0 - 90, k), panel(x0, y0, w, h, 20, k, 0x18)];
  // What's playing, the time, and a thin progress line.
  out.push(`{\\an4\\pos(${x0 + 24},${y0 + 28})\\bord0\\shad0\\fs22\\b1\\1c&H${C.text}&\\alpha${alpha(0x00, k)}}${escapeAss(String(info.title || '').slice(0, 64))}`);
  if (info.duration > 0) {
    out.push(`{\\an6\\pos(${x0 + w - 24},${y0 + 28})\\bord0\\shad0\\fs19\\1c&H${C.muted}&\\alpha${alpha(0x00, k)}}${clock(info.position)} / ${clock(info.duration)}`);
    const bx = x0 + 24; const bw = w - 48; const by = y0 + 50; const f = Math.max(0, Math.min(1, (info.position || 0) / info.duration));
    out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.line}&\\1a${alpha(0x00, k)}\\p1}${roundRect(bx, by, bw, 4, 2)}{\\p0}`);
    out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.accent}&\\1a${alpha(0x00, k)}\\p1}${roundRect(bx, by, Math.max(4, bw * f), 4, 2)}{\\p0}`);
  }
  out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.text}&\\1a${alpha(0xE6, k)}\\p1}${roundRect(x0 + 20, y0 + head, w - 40, 1, 0)}{\\p0}`);
  items.forEach((it, i) => {
    let x = x0 + 22 + (i % COLS) * CELL;
    const y = y0 + head + 14 + Math.floor(i / COLS) * LINE + 15;
    for (const key of it.keys) {
      const cw = capWidth(key);
      // A keycap: a darker edge under a light top, so it looks pressable.
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.muted}&\\1a${alpha(0x00, k)}\\p1}${roundRect(x, y - 14, cw, 31, 8)}{\\p0}`);
      out.push(`{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${C.text}&\\1a${alpha(0x00, k)}\\p1}${roundRect(x, y - 15, cw, 28, 8)}{\\p0}`);
      out.push(`{\\an5\\pos(${Math.round(x + cw / 2)},${y - 1})\\bord0\\shad0\\fs18\\b1\\1c&H${C.bg}&\\alpha${alpha(0x00, k)}}${escapeAss(key)}`);
      x += cw + 6;
    }
    out.push(`{\\an4\\pos(${Math.round(x + 6)},${y})\\bord0\\shad0\\fs21\\1c&H${C.text}&\\alpha${alpha(0x00, k)}}${escapeAss(it.label)}`);
  });
  if (footer) out.push(`{\\an5\\pos(640,${y0 + h - 22})\\bord0\\shad0\\fs17\\1c&H${C.muted}&\\alpha${alpha(0x00, k)}}${escapeAss(footer)}`);
  return out.join('\n');
}

// A small note at the top in the same style (the speaker layout you just picked).
function toastPanel(lines, k) {
  const wide = Math.max(...lines.map((l, i) => l.length * (i ? 9.5 : 12.5)));
  const w = Math.min(1100, Math.max(260, wide + 56));
  const h = 30 + lines.length * 30;
  const x0 = (1280 - w) / 2;
  const y0 = 40 - Math.round((1 - k) * 10);
  const out = [panel(x0, y0, w, h, 18, k, 0x28)];
  lines.forEach((l, i) => out.push(`{\\an5\\pos(640,${y0 + 30 + i * 30})\\bord0\\shad0\\fs${i ? 18 : 24}${i ? '' : '\\b1'}\\1c&H${i ? C.muted : C.text}&\\alpha${alpha(0x00, k)}}${escapeAss(l)}`));
  return out.join('\n');
}

function connect(socketPath, onMessage, watch = []) {
  let sock = null;
  let buffer = '';
  let closed = false;
  let nextId = 100;
  const queue = [];

  const waiting = new Map(); // request id -> resolve, for ask()
  // (A command as text, as in input.conf, is sent as a plain line: mpv reads it the same way, with
  // ${property} filled in. Those get no answer.)
  const send = (command) => {
    const id = nextId++;
    const line = typeof command === 'string' ? `${command.replace(/[\r\n]/g, ' ')}\n` : JSON.stringify({ command, request_id: id }) + '\n';
    if (sock) sock.write(line); else queue.push(line);
    return id;
  };
  // A question for mpv (a property's value, say): resolves with its answer, or null.
  const ask = (command) => new Promise((resolve) => {
    const id = send(command);
    waiting.set(id, resolve);
    setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 3000);
  });

  const attempt = (triesLeft) => {
    if (closed) return;
    const s = net.createConnection(socketPath);
    s.on('connect', () => {
      sock = s;
      ['time-pos', 'pause', 'duration', 'playlist-pos', 'height', ...watch].forEach((name, i) => {
        s.write(JSON.stringify({ command: ['observe_property', i + 1, name] }) + '\n');
      });
      while (queue.length) s.write(queue.shift());
    });
    s.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; /* not JSON */ }
        if (msg.request_id != null && waiting.has(msg.request_id)) {
          const resolve = waiting.get(msg.request_id);
          waiting.delete(msg.request_id);
          resolve(msg.error === 'success' ? msg.data : null);
          continue;
        }
        onMessage(msg);
      }
    });
    s.on('error', () => {
      // mpv creates the socket a moment after it starts.
      if (!sock && triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 300);
    });
  };
  attempt(60);
  return { send, ask, close: () => { closed = true; if (sock) sock.destroy(); } };
}

// entries: [{ url, title, start? }]. Callbacks:
//   onFileStart(index)                 a playlist entry started
//   onFileEnd(index, reason, position)  it ended ('eof' = played to the end)
//   onState({ position, paused, duration, index })
//   onMessage(args)                    a script-message from a button
//   onExit(error)                      mpv closed
//   onPlaying(index)                   it's open and starting (optional)
//   loadingText(index)                 text under the loading animation (optional)
//   onMetadata(tags)                   the stream's tags changed: a radio station's "now playing" (optional)
//   onPadless()                        this mpv can't read the controller: the app should pass
//                                      buttons on with press() while it plays (optional)
//   onSound(value)                     the speaker layout was changed with the sound button (optional)
//   onVisual(id)                       the picture for music was changed with its button (optional)
// help: [{ keys: ['A'], label: 'Pause' }] for the panel of buttons, helpFooter: the line under it.
// sound: the speaker layout to start with ('auto-safe', 'stereo', '5.1', '7.1').
// motion: false when Animations are off (the panels appear and go without fading).
// seeks: { back10, fwd30, back60, fwd60 } seconds for the skip buttons. rewindOnResume: after a
// pause, carry on from a second earlier.
// kind: 'video', 'live', 'song' or 'station' (what the menu offers). links(index): a promise of the
// title's pages [{ name, url }] for the menu's QR codes (films and shows). appPad: the app reads the
// controller and drives mpv (the menu, the hold buttons); false lets mpv read it itself, if it can.
// volume: mpv's volume to start at (0–130; null: mpv's own). onVolume(v): it changed (to keep).
// visual: for music and radio, the picture to show (visuals.js: 'cover', 'bars', … 'off'); null
// for films. cover(index): a promise of the cover picture's path on disk for that entry, or null.
function play({ how, entries, startIndex = 0, token, tokenHeader = 'X-Emby-Token', screenArgs = [], bindings, help = [], helpFooter = '', sound = 'auto-safe', motion = true, seeks, rewindOnResume = false, visual = null, cover, kind = 'video', links, appPad = true, padHint = null, colors = null, volume = null, onVolume, autoplay, onFileStart, onFileEnd, onState, onMessage, onExit, onPlaying, onMetadata, onPadless, onSound, onVisual, loadingText, logFile, log }) {
  setColors(colors); // (the theme's colours for the panels: Settings → Look)
  const dir = sharedDir(how.via);
  const id = `tv-overlay-${process.pid}-${Date.now()}`;
  const socketPath = path.join(dir, `${id}.sock`);
  const confPath = path.join(dir, 'tv-overlay-input.conf');
  fs.writeFileSync(confPath, inputConf(bindings, seeks));

  const files = [];
  entries.forEach((e) => {
    // Per-file options: each episode gets its own title; the first one may start partway.
    files.push('--{', `--force-media-title=${e.title}`);
    if (e.start > 0) files.push(`--start=${Math.floor(e.start)}`);
    for (const o of e.opts || []) files.push(o);
    files.push(e.url, '--}');
  });

  const args = [
    ...how.args,
    '--fs',
    ...screenArgs, // the same screen as the TV app
    '--ontop', // above the TV app, which waits full screen underneath (and is there when mpv closes)
    '--force-window=immediate',
    `--input-conf=${confPath}`,
    `--input-ipc-server=${socketPath}`,
    // Jellyfin needs its token on every request; live channels from other places must not get it.
    ...(token ? [`--http-header-fields=${tokenHeader}: ${token}`] : []),
    ...(SOUND_CHOICES.some((c) => c.value === sound) && sound !== 'auto-safe' ? [`--audio-channels=${sound}`] : []),
    ...(Number.isFinite(volume) && volume >= 0 && volume <= 130 ? [`--volume=${Math.round(volume)}`] : []),
    // (Music: the picture is there from the start; see visualStart below.)
    `--playlist-start=${startIndex}`,
    // Autoplay off: stop (paused) at the end of each episode instead of moving on.
    ...(autoplay ? [] : ['--keep-open=always']),
    // Debug logging on: mpv writes its own detailed log (why a stream wouldn't open, and so on).
    ...(logFile ? [`--log-file=${logFile}`] : []),
    ...files,
  ];

  const state = { position: null, paused: false, duration: null, index: startIndex };
  let current = null; // index of the file playing now
  let started = false; // mpv got as far as talking to us (so a later error exit isn't "failed to start")

  const ipc = connect(socketPath, (msg) => {
    started = true;
    if (msg.event === 'property-change') {
      if (msg.name === 'time-pos' && typeof msg.data === 'number') state.position = msg.data;
      else if (msg.name === 'pause') {
        const was = state.paused;
        state.paused = Boolean(msg.data);
        // Paused: the buttons show (and stay until you carry on), so they're easy to look up.
        if (controls) controls.refresh();
        // (Not when the app reads the controller: there the trigger menu shows the buttons.)
        if (state.paused && !was && loadedOnce && !controls) showHelp(0);
        else if (!state.paused && was) {
          hideHelp();
          // (A second back, so you don't miss the words you paused on.)
          if (rewindOnResume) ipc.send(['seek', -1, 'relative+exact']);
        }
      }
      else if (msg.name === 'duration' && typeof msg.data === 'number') state.duration = msg.data;
      else if (msg.name === 'volume') { if (typeof msg.data === 'number' && onVolume) onVolume(Math.round(msg.data)); return; }
      else if (msg.name === 'media-title') { state.title = typeof msg.data === 'string' ? msg.data : ''; return; }
      else if (msg.name === 'height') state.height = typeof msg.data === 'number' ? msg.data : null;
      else if (msg.name === 'metadata') { if (onMetadata) onMetadata(msg.data && typeof msg.data === 'object' ? msg.data : {}); return; }
      else if (msg.name === 'playlist-pos' && typeof msg.data === 'number' && msg.data >= 0) {
        state.index = msg.data;
        if (current !== msg.data) {
          // Normally mpv reports the old file ending first; if not, close it off here.
          if (current != null) onFileEnd(current, 'stop', state.position, state.duration);
          current = msg.data;
          state.position = null;
          state.duration = null;
          startLoading(current);
          visualFile(current);
          onFileStart(current);
        }
        return;
      }
      if (current != null) onState({ ...state, index: current });
    } else if (msg.event === 'end-file') {
      if (log) log.debug(`[mpv] file ${current} ended: ${msg.reason}${msg.file_error ? ` (${msg.file_error})` : ''}`);
      // "redirect": mpv read it as a list and is opening what's in it; the file isn't done yet.
      if (msg.reason === 'redirect') return;
      if (current != null) {
        onFileEnd(current, msg.reason, state.position, state.duration);
        current = null;
      }
    } else if (msg.event === 'client-message') {
      const args = msg.args || [];
      if (args[0] === 'tv-overlay-help') return showHelp(state.paused ? 0 : HELP_MS);
      if (args[0] === 'tv-overlay-sound') return nextSound();
      if (args[0] === 'tv-overlay-visual') return nextVisual();
      onMessage(args);
    } else if (msg.event === 'file-loaded') {
      // The stream is open: pictures are about to appear.
      stopLoading();
      // The first time, the buttons show for a few seconds.
      // (When the app reads the controller, a short note on how to get at everything instead.)
      if (!loadedOnce) { loadedOnce = true; if (controls) { if (padHint) showPanel(TOAST_ID, (k) => toastPanel(padHint, k), 5000); } else showHelp(HELP_MS); }
      visualLoaded(current);
      if (current != null && onPlaying) onPlaying(current);
    }
  }, ['media-title', 'volume', ...(onMetadata ? ['metadata'] : [])]);

  // While a file (or a live channel) is opening, a little animation, so you know it's coming.
  // Drawn with mpv's osd-overlay (styled text straight to the screen). show-text can't be used for
  // this: commands sent over the control socket don't expand ${osd-ass-cc}, so the styling codes
  // would show up as text.
  const OVERLAY_ID = 63;
  let spin = null;
  function startLoading(i) {
    stopLoading();
    if (!loadingText) return;
    const text = loadingText(i);
    if (!text) return;
    let frame = 0;
    const tick = () => {
      // Three dots, one lit at a time, big and centred, with what's loading underneath.
      // (In the theme's accent colour; the lit one glows.)
      const dots = [0, 1, 2].map((d) => (d === frame % 3 ? `{\\alpha&H00&\\1c&H${C.accent}&\\bord3\\3c&H${C.accent}&\\3a&HA0&\\blur4}●` : `{\\alpha&HB0&\\1c&H${C.text}&\\bord0\\blur0}●`)).join('{\\bord0}  ');
      ipc.send({
        name: 'osd-overlay', id: OVERLAY_ID, format: 'ass-events', res_x: 1280, res_y: 720,
        data: `{\\an5}{\\fs56}{\\bord0}{\\shad0}${dots}{\\alpha&H00&}\\N{\\fs30}${escapeAss(text)}`,
      });
      frame += 1;
    };
    tick();
    spin = setInterval(tick, 300);
  }
  function stopLoading() {
    if (!spin) return;
    clearInterval(spin);
    spin = null;
    ipc.send({ name: 'osd-overlay', id: OVERLAY_ID, format: 'none', data: '' });
  }

  // ---- panels that fade in and out: the buttons (along the bottom) and notes (at the top)
  const HELP_ID = 60;
  const TOAST_ID = 61;
  const HELP_MS = 7000;
  let loadedOnce = false;
  const panels = new Map(); // overlay id -> { k, draw, anim, hide }
  function drawPanel(id, p) {
    ipc.send({ name: 'osd-overlay', id, format: 'ass-events', res_x: 1280, res_y: 720, data: p.draw(p.k) });
  }
  function fadePanel(id, p, to, done) {
    clearInterval(p.anim);
    if (!motion) { p.k = to; if (to) drawPanel(id, p); if (done) done(); return; }
    p.anim = setInterval(() => {
      p.k = to > p.k ? Math.min(to, p.k + 0.25) : Math.max(to, p.k - 0.25); // about 160 ms
      if (p.k > 0) drawPanel(id, p);
      if (p.k === to) { clearInterval(p.anim); if (done) done(); }
    }, 40);
  }
  // ms: how long it stays (0: until hidden).
  function showPanel(id, draw, ms) {
    const p = panels.get(id) || { k: 0 };
    panels.set(id, p);
    p.draw = draw;
    clearTimeout(p.hide);
    if (p.k > 0) drawPanel(id, p); // (already showing: new contents straight away)
    fadePanel(id, p, 1);
    if (ms) p.hide = setTimeout(() => hidePanel(id), ms);
  }
  function hidePanel(id) {
    const p = panels.get(id);
    if (!p) return;
    clearTimeout(p.hide);
    fadePanel(id, p, 0, () => ipc.send({ name: 'osd-overlay', id, format: 'none', data: '' }));
  }
  function showHelp(ms) {
    if (!help.length) return;
    showPanel(HELP_ID, (k) => helpPanel(help, helpFooter, k), ms);
  }
  function hideHelp() { hidePanel(HELP_ID); }
  // The trigger menu: the same place as the button panel, kept up to date while it's showing.
  let triggerTick = null;
  function showTrigger(on) {
    clearInterval(triggerTick); triggerTick = null;
    if (!on) { hidePanel(HELP_ID); return; }
    hidePanel(TOAST_ID);
    const draw = () => showPanel(HELP_ID, (k) => triggerPanel(help, helpFooter, { title: state.title, position: state.position, duration: kind === 'live' || kind === 'station' ? 0 : state.duration }, k), 0);
    draw();
    triggerTick = setInterval(draw, 1000);
  }

  // ---- speakers: the sound button steps through automatic, stereo, 5.1 and 7.1
  let soundNow = SOUND_CHOICES.some((c) => c.value === sound) ? sound : 'auto-safe';
  function nextSound() {
    const i = SOUND_CHOICES.findIndex((c) => c.value === soundNow);
    setSound(SOUND_CHOICES[(i + 1) % SOUND_CHOICES.length].value);
  }
  async function setSound(value) {
    soundNow = value;
    ipc.send(['set_property', 'audio-channels', soundNow]);
    if (onSound) onSound(soundNow);
    // Say what the title itself has, so "5.1" on a stereo film isn't a puzzle.
    const has = await ipc.ask(['get_property', 'audio-params/hr-channels']);
    const pretty = typeof has === 'string' ? has.replace(/\(.*\)/, '') : ''; // ("5.1(side)" is just 5.1)
    const lines = [`Speakers: ${soundName(soundNow)}`];
    if (soundNow === 'auto-safe') lines.push('Whatever your computer\'s sound settings use');
    if (pretty) lines.push(`This one's sound is ${pretty}`);
    showPanel(TOAST_ID, (k) => toastPanel(lines, k), 3000);
  }

  // ---- pictures for music: a visualiser (or the cover) drawn from the sound, by mpv itself
  // (visuals.js). Each file gets its cover when it arrives; a file with real pictures of its own
  // (a music video) is left alone.
  let visualNow = visual && visuals.visualIds.includes(visual) ? visual : null;
  const covers = new Map(); // entry index -> path or null
  let graphNow = '';
  let hasVideo = false; // this file has its own moving pictures
  let loadedFile = null;
  const coverWait = new Map(); // entry index -> promise of the above
  function visualFile(i) {
    hasVideo = false;
    loadedFile = null;
    if (!visualNow || !cover || coverWait.has(i)) return;
    coverWait.set(i, Promise.resolve().then(() => cover(i)).catch(() => null).then((p) => {
      covers.set(i, p || null);
      if (loadedFile === i && graphNow !== visuals.graphFor(visualNow, p)) applyVisual(); // (a late cover)
    }));
  }
  async function visualLoaded(i) {
    if (!visualNow) return;
    const tracks = await ipc.ask(['get_property', 'track-list']);
    hasVideo = Array.isArray(tracks) && tracks.some((t) => t.type === 'video' && !t.albumart && !t.image);
    // Wait a moment for the cover, so the picture is set up once rather than twice (each change
    // makes mpv catch its breath for a moment).
    if (coverWait.has(i)) await Promise.race([coverWait.get(i), new Promise((r) => setTimeout(r, 2500))]);
    loadedFile = i;
    applyVisual();
  }
  function applyVisual() {
    if (finished || !visualNow || loadedFile == null) return;
    const path = covers.get(loadedFile) || null;
    const graph = hasVideo ? '' : visuals.graphFor(visualNow, path);
    redrawCard();
    if (graph === graphNow) return;
    if (log) log.debug(`[mpv] picture: ${hasVideo ? 'the file\'s own' : visualNow}${path ? ' with its cover' : ''}`);
    graphNow = graph;
    ipc.send(['set_property', 'lavfi-complex', graph]);
    // (Clearing it leaves mpv with no sound track chosen: choose it again, and the file's own
    // picture, if it has one.)
    if (!graph) { ipc.send(['set_property', 'aid', 1]); ipc.send(['set_property', 'vid', 'auto']); }
  }
  function nextVisual() {
    if (visualNow) setVisual(visuals.nextVisual(visualNow));
  }
  function setVisual(id) {
    if (!visualNow || !visuals.visualIds.includes(id)) return;
    visualNow = id;
    if (onVisual) onVisual(visualNow);
    applyVisual();
    showPanel(TOAST_ID, (k) => toastPanel([`Picture: ${visuals.visualName(visualNow)}`], k), 2500);
  }

  // ---- the card: what's playing (a station and its song, or a song, its artist and album). Where
  // it goes depends on the picture: beside a big cover, in the top-left corner over a visualiser,
  // or in the middle.
  const CARD_ID = 62;
  let cardLines = null;
  function redrawCard() {
    if (!cardLines || !cardLines.length) { ipc.send({ name: 'osd-overlay', id: CARD_ID, format: 'none', data: '' }); return; }
    const spot = visualNow && !hasVideo ? visuals.cardSpot(visualNow, Boolean(loadedFile != null && covers.get(loadedFile))) : 'middle';
    const [first, ...rest] = cardLines;
    const at = { beside: '{\\an4\\pos(660,360)}', corner: '{\\an7\\pos(56,44)}', middle: '{\\an5\\pos(640,360)}' }[spot];
    const big = spot === 'corner' ? 34 : 46;
    const lines = rest.filter(Boolean).map((l, i) => `\\N{\\fs${i ? (spot === 'corner' ? 18 : 22) : (spot === 'corner' ? 24 : 30)}}{\\alpha&H${i ? '60' : '10'}&}${escapeAss(l)}`).join('');
    ipc.send({ name: 'osd-overlay', id: CARD_ID, format: 'ass-events', res_x: 1280, res_y: 720,
      data: `${at}{\\bord1.2}{\\3c&H000000&}{\\3a&H90&}{\\shad0}{\\fs${big}}${escapeAss(first)}${lines}` });
  }

  // ---- the controller, read by the app: plain presses, the hold buttons, and the menu (mpvcontrols.js)
  const controls = appPad ? createControls({
    send: (cmd) => ipc.send(cmd),
    ask: (cmd) => ipc.ask(cmd),
    state,
    kind,
    bindings,
    seeks: { ...SEEK_DEFAULTS, ...Object.fromEntries(Object.entries(seeks || {}).filter(([, v]) => SEEK_STEPS.includes(v))) },
    command: (action) => (action in SEEK_DEFAULTS
      ? seekCommand(action, SEEK_STEPS.includes((seeks || {})[action]) ? seeks[action] : SEEK_DEFAULTS[action])
      : MPV_COMMANDS[action] || null),
    run: (action) => {
      if (action === 'help') showHelp(state.paused ? 0 : HELP_MS);
      else if (action === 'sound') nextSound();
      else if (action === 'visual') nextVisual();
      else onMessage([`tv-overlay-${action}`]); // stop, skip: the app decides
    },
    sounds: SOUND_CHOICES,
    sound: () => soundNow,
    setSound,
    visuals: visualNow ? visuals.VISUALS.map((v) => ({ id: v.id, name: v.name })) : null,
    visual: () => visualNow,
    setVisual,
    links: links ? () => links(current != null ? current : state.index) : null,
    hideHelp,
    showTrigger,
    motion,
    toast: (lines) => showPanel(TOAST_ID, (k) => toastPanel(lines, k), 3000),
    title: () => state.title || '',
  }) : null;

  let finished = false;
  let child = null;
  // Music: mpv starts with its picture already set, with the first cover if it comes quickly. (On
  // a radio stream, adding a picture once it's playing freezes the sound; changing one is fine.)
  async function visualStart() {
    if (!visualNow) return;
    let p = null;
    if (cover) {
      p = await Promise.race([Promise.resolve().then(() => cover(startIndex)).catch(() => null), new Promise((r) => setTimeout(() => r(undefined), 2500))]);
      if (p !== undefined) { covers.set(startIndex, p || null); coverWait.set(startIndex, Promise.resolve()); }
    }
    graphNow = visuals.graphFor(visualNow, p || null);
    args.splice(args.indexOf(`--playlist-start=${startIndex}`), 0, `--lavfi-complex=${graphNow}`);
  }
  Promise.all([controls ? true : canGamepad(how), visualStart()]).then(([pad]) => {
    if (finished) return;
    if (controls) { if (onPadless) onPadless(); } // (the app reads the controller and drives mpv)
    else if (pad) args.splice(how.args.length, 0, '--input-gamepad=yes');
    else { if (log) log.debug('[mpv] this mpv can\'t read the controller itself: the app passes buttons on'); if (onPadless) onPadless(); }
    start();
  });
  function start() {
  if (log) log.debug('[mpv] starting:', how.cmd, args.filter((a) => !a.startsWith('--http-header-fields')).map((a) => (a.startsWith('--lavfi-complex=') ? '--lavfi-complex=(the picture)' : a)).join(' '));
  child = spawn(how.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: require('./apps').cleanEnv() });
  // What mpv (or Flatpak) prints, the last few lines kept: when it quits without playing anything,
  // that's the only clue why, so it goes in the log. (Long codes hidden, like the relay's.)
  let said = '';
  const hear = (chunk) => { said = (said + chunk.toString()).slice(-3000); };
  child.stdout.on('data', hear);
  child.stderr.on('data', hear);
  child.on('error', () => finish('launch-failed'));
  child.on('exit', (code, signal) => {
    if (log) log.debug(`[mpv] closed (exit ${code}${signal ? `, ${signal}` : ''})`);
    // Quit with an error before anything played: say so (the app shows a message), with mpv's words.
    if (code && !started) {
      const words = said.replace(/[0-9a-f]{24,}/gi, '«hidden»').trim().split('\n').slice(-12).join('\n  ');
      if (log) log.warn(`[mpv] quit straight away (exit ${code}, started with ${how.via || how.cmd}). It said:\n  ${words || '(nothing)'}`);
      return finish('mpv-failed');
    }
    finish(null);
  });
  }

  function finish(error) {
    if (finished) return;
    finished = true;
    clearInterval(spin);
    for (const p of panels.values()) { clearInterval(p.anim); clearTimeout(p.hide); }
    if (controls) controls.stop();
    clearInterval(triggerTick);
    if (current != null) onFileEnd(current, 'quit', state.position, state.duration);
    current = null;
    ipc.close();
    try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
    onExit(error || null);
  }

  return {
    command: (cmd) => ipc.send(cmd),
    // A controller button (standard number), passed on as if mpv had read it itself: its own
    // bindings (Settings → Controller → In mpv) decide what it does. For an mpv that can't read
    // the controller.
    // phase: 'down', 'repeat' (held D-pad) or 'up'.
    press: (button, phase = 'down') => {
      if (controls) controls.input(button, phase);
      else if (phase !== 'up' && MPV_BUTTON[button]) ipc.send(['keypress', MPV_BUTTON[button]]);
    },
    // Closing it from the app (if it never started, there's nothing to close).
    get running() { return Boolean(child) && !finished; },
    say: (text, ms = 4000) => ipc.send(['show-text', text, ms]),
    // A card that stays on screen (for music and radio): a big first line, smaller ones under it.
    // Empty clears it.
    card: (lines) => { cardLines = lines && lines.length ? lines : null; redrawCard(); },
  };
}

module.exports = { play, canGamepad, MPV_COMMANDS, MPV_BUTTON, SOUND_CHOICES, SEEK_DEFAULTS, SEEK_STEPS, inputConf, sharedDir, helpPanel, toastPanel };
