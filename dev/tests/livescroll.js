require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Scrolling a big guide while the app checks which channels work (as on the owner's TV: about
// 3,500 channels). Records every stall in the page and in the app, and whether every press moved.
// All pretend: a local channel list where some channels are broken. Nothing real is played.
const path = require('path'); const fs = require('fs'); const http = require('http');
const { app, BaseWindow, ipcMain } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-livescroll');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
const OUT = path.join(__dirname, 'out', 'livescroll.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
const N = 3500; const now = Date.now();
const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
// (--slow: the page runs 4 times slower, like a small computer. The guide changes partway, as when
// a refresh brings the next hours.)
const SLOW = process.argv.includes('--slow');
let version = 1;
let m3u = '#EXTM3U\n'; let xml = '';
const guide = () => { let x = '<?xml version="1.0"?><tv>';
  for (let i = 0; i < N; i++) x += `<channel id="ch${i}"><display-name>Channel ${i}</display-name></channel>`;
  for (let i = 0; i < N; i++) for (let h = -2; h < 24; h++) { const s = base + h * 1800000; x += `<programme start="${fmt(s)}" stop="${fmt(s + 1800000)}" channel="ch${i}"><title>Show ${h} on ${i} v${version}</title><desc>A description of the programme, a sentence or two long.</desc></programme>`; }
  return x + '</tv>'; };
for (let i = 0; i < N; i++) m3u += `#EXTINF:-1 tvg-id="ch${i}" group-title="G${i % 25}",Channel ${i}\nhttp://127.0.0.1:5602/s/${i}.m3u8\n`;
const base = now - (now % 1800000);
xml = guide();
version = 2; const xml2 = guide(); version = 1; // (made now: making it later held the app up itself)
http.createServer((req, res) => {
  if (req.url === '/list.m3u') return res.end(m3u);
  if (req.url === '/guide.xml') return res.end(xml);
  const i = Number((/\/s\/(\d+)/.exec(req.url) || [])[1]);
  // About one in six doesn't work (so the check keeps hiding channels while you scroll).
  setTimeout(() => { if (i % 6 === 5) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n'); } }, 20);
}).listen(5602);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true, hideBroken: true, lists: [{ id: 'big', name: 'Big list', m3u: 'http://127.0.0.1:5602/list.m3u', guide: 'http://127.0.0.1:5602/guide.xml' }] } }));
let last = Date.now(); const mainGaps = [];
setInterval(() => { const n = Date.now(); if (n - last > 120) mainGaps.push([n, n - last]); last = n; }, 20);
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(3000);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  if (SLOW) { wc.debugger.attach('1.3'); await wc.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  const t0 = Date.now(); const rel = (t) => `${((t - t0) / 1000).toFixed(1)}s`;
  await js(`window.__gaps = []; window.__renders = []; window.__changed = 0; window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) __long.push([Date.now() - (performance.now() - e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask' });
    { let lastF = performance.now(); const tick = (t) => { if (t - lastF > 100) __gaps.push([Date.now(), Math.round(t - lastF)]); lastF = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    { const orig = renderLive; renderLive = function (...a) { const t = performance.now(); const r = orig.apply(this, a); __renders.push([Date.now(), Math.round(performance.now() - t)]); return r; }; }
    tv.onLiveChanged(() => { __changed++; });
    setView('live'); 0`);
  for (let i = 0; i < 120 && (await js("document.querySelectorAll('#live-list .live-row').length")) < 100; i++) await wait(500);
  say('guide up after', rel(Date.now()));
  await js("document.querySelector('#live-list .live-ch').focus(); 0");
  const press = (a) => ipcMain.emit('pad', { sender: wc }, a);
  const row = () => js("(() => { const r = document.activeElement.closest('#live-list .live-row'); return r ? [...document.querySelectorAll('#live-list .live-row')].indexOf(r) : 'not in the guide: ' + (document.activeElement.textContent || '').slice(0, 30); })()");
  // (--profile: where the time goes over 20 presses, then stop.)
  if (process.argv.includes('--profile')) {
    await wait(15000); // (after the first checks settle)
    if (!SLOW) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Profiler.enable'); await wc.debugger.sendCommand('Profiler.start');
    const events = [];
    wc.debugger.on('message', (_e, method, params) => { if (method === 'Tracing.dataCollected') events.push(...params.value); });
    const traced = new Promise((r) => wc.debugger.on('message', (_e, method) => { if (method === 'Tracing.tracingComplete') r(); }));
    await wc.debugger.sendCommand('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    for (let i = 0; i < 20; i++) { press('down'); await wait(300); }
    const { profile } = await wc.debugger.sendCommand('Profiler.stop');
    await wc.debugger.sendCommand('Tracing.end'); await traced;
    const sum = new Map(); const extra = new Map();
    for (const e of events) if (e.ph === 'X' && e.dur) { sum.set(e.name, (sum.get(e.name) || 0) + e.dur);
      const d = e.args && (e.args.elementCount || (e.args.beginData && (e.args.beginData.dirtyObjects || e.args.beginData.totalObjects)));
      if (d) extra.set(e.name, Math.max(extra.get(e.name) || 0, d)); }
    say('trace, by kind (20 presses):', [...sum].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, us]) => `\n  ${(us / 1000).toFixed(0)}ms ${k}${extra.has(k) ? ` (up to ${extra.get(k)} elements)` : ''}`).join(''));
    const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    say('profile, self time over 20 presses:', [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `\n  ${(us / 1000).toFixed(0)}ms ${k}`).join(''));
    app.exit(0); return;
  }
  let lost = 0;
  for (let round = 0; round < 6; round++) {
    const t = Date.now(); let before = await row();
    for (let i = 0; i < 100; i++) { press('down'); await wait(120); }
    let after = await row();
    if (typeof after === 'number' && typeof before === 'number') lost += 100 - (after - before);
    say(`${rel(t)} down x100: ${before} → ${after}`);
    if (round === 1) {
      xml = xml2; say('   (a new guide on the way)');
      // (--mainprofile: what the app's main side does while the new guide lands)
      if (process.argv.includes('--mainprofile')) {
        const insp = new (require('inspector').Session)(); insp.connect();
        const post = (m, p) => new Promise((res) => insp.post(m, p || {}, (err, r) => res(r)));
        await post('Profiler.enable'); await post('Profiler.start');
        js('tv.liveRefresh && tv.liveRefresh(); 0');
        await wait(12000);
        const { profile } = await post('Profiler.stop');
        const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
        // Which samples fall in the longest stall?
        const worst = mainGaps.slice().sort((x, y) => y[1] - x[1])[0];
        if (worst) {
          let t = profile.startTime; const inStall = new Map();
          const stallStart = (worst[0] - worst[1]) * 1000; const stallEnd = worst[0] * 1000;
          const wall0 = Date.now() * 1000 - (profile.endTime - profile.startTime) - 12000 * 0; // (approximate)
          profile.samples.forEach((id, i) => { t += profile.timeDeltas[i]; const n = byId.get(id); const stack = []; let x = n; const parent = new Map(); });
        }
        const total = new Map(); const parentOf = new Map();
        for (const n of profile.nodes) for (const c of n.children || []) parentOf.set(c, n.id);
        profile.samples.forEach((id, i) => { const seen = new Set(); for (let x = id; x; x = parentOf.get(x)) { const n = byId.get(x); const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`; if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + (profile.timeDeltas[i] || 0)); } } });
        say('main side, total time (with what it called):', [...total].filter(([k]) => !/^\(root\)|^\(idle\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `\n  ${(us / 1000).toFixed(0)}ms ${k}`).join(''));
        say('main side, self time while the guide lands:', [...self].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, us]) => `\n  ${(us / 1000).toFixed(0)}ms ${k}`).join(''));
        say('main stalls:', mainGaps.map(([t, ms]) => `${ms}ms`).join(' '));
        app.exit(0); return;
      }
      js('tv.liveRefresh && tv.liveRefresh(); 0');
    }
    before = after;
    for (let i = 0; i < 8; i++) { press('lclick'); await wait(300); }
    say(`   page down x8: ${before} → ${await row()}`);
    before = await row();
    for (let i = 0; i < 60; i++) { press('up'); await wait(120); }
    after = await row();
    if (typeof after === 'number' && typeof before === 'number') lost += 60 - (before - after);
    say(`   up x60: ${before} → ${after}`);
  }
  const r = JSON.parse(await js("JSON.stringify({ gaps: __gaps, renders: __renders, changed: __changed, long: __long, rows: document.querySelectorAll('#live-list .live-row').length, nodes: document.querySelectorAll('*').length })"));
  say('presses that went nowhere:', lost);
  say('guide redraws (live:changed', r.changed, '):', r.renders.map(([t, ms]) => `${rel(t)} ${ms}ms`).join(', '));
  say('rows:', r.rows, '| elements on the page:', r.nodes);
  const top = (xs) => xs.slice().sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, ms]) => `${ms}ms@${rel(t)}`).join(', ');
  say('page frame gaps over 100 ms:', r.gaps.length, '| worst:', top(r.gaps));
  say('long tasks:', r.long.length, '| worst:', top(r.long));
  say('main stalls over 120 ms:', mainGaps.length, '| worst:', top(mainGaps));
  app.exit(0);
});
