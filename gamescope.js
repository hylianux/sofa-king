'use strict';

// Fixes for Steam's Game Mode (gamescope), where the screen dims during a film: the app says
// someone's watching, but nothing in Game Mode listens. Both are off unless switched on in
// Settings → Advanced → Gamescope fixes, and only do anything in Game Mode, while a picture plays.
//
//  - Steam's dimming: through Steam's debugging port (the way Decky Loader gets into Steam), set
//    Steam's own "dim after" and "sleep after" to never while a film plays, then back to Steam's
//    usual 5 and 10 minutes. The same settings the DeckyInhibitScreenSaver plugin changes.
//  - A pretend person: a pretend controller (or keyboard) that makes a tiny movement every half
//    a minute, so Steam's idle timer sees activity. Made with Linux's uinput, by a small Python
//    script (Python's own library can do it; nothing to install).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const inGameMode = () => /gamescope/i.test(process.env.XDG_CURRENT_DESKTOP || '') || Boolean(process.env.GAMESCOPE_WAYLAND_DISPLAY);

// ------------------------------------------------------------------ Steam's dimming

// Where Steam keeps its files (the usual install, then the Flatpak one).
function steamDirs() {
  const home = os.homedir();
  return [path.join(home, '.steam', 'steam'), path.join(home, '.local', 'share', 'Steam'), path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')]
    .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}
// The file that tells Steam to open its debugging port when it starts.
const FLAG = '.cef-enable-remote-debugging';
const flagPaths = () => steamDirs().map((d) => path.join(d, FLAG));
const flagOn = () => flagPaths().some((p) => fs.existsSync(p));
function setFlag(on) {
  const dirs = steamDirs();
  if (!dirs.length) return { error: 'no-steam' };
  for (const d of dirs) {
    const p = path.join(d, FLAG);
    try { if (on) fs.writeFileSync(p, ''); else fs.rmSync(p, { force: true }); } catch { /* not ours to change */ }
  }
  return { ok: true };
}
// Decky Loader needs the port too: never close it under Decky.
const hasDecky = () => fs.existsSync(path.join(os.homedir(), 'homebrew', 'services', 'PluginLoader')) || fs.existsSync(path.join(os.homedir(), 'homebrew', 'plugins'));

// Is the DeckyInhibitScreenSaver plugin here, switched on, and running? (Then the app's own fix
// isn't needed.) installed: its folder in Decky's plugins (plugin.json: "ScreenSaver" by
// xfangfang); disabled: Decky lists it as switched off; monitor: its Background Monitor setting
// (on unless switched off); listening: in Game Mode, something answers the standard "don't dim"
// request (Game Mode has nothing of its own, so that's the plugin, or something like it).
const execFileP = (cmd, args) => new Promise((resolve) => {
  require('child_process').execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? null : String(stdout)));
});
async function deckyPlugin() {
  const home = os.homedir();
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  let folder = null;
  try {
    for (const d of fs.readdirSync(path.join(home, 'homebrew', 'plugins'))) {
      const meta = readJson(path.join(home, 'homebrew', 'plugins', d, 'plugin.json'));
      if (meta && meta.name === 'ScreenSaver' && /xfangfang/i.test(meta.author || '')) { folder = d; break; }
    }
  } catch { /* no Decky */ }
  const loader = readJson(path.join(home, 'homebrew', 'settings', 'loader.json')) || {};
  const disabled = Boolean(folder) && Array.isArray(loader.disabled_plugins) && loader.disabled_plugins.some((n) => n === 'ScreenSaver' || n === folder);
  const own = folder ? readJson(path.join(home, 'homebrew', 'settings', folder, 'settings.json')) : null;
  const monitor = own && typeof own.run_on_login === 'boolean' ? own.run_on_login : true;
  let listening = null;
  if (inGameMode()) {
    const out = await execFileP('busctl', ['--user', 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', 'org.freedesktop.ScreenSaver']);
    listening = out == null ? null : /true/.test(out);
  }
  return { installed: Boolean(folder), disabled, monitor, listening };
}

const PORT = Number(process.env.SOFA_STEAM_CEF_PORT) || 8080; // (tests use a pretend Steam elsewhere)

// The page inside Steam where its own scripts run.
async function steamPage() {
  const list = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json());
  const page = (list || []).find((t) => t.title === 'SharedJSContext') || (list || []).find((t) => /steamloopback\.host/.test(t.url || ''));
  if (!page || !page.webSocketDebuggerUrl) throw Object.assign(new Error('not Steam'), { code: 'no-port' });
  return page.webSocketDebuggerUrl;
}

// Run a script in Steam's page and get its answer.
async function inSteam(expression) {
  const url = await steamPage();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* gone */ } reject(Object.assign(new Error('no answer'), { code: 'no-answer' })); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      const r = msg.result || {};
      if (r.exceptionDetails) reject(Object.assign(new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'failed'), { code: 'steam-said-no' }));
      else resolve(r.result ? r.result.value : undefined);
    };
    ws.onerror = () => { clearTimeout(timer); reject(Object.assign(new Error('could not connect'), { code: 'no-port' })); };
  });
}

// Steam's dim and sleep times, as the DeckyInhibitScreenSaver plugin sets them: numbered fields
// in Steam's settings format (dim on battery 1, plugged in 2, as seconds; sleep 3 and 4, or in
// newer Steam 24003 and 24004 through another call). 0 is never.
const dimScript = (dimSeconds, sleepSeconds) => `(async () => {
  const field = (n, wire, value) => {
    const out = [];
    let key = (n << 3) | wire;
    do { let b = key & 0x7f; key >>>= 7; if (key) b |= 0x80; out.push(b); } while (key);
    if (wire === 0) { do { let b = value & 0x7f; value >>>= 7; if (value) b |= 0x80; out.push(b); } while (value); }
    else out.push(...new Uint8Array(new Float32Array([value]).buffer));
    return String.fromCharCode(...out);
  };
  await SteamClient.System.UpdateSettings(btoa(field(1, 5, ${dimSeconds}) + field(2, 5, ${dimSeconds})));
  if (SteamClient.System.RegisterForOnSuspendRequest) await SteamClient.System.UpdateSettings(btoa(field(3, 5, ${sleepSeconds}) + field(4, 5, ${sleepSeconds})));
  else await SteamClient.Settings.SetSetting(btoa(field(24003, 0, ${sleepSeconds}) + field(24004, 0, ${sleepSeconds})));
  return 'ok';
})()`;

const STEAM_USUAL = { dim: 300, sleep: 600 }; // Steam's own defaults: 5 and 10 minutes
const steamDimming = (on) => inSteam(on ? dimScript(STEAM_USUAL.dim, STEAM_USUAL.sleep) : dimScript(0, 0));
async function steamPortOpen() { try { await steamPage(); return true; } catch { return false; } }

// ------------------------------------------------------------------ a pretend person

const PERSON_SCRIPT = String.raw`
import fcntl, os, signal, struct, sys, time
how, every = sys.argv[1], float(sys.argv[2])
fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
UI_SET_EVBIT, UI_SET_KEYBIT, UI_SET_ABSBIT, UI_DEV_CREATE, UI_DEV_DESTROY = 0x40045564, 0x40045565, 0x40045567, 0x5501, 0x5502
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
KEY_F24, ABS_RX = 194, 3
absmax, absmin = [0] * 64, [0] * 64
fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
if how == 'keyboard':
    fcntl.ioctl(fd, UI_SET_KEYBIT, KEY_F24)
    name = b'SOFA King keep-awake keyboard'
else:
    # A plain controller: face buttons, shoulders, Select and Start (never the Guide button), two sticks.
    for b in (0x130, 0x131, 0x133, 0x134, 0x136, 0x137, 0x13a, 0x13b):
        fcntl.ioctl(fd, UI_SET_KEYBIT, b)
    fcntl.ioctl(fd, UI_SET_EVBIT, EV_ABS)
    for a in (0, 1, 3, 4):
        fcntl.ioctl(fd, UI_SET_ABSBIT, a)
        absmin[a], absmax[a] = -32768, 32767
    name = b'SOFA King keep-awake controller'
# Virtual bus, pid.codes' test id.
os.write(fd, struct.pack('80sHHHHI64i64i64i64i', name, 0x06, 0x1209, 0x0001, 1, 0, *absmax, *absmin, *([0] * 64), *([0] * 64)))
fcntl.ioctl(fd, UI_DEV_CREATE, 0)
def emit(t, c, v):
    os.write(fd, struct.pack('llHHi', 0, 0, t, c, v))
def done(*_):
    try: fcntl.ioctl(fd, UI_DEV_DESTROY, 0)
    finally: os._exit(0)
signal.signal(signal.SIGTERM, done)
print('ready', flush=True)
parent = os.getppid()
while True:
    # Every second, check the app is still there: if it's gone (even by crashing), so is this.
    for _ in range(int(every)):
        time.sleep(1)
        if os.getppid() != parent:
            done()
    if how == 'keyboard':
        # F24: a key no program uses.
        emit(EV_KEY, KEY_F24, 1); emit(EV_SYN, 0, 0); emit(EV_KEY, KEY_F24, 0); emit(EV_SYN, 0, 0)
    else:
        # The right stick, moved a hair and back: too little to move anything.
        emit(EV_ABS, ABS_RX, 2500); emit(EV_SYN, 0, 0); time.sleep(0.15); emit(EV_ABS, ABS_RX, 0); emit(EV_SYN, 0, 0)
`;

const PYTHON = ['/usr/bin/python3', '/bin/python3', '/usr/local/bin/python3'].find((p) => fs.existsSync(p)) || null;
function uinputOk() { try { fs.accessSync('/dev/uinput', fs.constants.W_OK); return true; } catch { return false; } }

function createPerson({ log, every = 30 } = {}) {
  let child = null;
  return {
    start(how) {
      if (child || !PYTHON || !uinputOk()) return false;
      child = spawn(PYTHON, ['-I', '-c', PERSON_SCRIPT, how === 'keyboard' ? 'keyboard' : 'controller', String(every)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let said = '';
      child.stderr.on('data', (d) => { said = (said + d).slice(-600); });
      child.stdout.on('data', (d) => { if (/ready/.test(d) && log) log.info(`[gamescope] pretend ${how === 'keyboard' ? 'keyboard' : 'controller'} on`); });
      child.on('exit', (code) => { if (code && log) log.warn(`[gamescope] pretend person stopped (exit ${code}): ${said.trim().split('\n').pop() || ''}`); child = null; });
      return true;
    },
    stop() {
      if (!child) return;
      child.kill('SIGTERM');
      child = null;
      if (log) log.info('[gamescope] pretend person off');
    },
    get running() { return Boolean(child); },
  };
}

module.exports = { inGameMode, steamDirs, flagOn, setFlag, hasDecky, deckyPlugin, steamPortOpen, steamDimming, dimScript, createPerson, uinputOk, PYTHON };
