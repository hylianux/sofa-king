require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// The controller in mpv, read by the app: holding L2 or R2 (◀ ▶ skip further, ▲ ▼ volume), both
// together to lock, B to unlock; ▲ or Start opens the menu (playhead, subtitles list, QR codes).
// Buttons saved before the menu make way for it. Needs mpv and ffmpeg (a test film, no sound).
const path = require('path'); const fs = require('fs'); const { execFileSync } = require('child_process');
const { app, BaseWindow, ipcMain } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-mpvmenu');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
const OUT = path.join(__dirname, 'out', 'mpvmenu.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
const FILM = path.join(UD, 'film.mkv');
fs.writeFileSync(path.join(UD, 'en.srt'), '1\n00:00:00,000 --> 00:09:00,000\nHello\n');
fs.writeFileSync(path.join(UD, 'fr.srt'), '1\n00:00:00,000 --> 00:09:00,000\nBonjour\n');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=640x360:r=24', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-i', path.join(UD, 'en.srt'), '-i', path.join(UD, 'fr.srt'), '-map', '0', '-map', '1', '-map', '2', '-map', '3', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=fra',
  '-t', '600', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', '-c:a', 'aac', '-c:s', 'srt', '-shortest', FILM]);
process.env.JF_VIDEO_FILE = FILM;
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true }, jellyfinPlayer: 'mpv', playback: { confirmStop: false },
  // As saved before the menu: L2/R2 skipped a minute, ▲ ▼ volume, Start the time.
  mpvBindings: { pause: 0, stop: 1, subs: 2, skip: 3, prev: 4, next: 5, back60: 6, fwd60: 7, audio: 8, time: 9, sound: 10, visual: 11, volup: 12, voldown: 13, back10: 14, fwd30: 15 },
}));
require('./mockjf').start();
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sock = () => { const dir = process.env.XDG_RUNTIME_DIR; const f = fs.readdirSync(dir).find((x) => /^tv-overlay-\d+-\d+\.sock$/.test(x) && x.includes(`-${process.pid}-`)); return f && path.join(dir, f); };
const ask = (cmd) => new Promise((resolve) => {
  const at = sock(); if (!at) return resolve(null);
  const s = require('net').createConnection(at); let buf = '';
  s.on('connect', () => s.write(JSON.stringify({ command: cmd, request_id: 7 }) + '\n'));
  s.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.request_id === 7) { s.end(); resolve(m.data); } } catch { /* partial */ } } });
  s.on('error', () => resolve(null)); setTimeout(() => { s.destroy(); resolve(null); }, 3000);
});
const A = 0; const B = 1; const L2 = 6; const R2 = 7; const START = 9; const UP = 12; const DOWN = 13; const LEFT = 14; const RIGHT = 15;
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const pad = async (b, phase = 'down', ms = 250) => { ipcMain.emit('pad-raw', { sender: wc }, b, phase); await wait(ms); };
  const tap = async (b, ms = 250) => { await pad(b, 'down', 60); await pad(b, 'up', ms); };
  const pos = async () => Math.round(await ask(['get_property', 'time-pos']));
  const shot = async (name) => { await ask(['screenshot-to-file', path.join(__dirname, 'out', `mpvmenu-${name}.png`), 'window']); };

  const b = await js('tv.mpvBindings()');
  say('saved buttons moved over:', JSON.stringify(b));
  say('  ', b.meta === 6 && b.meta2 === 7 && b.menu === 9 && b.menu2 === 12 && b.time === 13 && b.back60 == null && b.volup == null && b.pause === 0 ? 'PASS' : 'FAIL');

  say('play:', JSON.stringify(await js("tv.jfPlay('srv-living-room', 'item-other', 'Movie', 'Arrival', false)")));
  for (let i = 0; i < 30 && !(await ask(['get_property', 'time-pos'])); i++) await wait(500);
  await wait(1500);
  await ask(['set_property', 'pause', true]); await wait(400);
  await ask(['seek', 120, 'absolute+exact']); await wait(500);
  await ask(['set_property', 'volume', 50]);

  // Holding L2: ▶ skips a minute, ▲ turns it up.
  let p0 = await pos();
  await pad(L2); await shot('hold');
  await tap(RIGHT, 600); const p1 = await pos();
  await tap(UP); const v1 = await ask(['get_property', 'volume']);
  await pad(L2, 'up');
  await tap(RIGHT, 600); const p2 = await pos();
  say(`holding L2: ▶ ${p0}→${p1}, ▲ volume 50→${v1}; let go, ▶ ${p1}→${p2}`, p1 - p0 === 60 && v1 === 55 && p2 - p1 === 30 ? 'PASS' : 'FAIL');

  // Both together: locked. ◀ goes back a minute with nothing held; B unlocks (and doesn't stop).
  await pad(L2, 'down', 40); await pad(R2, 'down', 40); await pad(L2, 'up', 40); await pad(R2, 'up', 400);
  p0 = await pos(); await tap(LEFT, 600); const p3 = await pos();
  await tap(DOWN); const v2 = await ask(['get_property', 'volume']);
  await shot('locked');
  await tap(B, 600); const still = await ask(['get_property', 'time-pos']) != null;
  await tap(LEFT, 600); const p4 = await pos();
  say(`locked: ◀ ${p0}→${p3}, ▼ volume →${v2}; B: still playing ${still}, ◀ ${p3}→${p4}`, p0 - p3 === 60 && v2 === 50 && still && p3 - p4 === 10 ? 'PASS' : 'FAIL');

  // The menu (▲): Playhead first. A, ▶ three times, A: half a minute on.
  await tap(UP, 500); await shot('menu');
  p0 = await pos();
  await tap(A); await tap(RIGHT); await tap(RIGHT); await tap(RIGHT, 400); await shot('playhead');
  const stayed = await pos();
  await tap(A, 800); const p5 = await pos();
  say(`playhead: from ${p0}, stayed at ${stayed} while choosing, then jumped to ${p5}`, stayed === p0 && p5 - p0 === 30 ? 'PASS' : 'FAIL');
  // B there puts it back.
  await tap(A); await tap(LEFT); await tap(LEFT); await tap(B, 600);
  say('playhead, B:', await pos() === p5 ? 'PASS' : 'FAIL');

  // Subtitles: a list. Five along from Playhead; ▼ to the second track, A.
  for (let i = 0; i < 5; i++) await tap(RIGHT, 120);
  const sid0 = await ask(['get_property', 'sid']);
  await tap(A, 600); await shot('subs');
  await tap(DOWN); await tap(DOWN); await tap(A, 600);
  const sid1 = await ask(['get_property', 'sid']);
  say(`subtitles: ${sid0} → ${sid1}`, sid1 === 2 ? 'PASS' : 'FAIL');

  // QR codes (three further along): TMDB's page for this film.
  for (let i = 0; i < 3; i++) await tap(RIGHT, 120);
  await tap(A, 1500); await shot('qr');
  // B: back to the menu; B again closes it; then A pauses / plays as usual.
  await tap(B); await tap(B, 500);
  const paused0 = await ask(['get_property', 'pause']);
  await tap(A, 500); const paused1 = await ask(['get_property', 'pause']);
  say(`menu closed, A pauses / plays: ${paused0} → ${paused1}`, paused0 !== paused1 ? 'PASS' : 'FAIL');
  // Start opens it too; Start again closes it.
  await tap(START, 400); await shot('start'); await tap(START, 400);
  await tap(A, 500);
  say('after Start twice, A still pauses / plays:', (await ask(['get_property', 'pause'])) === paused0 ? 'PASS' : 'FAIL');
  await ask(['quit']); await wait(1500);
  // The volume carries over to the next thing played.
  const vol = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).mpvVolume;
  say('volume saved:', vol, vol === 50 ? 'PASS' : 'FAIL');
  await js("tv.jfPlay('srv-living-room', 'item-other', 'Movie', 'Arrival', false)");
  for (let i = 0; i < 30 && (await ask(['get_property', 'volume'])) == null; i++) await wait(500);
  const vNext = await ask(['get_property', 'volume']);
  say('next film starts at:', vNext, vNext === 50 ? 'PASS' : 'FAIL');
  await ask(['quit']); await wait(1500);
  app.exit(0);
});
