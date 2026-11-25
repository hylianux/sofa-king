'use strict';

// Watchmode: a second where-to-watch source. TMDB's data (from JustWatch) often misses titles on
// free services like Tubi, Pluto TV and The Roku Channel; Watchmode tracks them. The free plan
// gives 2,500 credits a month, and each title costs 1-2, so answers are cached for a day.

const fs = require('fs');

const BASE = 'https://api.watchmode.com/v1';
const DAY = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9]{20,64}$/;

function createWatchmode({ getKey, getRegion, cacheFile }) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {}; } catch { cache = {}; }
  let saveTimer = null;
  const saveCache = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const now = Date.now();
      for (const [k, v] of Object.entries(cache)) if (now - v.at > DAY) delete cache[k];
      try { fs.writeFileSync(cacheFile, JSON.stringify(cache), { mode: 0o600 }); } catch { /* cache is optional */ }
    }, 1000);
  };

  async function get(path, query = {}, key = getKey()) {
    if (!key) throw Object.assign(new Error('no key'), { code: 'no-key' });
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url, { headers: { 'X-API-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    } catch {
      throw Object.assign(new Error('unreachable'), { code: 'failed' });
    }
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('bad key'), { code: 'bad-key' });
    if (res.status === 429) throw Object.assign(new Error('quota'), { code: 'quota' });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'failed' });
    return res.json();
  }

  // Checks a key, and how much of this month's allowance is used (the status call is free).
  async function validate(key) {
    if (!KEY_PATTERN.test(key)) return { error: 'not-a-key' };
    try {
      const s = await get('/status/', {}, key);
      return { ok: true, used: s && s.quotaUsed, quota: s && s.quota };
    } catch (err) {
      return { error: err.code || 'failed' };
    }
  }

  async function status() {
    try {
      const s = await get('/status/');
      return { used: s && s.quotaUsed, quota: s && s.quota };
    } catch (err) {
      return { error: err.code || 'failed' };
    }
  }

  // Every place a TMDB title is available in your region:
  // [{ name, type: 'sub'|'free'|'rent'|'buy'|'tve', url }]
  async function sources(kind, tmdbId) {
    const region = getRegion();
    const ck = `${kind}:${tmdbId}:${region}`;
    if (cache[ck] && Date.now() - cache[ck].at < DAY) return cache[ck].list;
    let raw = await get(`/title/${kind === 'tv' ? 'tv' : 'movie'}-${tmdbId}/sources/`, { regions: region });
    if (raw === null) {
      // Older ids: look the title up by its TMDB id first.
      const found = await get('/search/', { search_field: kind === 'tv' ? 'tmdb_tv_id' : 'tmdb_movie_id', search_value: String(tmdbId) });
      const hit = found && (found.title_results || [])[0];
      raw = hit ? await get(`/title/${hit.id}/sources/`, { regions: region }) : [];
    }
    const byKey = new Map();
    for (const s of Array.isArray(raw) ? raw : []) {
      if (s.region && s.region !== region) continue;
      const type = s.type === 'purchase' ? 'buy' : s.type;
      const key = `${s.name}|${type}`;
      const url = typeof s.web_url === 'string' && /^https:\/\//.test(s.web_url) ? s.web_url : null;
      const price = typeof s.price === 'number' && s.price > 0 ? s.price : null;
      const had = byKey.get(key);
      if (!had) { byKey.set(key, { name: String(s.name || ''), type, url, price }); continue; }
      // One entry per format (SD, HD, 4K): keep the cheapest price, and any link.
      if (price != null && (had.price == null || price < had.price)) had.price = price;
      if (!had.url && url) had.url = url;
    }
    const list = [...byKey.values()];
    cache[ck] = { at: Date.now(), list };
    saveCache();
    return list;
  }

  return { validate, status, sources, KEY_PATTERN };
}

module.exports = { createWatchmode, KEY_PATTERN };
