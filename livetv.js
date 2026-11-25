'use strict';

// Live TV from many places at once: IPTV channel lists (M3U, with an XMLTV guide), and the Live TV
// on each of your Jellyfin servers. The same channel often shows up in several of them, so channels
// are matched up and shown once, each keeping every source it can play from, best first.
//
// Matching, strongest signal first:
//   1. the schedule: the same programmes at the same times means the same channel, whatever it's
//      called (two cities' NBC stations differ in their local news; East and West feeds are hours apart)
//   2. a shared station id (Gracenote) or guide id (tvg-id)
//   3. the same logo and the same tidied-up name
// A matching name on its own only marks a *possible* duplicate, for you to merge (or not) in Settings.

const zlib = require('zlib');

const HOUR = 60 * 60 * 1000;
const MAX_LIST = 60 * 1024 * 1024; // biggest list or guide we'll read

// ------------------------------------------------------------ reading lists

// #EXTINF:-1 tvg-id="CNN.us" tvg-logo="..." group-title="News",CNN HD
function parseM3u(text, baseUrl) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0] && lines[0].startsWith('#EXTM3U') ? attrs(lines[0]) : {};
  const channels = [];
  let info = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Some streams only answer a particular browser name or referring page.
    const opt = /^#EXTVLCOPT:\s*http-(user-agent|referrer)\s*=\s*(.+)$/i.exec(line);
    if (opt && info) { info[opt[1].toLowerCase() === 'referrer' ? 'referrer' : 'ua'] = opt[2].trim(); continue; }
    if (line.startsWith('#EXTINF')) {
      const comma = findTitleComma(line);
      const a = attrs(line.slice(0, comma));
      info = {
        name: line.slice(comma + 1).trim() || a['tvg-name'] || '',
        tvgId: a['tvg-id'] || '',
        stationId: a['tvc-guide-stationid'] || a['tvg-gracenote'] || a['gracenote'] || '',
        logo: a['tvg-logo'] || a.logo || '',
        group: (a['group-title'] || '').split(';')[0].trim(),
        number: a['tvg-chno'] || a['channel-number'] || a['tvh-chnum'] || '',
        ua: a['http-user-agent'] || a['user-agent'] || '',
        referrer: a['http-referrer'] || a['referrer'] || '',
      };
      continue;
    }
    if (line.startsWith('#')) continue; // #EXTVLCOPT, #KODIPROP...: not needed by mpv
    if (info) {
      let url = line;
      try { url = new URL(line, baseUrl).toString(); } catch { /* keep as is */ }
      if (/^https?:\/\//i.test(url)) channels.push({ ...info, url, localId: info.tvgId || `${info.name}|${url}` });
      info = null;
    }
  }
  return { channels, guideUrl: header['url-tvg'] || header['x-tvg-url'] || '' };
}

// The comma before the channel name (not one inside a quoted attribute).
function findTitleComma(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ',' && !quoted) return i;
  }
  return line.length;
}

function attrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

const unescapeXml = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .trim();

// "20261123220000 -0500" -> ms
function xmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se = '00', tz = '+0000'] = m;
  const sign = tz[0] === '-' ? -1 : 1;
  const off = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - off * 60000;
}

// Only what's on from 2 hours ago to `hours` ahead: guides can be huge.
function parseXmltv(text, { now = Date.now(), hours = 14 } = {}) {
  const from = now - 2 * HOUR;
  const to = now + hours * HOUR;
  const names = {};
  for (const m of String(text).matchAll(/<channel\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g)) {
    const dn = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/.exec(m[2]);
    const icon = /<icon\b[^>]*\bsrc="([^"]*)"/.exec(m[2]);
    names[unescapeXml(m[1])] = { name: dn ? unescapeXml(dn[1]) : '', logo: icon ? unescapeXml(icon[1]) : '' };
  }
  const programmes = {};
  for (const m of String(text).matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const a = attrs(m[1]);
    const start = xmltvTime(a.start);
    const stop = xmltvTime(a.stop);
    if (!(stop > from) || !(start < to)) continue;
    const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const sub = /<sub-title\b[^>]*>([\s\S]*?)<\/sub-title>/.exec(m[2]);
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    const id = unescapeXml(a.channel);
    (programmes[id] = programmes[id] || []).push({
      start, stop, title: t ? unescapeXml(t[1]) : '', sub: sub ? unescapeXml(sub[1]) : '', desc: desc ? unescapeXml(desc[1]).slice(0, 400) : '',
    });
  }
  for (const list of Object.values(programmes)) list.sort((x, y) => x.start - y.start);
  return { names, programmes };
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'sofa-king', accept: '*/*' } });
  } catch {
    throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status === 404 ? 'not-found' : 'failed' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_LIST) throw Object.assign(new Error('too big'), { code: 'too-big' });
  // Gzipped guides (.xml.gz) are common.
  const body = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf, { maxOutputLength: MAX_LIST * 4 }) : buf;
  return body.toString('utf8');
}

// A list address from you: an M3U playlist, or just a FastChannels server (http://host:5523), whose
// playlist and guide live at known places.
async function resolveList(input) {
  const raw = String(input || '').trim();
  const urls = raw.split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
  if (!urls.length) throw Object.assign(new Error('not a url'), { code: 'not-a-url' });
  let [m3u, guide] = urls;
  let text = null;
  try {
    text = await fetchText(m3u);
    if (!/#EXTINF/i.test(text)) text = null;
  } catch (err) {
    if (err.code === 'unreachable') throw err;
  }
  if (!text) {
    // Maybe the server's home address: try FastChannels' default feed.
    const base = m3u.replace(/\/+$/, '');
    try {
      const t = await fetchText(`${base}/feeds/default/m3u`);
      if (/#EXTINF/i.test(t)) {
        m3u = `${base}/feeds/default/m3u`;
        guide = guide || `${base}/feeds/default/epg.xml`;
        text = t;
      }
    } catch { /* not FastChannels */ }
  }
  if (!text) throw Object.assign(new Error('no channels'), { code: 'no-channels' });
  const parsed = parseM3u(text, m3u);
  if (!parsed.channels.length) throw Object.assign(new Error('no channels'), { code: 'no-channels' });
  // A FastChannels feed's guide sits next to its playlist.
  const feed = /^(.*\/feeds\/[^/]+)\/m3u(\/gracenote)?\/?$/.exec(m3u);
  if (!guide && !parsed.guideUrl && feed) guide = `${feed[1]}/epg.xml`;
  return { m3u, guide: guide || parsed.guideUrl || '', count: parsed.channels.length, parsed };
}

// ------------------------------------------------------------ matching channels up

const GENERIC = new Set(['paid programming', 'to be announced', 'tba', 'off air', 'sign off', 'programming', 'local programming', 'no information', 'movie', 'news']);

function tidyName(name) {
  return String(name || '').toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')               // (US), [HD]
    .replace(/^\s*(us|usa|uk|ca)\s*[:|-]\s*/, ' ')          // "US: CNN"
    .replace(/\b(f?hd|uhd|4k|sd|hevc|h\.?265|1080p?|720p?)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// What's on: start minute -> tidied title, for comparing schedules.
function fingerprint(programmes, channelName, now) {
  const own = tidyName(channelName);
  const slots = new Map();
  for (const p of programmes || []) {
    if (p.stop < now - HOUR || p.start > now + 8 * HOUR) continue;
    const t = tidyName(p.title);
    if (!t || GENERIC.has(t) || t === own) continue; // "CNN" every hour on CNN tells us nothing
    slots.set(Math.round(p.start / 60000), t);
  }
  return slots;
}

// The same channel: nearly every slot both guides fill agrees. Two cities' stations of the same
// network share most of the evening, but not their local news, and one disagreement in four is
// enough to keep them apart. (A little slack allows for guides that word a title differently.)
function sameSchedule(a, b) {
  if (a.size < 3 || b.size < 3) return false;
  let agree = 0;
  let clash = 0;
  for (const [start, title] of a) {
    if (!b.has(start)) continue;
    if (b.get(start) === title) agree += 1; else clash += 1;
  }
  return agree >= 3 && clash <= Math.floor((agree + clash) / 10) && agree / Math.min(a.size, b.size) >= 0.6;
}

// entries: [{ key, sourceId, sourceRank, name, number, logo, group, tvgId, stationId, programmes, play }]
// overrides: { merge: [[keyA, keyB]], split: [[keyA, keyB]] } (your choices, from Settings)
// How sharp a copy is, from its name: "ESPN HD" -> 720, "ESPN FHD" / "1080p" -> 1080, "4K" -> 2160,
// "SD" -> 480. null when the name doesn't say.
function qualityFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(4k|uhd|2160p?)\b/.test(n)) return 2160;
  if (/\b(fhd|1080[pi]?)\b/.test(n)) return 1080;
  if (/\b(hd|720p?)\b/.test(n)) return 720;
  if (/\b(sd|480[pi]?|576[pi]?)\b/.test(n)) return 480;
  return null;
}

const qualityLabel = (h) => (!h ? '' : h >= 2000 ? '4K' : h >= 1000 ? 'Full HD' : h >= 700 ? 'HD' : 'SD');

// options: { quality: { [key]: measured height }, preferQuality: true } — with preferQuality, a
// channel's sources are tried sharpest first (then in your order); otherwise in your order.
function mergeChannels(entries, overrides = {}, now = Date.now(), options = {}) {
  const measured = options.quality || {};
  const heightOf = (e) => measured[e.key] || qualityFromName(e.name) || null;
  const parent = entries.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const index = new Map(entries.map((e, i) => [e.key, i]));
  const kept = new Set((overrides.split || []).map(([a, b]) => [a, b].sort().join('\n')));
  const apart = (i, j) => kept.has([entries[i].key, entries[j].key].sort().join('\n'));
  const sources = entries.map((e) => new Set([e.sourceId])); // per group root: which lists it came from
  const union = (i, j, why) => {
    if (apart(i, j)) return;
    const a = find(i);
    const b = find(j);
    if (a === b) return;
    // Two channels from the same list are never the same channel (lists don't repeat themselves,
    // except on purpose, e.g. an HD and SD copy), unless you merged them.
    if (why !== 'you' && why !== 'variant' && [...sources[b]].some((x) => sources[a].has(x))) return;
    parent[b] = a;
    for (const x of sources[b]) sources[a].add(x);
  };
  const members = () => {
    const groups = new Map();
    entries.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), i]); });
    return groups;
  };

  const byKey = (fn) => {
    const seen = new Map();
    entries.forEach((e, i) => {
      const k = fn(e);
      if (!k) return;
      if (seen.has(k)) union(seen.get(k), i, 'id'); else seen.set(k, i);
    });
  };
  // HD and SD copies of a channel in the same list: one channel, two sources.
  {
    const seen = new Map();
    entries.forEach((e, i) => {
      const k = `${e.sourceId}|${tidyName(e.name)}`;
      if (!tidyName(e.name)) return;
      const first = seen.get(k);
      if (first === undefined) { seen.set(k, i); return; }
      if (entries[first].name !== e.name && (qualityFromName(entries[first].name) || qualityFromName(e.name))) union(first, i, 'variant');
    });
  }
  byKey((e) => e.stationId && `s:${e.stationId}`);
  byKey((e) => e.tvgId && `t:${e.tvgId.toLowerCase()}`);
  byKey((e) => e.logo && `l:${e.logo}|${tidyName(e.name)}`);

  // Same programmes at the same times.
  const prints = entries.map((e) => fingerprint(e.programmes, e.name, now));
  const bySlot = new Map();
  prints.forEach((p, i) => { for (const [start, title] of p) { const k = `${start}|${title}`; bySlot.set(k, [...(bySlot.get(k) || []), i]); } });
  const tried = new Set();
  for (const list of bySlot.values()) {
    if (list.length < 2 || list.length > 40) continue; // a slot everyone shares tells us nothing
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const pair = `${list[x]}|${list[y]}`;
        if (tried.has(pair)) continue;
        tried.add(pair);
        if (sameSchedule(prints[list[x]], prints[list[y]])) union(list[x], list[y], 'schedule');
      }
    }
  }

  for (const [a, b] of overrides.merge || []) {
    if (index.has(a) && index.has(b)) union(index.get(a), index.get(b), 'you');
  }

  // Build one channel per group.
  const channels = [];
  for (const ids of members().values()) {
    const byRank = ids.map((i) => entries[i]).sort((x, y) => x.sourceRank - y.sourceRank);
    // Unknown sharpness counts as ordinary (between SD and HD), so it isn't pushed to the back.
    const sharp = (e) => heightOf(e) || 600;
    const list = options.preferQuality === false ? byRank : [...byRank].sort((x, y) => sharp(y) - sharp(x) || x.sourceRank - y.sourceRank);
    const guide = [...list].sort((x, y) => (y.programmes || []).length - (x.programmes || []).length)[0];
    const lead = byRank[0]; // keeps the channel's id steady whichever copy plays first
    const best = Math.max(0, ...list.map((e) => heightOf(e) || 0));
    channels.push({
      id: lead.key,
      name: lead.name.replace(/\s*\b(f?hd|uhd|4k|sd)\b\s*$/i, '') || lead.name,
      quality: qualityLabel(best),
      number: list.map((e) => e.number).find(Boolean) || '',
      logo: list.map((e) => e.logo).find(Boolean) || '',
      group: list.map((e) => e.group).find(Boolean) || '',
      programmes: (guide.programmes || []).filter((p) => p.stop > now - HOUR),
      sources: list.map((e) => ({ key: e.key, sourceId: e.sourceId, play: e.play, name: e.name, height: heightOf(e) })),
    });
  }

  // Possible duplicates: same tidied name, still separate, and you haven't said "keep separate".
  const possible = [];
  const byName = new Map();
  for (const c of channels) {
    const n = tidyName(c.name);
    if (!n) continue;
    byName.set(n, [...(byName.get(n) || []), c]);
  }
  for (const same of byName.values()) {
    for (let i = 0; i < same.length; i++) {
      for (let j = i + 1; j < same.length; j++) {
        if (kept.has([same[i].id, same[j].id].sort().join('\n'))) continue;
        possible.push([same[i].id, same[j].id]);
      }
    }
  }

  channels.sort((x, y) => {
    const nx = parseFloat(x.number);
    const ny = parseFloat(y.number);
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx - ny;
    if (Number.isNaN(nx) !== Number.isNaN(ny)) return Number.isNaN(nx) ? 1 : -1;
    return x.name.localeCompare(y.name);
  });
  return { channels, possible };
}

module.exports = { parseM3u, parseXmltv, xmltvTime, fetchText, resolveList, mergeChannels, tidyName, qualityFromName, qualityLabel };
