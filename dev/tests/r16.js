require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
const LAYOUT = process.argv.find((a) => a.startsWith('--layout='));
// Big view on Home; row titles stay visible; title page cast & crew.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-r16');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  jellyfinServers: [{ id: 'srv-living-room', name: 'Living Room', url: 'http://localhost:8096', userId: 'user-1', userName: 'hylianux', token: 'tok-123' }],
  live: { iptvOrgAsked: true },
  layout: LAYOUT && !['--layout=detail','--layout=netflix2','--layout=xmb','--layout=xmb2'].includes(LAYOUT) ? LAYOUT.split('=')[1] : (/xmb/.test(LAYOUT || '') ? 'ps3-xmb' : 'netflix'),
}));
// One of your own themes, and one that tries to load from the internet.
fs.mkdirSync(path.join(UD, 'themes/layouts/tall'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.json'), JSON.stringify({ name: 'Tall', description: 'Test', author: 'Sam', behavior: { rowKeys: 'up-down', bogus: 1 } }));
fs.writeFileSync(path.join(UD, 'themes/layouts/tall/layout.css'), "@import url(https://evil.example/x.css); body.layout-tall .row h2 { color: var(--accent); background: url(https://evil.example/p.png); }");
fs.mkdirSync(path.join(UD, 'themes/colors'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/colors/mint.json'), JSON.stringify({ name: 'Mint', author: 'Sam', colors: { bg: '#0f2a22', accent: '#5fffc0', text: 'red; } body { display:none' } }));
const SHOTS = path.join(__dirname, 'out', 'shots-r16'); fs.mkdirSync(SHOTS, { recursive: true });
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

  const E = (c) => js(c).catch((e) => 'ERR ' + e.message);
  if (L === 'netflix') {
    await wait(6000);
    console.log('row sizes', await E("[...document.querySelectorAll('#rows .row')].map(r=>r.querySelectorAll('.card').length).join(',')"));
    await key('Down'); await key('Down'); await wait(600);
    const heroH = async () => E("Math.round(document.getElementById('hero').getBoundingClientRect().height) + '/' + Math.round(document.getElementById('rows').getBoundingClientRect().top)");
    const front = () => E("(() => { const a=document.activeElement; const s=a.closest('.row-cards'); const cs=[...s.querySelectorAll('.card')]; return cs.slice(0,4).map(c=>c.querySelector('.name').textContent.slice(0,6)).join('|')+' idx'+cs.indexOf(a)+' '+(a.querySelector('.name')||a).textContent.trim().slice(0,12)+'#'+cs.length+' left'+Math.round(a.getBoundingClientRect().left - s.getBoundingClientRect().left); })()");
    const ids0='';
    console.log('start', await front(), 'hero', await heroH());
    const rk = async (k, tag) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(90); await shot('roll-'+tag+'-a'); await wait(110); await shot('roll-'+tag+'-b'); await wait(400); await shot('roll-'+tag+'-c'); };
    await rk('Right', 'fwd'); await rk('Left', 'back');
    console.log('ghosts left', await E("document.querySelectorAll('.ghost').length"));
    const sizes = new Set();
    for (let i = 0; i < 16; i++) { await key('Right'); await wait(150); const h=await heroH(); if(!sizes.has(h)) console.log('  new size at', i, h, await E("['hero-row','hero-title','hero-meta','hero-overview','hero-chips'].map(i=>{const e=document.getElementById(i);return e? i+':'+Math.round(e.getBoundingClientRect().height):''}).join(' ')")); sizes.add(h); if(i<6) console.log('  ', i, await front()); }
    console.log('after 16 rights', await front(), '| hero/rows sizes seen', [...sizes].join(' '));
    console.log('hero parts', await E("['hero-row','hero-title','hero-meta','hero-overview','hero-chips'].map(i=>{const e=document.getElementById(i);return e? i+':'+Math.round(e.getBoundingClientRect().height):''}).join(' ')"));
    await key('Left'); console.log('after left', await front());
    await key('Up'); console.log('Up -> ', await E("document.activeElement.className + ' ' + document.activeElement.textContent.trim()"));
    console.log('More pos', await E("(() => { const m=document.activeElement.getBoundingClientRect(); const h=document.activeElement.closest('.row').querySelector('h2').getBoundingClientRect(); return 'more top '+Math.round(m.top)+' right '+Math.round(m.right)+' | h2 top '+Math.round(h.top)+' | win '+innerWidth; })()"));
    await shot('netflix-more');
    await key('Down'); console.log('Down from More ->', await front());
  }
  if (L === 'detail') {
    await wait(5000);
    await key('Down'); await key('Down'); await key('Right'); await key('Right'); await key('Right'); await wait(300);
    console.log('hero while looking up:', await E("document.getElementById('hero-meta').innerHTML.includes('skeleton') + ' chips ' + document.querySelectorAll('#hero-chips .skeleton-line').length"));
    await shot('hero-loading');
    await wait(3500);
    console.log('hero after:', await E("document.getElementById('hero-chips').textContent + ' | skel ' + document.querySelectorAll('#hero-chips .skeleton-line').length"));
    await shot('hero-loaded');
    await key('Right'); await js('document.activeElement.click(); 0'); await wait(500);
    console.log('detail loading:', await E("[...document.querySelectorAll('#screen-detail .skeleton-line')].filter(x=>x.offsetParent).length + ' focus ' + document.activeElement.textContent"));
    await shot('detail-loading');
    await wait(4000);
    console.log('detail loaded:', await E("[...document.querySelectorAll('#d-watch > *')].map(b=>b.textContent.trim()).join(' / ') + ' | yt ' + document.getElementById('d-yt').hidden + ' ' + document.getElementById('d-yt-row').textContent + ' | meta ' + document.getElementById('d-meta').textContent + ' | focus ' + document.activeElement.textContent"));
    await shot('detail-loaded');
  }
  if (L === 'rows' || L === 'netflix2' || L === 'xmb') {
    await wait(5000);
    const st = () => E("(() => { const r=document.getElementById('rows'); return 'top '+Math.round(r.scrollTop)+' ghosts '+r.querySelectorAll('.row.ghost').length+' focus '+(document.activeElement.closest('.row')||{}).dataset?.title; })()");
    const go = async (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); const a=[]; for (const ms of [40, 80, 120, 300]) { await wait(ms === 40 ? 40 : 40); a.push(await st()); } await wait(250); a.push(await st()); return a.join(' | '); };
    await js("document.querySelector('#rows .row .card').focus(); 0"); await wait(400);
    console.log('down:', await go('Down'));
    console.log('geo:', await E("(() => { const box=document.getElementById('rows'); const row=document.activeElement.closest('.row'); const h=row.querySelector('h2'); const f=(r)=>Math.round(r.top)+'-'+Math.round(r.bottom); return 'box '+f(box.getBoundingClientRect())+' row '+f(row.getBoundingClientRect())+' h2 '+f(h.getBoundingClientRect())+' h2 disp '+getComputedStyle(h).display+' vis '+getComputedStyle(h).visibility+' op '+getComputedStyle(h).opacity+' color '+getComputedStyle(h).color+' st '+box.scrollTop+' first child '+row.firstElementChild.tagName+' '+row.firstElementChild.className; })()"));
    await shot(L + '-after-down');
    console.log('down:', await go('Down'));
    console.log('up:', await go('Up'));
    // mash
    for (let i = 0; i < 6; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(30); }
    await wait(500);
    console.log('after mash:', await st());
  }
  if (L === 'xmb2') {
    await wait(5000);
    await js("document.querySelector('#rows .row .card').focus(); 0"); await wait(300);
    for (let i = 0; i < 3; i++) { await key('Right'); await wait(300); }
    const st = () => E("(() => { const s=document.activeElement.closest('.row-cards'); return s ? Math.round(s.scrollTop)+' '+(document.activeElement.querySelector('.name')||{}).textContent+' @'+Math.round(document.activeElement.getBoundingClientRect().top) : 'none'; })()");
    console.log('section:', await E("document.querySelector('.row.active').dataset.title"), await st());
    for (let n = 0; n < 14; n++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); const a=[]; for (let k=0;k<5;k++){ await wait(50); a.push(await st()); } console.log('down', n, a.join(' | ')); }
    console.log('xmb dbg:', await E("(() => { const s=document.activeElement.closest('.row-cards'); return 'client '+s.clientHeight+' scrollH '+s.scrollHeight+' top '+s.scrollTop+' padB '+s.style.paddingBottom+' cs '+getComputedStyle(s).paddingBottom+' item '+document.activeElement.offsetHeight+' rowend '+(s.querySelector('.row-end')||{}).offsetHeight+' focus '+document.activeElement.className+' after '+getComputedStyle(s,'::after').height+' var '+s.style.getPropertyValue('--list-tail')+' last '+s.lastElementChild.className+' endBottom '+Math.round(s.querySelector('.row-end').offsetTop+s.querySelector('.row-end').offsetHeight)+' disp '+getComputedStyle(s).display; })()"));
    console.log('xmb dbg2:', await E("(() => { const s=document.activeElement.closest('.row-cards'); const it=document.activeElement.closest('.row-end'); const t=it.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop; const kids=[...s.children].map(k=>k.className.split(' ')[0]+':'+Math.round(k.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop)+'+'+k.offsetHeight); return 'itemTop '+Math.round(t)+' h '+it.offsetHeight+' scrollH '+s.scrollHeight+' max '+(s.scrollHeight-s.clientHeight)+' kids '+kids.slice(-3).join(' ')+' rowH '+s.closest('.row').offsetHeight+' sH '+s.offsetHeight+' rowscroll '+s.closest('.row').scrollTop+' rowsTop '+document.getElementById('rows').scrollTop; })()"));
    await js("(() => { const s=document.activeElement.closest('.row-cards'); window.__sc=[]; s.addEventListener('scroll', () => __sc.push(Math.round(s.scrollTop)+'@'+Math.round(performance.now()))); })(); 0");
    await key('Up'); await wait(400); await key('Down'); await wait(500);
    console.log('scroll trace:', await E("__sc.join(' ')"));
    console.log('hero-row shown?', await E("getComputedStyle(document.getElementById('hero-row')).display"));
    await shot('xmb-list');
  }
  if (L === 'grid') {
    await js("(() => { const rs=[...document.querySelectorAll('#rows .row')].filter(r=>r.querySelectorAll('.card').length>=9); rs[0].querySelector('.card').focus(); })(); 0"); await wait(500);
    console.log('grid dbg:', await E("(() => { const r=document.getElementById('rows'); const strip=[...r.querySelectorAll('.row-cards')][2]; const row=strip.closest('.row'); const cs=getComputedStyle(strip); return 'rows h '+r.clientHeight+' row '+row.offsetHeight+' strip '+strip.offsetHeight+' card '+strip.querySelector('.card').offsetHeight+' pad '+cs.paddingTop+' gap '+cs.rowGap+' cols '+cs.gridTemplateColumns; })()"));
    console.log('grid:', await E("[...document.querySelectorAll('#rows .row-cards')].slice(0,3).map(s => s.querySelectorAll('.card:not(.beyond)').length + '+' + (s.querySelector('.row-end') ? 'More' : 'none')).join(', ')"));
    const where = () => E("(() => { const a=document.activeElement; const r=a.getBoundingClientRect(); return (a.className.split(' ')[0]) + ' @' + Math.round(r.left) + ',' + Math.round(r.top) + ' visible ' + (r.right <= innerWidth && r.left >= 0); })()");
    for (let i = 0; i < 10; i++) { await key('Right'); }
    console.log('after 10 rights', await where());
    await shot('grid-more');
  }
  if (L === 'ps5') {
    await key('Down'); await wait(500);
    console.log('ps5 boxes:', await E("['rows','hero','hero-title','hero-meta','hero-overview','hero-chips','row-hint-down'].map(i=>{const r=document.getElementById(i).getBoundingClientRect();return i+' '+Math.round(r.top)+'-'+Math.round(r.bottom)}).join(' | ') + ' | rows style ' + document.getElementById('rows').style.cssText + ' | view ' + Math.round(document.getElementById('view-home').getBoundingClientRect().bottom) + ' | hints ' + Math.round(document.querySelector('#screen-home > .hints, #screen-home footer')?.getBoundingClientRect().top)"));
    console.log('ps5 overlap:', await E("(() => { const a=document.activeElement; const r=a.closest('.row'); const h=r.querySelector('h2').getBoundingClientRect(); const p=(a.querySelector('.poster')||a).getBoundingClientRect(); return 'h2 bottom '+Math.round(h.bottom)+' card top '+Math.round(p.top) + ' gap ' + Math.round(p.top-h.bottom); })()"));
    console.log('ps5 on top of card:', await E("(() => { const p=document.activeElement.querySelector('.poster').getBoundingClientRect(); const e=document.elementFromPoint(p.left+p.width/2, p.top+p.height/2); return e.id || e.className; })()"));
    await shot('ps5');
  }
  app.exit(0);
});
