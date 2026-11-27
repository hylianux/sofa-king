require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Search finds live channels (by name) and what's on them (by title); more results load as you go
// down; a title's page says when it's on a live channel; in the guide, B goes up to the categories
// and page down / up jump a screenful; the skip lengths in Settings reach mpv; after a pause, mpv
// carries on a second earlier when that's switched on. Needs mpv and ffmpeg.
const path = require('path'); const fs = require('fs'); const http = require('http'); const { execFileSync } = require('child_process');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-searchlive');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
const OUT = path.join(__dirname, 'out', 'searchlive.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
const FILM = path.join(UD, 'film.mkv');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=640x360:r=24', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', '-c:a', 'aac', '-shortest', FILM]);
process.env.JF_VIDEO_FILE = FILM;

// A channel list: 200 channels, two of them news, and "Arrival" on one now and another tonight.
const now = Date.now(); const base = now - (now % 1800000);
const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const names = Array.from({ length: 200 }, (_, i) => (i === 5 ? 'BBC News' : i === 9 ? 'Sky News Extra' : i === 12 ? 'Movies Now' : i === 40 ? 'Film Four' : `Channel ${i}`));
let m3u = '#EXTM3U\n'; let xml = '<?xml version="1.0"?><tv>';
names.forEach((n, i) => { m3u += `#EXTINF:-1 tvg-id="ch${i}" group-title="G${i % 5}",${n}\nhttp://127.0.0.1:5601/s/${i}.m3u8\n`; xml += `<channel id="ch${i}"><display-name>${n}</display-name></channel>`; });
names.forEach((n, i) => { for (let h = -1; h < 12; h++) { const s = base + h * 1800000; const t = (i === 12 && h === 0) ? 'Arrival' : (i === 40 && h === 8) ? 'Arrival' : `Show ${h}`; xml += `<programme start="${fmt(s)}" stop="${fmt(s + 1800000)}" channel="ch${i}"><title>${t}</title></programme>`; } });
xml += '</tv>';
http.createServer((req, res) => { if (req.url.startsWith('/s/40.m3u8')) { res.writeHead(200, { 'content-type': 'video/x-matroska' }); return fs.createReadStream(FILM).pipe(res); } if (req.url === '/list.m3u') return res.end(m3u); if (req.url === '/guide.xml') return res.end(xml); res.end('#EXTM3U\n'); }).listen(5601);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  trakt: { clientId: 'cid', clientSecret: 'csec', accessToken: 'trakt-at', refreshToken: 'trakt-rt', expiresAt: Date.now() + 864e5, username: 'tester', rows: false },
  jellyfinPlayer: 'mpv', playback: { confirmStop: false, rewindOnResume: true },
  live: { iptvOrgAsked: true, lists: [{ id: 'mine', name: 'My list', m3u: 'http://127.0.0.1:5601/list.m3u', guide: 'http://127.0.0.1:5601/guide.xml' }] },
}));
// Pretend TMDB: three pages of 20 for any search.
let uid = 1000;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.trakt.tv') return new Response(u.pathname.startsWith('/sync/watchlist') && !/remove/.test(u.pathname) && (!opts || !opts.method || opts.method === 'GET') ? '[]' : '{}', { headers: { 'content-type': 'application/json' } });
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  const p = u.pathname.replace('/3', ''); const J = (o) => new Response(JSON.stringify(o));
  const m = /^\/(movie|tv)\/(\d+)$/.exec(p);
  if (m) return J({ id: +m[2], title: 'Arrival', name: 'Arrival', overview: 'A linguist.', vote_average: 7.6, vote_count: 18000, release_date: '2016-11-11', runtime: 116, genres: [], credits: { crew: [], cast: [] }, 'watch/providers': { results: {} } });
  if (p.startsWith('/search')) { const page = Number(u.searchParams.get('page')) || 1; return J({ page, total_pages: 3, results: Array.from({ length: 20 }, (_, i) => ({ id: ++uid, media_type: 'movie', title: `Arrival ${page}-${i}`, poster_path: null, release_date: '2016-01-01', vote_count: 0 })) }); }
  return J({ results: [] });
};
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
app.whenReady().then(async () => {
  session.defaultSession.protocol.handle('https', async () => new Response('', { status: 404 }));
  await wait(6000);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(300); } };
  const shot = async (f) => fs.writeFileSync(path.join(__dirname, 'out', `searchlive-${f}.png`), (await wc.capturePage()).toPNG());
  const results = () => js("[...document.querySelectorAll('#results > *')].map((n) => n.matches('.results-head') ? '# ' + n.textContent : n.querySelector('.name').textContent + (n.classList.contains('live-result') ? ' (' + n.querySelector('.sub').textContent + ')' : '')).join(' | ')");

  for (let i = 0; i < 40 && !((await js("tv.liveFind('news')")) || { channels: [] }).channels.length; i++) await wait(500);
  // Search: a channel's name.
  await js("openSearch(); type('news'); 0"); await wait(2000);
  const r1 = await results();
  say('"news":', r1.slice(0, 200));
  say('  channels found:', /# Live channels \| BBC News \(.*\| Sky News Extra/.test(r1) ? 'PASS' : 'FAIL');
  await shot('news');
  // A film's title: it's on a channel now and another tonight.
  await js("setQuery(''); type('arrival'); 0"); await wait(2000);
  const r2 = await results();
  say('"arrival":', r2.slice(0, 260));
  say('  on now and later:', /# On your live channels \| Arrival \(Movies Now · on now\) \| Arrival \(Film Four · (at|\w{3}) /.test(r2) ? 'PASS' : 'FAIL', '| films after:', /# Films and series \| Arrival 1-0/.test(r2) ? 'PASS' : 'FAIL');
  await shot('arrival');
  // More results further down.
  const count = () => js("document.querySelectorAll('#results > .card:not(.live-result)').length");
  say('films at first:', await count());
  await js("[...document.querySelectorAll('#results > .card')].at(-3).focus(); 0"); await wait(1500);
  say('after going down near the end:', await count());
  await js("[...document.querySelectorAll('#results > .card')].at(-3).focus(); 0"); await wait(1500);
  const c3 = await count();
  say('and again:', c3, c3 === 60 ? 'PASS' : 'FAIL');
  await js("[...document.querySelectorAll('#results > .card')].at(-1).focus(); 0"); await wait(1500);
  say('no more pages after the last:', await count() === 60 ? 'PASS' : 'FAIL');
  // Page down in the results.
  await js("document.querySelector('#results > .card').focus(); 0"); await wait(300);
  const at = () => js("[...document.querySelectorAll('#results > .card')].indexOf(document.activeElement)");
  await key('PageDown'); const pd = await at();
  await key('PageUp'); const pu = await at();
  say('page down in the results: card', pd, '| back up: card', pu, pd > 4 && pu < pd ? 'PASS' : 'FAIL');

  // A title's page.
  await js("openDetail({ kind: 'movie', id: 329865, title: 'Arrival' }); 0"); await wait(2500);
  const live = await js("document.getElementById('d-live').hidden ? '(hidden)' : [...document.querySelectorAll('#d-live-row .pill')].map((b) => b.textContent).join(' / ')");
  say('title page, on live TV:', live, /Movies Now.*on now.*Film Four/.test(live) ? 'PASS' : 'FAIL');
  await shot('detail');
  // Trakt: top of the right-hand side, and Right from Watch on goes straight to it.
  const sideFirst = await js("[...document.querySelectorAll('.d-side [data-nav]')].find((b) => b.offsetParent).textContent");
  await js("document.querySelector('#d-watch [data-nav]').focus(); 0"); await wait(200);
  await key('Right'); const k1 = await js("document.activeElement.textContent");
  await key('Right'); const k2 = await js("document.activeElement.textContent");
  await key('Left'); await key('Left'); const k3 = await js("document.activeElement.closest('#d-watch') ? 'Watch on' : document.activeElement.textContent");
  say(`Trakt: first on the right "${sideFirst}" | Right from Watch on: "${k1}", then "${k2}" | Left twice: ${k3}`, /watchlist/.test(sideFirst) && /watchlist/.test(k1) && /watched/.test(k2) && k3 === 'Watch on' ? 'PASS' : 'FAIL');
  await shot('trakt');
  await js("document.getElementById('d-qr').click(); 0"); await wait(1200);
  const qrs = await js("[...document.querySelectorAll('#qr-pair figcaption')].map((f) => f.textContent).join(' / ')");
  say('QR codes:', qrs, /TMDB.*themoviedb\.org\/movie\/329865/.test(qrs) ? 'PASS' : 'FAIL');
  await shot('qr');
  await key('Escape'); await wait(600);
  say('B from the codes, back on the title page:', await js("!document.getElementById('screen-detail').hidden") ? 'PASS' : 'FAIL');

  // The guide: B goes up to the categories; page down / up.
  await key('Escape'); await wait(500);
  await js("show('home'); setView('live'); 0"); await wait(3500);
  await js("document.querySelectorAll('#live-list .live-ch')[3].focus(); 0"); await wait(300);
  const row = () => js("(() => { const r = document.activeElement.closest('.live-row'); return r ? [...document.querySelectorAll('#live-list .live-row')].indexOf(r) : document.activeElement.closest('#live-groups') ? 'categories: ' + document.activeElement.textContent : document.activeElement.className; })()");
  await key('PageDown'); const g1 = await row();
  await key('PageDown'); const g2 = await row();
  await key('PageUp'); const g3 = await row();
  say('guide page down / down / up from row 3:', g1, g2, g3, g1 > 6 && g2 > g1 && g3 < g2 ? 'PASS' : 'FAIL');
  await key('Escape'); const g4 = await row();
  say('B in the guide:', g4, /^categories/.test(String(g4)) ? 'PASS' : 'FAIL');
  await shot('guide');

  // Settings: skip lengths.
  await js("openSettings({ tab: 'jellyfin' }); 0"); await wait(800);
  say('skip lines:', await js("[...document.querySelectorAll('#pb-seek .stepper')].map((s) => s.textContent.replace(/[−+]/g, ' ').replace(/\\s+/g, ' ').trim()).join(' / ')"));
  await js("document.querySelector('[data-seek=\"back60-less\"]').click(); 0"); await wait(500);
  await js("document.querySelector('[data-seek=\"back60-less\"]').click(); 0"); await wait(500);
  await js("document.querySelector('[data-seek=\"fwd60-less\"]').click(); 0"); await wait(500);
  const saved = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).playback.seek;
  say('saved:', JSON.stringify(saved), saved.back60 === 30 && saved.fwd60 === 45 ? 'PASS' : 'FAIL');
  await js("document.querySelector('[data-seek=\"back60-more\"]').focus(); 0"); await wait(600);
  await shot('settings');

  // mpv: the buttons do what was set, and after a pause it carries on a second earlier.
  say('play:', JSON.stringify(await js("tv.jfPlay('srv-living-room', 'item-other', 'Movie', 'Arrival', false)")));
  await wait(6000);
  // (Holding L2 or R2 with ◀ ▶ uses the lengths set for them: see mpvmenu.js.)
  await ask(['set_property', 'pause', true]); await ask(['seek', 60, 'absolute+exact']); await wait(500);
  const t0 = await ask(['get_property', 'time-pos']);
  const { ipcMain } = require('electron');
  for (const [b, ph] of [[6, 'down'], [15, 'down'], [15, 'up']]) { ipcMain.emit('pad-raw', { sender: wc }, b, ph); await wait(150); }
  await wait(500); const t1 = await ask(['get_property', 'time-pos']);
  for (const [b, ph] of [[14, 'down'], [14, 'up'], [6, 'up']]) { ipcMain.emit('pad-raw', { sender: wc }, b, ph); await wait(150); }
  await wait(500); const t2 = await ask(['get_property', 'time-pos']);
  say(`hold L2 + ▶: ${Math.round(t0)} → ${Math.round(t1)}, + ◀: → ${Math.round(t2)}`, Math.round(t1 - t0) === 45 && Math.round(t1 - t2) === 30 ? 'PASS' : 'FAIL');
  await ask(['set_property', 'pause', false]); await wait(800);
  await ask(['set_property', 'pause', true]); await wait(1000);
  const p0 = await ask(['get_property', 'time-pos']);
  await ask(['set_property', 'pause', false]); await wait(300);
  const p1 = await ask(['get_property', 'time-pos']);
  say(`paused at ${p0 && p0.toFixed(2)}, carried on from ${p1 && p1.toFixed(2)}`, p1 < p0 - 0.5 && p1 > p0 - 1.5 ? 'PASS' : 'FAIL');
  await ask(['quit']); await wait(2000);
  // Live → Recently watched: a channel that played.
  await js("show('home'); setView('live'); 0"); await wait(1500);
  const film4 = await js("(live.state.channels.find((c) => c.name === 'Film Four') || {}).id");
  say('tune in:', JSON.stringify(await js(`tv.livePlay(['${film4}'], '${film4}')`)));
  for (let i = 0; i < 30 && (await ask(['get_property', 'time-pos'])) == null; i++) await wait(500);
  say('  live playing at', await ask(['get_property', 'time-pos']));
  await wait(1500); await ask(['quit']); await wait(2500);
  say('  quit');
  await js("getLiveState().then((s) => renderLive(s)); 0"); await wait(1500);
  const groups = await js("[...document.querySelectorAll('#live-groups .pill')].map((b) => b.textContent).join(' / ')");
  await js("[...document.querySelectorAll('#live-groups .pill')].find((b) => b.textContent === 'Recently watched')?.click(); 0"); await wait(800);
  const rows = await js("[...document.querySelectorAll('#live-list .live-row')].map((r) => r.querySelector('.live-ch').textContent.replace(/\\s+/g, ' ').trim()).join(' / ')");
  say('Live categories:', groups, '| Recently watched:', rows.slice(0, 80), /Recently watched/.test(groups) && /Film Four/.test(rows) && !/Channel/.test(rows) ? 'PASS' : 'FAIL');
  await shot('recent');
  // The categories: left / right stop at the ends (no looping round), up goes nowhere, B goes back
  // to the first, down goes into the channels.
  const cat = () => js("document.activeElement.closest('#live-groups') ? document.activeElement.textContent : 'not on the categories: ' + document.activeElement.className");
  await js("document.querySelector('#live-groups .pill').focus(); 0");
  const seen = [];
  for (let i = 0; i < 10; i++) { await key('Right'); seen.push(await cat()); }
  await key('Up'); const up = await cat();
  await key('Escape'); const b = await cat();
  await key('Left'); const left = await cat();
  await key('Down'); const down = await js("document.activeElement.className");
  say('categories, Right x10:', seen.join(' > '), '| Up:', up, '| B:', b, '| Left at the start:', left, '| Down:', down,
    seen.at(-1) === 'G4' && seen.at(-2) === 'G4' && up === 'G4' && /^All/.test(b) && /^All/.test(left) && /live-ch/.test(down) ? 'PASS' : 'FAIL');
  app.exit(0);
});
