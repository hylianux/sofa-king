'use strict';

// Live TV's channel store, run on a background thread (livetv-worker.js) so reading big channel
// lists and guides, matching channels up, and saving the cache never freeze the app.
//
// It keeps every source's channels. The app sends it Jellyfin's channels (fetched with the
// server's sign-in, which stays in the app) and asks it to read channel lists itself. When asked
// to merge, it answers with the new channel list only if something changed since last time.

const fs = require('fs');
const crypto = require('crypto');
const livetv = require('./livetv');

function createStore() {
  const bySource = new Map(); // sourceId -> entries
  let lastFingerprint = '';

  async function readList({ srcId, rank, list, now }) {
    const parsed = livetv.parseM3u(await livetv.fetchText(list.m3u), list.m3u);
    let guide = { names: {}, programmes: {} };
    let guideError = null;
    const guideUrl = list.guide || parsed.guideUrl;
    if (guideUrl) {
      try { guide = livetv.parseXmltv(await livetv.fetchText(guideUrl), { now }); } catch (err) { guideError = err.code || 'failed'; }
    }
    // Lists without guide ids: match the guide by channel name.
    const byName = new Map(Object.entries(guide.names).map(([id, n]) => [livetv.tidyName(n.name), id]));
    const entries = parsed.channels.map((c) => {
      const gid = c.tvgId && guide.programmes[c.tvgId] ? c.tvgId : (byName.get(livetv.tidyName(c.name)) || c.tvgId);
      return {
        key: `${srcId}:${c.localId}`, sourceId: srcId, sourceRank: rank,
        name: c.name, number: c.number, logo: c.logo || (guide.names[gid] && guide.names[gid].logo) || '', group: c.group,
        tvgId: c.tvgId, stationId: c.stationId, programmes: guide.programmes[gid] || [],
        play: { type: 'url', url: c.url, ...(c.ua ? { ua: c.ua } : {}), ...(c.referrer ? { referrer: c.referrer } : {}) },
      };
    });
    bySource.set(srcId, entries);
    return { count: entries.length, guide: Boolean(guideUrl) && !guideError, guideError };
  }

  const ops = {
    // Read channel lists (in parallel). A list that fails keeps what it had before.
    async readLists({ lists, now }) {
      const out = {};
      await Promise.all(lists.map(async (l) => {
        try { out[l.srcId] = await readList({ ...l, now }); } catch (err) {
          out[l.srcId] = { error: err.code || 'failed', count: (bySource.get(l.srcId) || []).length, kept: bySource.has(l.srcId) };
        }
      }));
      return out;
    },
    setSource({ srcId, entries }) { bySource.set(srcId, Array.isArray(entries) ? entries : []); return true; },
    dropSource({ srcId }) { bySource.delete(srcId); return true; },
    // Only the sources still in use, best first. -> { changed, channels, possible, urls }
    merge({ ranks, merge, split, quality, preferQuality, now, force }) {
      const entries = [];
      for (const [srcId, list] of bySource) {
        if (!(srcId in ranks)) continue;
        for (const e of list) entries.push(e.sourceRank === ranks[srcId] ? e : { ...e, sourceRank: ranks[srcId] });
      }
      const merged = livetv.mergeChannels(entries, { merge, split }, now, { quality, preferQuality });
      // Did anything you'd see change? (Channels, their copies and order, and what's on.)
      const fingerprint = crypto.createHash('sha1').update(JSON.stringify([merged.channels, merged.possible])).digest('hex');
      const urls = [...new Map(entries.filter((e) => e.play && e.play.type === 'url' && e.sourceId.startsWith('list:'))
        .map((e) => [e.play.url, e.play])).values()];
      if (fingerprint === lastFingerprint && !force) return { changed: false, urls };
      lastFingerprint = fingerprint;
      // What goes back to the app is trimmed and sent as text: taking in thousands of channels'
      // full guides held the app (and the controller) up for most of a second. It only needs
      // what's on from now for a little over two days (search looks two days ahead, and the guide
      // refreshes every three hours), and descriptions only for the next few hours (only what's on
      // now shows one).
      const H = 3600 * 1000;
      const channels = merged.channels.map((c) => ({
        ...c,
        programmes: (c.programmes || []).filter((p) => p.stop > now && p.start < now + 54 * H)
          .map((p) => (p.desc && p.start >= now + 4 * H ? { ...p, desc: '' } : p)),
      }));
      return { changed: true, json: JSON.stringify({ channels, possible: merged.possible }), urls };
    },
    saveCache({ file, at, status }) {
      const entries = [...bySource.values()].flat();
      fs.writeFileSync(file, JSON.stringify({ at, entries, status }), { mode: 0o600 });
      return true;
    },
    loadCache({ file }) {
      let c;
      try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
      if (!c || !Array.isArray(c.entries)) return null;
      bySource.clear();
      for (const e of c.entries) {
        if (!bySource.has(e.sourceId)) bySource.set(e.sourceId, []);
        bySource.get(e.sourceId).push(e);
      }
      return { at: c.at || 0, status: c.status || {} };
    },
  };

  // One thing at a time, in the order asked (a merge waits for the lists being read before it).
  let queue = Promise.resolve();
  function run(op, args) {
    const next = queue.then(() => {
      if (!ops[op]) throw new Error(`unknown op ${op}`);
      return ops[op](args || {});
    });
    queue = next.catch(() => {});
    return next;
  }
  return { run };
}

module.exports = { createStore };
