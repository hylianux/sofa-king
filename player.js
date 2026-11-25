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
  time: 'show-progress',
};

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

function inputConf(bindings) {
  return Object.entries(bindings)
    .filter(([action, b]) => MPV_COMMANDS[action] && MPV_BUTTON[b])
    .map(([action, b]) => `${MPV_BUTTON[b]} ${MPV_COMMANDS[action]}`)
    .join('\n') + '\n';
}

// A folder both we and mpv can see. Flatpak apps always share $XDG_RUNTIME_DIR/app/<id> with the host.
function sharedDir(via) {
  const runtime = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const dir = via === 'flatpak' ? path.join(runtime, 'app', 'io.mpv.Mpv') : runtime;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Text inside mpv's styled messages: braces and backslashes would be read as styling.
const escapeAss = (s) => String(s).replace(/\\/g, '\\\\').replace(/[{}]/g, (c) => `\\${c}`);

function connect(socketPath, onMessage, watch = []) {
  let sock = null;
  let buffer = '';
  let closed = false;
  let nextId = 100;
  const queue = [];

  const send = (command) => {
    const line = JSON.stringify({ command, request_id: nextId++ }) + '\n';
    if (sock) sock.write(line); else queue.push(line);
  };

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
        try { onMessage(JSON.parse(line)); } catch { /* not JSON */ }
      }
    });
    s.on('error', () => {
      // mpv creates the socket a moment after it starts.
      if (!sock && triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 300);
    });
  };
  attempt(60);
  return { send, close: () => { closed = true; if (sock) sock.destroy(); } };
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
function play({ how, entries, startIndex = 0, token, tokenHeader = 'X-Emby-Token', screenArgs = [], bindings, help, autoplay, onFileStart, onFileEnd, onState, onMessage, onExit, onPlaying, onMetadata, onPadless, loadingText, logFile, log }) {
  const dir = sharedDir(how.via);
  const id = `tv-overlay-${process.pid}-${Date.now()}`;
  const socketPath = path.join(dir, `${id}.sock`);
  const confPath = path.join(dir, 'tv-overlay-input.conf');
  fs.writeFileSync(confPath, inputConf(bindings));

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
    `--osd-playing-msg=${help}`,
    '--osd-playing-msg-duration=6000',
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
      else if (msg.name === 'pause') state.paused = Boolean(msg.data);
      else if (msg.name === 'duration' && typeof msg.data === 'number') state.duration = msg.data;
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
      onMessage(msg.args || []);
    } else if (msg.event === 'file-loaded') {
      // The stream is open: pictures are about to appear.
      stopLoading();
      if (current != null && onPlaying) onPlaying(current);
    }
  }, onMetadata ? ['metadata'] : []);

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
      const dots = [0, 1, 2].map((d) => `{\\alpha&H${d === frame % 3 ? '00' : 'B0'}&}●`).join('  ');
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

  let finished = false;
  let child = null;
  canGamepad(how).then((pad) => {
    if (finished) return;
    if (pad) args.splice(how.args.length, 0, '--input-gamepad=yes');
    else { if (log) log.debug('[mpv] this mpv can\'t read the controller itself: the app passes buttons on'); if (onPadless) onPadless(); }
    start();
  });
  function start() {
  if (log) log.debug('[mpv] starting:', how.cmd, args.filter((a) => !a.startsWith('--http-header-fields')).join(' '));
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
    press: (button) => { if (MPV_BUTTON[button]) ipc.send(['keypress', MPV_BUTTON[button]]); },
    // Closing it from the app (if it never started, there's nothing to close).
    get running() { return Boolean(child) && !finished; },
    say: (text, ms = 4000) => ipc.send(['show-text', text, ms]),
    // A card that stays on screen (for radio, where there's no picture): a big first line, smaller
    // ones under it. Empty clears it.
    card: (lines) => ipc.send(lines && lines.length
      ? { name: 'osd-overlay', id: 62, format: 'ass-events', res_x: 1280, res_y: 720,
        data: `{\\an5}{\\bord0}{\\shad0}{\\fs46}${escapeAss(lines[0])}${lines.slice(1).filter(Boolean).map((l, i) => `\\N{\\fs${i ? 22 : 30}}{\\alpha&H${i ? '60' : '10'}&}${escapeAss(l)}`).join('')}` }
      : { name: 'osd-overlay', id: 62, format: 'none', data: '' }),
  };
}

module.exports = { play, canGamepad, MPV_COMMANDS, MPV_BUTTON, sharedDir };
