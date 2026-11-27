'use strict';

const $ = (id) => document.getElementById(id);
const IMG = 'https://image.tmdb.org/t/p/';

let services = [];

// ------------------------------------------------------------ helpers

// Readable text on any brand colour: dark text on light colours, white on dark ones.
function textFor(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0b0b10' : '#ffffff';
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'nav') node.dataset.nav = '';
    else node[k] = v;
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const ERRORS = {
  'no-key': 'Search needs a free key from TMDB. Set it up once in Settings; you can paste it in from your phone.',
  'bad-key': 'TMDB stopped accepting your saved key. Set a new one in Settings.',
  'not-a-key': 'That doesn\'t look like a TMDB key. Copy the API Read Access Token, the long one.',
  failed: 'Couldn\'t reach TMDB. Check your connection and try again.',
};

// ------------------------------------------------------------ screens

const screens = {
  home: $('screen-home'), search: $('screen-search'), detail: $('screen-detail'),
  settings: $('screen-settings'), ask: $('screen-ask'),
  episodes: $('screen-episodes'), choose: $('screen-choose'), update: $('screen-update'), slots: $('screen-slots'), more: $('screen-more'), setup: $('screen-setup'), allgenres: $('screen-allgenres'), iptv: $('screen-iptv'),
};
let screen = 'home';
const trail = []; // { screen, focus } to step back through

// Fewer animations: Settings → General → Screen → Animations off, or the system's "reduce motion".
const lessMotion = () => document.body.classList.contains('less-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const updateOffer = { pending: null }; // a new version waiting to be offered (see offerUpdate)
function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  if (updateOffer.pending) setTimeout(offerUpdate, 400); // (after typing or a setup, say)
  // A new screen gets the theme's "screen" sound (the keyboard has its own sounds).
  if (name !== screen && name !== 'ask' && window.tvSound) window.tvSound('screen');
  screen = name;
}

function go(name) {
  trail.push({ screen, focus: document.activeElement });
  show(name);
}

function back() {
  if (screen === 'ask') { askKeys.handle('back'); return true; }
  if (screen === 'choose') { finishChoose(null); return true; }
  if (screen === 'update') { finishUpdateOffer(false); return true; }
  if (screen === 'slots') { finishSlots(0); return true; }
  if (screen === 'search' && search.person) {
    // Leave a person's filmography, back to the plain results.
    const from = search.personCard;
    search.person = null;
    renderResults(search.results, labelFor(search.query));
    if (from && from.isConnected) from.focus();
    else tvNav.focusFirst();
    return true;
  }
  if (screen === 'settings') {
    // B steps back: from a section's options to the section menu, then out of Settings.
    const a = document.activeElement;
    const panel = document.querySelector(`#screen-settings .s-panel[data-tab="${settingsTab}"]`);
    if (a && a.closest('.s-group') && !panel.classList.contains('single')) {
      panel.querySelector('.rail-item.chosen')?.focus();
      return true;
    }
    rememberSettingsPlace();
  }
  const prev = trail.pop();
  if (!prev) return false;
  if (screen === 'settings') leaveSettings();
  if (screen === 'setup') leaveSetup();
  show(prev.screen);
  if (settings.overService) {
    // Opened from the menu while watching: back to the menu (B again closes it).
    settings.overService = false;
    tv.action('settings-to-menu');
    return true;
  }
  if (prev.focus && prev.focus.isConnected) prev.focus.focus();
  else tvNav.focusFirst();
  return true;
}

document.addEventListener('tvback', (e) => {
  if (back()) e.preventDefault();
});

// ------------------------------------------------------------ home

function tick() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const h = now.getHours();
  $('greeting').textContent = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

async function renderHome() {
  services = await tv.services(); // still needed: which "Watch on" buttons a title gets
  $('open-search').addEventListener('click', openSearch);
  $('open-settings').addEventListener('click', openSettings);
  $('results-setup').addEventListener('click', openSettings);
  $('home-setup').addEventListener('click', openSettings);
  $('genres-setup').addEventListener('click', openSettings);
  $('lib-setup').addEventListener('click', () => openSettings({ tab: 'jellyfin' }));
  $('open-search').focus();
  await loadRows();
}

// A message that shows for a few seconds at the bottom of the screen.
let toastTimer = null;
tv.onToast((text) => toast(String(text || ''), 9000));
function toast(text, ms = 6000) {
  clearTimeout(toastTimer);
  $('toast').textContent = text || '';
  $('toast').hidden = !text;
  if (text) toastTimer = setTimeout(() => { $('toast').hidden = true; }, ms);
}

const cardKey = (item) => (item.kind === 'jf' ? `jf:${item.serverId}:${item.item.id}` : `${item.kind}:${item.id}`);

const ARROW_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ARROW_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';

// Rows of things to watch: Jump back in and Up next from Jellyfin, then suggestions from TMDB.
// Each row ends in a card with "More" (the whole list, as a big grid) and "Back to the start".
let rowsSeq = 0;
// While Home loads: placeholder rows (and a placeholder big panel), shaped by the layout like real
// ones. They can't be selected, so you can still move around the tabs, search and Settings.
let skeletonFocus = null;
function showSkeleton() {
  const rows = $('rows');
  if (rows.querySelector('.card') || rows.querySelector('.skeleton')) return;
  const line = (w) => el('span', { class: 'skeleton-line', style: { width: w } });
  const titles = ['Jump back in', 'Up next', 'Trending', 'Popular'];
  rows.replaceChildren(...titles.slice(0, 3).map((t, r) => {
    const cards = el('div', { class: 'row-cards' });
    for (let i = 0; i < 10; i++) {
      cards.append(el('div', { class: 'card skeleton', style: { 'animation-delay': `${(r * 10 + i) * 40}ms` } },
        el('span', { class: 'poster' }), line(`${60 + ((i * 37) % 30)}%`), line(`${35 + ((i * 23) % 25)}%`)));
    }
    const section = el('section', { class: 'row skeleton' }, el('h2', { class: 'eyebrow' }, line(`${7 + r * 2}rem`)), cards);
    section.dataset.title = t;
    return section;
  }));
  if (heroOn() && !heroKey) {
    $('hero').classList.add('loading');
    $('hero-row').replaceChildren(line('8rem'));
    $('hero-title').replaceChildren(line('18rem'));
    $('hero-meta').replaceChildren(line('12rem'));
    $('hero-overview').replaceChildren(line('28rem'), el('br'), line('22rem'));
    $('hero-chips').replaceChildren(line('6rem'), line('7rem'), line('5rem'));
  }
  layoutRows();
  const nowhere = !document.activeElement || document.activeElement === document.body || !document.activeElement.offsetParent;
  if (screen === 'home' && view === 'home' && nowhere) {
    const tab = document.querySelector('#tabs .tab.chosen') || document.querySelector('#tabs .tab');
    if (tab) { tab.focus(); skeletonFocus = tab; }
  }
}

async function loadRows() {
  const seq = ++rowsSeq;
  showSkeleton();
  const res = await tv.browseHome();
  if (seq !== rowsSeq) return;
  const rows = $('rows');
  const focused = rows.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused && focused.dataset.key;
  const focusRow = focused && focused.closest('.row') && focused.closest('.row').dataset.title;
  const scroll = rows.scrollTop;
  rows.replaceChildren();
  $('hero').classList.remove('loading');
  const list = (res.ok && res.ok.rows) || [];
  const problem = res.error || (res.ok && res.ok.tmdbError);
  tmdbWorks = !problem || !['no-key', 'bad-key'].includes(problem);
  for (const row of list) rows.append(renderRow(row));
  const empty = $('home-empty');
  empty.hidden = !problem;
  if (problem) {
    $('home-empty-text').textContent = ERRORS[problem] || ERRORS.failed;
    $('home-setup').hidden = problem !== 'no-key' && problem !== 'bad-key';
  }
  rows.scrollTop = scroll;
  layoutRows();
  if (heroOn()) {
    // Big view: something in it from the start, and the first card selected (the search box
    // is the magnifier at the top in this layout).
    const first = rows.querySelector('.card');
    if (first && !heroKey) showHero(first.tvItem, first.closest('.row').dataset.title);
    const untouched = document.activeElement === document.body || document.activeElement === $('open-search') || (skeletonFocus && document.activeElement === skeletonFocus);
    if (first && !focused && untouched && screen === 'home' && view === 'home') first.focus();
  }
  skeletonFocus = null;
  if (focused) {
    // Keep your place after a refresh (e.g. back from mpv).
    const same = focusKey && rows.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    const sameRow = focusRow && [...rows.querySelectorAll('.row:not(.ghost)')].find((r) => r.dataset.title === focusRow);
    (same || (sameRow && sameRow.querySelector('[data-nav]')) || $('open-search')).focus();
  }
}

function renderRow(row) {
  const cards = el('div', { class: 'row-cards' });
  cards.dataset.row = '';
  for (const item of row.items) cards.append(resultCard(item));
  if (row.items.length) {
    // More is the last stop in a row; one more step and the row loops back to its first title.
    const more = el('button', { class: 'more-btn', nav: true, title: 'More', onclick: () => openMore(row) });
    more.innerHTML = ARROW_RIGHT;
    more.append(el('span', { class: 'tip', textContent: 'More' }));
    cards.append(el('div', { class: 'row-end' }, more));
  }
  const section = el('section', { class: 'row' }, el('h2', { class: 'eyebrow', textContent: row.title }), cards);
  section.dataset.title = row.title;
  return section;
}

// A Jellyfin card: a show opens its episodes; anything else plays (asking first if you're partway in).
let tmdbWorks = true;

// A Jellyfin card opens its title's page, with a Resume (or Play next) button at the front.
// Without a TMDB match (or key), it goes straight to the episodes, or plays.
function openJfCard(c) {
  const it = c.item;
  if (c.tmdb && tmdbWorks) {
    const partway = it.position > 30 && !it.played;
    const resume = it.type === 'Episode' || (it.type === 'Movie' && partway) ? c : null;
    return openDetail({ kind: c.tmdb.kind, id: c.tmdb.id, title: c.title, resume });
  }
  if (it.type === 'Series') {
    return openEpisodes({ serverId: c.serverId, serverName: c.serverName, itemId: it.id, name: it.name });
  }
  playJellyfin(c.serverId, it, toast);
}

// ------------------------------------------------------------ views (L1 / R1)

const VIEWS = ['home', 'live', 'music', 'genres', 'library'];
let view = 'home';

let viewSeq = 0;
function setView(name, { focus = true } = {}) {
  if (name !== view && window.tvSound) window.tvSound('screen');
  view = name;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  for (const t of document.querySelectorAll('#tabs .tab')) t.classList.toggle('chosen', t.dataset.view === name);
  if (name === 'live') showLive(focus);
  else if (name === 'genres' || name === 'library' || name === 'music') {
    // (Loaded once you've stopped on the tab for a moment, so flicking past it never waits.)
    const seq = (viewSeq += 1);
    if (focus) $('tabs').querySelector('.tab.chosen')?.focus({ preventScroll: true });
    setTimeout(() => {
      if (view !== name || seq !== viewSeq) return;
      const onTabs = $('tabs').contains(document.activeElement) || document.activeElement === document.body;
      ({ genres: showGenres, library: showLibrary, music: showMusic })[name](focus && onTabs);
    }, 160);
  }
  else if (focus) {
    const first = $('rows').querySelector('.card');
    (first || $('open-search')).focus();
  }
}

for (const t of document.querySelectorAll('#tabs .tab')) t.addEventListener('click', () => setView(t.dataset.view));

tv.onViewStep((dir) => {
  if (screen === 'episodes') return stepSeason(dir);
  if (screen === 'settings') return stepSettingsTab(dir);
  if (screen !== 'home') return;
  const i = Math.max(0, Math.min(VIEWS.length - 1, VIEWS.indexOf(view) + dir));
  if (VIEWS[i] !== view) setView(VIEWS[i]);
});

// ------------------------------------------------------------ endless grids
//
// A grid that loads the next page when you get near the bottom. fetchPage(n) -> { ok: { items, more } }.

function makeFeed(grid, fetchPage, { letters = false, onLetter = null } = {}) {
  const f = { page: 0, more: true, loading: false, gen: 0, last: null, seen: new Set(), count: 0 };
  const letterOf = (item) => {
    const ch = ((item.item && item.item.sortName) || item.title || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  };
  f.reset = () => {
    Object.assign(f, { page: 0, more: true, loading: false, last: null, seen: new Set(), count: 0, kinds: null });
    f.gen += 1;
    grid.replaceChildren();
    grid.scrollTop = 0;
  };
  f.load = async () => {
    if (f.loading || !f.more) return;
    f.loading = true;
    const gen = f.gen;
    const loading = el('p', { class: 'grid-note', textContent: 'Loading…' });
    grid.append(loading);
    const res = await fetchPage(f.page + 1);
    if (gen !== f.gen) return;
    loading.remove();
    f.loading = false;
    if (res.error) {
      f.more = false;
      grid.append(el('p', { class: 'grid-note', textContent: ERRORS[res.error] || 'Couldn’t load more.' }));
      return;
    }
    f.page += 1;
    f.more = res.ok.more;
    if (res.ok.kinds) f.kinds = res.ok.kinds;
    let nth = 0;
    for (const item of res.ok.items) {
      const key = cardKey(item);
      if (f.seen.has(key)) continue; // lists shift a little between pages
      f.seen.add(key);
      const card = resultCard(item);
      card.style.setProperty('--i', String(nth++)); // (each page's pictures rise in one after another)
      if (letters) {
        const l = letterOf(item);
        card.dataset.letter = l;
        if (l !== f.last) { f.last = l; grid.append(el('h3', { class: 'letter-head', textContent: l })); }
      }
      grid.append(card);
      f.count += 1;
    }
    if (!f.count && !f.more) grid.append(el('p', { class: 'grid-note', textContent: 'Nothing here.' }));
    // Not enough to scroll yet? Keep going.
    if (f.more && grid.scrollHeight <= grid.clientHeight + 300) f.load();
  };
  grid.addEventListener('focusin', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (letters && onLetter) onLetter(card.dataset.letter);
    const cards = grid.querySelectorAll('.card');
    if ([...cards].indexOf(card) > cards.length - 25) f.load();
  });
  grid.addEventListener('scroll', () => {
    if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - 600) f.load();
  });
  return f;
}

// ------------------------------------------------------------ More: a whole row as a big grid

const more = { row: null, kind: 'all' };
const moreFeed = makeFeed($('more-grid'), (n) => {
  if (!more.row.spec) return Promise.resolve({ ok: { items: n === 1 ? more.row.items : [], more: false } });
  const spec = more.row.spec.source === 'genre' ? { ...more.row.spec, kind: more.kind } : more.row.spec;
  return tv.browsePage(spec, n);
});

async function openMore(row, { eyebrow = 'More like this' } = {}) {
  go('more');
  more.row = row;
  more.kind = 'all';
  $('more-eyebrow').textContent = eyebrow;
  $('more-title').textContent = row.title;
  const genre = Boolean(row.spec && row.spec.source === 'genre');
  $('more-kind').hidden = true;
  for (const b of $('more-kind').children) b.classList.toggle('chosen', b.dataset.kind === 'all');
  moreFeed.reset();
  await moreFeed.load();
  // Movies / Shows filter, when the genre has both (K-dramas, say, are only shows).
  $('more-kind').hidden = !genre || (moreFeed.kinds && moreFeed.kinds.length < 2);
  if (screen === 'more' && more.row === row) ($('more-grid').querySelector('.card') || $('more-kind').querySelector('.chosen'))?.focus();
}

for (const b of $('more-kind').children) {
  b.addEventListener('click', async () => {
    more.kind = b.dataset.kind;
    for (const x of $('more-kind').children) x.classList.toggle('chosen', x === b);
    moreFeed.reset();
    await moreFeed.load();
  });
}

// ------------------------------------------------------------ Genres

// Each genre's own colours: fiery for action, rose for romance, blood-black for horror...
const GENRE_THEME = {
  action: ['#c2410c', '#7c2d12'], adventure: ['#b45309', '#365314'], animation: ['#db2777', '#7c3aed'],
  comedy: ['#ca8a04', '#c2410c'], crime: ['#334155', '#0f172a'], documentary: ['#0f766e', '#1e3a8a'],
  drama: ['#7f1d1d', '#3b0764'], family: ['#16a34a', '#0369a1'], fantasy: ['#7c3aed', '#1e1b4b'],
  scifi: ['#0891b2', '#1e1b4b'], horror: ['#450a0a', '#000000'], mystery: ['#312e81', '#0f172a'],
  romance: ['#e11d48', '#831843'], thriller: ['#1f2937', '#7f1d1d'], history: ['#92400e', '#451a03'],
  war: ['#4d5b2a', '#1c1917'], western: ['#c2410c', '#78350f'], kids: ['#f59e0b', '#ec4899'],
  reality: ['#d946ef', '#f97316'], holiday: ['#b91c1c', '#166534'],
  halloween: ['#ea580c', '#1c1917'], thanksgiving: ['#b45309', '#7c2d12'], valentines: ['#ec4899', '#9f1239'],
  summer: ['#f59e0b', '#0284c7'], superhero: ['#1d4ed8', '#b91c1c'], timetravel: ['#0e7490', '#4c1d95'],
  heist: ['#166534', '#0f172a'], space: ['#1e1b4b', '#000000'], dystopia: ['#57534e', '#1c1917'],
  apocalypse: ['#78350f', '#292524'], zombies: ['#3f6212', '#1c1917'], vampires: ['#7f1d1d', '#0c0a09'],
  dinosaurs: ['#4d7c0f', '#78350f'], spies: ['#0f172a', '#334155'], martialarts: ['#b91c1c', '#1c1917'],
  disaster: ['#c2410c', '#44403c'], serialkiller: ['#450a0a', '#18181b'], cyberpunk: ['#db2777', '#0891b2'],
  comingofage: ['#f59e0b', '#db2777'], roadtrip: ['#ea580c', '#0369a1'], sports: ['#15803d', '#1e3a8a'],
  courtroom: ['#78350f', '#1e293b'], truestory: ['#475569', '#1e293b'], books: ['#92400e', '#3f1d0b'],
  musicals: ['#a21caf', '#f59e0b'], standup: ['#7c3aed', '#111827'], mockumentary: ['#64748b', '#1e293b'],
  foundfootage: ['#3f3f46', '#09090b'], cult: ['#6d28d9', '#be185d'], anime: ['#ec4899', '#4338ca'],
  news: ['#1d4ed8', '#0f172a'], soap: ['#be185d', '#701a75'], talk: ['#ea580c', '#7c3aed'],
  tvmovie: ['#0369a1', '#1e293b'], music: ['#c026d3', '#1e1b4b'], kdrama: ['#e11d48', '#1e3a8a'],
  korean: ['#1e3a8a', '#b91c1c'], bollywood: ['#f97316', '#be185d'], british: ['#1e3a8a', '#991b1b'],
  japanese: ['#b91c1c', '#18181b'], spanish: ['#dc2626', '#ca8a04'], french: ['#1d4ed8', '#9f1239'],
  nordic: ['#334155', '#0c4a6e'], newreleases: ['#059669', '#0f766e'], greats: ['#ca8a04', '#78350f'],
  hiddengems: ['#059669', '#4338ca'], classics: ['#57534e', '#0c0a09'], seventies: ['#c2410c', '#a16207'],
  eighties: ['#db2777', '#4f46e5'], nineties: ['#14b8a6', '#7c3aed'], noughties: ['#2563eb', '#64748b'],
};

// Pictures load as tiles come into view (a few dozen tiles: no need to fetch them all at once).
const artSeen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    artSeen.unobserve(e.target);
    tv.genreArt(e.target.dataset.genre).then((path) => {
      if (!path) return;
      const img = new Image();
      img.onload = () => e.target.style.setProperty('--art', `url("${IMG}w780${path}")`);
      img.src = `${IMG}w780${path}`;
    }).catch(() => {});
  }
}, { rootMargin: '200px' });

let genresLoaded = false;

async function showGenres(focus) {
  const grid = $('genre-grid');
  if (!genresLoaded) {
    const res = await tv.genres();
    if (view !== 'genres') return;
    if (res.error) {
      $('genres-empty').hidden = false;
      $('genres-empty-text').textContent = ERRORS[res.error] || ERRORS.failed;
      $('genres-setup').hidden = res.error !== 'no-key' && res.error !== 'bad-key';
      if (focus) ($('genres-setup').hidden ? $('tabs').querySelector('.chosen') : $('genres-setup')).focus();
      return;
    }
    $('genres-empty').hidden = true;
    genresLoaded = true;
    allGenres = res.ok;
    // The popular genres, then a tile for everything else.
    const seeAll = el('button', { class: 'genre see-all', nav: true, onclick: openAllGenres },
      el('span', { textContent: 'See all genres' }), el('small', { textContent: `${allGenres.filter((g) => !g.popular).length} more: themes, holidays, eras, world cinema…` }));
    grid.replaceChildren(...allGenres.filter((g) => g.popular).map((g) => genreTile(g)), seeAll);
  }
  if (focus) grid.firstElementChild?.focus();
}

let allGenres = [];
function genreTile(g) {
  const [g1, g2] = GENRE_THEME[g.id] || ['#334155', '#0f172a'];
  const tile = el('button', {
    class: 'genre', nav: true, textContent: g.name, style: { '--g1': g1, '--g2': g2 },
    onclick: () => openMore({ title: g.name, spec: { source: 'genre', genre: g.id, kind: 'all' } }, { eyebrow: 'Genre' }),
  });
  tile.dataset.genre = g.id;
  artSeen.observe(tile);
  return tile;
}

function openAllGenres() {
  go('allgenres');
  const body = $('allgenres-body');
  if (!body.childElementCount) {
    const groups = [];
    for (const g of allGenres) {
      let grp = groups.find((x) => x.name === g.group);
      if (!grp) { grp = { name: g.group, list: [] }; groups.push(grp); }
      grp.list.push(g);
    }
    // The new ones first; the popular genres (already on the Genres view) at the end.
    groups.push(...groups.splice(groups.findIndex((g) => g.name === 'Popular'), 1).map((g) => ({ ...g, name: 'The usual genres' })));
    body.replaceChildren(...groups.map((grp) => el('section', { class: 'genre-group' },
      el('h2', { class: 'eyebrow', textContent: grp.name }),
      el('div', { class: 'genre-grid' }, ...grp.list.map((g) => genreTile(g))))));
  }
  body.scrollTop = 0;
  body.querySelector('.genre')?.focus();
}

// ------------------------------------------------------------ Library: everything on a Jellyfin server

const lib = { serverId: null, type: 'movie', letter: null, servers: [] };
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const libFeed = makeFeed($('lib-grid'), (n) => tv.browsePage({
  source: 'jf-library', serverId: lib.serverId, type: lib.type, letter: lib.letter,
}, n), {
  letters: true,
  onLetter: (l) => { for (const b of $('letters').children) b.classList.toggle('here', b.dataset.letter === l); },
});

$('letters').replaceChildren(...LETTERS.map((l) => {
  const b = el('button', { nav: true, textContent: l, onclick: () => jumpTo(l) });
  b.dataset.letter = l;
  return b;
}));

for (const b of $('lib-type').children) {
  b.addEventListener('click', () => {
    lib.type = b.dataset.type;
    for (const x of $('lib-type').children) x.classList.toggle('chosen', x === b);
    reloadLibrary(false);
  });
}

async function jumpTo(letter) {
  lib.letter = letter === '#' ? null : letter;
  libFeed.reset();
  await libFeed.load();
  $('lib-grid').querySelector('.card')?.focus();
}

async function reloadLibrary(focus) {
  lib.letter = null;
  libFeed.reset();
  await libFeed.load();
  if (focus) ($('lib-grid').querySelector('.card') || $('lib-type').querySelector('.chosen')).focus();
}

async function showLibrary(focus) {
  const res = await tv.mediaServers();
  if (view !== 'library') return;
  const servers = ((res && res.ok) || []).filter((x) => x.signedIn);
  const none = !servers.length;
  $('lib-empty').hidden = !none;
  for (const part of $('view-library').querySelectorAll('.lib-bar, .lib-body')) part.hidden = none;
  if (none) { if (focus) $('lib-setup').focus(); return; }
  const changed = servers.map((x) => x.id).join() !== lib.servers.map((x) => x.id).join();
  lib.servers = servers;
  if (!servers.some((x) => x.id === lib.serverId)) lib.serverId = servers[0].id;
  if (changed) {
    $('lib-servers').replaceChildren(...servers.map((x) => {
      const b = el('button', { class: `pill${x.id === lib.serverId ? ' chosen' : ''}`, nav: true, textContent: x.name });
      b.addEventListener('click', () => {
        lib.serverId = x.id;
        for (const y of $('lib-servers').children) y.classList.toggle('chosen', y === b);
        reloadLibrary(false);
      });
      return b;
    }));
    await reloadLibrary(focus);
  } else if (focus) {
    ($('lib-grid').querySelector('.card') || $('lib-type').querySelector('.chosen')).focus();
  }
}

// ------------------------------------------------------------ search

const search = { query: '', results: [], timer: null, seq: 0, person: null, personCard: null, music: false };

const KEYS = [...'abcdefghijklmnopqrstuvwxyz1234567890'];

function buildKeyboard() {
  const osk = $('osk');
  for (const k of KEYS) osk.append(el('button', { class: 'key', nav: true, textContent: k, onclick: () => type(k) }));
  // (Space and Delete show the button that does them.)
  const badge = (action) => { const k = el('kbd', { class: 'osk-badge' }); k.dataset.badge = action; return k; };
  osk.append(
    el('button', { class: 'key wider', nav: true, onclick: () => type(' ') }, el('span', { textContent: 'Space' }), badge('playpause')),
    el('button', { class: 'key wide', nav: true, onclick: () => erase() }, el('span', { textContent: 'Delete' }), badge('delete')),
    el('button', { class: 'key', nav: true, textContent: 'Clear', style: { 'font-size': '0.95rem', 'text-transform': 'none' }, onclick: () => setQuery('') }),
  );
}

// The buttons shown on the search keyboard's Space and Delete keys.
function oskBadges() {
  for (const k of document.querySelectorAll('.osk-badge')) {
    k.textContent = window.tvButtons.buttonFor(k.dataset.badge);
    k.hidden = !k.textContent;
  }
}
tv.bindings().then(() => setTimeout(oskBadges, 0));
tv.onBindings(() => setTimeout(oskBadges, 0));

// Left and right loop round each line of the search keyboard (and of its suggestions).
document.addEventListener('keydown', (e) => {
  if (screen !== 'search' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  const key = document.activeElement && document.activeElement.closest('#osk .key, #osk-sugg .sugg');
  if (!key) return;
  const top = key.offsetTop;
  const line = [...key.parentElement.children].filter((k) => Math.abs(k.offsetTop - top) < 4);
  const i = line.indexOf(key);
  if (e.key === 'ArrowRight' && i === line.length - 1) { e.preventDefault(); e.stopImmediatePropagation(); line[0].focus(); }
  else if (e.key === 'ArrowLeft' && i === 0) { e.preventDefault(); e.stopImmediatePropagation(); line[line.length - 1].focus(); }
  else return;
  if (window.tvSound) window.tvSound('move');
}, true);

function openSearch(opts) {
  // From the Music tab, the same screen searches music (see music.js).
  const music = Boolean(opts && opts.music);
  if (music !== search.music) { search.music = music; search.query = ''; search.results = []; renderResults([], 'Type to search'); }
  $('screen-search').classList.toggle('music', music);
  document.querySelector('#screen-search .credit').textContent = music
    ? 'Music from Deezer and MusicBrainz.' : 'Uses the TMDB API but is not endorsed or certified by TMDB.';
  go('search');
  updateQueryView();
  $('osk').firstElementChild.focus();
  searchSuggestSoon(0);
}

function type(ch) { setQuery((search.query + ch).replace(/^\s+/, '').slice(0, 60)); }
function erase() { setQuery(search.query.slice(0, -1)); }

function updateQueryView() {
  $('query-text').textContent = search.query;
  $('query').classList.toggle('empty', !search.query);
}

function setQuery(q) {
  search.query = q;
  search.person = null;
  updateQueryView();
  clearTimeout(search.timer);
  searchSuggestSoon();
  if (q.trim().length < 2) {
    search.results = [];
    searchSugg.titles = [];
    renderResults([], 'Type to search');
    return;
  }
  search.timer = setTimeout(runSearch, 300);
}

const labelFor = (q) => `Results for “${q.trim()}”`;

async function runSearch() {
  if (search.music) return runMusicSearch();
  const q = search.query.trim();
  const seq = ++search.seq;
  const res = await tv.search(q);
  if (seq !== search.seq || search.person) return; // a newer search (or a person view) took over
  if (res.error) return showMessage(res.error);
  search.results = res.ok;
  renderResults(res.ok, res.ok.length ? labelFor(q) : `Nothing found for “${q}”`);
  searchSugg.titles = res.ok.map((r) => r.title);
  searchSuggestSoon(0);
}

// ------------------------------------------------------------ search suggestions
//
// A row above the search keyboard (Up from the top keys): your earlier searches, titles from the
// results, and the word you're typing finished. Asked for after a short pause in typing. The row
// keeps two lines' height whether or not anything's in it, so the keys never move.

const searchSugg = { timer: 0, seq: 0, titles: [], cameFrom: null };

function searchSuggestSoon(ms = 250) {
  clearTimeout(searchSugg.timer);
  searchSugg.timer = setTimeout(searchSuggest, ms);
}

async function searchSuggest() {
  const seq = ++searchSugg.seq;
  const list = settings.suggestOn === false ? [] : await tv.suggest(search.query, search.music ? 'music' : 'search', searchSugg.titles);
  if (seq !== searchSugg.seq || screen !== 'search') return;
  const row = $('osk-sugg');
  const at = [...row.children].indexOf(document.activeElement);
  row.replaceChildren(...(list || []).map((item) => el('button', {
    class: `sugg ${item.kind}`, nav: true, onclick: () => pickSearchSugg(item),
  }, el('span', { textContent: item.label }))));
  // Only what fits on the row's two lines.
  const bottom = row.getBoundingClientRect().bottom;
  for (const b of [...row.children]) if (b.getBoundingClientRect().bottom > bottom + 2) b.remove();
  if (at >= 0) (row.children[Math.min(at, row.children.length - 1)] || backToKeys()).focus();
}

const backToKeys = () => (searchSugg.cameFrom && searchSugg.cameFrom.isConnected ? searchSugg.cameFrom : $('osk').firstElementChild);

function pickSearchSugg(item) {
  const back = backToKeys();
  setQuery(item.value.replace(/^\s+/, '').slice(0, 60));
  back.focus();
}

// Remember which key you came up from, to go back to it after picking.
$('osk-sugg').addEventListener('focusin', (e) => {
  if (e.relatedTarget && $('osk').contains(e.relatedTarget)) searchSugg.cameFrom = e.relatedTarget;
});

// Opening something a search found remembers the search (for suggesting it again).
$('results').addEventListener('click', (e) => {
  if (e.target.closest('button') && search.query.trim().length >= 2) tv.suggestRemember(search.query, search.music ? 'music' : 'search');
}, true);

function showMessage(code) {
  $('results').replaceChildren();
  $('results-label').textContent = 'Search';
  $('results-message-text').textContent = ERRORS[code] || ERRORS.failed;
  $('results-setup').hidden = code !== 'no-key' && code !== 'bad-key';
  $('results-message').hidden = false;
}

function renderResults(items, label) {
  $('results-message').hidden = true;
  $('results-label').textContent = label;
  const list = $('results');
  list.replaceChildren();
  list.scrollTop = 0;
  items.forEach((item, i) => { const c = resultCard(item); c.style.setProperty('--i', String(i)); list.append(c); });
}

function resultCard(item) {
  const poster = el('span', { class: 'poster' }, item.title);
  if (item.image) {
    const src = item.kind === 'jf' ? item.image : `${IMG}${item.kind === 'person' ? 'w185' : 'w342'}${item.image}`;
    const img = el('img', { alt: '', loading: 'lazy', src });
    img.addEventListener('error', () => img.remove());
    poster.append(img);
  }
  if (item.kind === 'jf') {
    if (item.progress > 0) poster.append(el('span', { class: 'bar-track' }, el('span', { style: { width: `${Math.round(item.progress * 100)}%` } })));
  }
  const card = el('button', {
    class: `card ${item.kind}`, nav: true,
    onclick: () => (item.kind === 'person' ? openPerson(item, card) : item.kind === 'jf' ? openJfCard(item) : openDetail(item)),
  },
  poster,
  el('span', { class: 'name', textContent: item.title }),
  el('span', { class: 'sub', textContent: item.sub }));
  card.dataset.key = cardKey(item);
  card.tvItem = item; // for the big view
  return card;
}

async function openPerson(item, card) {
  search.person = item.id;
  search.personCard = card;
  $('results-label').textContent = `Loading ${item.title}…`;
  const res = await tv.person(item.id);
  if (search.person !== item.id) return;
  if (res.error) return showMessage(res.error);
  renderResults(res.ok.works, `Known for · ${res.ok.name}`);
  tvNav.focusIn($('results'));
}

// Physical keyboards work too.
document.addEventListener('keydown', (e) => {
  if (screen === 'ask' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === 'Backspace') { e.preventDefault(); askErase(); }
    else if (e.key.length === 1 && e.key !== ' ') { e.preventDefault(); askType(e.key); }
    else if (e.key === ' ') { e.preventDefault(); askType(' '); }
    return;
  }
  if (screen !== 'search' || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'Backspace') { e.preventDefault(); erase(); }
  else if (e.key.length === 1 && /[\p{L}\p{N} '&:.,!?-]/u.test(e.key)) { e.preventDefault(); type(e.key.toLowerCase()); }
});

// ------------------------------------------------------------ detail

let detailSeq = 0;
let appsState = { vacuumtube: false, jellyfin: false, mpv: false };
let playerChoice = 'mpv';

async function refreshApps(again = false) {
  appsState = (await tv.apps(again)) || appsState;
  const badge = (id, key) => {
    const where = appsState.where && appsState.where[key];
    $(id).textContent = appsState[key] ? '✓ Installed' : 'Not installed';
    $(id).className = `app-badge ${appsState[key] ? 'yes' : 'no'}`;
    $(id).title = where || '';
  };
  badge('app-mpv-badge', 'mpv');
  badge('app-vt-badge', 'vacuumtube');
  badge('app-jf-badge', 'jellyfin');
  $('app-vt-state').textContent = appsState.vacuumtube
    ? `YouTube opens in VacuumTube${appsState.where && appsState.where.vacuumtube ? ` (${appsState.where.vacuumtube})` : ''}.`
    : 'Not found on this computer, so YouTube opens in the browser here. VacuumTube is the better app for watching YouTube on a TV.';
  $('app-mpv-state').textContent = appsState.mpv
    ? 'Installed. Plays Jellyfin files as they are: no transcoding, surround sound, HDR.'
    : 'The best way to play Jellyfin titles. Not installed, so they play in the built-in player for now.';
  $('app-jf-state').textContent = appsState.jellyfin
    ? 'Installed. Jellyfin titles open in it.'
    : 'Not installed, so Jellyfin titles open in the web player here.';
}

function status(text) {
  $('d-status').textContent = text || '';
  $('d-status').hidden = !text;
}

// Jellyfin servers that have this title get a button each, named after the server.
async function addJellyfinButtons(d, seq, early) {
  const res = (early && await early) || await tv.jfFind(d.kind, d.id, d.title, d.year);
  if (seq !== detailSeq || screen !== 'detail' || !res || !res.ok) return;
  const watch = $('d-watch');
  const placeholder = watch.querySelector('.placeholder');
  const resume = watch.querySelector('.resume');
  // Still on the button we focused when the page opened? Then the Jellyfin button can take over
  // (unless that's the Resume button: it stays first, and keeps the focus).
  const untouched = !resume && document.activeElement === watch.firstElementChild;
  const placeholderFocused = untouched || (placeholder && document.activeElement === placeholder);
  const buttons = res.ok.matches.map((m) => el('button', {
    class: `watch-btn jellyfin${String(m.serverId).startsWith('plex-') ? ' plex' : ''}`, nav: true, textContent: m.serverName,
    onclick: () => { remember(d); openOnJellyfin(m); },
  }));
  if (buttons.length) {
    if (placeholder) placeholder.remove();
    $('d-watch-label').textContent = 'Watch on';
    if (resume) resume.after(...buttons); else watch.prepend(...buttons);
    if (placeholderFocused || !watch.contains(document.activeElement)) buttons[0].focus();
    $('d-mpv').hidden = !(playerChoice === 'mpv' && !appsState.mpv);
  }
  if (res.ok.signedOut.length) status('One of your servers needs you to sign in again. You can do that in Settings → Servers.');
}

const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

// A show opens its episodes; a movie plays (asking first if you're partway through).
async function openOnJellyfin(m) {
  if (m.itemType === 'Series') return openEpisodes(m);
  status('');
  const r = await tv.jfItem(m.serverId, m.itemId);
  if (r.error) { status('Couldn\'t reach that server. Check it\'s running and try again.'); return; }
  playJellyfin(m.serverId, r.ok, status);
}

async function playJellyfin(serverId, item, say, { direct = false } = {}) {
  let resume = direct && item.position > 30 && !item.played;
  // (Plex always plays in mpv when it's there; Jellyfin uses the player chosen in Settings.)
  const player = String(serverId).startsWith('plex-') ? 'mpv' : playerChoice;
  if (!direct && item.position > 30 && !item.played && player === 'mpv' && appsState.mpv) {
    const choice = await chooseResume(item);
    if (!choice) return;
    resume = choice === 'resume';
  }
  const opening = player === 'desktop' && appsState.jellyfin ? 'in Jellyfin Desktop… close it to come back here.'
    : player === 'mpv' && appsState.mpv ? 'in mpv… stop it to come back here.' : '…';
  say(`Opening ${item.name} ${opening}`);
  const r = await tv.jfPlay(serverId, item.id, item.type, item.name, resume);
  if (r.error) say(r.error === 'busy' ? 'Something is already playing.' : 'Couldn\'t start that. Check the server is running and try again.');
  else if (r.ok.app === 'desktop' && !r.ok.shown) {
    say('Jellyfin Desktop is open, but couldn\'t jump to this title. Make sure it\'s signed in to the same server and account.');
  } else if (r.ok.app === 'web') say('');
}

// ------------------------------------------------------------ resume or start over

const choose = { resolve: null };

function chooseResume(item) {
  go('choose');
  $('choose-eyebrow').textContent = item.series ? `${item.series} · S${item.season}E${item.episode}` : 'Continue watching';
  $('choose-title').textContent = item.name;
  $('choose-resume').textContent = `Resume from ${clock(item.position)}`;
  $('choose-resume').focus();
  return new Promise((resolve) => { choose.resolve = resolve; });
}

function finishChoose(result) {
  const resolve = choose.resolve;
  choose.resolve = null;
  const prev = trail.pop();
  if (prev) {
    show(prev.screen);
    if (prev.focus && prev.focus.isConnected) prev.focus.focus();
  }
  if (resolve) resolve(result);
}

$('choose-resume').addEventListener('click', () => finishChoose('resume'));
$('choose-start').addEventListener('click', () => finishChoose('start'));

// ------------------------------------------------------------ episodes

const eps = { serverId: null, seriesId: null, seasonId: null, seasons: [] };

function epStatus(text) {
  $('ep-status').textContent = text || '';
  $('ep-status').hidden = !text;
}

async function openEpisodes(m) {
  go('episodes');
  Object.assign(eps, { serverId: m.serverId, seriesId: m.itemId, seasonId: null, seasons: [] });
  $('ep-server').textContent = `On ${m.serverName}`;
  $('ep-title').textContent = m.name;
  $('ep-next').replaceChildren();
  $('ep-seasons').replaceChildren();
  $('ep-list').replaceChildren(el('p', { class: 'ep-desc', textContent: 'Loading…' }));
  epStatus('');
  const [seasons, next] = await Promise.all([tv.jfSeasons(m.serverId, m.itemId), tv.jfNextUp(m.serverId, m.itemId)]);
  if (seasons.error) { $('ep-list').replaceChildren(); epStatus('Couldn\'t reach that server.'); return; }
  eps.seasons = seasons.ok;
  renderNext(next.ok || null);
  const nextSeason = next.ok && eps.seasons.find((s) => s.index === next.ok.season);
  await showSeason((nextSeason || eps.seasons[0] || {}).id, next.ok ? next.ok.id : null);
  ($('ep-next').firstElementChild || $('ep-list').firstElementChild || $('ep-seasons').firstElementChild)?.focus();
}

function renderNext(item) {
  const box = $('ep-next');
  box.replaceChildren();
  if (!item) return;
  const where = item.position > 30 ? `resume ${clock(item.position)}` : 'next up';
  box.append(el('button', {
    class: 'watch-btn jellyfin', nav: true, onclick: () => playJellyfin(eps.serverId, item, epStatus),
  }, document.createTextNode(`S${item.season}E${item.episode} · ${item.name}`), el('small', { textContent: where })));
}

// L1 / R1 on the episodes screen: previous / next season, wherever you are on the screen.
async function stepSeason(dir) {
  const i = eps.seasons.findIndex((s) => s.id === eps.seasonId);
  const next = eps.seasons[i + dir];
  if (!next) { if (window.tvSound) window.tvSound('edge'); return; }
  if (window.tvSound) window.tvSound('move');
  const onList = $('ep-list').contains(document.activeElement);
  await showSeason(next.id);
  // Keep your place: stay in the episode list (first episode) or on the season buttons.
  (onList ? $('ep-list').firstElementChild : $('ep-seasons').querySelector('.chosen'))?.focus();
  $('ep-list').scrollTop = 0;
}

async function showSeason(seasonId, highlightId) {
  if (!seasonId) { $('ep-list').replaceChildren(); return; }
  eps.seasonId = seasonId;
  const seasonsBox = $('ep-seasons');
  seasonsBox.replaceChildren(...eps.seasons.map((s) => el('button', {
    class: `pill${s.id === seasonId ? ' chosen' : ''}`, nav: true, textContent: s.name,
    onclick: () => showSeason(s.id).then(() => seasonsBox.querySelector('.chosen')?.focus()),
  })));
  const r = await tv.jfEpisodes(eps.serverId, eps.seriesId, seasonId);
  if (eps.seasonId !== seasonId) return;
  const list = $('ep-list');
  list.replaceChildren();
  if (r.error) { epStatus('Couldn\'t load episodes.'); return; }
  for (const e of r.ok) {
    const side = el('span', { class: 'ep-side' }, document.createTextNode(e.runtime ? `${Math.round(e.runtime / 60)} min` : ''));
    if (e.played) side.append(el('span', { class: 'seen', textContent: '✓' }));
    const row = el('button', { class: 'ep-row', nav: true, onclick: () => playJellyfin(eps.serverId, e, epStatus) },
      el('span', { class: 'num', textContent: e.episode ?? '' }),
      el('span', {}, el('span', { class: 'ep-name', textContent: e.name }), el('span', { class: 'ep-desc', textContent: e.overview })),
      side);
    row.querySelector('.ep-name').style.display = 'block';
    row.querySelector('.ep-desc').style.display = 'block';
    if (e.position > 0 && e.runtime && !e.played) {
      row.append(el('span', { class: 'bar', style: { width: `${Math.min(100, (e.position / e.runtime) * 100)}%` } }));
    }
    row.dataset.id = e.id;
    list.append(row);
  }
  if (highlightId) list.querySelector(`[data-id="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: 'center' });
}

// Back from mpv: refresh what's watched and what's next.
tv.onJfPlayed(async ({ serverId, itemId, error }) => {
  if (!error) loadRows(); // Jump back in / Up next
  if (error) {
    (screen === 'episodes' ? epStatus : screen === 'detail' ? status : toast)(error === 'mpv-failed'
      ? 'mpv quit straight away. The log (Settings → Developer) has what it said; or pick another player in Settings → Servers.'
      : 'mpv didn\'t start. Check it\'s installed, or pick another player in Settings → Servers.');
    return;
  }
  status('');
  epStatus('');
  refreshResume();
  if (screen === 'episodes' && serverId === eps.serverId) {
    const focusedId = document.activeElement && document.activeElement.dataset.id;
    const next = await tv.jfNextUp(eps.serverId, eps.seriesId);
    renderNext(next.ok || null);
    await showSeason(eps.seasonId);
    (focusedId && $('ep-list').querySelector(`[data-id="${CSS.escape(focusedId)}"]`) || $('ep-next').firstElementChild || $('ep-list').firstElementChild)?.focus();
  }
});

async function openDetail(item) {
  const seq = ++detailSeq;
  status('');
  $('d-vt').hidden = true;
  go('detail');
  $('d-kind').textContent = item.kind === 'tv' ? 'Series' : 'Film';
  $('d-title').textContent = item.title;
  // Shimmering placeholders where the details, the length and where to watch are on their way.
  const bar = (w) => el('span', { class: 'skeleton-line', style: { width: w } });
  $('d-meta').replaceChildren(bar('16rem'));
  $('d-rating').hidden = true;
  $('d-tagline').hidden = true;
  $('d-overview').replaceChildren(bar('92%'), el('br'), bar('86%'), el('br'), bar('60%'));
  $('d-backdrop').style.backgroundImage = '';
  $('d-watch').replaceChildren(el('button', { class: 'watch-btn plain loading', nav: true }, el('span', { class: 'wb-name', textContent: 'Finding where to watch…' }), bar('9rem')));
  $('d-watch-label').textContent = 'Watch on';
  for (const id of ['d-elsewhere', 'd-other', 'd-free', 'd-trakt', 'd-people-box', 'd-yt']) $(id).hidden = true;
  $('d-side-loading').hidden = false;
  $('d-watch').firstElementChild.focus();

  // Your own servers are checked at the same time as the details, so they show up first.
  const ref = item.kind === 'jf' ? item.tmdb : (item.kind === 'movie' || item.kind === 'tv') ? { kind: item.kind, id: item.id } : null;
  const jfEarly = ref ? tv.jfFind(ref.kind, ref.id, item.title, item.year || null).catch(() => null) : null;
  const res = await tv.details(item.kind, item.id);
  if (screen !== 'detail' || seq !== detailSeq) return;
  $('d-side-loading').hidden = true;
  if (res.error) {
    $('d-meta').textContent = '';
    $('d-overview').textContent = ERRORS[res.error] || ERRORS.failed;
    $('d-watch').replaceChildren(el('button', { class: 'watch-btn plain', nav: true, textContent: 'Back', onclick: back }));
    $('d-watch').firstElementChild.focus();
    return;
  }
  const d = res.ok;
  $('d-kind').textContent = d.kind === 'tv' ? 'Series' : 'Film';
  $('d-title').textContent = d.title;
  // Its length and when it would end if you started now (or, partway in, when it would finish).
  const left = item.kind === 'jf' && item.item && item.progress > 0 && item.item.runtime ? (item.item.runtime - item.item.position) / 60 : 0;
  const parts = d.meta.split('  ·  ').filter((x) => !/^\d+h \d+m$/.test(x));
  $('d-meta').textContent = [...parts.slice(0, 1), ...runtimeBits({ minutes: d.minutes, leftMinutes: left, series: d.kind === 'tv' }), ...parts.slice(1)].join('  ·  ');
  if (d.rating) { $('d-rating').textContent = `★ ${d.rating}`; $('d-rating').hidden = false; }
  $('d-overview').textContent = d.overview;
  if (d.backdrop) $('d-backdrop').style.backgroundImage = `url("${IMG}w1280${d.backdrop}")`;

  const mine = services.filter((s) => d.onServices.includes(s.id));
  const sellers = (d.rentOnly || []).map((r) => ({ r, s: services.find((x) => x.id === r.serviceId) })).filter((x) => x.s);
  const watch = $('d-watch');
  watch.replaceChildren();
  // Each button says how you'd watch: included with the service, free, or rent / buy only.
  for (const s of mine) {
    watch.append(el('button', {
      class: 'watch-btn', nav: true,
      style: { '--svc': s.color, '--svc-text': textFor(s.color) },
      onclick: () => { remember(d); if (d.links && d.links[s.id]) tv.openLink(d.links[s.id], s.id); else tv.open(s.id, d.title); },
    }, el('span', { class: 'wb-name', textContent: s.name }), el('small', { textContent: HOW_TEXT[(d.serviceHow || {})[s.id]] || 'Included' })));
  }
  for (const { r, s } of sellers) {
    watch.append(el('button', {
      class: 'watch-btn sells', nav: true,
      style: { '--svc': s.color },
      onclick: () => {
        remember(d);
        if (r.url) tv.openLink(r.url, r.storeId || s.id);
        else tv.open(r.storeId || s.id, d.title);
      },
    }, el('span', { class: 'wb-name', textContent: s.name }), el('small', { textContent: `Not included · ${rentBuyText(r)}` })));
  }
  if (mine.length) $('d-watch-label').textContent = 'Watch on';
  else if (sellers.length) $('d-watch-label').textContent = 'Not included with your services';
  else {
    $('d-watch-label').textContent = `Not streaming on your services in ${d.region}`;
    watch.append(el('button', { class: 'watch-btn plain placeholder', nav: true, textContent: 'Back', onclick: back }));
  }
  $('d-vt').hidden = !(mine.some((s) => s.id === 'youtube') && !appsState.vacuumtube);
  renderElsewhere(d);
  $('d-free').hidden = true;
  renderFreeSearch(d);
  renderTrakt(d, seq);
  renderPeople(d);
  $('d-tagline').textContent = d.tagline || '';
  $('d-tagline').hidden = !d.tagline;
  // No description from TMDB? Use the one from your Jellyfin server, if this came from there.
  if (!d.overview && item.resume && item.resume.item && item.resume.item.overview) $('d-overview').textContent = item.resume.item.overview;
  $('d-credit').textContent = `Streaming availability from JustWatch${d.watchmode ? ' and Watchmode' : ''} · Details from TMDB`;
  detailResume = item.resume || null;
  if (detailResume) {
    const placeholder = watch.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    $('d-watch-label').textContent = 'Watch on';
    watch.prepend(resumeButton(detailResume));
  }
  // Still checking your servers? A shimmering spot where their buttons will go (first in line).
  const checking = el('div', { class: 'watch-btn plain checking' }, el('span', { class: 'wb-name', textContent: 'Checking your servers…' }), bar('7rem'));
  const resumeBtn = watch.querySelector('.resume');
  if (resumeBtn) resumeBtn.after(checking); else watch.prepend(checking);
  (watch.querySelector('.watch-btn[data-nav], button.watch-btn') || watch.firstElementChild).focus();
  renderYouTubeFind(d);
  addJellyfinButtons(d, seq, jfEarly).finally(() => checking.remove());
}

// "Find it on YouTube": searches YouTube (in VacuumTube when it's installed) for uploads of
// this title. Not YouTube's own rent / buy (that's under "Rent or buy").
function renderYouTubeFind(d) {
  const q = [d.title, d.year, d.kind === 'movie' ? 'full movie' : ''].filter(Boolean).join(' ');
  const b = el('button', { class: 'pill', nav: true, onclick: () => { remember(d); tv.findOnYouTube(q); } },
    el('span', { textContent: `Search YouTube for “${q}”` }));
  $('d-yt-row').replaceChildren(b);
  $('d-yt').hidden = false;
}

// "Resume" (or "Play next") from Jump back in / Up next: picks up right where you were.
let detailResume = null;
function resumeButton(c) {
  const it = c.item;
  const partway = it.position > 30 && !it.played;
  const what = it.type === 'Episode' ? `S${it.season}E${it.episode} · ${it.name}` : '';
  const sub = partway
    ? [what, `from ${clock(it.position)}`].filter(Boolean).join(' · ')
    : [what || it.name, `on ${c.serverName}`].join(' · ');
  return el('button', {
    class: 'watch-btn jellyfin resume', nav: true,
    onclick: () => playJellyfin(c.serverId, it, status, { direct: true }),
  }, el('span', { class: 'wb-name', textContent: partway ? 'Resume' : it.type === 'Episode' ? 'Play next episode' : 'Play' }), el('small', { textContent: sub }));
}

// Back from watching: move the Resume button on (to where you stopped, or the next episode).
async function refreshResume() {
  const c = detailResume;
  if (!c || screen !== 'detail') return;
  const old = $('d-watch').querySelector('.resume');
  const r = c.item.type === 'Episode' ? await tv.jfNextUp(c.serverId, c.item.seriesId) : await tv.jfItem(c.serverId, c.item.id);
  if (detailResume !== c || !old || !old.isConnected) return;
  const it = r && r.ok;
  if (!it || (c.item.type === 'Movie' && it.played)) { old.remove(); detailResume = null; return; }
  detailResume = { ...c, item: it };
  const fresh = resumeButton(detailResume);
  const hadFocus = document.activeElement === old;
  old.replaceWith(fresh);
  if (hadFocus) fresh.focus();
}

// Everywhere else a title is available: every one opens something. Known services and stores open
// their own search for the title; anything else opens TMDB's where-to-watch page, which links to it.
let stores = [];
tv.stores().then((list) => { stores = list || []; });
const matches = (list, name) => list.find((x) => new RegExp(x.match, 'i').test(name));

const HOW_TEXT = { included: 'Included', free: 'Free', ads: 'Free with ads' };
const money = (n) => `$${Number(n).toFixed(2)}`;
// "Rent $3.99 · Buy $14.99", or "Rent or buy", "Buy only"...
function rentBuyText(x) {
  const parts = [];
  if (x.rent) parts.push(x.rentPrice != null ? `Rent ${money(x.rentPrice)}` : 'Rent');
  if (x.buy) parts.push(x.buyPrice != null ? `Buy ${money(x.buyPrice)}` : 'Buy');
  const priced = /\$/.test(parts.join(''));
  if (!parts.length || (!priced && parts.length === 2)) return 'Rent or buy';
  if (parts.length === 1) return parts[0].replace(/^(Rent|Buy)( (.*))?$/, (m, k, _, price) => (price ? `${k} only · ${price}` : `${k} only`));
  return parts.join(' · ');
}

function renderElsewhere(d) {
  const open = (e) => {
    const target = matches(services, e.name) || matches(stores, e.name);
    return () => {
      remember(d);
      if (e.url) tv.openLink(e.url, target ? target.id : null);
      else if (target) tv.open(target.id, d.title);
      else tv.openWatchPage(d.kind, d.id);
    };
  };
  const chip = (e, sub) => el('button', { class: 'pill', nav: true, onclick: open(e) }, document.createTextNode(e.name), el('small', { textContent: sub }));
  const selling = d.elsewhere.filter((e) => e.how === 'rent or buy');
  const other = d.elsewhere.filter((e) => e.how !== 'rent or buy');
  $('d-other-row').replaceChildren(...other.map((e) => chip(e, e.how === 'streaming' ? 'with a subscription' : e.how)));
  $('d-elsewhere-row').replaceChildren(...selling.map((e) => chip(e, rentBuyText(e))));
  $('d-other').hidden = !other.length;
  $('d-elsewhere').hidden = !selling.length;
}

// Where-to-watch data has gaps (free services rotate titles; live channels aren't tracked),
// so offer a quick search on the free services anyway.
function renderFreeSearch(d) {
  const free = services.filter((s) => s.free && !d.onServices.includes(s.id) && !d.elsewhere.some((e) => new RegExp(s.match, 'i').test(e.name)));
  $('d-free').querySelector('.eyebrow').textContent = d.watchmode ? 'Not listed? Search your free services anyway' : 'Not listed? Search your free services';
  $('d-free-row').replaceChildren(...free.map((s) => el('button', {
    class: 'pill', nav: true, textContent: s.name, onclick: () => { remember(d); tv.open(s.id, d.title); },
  })));
  $('d-free').hidden = !free.length;
}

// Trakt: put it on your watchlist (or take it off), or mark a film watched.
async function renderTrakt(d, seq) {
  $('d-trakt').hidden = true;
  if (!traktConnected) return;
  const r = await tv.traktTitle(d.kind, d.id);
  if (seq !== detailSeq || screen !== 'detail' || !r || r.error) return;
  let on = r.onWatchlist;
  const list = el('button', { class: 'pill', nav: true });
  const paint = () => { list.textContent = on ? '✓ On your watchlist' : '＋ Add to watchlist'; };
  paint();
  list.addEventListener('click', async () => {
    const res = await tv.traktWatchlist(d.kind, d.id, !on);
    if (res.ok) { on = !on; paint(); toast(on ? `Added ${d.title} to your Trakt watchlist.` : `Took ${d.title} off your Trakt watchlist.`); }
    else toast('Couldn\'t reach Trakt. Try again in a moment.');
  });
  const row = [list];
  if (d.kind === 'movie') {
    const seen = el('button', { class: 'pill', nav: true, textContent: 'Mark as watched' });
    seen.addEventListener('click', async () => {
      const res = await tv.traktWatched(d.kind, d.id);
      if (res.ok) { seen.textContent = '✓ Watched'; toast(`Marked ${d.title} as watched on Trakt.`); }
      else toast('Couldn\'t reach Trakt. Try again in a moment.');
    });
    row.push(seen);
  }
  $('d-trakt-row').replaceChildren(...row);
  $('d-trakt').hidden = false;
}

// Titles you open to watch feed "Inspired by what you've watched".
function remember(d) {
  tv.remember(d.kind, d.id, d.title);
}

$('d-vt-more').addEventListener('click', () => tv.open('vacuumtube-info'));
tv.onExternalClosed(() => { status(''); refreshApps(); loadRows(); });

// ------------------------------------------------------------ settings

const settings = { found: null, overService: false };
const mask = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;

function note(text, good) {
  $('s-note').textContent = text || '';
  $('s-note').classList.toggle('good', Boolean(good));
}

function renderStatus(s) {
  const status = $('s-status');
  status.className = 'status ' + (s.hasKey ? 'good' : 'none');
  status.textContent = s.hasKey ? `Search is on · key ${s.masked} · region ${s.region}` : 'No key yet, so search is off';
  $('s-remove').hidden = !s.hasKey;
  $('s-hints').classList.toggle('on', s.showHints);
  $('s-hints').setAttribute('aria-pressed', String(s.showHints));
  $('s-pause').classList.toggle('on', Boolean(s.pauseOnMenu));
  $('s-sounds').classList.toggle('on', s.soundEffects !== false);
  applyLayout(s.layout); applyLook(s.look);
  settings.kbConfirm = s.kbConfirm !== false;
  $('s-kb-confirm').classList.toggle('on', settings.kbConfirm);
  renderSuggestSettings(s.suggest);
  renderPlayerChoice(s.jellyfinPlayer);
  renderPlayback(s.playback);
  $('s-pause').setAttribute('aria-pressed', String(Boolean(s.pauseOnMenu)));
  $('s-how').hidden = s.hasKey || !$('s-found').hidden;
  renderExtras(s);
}

// Watchmode and Trakt in Settings.
function renderExtras(s) {
  const wm = s.watchmode || {};
  $('wm-status').className = 'status ' + (wm.hasKey ? 'good' : 'none');
  $('wm-status').textContent = wm.hasKey ? `On · key ${wm.masked}` : 'Off';
  $('wm-setup').textContent = wm.hasKey ? 'Change key' : 'Set up Watchmode';
  $('wm-remove').hidden = !wm.hasKey;
  if (wm.hasKey) {
    tv.wmStatus().then((u) => {
      if (u && u.quota) $('wm-status').textContent = `On · key ${wm.masked} · ${u.used ?? 0} of ${u.quota} lookups used this month`;
      else if (u && u.error === 'bad-key') { $('wm-status').className = 'status none'; $('wm-status').textContent = `Watchmode stopped accepting key ${wm.masked}`; }
    });
  }
  const t = s.trakt || {};
  $('trakt-status').className = 'status ' + (t.connected ? 'good' : 'none');
  $('trakt-status').textContent = t.connected ? `Connected${t.username ? ` as ${t.username}` : ''}`
    : t.signedOut ? 'Signed out. Sign in again to reconnect.'
      : t.hasApp ? 'Your Trakt app is saved. Sign in to finish.' : 'Not connected';
  $('trakt-setup').textContent = t.connected ? 'Set up again' : t.hasApp ? 'Sign in to Trakt' : 'Set up Trakt';
  $('trakt-remove').hidden = !(t.connected || t.hasApp);
  $('trakt-options').hidden = !t.connected;
  $('trakt-rows').classList.toggle('on', t.rows);
  $('trakt-scrobble').classList.toggle('on', t.scrobble);
  traktConnected = Boolean(t.connected);
}
let traktConnected = false;

async function refreshSettings() {
  renderStatus(await tv.settings());
  renderLiveSettings();
  renderDeveloper();
}

// If there's a TMDB key on the clipboard (say, copied from TMDB's site), offer it straight away.
// (focus: false when Settings was opened on another tab, so it isn't pulled over to General.)
async function checkClipboard({ focus = true } = {}) {
  const key = await tv.clipboardKey();
  settings.found = key;
  $('s-found').hidden = !key;
  if (key) $('s-how').hidden = true;
  if (key) {
    $('s-found-key').textContent = mask(key);
    if (focus) $('s-save').focus();
  }
  return key;
}

async function saveKey(key) {
  note('Checking the key with TMDB…');
  const r = await tv.setKey(key);
  if (r.ok) {
    settings.found = null;
    $('s-found').hidden = true;
    note(key ? 'Key saved. Search is ready.' : 'Key removed.', Boolean(key));
    await refreshSettings();
    $('s-phone').focus();
  } else {
    note(ERRORS[r.error] || ERRORS.failed);
  }
}

async function openSettings(opts) {
  const overService = Boolean(opts && opts.overService === true);
  if (screen !== 'settings') go('settings');
  const asked = opts && typeof opts.tab === 'string' ? opts.tab : '';
  if (asked) setSettingsTab(asked, { focus: false });
  settings.overService = overService;
  $('s-eyebrow').textContent = overService && opts.name ? `Press B to go back to ${opts.name}` : 'SOFA King';
  note('');
  $('s-phone-panel').hidden = true;
  closeJfPanel();
  // Back where you were last time (unless something asked for a particular tab).
  if (asked || !restoreSettingsPlace()) { if (!asked) setSettingsTab('general', { focus: false }); focusSettingsTab(); }
  refreshApps();
  renderServers((await tv.jfList()).ok || []);
  await refreshSettings();
  await checkClipboard({ focus: !asked || asked === 'general' });
}

function leaveSettings() {
  tv.phoneMode('text');
  clearTimeout(phoneTimer);
  closeJfPanel();
}

$('s-save').addEventListener('click', () => settings.found && saveKey(settings.found));
$('wm-setup').addEventListener('click', () => openSetup('watchmode'));
$('wm-remove').addEventListener('click', async () => {
  await tv.setAnyKey('watchmode', '');
  await refreshSettings();
  $('wm-setup').focus();
});
$('trakt-setup').addEventListener('click', () => openSetup('trakt'));
$('trakt-remove').addEventListener('click', async () => {
  renderStatus(await tv.traktRemove('all'));
  $('trakt-setup').focus();
  loadRows();
});
$('trakt-rows').addEventListener('click', async () => {
  renderStatus(await tv.traktOptions({ rows: !$('trakt-rows').classList.contains('on') }));
  loadRows();
});
$('trakt-scrobble').addEventListener('click', async () => {
  renderStatus(await tv.traktOptions({ scrobble: !$('trakt-scrobble').classList.contains('on') }));
});
$('s-pause').addEventListener('click', async () => {
  renderStatus(await tv.setPauseOnMenu(!$('s-pause').classList.contains('on')));
});
$('s-sounds').addEventListener('click', async () => {
  renderStatus(await tv.setSounds(!$('s-sounds').classList.contains('on')));
});
$('s-hints').addEventListener('click', async () => {
  renderStatus(await tv.setHints(!$('s-hints').classList.contains('on')));
});
$('s-remove').addEventListener('click', () => saveKey(''));
$('s-web').addEventListener('click', () => {
  note('');
  settings.toTmdb = true; // (coming back, the copied key is looked for)
  tv.open('tmdb');
});
$('s-clip').addEventListener('click', async () => {
  const key = await checkClipboard();
  if (key) saveKey(key);
  else note('There\'s no TMDB key on the clipboard yet. Copy the API Read Access Token first.');
});
$('s-phone').addEventListener('click', async () => {
  closeJfPanel();
  const info = await tv.phone('key');
  if (!info || info.error) {
    note('Couldn\'t find this TV on your home network. Check it\'s connected to Wi-Fi or Ethernet.');
    return;
  }
  // The QR code is an SVG the app generated itself from the remote's link.
  $('s-qr').innerHTML = info.qr;
  $('s-url').textContent = `${info.address} · ${info.network}`;
  $('s-phone-panel').hidden = false;
  note(info.seen ? 'Your phone is connected. Paste your key there and tap Save.' : 'Waiting for your phone…', info.seen);
  watchPhone(info.seen);
});

// ------------------------------------------------------------ phone not connecting

const KEY_TIPS = {
  steam: 'No keyboard? Press Steam + X to type with Steam\'s keyboard.',
  gnome: 'GNOME\'s on-screen keyboard will pop up for the password.',
  kde: 'KDE\'s on-screen keyboard doesn\'t reliably appear without a touchscreen, so plug in a keyboard for this one step.',
};
let phoneTimer = null;

function watchPhone(seen) {
  clearTimeout(phoneTimer);
  $('s-trouble').hidden = true;
  $('s-phone-panel').classList.remove('compact');
  if (!seen) phoneTimer = setTimeout(showTrouble, 15000);
}

async function showTrouble() {
  if (screen !== 'settings' || $('s-phone-panel').hidden) return;
  const f = await tv.firewall();
  if (!f || f.seen) return;
  const blocking = (f.kind === 'ufw' || f.kind === 'firewalld') && !f.open;
  const elsewhere = 'Check your phone is on the same Wi-Fi as this PC (not a guest network), that any VPN on the phone is off, and that your router doesn\'t keep Wi-Fi devices apart (often called "AP isolation" or "client isolation").';
  $('s-trouble-text').textContent = blocking
    ? `This PC's firewall (${f.kind}) is probably blocking it. You can let the remote through for your home network (${f.network}) only, not the internet.`
    : f.open
      ? `This PC's firewall already lets the remote in from your home network. ${elsewhere}`
      : `This PC's firewall doesn't look like the problem. ${elsewhere}`;
  $('s-allow').hidden = !(blocking && f.command);
  $('s-trouble-keys').textContent = blocking
    ? [f.command ? 'Press right to get to the button.' : '', 'This asks for your computer password in the system\'s own prompt.', ...f.tips.map((t) => KEY_TIPS[t])].filter(Boolean).join(' ')
    : '';
  $('s-trouble-cmd').hidden = !(blocking && f.command);
  $('s-trouble-cmd').textContent = f.command ? `Or run it yourself: ${f.command}` : '';
  $('s-trouble').hidden = false;
  $('s-phone-panel').classList.add('compact');
}

$('s-allow').addEventListener('click', async () => {
  note('Waiting for the password prompt…');
  const r = await tv.firewallAllow();
  if (r.ok && r.open === false) {
    note('The firewall said yes, but it still looks closed. Try the command below in a terminal.');
  } else if (r.ok) {
    note('Done. Scan the code again on your phone.', true);
    $('s-allow').hidden = true;
    $('s-trouble-text').textContent = 'The remote is allowed on your home network now.';
    $('s-trouble-keys').textContent = '';
    $('s-trouble-cmd').hidden = true;
    $('s-phone').focus();
    // If the phone still can't get through, say what else to check.
    clearTimeout(phoneTimer);
    phoneTimer = setTimeout(showTrouble, 20000);
  } else if (r.error === 'cancelled') {
    note('The password prompt was closed, so nothing changed.');
  } else if (r.error === 'no-pkexec') {
    note('This system can\'t show a password prompt. Run the command below in a terminal instead.');
  } else {
    note(`That didn't work${r.detail ? `: ${r.detail}` : '.'} You can run the command below in a terminal instead.`);
  }
});

tv.onPhoneConnected(() => {
  clearTimeout(phoneTimer);
  $('s-trouble').hidden = true;
  $('s-phone-panel').classList.remove('compact');
  if (screen === 'settings' && !$('s-phone-panel').hidden) note('Your phone is connected. Paste your key there and tap Save.', true);
});

tv.onSettings((s) => {
  renderStatus(s);
  loadRows();
  if (screen === 'settings' && s.hasKey) {
    note('Key saved. Search is ready.', true);
    $('s-found').hidden = true;
  }
});

// Coming back to Settings (from a website, mpv, another app). Only coming back from TMDB's site
// looks for a freshly copied key and moves to it; anything else leaves you where you were (it used
// to jump to General's "Use copied key" every time, wherever you'd been).
tv.onHomeShown(() => {
  settings.overService = false; // nothing paused underneath any more
  setTimeout(offerUpdate, 300); // a new version found while you were away
  if (screen === 'setup') setupBack();
  if (screen === 'home' && view === 'home') loadRows();
  if (screen === 'settings') {
    $('s-eyebrow').textContent = 'SOFA King';
    refreshSettings();
    if (settings.toTmdb) checkClipboard().then((key) => { if (!key) $('s-clip').focus(); });
    settings.toTmdb = false;
  }
});

// Settings picked from the menu (the app tells us whether a website is paused underneath).
tv.onOpenSettings((opts) => openSettings(opts));

// ------------------------------------------------------------ phone typing

tv.onRemoteText((text) => {
  if (screen === 'ask') { setAsk(text); return; }
  if (screen === 'settings') {
    const t = text.trim();
    if (/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|[a-f0-9]{32})$/i.test(t)) saveKey(t);
    return;
  }
  if (screen !== 'search') openSearch();
  setQuery(text.replace(/\s+/g, ' ').slice(0, 60));
});

tv.onRemoteKey((name) => {
  if (screen === 'search' && name === 'Backspace') erase();
  if (screen === 'ask' && name === 'Backspace') askErase();
  if (screen === 'ask' && name === 'Enter') finishAsk(ask.value);
});

// ------------------------------------------------------------ typing something in
//
// ask() shows a full on-screen keyboard and resolves with what was typed, or null if cancelled.

const ask = { value: '', secret: false, resolve: null, suggest: '', timer: 0, seq: 0, phoneSeq: 0 };

function showAsk() {
  const shown = ask.secret ? '•'.repeat(ask.value.length) : ask.value;
  $('ask-text').textContent = shown;
  $('ask-field').classList.toggle('empty', !ask.value);
}

function setAsk(text) { ask.value = String(text).slice(0, 300); showAsk(); askSuggest(); }

// Suggestions (only where askFor asked for them), after a short pause in typing.
function askSuggest() {
  if (!ask.suggest) return;
  clearTimeout(ask.timer);
  ask.timer = setTimeout(async () => {
    const seq = ++ask.seq;
    const list = await tv.suggest(ask.value, ask.suggest);
    if (seq === ask.seq && screen === 'ask' && ask.suggest) askKeys.suggestions(list);
  }, 250);
}
function askType(ch) { setAsk(ask.value + ch); }
function askErase() { setAsk(ask.value.slice(0, -1)); }

// The keys (and Shift, caps lock, "are you sure?"): see keyboard.js.
const askKeys = window.TVKeyboard.create({
  root: $('ask-keys'),
  onType: (t) => askType(t),
  onErase: () => askErase(),
  onSubmit: () => finishAsk(ask.value),
  onCancel: () => finishAsk(null),
  onPick: (item) => setAsk(item.value),
  confirm: () => settings.kbConfirm !== false,
  buttonName: (a) => window.tvButtons.buttonFor(a),
  describe: () => (ask.secret ? '•'.repeat(ask.value.length) : ask.value),
});
// On the typing screen, the controller moves around the keys (A types, Start is Done, B cancels).
const ASK_PRESS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok' };
document.addEventListener('keydown', (e) => {
  if (screen !== 'ask') return;
  if (e.key === 'Shift') { askKeys.hold('shift', true); return; }
  const a = ASK_PRESS[e.key];
  if (!a) return;
  e.preventDefault(); e.stopImmediatePropagation();
  askKeys.handle(a);
}, true);
document.addEventListener('keyup', (e) => { if (screen === 'ask' && e.key === 'Shift') askKeys.hold('shift', false); });
tv.onHold((action, down) => { if (screen === 'ask') askKeys.hold(action, down); });
tv.onTypingDone(() => { if (screen === 'ask') askKeys.handle('menu'); });

// suggest: what to suggest while typing ('words', or 'radio' for earlier station searches too);
// nothing for addresses, names and passwords.
function askFor({ label, eyebrow = '', hint = '', value = '', secret = false, placeholder = '', suggest = '' }) {
  if (ask.resolve) finishAsk(null);
  go('ask');
  ask.secret = secret;
  ask.suggest = !secret && settings.suggestOn !== false ? suggest : '';
  $('ask-eyebrow').textContent = eyebrow;
  $('ask-label').textContent = label;
  $('ask-hint').textContent = hint;
  $('ask-field').dataset.placeholder = placeholder;
  askKeys.reset({ suggest: Boolean(ask.suggest) });
  setAsk(value);
  tv.setTyping(true);
  askPhone(label, secret);
  return new Promise((resolve) => { ask.resolve = resolve; });
}

// The code to scan, so the phone can type here (hidden if this computer isn't on a network).
async function askPhone(label, secret) {
  const seq = ++ask.phoneSeq;
  $('ask-phone').hidden = true;
  const info = await tv.phoneAsk(label, secret);
  if (seq !== ask.phoneSeq || screen !== 'ask' || !info || info.error) return;
  $('ask-qr').innerHTML = info.qr; // an SVG the app made itself from the phone page's address
  $('ask-phone-addr').textContent = info.address || '';
  askPhoneSeen(info.seen);
  $('ask-phone').hidden = false;
}
function askPhoneSeen(seen) {
  $('ask-phone-help').textContent = seen ? 'Your phone is connected: type there and tap Send.' : 'Scan with your camera. Phone and TV need the same Wi-Fi.';
  $('ask-phone-help').classList.toggle('good', Boolean(seen));
}
tv.onPhoneConnected(() => { if (screen === 'ask') askPhoneSeen(true); });

function finishAsk(result) {
  const resolve = ask.resolve;
  ask.resolve = null;
  ask.phoneSeq++;
  tv.phoneMode('text');
  clearTimeout(ask.timer);
  if (result && ask.suggest === 'radio') tv.suggestRemember(result, 'radio');
  tv.setTyping(false);
  const prev = trail.pop();
  if (prev) {
    show(prev.screen);
    if (prev.focus && prev.focus.isConnected) prev.focus.focus();
  }
  if (resolve) resolve(result);
}

// ------------------------------------------------------------ settings: Jellyfin servers

function jfNote(text, good) {
  $('jf-note').textContent = text || '';
  $('jf-note').classList.toggle('good', Boolean(good));
}

const JF_ERRORS = {
  unreachable: 'Couldn\'t reach that address. Check the server is running and the address is right.',
  'bad-address': 'That doesn\'t look like a web address.',
  'not-jellyfin': 'Something answered at that address, but it isn\'t a Jellyfin server.',
  unauthorized: 'Jellyfin didn\'t accept that username and password.',
  'qc-off': 'Quick Connect is switched off on this server. Use your username and password instead.',
  expired: 'The code expired. Try adding the server again.',
  failed: 'Something went wrong talking to that server. Try again.',
};

function renderServers(list) {
  const box = $('jf-servers');
  box.replaceChildren();
  for (const s of list) {
    const row = el('div', { class: 'server' },
      el('div', {},
        el('p', { class: 'server-name', textContent: s.name }),
        el('p', { class: `server-meta${s.signedIn ? '' : ' bad'}`, textContent: s.signedIn ? `${s.url} · ${s.userName}` : `${s.url} · signed out` })),
      el('div', { class: 'server-actions' },
        s.signedIn ? null : el('button', { class: 'pill', nav: true, textContent: 'Sign in', onclick: () => signInTo({ name: s.name, url: s.url }) }),
        el('button', { class: 'pill quiet', nav: true, textContent: 'Remove', onclick: () => removeServer(s) })));
    box.append(row);
  }
}

async function removeServer(s) {
  const r = await tv.jfRemove(s.id);
  if (r.ok) { renderServers(r.ok); jfNote(`Removed ${s.name}.`); $('jf-add').focus(); }
}

tv.onJfChanged((list) => { renderServers(list); loadRows(); });

function closeJfPanel() {
  if (!$('plex-panel').hidden) closePlexPanel();
  $('jf-panel').hidden = true;
  tv.jfQcCancel();
}

function showJfStep(step) {
  $('s-phone-panel').hidden = true;
  $('jf-panel').hidden = false;
  $('jf-pick').hidden = step !== 'pick';
  $('jf-qc').hidden = step !== 'qc';
}

$('jf-add').addEventListener('click', async () => {
  jfNote('');
  showJfStep('pick');
  $('jf-pick-status').textContent = 'Looking on your network…';
  $('jf-found').replaceChildren();
  $('jf-type').focus();
  const r = await tv.jfDiscover();
  const found = r.ok || [];
  $('jf-pick-status').textContent = found.length
    ? 'Found on your network:'
    : 'No servers found automatically. Type its address instead.';
  for (const s of found) {
    $('jf-found').append(el('button', { class: 'pill', nav: true, onclick: () => signInTo(s) },
      document.createTextNode(s.name), el('small', { textContent: s.url })));
  }
  if (found.length) $('jf-found').firstElementChild.focus();
});

$('jf-type').addEventListener('click', async () => {
  const typed = await askFor({
    eyebrow: 'Add a Jellyfin server',
    label: 'Server address',
    hint: 'Like 192.168.1.20 or jellyfin.example.com. Port 8096 is assumed if you leave it out.',
    placeholder: '192.168.1.20',
  });
  if (!typed) return;
  jfNote('Checking that address…');
  const r = await tv.jfProbe(typed);
  if (r.error) { jfNote(JF_ERRORS[r.error] || JF_ERRORS.failed); $('jf-type').focus(); return; }
  jfNote('');
  signInTo(r.ok);
});

// Quick Connect first (no typing), username and password if the person prefers or it's off.
async function signInTo(server) {
  showJfStep('qc');
  $('jf-qc-title').textContent = `Sign in to ${server.name}`;
  $('jf-qc-code').textContent = '';
  $('jf-qc-status').textContent = 'Getting a code…';
  $('jf-password').onclick = () => signInWithPassword(server);
  $('jf-password').focus();
  const start = await tv.jfQcStart(server.url);
  if (start.error) {
    if (start.error === 'qc-off') return signInWithPassword(server, JF_ERRORS['qc-off']);
    $('jf-qc-status').textContent = JF_ERRORS[start.error] || JF_ERRORS.failed;
    return;
  }
  $('jf-qc-code').textContent = start.ok.code.replace(/(\d{3})(\d{3})/, '$1 $2');
  $('jf-qc-status').textContent = 'Waiting for approval…';
  const done = await tv.jfQcWait();
  if (done.error === 'cancelled') return;
  if (done.error) { $('jf-qc-status').textContent = JF_ERRORS[done.error] || JF_ERRORS.failed; return; }
  closeJfPanel();
  jfNote(`Added ${done.ok.name}, signed in as ${done.ok.userName}.`, true);
  $('jf-add').focus();
}

async function signInWithPassword(server, why) {
  tv.jfQcCancel();
  const username = await askFor({ eyebrow: `Sign in to ${server.name}`, label: 'Username', hint: why || '' });
  if (username == null) return;
  const password = await askFor({ eyebrow: `Sign in to ${server.name}`, label: `Password for ${username}`, secret: true });
  if (password == null) return;
  jfNote('Signing in…');
  const r = await tv.jfSignIn(server.url, username, password);
  if (r.error) { jfNote(JF_ERRORS[r.error] || JF_ERRORS.failed); return; }
  closeJfPanel();
  jfNote(`Added ${r.ok.name}, signed in as ${r.ok.userName}.`, true);
  $('jf-add').focus();
}

// ------------------------------------------------------------ Settings → Servers → Plex

const PLEX_ERRORS = {
  unreachable: 'Couldn\'t reach Plex. Check this computer is online, and try again.',
  unauthorized: 'Plex didn\'t accept the sign-in. Try signing in again.',
  expired: 'The code expired. Try signing in again.',
  failed: 'Something went wrong talking to Plex. Try again.',
};
const plexNote = (text) => { $('plex-note').textContent = text || ''; };
function renderPlex(st) {
  if (!st) return;
  $('plex-account').textContent = st.signedIn ? `Signed in as ${st.userName}.` : '';
  $('plex-signin').hidden = st.signedIn;
  $('plex-refresh').hidden = !st.signedIn;
  $('plex-signout').hidden = !st.signedIn;
  $('plex-servers').replaceChildren(...st.servers.map((x) => el('div', { class: 'server' },
    el('div', {},
      el('p', { class: 'server-name', textContent: x.name }),
      el('p', { class: `server-meta${x.reachable ? '' : ' bad'}`, textContent: [x.owned ? 'Yours' : 'Shared with you', x.reachable ? new URL(x.url).host : 'not reachable right now'].join(' · ') })),
    el('div', { class: 'server-actions' },
      el('button', { class: `pill toggle${x.enabled ? ' on' : ''}`, nav: true, onclick: async () => { const r = await tv.plexToggle(x.id); if (r.ok) { renderPlex(r.ok); loadRows(); } } },
        el('span', { textContent: 'Use it' }), el('span', { class: 'switch', 'aria-hidden': 'true' }))))));
  if (st.signedIn && !st.servers.length) plexNote('No servers on this Plex account yet. Once one is set up (or shared with you), choose "Look for servers again".');
}
tv.plexState().then((r) => renderPlex(r && r.ok));
tv.onPlexChanged((st) => { renderPlex(st); loadRows(); });

function closePlexPanel() {
  $('plex-panel').hidden = true;
  tv.plexCancel();
}
$('plex-cancel').addEventListener('click', () => { closePlexPanel(); $('plex-signin').focus(); });
$('plex-signin').addEventListener('click', async () => {
  plexNote('');
  $('s-phone-panel').hidden = true;
  $('jf-panel').hidden = true;
  $('plex-panel').hidden = false;
  $('plex-code').textContent = '';
  $('plex-status').textContent = 'Getting a code…';
  $('plex-cancel').focus();
  const start = await tv.plexStart();
  if (start.error) { $('plex-status').textContent = PLEX_ERRORS[start.error] || PLEX_ERRORS.failed; return; }
  $('plex-code').textContent = start.ok.code;
  $('plex-status').textContent = 'Waiting for you to enter it…';
  const done = await tv.plexWait();
  if (done.error === 'cancelled') return;
  if (done.error) { $('plex-status').textContent = PLEX_ERRORS[done.error] || PLEX_ERRORS.failed; return; }
  $('plex-panel').hidden = true;
  renderPlex(done.ok);
  plexNote(`Signed in. ${done.ok.servers.length === 1 ? 'Found 1 server.' : `Found ${done.ok.servers.length} servers.`}`);
  ($('plex-servers').querySelector('button') || $('plex-refresh')).focus();
  loadRows();
});
$('plex-refresh').addEventListener('click', async () => {
  plexNote('Looking for your servers…');
  const r = await tv.plexRefresh();
  if (r.error) { plexNote(PLEX_ERRORS[r.error] || PLEX_ERRORS.failed); return; }
  renderPlex(r.ok);
  plexNote(`Found ${r.ok.servers.length === 1 ? '1 server' : `${r.ok.servers.length} servers`}.`);
  loadRows();
});
$('plex-signout').addEventListener('click', async () => {
  const r = await tv.plexSignOut();
  if (r.ok) { renderPlex(r.ok); plexNote('Signed out of Plex.'); $('plex-signin').focus(); loadRows(); }
});

$('app-vt-more').addEventListener('click', () => tv.open('vacuumtube-info'));
$('app-mpv-more').addEventListener('click', () => tv.open('mpv-info'));
$('d-mpv-more').addEventListener('click', () => tv.open('mpv-info'));

function renderPlayerChoice(choice) {
  playerChoice = choice || playerChoice;
  for (const b of $('jf-player').children) b.classList.toggle('chosen', b.dataset.player === playerChoice);
}
for (const b of $('jf-player').children) {
  b.addEventListener('click', async () => {
    const s = await tv.setJfPlayer(b.dataset.player);
    if (s) renderPlayerChoice(s.jellyfinPlayer);
  });
}

// ------------------------------------------------------------ settings: YouTube

function renderYouTube(y) {
  if (!y) return;
  for (const b of $('yt-open').children) b.classList.toggle('chosen', b.dataset.open === y.open);
  $('yt-open-note').textContent = {
    auto: y.vacuumtube ? 'Automatic: in VacuumTube (it\'s installed). Without it, YouTube\'s TV page opens here.' : 'Automatic: YouTube\'s TV page opens here. If you install VacuumTube, it\'s used instead.',
    tv: 'YouTube\'s TV page (the one smart TVs show) opens here, with the extras below.',
    website: 'youtube.com opens here, the way it looks on a computer. The extras below don\'t apply to it.',
  }[y.open];
  for (const k of ['adblock', 'sponsorblock', 'dislikes', 'dearrow']) $(`yt-${k}`).classList.toggle('on', Boolean(y[k]));
  const focused = document.activeElement && document.activeElement.dataset.cat;
  $('yt-cats').replaceChildren(...y.categories.map((c) => {
    const b = el('button', { class: `pill toggle${y.sbCategories.includes(c.id) ? ' on' : ''}`, nav: true },
      el('span', { textContent: c.name }), el('span', { class: 'switch', 'aria-hidden': 'true' }));
    b.dataset.cat = c.id;
    b.addEventListener('click', async () => {
      const on = !y.sbCategories.includes(c.id);
      renderYouTube(await tv.youtubeSet({ sbCategories: on ? [...y.sbCategories, c.id] : y.sbCategories.filter((x) => x !== c.id) }));
    });
    return b;
  }));
  if (focused) $('yt-cats').querySelector(`[data-cat="${focused}"]`)?.focus();
}
for (const b of $('yt-open').children) b.addEventListener('click', async () => renderYouTube(await tv.youtubeSet({ open: b.dataset.open })));
for (const k of ['adblock', 'sponsorblock', 'dislikes', 'dearrow']) {
  $(`yt-${k}`).addEventListener('click', async () => renderYouTube(await tv.youtubeSet({ [k]: !$(`yt-${k}`).classList.contains('on') })));
}
tv.youtubeSettings().then(renderYouTube);
// (Fresh when you come into the section: VacuumTube may have been installed since.)
document.addEventListener('focusin', (e) => {
  if (screen === 'settings' && e.target.closest('.s-panel[data-tab="youtube"] .s-rail')) tv.youtubeSettings().then(renderYouTube);
});

// ------------------------------------------------------------ settings: controller buttons

const ACTIONS = [
  ['ok', 'Select'], ['back', 'Back'], ['menu', 'Open the menu'], ['esc', 'Esc (leave full screen)'],
  ['keyboard', 'Keyboard on websites'], ['playpause', 'Play / pause · type a space'], ['delete', 'Delete a letter'],
  ['lclick', 'Click'], ['rclick', 'Right-click'], ['scrollup', 'Scroll up · previous view'], ['scrolldown', 'Scroll down · next view'],
];
const actionName = Object.fromEntries(ACTIONS);
let bindings = {};

function bindNote(text, good) {
  $('bind-note').textContent = text || '';
  $('bind-note').classList.toggle('good', Boolean(good));
}

function renderBindings(b) {
  bindings = b || bindings;
  const box = $('bindings');
  const focusedAction = document.activeElement && document.activeElement.dataset.action;
  box.replaceChildren();
  for (const [action, label] of ACTIONS) {
    const row = el('button', { class: 'pill bind-row', nav: true, onclick: () => rebind(action, row) },
      el('span', { textContent: label }), el('kbd', { textContent: tvButtons.nameOf(bindings[action]) }));
    row.dataset.action = action;
    box.append(row);
  }
  if (focusedAction) box.querySelector(`[data-action="${focusedAction}"]`)?.focus();
}

async function rebind(action, row) {
  row.classList.add('listening');
  row.lastElementChild.textContent = 'Press…';
  bindNote(`Press the button you want for "${actionName[action]}".`);
  const index = await tv.captureButton();
  row.classList.remove('listening');
  if (index == null) { renderBindings(); bindNote('Nothing pressed, so nothing changed.'); return; }
  if (index >= 12 && index <= 15) { renderBindings(); bindNote('The D-pad always moves around. Pick another button.'); return; }
  const before = { ...bindings };
  const after = await tv.setBinding(action, index);
  renderBindings(after);
  const moved = ACTIONS.find(([a]) => a !== action && before[a] === index);
  bindNote(`${actionName[action]} is now ${tvButtons.nameOf(index)}.` +
    (moved ? ` ${moved[1]} moved to ${tvButtons.nameOf(after[moved[0]])}.` : ''), true);
}

$('bind-reset').addEventListener('click', async () => {
  renderBindings(await tv.resetBindings());
  bindNote('Buttons are back to the defaults.', true);
});

tv.onBindings((b) => renderBindings(b));

// ------------------------------------------------------------ settings: playback in mpv

let playback = null;

const hoursText = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
};

function renderPlayback(p) {
  if (!p) return;
  playback = p;
  $('pb-autoplay').classList.toggle('on', p.autoplay);
  $('pb-intro').classList.toggle('on', p.skipIntro);
  $('pb-credits').classList.toggle('on', p.skipCredits);
  $('pb-stop').classList.toggle('on', p.confirmStop);
  const sw = p.stillWatching;
  for (const b of $('sw-mode').children) b.classList.toggle('chosen', b.dataset.mode === sw.mode);
  $('sw-stepper').hidden = sw.mode === 'off';
  $('sw-value').textContent = sw.mode === 'episodes'
    ? `after ${sw.episodes} episode${sw.episodes === 1 ? '' : 's'} in a row`
    : `after ${hoursText(sw.minutes)} of watching`;
}

async function setPlayback(patch) {
  const s = await tv.setPlayback(patch);
  if (s) renderPlayback(s.playback);
}

$('pb-autoplay').addEventListener('click', () => setPlayback({ autoplay: !playback.autoplay }));
$('pb-intro').addEventListener('click', () => setPlayback({ skipIntro: !playback.skipIntro }));
$('pb-credits').addEventListener('click', () => setPlayback({ skipCredits: !playback.skipCredits }));
$('pb-stop').addEventListener('click', () => setPlayback({ confirmStop: !playback.confirmStop }));
for (const b of $('sw-mode').children) {
  b.addEventListener('click', () => setPlayback({ stillWatching: { mode: b.dataset.mode } }));
}

// Time steps: 15 minutes up to an hour, then half hours.
const stepMinutes = (min, dir) => {
  if (dir > 0) return min < 60 ? min + 15 : min + 30;
  return min <= 60 ? min - 15 : min - 30;
};
function stepStillWatching(dir) {
  const sw = playback.stillWatching;
  if (sw.mode === 'episodes') setPlayback({ stillWatching: { episodes: Math.min(20, Math.max(1, sw.episodes + dir)) } });
  else setPlayback({ stillWatching: { minutes: Math.min(720, Math.max(15, stepMinutes(sw.minutes, dir))) } });
}
$('sw-less').addEventListener('click', () => stepStillWatching(-1));
$('sw-more').addEventListener('click', () => stepStillWatching(1));

// ------------------------------------------------------------ settings: mpv buttons

const MPV_ACTIONS = [
  ['pause', 'Pause / play'], ['stop', 'Stop, back to the app'], ['skip', 'Skip intro / credits'],
  ['prev', 'Previous episode'], ['next', 'Next episode'], ['subs', 'Next subtitle track'], ['audio', 'Next audio track'],
  ['back10', 'Back 10 seconds'], ['fwd30', 'Ahead 30 seconds'], ['back60', 'Back 1 minute'], ['fwd60', 'Ahead 1 minute'],
  ['volup', 'Volume up'], ['voldown', 'Volume down'], ['time', 'Show the time'],
];
const mpvName = Object.fromEntries(MPV_ACTIONS);
let mpvBindings = {};

function mpvNote(text, good) {
  $('mpvb-note').textContent = text || '';
  $('mpvb-note').classList.toggle('good', Boolean(good));
}

function renderMpvBindings(b) {
  mpvBindings = b || mpvBindings;
  const box = $('mpv-bindings');
  const focused = document.activeElement && document.activeElement.dataset.mpvAction;
  box.replaceChildren();
  for (const [action, label] of MPV_ACTIONS) {
    const row = el('button', { class: 'pill bind-row', nav: true, onclick: () => rebindMpv(action, row) },
      el('span', { textContent: label }), el('kbd', { textContent: tvButtons.nameOf(mpvBindings[action]) }));
    row.dataset.mpvAction = action;
    box.append(row);
  }
  if (focused) box.querySelector(`[data-mpv-action="${focused}"]`)?.focus();
}

async function rebindMpv(action, row) {
  row.classList.add('listening');
  row.lastElementChild.textContent = 'Press…';
  mpvNote(`Press the button you want for "${mpvName[action]}" in mpv. The D-pad works here too.`);
  const index = await tv.captureButton();
  row.classList.remove('listening');
  if (index == null) { renderMpvBindings(); mpvNote('Nothing pressed, so nothing changed.'); return; }
  const before = { ...mpvBindings };
  const after = await tv.setMpvBinding(action, index);
  renderMpvBindings(after);
  const moved = MPV_ACTIONS.find(([a]) => a !== action && before[a] === index);
  mpvNote(`${mpvName[action]} is now ${tvButtons.nameOf(index)} in mpv.` +
    (moved ? ` ${moved[1]} moved to ${tvButtons.nameOf(after[moved[0]])}.` : ''), true);
}

$('mpvb-reset').addEventListener('click', async () => {
  renderMpvBindings(await tv.resetMpvBindings());
  mpvNote('mpv buttons are back to the defaults.', true);
});
tv.mpvBindings().then((b) => renderMpvBindings(b));
tv.bindings().then((b) => renderBindings(b));

// ------------------------------------------------------------ start

tick();
setInterval(tick, 10_000);
buildKeyboard();
renderHome();
refreshApps();
tv.settings().then((s) => s && renderPlayerChoice(s.jellyfinPlayer));

// ------------------------------------------------------------ setup guides: Watchmode and Trakt
//
// Step-by-step screens, like getting the TMDB key: open the right page in the app, then bring the
// key back from the page itself (menu → "Use the key on this page"), the clipboard, or a phone.

const setup = { kind: null, step: 0, found: null, phone: false, code: null, timer: null };

const KIND_NAMES = { watchmode: 'Watchmode', trakt: 'Trakt', live: 'Live TV', lastfm: 'Last.fm' };

function suNote(text, good) {
  $('su-note').textContent = text || '';
  $('su-note').classList.toggle('good', Boolean(good));
}

function suPage({ steps, title, body, actions }) {
  const total = steps[1];
  $('su-eyebrow').textContent = `Set up ${KIND_NAMES[setup.kind]} · ${total > 1 ? `step ${steps[0]} of ${total}` : 'done'}`;
  $('su-title').textContent = title;
  const bar = el('div', { class: 'su-steps' }, ...Array.from({ length: total }, (_, i) => el('span', { class: i < steps[0] ? 'done' : '' })));
  $('su-body').replaceChildren(bar);
  $('su-body').insertAdjacentHTML('beforeend', body);
  $('su-actions').replaceChildren(...actions.map(([label, fn, cls]) => el('button', { class: `pill ${cls || ''}`, nav: true, textContent: label, onclick: fn })));
  $('su-found').hidden = true;
  $('su-side').hidden = true;
  setup.phone = false;
  suNote('');
  $('su-actions').firstElementChild?.focus();
}

// (step: where to start, when not at the beginning: Last.fm's 'secret', say.)
async function openSetup(kind, step = 1) {
  if (screen !== 'setup') go('setup');
  setup.kind = kind;
  const s = await tv.settings();
  if (kind === 'trakt' && s.trakt.hasApp && !s.trakt.connected) return setupStep(3);
  setupStep(step);
}

function leaveSetup() {
  clearTimeout(setup.timer);
  if (setup.kind === 'trakt') tv.traktCancel();
  tv.phoneMode('text');
  setup.kind = null;
  refreshSettings();
}

function finishSetup() {
  // Back to Settings (where the guide was opened from).
  back();
}

// Came back from a website during setup: maybe there's a key on the clipboard now.
function setupBack() {
  if ((setup.kind === 'watchmode' || setup.kind === 'lastfm') && setup.step === 2) setupClipboard();
  if (setup.kind === 'trakt' && setup.step === 2) setupClipboard();
  if (setup.kind === 'trakt' && setup.step === 1) $('su-actions').children[1]?.focus();
}

async function setupClipboard() {
  const found = await tv.clipboardKey(setup.kind);
  setup.found = found;
  $('su-found').hidden = !found;
  if (found) {
    $('su-found-what').textContent = setup.kind === 'trakt' ? 'a Trakt Client ID' : 'a key';
    $('su-found-key').textContent = setup.kind === 'trakt' ? '' : mask(found);
    $('su-found-save').focus();
  }
  return found;
}

async function setupSave(text) {
  suNote(`Checking with ${KIND_NAMES[setup.kind]}…`);
  const r = await tv.setAnyKey(setup.kind, text);
  if (r.ok) return keySaved(setup.kind);
  suNote({
    'not-a-key': setup.kind === 'trakt' ? 'That doesn\'t look like a Client ID. Copy the code shown next to Client ID on your Trakt app.' : `That doesn't look like a ${KIND_NAMES[setup.kind]} key.`,
    'bad-key': `${KIND_NAMES[setup.kind]} didn't accept that key. Check you copied all of it.`,
    'key-first': 'That isn\'t a key Last.fm knows. If it\'s the shared secret, add the API key first, then the secret.',
    'bad-either': 'Last.fm didn\'t accept that as a key, or as the shared secret for your key. Check you copied all of it.',
    'bad-client': 'Trakt didn\'t recognise that Client ID. Check you copied all of it.',
    'quota': 'That key has used up this month\'s lookups. It works again next month.',
    'not-a-url': 'That doesn\'t look like a web address. It starts with http:// or https://.',
    'unreachable': 'Couldn\'t reach that address. Check it\'s right, and that this TV can reach it.',
    'no-channels': 'That address answered, but there were no channels in it.',
    'not-found': 'Nothing at that address. Check it\'s the playlist (M3U) address.',
    'too-big': 'That list is too big to read.',
  }[r.error] || `Couldn't reach ${KIND_NAMES[setup.kind]}. Check your internet connection and try again.`);
}

function keySaved(kind) {
  if (screen !== 'setup' || setup.kind !== kind) { refreshSettings(); return; }
  tv.phoneMode('text');
  if (kind === 'watchmode') setupStep(3);
  else setupStep(3);
}

tv.onSetupKeySaved((kind) => keySaved(kind));

$('su-found-save').addEventListener('click', () => setup.found && setupSave(setup.found));

async function setupPhone() {
  const info = await tv.phone('key', setup.kind);
  if (!info || info.error) {
    suNote('Couldn\'t find this TV on your home network. Check it\'s connected to Wi-Fi or Ethernet.');
    return;
  }
  setup.phone = true;
  $('su-qr').innerHTML = info.qr;
  $('su-side-title').textContent = 'Scan with your phone';
  $('su-code').hidden = true;
  $('su-side-help').textContent = setup.kind === 'live'
    ? 'Paste your channel list address on the page that opens. It saves by itself. Your phone and TV need to be on the same Wi-Fi.'
    : setup.kind === 'trakt'
    ? 'The page that opens links to Trakt\'s developer site. Make the app there, then paste its Client ID and tap Save. Your phone and TV need to be on the same Wi-Fi.'
    : setup.kind === 'lastfm'
    ? 'Paste your Last.fm API key and shared secret on the page that opens, one after the other. Each saves by itself. Your phone and TV need to be on the same Wi-Fi.'
    : 'Paste your Watchmode key on the page that opens and tap Save. Your phone and TV need to be on the same Wi-Fi.';
  $('su-side-url').textContent = `${info.address} · ${info.network}`;
  $('su-side').hidden = false;
  suNote(info.seen ? 'Your phone is connected. Paste it there and tap Save.' : 'Waiting for your phone…', info.seen);
}

tv.onPhoneConnected(() => {
  if (screen === 'setup' && setup.phone) suNote('Your phone is connected. Paste it there and tap Save.', true);
});

function setupStep(n) {
  setup.step = n;
  clearTimeout(setup.timer);
  if (setup.kind === 'watchmode') return watchmodeStep(n);
  if (setup.kind === 'live') return liveStep(n);
  if (setup.kind === 'lastfm') return lastfmStep(n);
  return traktStep(n);
}

// ---- Watchmode: get a key, bring it here, done.
function watchmodeStep(n) {
  if (n === 1) {
    suPage({
      steps: [1, 2],
      title: 'Get a free Watchmode key',
      body: `<p>Watchmode keeps track of where titles stream, including free services like <strong>Tubi</strong>, <strong>Pluto TV</strong> and <strong>The Roku Channel</strong>. Its free plan is for personal use and gives 2,500 lookups a month. Each title page uses one or two, and the app remembers answers for a day, so that's plenty.</p>
        <p><strong>Easiest: sign up on your phone.</strong> Scan the code, tap <strong>Get a free Watchmode key</strong>, fill in the form (choose the <strong>free</strong> plan), then copy the key, go back to the page you scanned, paste it and tap Save.</p>
        <p class="fine">Or sign up here on the TV: the form has an "I'm not a robot" box, which needs the pointer. Move it with the right stick and press R2 to click. Once the key shows, press Start and choose Use the key on this page.</p>`,
      actions: [
        ['Sign up on my phone', () => { setupStep(2); setupPhone(); }, 'primary'],
        ['Sign up here on the TV', () => tv.open('watchmode-key')],
        ['I already have a key', () => setupStep(2)],
      ],
    });
    return;
  }
  if (n === 2) {
    suPage({
      steps: [2, 2],
      title: 'Add your Watchmode key',
      body: `<p>Bring the key over whichever way is easiest:</p>
        <ol>
          <li><strong>From your phone:</strong> scan the code, paste the key, tap Save. Handy if Watchmode emailed it to you.</li>
          <li><strong>Copied it in the app?</strong> Choose <strong>Use copied key</strong>.</li>
          <li><strong>On Watchmode's page:</strong> open it, then press Start and choose <strong>Use the key on this page</strong>.</li>
        </ol>`,
      actions: [
        ['Paste it from my phone', setupPhone, 'primary'],
        ['Use copied key', async () => { const k = await setupClipboard(); if (k) setupSave(k); else suNote('There\'s no Watchmode key on the clipboard yet.'); }],
        ['Open Watchmode\'s site', () => tv.open('watchmode-key')],
      ],
    });
    setupClipboard();
    return;
  }
  suPage({
    steps: [2, 2],
    title: 'Watchmode is on',
    body: `<p>Title pages now check Watchmode as well as TMDB. Titles on your free services show up as <strong>Watch on</strong> buttons, and some open straight to the title instead of a search.</p>
      <p class="fine" id="su-usage"></p>`,
    actions: [['Done', finishSetup, 'primary']],
  });
  $('su-eyebrow').textContent = 'Set up Watchmode · done';
  tv.wmStatus().then((u) => { if (u && u.quota && $('su-usage')) $('su-usage').textContent = `${u.used ?? 0} of ${u.quota} lookups used this month.`; });
}

// ---- Last.fm: get a key (and its shared secret), bring them here, done. Step 'secret' is for
// scrobbling when the secret wasn't kept: Last.fm only shows it once, on the page right after the
// key is made, so the way back is a new key (or typing it, if it was saved somewhere).
function lastfmStep(n) {
  if (n === 1) {
    suPage({
      steps: [1, 2],
      title: 'Get a free Last.fm key',
      body: `<p>Last.fm knows which artists people listen to together, so its <strong>related artists</strong> are often better than ListenBrainz's (which the app uses until you add a key). With it you can also <strong>scrobble</strong>: add what you play to your Last.fm profile. The key is free, for personal use.</p>
        <p>Making one takes a minute: sign in to Last.fm, fill in a short form (only <strong>Application name</strong> is needed), and submit. The page that comes next shows two codes, the <strong>API key</strong> and the <strong>shared secret</strong>. <strong>Last.fm only ever shows the shared secret on that page</strong>, so bring both over before leaving it (scrobbling needs the secret).</p>
        <p><strong>Easiest: on your phone.</strong> Scan the code, tap <strong>Get a free Last.fm key</strong>, then paste the API key and the shared secret into the page you scanned, one after the other.</p>
        <p class="fine">Or do it here on the TV: once the codes show on Last.fm's page, press Start and choose Use the key on this page. Both are read off the page.</p>`,
      actions: [
        ['Do it on my phone', () => { setupStep(2); setupPhone(); }, 'primary'],
        ['Do it here on the TV', () => tv.open('lastfm-key')],
        ['I already have a key', () => setupStep(2)],
      ],
    });
    return;
  }
  if (n === 2) {
    suPage({
      steps: [2, 2],
      title: 'Add your Last.fm key',
      body: `<p>Bring the API key (and the shared secret, for scrobbling) over whichever way is easiest:</p>
        <ol>
          <li><strong>From your phone:</strong> scan the code, paste the API key, then the shared secret. Each saves by itself.</li>
          <li><strong>Copied it in the app?</strong> Choose <strong>Use copied key</strong>.</li>
          <li><strong>On Last.fm's page:</strong> open it, then press Start and choose <strong>Use the key on this page</strong>.</li>
        </ol>
        <p class="fine">Lost the shared secret? Last.fm won't show it again, but making a new key is quick and shows a new one (the old key just stops being used).</p>`,
      actions: [
        ['Paste it from my phone', setupPhone, 'primary'],
        ['Use copied key', async () => { const k = await setupClipboard(); if (k) setupSave(k); else suNote('There\'s no Last.fm key on the clipboard yet.'); }],
        ['Make a new key here on the TV', () => tv.open('lastfm-key')],
      ],
    });
    setupClipboard();
    return;
  }
  if (n === 'secret') {
    suPage({
      steps: [1, 1],
      title: 'One more code for scrobbling',
      body: `<p>Scrobbling needs your key's <strong>shared secret</strong>, and Last.fm only shows it once: on the page right after you make the key. Your API accounts page won't show it again.</p>
        <p><strong>Didn't keep it?</strong> Make a new key (only <strong>Application name</strong> is needed); this time both codes come over, and the old key just stops being used. <strong>Kept it?</strong> Choose <strong>I have the secret</strong>.</p>`,
      actions: [
        ['Make a new key on my phone', () => { setupPhone(); }, 'primary'],
        ['Make a new key here on the TV', () => tv.open('lastfm-key')],
        ['I have the secret', async () => {
          const secret = await askFor({ label: 'Your Last.fm shared secret', eyebrow: 'Set up Last.fm', hint: 'The second code Last.fm showed when you made your key (32 letters and numbers). Easiest pasted on your phone: scan the code.', placeholder: '32 letters and numbers' });
          if (!secret) return;
          setupSave(secret);
        }],
      ],
    });
    $('su-eyebrow').textContent = 'Set up Last.fm · scrobbling';
    return;
  }
  suPage({
    steps: [2, 2],
    title: 'Last.fm is on',
    body: `<p>Artist pages now get their <strong>Related artists</strong> from Last.fm.</p>
      <p id="su-lf-secret"></p>`,
    actions: [['Done', finishSetup, 'primary'], ['Sign in to scrobble', () => { finishSetup(); lastfmSignIn(); }]],
  });
  $('su-eyebrow').textContent = 'Set up Last.fm · done';
  // Scrobbling: ready to sign in, or still missing the secret.
  tv.musicSettings().then((r) => {
    const p = $('su-lf-secret');
    if (!p || !r.ok) return;
    p.innerHTML = r.ok.lastfmSecret
      ? 'Want what you play added to your Last.fm profile too? <strong>Sign in to scrobble</strong> opens Last.fm\'s page where you press Allow. (Or later, in Settings → Music → Scrobbling.)'
      : 'For <strong>scrobbling</strong>, the shared secret is still missing. If your phone is still on Last.fm\'s page, paste the secret into the page you scanned; <strong>Sign in to scrobble</strong> helps if not.';
  });
}

// ---- Trakt: account, API app, sign in with a code, done.
function traktStep(n) {
  if (n === 1) {
    suPage({
      steps: [1, 3],
      title: 'Your Trakt account',
      body: `<p>Trakt keeps track of what you watch, on any service, and suggests what to watch next. Once it's connected, Home shows your <strong>Trakt watchlist</strong> and <strong>Trakt's picks for you</strong>, and every title page gets an <strong>Add to watchlist</strong> button.</p>
        <p>A free account is all you need. If you don't have one, make it here in the app (or on your phone at trakt.tv), then come back with <strong>Start → Back to setup</strong>.</p>
        <p class="fine">Free Trakt accounts can have one connected app at a time. If Trakt is already connected to something else (a Jellyfin plugin, say), connecting this app may disconnect that one.</p>`,
      actions: [
        ['Make a free account', () => tv.open('trakt-join')],
        ['I have an account', () => setupStep(2), 'primary'],
      ],
    });
    $('su-actions').children[1].focus();
    return;
  }
  if (n === 2) {
    suPage({
      steps: [2, 3],
      title: 'Make a Trakt app for SOFA King',
      body: `<p>Trakt lets apps connect through a developer app that you make on your account. It's free and you only do it once. This is easiest on a phone or computer: scan the code, or open the page here.</p>
        <ol>
          <li>Go to <strong>developer.trakt.tv/apps</strong> and sign in to Trakt.</li>
          <li><strong>Connect GitHub.</strong> Trakt now asks for a GitHub account before you can make an app: in the <strong>Developer</strong> panel, choose to connect GitHub and sign in there. No GitHub account? Make a free one at github.com and confirm your email first.</li>
          <li>Make a <strong>new app</strong>. Name: <code>SOFA King</code>. Redirect URI: <code>urn:ietf:wg:oauth:2.0:oob</code> (if Trakt won't take it, use <code>http://localhost</code>). On the TV these are filled in for you.</li>
          <li><strong>Save</strong>, and copy the <strong>Client ID</strong>. That's all the app needs. New apps say the Client Secret is "Not issued" because they sign in with PKCE: that's fine, skip it. (Older apps that do have a secret can paste it too.)</li>
          <li>Bring the Client ID here: paste it on your phone, or on the TV press <strong>Start</strong> and choose <strong>Use the Client ID on this page</strong>.</li>
        </ol>
        <p class="fine">New apps start as Development apps, which you (the owner) can always sign in to. Already made one? Just use its Client ID.</p>`,
      actions: [
        ['Do it on my phone', setupPhone, 'primary'],
        ['Open it here on the TV', () => tv.open('trakt-apps')],
        ['Use copied Client ID', async () => { const k = await setupClipboard(); if (k) setupSave(k); else suNote('There\'s no Client ID on the clipboard yet.'); }],
      ],
    });
    setupClipboard();
    return;
  }
  if (n === 3) {
    suPage({
      steps: [3, 3],
      title: 'Sign in to Trakt',
      body: `<p>Getting a code from Trakt…</p>`,
      actions: [],
    });
    traktCode();
    return;
  }
  suPage({
    steps: [3, 3],
    title: setup.username ? `Connected as ${setup.username}` : 'Trakt is connected',
    body: `<p>Home now shows <strong>Your Trakt watchlist</strong> and <strong>Recommended for you on Trakt</strong>, and title pages have <strong>Add to watchlist</strong>. What you watch on Trakt also feeds <strong>Inspired by what you've watched</strong>.</p>
      <p class="fine">In Settings → Trakt you can turn the rows off, or have the app tell Trakt what you watch in mpv.</p>`,
    actions: [['Done', finishSetup, 'primary']],
  });
  $('su-eyebrow').textContent = 'Set up Trakt · done';
  loadRows();
}

async function traktCode() {
  const r = await tv.traktStart();
  if (screen !== 'setup' || setup.kind !== 'trakt' || setup.step !== 3) return;
  if (r.error) {
    $('su-body').lastElementChild.textContent = r.error === 'bad-client'
      ? 'Trakt didn\'t recognise the saved Client ID. Add it again.'
      : 'Couldn\'t reach Trakt. Check your internet connection and try again.';
    $('su-actions').replaceChildren(
      el('button', { class: 'pill primary', nav: true, textContent: 'Try again', onclick: () => setupStep(3) }),
      el('button', { class: 'pill', nav: true, textContent: 'Add the Client ID again', onclick: () => setupStep(2) }),
    );
    $('su-actions').firstElementChild.focus();
    return;
  }
  const c = r.ok;
  const site = c.url.replace(/^https?:\/\//, '');
  $('su-body').lastElementChild.outerHTML = `<div>
    <p>On your phone or computer, go to <strong>${site}</strong> (or scan the code), sign in to Trakt, and enter the code shown. This screen moves on by itself.</p>
    <p class="fine">Signed in to Trakt here in the app already? Choose <strong>Enter it here</strong> and the code is filled in for you.</p></div>`;
  $('su-qr').innerHTML = c.qr;
  $('su-side-title').textContent = 'Your code';
  $('su-code').textContent = c.userCode;
  $('su-code').hidden = false;
  $('su-side-help').textContent = `Enter it at ${site}`;
  $('su-side-url').textContent = '';
  $('su-side').hidden = false;
  $('su-actions').replaceChildren(
    el('button', { class: 'pill primary', nav: true, textContent: 'Enter it here on the TV', onclick: () => tv.traktActivateHere() }),
    el('button', { class: 'pill', nav: true, textContent: 'Get a new code', onclick: () => setupStep(3) }),
  );
  $('su-actions').firstElementChild.focus();
  const until = Date.now() + c.expiresIn * 1000;
  const countdown = () => {
    if (screen !== 'setup' || setup.step !== 3) return;
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    suNote(left ? `Waiting for the code… (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left)` : 'That code ran out. Get a new one.');
    if (left) setup.timer = setTimeout(countdown, 1000);
  };
  countdown();
}

tv.onTraktSignIn((r) => {
  if (screen !== 'setup' || setup.kind !== 'trakt') { refreshSettings(); loadRows(); return; }
  if (r.ok) { setup.username = r.username; setupStep(4); return; }
  clearTimeout(setup.timer);
  if (r.error === 'bad-secret') { setupStep(2); suNote('Trakt didn\'t accept the Client Secret. Paste just the Client ID this time.'); return; }
  suNote(r.error === 'denied' ? 'The sign-in was declined on Trakt. Get a new code to try again.' : 'That code ran out. Get a new one.');
});

// ------------------------------------------------------------ Live TV

const live = { state: null, group: null, timer: null };
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// The Live tab: the first screenful of channels straight away, the rest in pieces in the background,
// so the screen (and moving around it) never waits for a long guide.
async function getLiveState() {
  const st = await tv.liveState(true);
  if (!st || st.total == null) return st;
  const all = st.channels.slice();
  for (let from = all.length; from < st.total;) {
    await new Promise((r) => setTimeout(r, 0)); // let the screen respond between pieces
    const page = await tv.livePage(st.version, from, 400);
    if (!page || page.stale) return null; // changed meanwhile: a fresh one is on its way
    all.push(...page.channels);
    from += page.channels.length;
    if (!page.channels.length) break;
  }
  return { ...st, channels: all, partial: false };
}
// Live is drawn once and kept: coming back to it shows it as it was, straight away. Nothing is
// fetched or drawn until you've stopped on it for a moment, so flicking through the tabs (L1 / R1)
// never waits for it; and a long guide still being drawn pauses while you're elsewhere.
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function showLive(focus) {
  const visit = (live.visit = (live.visit || 0) + 1);
  const here = () => view === 'live' && screen === 'home' && visit === live.visit;
  const onTabs = () => !document.activeElement || document.activeElement === document.body || $('tabs').contains(document.activeElement);
  const drawn = Boolean(live.state && $('live-list').children.length);
  if (focus) $('tabs').querySelector('.tab.chosen')?.focus({ preventScroll: true });
  if (drawn) {
    await settle(250);
    if (!here()) return;
    if (focus && onTabs()) {
      const back = live.lastId && $('live-list').querySelector(`.live-row[data-id="${CSS.escape(live.lastId)}"] .live-ch`);
      (back || $('live-list').querySelector('.live-ch') || $('live-groups').querySelector('.chosen'))?.focus();
    }
    if (live.resume) live.resume(); // finish drawing a long guide
    await settle(400);
    if (!here()) return;
    const st = await getLiveState();
    if (st && here()) renderLive(st, { keep: true });
  } else {
    await settle(180);
    if (!here()) return;
    // First screenful
    const first = await tv.liveState(true);
    if (!here() || !first) return;
    renderLive({ ...first, partial: first.total > first.channels.length }, { focus: focus && onTabs() });
    // Then everything, quietly
    if (first.total > first.channels.length) {
      const st = await getLiveState();
      if (st && view === 'live') renderLive(st, { keep: true });
    }
  }
  clearInterval(live.timer);
  // Keep "what's on now" current.
  live.timer = setInterval(() => { if (view === 'live' && screen === 'home') getLiveState().then((s) => s && renderLive(s, { keep: true })); }, 60000);
}
// (Where you were in the guide, for coming back.)
document.addEventListener('focusin', (e) => {
  const row = e.target.closest && e.target.closest('#live-list .live-row');
  if (row) live.lastId = row.dataset.id;
});

tv.onLiveChanged(() => {
  if (view === 'live' && screen === 'home') getLiveState().then((s) => s && renderLive(s, { keep: true }));
  if (screen === 'settings') renderLiveSettings();
});

function liveGroups(st) {
  const groups = [];
  // (While the rest of the channels are still arriving, the counts come from the app.)
  if (st.favorites > 0 || st.channels.some((c) => c.favorite)) groups.push({ id: 'fav', name: '★ Favourites' });
  groups.push({ id: 'all', name: `All (${st.total != null ? st.total : st.channels.length})` });
  const counts = new Map(st.groupCounts || []);
  if (!st.groupCounts) for (const c of st.channels) if (c.group) counts.set(c.group, (counts.get(c.group) || 0) + 1);
  for (const [g] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30)) groups.push({ id: `g:${g}`, name: g });
  return groups;
}

const inGroup = (c, g) => (g === 'fav' ? c.favorite : g === 'all' ? true : c.group === g.slice(2));

function renderLive(st, { focus = false, keep = false } = {}) {
  if (!st) return;
  live.state = st;
  const offering = renderOffer(st);
  const none = !st.channels.length;
  // First time, nothing yet: the loading animation (you can still move around the rest of the app).
  const loading = none && st.refreshing && !offering;
  $('live-loading').hidden = !loading;
  if (loading && !$('live-ghosts').children.length) {
    const line = (w) => el('span', { class: 'skeleton-line', style: { width: w } });
    $('live-ghosts').replaceChildren(...Array.from({ length: 6 }, (_, i) => el('div', { class: 'live-ghost', style: { 'animation-delay': `${i * 90}ms` } },
      el('span', { class: 'skeleton-line logo' }), line(`${30 + ((i * 17) % 25)}%`), line(`${20 + ((i * 29) % 30)}%`))));
  }
  $('live-empty').hidden = !none || loading;
  $('live-body').hidden = none;
  $('view-live').querySelector('.live-bar').hidden = none;
  if (loading) { if (focus) $('tabs').querySelector('.tab.chosen')?.focus(); return; }
  if (none) {
    $('live-empty').hidden = none && offering && !st.refreshing;
    $('live-empty-text').textContent = st.refreshing ? 'Loading channels…'
      : st.sources.length ? 'No channels yet. Your channel lists or Jellyfin servers didn\'t return any. Check them in Settings → Live TV.'
        : 'Add an IPTV channel list (FastChannels, for one) to watch live channels here, with a guide.'
          + (st.jellyfinServers ? ' Your Jellyfin servers\' Live TV shows up here too, once it\'s set up on the server.' : '');
    if (focus) (offering ? $('lo-yes') : $('live-setup')).focus();
    return;
  }
  const groups = liveGroups(st);
  if (!groups.some((g) => g.id === live.group)) live.group = groups[0].id;
  const focusedId = document.activeElement && document.activeElement.closest('.live-row')?.dataset.id;
  const onFav = document.activeElement && document.activeElement.classList.contains('live-fav');
  const groupFocused = $('live-groups').contains(document.activeElement);

  $('live-groups').replaceChildren(...groups.map((g) => {
    const b = el('button', { class: `pill${g.id === live.group ? ' chosen' : ''}`, nav: true, textContent: g.name });
    b.addEventListener('click', () => { live.group = g.id; renderLive(live.state); $('live-groups').querySelector('.chosen')?.focus(); });
    return b;
  }));
  const updated = st.updatedAt ? `Updated ${timeOf(st.updatedAt)}` : '';
  $('live-meta').classList.toggle('busy', Boolean(st.refreshing));
  const bits = [st.refreshing ? 'Checking for changes…' : updated];
  if (st.checking) bits.push('checking channels…');
  if (st.hideBroken && st.hidden) bits.push(`${st.hidden} not working (hidden)`);
  $('live-meta').textContent = bits.filter(Boolean).join(' · ');

  const list = $('live-list');
  const scroll = list.scrollTop;
  const shown = st.channels.filter((c) => inGroup(c, live.group));
  // Nothing you'd see has changed (a refresh with no news, a minute ticking by in the same
  // programmes): leave the guide as it is rather than redrawing it.
  const minute = Math.floor(Date.now() / 60000);
  const parts = shown.map((c) => `${c.id}:${c.favorite ? 1 : 0}:${c.quality || ''}:${liveNowKey(c)}`);
  const sig = `${live.group}|${shown.length}|${parts.join(',')}`;
  if (keep && sig === live.sig && list.children.length) {
    if (minute !== live.sigMinute) { live.sigMinute = minute; liveProgress(); }
    return;
  }
  // Long guides are drawn in batches, so the app keeps responding while it fills in.
  const seq = (live.drawSeq = (live.drawSeq || 0) + 1);
  // (Small batches, each well under a frame's worth of work, with a breather between them.)
  const more = (from) => {
    live.resume = null;
    if (seq !== live.drawSeq || from >= shown.length) return;
    // Elsewhere now? Carry on when you're back.
    if (view !== 'live' || screen !== 'home') { live.resume = () => more(from); return; }
    list.append(...shown.slice(from, from + 40).map((c) => liveRow(c, shown)));
    setTimeout(() => more(from + 40), 16);
  };
  // The rest of a guide arriving after its first screenful: if what's drawn hasn't changed,
  // just add the rest after it (nothing redrawn, nothing moves).
  const had = live.sigParts || [];
  const prefix = keep && live.sigGroup === live.group && had.length && had.length <= parts.length && list.children.length === had.length
    && had.every((x, i) => x === parts[i]);
  live.sig = sig;
  live.sigParts = parts;
  live.sigGroup = live.group;
  live.sigMinute = minute;
  if (prefix) { setTimeout(() => more(had.length), 0); return; }
  const focusAt = focusedId ? shown.findIndex((c) => c.id === focusedId) : -1;
  const first = Math.max(60, Math.ceil((scroll + list.clientHeight * 2) / 64), focusAt + 20);
  list.replaceChildren(...shown.slice(0, first).map((c) => liveRow(c, shown)));
  setTimeout(() => more(first), 0);
  list.scrollTop = scroll;
  if (keep && focusedId) {
    const row = list.querySelector(`.live-row[data-id="${CSS.escape(focusedId)}"]`);
    if (row) (onFav ? row.querySelector('.live-fav') : row.querySelector('.live-ch')).focus();
  } else if (keep && groupFocused) {
    $('live-groups').querySelector('.chosen')?.focus();
  }
  if (focus) ((offering && $('lo-yes')) || list.querySelector('.live-ch') || $('live-groups').firstElementChild)?.focus();
  if (!list.contains(document.activeElement)) liveInfo(shown[0]);
}

// What's on now, per channel: a change means that row needs redrawing.
function liveNowKey(c) {
  const now = Date.now();
  const on = c.programmes.find((p) => p.start <= now && p.stop > now);
  const next = on && c.programmes.find((p) => p.start >= on.stop - 1000);
  return on ? `${on.start}|${on.title}|${next ? `${next.start}|${next.title}` : ''}` : '-';
}

// Up and down in the guide go straight to the row above or below (a guide can have thousands of
// channels, too many to measure on every press).
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || view !== 'live' || screen !== 'home') return;
  const btn = document.activeElement;
  const row = btn && btn.closest('#live-list .live-row');
  if (!row) return;
  const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
  if (!next) return; // the top or bottom: the usual way (up to the categories)
  e.preventDefault(); e.stopImmediatePropagation();
  const target = next.querySelector(btn.classList.contains('live-fav') ? '.live-fav' : '.live-ch');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
  if (window.tvSound) window.tvSound('move');
}, true);
// Move the "how far through" bars along without redrawing anything.
function liveProgress() {
  const now = Date.now();
  for (const bar of $('live-list').querySelectorAll('.track i[data-start]')) {
    const s = Number(bar.dataset.start); const e = Number(bar.dataset.stop);
    bar.style.width = `${Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100))}%`;
  }
}

function liveRow(c, shown) {
  const now = Date.now();
  const on = c.programmes.find((p) => p.start <= now && p.stop > now);
  const next = c.programmes.find((p) => p.start >= (on ? on.stop - 1000 : now));
  const logo = el('span', { class: 'logo' });
  if (c.logo) {
    const img = el('img', { alt: '', loading: 'lazy', src: c.logo });
    img.addEventListener('error', () => img.replaceWith(el('span', { textContent: initials(c.name) })));
    logo.append(img);
  } else logo.append(el('span', { textContent: initials(c.name) }));
  const nowBox = el('span', { class: 'on' });
  if (on) {
    const pct = Math.max(0, Math.min(100, ((now - on.start) / (on.stop - on.start)) * 100));
    const bar = el('i', { style: { width: `${pct}%` } });
    bar.dataset.start = on.start; bar.dataset.stop = on.stop;
    nowBox.append(el('b', { textContent: on.title || c.name }), el('span', { class: 'track' }, bar),
      el('small', { textContent: `until ${timeOf(on.stop)}` }));
  } else nowBox.append(el('small', { textContent: 'No guide for this channel' }));
  const ch = el('button', {
    class: 'live-ch', nav: true,
    onclick: () => playLive(shown, c),
  },
  el('span', { class: 'num', textContent: c.number || '' }),
  logo,
  el('span', {}, el('span', { class: 'ch-name' }, document.createTextNode(c.name), ...(c.quality ? [el('em', { class: 'q', textContent: c.quality === 'Full HD' ? 'FHD' : c.quality })] : [])),
    el('span', { class: 'ch-from', textContent: c.sources.join(' · ') })),
  nowBox,
  el('span', { class: 'next', textContent: next ? `${timeOf(next.start)}  ${next.title}` : '' }));
  ch.addEventListener('focus', () => liveInfo(c));
  const fav = el('button', { class: `live-fav${c.favorite ? ' on' : ''}`, nav: true, textContent: c.favorite ? '★' : '☆', title: c.favorite ? 'Remove from favourites' : 'Add to favourites' });
  fav.addEventListener('click', async () => {
    const st = await tv.liveFavorite(c.id, !c.favorite);
    toast(!c.favorite ? `Added ${c.name} to your favourites.` : `Took ${c.name} out of your favourites.`, 3000);
    renderLive(st, { keep: true });
  });
  fav.addEventListener('focus', () => liveInfo(c));
  const row = el('div', { class: 'live-row' }, ch, fav);
  row.dataset.row = '';
  row.dataset.id = c.id;
  return row;
}

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase();

function liveInfo(c) {
  const box = $('live-info');
  if (!c) { box.replaceChildren(); return; }
  const now = Date.now();
  const on = c.programmes.find((p) => p.start <= now && p.stop > now);
  const later = c.programmes.filter((p) => p.start >= (on ? on.stop - 1000 : now)).slice(0, 5);
  const parts = [];
  if (c.logo) {
    const img = el('img', { class: 'li-logo', alt: '', src: c.logo });
    img.addEventListener('error', () => img.remove());
    parts.push(img);
  }
  parts.push(el('h3', { textContent: `${c.number ? `${c.number} · ` : ''}${c.name}` }));
  // Every copy, in the order they're tried.
  const copies = (c.copies || []).map((x) => `${x.from}${x.quality ? ` (${x.quality})` : ''}`);
  parts.push(el('p', { class: 'li-from', textContent: copies.length > 1 ? `${copies.length} copies, tried in this order: ${copies.join(', ')}` : `From ${copies[0] || c.sources[0] || ''}` }));
  if (on) {
    parts.push(el('p', { class: 'li-now', textContent: on.title + (on.sub ? ` · ${on.sub}` : '') }));
    parts.push(el('p', { class: 'li-time', textContent: `Now · ${timeOf(on.start)} – ${timeOf(on.stop)}` }));
    if (on.desc) parts.push(el('p', { class: 'li-desc', textContent: on.desc }));
  }
  if (later.length) parts.push(el('ol', {}, ...later.map((p) => el('li', {}, el('time', { textContent: timeOf(p.start) }), el('span', { textContent: p.title })))));
  box.replaceChildren(...parts);
}

async function playLive(shown, c) {
  toast(`Tuning in to ${c.name}…`, 4000);
  const r = await tv.livePlay(shown.map((x) => x.id), c.id);
  if (r.error) {
    toast(r.error === 'no-mpv' ? 'Live TV plays in mpv. Install mpv (see Settings → Apps), then try again.'
      : r.error === 'busy' ? 'Something is already playing.' : 'Couldn\'t start that channel.', 6000);
  }
}

tv.onLivePlayed(({ error }) => {
  if (error) toast(error === 'mpv-failed' ? 'mpv quit straight away. The log (Settings → Developer) has what it said.' : 'mpv didn\'t start. Check it\'s installed (Settings → Apps).', 6000);
  else toast('');
  if (view === 'live') getLiveState().then((s) => s && renderLive(s, { keep: true }));
});

$('live-setup').addEventListener('click', () => openSetup('live'));

// ---- Settings → Live TV

const KIND_LABEL = { jellyfin: 'Jellyfin Live TV', list: 'Channel list' };

async function renderLiveSettings() {
  const st = await tv.liveState(true);
  if (!st) return;
  const focusedId = document.activeElement && document.activeElement.closest('[data-src]')?.dataset.src;
  const focusedAct = document.activeElement && document.activeElement.dataset.act;
  $('live-jf').classList.toggle('on', st.useJellyfin);
  $('live-hide').classList.toggle('on', st.hideBroken);
  $('live-quality').classList.toggle('on', st.preferQuality);
  $('live-hide-note').textContent = `Channels from channel lists are checked in the background every so often (and whenever one fails to play). Ones that don't open are hidden from the guide.${st.hideBroken && st.hidden ? ` ${st.hidden} hidden right now.` : ''}${st.checking ? ' Checking now…' : ''}`;
  $('iptv-chosen').textContent = st.iptvOrg.chosen.length ? `Added: ${st.iptvOrg.chosen.map((c) => c.name).join(', ')}` : 'None added yet.';
  const box = $('live-sources');
  box.replaceChildren(...st.sources.map((s, i) => {
    const bits = [KIND_LABEL[s.kind]];
    if (s.error) bits.push(s.error === 'unauthorized' ? 'needs signing in again' : 'couldn\'t reach it');
    else if (s.count != null) bits.push(`${s.count} channel${s.count === 1 ? '' : 's'}`, s.count ? (s.guide ? 'with guide' : 'no guide') : '');
    if (s.kind === 'jellyfin' && !s.error && s.count === 0) bits.push('(no Live TV set up on this server)');
    const row = el('div', { class: 'live-src' },
      el('span', { class: 'rank', textContent: String(i + 1) }),
      el('span', { class: 'what' }, el('b', { textContent: s.name }), el('small', { class: s.error ? 'bad' : '', textContent: bits.filter(Boolean).join(' · ') })));
    const btn = (label, act, fn, hidden) => {
      if (hidden) return null;
      const b = el('button', { class: 'pill', nav: true, textContent: label, onclick: fn });
      b.dataset.act = act;
      return b;
    };
    const parts = [
      btn('↑', 'up', async () => { await tv.liveMove(s.id, -1); renderLiveSettings(); }, i === 0),
      btn('↓', 'down', async () => { await tv.liveMove(s.id, 1); renderLiveSettings(); }, i === st.sources.length - 1),
      btn('Remove', 'remove', async () => { await tv.liveRemove(s.id); renderLiveSettings(); $('live-add').focus(); }, s.kind !== 'list'),
    ].filter(Boolean);
    row.append(...parts);
    row.dataset.src = s.id;
    row.dataset.row = '';
    return row;
  }));
  if (!st.sources.length) box.append(el('p', { class: 'fine', textContent: 'No channel lists yet.' }));
  if (focusedId) {
    const row = box.querySelector(`[data-src="${CSS.escape(focusedId)}"]`);
    (row && (row.querySelector(`[data-act="${focusedAct}"]`) || row.querySelector('.pill')))?.focus();
  }
  // Possible duplicates
  $('live-dupes').hidden = !st.possible.length;
  $('live-dupes-title').textContent = `Possible duplicates (${st.possible.length})`;
  $('live-dupes-list').replaceChildren(...st.possible.map(({ a, b }) => {
    const label = (x) => `${x.number ? `${x.number} · ` : ''}${x.name}`;
    const result = el('small', { class: 'dupe-check' });
    const same = el('button', { class: 'pill', nav: true, textContent: 'Same channel', onclick: async () => { await tv.livePair(a.id, b.id, true); renderLiveSettings(); } });
    const diff = el('button', { class: 'pill', nav: true, textContent: 'Different', onclick: async () => { await tv.livePair(a.id, b.id, false); renderLiveSettings(); } });
    const check = el('button', { class: 'pill', nav: true, textContent: 'Check' });
    check.addEventListener('click', async () => {
      check.disabled = true;
      check.textContent = 'Checking…';
      result.textContent = 'Watching both for about 40 seconds…';
      const r = await tv.liveCheckPair(a.id, b.id);
      check.disabled = false;
      check.textContent = 'Check again';
      result.textContent = checkText(r, a, b);
      // Put you on the answer it suggests.
      if (r && r.ok && r.ok.verdict === 'same') same.focus();
      else if (r && r.ok && r.ok.verdict === 'different') diff.focus();
    });
    const row = el('div', { class: 'live-dupe' },
      el('span', { class: 'what' }, document.createTextNode(`${label(a)}  ·  ${label(b)}`), el('br'),
        el('small', { textContent: `${a.sources.join(', ')}  and  ${b.sources.join(', ')}` }), el('br'), result),
      check, same, diff);
    row.dataset.row = '';
    return row;
  }));
}

$('live-add').addEventListener('click', () => openSetup('live'));
$('live-refresh').addEventListener('click', async () => {
  $('live-refresh').textContent = 'Refreshing…';
  await tv.liveRefresh();
  $('live-refresh').textContent = 'Refresh channels';
  renderLiveSettings();
});
$('live-jf').addEventListener('click', async () => {
  await tv.liveUseJellyfin(!$('live-jf').classList.contains('on'));
  renderLiveSettings();
});

// ---- the setup guide: add a channel list

function liveStep(n) {
  if (n === 1) {
    suPage({
      steps: [1, 2],
      title: 'Add a live TV channel list',
      body: `<p>Live TV plays channels from an <strong>IPTV channel list</strong> (an M3U playlist), with a TV guide if the list has one. Paste the list's address, and the guide's address if it's separate.</p>
        <p><strong>FastChannels?</strong> Just its address, like <code>http://192.168.1.10:5523</code>. The app finds the playlist and the guide for you.</p>
        <p class="fine">Live TV set up on your Jellyfin servers is added automatically. If the same channel is in several places, it shows once, and plays from the first place that has it (you can change the order in Settings → Live TV).</p>`,
      actions: [
        ['Paste it from my phone', setupPhone, 'primary'],
        ['Type the address', async () => {
          const value = await askFor({ eyebrow: 'Live TV', label: 'Channel list address', hint: 'FastChannels: http:// and its address, then :5523', placeholder: 'http://', value: 'http://' });
          if (screen !== 'setup') return;
          if (value) setupSave(value);
        }],
      ],
    });
    return;
  }
  suPage({ steps: [2, 2], title: 'Channels added', body: '<p id="su-live-count">Loading your channels…</p>', actions: [
    ['Watch live TV', () => { while (screen !== 'home' && back()) { /* back out to Home */ } setView('live'); }, 'primary'],
    ['Done', finishSetup],
  ] });
  $('su-eyebrow').textContent = 'Set up Live TV · done';
  const fill = async () => {
    const st = await tv.liveState(true);
    const p = $('su-live-count');
    if (!p || !st) return;
    if (st.refreshing) { setTimeout(fill, 800); return; }
    const lists = st.sources.filter((s) => s.kind === 'list');
    const last = lists[lists.length - 1];
    p.textContent = `${st.total != null ? st.total : st.channels.length} channels ready${last ? `, from ${last.name}${last.guide ? ', with a guide' : ''}` : ''}${st.sources.length > 1 ? ' and your other sources' : ''}.`;
  };
  setTimeout(fill, 400);
}

// ---- iptv-org: the first-time offer on the Live tab, and the picker

let iptvMetaCache = null;
async function iptvMeta() {
  if (iptvMetaCache) return iptvMetaCache;
  const r = await tv.iptvMeta();
  if (r && r.ok) iptvMetaCache = r.ok;
  return iptvMetaCache;
}

// Once: "Start with live channels from <your country>?" (from the time zone, or the system language).
function renderOffer(st) {
  const show = !st.iptvOrg.asked && Boolean(st.iptvOrg.country);
  $('live-offer').hidden = !show;
  if (!show) return false;
  const code = st.iptvOrg.country;
  const fill = (country) => {
    const name = country ? country.name : code.toUpperCase();
    $('lo-title').textContent = `Start with live channels from ${country && country.flag ? `${country.flag} ` : ''}${name}?`;
    $('lo-text').textContent = `iptv-org, a free, community-run collection of public live streams, has channels from ${name}. Add them now? You can add other countries, languages and categories any time in Settings → Live TV.`;
    $('lo-yes').textContent = `Yes, add ${name}`;
    $('lo-yes').onclick = async () => {
      $('lo-yes').textContent = 'Adding…';
      const next = await tv.iptvSet('country', code, true, name);
      toast(`Added ${name} from iptv-org. Loading the channels…`, 5000);
      renderLive(next, { focus: true });
    };
  };
  fill(null);
  iptvMeta().then((m) => { if (m) fill(m.countries.find((c) => c.code === code)); });
  return true;
}

$('lo-pick').addEventListener('click', () => openIptvPicker('countries'));
$('lo-no').addEventListener('click', async () => {
  renderLive(await tv.iptvAsked(), { focus: true });
  toast('OK. iptv-org is in Settings → Live TV whenever you want it.', 5000);
});

const iptv = { tab: 'countries' };

async function openIptvPicker(tab = 'countries') {
  if (screen !== 'iptv') go('iptv');
  iptv.tab = tab;
  for (const b of $('iptv-tabs').children) b.classList.toggle('chosen', b.dataset.tab === tab);
  $('iptv-grid').replaceChildren(el('p', { class: 'fine', textContent: 'Loading iptv-org’s lists…' }));
  iptvMetaCache = null; // fresh ticks
  const m = await iptvMeta();
  if (screen !== 'iptv') return;
  if (!m) { $('iptv-grid').replaceChildren(el('p', { class: 'fine', textContent: 'Couldn’t reach iptv-org. Check your internet connection and try again.' })); return; }
  let list = m[tab];
  if (tab === 'countries' && m.country) {
    // Where you are, first.
    const here = list.find((c) => c.code === m.country);
    if (here) list = [here, ...list.filter((c) => c !== here)];
  }
  const type = { countries: 'country', languages: 'language', categories: 'category' }[tab];
  $('iptv-grid').replaceChildren(...list.map((x) => {
    const tick = el('span', { class: 'tick', textContent: x.on ? '✓' : '' });
    const b = el('button', { class: `pill${x.on ? ' on' : ''}`, nav: true },
      ...(x.flag ? [el('span', { class: 'flag', textContent: x.flag })] : []),
      el('span', { textContent: x.name + (tab === 'countries' && x.code === m.country ? ' (here)' : '') }), tick);
    b.addEventListener('click', async () => {
      x.on = !x.on;
      b.classList.toggle('on', x.on);
      tick.textContent = x.on ? '✓' : '';
      await tv.iptvSet(type, x.code, x.on, x.name);
      toast(x.on ? `Added ${x.name}. Loading its channels…` : `Removed ${x.name}.`, 3000);
    });
    return b;
  }));
  $('iptv-grid').querySelector('.pill')?.focus();
}

for (const b of $('iptv-tabs').children) b.addEventListener('click', () => openIptvPicker(b.dataset.tab));
$('iptv-open').addEventListener('click', () => openIptvPicker('countries'));
$('live-hide').addEventListener('click', async () => {
  await tv.liveHideBroken(!$('live-hide').classList.contains('on'));
  renderLiveSettings();
});

// ------------------------------------------------------------ Settings tabs (L1 / R1)
//
// The settings page is one long list of sections in the HTML; here it's split into tabs.

const SETTINGS_TABS = [
  { id: 'general', name: 'General', sections: ['Search', 'More free services', 'Trakt'] },
  { id: 'look', name: 'Look', sections: ['Look', 'Advanced theming'] },
  { id: 'live', name: 'Live TV', sections: ['Live TV'] },
  { id: 'jellyfin', name: 'Servers', sections: ['Jellyfin', 'Plex'] },
  { id: 'music', name: 'Music', sections: ['Music'] },
  { id: 'youtube', name: 'YouTube', sections: ['YouTube'] },
  { id: 'apps', name: 'Apps', sections: ['Apps'] },
  { id: 'controller', name: 'Controller', sections: ['Controller'] },
  { id: 'developer', name: 'Developer', sections: ['Developer'] },
];
let settingsTab = 'general';

// Settings: tabs along the top (L1 / R1), and in each tab a menu of its sections down the left.
// One section shows at a time, so nothing jumps around as you move; long lists of options scroll
// inside their own box. Built here from the sections as they're written in home.html: a section
// starts at a heading, or at anything marked data-group="Its name".
const settingsGroup = {}; // tab -> the section showing in it
(function buildSettingsTabs() {
  const box = document.querySelector('#screen-settings .settings');
  const h1 = box.querySelector('h1');
  const bar = el('nav', { class: 'tabs s-tabs' });
  bar.append(el('kbd', { class: 'tab-key' }));
  bar.lastChild.dataset.bind = 'scrollup';
  const panels = {};
  for (const t of SETTINGS_TABS) {
    const b = el('button', { class: 'tab', nav: true, textContent: t.name, onclick: () => setSettingsTab(t.id) });
    b.dataset.tab = t.id;
    bar.append(b);
    panels[t.id] = el('div', { class: 's-panel' });
    panels[t.id].dataset.tab = t.id;
  }
  const end = el('kbd', { class: 'tab-key' });
  end.dataset.bind = 'scrolldown';
  bar.append(end);
  // Move each section (a heading and everything up to the next heading) into its tab.
  let into = panels.general;
  const byTab = {};
  for (const node of [...box.children].slice([...box.children].indexOf(h1) + 1)) {
    if (node.matches('h2.section-title')) {
      const t = SETTINGS_TABS.find((x) => x.sections.includes(node.textContent.trim()));
      into = t ? panels[t.id] : into;
    }
    (byTab[into.dataset.tab] = byTab[into.dataset.tab] || []).push(node);
  }
  // Then split each tab into its sections, with the menu down the left.
  for (const t of SETTINGS_TABS) {
    const nodes = byTab[t.id] || [];
    const groups = [];
    for (const node of nodes) {
      const starts = node.matches('h2.section-title, h3.sub-title') || node.hasAttribute('data-group');
      if (starts || !groups.length) {
        const name = node.dataset.group || node.textContent.trim();
        const g = el('section', { class: 's-group' });
        g.dataset.name = name;
        g.dataset.zone = '';
        if (node.matches('h2, h3')) { node.classList.add('group-title'); node.textContent = name; g.append(node); } else { g.append(el('h2', { class: 'group-title', textContent: name }), node); }
        groups.push(g);
      } else groups[groups.length - 1].append(node);
    }
    // A heading with nothing under it (like the tab's own name) isn't a section.
    const real = groups.filter((g) => g.children.length > 1 || !g.firstElementChild.matches('.group-title'));
    const rail = el('nav', { class: 's-rail' });
    rail.dataset.zone = 'column'; // up and down stay in the menu; right goes into the section
    for (const g of real) {
      const b = el('button', { class: 'rail-item', nav: true, textContent: g.dataset.name, onclick: () => focusGroupContent(g) });
      b.dataset.group = g.dataset.name;
      b.addEventListener('focus', () => showSettingsGroup(g));
      rail.append(b);
    }
    const body = el('div', { class: 's-groups' }, ...real);
    panels[t.id].append(rail, body);
    panels[t.id].classList.toggle('single', real.length < 2);
    // A tab with only one section has no menu beside it: up from the top goes to the tabs.
    if (real.length < 2) for (const g of real) delete g.dataset.zone;
    if (real[0]) showSettingsGroup(real[0], { quiet: true });
  }
  h1.after(bar, ...Object.values(panels));
  if (window.tvButtons) tv.bindings().then(window.tvButtons.label);
})();

// Show one section of a tab (its menu item marked), at its top.
function showSettingsGroup(g, { quiet = false } = {}) {
  const panel = g.closest('.s-panel');
  for (const x of panel.querySelectorAll('.s-group')) x.classList.toggle('on', x === g);
  for (const b of panel.querySelectorAll('.rail-item')) b.classList.toggle('chosen', b.dataset.group === g.dataset.name);
  if (settingsGroup[panel.dataset.tab] !== g.dataset.name) g.scrollTop = 0;
  settingsGroup[panel.dataset.tab] = g.dataset.name;
  if (!quiet) rememberSettingsPlace();
  if (typeof updatePreview === 'function') updatePreview();
}
// Into a section's options: where you were in it last, or its first option.
function focusGroupContent(g) {
  const last = g.lastFocus && g.lastFocus.isConnected && g.lastFocus.offsetParent ? g.lastFocus : null;
  const first = last || [...g.querySelectorAll('[data-nav]')].find((x) => x.offsetParent && !x.disabled);
  if (first) first.focus();
}
const currentGroup = () => document.querySelector(`#screen-settings .s-panel[data-tab="${settingsTab}"] .s-group.on`);

// Anything in Settings that's focused from code (after saving a key, say) opens its tab and
// section first, so it can be seen.
const realFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function focusShowingSettings(opts) {
  const g = this.closest && this.closest('#screen-settings .s-group');
  if (g) {
    const panel = g.closest('.s-panel');
    if (panel.hidden) setSettingsTab(panel.dataset.tab, { focus: false });
    if (!g.classList.contains('on')) showSettingsGroup(g);
  }
  return realFocus.call(this, opts);
};

document.addEventListener('focusin', (e) => {
  if (screen !== 'settings') return;
  const t = e.target;
  // Coming into the menu from elsewhere lands on the section you're in.
  const item = t.closest && t.closest('.s-rail .rail-item');
  if (item && !item.classList.contains('chosen') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.s-rail'))) {
    const chosen = item.closest('.s-rail').querySelector('.chosen');
    if (chosen) { chosen.focus(); return; }
  }
  const g = t.closest && t.closest('.s-group');
  if (g) g.lastFocus = t;
  rememberSettingsPlace();
});

// In the menu, Right goes into the section; in a section, Left from its left edge goes back to the menu.
document.addEventListener('keydown', (e) => {
  if (screen !== 'settings') return;
  const a = document.activeElement;
  if (e.key === 'ArrowRight' && a && a.matches('.s-rail .rail-item')) {
    e.preventDefault(); e.stopImmediatePropagation();
    const g = currentGroup();
    if (g) focusGroupContent(g);
    if (window.tvSound) window.tvSound('move');
  }
}, true);

// Where you were in Settings (tab, section, option), so it opens there next time.
function placeKey(node) {
  if (!node || node === document.body) return null;
  if (node.id) return `#${CSS.escape(node.id)}`;
  for (const k of ['layout', 'theme', 'slot', 'colors', 'accent', 'font', 'sound', 'instrument', 'soundFx', 'background', 'effect', 'group']) {
    if (node.dataset && k in node.dataset) {
      const scope = node.closest('[id]');
      const attr = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`); // soundFx -> sound-fx
      return `${scope ? `#${CSS.escape(scope.id)} ` : ''}[data-${attr}="${CSS.escape(node.dataset[k])}"]`;
    }
  }
  return null;
}
function rememberSettingsPlace() {
  if (screen !== 'settings') return;
  settings.place = { tab: settingsTab, groups: { ...settingsGroup }, focus: placeKey(document.activeElement) };
  try { localStorage.setItem('settingsPlace', JSON.stringify(settings.place)); } catch { /* fine */ }
}
function restoreSettingsPlace() {
  let p = settings.place;
  if (!p) { try { p = JSON.parse(localStorage.getItem('settingsPlace') || 'null'); } catch { p = null; } }
  if (!p || !p.tab) return false;
  setSettingsTab(p.tab, { focus: false });
  for (const [tab, name] of Object.entries(p.groups || {})) {
    const g = [...document.querySelectorAll(`#screen-settings .s-panel[data-tab="${tab}"] .s-group`)].find((x) => x.dataset.name === name);
    if (g) showSettingsGroup(g, { quiet: true });
  }
  let target = null;
  try { target = p.focus && document.querySelector(`#screen-settings ${p.focus}`); } catch { target = null; }
  if (target && target.closest('.s-panel') && !target.closest('.s-panel').hidden) {
    target.focus();
    if (target.offsetParent) return true;
  }
  focusSettingsTab();
  return true;
}

// A section with nothing to show right now (no possible duplicates, say) leaves the menu.
function refreshRail() {
  for (const g of document.querySelectorAll('#screen-settings .s-group')) {
    const empty = [...g.children].every((c) => c.classList.contains('group-title') || c.hidden);
    const item = [...g.closest('.s-panel').querySelectorAll('.rail-item')].find((b) => b.dataset.group === g.dataset.name);
    if (item) item.hidden = empty;
  }
}
setInterval(() => { if (screen === 'settings') refreshRail(); }, 1000);

function setSettingsTab(id, { focus = true } = {}) {
  refreshRail();
  settingsTab = SETTINGS_TABS.some((t) => t.id === id) ? id : 'general';
  for (const p of document.querySelectorAll('#screen-settings .s-panel')) p.hidden = p.dataset.tab !== settingsTab;
  for (const b of document.querySelectorAll('#screen-settings .s-tabs .tab')) b.classList.toggle('chosen', b.dataset.tab === settingsTab);
  document.querySelector('#screen-settings').classList.toggle('with-preview', settingsTab === 'look');
  if (typeof updatePreview === 'function') updatePreview();
  if (focus) focusSettingsTab();
}

// A tab opens on its section menu (or straight into the section when there's only one).
function focusSettingsTab() {
  const panel = document.querySelector(`#screen-settings .s-panel[data-tab="${settingsTab}"]`);
  const g = panel.querySelector('.s-group.on');
  if (panel.classList.contains('single') && g) return focusGroupContent(g);
  const item = panel.querySelector('.rail-item.chosen') || panel.querySelector('.rail-item');
  (item || document.querySelector('#screen-settings .s-tabs .chosen')).focus();
}

function stepSettingsTab(dir) {
  const i = SETTINGS_TABS.findIndex((t) => t.id === settingsTab);
  const next = SETTINGS_TABS[i + dir];
  if (!next) { if (window.tvSound) window.tvSound('edge'); return; }
  if (window.tvSound) window.tvSound('move');
  setSettingsTab(next.id);
}

// Moving up into a row of tabs lands on the tab you're on, not whichever is nearest.
document.addEventListener('focusin', (e) => {
  const tab = e.target.closest && e.target.closest('.tabs .tab');
  if (!tab || tab.classList.contains('chosen')) return;
  const bar = tab.closest('.tabs');
  if (e.relatedTarget && bar.contains(e.relatedTarget)) return; // moving along the tabs
  // Coming from the side (the search or Settings buttons in the same top bar): the nearest tab.
  const from = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.top, .s-tabs');
  if (from && from === tab.closest('.top, .s-tabs')) return;
  bar.querySelector('.tab.chosen')?.focus();
});

// What a picture check found, in words.
function checkText(r, a, b) {
  if (!r) return 'Couldn’t check.';
  if (r.error === 'no-mpv') return 'Checking needs mpv (see Settings → Apps).';
  if (r.error) return 'Couldn’t check: one of them has gone.';
  const v = r.ok;
  const sharp = (v.heights || []).some(Boolean) && v.heights[0] !== v.heights[1]
    ? ` (${a.name} ${v.heights[0] ? `${v.heights[0]}p` : '?'}, ${b.name} ${v.heights[1] ? `${v.heights[1]}p` : '?'})` : '';
  if (v.verdict === 'same') return `Same picture at ${v.matched} of ${v.of} moments: the same channel${sharp}.`;
  if (v.verdict === 'different') return `No matching pictures in ${v.of} moments: different channels${sharp}.`;
  return v.reason || `Only ${v.matched} of ${v.of} moments matched: can’t tell.`;
}

// Check all: one pair after another, merging the same ones and separating the different ones.
$('live-dupes-all').addEventListener('click', async () => {
  const btn = $('live-dupes-all');
  const log = $('live-dupes-log');
  const st = await tv.liveState(true);
  const pairs = st.possible.slice();
  if (!pairs.length) return;
  btn.disabled = true;
  log.replaceChildren();
  for (let i = 0; i < pairs.length; i++) {
    const { a, b } = pairs[i];
    btn.textContent = `Checking ${i + 1} of ${pairs.length}…`;
    const r = await tv.liveCheckPair(a.id, b.id);
    let done = '';
    if (r && r.ok && r.ok.verdict === 'same') { await tv.livePair(a.id, b.id, true); done = ' Merged.'; }
    else if (r && r.ok && r.ok.verdict === 'different') { await tv.livePair(a.id, b.id, false); done = ' Kept apart.'; }
    log.append(el('p', { class: 'dupe-result', textContent: `${a.name}: ${checkText(r, a, b)}${done}` }));
    await renderLiveSettings();
  }
  btn.disabled = false;
  btn.textContent = 'Check all';
});

$('live-quality').addEventListener('click', async () => {
  await tv.livePreferQuality(!$('live-quality').classList.contains('on'));
  renderLiveSettings();
});

$('apps-again').addEventListener('click', async () => {
  $('apps-again').textContent = 'Checking…';
  await refreshApps(true);
  $('apps-again').textContent = 'Check again';
  toast(`VacuumTube: ${appsState.vacuumtube ? 'installed' : 'not installed'} · mpv: ${appsState.mpv ? 'installed' : 'not installed'} · Jellyfin Desktop: ${appsState.jellyfin ? 'installed' : 'not installed'}`, 5000);
});

$('apps-vt-path').addEventListener('click', async () => {
  const p = await askFor({ label: 'Where is VacuumTube?', eyebrow: 'VacuumTube', hint: 'The full path of the program, like /opt/VacuumTube/vacuumtube. Leave empty to find it by itself again.', placeholder: '/opt/VacuumTube/vacuumtube' });
  if (screen !== 'settings') back();
  if (p == null) return;
  const r = await tv.setAppPath('vacuumtube', p.trim());
  await refreshApps(true);
  toast(r && r.error ? `There's no program at ${p.trim()}` : appsState.vacuumtube ? `VacuumTube found: ${appsState.where.vacuumtube}` : 'VacuumTube: still not found', 5000);
  $('apps-vt-path').focus();
});

// ------------------------------------------------------------ Home rows: several smaller, or one big

// A layout's or theme's CSS applies to the real page, stopping at the preview in Settings (which
// has its own copy, for whatever's highlighted). Animations stay outside the fence (they must).
function fenceCss(css) {
  const keyframes = [];
  let rest = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@keyframes', i);
    if (at < 0) { rest += css.slice(i); break; }
    rest += css.slice(i, at);
    let depth = 0; let j = css.indexOf('{', at);
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
    keyframes.push(css.slice(at, j + 1));
    i = j + 1;
  }
  return `${keyframes.join('\n')}\n@scope (html) to (.pv-root) {\n${rest}\n}`;
}

// The chosen layout (themes/layouts/<id>): its look comes in as CSS from the app; what's here is
// how it behaves (see BEHAVIOR in themes.js).
let layout = { id: 'netflix', behavior: { featured: true, widenSelected: true, rowKeys: 'up-down', rowScroll: 'start' } };
const B = () => layout.behavior || {};
function applyLayout(l) {
  if (!l || !l.id) return;
  for (const c of [...document.body.classList]) if (c.startsWith('layout-')) document.body.classList.remove(c);
  layout = l;
  document.body.classList.add(`layout-${l.id}`);
  // The layout's own CSS goes after the app's, so it wins wherever both set the same thing.
  $('layout-css').textContent = fenceCss(typeof l.css === 'string' ? l.css : '');
  document.body.classList.toggle('big-cards', Boolean(B().bigCards));
  for (const b of $('s-rows').querySelectorAll('[data-layout]')) b.classList.toggle('chosen', b.dataset.layout === l.id);
  if (!B().widenSelected) for (const c of document.querySelectorAll('#rows .card.wide')) unwiden(c);
  if (!B().oneRowAtATime) for (const r of document.querySelectorAll('#rows .row.active')) r.classList.remove('active');
  if (!B().sectionBar) $('xmb-bar').replaceChildren();
  layoutRows();
  // The layout may have hidden what had focus (like the search box): go somewhere you can see.
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (screen !== 'home' || view !== 'home' || (a && a !== document.body && a.offsetParent)) return;
    const first = $('rows').querySelector('.card:not(.skeleton)');
    const target = first || document.querySelector('#tabs .tab.chosen') || document.querySelector('#tabs .tab');
    if (target) { target.focus(); if (!first) skeletonFocus = target; }
  });
  if (B().featured && view === 'home' && screen === 'home') {
    const card = document.activeElement && document.activeElement.closest('#rows .card');
    if (card && card.tvItem) { heroKey = null; showHero(card.tvItem, card.closest('.row').dataset.title); }
  }
}

// Things each layout needs once the rows are drawn: wide pictures (Grid), one section at a time
// (PlayStation 5, PS3 cross bar), the section names across the top (cross bar).
function layoutRows() {
  const rows = [...$('rows').querySelectorAll('.row:not(.ghost)')];
  for (const card of $('rows').querySelectorAll('.card')) {
    if (B().widePictures) widePicture(card); else if (!card.classList.contains('wide')) posterPicture(card);
  }
  // Where each row sits among the others, for layouts that show it ("2 of 5", the rows around it).
  rows.forEach((r, i) => {
    r.dataset.pos = `${i + 1} of ${rows.length}`;
    if (rows[i - 1]) r.dataset.prev = rows[i - 1].dataset.title; else delete r.dataset.prev;
    if (rows[i + 1]) r.dataset.next = rows[i + 1].dataset.title; else delete r.dataset.next;
  });
  // moreAt: 'title': each row's More sits beside the row's name, not at the end of the row.
  for (const r of rows) {
    const end = r.querySelector('.row-end');
    const strip = r.querySelector('.row-cards');
    if (!end || !strip) continue;
    if (B().moreAt === 'title') { if (end.parentElement !== r) r.insertBefore(end, strip); }
    else if (end.parentElement !== strip) strip.append(end);
  }
  fillRows();
  requestAnimationFrame(fitRows);
  if (B().oneRowAtATime) {
    if (!rows.some((r) => r.classList.contains('active')) && rows[0]) rows[0].classList.add('active');
  }
  requestAnimationFrame(updateRowHints);
  if (B().sectionBar) {
    $('xmb-bar').replaceChildren(...rows.map((r) => el('span', { class: r.classList.contains('active') ? 'on' : '', textContent: r.dataset.title })));
  }
}

// The rows above and below what's on screen, named just outside the rows (never over a card).
function updateRowHints() {
  const up = $('row-hint-up');
  const down = $('row-hint-down');
  const rows = [...$('rows').querySelectorAll('.row:not(.ghost)')].filter((r) => !r.classList.contains('skeleton'));
  up.hidden = false; down.hidden = false;
  if (screen !== 'home' || view !== 'home' || B().sectionBar || rows.length < 2) { up.classList.remove('show'); down.classList.remove('show'); return; }
  const box = $('rows').getBoundingClientRect();
  const seen = rows.map((r) => {
    if (!r.offsetParent) return false;
    const b = r.getBoundingClientRect();
    return b.bottom > box.top + 40 && b.top < box.bottom - 40; // (mostly) in view
  });
  const focusRow = document.activeElement && document.activeElement.closest('#rows .row');
  let first = seen.indexOf(true);
  let last = seen.lastIndexOf(true);
  if (first < 0 && focusRow) first = last = rows.indexOf(focusRow);
  const above = first > 0 ? rows.slice(0, first) : [];
  const below = last >= 0 ? rows.slice(last + 1) : [];
  const label = (list, arrow) => `${arrow}  ${list[0].dataset.title}${list.length > 1 ? `  ·  ${list.length - 1} more` : ''}`;
  up.classList.toggle('show', above.length > 0);
  down.classList.toggle('show', below.length > 0);
  if (above.length) up.firstElementChild.textContent = label([...above].reverse(), '▲');
  if (below.length) down.firstElementChild.textContent = label(below, '▼');
}

// rowsPerScreen: cards are sized so exactly that many whole rows fit in the space there is: no row
// half in view, and nothing (art, the selected card's ring, names) cut off.
function fitRows() {
  const n = B().rowsPerScreen || 0;
  const rows = $('rows');
  const style = $('fit-css');
  if (!n || !rows.offsetParent) { style.textContent = ''; rows.style.height = ''; rows.style.flex = ''; return; }
  rows.style.height = ''; rows.style.flex = '';
  style.textContent = '';
  const avail = rows.clientHeight;
  const shown = [...rows.querySelectorAll('.row:not(.ghost)')].filter((r) => r.offsetParent && r.querySelector('.card:not(.skeleton)'));
  const card = shown[0] && shown[0].querySelector('.card:not(.wide)');
  const poster = card && card.querySelector('.poster');
  if (!avail || !card || !poster || !poster.offsetWidth) return;
  const ratio = poster.offsetHeight / poster.offsetWidth;
  const rowGap = parseFloat(getComputedStyle(shown[0]).marginBottom) || 0;
  // Everything in a row that isn't the picture (title, names, room for the ring): the most of any row.
  const fixed = Math.max(...shown.map((r) => r.offsetHeight - (r.querySelector('.card:not(.wide) .poster') || poster).offsetHeight));
  const cap = parseFloat(getComputedStyle(card).width); // the layout's own size is the most
  const per = avail / n - rowGap;
  // (A wide selected card keeps the same height as the others: 16:9 at the same height as 2:3.)
  const size = (w) => { style.textContent = `#rows .row-cards .card:not(.wide)${B().moreAt === 'title' ? '' : ', #rows .row-end'} { width: ${w.toFixed(1)}px; }
#rows .row-cards .card.wide { width: ${(w * ratio * 16 / 9).toFixed(1)}px; }`; };
  const tallest = () => Math.max(...shown.map((r) => r.offsetHeight));
  let w = Math.max(70, Math.min(cap, (per - fixed) / ratio));
  size(w);
  // Narrower cards can wrap a name onto another line: measure again, and shrink a little more if so.
  for (let i = 0; i < 3 && tallest() > per && w > 70; i++) {
    w = Math.max(70, w - (tallest() - per) / ratio - 1);
    size(w);
  }
  // Every row the same height, and the rows area exactly that many rows tall.
  const rowH = tallest();
  style.textContent += `\n#rows .row { min-height: ${rowH}px; box-sizing: border-box; }`;
  rows.style.flex = 'none';
  rows.style.height = `${Math.ceil(Math.min(avail, (rowH + rowGap) * n - rowGap))}px`;
  rows.scrollTop = 0;
}
// Fit again when the room changes: the window, or the big panel above the rows (its text arrives later).
let fitWas = '';
const refit = new ResizeObserver(() => {
  if (!B().rowsPerScreen || screen !== 'home' || view !== 'home') return;
  const now = `${$('view-home').clientHeight}|${$('hero').offsetHeight}`;
  if (now === fitWas) return;
  fitWas = now;
  requestAnimationFrame(() => { fitRows(); updateRowHints(); });
});
refit.observe($('view-home'));
refit.observe($('hero'));

// Rows loop: right from the last stop (More) goes back to the first title, left from the first
// title to More. Moving through a grid wraps line by line. A list going down (the cross bar) loops
// the same way with up and down.
document.addEventListener('keydown', (e) => {
  if (screen !== 'home' || view !== 'home') return;
  const vertical = B().rowKeys === 'left-right';
  const fwd = vertical ? 'ArrowDown' : 'ArrowRight';
  const back = vertical ? 'ArrowUp' : 'ArrowLeft';
  if (e.key !== fwd && e.key !== back) return;
  const a = document.activeElement;
  const strip = a && a.closest('#rows .row-cards');
  if (!strip) return;
  // carousel: the selected title stays at the front, and the row slides past it like a loop of
  // tape: the first title goes round to the end (or the last comes round to the front).
  if (B().carousel && !vertical && a.classList.contains('card')) {
    e.preventDefault(); e.stopImmediatePropagation();
    const cards = [...strip.querySelectorAll('.card:not(.ghost)')].filter((x) => !x.classList.contains('beyond'));
    if (cards.length < 2) { if (window.tvSound) window.tvSound('edge'); return; }
    treadmill(strip, cards, e.key === fwd);
    if (window.tvSound) window.tvSound('move');
    return;
  }
  const stops = [...strip.querySelectorAll('[data-nav]')].filter((x) => x.offsetParent && !x.classList.contains('beyond'));
  const i = stops.indexOf(a);
  if (i < 0) return;
  // Only at the ends of the row, or the line of a grid: otherwise the usual way.
  const r = a.getBoundingClientRect();
  const along = (x) => x.getBoundingClientRect();
  const sameLine = (x) => { const b = along(x); return vertical ? true : Math.abs(b.top - r.top) < r.height / 2; };
  const next = stops[i + (e.key === fwd ? 1 : -1)];
  if (next && (vertical || sameLine(next))) return;
  e.preventDefault(); e.stopImmediatePropagation();
  // Round to the other end of the same line (never up or down to another line of a grid).
  const line = stops.filter(sameLine);
  const target = vertical && next ? next : (e.key === fwd ? line[0] : line[line.length - 1]);
  if (!target || target === a) { if (window.tvSound) window.tvSound('edge'); return; }
  if (!next || !vertical) strip.scrollTo({ left: e.key === fwd ? 0 : strip.scrollWidth });
  target.focus();
  if (window.tvSound) window.tvSound('move');
}, true);
$('rows').addEventListener('scroll', () => requestAnimationFrame(updateRowHints), { passive: true });
window.addEventListener('resize', () => requestAnimationFrame(updateRowHints));

// fillRows: a row that wraps into a grid shows just enough titles to fill its lines exactly, with
// More as the last tile, however wide the screen is.
function fillRows() {
  const fillScreen = Boolean(B().fillScreen);
  const lines = B().fillRows || (fillScreen ? 1 : 0);
  const max = B().maxTitles || 0;
  for (const strip of $('rows').querySelectorAll('.row-cards')) {
    const cards = [...strip.querySelectorAll('.card')];
    for (const c of cards) c.classList.remove('beyond');
    strip.style.gridTemplateColumns = '';
    // maxTitles: at most this many, then More.
    if (max) { cards.forEach((c, i) => c.classList.toggle('beyond', i >= max)); continue; }
    if (!lines || !cards.length) continue;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const width = strip.clientWidth - parseFloat(getComputedStyle(strip).paddingLeft || 0) - parseFloat(getComputedStyle(strip).paddingRight || 0);
    const tile = cards[0].offsetWidth;
    if (!width || !tile) continue; // not on screen yet: measured again when it is
    // Columns: the grid's own (CSS grid), or as many tiles as fit across.
    const css = getComputedStyle(strip);
    const isGrid = css.display === 'grid' && css.gridTemplateColumns !== 'none';
    let cols = isGrid ? css.gridTemplateColumns.split(' ').length : Math.max(1, Math.floor((width + gap) / (tile + gap)));
    // Lines: fillScreen fits as many whole lines as the screen has room for (under the row's name).
    // On a small screen where only one line of the usual size fits, the tiles get smaller (more
    // columns) so there are always at least two lines.
    let rowsOf = lines;
    if (fillScreen) {
      const row = strip.closest('.row');
      const head = row ? row.offsetHeight - strip.offsetHeight : 0;
      const lineGap = parseFloat(css.rowGap) || 0;
      const room = $('rows').clientHeight - head - parseFloat(css.paddingTop || 0) - parseFloat(css.paddingBottom || 0);
      const cardH = cards[0].offsetHeight;
      rowsOf = Math.max(1, Math.floor((room + lineGap) / (cardH + lineGap)));
      if (rowsOf < 2 && isGrid) {
        const pic = cards[0].querySelector('.poster');
        const textH = cardH - (pic ? pic.offsetHeight : 0);
        const picH = (room - lineGap) / 2 - textH;
        const ratio = pic && pic.offsetHeight ? pic.offsetWidth / pic.offsetHeight : 16 / 9;
        const tileW = Math.max(80, picH * ratio);
        cols = Math.max(cols, Math.ceil((width + gap) / (tileW + gap)));
        strip.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        rowsOf = 2;
      }
    }
    // Whole lines, with More as the last tile.
    const show = Math.max(1, cols * rowsOf - 1);
    cards.forEach((c, i) => c.classList.toggle('beyond', i >= show));
  }
}
const fills = () => B().fillRows || B().maxTitles || B().fillScreen;
window.addEventListener('resize', () => { if (fills()) fillRows(); });
new ResizeObserver(() => { if (fills()) fillRows(); }).observe($('rows'));
setInterval(() => { if (screen === 'home' && view === 'home') updateRowHints(); else { $('row-hint-up').hidden = true; $('row-hint-down').hidden = true; } }, 700);

// The Netflix row (carousel): the big picture at the front stays put, like a viewer, and the
// cards roll under it like a treadmill. Forward: the front title slides off to the left, and the
// next card slides into the viewer, growing and fading into its wide picture. Back: the last
// title comes in from the left and does the same, and the one that was in front shrinks back
// into the line.
const ROLL_MS = 340;
const ROLL_EASE = 'cubic-bezier(0.22, 0.7, 0.2, 1)';
function treadmill(strip, cards, forward) {
  const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
  const front = cards[0];
  const incoming = forward ? cards[1] : cards[cards.length - 1];
  // Pictures of the front (wide) and the incoming card (still a poster), taken before anything moves.
  const ghostOf = (card) => {
    const g = card.cloneNode(true);
    g.classList.add('ghost');
    g.removeAttribute('data-nav');
    g.tabIndex = -1;
    g.setAttribute('aria-hidden', 'true');
    return g;
  };
  const frontGhost = ghostOf(front);
  const inGhost = ghostOf(incoming);

  // The real change: the row turns by one, and the incoming card takes the focus (and the viewer).
  const end = strip.querySelector('.row-end');
  if (forward) strip.insertBefore(front, end && end.parentElement === strip ? end : null);
  else strip.insertBefore(incoming, front);
  incoming.focus({ preventScroll: true });
  strip.scrollLeft = 0;
  for (const c of strip.querySelectorAll('.ghost')) c.remove(); // an earlier press still rolling

  const box = strip.getBoundingClientRect();
  const place = (g, r) => {
    Object.assign(g.style, {
      position: 'absolute', margin: '0', left: `${r.left - box.left - strip.clientLeft + strip.scrollLeft}px`,
      top: `${r.top - box.top - strip.clientTop}px`, width: `${r.width}px`, pointerEvents: 'none', zIndex: '2',
    });
    strip.append(g);
  };
  const slot = incoming.getBoundingClientRect(); // the viewer
  const opts = { duration: ROLL_MS, easing: ROLL_EASE };
  const done = (g) => setTimeout(() => g.remove(), ROLL_MS + 30);

  // Everything else rolls along by one place, from where it was.
  for (const c of cards) {
    if (c === incoming || (forward && c === front)) continue;
    const was = before.get(c);
    const now = c.getBoundingClientRect();
    const dx = was.left - now.left;
    if (c === front) {
      // (Back) the old front, from the viewer back into the line.
      c.animate([{ transform: `translateX(${dx}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], opts);
    } else if (Math.abs(dx) > 1) {
      c.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], opts);
    }
  }

  if (forward) {
    // The old front slides away to the left.
    place(frontGhost, before.get(front));
    frontGhost.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-(before.get(front).right - box.left + 40)}px)`, opacity: 0 }], opts);
    done(frontGhost);
    // (It's now at the far end of the line: it fades in there if that's on screen.)
    front.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ROLL_MS, easing: 'ease-in' });
  } else {
    // The wide picture of the old front fades as the new one arrives.
    place(frontGhost, before.get(front));
    frontGhost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], opts);
    done(frontGhost);
  }

  // The incoming card: its poster slides into the viewer and grows, fading into the wide picture.
  const from = forward ? before.get(incoming) : { left: box.left - before.get(incoming).width - 40, top: slot.top, width: before.get(incoming).width, right: box.left - 40 };
  place(inGhost, from);
  const dx = slot.left - from.left;
  const grow = slot.height / Math.max(1, before.get(incoming).height);
  inGhost.style.transformOrigin = 'left top';
  inGhost.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translateX(${dx}px) scale(${grow})`, opacity: 0.6, offset: 0.65 },
    { transform: `translateX(${dx}px) scale(${grow})`, opacity: 0 },
  ], opts);
  done(inGhost);
  incoming.animate([
    { opacity: 0, transform: `translateX(${forward ? 0 : -dx * 0.3}px) scale(0.92)`, transformOrigin: 'left center' },
    { opacity: 0, offset: 0.3, transform: 'scale(0.94)', transformOrigin: 'left center' },
    { opacity: 1, transform: 'none', transformOrigin: 'left center' },
  ], opts);
}

function widePicture(card) {
  const img = card.querySelector('.poster img');
  const wide = card.tvItem && backdropOf(card.tvItem, 'w780');
  if (!img || !wide || card.dataset.posterSrc) return;
  card.dataset.posterSrc = img.src;
  img.src = wide;
}
function posterPicture(card) {
  const img = card.querySelector('.poster img');
  if (img && card.dataset.posterSrc) { img.src = card.dataset.posterSrc; delete card.dataset.posterSrc; }
}
// ------------------------------------------------------------ Settings → Look

let themeList = { themes: [], saved: [], layouts: [], colors: [], fonts: [], sounds: [], effects: [], backgrounds: [], instruments: [], accents: [], folder: '' };
let lookNow = { theme: 'classic', look: {} };

const own = (t) => (t.source === 'yours' ? el('i', { class: 'own', textContent: t.author && t.author !== 'You' ? `By ${t.author}` : 'Yours' }) : null);
const swatchOf = (colors) => el('span', { class: 'swatch' }, ...colors.map((col) => el('i', { style: { background: col } })));
function pick(cls, data, value, ...kids) {
  const b = el('button', { class: cls, nav: true }, ...kids.filter(Boolean));
  b.dataset[data] = value;
  return b;
}

// The background and effects of a look, on their layers: a box for each, which its CSS draws on.
// Boxes already there are kept, so changing something else doesn't restart them.
function fillLayers(bgBox, fxBox, classHost, look) {
  const l = look || {};
  const keep = (box, want, prefix) => {
    const have = new Map([...box.children].map((d) => [d.dataset.id, d]));
    box.replaceChildren(...want.map((id) => {
      if (have.has(id)) return have.get(id);
      const d = el('div', { class: `${prefix} ${prefix}-${id}` });
      d.dataset.id = id;
      return d;
    }));
  };
  keep(bgBox, l.background ? [l.background] : [], 'bg');
  keep(fxBox, l.effects || [], 'fx');
  // An effect can also change how things look (rounder corners): it gets a class while it's on.
  for (const c of [...classHost.classList]) if (c.startsWith('with-')) classHost.classList.remove(c);
  for (const id of l.effects || []) classHost.classList.add(`with-${id}`);
}

// The look in use: its background and effects on Home, and the pickers marked to match.
function applyLook(state) {
  if (!state) return;
  lookNow = state;
  fillLayers($('bg-layer'), $('fx-layer'), document.body, state.look);
  $('effects-css').textContent = fenceCss(state.piecesCss || '');
  markLook();
  if (typeof updatePreview === 'function') requestAnimationFrame(updatePreview);
}

function markLook() {
  const l = lookNow.look || {};
  const mark = (box, key, value) => { for (const b of $(box).querySelectorAll(`[data-${key}]`)) b.classList.toggle('chosen', b.dataset[key] === value); };
  mark('s-themes', 'theme', lookNow.theme);
  mark('s-saved', 'theme', lookNow.theme);
  mark('s-colors', 'colors', l.colors);
  mark('s-accents', 'accent', l.accent || '');
  mark('s-font-display', 'font', l.display);
  mark('s-font-text', 'font', l.text);
  mark('s-sound-sets', 'sound', l.sounds);
  mark('s-instrument', 'instrument', l.instrument || '');
  mark('s-backgrounds', 'background', l.background || '');
  for (const b of $('s-sound-fx').querySelectorAll('[data-sound-fx]')) {
    const on = (l.soundFx || []).includes(b.dataset.soundFx);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  for (const b of $('s-effects').querySelectorAll('[data-effect]')) {
    const on = (l.effects || []).includes(b.dataset.effect);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  for (const b of $('s-colors').querySelectorAll('[data-colors]')) b.classList.toggle('suggested', b.dataset.colors === layout.colors);
  const custom = lookNow.theme === 'custom';
  const yours = themeList.saved.find((t) => t && t.id === lookNow.theme);
  $('s-custom-status').textContent = custom
    ? `Custom, changed from ${lookNow.base || 'Classic'}. Save it to keep it as one of your themes.`
    : `Using ${lookNow.name}${yours ? ' (one of your saved themes)' : ''}.`;
  $('s-look-save').hidden = !custom;
  $('s-look-delete').hidden = !yours;
}

async function setPart(patch) {
  const s = await tv.setLookPart(patch);
  if (s) applyLook(s.look);
}

// One of the ten squares: a saved theme (its picture and name) or an empty slot.
function savedSquare(t, slot) {
  if (!t) {
    const b = pick('saved-pick empty', 'slot', String(slot), el('span', { textContent: 'Empty' }));
    b.setAttribute('aria-label', `Empty slot ${slot}: save the look you're using here`);
    return b;
  }
  const b = pick('saved-pick', 'slot', String(slot),
    t.preview ? el('img', { src: t.preview, alt: '' }) : swatchOf(t.swatch),
    el('b', { textContent: t.name, style: { 'font-family': fontFamilyOf(t.look.display) } }));
  b.dataset.theme = t.id;
  return b;
}

function renderThemes() {
  const T = themeList;
  $('s-themes').replaceChildren(...T.themes.map((t) => {
    const b = pick('theme-pick', 'theme', t.id, swatchOf(t.swatch),
      el('b', { textContent: t.name, style: { 'font-family': fontFamilyOf(t.look.display) } }),
      el('small', { textContent: t.description }), own(t));
    b.addEventListener('click', async () => applyLook((await tv.setLookTheme(t.id)).look));
    return b;
  }));
  $('s-saved').replaceChildren(...T.saved.map((t, i) => {
    const b = savedSquare(t, i + 1);
    b.addEventListener('click', async () => {
      if (t) applyLook((await tv.setLookTheme(t.id)).look);
      else saveTheme(i + 1);
    });
    return b;
  }));
  $('s-rows').replaceChildren(...T.layouts.map((l) => {
    const b = pick('layout-pick', 'layout', l.id, el('b', { textContent: l.name }), el('small', { textContent: l.description }), own(l));
    b.addEventListener('click', async () => { const s = await tv.setTheme({ layout: l.id }); applyLayout(s.layout); markLook(); });
    return b;
  }));
  $('s-colors').replaceChildren(...T.colors.map((c) => {
    const b = pick('scheme-pick', 'colors', c.id, swatchOf(c.swatch), el('b', { textContent: c.name }), el('small', { textContent: c.description }), own(c));
    b.addEventListener('click', () => setPart({ colors: c.id }));
    return b;
  }));
  $('s-accents').replaceChildren(...T.accents.map((a) => {
    const b = pick('accent-pick', 'accent', a, a ? null : el('span', { textContent: 'Scheme' }));
    if (a) b.style.setProperty('--dot', a);
    b.setAttribute('aria-label', a ? `Highlight ${a}` : "The colour scheme's own highlight");
    b.addEventListener('click', () => setPart({ accent: a }));
    return b;
  }));
  for (const which of ['display', 'text']) {
    $(`s-font-${which}`).replaceChildren(...T.fonts.map((f) => {
      const b = pick('font-pick', 'font', f.id,
        el('b', { textContent: f.name, style: { 'font-family': f.family ? `"${f.family}", var(--font-system)` : 'var(--font-system)' } }),
        el('small', { textContent: f.description }), own(f));
      b.addEventListener('click', () => setPart({ [which]: f.id }));
      return b;
    }));
  }
  $('s-sound-sets').replaceChildren(...T.sounds.map((x) => {
    const b = pick('sound-pick', 'sound', x.id, el('b', { textContent: x.name }), el('small', { textContent: x.description }), own(x));
    b.addEventListener('click', async () => { await setPart({ sounds: x.id }); setTimeout(() => window.tvSoundSample && window.tvSoundSample(), 150); });
    return b;
  }));
  const KIND = { synth: 'Made on the fly', tone: 'Synth', recorded: 'Recorded' };
  $('s-instrument').replaceChildren(...T.instruments.map((i) => {
    const b = pick('sound-pick', 'instrument', i.id, el('b', { textContent: i.name }), el('small', { textContent: i.description }),
      el('i', { class: 'kind', textContent: i.source === 'yours' ? 'Yours · recorded' : KIND[i.kind] || '' }));
    // (A recorded one takes a moment to arrive: the sample waits for it.)
    b.addEventListener('click', async () => { await setPart({ instrument: i.id }); setTimeout(() => window.tvSoundSample && window.tvSoundSample(), i.kind === 'synth' ? 150 : 500); });
    return b;
  }));
  $('s-sound-fx').replaceChildren(...(T.soundFx || []).map((x) => {
    const b = pick('pill toggle fx-pick', 'soundFx', x.id,
      el('span', {}, el('b', { textContent: x.name }), el('small', { textContent: x.description })),
      el('span', { class: 'switch' }));
    b.addEventListener('click', async () => { await setPart({ soundFx: x.id, on: !b.classList.contains('on') }); setTimeout(() => window.tvSoundSample && window.tvSoundSample(), 400); });
    return b;
  }));
  $('s-backgrounds').replaceChildren(...[{ id: '', name: 'None', description: 'Just the colour scheme\'s own background.' }, ...T.backgrounds].map((x) => {
    const b = pick('sound-pick', 'background', x.id, el('b', { textContent: x.name }), el('small', { textContent: x.description }), own(x));
    b.addEventListener('click', () => setPart({ background: x.id }));
    return b;
  }));
  $('s-effects').replaceChildren(...T.effects.map((x) => {
    const b = pick('pill toggle fx-pick', 'effect', x.id,
      el('span', {}, el('b', { textContent: x.name }), el('small', { textContent: x.description }), own(x)),
      el('span', { class: 'switch' }));
    b.addEventListener('click', () => setPart({ effect: x.id, on: !b.classList.contains('on') }));
    return b;
  }));
  $('s-theme-folder').textContent = `Make your own moods, layouts, colours, fonts, sounds, effects and backgrounds: start from the templates in ${T.folder}/templates, then choose "Look for new themes". The guide is README.md in that folder.`;
  for (const b of $('s-rows').querySelectorAll('[data-layout]')) b.classList.toggle('chosen', b.dataset.layout === layout.id);
  markLook();
}
const fontFamilyOf = (id) => { const f = themeList.fonts.find((x) => x.id === id); return f && f.family ? `"${f.family}", var(--font-system)` : 'var(--font-system)'; };

// Save the look you're using as one of your ten themes: in the slot given, else the first empty
// one, else the one you choose to replace.
async function saveTheme(slot = 0) {
  const from = document.activeElement;
  let n = slot || (themeList.saved.findIndex((t) => !t) + 1);
  if (!n) n = await chooseSlot();
  if (!n) { if (from && from.isConnected) from.focus(); return; }
  const old = themeList.saved[n - 1];
  const name = await askFor({
    label: 'Name your theme', eyebrow: old ? `Replacing "${old.name}"` : 'Save theme',
    hint: 'It goes in your saved themes, with a small picture of how it looks.', placeholder: `My theme ${n}`, suggest: 'words',
  });
  if (screen !== 'settings') back();
  if (name == null) { focusLookControl(`s-saved [data-slot="${n}"]`); return; }
  // The picture is taken from the preview, once Settings is back on screen (the keyboard takes a
  // moment to go).
  await new Promise((r) => setTimeout(r, 450));
  const frame = pv.el && pv.el.querySelector('.pv-frame');
  const box = frame && frame.offsetParent ? frame.getBoundingClientRect() : null;
  const rect = box && { x: box.x, y: box.y, width: box.width, height: box.height };
  const r = await tv.saveLook(name.trim() || `My theme ${n}`, n, rect);
  if (!r || r.error) { toast(`Couldn't save the theme${r && r.error ? `: ${r.error}` : ''}`); return; }
  themeList = r.list; renderThemes(); applyLook(r.state.look);
  toast(old ? `Saved "${name.trim() || `My theme ${n}`}" in place of "${old.name}"` : `Saved "${name.trim() || `My theme ${n}`}"`);
  focusLookControl(`s-saved [data-slot="${n}"]`);
}

// All ten slots are used: which one to replace? (0: none, B was pressed.)
const slots = { resolve: null };
function chooseSlot() {
  $('slots-grid').replaceChildren(...themeList.saved.map((t, i) => {
    const b = savedSquare(t, i + 1);
    b.addEventListener('click', () => finishSlots(i + 1));
    return b;
  }));
  go('slots');
  $('slots-grid').firstElementChild.focus();
  return new Promise((resolve) => { slots.resolve = resolve; });
}
function finishSlots(n) {
  const resolve = slots.resolve;
  slots.resolve = null;
  const prev = trail.pop();
  if (prev) {
    show(prev.screen);
    if (prev.focus && prev.focus.isConnected) prev.focus.focus();
  }
  if (resolve) resolve(n);
}

$('s-look-save').addEventListener('click', () => saveTheme());

// Converting other sound formats (AIFF, WMA, APE, ALAC...) with ffmpeg.
function showConvert(st) {
  if (!st) return;
  $('s-convert-audio').classList.toggle('on', st.on);
  $('s-convert-audio').setAttribute('aria-pressed', String(st.on));
  $('s-convert-status').textContent = !st.ffmpeg
    ? 'Needs ffmpeg, which isn\'t installed. WAV, MP3, OGG, Opus, FLAC, AAC, M4A and WebM play without it.'
    : `AIFF, WMA, APE, CAF, WavPack and Apple Lossless, in your sound packs and instruments, turned into WAV with ffmpeg ${st.ffmpeg}.${st.converted ? ` ${st.converted} converted.` : ''}`;
}
$('s-convert-audio').addEventListener('click', async () => showConvert(await tv.setConvertAudio(!$('s-convert-audio').classList.contains('on'))));
tv.audioStatus().then(showConvert);
$('s-look-delete').addEventListener('click', async () => {
  const t = themeList.saved.find((x) => x && x.id === lookNow.theme);
  if (!t) return;
  const r = await tv.deleteLook(t.id);
  if (!r || r.error) { toast('Only your saved themes can be deleted here'); return; }
  themeList = r.list; renderThemes(); applyLook(r.state.look);
  toast(`Deleted "${t.name}". Its look is kept as Custom until you choose another.`);
  focusLookControl('s-look-save');
});
function focusLookControl(sel) {
  setTimeout(() => { const b = document.querySelector(`#${sel}`); if (b && b.offsetParent) b.focus(); }, 60);
}

tv.themes().then((t) => { if (t) { themeList = t; renderThemes(); } });
$('s-theme-reload').addEventListener('click', async () => {
  const r = await tv.reloadThemes();
  if (!r) return;
  const count = (x) => ['themes', 'layouts', 'colors', 'fonts', 'sounds', 'effects', 'backgrounds'].reduce((n, k) => n + x[k].length, 0);
  const before = count(themeList);
  themeList = r; renderThemes();
  applyLayout(r.state.layout); applyLook(r.state.look);
  const now = count(r);
  toast(now > before ? `Found ${now - before} new` : 'Themes reloaded: nothing new');
});
tv.settings().then((s) => {
  if (!s) return;
  applyLayout(s.layout); applyLook(s.look);
  settings.kbConfirm = s.kbConfirm !== false;
  $('s-kb-confirm').classList.toggle('on', settings.kbConfirm);
  renderSuggestSettings(s.suggest);
});
tv.settings().then((s) => { if (s) $('s-fullscreen').classList.toggle('on', s.fullScreen !== false); });
// Animations on or off (off: everything moves straight to where it's going).
function applyMotion(on) {
  document.body.classList.toggle('less-motion', !on);
  $('s-motion').classList.toggle('on', on);
}
tv.settings().then((s) => applyMotion(!s || s.motion !== false));
$('s-motion').addEventListener('click', async () => {
  const s = await tv.setMotion(!$('s-motion').classList.contains('on'));
  if (s) applyMotion(s.motion !== false);
});
// Updates (Settings → General → Updates). Only the AppImage replaces itself; run from the source
// code, it just says when there's a newer version.
const UPDATE_ERRORS = {
  unreachable: 'GitHub isn\'t answering. Check your internet connection and try again.',
  busy: 'GitHub is busy. Try again in a while.',
  'bad-checksum': 'The download didn\'t match its checksum, so it wasn\'t used. Try again.',
  'no-checksum': 'That release has no checksum to check the download against, so it wasn\'t used.',
  'no-file': 'That release has no AppImage for this computer.',
  'no-space': 'There isn\'t enough free space next to the AppImage for the new version.',
  'read-only': 'The AppImage is in a folder SOFA King can\'t write to, so it can\'t replace itself.',
  failed: 'Something went wrong. Try again (Settings → Developer has the log).',
};
const mb = (n) => `${Math.round(n / 1048576)} MB`;
function renderUpdate(st) {
  if (!st) return;
  const appImage = st.can.ok;
  const v = st.latest && st.latest.version;
  const status = $('up-status');
  const say = (cls, text) => { status.className = `status ${cls}`; status.textContent = text; };
  const go = $('up-go');
  go.hidden = false;
  $('up-restart').hidden = true;
  if (st.status === 'checking') { say('none', `This is version ${st.version} · looking…`); go.textContent = 'Looking…'; }
  else if (st.status === 'downloading') {
    const pct = st.total ? Math.floor((st.got / st.total) * 100) : 0;
    say('none', `Downloading ${v}… ${pct}%${st.total ? ` of ${mb(st.total)}` : ''}`);
    go.textContent = `Downloading… ${pct}%`;
  } else if (st.status === 'ready') {
    say('good', `Version ${v} is ready. It starts next time, or now.`);
    go.hidden = true;
    $('up-restart').hidden = false;
  } else if (st.status === 'available') {
    say('good', `Version ${v} is out · you have ${st.version}`);
    go.textContent = appImage ? `Update to ${v}` : 'Check again';
  } else if (st.status === 'none') {
    say('good', v ? `You have the newest version (${st.version})` : `This is version ${st.version} · no ${st.prerelease ? '' : 'stable '}release on GitHub yet`);
    go.textContent = 'Check now';
  } else { say('none', `This is version ${st.version}`); go.textContent = 'Check now'; }
  const news = st.status === 'available' || st.status === 'ready' ? (st.latest.news || []) : [];
  $('up-news').hidden = !news.length;
  $('up-news').replaceChildren(...news.map((t) => el('li', { textContent: t })));
  const note = $('up-note');
  note.classList.remove('good');
  note.textContent = st.error ? (UPDATE_ERRORS[st.error] || UPDATE_ERRORS.failed)
    : !appImage && st.can.why === 'not-appimage' ? (st.status === 'available'
      ? 'You\'re running SOFA King from its source code: git pull gets the new version (or download the AppImage from github.com/hylianux/sofa-king).'
      : 'You\'re running SOFA King from its source code, so it never replaces itself; git pull gets new versions. Check now still says when there\'s one.')
      : !appImage ? UPDATE_ERRORS['read-only'] : '';
  $('up-auto').classList.toggle('on', st.check);
  $('up-pre').classList.toggle('on', st.prerelease);
  // Focus never gets lost when a button comes or goes.
  if (document.activeElement === document.body || (document.activeElement && document.activeElement.hidden)) (go.hidden ? $('up-restart') : go).focus();
}
tv.onUpdate(renderUpdate);

// A new version, found when the app started: a small screen offering to go to Settings → Updates.
// It waits while you're typing or in the middle of setting something up, and shows once Home is
// back. "Show me" lands on the Update button.
tv.onUpdateOffer((st) => { updateOffer.pending = st; offerUpdate(); });
function offerUpdate() {
  const st = updateOffer.pending;
  if (!st || !st.latest || ['ask', 'setup', 'slots', 'choose', 'update'].includes(screen)) return;
  updateOffer.pending = null;
  $('uo-title').textContent = `SOFA King ${st.latest.version}`;
  const news = (st.latest.news || []).slice(0, 5);
  $('uo-news').hidden = !news.length;
  $('uo-news').replaceChildren(...news.map((t) => el('li', { textContent: t })));
  go('update');
  $('uo-show').focus();
  tv.updateOffered(st.latest.version);
}
async function finishUpdateOffer(showMe) {
  const prev = trail.pop();
  if (prev) {
    show(prev.screen);
    if (prev.focus && prev.focus.isConnected) prev.focus.focus();
  }
  if (!showMe) return;
  await openSettings({ tab: 'general' });
  renderUpdate(await tv.updateState());
  const btn = $('up-go').hidden ? $('up-restart') : $('up-go');
  btn.focus();
  btn.scrollIntoView({ block: 'center', behavior: lessMotion() ? 'auto' : 'smooth' });
}
$('uo-show').addEventListener('click', () => finishUpdateOffer(true));
$('uo-later').addEventListener('click', () => finishUpdateOffer(false));
tv.updateState().then(renderUpdate);
$('up-go').addEventListener('click', async () => {
  const st = await tv.updateState();
  if (!st || ['checking', 'downloading'].includes(st.status)) return;
  if (st.status === 'available' && st.can.ok) renderUpdate(await tv.updateInstall());
  else renderUpdate(await tv.updateCheck());
});
$('up-restart').addEventListener('click', async () => {
  const r = await tv.updateRestart();
  if (r && r.error) { $('up-note').textContent = 'The new version didn\'t start. Close SOFA King and start it again.'; }
});
for (const [id, key] of [['up-auto', 'check'], ['up-pre', 'prerelease']]) {
  $(id).addEventListener('click', async () => renderUpdate(await tv.updateSet(key, !$(id).classList.contains('on'))));
}

// Which screen mpv opens on (Settings → Apps).
async function renderMpvScreen(picked) {
  const n = Math.max(1, await tv.screens());
  const opts = [{ v: null, t: 'Automatic' }, ...Array.from({ length: Math.max(n, picked != null ? picked + 1 : 0) }, (_, i) => ({ v: i, t: `Screen ${i + 1}` }))];
  $('mpv-screen').replaceChildren(...opts.map((o) => {
    const b = el('button', { class: `pill${o.v === picked ? ' chosen' : ''}`, nav: true, textContent: o.t });
    b.addEventListener('click', async () => { const s = await tv.setMpvScreen(o.v); if (s) { await renderMpvScreen(s.mpvScreen); $('mpv-screen').querySelector('.chosen')?.focus(); } });
    return b;
  }));
}
tv.settings().then((s) => renderMpvScreen(s ? s.mpvScreen : null));
$('s-fullscreen').addEventListener('click', async () => {
  const s = await tv.setFullScreen(!$('s-fullscreen').classList.contains('on'));
  if (s) $('s-fullscreen').classList.toggle('on', Boolean(s.fullScreen));
});
// Suggestions while typing: on or off, remembering searches, forgetting them.
function renderSuggestSettings(g) {
  if (!g) return;
  settings.suggestOn = g.on !== false;
  $('s-suggest').classList.toggle('on', settings.suggestOn);
  $('s-suggest-remember').classList.toggle('on', g.remember !== false);
  $('s-suggest-remember').hidden = !settings.suggestOn;
  $('s-suggest-forget').hidden = !settings.suggestOn || !g.past;
}
$('s-suggest').addEventListener('click', async () => {
  const s = await tv.setSuggest({ on: !$('s-suggest').classList.contains('on') });
  if (s) renderSuggestSettings(s.suggest);
});
$('s-suggest-remember').addEventListener('click', async () => {
  const s = await tv.setSuggest({ remember: !$('s-suggest-remember').classList.contains('on') });
  if (s) renderSuggestSettings(s.suggest);
});
$('s-suggest-forget').addEventListener('click', async () => {
  const s = await tv.setSuggest({ forget: true });
  if (!s) return;
  renderSuggestSettings(s.suggest);
  $('s-suggest-remember').focus();
  toast('Earlier searches forgotten');
});
$('s-kb-confirm').addEventListener('click', async () => {
  const s = await tv.setKbConfirm(!$('s-kb-confirm').classList.contains('on'));
  if (!s) return;
  settings.kbConfirm = s.kbConfirm;
  $('s-kb-confirm').classList.toggle('on', s.kbConfirm);
});

// ------------------------------------------------------------ Settings → Developer

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
async function renderDeveloper() {
  const d = await tv.devState();
  if (!d) return;
  $('dev-debug').classList.toggle('on', d.debug);
  $('dev-status').textContent = `Log: ${kb(d.size)} · ${d.file}`;
}
$('dev-debug').addEventListener('click', async () => {
  await tv.devDebug(!$('dev-debug').classList.contains('on'));
  renderDeveloper();
});
$('dev-clear').addEventListener('click', async () => { await tv.devClear(); renderDeveloper(); toast('Log cleared.', 3000); });
$('dev-phone').addEventListener('click', async () => {
  const r = await tv.devPhoneLog();
  if (!r || r.error) { toast('Couldn’t find this TV on your home network.', 5000); return; }
  $('dev-qr-code').innerHTML = r.ok.qr;
  $('dev-qr-text').textContent = `Scan with your phone (on the same Wi-Fi) to download the log. If it doesn't load, the TV's firewall may be blocking ${r.ok.address}: see Settings → General → Paste it from my phone.`;
  $('dev-qr').hidden = false;
  $('dev-qr').scrollIntoView({ block: 'nearest' });
});

// ------------------------------------------------------------ Rows: keep the row's title in view

// Moving between rows scrolls the whole row (title and all) into view, not just the cards.
// The move is animated (quickly): from where the rows were before the key was pressed.
let rowsTopBefore = null;
document.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow') && screen === 'home' && view === 'home') rowsTopBefore = $('rows').scrollTop;
}, true);
$('rows').addEventListener('focusin', (e) => {
  const row = e.target.closest('.row');
  if (!row || row.classList.contains('ghost')) return;
  // (One row at a time: the rows don't scroll at all, so the row's name always shows. See the
  // layouts' CSS: overflow: clip.)
  if (B().oneRowAtATime) return;
  // Big view: the selected row goes to the top. Otherwise just enough to see it, title included.
  // A frame later: focusing scrolls just the card into view, after this runs, and would hide the title.
  const from = rowsTopBefore;
  rowsTopBefore = null;
  requestAnimationFrame(() => {
    const box = $('rows');
    const tall = row.offsetHeight > box.clientHeight;
    const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - pad;
    let target = box.scrollTop;
    if (B().rowScroll === 'start' || tall) target = top;
    else if (top < box.scrollTop) target = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) target = top + row.offsetHeight - box.clientHeight + pad;
    target = Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));
    scrollRowsTo(from == null ? box.scrollTop : from, target);
  });
});

// A quick, eased scroll of the rows (like a carousel turning), rather than a jump.
const ROW_MS = 200;
let rowScrollAnim = 0;
function scrollRowsTo(from, to) {
  const box = $('rows');
  const id = (rowScrollAnim += 1);
  if (Math.abs(to - from) < 2 || lessMotion()) {
    box.scrollTop = to;
    requestAnimationFrame(updateRowHints);
    return;
  }
  box.scrollTop = from;
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const step = (now) => {
    if (id !== rowScrollAnim) return;
    const t = Math.min(1, (now - start) / ROW_MS);
    box.scrollTop = from + (to - from) * ease(t);
    if (t < 1) requestAnimationFrame(step); else updateRowHints();
  };
  requestAnimationFrame(step);
}

// The Genres grid and All genres: moving up or down glides the tiles into place (eased, a little
// slower than the rows), instead of the jump the browser makes. Holding the D-pad keeps it flowing:
// each move starts from wherever the last one had got to. A tile at the top of its group brings
// the group's name into view with it; the first and last rows go all the way to the ends.
const GLIDE_MS = 280;
const glideBoxes = () => [$('genre-grid'), $('allgenres-body')];
for (const box of glideBoxes()) box.dataset.ownScroll = ''; // (nav's "show the ends" jump stays out)
let glideBefore = null;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const box = glideBoxes().find((b) => b.contains(document.activeElement));
  glideBefore = box ? { box, top: box.scrollTop } : null;
}, true);
const glides = new WeakMap();
for (const box of glideBoxes()) {
  box.addEventListener('focusin', (e) => {
    const tile = e.target.closest('.genre, button');
    if (!tile) return;
    const from = glideBefore && glideBefore.box === box ? glideBefore.top : null;
    glideBefore = null;
    if (from == null) return; // (not an up/down move: leave it be)
    requestAnimationFrame(() => {
      const r = box.getBoundingClientRect();
      const t = tile.getBoundingClientRect();
      const margin = t.height * 0.35;
      // The top edge to show: the group's name too, when the tile is in its group's first line.
      const group = tile.closest('.genre-group');
      const firstLine = group && Math.abs(t.top - group.querySelector('.genre').getBoundingClientRect().top) < 2;
      const topEdge = (firstLine ? group.getBoundingClientRect().top : t.top - margin) - r.top + box.scrollTop;
      const bottomEdge = t.bottom + margin - r.top + box.scrollTop;
      const max = box.scrollHeight - box.clientHeight;
      const tiles = [...box.querySelectorAll('.genre, .genre-grid > button')];
      let target = box.scrollTop;
      if (Math.abs(t.top - tiles[0].getBoundingClientRect().top) < 2) target = 0;
      else if (Math.abs(t.top - tiles[tiles.length - 1].getBoundingClientRect().top) < 2) target = max;
      else if (topEdge < box.scrollTop) target = topEdge;
      else if (bottomEdge > box.scrollTop + box.clientHeight) target = bottomEdge - box.clientHeight;
      target = Math.max(0, Math.min(max, target));
      const id = (glides.get(box) || 0) + 1;
      glides.set(box, id);
      if (lessMotion() || Math.abs(target - from) < 2) { box.scrollTop = target; return; }
      box.scrollTop = from;
      const start = performance.now();
      const ease = (x) => 1 - (1 - x) ** 3;
      const step = (now) => {
        if (glides.get(box) !== id) return;
        const k = Math.min(1, (now - start) / GLIDE_MS);
        box.scrollTop = from + (target - from) * ease(k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
}

// A row laid out as a list going down (the PS3 cross bar): the selected title sits at the top,
// all the way down to More (the list has room after its end for that), and the list glides past
// it, rather than jumping.
let listTopBefore = null;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const strip = document.activeElement && document.activeElement.closest('#rows .row-cards');
  listTopBefore = strip ? { strip, top: strip.scrollTop } : null;
}, true);
const listAnims = new WeakMap();
$('rows').addEventListener('focusin', (e) => {
  const card = e.target.closest('.card, .more-btn');
  const strip = card && card.closest('.row-cards');
  if (!strip || getComputedStyle(strip).flexDirection !== 'column') return;
  strip.dataset.ownScroll = ''; // (it scrolls itself: the usual "show the ends" scroll stays out of it)
  const before = listTopBefore && listTopBefore.strip === strip ? listTopBefore.top : strip.scrollTop;
  listTopBefore = null;
  requestAnimationFrame(() => {
    const item = card.closest('.card, .row-end') || card;
    const pad = parseFloat(getComputedStyle(strip).paddingTop) || 0;
    // Room after the last line, so every title (More too) can scroll up to the top.
    const room = `${Math.max(0, strip.clientHeight - item.offsetHeight - pad)}px`;
    if (strip.style.getPropertyValue('--list-tail') !== room) strip.style.setProperty('--list-tail', room);
    // (Where it should end up is worked out again on every frame: the titles above and below
    // are growing and shrinking as the selection moves, which shifts it a little as it goes.)
    const targetNow = () => {
      const top = item.getBoundingClientRect().top - strip.getBoundingClientRect().top + strip.scrollTop;
      return Math.max(0, Math.min(top - pad, strip.scrollHeight - strip.clientHeight));
    };
    const id = (listAnims.get(strip) || 0) + 1;
    listAnims.set(strip, id);
    if (lessMotion()) { strip.scrollTop = targetNow(); return; }
    const start = performance.now();
    const ease = (t) => 1 - (1 - t) ** 2; // (gentle: no overshoot-y rush at the start)
    strip.scrollTop = before;
    const step = (now) => {
      if (listAnims.get(strip) !== id) return;
      const t = Math.min(1, (now - start) / 170);
      const target = targetNow();
      strip.scrollTop = before + (target - before) * ease(t);
      if (t < 1 || Math.abs(strip.scrollTop - target) > 1) requestAnimationFrame(step);
      if (t >= 1) strip.scrollTop = target;
    };
    requestAnimationFrame(step);
  });
});

// One row at a time (Netflix, PS5, PS3): the old row slides away and the new one slides in, up
// or down (left or right for the cross bar), like a carousel turning.
function rowGhost(row) {
  if (lessMotion()) return null;
  for (const g of $('rows').querySelectorAll('.row.ghost')) g.remove();
  const box = $('rows');
  const r = row.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const g = row.cloneNode(true);
  g.classList.add('ghost');
  g.inert = true;
  Object.assign(g.style, {
    position: 'absolute', left: `${r.left - b.left + box.scrollLeft}px`, top: `${r.top - b.top + box.scrollTop}px`,
    width: `${r.width}px`, margin: '0', pointerEvents: 'none', zIndex: '0',
  });
  return g;
}
function rowSlide(to, ghost, forward) {
  if (lessMotion()) return;
  const sideways = B().rowKeys === 'left-right';
  const d = forward ? 1 : -1;
  const shift = (n) => (sideways ? `translateX(${n}px)` : `translateY(${n}px)`);
  // (The cross bar's sections just ease across a little, as on the PS3; rows slide a bit further.)
  const dist = sideways ? 18 : 46;
  const opts = { duration: sideways ? 160 : ROW_MS, easing: sideways ? 'ease-out' : 'cubic-bezier(0.22, 0.7, 0.2, 1)' };
  to.animate([{ transform: shift(dist * d), opacity: 0 }, { transform: 'none', opacity: 1 }], opts);
  if (ghost) {
    $('rows').append(ghost);
    ghost.animate([{ transform: 'none', opacity: 1 }, { transform: shift(-dist * d), opacity: 0 }], { ...opts, fill: 'forwards' });
    setTimeout(() => ghost.remove(), ROW_MS + 30);
  }
}

// ------------------------------------------------------------ Moving between rows, per layout
//
// Big view and PlayStation 5: up / down go to the row above / below, landing where you last were
// in it (or its first title). PS3 cross bar: left / right change section, up / down go through it.

function cardsRows() { return [...$('rows').querySelectorAll('.row:not(.ghost)')].filter((r) => r.querySelector('.card')); }
function landIn(row) {
  if (B().carousel) return row.querySelector('.card:not(.beyond)');
  const back = row.dataset.lastKey && row.querySelector(`.card[data-key="${CSS.escape(row.dataset.lastKey)}"]`);
  return back || row.querySelector('.card');
}
function switchRow(from, to) {
  if (B().oneRowAtATime) {
    const rows = cardsRows();
    const forward = rows.indexOf(to) > rows.indexOf(from);
    const ghost = rowGhost(from);
    from.classList.remove('active');
    to.classList.add('active');
    rowSlide(to, ghost, forward);
  }
  if (B().sectionBar) layoutRows();
  requestAnimationFrame(updateRowHints);
  const target = landIn(to);
  target.focus();
  if (window.tvSound) window.tvSound('move');
}

document.addEventListener('keydown', (e) => {
  if (screen !== 'home' || view !== 'home' || !['up-down', 'left-right'].includes(B().rowKeys)) return;
  const card = document.activeElement && document.activeElement.closest('#rows .row');
  if (!card) return;
  const row = card;
  const rows = cardsRows();
  const i = rows.indexOf(row);
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
  const across = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  // moreAt: 'title': up from a title goes to its row's More (beside the row's name), down from
  // More goes back to the title at the front.
  if (B().moreAt === 'title' && vertical) {
    const onMore = document.activeElement.classList.contains('more-btn');
    const more = row.querySelector('.more-btn');
    if (!onMore && e.key === 'ArrowUp' && more) {
      e.preventDefault(); e.stopImmediatePropagation();
      more.focus(); if (window.tvSound) window.tvSound('move');
      return;
    }
    if (onMore && e.key === 'ArrowDown') {
      e.preventDefault(); e.stopImmediatePropagation();
      landIn(row).focus(); if (window.tvSound) window.tvSound('move');
      return;
    }
  }
  if (B().moreAt === 'title' && across && document.activeElement.classList.contains('more-btn')) {
    e.preventDefault(); e.stopImmediatePropagation(); // More sits on its own
    if (window.tvSound) window.tvSound('edge');
    return;
  }
  let to = null;
  if (B().rowKeys === 'left-right' ? across : vertical) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    to = rows[i + step];
    if (!to) {
      // Up from the first row: on to the menu at the top (the usual way). Otherwise, the end.
      if (step === -1 && vertical) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.tvSound) window.tvSound('edge');
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    switchRow(row, to);
  }
}, true);

// ------------------------------------------------------------ Big view (Settings → Look → Layout)
//
// The selected card in a row becomes a wide picture at the front of the row, and the space at the
// top shows it large: title, year, score, what it's about, and where you can watch it (your
// services, and your Jellyfin servers).

const heroCache = new Map(); // card key -> { chips, meta } once looked up
let heroTimer = null;
let heroKey = null;

const heroOn = () => Boolean(B().featured);
const backdropOf = (item, size = 'w1280') => (item.kind === 'jf' ? item.backdrop : item.backdrop ? `${IMG}${size}${item.backdrop}` : null);

function widen(card) {
  if (card.classList.contains('wide')) return;
  card.classList.add('wide');
  widePicture(card);
}
function unwiden(card) {
  card.classList.remove('wide');
  posterPicture(card);
}

$('rows').addEventListener('focusin', (e) => {
  if (!heroOn()) return;
  const card = e.target.closest('.card');
  for (const c of $('rows').querySelectorAll('.card.wide')) if (c !== card) unwiden(c);
  if (!card || !card.tvItem) return;
  if (card.closest('.row')) card.closest('.row').dataset.lastKey = card.dataset.key;
  if (!B().widenSelected) { showHero(card.tvItem, card.closest('.row') && card.closest('.row').dataset.title); return; }
  widen(card);
  // The selected card goes to the front (the left) of its row.
  const strip = card.closest('.row-cards');
  if (strip) {
    const toFront = () => {
      const pad = parseFloat(getComputedStyle(strip).paddingLeft || '0');
      strip.scrollLeft += card.getBoundingClientRect().left - strip.getBoundingClientRect().left - pad;
    };
    // Now, and again once the focus move (and its own scroll) has finished.
    toFront();
    requestAnimationFrame(() => requestAnimationFrame(toFront));
  }
  showHero(card.tvItem, card.closest('.row') && card.closest('.row').dataset.title);
});

function showHero(item, rowTitle) {
  const key = cardKey(item);
  if (key === heroKey) return;
  heroKey = key;
  // (The words swap with a quick fade.)
  if (!lessMotion()) document.querySelector('#hero .hero-text').animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  $('hero-row').textContent = rowTitle || '';
  $('hero-title').textContent = item.title;
  // (An episode's name is already on the line above, with its number.)
  $('hero-overview').textContent = item.overview || '';
  // Not looked up yet? Shimmering placeholders where the length and where to watch will go.
  const pending = !heroCache.has(key) && heroCanLookUp(item);
  renderHeroMeta(item, heroCache.get(key), pending);
  renderHeroChips(item, heroCache.get(key), pending);
  const art = $('hero-art');
  const src = backdropOf(item);
  art.classList.remove('shown');
  if (src) {
    const pic = new Image();
    pic.onload = () => { if (heroKey === key) { art.src = src; art.classList.add('shown'); } };
    pic.src = src;
  }
  // Where to watch: looked up once you've stopped on it for a moment.
  clearTimeout(heroTimer);
  if (!heroCache.has(key)) heroTimer = setTimeout(() => lookUpHero(item, key), 350);
}

// How long, and when it would end if you started it now: "1h 56m · Ends at 9:42 PM".
const clockOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const lengthOf = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);
function runtimeBits({ minutes, leftMinutes, series = false }) {
  if (leftMinutes > 0) return [`${lengthOf(leftMinutes)} left`, `Ends at ${clockOf(Date.now() + leftMinutes * 60000)}`];
  if (!minutes) return [];
  if (series) return [`Episodes about ${lengthOf(minutes)}`, `One would end at ${clockOf(Date.now() + minutes * 60000)}`];
  return [lengthOf(minutes), `Ends at ${clockOf(Date.now() + minutes * 60000)}`];
}

const heroRef = (item) => (item.kind === 'jf' ? item.tmdb : { kind: item.kind, id: item.id });
const heroCanLookUp = (item) => Boolean(heroRef(item) && tmdbWorks);

function renderHeroMeta(item, extra, pending = false) {
  const meta = $('hero-meta');
  const bits = [];
  if (item.kind === 'jf') {
    const it = item.item;
    if (it.type === 'Episode') bits.push(`S${it.season}E${it.episode} · ${it.name}`);
    else if (it.year) bits.push(String(it.year));
    if (it.runtime) bits.push(...runtimeBits({ minutes: it.runtime / 60, leftMinutes: item.progress > 0 ? (it.runtime - it.position) / 60 : 0 }));
  } else {
    bits.push(item.sub);
    if (extra && extra.minutes) bits.push(...runtimeBits({ minutes: extra.minutes, series: item.kind === 'tv' }));
  }
  if (extra && extra.meta) bits.push(extra.meta);
  const rating = (extra && extra.rating) || item.rating;
  meta.replaceChildren(...bits.filter(Boolean).map((t) => el('span', { textContent: t })));
  if (rating) meta.prepend(el('span', { class: 'score', textContent: `★ ${rating}` }));
  if (pending) meta.append(el('span', { class: 'skeleton-line', style: { width: '9rem' } }));
}

// Your own servers first (they're what you can play right now), then streaming services.
function renderHeroChips(item, extra, pending = false) {
  const chips = [];
  const mine = ((extra && extra.chips) || []).filter((c) => c.jf);
  const others = ((extra && extra.chips) || []).filter((c) => !c.jf);
  if (item.kind === 'jf') chips.push(el('span', { class: `jf${String(item.serverId).startsWith('plex-') ? ' plex' : ''}`, textContent: item.progress > 0 ? `Resume on ${item.serverName}` : item.serverName }));
  for (const c of [...mine, ...others]) {
    if (item.kind === 'jf' && c.jf && c.label === item.serverName) continue;
    const s = el('span', { class: c.jf ? `jf${c.plex ? ' plex' : ''}` : c.rent ? 'rent' : '', textContent: c.label });
    if (c.color) { s.style.setProperty('--chip', c.color); s.style.setProperty('--chip-text', textFor(c.color)); }
    chips.push(s);
  }
  if (pending) {
    if (!extra || !extra.serversDone) chips.push(el('span', { class: 'skeleton-line chip-ph', style: { width: '6.5rem' } }));
    if (!extra || !extra.servicesDone) chips.push(el('span', { class: 'skeleton-line chip-ph', style: { width: '5rem' } }), el('span', { class: 'skeleton-line chip-ph', style: { width: '7rem' } }));
  }
  $('hero-chips').replaceChildren(...chips);
}

async function lookUpHero(item, key) {
  const ref = heroRef(item);
  const extra = { chips: [] };
  if (ref && tmdbWorks) {
    // Your servers usually answer first: show them as soon as they do, ahead of everything else.
    const serversP = tv.jfFind(ref.kind, ref.id, item.title, item.year || null).catch(() => null).then((found) => {
      for (const m of (found && found.ok && found.ok.matches) || []) extra.chips.push({ label: m.serverName, jf: true, plex: String(m.serverId).startsWith('plex-') });
      extra.serversDone = true;
      if (heroKey === key && !extra.servicesDone) renderHeroChips(item, extra, true);
    });
    const res = await tv.details(ref.kind, ref.id).catch(() => null);
    const d = res && res.ok;
    if (d) {
      extra.rating = d.rating;
      // (Without the year, already shown, and the length, which comes with its end time.)
      extra.meta = d.meta && item.kind !== 'jf' ? d.meta.split('  ·  ').slice(1).filter((x) => !/^\d+h \d+m$|seasons?$/.test(x)).join(' · ') : '';
      extra.minutes = d.minutes;
      for (const s of services.filter((x) => d.onServices.includes(x.id))) {
        const how = (d.serviceHow || {})[s.id];
        extra.chips.push({ label: how === 'free' || how === 'ads' ? `${s.name} · free` : s.name, color: s.color });
      }
      for (const r of d.rentOnly || []) {
        const s = services.find((x) => x.id === r.serviceId);
        if (s) extra.chips.push({ label: `${s.name} · rent or buy`, rent: true });
      }
    }
    extra.servicesDone = true;
    if (heroKey === key && !extra.serversDone) { renderHeroMeta(item, extra, true); renderHeroChips(item, extra, true); }
    await serversP;
  }
  heroCache.set(key, extra);
  if (heroKey === key) { renderHeroMeta(item, extra); renderHeroChips(item, extra); }
}

$('hero-search').addEventListener('click', openSearch);

// ------------------------------------------------------------ Title page: cast & crew

function renderPeople(d) {
  const people = d.people || [];
  $('d-people-box').hidden = !people.length;
  $('d-people').replaceChildren(...people.map((p) => {
    const face = el('span', { class: 'face' }, el('span', { textContent: initials(p.title) }));
    if (p.image) {
      const img = el('img', { alt: '', loading: 'lazy', src: `${IMG}w185${p.image}` });
      img.addEventListener('error', () => img.remove());
      face.append(img);
    }
    const b = el('button', { class: 'person', nav: true, onclick: () => openPersonFromTitle(p) },
      face, el('span', { class: 'p-name', textContent: p.title }), el('span', { class: 'p-role', textContent: p.sub }));
    return b;
  }));
  $('d-people').dataset.row = '';
}

// Everything they've been in (the search screen's person view).
function openPersonFromTitle(p) {
  go('search');
  updateQueryView();
  openPerson(p, null);
}

// Up from the Home / Live / Genres / Library tabs (nothing's above them) jumps to the Settings gear.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' || screen !== 'home') return;
  const tab = document.activeElement && document.activeElement.closest('#tabs .tab');
  if (!tab || !$('open-settings').offsetParent) return;
  e.preventDefault(); e.stopImmediatePropagation();
  $('open-settings').focus();
  if (window.tvSound) window.tvSound('move');
}, true);

// ------------------------------------------------------------ Settings → Look: the preview
//
// A small Home on the right of the Look tab, showing whatever's highlighted (a layout, theme,
// colour scheme, highlight colour or font) before you choose it. It's built from the same pieces
// as the real Home, styled by the real layout's CSS and theme's effects, scoped to the preview:
// "body.layout-x" becomes ".pv-root.layout-x", and so on.

var previewReady = false; // (var: the section menu can ask for an update before this part has run)
const pv = { el: null, root: null, bg: null, fx: null, css: null, label: null, caption: null, peek: null };

(function buildPreview() {
  const panel = document.querySelector('#screen-settings .s-panel[data-tab="look"]');
  if (!panel) return;
  const titles = [['Jump back in', 'Severance', 'Series'], ['Trending this week', 'Arrival', '2016 · Film'], ['Popular on your services', 'The Long Night', '2023 · Series']];
  const hues = [[205, 40], [330, 35], [95, 30], [30, 40], [170, 35], [260, 30], [0, 35], [50, 40], [185, 30]];
  const card = (i, r) => {
    const [h, s2] = hues[(i + r * 3) % hues.length];
    const poster = el('span', { class: 'poster pv-poster', style: { background: `linear-gradient(160deg, hsl(${h} ${s2}% 42%), hsl(${(h + 40) % 360} ${s2}% 22%))` } });
    if (i === 0 && r === 0) poster.append(el('span', { class: 'bar-track' }, el('span', { style: { width: '62%' } })));
    return el('div', { class: `card${i === 0 && r === 0 ? ' pv-focus' : ''}` }, poster,
      el('span', { class: 'name', textContent: i === 0 ? titles[r][1] : ['Harbor Lights', 'Paper Moons', 'Static', 'Golden Hour', 'North Line', 'Afterglow', 'Quiet Storm', 'Midnight Run'][(i + r) % 8] }),
      el('span', { class: 'sub', textContent: i === 0 ? titles[r][2] : '2024 · Film' }));
  };
  const rows = titles.map(([t], r) => {
    const cards = el('div', { class: 'row-cards' });
    for (let i = 0; i < 9; i++) cards.append(card(i, r));
    cards.append(el('div', { class: 'row-end' },
      el('span', { class: 'more-btn pv-btn', innerHTML: ARROW_RIGHT }, el('span', { class: 'tip', textContent: 'More' }))));
    const row = el('section', { class: `row${r === 0 ? ' active' : ''}` }, el('h2', { class: 'eyebrow', textContent: t }), cards);
    row.dataset.title = t;
    return row;
  });
  const bar = el('div', { class: 'xmb-bar' }, ...titles.map(([t], i) => el('span', { class: i === 0 ? 'on' : '', textContent: t })));
  const hero = el('section', { class: 'hero' },
    el('div', { class: 'hero-art pv-art shown' }),
    el('div', { class: 'hero-text' },
      el('p', { class: 'eyebrow', textContent: 'Jump back in' }),
      el('h2', { textContent: 'Severance' }),
      el('p', { class: 'hero-meta' }, el('span', { class: 'score', textContent: '★ 8.7' }), document.createTextNode('S1 E2 · Half Loop · 43 min left')),
      el('p', { class: 'hero-overview', textContent: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.' }),
      el('div', { class: 'hero-chips' }, el('span', { class: 'jf', textContent: 'Resume on Living Room' }), el('span', { textContent: 'Apple TV+' }), el('span', { class: 'rent', textContent: 'Prime Video · rent or buy' }))));
  const screenEl = el('div', { class: 'pv-screen' },
    el('header', { class: 'top' },
      el('div', { class: 'top-left' }, el('h1', { textContent: 'Good evening' }),
        el('nav', { class: 'tabs' }, ...['Home', 'Live', 'Genres', 'Library'].map((t, i) => el('span', { class: `tab${i === 0 ? ' chosen' : ''}`, textContent: t })))),
      el('div', { class: 'top-right' }, el('div', { class: 'pv-clock', textContent: '8:00 PM' }))),
    el('main', { class: 'home-main view pv-view-home' },
      el('div', { class: 'searchbar', textContent: 'Search movies, shows and people' }), bar, hero, el('div', { class: 'rows' }, ...rows)));
  pv.bg = el('div', { class: 'pv-bg' });
  pv.fx = el('div', { class: 'pv-fx' });
  pv.root = el('div', { class: 'pv-root' }, pv.bg, screenEl, pv.fx);
  pv.css = el('style');
  pv.label = el('p', { class: 'pv-label' });
  pv.caption = el('p', { class: 'pv-caption' });
  pv.el = el('aside', { class: 'look-preview' }, pv.label, el('div', { class: 'pv-frame' }, pv.root), pv.caption);
  document.head.append(pv.css);
  panel.append(pv.el);
  previewReady = true;
})();

// What the preview shows: what you're using, with whatever's highlighted swapped in.
function previewTarget() {
  const T = themeList;
  const a = document.activeElement;
  let look = { ...(lookNow.look || {}) };
  let lay = T.layouts.find((l) => l.id === layout.id) || { id: layout.id, behavior: B(), css: layout.css };
  let what = `What you're using now: ${lookNow.name || 'Classic'} · ${lay.name || ''}`;
  let about = '';
  const ds = (a && a.closest && a.closest('#screen-settings .s-group') && a.dataset) || {};
  if (ds.layout) { const l = T.layouts.find((x) => x.id === ds.layout); if (l) { lay = l; what = `Layout: ${l.name}`; about = l.description; } }
  if (ds.theme) {
    const t = T.themes.find((x) => x.id === ds.theme) || T.saved.find((x) => x && x.id === ds.theme);
    if (t) { look = { ...t.look }; what = `${t.slot ? 'Your theme' : 'Mood'}: ${t.name}`; about = t.description || ''; }
  } else if (ds.slot) { what = 'An empty slot'; about = 'Choose it to save the look you\'re using here.'; }
  if (ds.colors) { const c = T.colors.find((x) => x.id === ds.colors); if (c) { look.colors = c.id; look.accent = ''; what = `Colours: ${c.name}`; about = c.description; } }
  if ('accent' in ds) { look.accent = ds.accent; what = ds.accent ? 'Highlight colour' : "The scheme's own highlight colour"; }
  if (ds.font) {
    const f = T.fonts.find((x) => x.id === ds.font);
    const which = a.closest('#s-font-display') ? 'display' : 'text';
    if (f) { look[which] = f.id; what = `${which === 'display' ? 'Heading' : 'Text'} font: ${f.name}`; about = f.description; }
  }
  if (ds.sound) { const x = T.sounds.find((y) => y.id === ds.sound); if (x) { what = `Sounds: ${x.name}`; about = `${x.description} Select it to hear a sample.`; } }
  if ('instrument' in ds) {
    const x = T.instruments.find((y) => y.id === ds.instrument);
    if (x) { what = `Instrument: ${x.name}`; about = `${x.description}${x.license ? ` Recorded by ${x.author} (${x.license}).` : ''} Select it to hear a sample.`; }
  }
  if (ds.soundFx) { const x = (T.soundFx || []).find((y) => y.id === ds.soundFx); if (x) { what = `Sound effect: ${x.name}`; about = `${x.description} Switching it plays a sample.`; } }
  if ('background' in ds) {
    const x = T.backgrounds.find((y) => y.id === ds.background);
    look.background = ds.background;
    what = x ? `Background: ${x.name}` : 'No background';
    about = x ? x.description : 'Just the colour scheme\'s own background.';
  }
  // A highlighted effect is shown on, whether it is yet or not.
  if (ds.effect) {
    const x = T.effects.find((y) => y.id === ds.effect);
    if (x) { look.effects = [...new Set([...(look.effects || []), x.id])]; what = `Effect: ${x.name}`; about = x.description; }
  }
  return { look, lay, what, about };
}

const rgbOf = (hex) => { let h = String(hex || '#000').slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', '); };
const VAR_OF = { bg: '--bg', surface: '--bg-raised', surface2: '--surface-2', line: '--line-strong', text: '--text', textSoft: '--text-soft', muted: '--muted', faint: '--faint', focus: '--focus', onFocus: '--on-focus', onFocusSoft: '--on-focus-soft', accent: '--accent', gold: '--gold', good: '--good', bad: '--bad', glow1: '--glow-1', glow2: '--glow-2' };

// Layout and theme CSS, moved from the real page to the preview.
const scopeCss = (css, kind, id) => String(css || '')
  .split(`body.${kind}-${id || ''}`).join(`.pv-root.${kind}-${id || ''}`)
  .replace(/#view-home\b/g, '.pv-view-home').replace(/#screen-home\b/g, '.pv-screen')
  .replace(/:focus\b/g, '.pv-focus');
// The app's own "Rows" card sizes are written for the page (body:not(.big-cards)): the preview's own copy.
let compactCss = null;
function compactRules() {
  if (compactCss != null) return compactCss;
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes('body:not(.big-cards) :where(#screen-home)')) out.push(r.cssText.split('body:not(.big-cards) :where(#screen-home)').join('.pv-root.pv-root:not(.big-cards)'));
    }
  }
  compactCss = out.join('\n');
  return compactCss;
}

function updatePreview() {
  if (!previewReady || !pv.root || settingsTab !== 'look' || screen !== 'settings') return;
  const { look, lay, what, about } = previewTarget();
  const scheme = themeList.colors.find((c) => c.id === look.colors);
  const values = { ...((scheme && scheme.values) || {}) };
  if (look.accent) values.accent = look.accent;
  const st = pv.root.style;
  for (const [k, v] of Object.entries(VAR_OF)) if (values[k]) st.setProperty(v, values[k]);
  if (values.bg) { st.setProperty('--bg-rgb', rgbOf(values.bg)); st.setProperty('--ink', rgbOf(values.text)); st.setProperty('--accent-rgb', rgbOf(values.accent)); st.setProperty('--gold-rgb', rgbOf(values.gold)); st.setProperty('--good-rgb', rgbOf(values.good)); }
  st.setProperty('--font-display', fontFamilyOf(look.display));
  st.setProperty('--font-text', fontFamilyOf(look.text));
  const beh = lay.behavior || {};
  // The background and effects: the same pieces as on the real page, on the preview's own layers.
  const T = themeList;
  const bg = T.backgrounds.find((x) => x.id === look.background);
  const fx = (look.effects || []).map((id) => T.effects.find((x) => x.id === id)).filter(Boolean);
  pv.root.className = `pv-root layout-${lay.id}${beh.bigCards ? ' big-cards' : ''}`;
  fillLayers(pv.bg, pv.fx, pv.root, { background: bg ? bg.id : '', effects: fx.map((x) => x.id) });
  const pieces = [bg ? bg.css : '', ...fx.map((x) => x.css)].join('\n');
  pv.css.textContent = `${compactRules()}\n${scopeCss(lay.css, 'layout', lay.id)}\n${scopeCss(pieces, 'with', '')}`;
  // Behaviour that isn't CSS: the wide selected card, wide pictures, one row at a time.
  const first = pv.root.querySelector('.row .card');
  first.classList.toggle('wide', Boolean(beh.widenSelected));
  for (const p of pv.root.querySelectorAll('.pv-poster')) p.classList.toggle('pv-wide', Boolean(beh.widePictures));
  for (const [i, c] of [...pv.root.querySelectorAll('.row:first-of-type .card')].entries()) c.classList.toggle('beyond', Boolean(beh.fillRows) && i >= (beh.fillRows * 5 - 1));
  pv.root.querySelector('.hero').style.display = beh.featured ? '' : 'none';
  pv.label.textContent = what;
  pv.caption.textContent = about;
  scalePreview();
}
function scalePreview() {
  const frame = pv.root && pv.root.parentElement;
  if (!frame || !frame.clientWidth) return;
  const k = frame.clientWidth / pv.root.offsetWidth;
  pv.root.style.transform = `scale(${k})`;
  frame.style.height = `${pv.root.offsetHeight * k}px`;
}
window.addEventListener('resize', () => { if (screen === 'settings') scalePreview(); });
document.addEventListener('focusin', () => { if (screen === 'settings' && settingsTab === 'look') requestAnimationFrame(updatePreview); });
