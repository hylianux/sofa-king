require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Settings → Advanced → Gamescope fixes, against a pretend Steam (a page called SharedJSContext
// with a stand-in SteamClient, on a debugging port) in a pretend home folder, "in Game Mode":
// Steam's dimming off while a film plays and back after; the pretend controller/keyboard comes
// and goes; the Settings switches. Needs mpv, ffmpeg, python3 and a writable /dev/uinput.
const path = require('path'); const fs = require('fs'); const { execFileSync } = require('child_process');
const { app, BaseWindow, BrowserWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-gamescope');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
const HOME = path.join(UD, 'home'); fs.mkdirSync(path.join(HOME, '.steam', 'steam'), { recursive: true });
process.env.HOME = HOME; // (so the real Steam folder is never touched)
process.env.XDG_CURRENT_DESKTOP = 'gamescope';
process.env.SOFA_STEAM_CEF_PORT = '18080';
app.commandLine.appendSwitch('remote-debugging-port', '18080');
const FILM = path.join(UD, 'film.mkv');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=640x360:r=24', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', FILM]);
process.env.JF_VIDEO_FILE = FILM;
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true }, jellyfinPlayer: 'mpv', playback: { confirmStop: false },
  gamescope: { steamDim: true, person: true, personHow: 'controller' },
}));
const OUT = path.join(__dirname, 'out', 'gamescope.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
require('./mockjf').start();
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sock = () => { const dir = process.env.XDG_RUNTIME_DIR; const f = fs.readdirSync(dir).find((x) => /^tv-overlay-\d+-\d+\.sock$/.test(x) && x.includes(`-${process.pid}-`)); return f && path.join(dir, f); };
const mpv = (cmd) => new Promise((resolve) => { const s = require('net').createConnection(sock()); s.on('connect', () => { s.write(JSON.stringify({ command: cmd }) + '\n'); setTimeout(() => { s.end(); resolve(); }, 200); }); s.on('error', () => resolve()); });
const device = () => (fs.readFileSync('/proc/bus/input/devices', 'utf8').match(/SOFA King keep-awake (\w+)/) || [])[1] || 'none';
// What the pretend Steam was told, decoded: [{ call, fields: { 1: 300, ... } }]
const decode = (b64) => {
  const bytes = [...atob(b64)].map((c) => c.charCodeAt(0)); const out = {}; let i = 0;
  const varint = () => { let v = 0, s = 0, b; do { b = bytes[i++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };
  while (i < bytes.length) { const key = varint(); const n = key >>> 3; if ((key & 7) === 5) { out[n] = new Float32Array(new Uint8Array(bytes.slice(i, i + 4)).buffer)[0]; i += 4; } else out[n] = varint(); }
  return out;
};
app.whenReady().then(async () => {
  // The pretend Steam.
  const steam = new BrowserWindow({ show: false });
  await steam.loadURL('data:text/html,<title>SharedJSContext</title><script>window.calls=[];window.SteamClient={System:{UpdateSettings:async(b)=>calls.push(["System.UpdateSettings",b]),RegisterForOnSuspendRequest:null},Settings:{SetSetting:async(b)=>calls.push(["Settings.SetSetting",b])}};</script>');
  const told = async () => (await steam.webContents.executeJavaScript('calls.splice(0)')).map(([c, b]) => `${c} ${JSON.stringify(decode(b))}`).join(' + ') || '(nothing)';
  await wait(4500);
  const wc = BaseWindow.getAllWindows().find((w) => w.contentView).contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  say('play:', JSON.stringify(await js("tv.jfPlay('srv-living-room', 'item-other', 'Movie', 'Arrival', false)")));
  await wait(5000);
  say('playing: Steam told', await told(), '| pretend device:', device());
  await mpv(['set_property', 'pause', true]); await wait(1500);
  say('paused: Steam told', await told(), '| pretend device:', device());
  await mpv(['set_property', 'pause', false]); await wait(2000);
  say('carried on: Steam told', await told(), '| pretend device:', device());
  await mpv(['quit']); await wait(2000);
  say('stopped: Steam told', await told(), '| pretend device:', device());
  // Settings.
  await js("openSettings({ tab: 'advanced' }); 0"); await wait(1200);
  const st = () => js("[document.getElementById('gs-where').textContent, document.getElementById('gs-steam').classList.contains('on'), document.getElementById('gs-steam-status').textContent, document.getElementById('gs-person').classList.contains('on'), document.getElementById('gs-person-how').textContent, document.getElementById('gs-person-status').textContent].join(' | ')");
  say('settings:', await st());
  await js("document.getElementById('gs-person-how').click(); 0"); await wait(500);
  say('after "Pretends with":', await st());
  await js("document.getElementById('gs-steam').click(); 0"); await wait(800);
  say('Steam fix off:', await st(), '| port file:', fs.existsSync(path.join(HOME, '.steam', 'steam', '.cef-enable-remote-debugging')));
  await js("document.getElementById('gs-steam').click(); 0"); await wait(800);
  say('Steam fix on:', await st(), '| port file:', fs.existsSync(path.join(HOME, '.steam', 'steam', '.cef-enable-remote-debugging')));
  say('menu down the left:', await js("[...document.querySelectorAll('.s-panel[data-tab=\"advanced\"] .rail-item')].map((b) => b.textContent).join(', ')"), '| plugin note shown:', !(await js("document.getElementById('gs-plugin-note').hidden")));
  say('no plugin, something else answers:', await js("[document.getElementById('gs-plugin-note').hidden ? '(no plugin note)' : 'PLUGIN NOTE: ' + document.getElementById('gs-plugin-note').textContent, document.getElementById('gs-other').hidden ? '(no other note)' : document.getElementById('gs-other').textContent].join(' | ')"));
  // The plugin installed: both fixes say they're not needed.
  const put = (p, o) => { fs.mkdirSync(path.dirname(path.join(HOME, p)), { recursive: true }); fs.writeFileSync(path.join(HOME, p), JSON.stringify(o)); };
  put('homebrew/plugins/ScreenSaver/plugin.json', { name: 'ScreenSaver', author: 'xfangfang' });
  await js("refreshGamescope(); 0"); await wait(1200);
  say('plugin installed:', await js("document.getElementById('gs-plugin-note').hidden ? '(hidden)' : document.getElementById('gs-plugin-note').textContent"), '| on the other fix too:', !(await js("document.getElementById('gs-plugin-note2').hidden")));
  await js("document.querySelector('.s-panel[data-tab=\"advanced\"] .rail-item').focus(); 0"); await wait(400);
  fs.writeFileSync(path.join(__dirname, 'out', 'gamescope-menu.png'), (await wc.capturePage()).toPNG());
  await js("document.getElementById('gs-steam').focus(); 0"); await wait(400);
  fs.writeFileSync(path.join(__dirname, 'out', 'gamescope.png'), (await wc.capturePage()).toPNG());
  app.exit(0);
});
