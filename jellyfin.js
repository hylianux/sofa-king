'use strict';

// Talks to your Jellyfin servers: finds them on the network, signs in (Quick Connect or
// username/password), checks whether a title is in a library, and asks Jellyfin Desktop to
// show it. Tokens are kept in the app's own config file.

const dgram = require('dgram');
const os = require('os');

const CLIENT = 'SOFA King';
const TIMEOUT = 8000;

function createJellyfin({ deviceId, version, log = { debug() {} } }) {
  const deviceName = os.hostname() || 'TV';

  const authHeader = (token) =>
    `MediaBrowser Client="${CLIENT}", Device="${deviceName}", DeviceId="${deviceId()}", Version="${version}"` +
    (token ? `, Token="${token}"` : '');

  async function req(base, pathname, { method = 'GET', token, body, query, timeout = TIMEOUT } = {}) {
    const url = new URL(base.replace(/\/+$/, '') + pathname);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
    const headers = { Authorization: authHeader(token), 'X-Emby-Authorization': authHeader(token), Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    const started = Date.now();
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      log.debug(`[jellyfin] ${method} ${url.origin}${url.pathname} failed after ${Date.now() - started} ms: ${err.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : err.message}`);
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    log.debug(`[jellyfin] ${method} ${url.origin}${url.pathname} -> ${res.status} (${Date.now() - started} ms)`);
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: res.status });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'failed', status: res.status });
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  // "192.168.1.5" -> "http://192.168.1.5:8096"; keeps an explicit scheme, port or path.
  function normalize(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    const typedScheme = /^https?:\/\//i.test(s);
    if (!typedScheme) s = `http://${s}`;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (/\s/.test(u.hostname) || !u.hostname) return null;
    // A bare address gets Jellyfin's usual port; "http://..." typed in full is taken as given.
    if (!typedScheme && !u.port && (u.pathname === '/' || u.pathname === '')) u.port = '8096';
    return u.toString().replace(/\/+$/, '').replace(/\/web$/i, '');
  }

  async function publicInfo(url) {
    const base = normalize(url);
    if (!base) throw Object.assign(new Error('bad address'), { code: 'bad-address' });
    const info = await req(base, '/System/Info/Public');
    if (!info || !info.Id) throw Object.assign(new Error('not jellyfin'), { code: 'not-jellyfin' });
    return { id: info.Id, name: info.ServerName || 'Jellyfin', version: info.Version || '', url: base };
  }

  // Servers on this network answer a UDP broadcast on port 7359. Also try this computer itself.
  async function discover() {
    const found = new Map();
    const add = (s) => { if (s && s.id && !found.has(s.id)) found.set(s.id, s); };

    const udp = new Promise((resolve) => {
      let sock;
      try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve(); }
      sock.on('error', () => { try { sock.close(); } catch { /* closed */ } resolve(); });
      sock.on('message', (msg) => {
        try {
          const j = JSON.parse(msg.toString('utf8'));
          if (j.Id && j.Address) add({ id: j.Id, name: j.Name || 'Jellyfin', url: normalize(j.Address) });
        } catch { /* not for us */ }
      });
      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
          sock.send('who is JellyfinServer?', 7359, '255.255.255.255');
        } catch { /* no broadcast here */ }
        setTimeout(() => { try { sock.close(); } catch { /* closed */ } resolve(); }, 2500);
      });
    });
    const local = publicInfo('http://localhost:8096').then(add, () => {});
    await Promise.all([udp, local]);
    return [...found.values()];
  }

  // ---------------------------------------------------------------- signing in

  async function quickConnectStart(url) {
    const base = normalize(url);
    const enabled = await req(base, '/QuickConnect/Enabled').catch(() => false);
    if (enabled !== true) return { error: 'qc-off' };
    const r = await req(base, '/QuickConnect/Initiate', { method: 'POST' });
    return { code: r.Code, secret: r.Secret };
  }

  async function quickConnectCheck(url, secret) {
    const r = await req(normalize(url), '/QuickConnect/Connect', { query: { secret } });
    return Boolean(r && r.Authenticated);
  }

  const session = (r) => ({ token: r.AccessToken, userId: r.User && r.User.Id, userName: r.User && r.User.Name });

  async function quickConnectFinish(url, secret) {
    return session(await req(normalize(url), '/Users/AuthenticateWithQuickConnect', { method: 'POST', body: { Secret: secret } }));
  }

  async function signIn(url, username, password) {
    return session(await req(normalize(url), '/Users/AuthenticateByName', { method: 'POST', body: { Username: username, Pw: password } }));
  }

  // ---------------------------------------------------------------- finding a title

  const simplify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  async function itemsQuery(server, query) {
    try {
      return await req(server.url, '/Items', { token: server.token, query: { ...query, userId: server.userId } });
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      return req(server.url, `/Users/${server.userId}/Items`, { token: server.token, query }); // older servers
    }
  }

  // Is this TMDB title in this server's libraries? Matches the TMDB id, or failing that name + year.
  async function findOn(server, { kind, tmdbId, title, year }) {
    const r = await itemsQuery(server, {
      searchTerm: title,
      includeItemTypes: kind === 'tv' ? 'Series' : 'Movie',
      recursive: 'true',
      fields: 'ProviderIds,ProductionYear',
      limit: '25',
    });
    const items = (r && r.Items) || [];
    const tmdb = (it) => {
      const ids = it.ProviderIds || {};
      return String(ids.Tmdb || ids.tmdb || ids.TMDB || '');
    };
    const hit = items.find((it) => tmdb(it) === String(tmdbId)) ||
      items.find((it) => simplify(it.Name) === simplify(title) && (!year || !it.ProductionYear || String(it.ProductionYear) === String(year)));
    return hit ? { serverId: server.id, serverName: server.name, itemId: hit.Id, itemType: hit.Type, name: hit.Name } : null;
  }

  async function find(servers, item) {
    const results = await Promise.allSettled(servers.filter((s) => s.token).map((s) => findOn(s, item)));
    const matches = [];
    const problems = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) matches.push(r.value);
      if (r.status === 'rejected') problems.push({ serverId: servers[i].id, code: r.reason.code });
    });
    return { matches, problems };
  }

  // ---------------------------------------------------------------- showing it in Jellyfin Desktop

  const DESKTOP_CLIENT = /jellyfin (desktop|media player)/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Jellyfin's remote control: find this computer's Jellyfin Desktop session and tell it to
  // show the title. Keeps trying while the app starts up.
  async function showInDesktop(server, { itemId, itemType, name }, waitMs = 25000) {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      let sessions = [];
      try {
        sessions = await req(server.url, '/Sessions', { token: server.token, query: { controllableByUserId: server.userId, activeWithinSeconds: '120' } }) || [];
      } catch { /* server busy */ }
      const mine = sessions
        .filter((s) => DESKTOP_CLIENT.test(s.Client || '') && s.SupportsRemoteControl !== false)
        .sort((a, b) => (b.DeviceName === deviceName) - (a.DeviceName === deviceName) ||
          new Date(b.LastActivityDate || 0) - new Date(a.LastActivityDate || 0));
      if (mine.length) {
        await req(server.url, `/Sessions/${mine[0].Id}/Viewing`, {
          method: 'POST', token: server.token, query: { itemType, itemId, itemName: name },
        });
        return true;
      }
      await sleep(1500);
    }
    return false;
  }

  // For the web player: sign it in with our token so it opens straight to the title.
  function webSignInScript(server) {
    const J = JSON.stringify;
    return `(() => { try {
      const key = 'jellyfin_credentials';
      const creds = JSON.parse(localStorage.getItem(key) || '{"Servers":[]}');
      creds.Servers = creds.Servers || [];
      let s = creds.Servers.find((x) => x.Id === ${J(server.id)});
      if (s && s.AccessToken) return false;
      if (!s) { s = { Id: ${J(server.id)} }; creds.Servers.push(s); }
      Object.assign(s, { Name: ${J(server.name)}, ManualAddress: ${J(server.url)}, LastConnectionMode: 2,
        UserId: ${J(server.userId)}, AccessToken: ${J(server.token)}, DateLastAccessed: Date.now() });
      localStorage.setItem(key, JSON.stringify(creds));
      return true;
    } catch (e) { return false; } })()`;
  }

  const webUrl = (server, itemId) => `${server.url}/web/#/details?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(server.id)}`;

  // ---------------------------------------------------------------- library and playback

  const TICKS = 10_000_000; // Jellyfin counts time in 100-nanosecond ticks

  // One shape for movies and episodes, with where the person got to.
  function playable(it) {
    const ud = it.UserData || {};
    return {
      id: it.Id,
      type: it.Type,
      name: it.Name,
      series: it.SeriesName || null,
      seriesId: it.SeriesId || null,
      season: it.ParentIndexNumber ?? null,
      episode: it.IndexNumber ?? null,
      overview: it.Overview || '',
      runtime: it.RunTimeTicks ? Math.round(it.RunTimeTicks / TICKS) : null,
      position: ud.PlaybackPositionTicks ? Math.round(ud.PlaybackPositionTicks / TICKS) : 0,
      played: Boolean(ud.Played),
      lastPlayed: ud.LastPlayedDate || null,
      year: it.ProductionYear || null,
      sortName: it.SortName || it.Name || '',
      tmdbId: Number((it.ProviderIds || {}).Tmdb || (it.ProviderIds || {}).tmdb) || null,
      // Which item's poster to show: a show's poster for its episodes.
      poster: it.Type === 'Episode'
        ? (it.SeriesPrimaryImageTag && it.SeriesId ? it.SeriesId : null)
        : ((it.ImageTags && it.ImageTags.Primary) ? it.Id : null),
    };
  }

  async function getItem(server, itemId) {
    let it;
    try {
      it = await req(server.url, `/Items/${itemId}`, { token: server.token, query: { userId: server.userId } });
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      it = await req(server.url, `/Users/${server.userId}/Items/${itemId}`, { token: server.token }); // older servers
    }
    return playable(it);
  }

  async function seasons(server, seriesId) {
    const r = await req(server.url, `/Shows/${seriesId}/Seasons`, { token: server.token, query: { userId: server.userId } });
    return ((r && r.Items) || []).map((s) => ({
      id: s.Id, name: s.Name, index: s.IndexNumber ?? null,
      unplayed: s.UserData ? s.UserData.UnplayedItemCount ?? null : null,
    }));
  }

  async function episodes(server, seriesId, seasonId) {
    const r = await req(server.url, `/Shows/${seriesId}/Episodes`, {
      token: server.token, query: { userId: server.userId, seasonId, fields: 'Overview' },
    });
    return ((r && r.Items) || []).map(playable);
  }

  // ---------------------------------------------------------------- home rows and library

  const ROW_FIELDS = 'PrimaryImageAspectRatio,ProductionYear,SortName,ProviderIds,Overview';

  // "Jump back in": things you stopped partway through.
  async function resumeItems(server, limit = 24) {
    const query = { userId: server.userId, limit: String(limit), mediaTypes: 'Video', fields: ROW_FIELDS, enableImageTypes: 'Primary' };
    let r;
    try {
      r = await req(server.url, '/UserItems/Resume', { token: server.token, query });
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      r = await req(server.url, `/Users/${server.userId}/Items/Resume`, { token: server.token, query }); // older servers
    }
    return ((r && r.Items) || []).map(playable);
  }

  // "Up next": the next episode of shows you're watching (not ones already in "Jump back in").
  async function nextUpItems(server, limit = 24) {
    const r = await req(server.url, '/Shows/NextUp', {
      token: server.token, query: { userId: server.userId, limit: String(limit), fields: ROW_FIELDS, enableResumable: 'false' },
    });
    return ((r && r.Items) || []).map(playable);
  }

  // What you've watched lately, as TMDB ids: seeds for "Inspired by what you've watched".
  async function recentlyPlayedTmdb(server, limit = 12) {
    const r = await itemsQuery(server, {
      recursive: 'true', includeItemTypes: 'Movie,Episode', filters: 'IsPlayed',
      sortBy: 'DatePlayed', sortOrder: 'Descending', limit: String(limit * 2), fields: 'ProviderIds',
    });
    const items = (r && r.Items) || [];
    const tmdbOf = (it) => { const ids = it.ProviderIds || {}; return Number(ids.Tmdb || ids.tmdb || ids.TMDB) || null; };
    const seeds = [];
    const seriesIds = [...new Set(items.filter((it) => it.Type === 'Episode' && it.SeriesId).map((it) => it.SeriesId))];
    let series = [];
    if (seriesIds.length) {
      const sr = await itemsQuery(server, { ids: seriesIds.join(','), fields: 'ProviderIds' }).catch(() => null);
      series = (sr && sr.Items) || [];
    }
    for (const it of items) {
      if (it.Type === 'Movie' && tmdbOf(it)) seeds.push({ kind: 'movie', id: tmdbOf(it) });
      if (it.Type === 'Episode') {
        const show = series.find((x) => x.Id === it.SeriesId);
        if (show && tmdbOf(show)) seeds.push({ kind: 'tv', id: tmdbOf(show) });
      }
    }
    const seen = new Set();
    return seeds.filter((x) => !seen.has(x.kind + x.id) && seen.add(x.kind + x.id)).slice(0, limit);
  }

  // Your whole library, alphabetically, a page at a time. letter jumps to that letter and carries on from there.
  async function library(server, { type, start = 0, limit = 60, letter = null }) {
    const query = {
      recursive: 'true', includeItemTypes: type === 'tv' ? 'Series' : 'Movie',
      sortBy: 'SortName', sortOrder: 'Ascending', startIndex: String(start), limit: String(limit), fields: ROW_FIELDS,
    };
    if (letter && /^[A-Z]$/.test(letter)) query.nameStartsWithOrGreater = letter;
    const r = await itemsQuery(server, query);
    const items = ((r && r.Items) || []).map(playable);
    const total = (r && r.TotalRecordCount) || 0;
    return { items, more: start + items.length < total };
  }

  // ---------------------------------------------------------------- Live TV

  // The server's live channels (none if it has no Live TV set up).
  async function liveChannels(server) {
    let r;
    try {
      r = await req(server.url, '/LiveTv/Channels', {
        token: server.token,
        query: { userId: server.userId, enableImageTypes: 'Primary', enableUserData: 'false', sortBy: 'SortName', limit: '5000' },
      });
    } catch (err) {
      if (err.code === 'unauthorized') throw err;
      return []; // Live TV not set up (servers answer with an error)
    }
    return ((r && r.Items) || []).map((c) => ({
      id: c.Id, name: c.Name || '', number: c.ChannelNumber || c.Number || '',
      logo: c.ImageTags && c.ImageTags.Primary ? c.Id : null,
    }));
  }

  // What's on, from `from` to `to` (ms), for those channels.
  async function livePrograms(server, channelIds, from, to) {
    const out = {};
    for (let i = 0; i < channelIds.length; i += 100) {
      const chunk = channelIds.slice(i, i + 100);
      let r;
      try {
        r = await req(server.url, '/LiveTv/Programs', {
          token: server.token,
          query: {
            userId: server.userId, channelIds: chunk.join(','), minEndDate: new Date(from).toISOString(),
            maxStartDate: new Date(to).toISOString(), fields: 'Overview', enableImages: 'false', enableUserData: 'false', limit: '10000',
          },
        });
      } catch { continue; }
      for (const p of (r && r.Items) || []) {
        (out[p.ChannelId] = out[p.ChannelId] || []).push({
          start: Date.parse(p.StartDate), stop: Date.parse(p.EndDate),
          title: p.Name || '', sub: p.EpisodeTitle || '', desc: (p.Overview || '').slice(0, 400),
        });
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
    return out;
  }

  // Start a live channel: the server opens its tuner (or stream) and hands back where to watch.
  async function openLive(server, channelId) {
    // Opening a tuner can take a while (Tunarr starts a stream from scratch; an antenna tuner has
    // to lock on), and the server only answers once it's open.
    const r = await req(server.url, `/Items/${channelId}/PlaybackInfo`, {
      method: 'POST', token: server.token, timeout: 60000,
      query: { userId: server.userId, autoOpenLiveStream: 'true', isPlayback: 'true', startTimeTicks: '0' },
      body: {
        UserId: server.userId,
        // mpv plays anything, so: the stream as it is if the server can pass it on; otherwise
        // repackaged into a stream mpv reads (with the same picture and sound where possible, so
        // usually no re-encoding). Without the second part, a server can't send channels it gets
        // as HLS (Tunarr's, FastChannels'): it has nothing to turn them into.
        DeviceProfile: {
          MaxStreamingBitrate: 200000000,
          DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
          TranscodingProfiles: [{
            Type: 'Video', Container: 'ts', Protocol: 'hls', Context: 'Streaming',
            VideoCodec: 'h264,hevc,mpeg2video', AudioCodec: 'aac,ac3,eac3,mp3,mp2',
            MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true,
          }],
        },
      },
    });
    const src = r && r.MediaSources && r.MediaSources[0];
    // What the server offers for this channel: the first thing to look at when one won't play.
    log.debug('[jellyfin] live channel', channelId, 'offers', JSON.stringify((r && r.MediaSources || []).map((m) => ({
      Id: m.Id, Protocol: m.Protocol, Path: m.Path, Container: m.Container, IsRemote: m.IsRemote, IsInfiniteStream: m.IsInfiniteStream,
      SupportsDirectPlay: m.SupportsDirectPlay, SupportsDirectStream: m.SupportsDirectStream, SupportsTranscoding: m.SupportsTranscoding,
      TranscodingUrl: m.TranscodingUrl ? m.TranscodingUrl.split('?')[0] : null, LiveStreamId: m.LiveStreamId, RequiresOpening: m.RequiresOpening,
      Streams: (m.MediaStreams || []).map((x) => `${x.Type}:${x.Codec || '?'}${x.Height ? ` ${x.Width}x${x.Height}` : ''}`),
      ErrorCode: r.ErrorCode,
    }))));
    if (!src) throw Object.assign(new Error(`no stream${r && r.ErrorCode ? ` (${r.ErrorCode})` : ''}`), { code: 'no-media' });
    const key = new URLSearchParams({ api_key: server.token });
    let url;
    if (src.TranscodingUrl) {
      url = `${server.url}${src.TranscodingUrl}${src.TranscodingUrl.includes('?') ? '&' : '?'}${key}`;
    } else {
      const q = new URLSearchParams({ static: 'true', mediaSourceId: src.Id, playSessionId: r.PlaySessionId || '', api_key: server.token });
      if (src.LiveStreamId) q.set('liveStreamId', src.LiveStreamId);
      url = `${server.url}/Videos/${channelId}/stream?${q}`;
    }
    // Where the server itself gets the channel (Tunarr, FastChannels, an IPTV address...), if it says.
    const direct = typeof src.Path === 'string' && /^https?:\/\//i.test(src.Path) ? src.Path : null;
    // When the server says it can't pass this stream on as it is (no direct stream, nothing to
    // transcode to: typical for HLS channels from Tunarr), go straight to where it gets it, and keep
    // the server's address as the second try. Otherwise the other way round.
    const serverCanPass = Boolean(src.SupportsDirectStream || src.SupportsDirectPlay || src.TranscodingUrl);
    // Also straight there first when it's on the same machine as the server (so this TV can surely
    // reach it): no work for the server, and it starts sooner.
    // Jellyfin's own stream comes first whenever it offers one: it works from anywhere (the
    // channel's own address, like a Tunarr or tuner box on the server's network, often only works
    // at home), and Jellyfin repackages it into something mpv reads reliably. The channel's own
    // address is only tried first if Jellyfin can't pass the stream on at all.
    if (direct && !serverCanPass) return { url: direct, liveStreamId: src.LiveStreamId || null, alt: url, directFirst: true, why: 'server-cannot' };
    return { url, liveStreamId: src.LiveStreamId || null, alt: direct };
  }

  async function closeLive(server, liveStreamId) {
    if (!liveStreamId) return;
    await req(server.url, '/LiveTv/LiveStreams/Close', { method: 'POST', token: server.token, query: { liveStreamId } }).catch(() => {});
  }

  // A show's TMDB id, for filling in episode titles and plots the server doesn't have.
  async function seriesTmdbId(server, seriesId) {
    const r = await itemsQuery(server, { ids: seriesId, fields: 'ProviderIds' });
    const it = r && r.Items && r.Items[0];
    const ids = (it && it.ProviderIds) || {};
    return Number(ids.Tmdb || ids.tmdb || ids.TMDB) || null;
  }

  // Every episode of a show, in order (all seasons): the playlist for mpv.
  async function allEpisodes(server, seriesId) {
    const r = await req(server.url, `/Shows/${seriesId}/Episodes`, { token: server.token, query: { userId: server.userId, fields: 'Overview' } });
    return ((r && r.Items) || []).map(playable);
  }

  // The original file, straight from the server (mpv sends the login as a header).
  const streamUrl = (server, itemId) => `${server.url}/Videos/${itemId}/stream?static=true`;

  // Where the intro and end credits are, if the server knows (Jellyfin 10.10+ media segments).
  async function segments(server, itemId) {
    try {
      const url = `/MediaSegments/${itemId}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`;
      const r = await req(server.url, url, { token: server.token });
      return ((r && r.Items) || [])
        .filter((g) => g.Type === 'Intro' || g.Type === 'Outro')
        .map((g) => ({ type: g.Type === 'Intro' ? 'intro' : 'credits', start: g.StartTicks / TICKS, end: g.EndTicks / TICKS }))
        .filter((g) => g.end > g.start);
    } catch {
      return []; // older server, or nothing marked
    }
  }

  async function nextUp(server, seriesId) {
    const r = await req(server.url, '/Shows/NextUp', {
      token: server.token, query: { userId: server.userId, seriesId, limit: '1', fields: 'Overview' },
    });
    const it = r && r.Items && r.Items[0];
    return it ? playable(it) : null;
  }

  // What to stream: the original file (no transcoding), its external subtitles, and a session id.
  async function playbackInfo(server, itemId) {
    const r = await req(server.url, `/Items/${itemId}/PlaybackInfo`, {
      method: 'POST', token: server.token, query: { userId: server.userId }, body: { UserId: server.userId },
    });
    const source = r && r.MediaSources && r.MediaSources[0];
    if (!source) throw Object.assign(new Error('no media'), { code: 'no-media' });
    const q = (extra) => new URLSearchParams({ ...extra, api_key: server.token }).toString();
    const subtitles = (source.MediaStreams || [])
      .filter((s) => s.Type === 'Subtitle' && s.IsExternal && Number.isInteger(s.Index))
      .map((s) => `${server.url}/Videos/${itemId}/${source.Id}/Subtitles/${s.Index}/0/Stream.${(s.Codec || 'srt').toLowerCase()}?${q({})}`);
    return {
      playSessionId: r.PlaySessionId || '',
      mediaSourceId: source.Id,
      url: `${server.url}/Videos/${itemId}/stream?${new URLSearchParams({ static: 'true', mediaSourceId: source.Id })}`,
      subtitles,
    };
  }

  // Playback reports keep Jellyfin's "continue watching" and watched marks in step.
  function report(server, stage, { itemId, mediaSourceId, playSessionId, seconds, paused }) {
    const path = stage === 'start' ? '/Sessions/Playing' : stage === 'progress' ? '/Sessions/Playing/Progress' : '/Sessions/Playing/Stopped';
    return req(server.url, path, {
      method: 'POST', token: server.token,
      body: {
        ItemId: itemId, MediaSourceId: mediaSourceId, PlaySessionId: playSessionId,
        PositionTicks: Math.max(0, Math.round((seconds || 0) * TICKS)),
        IsPaused: Boolean(paused), CanSeek: true, PlayMethod: 'DirectPlay',
      },
    }).catch(() => {}); // a missed report isn't worth interrupting playback for
  }

  // ---------------------------------------------------------------- music
  //
  // Albums in your music libraries, in the same shape as subsonic.js. Songs play in mpv from
  // /Audio/<id>/stream (the original file), with the token as a header.

  const albumOf = (server, it) => {
    const ids = it.ProviderIds || {};
    return {
      kind: 'album', serverId: server.id, serverName: server.name, itemId: it.Id, title: it.Name || '',
      artist: it.AlbumArtist || (it.AlbumArtists && it.AlbumArtists[0] && it.AlbumArtists[0].Name) || '',
      artists: [...new Set([...(it.AlbumArtists || []), ...(it.ArtistItems || [])].map((x) => x.Name).filter(Boolean))],
      year: it.ProductionYear ? String(it.ProductionYear) : '',
      cover: it.ImageTags && it.ImageTags.Primary ? `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(it.Id)}/Images/Primary?fillHeight=500&quality=85` : '',
      releaseTypes: [], compilation: false, mbid: ids.MusicBrainzAlbum || '', releaseGroup: ids.MusicBrainzReleaseGroup || '', songs: it.ChildCount || 0,
    };
  };
  const ALBUM_FIELDS = 'ProviderIds,ProductionYear,ChildCount';
  async function musicAlbums(server, { title, artist } = {}, limit = 30) {
    const q = { includeItemTypes: 'MusicAlbum', recursive: 'true', fields: ALBUM_FIELDS, limit: String(limit) };
    if (title) q.searchTerm = title;
    else if (artist) {
      // An artist's albums: theirs, and ones that credit them.
      const a = await itemsQuery(server, { searchTerm: artist, includeItemTypes: 'MusicArtist', recursive: 'true', limit: '10' });
      const ids = ((a && a.Items) || []).filter((x) => simplify(x.Name) === simplify(artist)).map((x) => x.Id);
      if (!ids.length) return [];
      q.artistIds = ids.join(',');
      q.limit = '200';
    }
    const r = await itemsQuery(server, q);
    return ((r && r.Items) || []).map((it) => albumOf(server, it));
  }
  async function musicAlbum(server, id) {
    const [a, t] = await Promise.all([
      itemsQuery(server, { ids: id, fields: ALBUM_FIELDS }),
      itemsQuery(server, { parentId: id, includeItemTypes: 'Audio', recursive: 'true', sortBy: 'ParentIndexNumber,IndexNumber,SortName' }),
    ]);
    const it = ((a && a.Items) || [])[0];
    if (!it) throw Object.assign(new Error('gone'), { code: 'gone' });
    return {
      ...albumOf(server, it),
      tracks: ((t && t.Items) || []).map((x) => ({
        id: x.Id, title: x.Name || '', artist: (x.Artists || []).join(', '), n: x.IndexNumber || 0, disc: x.ParentIndexNumber || 0,
        seconds: Math.round((x.RunTimeTicks || 0) / 1e7), url: `${server.url}/Audio/${x.Id}/stream?static=true`,
      })),
    };
  }
  // Songs by name (for playlists from elsewhere).
  async function musicSongs(server, title, limit = 15) {
    const r = await itemsQuery(server, { searchTerm: title, includeItemTypes: 'Audio', recursive: 'true', limit: String(limit) });
    return ((r && r.Items) || []).map((x) => ({
      id: x.Id, title: x.Name || '', artist: (x.Artists || []).join(', ') || x.AlbumArtist || '', album: x.Album || '',
      seconds: Math.round((x.RunTimeTicks || 0) / 1e7), url: `${server.url}/Audio/${x.Id}/stream?static=true`,
    }));
  }
  async function musicRecent(server, limit = 30) {
    const r = await itemsQuery(server, { includeItemTypes: 'MusicAlbum', recursive: 'true', fields: ALBUM_FIELDS, sortBy: 'DateCreated', sortOrder: 'Descending', limit: String(limit) });
    return ((r && r.Items) || []).map((it) => albumOf(server, it));
  }

  return {
    musicAlbums, musicAlbum, musicRecent, musicSongs,
    normalize, publicInfo, discover, quickConnectStart, quickConnectCheck, quickConnectFinish, signIn, find,
    showInDesktop, webSignInScript, webUrl, getItem, seasons, episodes, nextUp, playbackInfo, report,
    allEpisodes, streamUrl, segments, resumeItems, nextUpItems, recentlyPlayedTmdb, library, seriesTmdbId, liveChannels, livePrograms, openLive, closeLive,
  };
}

module.exports = { createJellyfin };
