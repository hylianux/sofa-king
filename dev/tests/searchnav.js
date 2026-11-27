require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Big view on Home; row titles stay visible; title page cast & crew.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-searchnav');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true },
  colors: 'nord',
}));
// One of your own themes, and one that tries to load from the internet.
fs.mkdirSync(path.join(UD, 'themes/layouts/tall'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.json'), JSON.stringify({ name: 'Tall', description: 'Test', author: 'Sam', behavior: { rowKeys: 'up-down', bogus: 1 } }));
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.css'), "@import url(https://evil.example/x.css); body.layout-tall .row h2 { color: var(--accent); background: url(https://evil.example/p.png); }");
fs.mkdirSync(path.join(UD, 'themes/colors'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/colors/mint.json'), JSON.stringify({ name: 'Mint', author: 'Sam', colors: { bg: '#0f2a22', accent: '#5fffc0', text: 'red; } body { display:none' } }));
const SHOTS = path.join(__dirname, 'out', 'shots-searchnav'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
require('./mockjf').start();
let uid = 1000;
const titles = ['The Long Night', 'Harbor Lights', 'Paper Moons', 'Static', 'Golden Hour', 'North Line', 'Afterglow', 'Quiet Storm'];
const fake = (n, label) => Array.from({ length: n }, (_, i) => ({ id: ++uid, media_type: i % 2 ? 'tv' : 'movie', title: titles[i % 8], name: titles[i % 8], poster_path: `/p${uid}.jpg`, backdrop_path: `/b${uid}.jpg`, vote_average: 7.4, vote_count: 900, overview: `${titles[i % 8]}: a story about people and places, told over one long night in a city that never quite sleeps.`, release_date: '2023-05-01', first_air_date: '2022-01-01', popularity: 100 - i }));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  const p = u.pathname.replace('/3', '');
  const J = (o) => new Response(JSON.stringify(o));
  const m = /^\/(movie|tv)\/(\d+)$/.exec(p);
  if (m) return J({ id: +m[2], title: 'Arrival', name: 'Arrival', tagline: 'Why are they here?', overview: 'A linguist works with the military to communicate with alien lifeforms after twelve mysterious spacecraft appear around the world.', vote_average: 7.6, vote_count: 18000, release_date: '2016-11-11', runtime: 116, genres: [{ name: 'Drama' }, { name: 'Sci-Fi' }], backdrop_path: '/arr.jpg',
    credits: { crew: [{ id: 1, name: 'Denis Villeneuve', job: 'Director', profile_path: '/dv.jpg' }, { id: 2, name: 'Eric Heisserer', job: 'Screenplay', profile_path: null }],
      cast: [{ id: 3, name: 'Amy Adams', character: 'Louise Banks', profile_path: '/aa.jpg' }, { id: 4, name: 'Jeremy Renner', character: 'Ian Donnelly', profile_path: '/jr.jpg' }, { id: 5, name: 'Forest Whitaker', character: 'Colonel Weber', profile_path: '/fw.jpg' }] },
    'watch/providers': { results: { US: { flatrate: [{ provider_name: 'Paramount Plus' }], rent: [{ provider_name: 'Amazon Video' }] } } } });
  if (p.startsWith('/search')) return J({ results: fake(14, p), page: 1, total_pages: 1 });
  if (p.startsWith('/trending') || p.startsWith('/discover') || /recommendations/.test(p)) return J({ results: fake(14, p), page: 1, total_pages: 2 });
  return J({ results: [] });
};
require(require('path').join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));



app.whenReady().then(async () => {
  session.defaultSession.protocol.handle('https', async () => new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#3a5f8a"/></svg>`, { headers: { 'content-type': 'image/svg+xml' } }));
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(220); } };
  const shot = async (f) => fs.writeFileSync(path.join(SHOTS, f + '.png'), (await wc.capturePage()).toPNG());
  const where = () => js("(() => { const a = document.activeElement; return (a.closest('#osk') ? 'key ' + a.textContent.trim() : a.closest('#results') ? 'result ' + [...document.querySelectorAll('#results [data-nav]')].indexOf(a) : a.id || a.className); })()");
  const OUT = path.join(__dirname, 'out', 'searchnav.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
  await js('openSearch(); 0'); await wait(600);
  await js("type('the'); 0"); await wait(2500);
  say('results:', await js("document.querySelectorAll('#results [data-nav]').length"));
  await shot('1-results');
  const rows = await js("(() => { const keys = [...document.querySelectorAll('#osk .key')].filter(k => k.offsetParent); const tops = [...new Set(keys.map(k => k.offsetTop))]; return tops.length; })()");
  say('keyboard rows:', rows);
  for (let r = 0; r < rows; r++) {
    await js(`(() => { const keys = [...document.querySelectorAll('#osk .key')].filter(k => k.offsetParent); const tops = [...new Set(keys.map(k => k.offsetTop))]; const line = keys.filter(k => k.offsetTop === tops[${r}]); line[line.length - 1].focus(); })(); 0`);
    const from = await where();
    await key('Right');
    const to = await where();
    await key('Left');
    say(`row ${r + 1}: Right from "${from}" ->`, to, '| Left back ->', await where());
  }
  await shot('2-after');
  // Over to the results from the last row, then down through them: does it glide?
  const glide = async (label, boxId) => {
    const box = `document.getElementById('${boxId}')`;
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const before = await js(`${box}.scrollTop`);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
      await wait(90); const mid = await js(`${box}.scrollTop`);
      await wait(400); const after = await js(`${box}.scrollTop`);
      samples.push(`${Math.round(before)}→${Math.round(mid)}→${Math.round(after)}`);
    }
    const moving = samples.some((x) => { const [a, m, b] = x.split('→').map(Number); return b !== a && m !== b && m !== a; });
    say(`${label}: scroll before→partway→after:`, samples.join('  '), moving ? 'GLIDES' : 'JUMPS (or no scroll)');
  };
  await js(`(() => { const keys = [...document.querySelectorAll('#osk .key')].filter(k => k.offsetParent); const tops = [...new Set(keys.map(k => k.offsetTop))]; const line = keys.filter(k => k.offsetTop === tops[2]); line[line.length - 1].focus(); })(); 0`);
  await key('Right'); say('into results:', await where());
  await glide('search results', 'results');
  // A genre's list.
  await js("openMore({ title: 'Comedy', spec: { source: 'genre', genre: 'comedy', kind: 'all' } }, { eyebrow: 'Genre' }); 0"); await wait(2500);
  say('genre list cards:', await js("document.querySelectorAll('#more-grid .card').length"), '| focus', await js("document.activeElement.className"));
  await glide('genre list', 'more-grid');
  await shot('3-genre');
  // The Library (the pretend Jellyfin's films, with letter headings).
  await js("go('home'); setView('library'); 0"); await wait(3000);
  await js("showLibrary(true); 0"); await wait(2000);
  say('library cards:', await js("document.querySelectorAll('#lib-grid .card').length"), '| focus', await js("document.activeElement.className"));
  await glide('library', 'lib-grid');
  await shot('4-library');
  app.exit(0);
});
