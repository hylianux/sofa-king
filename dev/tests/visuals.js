require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Pictures while music plays (visuals.js): first every visualiser's filter graph, with and without a
// cover, through ffmpeg; then in the app, a pretend radio station (a local stream with a logo) in
// real mpv: the remembered picture is used, the logo arrives as a cover, R3 steps through every
// picture (a screenshot of each) without the sound stopping, and the last one is remembered.
// Needs mpv and ffmpeg.
const path = require('path'); const fs = require('fs'); const http = require('http'); const { execFileSync } = require('child_process');
const UD = path.join(__dirname, 'out', 'userdata-visuals');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
const OUT = path.join(__dirname, 'out', 'visuals.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
const SONG = path.join(UD, 'song.mp3'); const LOGO = path.join(UD, 'logo.png');
// (Something with a beat and both channels, so the pictures have something to show.)
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=110:d=90', '-f', 'lavfi', '-i', 'sine=f=165:d=90', '-f', 'lavfi', '-i', 'anoisesrc=d=90:a=0.15:c=pink',
  '-filter_complex', '[0][2]amix=2,tremolo=f=2:d=0.9[l];[1][2]amix=2,tremolo=f=3:d=0.7[r];[l][r]join=inputs=2:channel_layout=stereo,volume=2', '-c:a', 'libmp3lame', SONG]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=400x400', '-frames:v', '1', LOGO]);

const visuals = require('../../visuals');
let bad = 0;
for (const cover of [LOGO, null]) {
  for (const v of visuals.VISUALS) {
    if (!v.graph) continue;
    const g = visuals.graphFor(v.id, cover).replace('[aid1]asplit[ao][a]', '[0:a]anull[a]');
    try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-t', '2', '-i', SONG, '-filter_complex', g, '-map', '[vo]', '-f', 'null', '-'], { stdio: 'pipe' }); say(`graph ${v.id}${cover ? ' (cover)' : ''}: ok`); } catch (e) { bad++; say(`graph ${v.id}${cover ? ' (cover)' : ''}: FAIL ${String(e.stderr).slice(0, 300)}`); }
  }
}
say('a path with odd characters is refused:', visuals.graphFor('cover', '/tmp/a;b[x].jpg').includes('movie=') ? 'FAIL' : 'PASS');

const { app, BaseWindow } = require('electron');
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true }, mpvVisual: 'bars', playback: { confirmStop: false },
  // (Some stations heard before, for Recently played. Never played here.)
  radio: { recent: ['One', 'Two', 'Three'].map((n) => ({ id: `my-old-${n}`, name: `Old ${n} FM`, url: `http://127.0.0.1:9/${n}`, source: 'mine' })) } }));
const srv = http.createServer((req, res) => {
  if (req.url === '/logo.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(fs.readFileSync(LOGO)); return; }
  res.writeHead(200, { 'content-type': 'audio/mpeg' }); fs.createReadStream(SONG).pipe(res);
}).listen(0, '127.0.0.1');
// (Is the screen kept awake while the station plays? Heard on the session bus.)
const awake = [];
const mon = require('child_process').spawn('dbus-monitor', ['--session', "interface='org.freedesktop.ScreenSaver'"]);
mon.stdout.on('data', (d) => { for (const m of String(d).matchAll(/member=(Inhibit|UnInhibit)/g)) awake.push(m[1]); });
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sock = () => { const dir = process.env.XDG_RUNTIME_DIR; const f = fs.readdirSync(dir).find((x) => /^tv-overlay-\d+-\d+\.sock$/.test(x) && x.includes(`-${process.pid}-`)); return f && path.join(dir, f); };
const ask = (cmd) => new Promise((resolve) => {
  const s = require('net').createConnection(sock()); let buf = '';
  s.on('connect', () => s.write(JSON.stringify({ command: cmd, request_id: 7 }) + '\n'));
  s.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.request_id === 7) { s.end(); resolve(m.data); } } catch { /* partial */ } } });
  s.on('error', () => resolve(null)); setTimeout(() => { s.destroy(); resolve(null); }, 3000);
});
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const base = `http://127.0.0.1:${srv.address().port}`;
  say('play:', JSON.stringify(await js(`tv.radioPlay([{ id: 'my-test', name: 'Test FM', url: '${base}/stream.mp3', logo: '${base}/logo.png', source: 'mine', about: 'Tones and noise' }], 0)`)));
  for (let i = 0; i < 40 && !sock(); i++) await wait(250);
  await ask(['set_property', 'volume', 0]); // (tones and noise: not out loud on your speakers)
  await wait(7000);
  const graph = async () => String(await ask(['get_property', 'lavfi-complex']) || '');
  const which = (g) => (visuals.VISUALS.find((v) => g === visuals.graphFor(v.id, (g.match(/movie=([^,]+)/) || [])[1] || null)) || {}).id || (g ? '?' : '(none)');
  let g = await graph();
  say('starts on the remembered one:', which(g), which(g) === 'bars' ? 'PASS' : 'FAIL', '| with the logo:', /movie=.*sofa-cover-/.test(g) ? 'PASS' : 'FAIL');
  const seen = [];
  for (let i = 0; i < visuals.VISUALS.length; i++) {
    const t0 = await ask(['get_property', 'time-pos']);
    await ask(['keypress', 'GAMEPAD_RIGHT_STICK']);
    await wait(3000);
    const t1 = await ask(['get_property', 'time-pos']);
    g = await graph();
    const id = which(g); seen.push(id);
    const sound = await ask(['get_property', 'current-tracks/audio/id']);
    say(`R3 → ${id}: time ${t0 && t0.toFixed(1)} → ${t1 && t1.toFixed(1)} ${t1 > t0 + 1.5 ? 'PASS' : 'FAIL (the sound stopped or jumped)'} | sound track: ${sound ? 'yes' : 'NONE'}`);
    await ask(['screenshot-to-file', path.join(__dirname, 'out', `visuals-${id}.png`), 'window']);
  }
  say('went through every one:', visuals.visualIds.every((id) => seen.includes(id)) ? 'PASS' : `FAIL ${seen}`);
  const saved = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).mpvVisual;
  say('the last one is remembered:', saved, saved === seen.at(-1) ? 'PASS' : 'FAIL');
  const cfg = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
  say('screen kept awake while it plays:', awake.join(', ') || '(nothing)', awake.at(-1) === 'Inhibit' ? 'PASS' : 'FAIL');
  say('recently played:', (cfg.radio && cfg.radio.recent || []).map((x) => x.name).join(', '), cfg.radio && cfg.radio.recent && cfg.radio.recent[0] && cfg.radio.recent[0].id === 'my-test' ? 'PASS' : 'FAIL');
  say('volume kept for next time:', cfg.mpvVolume, cfg.mpvVolume === 0 ? 'PASS' : 'FAIL');
  const tab = await js("openRadio('recent').then(() => new Promise((r) => setTimeout(r, 800))).then(() => [document.querySelector('#radio-tabs .chosen').textContent, [...document.querySelectorAll('#radio-list .radio-st')].map((b) => b.textContent).join(' / ')].join(': '))");
  say('Radio → Recently played:', tab, /^Recently played: .*Test FM/.test(tab) ? 'PASS' : 'FAIL');
  // ✕ takes one off; Clear all asks first (No to start with, B is No), Yes clears.
  const names = () => js("[...document.querySelectorAll('#radio-list .st-name')].map((x) => x.textContent).join(' / ')");
  const before = await names();
  await js("[...document.querySelectorAll('#radio-list .radio-row')].find((r) => /Old Two/.test(r.textContent)).querySelector('.radio-x').click(); 0"); await wait(1200);
  const after = await names();
  say(`✕ on Old Two FM: ${before} → ${after} | focus on: ${await js("document.activeElement.className + ' ' + (document.activeElement.closest('.radio-row') || {}).textContent")}`, !/Old Two/.test(after) && /Old Three/.test(after) ? 'PASS' : 'FAIL');
  await js("document.querySelector('.radio-tools .pill').click(); 0"); await wait(600);
  say('Clear all asks:', await js("screen + ': ' + document.getElementById('sure-title').textContent + ' | on: ' + document.activeElement.textContent"));
  await js("back(); 0"); await wait(600);
  say('B keeps them:', await js('screen'), await names() === after ? 'PASS' : 'FAIL');
  await js("document.querySelector('.radio-tools .pill').click(); 0"); await wait(600);
  await js("document.getElementById('sure-yes').click(); 0"); await wait(1200);
  const cfg2 = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
  say('Yes clears them:', await js('screen'), JSON.stringify(await names()), '| saved:', cfg2.radio.recent.length, cfg2.radio.recent.length === 0 && !(await names()) ? 'PASS' : 'FAIL');
  // L1 / R1 switch tabs (stopping at the ends); the buttons show either side of them.
  const { ipcMain } = require('electron');
  const tabNow = () => js("document.querySelector('#radio-tabs .chosen').textContent");
  ipcMain.emit('pad', { sender: wc }, 'scrollup'); await wait(800); const t1 = await tabNow();
  ipcMain.emit('pad', { sender: wc }, 'scrollup'); await wait(800); const t2 = await tabNow();
  ipcMain.emit('pad', { sender: wc }, 'scrollup'); await wait(800); const t3 = await tabNow();
  say(`L1 from Recently played: ${t1} → ${t2} → ${t3} | hints: ${await js("[...document.querySelectorAll('.radio-tabbar kbd')].map((k) => k.textContent).join(' … ')")}`, t1 === 'Your stations' && t2 === '★ Favourites' && t3 === '★ Favourites' ? 'PASS' : 'FAIL');
  await js("document.querySelector('#radio-tabs .chosen').focus(); 0");
  fs.writeFileSync(path.join(__dirname, 'out', 'visuals-radio-tabs.png'), (await wc.capturePage()).toPNG());
  await ask(['quit']); await wait(2000);
  say('awake lifted after quitting:', awake.at(-1) === 'UnInhibit' ? 'PASS' : 'FAIL');
  say('covers tidied after quitting: (checked at exit)');
  say(bad ? `${bad} graphs FAILED` : 'all graphs ok');
  app.exit(0);
});
