require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// "Set up search" (and the Library's set-up button) go straight to the setting that does it,
// not wherever Settings was last left.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-setupjump');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } })); // (no TMDB key)
const OUT = path.join(__dirname, 'out', 'setupjump.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const where = () => js("(() => { const a = document.activeElement; const g = a.closest('.s-group'); return `${screen} · ${settingsTab} · ${g ? g.dataset.name : '-'} · ${a.id || a.dataset.group || a.className}`; })()");
  const leaveInLook = async () => {
    await js('openSettings({ tab: "look" })'); await wait(600);
    await js("document.querySelector('#screen-settings .s-panel[data-tab=\"look\"] .rail-item:nth-of-type(3)').focus(); rememberSettingsPlace(); 0");
    say('  left Settings at:', await where());
    await js("go('home'); 0"); await wait(800);
  };
  for (const [btn, want] of [['home-setup', 's-phone'], ['genres-setup', 's-phone'], ['results-setup', 's-phone'], ['lib-setup', 'jf-add']]) {
    await leaveInLook();
    await js(`document.getElementById('${btn}').click(); 0`); await wait(1200);
    const at = await where();
    say(`${btn} ->`, at, at.endsWith(want) ? 'PASS' : 'FAIL');
    if (btn === 'home-setup') fs.writeFileSync(path.join(__dirname, 'out', 'setupjump.png'), (await wc.capturePage()).toPNG());
  }
  // The gear still opens where you left off.
  await leaveInLook();
  await js("openSettings(); 0"); await wait(1000);
  say('gear ->', await where());
  app.exit(0);
});
