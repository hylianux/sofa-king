'use strict';

// With debug logging on: what goes wrong when a website's video won't play (Hulu's "Error playing
// video", say). Chromium's media player says why (a decryption or licence problem, a format it
// can't play), and the site itself often says something about DRM in its console. Both go in the
// log as [media] lines, short, with web addresses cut down to where they point (no ?…).

const DRM_WORDS = /widevine|drm|eme|license|licence|keysystem|mediakeys|cdm|decrypt|hdcp|playback error|error code/i;
const tidy = (s) => String(s || '').replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1?…').replace(/\s+/g, ' ').slice(0, 300);

// What Widevine says this computer can do, asked from inside the site (each robustness level is
// a promise that a stricter licence will work; Hulu and the like may want more than software).
const PROBE = `(async () => {
  const out = [];
  for (const r of ['SW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'HW_SECURE_DECODE', 'HW_SECURE_ALL']) {
    try {
      await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"', robustness: r }] }]);
      out.push(r + ' yes');
    } catch { out.push(r + ' no'); }
  }
  try { const a = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], persistentState: 'required', sessionTypes: ['persistent-license'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"' }] }]); out.push('persistent licences yes'); } catch { out.push('persistent licences no'); }
  try { const k = await (await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"' }] }])).createMediaKeys();
    out.push('HDCP ' + (k.getStatusForPolicy ? await k.getStatusForPolicy({ minHdcpVersion: '1.0' }).catch((e) => 'unknown (' + e.name + ')') : 'unknown')); } catch {}
  return out.join(', ');
})()`;

// Licence requests and other DRM addresses, as the site sends them (just where to and the answer).
const LICENCE_URL = /licen[cs]e|widevine|\/drm|wvproxy|\/wv\b|cdm/i;
const watchedSessions = new WeakSet();
function watchLicences(ses, log) {
  if (!ses || watchedSessions.has(ses)) return;
  watchedSessions.add(ses);
  const where = (u) => tidy(u).replace(/\?…$/, '');
  // (Licences are always asked for with POST; video pieces are GETs, even when "widevine" is in
  // their address. A POST the server refuses is logged too, whatever its address: services name
  // their licence addresses all sorts of things.)
  ses.webRequest.onCompleted({ urls: ['https://*/*'] }, (d) => {
    if (!log.debugOn || d.method !== 'POST') return;
    if (LICENCE_URL.test(d.url)) log.debug(`[media] licence request to ${where(d.url)} → ${d.statusCode}`);
    else if (d.statusCode >= 400) log.debug(`[media] refused: POST ${where(d.url)} → ${d.statusCode}`);
  });
  ses.webRequest.onErrorOccurred({ urls: ['https://*/*'] }, (d) => {
    if (log.debugOn && d.method === 'POST' && LICENCE_URL.test(d.url) && d.error !== 'net::ERR_ABORTED') log.debug(`[media] licence request to ${where(d.url)} failed: ${d.error}`);
  });
}

function watchMedia(wc, log, name) {
  if (!wc || wc.isDestroyed()) return;
  watchLicences(wc.session, log);
  wc.once('did-finish-load', () => {
    if (wc.isDestroyed()) return;
    wc.executeJavaScript(PROBE, true).then((r) => log.debug(`[media] ${name}: Widevine here: ${r}`)).catch(() => {});
  });
  // The site's own messages about DRM (errors and warnings only).
  wc.on('console-message', (event, oldLevel, oldMessage) => {
    if (!log.debugOn) return;
    const level = event.level != null ? event.level : oldLevel; // (newer Electron: one details object)
    const message = event.message != null ? event.message : oldMessage;
    if (!['warning', 'error', 2, 3].includes(level)) return;
    if (DRM_WORDS.test(message || '')) log.debug(`[media] ${name} says: ${tidy(message)}`);
  });
  // Chromium's media player: errors, and its own error messages.
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    wc.debugger.on('message', (_e, method, params) => {
      if (!log.debugOn) return;
      if (method === 'Media.playerErrorsRaised') {
        for (const e of params.errors || []) log.debug(`[media] ${name} player error: ${tidy([e.errorType, e.code, e.data && JSON.stringify(e.data)].filter(Boolean).join(' '))}`);
      } else if (method === 'Media.playerMessagesLogged') {
        for (const m of params.messages || []) if (m.level === 'error') log.debug(`[media] ${name} player: ${tidy(m.message)}`);
      } else if (method === 'Media.playerPropertiesChanged') {
        // Which decoders were picked, and whether it's encrypted: enough to tell DRM from format.
        for (const p of params.properties || []) {
          if (/kVideoDecoderName|kAudioDecoderName|kIsVideoEncrypted|kIsAudioEncrypted|kVideoPlaybackRoughness|kRendererName/.test(p.name)) log.debug(`[media] ${name} ${p.name.replace(/^k/, '')}: ${tidy(p.value)}`);
        }
      }
    });
    const enable = () => { if (wc.debugger.isAttached()) wc.debugger.sendCommand('Media.enable').catch(() => {}); };
    enable();
    wc.on('did-navigate', enable);
  } catch (err) {
    log.debug(`[media] couldn't watch ${name}'s player: ${err.message}`);
  }
}

module.exports = { watchMedia, tidy };
