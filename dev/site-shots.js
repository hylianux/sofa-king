// Screenshots for the website (site/shots/). Runs the real app with made-up films (poster art drawn
// here, no real posters) and pretend live channels; nothing real is contacted or played.
//   node_modules/.bin/electron dev/site-shots.js --layout=netflix --mood=classic --shots=home,detail
const path = require('path'); const fs = require('fs'); const http = require('http');
const { app, BaseWindow, session } = require('electron');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
const LAYOUT = arg('layout', 'netflix'); const MOOD = arg('mood', 'classic');
const SHOTS = arg('shots', 'home').split(',');
const NAME = arg('name', LAYOUT);
const OUTDIR = path.join(__dirname, '..', 'site', 'shots'); fs.mkdirSync(OUTDIR, { recursive: true });
const UD = path.join(__dirname, 'tests', 'out', 'userdata-siteshots');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);

// ---- made-up films and series, each with its own colours
const FILMS = [
  ['The Lighthouse Keeper', 'Drama', ['#0f2a44', '#e8a23a']], ['Neon Harbor', 'Thriller', ['#1a0b33', '#ff3d8b']],
  ['Paper Moons', 'Romance', ['#2b1a3d', '#f6c9a8']], ['Orbit of Ash', 'Science Fiction', ['#05070d', '#5ad1ff']],
  ['Small Town Giants', 'Comedy', ['#2f5d1f', '#ffd447']], ['The Quiet Field', 'Drama', ['#3b4a2a', '#d9c27a']],
  ['Midnight Line', 'Mystery', ['#0b1020', '#8f7bff']], ['Saltwater Kings', 'Adventure', ['#023047', '#ffb703']],
  ['Afterglow', 'Romance', ['#3a0d2e', '#ff8fab']], ['Iron Orchard', 'Western', ['#3d1f0f', '#e76f51']],
  ['The Clockmaker', 'Fantasy', ['#1d1a12', '#d4a373']], ['Static Bloom', 'Horror', ['#0d0d0d', '#9ef01a']],
  ['North of Nowhere', 'Adventure', ['#14213d', '#a8dadc']], ['Golden Hour', 'Drama', ['#4a2511', '#ffc971']],
  ['Velvet Signal', 'Science Fiction', ['#10002b', '#c77dff']], ['The Long Night', 'Thriller', ['#0a0f1c', '#e63946']],
  ['Harbor Lights', 'Family', ['#003049', '#fcbf49']], ['Wildflower Road', 'Comedy', ['#264653', '#e9c46a']],
  ['Cold Front', 'Action', ['#0b2545', '#8ecae6']], ['The Last Arcade', 'Comedy', ['#1b0036', '#00f5d4']],
  ['Echoes of Glass', 'Mystery', ['#0e1c26', '#b8f2e6']], ['Summer of Kites', 'Family', ['#1d3557', '#f1faee']],
  ['Brass & Thunder', 'Action', ['#2a1a0a', '#f4a261']], ['Quiet Storm', 'Drama', ['#1c2333', '#9db4c0']],
];
const byId = new Map(FILMS.map((f, i) => [1000 + i, { id: 1000 + i, title: f[0], genre: f[1], colors: f[2] }]));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// A poster: a gradient, a big soft shape, the title.
function poster(f, w = 300, h = 450, words = true) {
  const [a, b] = f.colors; const seed = f.id * 37;
  const cx = 60 + (seed % 180); const cy = 110 + (seed % 140); const r = 70 + (seed % 60);
  const shape = ['circle', 'hills', 'rings'][f.id % 3];
  const art = shape === 'circle' ? `<circle cx="${cx * w / 300}" cy="${cy * h / 450}" r="${r * w / 300}" fill="${b}" opacity="0.85"/>`
    : shape === 'hills' ? `<path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.45} ${w * 0.55} ${h * 0.66} T ${w} ${h * 0.58} V ${h} H 0 Z" fill="${b}" opacity="0.7"/><path d="M0 ${h * 0.82} Q ${w * 0.4} ${h * 0.62} ${w} ${h * 0.78} V ${h} H 0 Z" fill="${a}" opacity="0.9"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${w * 0.09}" fill="${b}"/>`
      : [1, 2, 3, 4].map((k) => `<circle cx="${w / 2}" cy="${h * 0.4}" r="${k * w * 0.09}" fill="none" stroke="${b}" stroke-width="${w * 0.012}" opacity="${1 - k * 0.2}"/>`).join('');
  const lines = f.title.split(' ').reduce((acc, wd) => { const l = acc[acc.length - 1]; if (l && (l + ' ' + wd).length <= 12) acc[acc.length - 1] = l + ' ' + wd; else acc.push(wd); return acc; }, []);
  const fs1 = w * 0.105;
  const text = words ? lines.map((l, i) => `<text x="${w / 2}" y="${h * 0.8 + (i - lines.length + 1) * fs1 * 1.05}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${fs1}" fill="#fff" letter-spacing="1">${esc(l.toUpperCase())}</text>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#000"/></linearGradient><radialGradient id="v" cx="0.5" cy="0.4" r="0.8"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${art}<rect width="100%" height="100%" fill="url(#v)"/>${text}</svg>`;
}
const OVERVIEW = {
  'The Lighthouse Keeper': 'A retired keeper returns to the island where her brother vanished, and finds the lamp lit every night.',
  'Neon Harbor': 'A night-shift taxi driver is pulled into a smuggling ring that runs through the city\'s flooded docks.',
  'Orbit of Ash': 'The last crew of a mining station must decide who goes home when only one capsule is left.',
};
const card = (f, i) => ({ id: f.id, media_type: i % 3 === 1 ? 'tv' : 'movie', title: f.title, name: f.title, poster_path: `/p${f.id}.svg`, backdrop_path: `/b${f.id}.svg`, vote_average: 6.8 + (f.id % 20) / 10, vote_count: 900, overview: OVERVIEW[f.title] || `${f.genre}. A story about ${f.title.toLowerCase()}.`, release_date: `20${18 + (f.id % 7)}-05-01`, first_air_date: `20${18 + (f.id % 7)}-01-01`, popularity: 100 });
const shuffled = (k) => FILMS.map((_, i) => byId.get(1000 + ((i * k + 3) % FILMS.length)));
let page = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, opts); // (the pretend servers here)
  const J = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  if (u.hostname !== 'api.themoviedb.org') return new Response('', { status: 404 }); // (nothing real is asked)
  const p = u.pathname.replace('/3', '');
  const m = /^\/(movie|tv)\/(\d+)$/.exec(p);
  if (m) {
    const f = byId.get(+m[2]) || byId.get(1000);
    return J({ id: f.id, title: f.title, name: f.title, tagline: '', overview: OVERVIEW[f.title] || `${f.genre}. A story about ${f.title.toLowerCase()}.`, vote_average: 7.6, vote_count: 18000, release_date: '2024-11-11', first_air_date: '2024-11-11', runtime: 116, genres: [{ id: 18, name: f.genre }], backdrop_path: `/b${f.id}.svg`, poster_path: `/p${f.id}.svg`, number_of_seasons: 2,
      credits: { crew: [{ id: 1, name: 'Mara Ellison', job: 'Director' }], cast: [{ id: 3, name: 'June Okafor', character: 'Ada' }, { id: 4, name: 'Tomas Reyes', character: 'Eli' }, { id: 5, name: 'Priya Hale', character: 'Wren' }] },
      external_ids: {}, 'watch/providers': { results: { US: { flatrate: [{ provider_name: 'Netflix' }, { provider_name: 'Hulu' }, { provider_name: 'Max' }], free: [{ provider_name: 'Tubi' }], rent: [{ provider_name: 'Apple TV' }] } } } });
  }
  if (/^\/watch\/providers\/(movie|tv)$/.test(p)) return J({ results: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 15, provider_name: 'Hulu' }] });
  if (/genre\/(movie|tv)\/list/.test(p)) return J({ genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Science Fiction', 'Family', 'Mystery'].map((name, i) => ({ id: 10 + i, name })) });
  if (/^\/(trending|discover|search)|recommendations|similar/.test(p)) { page += 1; return J({ results: shuffled([1, 5, 7, 11, 13][page % 5]).map(card), page: 1, total_pages: 1 }); }
  return J({ results: [] });
};

// ---- pretend live channels (a list and a guide, served here)
const CHANNELS = [
  ['Harbor News 24', 'News', ['Morning Report', 'Market Watch', 'World Today', 'Weather Desk', 'Evening Report']],
  ['Retro Movies', 'Movies', ['Brass & Thunder', 'Cold Front', 'The Clockmaker', 'Golden Hour']],
  ['Cartoon Junction', 'Kids', ['Captain Pickle', 'Robot Pals', 'Snack Attack', 'The Bunny Brigade']],
  ['Stadium One', 'Sports', ['Match Day Live', 'Highlights', 'Coaches\' Corner', 'Late Kick-off']],
  ['Chill FM Visuals', 'Music', ['Lo-fi Sunrise', 'Synth Drive', 'Jazz After Dark', 'Ambient Hours']],
  ['Science Channel Plus', 'Documentary', ['Deep Oceans', 'How It\'s Built', 'Night Sky', 'Volcano Watch']],
  ['Comedy Corner', 'Entertainment', ['Stand-up Showcase', 'Sitcom Classics', 'Late Laughs', 'Prank Week']],
  ['Cooking Today', 'Lifestyle', ['Bread Basics', 'One-Pan Dinners', 'Sweet Tooth', 'Street Food Tour']],
  ['Mystery Theatre', 'Movies', ['Midnight Line', 'Echoes of Glass', 'The Long Night', 'Quiet Storm']],
  ['Nature Live', 'Documentary', ['Birds of the Coast', 'Big Cats', 'Rainforest Diaries', 'Wild Rivers']],
  ['Retro Gaming TV', 'Entertainment', ['Speedrun Hour', 'Arcade Legends', 'Pixel Talk', 'Boss Battles']],
  ['Classic Westerns', 'Movies', ['Iron Orchard', 'Dust Riders', 'High Mesa', 'Last Stagecoach']],
  ['Global Weather', 'News', ['Forecast', 'Storm Tracker', 'Forecast', 'Travel Weather']],
  ['Kids Science Lab', 'Kids', ['Fizz & Pop', 'Space Cadets', 'Bug World', 'Tiny Machines']],
];
const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const base = Date.now() - (Date.now() % 1800000) - 900000;
let m3u = '#EXTM3U\n'; let xml = '<?xml version="1.0"?><tv>';
CHANNELS.forEach(([name, group], i) => { m3u += `#EXTINF:-1 tvg-id="c${i}" tvg-chno="${101 + i}" group-title="${group}",${name}\nhttp://127.0.0.1:5611/s/${i}.m3u8\n`; xml += `<channel id="c${i}"><display-name>${esc(name)}</display-name></channel>`; });
CHANNELS.forEach(([, , shows], i) => { for (let h = 0; h < 16; h++) { const s = base + h * 1800000 * (1 + (i % 2)); xml += `<programme start="${fmt(s)}" stop="${fmt(s + 1800000 * (1 + (i % 2)))}" channel="c${i}"><title>${esc(shows[(h + i) % shows.length])}</title><desc>${esc(shows[(h + i) % shows.length])}: a new episode.</desc></programme>`; } });
xml += '</tv>';
http.createServer((req, res) => {
  if (req.url === '/list.m3u') return res.end(m3u);
  if (req.url === '/guide.xml') return res.end(xml);
  res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n');
}).listen(5611);

// ---- a pretend Navidrome with a made-up band's album (a song made of tones, a drawn cover)
const { execFileSync } = require('child_process');
const SONG = path.join(UD, 'song.mp3'); const COVER = path.join(UD, 'cover.png');
if (SHOTS.includes('music')) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=110:d=60', '-f', 'lavfi', '-i', 'sine=f=165:d=60', '-f', 'lavfi', '-i', 'anoisesrc=d=60:a=0.15:c=pink',
    '-filter_complex', '[0][2]amix=2,tremolo=f=2:d=0.9[l];[1][2]amix=2,tremolo=f=3:d=0.7[r];[l][r]join=inputs=2:channel_layout=stereo,volume=2', '-c:a', 'libmp3lame', SONG]);
  const svg = path.join(UD, 'cover.svg');
  fs.writeFileSync(svg, poster({ id: 1014, title: 'Velvet Signal', colors: ['#10002b', '#c77dff'] }, 600, 600));
  execFileSync('rsvg-convert', ['-w', '600', '-h', '600', '-o', COVER, svg]);
}
const nd = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
  const J = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: '0.61.2', openSubsonic: true, ...o } })); };
  if (m === 'getAlbum') return J({ album: { id: 'al-1', name: 'Velvet Signal', artist: 'The Paper Moons', year: 2024, coverArt: 'al-1', song: [{ id: 's1', title: 'Harbor Lights', artist: 'The Paper Moons', album: 'Velvet Signal', albumId: 'al-1', coverArt: 'al-1', track: 1, duration: 60 }] } });
  if (m === 'getCoverArt') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(fs.readFileSync(COVER)); }
  if (m === 'stream') { const f = fs.readFileSync(SONG); res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(f.length) }); return res.end(f); }
  if (m === 'ping' || m === 'scrobble' || m === 'getMusicFolders') return J({});
  res.writeHead(404); res.end();
}).listen(5612, '127.0.0.1');

fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  mpvVolume: 0, mpvVisual: 'cover', // (silent: nothing out loud on the speakers)
  music: { servers: [{ id: 'sub-0a1b2c', name: 'Navidrome', url: 'http://127.0.0.1:5612', user: 'me', token: 't0k', salt: 's4lt' }] },
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  layout: LAYOUT, look: { theme: MOOD, base: MOOD, custom: null },
  live: { iptvOrgAsked: true, hideBroken: false, lists: [{ id: 'demo', name: 'My channels', m3u: 'http://127.0.0.1:5611/list.m3u', guide: 'http://127.0.0.1:5611/guide.xml' }] },
}));
require(path.join(__dirname, '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    session.defaultSession.protocol.handle('https', async (req) => {
      const m = /\/(p|b)(\d+)\.svg$/.exec(new URL(req.url).pathname);
      const f = m && byId.get(+m[2]);
      const svg = f ? (m[1] === 'p' ? poster(f) : poster(f, 1280, 720, false)) : '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
    });
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(5000);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const shot = async (name) => { await wait(1200); fs.writeFileSync(path.join(OUTDIR, `${name}.png`), (await wc.capturePage()).toPNG()); };
    const key = async (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(350); };
    for (const s of SHOTS) {
      if (s === 'home') {
        await js("go('home'); setView('home'); 0"); await wait(2500);
        await key('Down'); await key('Right'); await key('Right');
        await shot(`home-${NAME}`);
      } else if (s === 'detail') {
        await js("openDetail({ kind: 'movie', id: 1003, title: 'Orbit of Ash' }); 0"); await wait(3000);
        await shot('detail');
      } else if (s === 'live') {
        await js("go('home'); setView('live'); 0"); await wait(6000);
        await js("document.querySelectorAll('#live-list .live-ch')[2].focus(); 0");
        await shot('live');
      } else if (s === 'search') {
        await js("go('home'); setView('home'); openSearch(); setQuery('the'); 0"); await wait(3000);
        await shot('search');
      } else if (s === 'look') {
        await js("go('home'); openSettings({ tab: 'look' }); 0"); await wait(2500);
        await shot('settings-look');
      } else if (s === 'music') {
        // Played in mpv: its own screenshots (with the card and pictures drawn on top).
        const sock = () => { const dir = process.env.XDG_RUNTIME_DIR; const f = fs.readdirSync(dir).find((x) => /^tv-overlay-\d+-\d+\.sock$/.test(x) && x.includes(`-${process.pid}-`)); return f && path.join(dir, f); };
        const ask = (cmd) => new Promise((resolve) => {
          const so = require('net').createConnection(sock()); let buf = '';
          so.on('connect', () => so.write(JSON.stringify({ command: cmd, request_id: 7 }) + '\n'));
          so.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.request_id === 7) { so.end(); resolve(m.data); } } catch { /* partial */ } } });
          so.on('error', () => resolve(null)); setTimeout(() => { so.destroy(); resolve(null); }, 3000);
        });
        fs.writeFileSync(path.join(OUTDIR, 'music-play.txt'), JSON.stringify(await js("tv.musicPlay('sub-0a1b2c', 'al-1', 0)")));
        for (let i = 0; i < 40 && !sock(); i++) await wait(250);
        await ask(['set_property', 'volume', 0]);
        await wait(9000); // (after the button panel has faded)
        for (let i = 0; i < 7; i++) {
          const g = String(await ask(['get_property', 'lavfi-complex']) || '');
          const id = (require('../visuals').VISUALS.find((v) => g === require('../visuals').graphFor(v.id, (g.match(/movie=([^,]+)/) || [])[1] || null)) || {}).id || 'x';
          await ask(['screenshot-to-file', path.join(OUTDIR, `music-${id}.png`), 'window']);
          await ask(['keypress', 'GAMEPAD_RIGHT_STICK']); await wait(3500);
        }
        await ask(['quit']); await wait(1000);
      } else if (s === 'genres') {
        await js("go('home'); setView('genres'); 0"); await wait(3500);
        await shot('genres');
      }
    }
  } catch (e) { fs.writeFileSync(path.join(OUTDIR, 'error.txt'), e.stack); }
  app.exit(0);
});
