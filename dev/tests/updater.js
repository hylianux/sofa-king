require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// The AppImage updater, against a pretend GitHub on localhost and a pretend AppImage (a small file
// in out/): the check by itself after starting (and its note on screen), test versions on and off,
// Settings → General → Updates, a download whose checksum is wrong (refused, nothing replaced),
// then a good one (replaced in place, runnable, Restart now). Restart itself isn't pressed.
const path = require('path'); const fs = require('fs'); const http = require('http'); const crypto = require('crypto');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-updater');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true }, layout: 'netflix', debugLog: true, updates: { prerelease: false } }));
const SHOTS = path.join(__dirname, 'out', 'shots-updater'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'updater.txt'); fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

// ---- the pretend AppImage
const DIR = path.join(__dirname, 'out', 'fake-appimage');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR);
const APPIMAGE = path.join(DIR, 'SOFA-King.AppImage');
fs.writeFileSync(APPIMAGE, 'the old version', { mode: 0o755 });

// ---- pretend GitHub
const PORT = 47000 + Math.floor(Math.random() * 2000);
const GH = `http://127.0.0.1:${PORT}`;
const NEW = Buffer.alloc(3 * 1024 * 1024, 'n'); // the new version's file
const SUM = crypto.createHash('sha256').update(NEW).digest('hex');
let badSum = false;
const seen = [];
const rel = (v, pre) => ({
  tag_name: `v${v}`, name: `SOFA King ${v}`, published_at: '2026-12-01T10:00:00Z', prerelease: pre, draft: false,
  html_url: `${GH}/r/${v}`,
  body: `## Installing\n...\n## What's Changed\n* Radio remembers your station by @someone in https://github.com/x/pull/9\n* **Faster** Live TV\n`,
  assets: [
    { name: `SOFA-King-${v}-x86_64.AppImage`, browser_download_url: `${GH}/dl/${v}.AppImage`, size: NEW.length },
    { name: `SOFA-King-${v}-arm64.AppImage`, browser_download_url: `${GH}/dl/arm.AppImage`, size: 5 },
    { name: 'SHA256SUMS.txt', browser_download_url: `${GH}/dl/${v}.sums` },
  ],
});
const gh = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url} ua=${req.headers['user-agent']}`);
  const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/repos/hylianux/sofa-king/releases/latest') return J(rel('9.9.0', false));
  if (req.url.startsWith('/repos/hylianux/sofa-king/releases?')) return J([rel('9.9.0', false), rel('10.0.0-beta.1', true), { ...rel('11.0.0', false), draft: true }]);
  const m = /^\/dl\/(.+)\.(AppImage|sums)$/.exec(req.url);
  if (m && m[2] === 'sums') { res.writeHead(200); return res.end(`${badSum ? '0'.repeat(64) : SUM}  SOFA-King-${m[1]}-x86_64.AppImage\n${'1'.repeat(64)}  SOFA-King-${m[1]}-arm64.AppImage\n`); }
  if (m) { res.writeHead(200, { 'content-length': String(NEW.length) }); return res.end(NEW); }
  res.writeHead(404); res.end();
});
gh.listen(PORT, '127.0.0.1');
process.env.APPIMAGE = APPIMAGE;
process.env.SOFA_UPDATE_API = GH;

require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };

app.whenReady().then(async () => {
  try {
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(1000);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const shot = async (f) => fs.writeFileSync(path.join(SHOTS, `${f}.png`), (await wc.capturePage()).toPNG());
    const focused = () => js("(document.activeElement.id || document.activeElement.className) + ' | ' + (document.activeElement.textContent || '').trim().slice(0, 60)");
    const status = () => js("document.getElementById('up-status').textContent + ' | button: ' + (document.getElementById('up-go').hidden ? '(hidden)' : document.getElementById('up-go').textContent) + ' | note: ' + document.getElementById('up-note').textContent");

    // The check by itself, a moment after starting: a small screen offering the new version.
    await until(() => js("screen === 'update'"), 15000);
    say('offered:', await js("document.getElementById('uo-title').textContent + ' | news: ' + [...document.querySelectorAll('#uo-news li')].length + ' | focus: ' + document.activeElement.textContent"));
    await wait(800); await shot('1-offer');
    const cfg = () => JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).updates;
    await wait(300);
    say('remembered:', JSON.stringify({ toldAbout: cfg().toldAbout, checked: cfg().lastCheck > 0 }));
    // B: back where you were. Then Show me (offered again by hand, as if the app had just started).
    await js("back(); 0"); await wait(500);
    say('B:', await js("screen"));
    await js("tv.updateState().then((st) => { updateOffer.pending = st; offerUpdate(); }); 0"); await wait(800);
    await js("document.getElementById('uo-show').click(); 0"); await wait(2000);
    say('Show me:', await js("screen + ' tab=' + settingsTab"), '|', await focused());
    await shot('1b-show-me');

    // Settings → General → Updates.
    await js("openSettings({ tab: 'general' }); 0"); await wait(1200);
    say('general rail:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
    await js("document.querySelector('.s-panel:not([hidden]) .rail-item[data-group=\"Updates\"]').focus(); 0"); await wait(600);
    say('updates:', await status());
    say('what\'s new:', await js("[...document.querySelectorAll('#up-news li')].map(l=>l.textContent).join(' / ')"));
    await shot('2-available');

    // Test versions on: the beta (newer than 9.9.0), never the draft.
    await js("document.getElementById('up-pre').click(); 0"); await wait(500);
    await js("document.getElementById('up-go').click(); 0");
    await until(() => js("/is out|newest/.test(document.getElementById('up-status').textContent)"), 10000);
    say('with test versions:', await status());
    await js("document.getElementById('up-pre').click(); 0"); await wait(500);
    await js("document.getElementById('up-go').click(); 0");
    await until(() => js("/9\\.9\\.0 is out/.test(document.getElementById('up-status').textContent)"), 10000);
    say('without:', await status());

    // A download that doesn't match its checksum: refused, the old file untouched, nothing left over.
    badSum = true;
    await js("document.getElementById('up-go').focus(); document.getElementById('up-go').click(); 0");
    await until(() => js("/checksum/.test(document.getElementById('up-note').textContent)"), 20000);
    say('bad checksum:', await status());
    say('file after bad checksum:', JSON.stringify(fs.readFileSync(APPIMAGE, 'utf8')), '| left over:', JSON.stringify(fs.readdirSync(DIR).filter((f) => f !== 'SOFA-King.AppImage')));

    // A good one.
    badSum = false;
    await js("document.getElementById('up-go').click(); 0");
    await until(() => js("!document.getElementById('up-restart').hidden"), 30000);
    say('after update:', await status(), '| restart shown:', await js("!document.getElementById('up-restart').hidden"));
    say('focus:', await focused());
    const now = fs.readFileSync(APPIMAGE);
    say('file replaced:', now.equals(NEW) ? 'yes' : 'NO', '| runnable:', (fs.statSync(APPIMAGE).mode & 0o111) ? 'yes' : 'NO', '| same name:', fs.existsSync(APPIMAGE), '| left over:', JSON.stringify(fs.readdirSync(DIR).filter((f) => f !== 'SOFA-King.AppImage')));
    await shot('3-ready');

    // Only the release page's address was asked for, with a plain User-Agent.
    say('github saw:', [...new Set(seen.map((l) => l.replace(/\d+\.\d+\.\d+(-[\w.]+)?/g, 'X')))].join('\n  '));
    const log = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');
    say('update log lines:', log.split('\n').filter((l) => /\[update\]/.test(l)).map((l) => l.replace(/^\S+\s+\w+\s+/, '')).join('\n  '));
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
app.on('web-contents-created', (e, w) => w.on('console-message', (event) => { const m = event.message || ''; if (/error|refused|Uncaught/i.test(m)) say('page says:', m.slice(0, 300), `(${String(event.sourceId || '').split('/').pop()}:${event.lineNumber})`); }));
