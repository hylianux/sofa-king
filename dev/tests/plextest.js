require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Plex: sign in with a code (pretend plex.tv), find servers, rows, "on my server", pictures,
// library, episodes, playback info and reports, against a pretend Plex server on localhost.
const path = require('path'); const fs = require('fs'); const http = require('http');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-plex');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  live: { iptvOrgAsked: true }, layout: 'netflix',
}));
const OUT = path.join(__dirname, 'out', 'plex-out.txt'); fs.writeFileSync(OUT, '');
const LOG = (...a) => fs.appendFileSync(OUT, a.join(' ') + '\n');

// ---- pretend Plex Media Server
const seen = [];
const SVR_TOKEN = 'srv-token-abcdef123456';
const md = (o) => ({ MediaContainer: { size: o.length, totalSize: o.length, Metadata: o } });
const MOVIE = { ratingKey: '100', type: 'movie', title: 'Harbor Lights', titleSort: 'Harbor Lights', year: 2023, summary: 'A movie on Plex.', duration: 6000000, viewOffset: 600000, lastViewedAt: 1764000000, Guid: [{ id: 'tmdb://424242' }],
  Media: [{ Part: [{ id: 5, key: '/library/parts/5/1700000000/file.mkv', Stream: [{ streamType: 3, key: '/library/streams/77' }] }] }], Marker: [{ type: 'intro', startTimeOffset: 1000, endTimeOffset: 61000 }, { type: 'credits', startTimeOffset: 5800000, endTimeOffset: 6000000 }] };
const SHOW = { ratingKey: '200', type: 'show', title: 'Paper Moons', year: 2022, Guid: [{ id: 'tmdb://515151' }] };
const EPS = [1, 2, 3].map((n) => ({ ratingKey: String(300 + n), type: 'episode', title: `Episode ${n}`, grandparentTitle: 'Paper Moons', grandparentRatingKey: '200', parentIndex: 1, index: n, duration: 2400000, viewCount: n < 3 ? 1 : 0,
  Media: [{ Part: [{ id: 50 + n, key: `/library/parts/${50 + n}/1/file.mkv` }] }] }));
const pms = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push(`${req.method} ${u.pathname}${u.search} token=${req.headers['x-plex-token'] === SVR_TOKEN ? 'ok' : (req.headers['x-plex-token'] ? 'WRONG' : 'none')} client=${req.headers['x-plex-client-identifier'] ? 'yes' : 'no'}`);
  const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname;
  if (p === '/identity') return J({ MediaContainer: { machineIdentifier: 'abc123machine' } });
  if (req.headers['x-plex-token'] !== SVR_TOKEN) { res.writeHead(401); return res.end(); }
  if (p === '/library/sections') return J({ MediaContainer: { Directory: [{ key: '1', type: 'movie', title: 'Movies' }, { key: '2', type: 'show', title: 'TV' }] } });
  if (p === '/library/sections/1/all') {
    const t = (u.searchParams.get('title') || '').toLowerCase();
    if (t) return J(md(t && 'harbor lights'.includes(t.slice(0, 6)) ? [MOVIE] : []));
    const start = Number(u.searchParams.get('X-Plex-Container-Start') || 0); const size = Number(u.searchParams.get('X-Plex-Container-Size') || 50);
    const all = Array.from({ length: 30 }, (_, i) => ({ ratingKey: String(1000 + i), type: 'movie', title: `Film ${String.fromCharCode(65 + (i % 26))}${i}`, year: 2000 + i }));
    return J({ MediaContainer: { size: Math.min(size, all.length - start), totalSize: all.length, Metadata: all.slice(start, start + size) } });
  }
  if (p === '/library/sections/2/all') return J(md((u.searchParams.get('title') || '').toLowerCase().startsWith('paper') ? [SHOW] : []));
  if (p === '/library/onDeck') return J(md([MOVIE, EPS[2]]));
  if (p === '/library/metadata/100') return J(md([MOVIE]));
  if (p === '/library/metadata/200') return J(md([SHOW]));
  if (p === '/library/metadata/200/children') return J(md([{ ratingKey: '250', type: 'season', title: 'Season 1', index: 1, leafCount: 3, viewedLeafCount: 2 }]));
  if (p === '/library/metadata/250/children' || p === '/library/metadata/200/allLeaves') return J(md(EPS));
  if (/^\/library\/metadata\/30\d$/.test(p)) return J(md([EPS[Number(p.slice(-1)) - 1]]));
  if (p === '/photo/:/transcode') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#e5a00d"/></svg>'); }
  if (p === '/:/timeline' || p === '/:/scrobble') return J({});
  res.writeHead(404); res.end();
}).listen(32499, '127.0.0.1');

// ---- pretend plex.tv
let polls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'plex.tv') {
    const h = opts.headers || {};
    seen.push(`plex.tv ${opts.method || 'GET'} ${u.pathname} account-token=${h['X-Plex-Token'] ? 'yes' : 'no'} client=${h['X-Plex-Client-Identifier'] ? 'yes' : 'no'}`);
    const J = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/api/v2/pins' && opts.method === 'POST') return J({ id: 987, code: 'WXYZ', expiresIn: 900 });
    if (u.pathname === '/api/v2/pins/987') return J({ id: 987, code: 'WXYZ', authToken: ++polls >= 2 ? 'account-token-999999' : null });
    if (u.pathname === '/api/v2/user') return J({ username: 'hylianux', title: 'hylianux' });
    if (u.pathname === '/api/v2/resources') return J([
      { name: 'Media Box', provides: 'server', clientIdentifier: 'abc123machine', accessToken: SVR_TOKEN, owned: true,
        connections: [{ uri: 'http://10.255.255.1:32400', local: true, protocol: 'http' }, { uri: 'http://127.0.0.1:32499', local: false, protocol: 'http' }] },
      { name: 'My Phone', provides: 'client,player', clientIdentifier: 'phone1', connections: [] },
    ]);
    return new Response('', { status: 404 });
  }
  if (u.hostname === 'api.themoviedb.org') {
    const J = (o) => new Response(JSON.stringify(o));
    if (/^\/3\/(movie|tv)\/\d+$/.test(u.pathname)) return J({ id: 424242, title: 'Harbor Lights', overview: 'x', release_date: '2023-01-01', runtime: 100, genres: [], credits: { cast: [], crew: [] }, 'watch/providers': { results: {} } });
    return J({ results: [], page: 1, total_pages: 1 });
  }
  return realFetch(url, opts);
};
require(require('path').join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    await wait(2500);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
    LOG('start:', await js("tv.plexStart().then(r => JSON.stringify(r))"));
    LOG('wait:', await js("tv.plexWait().then(r => JSON.stringify(r))"));
    LOG('state:', await js("tv.plexState().then(r => JSON.stringify(r))"));
    const cfg = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
    LOG('saved servers:', JSON.stringify((cfg.plex.servers || []).map((s) => [s.id, s.url, s.enabled])));
    LOG('media servers:', await js("tv.mediaServers().then(r => JSON.stringify(r))"));
    LOG('find movie:', await js("tv.jfFind('movie', 424242, 'Harbor Lights', '2023').then(r => JSON.stringify(r))"));
    LOG('find show:', await js("tv.jfFind('tv', 515151, 'Paper Moons', '2022').then(r => JSON.stringify(r))"));
    LOG('home rows:', await js("tv.browseHome().then(r => JSON.stringify((r.ok.rows||[]).filter(x=>/Jump|Up next/.test(x.title)).map(x => x.title + ': ' + x.items.map(i => i.title + ' [' + i.serverName + '] ' + i.image).join(', '))))"));
    LOG('picture:', await js("fetch('jfimg://plex-abc123machine/Items/100/Images/Primary').then(r => r.status + ' ' + r.headers.get('content-type'))"));
    LOG('item:', await js("tv.jfItem('plex-abc123machine', '100').then(r => JSON.stringify(r))"));
    LOG('seasons:', await js("tv.jfSeasons('plex-abc123machine', '200').then(r => JSON.stringify(r))"));
    LOG('episodes:', await js("tv.jfEpisodes('plex-abc123machine', '200', '250').then(r => JSON.stringify(r.ok.map(e => e.name + ' ' + e.played)))"));
    LOG('next up:', await js("tv.jfNextUp('plex-abc123machine', '200').then(r => JSON.stringify(r.ok && r.ok.name))"));
    LOG('library:', await js("tv.browsePage({ source: 'jf-library', serverId: 'plex-abc123machine', type: 'movie' }, 1).then(r => r.ok.items.length + ' more ' + r.ok.more + ' first ' + r.ok.items[0].title)"));
    // The playback pieces, straight from the module.
    const { createPlex } = require(require('path').join(__dirname, '..', '..', 'plex.js'));
    const px = createPlex({ clientId: () => 'test-client', version: '0.1.0' });
    const server = { id: 'plex-abc123machine', type: 'plex', url: 'http://127.0.0.1:32499', token: SVR_TOKEN };
    LOG('playback:', JSON.stringify(await px.playbackInfo(server, '100')));
    LOG('segments:', JSON.stringify(await px.segments(server, '100')));
    await px.report(server, 'progress', { itemId: '100', seconds: 120, paused: false, duration: 6000000 });
    await px.report(server, 'stopped', { itemId: '100', seconds: 5700, duration: 6000000 });
    await wait(300);
    LOG('stream url:', px.streamUrl(server, '100', (await px.getItem(server, '100'))));
    const logText = fs.readdirSync(path.join(UD, 'logs')).map((f) => fs.readFileSync(path.join(UD, 'logs', f), 'utf8')).join('');
    LOG('log mentions tokens?', /srv-token-abcdef|account-token-999/.test(logText) ? 'YES (bad)' : 'no');
    LOG('log plex lines:', logText.split('\n').filter((l) => /plex/i.test(l)).slice(0, 6).join('\n   '));
    LOG('requests:\n  ' + seen.join('\n  '));
    LOG('toggle off:', await js("tv.plexToggle('plex-abc123machine').then(r => JSON.stringify(r.ok.servers))"));
    LOG('media servers after off:', await js("tv.mediaServers().then(r => r.ok.length)"));
    LOG('sign out:', await js("tv.plexSignOut().then(r => JSON.stringify(r.ok))"));
  } catch (e) { LOG('TEST ERROR', e.stack); }
  app.exit(0);
});
