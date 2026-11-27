require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, ipcMain } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-kb'); fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } }));
require(require('path').join(__dirname, '..', '..', 'main.js'));
const LOG = (...a) => fs.appendFileSync(path.join(__dirname, 'out', 'kb-out.txt'), a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => { try {
  await wait(3500);
  const views = BaseWindow.getAllWindows()[0].contentView.children;
  const wc = views[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(120); } };
  const shot = async (f) => fs.writeFileSync(path.join(__dirname, 'out', f + '.png'), (await wc.capturePage()).toPNG());
  const sel = () => js("document.querySelector('#ask-keys .k.sel').dataset.k");
  await js("window.__r = 'pending'; askFor({ label: 'Name your theme', eyebrow: 'Test' }).then((v) => { window.__r = v; }); 0"); await wait(600);
  LOG('start on:', await sel(), '| badges:', await js("[...document.querySelectorAll('#ask-keys .kb-badge')].map(b => b.parentElement.dataset.k + '=' + b.textContent).join(' ')"));
  await key('Enter'); // q
  await js("askKeys.hold('rclick', true)"); await key('Right'); await key('Enter'); // W
  await key('Up'); await key('Enter'); // shifted number row: 2 -> @
  await js("askKeys.hold('rclick', false)");
  await key('Enter'); // 2
  LOG('typed:', await js('ask.value'));
  // caps lock: both together
  await js("askKeys.hold('rclick', true); askKeys.hold('lclick', true); askKeys.hold('rclick', false); askKeys.hold('lclick', false)");
  await key('Down'); await key('Enter');
  LOG('caps lock on, typed:', await js('ask.value'), '| caps shown:', await js("document.getElementById('ask-keys').classList.contains('caps')"));
  await js("askKeys.hold('lclick', true)"); await key('Enter'); await js("askKeys.hold('lclick', false)");
  LOG('caps + hold (small):', await js('ask.value'));
  // wrap: from the start of a row, left goes to its end
  await js("document.querySelector('#ask-keys .k.sel').classList.remove('sel')");
  const row1 = await js("[...document.querySelectorAll('#ask-keys .kb-row')][1].firstElementChild.dataset.k");
  await js("askKeys.render('q')"); await key('Left'); LOG('left from q ->', await sel()); await key('Right'); LOG('right again ->', await sel());
  // Start: asks first
  await js("window.__typingDone = 0"); ipcMain.emit('pad', { sender: wc }, 'menu'); await wait(400);
  LOG('Start -> dialog:', await js("!!document.querySelector('#ask-keys .kb-dialog')"), await js("document.querySelector('.kb-q') && document.querySelector('.kb-q').textContent"), '| default:', await js("document.querySelector('.kb-dialog .k.sel').textContent"));
  await shot('kb-dialog');
  await key('Left'); await key('Enter'); await wait(200);
  LOG('Left, A on "No": still typing?', await js('screen'), await js("!!document.querySelector('.kb-dialog')"));
  await key('Escape'); await wait(300);
  LOG('B -> dialog:', await js("document.querySelector('.kb-q') && document.querySelector('.kb-q').textContent"));
  await key('Escape'); await wait(200);
  ipcMain.emit('pad', { sender: wc }, 'menu'); await wait(300); await key('Enter'); await wait(300);
  LOG('Start, A (already on Yes) -> sent:', JSON.stringify(await js('window.__r')), '| screen', await js('screen'));
  // with "ask first" off
  await js("tv.setKbConfirm(false).then(s => { settings.kbConfirm = s.kbConfirm; }); 0"); await wait(300);
  await js("window.__r = 'pending'; askFor({ label: 'Again' }).then((v) => { window.__r = v; }); 0"); await wait(400);
  await key('Enter'); ipcMain.emit('pad', { sender: wc }, 'menu'); await wait(400);
  LOG('no asking: sent straight away:', JSON.stringify(await js('window.__r')));
  await js("openSearch()"); await wait(400);
  LOG('search badges:', await js("[...document.querySelectorAll('.osk-badge')].map(b => b.textContent).join(' ')"));
  await js("document.querySelector('#osk .key').focus()"); await key('Left');
  LOG('search: left from a ->', await js("document.activeElement.textContent"));
  } catch (err) { LOG('ERROR', err.message); }
  app.exit(0);
});
