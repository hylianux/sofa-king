require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Walks every screen: for each thing you can select, presses all four directions and checks that
// left / right never move up or down, and that everything can be reached from the screen's start.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const LAYOUT = (process.argv.find((a) => a.startsWith('--layout=')) || '--layout=netflix').split('=')[1];
const UD = path.join(__dirname, 'out', 'userdata-navaudit');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true }, layout: LAYOUT,
}));
const OUT = path.join(__dirname, 'out', `navaudit-${LAYOUT}.txt`); fs.writeFileSync(OUT, '');
const LOG = (...a) => { fs.appendFileSync(OUT, a.join(' ') + '\n'); };
require('./mockjf').start();
let uid = 1000;
const titles = ['The Long Night', 'Harbor Lights', 'Paper Moons', 'Static', 'Golden Hour', 'North Line', 'Afterglow', 'Quiet Storm'];
const fake = (n) => Array.from({ length: n }, (_, i) => ({ id: ++uid, media_type: i % 2 ? 'tv' : 'movie', title: titles[i % 8], name: titles[i % 8], poster_path: `/p${uid}.jpg`, backdrop_path: `/b${uid}.jpg`, vote_average: 7.4, vote_count: 900, overview: 'x', release_date: '2023-05-01', first_air_date: '2022-01-01', popularity: 100 - i, profile_path: null, known_for_department: 'Acting' }));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  const p = u.pathname.replace('/3', '');
  const J = (o) => new Response(JSON.stringify(o));
  const m = /^\/(movie|tv)\/(\d+)$/.exec(p);
  if (m) return J({ id: +m[2], title: 'Arrival', tagline: 'Why are they here?', overview: 'A linguist works with the military.', vote_average: 7.6, vote_count: 18000, release_date: '2016-11-11', runtime: 116, genres: [{ id: 18, name: 'Drama' }], backdrop_path: '/arr.jpg',
    credits: { crew: [{ id: 1, name: 'Denis Villeneuve', job: 'Director' }], cast: [{ id: 3, name: 'Amy Adams', character: 'Louise' }, { id: 4, name: 'Jeremy Renner', character: 'Ian' }] },
    'watch/providers': { results: { US: { flatrate: [{ provider_name: 'Netflix' }, { provider_name: 'Hulu' }, { provider_name: 'Max' }, { provider_name: 'Paramount Plus' }], rent: [{ provider_name: 'Amazon Video' }, { provider_name: 'Apple TV' }] } } } });
  if (/genre\/(movie|tv)\/list/.test(p)) return J({ genres: [{ id: 28, name: 'Action' }, { id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Science Fiction' }] });
  if (p.startsWith('/trending') || p.startsWith('/discover') || p.startsWith('/search') || /recommendations/.test(p)) return J({ results: fake(14), page: 1, total_pages: 2 });
  return J({ results: [] });
};
require(require('path').join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// In the page: press each direction from each item (as real key events, so every handler runs).
const AUDIT = `(async (scopeSel, name) => {
  const scope = document.querySelector(scopeSel) || document.body;
  const vis = (x) => x.offsetParent && !x.disabled && x.getBoundingClientRect().width > 0;
  const items = () => [...scope.querySelectorAll('[data-nav]')].filter(vis);
  const label = (x) => { if (!x) return 'nothing'; const t = (x.id || x.dataset.group || x.dataset.view || x.dataset.tab || (x.textContent || '').trim().slice(0, 22) || x.className); return t.replace(/\\s+/g, ' '); };
  const press = (key) => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); t.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); };
  const list = items();
  const bad = [];
  const edges = new Map();
  for (const el of list) {
    if (!vis(el)) continue;
    const out = {};
    for (const [key, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down']]) {
      el.focus({ preventScroll: false });
      if (document.activeElement !== el) continue;
      const a = el.getBoundingClientRect();
      press(key);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = document.activeElement;
      out[dir] = b;
      const a2 = el.getBoundingClientRect(); // (where it is now: the page may have scrolled)
      if (b && b !== el && (dir === 'left' || dir === 'right')) {
        const r = b.getBoundingClientRect();
        const overlap = r.top < a2.bottom - 1 && r.bottom > a2.top + 1;
        const toMenu = (dir === 'left' && b.closest('[data-zone="column"]') && !el.closest('[data-zone="column"]')) || (dir === 'right' && el.closest('[data-zone="column"]') && !b.closest('[data-zone="column"]'));
        if (!overlap && !toMenu) bad.push(dir + ' from "' + label(el) + '" went ' + (r.top > a2.top ? 'DOWN' : 'UP') + ' to "' + label(b) + '"');
      }
      if (b && b !== el && !scope.contains(b)) out[dir + 'Out'] = true;
    }
    edges.set(el, out);
  }
  // Can everything be reached from the first item (moving around inside this screen)?
  const seen = new Set([list[0]]);
  const queue = [list[0]];
  while (queue.length) { const x = queue.shift(); for (const d of ['left', 'right', 'up', 'down']) { const y = (edges.get(x) || {})[d]; if (y && list.includes(y) && !seen.has(y)) { seen.add(y); queue.push(y); } } }
  const unreachable = list.filter((x) => !seen.has(x) && vis(x)).map(label);
  return name + ': ' + list.length + ' items | sideways up/down: ' + (bad.length ? '\\n    ' + [...new Set(bad)].join('\\n    ') : 'none') + (unreachable.length ? '\\n  UNREACHABLE from "' + label(list[0]) + '": ' + unreachable.slice(0, 12).join(', ') + (unreachable.length > 12 ? ' …' : '') : '');
})`;

app.whenReady().then(async () => {
  try {
    session.defaultSession.protocol.handle('https', async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#456"/></svg>', { headers: { 'content-type': 'image/svg+xml' } }));
    await wait(2500);
    // (A slow start: wait for the window, up to 20 seconds.)
    for (let i = 0; i < 70 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(1500);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
    const audit = async (scope, name) => LOG(await js(`${AUDIT}(${JSON.stringify(scope)}, ${JSON.stringify(name)})`));
    await wait(3000);
    // Home and its tabs
    await js("setView('home'); 0"); await wait(800);
    await audit('#screen-home', `Home (${LAYOUT})`);
    for (const v of ['live', 'music', 'genres', 'library']) { await js(`setView('${v}'); 0`); await wait(1500); await audit('#screen-home', `Home → ${v}`); }
    if (LAYOUT !== 'netflix') { LOG('(other screens checked with the netflix layout)'); app.exit(0); return; }
    // Search
    await js("setView('home'); openSearch(); 0"); await wait(800);
    await audit('#screen-search', 'Search');
    await js("setQuery('har'); 0"); await wait(2000);
    await audit('#screen-search', 'Search with results');
    // A title's page
    await js("go('home'); setView('home'); 0"); await wait(500);
    await js("openDetail({ kind: 'movie', id: 329865, title: 'Arrival' }); 0"); await wait(2500);
    await audit('#screen-detail', 'Title page');
    // Music (the real catalogue: needs the internet): search, an artist's page, an album's page
    await js("go('home'); setView('home'); openSearch({ music: true }); setQuery('nirvana'); 0"); await wait(5000);
    await audit('#screen-search', 'Music search with results');
    await js("go('home'); openArtist({ kind: 'artist', name: 'Nirvana' }); 0"); await wait(20000);
    await audit('#screen-artist', 'Artist page');
    await js("go('home'); openAlbum({ kind: 'album', title: 'Nevermind', artist: 'Nirvana' }); 0"); await wait(8000);
    await audit('#screen-album', 'Album page');
    // A playlist page (ListenBrainz's weekly one for a public user).
    const pls = await js("tv.musicListenBrainz('rob').then(() => tv.musicMadeFor())");
    if (pls.ok && pls.ok.length) {
      await js(`go('home'); openPlaylist(${JSON.stringify(pls.ok[0])}); 0`); await wait(12000);
      await audit('#screen-playlist', 'Playlist page');
    }
    await js("go('home'); openRadio('popular'); 0"); await wait(6000);
    await audit('#screen-radio', 'Radio');
    // More (a whole list), all genres, episodes, iptv-org picker, setup
    await js("go('home'); setView('home'); 0"); await wait(400);
    await js("openMore({ title: 'Trending this week', items: [], more: true, spec: { source: 'trending', kind: 'all' } }); 0"); await wait(2000);
    await audit('#screen-more', 'More');
    await js("go('home'); openAllGenres(); 0"); await wait(1500);
    await audit('#screen-allgenres', 'All genres');
    await js("go('home'); openEpisodes({ serverId: 'srv-living-room', serverName: 'Living Room', itemId: 'series-sev', name: 'Severance' }); 0"); await wait(2000);
    await audit('#screen-episodes', 'Episodes');
    await js("go('home'); openIptvPicker('countries'); 0"); await wait(2500);
    await audit('#screen-iptv', 'iptv-org picker');
    await js("go('home'); openSetup('live'); 0"); await wait(1500);
    await audit('#screen-setup', 'Setup');
    // Settings: every tab, every section
    await js("go('home'); openSettings(); 0"); await wait(1000);
    const tabs = JSON.parse(await js("JSON.stringify(SETTINGS_TABS.map(t => t.id))"));
    for (const t of tabs) {
      await js(`setSettingsTab('${t}', { focus: false }); 0`); await wait(300);
      const groups = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.s-panel[data-tab="${t}"] .s-group')].map(g => g.dataset.name))`));
      for (const g of groups) {
        await js(`(() => { const g=[...document.querySelectorAll('.s-panel[data-tab="${t}"] .s-group')].find(x => x.dataset.name === ${JSON.stringify(g)}); showSettingsGroup(g); })(); 0`); await wait(250);
        await audit(`.s-panel[data-tab="${t}"]`, `Settings → ${t} → ${g}`);
      }
    }
  } catch (e) { LOG('TEST ERROR', e.stack); }
  app.exit(0);
});
