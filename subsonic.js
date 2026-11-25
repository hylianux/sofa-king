'use strict';

// Navidrome, and other servers that speak the Subsonic language (Airsonic, Gonic...).
//
// Subsonic normally puts the sign-in in the web address. We never do: every request is sent as a
// form (POST), with the sign-in in the body, which Navidrome and other OpenSubsonic servers accept.
// We don't keep your password either: only a one-way scrambled form of it (a "token") and the
// random "salt" used to make it, which the server checks without needing the password again.

const crypto = require('crypto');

const API_VERSION = '1.16.1';
const CLIENT = 'SOFAKing';
const TIMEOUT = 12000;

function createSubsonic({ log = { debug() {} } } = {}) {
  // "my-server" -> "http://my-server:4533"; keeps an explicit scheme, port or path.
  function normalize(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    const typedScheme = /^https?:\/\//i.test(s);
    if (!typedScheme) s = `http://${s}`;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!u.hostname || /\s/.test(u.hostname)) return null;
    if (!typedScheme && !u.port && (u.pathname === '/' || u.pathname === '')) u.port = '4533';
    return u.toString().replace(/\/+$/, '').replace(/\/app$/i, '');
  }

  const signIn = (password) => {
    const salt = crypto.randomBytes(8).toString('hex');
    return { salt, token: crypto.createHash('md5').update(String(password) + salt).digest('hex') };
  };

  function form(server, params) {
    const body = new URLSearchParams({ u: server.user, t: server.token, s: server.salt, v: API_VERSION, c: CLIENT, f: 'json' });
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null) continue;
      if (Array.isArray(v)) for (const x of v) body.append(k, x);
      else body.set(k, String(v));
    }
    return body;
  }

  // A request that answers with JSON.
  async function call(server, method, params = {}, { timeout = TIMEOUT } = {}) {
    const started = Date.now();
    let res;
    try {
      res = await fetch(`${server.url}/rest/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form(server, params),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      log.debug(`[subsonic] ${method} at ${server.url} failed: ${err.name === 'TimeoutError' ? 'no answer' : err.message}`);
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    log.debug(`[subsonic] ${method} -> ${res.status} (${Date.now() - started} ms)`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status === 404 ? 'not-subsonic' : 'failed' });
    let j;
    try { j = await res.json(); } catch { throw Object.assign(new Error('not json'), { code: 'not-subsonic' }); }
    const r = j && j['subsonic-response'];
    if (!r) throw Object.assign(new Error('not subsonic'), { code: 'not-subsonic' });
    if (r.status !== 'ok') {
      const code = r.error && r.error.code;
      // 40: wrong name or password; 41: token sign-in not supported; 50: not allowed.
      throw Object.assign(new Error((r.error && r.error.message) || 'failed'), { code: code === 40 || code === 41 || code === 50 ? 'unauthorized' : 'failed', subsonicCode: code });
    }
    return r;
  }

  // Checks the address and sign-in. Answers the server's details, to be saved (without the password).
  async function connect(url, user, password) {
    const base = normalize(url);
    if (!base) throw Object.assign(new Error('bad address'), { code: 'bad-address' });
    const auth = signIn(password);
    const server = { url: base, user: String(user || '').trim(), ...auth };
    const r = await call(server, 'ping');
    let host = base;
    try { host = new URL(base).hostname; } catch { /* keep the address */ }
    const kind = r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : 'Subsonic';
    return {
      id: `sub-${crypto.createHash('sha1').update(`${base}|${server.user}`).digest('hex').slice(0, 12)}`,
      type: 'subsonic', name: `${kind} on ${host}`, kind, version: r.serverVersion || r.version || '', ...server,
    };
  }

  async function folders(server) {
    const r = await call(server, 'getMusicFolders');
    return ((r.musicFolders && r.musicFolders.musicFolder) || []).map((f) => ({ id: String(f.id), name: f.name || `Folder ${f.id}` }));
  }

  // The folders to look in: the ones you picked, or all of them.
  const folderIds = (server) => (Array.isArray(server.folders) && server.folders.length ? server.folders : [null]);

  const albumOf = (server, a) => ({
    kind: 'album', serverId: server.id, serverName: server.name, itemId: String(a.id), title: a.name || a.title || '', artist: a.artist || a.displayArtist || '',
    artists: [...new Set([...(a.artists || []), ...(a.albumArtists || [])].map((x) => x.name).filter(Boolean))],
    year: a.year ? String(a.year) : '', cover: a.coverArt ? `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(a.coverArt)}/Images/Primary` : '',
    releaseTypes: (a.releaseTypes || []).map((t) => String(t).toLowerCase()), compilation: Boolean(a.isCompilation), mbid: a.musicBrainzId || '',
    songs: a.songCount || 0,
  });

  async function searchAlbums(server, query, count = 30) {
    const out = [];
    for (const folder of folderIds(server)) {
      const r = await call(server, 'search3', { query, albumCount: count, artistCount: 0, songCount: 0, musicFolderId: folder });
      out.push(...((r.searchResult3 && r.searchResult3.album) || []).map((a) => albumOf(server, a)));
    }
    return out;
  }

  // Every album an artist is on: their own, and ones that credit them (tributes tagged with the
  // artist among the album artists, for example).
  async function artistAlbums(server, name) {
    const out = new Map();
    for (const folder of folderIds(server)) {
      const r = await call(server, 'search3', { query: name, artistCount: 10, albumCount: 0, songCount: 0, musicFolderId: folder });
      const artists = ((r.searchResult3 && r.searchResult3.artist) || []).filter((a) => sameName(a.name, name));
      for (const a of artists) {
        const g = await call(server, 'getArtist', { id: a.id });
        for (const al of (g.artist && g.artist.album) || []) out.set(String(al.id), albumOf(server, al));
      }
    }
    return [...out.values()];
  }

  async function album(server, id) {
    const r = await call(server, 'getAlbum', { id });
    const a = r.album || {};
    return {
      ...albumOf(server, a),
      tracks: (a.song || []).map((s) => ({
        id: String(s.id), title: s.title || '', artist: s.artist || '', n: s.track || 0, disc: s.discNumber || 0, seconds: s.duration || 0,
      })),
    };
  }

  // Songs by name (for playlists from elsewhere: which of these songs do you have?).
  async function searchSongs(server, query, count = 15) {
    const out = [];
    for (const folder of folderIds(server)) {
      const r = await call(server, 'search3', { query, songCount: count, albumCount: 0, artistCount: 0, musicFolderId: folder });
      out.push(...((r.searchResult3 && r.searchResult3.song) || []).map((s) => ({
        id: String(s.id), title: s.title || '', artist: s.artist || '', album: s.album || '', seconds: s.duration || 0,
      })));
    }
    return out;
  }

  async function recent(server, size = 30) {
    const out = [];
    for (const folder of folderIds(server)) {
      const r = await call(server, 'getAlbumList2', { type: 'newest', size, musicFolderId: folder });
      out.push(...((r.albumList2 && r.albumList2.album) || []).map((a) => albumOf(server, a)));
    }
    return out;
  }

  // The raw response for a song or a picture (for the app's own little relay; see main.js).
  function fetchRaw(server, method, params, headers = {}) {
    return fetch(`${server.url}/rest/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: form(server, params),
    });
  }
  const cover = (server, id, size = 500) => fetchRaw(server, 'getCoverArt', { id, size }, { Accept: 'image/*' });
  const stream = (server, id, range) => fetchRaw(server, 'stream', { id, format: 'raw' }, range ? { Range: range } : {});

  // Tells the server what's playing (submission false) and what was played (true), for its
  // "now playing" and play counts.
  const scrobble = (server, id, submission) => call(server, 'scrobble', { id, submission: Boolean(submission), time: Date.now() }).catch(() => {});

  return { normalize, connect, folders, searchAlbums, searchSongs, artistAlbums, album, recent, cover, stream, scrobble };
}

const sameName = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

module.exports = { createSubsonic };
