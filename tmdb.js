'use strict';

// TMDB lookups, run in the main process so the key never reaches a web page.
// Where-to-watch data comes from JustWatch via TMDB, and must be credited to JustWatch.

const API = 'https://api.themoviedb.org/3';
const CACHE_MS = 30 * 60 * 1000; // home rows refresh every half hour

function createTmdb({ getKey, getRegion, services, stores = [], log = { debug() {} } }) {
  const cache = new Map();
  // Each service, and (for some) the store that rents and sells its titles: Amazon for Prime Video,
  // the Apple TV store for Apple TV+, YouTube's own store.
  const matchers = services.map((s) => {
    const store = s.store && stores.find((x) => x.id === s.store);
    const sells = s.rentMatch || (store && store.match);
    return { id: s.id, re: new RegExp(s.match || `^${s.name}`, 'i'), sellsAs: sells ? new RegExp(sells, 'i') : null, storeId: store ? store.id : null };
  });

  async function request(pathname, params, key) {
    const url = new URL(API + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = { accept: 'application/json' };
    // A Read Access Token is a long JWT (has dots); a v3 API key is 32 hex characters.
    if (key.includes('.')) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw Object.assign(new Error('TMDB unreachable'), { code: 'failed' });
    }
    if (res.status === 401) throw Object.assign(new Error('TMDB rejected the key'), { code: 'bad-key' });
    if (!res.ok) throw Object.assign(new Error(`TMDB ${res.status}`), { code: 'failed' });
    return res.json();
  }

  async function get(pathname, params = {}) {
    const key = getKey();
    if (!key) throw Object.assign(new Error('No TMDB key'), { code: 'no-key' });
    const cacheKey = pathname + '?' + new URLSearchParams(params);
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.json;
    const json = await request(pathname, params, key);
    cache.delete(cacheKey);
    cache.set(cacheKey, { at: Date.now(), json });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return json;
  }

  // Checks a key before we save it: 'ok', 'bad-key' or 'failed'.
  async function validate(key) {
    try {
      await request('/authentication', {}, key);
      return 'ok';
    } catch (err) {
      return err.code === 'bad-key' ? 'bad-key' : 'failed';
    }
  }

  const year = (d) => (d ? d.slice(0, 4) : '');

  // One shape for movies, shows and people, whatever endpoint they came from.
  function card(item, kind = item.media_type) {
    if (kind === 'person') {
      return {
        kind, id: item.id, title: item.name, image: item.profile_path || null,
        sub: item.known_for_department || '',
      };
    }
    if (kind !== 'movie' && kind !== 'tv') return null;
    return {
      kind, id: item.id,
      title: item.title || item.name,
      image: item.poster_path || null,
      sub: [year(item.release_date || item.first_air_date), kind === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · '),
      // For the big view at the top of Home.
      backdrop: item.backdrop_path || null,
      rating: item.vote_count > 20 ? Math.round(item.vote_average * 10) / 10 : null,
      overview: (item.overview || '').slice(0, 320),
      year: year(item.release_date || item.first_air_date),
    };
  }

  async function search(query) {
    return (await searchPage(query, 1)).items.slice(0, 30);
  }
  // One page of results (TMDB gives 20 at a time): { items, more }.
  async function searchPage(query, page = 1) {
    const json = await get('/search/multi', { query, include_adult: 'false', language: 'en-US', page: String(page) });
    return { items: json.results.map((r) => card(r)).filter(Boolean), more: page < Math.min(json.total_pages || 1, 25) };
  }

  async function person(id) {
    const [info, credits] = await Promise.all([
      get(`/person/${id}`, { language: 'en-US' }),
      get(`/person/${id}/combined_credits`, { language: 'en-US' }),
    ]);
    const seen = new Set();
    const works = [...credits.cast, ...credits.crew]
      .filter((c) => (c.media_type === 'movie' || c.media_type === 'tv') && !seen.has(c.media_type + c.id) && seen.add(c.media_type + c.id))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 40)
      .map((c) => card(c));
    return { name: info.name, works };
  }

  // TMDB's ids for the services in services.json, so lists can be filtered to them.
  async function providerIds() {
    const region = getRegion();
    const [movie, tv] = await Promise.all([
      get('/watch/providers/movie', { watch_region: region, language: 'en-US' }),
      get('/watch/providers/tv', { watch_region: region, language: 'en-US' }),
    ]);
    const ids = new Set();
    for (const p of [...movie.results, ...tv.results]) {
      if (matchers.some((m) => m.re.test(p.provider_name))) ids.add(p.provider_id);
    }
    return [...ids];
  }

  // ---------------------------------------------------------------- browsing pages
  //
  // Every list (a home row, its "More" grid, a genre) is described by a spec, and fetched a page
  // at a time: { items, more } where more says whether another page exists.

  const GENRES = {
    action: { name: 'Action', movie: 28, tv: 10759 },
    adventure: { name: 'Adventure', movie: 12, tv: 10759 },
    animation: { name: 'Animation', movie: 16, tv: 16 },
    comedy: { name: 'Comedy', movie: 35, tv: 35 },
    crime: { name: 'Crime', movie: 80, tv: 80 },
    documentary: { name: 'Documentary', movie: 99, tv: 99 },
    drama: { name: 'Drama', movie: 18, tv: 18 },
    family: { name: 'Family', movie: 10751, tv: 10751 },
    fantasy: { name: 'Fantasy', movie: 14, tv: 10765 },
    scifi: { name: 'Science fiction', movie: 878, tv: 10765 },
    horror: { name: 'Horror', movie: 27, tv: null },
    mystery: { name: 'Mystery', movie: 9648, tv: 9648 },
    romance: { name: 'Romance', movie: 10749, tv: null },
    thriller: { name: 'Thriller', movie: 53, tv: null },
    history: { name: 'History', movie: 36, tv: null },
    war: { name: 'War', movie: 10752, tv: 10768 },
    western: { name: 'Western', movie: 37, tv: 37 },
    kids: { name: 'Kids', movie: null, tv: 10762 },
    reality: { name: 'Reality', movie: null, tv: 10764 },
    holiday: { name: 'Holiday classics', keyword: 'christmas' },
  };

  // Many more ways to browse, behind "See all genres". Each is a TMDB "discover" search:
  //   keyword: a TMDB keyword (looked up by name), genre ids (movie / tv), kinds it applies to,
  //   q: extra filters ('date.gte' / 'date.lte' become release or first-air dates),
  //   sort: 'popular' (default), 'votes' (the well-known ones first) or 'rating'.
  const MORE_GENRES = {
    // Holidays and seasons
    halloween: { name: 'Halloween', group: 'Holidays and seasons', keyword: 'halloween', sort: 'votes' },
    thanksgiving: { name: 'Thanksgiving', group: 'Holidays and seasons', keyword: 'thanksgiving', sort: 'votes' },
    valentines: { name: 'Valentine’s Day', group: 'Holidays and seasons', keyword: 'valentine\'s day', sort: 'votes' },
    summer: { name: 'Summer', group: 'Holidays and seasons', keyword: 'summer', sort: 'votes' },
    // Themes
    superhero: { name: 'Superheroes', group: 'Themes', keyword: 'superhero' },
    timetravel: { name: 'Time travel', group: 'Themes', keyword: 'time travel' },
    heist: { name: 'Heists', group: 'Themes', keyword: 'heist' },
    space: { name: 'Space', group: 'Themes', keyword: 'space' },
    dystopia: { name: 'Dystopias', group: 'Themes', keyword: 'dystopia' },
    apocalypse: { name: 'After the apocalypse', group: 'Themes', keyword: 'post-apocalyptic future' },
    zombies: { name: 'Zombies', group: 'Themes', keyword: 'zombie' },
    vampires: { name: 'Vampires', group: 'Themes', keyword: 'vampire' },
    dinosaurs: { name: 'Dinosaurs', group: 'Themes', keyword: 'dinosaur' },
    spies: { name: 'Spies', group: 'Themes', keyword: 'spy' },
    martialarts: { name: 'Martial arts', group: 'Themes', keyword: 'martial arts' },
    disaster: { name: 'Disasters', group: 'Themes', keyword: 'disaster' },
    serialkiller: { name: 'Serial killers', group: 'Themes', keyword: 'serial killer' },
    cyberpunk: { name: 'Cyberpunk', group: 'Themes', keyword: 'cyberpunk' },
    comingofage: { name: 'Coming of age', group: 'Themes', keyword: 'coming of age' },
    roadtrip: { name: 'Road trips', group: 'Themes', keyword: 'road trip' },
    sports: { name: 'Sports', group: 'Themes', keyword: 'sport' },
    courtroom: { name: 'Courtroom', group: 'Themes', keyword: 'courtroom' },
    truestory: { name: 'Based on a true story', group: 'Themes', keyword: 'based on true story' },
    books: { name: 'Based on a book', group: 'Themes', keyword: 'based on novel or book' },
    // Kinds of film and TV
    musicals: { name: 'Musicals', group: 'Styles', keyword: 'musical', sort: 'votes' },
    standup: { name: 'Stand-up comedy', group: 'Styles', keyword: 'stand-up comedy' },
    mockumentary: { name: 'Mockumentaries', group: 'Styles', keyword: 'mockumentary', sort: 'votes' },
    foundfootage: { name: 'Found footage', group: 'Styles', keyword: 'found footage' },
    cult: { name: 'Cult classics', group: 'Styles', keyword: 'cult film', sort: 'votes' },
    anime: { name: 'Anime', group: 'Styles', movie: 16, tv: 16, q: { with_original_language: 'ja' } },
    news: { name: 'News', group: 'Styles', kinds: ['tv'], tv: 10763 },
    soap: { name: 'Soaps', group: 'Styles', kinds: ['tv'], tv: 10766 },
    talk: { name: 'Talk shows', group: 'Styles', kinds: ['tv'], tv: 10767 },
    tvmovie: { name: 'TV movies', group: 'Styles', kinds: ['movie'], movie: 10770 },
    music: { name: 'Music', group: 'Styles', kinds: ['movie'], movie: 10402 },
    // From around the world
    kdrama: { name: 'K-dramas', group: 'Around the world', kinds: ['tv'], tv: 18, q: { with_origin_country: 'KR' } },
    korean: { name: 'Korean films', group: 'Around the world', kinds: ['movie'], q: { with_origin_country: 'KR' } },
    bollywood: { name: 'Bollywood', group: 'Around the world', kinds: ['movie'], q: { with_original_language: 'hi' } },
    british: { name: 'British TV', group: 'Around the world', kinds: ['tv'], q: { with_origin_country: 'GB' } },
    japanese: { name: 'Japanese live action', group: 'Around the world', q: { with_original_language: 'ja', without_genres: '16' } },
    spanish: { name: 'Spanish-language', group: 'Around the world', q: { with_original_language: 'es' } },
    french: { name: 'French', group: 'Around the world', q: { with_original_language: 'fr' } },
    nordic: { name: 'Nordic noir', group: 'Around the world', movie: 80, tv: 80, q: { with_origin_country: 'SE|DK|NO|IS|FI' } },
    // By era and acclaim
    newreleases: { name: 'New releases', group: 'By era and acclaim', q: { 'date.gte': -120 }, minVotes: 10 },
    greats: { name: 'All-time greats', group: 'By era and acclaim', sort: 'rating', minVotes: 5000 },
    hiddengems: { name: 'Hidden gems', group: 'By era and acclaim', sort: 'rating', minVotes: 150, q: { 'vote_count.lte': '1500', 'vote_average.gte': '7.3' } },
    classics: { name: 'Golden-age classics', group: 'By era and acclaim', sort: 'votes', q: { 'date.lte': '1969-12-31' } },
    seventies: { name: 'The ’70s', group: 'By era and acclaim', sort: 'votes', q: { 'date.gte': '1970-01-01', 'date.lte': '1979-12-31' } },
    eighties: { name: 'The ’80s', group: 'By era and acclaim', sort: 'votes', q: { 'date.gte': '1980-01-01', 'date.lte': '1989-12-31' } },
    nineties: { name: 'The ’90s', group: 'By era and acclaim', sort: 'votes', q: { 'date.gte': '1990-01-01', 'date.lte': '1999-12-31' } },
    noughties: { name: 'The 2000s', group: 'By era and acclaim', sort: 'votes', q: { 'date.gte': '2000-01-01', 'date.lte': '2009-12-31' } },
  };
  const ALL_GENRES = { ...GENRES, ...MORE_GENRES };

  // The popular ones (shown first), and the rest grouped for "See all genres".
  const genreList = () => [
    ...Object.entries(GENRES).map(([id, g]) => ({ id, name: g.name, popular: true, group: 'Popular' })),
    ...Object.entries(MORE_GENRES).map(([id, g]) => ({ id, name: g.name, popular: false, group: g.group })),
  ];

  // TMDB keyword ids, looked up by name once (e.g. "christmas" for Holiday classics).
  const keywordIds = new Map();
  async function keywordId(name) {
    if (keywordIds.has(name)) return keywordIds.get(name);
    const r = await get('/search/keyword', { query: name, page: '1' });
    const hit = (r.results || []).find((k) => k.name.toLowerCase() === name) || (r.results || [])[0];
    keywordIds.set(name, hit ? hit.id : null);
    return hit ? hit.id : null;
  }

  const base = { include_adult: 'false', language: 'en-US' };
  const mine = async () => {
    const ids = await providerIds();
    return ids.length ? { watch_region: getRegion(), with_watch_providers: ids.join('|'), with_watch_monetization_types: 'flatrate|free|ads' } : null;
  };

  // Two lists merged most-popular first (for "movies and shows together").
  function interleave(a, b) {
    return [...a, ...b].sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
  }

  const asPage = (json, kind) => ({
    items: (json.results || []).map((r) => card(r, kind || r.media_type)).filter((c) => c && c.kind !== 'person'),
    more: (json.page || 1) < Math.min(json.total_pages || 1, 500),
  });

  const DATE_KEYS = { movie: 'primary_release_date', tv: 'first_air_date' };
  const SORTS = { popular: 'popularity.desc', votes: 'vote_count.desc', rating: 'vote_average.desc' };

  async function genrePage(spec, page) {
    const g = ALL_GENRES[spec.genre];
    if (!g) return { items: [], more: false };
    const allowed = g.kinds || ['movie', 'tv'];
    const wanted = spec.kind === 'movie' ? ['movie'] : spec.kind === 'tv' ? ['tv'] : ['movie', 'tv'];
    const kinds = wanted.filter((k) => allowed.includes(k));
    const sort = g.keyword && !g.sort ? 'popular' : (g.sort || 'popular');
    const params = { ...base, page: String(page), sort_by: SORTS[sort], 'vote_count.gte': String(g.minVotes ?? 50) };
    if (g.keyword) {
      const kw = await keywordId(g.keyword);
      if (!kw) return { items: [], more: false };
      params.with_keywords = String(kw);
    }
    if (g.keyword === 'christmas') params.sort_by = SORTS.votes; // classics: the well-loved ones first
    const results = await Promise.all(kinds.map((k) => {
      const hasGenreIds = g.movie !== undefined || g.tv !== undefined;
      if (hasGenreIds && !g[k]) return null; // e.g. no "Horror" genre for TV on TMDB
      const p = { ...params };
      if (hasGenreIds) p.with_genres = String(g[k]);
      for (const [key, value] of Object.entries(g.q || {})) {
        const m = /^date\.(gte|lte)$/.exec(key);
        if (!m) { p[key] = value; continue; }
        // A number means "days from today" (e.g. -120: the last four months).
        const v = typeof value === 'number' ? new Date(Date.now() + value * 86400000).toISOString().slice(0, 10) : value;
        p[`${DATE_KEYS[k]}.${m[1]}`] = v;
      }
      return get(`/discover/${k}`, p).then((json) => ({ json, k }));
    }));
    const got = results.filter(Boolean);
    const lists = got.map(({ json, k }) => (json.results || []).map((r) => ({ ...r, media_type: k })));
    const order = params.sort_by === SORTS.votes ? 'vote_count' : params.sort_by === SORTS.rating ? 'vote_average' : 'popularity';
    const merged = [...lists.flat()].sort((x, y) => (y[order] || 0) - (x[order] || 0));
    if (spec.art) {
      // A picture for the genre's tile: a wide still from one of its best-known titles.
      const pick = merged.filter((r) => r.backdrop_path).slice(0, 3);
      return { art: pick.length ? pick[(String(spec.genre).length) % pick.length].backdrop_path : null };
    }
    return {
      items: merged.map((r) => card(r)).filter(Boolean),
      more: got.some(({ json }) => (json.page || 1) < Math.min(json.total_pages || 1, 500)),
      kinds: allowed,
    };
  }

  // "Inspired by what you've watched": TMDB's recommendations for the titles you watched most
  // recently, mixed together, leaving out what you've already seen.
  async function inspiredPage(seeds, page) {
    if (!seeds.length) return { items: [], more: false };
    const picked = seeds.slice(0, 6);
    const lists = await Promise.all(picked.map((s) =>
      get(`/${s.kind}/${s.id}/recommendations`, { ...base, page: String(page) })
        .then((json) => ({ items: (json.results || []).map((r) => card(r, s.kind)).filter(Boolean), more: (json.page || 1) < (json.total_pages || 1) }))
        .catch(() => ({ items: [], more: false }))));
    const seen = new Set(seeds.map((s) => `${s.kind}:${s.id}`));
    const items = [];
    for (let i = 0; i < 20; i++) {
      for (const l of lists) {
        const c = l.items[i];
        if (c && !seen.has(`${c.kind}:${c.id}`)) { seen.add(`${c.kind}:${c.id}`); items.push(c); }
      }
    }
    return { items, more: lists.some((l) => l.more) };
  }

  async function page(spec, n = 1, seeds = []) {
    const p = String(n);
    switch (spec && spec.source) {
      case 'trending':
        return asPage(await get('/trending/all/week', { language: 'en-US', page: p }));
      case 'mine': {
        const f = await mine();
        if (!f) return { items: [], more: false };
        return asPage(await get(`/discover/${spec.kind}`, { ...base, ...f, sort_by: 'popularity.desc', page: p }), spec.kind);
      }
      case 'genre':
        return genrePage(spec, n);
      case 'inspired':
        return inspiredPage(seeds, n);
      default:
        return { items: [], more: false };
    }
  }

  // The home screen's TMDB rows (the Jellyfin ones come from jellyfin.js).
  async function home(seeds = []) {
    const specs = [
      { title: 'Inspired by what you\'ve watched', spec: { source: 'inspired' } },
      { title: 'Trending this week', spec: { source: 'trending' } },
      { title: 'Movies on your services', spec: { source: 'mine', kind: 'movie' } },
      { title: 'Shows on your services', spec: { source: 'mine', kind: 'tv' } },
    ];
    const pages = await Promise.all(specs.map((r) => page(r.spec, 1, seeds).catch((err) => {
      if (err.code === 'no-key' || err.code === 'bad-key') throw err;
      return { items: [], more: false };
    })));
    return specs.map((r, i) => ({ ...r, items: pages[i].items, more: pages[i].more })).filter((r) => r.items.length);
  }

  // Cards for titles known only by TMDB id (from Trakt), a few at a time.
  async function cards(refs) {
    const out = new Array(refs.length).fill(null);
    let next = 0;
    async function worker() {
      while (next < refs.length) {
        const i = next++;
        const r = refs[i];
        try { out[i] = card(await get(`/${r.kind}/${r.id}`, { language: 'en-US' }), r.kind); } catch { /* skip it */ }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    return out.filter(Boolean);
  }

  // A season's episodes by number: { 1: { name, overview }, ... }
  async function seasonEpisodes(tvId, season) {
    const r = await get(`/tv/${tvId}/season/${season}`, { language: 'en-US' });
    const out = {};
    for (const e of r.episodes || []) out[e.episode_number] = { name: e.name || '', overview: e.overview || '' };
    return out;
  }

  // Who made it and who's in it: directors / creators and writers first, then the main cast.
  function peopleOf(d, kind) {
    const out = [];
    const seen = new Set();
    const add = (p, role) => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      out.push({ kind: 'person', id: p.id, title: p.name, image: p.profile_path || null, sub: role });
    };
    const crew = (d.credits && d.credits.crew) || [];
    if (kind === 'tv') for (const p of d.created_by || []) add(p, 'Creator');
    for (const p of crew.filter((c) => c.job === 'Director').slice(0, 2)) add(p, 'Director');
    for (const p of crew.filter((c) => ['Screenplay', 'Writer', 'Novel'].includes(c.job)).slice(0, 2)) add(p, p.job === 'Novel' ? 'Novel' : 'Writer');
    for (const p of ((d.credits && d.credits.cast) || []).slice(0, 12)) add(p, p.character || p.roles?.[0]?.character || 'Cast');
    return out;
  }

  async function details(kind, id) {
    if (kind !== 'movie' && kind !== 'tv') throw Object.assign(new Error('Bad kind'), { code: 'failed' });
    const d = await get(`/${kind}/${id}`, { language: 'en-US', append_to_response: 'watch/providers,credits,external_ids' });
    const region = getRegion();
    const where = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[region]) || {};
    const names = (list) => (list || []).map((p) => p.provider_name);
    const flat = names(where.flatrate);
    const free = names(where.free);
    const ads = names(where.ads);
    const rent = names(where.rent);
    const buy = names(where.buy);
    const streaming = [...flat, ...free, ...ads];

    // On your services: included with the subscription, free, or free with ads.
    const serviceHow = {};
    for (const m of matchers) {
      if (flat.some((n) => m.re.test(n))) serviceHow[m.id] = 'included';
      else if (free.some((n) => m.re.test(n))) serviceHow[m.id] = 'free';
      else if (ads.some((n) => m.re.test(n))) serviceHow[m.id] = 'ads';
    }
    const onServices = Object.keys(serviceHow);

    // Your services that only sell it: Prime Video members, say, when Amazon only rents or sells
    // this one. Shown up front, so you know before you open Amazon.
    const rentOnly = [];
    const sold = (re) => {
      const r = rent.find((n) => re.test(n));
      const b = buy.find((n) => re.test(n));
      return r || b ? { store: r || b, rent: Boolean(r), buy: Boolean(b) } : null;
    };
    for (const m of matchers) {
      if (serviceHow[m.id] || !m.sellsAs) continue;
      const got = sold(m.sellsAs);
      if (got) rentOnly.push({ serviceId: m.id, storeId: m.storeId, ...got });
    }

    // Everywhere else: streaming on services you don't have, or rent/buy (and which).
    const ours = (n) => matchers.some((m) => (m.re.test(n) && (serviceHow[m.id] || rentOnly.some((r) => r.serviceId === m.id)))
      || (m.sellsAs && m.sellsAs.test(n) && (serviceHow[m.id] || rentOnly.some((r) => r.serviceId === m.id))));
    const how = new Map();
    for (const n of flat) if (!ours(n)) how.set(n, { how: 'streaming' });
    for (const n of [...free, ...ads]) if (!ours(n) && !how.has(n)) how.set(n, { how: 'free' });
    for (const n of [...rent, ...buy]) {
      if (ours(n) || (how.has(n) && how.get(n).how !== 'rent or buy')) continue;
      how.set(n, { how: 'rent or buy', rent: rent.includes(n), buy: buy.includes(n) });
    }
    const elsewhere = [...how].map(([name, h]) => ({ name, ...h }));

    const runtime = kind === 'movie'
      ? (d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : '')
      : (d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons === 1 ? '' : 's'}` : '');

    return {
      kind, id,
      title: d.title || d.name,
      meta: [year(d.release_date || d.first_air_date), runtime, (d.genres || []).slice(0, 3).map((g) => g.name).join(', ')]
        .filter(Boolean).join('  ·  '),
      rating: d.vote_count > 20 ? Math.round(d.vote_average * 10) / 10 : null,
      overview: d.overview || '',
      tagline: d.tagline || '',
      // How long it runs, in minutes: the film, or a typical episode.
      minutes: kind === 'movie' ? (d.runtime || null)
        : ((d.last_episode_to_air && d.last_episode_to_air.runtime) || (d.episode_run_time || [])[0] || null),
      people: peopleOf(d, kind),
      backdrop: d.backdrop_path || null,
      poster: d.poster_path || null,
      year: year(d.release_date || d.first_air_date),
      imdbId: /^tt\d+$/.test(d.imdb_id || '') ? d.imdb_id : (d.external_ids && /^tt\d+$/.test(d.external_ids.imdb_id || '') ? d.external_ids.imdb_id : null),
      onServices,
      serviceHow,
      rentOnly,
      elsewhere: elsewhere.slice(0, 14),
      region,
    };
  }

  const genreArt = (id) => genrePage({ genre: id, kind: 'all', art: true }, 1).then((r) => r.art || null);

  return { search, searchPage, person, details, home, page, genreList, genreArt, seasonEpisodes, cards, validate, reset: () => cache.clear() };
}

module.exports = { createTmdb };
