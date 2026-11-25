require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
const LAYOUT = process.argv.find((a) => a.startsWith('--layout='));
// Big view on Home; row titles stay visible; title page cast & crew.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-lay2');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true },
  layout: LAYOUT ? LAYOUT.split('=')[1] : 'netflix',
}));
// One of your own themes, and one that tries to load from the internet.
fs.mkdirSync(path.join(UD, 'themes/layouts/tall'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.json'), JSON.stringify({ name: 'Tall', description: 'Test', author: 'Sam', behavior: { rowKeys: 'up-down', bogus: 1 } }));
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.css'), "@import url(https://evil.example/x.css); body.layout-tall .row h2 { color: var(--accent); background: url(https://evil.example/p.png); }");
fs.mkdirSync(path.join(UD, 'themes/colors'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/colors/mint.json'), JSON.stringify({ name: 'Mint', author: 'Sam', colors: { bg: '#0f2a22', accent: '#5fffc0', text: 'red; } body { display:none' } }));
const SHOTS = path.join(__dirname, 'out', 'shots-lay2'); fs.mkdirSync(SHOTS, { recursive: true });
require('./mockjf').start();
let uid = 1000;
const titles = ['The Long Night', 'Harbor Lights', 'Paper Moons', 'Static', 'Golden Hour', 'North Line', 'Afterglow', 'Quiet Storm'];
const fake = (n, label) => Array.from({ length: n }, (_, i) => ({ id: ++uid, media_type: i % 2 ? 'tv' : 'movie', title: titles[i % 8], name: titles[i % 8], poster_path: `/p${uid}.jpg`, backdrop_path: `/b${uid}.jpg`, vote_average: 7.4, vote_count: 900, overview: `${titles[i % 8]}: a story about people and places, told over one long night in a city that never quite sleeps. Along the way, old friends return, secrets surface, and nobody gets home before dawn — least of all the one person who promised they would.`, release_date: '2023-05-01', first_air_date: '2022-01-01', popularity: 100 - i }));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  await new Promise((r) => setTimeout(r, 2500));
  const p = u.pathname.replace('/3', '');
  const J = (o) => new Response(JSON.stringify(o));
  const m = /^\/(movie|tv)\/(\d+)$/.exec(p);
  if (m) return J({ id: +m[2], title: 'Arrival: The Extended Director\'s Cut With A Very Long Name', name: 'Arrival', tagline: 'Why are they here?', overview: 'A linguist works with the military to communicate with alien lifeforms after twelve mysterious spacecraft appear around the world.', vote_average: 7.6, vote_count: 18000, release_date: '2016-11-11', runtime: 116, genres: [{ name: 'Drama' }, { name: 'Sci-Fi' }], backdrop_path: '/arr.jpg',
    credits: { crew: [{ id: 1, name: 'Denis Villeneuve', job: 'Director', profile_path: '/dv.jpg' }, { id: 2, name: 'Eric Heisserer', job: 'Screenplay', profile_path: null }],
      cast: [{ id: 3, name: 'Amy Adams', character: 'Louise Banks', profile_path: '/aa.jpg' }, { id: 4, name: 'Jeremy Renner', character: 'Ian Donnelly', profile_path: '/jr.jpg' }, { id: 5, name: 'Forest Whitaker', character: 'Colonel Weber', profile_path: '/fw.jpg' }] },
    'watch/providers': { results: { US: { flatrate: [{ provider_name: 'Paramount Plus' }, { provider_name: 'Netflix' }, { provider_name: 'Hulu' }, { provider_name: 'Max' }], rent: [{ provider_name: 'Amazon Video' }, { provider_name: 'Apple TV' }] } } } });
  if (p.startsWith('/trending') || p.startsWith('/discover') || /recommendations/.test(p)) return J({ results: fake(14, p), page: 1, total_pages: 2 });
  return J({ results: [] });
};
require(require('path').join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STEP = (m) => fs.appendFileSync(path.join(__dirname, 'out', 'xmb-steps.txt'), `${Date.now() % 100000} ${m}\n`);
app.whenReady().then(async () => {
  STEP('ready');
  let n = 0;
  const hues = ['#3a5f8a', '#8a3a5f', '#5f8a3a', '#8a6a3a', '#3a8a7a'];
  session.defaultSession.protocol.handle('https', async (req) => {
    const u = new URL(req.url);
    const c = hues[(n++) % hues.length];
    const wide = /\/b|arr|w780|w1280/.test(u.pathname);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 1280 : 300}" height="${wide ? 720 : 450}"><rect width="100%" height="100%" fill="${c}"/><circle cx="70%" cy="40%" r="${wide ? 160 : 60}" fill="rgba(255,255,255,.35)"/></svg>`;
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
  });
  const L = LAYOUT ? LAYOUT.split('=')[1] : 'netflix';
  if (process.env.BEAT) { let n = 0; setInterval(() => process.stdout.write(`beat ${n++}\n`), 500); }
  if (process.env.PAUSE) {
    const w0 = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    w0.debugger.attach('1.3');
    w0.debugger.on('message', (_e, method, params) => {
      if (method === 'Debugger.paused') { console.log('PAUSED AT:\n' + params.callFrames.slice(0, 8).map((f) => `  ${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`).join('\n')); process.exit(0); }
    });
    await w0.debugger.sendCommand('Debugger.enable');
    setTimeout(() => w0.debugger.sendCommand('Debugger.pause').catch((e) => console.log('pause failed', e.message)), Number(process.env.PAUSE));
  }
  await wait(1800);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  STEP('got wc');
  const key = async (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); };
  const shot = async (f) => fs.writeFileSync(path.join(SHOTS, f + '.png'), (await wc.capturePage()).toPNG());
  console.log(L, 'while loading: skeleton cards', await js("document.querySelectorAll('.card.skeleton').length"), '| focus', await js("document.activeElement.className"), '| hero loading', await js("document.getElementById('hero').classList.contains('loading')"));
  STEP('loading logged'); await shot(L + '-0-loading'); STEP('shot0');
  await wait(5000);
  console.log(L, 'loaded: cards', await js("document.querySelectorAll('#rows .card:not(.skeleton)').length"), '| focus', await js("document.activeElement.className"));
  if (L === 'netflix') {
    await wait(800);
    console.log('hero fits: content bottom', await js("Math.round(document.getElementById('hero-chips').getBoundingClientRect().bottom)"), 'vs hero bottom', await js("Math.round(document.getElementById('hero').getBoundingClientRect().bottom)"));
  }
  if (L === 'big-posters') {
    for (let i = 0; i < 3; i++) await key('Down');
    console.log('focused row text fully visible:', await js("(() => { const c=document.activeElement; const sub=c.querySelector('.sub')||c; return Math.round(sub.getBoundingClientRect().bottom) + ' <= ' + Math.round(document.getElementById('rows').getBoundingClientRect().bottom); })()"));
  }
  if (L === 'grid') {
    console.log('grid rows:', await js("[...document.querySelectorAll('#rows .row-cards')].map(s => s.querySelectorAll('.card:not(.beyond)').length + ' shown').join(', ')"), '| back button visible', await js("[...document.querySelectorAll('.start-btn')].some(b=>b.offsetParent)"));
  }
  if (L === 'ps5') {
    await key('Down');
    console.log('ps5 hints:', await js("(() => { const r=document.querySelector('.row.active'); return [getComputedStyle(r,'::before').content, getComputedStyle(r.querySelector('h2'),'::after').content, getComputedStyle(r,'::after').content].join(' | '); })()"));
  }
  if (L === 'ps3-xmb') {
    await key('Right'); await js("document.querySelector('#rows .row.active .card').focus()"); await wait(400); await key('Down');
    console.log('xmb selected wide:', await js("document.activeElement.classList.contains('wide')"), await js("(() => { const p=document.activeElement.querySelector('.poster'); if (!p) return 'no picture'; const r=p.getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height); })()"));
  }
  await wait(900);
  // Everything on screen? The selected card (with its ring) and its name inside the rows' frame.
  if (L !== 'netflix' && L !== 'ps5') { await js("(document.querySelector('#rows .card')).focus()"); await wait(500); }
  console.log('  fit:', await js(`(() => {
    const box = document.getElementById('rows').getBoundingClientRect();
    const c = document.activeElement.closest('.card') || document.activeElement;
    const p = (c.querySelector('.poster') || c).getBoundingClientRect();
    const n = (c.querySelector('.name') || c).getBoundingClientRect();
    const rows = [...document.querySelectorAll('#rows .row')].filter(r => r.offsetParent).map(r => { const b = r.getBoundingClientRect(); return b.top >= box.top - 1 && b.bottom <= box.bottom + 1 ? 'whole' : (b.bottom <= box.top || b.top >= box.bottom) ? 'off' : 'PART'; });
    const hint = document.getElementById('row-hint-down').getBoundingClientRect();
    return 'card top ' + Math.round(p.top - 6 - box.top) + 'px inside, name bottom ' + Math.round(box.bottom - n.bottom) + 'px inside | rows ' + rows.join(',') + ' | hint below rows: ' + (hint.top >= box.bottom - 1);
  })()`));
  console.log('  debug:', await js("(() => { const r=document.getElementById('rows'); return 'rows h ' + r.style.height + ' client ' + r.clientHeight + ' scrollTop ' + r.scrollTop + ' | ' + [...r.querySelectorAll('.row')].map(x => x.offsetHeight + '@' + x.offsetTop).join(' ') + ' | ' + document.getElementById('fit-css').textContent.replace(/\\s+/g,' '); })()"));
  console.log('  hints:', await js("[...document.querySelectorAll('.row-hint')].map(h => h.hidden ? '-' : h.textContent).join('  /  ')"));
  await shot(L + '-1-loaded');
  app.exit(0);
});
