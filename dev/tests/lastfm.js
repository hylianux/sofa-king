require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Scrobbling to Last.fm, against a pretend Last.fm (every signed call checked) and a pretend
// Navidrome playing real (silent) songs in mpv:
//   - the key with its shared secret read off Last.fm's page together;
//   - signing in: a token, Last.fm's "allow" page opened here, waiting until Allow is pressed,
//     then back home with scrobbling on;
//   - playing: "now playing" for each song, a 10-second song never scrobbled, a 34-second one
//     scrobbled once played past half, with its start time;
//   - an older-style Subsonic server that only reads the address: added, played, scrobbled;
//   - scrobbling switched off for one server: nothing from it, the other still scrobbles;
//   - scrobbling off sends nothing; signing out; the secret and session never in the log.
const path = require('path'); const fs = require('fs'); const http = require('http'); const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-lastfm');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true }, layout: 'netflix', debugLog: true }));
const OUT = path.join(__dirname, 'out', 'lastfm.txt'); fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

const KEY = 'a'.repeat(31) + '1';
const SECRET = 'b'.repeat(31) + '2';
const SK = 'SessionKeyFromLastfm1234567890ab';

// Two silent songs: 10 seconds (too short to count) and 34 seconds.
const SND = path.join(__dirname, 'out', 'lastfm-songs'); fs.mkdirSync(SND, { recursive: true });
for (const [n, secs] of [['short', 10], ['long', 34]]) {
  const f = path.join(SND, `${n}.mp3`);
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(secs), '-q:a', '9', f]);
}

// ---- pretend Last.fm (reached through fetch, as the app's calls are)
let allowed = false;
const lf = [];
const sig = (p) => crypto.createHash('md5').update(Object.keys(p).filter((k) => k !== 'format' && k !== 'api_sig').sort().map((k) => `${k}${p[k]}`).join('') + SECRET).digest('hex');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'ws.audioscrobbler.com') return realFetch(url, opts);
  const p = Object.fromEntries(opts.body ? new URLSearchParams(String(opts.body)) : u.searchParams);
  const J = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  const signedOk = p.api_sig === sig(p);
  lf.push({ method: p.method, how: opts.method || 'GET', signed: p.api_sig ? (signedOk ? 'ok' : 'BAD') : 'none', p });
  if (p.method === 'artist.getinfo') return J(p.api_key === KEY ? { artist: { name: 'Nirvana' } } : { error: 10, message: 'Invalid API key' });
  if (!signedOk) return J({ error: 13, message: 'Invalid method signature supplied' });
  if (p.method === 'auth.getToken') return J({ token: 'tok123' });
  if (p.method === 'auth.getSession') return J(allowed ? { session: { name: 'testlistener', key: SK, subscriber: 0 } } : { error: 14, message: 'Unauthorized Token' });
  if (p.sk !== SK) return J({ error: 9, message: 'Invalid session key' });
  if (p.method === 'track.updateNowPlaying') return J({ nowplaying: {} });
  if (p.method === 'track.scrobble') return J({ scrobbles: { '@attr': { accepted: 1, ignored: 0 } } });
  return J({ error: 3, message: 'Invalid method' });
};

// ---- pretend Navidrome
const PASSWORD = 'pw';
const nd = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = new URLSearchParams(body || u.search);
    const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: '0.61.2', openSubsonic: true, ...o } })); };
    const m = u.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
    if (m === 'ping' || m === 'scrobble') return J({});
    if (m === 'getMusicFolders') return J({ musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } });
    if (m === 'getAlbum') return J({ album: { id: 'al-1', name: 'Nevermind', artist: 'Nirvana', year: 1991, song: [{ id: 'short', title: 'Intro Bit', artist: 'Nirvana', track: 1, duration: 10 }, { id: 'long', title: 'In Bloom', artist: 'Nirvana', track: 2, duration: 34 }] } });
    if (m === 'stream') {
      const f = fs.readFileSync(path.join(SND, `${p.get('id')}.mp3`));
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(f.length) });
      return res.end(f);
    }
    res.writeHead(404); res.end();
  });
});

// ---- an older-style Subsonic server: reads only the address, never a form
const oldSeen = [];
const old = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams;
  oldSeen.push(`${req.method} ${u.pathname.replace(/^\/rest\//, '')}`);
  const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.15.0', type: 'gonic', ...o } })); };
  if (!p.get('u')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 10, message: 'please provide a `u` parameter' } } })); }
  const m = u.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
  if (m === 'ping' || m === 'scrobble') return J({});
  if (m === 'getAlbum') return J({ album: { id: 'al-9', name: 'Bleach', artist: 'Nirvana', song: [{ id: 'short', title: 'Blew', artist: 'Nirvana', track: 1, duration: 10 }] } });
  if (m === 'stream') { const f = fs.readFileSync(path.join(SND, 'short.mp3')); res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(f.length) }); return res.end(f); }
  res.writeHead(404); res.end();
});

require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };
const calls = (m) => lf.filter((c) => c.method === m);

app.whenReady().then(async () => {
  try {
    // Last.fm's pages (the key page and the "allow" page), as the app's website view sees them.
    session.fromPartition('persist:tv').protocol.handle('https', async (req) => new Response(
      /api\/auth/.test(req.url) ? '<h1>Allow SOFA King to use your Last.fm account?</h1><button>Yes, allow access</button>'
        : `<h1>API account created</h1><p>API key ${KEY}</p><p>Shared secret ${SECRET}</p>`, { headers: { 'content-type': 'text/html' } }));
    await new Promise((r) => nd.listen(0, '127.0.0.1', r));
    const ND = `http://127.0.0.1:${nd.address().port}`;
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(2500);
    const views = () => BaseWindow.getAllWindows()[0].contentView.children.map((v) => v.webContents);
    const wc = views()[0];
    const js = (c) => wc.executeJavaScript(c);
    const st = async () => (await js('tv.musicSettings()')).ok;
    const show = (s) => JSON.stringify({ user: s.lastfmUser, secret: s.lastfmSecret, scrobble: s.scrobble, waiting: s.lastfmSigningIn });

    const added = await js(`tv.musicAddServer('${ND}', 'me', '${PASSWORD}')`);
    const sid = added.ok.servers[0].id;

    // The key and secret, read off Last.fm's page (Start → Use the key on this page).
    await js("openSetup('lastfm'); 0"); await wait(400);
    await js("tv.open('lastfm-key'); 0"); await wait(2000);
    await views().find((w) => /overlay\.html/.test(w.getURL())).executeJavaScript("window.tv.action('grab-key'); 0");
    await until(async () => (await st()).lastfm, 10000);
    say('key from the page:', JSON.stringify((await st()).lastfm), '| secret picked up too:', (await st()).lastfmSecret);
    say('settings, before signing in:', await js("document.getElementById('mu-sc-status').textContent + ' | sign in: ' + !document.getElementById('mu-sc-signin').hidden + ' | switch: ' + !document.getElementById('mu-sc-on').hidden"));

    // Signing in: Last.fm's page opens here; nothing until Allow is pressed.
    await js("openSettings({ tab: 'music' }); 0"); await wait(600);
    await js("document.getElementById('mu-sc-signin').click(); 0");
    await until(() => views().some((w) => /api\/auth/.test(w.getURL())), 10000);
    const authUrl = views().map((w) => w.getURL()).find((u) => /api\/auth/.test(u)) || '';
    say('allow page opened:', authUrl.replace(KEY, '<key>'));
    await wait(4000);
    say('while waiting:', show(await st()), '| asked', calls('auth.getSession').length, 'times, signed:', [...new Set(calls('auth.getSession').map((c) => c.signed))].join());
    allowed = true;
    await until(async () => (await st()).lastfmUser, 10000);
    await wait(500);
    say('after Allow:', show(await st()), '| allow page still open:', views().some((w) => /api\/auth/.test(w.getURL())), '| note:', await js("document.getElementById('toast').textContent"));
    say('settings now:', await js("document.getElementById('mu-sc-status').textContent + ' | sign out: ' + !document.getElementById('mu-sc-signout').hidden + ' | switch on: ' + document.getElementById('mu-sc-on').classList.contains('on')"));

    // Playing: the 10-second song (never counts), then the 34-second one.
    const t0 = Math.floor(Date.now() / 1000);
    say('play:', JSON.stringify(await js(`tv.musicPlay('${sid}', 'al-1', 0)`)));
    await until(() => calls('track.scrobble').length > 0, 70000);
    await wait(1000);
    say('now playing sent for:', calls('track.updateNowPlaying').map((c) => `${c.p.artist} – ${c.p.track} (${c.p.album}, ${c.p.duration}s, #${c.p.trackNumber}) signed ${c.signed} ${c.how}`).join(' / '));
    const sc = calls('track.scrobble');
    say('scrobbled:', sc.map((c) => `${c.p.artist} – ${c.p.track} (${c.p.duration}s) signed ${c.signed} ${c.how}, started ${Number(c.p.timestamp) - t0 >= 9 ? 'after the first song' : `${Number(c.p.timestamp) - t0}s in (wrong?)`}`).join(' / '));
    await until(() => js("screen !== 'player'"), 10000);
    await wait(2000);
    try { execFileSync('pkill', ['-f', '[t]v-overlay-input.conf']); } catch { /* already gone */ }
    await wait(1500);

    // An older-style server (only reads the address).
    await new Promise((r) => old.listen(0, '127.0.0.1', r));
    const added2 = await js(`tv.musicAddServer('http://127.0.0.1:${old.address().port}', 'me', '${PASSWORD}')`);
    const sid2 = added2.ok ? added2.ok.servers.find((x) => x.id !== sid).id : null;
    const saved2 = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).music.servers.find((x) => x.id === sid2) || {};
    say('older server added:', added2.ok ? added2.ok.servers.find((x) => x.id === sid2).name : JSON.stringify(added2), '| marked address-only:', saved2.get, '| asked:', [...new Set(oldSeen)].join(', '));

    // Per server: off for the first one.
    await js('openSettings({ tab: \'music\' }); 0'); await wait(500);
    say('per-server switches:', await js("[...document.querySelectorAll('#mu-sc-servers .pill')].map((b) => b.textContent.trim() + (b.classList.contains('on') ? ' [on]' : ' [off]')).join(' / ')"));
    await js(`document.querySelector('#mu-sc-servers [data-server="${sid}"]').click(); 0`); await wait(500);
    say('after switching the first off:', await js("[...document.querySelectorAll('#mu-sc-servers .pill')].map((b) => b.textContent.trim() + (b.classList.contains('on') ? ' [on]' : ' [off]')).join(' / ')"), '| focus:', await js('document.activeElement.textContent.trim()'));
    let n = lf.length;
    await js(`tv.musicPlay('${sid}', 'al-1', 0)`); await wait(5000);
    say('playing from the switched-off server, sent:', lf.length - n);
    try { execFileSync('pkill', ['-f', '[t]v-overlay-input.conf']); } catch { /* already gone */ }
    await wait(1500);
    n = lf.length;
    say('play from the older server:', JSON.stringify(await js(`tv.musicPlay('${sid2}', 'al-9', 0)`)));
    await until(() => lf.length > n, 15000);
    say('sent for it:', lf.slice(n).map((c) => `${c.method} ${c.p.artist} – ${c.p.track}`).join(' / '), '| it streamed:', oldSeen.includes('GET stream'));
    try { execFileSync('pkill', ['-f', '[t]v-overlay-input.conf']); } catch { /* already gone */ }
    await wait(1500);

    // Scrobbling off: nothing is sent.
    await js('tv.lastfmScrobble(false)');
    const before = lf.length;
    await js(`tv.musicPlay('${sid}', 'al-1', 0)`);
    await wait(5000);
    say('scrobbling off, sent while playing:', lf.length - before);
    try { execFileSync('pkill', ['-f', '[t]v-overlay-input.conf']); } catch { /* already gone */ }
    await wait(1500);

    // Signing out.
    say('sign out:', show((await js('tv.lastfmSignOut()')).ok));

    // Pasting from the phone: the key and the secret one at a time, in either order, or together.
    const paste = (t) => js(`tv.setAnyKey('lastfm', ${JSON.stringify(t)})`);
    const keep = async () => { const x = await st(); return `key ${x.lastfm ? 'yes' : 'no'}, secret ${x.lastfmSecret ? 'yes' : 'no'}`; };
    await paste('');
    say('forgotten:', await keep());
    say('secret first, with no key:', JSON.stringify(await paste(SECRET)), '|', await keep());
    say('then the key:', JSON.stringify(await paste(KEY)), '|', await keep());
    say('then the secret:', JSON.stringify(await paste(SECRET)), '|', await keep());
    await paste('');
    say('both at once, secret first:', JSON.stringify(await paste(`${SECRET}\n${KEY}`)), '|', await keep());
    say('something else:', JSON.stringify(await paste('c'.repeat(32))), '|', await keep());
    // No secret: Sign in to scrobble explains instead (the setup's "secret" step).
    await paste(''); await paste(KEY);
    await js("openSettings({ tab: 'music' }); 0"); await wait(500);
    await js("document.getElementById('mu-sc-signin').click(); 0"); await wait(800);
    say('sign in with no secret opens:', await js("screen + ' | ' + document.getElementById('su-title').textContent + ' | ' + [...document.querySelectorAll('#su-actions .pill')].map((b) => b.textContent).join(' / ')"));
    await js("document.querySelector('#su-actions .pill:nth-child(3)').click(); 0"); await wait(600);
    await js(`setAsk(${JSON.stringify(SECRET)}); finishAsk(ask.value); 0`); await wait(1500);
    say('typed the secret:', await keep(), '| setup now:', await js("document.getElementById('su-title').textContent + ' | ' + (document.getElementById('su-lf-secret') || {}).textContent"));

    const log = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');
    say('older server\'s token in the log:', log.includes(saved2.token) ? 'YES (bad)' : 'no');
    say('secret in the log:', log.includes(SECRET) ? 'YES (bad)' : 'no', '| session in the log:', log.includes(SK) ? 'YES (bad)' : 'no', '| key in the log:', log.includes(KEY) ? 'YES (bad)' : 'no');
    say('log lines:', log.split('\n').filter((l) => /\[lastfm\]/.test(l)).map((l) => l.replace(/^\S+\s+\w+\s+/, '')).slice(-6).join('\n  '));
  } catch (err) { say('ERROR', err.stack); }
  try { execFileSync('pkill', ['-f', '[t]v-overlay-input.conf']); } catch { /* none */ }
  app.exit(0);
});
app.on('web-contents-created', (e, w) => w.on('console-message', (event) => { const m = event.message || ''; if (/error|refused|Uncaught/i.test(m)) say('page says:', m.slice(0, 300), `(${String(event.sourceId || '').split('/').pop()}:${event.lineNumber})`); }));
