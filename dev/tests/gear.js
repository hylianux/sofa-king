require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// How you get to the gear, and the menu opening with one Start press (a real gamepad press can't be
// faked here, so the double report is simulated: two 'pad' menu messages close together).
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, ipcMain } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-gear');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } }));
require(require('path').join(__dirname, '..', '..', 'main.js'));
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (ev, level, msg, line, src) => { const m = (ev && ev.message) || msg || ''; if (/overlay/.test(String((ev && ev.sourceId) || src || ''))) console.log('PAGE:', String(m).slice(0, 200), (ev && ev.lineNumber) || line); }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(4000);
  const views = BaseWindow.getAllWindows()[0].contentView.children;
  const wc = views[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(180); };
  const where = () => js("(document.activeElement.id || document.activeElement.className) + ' ' + (document.activeElement.textContent || '').trim().slice(0, 20)");
  console.log('start:', await where());
  const path2 = [];
  await js("document.querySelector('#tabs .tab[data-view=\"genres\"]').click()"); await wait(500);
  await js("document.querySelector('#tabs .tab.chosen').focus()"); await wait(200);
  for (const k of ['Right', 'Right', 'Right', 'Right', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Down']) { await key(k); path2.push(k + '→' + await where()); }
  console.log(path2.join(' | '));
  // Start pressed once, reported by two pages
  const overlayWc = views.find((v) => /overlay\.html/.test(v.webContents.getURL())).webContents;
  ipcMain.emit('pad', { sender: wc }, 'menu');
  setTimeout(() => ipcMain.emit('pad', { sender: overlayWc }, 'menu'), 60);
  await wait(600);
  // The website keyboard draws (shared keyboard code)
  console.log('overlay check:', await overlayWc.executeJavaScript("[typeof TVKeyboard, typeof kb, typeof showBuffer, typeof showKeyboard, typeof showMenu, typeof keys, [...document.scripts].map(s=>s.src.split('/').pop()).join(',')].join(' ')").catch((e) => 'ERR ' + e.message));
  overlayWc.send('overlay-state', { mode: 'keyboard', kbConfirm: true, field: { label: 'Email', kind: 'text' } });
  await wait(400);
  console.log('website keyboard keys:', await overlayWc.executeJavaScript("document.querySelectorAll('#kb-rows .k').length + ' keys, badges ' + [...document.querySelectorAll('#kb-rows .kb-badge')].map(b => b.textContent).join(' ')"));
  console.log('menu open after one press (seen twice):', views.find((v) => /overlay\.html/.test(v.webContents.getURL())).getVisible());
  app.exit(0);
});
