'use strict';

// The Music tab, an artist's page and an album's page (loaded after home.js, and using its
// helpers: el, $, go, back, toast, tvNav...).
//
// Find it first, then see where it's streaming: the catalogue (MusicBrainz and Deezer, in the main
// process) answers what exists; the album's page shows your music services and your own servers.
// An artist's page sorts the catalogue onto shelves (albums, EPs, singles, live, compilations...,
// then unofficial releases and tributes), and puts in what's on your servers too: albums that match
// get a mark, ones that credit the artist go with the tributes, and the rest get their own shelf.

screens.artist = $('screen-artist');
screens.album = $('screen-album');
screens.playlist = $('screen-playlist');

const musicState = { loaded: false, loading: false, artistSeq: 0, albumSeq: 0, settings: null };

// ------------------------------------------------------------ cards

function musicInitials(text) {
  return String(text || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// A square picture (round for an artist), or the first letters until (or unless) it loads.
function musicArt(src, label, round = false) {
  const box = el('span', { class: `m-art${round ? ' round' : ''}` }, el('span', { class: 'm-initials', textContent: musicInitials(label) }));
  if (src) {
    const img = el('img', { alt: '', loading: 'lazy', src });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

function musicCard(item, { onServers = false } = {}) {
  const artist = item.kind === 'artist';
  const sub = artist ? 'Artist'
    : item.kind === 'playlist' ? (item.date ? `Made ${item.date}` : 'Playlist')
    : item.kind === 'song' ? [item.artist, item.album].filter(Boolean).join(' · ')
      : [item.artist, item.year, item.serverId ? '' : item.type].filter(Boolean).join(' · ');
  const art = musicArt(artist ? item.picture : item.cover, artist ? item.name : item.title, artist);
  if (onServers) art.append(el('span', { class: 'm-mine', title: 'On your servers', textContent: '●' }));
  if (item.unofficial) art.append(el('span', { class: 'm-tag', textContent: 'Unofficial' }));
  const card = el('button', {
    class: `card m-card${artist ? ' artist' : ''}`, nav: true,
    onclick: () => openMusicItem(item),
  }, art, el('span', { class: 'name', textContent: artist ? item.name : item.title }), el('span', { class: 'sub', textContent: sub }));
  card.dataset.key = musicKey(item);
  return card;
}

const musicKey = (item) => [item.kind, item.mbid || '', item.deezerId || '', item.serverId || '', item.itemId || '', item.name || item.title || ''].join('|');

function openMusicItem(item) {
  if (item.kind === 'artist') return openArtist(item);
  if (item.kind === 'playlist') return openPlaylist(item);
  if (item.kind === 'song') return openAlbum({ deezerId: item.albumDeezerId, title: item.album, artist: item.artist, song: item.title });
  return openAlbum(item);
}

// A shelf: its name, then a line of cards (left and right along it; up and down between shelves).
function shelf(title, items, { id = '', count = true, library = null } = {}) {
  const box = el('section', { class: 'm-shelf' });
  if (id) box.dataset.shelf = id;
  box.append(el('h2', { class: 'eyebrow', textContent: count && items.length > 1 ? `${title} · ${items.length}` : title }));
  const line = el('div', { class: 'm-line' });
  for (const it of items) line.append(musicCard(it, { onServers: Boolean(library && library(it)) }));
  box.append(line);
  return box;
}

// Placeholders while a shelf is on its way.
function shelfLoading(title, n = 6) {
  const cards = Array.from({ length: n }, () => el('span', { class: 'card m-card ghost' }, el('span', { class: 'm-art skeleton-block' }), el('span', { class: 'skeleton-line', style: { width: '70%' } })));
  return el('section', { class: 'm-shelf loading' }, el('h2', { class: 'eyebrow', textContent: title }), el('div', { class: 'm-line' }, ...cards));
}

// Moving onto a shelf shows the whole of it, its name included.
for (const box of [$('ar-shelves'), $('music-rows')]) {
  box.addEventListener('focusin', (e) => {
    const sh = e.target.closest('.m-shelf');
    if (sh) sh.scrollIntoView({ block: 'nearest', behavior: lessMotion() ? 'auto' : 'smooth' });
  });
}

// ------------------------------------------------------------ the Music tab

async function showMusic(focus) {
  const rows = $('music-rows');
  if (!musicState.loaded && !musicState.loading) {
    musicState.loading = true;
    rows.replaceChildren(shelfLoading('Popular albums'), shelfLoading('Popular artists'));
    const res = await tv.musicCharts();
    musicState.loading = false;
    if (res.error) {
      rows.replaceChildren();
      $('music-empty').hidden = false;
      $('music-empty-text').textContent = res.error === 'unreachable' ? 'The music catalogue isn\'t answering. Check your internet connection and try again.' : ERRORS.failed;
      if (view === 'music' && focus) $('open-music-search').focus();
      return;
    }
    $('music-empty').hidden = true;
    musicState.loaded = true;
    rows.replaceChildren(...res.ok.map((r) => shelf(r.title, r.items, { id: r.id, count: false })));
    await addRadioShelf();
    await addMadeForShelf();
  }
  if (focus && view === 'music') $('open-music-search').focus();
}
$('open-music-search').addEventListener('click', () => openSearch({ music: true }));

// ------------------------------------------------------------ search (the Search screen, music mode)

async function runMusicSearch() {
  const q = search.query.trim();
  const seq = ++search.seq;
  const res = await tv.musicSearch(q);
  if (seq !== search.seq || !search.music) return;
  $('results-message').hidden = true;
  if (res.error) {
    $('results').replaceChildren();
    $('results-label').textContent = 'Search';
    $('results-message-text').textContent = res.error === 'unreachable' ? 'The music catalogue isn\'t answering. Check your internet connection.' : ERRORS.failed;
    $('results-setup').hidden = true;
    $('results-message').hidden = false;
    return;
  }
  const { artists, albums, songs } = res.ok;
  const total = artists.length + albums.length + songs.length;
  $('results-label').textContent = total ? `Results for “${q}”` : `Nothing found for “${q}”`;
  const list = $('results');
  list.replaceChildren();
  list.scrollTop = 0;
  let i = 0;
  for (const [title, items] of [['Artists', artists], ['Albums', albums], ['Songs', songs]]) {
    if (!items.length) continue;
    list.append(el('h3', { class: 'results-head', textContent: title }));
    for (const it of items) { const c = musicCard(it); c.style.setProperty('--i', String(i++)); list.append(c); }
  }
  // Their names for the suggestions above the keys.
  searchSugg.titles = [...artists.map((a) => a.name), ...albums.map((a) => a.title), ...songs.map((x) => x.title)];
  searchSuggestSoon(0);
}

// ------------------------------------------------------------ an artist's page

async function openArtist(item) {
  const seq = ++musicState.artistSeq;
  go('artist');
  const name = item.name || item.artist || '';
  $('ar-name').textContent = name;
  $('ar-about').textContent = '';
  $('ar-picture').replaceChildren(musicArt(item.picture, name, true));
  $('ar-backdrop').style.backgroundImage = item.picture ? `url("${item.picture}")` : '';
  const shelves = $('ar-shelves');
  shelves.replaceChildren(shelfLoading('Albums'), shelfLoading('Singles'));
  $('ar-page').scrollTop = 0;
  // Something to stand on while it loads (B still goes back).
  const holder = el('button', { class: 'pill', nav: true, textContent: 'Loading…', onclick: back });
  shelves.prepend(holder);
  holder.focus();

  const res = await tv.musicArtist({ name, mbid: item.artistMbid || item.mbid || undefined, deezerId: item.deezerId || undefined });
  if (screen !== 'artist' || seq !== musicState.artistSeq) return;
  if (res.error) {
    shelves.replaceChildren(el('p', { class: 'message', textContent: res.error === 'unreachable' ? 'The music catalogue isn\'t answering. Check your internet connection and try again.' : ERRORS.failed }),
      el('button', { class: 'pill', nav: true, textContent: 'Back', onclick: back }));
    shelves.lastChild.focus();
    return;
  }
  const a = res.ok;
  $('ar-name').textContent = a.name;
  $('ar-about').textContent = a.about;
  if (a.picture) {
    $('ar-picture').replaceChildren(musicArt(a.picture, a.name, true));
    $('ar-backdrop').style.backgroundImage = `url("${a.picture}")`;
  }

  // Your albums, by title: the ones that match the catalogue get a mark on their card.
  // Matched first by MusicBrainz id (when your tags have one), then by title, then by title
  // without volume numbers ("Outcesticide I: In Memory of Kurt Cobain" is "Outcesticide: In
  // Memory of Kurt Cobain" in the catalogue), as long as only one of yours fits.
  const lib = a.library || [];
  const used = new Set();
  const normOf = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+(single|ep)$/, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const looseOf = (t) => normOf(t).replace(/\b(vol(ume)?\s*)?([ivx]+|\d+)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const index = (key) => {
    const m = new Map();
    for (const x of lib) { const k = key(x); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(x); } }
    return m;
  };
  const byTitle = index((x) => x.norm);
  const byLoose = index((x) => looseOf(x.title));
  const byGroup = () => index((x) => x.releaseGroup || '');
  let groups = byGroup();
  const shown = []; // every catalogue item on the page, to mark later when more is known
  const onServers = (it) => {
    if (!shown.includes(it)) shown.push(it);
    let hits = (it.mbid && groups.get(it.mbid)) || byTitle.get(normOf(it.title));
    if (!hits) {
      const loose = (byLoose.get(looseOf(it.title)) || []).filter((x) => !used.has(x));
      if (loose.length === 1 && looseOf(it.title).length > 3) hits = loose;
    }
    if (!hits) return false;
    for (const h of hits) used.add(h);
    it.yours = hits;
    return true;
  };
  const markCard = (it) => {
    const card = shelves.querySelector(`.card[data-key="${CSS.escape(musicKey(it))}"] .m-art`);
    if (card && !card.querySelector('.m-mine')) card.append(el('span', { class: 'm-mine', title: 'On your servers', textContent: '●' }));
  };
  const showShelf = (id) => !(musicState.settings && musicState.settings.shelves && musicState.settings.shelves[id] === false);

  shelves.replaceChildren(...a.shelves.map((s) => shelf(s.title, s.items, { id: s.id, library: onServers })));
  // The rest of what's on your servers: theirs (but not in the catalogue), and albums by others
  // that credit them (tributes, covers, compilations), which join the tributes shelf below.
  const placeLibrary = () => {
    const left = lib.filter((x) => !used.has(x));
    const own = left.filter((x) => !x.credited);
    const credited = left.filter((x) => x.credited);
    shelves.querySelector('[data-shelf="yours-only"]')?.remove();
    if (own.length) shelves.append(shelf('Only on your servers', own, { id: 'yours-only' }));
    return credited;
  };
  let credited = placeLibrary();
  const first = shelves.querySelector('.card');
  if (first) first.focus(); else shelves.append(el('button', { class: 'pill', nav: true, textContent: 'Back', onclick: back }));
  if (!shelves.querySelector('.card')) shelves.lastChild.focus();

  // Your tagged albums whose edition isn't matched yet: which album they are, then mark them.
  const unknown = lib.filter((x) => !used.has(x) && x.mbid && !x.releaseGroup).slice(0, 20);
  const placeGroups = async () => {
    if (!unknown.length) return;
    const r = await tv.musicGroups(unknown.map((x) => x.mbid));
    if (screen !== 'artist' || seq !== musicState.artistSeq || !r.ok) return;
    for (const x of unknown) if (r.ok[x.mbid]) x.releaseGroup = r.ok[x.mbid];
    groups = byGroup();
    for (const it of shown) if (!it.yours && groups.get(it.mbid) && onServers(it)) markCard(it);
    credited = placeLibrary();
  };

  // Then the slower shelves, one after another, added at the bottom (nothing above moves).
  if (!a.mbid) {
    if (credited.length) shelves.append(shelf('Tributes and covers', credited, { id: 'tribute' }));
    await relatedShelf(a, shelves, seq);
    return;
  }
  await placeGroups();
  for (const which of ['unofficial', 'unofficial-live', 'tribute', 'appears']) {
    if (!showShelf(which === 'unofficial-live' ? 'unofficial' : which)) continue;
    const title = { unofficial: 'Unofficial', 'unofficial-live': 'Unofficial live recordings', tribute: 'Tributes and covers', appears: 'Appears on' }[which];
    if (screen !== 'artist' || seq !== musicState.artistSeq) return;
    const ghost = shelfLoading(title, 5);
    const yoursOnly = shelves.querySelector('[data-shelf="yours-only"]');
    shelves.insertBefore(ghost, yoursOnly);
    const r = await tv.musicExtra(a.mbid, which);
    if (screen !== 'artist' || seq !== musicState.artistSeq) return;
    let items = r.ok || [];
    if (which === 'tribute') {
      // Tributes on your servers that the catalogue doesn't list.
      const have = new Set(items.map((x) => normOf(x.title)));
      for (const x of items) onServers(x);
      items = [...items, ...credited.filter((x) => !have.has(x.norm))];
    }
    const box = items.length ? shelf(title, items, { id: which, library: onServers }) : null;
    const hadFocus = ghost.contains(document.activeElement);
    if (box) ghost.replaceWith(box); else ghost.remove();
    if (hadFocus) (box ? box.querySelector('.card') : shelves.querySelector('.card'))?.focus();
    credited = placeLibrary();
  }
  // Tributes switched off: albums crediting them still have a place.
  if (!showShelf('tribute') && credited.length) shelves.insertBefore(shelf('Credits them', credited, { id: 'tribute' }), shelves.querySelector('[data-shelf="yours-only"]'));
  await relatedShelf(a, shelves, seq);
}

// Artists like this one, last on the page.
async function relatedShelf(a, shelves, seq) {
  if (musicState.settings && musicState.settings.shelves && musicState.settings.shelves.related === false) return;
  const ghost = shelfLoading('Related artists', 6);
  shelves.append(ghost);
  const r = await tv.musicRelated({ mbid: a.mbid || '', name: a.name });
  if (screen !== 'artist' || seq !== musicState.artistSeq) return;
  const items = (r.ok || []).filter((x) => x.name);
  const hadFocus = ghost.contains(document.activeElement);
  if (items.length) {
    const box = shelf('Related artists', items, { id: 'related', count: false });
    ghost.replaceWith(box);
    if (hadFocus) box.querySelector('.card')?.focus();
  } else {
    ghost.remove();
    if (hadFocus) shelves.querySelector('.card')?.focus();
  }
}

// ------------------------------------------------------------ an album's page

const mmss = (sec) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');

async function openAlbum(item) {
  const seq = ++musicState.albumSeq;
  go('album');
  const bar = (w) => el('span', { class: 'skeleton-line', style: { width: w } });
  $('al-kind').textContent = item.type || 'Album';
  $('al-title').textContent = item.title || '';
  $('al-artist').textContent = item.artist || '';
  $('al-artist').hidden = !item.artist;
  $('al-meta').replaceChildren(bar('10rem'));
  $('al-cover').replaceChildren(musicArt(item.cover, item.title));
  $('al-backdrop').style.backgroundImage = item.cover ? `url("${item.cover}")` : '';
  $('al-yours-label').hidden = true;
  $('al-yours').replaceChildren();
  $('al-listen-label').hidden = false;
  $('al-listen-label').textContent = 'Listen on';
  $('al-listen').replaceChildren(el('button', { class: 'watch-btn plain loading', nav: true, onclick: back }, el('span', { class: 'wb-name', textContent: 'Finding where it\'s streaming…' }), bar('8rem')));
  $('al-note').textContent = '';
  $('al-tracks').replaceChildren(...Array.from({ length: 8 }, () => el('div', { class: 'al-track ghost' }, bar('60%'))));
  $('al-listen').firstElementChild.focus();

  const res = await tv.musicAlbum({ mbid: item.mbid, deezerId: item.deezerId, title: item.title, artist: item.artist, serverId: item.serverId, itemId: item.itemId });
  if (screen !== 'album' || seq !== musicState.albumSeq) return;
  if (res.error) {
    $('al-meta').textContent = '';
    $('al-tracks').replaceChildren();
    $('al-note').textContent = res.error === 'unreachable' ? 'The music catalogue isn\'t answering. Check your internet connection and try again.' : ERRORS.failed;
    $('al-listen').replaceChildren(el('button', { class: 'watch-btn plain', nav: true, textContent: 'Back', onclick: back }));
    $('al-listen').firstElementChild.focus();
    return;
  }
  const a = res.ok;
  $('al-kind').textContent = [a.type || 'Album', a.status].filter(Boolean).join(' · ');
  $('al-title').textContent = a.title;
  $('al-artist').textContent = a.artist;
  $('al-artist').hidden = !a.artist;
  $('al-artist').onclick = () => openArtist({ name: a.artist, artistMbid: a.artistMbid });
  const minutes = Math.round(a.tracks.reduce((n, t) => n + (t.seconds || 0), 0) / 60);
  $('al-meta').textContent = [a.year, a.tracks.length ? `${a.tracks.length} ${a.tracks.length === 1 ? 'track' : 'tracks'}` : '', minutes ? `${minutes} min` : '', a.label].filter(Boolean).join('  ·  ');
  if (a.cover) {
    $('al-cover').replaceChildren(musicArt(a.cover, a.title));
    $('al-backdrop').style.backgroundImage = `url("${a.cover}")`;
  }

  // Your servers first: each copy plays the whole album in mpv.
  const yours = a.yours || [];
  $('al-yours-label').hidden = !yours.length;
  $('al-yours').replaceChildren(...yours.map((y) => el('button', {
    class: 'watch-btn mine', nav: true, onclick: () => playAlbum(y, 0),
  }, el('span', { class: 'wb-name', textContent: y.serverName }), el('small', { textContent: 'Play the album' }))));

  // The music services you use: straight to the album, or their search when we don't know where.
  const listen = $('al-listen');
  // (YouTube Music is found when you press it, and plays where YouTube opens: VacuumTube, say.)
  const viaYouTube = (l) => l.service === 'youtube-music';
  listen.replaceChildren(...a.links.map((l) => el('button', {
    class: `watch-btn${l.direct || viaYouTube(l) ? '' : ' sells'}`, nav: true,
    style: { '--svc': l.color, '--svc-text': textFor(l.color) },
    onclick: () => (viaYouTube(l) ? playOnYouTube('album', a.title, a.artist) : tv.openLink(l.url, l.service)),
  }, el('span', { class: 'wb-name', textContent: l.name }), el('small', { textContent: viaYouTube(l) ? 'Play the album' : l.direct ? 'Open the album' : 'Search for it' }))));
  $('al-listen-label').hidden = !a.links.length;
  $('al-note').textContent = !a.links.length && !yours.length
    ? (a.status === 'Unofficial' ? 'Unofficial releases aren\'t on the music services.' : 'Not found on your music services or your servers.')
    : a.links.some((l) => !l.direct && l.service !== 'youtube-music') ? 'Outlined buttons open that service\'s search for this album.' : '';

  // The tracks: OK on one plays from there (from your servers).
  const playable = yours[0] || null;
  let disc = 0;
  const rows = [];
  for (const t of a.tracks) {
    if (t.disc && t.disc !== disc && a.tracks.some((x) => x.disc && x.disc !== t.disc)) { disc = t.disc; rows.push(el('p', { class: 'al-disc', textContent: `Disc ${disc}` })); }
    const row = el('button', {
      class: `al-track${item.song && normSong(t.title) === normSong(item.song) ? ' picked' : ''}`, nav: true,
      // (Not on your servers: the song on YouTube Music instead.)
      onclick: () => (playable ? playAlbum(playable, a.tracks.indexOf(t)) : playOnYouTube('song', t.title, t.artist || a.artist)),
    }, el('span', { class: 'n', textContent: String(t.n) }), el('span', { class: 't', textContent: t.title }), el('span', { class: 'd', textContent: mmss(t.seconds) }));
    rows.push(row);
  }
  $('al-tracks').replaceChildren(...rows);
  $('al-tracks').classList.toggle('playable', Boolean(playable));
  // Where to start: the song you picked, or the first way to listen.
  const picked = $('al-tracks').querySelector('.picked');
  if (picked) { picked.focus(); picked.scrollIntoView({ block: 'center' }); } else ($('al-yours').firstElementChild || listen.firstElementChild || $('al-tracks').querySelector('.al-track') || $('al-artist')).focus();
}
const normSong = (s) => String(s || '').toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, '');

async function playOnYouTube(kind, title, artist) {
  toast(`Looking for ${title} on YouTube Music…`, 3000);
  const r = await tv.musicYouTube(kind, title, artist);
  if (r && r.ok === false && !r.error) toast('Not found on YouTube Music, so it\'s a YouTube search instead.', 4000);
}

async function playAlbum(y, start) {
  toast(`Opening ${y.title || 'the album'} from ${y.serverName}…`, 3000);
  const r = await tv.musicPlay(y.serverId, y.itemId, start);
  if (r.error) toast(r.error === 'no-mpv' ? 'Playing music needs mpv. Install it from your package manager (Settings → Apps shows whether it\'s found).' : r.error === 'busy' ? 'Something is already playing.' : 'Couldn\'t play that album from your server.', 6000);
}
tv.onMusicPlayed((info) => { if (info && info.error) toast(info.error === 'mpv-failed' ? 'mpv quit straight away. The log (Settings → Developer) has what it said.' : 'mpv closed with a problem. Settings → Developer → the log has the details.', 6000); });

// ------------------------------------------------------------ made for you (ListenBrainz)

// The Music tab's "Made for you" shelf, after Radio (when you've given your ListenBrainz name).
async function addMadeForShelf() {
  const r = await tv.musicMadeFor();
  const rows = $('music-rows');
  rows.querySelector('[data-shelf="made-for"]')?.remove();
  if (!r.ok || !r.ok.length) return;
  const box = shelf('Made for you', r.ok, { id: 'made-for', count: false });
  const after = rows.querySelector('[data-shelf="radio"]') || rows.querySelector('[data-shelf="yours"]');
  if (after) after.after(box); else rows.prepend(box);
}

// A playlist: its songs, matched on your servers. Play plays the ones you have, in order; a song
// you don't have plays on YouTube Music.
const playlistState = { seq: 0, tracks: [], found: [] };
async function openPlaylist(item) {
  const seq = ++playlistState.seq;
  go('playlist');
  $('pl-title').textContent = item.title || 'Playlist';
  $('pl-meta').textContent = '';
  $('pl-about').textContent = item.about || '';
  $('pl-cover').replaceChildren(musicArt('', item.title));
  $('pl-backdrop').style.backgroundImage = '';
  $('pl-tracks').replaceChildren();
  const holder = el('button', { class: 'watch-btn plain loading', nav: true, onclick: back }, el('span', { class: 'wb-name', textContent: 'Loading the playlist…' }));
  $('pl-play').replaceChildren(holder);
  holder.focus();
  const r = await tv.musicPlaylist(item.id);
  if (screen !== 'playlist' || seq !== playlistState.seq) return;
  if (r.error) {
    $('pl-play').replaceChildren(el('button', { class: 'watch-btn plain', nav: true, textContent: 'Back', onclick: back }));
    $('pl-meta').textContent = r.error === 'unreachable' ? 'ListenBrainz isn\'t answering. Check your internet connection.' : 'Couldn\'t open this playlist.';
    $('pl-play').firstElementChild.focus();
    return;
  }
  const pl = r.ok;
  playlistState.tracks = pl.tracks;
  playlistState.found = [];
  const cover = (pl.tracks.find((t) => t.cover) || {}).cover || '';
  $('pl-cover').replaceChildren(musicArt(cover, pl.title));
  $('pl-backdrop').style.backgroundImage = cover ? `url("${cover}")` : '';
  const mins = Math.round(pl.tracks.reduce((n, t) => n + (t.seconds || 0), 0) / 60);
  $('pl-meta').textContent = `${pl.tracks.length} songs${mins ? `  ·  ${mins} min` : ''}`;
  if (pl.about) $('pl-about').textContent = pl.about;
  $('pl-tracks').replaceChildren(...pl.tracks.map((t, i) => el('button', { class: 'al-track', nav: true, onclick: () => playFromPlaylist(i) },
    el('span', { class: 'n', textContent: String(i + 1) }),
    el('span', { class: 't' }, t.title, el('small', { textContent: `  ·  ${t.artist}` })),
    el('span', { class: 'd', textContent: mmss(t.seconds) }))));
  $('pl-play').firstElementChild.querySelector('.wb-name').textContent = 'Looking for these on your servers…';
  const f = await tv.musicFindSongs(pl.tracks.map((t) => ({ title: t.title, artist: t.artist })));
  if (screen !== 'playlist' || seq !== playlistState.seq) return;
  playlistState.found = f.ok || [];
  const have = playlistState.found.filter(Boolean).length;
  [...$('pl-tracks').children].forEach((row, i) => row.classList.toggle('on-servers', Boolean(playlistState.found[i])));
  const focusWasHere = $('pl-play').contains(document.activeElement);
  $('pl-play').replaceChildren(have
    ? el('button', { class: 'watch-btn mine', nav: true, onclick: () => playFromPlaylist(playlistState.found.findIndex(Boolean)) },
      el('span', { class: 'wb-name', textContent: 'Play from your servers' }), el('small', { textContent: `${have} of ${pl.tracks.length} songs` }))
    : el('button', { class: 'watch-btn plain', nav: true, onclick: () => playFromPlaylist(0) },
      el('span', { class: 'wb-name', textContent: 'Play the first song on YouTube Music' })));
  $('pl-about').textContent = `${pl.about ? `${pl.about}  ` : ''}${have < pl.tracks.length ? 'Songs with a dot are on your servers; the others play on YouTube Music.' : ''}`;
  if (focusWasHere) $('pl-play').firstElementChild.focus();
}

function playFromPlaylist(i) {
  const t = playlistState.tracks[i];
  if (!t) return;
  const found = playlistState.found;
  if (!found[i]) return playOnYouTube('song', t.title, t.artist);
  const list = found.filter(Boolean);
  toast(`Playing ${t.title}…`, 3000);
  tv.musicPlaySongs(list, list.indexOf(found[i])).then((r) => {
    if (r.error) toast(r.error === 'no-mpv' ? 'Playing music needs mpv. Install it from your package manager (Settings → Apps shows whether it\'s found).' : r.error === 'busy' ? 'Something is already playing.' : 'Couldn\'t play those songs from your servers.', 6000);
  });
}

// ------------------------------------------------------------ Settings → Music

function renderMusicSettings(st) {
  musicState.settings = st;
  const list = $('mu-servers');
  list.replaceChildren(...st.servers.map((s) => el('div', { class: 'server' },
    el('div', {}, el('p', { class: 'server-name', textContent: s.name }), el('p', { class: 'server-meta', textContent: `${s.url} · ${s.user}` })),
    el('div', { class: 'server-actions' }, el('button', { class: 'pill quiet', nav: true, textContent: 'Remove', onclick: () => removeMusicServer(s) })))));
  $('mu-services').replaceChildren(...st.services.map((s) => {
    const b = el('button', { class: `pill toggle${s.on ? ' on' : ''}`, nav: true, onclick: async () => { const r = await tv.musicSetService(s.id, !s.on); if (r.ok) renderMusicSettings(r.ok); focusLater(`#mu-services [data-service="${s.id}"]`); } },
      el('span', { textContent: s.name }), el('span', { class: 'switch', 'aria-hidden': 'true' }));
    b.dataset.service = s.id;
    return b;
  }));
  // The picture while music plays.
  const had = document.activeElement && document.activeElement.closest('#mu-visual') ? document.activeElement.dataset.visual : null;
  $('mu-visual').replaceChildren(...(st.visuals || []).map((v) => {
    const b = el('button', { class: `pill${v.id === st.visual ? ' chosen' : ''}`, nav: true, textContent: v.name, onclick: async () => { const r = await tv.musicSetVisual(v.id); if (r.ok) renderMusicSettings(r.ok); } });
    b.dataset.visual = v.id;
    return b;
  }));
  if (had) $('mu-visual').querySelector(`[data-visual="${had}"]`)?.focus();
  $('mu-visual-how').hidden = !st.visualButton;
  $('mu-visual-button').textContent = st.visualButton || '';
  $('mu-use-jellyfin').classList.toggle('on', st.useJellyfin);
  $('mu-use-plex').classList.toggle('on', st.usePlex);
  $('mu-use-jellyfin').hidden = !st.jellyfin;
  $('mu-use-plex').hidden = !st.plex;
  $('mu-lb-status').className = `status ${st.listenbrainz ? 'good' : 'none'}`;
  $('mu-lb-status').textContent = st.listenbrainz ? `On · ${st.listenbrainz}` : 'Off';
  $('mu-lb-set').textContent = st.listenbrainz ? 'Change your name' : 'Add your ListenBrainz name';
  $('mu-lb-clear').hidden = !st.listenbrainz;
  $('mu-lf-status').className = `status ${st.lastfm ? 'good' : 'none'}`;
  $('mu-lf-status').textContent = st.lastfm ? `Last.fm · key ${st.lastfm}` : 'ListenBrainz (no key needed)';
  $('mu-lf-setup').textContent = st.lastfm ? 'Change key' : 'Set up Last.fm';
  $('mu-lf-remove').hidden = !st.lastfm;
  // Scrobbling.
  const signedIn = Boolean(st.lastfmUser);
  $('mu-sc-status').className = `status ${signedIn && st.scrobble ? 'good' : 'none'}`;
  $('mu-sc-status').textContent = !st.lastfm ? 'Needs your Last.fm key first'
    : signedIn ? (st.scrobble ? `Scrobbling as ${st.lastfmUser}` : `Signed in as ${st.lastfmUser} · scrobbling off`)
      : st.lastfmSigningIn ? 'Waiting for you to press Allow on Last.fm…' : 'Not signed in';
  $('mu-sc-signin').hidden = signedIn;
  $('mu-sc-signin').textContent = st.lastfm ? 'Sign in to scrobble' : 'Set up Last.fm';
  $('mu-sc-signout').hidden = !signedIn;
  $('mu-sc-on').hidden = !signedIn;
  $('mu-sc-on').classList.toggle('on', st.scrobble !== false);
  // One switch per server, once scrobbling is on.
  const perServer = signedIn && st.scrobble !== false && st.scrobbleServers.length > 0;
  $('mu-sc-servers-label').hidden = !perServer;
  $('mu-sc-servers').hidden = !perServer;
  $('mu-sc-servers').replaceChildren(...(perServer ? st.scrobbleServers : []).map((s) => {
    const b = el('button', {
      class: `pill toggle${s.on ? ' on' : ''}`, nav: true,
      onclick: async () => { const r = await tv.lastfmServer(s.id, !s.on); if (r.ok) renderMusicSettings(r.ok); focusLater(`#mu-sc-servers [data-server="${CSS.escape(s.id)}"]`); },
    }, el('span', { textContent: s.name.includes(s.kind) ? s.name : `${s.name} (${s.kind})` }), el('span', { class: 'switch', 'aria-hidden': 'true' }));
    b.dataset.server = s.id;
    return b;
  }));
  for (const k of ['unofficial', 'tribute', 'appears', 'related']) $(`mu-shelf-${k}`).classList.toggle('on', st.shelves[k] !== false);
  renderMusicFolders();
}
const focusLater = (sel) => requestAnimationFrame(() => document.querySelector(sel)?.focus());

async function renderMusicFolders() {
  const box = $('mu-folders');
  const servers = (musicState.settings && musicState.settings.servers) || [];
  if (!servers.length) { box.replaceChildren(el('p', { class: 'fine', textContent: 'Add a server first.' })); return; }
  const parts = [];
  for (const s of servers) {
    const r = await tv.musicFolders(s.id);
    parts.push(el('p', { class: 'fine', textContent: s.name }));
    if (r.error) { parts.push(el('p', { class: 'note bad', textContent: 'Couldn\'t ask the server for its folders.' })); continue; }
    for (const f of r.ok.all) {
      const on = r.ok.picked.includes(f.id);
      const b = el('button', { class: `pill toggle${on ? ' on' : ''}`, nav: true, onclick: async () => { await tv.musicSetFolder(s.id, f.id, !on); await renderMusicFolders(); focusLater(`#mu-folders [data-folder="${s.id}:${f.id}"]`); } },
        el('span', { textContent: f.name }), el('span', { class: 'switch', 'aria-hidden': 'true' }));
      b.dataset.folder = `${s.id}:${f.id}`;
      parts.push(b);
    }
  }
  box.replaceChildren(...parts);
}

async function addMusicServer() {
  const note = (t, good) => { $('mu-note').textContent = t; $('mu-note').classList.toggle('good', Boolean(good)); };
  const url = await askFor({ label: 'Your server\'s address', eyebrow: 'Music · Add a server', hint: 'For example my-server:4533 or http://192.168.1.10:4533', placeholder: 'my-server:4533' });
  if (!url) return focusLater('#mu-add');
  const user = await askFor({ label: 'Your user name on it', eyebrow: 'Music · Add a server' });
  if (!user) return focusLater('#mu-add');
  const password = await askFor({ label: `The password for ${user}`, eyebrow: 'Music · Add a server', secret: true });
  if (!password) return focusLater('#mu-add');
  note('Checking…');
  const r = await tv.musicAddServer(url, user, password);
  if (r.error) {
    note({ unauthorized: 'The server didn\'t accept that user name and password.', unreachable: 'Nothing answered at that address.', 'bad-address': 'That doesn\'t look like an address.', 'not-subsonic': 'Something answered, but it isn\'t a Subsonic server (check the address and port).', 'no-token': 'That server can\'t check a scrambled sign-in, only a plain password, which the app doesn\'t keep. If the server can make an app password or API key, use that as the password.' }[r.error] || 'Couldn\'t add the server.');
  } else {
    note('Added. Its albums now show up in the Music tab.', true);
    renderMusicSettings(r.ok);
    musicState.loaded = false; // "New on your servers" next time
  }
  focusLater('#mu-add');
}
async function removeMusicServer(s) {
  const r = await tv.musicRemoveServer(s.id);
  if (r.ok) renderMusicSettings(r.ok);
  musicState.loaded = false;
  focusLater('#mu-add');
}
$('mu-add').addEventListener('click', addMusicServer);
for (const kind of ['jellyfin', 'plex']) {
  $(`mu-use-${kind}`).addEventListener('click', async () => {
    const on = !$(`mu-use-${kind}`).classList.contains('on');
    const r = await tv.musicUse(kind, on);
    if (r.ok) renderMusicSettings(r.ok);
    musicState.loaded = false;
  });
}
$('mu-lb-set').addEventListener('click', async () => {
  const name = await askFor({ label: 'Your ListenBrainz user name', eyebrow: 'Music · Recommendations', value: (musicState.settings && musicState.settings.listenbrainz) || '', hint: 'As it shows on listenbrainz.org (your profile\'s address works too).' });
  if (name == null || !name.trim()) return focusLater('#mu-lb-set');
  $('mu-lb-note').textContent = 'Checking with ListenBrainz…';
  const r = await tv.musicListenBrainz(name);
  $('mu-lb-note').textContent = r.ok ? 'Done. Your playlists are on the Music tab.' : r.error === 'no-user' ? 'ListenBrainz doesn\'t know that name. Check the spelling.' : r.error === 'bad-user' ? 'That doesn\'t look like a ListenBrainz name.' : 'ListenBrainz isn\'t answering. Try again in a moment.';
  $('mu-lb-note').classList.toggle('good', Boolean(r.ok));
  if (r.ok) { renderMusicSettings(r.ok); musicState.loaded = false; }
  focusLater('#mu-lb-set');
});
$('mu-lb-clear').addEventListener('click', async () => {
  const r = await tv.musicListenBrainz('');
  if (r.ok) renderMusicSettings(r.ok);
  $('mu-lb-note').textContent = '';
  musicState.loaded = false;
  focusLater('#mu-lb-set');
});
$('mu-lf-setup').addEventListener('click', () => openSetup('lastfm'));

// ---- Scrobbling to Last.fm
const LASTFM_ERRORS = {
  'bad-secret': 'Last.fm didn\'t accept that secret. It\'s the "Shared secret" just below your API key, not the key itself.',
  'not-a-key': 'That doesn\'t look like a shared secret (32 letters and numbers).',
  'bad-key': 'Last.fm didn\'t accept your key. Set it up again.',
  unreachable: 'Couldn\'t reach Last.fm. Check your internet connection.',
  busy: 'Last.fm is busy. Try again in a minute.',
};
// Sign in: the shared secret first if it wasn't picked up with the key, then Last.fm's "allow
// access" page opens here; once you press Allow, you're brought back by yourself.
async function lastfmSignIn() {
  const note = (t) => { if ($('mu-sc-note')) $('mu-sc-note').textContent = t || ''; };
  let st = await tv.musicSettings();
  if (!st.ok || !st.ok.lastfm) { openSetup('lastfm'); return; }
  // No secret: the setup explains where it is (shown only once, when the key was made) and how to
  // get one (a new key). Once it's in, Sign in to scrobble works.
  if (!st.ok.lastfmSecret) { openSetup('lastfm', 'secret'); return; }
  note('');
  const r = await tv.lastfmSignIn();
  if (r.error) { note(LASTFM_ERRORS[r.error] || ERRORS.failed); focusLater('#mu-sc-signin'); return; }
  renderMusicSettings(r.ok);
  note('Last.fm\'s page is open: sign in there if it asks, then press Allow. You\'ll come back here by yourself.');
}
$('mu-sc-signin').addEventListener('click', lastfmSignIn);
$('mu-sc-signout').addEventListener('click', async () => {
  const r = await tv.lastfmSignOut();
  if (r.ok) renderMusicSettings(r.ok);
  $('mu-sc-note').textContent = '';
  focusLater('#mu-sc-signin');
});
$('mu-sc-on').addEventListener('click', async () => {
  const r = await tv.lastfmScrobble(!$('mu-sc-on').classList.contains('on'));
  if (r.ok) renderMusicSettings(r.ok);
});
tv.onLastfmSignedIn(async (user) => {
  $('mu-sc-note').textContent = '';
  const st = await tv.musicSettings();
  if (st.ok) renderMusicSettings(st.ok);
  toast(`Signed in to Last.fm as ${user}. Scrobbling is on.`);
  if (screen === 'settings') focusLater('#mu-sc-on');
});
$('mu-lf-remove').addEventListener('click', async () => {
  await tv.setAnyKey('lastfm', '');
  const r = await tv.musicSettings();
  if (r.ok) renderMusicSettings(r.ok);
  focusLater('#mu-lf-setup');
});
for (const k of ['unofficial', 'tribute', 'appears', 'related']) {
  $(`mu-shelf-${k}`).addEventListener('click', async () => {
    const r = await tv.musicShelf(k, !$(`mu-shelf-${k}`).classList.contains('on'));
    if (r.ok) renderMusicSettings(r.ok);
  });
}
tv.onMusicChanged((st) => renderMusicSettings(st));
tv.musicSettings().then((r) => { if (r.ok) renderMusicSettings(r.ok); });

// ------------------------------------------------------------ radio

screens.radio = $('screen-radio');
const radio = { tab: 'favorites', list: [], state: null, seq: 0, search: '' };

// A station as a card on the Music tab: OK plays it (next / previous in mpv move along the shelf).
function stationCard(st, list) {
  const card = el('button', { class: 'card m-card station', nav: true, onclick: () => playStation(list, list.indexOf(st)) },
    musicArt(st.logo, st.name), el('span', { class: 'name', textContent: st.name }), el('span', { class: 'sub', textContent: st.about || 'Radio' }));
  card.dataset.key = `station|${st.id}`;
  return card;
}
function radioShelf(state) {
  const list = [...state.favorites, ...state.mine.filter((m) => !state.favorites.some((f) => f.id === m.id))];
  const box = el('section', { class: 'm-shelf' });
  box.dataset.shelf = 'radio';
  box.append(el('h2', { class: 'eyebrow', textContent: 'Radio' }));
  const line = el('div', { class: 'm-line' });
  line.append(el('button', { class: 'card m-card radio-more', nav: true, onclick: () => openRadio(list.length ? 'favorites' : 'popular') },
    el('span', { class: 'm-art' }, el('span', { class: 'm-initials', textContent: '📻' })),
    el('span', { class: 'name', textContent: list.length ? 'All stations' : 'Find stations' }),
    el('span', { class: 'sub', textContent: 'Popular here, SomaFM, search' })));
  for (const st of list) line.append(stationCard(st, list));
  box.append(line);
  return box;
}
// (Put in the Music tab after "New on your servers", or first.)
async function addRadioShelf() {
  const r = await tv.radioState();
  if (!r.ok) return;
  radio.state = r.ok;
  const rows = $('music-rows');
  rows.querySelector('[data-shelf="radio"]')?.remove();
  const yours = rows.querySelector('[data-shelf="yours"]');
  const shelfEl = radioShelf(r.ok);
  if (yours) yours.after(shelfEl); else rows.prepend(shelfEl);
}

const RADIO_TABS = [
  { id: 'favorites', name: '★ Favourites' },
  { id: 'mine', name: 'Your stations' },
  { id: 'recent', name: 'Recently played' },
  { id: 'popular', name: 'Popular' },
  { id: 'somafm', name: 'SomaFM' },
  { id: 'search', name: 'Search' },
  { id: 'countries', name: 'Country' },
];

async function openRadio(tab = 'favorites') {
  const r = await tv.radioState();
  if (r.ok) radio.state = r.ok;
  go('radio');
  renderRadioTabs();
  showRadioTab(tab);
}
function renderRadioTabs() {
  const st = radio.state || {};
  $('radio-tabs').replaceChildren(...RADIO_TABS.filter((t) => t.id !== 'somafm' || st.somafm).map((t) => {
    const b = el('button', { class: `pill${t.id === radio.tab ? ' chosen' : ''}`, nav: true, textContent: t.id === 'popular' && st.country ? `Popular in ${st.country}` : t.name, onclick: () => showRadioTab(t.id, { focusList: true }) });
    b.dataset.tab = t.id;
    return b;
  }));
}

// L1 / R1: the tab before or after, stopping at the ends. (Search is passed over: landing on it
// would ask you to type.)
function stepRadioTab(dir) {
  const tabs = [...$('radio-tabs').children].map((b) => b.dataset.tab).filter((t) => t !== 'search');
  const i = tabs.indexOf(radio.tab);
  const to = tabs[Math.max(0, Math.min(tabs.length - 1, (i < 0 ? 0 : i) + dir))];
  if (to && to !== radio.tab) { if (window.tvSound) window.tvSound('move'); showRadioTab(to); }
}

async function showRadioTab(tab, { focusList = false } = {}) {
  const seq = ++radio.seq;
  radio.tab = tab;
  for (const b of $('radio-tabs').children) b.classList.toggle('chosen', b.dataset.tab === tab);
  const listBox = $('radio-list');
  const note = $('radio-note');
  if (tab === 'search') {
    const q = await askFor({ label: 'Search for a station', eyebrow: 'Radio', value: radio.search, placeholder: 'jazz, BBC, KEXP…', suggest: 'radio' });
    if (seq !== radio.seq) return;
    if (!q) { $('radio-tabs').querySelector('[data-tab="search"]')?.focus(); return; }
    radio.search = q;
  }
  note.textContent = tab === 'countries' ? 'Pick the country for "Popular".' : 'Loading…';
  listBox.replaceChildren();
  $('radio-tabs').querySelector(`[data-tab="${tab}"]`)?.focus();
  if (tab === 'countries') {
    const r = await tv.radioCountries();
    if (seq !== radio.seq) return;
    if (r.error) { note.textContent = 'Radio Browser isn\'t answering. Check your internet connection.'; return; }
    listBox.replaceChildren(el('div', { class: 'iptv-grid radio-countries' }, ...r.ok.map((c) => el('button', {
      class: `pill${radio.state && radio.state.country === c.code ? ' chosen' : ''}`, nav: true,
      onclick: async () => { const s = await tv.radioSetCountry(c.code); if (s.ok) radio.state = s.ok; renderRadioTabs(); showRadioTab('popular', { focusList: true }); },
    }, el('span', { textContent: c.name }), el('small', { textContent: ` ${c.count}` })))));
    if (focusList) listBox.querySelector('.chosen, .pill')?.focus();
    return;
  }
  const r = await tv.radioList(tab, tab === 'search' ? radio.search : null);
  if (seq !== radio.seq) return;
  if (r.error) { note.textContent = 'The station list isn\'t answering. Check your internet connection.'; return; }
  radio.list = r.ok;
  note.textContent = r.ok.length ? ({ favorites: 'Your favourite stations. ☆ beside any station adds it here.', mine: 'Stations you added (Settings → Music → Radio).', recent: 'The stations you\'ve listened to lately, newest first.', popular: `The most played stations in ${(radio.state && radio.state.country) || 'your country'}.`, somafm: 'Listener-supported, ad-free channels from San Francisco.', search: `Stations matching “${radio.search}”.` }[tab] || '')
    : ({ favorites: 'No favourites yet. Press ☆ beside a station to add it.', mine: 'Add your own in Settings → Music → Radio.', recent: 'Nothing yet: stations you listen to show up here.', search: `Nothing found for “${radio.search}”.` }[tab] || 'Nothing here.');
  listBox.replaceChildren(...r.ok.map((st, i) => radioRow(st, i, { removable: tab === 'recent' })));
  // Recently played: a way to clear the lot (after asking).
  if (tab === 'recent' && r.ok.length) {
    listBox.prepend(el('div', { class: 'radio-tools' }, el('button', { class: 'pill quiet', nav: true, textContent: 'Clear all', onclick: clearRecentRadio })));
  }
  if (focusList || tab === 'search') listBox.querySelector('.radio-st')?.focus();
}

async function clearRecentRadio() {
  const ok = await askSure({ eyebrow: 'Radio', title: 'Clear your recently played stations?', yes: 'Yes, clear them', no: 'No, keep them', fine: 'Your favourites and your own stations stay as they are.' });
  if (!ok) return;
  const r = await tv.radioRecentClear();
  if (r.error) { toast('Couldn\'t clear them. Try again.', 3000); return; }
  toast('Cleared your recently played stations.', 3000);
  showRadioTab('recent');
  $('radio-tabs').querySelector('[data-tab="recent"]')?.focus();
}

// A station: ☆ to make it a favourite, then the station itself (OK plays it). In Recently played,
// ✕ after it takes it off the list.
function radioRow(st, i, { removable = false } = {}) {
  const fav = el('button', { class: `live-fav${st.favorite ? ' on' : ''}`, nav: true, textContent: st.favorite ? '★' : '☆', title: st.favorite ? 'Remove from favourites' : 'Add to favourites' });
  fav.addEventListener('click', async () => {
    const r = await tv.radioFavorite(st, !st.favorite);
    if (!r.ok) return;
    radio.state = r.ok;
    st.favorite = !st.favorite;
    fav.classList.toggle('on', st.favorite);
    fav.textContent = st.favorite ? '★' : '☆';
    toast(st.favorite ? `Added ${st.name} to your favourites.` : `Took ${st.name} out of your favourites.`, 3000);
    musicState.loaded = false; // the Music tab's Radio shelf, next time
  });
  const logo = el('span', { class: 'logo' }, el('span', { textContent: musicInitials(st.name) }));
  if (st.logo) { const img = el('img', { alt: '', loading: 'lazy', src: st.logo }); img.addEventListener('error', () => img.remove()); logo.append(img); }
  const btn = el('button', { class: 'radio-st', nav: true, onclick: () => playStation(radio.list, i) },
    logo, el('span', { class: 'st-name', textContent: st.name }), el('span', { class: 'st-about', textContent: st.about || '' }));
  const row = el('div', { class: 'radio-row' }, fav, btn);
  if (removable) {
    const x = el('button', { class: 'live-fav radio-x', nav: true, textContent: '✕', title: 'Take it off this list', 'aria-label': `Take ${st.name} off this list` });
    x.addEventListener('click', async () => {
      const r = await tv.radioRecentRemove(st.id);
      if (r.error) return;
      // Stay where you were: the next row's ✕, or the one before.
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      radio.list = r.ok;
      // (Each row plays from the list as it now is.)
      showRadioTab('recent').then(() => {
        const rows = [...$('radio-list').querySelectorAll('.radio-row')];
        const at = next && next.dataset.key ? rows.find((x) => x.dataset.key === next.dataset.key) : null;
        (at ? at.querySelector('.radio-x') : $('radio-list').querySelector('.radio-tools .pill') || $('radio-tabs').querySelector('[data-tab="recent"]'))?.focus();
      });
      toast(`Took ${st.name} off Recently played.`, 3000);
    });
    row.append(x);
  }
  row.dataset.key = st.id;
  return row;
}

async function playStation(list, index) {
  const st = list[index];
  if (!st) return;
  toast(`Tuning in to ${st.name}…`, 3000);
  const r = await tv.radioPlay(list, index);
  if (r.error) toast(r.error === 'no-mpv' ? 'Radio plays in mpv. Install it from your package manager (Settings → Apps shows whether it\'s found).' : r.error === 'busy' ? 'Something is already playing.' : 'Couldn\'t play that station.', 6000);
}

// Settings → Music → Radio.
function renderRadioSettings(st) {
  radio.state = st;
  $('ra-mine').replaceChildren(...st.mine.map((s) => el('div', { class: 'server' },
    el('div', {}, el('p', { class: 'server-name', textContent: s.name }), el('p', { class: 'server-meta', textContent: s.url })),
    el('div', { class: 'server-actions' }, el('button', { class: 'pill quiet', nav: true, textContent: 'Remove', onclick: async () => { const r = await tv.radioRemove(s.id); if (r.ok) renderRadioSettings(r.ok); musicState.loaded = false; focusLater('#ra-add'); } })))));
  $('ra-somafm').classList.toggle('on', st.somafm);
}
$('ra-add').addEventListener('click', async () => {
  const url = await askFor({ label: 'The station\'s address', eyebrow: 'Radio · Add a station', hint: 'A stream, or an M3U or PLS playlist. Paste it from your phone.', placeholder: 'https://…' });
  if (!url) return focusLater('#ra-add');
  const name = await askFor({ label: 'What to call it', eyebrow: 'Radio · Add a station', suggest: 'words' });
  const r = await tv.radioAdd(name || '', url);
  $('ra-note').textContent = r.ok ? 'Added. It\'s on the Music tab\'s Radio shelf.' : r.error === 'bad-address' ? 'That needs to be a web address starting with http:// or https://.' : 'Couldn\'t add the station.';
  $('ra-note').classList.toggle('good', Boolean(r.ok));
  if (r.ok) { renderRadioSettings(r.ok); musicState.loaded = false; }
  focusLater('#ra-add');
});
$('ra-somafm').addEventListener('click', async () => {
  const r = await tv.radioSomafm(!$('ra-somafm').classList.contains('on'));
  if (r.ok) renderRadioSettings(r.ok);
});
tv.radioState().then((r) => { if (r.ok) renderRadioSettings(r.ok); });
// (Fresh each time you open Settings → Music: stations and favourites change on the Radio page.)
document.addEventListener('focusin', (e) => {
  if (screen !== 'settings' || !e.target.closest('.s-panel[data-tab="music"] .s-rail')) return;
  tv.radioState().then((r) => { if (r.ok) renderRadioSettings(r.ok); });
});
