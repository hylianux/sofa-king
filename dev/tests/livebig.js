require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
const path = require('path'); const fs = require('fs'); const http = require('http');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-livebig');
const second = process.argv.includes('--again');
if (!second) { fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true }); }
app.setPath('userData', UD);
const N = 3000; const now = Date.now();
let version = second && process.argv.includes('--changed') ? 2 : 1;
const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
function lists() {
  let m3u = '#EXTM3U\n';
  for (let i = 0; i < N; i++) m3u += `#EXTINF:-1 tvg-id="ch${i}" group-title="G${i % 20}",Channel ${i}\nhttp://127.0.0.1:5599/s/${i}.m3u8\n`;
  let xml = '<?xml version="1.0"?><tv>';
  for (let i = 0; i < N; i++) xml += `<channel id="ch${i}"><display-name>Channel ${i}</display-name></channel>`;
  const base = now - (now % 1800000);
  for (let i = 0; i < N; i++) for (let h = -2; h < 30; h++) { const s = base + h * 1800000; xml += `<programme start="${fmt(s)}" stop="${fmt(s + 1800000)}" channel="ch${i}"><title>Show ${h} on ${i} v${version}</title><desc>A description of the programme, a sentence or two long.</desc></programme>`; }
  return { m3u, xml: xml + '</tv>' };
}
const L = lists();
const server = http.createServer((req, res) => {
  setTimeout(() => {
    if (req.url === '/list.m3u') return res.end(L.m3u);
    if (req.url === '/guide.xml') return res.end(L.xml);
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\n');
  }, req.url.startsWith('/s/') ? 5 : 1500); // the list and guide take a moment, like over a network
}).listen(5599);
if (!second) fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true, lists: [{ id: 'big', name: 'Big list', m3u: 'http://127.0.0.1:5599/list.m3u', guide: 'http://127.0.0.1:5599/guide.xml' }] } }));
require(require('path').join(__dirname, '..', '..', 'main.js'));
// main-thread stalls
{ let last = Date.now(); global.__mainLong = []; setInterval(() => { const n = Date.now(); if (n - last > 120) __mainLong.push((n - last) + 'ms@' + (n % 100000)); last = n; }, 50); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(2500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  // Measure how long a simple round trip to the app takes, every 50 ms, while the Live tab loads.
  await js(`window.__lat = []; window.__ping = setInterval(() => { const t = performance.now(); tv.settings().then(() => __lat.push(performance.now() - t)); }, 50);
    window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) __long.push(Math.round(e.duration) + 'ms@' + Math.round(e.startTime)); }).observe({ type: 'longtask', buffered: true }); window.__jank = 0; let last = performance.now(); (function f(t) { if (t - last > window.__jank) window.__jank = t - last; last = t; requestAnimationFrame(f); })(performance.now());`);
  const t0 = Date.now();
  await js("setView('live')");
  await wait(300);
  console.log(second ? 'AGAIN' : 'FIRST', '| after 0.3 s: loading shown', await js("!document.getElementById('live-loading').hidden"), '| rows', await js("document.querySelectorAll('.live-row').length"), '| meta', await js("document.getElementById('live-meta').textContent"));
  let drawn = 0;
  for (let i = 0; i < 80; i++) { await wait(250); drawn = await js("document.querySelectorAll('.live-row').length"); if (drawn >= N && !(await js('live.state && live.state.refreshing'))) break; }
  const st = await js('({ refreshing: live.state.refreshing, n: live.state.channels.length, draws: live.drawSeq, sig: (live.sig||"").length })');
  const lat = await js('__lat'); const jank = await js('__jank');
  lat.sort((a, b) => a - b);
  console.log(`done after ${((Date.now() - t0) / 1000).toFixed(1)} s: rows ${drawn}, channels ${st.n}, guide drawn ${st.draws} time(s) | app round trip: median ${lat[lat.length >> 1].toFixed(0)} ms, worst ${lat[lat.length - 1].toFixed(0)} ms | worst frame gap in the page ${jank.toFixed(0)} ms`);
  console.log('main stalls:', __mainLong.join(' '));
  console.log('page long tasks:', (await js('__long')).join(' '));
  console.log('now on first channel:', await js("document.querySelector('.live-row .on b') && document.querySelector('.live-row .on b').textContent"));
  // moving around stays quick
  await js("document.querySelector('.live-ch').focus()");
  const tk = Date.now(); for (let i = 0; i < 10; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(30); }
  await wait(200);
  console.log('10 presses down ->', await js("document.activeElement.closest('.live-row').dataset.id"), `(${Date.now() - tk} ms)`);
  // Flicking through the tabs (like mashing R1 / L1): nothing should hold it up.
  await js("setView('home'); 0"); await wait(800);
  await js("window.__long = []; window.__jank = 0; 0");
  const order = ['live', 'genres', 'library', 'home', 'live', 'genres', 'live', 'home', 'live', 'library', 'live', 'home'];
  const tm = Date.now();
  for (const v of order) { await js(`setView('${v}'); 0`); await wait(70); }
  const mashMs = Date.now() - tm;
  await wait(1500);
  console.log(`mashing ${order.length} tab changes took ${mashMs} ms (${order.length * 70} ms of waiting) | worst frame gap ${(await js('__jank')).toFixed(0)} ms | long tasks: ${(await js('__long')).join(' ') || 'none'}`);
  console.log('timings:', await js(`(() => { const out = []; for (const v of ['home','live','genres','live','library','home','live']) { const t = performance.now(); setView(v); document.body.offsetHeight; getComputedStyle(document.activeElement).color; out.push(v + ' ' + (performance.now() - t).toFixed(1)); } return out.join(', '); })()`));
  await js("setView('live'); 0"); await wait(900);
  console.log('back on Live: focus', await js("document.activeElement.className"), '| rows', await js("document.querySelectorAll('.live-row').length"));
  const log = fs.readFileSync(path.join(UD, 'logs/sofa-king.log'), 'utf8').split('\n').filter((l) => /\[live\]/.test(l)).slice(-4).map((l) => l.slice(30)).join('\n  ');
  console.log('log:\n  ' + log);
  server.close();
  app.exit(0);
});
