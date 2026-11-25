require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Round 3: the Music tab. The real catalogue (MusicBrainz, Deezer, Apple: needs the internet) and a
// pretend Navidrome server on localhost: adding it (the sign-in only ever in the request body),
// search, an artist's page with its shelves (and your albums sorted in), an album's page, playing
// through the relay, and Settings → Music.
const path = require('path'); const fs = require('fs'); const http = require('http');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-music');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true }, layout: 'netflix', debugLog: true }));
const SHOTS = path.join(__dirname, 'out', 'shots-music'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'music.txt'); fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

// ---- pretend Navidrome
const PASSWORD = 'correct horse battery';
const seen = [];
const crypto = require('crypto');
const ALBUMS = [
  { id: 'al-1', name: 'Nevermind', artist: 'Nirvana', year: 1991, coverArt: 'al-1', songCount: 2, releaseTypes: ['Album'], artists: [{ name: 'Nirvana' }] },
  { id: 'al-2', name: 'Outcesticide I: In Memory of Kurt Cobain', artist: 'Nirvana', year: 1994, coverArt: 'al-2', songCount: 1, artists: [{ name: 'Nirvana' }] },
  { id: 'al-3', name: 'Basement Tapes Nobody Has', artist: 'Nirvana', year: 1990, coverArt: 'al-3', songCount: 1, artists: [{ name: 'Nirvana' }] },
  // Tagged with MusicBrainz (an edition of Bleach) but named oddly: matched by its id.
  { id: 'al-5', name: 'My Rip of That First Record', artist: 'Nirvana', year: 1989, coverArt: 'al-5', songCount: 1, artists: [{ name: 'Nirvana' }], musicBrainzId: '02b23593-ad18-4c8c-b30a-5c96b4796289' },
  { id: 'al-4', name: 'A Kazoo Tribute to Nirvana', artist: 'Various Artists', year: 2003, coverArt: 'al-4', songCount: 1, artists: [{ name: 'Various Artists' }], albumArtists: [{ name: 'Nirvana' }] },
];
const SONGS = { 'al-1': [{ id: 's-1', title: 'Smells Like Teen Spirit', track: 1, duration: 301 }, { id: 's-2', title: 'In Bloom', track: 2, duration: 254 }] };
const nd = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = new URLSearchParams(body);
    const signedIn = p.get('u') === 'me' && p.get('t') === crypto.createHash('md5').update(PASSWORD + p.get('s')).digest('hex');
    seen.push(`${req.method} ${u.pathname} query=${u.search ? 'YES' : 'none'} signin=${signedIn ? 'ok' : 'no'}${p.has('p') ? ' PASSWORD-SENT' : ''}`);
    const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: '0.61.2', openSubsonic: true, ...o } })); };
    if (!signedIn) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })); }
    const m = u.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
    if (m === 'ping') return J({});
    if (m === 'getMusicFolders') return J({ musicFolders: { musicFolder: [{ id: 1, name: 'Music' }, { id: 2, name: 'Archival' }] } });
    if (m === 'search3') {
      const q = (p.get('query') || '').toLowerCase();
      if (Number(p.get('songCount'))) return J({ searchResult3: { song: Object.values(SONGS).flat().filter((x) => x.title.toLowerCase().includes(q)).map((x) => ({ ...x, artist: 'Nirvana', album: 'Nevermind' })) } });
      if (Number(p.get('artistCount'))) return J({ searchResult3: { artist: q.includes('nirvana') ? [{ id: 'ar-1', name: 'Nirvana' }] : [] } });
      return J({ searchResult3: { album: ALBUMS.filter((a) => a.name.toLowerCase().includes(q)) } });
    }
    if (m === 'getArtist') return J({ artist: { id: 'ar-1', name: 'Nirvana', album: ALBUMS } });
    if (m === 'getAlbum') { const a = ALBUMS.find((x) => x.id === p.get('id')); return J({ album: { ...a, song: SONGS[a.id] || [{ id: `s-${a.id}`, title: 'Track', track: 1, duration: 100 }] } }); }
    if (m === 'getAlbumList2') return J({ albumList2: { album: ALBUMS } });
    if (m === 'getCoverArt') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#c33"/></svg>'); }
    if (m === 'stream') { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '5' }); return res.end('ID3xx'); }
    if (m === 'scrobble') return J({});
    res.writeHead(404); res.end();
  });
});

require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };

app.whenReady().then(async () => {
  try {
    await new Promise((r) => nd.listen(0, '127.0.0.1', r));
    const ND = `http://127.0.0.1:${nd.address().port}`;
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(3000);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); } };
    const shot = async (f) => fs.writeFileSync(path.join(SHOTS, `${f}.png`), (await wc.capturePage()).toPNG());
    const focused = () => js("(document.activeElement.className || document.activeElement.tagName) + ' | ' + (document.activeElement.textContent || '').trim().slice(0, 60)");

    // Add the pretend Navidrome (wrong password first).
    say('wrong password:', JSON.stringify(await js(`tv.musicAddServer('${ND}', 'me', 'nope')`)));
    const added = await js(`tv.musicAddServer('${ND}', 'me', '${PASSWORD}')`);
    say('added:', JSON.stringify(added.ok && added.ok.servers));
    const cfg = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
    say('password saved anywhere:', JSON.stringify(cfg).includes(PASSWORD) ? 'YES (bad)' : 'no');

    // The Music tab.
    await js("setView('music')"); await wait(400);
    await until(() => js("Boolean(document.querySelector('#music-rows .m-shelf:not(.loading) .card'))"));
    say('music rows:', await js("[...document.querySelectorAll('#music-rows .m-shelf h2')].map(h=>h.textContent).join(' | ')"));
    say('focus:', await focused());
    await key('Down'); say('down:', await focused());
    await key('Right', 2); say('right x2:', await focused());
    await wait(1200); await shot('1-music-tab');

    // Search.
    await js("openSearch({ music: true })"); await wait(300);
    await js("setQuery('nirvana')");
    await until(() => js("document.querySelectorAll('#results .m-card').length > 3"));
    say('search heads:', await js("[...document.querySelectorAll('#results .results-head')].map(h=>h.textContent).join(', ')"), '| cards:', await js("document.querySelectorAll('#results .m-card').length"));
    await wait(1500); await shot('2-search');

    // An artist's page.
    await js("openArtist({ kind: 'artist', name: 'Nirvana' })");
    await until(() => js("Boolean(document.querySelector('#ar-shelves .m-shelf:not(.loading) .card'))"), 40000);
    say('artist:', await js("document.getElementById('ar-name').textContent + ' | ' + document.getElementById('ar-about').textContent"));
    say('shelves:', await js("[...document.querySelectorAll('#ar-shelves .m-shelf h2')].map(h=>h.textContent).join(' | ')"));
    say('focus:', await focused());
    await wait(1500); await shot('3-artist');
    await until(() => js("!document.querySelector('#ar-shelves .m-shelf.loading') && Boolean(document.querySelector('[data-shelf=\"related\"]'))"), 120000);
    say('all shelves:', await js("[...document.querySelectorAll('#ar-shelves .m-shelf h2')].map(h=>h.textContent).join(' | ')"));
    say('marked as on your servers:', await js("[...document.querySelectorAll('#ar-shelves .m-mine')].map(m=>m.closest('.card').querySelector('.name').textContent).join(' | ')"));
    say('related artists:', await js("[...document.querySelectorAll('[data-shelf=\"related\"] .name')].slice(0, 5).map(n=>n.textContent).join(', ')"));
    say('appears on:', await js("[...document.querySelectorAll('[data-shelf=\"appears\"] .name')].length"), 'albums');
    say('only on your servers:', await js("[...document.querySelectorAll('[data-shelf=\"yours-only\"] .name')].map(n=>n.textContent).join(' | ')"));
    say('kazoo tribute with the tributes:', await js("[...document.querySelectorAll('[data-shelf=\"tribute\"] .name')].some(n=>/Kazoo/.test(n.textContent))"));
    // Moving down through the shelves: always onto the next shelf, never sideways.
    const path1 = [];
    for (let i = 0; i < 5; i++) { await key('Down'); path1.push(await js("document.activeElement.closest('.m-shelf')?.dataset.shelf || document.activeElement.className")); }
    say('down through shelves:', path1.join(' > '));
    await key('Down', 6); await wait(800); await shot('4-artist-lower');

    // An album's page (Nevermind, which is on the pretend server too).
    await js("openAlbum({ kind: 'album', title: 'Nevermind', artist: 'Nirvana' })");
    await until(() => js("document.querySelectorAll('#al-tracks .al-track:not(.ghost)').length > 0"), 30000);
    say('album:', await js("document.getElementById('al-kind').textContent + ' | ' + document.getElementById('al-title').textContent + ' | ' + document.getElementById('al-meta').textContent"));
    say('your servers:', await js("[...document.querySelectorAll('#al-yours .watch-btn')].map(b=>b.textContent).join(', ')"));
    say('listen on:', await js("[...document.querySelectorAll('#al-listen .watch-btn')].map(b=>b.textContent).join(', ')"));
    say('tracks:', await js("document.querySelectorAll('#al-tracks .al-track').length"), '| focus:', await focused());
    await key('Right', 3); say('right x3:', await focused());
    await wait(1200); await shot('5-album');
    // Playing goes through the relay (mpv may not be here: either way, no sign-in in an address).
    const played = await js("tv.musicPlay(document.querySelector('#al-yours .watch-btn') ? 'x' : '', '', 0)");
    say('play with a bad server id:', JSON.stringify(played));

    // An unofficial album opened from the pretend server only.
    await js("openAlbum({ kind: 'album', title: 'Basement Tapes Nobody Has', artist: 'Nirvana', serverId: JSON.parse(JSON.stringify(document.querySelector('[data-shelf=\"yours-only\"] .card') ? 'from-shelf' : 'none')) })");
    await wait(300);
    const sid = (await js("tv.musicSettings()")).ok.servers[0].id;
    await js(`openAlbum({ kind: 'album', title: 'Basement Tapes Nobody Has', artist: 'Nirvana', serverId: '${sid}', itemId: 'al-3' })`);
    await until(() => js("document.querySelectorAll('#al-tracks .al-track:not(.ghost)').length > 0"), 30000);
    say('library-only album:', await js("document.getElementById('al-title').textContent + ' | yours: ' + [...document.querySelectorAll('#al-yours .watch-btn')].map(b=>b.textContent).join(', ') + ' | note: ' + document.getElementById('al-note').textContent"));

    // Playing it: mpv gets the songs from the relay on this computer, which asks the server.
    const playRes = await js(`tv.musicPlay('${sid}', 'al-1', 1)`);
    say('play:', JSON.stringify(playRes));
    await until(() => seen.some((x) => x.includes('/rest/stream')), 15000);
    await wait(2500);
    const mpvLine = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8').split('\n').find((l) => /\[mpv\] starting/.test(l)) || '';
    say('mpv was given:', mpvLine.replace(/^.*?starting:\s*/, '').split(' ').filter((a) => /^http/.test(a)).map((a) => a.replace(/[0-9a-f]{32}/, '<secret>')).join(' '));
    say('mpv args mention the token:', mpvLine.includes(JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).music.servers[0].token) ? 'YES (bad)' : 'no');

    // B goes back through the pages.
    await js("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(300);
    say('B:', await js('screen'));

    // Radio: the page, its tabs, favourites, your own station, and playing (next = next station).
    await js("openRadio('popular')");
    await until(() => js("document.querySelectorAll('#radio-list .radio-st').length > 5"), 20000);
    say('radio tabs:', await js("[...document.querySelectorAll('#radio-tabs .pill')].map(b=>b.textContent).join(', ')"));
    say('popular stations:', await js("document.querySelectorAll('#radio-list .radio-st').length"), '| first:', await js("document.querySelector('#radio-list .st-name').textContent"));
    await js("document.querySelector('#radio-list .radio-st').focus()"); await wait(200);
    await key('Left'); say('left from a station:', await focused());
    await key('Right'); await key('Down'); say('down:', await focused());
    await wait(1500); await shot('8-radio-popular');
    await js("document.querySelector('#radio-list .live-fav').click()"); await wait(800);
    say('favourites now:', JSON.stringify((await js('tv.radioState()')).ok.favorites.map((x) => x.name)));
    await js("showRadioTab('somafm')");
    await until(() => js("document.querySelectorAll('#radio-list .radio-st').length > 5"), 20000);
    say('somafm channels:', await js("document.querySelectorAll('#radio-list .radio-st').length"));
    await js("showRadioTab('countries', { focusList: true })");
    await until(() => js("document.querySelectorAll('.radio-countries .pill').length > 20"), 20000);
    say('countries:', await js("document.querySelectorAll('.radio-countries .pill').length"));
    await wait(800); await shot('9-radio-countries');
    say('bad address refused:', JSON.stringify(await js("tv.radioAdd('Nope', 'file:///etc/passwd')")), JSON.stringify(await js("tv.radioAdd('Nope', '--script=x')")));
    const mine = await js("tv.radioAdd('My test stream', 'https://example.com/stream.mp3')");
    say('own station added:', JSON.stringify(mine.ok && mine.ok.mine.map((x) => x.name)));
    const fresh = await js("tv.radioList('favorites')");
    const rp = await js(`tv.radioPlay(${JSON.stringify(fresh.ok)}, 0)`);
    say('radio play:', JSON.stringify(rp));
    await wait(3000);
    const mpv2 = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8').split('\n').filter((l) => /\[mpv\] starting/.test(l)).pop() || '';
    say('mpv got for radio:', mpv2.split(' ').filter((a) => /^https?:/.test(a)).join(' ').slice(0, 200), '| header option:', /http-header-fields/.test(mpv2) ? 'yes (bad)' : 'none');
    require('child_process').execSync('pkill -f "[t]v-overlay-input.conf" || true');
    await wait(1500);
    await js("go('home'); musicState.loaded = false; setView('music')"); await wait(400);
    await until(() => js("Boolean(document.querySelector('[data-shelf=\"radio\"] .station'))"), 20000);
    say('music tab radio shelf:', await js("[...document.querySelectorAll('[data-shelf=\"radio\"] .name')].map(n=>n.textContent).join(' | ')"));
    say('shelf order:', await js("[...document.querySelectorAll('#music-rows .m-shelf h2')].map(h=>h.textContent).join(' | ')"));

    // ListenBrainz: your name (checked), the Made for you shelf, a playlist and its songs.
    say('unknown listenbrainz name:', JSON.stringify(await js("tv.musicListenBrainz('nobody-xyz-123')")));
    say('listenbrainz name kept:', (await js("tv.musicListenBrainz('rob')")).ok.listenbrainz);
    await js("go('home'); musicState.loaded = false; setView('music')");
    await until(() => js("Boolean(document.querySelector('[data-shelf=\"made-for\"] .card'))"), 30000);
    say('shelf order now:', await js("[...document.querySelectorAll('#music-rows .m-shelf h2')].map(h=>h.textContent).join(' | ')"));
    say('made for you:', await js("[...document.querySelectorAll('[data-shelf=\"made-for\"] .name')].slice(0, 4).map(n=>n.textContent).join(' | ')"));
    await js("document.querySelector('[data-shelf=\"made-for\"] .card').click()");
    await until(() => js("document.querySelectorAll('#pl-tracks .al-track').length > 5 && !document.querySelector('#pl-play .loading')"), 120000);
    say('playlist:', await js("document.getElementById('pl-title').textContent + ' | ' + document.getElementById('pl-meta').textContent"), '| play button:', await js("document.getElementById('pl-play').textContent"));
    say('focus:', await focused());
    await wait(1500); await shot('11-playlist');
    const found = await js("tv.musicFindSongs([{ title: 'Smells Like Teen Spirit', artist: 'Nirvana' }, { title: 'A Song Nobody Has', artist: 'Nobody' }])");
    say('songs found:', JSON.stringify((found.ok || []).map((x) => x && `${x.title} on ${x.serverName}`)));
    say('play found songs:', JSON.stringify(await js(`tv.musicPlaySongs(${JSON.stringify(found.ok.filter(Boolean))}, 0)`)));
    await wait(2500);
    const mpv3 = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8').split('\n').filter((l) => /\[mpv\] starting/.test(l)).pop() || '';
    say('mpv got for the playlist:', mpv3.split(' ').filter((a) => /^https?:/.test(a)).join(' ').replace(/\/[0-9a-f]{32}\//g, '/<secret>/'));
    require('child_process').execSync('pkill -f "[t]v-overlay-input.conf" || true');
    await wait(1500);
    say('songs from a page are refused:', JSON.stringify(await js("tv.musicPlaySongs([{ serverId: 'sub-x', id: 'made-up' }], 0)")));
    say('wrong last.fm key:', JSON.stringify(await js("tv.setAnyKey('lastfm', '0123456789abcdef0123456789abcdef')")), '| not a key:', JSON.stringify(await js("tv.setAnyKey('lastfm', 'hello')")));

    // Settings → Music.
    await js("openSettings({ tab: 'music' })"); await wait(1500);
    say('music rail:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
    await js("document.querySelector('.s-panel:not([hidden]) .rail-item[data-group=\"Radio\"]').focus()"); await wait(600);
    say('radio settings:', await js("document.getElementById('ra-mine').textContent + ' | somafm on: ' + document.getElementById('ra-somafm').classList.contains('on')"));
    await shot('10-settings-radio');
    await js("document.querySelector('.s-panel:not([hidden]) .rail-item[data-group=\"Folders\"]').focus()"); await wait(600);
    say('folders:', await js("[...document.querySelectorAll('#mu-folders .toggle')].map(b=>b.textContent).join(', ')"));
    await js("document.querySelector('#mu-folders [data-folder$=\":1\"]').click()"); await wait(800);
    say('picked Music only:', JSON.stringify(JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).music.servers[0].folders));
    await shot('6-settings-folders');
    await js("document.querySelector('.s-panel:not([hidden]) .rail-item[data-group=\"Music services\"]').focus()"); await wait(500);
    await shot('7-settings-services');
    await js("document.querySelector('.s-panel:not([hidden]) .rail-item[data-group=\"Recommendations\"]').focus()"); await wait(500);
    say('recommendations:', await js("document.getElementById('mu-lb-status').textContent + ' | ' + document.getElementById('mu-lf-status').textContent"));
    await shot('12-settings-recommendations');
    await js("document.getElementById('mu-shelf-appears').click()"); await wait(500);
    say('appears on switched off:', JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).music.shelves.appears === false);
    say('extra shelf when off:', JSON.stringify(await js("tv.musicExtra('5b11f4ce-a62d-471e-81fc-a69a8278c7da', 'appears')")));

    // What the pretend server saw: never a sign-in in an address, never the password itself.
    say('server saw:', [...new Set(seen)].join('\n  '));
    const log = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');
    const token = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).music.servers[0].token;
    say('token in the log:', log.includes(token) ? 'YES (bad)' : 'no', '| password in the log:', log.includes(PASSWORD) ? 'YES (bad)' : 'no');
    say('music log lines:', log.split('\n').filter((l) => /\[music\]|\[subsonic\]/.test(l)).length);
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
app.on('web-contents-created', (e, w) => w.on('console-message', (event) => { const m = event.message || ''; if (/error|refused|Uncaught/i.test(m)) say('page says:', m.slice(0, 300), `(${String(event.sourceId || '').split('/').pop()}:${event.lineNumber})`); }));
