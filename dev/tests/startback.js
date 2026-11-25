require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// While watching: Start opens the menu; Settings from the menu; Start closes everything; Start
// reopens Settings where you were; B steps back (section -> menu of sections -> the menu -> the show).
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, ipcMain, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-startback');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } }));
const fake = (ses) => { try { ses.protocol.handle('https', () => new Response('<html><body style="background:#300"><h1>Pretend Netflix</h1><video></video></body></html>', { headers: { 'content-type': 'text/html' } })); } catch { /* already */ } };
app.on('session-created', fake);
require(require('path').join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(3500);
  const views = () => BaseWindow.getAllWindows()[0].contentView.children;
  const home = views()[0].webContents;
  const overlay = views().find((v) => /overlay\.html/.test(v.webContents.getURL())).webContents;
  const hjs = (c) => home.executeJavaScript(c);
  const start = async () => { ipcMain.emit('pad', { sender: overlay.isFocused() ? overlay : home }, 'menu'); await wait(500); };
  const state = async () => {
    const v = views();
    const ov = v.find((x) => /overlay\.html/.test(x.webContents.getURL()));
    const homeView = v.find((x) => x.webContents === home);
    const top = v.filter((x) => x.getVisible()).map((x) => (x.webContents === home ? 'home' : /overlay\.html/.test(x.webContents.getURL()) ? 'menu' : /hints/.test(x.webContents.getURL()) ? 'hints' : 'show'));
    return `visible: ${top.join(',')} | home screen ${await hjs('screen')}${await hjs("screen === 'settings' ? ' tab=' + settingsTab + ' at ' + (document.activeElement.dataset.group || document.activeElement.dataset.layout || document.activeElement.id) : ''")}`;
  };
  ipcMain.emit('ui:open', { sender: home }, 'netflix'); await wait(2500);
  console.log('views:', views().map((x) => x.webContents.getURL().split('/').pop() + '=' + x.getVisible()).join(' '));
  console.log('watching:', await state());
  await start(); console.log('Start:', await state());
  ipcMain.emit('ui:action', { sender: overlay }, 'settings'); await wait(1200);
  console.log('menu -> Settings:', await state());
  await hjs("setSettingsTab('look')"); await wait(300);
  await hjs("document.querySelector('#s-rows [data-layout=\"grid\"]').focus()"); await wait(300);
  console.log('moved to Look → Layout → Grid:', await state());
  ipcMain.emit('pad', { sender: home }, 'menu'); await wait(600);
  console.log('Start:', await state());
  ipcMain.emit('pad', { sender: views().find((v) => v.getVisible() && v.webContents !== home && !/overlay\.html|hints\.html/.test(v.webContents.getURL())).webContents }, 'menu'); await wait(1200);
  console.log('Start again:', await state());
  await hjs("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(400);
  console.log('B:', await state());
  await hjs("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(800);
  console.log('B:', await state());
  ipcMain.emit('pad', { sender: overlay }, 'back'); await wait(600);
  console.log('B:', await state());
  app.exit(0);
});
