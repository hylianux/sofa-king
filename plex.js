'use strict';

// Plex: signing in with a code (plex.tv/link), finding your servers, and the same things we do
// with Jellyfin servers (Jump back in / Up next, "is it on my server?", the library, episodes,
// and playing in mpv with resume points and watched marks kept in step).
//
// Every function that takes a server returns things in the same shape as jellyfin.js, so the rest
// of the app doesn't need to know which kind of server it's talking to. A Plex server here is
// { id: 'plex-<machine id>', type: 'plex', name, url, token, userId: 'plex', machineId, owned }.
//
// The server's token is only ever sent to that server (as the X-Plex-Token header, never in an
// address), and the account's token only to plex.tv.

const os = require('os');

const PLEX_TV = 'https://plex.tv';
const TIMEOUT = 10_000;
const MS = 1000;

const simplify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();

function createPlex({ clientId, version, log = { debug() {} } }) {
  const headers = (token) => ({
    Accept: 'application/json',
    'X-Plex-Product': 'SOFA King',
    'X-Plex-Version': version,
    'X-Plex-Client-Identifier': clientId(),
    'X-Plex-Device-Name': os.hostname() || 'TV',
    'X-Plex-Platform': 'Linux',
    'X-Plex-Device': 'TV',
    ...(token ? { 'X-Plex-Token': token } : {}),
  });

  async function req(base, pathname, { method = 'GET', token, query, timeout = TIMEOUT } = {}) {
    const url = new URL(base.replace(/\/+$/, '') + pathname);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
    const started = Date.now();
    let res;
    try {
      res = await fetch(url, { method, headers: headers(token), signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      log.debug(`[plex] ${method} ${url.origin}${url.pathname} failed after ${Date.now() - started} ms: ${err.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : err.message}`);
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    log.debug(`[plex] ${method} ${url.origin}${url.pathname} -> ${res.status} (${Date.now() - started} ms)`);
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: res.status });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'failed', status: res.status });
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }
  const mc = (r) => (r && r.MediaContainer) || {};
  const get = (server, pathname, query) => req(server.url, pathname, { token: server.token, query });

  // ---------------------------------------------------------------- signing in (plex.tv/link)

  // A 4-character code for the person to enter at plex.tv/link.
  async function pinStart() {
    const r = await req(PLEX_TV, '/api/v2/pins', { method: 'POST' });
    if (!r || !r.id || !r.code) throw Object.assign(new Error('no code'), { code: 'failed' });
    return { id: r.id, code: r.code, expiresAt: Date.now() + (r.expiresIn || 900) * 1000 };
  }
  // null until the code has been entered; then the account's token.
  async function pinCheck(id) {
    const r = await req(PLEX_TV, `/api/v2/pins/${encodeURIComponent(id)}`);
    return (r && r.authToken) || null;
  }
  async function account(token) {
    const r = await req(PLEX_TV, '/api/v2/user', { token });
    return { userName: (r && (r.title || r.username)) || 'Plex', id: r && r.id };
  }

  // Your servers (yours and ones shared with you), each with the address that answers best:
  // on your network first, then over the internet, then through Plex's relay.
  async function servers(accountToken) {
    const r = await req(PLEX_TV, '/api/v2/resources', { token: accountToken, query: { includeHttps: '1', includeRelay: '1' } });
    const list = (Array.isArray(r) ? r : []).filter((d) => String(d.provides || '').split(',').includes('server'));
    return Promise.all(list.map(async (d) => {
      const conns = (d.connections || []).slice().sort((a, b) => rank(a) - rank(b));
      const url = await firstAnswering(conns.map((c) => c.uri), d.accessToken);
      return {
        id: `plex-${d.clientIdentifier}`, type: 'plex', name: d.name || 'Plex', machineId: d.clientIdentifier,
        token: d.accessToken || accountToken, userId: 'plex', owned: Boolean(d.owned),
        url: url || (conns[0] && conns[0].uri) || '', reachable: Boolean(url),
        addresses: conns.map((c) => c.uri).slice(0, 8),
      };
    }));
  }
  const rank = (c) => (c.relay ? 3 : c.local ? 0 : 1) + (c.protocol === 'https' ? 0 : 0.5);
  async function firstAnswering(uris, token) {
    for (const uri of uris) {
      try {
        await req(uri, '/identity', { token, timeout: 3500 });
        return uri;
      } catch { /* try the next */ }
    }
    return null;
  }
  // The server moved (a new address on your network, say)? Find one that answers.
  async function reconnect(server) {
    const url = await firstAnswering([server.url, ...(server.addresses || []).filter((u) => u !== server.url)], server.token);
    return url;
  }

  // ---------------------------------------------------------------- items, in Jellyfin's shape

  const TYPE = { movie: 'Movie', episode: 'Episode', show: 'Series', season: 'Season' };
  const tmdbOf = (it) => {
    for (const g of it.Guid || []) { const m = /^tmdb:\/\/(\d+)/.exec(g.id || ''); if (m) return Number(m[1]); }
    const m = /themoviedb:\/\/(\d+)/.exec(it.guid || '');
    return m ? Number(m[1]) : null;
  };
  function playable(it) {
    const ep = it.type === 'episode';
    const part = it.Media && it.Media[0] && it.Media[0].Part && it.Media[0].Part[0];
    return {
      id: String(it.ratingKey),
      type: TYPE[it.type] || it.type,
      name: it.title || '',
      series: ep ? it.grandparentTitle || null : null,
      seriesId: ep && it.grandparentRatingKey ? String(it.grandparentRatingKey) : null,
      season: ep ? it.parentIndex ?? null : null,
      episode: ep ? it.index ?? null : null,
      overview: it.summary || '',
      runtime: it.duration ? Math.round(it.duration / MS) : null,
      position: it.viewOffset ? Math.round(it.viewOffset / MS) : 0,
      played: (it.viewCount || 0) > 0 && !it.viewOffset,
      lastPlayed: it.lastViewedAt ? new Date(it.lastViewedAt * 1000).toISOString() : null,
      year: it.year || null,
      sortName: it.titleSort || it.title || '',
      tmdbId: tmdbOf(it),
      // Which item's picture: a show's for its episodes.
      poster: ep ? (it.grandparentRatingKey ? String(it.grandparentRatingKey) : null) : String(it.ratingKey),
      partKey: part ? part.key : null,
    };
  }

  async function sections(server, type) {
    const r = await get(server, '/library/sections');
    return (mc(r).Directory || []).filter((d) => !type || d.type === type);
  }

  // Is this TMDB title on this server? The TMDB id, or failing that name + year.
  async function findOn(server, { kind, tmdbId, title, year }) {
    const type = kind === 'tv' ? 'show' : 'movie';
    const libs = await sections(server, type);
    const found = [];
    await Promise.all(libs.map(async (d) => {
      const r = await get(server, `/library/sections/${d.key}/all`, { type: type === 'show' ? '2' : '1', title, includeGuids: '1' }).catch(() => null);
      found.push(...(mc(r).Metadata || []));
    }));
    const hit = found.find((it) => tmdbId && tmdbOf(it) === Number(tmdbId)) ||
      found.find((it) => simplify(it.title) === simplify(title) && (!year || !it.year || String(it.year) === String(year)));
    return hit ? { serverId: server.id, serverName: server.name, itemId: String(hit.ratingKey), itemType: TYPE[hit.type], name: hit.title } : null;
  }
  async function find(list, item) {
    const results = await Promise.allSettled(list.filter((s) => s.token && s.url).map((s) => findOn(s, item)));
    const matches = [];
    const problems = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) matches.push(r.value);
      if (r.status === 'rejected') problems.push({ serverId: list[i].id, code: r.reason.code });
    });
    return { matches, problems };
  }

  async function getItem(server, itemId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(itemId)}`, { includeGuids: '1' });
    const it = (mc(r).Metadata || [])[0];
    if (!it) throw Object.assign(new Error('gone'), { code: 'gone' });
    return playable(it);
  }

  async function seasons(server, seriesId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(seriesId)}/children`);
    return (mc(r).Metadata || []).filter((s) => s.type === 'season').map((s) => ({
      id: String(s.ratingKey), name: s.title, index: s.index ?? null,
      unplayed: s.leafCount != null ? s.leafCount - (s.viewedLeafCount || 0) : null,
    }));
  }
  async function episodes(server, seriesId, seasonId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(seasonId)}/children`);
    return (mc(r).Metadata || []).filter((e) => e.type === 'episode').map(playable);
  }
  async function allEpisodes(server, seriesId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(seriesId)}/allLeaves`);
    return (mc(r).Metadata || []).filter((e) => e.type === 'episode').map(playable);
  }
  // The next one to watch: partway through, or the first unwatched after the last one watched.
  async function nextUp(server, seriesId) {
    const all = await allEpisodes(server, seriesId);
    const partway = all.find((e) => e.position > 0);
    if (partway) return partway;
    let last = -1;
    all.forEach((e, i) => { if (e.played) last = i; });
    return all[last + 1] || null;
  }
  async function seriesTmdbId(server, seriesId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(seriesId)}`, { includeGuids: '1' });
    const it = (mc(r).Metadata || [])[0];
    return it ? tmdbOf(it) : null;
  }

  // "Continue watching": Plex's On Deck has both what you're partway through and the next episodes.
  async function onDeck(server, limit) {
    const r = await get(server, '/library/onDeck', { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit * 2), includeGuids: '1' });
    return (mc(r).Metadata || []).filter((it) => it.type === 'movie' || it.type === 'episode');
  }
  async function resumeItems(server, limit = 24) {
    return (await onDeck(server, limit)).filter((it) => it.viewOffset > 0).slice(0, limit).map(playable);
  }
  async function nextUpItems(server, limit = 24) {
    return (await onDeck(server, limit)).filter((it) => !it.viewOffset && it.type === 'episode').slice(0, limit).map(playable);
  }
  // (Seeds for "Inspired by what you've watched": the films and shows you're watching now.)
  async function recentlyPlayedTmdb(server, limit = 12) {
    const items = await onDeck(server, limit);
    const seeds = [];
    for (const it of items) {
      if (it.type === 'movie' && tmdbOf(it)) seeds.push({ kind: 'movie', id: tmdbOf(it) });
      if (it.type === 'episode' && it.grandparentRatingKey) {
        const id = await seriesTmdbId(server, it.grandparentRatingKey).catch(() => null);
        if (id) seeds.push({ kind: 'tv', id });
      }
      if (seeds.length >= limit) break;
    }
    const seen = new Set();
    return seeds.filter((x) => !seen.has(x.kind + x.id) && seen.add(x.kind + x.id));
  }

  // Your whole library, alphabetically, a page at a time, across every library of that kind.
  // letter jumps to that letter (in the first library) and carries on from there.
  async function library(server, { type, start = 0, limit = 60, letter = null }) {
    const ptype = type === 'tv' ? 'show' : 'movie';
    const libs = await sections(server, ptype);
    let skip = start;
    const items = [];
    let total = 0;
    for (const d of libs) {
      let offset = 0;
      if (letter && /^[A-Z]$/.test(letter) && d === libs[0]) {
        const chars = mc(await get(server, `/library/sections/${d.key}/firstCharacter`, { type: ptype === 'show' ? '2' : '1' }).catch(() => null)).Directory || [];
        for (const c of chars) { if (String(c.title).toUpperCase() >= letter) break; offset += c.size || 0; }
      }
      const want = limit - items.length;
      const r = await get(server, `/library/sections/${d.key}/all`, {
        type: ptype === 'show' ? '2' : '1', sort: 'titleSort', includeGuids: '1',
        'X-Plex-Container-Start': String(offset + skip), 'X-Plex-Container-Size': String(Math.max(0, want)),
      });
      const size = (mc(r).totalSize ?? mc(r).size ?? 0) - offset;
      total += size;
      if (want > 0) items.push(...(mc(r).Metadata || []).map(playable));
      skip = Math.max(0, skip - size);
    }
    return { items, more: start + items.length < total };
  }

  // ---------------------------------------------------------------- playing (in mpv)

  // The original file, straight from the server (mpv sends the token as a header).
  const streamUrl = (server, itemId, item) => (item && item.partKey ? `${server.url}${item.partKey}` : null);

  async function details(server, itemId) {
    const r = await get(server, `/library/metadata/${encodeURIComponent(itemId)}`, { includeMarkers: '1' });
    return (mc(r).Metadata || [])[0] || null;
  }
  // Intros and credits, when the server has found them (Plex Pass).
  async function segments(server, itemId) {
    try {
      const it = await details(server, itemId);
      return ((it && it.Marker) || [])
        .filter((m) => m.type === 'intro' || m.type === 'credits')
        .map((m) => ({ type: m.type, start: m.startTimeOffset / MS, end: m.endTimeOffset / MS }))
        .filter((g) => g.end > g.start);
    } catch { return []; }
  }
  async function playbackInfo(server, itemId) {
    const it = await details(server, itemId);
    const part = it && it.Media && it.Media[0] && it.Media[0].Part && it.Media[0].Part[0];
    if (!part) throw Object.assign(new Error('no media'), { code: 'no-media' });
    const subtitles = (part.Stream || []).filter((s) => s.streamType === 3 && s.key).map((s) => `${server.url}${s.key}`);
    return { playSessionId: '', mediaSourceId: String(part.id), url: `${server.url}${part.key}`, subtitles, duration: it.duration || 0 };
  }
  // Tells Plex where you are, so its "continue watching" and watched marks stay right.
  function report(server, stage, { itemId, seconds, paused, duration }) {
    const state = stage === 'stopped' ? 'stopped' : paused ? 'paused' : 'playing';
    const time = Math.max(0, Math.round((seconds || 0) * MS));
    const p = get(server, '/:/timeline', {
      ratingKey: itemId, key: `/library/metadata/${itemId}`, state, time: String(time),
      ...(duration ? { duration: String(Math.round(duration)) } : {}),
    }).catch(() => {});
    // Most of the way through when it stops: mark it watched.
    if (stage === 'stopped' && duration && time >= duration * 0.9) {
      get(server, '/:/scrobble', { identifier: 'com.plexapp.plugins.library', key: itemId }).catch(() => {});
    }
    return p;
  }

  // ---------------------------------------------------------------- music
  //
  // Albums in your music libraries, in the same shape as subsonic.js (the Music tab's
  // "Your servers" buttons and shelves). Songs play in mpv with the token as a header.

  const albumOf = (server, it) => ({
    kind: 'album', serverId: server.id, serverName: server.name, itemId: String(it.ratingKey), title: it.title || '',
    artist: it.parentTitle || '', artists: [it.parentTitle].filter(Boolean), year: it.year ? String(it.year) : '',
    cover: `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(it.ratingKey)}/Images/Primary`,
    releaseTypes: [it.subtype || ''].filter(Boolean).map((t) => String(t).toLowerCase()), compilation: false, mbid: '', songs: it.leafCount || 0,
  });
  async function musicAlbums(server, { title, artist } = {}, limit = 30) {
    const libs = await sections(server, 'artist');
    const out = [];
    await Promise.all(libs.map(async (d) => {
      if (artist && !title) {
        // An artist's albums: find the artist, then their albums.
        const r = await get(server, `/library/sections/${d.key}/all`, { type: '8', title: artist }).catch(() => null);
        for (const a of (mc(r).Metadata || []).filter((x) => simplify(x.title) === simplify(artist))) {
          const c = await get(server, `/library/metadata/${a.ratingKey}/children`).catch(() => null);
          out.push(...(mc(c).Metadata || []).filter((x) => x.type === 'album').map((x) => albumOf(server, x)));
        }
        return;
      }
      const r = await get(server, `/library/sections/${d.key}/all`, { type: '9', title, 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit) }).catch(() => null);
      out.push(...(mc(r).Metadata || []).map((x) => albumOf(server, x)));
    }));
    return out;
  }
  async function musicAlbum(server, id) {
    const [m, c] = await Promise.all([
      get(server, `/library/metadata/${encodeURIComponent(id)}`),
      get(server, `/library/metadata/${encodeURIComponent(id)}/children`),
    ]);
    const a = (mc(m).Metadata || [])[0];
    if (!a) throw Object.assign(new Error('gone'), { code: 'gone' });
    return {
      ...albumOf(server, a),
      tracks: (mc(c).Metadata || []).map((t) => {
        const part = t.Media && t.Media[0] && t.Media[0].Part && t.Media[0].Part[0];
        return { id: String(t.ratingKey), title: t.title || '', artist: t.originalTitle || t.grandparentTitle || '', n: t.index || 0, disc: t.parentIndex || 0, seconds: Math.round((t.duration || 0) / MS), url: part ? `${server.url}${part.key}` : null };
      }),
    };
  }
  // Songs by name (for playlists from elsewhere).
  async function musicSongs(server, title, limit = 15) {
    const libs = await sections(server, 'artist');
    const out = [];
    await Promise.all(libs.map(async (d) => {
      const r = await get(server, `/library/sections/${d.key}/all`, { type: '10', title, 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit) }).catch(() => null);
      for (const t of mc(r).Metadata || []) {
        const part = t.Media && t.Media[0] && t.Media[0].Part && t.Media[0].Part[0];
        if (part) out.push({ id: String(t.ratingKey), title: t.title || '', artist: t.originalTitle || t.grandparentTitle || '', album: t.parentTitle || '', seconds: Math.round((t.duration || 0) / MS), url: `${server.url}${part.key}` });
      }
    }));
    return out;
  }
  async function musicRecent(server, limit = 30) {
    const libs = await sections(server, 'artist');
    const out = [];
    for (const d of libs) {
      const r = await get(server, `/library/sections/${d.key}/recentlyAdded`, { type: '9', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit) }).catch(() => null);
      out.push(...(mc(r).Metadata || []).filter((x) => x.type === 'album').map((x) => albumOf(server, x)));
    }
    return out;
  }

  // Plex's own web app, at this title (when mpv isn't there to play it).
  const webUrl = (server, itemId) =>
    `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(server.machineId)}/details?key=${encodeURIComponent(`/library/metadata/${itemId}`)}`;

  // A picture from the server, sized for us: a poster or a wide backdrop.
  const imagePath = (itemId, kind) => {
    const src = `/library/metadata/${itemId}/${kind === 'Backdrop' ? 'art' : 'thumb'}`;
    const [w, h] = kind === 'Backdrop' ? [1280, 720] : kind === 'Logo' ? [240, 120] : [300, 450];
    return `/photo/:/transcode?${new URLSearchParams({ url: src, width: String(w), height: String(h), minSize: '1', upscale: '1' })}`;
  };

  return {
    pinStart, pinCheck, account, servers, reconnect, find, getItem, seasons, episodes, allEpisodes, nextUp, seriesTmdbId,
    resumeItems, nextUpItems, recentlyPlayedTmdb, library, streamUrl, segments, playbackInfo, report, webUrl, imagePath,
    headers, musicAlbums, musicAlbum, musicRecent, musicSongs,
  };
}

module.exports = { createPlex, simplify };
