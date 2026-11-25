'use strict';

// Trakt: keeps track of what you watch anywhere, and suggests what to watch next.
// Uses your own Trakt API app (its Client ID; apps made since October 2026 have no Client Secret,
// and older ones that have one can still use it), and signs in with a code shown on the TV
// (Trakt's "device" sign-in: enter the code at trakt.tv/activate on any phone or computer).
// Titles are matched by TMDB id, which Trakt includes for everything.

const BASE = 'https://api.trakt.tv';
// Sign-in calls move to auth.trakt.tv (required from February 2027); api.trakt.tv is the fallback.
const AUTH_HOSTS = ['https://auth.trakt.tv', 'https://api.trakt.tv'];
const NO_SECRET_REDIRECTS = ['urn:ietf:wg:oauth:2.0:oob', 'http://localhost'];
const ID_PATTERN = /\b[a-f0-9]{64}\b/gi;

const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

function createTrakt({ getAuth, saveAuth, version = '0.1.0' }) {
  const headers = (clientId, token) => ({
    'content-type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
    'user-agent': `sofa-king/${version}`,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function raw(method, path, { clientId, token, body, query, base = BASE } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    try {
      return await fetch(url, {
        method, headers: headers(clientId, token),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw fail('failed', 'unreachable');
    }
  }

  // ------------------------------------------------------------ signing in

  // Sign-in calls: auth.trakt.tv first, api.trakt.tv if that can't be reached.
  async function authCall(path, opts) {
    let lastErr = null;
    for (const base of AUTH_HOSTS) {
      try {
        const res = await raw('POST', path, { ...opts, base });
        if (res.status === 404 && base !== AUTH_HOSTS[AUTH_HOSTS.length - 1] && path !== '/oauth/device/token') continue;
        return res;
      } catch (err) { lastErr = err; }
    }
    throw lastErr || fail('failed');
  }
  const withSecret = (body, secret) => (secret ? { ...body, client_secret: secret } : body);

  // Step 1: a code to show on the TV. Also proves the client id is real.
  async function deviceCode(clientId) {
    const res = await authCall('/oauth/device/code', { clientId, body: { client_id: clientId } });
    if (res.status === 401 || res.status === 403 || res.status === 404) throw fail('bad-client');
    if (!res.ok) throw fail('failed', `HTTP ${res.status}`);
    const j = await res.json();
    return {
      deviceCode: j.device_code, userCode: j.user_code, url: j.verification_url || 'https://trakt.tv/activate',
      expiresIn: j.expires_in || 600, interval: j.interval || 5,
    };
  }

  // Step 2: ask whether the code has been entered yet.
  // -> { tokens } | { pending: true } | { slowDown: true }; throws 'expired', 'denied', 'bad-secret'.
  async function checkDevice(clientId, clientSecret, code) {
    const res = await authCall('/oauth/device/token', { clientId, body: withSecret({ code, client_id: clientId }, clientSecret) });
    if (res.status === 200) return { tokens: tokensFrom(await res.json()) };
    if (res.status === 400) return { pending: true };
    if (res.status === 429) return { slowDown: true };
    if (res.status === 404 || res.status === 409 || res.status === 410) throw fail('expired');
    if (res.status === 418) throw fail('denied');
    if (res.status === 401 || res.status === 403) throw fail('bad-secret');
    throw fail('failed', `HTTP ${res.status}`);
  }

  function tokensFrom(j) {
    const created = (j.created_at ? j.created_at * 1000 : Date.now());
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: created + (j.expires_in || 86400) * 1000 };
  }

  // Refresh tokens work once each, so the new pair is saved straight away. Apps without a secret
  // are checked against their redirect addresses: try the ones the setup guide asks for.
  async function refresh(auth) {
    const redirects = auth.redirectUri ? [auth.redirectUri, ...NO_SECRET_REDIRECTS.filter((r) => r !== auth.redirectUri)] : NO_SECRET_REDIRECTS;
    let res = null;
    let used = null;
    for (const redirect of redirects) {
      res = await authCall('/oauth/token', {
        clientId: auth.clientId,
        body: withSecret({ refresh_token: auth.refreshToken, client_id: auth.clientId, redirect_uri: redirect, grant_type: 'refresh_token' }, auth.clientSecret),
      });
      used = redirect;
      if (res.ok) break;
      const text = await res.clone().text().catch(() => '');
      if (!/redirect/i.test(text)) break; // a different problem: don't keep trying
    }
    if (res.ok) {
      const next = { ...auth, ...tokensFrom(await res.json()), redirectUri: used };
      saveAuth(next);
      return next;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      saveAuth({ ...auth, accessToken: '', refreshToken: '', expiresAt: 0 });
      throw fail('signed-out');
    }
    throw fail('failed', `HTTP ${res.status}`);
  }

  // A signed-in request. Refreshes the sign-in when it's about to run out, or when Trakt says it has.
  async function call(method, path, opts = {}) {
    let auth = getAuth();
    if (!auth || !auth.clientId || !auth.accessToken) throw fail('signed-out');
    if (auth.expiresAt && auth.expiresAt - Date.now() < 10 * 60 * 1000) auth = await refresh(auth);
    let res = await raw(method, path, { ...opts, clientId: auth.clientId, token: auth.accessToken });
    if (res.status === 401) {
      auth = await refresh(auth);
      res = await raw(method, path, { ...opts, clientId: auth.clientId, token: auth.accessToken });
    }
    if (res.status === 401) throw fail('signed-out');
    if (res.status === 409) return null; // e.g. scrobbled the same thing twice in a row
    if (!res.ok) throw fail('failed', `HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  // ------------------------------------------------------------ what we use

  async function user() {
    const s = await call('GET', '/users/settings');
    return { username: (s && s.user && (s.user.name || s.user.username)) || '', slug: s && s.user && s.user.ids && s.user.ids.slug };
  }

  // Trakt items -> { kind: 'movie'|'tv', id: tmdbId }
  const ref = (it) => {
    if (it.movie && it.movie.ids && it.movie.ids.tmdb) return { kind: 'movie', id: it.movie.ids.tmdb };
    if (it.show && it.show.ids && it.show.ids.tmdb) return { kind: 'tv', id: it.show.ids.tmdb };
    if (it.ids && it.ids.tmdb) return { kind: it.first_aired !== undefined || it.network !== undefined ? 'tv' : 'movie', id: it.ids.tmdb };
    return null;
  };

  async function recommendations(limit = 24) {
    const q = { limit: String(limit), ignore_collected: 'true', ignore_watchlisted: 'true' };
    const [movies, shows] = await Promise.all([
      call('GET', '/recommendations/movies', { query: q }).catch(() => []),
      call('GET', '/recommendations/shows', { query: q }).catch(() => []),
    ]);
    const m = (movies || []).filter((x) => x.ids && x.ids.tmdb).map((x) => ({ kind: 'movie', id: x.ids.tmdb }));
    const s = (shows || []).filter((x) => x.ids && x.ids.tmdb).map((x) => ({ kind: 'tv', id: x.ids.tmdb }));
    const out = [];
    for (let i = 0; i < Math.max(m.length, s.length); i++) { if (m[i]) out.push(m[i]); if (s[i]) out.push(s[i]); }
    return out;
  }

  let watchlistCache = null;
  async function watchlist() {
    if (watchlistCache && Date.now() - watchlistCache.at < 5 * 60 * 1000) return watchlistCache.list;
    const [movies, shows] = await Promise.all([
      call('GET', '/sync/watchlist/movies/added'), call('GET', '/sync/watchlist/shows/added'),
    ]);
    const list = [...(movies || []), ...(shows || [])]
      .sort((a, b) => String(b.listed_at || '').localeCompare(String(a.listed_at || '')))
      .map(ref).filter(Boolean);
    watchlistCache = { at: Date.now(), list };
    return list;
  }

  async function onWatchlist(kind, id) {
    return (await watchlist()).some((x) => x.kind === kind && x.id === id);
  }

  const bodyFor = (kind, id) => (kind === 'tv' ? { shows: [{ ids: { tmdb: id } }] } : { movies: [{ ids: { tmdb: id } }] });

  async function setWatchlist(kind, id, on) {
    await call('POST', on ? '/sync/watchlist' : '/sync/watchlist/remove', { body: bodyFor(kind, id) });
    watchlistCache = null;
  }

  async function markWatched(kind, id) {
    await call('POST', '/sync/history', { body: bodyFor(kind, id) });
  }

  // Recently watched titles (anywhere you track with Trakt): seeds for suggestions.
  async function recentlyWatched(limit = 12) {
    const items = await call('GET', '/sync/history', { query: { limit: String(limit * 3) } });
    const seen = new Set();
    return (items || []).map(ref).filter((r) => r && !seen.has(r.kind + r.id) && seen.add(r.kind + r.id)).slice(0, limit);
  }

  // Playback in mpv: start / pause / stop, with how far through (0-100). Trakt marks it watched
  // when it stops past 80%.
  // what: { kind: 'movie', tmdbId } or { kind: 'episode', showTmdbId, season, episode }
  async function scrobble(action, what, progress) {
    const body = what.kind === 'movie'
      ? { movie: { ids: { tmdb: what.tmdbId } } }
      : { show: { ids: { tmdb: what.showTmdbId } }, episode: { season: what.season, number: what.episode } };
    return call('POST', `/scrobble/${action}`, { body: { ...body, progress: Math.max(0, Math.min(100, Number(progress) || 0)) } });
  }

  // The Client ID (and, for older apps, the Client Secret), read from text: a paste, or Trakt's
  // app page. Older apps' codes are 64 hex characters; Trakt doesn't promise a format for new ones,
  // so anything code-like is accepted here and Trakt itself says whether it's real.
  // pasted: the text is something the person pasted (so one bare code on its own is the Client ID).
  const CODE = '[A-Za-z0-9][A-Za-z0-9_.~-]{15,127}';
  function findCredentials(text, { pasted = true } = {}) {
    const t = String(text || '');
    const id = new RegExp(`client\\s*id\\W{0,40}?(${CODE})`, 'i').exec(t);
    const secret = new RegExp(`client\\s*secret\\W{0,40}?(${CODE})`, 'i').exec(t);
    const okSecret = secret && !/^not\b/i.test(secret[1]) ? secret[1] : '';
    if (id) return { clientId: id[1], clientSecret: okSecret, labelled: true };
    const hex = [...new Set(t.match(ID_PATTERN) || [])];
    if (!pasted) return hex.length ? { clientId: hex[0], clientSecret: hex[1] || '', labelled: hex.length < 2 } : null;
    const codes = [...new Set(t.split(/[\s,;]+/).filter((w) => new RegExp(`^${CODE}$`).test(w) && /\d/.test(w)))];
    if (codes.length === 1) return { clientId: codes[0], clientSecret: '', labelled: true };
    return codes.length >= 2 ? { clientId: codes[0], clientSecret: codes[1], labelled: false } : null;
  }

  return {
    deviceCode, checkDevice, user, recommendations, watchlist, onWatchlist, setWatchlist, markWatched,
    recentlyWatched, scrobble, findCredentials, forget: () => { watchlistCache = null; },
  };
}

module.exports = { createTrakt };
