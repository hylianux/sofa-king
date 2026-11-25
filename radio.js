'use strict';

// Internet radio: stations from Radio Browser (a free, community-run list of tens of thousands of
// stations, no key), SomaFM's channels, and stations you add yourself (a stream address, or an M3U
// or PLS playlist). Stations play in mpv, which reads all of those.
//
// Radio Browser asks apps to name themselves and to report a "click" when a station is played (it
// keeps its popular lists honest); that's all it hears from us, apart from what you searched for.

const UA = 'SOFAKing/0.1';
const CACHE_MS = 30 * 60 * 1000;

// Only addresses mpv should open: http(s), nothing that could be read as an option or a file.
const okUrl = (u) => {
  try { const x = new URL(String(u)); return (x.protocol === 'http:' || x.protocol === 'https:') && !/\s/.test(String(u)); } catch { return false; }
};

function createRadio({ log = { debug() {} } } = {}) {
  const cache = new Map();
  async function getJson(url, timeout = 10000) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.json;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      log.debug(`[radio] ${new URL(url).host}${new URL(url).pathname} failed: ${err.name === 'TimeoutError' ? 'no answer' : err.message}`);
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    log.debug(`[radio] ${new URL(url).host}${new URL(url).pathname} -> ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'failed' });
    const json = await res.json();
    cache.set(url, { at: Date.now(), json });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return json;
  }

  // Radio Browser runs on several servers; ask which ones are up and use one of them.
  let base = null;
  async function rb(pathname, params = {}) {
    if (!base) {
      try {
        const list = await getJson('https://all.api.radio-browser.info/json/servers', 6000);
        const names = [...new Set(list.map((s) => s.name).filter((n) => /^[a-z0-9.-]+\.api\.radio-browser\.info$/.test(n)))];
        base = `https://${names[Math.floor(Math.random() * names.length)] || 'de1.api.radio-browser.info'}`;
      } catch { base = 'https://de1.api.radio-browser.info'; }
    }
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try { return await getJson(url.toString()); } catch (err) { base = null; throw err; }
  }

  const fromRb = (s) => ({
    id: `rb-${s.stationuuid}`, uuid: s.stationuuid, name: String(s.name || '').trim() || 'Station', url: s.url_resolved || s.url,
    logo: /^https?:\/\//.test(s.favicon || '') ? s.favicon : '',
    about: [String(s.tags || '').split(',').filter(Boolean).slice(0, 3).join(', '), s.codec && s.bitrate ? `${s.codec} ${s.bitrate}k` : ''].filter(Boolean).join(' · '),
    country: s.countrycode || '', source: 'radio-browser',
  });
  const usable = (list) => list.map(fromRb).filter((s) => okUrl(s.url));

  async function popular(country, limit = 100) {
    const cc = String(country || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US';
    return usable(await rb(`/json/stations/bycountrycodeexact/${cc}`, { order: 'clickcount', reverse: 'true', limit, hidebroken: 'true' }));
  }
  async function search(query, limit = 100) {
    const q = String(query || '').trim().slice(0, 80);
    if (!q) return [];
    return usable(await rb('/json/stations/search', { name: q, order: 'clickcount', reverse: 'true', limit, hidebroken: 'true' }));
  }
  async function byTag(tag, limit = 100) {
    return usable(await rb('/json/stations/search', { tag: String(tag || '').slice(0, 40), tagExact: 'true', order: 'clickcount', reverse: 'true', limit, hidebroken: 'true' }));
  }
  async function countries() {
    const list = await rb('/json/countries', { order: 'stationcount', reverse: 'true', hidebroken: 'true' });
    return list.filter((c) => /^[A-Z]{2}$/.test(c.iso_3166_1) && c.stationcount >= 5).map((c) => ({ code: c.iso_3166_1, name: c.name, count: c.stationcount }));
  }
  // Tells Radio Browser the station was played.
  function clicked(uuid) {
    if (!/^[0-9a-f-]{36}$/.test(String(uuid))) return;
    rb(`/json/url/${uuid}`).catch(() => {});
  }

  async function somafm() {
    const j = await getJson('https://somafm.com/channels.json');
    return (j.channels || []).map((c) => {
      const pls = (c.playlists || []).find((p) => p.format === 'aac' && p.quality === 'highest') || (c.playlists || [])[0];
      return {
        id: `soma-${c.id}`, name: c.title, url: pls ? pls.url : '', logo: c.largeimage || c.image || '',
        about: [c.description, c.genre && c.genre.split('|').join(', ')].filter(Boolean).join(' · '), source: 'somafm',
      };
    }).filter((s) => okUrl(s.url));
  }

  return { popular, search, byTag, countries, clicked, somafm };
}

module.exports = { createRadio, okUrl };
