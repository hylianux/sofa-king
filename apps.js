'use strict';

// Other apps we hand off to: VacuumTube for YouTube, Jellyfin Desktop for Jellyfin.
// Each can be a Flatpak or a regular install. We launch it, then watch for it to close
// so the TV app can come back to the front.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const APPS = {
  vacuumtube: {
    name: 'VacuumTube',
    flatpaks: ['rocks.shy.VacuumTube'],
    bins: ['vacuumtube', 'VacuumTube', 'vacuum-tube'],
    paths: ['/opt/VacuumTube/vacuumtube', '/opt/vacuumtube/vacuumtube', '/opt/VacuumTube/VacuumTube', '/opt/vacuumtube/VacuumTube',
      '/usr/lib/vacuumtube/vacuumtube', '/usr/lib/VacuumTube/vacuumtube', '/usr/lib/vacuumtube/VacuumTube'],
    desktop: /vacuum\s*tube/i,   // how its app-launcher entry is named
    folders: /^vacuum-?tube$/i,    // a folder of its own in /opt or /usr/lib
    args: ['--fullscreen'],
    process: /vacuumtube/i,
    appimage: /^vacuumtube.*\.appimage$/i,
    site: 'https://github.com/shy1132/VacuumTube',
  },
  mpv: {
    name: 'mpv',
    flatpaks: ['io.mpv.Mpv'],
    bins: ['mpv'],
    paths: [],
    args: [],
    process: /(^|\/)mpv(\s|$)|io\.mpv\.Mpv/,
    site: 'https://mpv.io',
  },
  jellyfin: {
    name: 'Jellyfin Desktop',
    flatpaks: ['org.jellyfin.JellyfinDesktop', 'com.github.iwalton3.jellyfin-media-player'],
    bins: ['jellyfin-desktop', 'jellyfinmediaplayer', 'jellyfin-media-player'],
    paths: [],
    args: [],
    process: /jellyfin-?desktop|jellyfinmediaplayer|jellyfin-media-player|JellyfinDesktop/i,
  },
};

const run = (cmd, args, timeout = 6000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
});

function which(name) {
  const dirs = [...String(process.env.PATH || '').split(':'), '/usr/bin', '/usr/local/bin', '/bin', `${process.env.HOME}/.local/bin`];
  for (const dir of dirs) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

const found = new Map(); // id -> { at, how }
let customPaths = {};      // id -> a path set in Settings → Apps
function setCustomPath(id, p) { customPaths[id] = p || ''; found.delete(id); }

// The app's entry in the app launcher (every package installs one): what command it runs.
const DESKTOP_DIRS = () => [
  '/usr/share/applications', '/usr/local/share/applications', path.join(process.env.HOME || '', '.local/share/applications'),
  '/var/lib/flatpak/exports/share/applications', path.join(process.env.HOME || '', '.local/share/flatpak/exports/share/applications'),
  ...String(process.env.XDG_DATA_DIRS || '').split(':').filter(Boolean).map((d) => path.join(d, 'applications')),
];
function fromDesktopEntry(re) {
  for (const dir of [...new Set(DESKTOP_DIRS())]) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.desktop')); } catch { continue; }
    for (const n of names) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
      const name = /^Name=(.*)$/m.exec(text);
      if (!re.test(n) && !(name && re.test(name[1]))) continue;
      const exec = /^Exec=(.*)$/m.exec(text);
      if (!exec) continue;
      // Exec=/usr/bin/vacuumtube %U  ->  /usr/bin/vacuumtube   (quotes allowed; field codes dropped)
      const parts = exec[1].match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')).filter((x) => !/^%[a-zA-Z]$/.test(x));
      if (!parts.length) continue;
      const cmd = parts[0].includes('/') ? parts[0] : which(parts[0]);
      if (!cmd) continue;
      try { fs.accessSync(cmd, fs.constants.X_OK); } catch { continue; }
      return { cmd, args: parts.slice(1), via: `app launcher (${n})` };
    }
  }
  return null;
}
// A folder of its own in /opt or /usr/lib, with a program in it of the same name.
function fromFolders(re) {
  for (const root of ['/opt', '/usr/lib', '/usr/local/lib', '/usr/share']) {
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const d of names.filter((n) => re.test(n))) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, d)); } catch { continue; }
      const exe = files.find((f) => re.test(f) || /^vacuum-?tube$/i.test(f));
      if (!exe) continue;
      const p = path.join(root, d, exe);
      try { if (fs.statSync(p).isFile()) { fs.accessSync(p, fs.constants.X_OK); return { cmd: p, args: [], via: 'bin' }; } } catch { /* not a program */ }
    }
  }
  return null;
}

// How to start an app: { cmd, args } or null if it isn't installed. Re-checked after a minute.
async function locate(id) {
  const app = APPS[id];
  if (!app) return null;
  const hit = found.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.how;

  let how = null;
  if (customPaths[id]) {
    try { fs.accessSync(customPaths[id], fs.constants.X_OK); how = { cmd: customPaths[id], args: [], via: 'your setting' }; } catch { /* checked below */ }
  }
  const flatpak = !how && which('flatpak');
  if (flatpak) {
    for (const ref of app.flatpaks) {
      if ((await run(flatpak, ['info', ref])).ok) { how = { cmd: flatpak, args: ['run', ref], via: 'flatpak' }; break; }
    }
  }
  if (!how) {
    for (const bin of app.bins) {
      const p = which(bin);
      if (p) { how = { cmd: p, args: [], via: 'bin' }; break; }
    }
  }
  if (!how && app.appimage) {
    // AppImages: usually in ~/Applications, ~/.local/bin or ~/Downloads.
    for (const d of ['Applications', '.local/bin', 'Downloads', 'AppImages', 'bin'].map((x) => path.join(process.env.HOME || '', x))) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      const hit = names.find((n) => app.appimage.test(n));
      if (hit) {
        const p = path.join(d, hit);
        try { fs.accessSync(p, fs.constants.X_OK); how = { cmd: p, args: [], via: 'appimage' }; break; } catch { /* not runnable */ }
      }
    }
  }
  if (!how) {
    for (const p of app.paths) {
      try { fs.accessSync(p, fs.constants.X_OK); how = { cmd: p, args: [], via: 'bin' }; break; } catch { /* no */ }
    }
  }
  if (!how && app.desktop) how = fromDesktopEntry(app.desktop);
  if (!how && app.folders) how = fromFolders(app.folders);
  found.set(id, { at: Date.now(), how });
  return how;
}

// Is the app running right now? (Looks for its process; we can't otherwise see other apps.)
function running(id) {
  const re = APPS[id].process;
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch { return false; }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { continue; }
    if (re.test(cmd)) return true;
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The environment other apps start with: ours, minus what belongs to us. Started with
// `npm start`, our PATH begins with this project's node_modules/.bin, so a launcher script that
// runs `electron` (as VacuumTube's does on Arch: /usr/bin/startvacuumtube) would get *our*
// Electron instead of the system one, and crash. Electron also changes a few desktop variables
// for itself, which are put back.
function cleanEnv(base = process.env) {
  const env = { ...base };
  env.PATH = String(env.PATH || '').split(':')
    .filter((p) => p && !/[\\/]node_modules[\\/]\.bin\/?$/.test(p) && !/node-gyp-bin/.test(p)).join(':') || '/usr/local/bin:/usr/bin:/bin';
  for (const k of Object.keys(env)) {
    if (/^(npm_|ELECTRON_|NODE_|CHROME_|GOOGLE_API|INIT_CWD$|COLOR$|EDITOR_NPM)/.test(k)) delete env[k];
  }
  if (env.ORIGINAL_XDG_CURRENT_DESKTOP) { env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP; delete env.ORIGINAL_XDG_CURRENT_DESKTOP; }
  delete env.NODE_OPTIONS;
  // Run as an AppImage, the app sits in a temporary folder (/tmp/.mount_…) and paths into it are
  // added to PATH, LD_LIBRARY_PATH and the like. Other apps must not pick up our copies of things.
  const inside = [env.APPDIR, '/tmp/.mount_'].filter(Boolean);
  if (env.APPIMAGE || env.APPDIR) {
    for (const k of Object.keys(env)) {
      const v = String(env[k]);
      if (!inside.some((d) => v.includes(d))) continue;
      const kept = v.split(':').filter((p) => p && !inside.some((d) => p.startsWith(d))).join(':');
      if (kept) env[k] = kept; else delete env[k];
    }
    for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[k];
    if (!env.PATH) env.PATH = '/usr/local/bin:/usr/bin:/bin';
  }
  return env;
}

// Start the app (with extra arguments, like a URL). onClosed runs once it has gone away again;
// onFailed (instead) if it never got going: it couldn't be run, or it quit within a few seconds
// with an error. What it printed goes to the log either way, to see why.
async function launch(id, extraArgs = [], onClosed = () => {}, { onFailed = null, log = console } = {}) {
  const how = await locate(id);
  if (!how) return { error: 'not-installed' };
  const app = APPS[id];
  const args = [...how.args, ...app.args, ...extraArgs];
  log.info(`[apps] starting ${app.name}: ${how.cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  let child;
  try {
    child = spawn(how.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false, env: cleanEnv() });
  } catch (err) {
    log.warn(`[apps] ${app.name} couldn't be started: ${err.message}`);
    return { error: 'failed' };
  }
  const started = Date.now();
  let said = '';
  const keep = (d) => { said = (said + d.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const lines = () => said.split('\n').map((l) => l.trim()).filter(Boolean).slice(-12).join('\n    ');
  let failed = false;
  child.on('error', (err) => { failed = true; log.warn(`[apps] ${app.name} couldn't be started: ${err.message}`); });
  child.on('exit', (code, signal) => {
    const quick = Date.now() - started < 8000;
    if (code === 0 && !said) return;
    const msg = `[apps] ${app.name} (${path.basename(how.cmd)}) ended after ${((Date.now() - started) / 1000).toFixed(1)} s with ${signal || `code ${code}`}`;
    if (code !== 0 || signal) log.warn(`${msg}${said ? `; it said:\n    ${lines()}` : ''}`);
    else log.debug(`${msg}; it said:\n    ${lines()}`);
    if ((code !== 0 || signal) && quick) failed = true;
  });

  // Watch the app itself rather than our child: a second launch often just hands the request to
  // a copy that's already open and exits straight away.
  (async () => {
    while (!running(id) && !failed && Date.now() - started < 20_000) await sleep(500);
    if (failed && !running(id)) { if (onFailed) onFailed(); else onClosed(); return; }
    while (running(id)) await sleep(1500);
    onClosed();
  })();
  return { ok: true, name: app.name };
}

const info = (id) => ({ name: APPS[id].name, site: APPS[id].site || null });

// Forget what we found, so the next look checks again (after installing something, say).
const forget = () => found.clear();

module.exports = { locate, launch, running, info, forget, setCustomPath, cleanEnv };
