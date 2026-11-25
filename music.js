'use strict';

// The music catalogue: find an artist, album or song first, then show where it's streaming.
//
// - MusicBrainz (free, no key) knows every release and what kind it is: album, EP, single, live,
//   compilation, bootleg, and which albums are tributes to an artist. It asks for at most one
//   request a second, so all requests to it wait their turn here.
// - The Cover Art Archive has the pictures for MusicBrainz releases.
// - Deezer's search (free, no key) is quick, has pictures, and gives a direct Deezer link.
// - Apple's search (free, no key) gives a direct Apple Music link.
// - Anything else (Spotify, YouTube Music, Tidal, Amazon Music) gets a direct link when
//   MusicBrainz has one, and otherwise opens that service's search for the album.
// - Related artists: ListenBrainz (free, no key), or Last.fm when you've added its free key.
// - "Made for you" playlists: ListenBrainz, for the user name you give it (its playlists are public).
// Nothing here sends anything about you: only what you searched for (and your ListenBrainz name).

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const DEEZER = 'https://api.deezer.com';
const ITUNES = 'https://itunes.apple.com';
const LB = 'https://api.listenbrainz.org/1';
const LB_LABS = 'https://labs.api.listenbrainz.org';
const LASTFM = 'https://ws.audioscrobbler.com/2.0/';
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UA = 'SOFAKing/0.1 ( music catalogue lookups )';
const CACHE_MS = 60 * 60 * 1000;

// The music services an album can be opened on (as websites, like the video services).
const MUSIC_SERVICES = [
  { id: 'spotify', name: 'Spotify', color: '#1DB954', url: 'https://open.spotify.com', searchUrl: 'https://open.spotify.com/search/{q}', host: /(^|\.)spotify\.com$/ },
  { id: 'apple-music', name: 'Apple Music', color: '#FA243C', url: 'https://music.apple.com', searchUrl: 'https://music.apple.com/us/search?term={q}', host: /(^|\.)music\.apple\.com$|(^|\.)itunes\.apple\.com$/ },
  { id: 'youtube-music', name: 'YouTube Music', color: '#FF0033', url: 'https://music.youtube.com', searchUrl: 'https://music.youtube.com/search?q={q}', host: /(^|\.)music\.youtube\.com$/ },
  { id: 'deezer', name: 'Deezer', color: '#A238FF', url: 'https://www.deezer.com', searchUrl: 'https://www.deezer.com/search/{q}', host: /(^|\.)deezer\.com$/ },
  { id: 'tidal', name: 'Tidal', color: '#33FFEE', url: 'https://listen.tidal.com', searchUrl: 'https://listen.tidal.com/search?q={q}', host: /(^|\.)tidal\.com$/ },
  { id: 'amazon-music', name: 'Amazon Music', color: '#25D1DA', url: 'https://music.amazon.com', searchUrl: 'https://music.amazon.com/search/{q}', host: /(^|\.)music\.amazon\.[a-z.]+$/ },
  { id: 'bandcamp', name: 'Bandcamp', color: '#1DA0C3', url: 'https://bandcamp.com', searchUrl: 'https://bandcamp.com/search?q={q}', host: /(^|\.)bandcamp\.com$/, directOnly: true },
];

// The shelves on an artist's page, in order.
const SHELVES = [
  { id: 'album', title: 'Albums' },
  { id: 'ep', title: 'EPs' },
  { id: 'single', title: 'Singles' },
  { id: 'live', title: 'Live' },
  { id: 'compilation', title: 'Compilations' },
  { id: 'soundtrack', title: 'Soundtracks' },
  { id: 'remix', title: 'Remixes' },
  { id: 'demo', title: 'Demos' },
  { id: 'other', title: 'Other releases' },
  { id: 'unofficial', title: 'Unofficial' },
  { id: 'unofficial-live', title: 'Unofficial live recordings' },
  { id: 'tribute', title: 'Tributes and covers' },
  { id: 'appears', title: 'Appears on' },
];

// "Nevermind (Remastered) [Deluxe]" and "nevermind" match; so do "AC/DC" and "ac dc".
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+(single|ep)$/, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const year = (d) => (d ? String(d).slice(0, 4) : '');

// What kind of release a MusicBrainz release group is: one of the shelf ids.
function shelfOf(g) {
  const sec = g['secondary-types'] || [];
  if (sec.includes('Live')) return 'live';
  if (sec.includes('Compilation')) return 'compilation';
  if (sec.includes('Soundtrack')) return 'soundtrack';
  if (sec.includes('Remix') || sec.includes('DJ-mix') || sec.includes('Mixtape/Street')) return 'remix';
  if (sec.includes('Demo')) return 'demo';
  if (sec.length) return 'other';
  return { Album: 'album', EP: 'ep', Single: 'single' }[g['primary-type']] || 'other';
}
const TYPE_NAMES = { album: 'Album', ep: 'EP', single: 'Single', live: 'Live', compilation: 'Compilation', soundtrack: 'Soundtrack', remix: 'Remixes', demo: 'Demo', other: 'Other' };

function createMusic({ getRegion = () => 'US', getServices = () => null, log = { debug() {} } } = {}) {
  const cache = new Map();
  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return value;
  };

  async function getJson(url, { headers = {}, timeout = 12000 } = {}) {
    let res;
    const started = Date.now();
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      log.debug(`[music] ${new URL(url).host}${new URL(url).pathname} failed: ${err.name === 'TimeoutError' ? 'no answer' : err.message}`);
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    log.debug(`[music] ${new URL(url).host}${new URL(url).pathname} -> ${res.status} (${Date.now() - started} ms)`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status === 503 ? 'busy' : res.status === 404 ? 'not-found' : 'failed', status: res.status });
    return res.json();
  }

  // MusicBrainz: one request at a time, a little over a second apart. When it's busy, try again
  // a couple of times.
  let mbChain = Promise.resolve();
  let mbLast = 0;
  function mb(pathname, params = {}) {
    const url = new URL(MB + pathname);
    for (const [k, v] of Object.entries({ ...params, fmt: 'json' })) url.searchParams.set(k, v);
    return cached(url.toString(), () => {
      const run = mbChain.then(async () => {
        for (let attempt = 0; ; attempt++) {
          const wait = mbLast + 1100 - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          mbLast = Date.now();
          try {
            return await getJson(url.toString());
          } catch (err) {
            if (err.code !== 'busy' || attempt >= 2) throw err;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      });
      mbChain = run.catch(() => {});
      return run;
    });
  }
  const deezer = (pathname, params = {}) => {
    const url = new URL(DEEZER + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return cached(url.toString(), async () => {
      const j = await getJson(url.toString());
      if (j && j.error) throw Object.assign(new Error('deezer'), { code: j.error.code === 800 ? 'not-found' : 'failed' });
      return j;
    });
  };
  const itunes = (params) => {
    const url = new URL(`${ITUNES}/search`);
    for (const [k, v] of Object.entries({ country: String(getRegion() || 'US').toLowerCase(), limit: 15, ...params })) url.searchParams.set(k, v);
    return cached(url.toString(), () => getJson(url.toString()));
  };

  // ---------------------------------------------------------------- shapes the pages use

  const coverOf = (mbid, size = 250) => (mbid ? `${CAA}/release-group/${mbid}/front-${size}` : '');
  const credit = (ac) => (ac || []).map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();

  const fromGroup = (g, extra = {}) => ({
    kind: 'album', mbid: g.id, title: g.title, artist: credit(g['artist-credit']), year: year(g['first-release-date']),
    shelf: shelfOf(g), type: TYPE_NAMES[shelfOf(g)], cover: coverOf(g.id), ...extra,
  });
  const fromDeezerAlbum = (a) => ({
    kind: 'album', deezerId: a.id, title: a.title, artist: (a.artist && a.artist.name) || '', year: year(a.release_date),
    type: { album: 'Album', ep: 'EP', single: 'Single', compile: 'Compilation' }[a.record_type] || '', cover: a.cover_big || a.cover_medium || '',
    deezerLink: a.link || '',
  });
  const fromDeezerArtist = (a) => ({ kind: 'artist', deezerId: a.id, name: a.name, picture: a.picture_big || a.picture_medium || '', fans: a.nb_fan || 0 });
  const fromDeezerTrack = (t) => ({
    kind: 'song', deezerId: t.id, title: t.title, artist: (t.artist && t.artist.name) || '', album: (t.album && t.album.title) || '',
    albumDeezerId: t.album && t.album.id, cover: (t.album && (t.album.cover_big || t.album.cover_medium)) || '', seconds: t.duration || 0,
    deezerLink: t.link || '',
  });

  // ---------------------------------------------------------------- search

  // Artists, albums and songs for what you typed. Deezer answers fast with pictures; MusicBrainz
  // adds releases Deezer doesn't have (bootlegs like Outcesticide, old promos, tributes).
  async function search(query) {
    const q = String(query || '').trim().slice(0, 100);
    if (!q) return { artists: [], albums: [], songs: [] };
    const [artists, albums, songs, groups] = await Promise.allSettled([
      deezer('/search/artist', { q, limit: 12 }),
      deezer('/search/album', { q, limit: 24 }),
      deezer('/search/track', { q, limit: 24 }),
      mb('/release-group', { query: q, limit: 25 }),
    ]);
    const ok = (r) => (r.status === 'fulfilled' && r.value) || null;
    if (!ok(artists) && !ok(albums) && !ok(songs) && !ok(groups)) throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    const out = {
      artists: ((ok(artists) || {}).data || []).map(fromDeezerArtist),
      albums: ((ok(albums) || {}).data || []).map(fromDeezerAlbum),
      songs: ((ok(songs) || {}).data || []).map(fromDeezerTrack),
    };
    // Releases only MusicBrainz knows, after Deezer's (the closest matches only).
    const have = new Set(out.albums.map((a) => `${norm(a.artist)}|${norm(a.title)}`));
    for (const g of (ok(groups) || {})['release-groups'] || []) {
      if ((g.score || 0) < 80) continue;
      const a = fromGroup(g);
      const statuses = (g.releases || []).map((r) => r.status).filter(Boolean);
      if (statuses.length && statuses.every((s) => s === 'Bootleg')) { a.unofficial = true; a.type = 'Unofficial'; }
      const k = `${norm(a.artist)}|${norm(a.title)}`;
      if (have.has(k)) continue;
      have.add(k);
      out.albums.push(a);
    }
    return out;
  }

  // ---------------------------------------------------------------- an artist's page

  // The MusicBrainz artist for a name (the best match, as MusicBrainz ranks them).
  async function findArtist(name) {
    const r = await mb('/artist', { query: `artist:"${String(name).replace(/"/g, '')}"`, limit: 5 });
    const list = r.artists || [];
    return list.find((a) => norm(a.name) === norm(name)) || list[0] || null;
  }
  async function deezerArtistFor(name) {
    try {
      const r = await deezer('/search/artist', { q: name, limit: 5 });
      const same = (r.data || []).filter((a) => norm(a.name) === norm(name)).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
      return same[0] || null;
    } catch { return null; }
  }

  // Everything official, sorted onto shelves (newest first). The unofficial and tribute shelves
  // come separately (artistExtra), so the page can show this much first.
  async function artist({ name, mbid, deezerId }) {
    const [a, dzFirst] = await Promise.all([
      mbid ? mb(`/artist/${mbid}`, {}) : name ? findArtist(name) : null,
      deezerId ? deezer(`/artist/${deezerId}`).catch(() => null) : name ? deezerArtistFor(name) : null,
    ]);
    const shownName = (a && a.name) || name || '';
    const dz = dzFirst || (!name && shownName ? await deezerArtistFor(shownName) : null);
    const out = {
      name: shownName, mbid: a ? a.id : null, deezerId: dz ? dz.id : null,
      picture: dz ? dz.picture_xl || dz.picture_big || '' : '',
      about: a ? [a.disambiguation, a.area && a.area.name, a['life-span'] && year(a['life-span'].begin) && `${year(a['life-span'].begin)}${a['life-span'].ended ? `–${year(a['life-span'].end)}` : ''}`].filter(Boolean).join(' · ') : '',
      shelves: [],
    };
    if (!a) {
      // Not in MusicBrainz: Deezer's list of albums is all there is.
      if (dz) {
        const r = await deezer(`/artist/${dz.id}/albums`, { limit: 100 }).catch(() => ({ data: [] }));
        const items = (r.data || []).map((x) => ({ ...fromDeezerAlbum(x), artist: shownName }));
        for (const s of SHELVES) {
          const of = items.filter((x) => (x.type || 'Album').toLowerCase() === s.id || (s.id === 'compilation' && x.type === 'Compilation'));
          if (of.length) out.shelves.push({ id: s.id, title: s.title, items: of });
        }
      }
      return out;
    }
    const groups = [];
    for (let offset = 0; offset < 400; offset += 100) {
      const r = await mb('/release-group', { artist: a.id, 'release-group-status': 'website-default', limit: 100, offset });
      groups.push(...(r['release-groups'] || []));
      if (groups.length >= (r['release-group-count'] || 0)) break;
    }
    const items = groups.map((g) => fromGroup(g, { artist: credit(g['artist-credit']) || shownName }))
      .sort((x, y) => String(y.year).localeCompare(String(x.year)) || x.title.localeCompare(y.title));
    for (const s of SHELVES) {
      const of = items.filter((x) => x.shelf === s.id);
      if (of.length) out.shelves.push({ id: s.id, title: s.title, items: of });
    }
    return out;
  }

  // The shelves that take longer: unofficial releases (bootlegs) and tributes to the artist.
  async function artistExtra(mbid, which) {
    if (!/^[0-9a-f-]{36}$/.test(String(mbid))) return [];
    if (which === 'appears') return appearsOn(mbid);
    if (which === 'tribute') {
      const a = await mb(`/artist/${mbid}`, { inc: 'release-group-rels' });
      return (a.relations || []).filter((r) => r.type === 'tribute' && r.release_group)
        .map((r) => fromGroup(r.release_group, { artist: '', tribute: true, type: 'Tribute' }))
        .sort((x, y) => String(y.year).localeCompare(String(x.year)));
    }
    // Bootlegs: release groups whose releases are all bootlegs (an official album with a bootleg
    // pressing stays on its own shelf).
    const live = which === 'unofficial-live';
    const found = [];
    for (let offset = 0; offset < (live ? 100 : 300); offset += 100) {
      const r = await mb('/release-group', { query: `arid:${mbid} AND status:bootleg AND ${live ? '' : 'NOT '}secondarytype:live`, limit: 100, offset });
      const list = r['release-groups'] || [];
      for (const g of list) {
        const statuses = (g.releases || []).map((x) => x.status).filter(Boolean);
        if (statuses.length && statuses.every((s) => s === 'Bootleg')) found.push(fromGroup(g, { unofficial: true, type: live ? 'Unofficial live' : 'Unofficial' }));
      }
      if (offset + 100 >= (r.count || 0)) break;
    }
    return found.sort((x, y) => String(x.year).localeCompare(String(y.year)) || x.title.localeCompare(y.title));
  }

  // Albums by others the artist appears on: compilations, soundtracks, split singles. (Releases
  // with one of their songs, but not credited to them.) The newest first.
  async function appearsOn(mbid) {
    const groups = new Map();
    for (let offset = 0; offset < 200; offset += 100) {
      const r = await mb('/release', { track_artist: mbid, inc: 'release-groups+artist-credits', status: 'official', limit: 100, offset });
      for (const rel of r.releases || []) {
        const g = rel['release-group'];
        if (!g || groups.has(g.id)) continue;
        if ((rel['artist-credit'] || []).some((c) => c.artist && c.artist.id === mbid)) continue; // their own
        groups.set(g.id, fromGroup({ ...g, 'first-release-date': g['first-release-date'] || rel.date }, { artist: credit(rel['artist-credit']), appears: true }));
      }
      if (offset + 100 >= (r['release-count'] || 0)) break;
    }
    return [...groups.values()].sort((x, y) => String(y.year).localeCompare(String(x.year)) || x.title.localeCompare(y.title));
  }

  // Which release group (all editions of an album) each release belongs to. Your servers know the
  // release (the exact edition) from its tags; the artist's page lists release groups.
  async function releaseGroups(releaseIds) {
    const out = {};
    for (const id of (releaseIds || []).filter((x) => MBID.test(String(x))).slice(0, 20)) {
      try {
        const r = await mb(`/release/${id}`, { inc: 'release-groups' });
        if (r['release-group']) out[id] = r['release-group'].id;
      } catch { /* not in MusicBrainz any more */ }
    }
    return out;
  }

  // ---------------------------------------------------------------- related artists

  // Artists like this one: from Last.fm when there's a key, else ListenBrainz (needs the
  // MusicBrainz id). Pictures come from Deezer.
  async function related({ mbid, name, lastfmKey }) {
    let list = [];
    if (lastfmKey) {
      const url = new URL(LASTFM);
      for (const [k, v] of Object.entries({ method: 'artist.getsimilar', ...(MBID.test(mbid || '') ? { mbid } : { artist: name }), limit: 20, autocorrect: 1, api_key: lastfmKey, format: 'json' })) url.searchParams.set(k, v);
      try {
        const j = await cached(url.toString(), () => getJson(url.toString()));
        list = ((j.similarartists && j.similarartists.artist) || []).map((a) => ({ name: a.name, mbid: MBID.test(a.mbid || '') ? a.mbid : null }));
      } catch (err) { log.debug('[music] last.fm related:', err.code || err.message); }
    }
    if (!list.length && MBID.test(mbid || '')) {
      const url = `${LB_LABS}/similar-artists/json?artist_mbids=${mbid}&algorithm=session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30`;
      const j = await cached(url, () => getJson(url)).catch(() => []);
      list = (Array.isArray(j) ? j : []).slice(0, 20).map((a) => ({ name: a.name, mbid: MBID.test(a.artist_mbid || '') ? a.artist_mbid : null }));
    }
    const pics = await Promise.all(list.map((a) => deezerArtistFor(a.name)));
    return list.map((a, i) => ({ kind: 'artist', name: a.name, mbid: a.mbid, deezerId: pics[i] ? pics[i].id : null, picture: pics[i] ? pics[i].picture_big || pics[i].picture_medium || '' : '' }));
  }
  // Checks a Last.fm key (it answers an error for a wrong one).
  async function lastfmCheck(key) {
    const url = new URL(LASTFM);
    for (const [k, v] of Object.entries({ method: 'artist.getinfo', artist: 'Nirvana', api_key: key, format: 'json' })) url.searchParams.set(k, v);
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }); } catch { throw Object.assign(new Error('unreachable'), { code: 'unreachable' }); }
    const j = await res.json().catch(() => ({}));
    log.debug(`[music] last.fm key check -> ${res.status}`);
    if (j.error === 10 || j.error === 26 || res.status === 403) throw Object.assign(new Error('bad key'), { code: 'bad-key' });
    if (!res.ok || j.error) throw Object.assign(new Error('failed'), { code: 'failed' });
    return true;
  }

  // ---------------------------------------------------------------- ListenBrainz: made for you

  const lbUser = (u) => String(u || '').trim().replace(/^.*listenbrainz\.org\/user\//i, '').replace(/\/.*$/, '');
  async function madeFor(user) {
    const u = lbUser(user);
    if (!/^[\w.@+-]{1,64}$/.test(u)) throw Object.assign(new Error('bad user'), { code: 'bad-user' });
    const url = `${LB}/user/${encodeURIComponent(u)}/playlists/createdfor?count=30`;
    let j;
    try { j = await getJson(url); } catch (err) { if (err.code === 'not-found') throw Object.assign(new Error('no user'), { code: 'no-user' }); throw err; }
    // Only the newest of each kind (Daily Jams, Weekly Jams, Weekly Exploration…).
    const seen = new Set();
    const out = [];
    for (const p of j.playlists || []) {
      const pl = p.playlist || {};
      const id = String(pl.identifier || '').split('/').pop();
      if (!MBID.test(id)) continue;
      const kind = String(pl.title || '').replace(/\s+for\s+.*$/i, '').trim();
      if (seen.has(kind)) continue;
      seen.add(kind);
      out.push({ kind: 'playlist', id, title: kind || pl.title, about: String(pl.annotation || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300), date: String(pl.date || '').slice(0, 10) });
    }
    return out;
  }
  async function playlist(id) {
    if (!MBID.test(String(id))) throw Object.assign(new Error('bad id'), { code: 'failed' });
    const j = await getJson(`${LB}/playlist/${id}`);
    const pl = j.playlist || {};
    const ext = (t) => (t.extension && t.extension['https://musicbrainz.org/doc/jspf#track']) || {};
    const tracks = (pl.track || []).slice(0, 200).map((t) => {
      const meta = ext(t).additional_metadata || {};
      return {
        title: String(t.title || ''), artist: String(t.creator || ''), album: String(t.album || ''), seconds: Math.round((t.duration || 0) / 1000),
        cover: MBID.test(meta.caa_release_mbid || '') ? `${CAA}/release/${meta.caa_release_mbid}/front-250` : '',
      };
    }).filter((t) => t.title);
    return { kind: 'playlist', id, title: String(pl.title || '').replace(/\s+for\s+.*$/i, '').trim(), about: String(pl.annotation || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400), tracks };
  }

  // ---------------------------------------------------------------- an album's page

  function serviceFor(url) {
    let host = '';
    try { host = new URL(url).hostname; } catch { return null; }
    return MUSIC_SERVICES.find((s) => s.host.test(host)) || null;
  }

  // Album details, its tracks, and where it's streaming. Takes whatever is known: a MusicBrainz
  // id, a Deezer id, or just the title and artist.
  async function album({ mbid, deezerId, title, artist: artistName }) {
    const out = { kind: 'album', mbid: mbid || null, deezerId: deezerId || null, title: title || '', artist: artistName || '', artistMbid: null, year: '', type: '', status: '', cover: '', label: '', tracks: [], links: [] };
    const direct = new Map(); // service id -> url

    // Deezer: tracks and a link.
    let dz = null;
    if (deezerId) dz = await deezer(`/album/${deezerId}`).catch(() => null);
    // MusicBrainz: what kind of release it is, its tracks when Deezer hasn't got it, and links.
    let g = null;
    if (mbid) g = await mb(`/release-group/${mbid}`, { inc: 'artist-credits+releases+url-rels' }).catch(() => null);
    else if (title) {
      const t = (dz && dz.title) || title;
      const ar = (dz && dz.artist && dz.artist.name) || artistName || '';
      const r = await mb('/release-group', { query: `releasegroup:"${norm(t)}"${ar ? ` AND artist:"${ar.replace(/"/g, '')}"` : ''}`, limit: 10 }).catch(() => null);
      const hit = r && (r['release-groups'] || []).find((x) => norm(x.title) === norm(t) && (!ar || norm(credit(x['artist-credit'])) === norm(ar)));
      if (hit) g = await mb(`/release-group/${hit.id}`, { inc: 'artist-credits+releases+url-rels' }).catch(() => null);
    }
    if (g) {
      out.mbid = g.id;
      out.title = g.title;
      out.artist = credit(g['artist-credit']) || out.artist;
      const first = (g['artist-credit'] || [])[0];
      out.artistMbid = first && first.artist ? first.artist.id : null;
      out.year = year(g['first-release-date']);
      out.type = TYPE_NAMES[shelfOf(g)];
      const statuses = (g.releases || []).map((x) => x.status).filter(Boolean);
      if (statuses.length && statuses.every((s) => s === 'Bootleg')) out.status = 'Unofficial';
      else if (statuses.length && statuses.every((s) => s === 'Promotion')) out.status = 'Promo';
      out.cover = coverOf(g.id, 500);
      for (const r of g.relations || []) { const s = r.url && serviceFor(r.url.resource); if (s && !direct.has(s.id)) direct.set(s.id, r.url.resource); }
    }
    if (!dz && out.title) {
      // Deezer's copy, by title and artist.
      const r = await deezer('/search/album', { q: `${out.artist} ${out.title}`.trim(), limit: 15 }).catch(() => null);
      const hit = r && (r.data || []).find((x) => norm(x.title) === norm(out.title) && (!out.artist || norm(x.artist && x.artist.name) === norm(out.artist)));
      if (hit) dz = await deezer(`/album/${hit.id}`).catch(() => null);
    }
    if (dz) {
      out.deezerId = dz.id;
      if (!out.title) out.title = dz.title;
      if (!out.artist) out.artist = (dz.artist && dz.artist.name) || '';
      if (!out.year) out.year = year(dz.release_date);
      if (!out.type) out.type = { album: 'Album', ep: 'EP', single: 'Single', compile: 'Compilation' }[dz.record_type] || '';
      out.cover = dz.cover_xl || dz.cover_big || out.cover;
      out.label = dz.label || '';
      out.tracks = ((dz.tracks && dz.tracks.data) || []).map((t, i) => ({ n: i + 1, title: t.title, seconds: t.duration || 0, deezerId: t.id }));
      if (dz.link) direct.set('deezer', dz.link);
    }
    if (!out.tracks.length && g && (g.releases || []).length) {
      // The first official release (or the first one) for the track list.
      const rel = [...g.releases].sort((x, y) => (x.status === 'Official' ? 0 : 1) - (y.status === 'Official' ? 0 : 1) || String(x.date || '9').localeCompare(String(y.date || '9')))[0];
      const r = await mb(`/release/${rel.id}`, { inc: 'recordings+url-rels' }).catch(() => null);
      if (r) {
        let n = 0;
        for (const m of r.media || []) for (const t of m.tracks || []) out.tracks.push({ n: ++n, title: t.title, seconds: Math.round((t.length || 0) / 1000), disc: (r.media.length > 1 ? m.position : 0) });
        if (!out.label && r['label-info'] && r['label-info'][0] && r['label-info'][0].label) out.label = r['label-info'][0].label.name;
        for (const x of r.relations || []) { const s = x.url && serviceFor(x.url.resource); if (s && !direct.has(s.id)) direct.set(s.id, x.url.resource); }
      }
    }
    if (!direct.has('apple-music') && out.title && out.artist && out.status !== 'Unofficial') {
      // Apple Music: the artist's albums from Apple's catalogue (its plain search misses big
      // albums), the same title, preferring the plain edition over deluxe ones.
      const albums = await appleAlbums(out.artist).catch(() => []);
      const same = albums.filter((x) => norm(x.collectionName) === norm(out.title));
      const hit = same.find((x) => x.collectionName.toLowerCase() === out.title.toLowerCase()) || same[0];
      if (hit && hit.collectionViewUrl) direct.set('apple-music', hit.collectionViewUrl.replace(/[?&]uo=\d+/, ''));
    }
    out.links = linksFor(direct, `${out.artist} ${out.title}`, out.status === 'Unofficial');
    return out;
  }

  async function appleAlbums(name) {
    const r = await itunes({ term: name, entity: 'musicArtist', limit: 5 });
    const a = (r.results || []).find((x) => norm(x.artistName) === norm(name));
    if (!a) return [];
    const url = new URL(`${ITUNES}/lookup`);
    for (const [k, v] of Object.entries({ id: a.artistId, entity: 'album', limit: 200, country: String(getRegion() || 'US').toLowerCase() })) url.searchParams.set(k, v);
    const l = await cached(url.toString(), () => getJson(url.toString()));
    return (l.results || []).filter((x) => x.wrapperType === 'collection');
  }

  // One button per service you use: straight to the album when we have its link, otherwise the
  // service's search. (Unofficial releases aren't on the services, so they only get direct links.)
  function linksFor(direct, query, unofficial) {
    const use = getServices();
    const links = [];
    for (const s of MUSIC_SERVICES) {
      if (use && !use.includes(s.id)) continue;
      if (direct.has(s.id)) links.push({ service: s.id, name: s.name, color: s.color, url: direct.get(s.id), direct: true });
      else if (!s.directOnly && !unofficial) links.push({ service: s.id, name: s.name, color: s.color, url: s.searchUrl.replace('{q}', encodeURIComponent(query.trim())), direct: false });
    }
    return links.sort((x, y) => Number(y.direct) - Number(x.direct));
  }

  // ---------------------------------------------------------------- the Music tab's rows

  async function charts() {
    const [albums, artists, tracks] = await Promise.allSettled([
      deezer('/chart/0/albums', { limit: 30 }), deezer('/chart/0/artists', { limit: 30 }), deezer('/chart/0/tracks', { limit: 30 }),
    ]);
    const data = (r) => (r.status === 'fulfilled' && r.value && r.value.data) || [];
    if (!data(albums).length && !data(artists).length && !data(tracks).length) throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    return [
      { id: 'top-albums', title: 'Popular albums', items: data(albums).map(fromDeezerAlbum) },
      { id: 'top-artists', title: 'Popular artists', items: data(artists).map(fromDeezerArtist) },
      { id: 'top-songs', title: 'Popular songs', items: data(tracks).map(fromDeezerTrack) },
    ].filter((r) => r.items.length);
  }

  return { search, artist, artistExtra, album, charts, serviceFor, releaseGroups, related, lastfmCheck, madeFor, playlist };
}

module.exports = { createMusic, MUSIC_SERVICES, SHELVES, norm };
