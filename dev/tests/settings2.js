require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Big view on Home; row titles stay visible; title page cast & crew.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-set2');
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
const SHOTS = path.join(__dirname, 'out', 'shots-set2'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
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
  const where = () => js("(() => { const a=document.activeElement; const g=a.closest('.s-group'); return (a.dataset.group||a.dataset.sound||a.dataset.layout||a.dataset.theme||a.id||a.className) + (g ? ' [in ' + g.dataset.name + ']' : '') + ' tab=' + settingsTab; })()");
  await js('openSettings()'); await wait(800);
  console.log('open:', await where(), '| rails:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
  await key('Right'); // into Search section? (general tab, rail focused)
  console.log('right:', await where());
  // to Look tab
  await js("stepSettingsTab(1)"); await wait(400);
  console.log('look tab:', await where(), '| rails:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
  await shot('1-look-layout');
  // down the rail to Sounds
  for (let i = 0; i < 7; i++) await key('Down');
  console.log('rail down x7:', await where(), '| shown section:', await js('currentGroup().dataset.name'));
  await key('Right');
  console.log('into sounds:', await where());
  const top0 = await js("Math.round(currentGroup().querySelector('.group-title').getBoundingClientRect().top)");
  await key('Down', 9);
  console.log('after 9 downs:', await where(), '| heading stayed put:', top0 === await js("Math.round(currentGroup().querySelector('.group-title').getBoundingClientRect().top)"), '| list scrolled', await js("document.getElementById('s-sound-sets').scrollTop"), '| scrollbar shown', await js("document.getElementById('s-sound-sets').scrollHeight > document.getElementById('s-sound-sets').clientHeight"));
  await shot('2-sounds-scrolled');
  await key('Down', 6);
  console.log('to the bottom:', await where());
  await shot('3-sounds-bottom');
  // B: back to the rail, then out
  await js("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(300);
  console.log('B once:', await where(), '| screen', await js('screen'));
  await js("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(300);
  console.log('B twice: screen', await js('screen'));
  await js('openSettings()'); await wait(800);
  console.log('reopened at:', await where());
  // Live tab, Jellyfin tab rails
  for (const t of ['live', 'jellyfin', 'controller', 'apps', 'developer']) { await js(`setSettingsTab('${t}')`); await wait(250); console.log(` ${t}:`, await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ') || '(one section)'"), '|', await where()); }
  await js("setSettingsTab('live')"); await wait(300); await shot('4-live');
  await js("setSettingsTab('general')"); await wait(300); await shot('5-general');
  // focusing something in a hidden section from code
  await js("$('jf-add').focus()"); await wait(300);
  console.log('focus jf-add from code:', await where());
  app.exit(0);
});
