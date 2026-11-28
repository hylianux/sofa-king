require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Debug logging's [media] lines when a website's video fails. Every https address in the website
// layer is answered here (nothing reaches the real Hulu): a page whose video fails, a DRM message
// in its console, and a licence request refused with 403.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, ipcMain, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-medialog');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ debugLog: true, live: { iptvOrgAsked: true } }));
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
app.whenReady().then(async () => {
  session.fromPartition('persist:tv').protocol.handle('https', (req) => {
    if (/license/.test(req.url)) return new Response('no', { status: 403 });
    return new Response(`<video id=v></video><script>console.error('Playback error: DRM license denied (RUNUNK13) https://x.test/a?token=SECRET123');
      fetch('/license?token=SECRET123', { method: 'POST' }).catch(() => {}); document.getElementById('v').src = '/nothing.mp4';</script>`,
      { headers: { 'content-type': 'text/html' } });
  });
  await wait(4000);
  const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
  ipcMain.emit('ui:open', { sender: wc }, 'hulu');
  await wait(6000);
  const logText = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');
  const media = logText.split('\n').filter((l) => l.includes('[media]'));
  check('site DRM message logged', media.some((l) => /hulu says: .*RUNUNK13/.test(l)));
  check('licence request and its answer logged', media.some((l) => /licence request to https:\/\/www\.hulu\.com\/license → 403/.test(l)));
  check('Widevine probe logged', media.some((l) => /Widevine here: SW_SECURE_CRYPTO/.test(l)));
  check('player error logged', media.some((l) => /player error/.test(l)));
  check('nothing after ? in the log', !/SECRET123/.test(logText));
  // Dolby sound: the site is told it can't play it (Chromium here has no decoder), AAC still yes.
  const svc = BaseWindow.getAllWindows()[0].contentView.children.map((v) => v.webContents).find((w) => /hulu\.com/.test(w.getURL()));
  const said = svc ? await svc.executeJavaScript(`(async () => {
    const t = (c) => 'audio/mp4; codecs="' + c + '"';
    const eme = async (c) => navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"' }], audioCapabilities: [{ contentType: t(c) }] }]).then(() => 'yes', () => 'no');
    const mc = async (c) => (await navigator.mediaCapabilities.decodingInfo({ type: 'media-source', audio: { contentType: t(c), channels: '6', bitrate: 384000, samplerate: 48000 } })).supported;
    return [MediaSource.isTypeSupported(t('ec-3')), MediaSource.isTypeSupported(t('ac-3')), document.createElement('video').canPlayType(t('ec-3')), await mc('ec-3'), await eme('ec-3'),
            MediaSource.isTypeSupported(t('mp4a.40.2')), await mc('mp4a.40.2'), await eme('mp4a.40.2'), MediaSource.isTypeSupported.toString().includes('native')].join(' ');
  })()`) : 'no hulu page';
  check('Dolby: no, AAC: yes, and it looks untouched', said === 'false false  false no true true yes true', said);
  fs.writeFileSync(path.join(__dirname, 'out', 'medialog.txt'), results.join('\n') + '\n\n' + media.join('\n') + '\n');
  app.exit(0);
});
