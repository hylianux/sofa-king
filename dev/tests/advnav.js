require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Settings → Advanced with the D-pad: the menu, into Gamescope fixes, down through it.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-advnav');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true }, gamescope: { person: true } }));
const OUT = path.join(__dirname, 'out', 'advnav.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(350); } };
  const where = () => js("(() => { const a = document.activeElement; const b = a.getBoundingClientRect(); const box = a.closest('.s-group'); const r = box ? box.getBoundingClientRect() : b; return (a.id || a.textContent.trim().slice(0, 30)) + (b.bottom > r.bottom + 1 || b.top < r.top - 1 ? '  (CUT OFF)' : '') + (box && box.scrollWidth > box.clientWidth + 1 ? '  (SIDEWAYS SCROLL)' : ''); })()");
  await js("openSettings({ tab: 'advanced' }); 0"); await wait(1000);
  say('opened on:', await where());
  await key('Right'); say('right:', await where());
  for (let i = 1; i <= 6; i++) { await key('Down'); say(`down ${i}:`, await where()); if (i === 2) { await wait(900); say('  a moment later:', await where()); fs.writeFileSync(path.join(__dirname, 'out', 'advnav-2.png'), (await wc.capturePage()).toPNG()); } }
  say('pretends-with button:', await js("(() => { const b = document.getElementById('gs-person-how'); const r = b.getBoundingClientRect(); const p = document.getElementById('gs-person').getBoundingClientRect(); return JSON.stringify({ hidden: b.hidden, shown: Boolean(b.offsetParent), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), toggleBottom: Math.round(p.bottom), display: getComputedStyle(b).display }); })()"));
  await key('Left'); say('left:', await where());
  // For comparison: Developer's switch.
  await js("setSettingsTab('developer'); 0"); await wait(500); await key('Right'); await wait(300);
  say('developer:', await where());
  app.exit(0);
});
