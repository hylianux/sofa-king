// A pretend Jellyfin server on localhost:8096, recording what it's asked.
const http = require('http');
const log = [];
let qcPolls = 0;
const ITEMS = [
  { Id: 'item-arrival', Name: 'Arrival', Type: 'Movie', ProductionYear: 2016, ProviderIds: { Tmdb: '329865', Imdb: 'tt2543164' }, RunTimeTicks: 6.96e10, UserData: { PlaybackPositionTicks: 2.5e10, Played: false } },
  { Id: 'item-other', Name: 'Arrival', Type: 'Movie', ProductionYear: 1996, ProviderIds: { Tmdb: '10' } },
  { Id: 'series-sev', Name: 'Severance', Type: 'Series', ProductionYear: 2022, ProviderIds: { Tmdb: '95396' }, ImageTags: { Primary: 'x' } },
];
// A library to page through: 150 movies, A to Z, plus a few starting with digits.
const WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];
const LIBRARY = [];
['12 Monkeys', '2001: A Space Odyssey', '42'].forEach((n, i) => LIBRARY.push({ Id: `lib-d${i}`, Name: n, SortName: n, Type: 'Movie', ProductionYear: 1990 + i, ImageTags: { Primary: 'x' }, UserData: {} }));
for (const w of WORDS) for (let i = 1; i <= 6; i++) LIBRARY.push({ Id: `lib-${w}-${i}`, Name: `The ${w} Story ${i}`, SortName: `${w} Story ${i}`, Type: 'Movie', ProductionYear: 2000 + i, ImageTags: { Primary: 'x' }, UserData: { PlaybackPositionTicks: 0 } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function start(port = 8096) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const auth = req.headers.authorization || '';
    const authed = auth.includes('Token="tok-123"');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      log.push(`${req.method} ${url.pathname}${url.search}`);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const p = url.pathname;
      if (p === '/System/Info/Public') return json(200, { Id: 'srv-living-room', ServerName: 'Living Room', Version: '10.10.7' });
      if (p === '/QuickConnect/Enabled') return json(200, true);
      if (p === '/QuickConnect/Initiate' && req.method === 'POST') return json(200, { Code: '482913', Secret: 'secret-1' });
      if (p === '/QuickConnect/Connect') { qcPolls += 1; return json(200, { Authenticated: qcPolls >= 2 }); }
      if (p === '/Users/AuthenticateWithQuickConnect') return json(200, { AccessToken: 'tok-123', User: { Id: 'user-1', Name: 'hylianux' } });
      if (p === '/Users/AuthenticateByName') {
        const b = JSON.parse(body || '{}');
        return b.Pw === 'hunter2' ? json(200, { AccessToken: 'tok-123', User: { Id: 'user-1', Name: b.Username } }) : json(401);
      }
      if (!authed && (p === '/Items' || p.startsWith('/Sessions'))) return json(401);
      if (/^\/Items\/[^/]+\/Images\/Primary$/.test(p)) {
        if (req.headers['x-emby-token'] !== 'tok-123') return json(401);
        log.push('IMAGE ' + p);
        res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG);
      }
      // Live TV
      if (p === '/LiveTv/Channels') return json(200, { Items: [
        { Id: 'lc-nbc', Name: 'NBC', ChannelNumber: '4', ImageTags: { Primary: 'x' } },
        { Id: 'lc-cc', Name: 'Comedy Central', ChannelNumber: '30' },
        { Id: 'lc-only', Name: 'Local Weather', ChannelNumber: '2.4' },
      ] });
      if (p === '/LiveTv/Programs') {
        log.push('PROGRAMS ' + url.searchParams.get('channelIds'));
        const at = (h) => new Date(Math.floor(Date.now() / 3600e3) * 3600e3 + h * 3600e3).toISOString();
        const show = (ch, titles) => titles.map((t, i) => ({ ChannelId: ch, Name: t, StartDate: at(i), EndDate: at(i + 1), Overview: t + ' (plot)' }));
        return json(200, { Items: [...show('lc-nbc', ['News 4 New York', 'Jeopardy!', 'The Voice', 'Tonight Show']), ...show('lc-cc', ['The Daily Show', 'South Park', 'Futurama', 'Key & Peele'])] });
      }
      if (p === '/Items/lc-cc/PlaybackInfo' && process.env.JF_LIVE_FAIL) return json(500, {});
      if (p === '/Items/lc-only/PlaybackInfo' && process.env.JF_TUNARR) {
        return json(200, { PlaySessionId: 'ps3', MediaSources: [{ Id: 'ms3', LiveStreamId: 'live-3', Protocol: 'Http', Container: 'hls', Path: 'http://127.0.0.1:5523/tunarr/stream/1.ts', SupportsDirectPlay: false, SupportsDirectStream: false, SupportsTranscoding: false }] });
      }
      if (p === '/Videos/lc-only/stream' && process.env.JF_TUNARR) return json(500, {});
      if (p === '/Items/lc-only/PlaybackInfo' && process.env.JF_LIVE_SLOW) {
        // A Tunarr channel: the server takes a while to get the stream going.
        return setTimeout(() => json(200, { PlaySessionId: 'ps2', MediaSources: [{ Id: 'ms2', LiveStreamId: 'live-2', SupportsDirectStream: true }] }), 12000);
      }
      if (/^\/Items\/lc-[a-z]+\/PlaybackInfo$/.test(p)) {
        log.push('OPENLIVE ' + p + ' ' + url.search);
        return json(200, { PlaySessionId: 'ps1', MediaSources: [{ Id: 'ms1', LiveStreamId: 'live-1', TranscodingUrl: '/videos/lc/master.m3u8?LiveStreamId=live-1' }] });
      }
      if (p === '/LiveTv/LiveStreams/Close') { log.push('CLOSE ' + url.searchParams.get('liveStreamId')); return json(204); }
      if (p === '/UserItems/Resume') return json(200, { Items: [
        { ...ITEMS[0], UserData: { ...ITEMS[0].UserData, LastPlayedDate: '2026-11-20T10:00:00Z' }, ImageTags: { Primary: 'x' } },
        { Id: 'ep-102', Name: 'Half Loop', Type: 'Episode', SeriesName: 'Severance', SeriesId: 'series-sev', SeriesPrimaryImageTag: 'x', ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 3.3e10, UserData: { Played: false, PlaybackPositionTicks: 7.5e9, LastPlayedDate: '2026-11-22T21:00:00Z' } },
      ] });
      if (p === '/Items' && url.searchParams.get('ids')) {
        const ids = url.searchParams.get('ids').split(',');
        return json(200, { Items: ITEMS.filter((i) => ids.includes(i.Id)) });
      }
      if (p === '/Items' && url.searchParams.get('filters') === 'IsPlayed') return json(200, { Items: [
        { Id: 'ep-101', Type: 'Episode', SeriesId: 'series-sev' }, { ...ITEMS[0] }] });
      if (p === '/Items' && url.searchParams.get('sortBy') === 'SortName') {
        log.push('LIBRARY ' + url.search);
        const letter = url.searchParams.get('nameStartsWithOrGreater');
        const all = LIBRARY.filter((m) => !letter || m.SortName.toUpperCase() >= letter);
        const start = Number(url.searchParams.get('startIndex') || 0);
        const limit = Number(url.searchParams.get('limit') || 60);
        return json(200, { Items: all.slice(start, start + limit), TotalRecordCount: all.length });
      }
      if (p === '/Items') {
        const term = (url.searchParams.get('searchTerm') || '').toLowerCase();
        const types = (url.searchParams.get('includeItemTypes') || '').split(',');
        return json(200, { Items: ITEMS.filter((i) => i.Name.toLowerCase().includes(term) && (!types[0] || types.includes(i.Type))) });
      }
      if (p === '/Sessions' && req.method === 'GET') {
        return json(200, [{ Id: 'sess-desktop', Client: 'Jellyfin Desktop', DeviceName: require('os').hostname(), SupportsRemoteControl: true, LastActivityDate: new Date().toISOString() }]);
      }
      if (/^\/Sessions\/[^/]+\/Viewing$/.test(p)) return json(204);
      const EPISODES = {
        'season-1': [
          { Id: 'ep-101', Name: 'Pilot', Type: 'Episode', SeriesName: 'Severance', SeriesId: 'series-sev', ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 3.3e10, Overview: 'Mark leads a team.', UserData: { Played: true, PlaybackPositionTicks: 0 } },
          { Id: 'ep-102', Name: 'Half Loop', Type: 'Episode', SeriesName: 'Severance', SeriesId: 'series-sev', ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 3.3e10, Overview: 'Helly tries to quit.', UserData: { Played: false, PlaybackPositionTicks: 7.5e9 } },
          { Id: 'ep-103', Name: 'In Perpetuity', Type: 'Episode', SeriesName: 'Severance', SeriesId: 'series-sev', ParentIndexNumber: 1, IndexNumber: 3, RunTimeTicks: 3.3e10, Overview: 'A field trip.', UserData: { Played: false } },
        ],
        'season-2': [
          { Id: 'ep-201', Name: 'Severance.S02E01.1080p.WEB.mkv', Type: 'Episode', SeriesName: 'Severance', SeriesId: 'series-sev', ParentIndexNumber: 2, IndexNumber: 1, RunTimeTicks: 3.3e10, UserData: { Played: false } },
        ],
      };
      const ALL = [...ITEMS, ...Object.values(EPISODES).flat()];
      let m;
      if ((m = /^\/Shows\/([^/]+)\/Seasons$/.exec(p))) return json(200, { Items: [
        { Id: 'season-1', Name: 'Season 1', IndexNumber: 1, UserData: { UnplayedItemCount: 2 } },
        { Id: 'season-2', Name: 'Season 2', IndexNumber: 2, UserData: { UnplayedItemCount: 1 } }] });
      if ((m = /^\/Shows\/([^/]+)\/Episodes$/.exec(p))) {
        const sid = url.searchParams.get('seasonId');
        return json(200, { Items: sid ? EPISODES[sid] || [] : Object.values(EPISODES).flat() });
      }
      if ((m = /^\/MediaSegments\/([^/]+)$/.exec(p))) {
        return json(200, { Items: m[1] === 'ep-102' || m[1] === 'ep-103' ? [
          { Type: 'Intro', StartTicks: 5e7, EndTicks: 2e8 }, { Type: 'Outro', StartTicks: 5e8, EndTicks: 6e8 }] : [] });
      }
      if (p === '/Shows/NextUp') return json(200, { Items: [url.searchParams.get('seriesId') ? EPISODES['season-1'][1] : { ...EPISODES['season-2'][0], SeriesPrimaryImageTag: 'x' }] });
      if ((m = /^\/Items\/([^/]+)\/PlaybackInfo$/.exec(p))) return json(200, { PlaySessionId: 'play-1', MediaSources: [{ Id: 'ms-' + m[1], MediaStreams: [
        { Type: 'Video', Index: 0 }, { Type: 'Subtitle', Index: 3, IsExternal: true, Codec: 'srt' }, { Type: 'Subtitle', Index: 2, IsExternal: false, Codec: 'subrip' }] }] });
      if ((m = /^\/Items\/([^/]+)$/.exec(p))) { const it = ALL.find((i) => i.Id === m[1]); return it ? json(200, it) : json(404, {}); }
      if (p.startsWith('/Sessions/Playing')) { log.push('REPORT ' + p + ' ' + body); return json(204); }
      if (p.startsWith('/web')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<body><p id="c"></p><script>document.getElementById("c").textContent=localStorage.getItem("jellyfin_credentials")||"none"</script></body>');
      }
      json(404, {});
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { start, log };
