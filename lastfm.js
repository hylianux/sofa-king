'use strict';

// Scrobbling to Last.fm: what you play on your music servers goes on your Last.fm profile.
//
// Signing in (Last.fm's "desktop" way): with your API key and its shared secret, ask Last.fm for a
// token, open its "allow access" page for that token, and once you've pressed Allow there, swap
// the token for a session key. The session key doesn't run out, so this happens once. Every call
// that changes something is signed: an MD5 of its parameters (sorted, names and values run
// together) followed by the shared secret. The secret and the session key never go in the log
// (main.js lists them in getSecrets) and only ever go to Last.fm.

const crypto = require('crypto');

const API = 'https://ws.audioscrobbler.com/2.0/';
const UA = 'SOFAKing/0.1 ( scrobbling )';

const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

function sign(params, secret) {
  const base = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort()
    .map((k) => `${k}${params[k]}`).join('');
  return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
}

function createLastfm({ api = API, log = console } = {}) {
  async function call(method, params, { key, secret, post = false }) {
    const all = { ...params, method, api_key: key };
    all.api_sig = sign(all, secret);
    all.format = 'json';
    const body = new URLSearchParams(all);
    let res;
    try {
      res = post
        ? await fetch(api, { method: 'POST', body, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
        : await fetch(`${api}?${body}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    } catch { throw fail('unreachable'); }
    const j = await res.json().catch(() => ({}));
    log.debug(`[lastfm] ${method} -> ${res.status}${j.error ? ` (error ${j.error})` : ''}`);
    if (j.error) {
      // 4/9: signed out (or the session was taken back), 10/26: bad key, 13: wrong secret,
      // 14: not allowed yet, 15: the token ran out, 11/16/29: Last.fm busy.
      const code = { 4: 'signed-out', 9: 'signed-out', 10: 'bad-key', 26: 'bad-key', 13: 'bad-secret', 14: 'not-yet', 15: 'expired', 11: 'busy', 16: 'busy', 29: 'busy' }[j.error] || 'failed';
      throw fail(code, j.message);
    }
    if (!res.ok) throw fail('failed', `Last.fm answered ${res.status}`);
    return j;
  }

  // Step 1: a token, and the page where you allow it. (A wrong secret fails here.)
  async function start({ key, secret }) {
    const j = await call('auth.getToken', {}, { key, secret });
    if (!j.token) throw fail('failed');
    return { token: j.token, page: `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(j.token)}` };
  }

  // Step 2, asked every few seconds until you've pressed Allow: { user, session }, or throws
  // 'not-yet'.
  async function finish({ key, secret, token }) {
    const j = await call('auth.getSession', { token }, { key, secret });
    if (!j.session || !j.session.key) throw fail('failed');
    return { user: String(j.session.name || ''), session: String(j.session.key) };
  }

  const trackParams = (t) => {
    const p = { artist: t.artist, track: t.title };
    if (t.album) p.album = t.album;
    if (t.albumArtist && t.albumArtist !== t.artist) p.albumArtist = t.albumArtist;
    if (t.duration > 0) p.duration = String(Math.round(t.duration));
    if (t.trackNumber > 0) p.trackNumber = String(t.trackNumber);
    return p;
  };

  // "Now playing" on your profile, while a song plays.
  const nowPlaying = (auth, t) => call('track.updateNowPlaying', { ...trackParams(t), sk: auth.session }, { ...auth, post: true });

  // A song you've listened to (startedAt: when it started, in seconds).
  const scrobble = (auth, t, startedAt) => call('track.scrobble', { ...trackParams(t), timestamp: String(startedAt), sk: auth.session }, { ...auth, post: true });

  return { start, finish, nowPlaying, scrobble };
}

// Last.fm's rule: a song counts once it's been played for half its length or four minutes,
// whichever comes first, and songs under 30 seconds never count.
function counts(duration, played) {
  if (!(duration > 30)) return false;
  return played >= Math.min(duration / 2, 240);
}

module.exports = { createLastfm, sign, counts };
