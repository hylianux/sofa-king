'use strict';

// YouTube, for people without VacuumTube: YouTube's own TV page (the one smart TVs and VacuumTube
// show), opened inside the app. It's made for a remote, so the controller just works.
//
// Optional extras for it, all off until you switch them on in Settings → YouTube:
//   - Block ads: ads are taken out of YouTube's answers before the page reads them (no ad breaks in
//     videos, no ad tiles in rows or search). The same way VacuumTube does it (MIT licence).
//   - SponsorBlock: skips sponsor spots and other parts you pick, from sponsor.ajay.app's
//     community list. It's asked with a scrambled prefix of the video's id, not the id itself.
//   - Return YouTube Dislike: shows likes and dislikes when a video starts (returnyoutubedislikeapi.com).
//   - DeArrow: swaps clickbait titles for the community's plainer ones (sponsor.ajay.app). Titles
//     only; its pictures would be blocked by the page's own rules.
//
// Also: finding a song or album on YouTube Music (its own search, no key), so the YouTube Music
// button can play it in VacuumTube or here.

const crypto = require('crypto');

const TV_URL = 'https://www.youtube.com/tv';
// The TV page only opens for TVs and consoles. This says "a TV app called SOFA King", in the
// shape YouTube expects from TVs (the same shape VacuumTube uses for itself).
const TV_UA = 'Mozilla/5.0 (X11; Linux x86_64) Cobalt/25.lts.30.1034943-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, SOFAKing_DESKTOP_x86_64_2025/0.1 (SOFAKing, Linux) com.tvoverlay/0.1';

const SB_CATEGORIES = [
  { id: 'sponsor', name: 'Sponsor spots' },
  { id: 'selfpromo', name: 'Self-promotion' },
  { id: 'interaction', name: '"Like and subscribe" reminders' },
  { id: 'intro', name: 'Intros' },
  { id: 'outro', name: 'End cards and credits' },
  { id: 'preview', name: 'Previews and recaps' },
  { id: 'music_offtopic', name: 'Non-music parts of music videos' },
  { id: 'filler', name: 'Tangents and jokes' },
];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,80}$/;

// Links: the TV page's own (inside the app), and plain ones (for VacuumTube and the website).
function tvLink({ videoId, playlistId, search } = {}) {
  if (VIDEO_ID.test(videoId || '')) return `${TV_URL}#/watch?v=${videoId}${LIST_ID.test(playlistId || '') ? `&list=${playlistId}` : ''}`;
  if (search) return `${TV_URL}#/search?q=${encodeURIComponent(search)}`;
  return TV_URL;
}
function watchLink({ videoId, playlistId, search } = {}, host = 'www.youtube.com') {
  if (VIDEO_ID.test(videoId || '')) return `https://${host}/watch?v=${videoId}${LIST_ID.test(playlistId || '') ? `&list=${playlistId}` : ''}`;
  if (search) return host === 'music.youtube.com' ? `https://${host}/search?q=${encodeURIComponent(search)}` : `https://${host}/results?search_query=${encodeURIComponent(search)}`;
  return `https://${host}`;
}
// A YouTube address (a trailer on another site, say) -> what it points at.
function parseLink(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return { videoId: u.pathname.slice(1, 12), playlistId: u.searchParams.get('list') || '' };
    const embed = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (embed) return { videoId: embed[1] };
    if (u.searchParams.get('v')) return { videoId: u.searchParams.get('v'), playlistId: u.searchParams.get('list') || '' };
    if (u.searchParams.get('search_query') || u.searchParams.get('q')) return { search: u.searchParams.get('search_query') || u.searchParams.get('q') };
  } catch { /* not an address */ }
  return {};
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*[([][^)\]]*(remaster|deluxe|edition|version|anniversary|expanded|bonus)[^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, '');

function createYouTube({ log = { debug() {} } } = {}) {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const cache = new Map();

  async function ytm(endpoint, body) {
    const res = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251020.01.00', hl: 'en', gl: 'US' } }, ...body }),
      signal: AbortSignal.timeout(10000),
    });
    log.debug(`[youtube] music ${endpoint} -> ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'failed' });
    return res.json();
  }
  const walk = (o, test, out = []) => {
    if (o && typeof o === 'object') { if (test(o)) out.push(o); for (const v of Object.values(o)) walk(v, test, out); }
    return out;
  };

  // An album or a song on YouTube Music -> { videoId, playlistId } (an album: its first song, then
  // the rest of it), or null when it isn't there.
  async function findMusic({ kind = 'album', title, artist }) {
    const key = `${kind}|${norm(artist)}|${norm(title)}`;
    if (cache.has(key)) return cache.get(key);
    const params = kind === 'song' ? 'EgWKAQIIAWoMEA4QChADEAQQCRAF' : 'EgWKAQIYAWoMEA4QChADEAQQCRAF'; // (YouTube Music's "Songs" and "Albums" filters)
    const j = await ytm('search', { query: `${artist || ''} ${title || ''}`.trim(), params });
    const items = walk(j, (o) => o.musicResponsiveListItemRenderer).map((o) => o.musicResponsiveListItemRenderer).slice(0, 10).map((it) => ({
      texts: walk(it.flexColumns, (o) => typeof o.text === 'string').map((o) => o.text),
      playlistId: walk(it, (o) => o.watchPlaylistEndpoint).map((o) => o.watchPlaylistEndpoint.playlistId)[0] || '',
      videoId: (it.playlistItemData && it.playlistItemData.videoId) || walk(it, (o) => o.watchEndpoint).map((o) => o.watchEndpoint.videoId)[0] || '',
    }));
    // The one with the same name by the same artist, else the same name, else nothing.
    const named = items.filter((x) => norm(x.texts[0]) === norm(title));
    const hit = named.find((x) => x.texts.some((t) => norm(t) === norm(artist))) || named[0] || null;
    let out = null;
    if (hit && kind === 'song' && VIDEO_ID.test(hit.videoId)) out = { videoId: hit.videoId };
    else if (hit && hit.playlistId) {
      const next = await ytm('next', { playlistId: hit.playlistId, enablePersistentPlaylistPanel: true, isAudioOnly: true });
      const first = walk(next, (o) => o.playlistPanelVideoRenderer).map((o) => o.playlistPanelVideoRenderer.videoId).find((v) => VIDEO_ID.test(v || ''));
      if (first) out = { videoId: first, playlistId: hit.playlistId };
    }
    log.debug(`[youtube] music ${kind} "${title}":`, out ? 'found' : 'not found');
    cache.set(key, out);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return out;
  }

  // ---- what the TV page's extras ask for

  const prefix = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 4);
  async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'SOFAKing/0.1', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    log.debug(`[youtube] ${new URL(url).host}${new URL(url).pathname.replace(/\/[0-9a-f]{4}$/, '/…')} -> ${res.status}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function segments(videoId, categories) {
    if (!VIDEO_ID.test(videoId)) return [];
    const cats = (categories || []).filter((c) => SB_CATEGORIES.some((x) => x.id === c));
    if (!cats.length) return [];
    const list = await getJson(`https://sponsor.ajay.app/api/skipSegments/${prefix(videoId)}?categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent('["skip"]')}`);
    const mine = (list || []).find((v) => v.videoID === videoId);
    return ((mine && mine.segments) || []).map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  }
  async function votes(videoId) {
    if (!VIDEO_ID.test(videoId)) return null;
    const j = await getJson(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
    return j ? { likes: Number(j.likes) || 0, dislikes: Number(j.dislikes) || 0 } : null;
  }
  const titles = new Map(); // videoId -> the community's title, or ''
  async function betterTitle(videoId) {
    if (!VIDEO_ID.test(videoId)) return '';
    if (titles.has(videoId)) return titles.get(videoId);
    const j = await getJson(`https://sponsor.ajay.app/api/branding/${prefix(videoId)}`).catch(() => null);
    const mine = j && j[videoId];
    const t = mine && (mine.titles || []).find((x) => !x.original && (x.locked || x.votes >= 0));
    // (">" marks words DeArrow shouldn't re-capitalise; it isn't part of the title.)
    const title = t ? String(t.title).replace(/(^|\s)>(\S)/g, '$1$2').trim() : '';
    titles.set(videoId, title);
    if (titles.size > 2000) titles.delete(titles.keys().next().value);
    return title;
  }

  return { findMusic, segments, votes, betterTitle };
}

// Runs inside the TV page, before its own scripts, with the extras you switched on. It talks to the
// app through window.__tvoAsk (a channel the app opens); it can't reach other sites itself.
function pageScript(settings) {
  const s = JSON.stringify({
    adblock: Boolean(settings.adblock), sponsorblock: Boolean(settings.sponsorblock), dislikes: Boolean(settings.dislikes), dearrow: Boolean(settings.dearrow),
  });
  return `(() => {
  if (window.__tvoExtras) return;
  window.__tvoExtras = true;
  const S = ${s};
  // The app reads the controller itself; the page must not read it a second time.
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [], configurable: true }); } catch {}

  // Questions to the app, answered by id.
  const waiting = new Map(); let nextId = 1;
  const ask = (what, arg) => new Promise((resolve) => {
    if (typeof window.__tvoAsk !== 'function') return resolve(null);
    const id = nextId++; waiting.set(id, resolve);
    window.__tvoAsk(JSON.stringify({ id, what, arg }));
    setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 10000);
  });
  window.__tvoAnswer = (id, value) => { const r = waiting.get(id); if (r) { waiting.delete(id); r(value); } };

  // ---- ads: taken out of YouTube's answers as the page reads them
  const AD_KEYS = ['adSlotRenderer', 'promoShelfRenderer'];
  const isAd = (x) => x && typeof x === 'object' && (AD_KEYS.some((k) => k in x) || (x.shelfRenderer && x.shelfRenderer.tvhtml5Metadata && x.shelfRenderer.tvhtml5Metadata.hideLogo)
    || (x.command && x.command.reelWatchEndpoint && x.command.reelWatchEndpoint.adClientParams && x.command.reelWatchEndpoint.adClientParams.isAd));
  const clean = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) if (isAd(o[i])) o.splice(i, 1); else clean(o[i], depth + 1);
      return;
    }
    if ('adPlacements' in o) o.adPlacements = [];
    if ('adSlots' in o) o.adSlots = [];
    if ('playerAds' in o) delete o.playerAds;
    for (const k in o) if (o[k] && typeof o[k] === 'object') clean(o[k], depth + 1);
  };
  // ---- DeArrow: titles seen in YouTube's answers, swapped once the community's arrive
  const seen = new Map(); // original title -> video id
  const better = new Map(); // original title -> new title
  const collect = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 40 || seen.size > 3000) return;
    const tile = o.tileRenderer;
    if (tile && tile.contentId && /^[A-Za-z0-9_-]{11}$/.test(tile.contentId)) {
      const t = tile.metadata && tile.metadata.tileMetadataRenderer && tile.metadata.tileMetadataRenderer.title;
      const text = t && (t.simpleText || (t.runs || []).map((r) => r.text).join(''));
      if (text && !seen.has(text)) { seen.set(text, tile.contentId); lookUp(text, tile.contentId); }
    }
    for (const k in o) if (o[k] && typeof o[k] === 'object') collect(o[k], depth + 1);
  };
  const lookUp = async (text, id) => {
    const t = await ask('title', id);
    if (t && t !== text) { better.set(text, t); swapAll(); }
  };
  let swapping = 0;
  const swapAll = () => { if (!swapping) swapping = requestAnimationFrame(() => { swapping = 0; swapIn(document.body); }); };
  const swapIn = (root) => {
    if (!root || !better.size) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = better.get(n.nodeValue); if (t) n.nodeValue = t; }
  };
  // (This runs before the page exists: watch it once it does.)
  const watchPage = () => new MutationObserver(() => swapAll()).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (S.dearrow) { if (document.documentElement) watchPage(); else document.addEventListener('DOMContentLoaded', watchPage, { once: true }); }

  // YouTube's answers, cleaned where they arrive (the page's requests to /youtubei/), and again
  // wherever the page decodes them itself.
  const tidy = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    try { if (S.adblock) clean(obj); if (S.dearrow) collect(obj); } catch {}
    return obj;
  };
  const tidyText = (text) => {
    if (typeof text !== 'string' || text.length < 200 || text[0] !== '{') return text;
    if (!(S.adblock && /adSlot|adPlacements|playerAds|promoShelf|isAd|hideLogo/.test(text)) && !(S.dearrow && text.includes('tileRenderer'))) return text;
    try { return JSON.stringify(tidy(parse.call(JSON, text))); } catch { return text; }
  };
  const ANSWERS = /youtubei.v1.(browse|search|next|player|reel|guide)/;
  const parse = JSON.parse;
  if (S.adblock || S.dearrow) {
    JSON.parse = function (text, reviver) {
      const out = parse.call(this, text, reviver);
      if (typeof text === 'string' && text.length > 200 && out && typeof out === 'object') tidy(out);
      return out;
    };
    const X = XMLHttpRequest.prototype;
    const open = X.open;
    X.open = function (method, url, ...rest) { this.__tvoUrl = String(url || ''); this.__tvoRaw = null; return open.call(this, method, url, ...rest); };
    const textGet = Object.getOwnPropertyDescriptor(X, 'responseText').get;
    const respGet = Object.getOwnPropertyDescriptor(X, 'response').get;
    const cleaned = (xhr) => {
      const raw = textGet.call(xhr);
      if (xhr.readyState !== 4 || !ANSWERS.test(xhr.__tvoUrl || '')) return raw;
      if (xhr.__tvoRaw !== raw) { xhr.__tvoRaw = raw; xhr.__tvoClean = tidyText(raw); }
      return xhr.__tvoClean;
    };
    Object.defineProperty(X, 'responseText', { configurable: true, get() { return cleaned(this); } });
    Object.defineProperty(X, 'response', { configurable: true, get() {
      if (this.responseType === '' || this.responseType === 'text') return cleaned(this);
      const r = respGet.call(this);
      if (this.responseType === 'json' && this.readyState === 4 && ANSWERS.test(this.__tvoUrl || '') && r && !r.__tvoDone) { tidy(r); try { Object.defineProperty(r, '__tvoDone', { value: true }); } catch {} }
      return r;
    } });
    const json = Response.prototype.json;
    Response.prototype.json = async function () { const out = await json.call(this); return ANSWERS.test(this.url) ? tidy(out) : out; };
    const text = Response.prototype.text;
    Response.prototype.text = async function () { const out = await text.call(this); return ANSWERS.test(this.url) ? tidyText(out) : out; };
  }

  // ---- a small note in the corner (skipped a sponsor, the votes)
  let note = null, noteTimer = 0;
  const say = (text, ms = 4000) => {
    if (!document.body) return;
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;top:4vh;right:3vw;z-index:2147483647;padding:1.1vh 1.4vw;border-radius:1.2vh;background:rgba(15,15,20,.86);color:#fff;font:600 2.3vh/1.3 Roboto,system-ui,sans-serif;transition:opacity .25s;opacity:0;pointer-events:none';
      document.body.append(note);
    }
    note.textContent = text;
    note.style.opacity = '1';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.style.opacity = '0'; }, ms);
  };

  // ---- the video playing now (the page shows it at #/watch?v=…)
  const NAMES = { sponsor: 'sponsor spot', selfpromo: 'self-promotion', interaction: 'reminder to like and subscribe', intro: 'intro', outro: 'end cards', preview: 'preview', music_offtopic: 'non-music part', filler: 'tangent' };
  let videoId = '', segs = [];
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n);
  const onVideo = async () => {
    const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(location.hash);
    const id = m ? m[1] : '';
    if (id === videoId) return;
    videoId = id; segs = [];
    if (!id) return;
    if (S.sponsorblock) { const r = await ask('segments', id); if (videoId === id && Array.isArray(r)) segs = r; }
    if (S.dislikes) { const v = await ask('votes', id); if (videoId === id && v) say('👍 ' + fmt(v.likes) + '    👎 ' + fmt(v.dislikes), 6000); }
  };
  window.addEventListener('hashchange', onVideo);
  setInterval(onVideo, 1500); // (the page doesn't always announce changes)
  if (S.sponsorblock) {
    document.addEventListener('timeupdate', (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || !segs.length) return;
      const t = v.currentTime;
      const hit = segs.find((x) => t >= x.start && t < x.end - 0.3);
      if (!hit) return;
      v.currentTime = Math.min(hit.end, (v.duration || hit.end) - 0.1);
      say('Skipped the ' + (NAMES[hit.category] || 'segment') + ' (SponsorBlock)');
    }, true);
  }
})();`;
}

module.exports = { createYouTube, pageScript, tvLink, watchLink, parseLink, TV_URL, TV_UA, SB_CATEGORIES };
