require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// While a film plays in mpv, the computer is told someone's watching (the standard "don't dim"
// request on the session bus); paused or stopped, it's lifted. Needs mpv and ffmpeg; plays a
// silent test film from the pretend Jellyfin.
const path = require('path'); const fs = require('fs'); const { spawn, execFileSync } = require('child_process');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-awake');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
const FILM = path.join(UD, 'film.mkv');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=640x360:r=24', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', FILM]);
process.env.JF_VIDEO_FILE = FILM;
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true }, jellyfinPlayer: 'mpv', playback: { confirmStop: false },
}));
const OUT = path.join(__dirname, 'out', 'awake.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
// Watch the session bus for the requests.
const calls = [];
const mon = spawn('dbus-monitor', ['--session', "interface='org.freedesktop.ScreenSaver'"]);
mon.stdout.on('data', (d) => { for (const m of String(d).matchAll(/member=(Inhibit|UnInhibit)/g)) calls.push(m[1]); });
require('./mockjf').start();
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sock = () => { const dir = process.env.XDG_RUNTIME_DIR; const f = fs.readdirSync(dir).find((x) => /^tv-overlay-\d+-\d+\.sock$/.test(x) && x.includes(`-${process.pid}-`)); return f && path.join(dir, f); };
const mpv = (cmd) => new Promise((resolve) => { const s = require('net').createConnection(sock()); s.on('connect', () => { s.write(JSON.stringify({ command: cmd }) + '\n'); setTimeout(() => { s.end(); resolve(); }, 200); }); s.on('error', () => resolve()); });
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const seen = () => calls.join(', ') || '(none)';
  say('before playing:', seen());
  say('play:', JSON.stringify(await js("tv.jfPlay('srv-living-room', 'item-other', 'Movie', 'Arrival', false)")));
  await wait(5000);
  say('playing:', seen(), calls.at(-1) === 'Inhibit' ? 'PASS' : 'FAIL');
  await mpv(['set_property', 'pause', true]); await wait(1000);
  say('paused:', seen(), calls.at(-1) === 'UnInhibit' ? 'PASS' : 'FAIL');
  await mpv(['set_property', 'pause', false]); await wait(1500);
  say('carried on:', seen(), calls.at(-1) === 'Inhibit' ? 'PASS' : 'FAIL');
  await mpv(['quit']); await wait(2000);
  say('stopped:', seen(), calls.at(-1) === 'UnInhibit' ? 'PASS' : 'FAIL');
  mon.kill();
  app.exit(0);
});
