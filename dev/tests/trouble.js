require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// "Phone not connecting?": the Allow on my home network button can be reached with Right, and Left comes back.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-trouble');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } }));
const OUT = path.join(__dirname, 'out', 'trouble.txt'); const log = []; const say = (...a) => { log.push(a.join(' ')); fs.writeFileSync(OUT, log.join('\n')); };
// Something else already has the usual port: the remote should take the next one, which the
// firewall rule it offers also covers.
const blocker = require('http').createServer().listen(8765, '0.0.0.0');
// No system password prompt (as in Steam's Game Mode): pkexec can't ask, so the app asks itself.
// (Stand-ins, so nothing on this computer changes.)
const firewall = require(path.join(__dirname, '..', '..', 'firewall.js'));
let typed = null;
firewall.allow = async () => ({ error: 'no-agent', command: 'sudo ufw …' });
firewall.allowWithPassword = async (fw, network, ports, password) => { typed = { network, ports, password }; return password === 'hunter2' ? { ok: true } : { error: 'wrong-password' }; };
const realDetect = firewall.detect;
firewall.detect = async (o) => ({ ...(await realDetect(o)), ...(typed && typed.password === 'hunter2' ? { open: true } : {}) });
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(4500);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); } };
  const where = () => js('document.activeElement.id || document.activeElement.className');
  await js('openSettings({ tab: "general" })'); await wait(800);
  await js("document.getElementById('s-phone').click(); 0"); await wait(1500);
  say('QR address:', await js("document.getElementById('s-url').textContent"));
  const f = await js('tv.firewall()');
  say('firewall:', JSON.stringify({ kind: f.kind, open: f.open, network: f.network, port: f.port, command: f.command }));
  say('command covers this port:', /port 8765:8774 /.test(f.command || '') && f.port === 8766 ? 'PASS' : 'FAIL');
  // Show the box as 15 seconds without the phone would. (Here the real firewall is ufw with only
  // an older, narrower rule, so it offers the button.)
  await js('showTrouble(); 0'); await wait(800);
  say('trouble shown:', !(await js("document.getElementById('s-trouble').hidden")), '| allow shown:', !(await js("document.getElementById('s-allow').hidden")));
  await js("document.getElementById('s-phone').focus(); 0");
  say('start:', await where());
  await key('Right', 3);
  const got = await where(); say('after Right x3:', got, got === 's-allow' ? 'PASS' : 'FAIL');
  await key('Down'); say('Down in panel stays:', await where());
  await key('Up'); say('Up in panel stays:', await where());
  await key('Left'); const back = await where(); say('after Left:', back, back === 's-phone' ? 'PASS' : 'FAIL');
  fs.writeFileSync(path.join(__dirname, 'out', 'trouble.png'), (await wc.capturePage()).toPNG());

  // Allow, with no system prompt: our own typing screen asks for the password.
  await key('Right', 3); say('before A:', await where()); wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); // (A, as the app presses it)
  for (let i = 0; i < 10 && (await js('screen')) !== 'ask'; i++) await wait(500);
  say('note now:', await js("document.getElementById('s-note').textContent"));
  say('no prompt -> typing screen:', await js('screen'), '|', await js("document.getElementById('ask-label').textContent"), '| hidden as dots:', await js('ask.secret'));
  fs.writeFileSync(path.join(__dirname, 'out', 'trouble-ask.png'), (await wc.capturePage()).toPNG());
  await js("finishAsk('wrong'); 0"); await wait(800);
  say('wrong password:', await js('screen'), '|', await js("document.getElementById('s-note').textContent"));
  await js("document.getElementById('s-allow').click(); 0"); await wait(1500);
  await js("finishAsk('hunter2'); 0"); await wait(800);
  say('right password:', await js("document.getElementById('s-note').textContent"), '| focus', await where(), '| sent', JSON.stringify(typed));
  const logText = fs.readdirSync(path.join(UD, 'logs')).map((f) => fs.readFileSync(path.join(UD, 'logs', f), 'utf8')).join('');
  say('password in the log:', /hunter2/.test(logText) ? 'FAIL (it is)' : 'PASS (no)', '|', (logText.match(/\[firewall\].*/g) || []).join(' / '));
  blocker.close();
  app.exit(0);
});
