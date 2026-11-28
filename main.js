'use strict';

// SOFA King: one full-screen window holding three layers.
//   home    - our launcher, search and settings screens (ui/home.html)
//   service - the website currently open (Netflix, Hulu, TMDB...), created on demand
//   overlay - our menu and on-screen keyboard (ui/overlay.html), drawn on top
//
// Runs on castLabs "Electron for Content Security", which adds Widevine so DRM video plays.

const path = require('path');
const fs = require('fs');
const electron = require('electron');
const { app, BaseWindow, WebContentsView, ipcMain, session, clipboard, protocol, powerSaveBlocker } = electron;
const components = electron.components; // only present in the castLabs build
const { createTmdb } = require('./tmdb');
const { createPhoneRemote } = require('./phone');
const firewall = require('./firewall');
const gamescope = require('./gamescope');
const apps = require('./apps');
const { createJellyfin } = require('./jellyfin');
const { createWatchmode } = require('./watchmode');
const { createTrakt } = require('./trakt');
const player = require('./player');
const visuals = require('./visuals');
const crypto = require('crypto');
const http = require('http');
const livetv = require('./livetv');
const { createLogger } = require('./logger');
const { createThemes } = require('./themes');
const { createPlex } = require('./plex');
const { createMusic, MUSIC_SERVICES } = require('./music');
const { createSubsonic } = require('./subsonic');
const { createRadio, okUrl: radioUrlOk } = require('./radio');
const ytTools = require('./youtube');
const { createUpdater } = require('./updater');
const { createSuggester, rememberIn } = require('./suggest');
const { createLastfm, counts: lastfmCounts } = require('./lastfm');
const VERSION = require('./package.json').version;

// The app used to be called TV Overlay. The first time SOFA King starts, your settings, themes,
// sign-ins and logs move over from the old folder (~/.config/tv-overlay -> ~/.config/sofa-king).
// Anything already in the new folder stays; nothing is deleted.
(function moveOldFolder() {
  const now = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'tv-overlay');
  if (path.basename(now) !== 'sofa-king' || !fs.existsSync(old) || fs.existsSync(path.join(now, 'config.json'))) return;
  try {
    if (!fs.existsSync(now)) { fs.renameSync(old, now); return; }
    for (const name of fs.readdirSync(old)) {
      const to = path.join(now, name);
      if (!fs.existsSync(to)) fs.renameSync(path.join(old, name), to);
    }
    if (!fs.readdirSync(old).length) fs.rmdirSync(old);
  } catch { /* the old folder stays where it was; the app starts fresh */ }
  // The old log's name.
  try {
    const logs = path.join(now, 'logs');
    for (const f of fs.readdirSync(logs)) {
      const m = /^tv-overlay((\.\d+)?\.log)$/.exec(f);
      if (m && !fs.existsSync(path.join(logs, `sofa-king${m[1]}`))) fs.renameSync(path.join(logs, f), path.join(logs, `sofa-king${m[1]}`));
    }
  } catch { /* no logs yet */ }
}());

// The log (Settings → Developer). Secrets are hidden before anything is written.
const log = createLogger({
  dir: path.join(app.getPath('userData'), 'logs'),
  getSecrets: () => {
    try {
      if (!CONFIG) return [];
      return [CONFIG.tmdbKey, CONFIG.watchmodeKey, CONFIG.trakt && CONFIG.trakt.accessToken, CONFIG.trakt && CONFIG.trakt.refreshToken,
        CONFIG.trakt && CONFIG.trakt.clientSecret, ...(CONFIG.jellyfinServers || []).map((s) => s.token),
        CONFIG.plex && CONFIG.plex.accountToken, ...((CONFIG.plex && CONFIG.plex.servers) || []).map((s) => s.token),
        ...((CONFIG.music && CONFIG.music.servers) || []).map((s) => s.token), CONFIG.music && CONFIG.music.lastfmKey,
        CONFIG.music && CONFIG.music.lastfm && CONFIG.music.lastfm.secret, CONFIG.music && CONFIG.music.lastfm && CONFIG.music.lastfm.session].filter(Boolean);
    } catch {
      return []; // too early: settings not read yet
    }
  },
});
log.info(`---- SOFA King ${VERSION} starting (Electron ${process.versions.electron}, ${process.platform} ${require('os').release()})`);
const QRCode = require('qrcode');

// Layouts and colour schemes: built in, plus any of your own in ~/.config/sofa-king/themes.
const themes = createThemes({
  builtInDir: path.join(__dirname, 'themes'),
  userDir: path.join(electron.app.getPath('userData'), 'themes'),
  log: (...a) => log.info(...a),
});
// Sound files that can't be played as they are get converted with ffmpeg (see audioconvert.js).
const audioConvert = require('./audioconvert').createAudioConvert({
  cacheDir: path.join(electron.app.getPath('userData'), 'audio-cache'),
  env: apps.cleanEnv(),
  log: (...a) => log.info(...a),
});
themes.setPlayable(audioConvert.playable);
// Converts whatever needs it (each file only once), then sends the sounds out again if anything changed.
async function refreshAudio() {
  try {
    if (await audioConvert.prepare(themes.audioFiles(), CONFIG.convertAudio !== false)) applyThemeEverywhere();
  } catch (err) { log.warn('audio: converting failed:', err.message); }
}
// Older settings named the layouts differently.
const OLD_LAYOUTS = { hero: 'netflix', compact: 'rows', large: 'big-posters', xmb: 'ps3-xmb' };

// Posters from your Jellyfin servers: jfimg://<server id>/Items/<id>/Images/Primary, fetched with
// that server's sign-in so the page never sees a token.
protocol.registerSchemesAsPrivileged([{ scheme: 'jfimg', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Arrow keys move focus around web pages like a TV interface.
app.commandLine.appendSwitch('enable-spatial-navigation');

const WINDOWED = process.argv.includes('--windowed') || app.commandLine.hasSwitch('windowed');
const SERVICE_PARTITION = 'persist:tv'; // logins survive restarts
const MENU_KEYS = new Set(['F10', 'ContextMenu']); // keyboard / remote keys that open the overlay
const PRELOAD = path.join(__dirname, 'preload.js');
const ui = (file) => path.join(__dirname, 'ui', file);

const SERVICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8'));
const publicServices = () => SERVICES.map(({ id, name, color, match, free }) => ({ id, name, color, match: match || `^${name}`, free: Boolean(free) }));

// Pages opened the same way as a service, but not listed on the home screen.
const EXTRA_PAGES = [
  { id: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org/settings/api', returnLabel: 'Back to settings', grab: 'tmdb' },
  { id: 'watchmode-key', name: 'Watchmode', url: 'https://api.watchmode.com/requestApiKey/', returnLabel: 'Back to setup', grab: 'watchmode' },
  { id: 'trakt-join', name: 'Trakt', url: 'https://app.trakt.tv/', returnLabel: 'Back to setup' },
  { id: 'trakt-apps', name: 'Trakt developer apps', url: 'https://developer.trakt.tv/apps', returnLabel: 'Back to setup', grab: 'trakt', fill: 'trakt-app' },
  { id: 'lastfm-key', name: 'Last.fm', url: 'https://www.last.fm/api/account/create', returnLabel: 'Back to setup', grab: 'lastfm' },
  { id: 'vacuumtube-info', name: 'VacuumTube', url: 'https://github.com/shy1132/VacuumTube', returnLabel: 'Back' },
  { id: 'mpv-info', name: 'mpv', url: 'https://mpv.io', returnLabel: 'Back' },
  { id: 'decky', name: 'Decky Loader', url: 'https://decky.xyz', returnLabel: 'Back to settings' },
  { id: 'decky-inhibit', name: 'DeckyInhibitScreenSaver', url: 'https://github.com/xfangfang/DeckyInhibitScreenSaver', returnLabel: 'Back to settings' },
];
// Rent-or-buy stores: not "your services", but every store shown on a title's page opens somewhere.
const STORES = JSON.parse(fs.readFileSync(path.join(__dirname, 'stores.json'), 'utf8'));
const findPage = (id) => SERVICES.find((s) => s.id === id) || STORES.find((s) => s.id === id) || EXTRA_PAGES.find((p) => p.id === id) ||
  MUSIC_SERVICES.find((p) => p.id === id);

// ---------------------------------------------------------------- config
//
// Settings saved from the app live in ~/.config/sofa-king/config.json.
// A config.json next to this file, or TMDB_KEY / TV_REGION in the environment, also work.

const KEY_PATTERN = /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|[a-f0-9]{32})$/i;
const maskKey = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
const userConfigFile = () => path.join(app.getPath('userData'), 'config.json');

function cleanTrakt(t) {
  const str = (v) => (typeof v === 'string' ? v : '');
  t = t && typeof t === 'object' ? t : {};
  return {
    clientId: str(t.clientId), clientSecret: str(t.clientSecret),
    accessToken: str(t.accessToken), refreshToken: str(t.refreshToken), expiresAt: Number(t.expiresAt) || 0,
    username: str(t.username),
    redirectUri: str(t.redirectUri),
    rows: t.rows !== false, // Trakt rows on the home screen
    scrobble: t.scrobble === true, // off: the Jellyfin Trakt plugin may already do this
  };
}

// Plex: the sign-in (the account's token) and the servers found with it.
function cleanPlexConfig(saved) {
  const p = saved && typeof saved === 'object' ? saved : {};
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    clientId: str(p.clientId),
    accountToken: str(p.accountToken),
    userName: str(p.userName),
    servers: (Array.isArray(p.servers) ? p.servers : []).filter((x) => x && typeof x.id === 'string' && x.id.startsWith('plex-')).map((x) => ({
      id: x.id, type: 'plex', name: str(x.name) || 'Plex', url: str(x.url), token: str(x.token), userId: 'plex',
      machineId: str(x.machineId), owned: Boolean(x.owned), enabled: x.enabled !== false,
      addresses: Array.isArray(x.addresses) ? x.addresses.filter((a) => typeof a === 'string').slice(0, 8) : [],
    })),
  };
}

function loadConfig() {
  const merged = { ...readJson(path.join(__dirname, 'config.json')), ...readJson(userConfigFile()) };
  const key = String(process.env.TMDB_KEY || merged.tmdbKey || '').trim();
  return {
    tmdbKey: KEY_PATTERN.test(key) ? key : '',
    region: String(process.env.TV_REGION || merged.region || 'US').toUpperCase(),
    phonePort: Number(merged.phonePort) || 8765,
    showHints: merged.showHints !== false,
    soundEffects: merged.soundEffects !== false, // on by default
    convertAudio: merged.convertAudio !== false, // other sound formats converted with ffmpeg (on by default)
    pauseOnMenu: merged.pauseOnMenu === true, // off by default: the video keeps playing behind the menu
    jellyfinPlayer: ['mpv', 'desktop', 'web'].includes(merged.jellyfinPlayer) ? merged.jellyfinPlayer : 'mpv',
    playback: cleanPlayback(merged.playback),
    mpvBindings: cleanMpvBindings(merged.mpvBindings),
    jellyfinServers: Array.isArray(merged.jellyfinServers) ? merged.jellyfinServers.filter((s) => s && s.id && s.url) : [],
    jellyfinDeviceId: typeof merged.jellyfinDeviceId === 'string' ? merged.jellyfinDeviceId : '',
    plex: cleanPlexConfig(merged.plex),
    music: cleanMusicConfig(merged.music),
    radio: cleanRadioConfig(merged.radio),
    youtube: cleanYouTubeConfig(merged.youtube),
    updates: cleanUpdatesConfig(merged.updates),
    suggest: cleanSuggestConfig(merged.suggest),
    bindings: cleanBindings(merged.bindings),
    debugLog: merged.debugLog === true,
    mpvScreen: Number.isInteger(merged.mpvScreen) ? merged.mpvScreen : null, // null: the app's own screen
    // Speakers in mpv (the sound button steps through these, and the last one picked is kept).
    mpvVolume: Number.isInteger(merged.mpvVolume) && merged.mpvVolume >= 0 && merged.mpvVolume <= 130 ? merged.mpvVolume : null,
    mpvSound: player.SOUND_CHOICES.some((c) => c.value === merged.mpvSound) ? merged.mpvSound : 'auto-safe',
    mpvVisual: visuals.visualIds.includes(merged.mpvVisual) ? merged.mpvVisual : 'cover',
    gamescope: cleanGamescope(merged.gamescope),
    fullScreen: merged.fullScreen !== false, // the app fills the screen (unless started with --windowed)
    motion: merged.motion !== false, // animations (off: everything moves straight to where it's going)
    kbConfirm: merged.kbConfirm !== false, // "are you sure?" before sending or cancelling typing (on by default)
    appPaths: merged.appPaths && typeof merged.appPaths === 'object' ? merged.appPaths : {},
    layout: typeof merged.layout === 'string' ? merged.layout
      : (typeof merged.homeRows === 'string' ? OLD_LAYOUTS[merged.homeRows] || merged.homeRows : 'netflix'),
    look: cleanLook(merged),
    watchmodeKey: typeof merged.watchmodeKey === 'string' ? merged.watchmodeKey : '',
    trakt: cleanTrakt(merged.trakt),
    live: cleanLive(merged.live),
    history: Array.isArray(merged.history)
      ? merged.history.filter((h) => h && (h.kind === 'movie' || h.kind === 'tv') && Number.isInteger(h.id)).slice(0, 30) : [],
  };
}

// The chosen theme, or your custom one. (Older settings only had a colour scheme: that becomes a
// custom theme based on Classic.)
function cleanLook(merged) {
  const l = merged.look && typeof merged.look === 'object' ? merged.look : null;
  if (l && typeof l.theme === 'string') {
    const custom = l.custom && typeof l.custom === 'object' ? l.custom : null;
    return { theme: l.theme === 'custom' && !custom ? 'classic' : l.theme, custom, base: typeof l.base === 'string' ? l.base : 'classic' };
  }
  if (typeof merged.colors === 'string' && merged.colors !== 'midnight') {
    return { theme: 'custom', base: 'classic', custom: { colors: merged.colors, display: 'clean', text: 'clean', sounds: 'classic' } };
  }
  return { theme: 'classic', custom: null, base: 'classic' };
}

// Music: your Navidrome / Subsonic servers (with the folders to look in), and the music services
// you use (null: all of them).
function cleanMusicConfig(m) {
  const x = m && typeof m === 'object' ? m : {};
  const ids = new Set(MUSIC_SERVICES.map((s) => s.id));
  return {
    servers: (Array.isArray(x.servers) ? x.servers : []).filter((s) => s && /^sub-[0-9a-f]+$/.test(s.id) && s.url && s.user && s.token && s.salt)
      .map((s) => ({ id: s.id, type: 'subsonic', name: String(s.name || 'Navidrome'), kind: String(s.kind || ''), url: s.url, user: s.user, token: s.token, salt: s.salt, get: s.get === true,
        folders: Array.isArray(s.folders) ? s.folders.map(String).slice(0, 50) : [] })),
    services: Array.isArray(x.services) ? x.services.filter((id) => ids.has(id)) : null,
    useJellyfin: x.useJellyfin !== false,
    usePlex: x.usePlex !== false,
    // Recommendations: your ListenBrainz name (public), and a Last.fm key for related artists.
    listenbrainz: typeof x.listenbrainz === 'string' && /^[\w.@+-]{1,64}$/.test(x.listenbrainz) ? x.listenbrainz : '',
    lastfmKey: typeof x.lastfmKey === 'string' && /^[0-9a-f]{32}$/.test(x.lastfmKey) ? x.lastfmKey : '',
    // Scrobbling: the key's shared secret, and the session from signing in (with your user name).
    // Scrobbling itself is on by default once you've signed in.
    lastfm: cleanLastfm(x.lastfm),
    // Which of the slower shelves an artist's page shows.
    shelves: Object.fromEntries(['unofficial', 'tribute', 'appears', 'related'].map((k) => [k, !(x.shelves && x.shelves[k] === false)])),
  };
}

function cleanLastfm(l) {
  const x = l && typeof l === 'object' ? l : {};
  const hex = (v) => (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v) ? v.toLowerCase() : '');
  const session = typeof x.session === 'string' && /^[\w-]{16,64}$/.test(x.session) ? x.session : '';
  return {
    secret: hex(x.secret), session, user: session && typeof x.user === 'string' ? x.user.slice(0, 64) : '', scrobble: x.scrobble !== false,
    // Servers whose plays aren't scrobbled (say one already sends them to Last.fm itself). New
    // servers are scrobbled until switched off here.
    skip: Array.isArray(x.skip) ? x.skip.filter((id) => typeof id === 'string' && id.length < 100).slice(0, 50) : [],
  };
}

// Radio: your own stations, your favourites, SomaFM on or off, and the country for "Popular".
function cleanStation(x) {
  if (!x || typeof x !== 'object') return null;
  const st = {
    id: String(x.id || '').slice(0, 80), name: String(x.name || '').slice(0, 120), url: String(x.url || '').slice(0, 1000),
    logo: /^https?:\/\//.test(String(x.logo || '')) ? String(x.logo).slice(0, 1000) : '', about: String(x.about || '').slice(0, 200),
    source: ['radio-browser', 'somafm', 'mine'].includes(x.source) ? x.source : 'mine', uuid: /^[0-9a-f-]{36}$/.test(String(x.uuid || '')) ? x.uuid : '',
  };
  return st.id && st.name && radioUrlOk(st.url) ? st : null;
}
// YouTube: where it opens, and the TV page's extras (all off until switched on).
// Updates (Settings → General → Updates). Test versions are on by default when this copy is one.
function cleanUpdatesConfig(u) {
  const x = u && typeof u === 'object' ? u : {};
  return {
    check: x.check !== false,
    prerelease: typeof x.prerelease === 'boolean' ? x.prerelease : VERSION.includes('-'),
    lastCheck: Number(x.lastCheck) || 0,
    toldAbout: typeof x.toldAbout === 'string' ? x.toldAbout.slice(0, 40) : '',
  };
}

// Suggestions while typing: on or off, whether searches are remembered, and the remembered ones
// (newest first) for each place you search.
const PAST_PLACES = ['search', 'music', 'radio', 'web'];
function cleanSuggestConfig(g) {
  const x = g && typeof g === 'object' ? g : {};
  const past = {};
  for (const k of PAST_PLACES) {
    past[k] = Array.isArray(x.past && x.past[k]) ? x.past[k].filter((p) => typeof p === 'string' && p.trim()).map((p) => p.slice(0, 100)).slice(0, 50) : [];
  }
  return { on: x.on !== false, remember: x.remember !== false, past };
}

function cleanYouTubeConfig(y) {
  const x = y && typeof y === 'object' ? y : {};
  const cats = Array.isArray(x.sbCategories) ? x.sbCategories.filter((c) => ytTools.SB_CATEGORIES.some((k) => k.id === c)) : ['sponsor'];
  return {
    open: ['auto', 'tv', 'website'].includes(x.open) ? x.open : 'auto',
    adblock: x.adblock === true, sponsorblock: x.sponsorblock === true, dislikes: x.dislikes === true, dearrow: x.dearrow === true,
    sbCategories: [...new Set(cats)],
  };
}
function cleanRadioConfig(r) {
  const x = r && typeof r === 'object' ? r : {};
  return {
    stations: (Array.isArray(x.stations) ? x.stations : []).map(cleanStation).filter(Boolean).slice(0, 200),
    favorites: (Array.isArray(x.favorites) ? x.favorites : []).map(cleanStation).filter(Boolean).slice(0, 200),
    recent: (Array.isArray(x.recent) ? x.recent : []).map(cleanStation).filter(Boolean).slice(0, 20), // listened to lately, newest first
    somafm: x.somafm !== false,
    country: typeof x.country === 'string' && /^[A-Z]{2}$/.test(x.country) ? x.country : null,
  };
}

function saveUserConfig(patch) {
  const file = userConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...readJson(file), ...patch }, null, 2), { mode: 0o600 });
}

let CONFIG = {
  tmdbKey: '', region: 'US', phonePort: 8765, showHints: true, jellyfinServers: [], jellyfinDeviceId: '', bindings: null,
  playback: null, mpvBindings: null, music: { servers: [], services: null, useJellyfin: true, usePlex: true, listenbrainz: '', lastfmKey: '', lastfm: cleanLastfm(null), shelves: { unofficial: true, tribute: true, appears: true, related: true } },
  radio: { stations: [], favorites: [], recent: [], somafm: true, country: null },
  youtube: { open: 'auto', adblock: false, sponsorblock: false, dislikes: false, dearrow: false, sbCategories: ['sponsor'] },
  updates: cleanUpdatesConfig(null),
  suggest: cleanSuggestConfig(null),
};

const tmdb = createTmdb({ getKey: () => CONFIG.tmdbKey, getRegion: () => CONFIG.region, services: SERVICES, stores: STORES });
let watchmode = null; // made once the config folder is known (it keeps a cache there)
const trakt = createTrakt({
  getAuth: () => CONFIG.trakt,
  saveAuth: (next) => {
    CONFIG.trakt = { ...CONFIG.trakt, ...next };
    saveUserConfig({ trakt: CONFIG.trakt });
    if (!CONFIG.trakt.accessToken) home?.webContents.send('settings:changed', settingsState());
  },
});

const traktState = () => {
  const t = CONFIG.trakt || {};
  return {
    hasApp: Boolean(t.clientId),
    connected: Boolean(t.accessToken),
    signedOut: Boolean(t.clientId && t.username && !t.accessToken),
    username: t.username || '', rows: t.rows !== false, scrobble: Boolean(t.scrobble),
  };
};

const layoutState = () => {
  const l = themes.layout(CONFIG.layout);
  return { id: l.id, name: l.name, behavior: l.behavior, colors: l.colors, css: l.css };
};

// The look in use: the chosen mood's (or saved theme's), or your custom one.
function currentLook() {
  const L = CONFIG.look;
  if (L.theme === 'custom' && L.custom) {
    // Before effects were pieces, a custom theme had one switch for its base theme's effects.
    if (typeof L.custom.effects === 'boolean') {
      const base = themes.theme(L.base);
      L.custom = { ...L.custom, effects: L.custom.effects && base ? base.look.effects : [] };
    }
    return themes.resolve(L.custom);
  }
  const t = themes.theme(L.theme) || themes.theme('classic');
  return themes.resolve(t ? t.look : {});
}
function lookState() {
  const L = CONFIG.look;
  const look = currentLook();
  const chosen = L.theme === 'custom' ? null : themes.theme(L.theme);
  const pieces = themes.piecesCss(look);
  return {
    theme: chosen ? chosen.id : 'custom',
    name: chosen ? chosen.name : 'Custom',
    base: L.theme === 'custom' ? (themes.theme(L.base) || { name: 'Classic' }).name : '',
    look,
    // The effects' and background's CSS, for Home (see applyLook in ui/home.js).
    piecesCss: pieces.css,
  };
}

// Colours and fonts go into every screen (Home, the menu, the controls strip), put in again whenever
// a screen loads and swapped in place when you change them. Home also gets every font, for the
// font pickers. (A layout's CSS and a theme's effects go to Home with the settings.)
const themeKeys = new WeakMap();
const allFontKeys = new WeakMap();
async function applyTheme(wc, isHome, { fonts = false } = {}) {
  if (!wc || wc.isDestroyed()) return;
  const old = themeKeys.get(wc) || [];
  try {
    if (isHome && (fonts || !allFontKeys.has(wc))) {
      const before = allFontKeys.get(wc);
      allFontKeys.set(wc, await wc.insertCSS(themes.allFontsCss(), { cssOrigin: 'author' }));
      if (before) await wc.removeInsertedCSS(before);
    }
    themeKeys.set(wc, [await wc.insertCSS(themes.lookCss(currentLook()), { cssOrigin: 'author' })]);
    for (const k of old) await wc.removeInsertedCSS(k);
  } catch (err) { log.warn('theme: could not apply:', err.message); }
}
function applyThemeEverywhere({ fonts = false } = {}) {
  if (home) applyTheme(home.webContents, true, { fonts });
  if (overlay) applyTheme(overlay.webContents, false);
  if (hints) applyTheme(hints.webContents, false);
  if (win) win.setBackgroundColor(themes.scheme(currentLook().colors).colors.bg);
  const spec = themes.soundSpec(currentLook());
  for (const v of [home, overlay, hints]) if (v && !v.webContents.isDestroyed()) v.webContents.send('sound:set', spec);
}

const settingsState = () => ({
  hasKey: Boolean(CONFIG.tmdbKey), masked: maskKey(CONFIG.tmdbKey), region: CONFIG.region, showHints: CONFIG.showHints,
  watchmode: { hasKey: Boolean(CONFIG.watchmodeKey), masked: maskKey(CONFIG.watchmodeKey) },
  trakt: traktState(),
  pauseOnMenu: CONFIG.pauseOnMenu,
  soundEffects: CONFIG.soundEffects,
  layout: layoutState(),
  look: lookState(),
  kbConfirm: CONFIG.kbConfirm,
  suggest: { on: CONFIG.suggest.on, remember: CONFIG.suggest.remember, past: PAST_PLACES.reduce((n, k) => n + CONFIG.suggest.past[k].length, 0) },
  fullScreen: Boolean(win && !win.isDestroyed() && (win.isKiosk() || win.isFullScreen())),
  mpvScreen: CONFIG.mpvScreen,
  motion: CONFIG.motion,
  jellyfinPlayer: CONFIG.jellyfinPlayer,
  playback: CONFIG.playback,
});

// Check a key with TMDB, then save it. An empty key removes the saved one.
async function setKey(raw) {
  const key = String(raw || '').trim();
  if (key && !KEY_PATTERN.test(key)) return { error: 'not-a-key' };
  if (key) {
    const check = await tmdb.validate(key);
    if (check !== 'ok') return { error: check };
  }
  CONFIG.tmdbKey = key;
  saveUserConfig({ tmdbKey: key });
  tmdb.reset();
  home?.webContents.send('settings:changed', settingsState());
  return { ok: true, masked: maskKey(key) };
}

// ---------------------------------------------------------------- state

let win = null;
let home = null;
let overlay = null;
let service = null;        // WebContentsView of the open website
let current = null;        // services.json / EXTRA_PAGES entry for it
let overlayOpen = false;   // menu showing
let quitAsking = false;    // the menu's "Quit SOFA King?" question is up
let keyboardOpen = false;  // on-screen keyboard showing over a website
let serviceField = null;   // { label, kind } of the text field focused on the website, if any
let keyboardField = null;  // the field the keyboard is typing into (kept while the website blinks its focus)
let homeOverService = false; // Settings opened from the menu, shown over the website
let resumeOnClose = false;   // the menu paused a video (only with "pause when the menu opens" on)
let hints = null;            // the controls strip shown over websites
let servicePlaying = false;  // a video is playing on the website

// ---------------------------------------------------------------- phone remote

let phoneSeen = false; // has anything on the network reached the remote yet?

const phone = createPhoneRemote({
  getPort: () => CONFIG.phonePort,
  handlers: {
    log: () => logForPhone(),
    seen: () => {
      if (phoneSeen) return;
      phoneSeen = true;
      home?.webContents.send('phone:connected');
      overlay?.webContents.send('phone:connected');
    },
    text: (text) => {
      text = text.slice(0, 500);
      if (!text) return;
      if (service) {
        service.webContents.insertText(text);
        if (keyboardOpen) overlay.webContents.send('kb:typed', text);
      } else {
        home.webContents.send('remote:text', text);
      }
    },
    key: (name) => {
      if (!['Enter', 'Backspace', 'Tab'].includes(name)) return;
      if (service) {
        sendNamedKey(service.webContents, name);
        if (keyboardOpen && name === 'Backspace') overlay.webContents.send('kb:typed', '\b');
      } else {
        home.webContents.send('remote:key', name);
      }
    },
    tmdb: (key) => setKey(key),
    setKey: async (kind, text) => {
      const r = await setAnyKey(kind, text);
      if (r.ok) home?.webContents.send('setup:key-saved', kind); // the setup screen moves on
      return r;
    },
  },
});

const phoneLabel = () => (service ? (serviceField ? serviceField.label : current.name) : 'Search');

function updatePhoneState() {
  phone.setState({ label: phoneLabel(), kind: service && serviceField ? serviceField.kind : 'text' });
}

// ---------------------------------------------------------------- views

function makeView({ partition, transparent } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, sandbox: true, partition,
      // Our own screens play little sounds on controller presses, which aren't "clicks" to Chromium.
      ...(partition ? {} : { autoplayPolicy: 'no-user-gesture-required' }),
    },
  });
  if (transparent) view.setBackgroundColor('#00000000');

  // Catch our keys before the website sees them.
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (MENU_KEYS.has(input.key)) {
      event.preventDefault();
      toggleOverlay();
    } else if (input.key === 'BrowserBack') {
      event.preventDefault();
      handleAction(view.webContents, 'back');
    }
  });
  return view;
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  for (const v of [home, service, overlay]) if (v) v.setBounds({ x: 0, y: 0, width, height });
  if (hints) {
    // A small strip at the bottom: it only covers its own area, so the site stays usable around it.
    const w = Math.min(1000, width - 40);
    const h = Math.round(Math.max(54, height * 0.075));
    hints.setBounds({ x: Math.round((width - w) / 2), y: height - h - 16, width: w, height: h });
  }
}

// Keep our layers above the website: the controls strip, then the menu/keyboard on top.
function restack() {
  win.contentView.addChildView(hints);
  win.contentView.addChildView(overlay);
}

// The controls strip shows over a website you're browsing, but not over a playing video,
// the menu, the keyboard or Settings, and not at all if it's switched off.
function updateHints() {
  if (!hints) return;
  hints.setVisible(Boolean(CONFIG.showHints && service && !homeOverService && !overlayOpen && !keyboardOpen && !servicePlaying));
}

const activeView = () => (service && !homeOverService ? service : home);

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 720,
    kiosk: !WINDOWED && CONFIG.fullScreen,
    fullscreen: !WINDOWED && CONFIG.fullScreen,
    backgroundColor: themes.scheme(currentLook().colors).colors.bg,
    title: 'SOFA King',
  });

  home = makeView();
  home.webContents.on('dom-ready', () => { allFontKeys.delete(home.webContents); applyTheme(home.webContents, true); });
  home.webContents.loadFile(ui('home.html'));

  overlay = makeView({ transparent: true });
  overlay.webContents.on('dom-ready', () => applyTheme(overlay.webContents, false));
  overlay.webContents.loadFile(ui('overlay.html'));

  hints = makeView({ transparent: true });
  hints.webContents.on('dom-ready', () => applyTheme(hints.webContents, false));
  hints.webContents.loadFile(ui('hints.html'));

  win.contentView.addChildView(home);
  restack();
  overlay.setVisible(false);
  hints.setVisible(false);

  layout();
  win.on('resize', layout);
  win.on('closed', () => app.quit());
  home.webContents.once('did-finish-load', () => home.webContents.focus());
}

// ---------------------------------------------------------------- services

// User-origin !important styles win over the site's own, including sites that hide focus outlines.
const FOCUS_CSS = `
  :focus-visible {
    outline: 4px solid #ffd400 !important;
    outline-offset: 3px !important;
    box-shadow: 0 0 0 9px rgba(11, 11, 16, 0.75) !important;
    border-radius: 4px;
  }
  html[data-tv-playing] :focus-visible { outline: none !important; box-shadow: none !important; }
`;

const YOUTUBE = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)(\/|$)/i;
let hasVacuumTube = false; // refreshed whenever we look


async function checkVacuumTube() {
  hasVacuumTube = Boolean(await apps.locate('vacuumtube'));
  return hasVacuumTube;
}

// Open a page from services.json / EXTRA_PAGES (by id) or a page object. YouTube goes where
// Settings → YouTube says (see openYouTube).
async function openPage(id, query) {
  const def = typeof id === 'object' ? id : findPage(id);
  if (!def) return;
  if (def.id === 'youtube') return openYouTube(query ? { search: query } : {});
  openService(def, query);
}

// YouTube, wherever it should open: { videoId, playlistId } or { search }, or nothing for its home.
//   Automatic: VacuumTube when it's installed, else YouTube's TV page here.
//   TV page:   always YouTube's TV page here (with the extras from Settings → YouTube).
//   Website:   youtube.com, as it looks on a computer.
// VacuumTube gets a plain YouTube address: it reliably opens videos (an album: its first song,
// with the rest after it); searches are up to YouTube's TV page there.
const ytDef = () => ({ ...findPage('youtube'), tvPage: true, url: ytTools.TV_URL, searchUrl: null });
async function openYouTube(target = {}, { music = false } = {}) {
  const mode = CONFIG.youtube.open;
  if (mode === 'website') {
    const url = ytTools.watchLink(target, music ? 'music.youtube.com' : 'www.youtube.com');
    return openService({ ...findPage('youtube'), id: music ? 'youtube-music' : 'youtube', name: music ? 'YouTube Music' : 'YouTube', url, searchUrl: null });
  }
  const tvHere = () => openService({ ...ytDef(), url: ytTools.tvLink(target) });
  if (mode === 'auto' && await checkVacuumTube()) {
    // (The address goes last, on its own: every VacuumTube version reads it that way.)
    const r = await handOff('vacuumtube', [ytTools.vacuumTubeLink(target)], tvHere);
    if (r.ok) return;
  }
  tvHere();
}
const youtubeElsewhere = () => CONFIG.youtube.open !== 'website';

function openService(id, query) {
  const def = typeof id === 'object' ? id : findPage(id);
  if (!def) return;
  const url = query && def.searchUrl ? def.searchUrl.replace('{q}', encodeURIComponent(query)) : def.url;
  log.debug('[web] opening', def.id, url);

  closeService();
  homeOverService = false;
  current = def;
  service = makeView({ partition: SERVICE_PARTITION });

  // Sites that open pop-ups: keep everything in this one view.
  service.webContents.setWindowOpenHandler(({ url: target }) => {
    if (YOUTUBE.test(target) && youtubeElsewhere() && !def.tvPage && def.id !== 'youtube') openYouTube(ytTools.parseLink(target));
    else if (/^https?:/.test(target)) service.webContents.loadURL(target).catch(() => {});
    return { action: 'deny' };
  });
  // A YouTube link on another site (a trailer, say) opens in VacuumTube or the TV page instead.
  service.webContents.on('will-navigate', (event, target) => {
    if (def.id !== 'youtube' && !def.tvPage && !/^youtube-music|^link-/.test(def.id) && youtubeElsewhere() && YOUTUBE.test(target)) {
      event.preventDefault();
      openYouTube(ytTools.parseLink(target));
    }
  });
  // YouTube's TV page: it only opens for TVs, and gets the extras you switched on.
  if (def.tvPage) service.webContents.setUserAgent(ytTools.TV_UA);
  // The Jellyfin web player: sign it in with our saved login, then show the title.
  if (def.jellyfinServer) {
    service.webContents.once('dom-ready', async () => {
      try {
        if (service && await service.webContents.executeJavaScript(jf.webSignInScript(def.jellyfinServer), true)) {
          service.webContents.reload();
        }
      } catch { /* the person can still sign in by hand */ }
    });
  }
  service.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { serviceField = null; updatePhoneState(); }
  });
  // A bold highlight on whatever the D-pad has selected.
  service.webContents.on('dom-ready', () => {
    if (service) service.webContents.insertCSS(FOCUS_CSS, { cssOrigin: 'user' }).catch(() => {});
  });
  // Setup pages: fill in the boring parts of a form (Trakt's new-app form, its activate code).
  if (def.fill) {
    service.webContents.on('dom-ready', () => {
      if (service) service.webContents.executeJavaScript(fillScript(def.fill, def.fillValue), true).catch(() => {});
    });
  }

  servicePlaying = false;
  win.contentView.addChildView(service);
  restack(); // re-adding moves our layers back above the website
  layout();
  home.setVisible(false);
  hideOverlay();

  const view = service;
  const load = () => { if (service === view && !view.webContents.isDestroyed()) view.webContents.loadURL(url).catch(() => {}); }; // errors show on the page itself
  if (def.tvPage) setUpTvPage(service.webContents).finally(load); else load();
  service.webContents.focus();
  updatePhoneState();
  updateHints();
}

function closeService() {
  if (!service) return;
  closeKeyboard();
  win.contentView.removeChildView(service);
  service.webContents.close(); // stops playback and frees memory; login stays in the partition
  service = null;
  current = null;
  serviceField = null;
  servicePlaying = false;
  updateHints();
}

function goHome() {
  homeOverService = false;
  lastPlace = 'menu';
  closeService();
  home.setVisible(true);
  hideOverlay();
  home.webContents.focus();
  home.webContents.send('home:shown');
  updatePhoneState();
}

// ---------------------------------------------------------------- settings from the menu
//
// While a website is open, Settings is drawn over it and the website stays paused underneath,
// so leaving Settings goes straight back to what you were watching.

function showSettings() {
  hideOverlay();
  if (service) {
    homeOverService = true;
    win.contentView.addChildView(home);
    restack();
    home.setVisible(true);
  }
  updateHints();
  home.webContents.focus();
  home.webContents.send('open-settings', { overService: Boolean(service), name: current ? current.name : null });
}

function returnToService() {
  if (!homeOverService || !service) return;
  homeOverService = false;
  home.setVisible(false);
  service.webContents.focus();
  updateHints();
}

// ---------------------------------------------------------------- menu

const PAUSE_JS = `(() => {
  const v = [...document.querySelectorAll('video')].find((v) => !v.paused);
  if (v) { v.pause(); return true; }
  return false;
})()`;
const RESUME_JS = `(() => { const v = [...document.querySelectorAll('video')].find((v) => v.paused && v.readyState > 0); if (v) v.play().catch(() => {}); })()`;

// Play / pause: toggles the main video on the page (the biggest one). Returns false if there isn't one.
const TOGGLE_PLAY_JS = `(() => {
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0);
  if (!vids.length) return false;
  const v = vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (v.paused) v.play().catch(() => {}); else v.pause();
  return true;
})()`;

function showOverlay() {
  if (overlayOpen) return;
  closeKeyboard();
  overlayOpen = true;
  resumeOnClose = false;
  // By default the menu leaves the video playing. With "pause when the menu opens" switched on,
  // pause it alongside showing the menu (never before: a busy site can take seconds to answer).
  if (CONFIG.pauseOnMenu && service) {
    Promise.race([
      service.webContents.executeJavaScript(PAUSE_JS, true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ]).then((paused) => { if (overlayOpen && paused) resumeOnClose = true; }, () => {});
  }
  restack();
  overlay.setVisible(true);
  updateHints();
  overlay.webContents.send('overlay-state', {
    motion: CONFIG.motion,
    mode: 'menu',
    service: current
      ? {
        id: current.id, name: current.name, returnLabel: current.returnLabel || null, grabKey: Boolean(current.grab),
        grabLabel: current.grab === 'trakt' ? 'Use the Client ID on this page' : 'Use the key on this page',
      }
      : null,
    services: publicServices(),
  });
  overlay.webContents.focus();
}

// resume: closing the menu to carry on watching (not leaving for somewhere else).
function hideOverlay(resume = false) {
  if (!overlayOpen) return;
  overlayOpen = false;
  quitAsking = false;
  overlay.setVisible(false);
  updateHints();
  activeView().webContents.focus();
  if (resume && resumeOnClose && service) {
    service.webContents.executeJavaScript(RESUME_JS, true).catch(() => {});
  }
  resumeOnClose = false;
}

// One press of Start can be seen by two pages (the one you were on, and the menu as it appears):
// a second toggle straight after the first is the same press, so it's ignored.
let lastToggle = 0;
// While watching, Start closes the menu (or Settings, opened from it) straight away, and the next
// Start opens whichever it was again, where you left it.
let lastPlace = 'menu';
function toggleOverlay() {
  const now = Date.now();
  if (now - lastToggle < 350) return;
  lastToggle = now;
  if (homeOverService) { lastPlace = 'settings'; returnToService(); return; }
  if (overlayOpen) { lastPlace = 'menu'; hideOverlay(true); return; }
  if (service && lastPlace === 'settings') { showSettings(); return; }
  showOverlay();
}

// ---------------------------------------------------------------- on-screen keyboard for websites
//
// The keyboard is drawn by the overlay page, but the website keeps keyboard focus so the
// text field stays active. Controller presses are routed to the overlay to move around the
// keys, and the keys' letters are inserted into the website.

async function openKeyboard() {
  if (!service || overlayOpen || keyboardOpen) return;
  keyboardOpen = true;
  keyboardField = serviceField;
  updatePhoneState();
  const phoneInfo = await phone.start().catch(() => null);
  if (!keyboardOpen) return;
  restack();
  overlay.setVisible(true);
  updateHints();
  service.webContents.send('kb:mode', true); // L2 / R2 are Shift now, not mouse clicks
  overlay.webContents.send('overlay-state', {
    motion: CONFIG.motion,
    mode: 'keyboard',
    kbConfirm: CONFIG.kbConfirm,
    suggest: CONFIG.suggest.on,
    field: serviceField,
    phone: phoneInfo && !phoneInfo.error ? { ...phoneInfo, seen: phoneSeen } : null,
  });
  service.webContents.focus();
}

function closeKeyboard() {
  if (!keyboardOpen) return;
  keyboardOpen = false;
  overlay.setVisible(false);
  updateHints();
  if (service) { service.webContents.send('kb:mode', false); service.webContents.focus(); }
}

function sendNamedKey(wc, name) {
  if (name === 'Enter') pressKey(wc, 'Enter', '\r');
  else if (name === 'Backspace') pressKey(wc, 'Backspace');
  else if (name === 'Tab') pressKey(wc, 'Tab');
}

// A website reports its focused text field (from preload.js).
ipcMain.on('field', (event, info) => {
  if (!service || event.sender !== service.webContents) return;
  if (info && info.focused) {
    serviceField = { label: String(info.label || 'Text').slice(0, 60), kind: ['password', 'search', 'email'].includes(info.kind) ? info.kind : 'text' };
    if (keyboardOpen) { keyboardField = serviceField; overlay.webContents.send('kb:field', serviceField); }
  } else {
    serviceField = null;
  }
  updatePhoneState();
});

const fromOverlay = (event) => event.sender === overlay?.webContents;

ipcMain.on('kb:type', (event, text) => {
  if (fromOverlay(event) && service && keyboardOpen) service.webContents.insertText(String(text).slice(0, 500));
});
ipcMain.on('kb:key', (event, name) => {
  if (fromOverlay(event) && service && keyboardOpen) sendNamedKey(service.webContents, String(name));
});
ipcMain.on('kb:close', (event, submit) => {
  if (!fromOverlay(event) || !keyboardOpen) return;
  closeKeyboard();
  if (submit && service) sendNamedKey(service.webContents, 'Enter');
});

// The website says whether a video is playing (from preload.js), so the strip can step aside.
ipcMain.on('playing', (event, playing) => {
  if (!service || event.sender !== service.webContents) return;
  servicePlaying = Boolean(playing);
  updateHints();
});

ipcMain.handle('ui:set-jf-player', (event, choice) => {
  if (event.sender !== home?.webContents || !['mpv', 'desktop', 'web'].includes(choice)) return null;
  CONFIG.jellyfinPlayer = choice;
  saveUserConfig({ jellyfinPlayer: choice });
  return settingsState();
});

ipcMain.handle('ui:set-pause-on-menu', (event, on) => {
  if (event.sender !== home?.webContents) return null;
  CONFIG.pauseOnMenu = Boolean(on);
  saveUserConfig({ pauseOnMenu: CONFIG.pauseOnMenu });
  return settingsState();
});

ipcMain.handle('ui:sounds', () => CONFIG.soundEffects !== false);
ipcMain.handle('themes:list', () => themes.list());
ipcMain.handle('themes:set', (event, choice) => {
  if (event.sender !== home?.webContents) return settingsState();
  const c = choice && typeof choice === 'object' ? choice : {};
  if (typeof c.layout === 'string') { CONFIG.layout = themes.layout(c.layout).id; saveUserConfig({ layout: CONFIG.layout }); }
  log.info(`theme: layout ${CONFIG.layout}`);
  return settingsState();
});

function saveLook() {
  saveUserConfig({ look: CONFIG.look, colors: undefined });
  const L = CONFIG.look;
  log.info(`theme: ${L.theme}${L.theme === 'custom' ? ` (from ${L.base}): ${JSON.stringify(currentLook())}` : ''}`);
  applyThemeEverywhere();
  return settingsState();
}
// A whole theme: its colours, fonts, sounds and effects.
ipcMain.handle('look:theme', (event, id) => {
  if (event.sender !== home?.webContents) return settingsState();
  const t = themes.theme(String(id));
  if (!t) return settingsState();
  CONFIG.look = { theme: t.id, base: t.id, custom: null };
  return saveLook();
});
// Changing any part makes it your custom theme, starting from whatever you had.
ipcMain.handle('look:custom', (event, patch) => {
  if (event.sender !== home?.webContents) return settingsState();
  const p = patch && typeof patch === 'object' ? patch : {};
  const L = CONFIG.look;
  const next = { ...currentLook() };
  for (const k of ['colors', 'accent', 'display', 'text', 'sounds', 'instrument', 'background']) if (typeof p[k] === 'string') next[k] = p[k];
  // A sound effect switched on or off: { soundFx: id, on: true/false }.
  if (typeof p.soundFx === 'string') {
    next.soundFx = next.soundFx.filter((id) => id !== p.soundFx);
    if (p.on) next.soundFx.push(p.soundFx);
  }
  // An effect switched on or off: { effect: id, on: true/false }.
  if (typeof p.effect === 'string') {
    next.effects = next.effects.filter((id) => id !== p.effect);
    if (p.on) next.effects.push(p.effect);
  }
  CONFIG.look = { theme: 'custom', base: L.theme === 'custom' ? L.base : L.theme, custom: themes.resolve(next) };
  return saveLook();
});
// Save the look you're using in one of your ten slots (slot 0: the first empty one; when none is
// empty, the answer says so and Settings asks which to replace). rect is where the preview is in
// Settings: a square from it becomes the slot's picture.
ipcMain.handle('look:save', async (event, name, slot, rect) => {
  if (event.sender !== home?.webContents) return null;
  try {
    const n = Number(slot) || themes.freeSlot();
    if (!n) return { error: 'full' };
    const id = themes.saveLook(String(name || ''), currentLook(), n, await previewPicture(rect));
    CONFIG.look = { theme: id, base: id, custom: null };
    return { ok: true, id, list: themes.list(), state: saveLook() };
  } catch (err) {
    log.warn('theme: could not save:', err.message);
    return { error: err.message };
  }
});
// A small square picture of the preview in Settings: the left of it, where the greeting, the big
// panel and the selected title are.
async function previewPicture(rect) {
  const r = rect && typeof rect === 'object' ? rect : null;
  if (!r || !home || home.webContents.isDestroyed()) return null;
  const box = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(Math.min(r.width, r.height)), height: Math.round(r.height) };
  if (!(box.width > 10 && box.height > 10)) return null;
  try {
    const img = await home.webContents.capturePage(box);
    if (img.isEmpty()) { log.warn('theme: the picture of the preview came out empty'); return null; }
    return img.resize({ width: 192, height: 192, quality: 'good' }).toPNG();
  } catch (err) {
    log.warn('theme: no picture of the preview:', err.message);
    return null;
  }
}
ipcMain.handle('look:delete', (event, id) => {
  if (event.sender !== home?.webContents) return null;
  const t = themes.theme(String(id));
  const look = t && t.look;
  if (!themes.deleteLook(String(id))) return { error: 'not-yours' };
  // Deleting the theme in use keeps its look, as your custom theme.
  if (CONFIG.look.theme === id) CONFIG.look = { theme: 'custom', base: 'classic', custom: themes.resolve(look) };
  return { ok: true, list: themes.list(), state: saveLook() };
});
ipcMain.handle('sound:set', () => themes.soundSpec(currentLook()));
// Picks up themes, layouts, colours, fonts and sounds you've added (or changed) without restarting.
ipcMain.handle('themes:reload', async (event) => {
  if (event.sender !== home?.webContents) return null;
  themes.reload();
  await refreshAudio();
  applyThemeEverywhere({ fonts: true });
  return { ...themes.list(), state: settingsState() };
});
// Converting other sound formats with ffmpeg (Settings → Look → Make your own).
ipcMain.handle('audio:status', async () => ({ on: CONFIG.convertAudio !== false, ...(await audioConvert.status()) }));
ipcMain.handle('audio:set-convert', async (event, on) => {
  if (event.sender !== home?.webContents) return null;
  CONFIG.convertAudio = Boolean(on);
  saveUserConfig({ convertAudio: CONFIG.convertAudio });
  await refreshAudio();
  applyThemeEverywhere();
  return { on: CONFIG.convertAudio, ...(await audioConvert.status()) };
});
ipcMain.handle('ui:set-sounds', (event, on) => {
  if (event.sender !== home?.webContents) return settingsState();
  CONFIG.soundEffects = Boolean(on);
  saveUserConfig({ soundEffects: CONFIG.soundEffects });
  for (const v of [home, overlay, hints]) if (v && !v.webContents.isDestroyed()) v.webContents.send('sounds:changed', CONFIG.soundEffects);
  return settingsState();
});

ipcMain.handle('ui:set-hints', (event, on) => {
  if (event.sender !== home?.webContents) return null;
  CONFIG.showHints = Boolean(on);
  saveUserConfig({ showHints: CONFIG.showHints });
  updateHints();
  return settingsState();
});

// ---------------------------------------------------------------- controller mouse
//
// preload.js draws the pointer and reports where it is; real mouse events come from here,
// so websites treat them like a physical mouse.

// Pointer input goes in through Chromium's DevTools protocol, the same path a real mouse takes,
// so clicks reach boxes inside frames from other sites (captchas, sign-in widgets, video players).
// Plain sendInputEvent only reaches the page itself, not those frames.
function cdp(wc) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return (method, params) => wc.debugger.sendCommand(method, params).catch(() => {});
  } catch {
    return null; // DevTools already open on this page: fall back to plain events
  }
}

ipcMain.on('pointer', (event, p) => {
  if (!service || event.sender !== service.webContents || overlayOpen || !p) return;
  const wc = service.webContents;
  const x = Math.round(Number(p.x) || 0);
  const y = Math.round(Number(p.y) || 0);
  const send = cdp(wc);
  if (p.type === 'move') {
    if (send) send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    else wc.sendInputEvent({ type: 'mouseMove', x, y });
  } else if (p.type === 'click') {
    const button = p.button === 'right' ? 'right' : 'left';
    webSound('select');
    closeKeyboard();
    if (send) {
      const buttons = button === 'right' ? 2 : 1;
      send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
      send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
    } else {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
    }
  } else if (p.type === 'scroll') {
    const deltaY = p.dir > 0 ? SCROLL_STEP : -SCROLL_STEP;
    if (send) send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
    else wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -deltaY, canScroll: true });
  }
});
const SCROLL_STEP = 240;

// ---------------------------------------------------------------- input

// Sounds for presses on websites (played by our overlay layer, since sites can't know about them).
const WEB_SOUNDS = { up: 'move', down: 'move', left: 'move', right: 'move', ok: 'select', lclick: 'select', rclick: 'select', back: 'back', esc: 'back' };

function webSound(name) {
  if (name && CONFIG.soundEffects && overlay && !overlay.webContents.isDestroyed()) overlay.webContents.send('sound:play', name);
}

const KEYMAP = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Enter' };
// On our own screens: delete a letter, and play/pause doubles as "type a space".
const OUR_PAGE_KEYS = { delete: ['Backspace', null], playpause: ['Space', ' '], rclick: ['PageUp', null], lclick: ['PageDown', null] };

const EXIT_FULLSCREEN_JS = `(() => { if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return true; } return false; })()`;

function pressKey(wc, keyCode, char) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (char) wc.sendInputEvent({ type: 'char', keyCode: char });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}

function handleAction(wc, action) {
  if (action === 'menu') return toggleOverlay();
  const onService = service && wc === service.webContents;
  if (onService && !overlayOpen && !keyboardOpen) webSound(WEB_SOUNDS[action]);

  if (action === 'back') {
    if (overlayOpen && quitAsking) { quitAsking = false; overlay.webContents.send('overlay:confirm-quit', false); return; }
    if (overlayOpen) return hideOverlay(true);
    if (onService && current && current.tvPage) {
      // YouTube's TV page steps back by itself on Escape; on its home screen, offer the way home.
      if (/^#?\/?$/.test(new URL(wc.getURL() || ytTools.TV_URL).hash)) return showOverlay();
      return pressKey(wc, 'Escape');
    }
    if (onService) {
      const history = wc.navigationHistory;
      if (history.canGoBack()) return history.goBack();
      return showOverlay(); // nothing left to go back to: offer the way home
    }
    if (wc === home.webContents) pressKey(wc, 'Escape'); // the home page steps back through its own screens
    return;
  }

  if (action === 'esc') {
    if (overlayOpen && quitAsking) return handleAction(wc, 'back');
    if (overlayOpen) return hideOverlay(true);
    if (onService) {
      // Leave full screen (the page's own, and the browser's), then let the site see Escape too.
      wc.executeJavaScript(EXIT_FULLSCREEN_JS, true).catch(() => {});
      pressKey(wc, 'Escape');
      return;
    }
    return handleAction(wc, 'back');
  }

  if (onService) {
    if (action === 'ok' && serviceField) return openKeyboard(); // A on a text field: bring up the keyboard
    if (action === 'keyboard') return openKeyboard();
    if (action === 'playpause') {
      // Toggle the video directly; sites without a <video> we can reach get a Space press instead.
      wc.executeJavaScript(TOGGLE_PLAY_JS, true).then((done) => { if (!done) pressKey(wc, 'Space', ' '); }, () => pressKey(wc, 'Space', ' '));
      return;
    }
  }

  if (OUR_PAGE_KEYS[action]) {
    if (wc === home.webContents) pressKey(wc, ...OUR_PAGE_KEYS[action]);
    return;
  }

  // L1 / R1 on the home screen: switch between Home, Genres and Library.
  if (action === 'scrollup' || action === 'scrolldown') {
    if (wc === home.webContents) wc.send('view:step', action === 'scrollup' ? -1 : 1);
    return;
  }

  const key = KEYMAP[action];
  if (key) pressKey(wc, key, key === 'Enter' ? '\r' : null);
}

// Gamepad presses, reported by preload.js from whichever page has focus.
// Typing on Home (naming a theme, a server address...): Start means "done" there.
let homeTyping = false;
ipcMain.on('typing', (event, on) => { if (event.sender === home?.webContents) homeTyping = Boolean(on); });
// L2 / R2 held down or let go on a website, while its keyboard is up: Shift on the keyboard.
ipcMain.on('pad-hold', (event, action, down) => {
  if (keyboardOpen && service && event.sender === service.webContents) overlay.webContents.send('kb:hold', String(action), Boolean(down));
});

ipcMain.on('pad', (event, action) => {
  if (action === 'menu') {
    if (keyboardOpen) return overlay.webContents.send('kb:pad', 'menu');
    if (homeTyping && !overlayOpen && event.sender === home?.webContents) return home.webContents.send('typing:done');
    return toggleOverlay();
  }
  if (keyboardOpen) {
    if (service && event.sender === service.webContents) overlay.webContents.send('kb:pad', action);
    return;
  }
  const target = overlayOpen ? overlay : activeView();
  if (event.sender !== target.webContents) return; // ignore stray reports from other layers
  handleAction(target.webContents, action);
});

// ---------------------------------------------------------------- controller buttons
//
// Which button does what, saved in config. Button numbers follow the standard gamepad layout.
// The D-pad (12-15) always moves and can't be reassigned.

const DEFAULT_BINDINGS = {
  ok: 0, back: 1, delete: 2, playpause: 3, scrollup: 4, scrolldown: 5,
  rclick: 6, lclick: 7, esc: 8, menu: 9, keyboard: 11,
};
const BINDABLE = Object.keys(DEFAULT_BINDINGS);

function cleanBindings(saved) {
  const out = { ...DEFAULT_BINDINGS };
  if (saved && typeof saved === 'object') {
    for (const a of BINDABLE) {
      const n = saved[a];
      if (n === null) out[a] = null; // deliberately unassigned
      else if (Number.isInteger(n) && n >= 0 && n < 32 && !(n >= 12 && n <= 15)) out[a] = n;
    }
  }
  return out;
}

function broadcastBindings() {
  for (const v of [home, overlay, hints, service]) if (v && !v.webContents.isDestroyed()) v.webContents.send('bindings:changed', CONFIG.bindings);
}

ipcMain.handle('bindings:get', () => CONFIG.bindings);

ipcMain.handle('bindings:set', (event, action, index) => {
  if (event.sender !== home?.webContents || !BINDABLE.includes(action)) return CONFIG.bindings;
  if (!Number.isInteger(index) || index < 0 || index >= 32 || (index >= 12 && index <= 15)) return CONFIG.bindings;
  const next = { ...CONFIG.bindings };
  const previous = next[action];
  // One button, one job: whatever had this button before takes this action's old button.
  for (const a of BINDABLE) if (a !== action && next[a] === index) next[a] = previous;
  next[action] = index;
  CONFIG.bindings = next;
  saveUserConfig({ bindings: next });
  broadcastBindings();
  return next;
});

ipcMain.handle('bindings:reset', (event) => {
  if (event.sender !== home?.webContents) return CONFIG.bindings;
  CONFIG.bindings = { ...DEFAULT_BINDINGS };
  saveUserConfig({ bindings: CONFIG.bindings });
  broadcastBindings();
  return CONFIG.bindings;
});

// ---------------------------------------------------------------- our pages

// Requests from our own pages only (never from websites).
const fromOurPages = (event) => event.sender === home?.webContents || event.sender === overlay?.webContents;
const fromHome = (event) => event.sender === home?.webContents;

ipcMain.handle('ui:services', (event) => (fromOurPages(event) ? publicServices() : []));

function tmdbHandler(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromHome(event)) return { error: 'failed' };
    try {
      return { ok: await fn(...args) };
    } catch (err) {
      if (!err.code) console.error(`[tmdb] ${channel}:`, err.message);
      return { error: err.code || 'failed' };
    }
  });
}
tmdbHandler('tmdb:search', (query) => tmdb.search(String(query).slice(0, 100)));
// The TMDB and IMDb pages of something playing from your server (for the QR codes in mpv's menu):
// an episode's are its show's. TMDB fills in IMDb's number when your server doesn't have it.
async function titleLinks(server, e) {
  if (!e) return [];
  let kind = 'movie'; let id = e.tmdbId; let imdb = e.imdbId;
  if (e.seriesId) {
    kind = 'tv';
    try { const s = await be(server).getItem(server, e.seriesId); id = s.tmdbId; imdb = s.imdbId; } catch { id = null; imdb = null; }
  }
  if (id && !imdb && CONFIG.tmdbKey) { try { imdb = (await tmdb.details(kind, id)).imdbId; } catch { /* TMDB's page will do */ } }
  const out = [];
  if (id) out.push({ name: 'TMDB', url: `https://www.themoviedb.org/${kind}/${id}` });
  if (imdb) out.push({ name: 'IMDb', url: `https://www.imdb.com/title/${imdb}/` });
  return out;
}

// QR codes for a title's TMDB and IMDb pages, to open on your phone: [{ name, url, svg }].
async function titleQrs(kind, id, imdbId) {
  const QRCode = require('qrcode');
  const out = [];
  if ((kind === 'movie' || kind === 'tv') && /^\d+$/.test(String(id))) out.push({ name: 'TMDB', url: `https://www.themoviedb.org/${kind}/${id}` });
  if (/^tt\d+$/.test(String(imdbId || ''))) out.push({ name: 'IMDb', url: `https://www.imdb.com/title/${imdbId}/` });
  for (const q of out) q.svg = await QRCode.toString(q.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0b10', light: '#ffffff' } });
  return out;
}
tmdbHandler('tmdb:qr', (kind, id, imdbId) => titleQrs(String(kind), String(id), imdbId ? String(imdbId) : null));
tmdbHandler('tmdb:search-page', (query, page) => tmdb.searchPage(String(query).slice(0, 100), Math.max(1, Math.min(25, Number(page) || 1))));
tmdbHandler('tmdb:person', (id) => tmdb.person(Number(id)));
tmdbHandler('tmdb:details', async (kind, id) => {
  const d = await tmdb.details(String(kind), Number(id));
  if (CONFIG.watchmodeKey) {
    try { mergeWatchmode(d, await watchmode.sources(d.kind, d.id)); } catch (err) { d.watchmodeError = err.code || 'failed'; }
  }
  return d;
});

// Add what Watchmode knows to a title's page: more of your services (often free ones like Tubi),
// direct links where it has them, and more places to rent or buy.
const allowedLinks = new Set(); // links the title pages may open (only ones Watchmode gave us)
const SELLS = SERVICES.map((svc) => {
  const store = svc.store && STORES.find((x) => x.id === svc.store);
  const re = svc.rentMatch || (store && store.match);
  return re ? { id: svc.id, storeId: store ? store.id : null, re: new RegExp(re, 'i') } : null;
}).filter(Boolean);
const svcRe = (svc) => new RegExp(svc.match || `^${svc.name}`, 'i');

function mergeWatchmode(d, sources) {
  d.links = d.links || {};
  const allow = (url) => { if (url) allowedLinks.add(url); return url || null; };
  const priced = (target, src) => {
    if (src.type === 'rent') { target.rent = true; if (src.price != null && (target.rentPrice == null || src.price < target.rentPrice)) target.rentPrice = src.price; }
    if (src.type === 'buy') { target.buy = true; if (src.price != null && (target.buyPrice == null || src.price < target.buyPrice)) target.buyPrice = src.price; }
    if (src.url && !target.url) target.url = allow(src.url);
  };
  // Streaming first, so a service that includes it isn't also listed as "rent or buy".
  const order = { sub: 0, free: 1, tve: 2, rent: 3, buy: 3 };
  for (const src of [...sources].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))) {
    const svc = SERVICES.find((x) => svcRe(x).test(src.name));
    if (svc && (src.type === 'sub' || src.type === 'free')) {
      if (!d.serviceHow[svc.id]) d.serviceHow[svc.id] = src.type === 'sub' ? 'included' : 'free';
      if (!d.onServices.includes(svc.id)) d.onServices.push(svc.id);
      if (src.url && !d.links[svc.id]) d.links[svc.id] = allow(src.url);
      d.rentOnly = d.rentOnly.filter((r) => r.serviceId !== svc.id);
      d.elsewhere = d.elsewhere.filter((e) => !svcRe(svc).test(e.name));
      continue;
    }
    if (src.type === 'rent' || src.type === 'buy') {
      const seller = SELLS.find((x) => x.re.test(src.name));
      if (seller && d.serviceHow[seller.id]) continue; // included with your service anyway
      if (seller) {
        let r = d.rentOnly.find((x) => x.serviceId === seller.id);
        if (!r) { r = { serviceId: seller.id, storeId: seller.storeId, store: src.name, rent: false, buy: false }; d.rentOnly.push(r); }
        priced(r, src);
        d.elsewhere = d.elsewhere.filter((e) => !seller.re.test(e.name));
        continue;
      }
      let e = d.elsewhere.find((x) => x.name.toLowerCase() === src.name.toLowerCase());
      if (e && e.how !== 'rent or buy') continue;
      if (!e) { e = { name: src.name, how: 'rent or buy', rent: false, buy: false }; d.elsewhere.push(e); }
      priced(e, src);
      continue;
    }
    if (src.type === 'sub' || src.type === 'free' || src.type === 'tve') {
      if (d.elsewhere.some((x) => x.name.toLowerCase() === src.name.toLowerCase())) {
        const e = d.elsewhere.find((x) => x.name.toLowerCase() === src.name.toLowerCase());
        if (src.url && !e.url) e.url = allow(src.url);
        continue;
      }
      d.elsewhere.push({ name: src.name, how: src.type === 'sub' ? 'streaming' : src.type === 'free' ? 'free' : 'with a TV provider', url: allow(src.url) });
    }
  }
  d.elsewhere = d.elsewhere.slice(0, 18);
  d.watchmode = true;
}

// A direct link to a title (from Watchmode), opened as that service when we know it.
ipcMain.on('ui:open-link', (event, url, serviceId) => {
  if (!fromOurPages(event) || !(allowedLinks.has(url) || musicLinks.has(url))) return;
  const def = (serviceId && findPage(String(serviceId))) || {};
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
  openService({ ...def, id: def.id || `link-${host}`, name: def.name || host, url, returnLabel: def.returnLabel || 'Back', searchUrl: null });
});

// ---------------------------------------------------------------- Trakt

let traktSignIn = null; // { code, timer, cancelled }

ipcMain.handle('trakt:start', async (event) => {
  if (!fromHome(event)) return { error: 'failed' };
  if (traktSignIn) { traktSignIn.cancelled = true; clearTimeout(traktSignIn.timer); }
  const t = CONFIG.trakt;
  if (!t.clientId) return { error: 'no-app' };
  let code;
  try { code = await trakt.deviceCode(t.clientId); } catch (err) { return { error: err.code || 'failed' }; }
  const run = { code, cancelled: false, timer: null, interval: code.interval, until: Date.now() + code.expiresIn * 1000 };
  traktSignIn = run;
  const poll = async () => {
    if (run.cancelled) return;
    if (Date.now() > run.until) { home.webContents.send('trakt:signin', { error: 'expired' }); return; }
    try {
      const r = await trakt.checkDevice(t.clientId, t.clientSecret, code.deviceCode);
      if (run.cancelled) return;
      if (r.tokens) {
        CONFIG.trakt = { ...CONFIG.trakt, ...r.tokens };
        try { CONFIG.trakt.username = (await trakt.user()).username; } catch { /* name is just for show */ }
        saveUserConfig({ trakt: CONFIG.trakt });
        traktSignIn = null;
        seedCache = null;
        if (current && current.id === 'trakt-activate') goHome();
        home.webContents.send('trakt:signin', { ok: true, username: CONFIG.trakt.username });
        home.webContents.send('settings:changed', settingsState());
        return;
      }
      if (r.slowDown) run.interval += 2;
    } catch (err) {
      if (err.code === 'expired' || err.code === 'denied' || err.code === 'bad-secret') {
        traktSignIn = null;
        home.webContents.send('trakt:signin', { error: err.code });
        return;
      }
      // network blips: keep trying
    }
    run.timer = setTimeout(poll, run.interval * 1000);
  };
  run.timer = setTimeout(poll, run.interval * 1000);
  const qr = await QRCode.toString(code.url, { type: 'svg', margin: 1, color: { dark: '#0b0b10', light: '#ffffff' } }).catch(() => '');
  return { ok: { userCode: code.userCode, url: code.url, expiresIn: code.expiresIn, qr } };
});

ipcMain.handle('trakt:cancel', (event) => {
  if (!fromHome(event)) return false;
  if (traktSignIn) { traktSignIn.cancelled = true; clearTimeout(traktSignIn.timer); traktSignIn = null; }
  return true;
});

// Enter the code on Trakt's activate page here on the TV (you're signed in to Trakt in the app).
ipcMain.on('trakt:activate-here', (event) => {
  if (!fromHome(event) || !traktSignIn) return;
  openService({
    id: 'trakt-activate', name: 'Trakt', url: traktSignIn.code.url, returnLabel: 'Back to setup',
    fill: 'trakt-code', fillValue: traktSignIn.code.userCode,
  });
});

ipcMain.handle('trakt:remove', (event, what) => {
  if (!fromHome(event)) return settingsState();
  CONFIG.trakt = what === 'all'
    ? cleanTrakt({})
    : { ...CONFIG.trakt, accessToken: '', refreshToken: '', expiresAt: 0, username: '' };
  saveUserConfig({ trakt: CONFIG.trakt });
  trakt.forget();
  seedCache = null;
  return settingsState();
});

ipcMain.handle('trakt:options', (event, patch) => {
  if (!fromHome(event) || !patch || typeof patch !== 'object') return settingsState();
  for (const k of ['rows', 'scrobble']) if (typeof patch[k] === 'boolean') CONFIG.trakt[k] = patch[k];
  saveUserConfig({ trakt: CONFIG.trakt });
  return settingsState();
});

// A title's page: is it on your Trakt watchlist? And the buttons to change that / mark it watched.
ipcMain.handle('trakt:title', async (event, kind, id) => {
  if (!fromHome(event) || !CONFIG.trakt.accessToken) return null;
  try { return { onWatchlist: await trakt.onWatchlist(String(kind), Number(id)) }; } catch (err) { return { error: err.code || 'failed' }; }
});
ipcMain.handle('trakt:watchlist', async (event, kind, id, on) => {
  if (!fromHome(event)) return { error: 'failed' };
  try { await trakt.setWatchlist(String(kind), Number(id), Boolean(on)); return { ok: true }; } catch (err) { return { error: err.code || 'failed' }; }
});
ipcMain.handle('trakt:watched', async (event, kind, id) => {
  if (!fromHome(event)) return { error: 'failed' };
  try { await trakt.markWatched(String(kind), Number(id)); seedCache = null; return { ok: true }; } catch (err) { return { error: err.code || 'failed' }; }
});

// Trakt rows for the home screen: your watchlist, and Trakt's suggestions for you.
async function traktRows() {
  if (!CONFIG.trakt.accessToken || CONFIG.trakt.rows === false || !CONFIG.tmdbKey) return [];
  const [watch, recs] = await Promise.all([trakt.watchlist().catch(() => []), trakt.recommendations().catch(() => [])]);
  const [watchCards, recCards] = await Promise.all([tmdb.cards(watch.slice(0, 30)), tmdb.cards(recs.slice(0, 30))]);
  const rows = [];
  if (watchCards.length) rows.push({ title: 'Your Trakt watchlist', items: watchCards, more: false });
  if (recCards.length) rows.push({ title: 'Recommended for you on Trakt', items: recCards, more: false });
  return rows;
}
tmdbHandler('tmdb:home', () => tmdb.home());
tmdbHandler('tmdb:genres', async () => tmdb.genreList());
// Pictures for genre tiles, kept for a day so the tiles don't change every time you look.
const genreArtCache = new Map();
tmdbHandler('tmdb:genre-art', async (id) => {
  const hit = genreArtCache.get(id);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.art;
  const art = await tmdb.genreArt(String(id));
  genreArtCache.set(id, { at: Date.now(), art });
  return art;
});

// ---------------------------------------------------------------- browsing rows and pages

// Titles you've opened to watch (newest first), for "Inspired by what you've watched".
ipcMain.on('ui:remember', (event, kind, id, title) => {
  if (!fromHome(event) || (kind !== 'movie' && kind !== 'tv') || !Number.isInteger(Number(id))) return;
  const entry = { kind, id: Number(id), title: String(title || '').slice(0, 200), at: Date.now() };
  CONFIG.history = [entry, ...(CONFIG.history || []).filter((h) => !(h.kind === kind && h.id === entry.id))].slice(0, 30);
  saveUserConfig({ history: CONFIG.history });
  seedCache = null;
});

// What you've watched lately: played titles on your Jellyfin servers, plus titles opened here.
let seedCache = null;
async function seeds() {
  if (seedCache && Date.now() - seedCache.at < 5 * 60 * 1000) return seedCache.list;
  const [fromServers, fromTrakt] = await Promise.all([
    Promise.all(mediaServers().map((s) => be(s).recentlyPlayedTmdb(s).catch(() => []))),
    CONFIG.trakt.accessToken ? trakt.recentlyWatched().catch(() => []) : [],
  ]);
  const mixed = [];
  const lists = [(CONFIG.history || []).map(({ kind, id }) => ({ kind, id })), fromTrakt, ...fromServers];
  for (let i = 0; i < 12; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
  const seen = new Set();
  const list = mixed.filter((x) => !seen.has(x.kind + x.id) && seen.add(x.kind + x.id)).slice(0, 8);
  seedCache = { at: Date.now(), list };
  return list;
}

const signedInServers = () => CONFIG.jellyfinServers.filter((s) => s.token && s.userId);

// A Jellyfin item as a card on our screens.
function jfCard(server, it) {
  const ep = it.type === 'Episode';
  return {
    kind: 'jf', serverId: server.id, serverName: server.name, item: it,
    title: ep ? (it.series || it.name) : it.name,
    // Just the show or film on the card; which episode and which server are in its details.
    sub: ep ? 'Series' : [it.year, 'Film'].filter(Boolean).join(' · '),
    image: it.poster ? `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(it.poster)}/Images/Primary?fillHeight=450&quality=85` : null,
    progress: it.position > 0 && it.runtime && !it.played ? Math.min(1, it.position / it.runtime) : 0,
    // A wide picture for the big view: the show's (for an episode) or the film's.
    backdrop: `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(ep && it.seriesId ? it.seriesId : it.id)}/Images/Backdrop?maxWidth=1280&quality=85`,
    overview: (it.overview || '').slice(0, 320),
    // The TMDB title it belongs to, so picking it opens that title's page (with a Resume button).
    tmdb: it.type === 'Movie' && it.tmdbId ? { kind: 'movie', id: it.tmdbId }
      : it.type === 'Series' && it.tmdbId ? { kind: 'tv', id: it.tmdbId } : null,
  };
}

// Episodes: find their show on TMDB (one lookup per show, remembered).
async function attachShows(server, cards) {
  await Promise.all(cards.filter((c) => c.item.type === 'Episode' && c.item.seriesId).map(async (c) => {
    const key = `${server.id}:${c.item.seriesId}`;
    if (!showTmdbIds.has(key)) showTmdbIds.set(key, await be(server).seriesTmdbId(server, c.item.seriesId).catch(() => null));
    const id = showTmdbIds.get(key);
    if (id) c.tmdb = { kind: 'tv', id };
  }));
  return cards;
}

// "Jump back in" and "Up next", across every server, most recently watched first.
async function jellyfinRows() {
  const servers = mediaServers();
  const got = await Promise.all(servers.map(async (s) => {
    const [resume, next] = await Promise.all([be(s).resumeItems(s).catch(() => []), be(s).nextUpItems(s).catch(() => [])]);
    await enrichEpisodes(s, [...resume, ...next], { plots: false }).catch(() => {});
    return { s, resume: await attachShows(s, resume.map((it) => jfCard(s, it))), next: await attachShows(s, next.map((it) => jfCard(s, it))) };
  }));
  const byRecent = (a, b) => String(b.item.lastPlayed || '').localeCompare(String(a.item.lastPlayed || ''));
  const resume = got.flatMap(({ resume: r }) => r).sort(byRecent);
  const resumeIds = new Set(resume.map((c) => c.serverId + c.item.id));
  const next = got.flatMap(({ next: n }) => n).filter((c) => !resumeIds.has(c.serverId + c.item.id));
  for (const c of next) c.upNext = true;
  const rows = [];
  if (resume.length) rows.push({ title: 'Jump back in', items: resume, more: false });
  if (next.length) rows.push({ title: 'Up next', items: next, more: false });
  return rows;
}

ipcMain.handle('browse:home', async (event) => {
  if (!fromHome(event)) return { error: 'failed' };
  const jfRows = await jellyfinRows().catch(() => []);
  if (!CONFIG.tmdbKey) return { ok: { rows: jfRows, tmdbError: 'no-key' } };
  try {
    const [tRows, tmdbRows] = await Promise.all([traktRows().catch(() => []), seeds().then((x) => tmdb.home(x))]);
    return { ok: { rows: [...jfRows, ...tRows, ...tmdbRows] } };
  } catch (err) {
    if (!err.code) console.error('[browse] home:', err.message);
    return { ok: { rows: jfRows, tmdbError: err.code || 'failed' } };
  }
});

// One page of a long list: a TMDB list (genres, trending, inspired...) or a Jellyfin library.
const LIBRARY_PAGE = 60;
ipcMain.handle('browse:page', async (event, spec, n) => {
  if (!fromHome(event) || !spec || typeof spec !== 'object') return { error: 'failed' };
  const page = Math.max(1, Math.min(500, Number(n) || 1));
  try {
    if (spec.source === 'jf-library') {
      const server = serverFor(String(spec.serverId));
      const r = await be(server).library(server, {
        type: spec.type === 'tv' ? 'tv' : 'movie',
        start: (page - 1) * LIBRARY_PAGE, limit: LIBRARY_PAGE,
        letter: typeof spec.letter === 'string' ? spec.letter : null,
      });
      return { ok: { items: r.items.map((it) => jfCard(server, it)), more: r.more } };
    }
    return { ok: await tmdb.page(spec, page, spec.source === 'inspired' ? await seeds() : []) };
  } catch (err) {
    if (!err.code) console.error('[browse] page:', err.message);
    return { error: err.code || 'failed' };
  }
});

ipcMain.handle('ui:settings', (event) => (fromHome(event) ? settingsState() : null));
ipcMain.handle('wm:status', (event) => (fromHome(event) && CONFIG.watchmodeKey ? watchmode.status() : null));
ipcMain.handle('ui:set-key', (event, key) => (fromHome(event) ? setKey(key) : { error: 'failed' }));
ipcMain.handle('ui:set-any-key', (event, kind, key) => (fromHome(event) ? setAnyKey(String(kind), key) : { error: 'failed' }));

// A key on the clipboard (only if it looks like one, and isn't the one already saved).
ipcMain.handle('ui:clipboard-key', async (event, kind = 'tmdb') => {
  if (!fromHome(event)) return null;
  // readText is async in newer Electron releases; await works either way.
  const text = String((await clipboard.readText()) || '').trim();
  if (kind === 'watchmode') return /^[A-Za-z0-9]{20,64}$/.test(text) && text !== CONFIG.watchmodeKey ? text : null;
  if (kind === 'trakt') return trakt.findCredentials(text) ? text : null;
  if (kind === 'lastfm') return /^[0-9a-f]{32}$/i.test(text) && ![CONFIG.music.lastfmKey, CONFIG.music.lastfm.secret].includes(text.toLowerCase()) ? text : null;
  return KEY_PATTERN.test(text) && text !== CONFIG.tmdbKey ? text : null;
});

ipcMain.handle('ui:phone', async (event, mode, keyFor = 'tmdb') => {
  if (!fromHome(event)) return null;
  phone.setState({ mode: mode === 'key' ? 'key' : 'text', keyFor: ['tmdb', 'watchmode', 'trakt', 'live', 'lastfm'].includes(keyFor) ? keyFor : 'tmdb' });
  updatePhoneState();
  const info = await phone.start().catch(() => ({ error: 'failed' }));
  return info && !info.error ? { ...info, seen: phoneSeen } : info;
});

// ---------------------------------------------------------------- firewall help for the phone remote

async function firewallPlan() {
  const info = await phone.start().catch(() => null);
  if (!info || info.error) return { kind: 'unknown' };
  const fw = await firewall.detect({ port: info.port, cidr: info.cidr, iface: info.network, ports: info.ports });
  const network = firewall.homeRange(info.cidr);
  const plan = network ? firewall.plan(fw, network, info.ports) : null;
  console.log(`[firewall] ${fw.kind}${fw.zone ? ` (zone ${fw.zone})` : ''}: port ${info.port} ${fw.open === null ? 'unknown' : fw.open ? 'open' : 'closed'} for ${network}`);
  return { fw, network, port: info.port, ports: info.ports, plan };
}

ipcMain.handle('ui:firewall', async (event) => {
  if (!fromHome(event)) return null;
  const { fw, network, port, plan } = await firewallPlan();
  return {
    kind: fw ? fw.kind : 'unknown',
    open: Boolean(fw && fw.open),
    network,
    port,
    command: plan ? plan.display : null,
    tips: firewall.keyboardTips(),
    seen: phoneSeen,
  };
});

ipcMain.handle('ui:firewall-allow', async (event) => {
  if (!fromHome(event)) return { error: 'failed' };
  const { fw, network, ports } = await firewallPlan();
  if (!fw || !network) return { error: 'unsupported' };

  // Get our full-screen window out of the way so the system's password prompt is visible.
  const wasKiosk = win.isKiosk();
  if (wasKiosk) win.setKiosk(false);
  win.minimize();
  try {
    const r = await firewall.allow(fw, network, ports);
    console.log(`[firewall] allow: ${r.ok ? 'done' : r.error}${r.detail ? ` (pkexec said: ${r.detail})` : ''}`);
    if (!r.ok) return r;
    // Check it took.
    const after = await firewallPlan();
    return { ok: true, open: after.fw ? after.fw.open : null };
  } finally {
    win.restore();
    if (wasKiosk) win.setKiosk(true);
    home.webContents.focus();
  }
});
// The same, with the password typed on the app's own keyboard (for when there's no system prompt).
ipcMain.handle('ui:firewall-password', async (event, password) => {
  if (!fromHome(event) || typeof password !== 'string' || !password || password.length > 1024) return { error: 'failed' };
  const { fw, network, ports } = await firewallPlan();
  if (!fw || !network) return { error: 'unsupported' };
  const r = await firewall.allowWithPassword(fw, network, ports, password);
  console.log(`[firewall] allow with typed password: ${r.ok ? 'done' : r.error}${r.detail ? ` (sudo said: ${r.detail})` : ''}`);
  if (!r.ok) return r;
  const after = await firewallPlan();
  return { ok: true, open: after.fw ? after.fw.open : null };
});
ipcMain.on('ui:phone-mode', (event, mode, keyFor = 'tmdb') => {
  if (!fromHome(event)) return;
  phone.setState({ mode: mode === 'key' ? 'key' : 'text', keyFor: ['tmdb', 'watchmode', 'trakt', 'live', 'lastfm'].includes(keyFor) ? keyFor : 'tmdb' });
  updatePhoneState(); // (back to "Search", after the typing screen named its own field)
});

// The typing screen: the phone types into it, under its own name ("Your Last.fm shared secret"),
// with dots for passwords. Answers the code to scan, as ui:phone does.
ipcMain.handle('ui:phone-ask', async (event, label, secret) => {
  if (!fromHome(event)) return null;
  phone.setState({ mode: 'text', label: String(label || 'Text').slice(0, 60), kind: secret ? 'password' : 'text' });
  const info = await phone.start().catch(() => ({ error: 'failed' }));
  return info && !info.error ? { ...info, seen: phoneSeen } : info;
});

ipcMain.handle('ui:stores', (event) => (fromOurPages(event)
  ? [...STORES.map(({ id, name, match }) => ({ id, name, match }))]
  : []));

// TMDB's where-to-watch page for a title: links out to every provider, for ones we don't know.
ipcMain.on('ui:open-watch-page', (event, kind, id) => {
  if (!fromOurPages(event) || !['movie', 'tv'].includes(kind) || !Number.isInteger(id)) return;
  openService({
    id: 'tmdb-watch', name: 'Where to watch', returnLabel: 'Back',
    url: `https://www.themoviedb.org/${kind}/${id}/watch?locale=${encodeURIComponent(CONFIG.region)}`,
  });
});

// "Find it on YouTube" on a title's page: a YouTube search, wherever YouTube opens.
ipcMain.on('ui:find-youtube', async (event, query) => {
  if (!fromHome(event)) return;
  const q = String(query || '').slice(0, 200).trim();
  if (!q) return;
  openYouTube({ search: q });
});

ipcMain.on('ui:open', (event, id, query) => {
  if (fromOurPages(event)) openPage(String(id), query);
});

// Read a key straight off the page it's shown on (TMDB's API settings, Watchmode's key page,
// Trakt's API app page).
const PAGE_TEXT_JS = `(() => [document.body.innerText, ...[...document.querySelectorAll('input, textarea')].map((i) => i.value)].join('\\n'))()`;
const TMDB_IN = (text) => {
  const token = text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (token) return token[0];
  const key = text.match(/\b[a-f0-9]{32}\b/i);
  return key ? key[0] : null;
};
// Watchmode keys are letters and digits; on its pages the key sits next to the words "API key".
const WATCHMODE_IN = (text) => {
  const near = /api\s*key[^A-Za-z0-9]{0,40}([A-Za-z0-9]{30,64})\b/i.exec(text);
  if (near) return near[1];
  const any = text.match(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{36,48}\b/);
  return any ? any[0] : null;
};

// Fills a field when it appears (these sites build their pages with script, so keep looking).
function fillScript(kind, value) {
  const wanted = kind === 'trakt-app'
    ? [{ match: 'redirect', value: 'urn:ietf:wg:oauth:2.0:oob' }, { match: '^\\s*name\\b|app(lication)? name', value: 'SOFA King' }]
    : [{ match: 'code|activate', value: String(value || ''), any: true }];
  return `(() => {
    if (window.__tvFill) return; window.__tvFill = true;
    const wanted = ${JSON.stringify(wanted)};
    // Everything that says what a field is for: its label, placeholder, name...
    const describe = (el) => [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      ...(el.labels ? [...el.labels].map((l) => l.textContent) : []),
      el.closest('label') ? el.closest('label').textContent : ''].filter(Boolean).map((t) => t.trim());
    const set = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const done = new WeakSet();
    const tick = () => {
      const fields = [...document.querySelectorAll('input[type=text], input:not([type]), textarea')].filter((el) => el.offsetParent);
      for (const w of wanted) {
        const re = new RegExp(w.match, 'i');
        const el = fields.find((f) => describe(f).some((t) => re.test(t))) || (w.any ? fields[0] : null);
        if (el && !el.value && !done.has(el)) { set(el, w.value); done.add(el); }
      }
    };
    setInterval(tick, 700);
    tick();
  })()`;
}

const GRAB_NAMES = { tmdb: 'TMDB', watchmode: 'Watchmode', trakt: 'Trakt', lastfm: 'Last.fm' };
// A Last.fm key: 32 letters and numbers (0-9, a-f), shown next to "API key".
// Its shared secret (needed for scrobbling) is shown just below it, and is picked up too.
const LASTFM_IN = (text) => {
  const near = /api\s*key[^0-9a-f]{0,40}([0-9a-f]{32})\b/i.exec(text);
  const secret = /shared\s*secret[^0-9a-f]{0,40}([0-9a-f]{32})\b/i.exec(text);
  return near ? `${near[1]}${secret ? ` ${secret[1]}` : ''}` : null;
};

async function grabKeyFromPage() {
  if (!service || !current || !current.grab) return;
  const kind = current.grab;
  let text = '';
  try { text = String(await service.webContents.executeJavaScript(PAGE_TEXT_JS, true) || ''); } catch { /* page busy */ }
  const creds = kind === 'trakt' ? trakt.findCredentials(text, { pasted: false }) : null;
  const found = kind === 'tmdb' ? TMDB_IN(text) : kind === 'watchmode' ? WATCHMODE_IN(text) : kind === 'lastfm' ? LASTFM_IN(text)
    : (creds ? `Client ID ${creds.clientId}${creds.clientSecret ? ` Client Secret ${creds.clientSecret}` : ''}` : null);
  if (!found) {
    overlay.webContents.send('overlay-notice', {
      tmdb: 'No key on this page yet. Sign in, open the API section, then try again.',
      watchmode: 'No key on this page yet. Finish signing up, open the page that shows your API key, then try again.',
      trakt: 'No Client ID on this page yet. Save your app, open it, then try again.',
      lastfm: 'No key on this page yet. Fill in the form (only the name is needed) and submit it, then try again.',
    }[kind]);
    return;
  }
  overlay.webContents.send('overlay-notice', `Checking with ${GRAB_NAMES[kind]}…`);
  const result = await setAnyKey(kind, found);
  if (result.ok) {
    goHome();
    home.webContents.send('setup:key-saved', kind);
  } else {
    overlay.webContents.send('overlay-notice', keyError(kind, result.error));
  }
}

function keyError(kind, code) {
  const name = GRAB_NAMES[kind];
  return {
    'bad-key': `${name} didn't accept that key.`,
    'bad-client': 'Trakt didn\'t recognise that Client ID.',
    'not-a-key': `That doesn't look like a ${name} key.`,
    'quota': 'That key has used this month\'s lookups.',
  }[code] || `Couldn't check with ${name}. Try again.`;
}

// Save a key for TMDB, Watchmode or Trakt (from the phone, the clipboard or a page).
async function setAnyKey(kind, raw) {
  const text = String(raw || '').trim();
  if (kind === 'tmdb') return setKey(text);
  if (kind === 'watchmode') return setWatchmodeKey(text);
  if (kind === 'trakt') return setTraktApp(text);
  if (kind === 'live') return addLiveList(text);
  if (kind === 'lastfm') return setLastfmKey(text);
  return { error: 'failed' };
}

// A Last.fm key, its shared secret, or both. Both look alike (32 letters and numbers), so whichever
// Last.fm accepts as a key is the key, and the other is checked as that key's secret. So from the
// phone you can paste one, then the other, in either order. ("key secret" comes from reading
// Last.fm's page.) A new key signs you out of scrobbling (the old sign-in and secret belonged to
// the old key); removing the key (empty) forgets everything. Answers { ok, saved: 'key' | 'secret'
// | 'both', message } so the phone can say what it got.
async function setLastfmKey(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) {
    CONFIG.music.lastfmKey = '';
    CONFIG.music.lastfm = cleanLastfm({ scrobble: CONFIG.music.lastfm.scrobble, skip: CONFIG.music.lastfm.skip });
    saveMusic();
    return { ok: true };
  }
  const codes = [...new Set(text.match(/\b[0-9a-f]{32}\b/g) || [])].slice(0, 2);
  if (!codes.length) return { error: 'not-a-key' };
  const isKey = async (k) => {
    try { await music.lastfmCheck(k); return true; } catch (err) { if (err.code === 'bad-key') return false; throw err; }
  };
  const isSecret = async (key, s) => {
    try { await lastfm.start({ key, secret: s }); return true; } catch (err) { if (err.code === 'bad-secret') return false; throw err; }
  };
  let key = '';
  let secret = '';
  try {
    for (const c of codes) if (!key && await isKey(c)) key = c;
    const other = codes.find((c) => c !== key);
    const forKey = key || CONFIG.music.lastfmKey; // a secret on its own goes with the key you have
    if (other && forKey && await isSecret(forKey, other)) secret = other;
    // (No key yet and one code that isn't a key: maybe the secret, pasted first.)
    if (!key && !secret) return { error: forKey && codes.length === 1 ? 'bad-either' : !forKey && codes.length === 1 ? 'key-first' : 'bad-key' };
  } catch (err) { return { error: err.code || 'failed' }; }
  if (key && key !== CONFIG.music.lastfmKey) {
    const lf = CONFIG.music.lastfm;
    CONFIG.music.lastfm = cleanLastfm({ scrobble: lf.scrobble, skip: lf.skip });
    CONFIG.music.lastfmKey = key;
  }
  if (secret) CONFIG.music.lastfm.secret = secret;
  saveMusic();
  const saved = key && secret ? 'both' : key ? 'key' : 'secret';
  const message = {
    both: 'Saved your key and shared secret. Now sign in to scrobble on your TV.',
    key: CONFIG.music.lastfm.secret ? 'Saved your key.' : 'Saved your key. For scrobbling, paste the shared secret too.',
    secret: 'Saved your shared secret. Now sign in to scrobble on your TV.',
  }[saved];
  return { ok: true, saved, message };
}

async function setWatchmodeKey(key) {
  if (key) {
    const check = await watchmode.validate(key);
    if (check.error) return check;
  }
  CONFIG.watchmodeKey = key;
  saveUserConfig({ watchmodeKey: key });
  home?.webContents.send('settings:changed', settingsState());
  return { ok: true, masked: maskKey(key) };
}

// The Trakt app's Client ID (and Client Secret, for apps made before October 2026). Checks the ID
// with Trakt (it hands back a sign-in code). Two unlabelled codes: try both ways round.
async function setTraktApp(text) {
  const creds = trakt.findCredentials(text);
  if (!creds) return { error: 'not-a-key' };
  const tries = creds.labelled ? [creds] : [creds, { clientId: creds.clientSecret, clientSecret: creds.clientId }];
  for (const c of tries) {
    try {
      await trakt.deviceCode(c.clientId);
      CONFIG.trakt = { ...CONFIG.trakt, clientId: c.clientId, clientSecret: c.clientSecret, accessToken: '', refreshToken: '', expiresAt: 0 };
      saveUserConfig({ trakt: CONFIG.trakt });
      home?.webContents.send('settings:changed', settingsState());
      return { ok: true };
    } catch (err) {
      if (err.code !== 'bad-client') return { error: err.code || 'failed' };
    }
  }
  return { error: 'bad-client' };
}

ipcMain.on('ui:action', (event, name, arg) => {
  if (!fromOurPages(event)) return;
  switch (name) {
    case 'resume':
      lastPlace = 'menu';
      if (homeOverService) returnToService();
      hideOverlay(true);
      break;
    case 'settings': showSettings(); break;
    case 'return-to-service': if (fromHome(event)) returnToService(); break;
    // B out of Settings (opened from the menu while watching): back to the menu.
    case 'settings-to-menu': if (fromHome(event)) { returnToService(); lastPlace = 'menu'; showOverlay(); } break;
    case 'home': goHome(); break;
    case 'reload':
      if (service) { hideOverlay(); service.webContents.reload(); }
      break;
    case 'switch': openPage(arg); break;
    case 'grab-key': grabKeyFromPage(); break;
    case 'back': if (fromOverlay(event)) handleAction(event.sender, 'back'); break;
    case 'quit': // ask first: this closes everything, not just the site you're on
      if (fromOverlay(event)) { quitAsking = true; overlay.webContents.send('overlay:confirm-quit', true); }
      break;
    case 'quit-cancel':
      if (fromOverlay(event)) { quitAsking = false; overlay.webContents.send('overlay:confirm-quit', false); }
      break;
    case 'quit-confirmed': if (fromOverlay(event) && quitAsking) app.quit(); break;
  }
});

// ---------------------------------------------------------------- handing off to other apps
//
// VacuumTube and Jellyfin Desktop run as their own windows. We step aside (leave full screen and
// minimise) while one is open, and come back to the front when it closes.

let externalApp = null;
let stepAsideKiosk = false;
let stepAsideHow = 'hidden';

function stepAside(id) {
  externalApp = id;
  hideOverlay();
  closeKeyboard();
  if (service) service.webContents.executeJavaScript(PAUSE_JS, true).catch(() => {});
  // mpv opens on top of us (--ontop) and we stay where we are, full screen underneath: when it
  // closes, we're simply the window that's left, and the desktop hands us the focus. (Coming
  // back from minimised is the part desktops, Wayland ones especially, often won't allow.)
  // Other apps: we get out of the way entirely (hidden, not minimised), and come back as a
  // freshly shown window, which desktops do bring to the front.
  stepAsideHow = id === 'mpv' ? 'under' : 'hidden';
  stepAsideKiosk = false;
  if (stepAsideHow === 'hidden') win.hide();
  log.debug(`[apps] stepping aside for ${id} (${stepAsideHow === 'under' ? 'staying underneath' : 'hidden'})`);
}

function stepBack() {
  externalApp = null;
  if (win.isMinimized()) win.restore();
  if (stepAsideKiosk) { win.setKiosk(true); win.setFullScreen(true); }
  log.debug('[apps] coming back to the front');
  // Come back to the front with the keyboard and controller, without a click. Window managers
  // don't always let an app take focus, so: show, focus, ask for it outright, and (the trick most
  // of them respect) be "always on top" for a moment.
  win.show();
  win.focus();
  try { app.focus({ steal: true }); } catch { /* not on this platform */ }
  win.setAlwaysOnTop(true);
  setTimeout(() => { if (!win.isDestroyed()) { win.setAlwaysOnTop(false); win.focus(); activeView().webContents.focus(); } }, 300);
  activeView().webContents.focus();
  home.webContents.send('external:closed');
}

// Hand over to another app. If it never gets going (it quits straight away with an error), we
// come straight back, say so, and run fallback (YouTube's website instead of VacuumTube, say).
async function handOff(id, args = [], fallback = null) {
  if (externalApp) return { error: 'busy' };
  const onFailed = () => {
    if (externalApp !== id) return;
    stepBack();
    const name = apps.info(id).name;
    home.webContents.send('toast', fallback
      ? `${name} didn't start, so it's opening here instead. The log (Settings → Troubleshooting) says why.`
      : `${name} didn't start. The log (Settings → Troubleshooting) says why.`);
    if (fallback) fallback();
  };
  const r = await apps.launch(id, args, stepBack, { onFailed, log });
  if (r.ok) stepAside(id);
  return r;
}

// Full screen on or off (Settings → General). Some window managers need asking twice.
function setFullScreen(on) {
  win.setKiosk(on);
  win.setFullScreen(on);
  setTimeout(() => { if (!win.isDestroyed() && win.isFullScreen() !== on) win.setFullScreen(on); }, 400);
}
ipcMain.handle('ui:set-motion', (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.motion = Boolean(on);
  saveUserConfig({ motion: CONFIG.motion });
  overlay?.webContents.send('motion', CONFIG.motion);
  return settingsState();
});
ipcMain.handle('ui:set-fullscreen', (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.fullScreen = Boolean(on);
  saveUserConfig({ fullScreen: CONFIG.fullScreen });
  setFullScreen(CONFIG.fullScreen);
  return settingsState();
});

ipcMain.handle('ui:set-kb-confirm', (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.kbConfirm = Boolean(on);
  saveUserConfig({ kbConfirm: CONFIG.kbConfirm });
  return settingsState();
});

// ------------------------------------------------------------ suggestions while typing
//
// The keyboards ask after a short pause in typing (never on every key). where: 'search' or
// 'music' (the Search screen, which passes the titles it's showing), 'radio' (station search),
// 'words' (just finishing words), 'web' (a website's text field; what kind of field it is comes
// from the website's page: search boxes get titles too, email fields only email endings, and
// password fields nothing).

const suggester = createSuggester();
const titleCache = new Map(); // TMDB titles for website search boxes, by what was typed

async function tmdbTitles(text) {
  const q = text.trim().toLowerCase();
  if (q.length < 2 || !CONFIG.tmdbKey) return [];
  if (titleCache.has(q)) return titleCache.get(q);
  let titles = [];
  try { titles = (await tmdb.search(q)).filter((c) => c.kind === 'movie' || c.kind === 'tv').map((c) => c.title); } catch { /* no titles, then */ }
  titleCache.set(q, titles);
  if (titleCache.size > 60) titleCache.delete(titleCache.keys().next().value);
  return titles;
}

ipcMain.handle('suggest:get', async (event, text, where, titles) => {
  if (!fromOurPages(event) || !CONFIG.suggest.on) return [];
  const t = String(text || '').slice(0, 300);
  const w = String(where || '');
  const fromHomePage = fromHome(event);
  if (w === 'web') {
    const f = keyboardField;
    if (fromHomePage || !keyboardOpen || !f || f.kind === 'password') return [];
    const isSearch = f.kind === 'search';
    return suggester.suggest(t, { past: isSearch ? CONFIG.suggest.past.web : [], titles: isSearch ? await tmdbTitles(t) : [], words: f.kind !== 'email' });
  }
  if (!fromHomePage) return [];
  const known = Array.isArray(titles) ? titles.filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 40) : [];
  if (w === 'words') return suggester.suggest(t, {});
  if (!PAST_PLACES.includes(w)) return [];
  return suggester.suggest(t, { past: CONFIG.suggest.past[w], titles: known });
});

// A search worth remembering (you opened something it found, or sent it).
ipcMain.on('suggest:remember', (event, text, where) => {
  if (!fromOurPages(event) || !CONFIG.suggest.on || !CONFIG.suggest.remember) return;
  const w = String(where || '');
  if (!PAST_PLACES.includes(w)) return;
  if (w === 'web' ? fromHome(event) || !keyboardField || keyboardField.kind !== 'search' : !fromHome(event)) return;
  CONFIG.suggest.past[w] = rememberIn(CONFIG.suggest.past[w], text);
  saveUserConfig({ suggest: CONFIG.suggest });
});

// Settings → Controller → On-screen keyboard.
ipcMain.handle('ui:set-suggest', (event, patch) => {
  if (!fromHome(event) || !patch || typeof patch !== 'object') return null;
  if (typeof patch.on === 'boolean') CONFIG.suggest.on = patch.on;
  if (typeof patch.remember === 'boolean') CONFIG.suggest.remember = patch.remember;
  if (patch.forget || patch.remember === false) for (const k of PAST_PLACES) CONFIG.suggest.past[k] = [];
  saveUserConfig({ suggest: CONFIG.suggest });
  return settingsState();
});

// Where an app is, set by hand (Settings → Apps), for installs it can't find by itself.
ipcMain.handle('apps:set-path', (event, id, p) => {
  if (!fromHome(event) || !['vacuumtube', 'mpv', 'jellyfin'].includes(id)) return null;
  const clean = String(p || '').trim();
  if (clean) { try { fs.accessSync(clean, fs.constants.X_OK); } catch { return { error: 'not-found' }; } }
  CONFIG.appPaths = { ...(CONFIG.appPaths || {}), [id]: clean };
  saveUserConfig({ appPaths: CONFIG.appPaths });
  apps.setCustomPath(id, clean);
  log.info(`[apps] ${id} path set to ${clean || '(find it by itself)'}`);
  return { ok: true };
});

ipcMain.handle('apps:status', async (event, again) => {
  if (!fromHome(event)) return null;
  if (again) apps.forget();
  const where = (how) => (!how ? null : how.via === 'flatpak' ? 'Flatpak' : how.via === 'appimage' ? `AppImage (${path.basename(how.cmd)})` : how.via && how.via.startsWith('app launcher') ? `${how.cmd}` : how.cmd);
  const [vt, jfd, mpvHow] = await Promise.all([apps.locate('vacuumtube'), apps.locate('jellyfin'), apps.locate('mpv')]);
  await checkVacuumTube();
  log.debug('[apps] vacuumtube:', where(vt) || 'not installed', '| mpv:', where(mpvHow) || 'not installed', '| jellyfin desktop:', where(jfd) || 'not installed');
  return {
    vacuumtube: Boolean(vt), jellyfin: Boolean(jfd), mpv: Boolean(mpvHow),
    where: { vacuumtube: where(vt), jellyfin: where(jfd), mpv: where(mpvHow) },
  };
});

// ---------------------------------------------------------------- Jellyfin servers

const jf = createJellyfin({ deviceId: () => CONFIG.jellyfinDeviceId, version: '0.1.0', log });
const plex = createPlex({ clientId: () => CONFIG.plex.clientId, version: '0.1.0', log });

// Every server you watch from: Jellyfin and Plex. be(server) is the module that talks to it
// (both answer in the same shapes).
const plexServers = () => (CONFIG.plex.servers || []).filter((s) => s.enabled !== false && s.token && s.url);
const mediaServers = () => [...signedInServers(), ...plexServers()];
const be = (server) => (server && server.type === 'plex' ? plex : jf);

const publicServers = () => CONFIG.jellyfinServers.map(({ id, name, url, userName, token }) => ({
  id, name, url, userName: userName || '', signedIn: Boolean(token),
}));

function saveServers() {
  saveUserConfig({ jellyfinServers: CONFIG.jellyfinServers });
  home?.webContents.send('jf:changed', publicServers());
}

function addServer(info, auth) {
  CONFIG.jellyfinServers = [
    ...CONFIG.jellyfinServers.filter((s) => s.id !== info.id),
    { id: info.id, name: info.name, url: info.url, userId: auth.userId, userName: auth.userName, token: auth.token },
  ];
  saveServers();
  return publicServers().find((s) => s.id === info.id);
}

// Errors come back as { error: code }: 'unreachable', 'unauthorized', 'not-jellyfin', 'bad-address', 'qc-off'...
function jfHandler(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromHome(event)) return { error: 'failed' };
    try { return { ok: await fn(...args) }; } catch (err) {
      if (!err.code) console.error(`[jellyfin] ${channel}:`, err.message);
      return { error: err.code || 'failed' };
    }
  });
}

jfHandler('jf:list', async () => publicServers());
jfHandler('jf:discover', async () => {
  const mine = new Set(CONFIG.jellyfinServers.filter((s) => s.token).map((s) => s.id));
  return (await jf.discover()).filter((s) => !mine.has(s.id));
});
jfHandler('jf:probe', (url) => jf.publicInfo(String(url)));

let qc = null; // the Quick Connect sign-in in progress
jfHandler('jf:qc-start', async (url) => {
  const info = await jf.publicInfo(String(url));
  const r = await jf.quickConnectStart(info.url);
  if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
  qc = { info, secret: r.secret, cancelled: false };
  return { code: r.code, server: { name: info.name, url: info.url } };
});
jfHandler('jf:qc-wait', async () => {
  const mine = qc;
  if (!mine) throw Object.assign(new Error('none'), { code: 'cancelled' });
  const until = Date.now() + 10 * 60 * 1000;
  while (!mine.cancelled && Date.now() < until) {
    if (await jf.quickConnectCheck(mine.info.url, mine.secret).catch(() => false)) {
      const auth = await jf.quickConnectFinish(mine.info.url, mine.secret);
      if (qc === mine) qc = null;
      return addServer(mine.info, auth);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Object.assign(new Error('cancelled'), { code: mine.cancelled ? 'cancelled' : 'expired' });
});
jfHandler('jf:qc-cancel', async () => { if (qc) qc.cancelled = true; qc = null; return true; });
jfHandler('jf:signin', async (url, username, password) => {
  const info = await jf.publicInfo(String(url));
  const auth = await jf.signIn(info.url, String(username), String(password));
  return addServer(info, auth);
});
jfHandler('jf:remove', async (id) => {
  CONFIG.jellyfinServers = CONFIG.jellyfinServers.filter((s) => s.id !== id);
  saveServers();
  return publicServers();
});
// ---------------------------------------------------------------- Plex
//
// Sign in with a code: the person enters it at plex.tv/link on a phone or computer. Then every
// server on the account (theirs, and ones shared with them) can be used, each switched on or off.

const publicPlex = () => ({
  signedIn: Boolean(CONFIG.plex.accountToken),
  userName: CONFIG.plex.userName,
  servers: (CONFIG.plex.servers || []).map((x) => ({ id: x.id, name: x.name, owned: x.owned, enabled: x.enabled !== false, reachable: Boolean(x.url), url: x.url })),
});
function savePlex() {
  saveUserConfig({ plex: CONFIG.plex });
  home?.webContents.send('plex:changed', publicPlex());
}
// Look up the account's servers again (new ones, new addresses), keeping which are switched off.
async function refreshPlexServers() {
  if (!CONFIG.plex.accountToken) return publicPlex();
  const found = await plex.servers(CONFIG.plex.accountToken);
  const before = new Map((CONFIG.plex.servers || []).map((x) => [x.id, x]));
  CONFIG.plex.servers = found.map((x) => ({ ...x, enabled: before.has(x.id) ? before.get(x.id).enabled !== false : true }));
  log.info(`[plex] servers: ${CONFIG.plex.servers.map((x) => `${x.name} (${x.url ? new URL(x.url).host : 'not reachable'})`).join(', ') || 'none'}`);
  savePlex();
  return publicPlex();
}

let plexPin = null;
jfHandler('plex:state', async () => publicPlex());
jfHandler('plex:start', async () => {
  if (plexPin) plexPin.cancelled = true;
  const pin = await plex.pinStart();
  plexPin = { ...pin, cancelled: false };
  return { code: pin.code, url: 'https://plex.tv/link' };
});
jfHandler('plex:wait', async () => {
  const mine = plexPin;
  if (!mine) throw Object.assign(new Error('none'), { code: 'cancelled' });
  while (!mine.cancelled && Date.now() < mine.expiresAt) {
    const token = await plex.pinCheck(mine.id).catch(() => null);
    if (token) {
      if (plexPin === mine) plexPin = null;
      const who = await plex.account(token).catch(() => ({ userName: 'Plex' }));
      CONFIG.plex.accountToken = token;
      CONFIG.plex.userName = who.userName;
      log.info(`[plex] signed in as ${who.userName}`);
      return refreshPlexServers();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Object.assign(new Error('cancelled'), { code: mine.cancelled ? 'cancelled' : 'expired' });
});
jfHandler('plex:cancel', async () => { if (plexPin) plexPin.cancelled = true; plexPin = null; return true; });
jfHandler('plex:refresh', async () => refreshPlexServers());
jfHandler('plex:toggle', async (id) => {
  const x = (CONFIG.plex.servers || []).find((y) => y.id === id);
  if (x) x.enabled = x.enabled === false;
  savePlex();
  return publicPlex();
});
jfHandler('plex:signout', async () => {
  CONFIG.plex = { ...CONFIG.plex, accountToken: '', userName: '', servers: [] };
  log.info('[plex] signed out');
  savePlex();
  return publicPlex();
});
// Every server to browse in Library: Jellyfin and Plex.
jfHandler('media:servers', async () => [
  ...publicServers().filter((x) => x.signedIn).map((x) => ({ ...x, kind: 'jellyfin' })),
  ...plexServers().map((x) => ({ id: x.id, name: x.name, url: x.url, signedIn: true, kind: 'plex' })),
]);

jfHandler('jf:find', async (kind, tmdbId, title, year) => {
  const item = { kind: String(kind), tmdbId: Number(tmdbId), title: String(title), year };
  const [a, b] = await Promise.all([jf.find(CONFIG.jellyfinServers, item), plex.find(plexServers(), item)]);
  const problems = [...a.problems, ...b.problems];
  return { matches: [...a.matches, ...b.matches], signedOut: problems.filter((p) => p.code === 'unauthorized').map((p) => p.serverId) };
});

// When the server couldn't match an episode, its name is the filename and it has no plot.
// Fill those in from TMDB by season and episode number.
const looksLikeFile = (n) => !n || /\.(mkv|mp4|m4v|avi|ts|webm|mov|wmv)$/i.test(n) ||
  /\bS\d{1,2}\s?E\d{1,3}\b/i.test(n) || (/[._]/.test(n) && !/\s/.test(n));
const showTmdbIds = new Map(); // `${serverId}:${seriesId}` -> TMDB id (or null)

async function enrichEpisodes(server, eps, { plots = true } = {}) {
  if (!CONFIG.tmdbKey) return eps;
  const need = eps.filter((e) => e.type === 'Episode' && e.seriesId && e.season != null && e.episode != null &&
    (looksLikeFile(e.name) || (plots && !e.overview)));
  const bySeries = new Map();
  for (const e of need) bySeries.set(e.seriesId, [...(bySeries.get(e.seriesId) || []), e]);
  await Promise.all([...bySeries].map(async ([seriesId, list]) => {
    const key = `${server.id}:${seriesId}`;
    if (!showTmdbIds.has(key)) showTmdbIds.set(key, await be(server).seriesTmdbId(server, seriesId).catch(() => null));
    const tmdbId = showTmdbIds.get(key);
    if (!tmdbId) return;
    const seasons = [...new Set(list.map((e) => e.season))];
    const info = {};
    await Promise.all(seasons.map(async (n) => { info[n] = await tmdb.seasonEpisodes(tmdbId, n).catch(() => ({})); }));
    for (const e of list) {
      const t = (info[e.season] || {})[e.episode];
      if (!t) continue;
      if (looksLikeFile(e.name) && t.name) e.name = t.name;
      if (plots && !e.overview && t.overview) e.overview = t.overview;
    }
  }));
  return eps;
}

const serverFor = (id) => {
  const server = CONFIG.jellyfinServers.find((s) => s.id === id) || plexServers().find((s) => s.id === id);
  if (!server) throw Object.assign(new Error('gone'), { code: 'gone' });
  return server;
};

jfHandler('jf:item', (serverId, itemId) => { const s = serverFor(serverId); return be(s).getItem(s, String(itemId)); });
jfHandler('jf:seasons', (serverId, seriesId) => { const s = serverFor(serverId); return be(s).seasons(s, String(seriesId)); });
jfHandler('jf:episodes', async (serverId, seriesId, seasonId) => {
  const server = serverFor(serverId);
  return enrichEpisodes(server, await be(server).episodes(server, String(seriesId), String(seasonId)));
});
jfHandler('jf:nextup', async (serverId, seriesId) => {
  const server = serverFor(serverId);
  const next = await be(server).nextUp(server, String(seriesId));
  if (next) await enrichEpisodes(server, [next], { plots: false });
  return next;
});

// ---------------------------------------------------------------- playing in mpv
//
// The original file straight from the server (no transcoding). Shows play as a playlist of every
// episode, starting at the one you picked, so next/previous and autoplay work. Each episode is
// reported to Jellyfin as it starts and stops, so resume points and watched marks stay right.

const DEFAULT_PLAYBACK = {
  autoplay: true,
  skipIntro: false,
  skipCredits: false,
  confirmStop: true, // press stop twice to leave mpv, so one stray press doesn't end the show
  stillWatching: { mode: 'time', episodes: 3, minutes: 180 }, // mode: 'off' | 'episodes' | 'time'
  seek: { ...player.SEEK_DEFAULTS }, // how far each skip button goes, in seconds
  rewindOnResume: false, // after a pause, carry on from a second earlier
  appPad: true, // the app reads the controller in mpv (the menu, the hold buttons); off: mpv reads it itself
};

function cleanPlayback(saved) {
  const p = { ...DEFAULT_PLAYBACK, stillWatching: { ...DEFAULT_PLAYBACK.stillWatching }, seek: { ...DEFAULT_PLAYBACK.seek } };
  if (!saved || typeof saved !== 'object') return p;
  for (const k of ['autoplay', 'skipIntro', 'skipCredits', 'confirmStop', 'rewindOnResume', 'appPad']) if (typeof saved[k] === 'boolean') p[k] = saved[k];
  for (const k of Object.keys(p.seek)) if (saved.seek && player.SEEK_STEPS.includes(saved.seek[k])) p.seek[k] = saved.seek[k];
  const sw = saved.stillWatching || {};
  if (['off', 'episodes', 'time'].includes(sw.mode)) p.stillWatching.mode = sw.mode;
  if (Number.isInteger(sw.episodes)) p.stillWatching.episodes = Math.min(20, Math.max(1, sw.episodes));
  if (Number.isInteger(sw.minutes)) p.stillWatching.minutes = Math.min(720, Math.max(15, sw.minutes));
  return p;
}

// L2 and R2 are "hold" buttons (meta): held (or both pressed to lock), ◀ ▶ skip further and ▲ ▼
// change the volume. Start and ▲ open the menu. (back60, fwd60, volup and voldown are what holding
// does; they can still be given buttons of their own.)
const DEFAULT_MPV_BINDINGS = {
  pause: 0, stop: 1, subs: 2, skip: 3, prev: 4, next: 5, meta: 6, meta2: 7,
  audio: 8, menu: 9, sound: 10, visual: 11, menu2: 12, time: 13, back10: 14, fwd30: 15,
  back60: null, fwd60: null, volup: null, voldown: null,
};
const MPV_ACTIONS = Object.keys(DEFAULT_MPV_BINDINGS);

function cleanMpvBindings(saved) {
  const out = { ...DEFAULT_MPV_BINDINGS };
  if (saved && typeof saved === 'object') {
    for (const a of MPV_ACTIONS) {
      const n = saved[a];
      if (n === null) out[a] = null;
      else if (Number.isInteger(n) && n >= 0 && n <= 16) out[a] = n;
    }
    // Saved before the menu (November 27, 2026): L2, R2, ▲ and ▼ make way for the hold buttons and
    // the menu, where they still had their old jobs.
    if (!('meta' in saved)) {
      for (const [a, b] of [['back60', 6], ['fwd60', 7], ['volup', 12], ['voldown', 13]]) if (out[a] === b) out[a] = null;
      if (out.time === 9) out.time = MPV_ACTIONS.some((x) => out[x] === 13) ? null : 13;
    }
    // An action added since these were saved doesn't take a button you've already given to another.
    for (const a of MPV_ACTIONS) {
      if (a in saved || out[a] == null) continue;
      if (MPV_ACTIONS.some((b) => b !== a && out[b] === out[a])) out[a] = null;
    }
  }
  return out;
}

const BUTTON_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Select', 9: 'Start',
  10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'Home',
};
const buttonName = (i) => (i == null ? '—' : BUTTON_NAMES[i] || `Button ${i}`);

// The panel of buttons mpv shows, for what's playing: 'video' (films and shows), 'song', 'station'
// or 'live'. When the app reads the controller, that's the trigger menu (while L2 or R2 is held);
// otherwise mpv's own panel (when it starts, while paused, and on the time button).
function mpvHelp(kind = 'video') {
  const b = CONFIG.mpvBindings;
  const keys = (...actions) => (actions.every((a) => b[a] != null) ? actions.map((a) => buttonName(b[a])) : null);
  const items = [];
  const add = (label, ...actions) => { const k = keys(...actions); if (k) items.push({ keys: k, label }); };
  const one = { video: 'episode', song: 'song', station: 'station', live: 'channel' }[kind];
  add('Pause', 'pause');
  add(`Previous / next ${one}`, 'prev', 'next');
  if (kind === 'video') add('Skip intro / credits', 'skip');
  if (kind === 'live') add('What\'s on', 'skip');
  const sk = CONFIG.playback.seek;
  const len = (s) => (s < 60 ? `${s} s` : `${s / 60} min`);
  const pair = (a, b) => (sk[a] === sk[b] ? `Back / ahead ${len(sk[a])}` : `Back ${len(sk[a])} / ahead ${len(sk[b])}`);
  if (kind === 'video' || kind === 'song') add(pair('back10', 'fwd30'), 'back10', 'fwd30');
  if (kind === 'video') add(pair('back60', 'fwd60'), 'back60', 'fwd60');
  if (kind === 'video' || kind === 'live') add('Subtitles', 'subs');
  if (kind === 'video' || kind === 'live') add('Audio track', 'audio');
  add('Volume', 'volup', 'voldown');
  if (CONFIG.playback.appPad) {
    // In the trigger menu, ▲ and ▼ change the volume (unless they're set to something else).
    const free = (btn) => !Object.keys(b).some((a) => b[a] === btn && !['menu', 'menu2', 'time'].includes(a));
    if (b.volup == null && free(12) && free(13)) items.push({ keys: ['▲', '▼'], label: 'Volume' });
    if (b.time != null && b.time !== 12 && b.time !== 13) add('Show the time', 'time');
  }
  add('Speakers', 'sound');
  if (kind === 'song' || kind === 'station') add('Picture', 'visual');
  add('Stop', 'stop');
  return items;
}
const triggerNames = () => [CONFIG.mpvBindings.meta, CONFIG.mpvBindings.meta2].filter((x) => x != null).map(buttonName);
function mpvHelpFooter() {
  if (CONFIG.playback.appPad) {
    const t = triggerNames();
    return t.length === 2 ? `Let go to hide · press ${t[0]} + ${t[1]} together to lock the buttons on` : 'Let go to hide';
  }
  const t = CONFIG.mpvBindings.time;
  return t == null ? 'Pause to see these again' : `Pause, or press ${buttonName(t)}, to see these again`;
}
// What every mpv start shares: the panel's footer, the speakers, and whether panels fade.
// (The volume carries over: the next thing plays as loud as the last was left.)
const mpvCommon = () => ({
  appPad: CONFIG.playback.appPad,
  volume: CONFIG.mpvVolume,
  onVolume: (v) => {
    if (v === CONFIG.mpvVolume) return;
    CONFIG.mpvVolume = v;
    saveUserConfig({ mpvVolume: v });
  },
  helpFooter: mpvHelpFooter(),
  // The theme's colours, for the menus and panels drawn on mpv's screen.
  colors: (() => { const l = currentLook(); const c = { ...themes.scheme(l.colors).colors }; if (l.accent) c.accent = l.accent; return c; })(),
  // (Shown once when something starts, when the app reads the controller.)
  padHint: triggerNames().length ? ['Press any button for the menu', `Hold ${triggerNames().join(' or ')} for every control`] : ['Press any button for the menu'],
  seeks: CONFIG.playback.seek,
  sound: CONFIG.mpvSound,
  motion: CONFIG.motion,
  onSound: (value) => { CONFIG.mpvSound = value; saveUserConfig({ mpvSound: value }); },
});
// Music and radio: the picture (visualiser) to show, remembered when it's changed, and each
// entry's cover (or station logo) fetched to a file mpv can read. urlOf(i): the picture's address.
function mpvMusic(how, urlOf) {
  return {
    visual: CONFIG.mpvVisual,
    onVisual: (id) => { CONFIG.mpvVisual = id; saveUserConfig({ mpvVisual: id }); },
    cover: (i) => coverFile(how, urlOf(i)),
  };
}

// A picture from one of your servers (jfimg://<server id>/Items/<id>/Images/Primary…), fetched
// with that server's own sign-in: for the pages (as jfimg: addresses) and for mpv's covers.
async function serverImage(url) {
  try {
    const u = new URL(url);
    const id = decodeURIComponent(u.hostname);
    const server = CONFIG.jellyfinServers.find((s) => s.id === id && s.token) || plexServers().find((s) => s.id.toLowerCase() === id.toLowerCase()) ||
      CONFIG.music.servers.find((s) => s.id === id);
    if (server && server.type === 'subsonic') {
      // (Navidrome: its cover picture, asked for with the sign-in out of sight.)
      const m = /^\/Items\/([^/]+)\/Images\/Primary$/.exec(u.pathname);
      if (!m) return new Response('', { status: 404 });
      const r = await subsonic.cover(server, decodeURIComponent(m[1]), 500);
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg' } });
    }
    const m = /^\/Items\/([^/]+)\/Images\/(Primary|Backdrop|Thumb)(\/0)?$/.exec(u.pathname);
    if (!server || !m) return new Response('', { status: 404 });
    // (Plex: the same kind of address, turned into Plex's picture resizer for that item.)
    const r = server.type === 'plex'
      ? await fetch(`${server.url}${plex.imagePath(decodeURIComponent(m[1]), m[2])}`, { headers: { 'X-Plex-Token': server.token, Accept: 'image/*' } })
      : await fetch(`${server.url}${u.pathname}${u.search}`, { headers: { 'X-Emby-Token': server.token } });
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg' } });
  } catch {
    return new Response('', { status: 502 });
  }
}

// Cover pictures for mpv, saved where it can read them (sofa-cover-<n> in its shared folder), and
// tidied away when the app closes. Pictures from your servers come with that server's sign-in (as
// the app's pages get them); station logos are plain public pictures. Only real pictures are kept
// (JPEG, PNG, WebP or GIF, under 8 MB): anything else, and there's no cover.
const coverFiles = new Map(); // address -> promise of path or null
function coverFile(how, url) {
  if (!url) return Promise.resolve(null);
  if (!coverFiles.has(url)) {
    coverFiles.set(url, (async () => {
      try {
        const r = /^jfimg:/.test(url) ? await serverImage(url)
          : /^https?:\/\//.test(url) ? await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'SOFAKing/0.1', Accept: 'image/*' } })
            : null;
        if (!r || !r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        const ext = buf.length > 8 * 1024 * 1024 ? null
          : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
            : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
              : buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' ? 'webp'
                : buf.subarray(0, 3).toString() === 'GIF' ? 'gif' : null;
        if (!ext) return null;
        const file = path.join(player.sharedDir(how.via), `sofa-cover-${process.pid}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}.${ext}`);
        fs.writeFileSync(file, buf);
        return file;
      } catch {
        return null;
      }
    })());
  }
  return coverFiles.get(url);
}
async function forgetCovers() {
  for (const p of coverFiles.values()) { const f = await p.catch(() => null); if (f) fs.rm(f, { force: true }, () => {}); }
  coverFiles.clear();
}

const titleOf = (e) => (e.series ? `${e.series} · S${e.season ?? '?'}E${e.episode ?? '?'} · ${e.name}` : e.name);

async function playInMpv(server, itemId, resume, how) {
  if (externalApp) throw Object.assign(new Error('busy'), { code: 'busy' });
  const first = (await enrichEpisodes(server, [await be(server).getItem(server, itemId)], { plots: false }))[0];
  let list = [first];
  let index = 0;
  if (first.type === 'Episode' && first.seriesId) {
    try {
      const all = await enrichEpisodes(server, await be(server).allEpisodes(server, first.seriesId), { plots: false });
      const i = all.findIndex((e) => e.id === first.id);
      if (i >= 0) { list = all; index = i; }
    } catch { /* play just this one */ }
  }
  const entries = list.map((e, i) => ({
    url: be(server).streamUrl(server, e.id, e),
    title: titleOf(e),
    start: i === index && resume ? first.position : 0,
  }));

  const sess = { server, list, current: null, startedAt: Date.now(), started: 0, asking: false, sawPause: false, askTimer: null };
  stepAside('mpv');
  const ctl = playMpv({
    how,
    entries,
    startIndex: index,
    token: server.token,
    tokenHeader: server.type === 'plex' ? 'X-Plex-Token' : 'X-Emby-Token',
    screenArgs: mpvScreenArgs(),
    bindings: CONFIG.mpvBindings,
    help: mpvHelp('video'),
    kind: 'video',
    ...mpvCommon(),
    rewindOnResume: CONFIG.playback.rewindOnResume,
    links: (i) => titleLinks(server, list[i]),
    keepAwake: true,
    loadingText: (i) => `Loading ${entries[i] ? entries[i].title : ''}…`,
    log, logFile: mpvLogFile(how),
    autoplay: CONFIG.playback.autoplay,
    onFileStart: (i) => startEpisode(sess, ctl, i),
    onFileEnd: (i, reason, pos, dur) => endEpisode(sess, i, reason, pos, dur),
    onState: (st) => playbackState(sess, ctl, st),
    onMessage: (args) => {
      if (args[0] === 'tv-overlay-skip') skipSegment(sess, ctl);
      if (args[0] === 'tv-overlay-stop') confirmStop(sess, ctl);
    },
    onExit: (error) => {
      clearTimeout(sess.askTimer);
      stepBack();
      home.webContents.send('jf:played', { serverId: server.id, itemId, error });
    },
  });
  return { app: 'mpv' };
}

// Every mpv start goes through here. An mpv that can't read the controller itself (Flathub's, for
// one) gets the buttons from the app instead: the home page keeps reading the controller while mpv
// is in front and sends each press here ('pad-raw'), and it's passed to mpv by name.
let padlessMpv = null;
// While something plays (opts.keepAwake: films, shows, live TV, and music and radio, which show a picture too), the computer
// is told someone's watching, so the screen doesn't dim or the computer sleep. This is the standard
// "don't dim" request desktops honour (mpv sends its own there too). Steam's Game Mode has nothing
// that listens for it, unless the DeckyInhibitScreenSaver plugin is installed. Lifted while paused.
let awakeId = null;
function keepAwake(on) {
  if (on && awakeId == null) { awakeId = powerSaveBlocker.start('prevent-display-sleep'); gamescopeWatching(true); }
  else if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; gamescopeWatching(false); }
}
// ---- Settings → Advanced → Gamescope fixes (only in Steam's Game Mode, only while a picture plays)
function cleanGamescope(saved) {
  const g = saved && typeof saved === 'object' ? saved : {};
  return {
    steamDim: g.steamDim === true, // turn Steam's dimming off while watching (Steam's debugging port)
    person: g.person === true, // a pretend controller or keyboard that keeps Steam's idle timer awake
    personHow: g.personHow === 'keyboard' ? 'keyboard' : 'controller',
    madePort: g.madePort === true, // we opened Steam's debugging port (so we may close it again)
    dimmedOff: g.dimmedOff === true, // Steam's dimming is off right now, by us (put back on next start if we quit mid-film)
  };
}
const pretendPerson = gamescope.createPerson({ log });
function saveGamescope(patch) {
  CONFIG.gamescope = { ...CONFIG.gamescope, ...patch };
  saveUserConfig({ gamescope: CONFIG.gamescope });
}
async function steamDimmingBack() {
  try {
    await gamescope.steamDimming(true);
    saveGamescope({ dimmedOff: false });
    log.info('[gamescope] Steam\'s dimming back on (5 minutes, sleep after 10)');
  } catch (err) { log.warn(`[gamescope] couldn't put Steam's dimming back: ${err.code || err.message}`); }
}
function gamescopeWatching(on) {
  if (!gamescope.inGameMode()) return;
  const g = CONFIG.gamescope;
  if (g.steamDim && on) {
    gamescope.steamDimming(false).then(() => { saveGamescope({ dimmedOff: true }); log.info('[gamescope] Steam\'s dimming off while this plays'); })
      .catch((err) => log.warn(`[gamescope] couldn't turn Steam's dimming off: ${err.code || err.message}`));
  } else if (!on && g.dimmedOff) steamDimmingBack();
  if (g.person && on) pretendPerson.start(g.personHow);
  else if (!on) pretendPerson.stop();
}

function playMpv(opts) {
  // (Paused for a few seconds before the screen may dim: changing the picture for music pauses
  // mpv for a blink, which shouldn't turn Steam's dimming back on and off each time.)
  let lift = null;
  const awake = (on) => {
    clearTimeout(lift);
    if (on) keepAwake(true); else lift = setTimeout(() => keepAwake(false), 4000);
  };
  const ctl = player.play({
    ...opts,
    onState: (st) => { if (opts.keepAwake) awake(!st.paused); opts.onState(st); },
    onPadless: () => { padlessMpv = ctl; home?.webContents.send('pad:to-mpv', true); },
    onExit: (error) => {
      clearTimeout(lift);
      keepAwake(false);
      if (padlessMpv === ctl) { padlessMpv = null; home?.webContents.send('pad:to-mpv', false); }
      opts.onExit(error);
    },
  });
  return ctl;
}
ipcMain.on('pad-raw', (event, button, phase) => {
  if (padlessMpv && home && event.sender === home.webContents && Number.isInteger(button)) padlessMpv.press(button, ['down', 'repeat', 'up'].includes(phase) ? phase : 'down');
});

// "Are you sure?": the first press asks, a second press within a few seconds stops.
// mpv on the same screen as the TV app. Automatic: the screen the app's window is on (screens
// counted left to right, as mpv counts them), placed there too (for desktops that let apps choose
// where they open). Or a screen picked in Settings → Apps, for desktops where that guess is wrong.
function mpvScreenArgs() {
  try {
    const { screen } = electron;
    const all = screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    const picked = Number.isInteger(CONFIG.mpvScreen) ? CONFIG.mpvScreen : null;
    const here = screen.getDisplayMatching(win.getBounds());
    const i = picked != null ? Math.min(picked, Math.max(0, all.length - 1)) : Math.max(0, all.findIndex((d) => d.id === here.id));
    const d = all[i] || here;
    const f = d.scaleFactor || 1;
    const b = d.bounds;
    const args = [`--screen=${i}`, `--fs-screen=${i}`,
      `--geometry=${Math.round(b.width * f)}x${Math.round(b.height * f)}+${Math.round(b.x * f)}+${Math.round(b.y * f)}`];
    // A screen known by its connector name (DP-1, HDMI-A-1...): mpv can use that directly.
    if (/^(e?DP|HDMI|DVI|VGA|LVDS|Virtual|USB-C)(-[A-Z])?-\d+$/i.test(d.label || '')) args.push(`--screen-name=${d.label}`, `--fs-screen-name=${d.label}`);
    log.debug(`[mpv] screen ${i + 1} of ${all.length}${picked != null ? ' (picked in Settings)' : ' (the app\'s)'}: ${d.label || 'unnamed'} ${b.width}x${b.height} at ${b.x},${b.y}`);
    return args;
  } catch (err) {
    log.debug(`[mpv] couldn't work out the screen: ${err.message}`);
    return [];
  }
}
ipcMain.handle('ui:set-mpv-screen', (event, n) => {
  if (!fromHome(event)) return null;
  CONFIG.mpvScreen = Number.isInteger(n) && n >= 0 && n < 8 ? n : null;
  saveUserConfig({ mpvScreen: CONFIG.mpvScreen });
  return settingsState();
});
ipcMain.handle('ui:screens', (event) => (fromHome(event) ? electron.screen.getAllDisplays().length : 1));

const STOP_WINDOW = 3000;
function confirmStop(sess, ctl, what = 'watching') {
  const now = Date.now();
  if (!CONFIG.playback.confirmStop || (sess.stopAskedAt && now - sess.stopAskedAt < STOP_WINDOW)) {
    ctl.command(['quit']);
    return;
  }
  sess.stopAskedAt = now;
  ctl.say(`Stop ${what}? Press ${buttonName(CONFIG.mpvBindings.stop)} again to stop.`, STOP_WINDOW);
}

// ---- telling Trakt what's playing (Settings → Trakt, off by default)

async function traktTarget(sess, item) {
  if (item.traktTarget !== undefined) return item.traktTarget;
  let t = null;
  try {
    if (item.type === 'Movie') {
      const id = item.tmdbId || (await be(sess.server).getItem(sess.server, item.id)).tmdbId;
      if (id) t = { kind: 'movie', tmdbId: id };
    } else if (item.type === 'Episode' && item.seriesId && item.season != null && item.episode != null) {
      const key = `${sess.server.id}:${item.seriesId}`;
      if (!showTmdbIds.has(key)) showTmdbIds.set(key, await be(sess.server).seriesTmdbId(sess.server, item.seriesId).catch(() => null));
      const show = showTmdbIds.get(key);
      if (show) t = { kind: 'episode', showTmdbId: show, season: item.season, episode: item.episode };
    }
  } catch { /* no match: nothing to tell Trakt */ }
  item.traktTarget = t;
  return t;
}

async function traktScrobble(sess, cur, action, seconds) {
  if (!CONFIG.trakt.scrobble || !CONFIG.trakt.accessToken) return;
  const t = await traktTarget(sess, cur.item);
  if (!t) return;
  const total = cur.duration || cur.item.runtime;
  const progress = total ? (100 * (seconds || 0)) / total : 0;
  trakt.scrobble(action, t, progress).catch((err) => { if (err.code !== 'signed-out') console.warn('[trakt] scrobble:', err.message); });
}

async function startEpisode(sess, ctl, i) {
  const item = sess.list[i];
  if (!item) return;
  const cur = { index: i, item, ids: null, segments: [], inSegment: null, lastPos: null, lastProgress: 0 };
  sess.current = cur;
  sess.started += 1;
  if (sess.started > 1 && stillWatchingDue(sess)) askStillWatching(sess, ctl);
  try {
    const api = be(sess.server);
    const [info, segs] = await Promise.all([api.playbackInfo(sess.server, item.id), api.segments(sess.server, item.id)]);
    if (sess.current !== cur) return;
    cur.ids = { itemId: item.id, mediaSourceId: info.mediaSourceId, playSessionId: info.playSessionId, duration: info.duration || (item.runtime || 0) * 1000 };
    cur.segments = segs;
    for (const sub of info.subtitles) ctl.command(['sub-add', sub, 'auto']); // available, not switched on
    api.report(sess.server, 'start', { ...cur.ids, seconds: cur.lastPos || 0 });
  } catch { /* plays anyway; just no report for this one */ }
  cur.traktPaused = false;
  traktScrobble(sess, cur, 'start', cur.lastPos || (item.position || 0));
}

function endEpisode(sess, i, reason, pos, dur) {
  const cur = sess.current;
  if (!cur || cur.index !== i) return;
  sess.current = null;
  const seconds = reason === 'eof' ? (dur || pos || cur.lastPos || 0) : (pos ?? cur.lastPos ?? 0);
  if (cur.ids) be(sess.server).report(sess.server, 'stopped', { ...cur.ids, seconds });
  if (dur) cur.duration = dur;
  traktScrobble(sess, cur, 'stop', seconds);
}

function playbackState(sess, ctl, st) {
  const cur = sess.current;
  if (!cur || st.index !== cur.index) return;
  if (st.position != null) cur.lastPos = st.position;
  if (st.duration) cur.duration = st.duration;
  if (Boolean(st.paused) !== Boolean(cur.traktPaused) && cur.traktPaused !== undefined) {
    cur.traktPaused = Boolean(st.paused);
    traktScrobble(sess, cur, st.paused ? 'pause' : 'start', st.position);
  }

  // "Still watching?" is answered by un-pausing.
  if (sess.asking) {
    if (st.paused) sess.sawPause = true;
    else if (sess.sawPause) {
      sess.asking = false;
      clearTimeout(sess.askTimer);
      sess.startedAt = Date.now();
      sess.started = 1;
      ctl.say('', 1);
    }
  }

  const now = Date.now();
  if (cur.ids && st.position != null && now - cur.lastProgress > 10_000) {
    cur.lastProgress = now;
    be(sess.server).report(sess.server, 'progress', { ...cur.ids, seconds: st.position, paused: st.paused });
  }

  // Intros and credits: offer the skip button, or skip straight away if that's switched on.
  const pos = st.position;
  if (pos == null) return;
  const seg = cur.segments.find((g) => pos >= g.start && pos < g.end - 1);
  if (seg && cur.inSegment !== seg) {
    cur.inSegment = seg;
    const auto = seg.type === 'intro' ? CONFIG.playback.skipIntro : CONFIG.playback.skipCredits;
    if (auto) skipSegment(sess, ctl, seg);
    else ctl.say(`Press ${buttonName(CONFIG.mpvBindings.skip)} to skip ${seg.type === 'intro' ? 'the intro' : 'the credits'}`, 6000);
  } else if (!seg) {
    cur.inSegment = null;
  }
}

function skipSegment(sess, ctl, seg) {
  const cur = sess.current;
  if (!cur) return;
  const pos = cur.lastPos ?? 0;
  seg = seg || cur.segments.find((g) => pos >= g.start - 1 && pos < g.end - 1);
  if (!seg) { ctl.say('Nothing to skip here', 2000); return; }
  // Skipping credits with autoplay on goes straight to the next episode.
  if (seg.type === 'credits' && CONFIG.playback.autoplay && cur.index < sess.list.length - 1) ctl.command(['playlist-next']);
  else ctl.command(['seek', seg.end, 'absolute']);
}

function stillWatchingDue(sess) {
  const sw = CONFIG.playback.stillWatching;
  if (sw.mode === 'episodes') return sess.started > sw.episodes;
  if (sw.mode === 'time') return Date.now() - sess.startedAt >= sw.minutes * 60_000;
  return false;
}

const ASK_FOR = 20 * 60_000; // no answer in 20 minutes: stop

function askStillWatching(sess, ctl) {
  sess.asking = true;
  sess.sawPause = false;
  ctl.command(['set', 'pause', 'yes']);
  ctl.say(`Are you still watching? Press ${buttonName(CONFIG.mpvBindings.pause)} to keep watching, ` +
    `or ${buttonName(CONFIG.mpvBindings.stop)} to stop.`, ASK_FOR);
  clearTimeout(sess.askTimer);
  sess.askTimer = setTimeout(() => ctl.command(['quit']), ASK_FOR);
}

// ---------------------------------------------------------------- playback settings

ipcMain.handle('ui:set-playback', (event, patch) => {
  if (event.sender !== home?.webContents || !patch || typeof patch !== 'object') return null;
  const merged = { ...CONFIG.playback, ...patch, stillWatching: { ...CONFIG.playback.stillWatching, ...(patch.stillWatching || {}) }, seek: { ...CONFIG.playback.seek, ...(patch.seek || {}) } };
  CONFIG.playback = cleanPlayback(merged);
  saveUserConfig({ playback: CONFIG.playback });
  return settingsState();
});

ipcMain.handle('mpvb:get', () => CONFIG.mpvBindings);
ipcMain.handle('mpvb:set', (event, action, index) => {
  if (event.sender !== home?.webContents || !MPV_ACTIONS.includes(action)) return CONFIG.mpvBindings;
  if (!Number.isInteger(index) || index < 0 || index > 16) return CONFIG.mpvBindings;
  const next = { ...CONFIG.mpvBindings };
  const previous = next[action];
  for (const a of MPV_ACTIONS) if (a !== action && next[a] === index) next[a] = previous; // swap
  next[action] = index;
  CONFIG.mpvBindings = next;
  saveUserConfig({ mpvBindings: next });
  return next;
});
ipcMain.handle('mpvb:reset', (event) => {
  if (event.sender !== home?.webContents) return CONFIG.mpvBindings;
  CONFIG.mpvBindings = { ...DEFAULT_MPV_BINDINGS };
  saveUserConfig({ mpvBindings: CONFIG.mpvBindings });
  return CONFIG.mpvBindings;
});

// Play a movie or episode with the player chosen in Settings, falling back to the built-in one.
jfHandler('jf:play', async (serverId, itemId, itemType, name, resume) => {
  const server = serverFor(serverId);
  itemId = String(itemId);
  // Plex: mpv, or else Plex's own web app (signed in once, inside the app).
  if (server.type === 'plex') {
    const how = await apps.locate('mpv');
    if (how) return playInMpv(server, itemId, Boolean(resume), how);
    openService({ id: 'plex-web', name: server.name, url: plex.webUrl(server, itemId) });
    return { app: 'web' };
  }
  if (CONFIG.jellyfinPlayer === 'mpv') {
    const how = await apps.locate('mpv');
    if (how) return playInMpv(server, itemId, Boolean(resume), how);
  }
  if (CONFIG.jellyfinPlayer === 'desktop' && await apps.locate('jellyfin')) {
    const r = await handOff('jellyfin');
    if (r.ok) {
      const shown = await jf.showInDesktop(server, { itemId, itemType: String(itemType), name: String(name) });
      return { app: 'desktop', shown };
    }
  }
  openService({ id: 'jellyfin-web', name: server.name, url: jf.webUrl(server, itemId), jellyfinServer: server });
  return { app: 'web' };
});

// ---------------------------------------------------------------- music
//
// The Music tab: find an artist, album or song in the catalogue (music.js), then show where it's
// streaming: the music services, and your own Jellyfin, Plex and Navidrome servers. Albums on your
// servers play in mpv.

const music = createMusic({ getRegion: () => CONFIG.region, getServices: () => CONFIG.music.services, log });
const subsonic = createSubsonic({ log });
const musicLinks = new Set(); // links the music pages may open (only ones the catalogue gave us)

// Every server with music: Jellyfin and Plex (unless switched off for music), and Navidrome.
const musicServers = () => [
  ...(CONFIG.music.useJellyfin ? signedInServers() : []),
  ...(CONFIG.music.usePlex ? plexServers() : []),
  ...CONFIG.music.servers,
];
const musicBe = (server) => (server.type === 'subsonic'
  ? {
    albums: (q) => subsonic.searchAlbums(server, q.title), artistAlbums: (name) => subsonic.artistAlbums(server, name), album: (id) => subsonic.album(server, id),
    recent: () => subsonic.recent(server), songs: (title) => subsonic.searchSongs(server, title),
  }
  : {
    albums: (q) => be(server).musicAlbums(server, q), artistAlbums: (name) => be(server).musicAlbums(server, { artist: name }),
    album: (id) => be(server).musicAlbum(server, id), recent: () => be(server).musicRecent(server), songs: (title) => be(server).musicSongs(server, title),
  });
const musicServerFor = (id) => {
  const server = musicServers().find((s) => s.id === id);
  if (!server) throw Object.assign(new Error('gone'), { code: 'gone' });
  return server;
};

// Ask every server at once; a server that doesn't answer is left out (and noted in the log).
async function fromEachServer(fn) {
  const all = musicServers();
  const r = await Promise.allSettled(all.map((s) => fn(musicBe(s), s)));
  const out = [];
  r.forEach((x, i) => {
    if (x.status === 'fulfilled') out.push(...(x.value || []));
    else log.debug(`[music] ${all[i].name}: ${x.reason && (x.reason.code || x.reason.message)}`);
  });
  return out;
}

const normTitle = (s) => require('./music').norm(s);
function noteLinks(links) { for (const l of links || []) musicLinks.add(l.url); if (musicLinks.size > 2000) musicLinks.clear(); }

function musicHandler(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromHome(event)) return { error: 'failed' };
    try { return { ok: await fn(...args) }; } catch (err) {
      if (!err.code) console.error(`[music] ${channel}:`, err.message);
      return { error: err.code || 'failed' };
    }
  });
}

musicHandler('music:search', (q) => music.search(String(q || '').slice(0, 100)));
musicHandler('music:charts', async () => {
  const [charts, recent] = await Promise.allSettled([music.charts(), fromEachServer((b) => b.recent())]);
  const rows = [];
  if (recent.status === 'fulfilled' && recent.value.length) rows.push({ id: 'yours', title: 'New on your servers', items: recent.value.slice(0, 40) });
  if (charts.status === 'fulfilled') rows.push(...charts.value);
  if (!rows.length) throw (charts.reason || Object.assign(new Error('unreachable'), { code: 'unreachable' }));
  return rows;
});
// An artist's page: the catalogue's shelves, and every album on your servers that credits them
// (the page sorts those in: see home.js).
musicHandler('music:artist', async (spec) => {
  const s = spec && typeof spec === 'object' ? spec : {};
  const [a, library] = await Promise.all([
    music.artist({ name: s.name ? String(s.name) : '', mbid: s.mbid ? String(s.mbid) : null, deezerId: s.deezerId ? Number(s.deezerId) : null }),
    s.name ? fromEachServer((b) => b.artistAlbums(String(s.name))) : [],
  ]);
  const more = !s.name && a.name ? await fromEachServer((b) => b.artistAlbums(a.name)) : [];
  a.library = [...library, ...more].map((x) => ({ ...x, norm: normTitle(x.title), credited: normTitle(x.artist) !== normTitle(a.name) }));
  return a;
});
musicHandler('music:extra', (mbid, which) => {
  const w = ['unofficial', 'unofficial-live', 'tribute', 'appears'].includes(which) ? which : 'unofficial';
  const shelf = w === 'unofficial-live' ? 'unofficial' : w;
  return CONFIG.music.shelves[shelf] === false ? [] : music.artistExtra(String(mbid), w);
});
// Your tagged albums' editions -> which album (release group) they are, to match the artist's page.
musicHandler('music:groups', (ids) => music.releaseGroups((Array.isArray(ids) ? ids : []).map(String)));
musicHandler('music:related', (spec) => {
  if (!CONFIG.music.shelves.related) return [];
  const s = spec && typeof spec === 'object' ? spec : {};
  return music.related({ mbid: s.mbid ? String(s.mbid) : null, name: String(s.name || ''), lastfmKey: CONFIG.music.lastfmKey });
});
// ListenBrainz's playlists made for you, and one of them.
musicHandler('music:made-for', () => (CONFIG.music.listenbrainz ? music.madeFor(CONFIG.music.listenbrainz) : []));
musicHandler('music:playlist', (id) => music.playlist(String(id)));

// Which of these songs are on your servers (same title, same artist). Found songs are kept here,
// so playing them never relies on addresses from the page.
const foundSongs = new Map(); // "<server id>|<song id>" -> { server id, song }
const SONG_KEY = (serverId, id) => `${serverId}|${id}`;
musicHandler('music:find-songs', async (list) => {
  const songs = (Array.isArray(list) ? list : []).slice(0, 200).map((t) => ({ title: String((t && t.title) || '').slice(0, 200), artist: String((t && t.artist) || '').slice(0, 200) }));
  const servers = musicServers();
  if (!servers.length) return songs.map(() => null);
  const out = new Array(songs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < songs.length) {
      const i = next++;
      const want = songs[i];
      const t = normTitle(want.title);
      const a = normTitle(want.artist);
      for (const server of servers) {
        let hits = [];
        try { hits = await musicBe(server).songs(want.title); } catch { continue; }
        const hit = hits.find((h) => normTitle(h.title) === t && (!a || normTitle(h.artist).split(' and ').some((x) => a.includes(x)) || normTitle(h.artist).includes(a)));
        if (hit) {
          foundSongs.set(SONG_KEY(server.id, hit.id), { serverId: server.id, song: hit });
          if (foundSongs.size > 3000) foundSongs.delete(foundSongs.keys().next().value);
          out[i] = { serverId: server.id, serverName: server.name, id: hit.id, title: hit.title, artist: hit.artist, album: hit.album, seconds: hit.seconds };
          break;
        }
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
});
// Play found songs, in order, from wherever each one is.
musicHandler('music:play-songs', async (list, start) => {
  const queue = (Array.isArray(list) ? list : []).slice(0, 300).map((x) => foundSongs.get(SONG_KEY(String(x && x.serverId), String(x && x.id))))
    .filter(Boolean).map((f) => { const server = musicServers().find((s) => s.id === f.serverId); return server ? { server, track: f.song } : null; }).filter(Boolean);
  if (!queue.length) throw Object.assign(new Error('empty'), { code: 'empty' });
  const how = await apps.locate('mpv');
  if (!how) throw Object.assign(new Error('no mpv'), { code: 'no-mpv' });
  return playQueue(queue, Math.max(0, Math.min(queue.length - 1, Number(start) || 0)), how, {});
});
// An album's page: the catalogue's details and links, and the same album on your servers.
musicHandler('music:album', async (spec) => {
  const s = spec && typeof spec === 'object' ? spec : {};
  let own = null;
  if (s.serverId && s.itemId) own = await musicBe(musicServerFor(String(s.serverId))).album(String(s.itemId));
  const want = { mbid: s.mbid ? String(s.mbid) : null, deezerId: s.deezerId ? Number(s.deezerId) : null, title: String(s.title || (own && own.title) || ''), artist: String(s.artist || (own && own.artist) || '') };
  let a;
  try { a = await music.album(want); } catch (err) {
    if (!own) throw err;
    a = { kind: 'album', title: own.title, artist: own.artist, year: own.year, cover: own.cover, tracks: [], links: [], type: '', status: '' };
  }
  if (!a.cover && own) a.cover = own.cover;
  if (!a.tracks.length && own) a.tracks = own.tracks.map((t, i) => ({ n: t.n || i + 1, title: t.title, seconds: t.seconds, disc: t.disc }));
  noteLinks(a.links);
  // The same album on your servers: same title, and the artist among its artists.
  const n = normTitle(a.title);
  const na = normTitle(a.artist);
  const found = a.title ? await fromEachServer((b) => b.albums({ title: a.title })) : [];
  a.yours = found.filter((x) => normTitle(x.title) === n && (!na || normTitle(x.artist) === na || (x.artists || []).some((y) => normTitle(y) === na)));
  if (own && !a.yours.some((x) => x.serverId === own.serverId && x.itemId === own.itemId)) a.yours.unshift(own);
  for (const y of a.yours) delete y.tracks;
  return a;
});
musicHandler('music:server-album', (serverId, itemId) => musicBe(musicServerFor(String(serverId))).album(String(itemId)));
musicHandler('music:play', async (serverId, itemId, start) => {
  const server = musicServerFor(String(serverId));
  const al = await musicBe(server).album(String(itemId));
  if (!al.tracks.length) throw Object.assign(new Error('empty'), { code: 'empty' });
  const how = await apps.locate('mpv');
  if (!how) throw Object.assign(new Error('no mpv'), { code: 'no-mpv' });
  return playMusic(server, al, Math.max(0, Math.min(al.tracks.length - 1, Number(start) || 0)), how);
});

// Navidrome's songs reach mpv through a little relay on this computer only, so the sign-in never
// goes in an address: http://127.0.0.1:<port>/<secret>/<server id>/<song id>.
let relay = null;
function musicRelay() {
  if (relay) return relay;
  const http = require('http');
  const secret = require('crypto').randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    const m = /^\/([0-9a-f]{32})\/([^/]+)\/([^/?]+)$/.exec(req.url || '');
    const s = m && m[1] === secret && CONFIG.music.servers.find((x) => x.id === decodeURIComponent(m[2]));
    if (!s) { res.writeHead(404); res.end(); return; }
    try {
      const r = await subsonic.stream(s, decodeURIComponent(m[3]), req.headers.range);
      const headers = {};
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) headers[h] = r.headers.get(h);
      res.writeHead(r.status, headers);
      if (req.method === 'HEAD' || !r.body) { res.end(); return; }
      const { Readable } = require('stream');
      Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
      req.on('close', () => { try { r.body.cancel(); } catch { /* done */ } });
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  relay = new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}/${secret}` }));
  });
  return relay;
}

function playMusic(server, al, index, how) {
  return playQueue(al.tracks.map((t) => ({ server, track: t, album: al.title, albumArtist: al.artist, cover: al.cover })), index, how, { serverId: server.id, itemId: al.itemId });
}

// Songs in mpv, one after another: [{ server, track, album?, albumArtist? }]. Songs can come from
// different servers: each server's sign-in goes only with its own songs (Navidrome's through the
// relay, Jellyfin's and Plex's as a header on just those files).
async function playQueue(queue, index, how, played) {
  if (externalApp) throw Object.assign(new Error('busy'), { code: 'busy' });
  const base = queue.some((q) => q.server.type === 'subsonic') ? (await musicRelay()).base : '';
  const sub = (q) => q.server.type === 'subsonic';
  const entries = queue.map((q) => {
    const t = q.track;
    const opts = !sub(q) && q.server.token ? [`--http-header-fields=${q.server.type === 'plex' ? 'X-Plex-Token' : 'X-Emby-Token'}: ${q.server.token}`] : [];
    const by = t.artist && (!q.albumArtist || normTitle(t.artist) !== normTitle(q.albumArtist)) ? ` · ${t.artist}` : '';
    const album = q.album || t.album;
    return { url: sub(q) ? `${base}/${encodeURIComponent(q.server.id)}/${encodeURIComponent(t.id)}` : t.url, title: `${t.title}${by}${album ? ` · ${album}` : ''}`, start: 0, opts };
  });
  if (entries.some((e) => !e.url)) throw Object.assign(new Error('no address'), { code: 'failed' });
  const scrobbled = new Set();
  const lfDone = new Set();
  const startedAt = {}; // when each song started (seconds), for Last.fm
  stepAside('mpv');
  const sess = {};
  const ctl = playMpv({
    how,
    entries,
    startIndex: index,
    token: null, // (per file, above)
    screenArgs: mpvScreenArgs(),
    bindings: CONFIG.mpvBindings,
    help: mpvHelp('song'),
    kind: 'song',
    keepAwake: true, // (the cover or a visualiser is on screen)
    ...mpvCommon(),
    ...mpvMusic(how, (i) => queue[i] && (queue[i].cover || queue[i].track.cover)),
    loadingText: (i) => `Loading ${queue[i] ? queue[i].track.title : ''}…`,
    log, logFile: mpvLogFile(how),
    autoplay: true,
    // Navidrome keeps "now playing" and play counts.
    // Last.fm (when you've signed in and scrobbling is on) gets "now playing", then the song once
    // you've heard half of it or four minutes.
    onFileStart: (i) => {
      const q = queue[i];
      ctl.card(null); // (the song's card waits until it's playing, off the loading dots)
      if (!q) return;
      if (sub(q)) subsonic.scrobble(q.server, q.track.id, false);
      startedAt[i] = Math.floor(Date.now() / 1000);
      if (q.track.artist || q.albumArtist) lastfmSend(q.server, 'nowPlaying', lastfmTrack(q));
    },
    onFileEnd: (i, reason, pos, dur) => {
      const q = queue[i];
      if (q && sub(q) && !scrobbled.has(i) && (reason === 'eof' || (dur && pos >= dur / 2))) { scrobbled.add(i); subsonic.scrobble(q.server, q.track.id, true); }
      const length = dur || (q && q.track.seconds) || 0;
      const heard = reason === 'eof' ? length : pos;
      if (q && !lfDone.has(i) && startedAt[i] && (q.track.artist || q.albumArtist) && lastfmCounts(length, heard)) {
        lfDone.add(i);
        lastfmSend(q.server, 'scrobble', lastfmTrack(q, length), startedAt[i]);
      }
    },
    // What's playing: the song, who by, and the album.
    onPlaying: (i) => {
      const q = queue[i];
      if (q) ctl.card([q.track.title, q.track.artist || q.albumArtist, q.album || q.track.album]);
    },
    onState: () => {},
    onMessage: (args) => { if (args[0] === 'tv-overlay-stop') confirmStop(sess, ctl, 'listening'); },
    onExit: (error) => {
      stepBack();
      home.webContents.send('music:played', { ...played, error });
    },
  });
  return { app: 'mpv' };
}

// Settings → Music.
const publicMusic = () => ({
  servers: CONFIG.music.servers.map(({ id, name, kind, url, user, folders }) => ({ id, name, kind, url, user, folders })),
  services: MUSIC_SERVICES.map(({ id, name, color }) => ({ id, name, color, on: !CONFIG.music.services || CONFIG.music.services.includes(id) })),
  useJellyfin: CONFIG.music.useJellyfin, usePlex: CONFIG.music.usePlex,
  jellyfin: signedInServers().length, plex: plexServers().length,
  listenbrainz: CONFIG.music.listenbrainz, lastfm: CONFIG.music.lastfmKey ? maskKey(CONFIG.music.lastfmKey) : '',
  lastfmUser: CONFIG.music.lastfm.user, lastfmSecret: Boolean(CONFIG.music.lastfm.secret), scrobble: CONFIG.music.lastfm.scrobble,
  lastfmSigningIn: Boolean(lastfmSignIn),
  // Each music server, with whether its plays are scrobbled.
  scrobbleServers: musicServers().map((s) => ({
    id: s.id, name: s.name, kind: s.type === 'subsonic' ? s.kind || 'Subsonic' : s.type === 'plex' ? 'Plex' : 'Jellyfin',
    on: !CONFIG.music.lastfm.skip.includes(s.id),
  })),
  shelves: { ...CONFIG.music.shelves },
  visual: CONFIG.mpvVisual, visuals: visuals.VISUALS.map(({ id, name }) => ({ id, name })),
  visualButton: CONFIG.mpvBindings.visual == null ? null : buttonName(CONFIG.mpvBindings.visual),
});
function saveMusic() {
  saveUserConfig({ music: CONFIG.music });
  home?.webContents.send('music:changed', publicMusic());
}
musicHandler('music:settings', () => publicMusic());
// The picture while music and radio play (its button in mpv changes it too).
musicHandler('music:visual', (id) => {
  if (visuals.visualIds.includes(String(id))) { CONFIG.mpvVisual = String(id); saveUserConfig({ mpvVisual: CONFIG.mpvVisual }); }
  return publicMusic();
});
musicHandler('music:add-server', async (url, user, password) => {
  const s = await subsonic.connect(String(url || ''), String(user || ''), String(password || ''));
  CONFIG.music.servers = [...CONFIG.music.servers.filter((x) => x.id !== s.id), { ...s, folders: [] }];
  delete s.version;
  saveMusic();
  log.info(`[music] added ${s.name}`);
  return publicMusic();
});
musicHandler('music:remove-server', (id) => {
  CONFIG.music.servers = CONFIG.music.servers.filter((x) => x.id !== String(id));
  saveMusic();
  return publicMusic();
});
musicHandler('music:folders', async (id) => {
  const s = musicServerFor(String(id));
  return { all: await subsonic.folders(s), picked: s.folders || [] };
});
musicHandler('music:set-folder', (id, folder, on) => {
  const s = CONFIG.music.servers.find((x) => x.id === String(id));
  if (!s) throw Object.assign(new Error('gone'), { code: 'gone' });
  const set = new Set(s.folders || []);
  if (on) set.add(String(folder)); else set.delete(String(folder));
  s.folders = [...set];
  saveMusic();
  return s.folders;
});
musicHandler('music:set-service', (id, on) => {
  const all = MUSIC_SERVICES.map((x) => x.id);
  const set = new Set(CONFIG.music.services || all);
  if (on) set.add(String(id)); else set.delete(String(id));
  CONFIG.music.services = all.filter((x) => set.has(x));
  saveMusic();
  return publicMusic();
});
// Your ListenBrainz name: checked (it must exist) before it's kept. Empty forgets it.
musicHandler('music:listenbrainz', async (name) => {
  const u = String(name || '').trim().replace(/^.*listenbrainz\.org\/user\//i, '').replace(/\/.*$/, '');
  if (u) await music.madeFor(u);
  CONFIG.music.listenbrainz = u;
  saveMusic();
  return publicMusic();
});
// ---- Last.fm scrobbling: signing in, on or off, signing out.
const lastfm = createLastfm({ log });
let lastfmSignIn = null; // { timer, until } while waiting for you to press Allow on Last.fm
const lastfmAuth = () => ({ key: CONFIG.music.lastfmKey, secret: CONFIG.music.lastfm.secret, session: CONFIG.music.lastfm.session });

function stopLastfmSignIn() {
  if (lastfmSignIn) clearInterval(lastfmSignIn.timer);
  lastfmSignIn = null;
}

// Open Last.fm's "allow access" page here, and wait (up to 10 minutes) for you to press Allow.
musicHandler('music:lastfm-signin', async () => {
  const { key, secret } = lastfmAuth();
  if (!key) throw Object.assign(new Error('no key'), { code: 'no-key' });
  if (!secret) throw Object.assign(new Error('no secret'), { code: 'no-secret' });
  stopLastfmSignIn();
  const { token, page } = await lastfm.start({ key, secret });
  const until = Date.now() + 10 * 60e3;
  const timer = setInterval(async () => {
    if (!lastfmSignIn || lastfmSignIn.timer !== timer) return;
    if (Date.now() > until) { stopLastfmSignIn(); saveMusic(); return; }
    try {
      const { user, session } = await lastfm.finish({ key, secret, token });
      stopLastfmSignIn();
      Object.assign(CONFIG.music.lastfm, { user, session, scrobble: true });
      saveMusic();
      log.info('[lastfm] signed in; scrobbling on');
      if (current && current.id === 'lastfm-auth') goHome();
      home.webContents.send('lastfm:signed-in', user);
    } catch (err) {
      if (err.code !== 'not-yet' && err.code !== 'unreachable' && err.code !== 'busy') { stopLastfmSignIn(); saveMusic(); log.warn(`[lastfm] sign-in stopped: ${err.code}`); }
    }
  }, 3000);
  lastfmSignIn = { timer, until };
  openService({ id: 'lastfm-auth', name: 'Last.fm', url: page, returnLabel: 'Back to settings', searchUrl: null });
  return publicMusic();
});
musicHandler('music:lastfm-scrobble', (on) => {
  CONFIG.music.lastfm.scrobble = Boolean(on);
  saveMusic();
  return publicMusic();
});
musicHandler('music:lastfm-server', (id, on) => {
  const skip = new Set(CONFIG.music.lastfm.skip);
  if (on) skip.delete(String(id)); else skip.add(String(id));
  CONFIG.music.lastfm.skip = [...skip].slice(0, 50);
  saveMusic();
  return publicMusic();
});
musicHandler('music:lastfm-signout', () => {
  stopLastfmSignIn();
  Object.assign(CONFIG.music.lastfm, { session: '', user: '' });
  saveMusic();
  return publicMusic();
});

// What a song in the queue is, for Last.fm.
function lastfmTrack(q, seconds) {
  const t = q.track;
  return { artist: t.artist || q.albumArtist || '', title: t.title || '', album: q.album || t.album || '', albumArtist: q.albumArtist || '', duration: seconds || t.seconds || 0, trackNumber: t.n || 0 };
}
const scrobbling = () => Boolean(CONFIG.music.lastfm.scrobble && CONFIG.music.lastfm.session && CONFIG.music.lastfmKey && CONFIG.music.lastfm.secret);
function lastfmSend(server, what, ...args) {
  if (!scrobbling() || CONFIG.music.lastfm.skip.includes(server.id)) return;
  lastfm[what](lastfmAuth(), ...args).catch((err) => {
    log.warn(`[lastfm] ${what}: ${err.code || err.message}`);
    // Signed out on Last.fm's side (access taken back): forget the sign-in, so Settings says so.
    if (err.code === 'signed-out') { Object.assign(CONFIG.music.lastfm, { session: '', user: '' }); saveMusic(); }
  });
}

musicHandler('music:shelf', (id, on) => {
  if (['unofficial', 'tribute', 'appears', 'related'].includes(String(id))) CONFIG.music.shelves[String(id)] = Boolean(on);
  saveMusic();
  return publicMusic();
});
musicHandler('music:use', (kind, on) => {
  if (kind === 'jellyfin') CONFIG.music.useJellyfin = Boolean(on);
  if (kind === 'plex') CONFIG.music.usePlex = Boolean(on);
  saveMusic();
  return publicMusic();
});

// ---------------------------------------------------------------- YouTube's TV page
//
// youtube.js has the details. Here: the page's extras go in before its own scripts (through
// Chromium's DevTools channel, the same one the pointer uses), and its questions (SponsorBlock's
// segments, the votes, DeArrow's titles) are answered from here, since the page can't reach those
// sites itself.

const yt = ytTools.createYouTube({ log });

async function setUpTvPage(wc) {
  // (DevTools doesn't answer until a page is running, so a blank one goes first.)
  await wc.loadURL('about:blank').catch(() => {});
  if (wc.isDestroyed()) return;
  const send = cdp(wc);
  const y = CONFIG.youtube;
  if (!send) return;
  if (!wc.__tvoAnswers) {
    wc.__tvoAnswers = true;
    wc.debugger.on('message', async (_e, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params.name !== '__tvoAsk') return;
      let q;
      try { q = JSON.parse(params.payload); } catch { return; }
      const id = Number(q.id) || 0;
      let value = null;
      try {
        if (q.what === 'segments' && CONFIG.youtube.sponsorblock) value = await yt.segments(String(q.arg), CONFIG.youtube.sbCategories);
        else if (q.what === 'votes' && CONFIG.youtube.dislikes) value = await yt.votes(String(q.arg));
        else if (q.what === 'title' && CONFIG.youtube.dearrow) value = await yt.betterTitle(String(q.arg));
      } catch (err) { log.debug('[youtube] extra failed:', q.what, err.message); }
      if (!wc.isDestroyed()) send('Runtime.evaluate', { expression: `window.__tvoAnswer && window.__tvoAnswer(${id}, ${JSON.stringify(value)})` });
    });
  }
  await send('Runtime.enable');
  await send('Runtime.addBinding', { name: '__tvoAsk' });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: ytTools.pageScript(y) });
  log.debug('[youtube] TV page extras:', ['adblock', 'sponsorblock', 'dislikes', 'dearrow'].filter((k) => y[k]).join(', ') || 'none');
}

ipcMain.handle('youtube:settings', (event) => (fromHome(event) ? { ...CONFIG.youtube, categories: ytTools.SB_CATEGORIES, vacuumtube: hasVacuumTube } : null));
ipcMain.handle('youtube:set', (event, patch) => {
  if (!fromHome(event) || !patch || typeof patch !== 'object') return null;
  const next = { ...patch };
  if (!['auto', 'tv', 'website'].includes(next.open)) delete next.open; // (anything else keeps what you had)
  CONFIG.youtube = cleanYouTubeConfig({ ...CONFIG.youtube, ...next });
  saveUserConfig({ youtube: CONFIG.youtube });
  return { ...CONFIG.youtube, categories: ytTools.SB_CATEGORIES, vacuumtube: hasVacuumTube };
});

// The YouTube Music button on an album's page: the album itself, found on YouTube Music, played
// in VacuumTube or the TV page (or YouTube Music's website, when YouTube is set to the website).
ipcMain.handle('music:youtube', async (event, what) => {
  if (!fromHome(event) || !what || typeof what !== 'object') return { error: 'failed' };
  const title = String(what.title || '').slice(0, 200);
  const artist = String(what.artist || '').slice(0, 200);
  const kind = what.kind === 'song' ? 'song' : 'album';
  let found = null;
  try { found = await yt.findMusic({ kind, title, artist }); } catch (err) { log.debug('[youtube] music lookup failed:', err.message); }
  await openYouTube(found || { search: `${artist} ${title}`.trim() }, { music: true });
  return { ok: Boolean(found) };
});

// ---------------------------------------------------------------- radio
//
// Internet radio (radio.js): your favourites and your own stations, SomaFM, and what's popular in
// your country, or a search. Stations play in mpv; next and previous change station.

const radio = createRadio({ log });
const radioCountry = () => CONFIG.radio.country || (/^[A-Z]{2}$/.test(CONFIG.region) ? CONFIG.region : 'US');
const markFav = (list) => {
  const fav = new Set(CONFIG.radio.favorites.map((x) => x.id));
  return list.map((x) => ({ ...x, favorite: fav.has(x.id) }));
};
function saveRadio() { saveUserConfig({ radio: CONFIG.radio }); }
const radioState = () => ({ country: radioCountry(), somafm: CONFIG.radio.somafm, favorites: markFav(CONFIG.radio.favorites), mine: markFav(CONFIG.radio.stations) });

musicHandler('radio:state', () => radioState());
musicHandler('radio:list', async (kind, arg) => {
  if (kind === 'favorites') return markFav(CONFIG.radio.favorites);
  if (kind === 'mine') return markFav(CONFIG.radio.stations);
  if (kind === 'recent') return markFav(CONFIG.radio.recent);
  if (kind === 'somafm') return markFav(await radio.somafm());
  if (kind === 'search') return markFav(await radio.search(String(arg || '')));
  if (kind === 'tag') return markFav(await radio.byTag(String(arg || '')));
  return markFav(await radio.popular(arg ? String(arg) : radioCountry()));
});
musicHandler('radio:countries', () => radio.countries());
musicHandler('radio:set-country', (code) => {
  CONFIG.radio.country = /^[A-Z]{2}$/.test(String(code)) ? String(code) : null;
  saveRadio();
  return radioState();
});
musicHandler('radio:somafm', (on) => { CONFIG.radio.somafm = Boolean(on); saveRadio(); return radioState(); });
musicHandler('radio:favorite', (station, on) => {
  const st = cleanStation(station);
  if (!st) throw Object.assign(new Error('bad station'), { code: 'failed' });
  CONFIG.radio.favorites = CONFIG.radio.favorites.filter((x) => x.id !== st.id);
  if (on) CONFIG.radio.favorites.unshift(st);
  saveRadio();
  return radioState();
});
musicHandler('radio:add', (name, url) => {
  const u = String(url || '').trim();
  if (!radioUrlOk(u)) throw Object.assign(new Error('bad address'), { code: 'bad-address' });
  const st = cleanStation({ id: `my-${require('crypto').createHash('sha1').update(u).digest('hex').slice(0, 12)}`, name: String(name || '').trim() || u, url: u, source: 'mine' });
  CONFIG.radio.stations = [...CONFIG.radio.stations.filter((x) => x.id !== st.id), st];
  saveRadio();
  return radioState();
});
// Radio → Recently played: take one out, or clear the lot.
musicHandler('radio:recent-remove', (id) => {
  CONFIG.radio.recent = CONFIG.radio.recent.filter((x) => x.id !== String(id));
  saveRadio();
  return markFav(CONFIG.radio.recent);
});
musicHandler('radio:recent-clear', () => {
  CONFIG.radio.recent = [];
  saveRadio();
  return [];
});
musicHandler('radio:remove', (id) => {
  CONFIG.radio.stations = CONFIG.radio.stations.filter((x) => x.id !== String(id));
  CONFIG.radio.favorites = CONFIG.radio.favorites.filter((x) => x.id !== String(id));
  saveRadio();
  return radioState();
});
musicHandler('radio:play', async (list, index) => {
  const stations = (Array.isArray(list) ? list : []).slice(0, 300).map(cleanStation).filter(Boolean);
  if (!stations.length) throw Object.assign(new Error('nothing'), { code: 'failed' });
  const how = await apps.locate('mpv');
  if (!how) throw Object.assign(new Error('no mpv'), { code: 'no-mpv' });
  if (externalApp) throw Object.assign(new Error('busy'), { code: 'busy' });
  const start = Math.max(0, Math.min(stations.length - 1, Number(index) || 0));
  stepAside('mpv');
  const sess = {};
  let playing = start;
  let loaded = false;
  let lastMeta = null;
  // What's on screen: the station, and the song when the station says (not all of them do).
  const showCard = (meta) => {
    const st = stations[playing];
    if (!st) return;
    const m = meta || {};
    const get = (k) => { const hit = Object.keys(m).find((x) => x.toLowerCase() === k); return hit ? String(m[hit]).trim() : ''; };
    const song = get('icy-title') || [get('artist'), get('title')].filter(Boolean).join(' – ');
    ctl.card([st.name, song ? `♪ ${song}` : 'No song details from this station', st.about || get('icy-genre')]);
  };
  const ctl = playMpv({
    how,
    entries: stations.map((x) => ({ url: x.url, title: x.name, start: 0 })),
    startIndex: start,
    token: null, // (no server's token ever goes to a radio station)
    screenArgs: mpvScreenArgs(),
    bindings: CONFIG.mpvBindings,
    help: mpvHelp('station'),
    kind: 'station',
    keepAwake: true, // (the logo or a visualiser is on screen)
    ...mpvCommon(),
    ...mpvMusic(how, (i) => stations[i] && stations[i].logo),
    loadingText: (i) => `Tuning in to ${stations[i] ? stations[i].name : ''}…`,
    log, logFile: mpvLogFile(how),
    autoplay: true,
    // (The card waits until the station is playing, so it doesn't sit on the loading dots.)
    onFileStart: (i) => { playing = i; loaded = false; lastMeta = null; ctl.card(null); if (stations[i] && stations[i].uuid) radio.clicked(stations[i].uuid); },
    onPlaying: (i) => {
      loaded = true; showCard(lastMeta);
      // (Radio → Recently played: it's playing, so it works.)
      const st = stations[i];
      if (st) { CONFIG.radio.recent = [st, ...CONFIG.radio.recent.filter((x) => x.id !== st.id)].slice(0, 20); saveRadio(); }
    },
    onMetadata: (meta) => { lastMeta = meta; if (loaded) showCard(meta); },
    onFileEnd: () => {}, onState: () => {},
    onMessage: (args) => { if (args[0] === 'tv-overlay-stop') confirmStop(sess, ctl, 'listening'); },
    onExit: (error) => { stepBack(); home.webContents.send('music:played', { error }); },
  });
  return { app: 'mpv' };
});

// ---------------------------------------------------------------- Live TV
//
// Channels from IPTV lists (M3U + XMLTV guide; FastChannels needs only its address) and from the
// Live TV on your Jellyfin servers, matched up so each channel shows once (see livetv.js).
// mpv plays them as a playlist, so the previous / next buttons flip channels. Each playlist entry
// is a local address that picks the channel's best working source at the moment you tune in, and
// the next one if that fails.

const LIVE_REFRESH_MS = 3 * 60 * 60 * 1000;
const LIVE_HOUR = 60 * 60 * 1000;
const live = { channels: [], possible: [], urls: null, status: {}, updatedAt: 0, refreshing: null };

// The channel store runs on a background thread (livetv-worker.js), so reading big lists and guides
// and matching channels never freezes the app. If the thread can't start, it runs here instead.
const { Worker } = require('worker_threads');
let liveWorker = null;
let liveInline = null;
const liveCalls = new Map();
let liveCallId = 0;
function liveStore(op, args) {
  if (!liveWorker && !liveInline && process.env.TV_OVERLAY_LIVE_INLINE === '1') {
    liveInline = require('./livetv-store').createStore(); // for tests that stand in for the network here
  }
  if (!liveWorker && !liveInline) {
    try {
      liveWorker = new Worker(path.join(__dirname, 'livetv-worker.js'));
      liveWorker.on('message', ({ id, result, error }) => {
        const call = liveCalls.get(id);
        if (!call) return;
        liveCalls.delete(id);
        if (error) call.reject(Object.assign(new Error(error.message), { code: error.code })); else call.resolve(result);
      });
      liveWorker.on('error', (err) => {
        log.warn('[live] background thread stopped, carrying on without it:', err.message);
        liveWorker = null;
        liveInline = require('./livetv-store').createStore();
        for (const call of liveCalls.values()) call.reject(Object.assign(new Error('restarting'), { code: 'failed' }));
        liveCalls.clear();
        live.updatedAt = 0; // the channels it held are gone: read them again
        setTimeout(() => refreshLive(), 1000);
      });
      liveWorker.unref();
    } catch (err) {
      log.warn('[live] no background thread:', err.message);
      liveInline = require('./livetv-store').createStore();
    }
  }
  if (liveInline) return liveInline.run(op, args);
  return new Promise((resolve, reject) => {
    const id = ++liveCallId;
    liveCalls.set(id, { resolve, reject });
    liveWorker.postMessage({ id, op, args });
  });
}
let liveSess = null;

function cleanLive(l) {
  l = l && typeof l === 'object' ? l : {};
  const pairs = (v) => (Array.isArray(v) ? v.filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string')) : []);
  return {
    lists: (Array.isArray(l.lists) ? l.lists : []).filter((x) => x && typeof x.m3u === 'string' && /^https?:\/\//.test(x.m3u))
      .map((x) => ({
        id: String(x.id || crypto.randomBytes(4).toString('hex')), name: String(x.name || 'Channel list'), m3u: x.m3u,
        guide: typeof x.guide === 'string' ? x.guide : '',
        ...(x.iptvOrg && typeof x.iptvOrg === 'object' ? { iptvOrg: { type: String(x.iptvOrg.type), code: String(x.iptvOrg.code) } } : {}),
      })),
    useJellyfin: l.useJellyfin !== false,
    order: Array.isArray(l.order) ? l.order.filter((x) => typeof x === 'string') : [],
    merge: pairs(l.merge), split: pairs(l.split),
    favorites: Array.isArray(l.favorites) ? l.favorites.filter((x) => typeof x === 'string') : [],
    recent: Array.isArray(l.recent) ? l.recent.filter((x) => typeof x === 'string').slice(0, 20) : [], // channels watched lately (a source of each), newest first
    hideBroken: l.hideBroken !== false, // hide channels that don't work (on by default)
    preferQuality: l.preferQuality !== false, // play a channel's sharpest copy first (on by default)
    iptvOrgAsked: l.iptvOrgAsked === true, // asked once whether to start with your country's channels
  };
}
const saveLive = () => saveUserConfig({ live: CONFIG.live });
// A channel that played: first in Live → Recently watched (by its sources, which outlast its id).
function rememberLiveChannel(c) {
  const keys = (c && c.sources ? c.sources : []).map((s) => s.key).filter((k) => typeof k === 'string');
  if (!keys.length) return;
  CONFIG.live.recent = [keys[0], ...CONFIG.live.recent.filter((k) => !keys.includes(k))].slice(0, 20);
  saveLive();
  home?.webContents.send('live:changed');
}

// Every place channels come from, best first: your order from Settings, or by default your
// Jellyfin servers, then lists.
function liveSources() {
  const all = [
    ...(CONFIG.live.useJellyfin ? signedInServers().map((s) => ({ id: `jf:${s.id}`, name: s.name, kind: 'jellyfin', server: s })) : []),
    ...CONFIG.live.lists.map((l) => ({ id: `list:${l.id}`, name: l.name, kind: 'list', list: l })),
  ];
  const rank = (s) => { const i = CONFIG.live.order.indexOf(s.id); return i < 0 ? 1000 + all.indexOf(s) : i; };
  return all.sort((a, b) => rank(a) - rank(b));
}

// A Jellyfin server's channels (channel lists are read by the channel store itself).
async function readJellyfinSource(src, rank, now) {
  const server = src.server;
  const chans = await jf.liveChannels(server);
  const progs = chans.length ? await jf.livePrograms(server, chans.map((c) => c.id), now - 2 * LIVE_HOUR, now + 14 * LIVE_HOUR) : {};
  const entries = chans.map((c) => ({
    key: `${src.id}:${c.id}`, sourceId: src.id, sourceRank: rank,
    name: c.name, number: c.number, group: '',
    logo: c.logo ? `jfimg://${encodeURIComponent(server.id)}/Items/${encodeURIComponent(c.logo)}/Images/Primary?fillHeight=120&quality=90` : '',
    tvgId: '', stationId: '', programmes: progs[c.id] || [],
    play: { type: 'jf', serverId: server.id, channelId: c.id },
  }));
  return { entries, status: { count: entries.length, guide: Object.keys(progs).length > 0 } };
}

// Match channels up again (after a refresh, or a change in Settings). The guide is only redrawn
// when something you'd see has actually changed.
async function rebuildLive(now = Date.now(), { force = false } = {}) {
  const ranks = Object.fromEntries(liveSources().map((src, i) => [src.id, i]));
  let r;
  try {
    r = await liveStore('merge', { ranks, merge: CONFIG.live.merge, split: CONFIG.live.split, quality: liveQuality, preferQuality: CONFIG.live.preferQuality, now, force });
  } catch (err) {
    log.warn('[live] matching channels failed:', err.message);
    return false;
  }
  live.urls = r.urls;
  if (!r.changed) { log.debug('[live] nothing changed'); return false; }
  const got = r.json ? JSON.parse(r.json) : r; // (sent as text: much quicker to take in)
  live.channels = got.channels;
  live.possible = got.possible;
  home?.webContents.send('live:changed');
  return true;
}

const liveCacheFile = () => path.join(app.getPath('userData'), 'live-cache.json');

// Fetch the latest from every source, in the background. Until it's done, the guide shows what it
// had (from the cache, at start-up); it's swapped for the new one only if anything changed.
async function refreshLive() {
  if (live.refreshing) return live.refreshing;
  live.refreshing = (async () => {
    const now = Date.now();
    const srcs = liveSources().map((src, rank) => ({ src, rank }));
    home?.webContents.send('live:changed'); // "Updating…"
    const lists = srcs.filter(({ src }) => src.kind === 'list').map(({ src, rank }) => ({ srcId: src.id, rank, list: { m3u: src.list.m3u, guide: src.list.guide } }));
    const [listStatus, jfStatus] = await Promise.all([
      lists.length ? liveStore('readLists', { lists, now }).catch((err) => Object.fromEntries(lists.map((l) => [l.srcId, { error: err.code || 'failed', count: 0 }]))) : {},
      Promise.all(srcs.filter(({ src }) => src.kind === 'jellyfin').map(async ({ src, rank }) => {
        try {
          const { entries, status } = await readJellyfinSource(src, rank, now);
          await liveStore('setSource', { srcId: src.id, entries });
          return [src.id, status];
        } catch (err) {
          return [src.id, { error: err.code || 'failed', count: 0 }]; // keeps what it had from this server
        }
      })),
    ]);
    live.status = { ...listStatus, ...Object.fromEntries(jfStatus) };
    for (const { src } of srcs) {
      const st = live.status[src.id] || {};
      log.info(`[live] ${src.name}: ${st.error ? `error ${st.error}${st.kept ? ' (kept the last ones)' : ''}` : `${st.count} channels${st.guide ? ', with guide' : ''}${st.guideError ? `, guide error ${st.guideError}` : ''}`}`);
    }
    live.updatedAt = now;
    const changed = await rebuildLive(now);
    log.info(`[live] refreshed: ${changed ? 'changes found, guide updated' : 'no changes'}`);
    liveStore('saveCache', { file: liveCacheFile(), at: now, status: live.status }).catch((err) => log.warn('[live] cache not saved:', err.message));
  })().finally(() => { live.refreshing = null; home?.webContents.send('live:changed'); checkLiveHealth(); });
  return live.refreshing;
}

// At start-up: the channels from last time, straight away, so the Live tab opens instantly.
async function loadLiveCache() {
  try {
    const c = await liveStore('loadCache', { file: liveCacheFile() });
    if (!c) return;
    live.status = c.status;
    live.updatedAt = c.at;
    await rebuildLive(Date.now(), { force: true });
  } catch (err) { log.warn('[live] cache not read:', err.message); }
}

const findChannel = (id) => live.channels.find((c) => c.id === id || c.sources.some((s) => s.key === id));
const liveSourceName = (id) => { const s = liveSources().find((x) => x.id === id); return s ? s.name : ''; };

// A channel "doesn't work" when every place it comes from is a stream address we checked and
// couldn't open. (Jellyfin channels aren't checked: the server opens them when you tune in.)
function liveBroken(c) {
  return c.sources.every((s) => {
    if (!s.play || s.play.type !== 'url') return false;
    const h = liveHealth[s.play.url];
    return h && h.ok === false;
  });
}

function liveSummary(opts) {
  const now = Date.now();
  const fav = new Set(CONFIG.live.favorites);
  const hide = CONFIG.live.hideBroken;
  const visible = hide ? live.channels.filter((c) => !liveBroken(c)) : live.channels;
  const describe = (id) => {
    const c = findChannel(id);
    return c ? { id: c.id, name: c.name, number: c.number, logo: c.logo, quality: c.quality, sources: [...new Set(c.sources.map((s) => liveSourceName(s.sourceId)))] } : null;
  };
  return {
    sources: liveSources().map((s) => ({ id: s.id, name: s.name, kind: s.kind, ...(live.status[s.id] || {}) })),
    useJellyfin: CONFIG.live.useJellyfin,
    jellyfinServers: signedInServers().length,
    hidden: live.channels.length - visible.length,
    hideBroken: hide,
    checking: Boolean(healthRun),
    iptvOrg: {
      asked: CONFIG.live.iptvOrgAsked,
      country: guessCountry(),
      chosen: CONFIG.live.lists.filter((l) => l.iptvOrg).map((l) => ({ ...l.iptvOrg, name: l.name.replace(/^iptv-org · /, '') })),
    },
    preferQuality: CONFIG.live.preferQuality,
    channels: (opts && opts.lite) ? undefined : visible.map((c) => ({
      id: c.id, name: c.name, number: c.number, logo: c.logo, group: c.group, quality: c.quality,
      copies: c.sources.map((s) => ({ from: liveSourceName(s.sourceId), quality: livetv.qualityLabel(s.height) })),
      favorite: c.sources.some((s) => fav.has(s.key)),
      sources: [...new Set(c.sources.map((s) => liveSourceName(s.sourceId)))],
      // What's on now and the next few: the guide only shows those, and only what's on now needs
      // its description. (Keeps what goes to the screen small, however many channels there are.)
      programmes: c.programmes.filter((p) => p.stop > now && p.start < now + 8 * LIVE_HOUR).slice(0, 6)
        .map((p, i) => (i === 0 && p.start <= now ? p : { start: p.start, stop: p.stop, title: p.title, sub: p.sub })),
    })),
    // Recently watched, newest first: the whole channels (the guide arrives in pieces, and these
    // may not be in the first).
    recentChannels: (opts && opts.lite) ? undefined : (() => {
      const rank = (c) => Math.min(...c.sources.map((s) => { const i = CONFIG.live.recent.indexOf(s.key); return i < 0 ? Infinity : i; }));
      return visible.filter((c) => rank(c) < Infinity).sort((a, b) => rank(a) - rank(b)).map((c) => c.id);
    })(),
    possible: live.possible.map(([a, b]) => ({ a: describe(a), b: describe(b) })).filter((p) => p.a && p.b).slice(0, 60),
    updatedAt: live.updatedAt,
    refreshing: Boolean(live.refreshing),
  };
}

async function addLiveList(text) {
  let r;
  try { r = await livetv.resolveList(text); } catch (err) { return { error: err.code || 'failed' }; }
  if (CONFIG.live.lists.some((l) => l.m3u === r.m3u)) return { ok: { count: r.count, name: CONFIG.live.lists.find((l) => l.m3u === r.m3u).name, already: true } };
  let host = '';
  try { host = new URL(r.m3u).host; } catch { /* keep blank */ }
  let name = /\/feeds\/[^/]+\/m3u/.test(r.m3u) ? `FastChannels (${host})` : host || 'Channel list';
  if (CONFIG.live.lists.some((l) => l.name === name)) {
    // Two lists from the same place: tell them apart by the list's own name.
    try { name = `${name} · ${decodeURIComponent(new URL(r.m3u).pathname.split('/').filter(Boolean).pop() || '')}`; } catch { /* keep it */ }
  }
  CONFIG.live.lists.push({ id: crypto.randomBytes(4).toString('hex'), name, m3u: r.m3u, guide: r.guide });
  saveLive();
  refreshLive();
  return { ok: { count: r.count, name, guide: Boolean(r.guide) } };
}

// The Live tab gets its channels in pieces: the first screenful straight away, the rest in the
// background (a guide can have thousands of channels; one big delivery would stall the screen).
let livePaged = { version: 0, channels: [] };
ipcMain.handle('live:state', (event, paged) => {
  if (!fromHome(event)) return null;
  if (Date.now() - live.updatedAt > LIVE_REFRESH_MS && liveSources().length) refreshLive();
  const full = liveSummary();
  if (!paged) return full;
  livePaged = { version: livePaged.version + 1, channels: full.channels };
  const groups = new Map();
  for (const c of full.channels) if (c.group) groups.set(c.group, (groups.get(c.group) || 0) + 1);
  return {
    ...full,
    channels: full.channels.slice(0, 80),
    total: full.channels.length,
    favorites: full.channels.filter((c) => c.favorite).length,
    groupCounts: [...groups],
    version: livePaged.version,
  };
});
ipcMain.handle('live:page', (event, version, from, count) => {
  if (!fromHome(event)) return null;
  if (version !== livePaged.version) return { stale: true };
  return { channels: livePaged.channels.slice(Math.max(0, from | 0), Math.max(0, from | 0) + Math.min(500, count | 0)) };
});
ipcMain.handle('live:refresh', async (event) => { if (fromHome(event)) await refreshLive(); return liveSummary(); });
ipcMain.handle('live:add-list', (event, text) => (fromHome(event) ? addLiveList(String(text || '')) : { error: 'failed' }));
ipcMain.handle('live:remove', async (event, sourceId) => {
  if (!fromHome(event)) return null;
  CONFIG.live.lists = CONFIG.live.lists.filter((l) => `list:${l.id}` !== sourceId);
  CONFIG.live.order = CONFIG.live.order.filter((x) => x !== sourceId);
  saveLive();
  await liveStore('dropSource', { srcId: sourceId });
  await rebuildLive();
  return liveSummary();
});
ipcMain.handle('live:move', async (event, sourceId, dir) => {
  if (!fromHome(event)) return null;
  const order = liveSources().map((s) => s.id);
  const i = order.indexOf(sourceId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i >= 0 && j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]];
  CONFIG.live.order = order;
  saveLive();
  await rebuildLive();
  return liveSummary();
});
ipcMain.handle('live:use-jellyfin', async (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.live.useJellyfin = Boolean(on);
  saveLive();
  if (on) refreshLive(); else await rebuildLive();
  return liveSummary();
});
ipcMain.handle('live:favorite', (event, id, on) => {
  if (!fromHome(event)) return null;
  const c = findChannel(String(id));
  if (!c) return liveSummary();
  const keys = c.sources.map((s) => s.key);
  CONFIG.live.favorites = CONFIG.live.favorites.filter((k) => !keys.includes(k));
  if (on) CONFIG.live.favorites.push(c.id);
  saveLive();
  return liveSummary();
});
// Live → Recently watched: take one channel off (all its sources), or clear the lot.
ipcMain.handle('live:recent-remove', (event, id) => {
  if (!fromHome(event)) return null;
  const c = findChannel(String(id));
  if (c) {
    const keys = c.sources.map((s) => s.key);
    CONFIG.live.recent = CONFIG.live.recent.filter((k) => !keys.includes(k));
    saveLive();
  }
  return liveSummary();
});
ipcMain.handle('live:recent-clear', (event) => {
  if (!fromHome(event)) return null;
  CONFIG.live.recent = [];
  saveLive();
  return liveSummary();
});
// Your call on a possible duplicate: the same channel, or two different ones.
ipcMain.handle('live:pair', async (event, a, b, same) => {
  if (!fromHome(event)) return null;
  const pair = [String(a), String(b)];
  const key = [...pair].sort().join('\n');
  const notPair = (p) => [...p].sort().join('\n') !== key;
  CONFIG.live.merge = CONFIG.live.merge.filter(notPair);
  CONFIG.live.split = CONFIG.live.split.filter(notPair);
  (same ? CONFIG.live.merge : CONFIG.live.split).push(pair);
  saveLive();
  await rebuildLive();
  return liveSummary();
});
// Search: live channels by name, and programmes coming up in the guide by title (the next two
// days). Words match from their start ("news" finds "BBC News", not "Newsround's").
const liveWords = (s) => normTitle(s).split(' ').filter(Boolean);
const liveMatch = (query) => {
  const q = liveWords(query);
  return (text) => {
    const w = liveWords(text);
    return q.length > 0 && q.every((x) => w.some((y) => y.startsWith(x)));
  };
};
const liveCard = (c) => ({ id: c.id, name: c.name, number: c.number, logo: c.logo });
ipcMain.handle('live:find', (event, query) => {
  if (!fromHome(event)) return null;
  const q = String(query || '').slice(0, 100);
  if (liveWords(q).length === 0) return { channels: [], shows: [] };
  const matches = liveMatch(q);
  const now = Date.now();
  const visible = CONFIG.live.hideBroken ? live.channels.filter((c) => !liveBroken(c)) : live.channels;
  const channels = visible.filter((c) => matches(c.name)).slice(0, 20).map((c) => {
    const on = c.programmes.find((p) => p.start <= now && p.stop > now);
    return { ...liveCard(c), on: on ? on.title : '' };
  });
  const shows = [];
  for (const c of visible) {
    for (const p of c.programmes) {
      if (p.stop <= now || p.start > now + 48 * LIVE_HOUR || !p.title || !matches(p.title)) continue;
      shows.push({ ...liveCard(c), title: p.title, sub: p.sub || '', start: p.start, stop: p.stop });
    }
  }
  shows.sort((a, b) => a.start - b.start);
  return { channels, shows: shows.slice(0, 30) };
});
// A title's page: is it on a live channel now or soon (the same title, in the next two days)?
ipcMain.handle('live:on-air', (event, title) => {
  if (!fromHome(event)) return [];
  const want = normTitle(String(title || '').slice(0, 200));
  if (!want) return [];
  const now = Date.now();
  const visible = CONFIG.live.hideBroken ? live.channels.filter((c) => !liveBroken(c)) : live.channels;
  const out = [];
  for (const c of visible) {
    for (const p of c.programmes) {
      if (p.stop <= now || p.start > now + 48 * LIVE_HOUR || normTitle(p.title || '') !== want) continue;
      out.push({ ...liveCard(c), title: p.title, start: p.start, stop: p.stop, now: p.start <= now });
    }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 8);
});

ipcMain.handle('live:play', async (event, ids, startId) => {
  if (!fromHome(event) || !Array.isArray(ids)) return { error: 'failed' };
  try { return await playLive(ids.map(String), String(startId)); } catch (err) { return { error: err.code || 'failed' }; }
});


// ---- iptv-org: free, community-run lists of public live streams, by country, language or category

const IPTV_ORG = 'https://iptv-org.github.io';
const IPTV_TYPES = { country: 'countries', language: 'languages', category: 'categories' };
let iptvMeta = null; // { at, countries, languages, categories }

async function iptvOrgMeta() {
  const file = path.join(app.getPath('userData'), 'iptv-org.json');
  if (!iptvMeta) { try { iptvMeta = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { iptvMeta = null; } }
  if (iptvMeta && Date.now() - iptvMeta.at < 7 * 24 * LIVE_HOUR) return iptvMeta;
  try {
    const get = async (n) => JSON.parse(await livetv.fetchText(`${IPTV_ORG}/api/${n}.json`));
    const [countries, languages, categories] = await Promise.all([get('countries'), get('languages'), get('categories')]);
    iptvMeta = {
      at: Date.now(),
      countries: countries.map((c) => ({ code: String(c.code).toLowerCase(), name: c.name, flag: c.flag || '' })).sort((a, b) => a.name.localeCompare(b.name)),
      languages: languages.map((l) => ({ code: String(l.code), name: l.name })).sort((a, b) => a.name.localeCompare(b.name)),
      categories: categories.map((c) => ({ code: String(c.id), name: c.name })).filter((c) => c.code !== 'xxx').sort((a, b) => a.name.localeCompare(b.name)),
    };
    fs.writeFileSync(file, JSON.stringify(iptvMeta));
  } catch (err) {
    if (!iptvMeta) throw err;
  }
  return iptvMeta;
}

// Where is this TV? Best effort, without asking anyone online: the time zone's country (from the
// system's time zone table), then the system language's country, then the app's region setting.
let countryGuess;
function guessCountry() {
  if (countryGuess !== undefined) return countryGuess;
  let code = null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const f of ['/usr/share/zoneinfo/zone.tab', '/usr/share/zoneinfo/zone1970.tab']) {
      if (code || !fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const cols = line.split('\t');
        if (cols[2] === tz) { code = cols[0].split(',')[0]; break; }
      }
    }
  } catch { /* no table */ }
  if (!code) { try { code = app.getLocaleCountryCode() || null; } catch { /* older Electron */ } }
  if (!code && CONFIG.region) code = CONFIG.region;
  countryGuess = code ? code.toLowerCase() : null;
  return countryGuess;
}

ipcMain.handle('iptv:meta', async (event) => {
  if (!fromHome(event)) return null;
  try {
    const m = await iptvOrgMeta();
    const chosen = new Set(CONFIG.live.lists.filter((l) => l.iptvOrg).map((l) => `${l.iptvOrg.type}:${l.iptvOrg.code}`));
    const mark = (type) => (x) => ({ ...x, on: chosen.has(`${type}:${x.code}`) });
    return { ok: { countries: m.countries.map(mark('country')), languages: m.languages.map(mark('language')), categories: m.categories.map(mark('category')), country: guessCountry() } };
  } catch (err) {
    return { error: err.code || 'failed' };
  }
});

// Turn one iptv-org list on or off.
ipcMain.handle('iptv:set', async (event, type, code, on, name) => {
  if (!fromHome(event) || !IPTV_TYPES[type] || !/^[a-z0-9_-]{1,20}$/i.test(String(code))) return null;
  const id = `iptv-${type}-${String(code).toLowerCase()}`;
  CONFIG.live.lists = CONFIG.live.lists.filter((l) => l.id !== id);
  if (on) {
    CONFIG.live.lists.push({
      id, name: `iptv-org · ${String(name || code).slice(0, 60)}`,
      m3u: `${IPTV_ORG}/iptv/${IPTV_TYPES[type]}/${String(code).toLowerCase()}.m3u`, guide: '',
      iptvOrg: { type, code: String(code).toLowerCase() },
    });
  } else {
    await liveStore('dropSource', { srcId: `list:${id}` });
  }
  CONFIG.live.iptvOrgAsked = true;
  saveLive();
  if (on) refreshLive(); else await rebuildLive();
  return liveSummary();
});

// "Not now" to the first-time offer: don't ask again.
ipcMain.handle('iptv:asked', (event) => {
  if (!fromHome(event)) return null;
  CONFIG.live.iptvOrgAsked = true;
  saveLive();
  return liveSummary();
});

ipcMain.handle('live:hide-broken', (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.live.hideBroken = Boolean(on);
  saveLive();
  if (on) checkLiveHealth();
  home?.webContents.send('live:changed');
  return liveSummary();
});

// ---- "Hide channels that don't work": open each list channel's stream now and then, in the background.

const HEALTH_AGAIN_MS = 12 * LIVE_HOUR;
let liveHealth = {};
let healthRun = null;
const liveHealthFile = () => path.join(app.getPath('userData'), 'live-health.json');
function loadLiveHealth() { try { liveHealth = JSON.parse(fs.readFileSync(liveHealthFile(), 'utf8')) || {}; } catch { liveHealth = {}; } }
let healthSaveTimer = null;
function saveLiveHealth() {
  clearTimeout(healthSaveTimer);
  healthSaveTimer = setTimeout(() => {
    if (live.urls) { // (only once the channels are known)
      const keep = new Set(live.urls.map((p) => p.url));
      for (const u of Object.keys(liveHealth)) if (!keep.has(u)) delete liveHealth[u];
    }
    try { fs.writeFileSync(liveHealthFile(), JSON.stringify(liveHealth)); } catch { /* optional */ }
  }, 2000);
}

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Does it open? A playlist (HLS) or video data within 12 seconds counts.
async function streamWorks(p) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(p.url, { headers: { 'user-agent': p.ua || BROWSER_UA, ...(p.referrer ? { referer: p.referrer } : {}) }, signal: ac.signal });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const head = Buffer.from(value || []).toString('latin1', 0, 64);
    const type = res.headers.get('content-type') || '';
    return head.startsWith('#EXTM3U') || head.charCodeAt(0) === 0x47 || /video|mpegurl|mp2t|octet-stream|dash\+xml/i.test(type);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

function checkLiveHealth() {
  if (healthRun || !CONFIG.live.hideBroken) return healthRun;
  const now = Date.now();
  const todo = (live.urls || []).filter((p) => !liveHealth[p.url] || now - liveHealth[p.url].at > HEALTH_AGAIN_MS);
  if (!todo.length) return null;
  healthRun = (async () => {
    let done = 0;
    let next = 0;
    let dirty = false;
    const worker = async () => {
      while (next < todo.length && CONFIG.live.hideBroken) {
        const p = todo[next++];
        const was = liveHealth[p.url] && liveHealth[p.url].ok;
        liveHealth[p.url] = { ok: await streamWorks(p), at: Date.now() };
        if (liveHealth[p.url].ok !== was) dirty = true;
        done += 1;
        // Only redraw the guide when a channel turned up broken (or working again).
        if (done % 150 === 0) { saveLiveHealth(); if (dirty) { dirty = false; home?.webContents.send('live:changed'); } }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    saveLiveHealth();
  })().finally(() => { healthRun = null; home?.webContents.send('live:changed'); });
  return healthRun;
}


// ---- how sharp each copy of a channel really is (measured while playing, or by a picture check)

let liveQuality = {};
const liveQualityFile = () => path.join(app.getPath('userData'), 'live-quality.json');
function loadLiveQuality() { try { liveQuality = JSON.parse(fs.readFileSync(liveQualityFile(), 'utf8')) || {}; } catch { liveQuality = {}; } }
let qualityTimer = null;
function saveLiveQuality() {
  clearTimeout(qualityTimer);
  qualityTimer = setTimeout(() => {
    try { fs.writeFileSync(liveQualityFile(), JSON.stringify(liveQuality)); } catch { /* optional */ }
    if (!liveSess) rebuildLive(); // re-order copies (not mid-watch: the playlist is already set)
  }, 1500);
}

ipcMain.handle('live:prefer-quality', async (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.live.preferQuality = Boolean(on);
  saveLive();
  await rebuildLive();
  return liveSummary();
});

// ---- "Check": are two channels showing the same thing? Watch both for a little while and compare
// the pictures. Live streams run a few seconds (or a minute) apart, so every moment of one is
// compared with every moment of the other, not just the ones at the same clock time.

const CHECK_SECONDS = 36;
const CHECK_EVERY = 3; // a picture every 3 seconds

// A picture's fingerprint: 64 bits saying whether each spot is brighter than the one to its right.
// Similar pictures have similar fingerprints, whatever their size or sharpness.
function fingerprintImage(file) {
  const img = electron.nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const small = img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap(); // BGRA
  const lum = [];
  for (let i = 0; i < 72; i++) lum.push(0.114 * small[i * 4] + 0.587 * small[i * 4 + 1] + 0.299 * small[i * 4 + 2]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const spread = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  if (spread < 6) return null; // black, or one flat colour: says nothing about the channel
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (lum[y * 9 + x] < lum[y * 9 + x + 1] ? 1n : 0n);
  return bits;
}
const distance = (a, b) => { let x = a ^ b; let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

// Where a copy plays from right now (a Jellyfin channel has to be opened first; closed afterwards).
async function openCopy(src, opened) {
  if (src.play.type === 'url') return src.play;
  const server = serverFor(src.play.serverId);
  const r = await jf.openLive(server, src.play.channelId);
  if (r.liveStreamId) opened.push({ server, id: r.liveStreamId });
  return { url: r.url };
}

// Pictures from one copy, with mpv (no window): returns { prints, height }.
async function samplePictures(how, play, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    ...how.args, '--no-config', '--ao=null', '--vo=image',
    '--vo-image-format=png', `--vo-image-outdir=${dir}`, `--vf=lavfi=[fps=1/${CHECK_EVERY},scale=96:-2]`,
    `--length=${CHECK_SECONDS}`, '--network-timeout=30', '--term-playing-msg=TVO-HEIGHT=${height}',
    ...(play.ua ? [`--user-agent=${play.ua}`] : []), ...(play.referrer ? [`--referrer=${play.referrer}`] : []),
    play.url,
  ];
  const height = await new Promise((resolve) => {
    const child = require('child_process').spawn(how.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: apps.cleanEnv() });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), (CHECK_SECONDS + 45) * 1000);
    child.on('exit', () => { clearTimeout(kill); const m = /TVO-HEIGHT=(\d+)/.exec(out); resolve(m ? Number(m[1]) : null); });
    child.on('error', () => { clearTimeout(kill); resolve(null); });
  });
  const prints = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => fingerprintImage(path.join(dir, f))).filter((p) => p != null);
  fs.rmSync(dir, { recursive: true, force: true });
  return { prints, height };
}

async function checkPair(aId, bId) {
  const how = await apps.locate('mpv');
  if (!how) return { error: 'no-mpv' };
  const A = findChannel(aId);
  const B = findChannel(bId);
  if (!A || !B) return { error: 'gone' };
  const base = path.join(player.sharedDir(how.via), `sofa-king-check-${process.pid}`);
  const opened = [];
  try {
    const [pa, pb] = await Promise.all([openCopy(A.sources[0], opened), openCopy(B.sources[0], opened)]);
    const [sa, sb] = await Promise.all([samplePictures(how, pa, `${base}-a`), samplePictures(how, pb, `${base}-b`)]);
    if (sa.height) { liveQuality[A.sources[0].key] = sa.height; saveLiveQuality(); }
    if (sb.height) { liveQuality[B.sources[0].key] = sb.height; saveLiveQuality(); }
    if (sa.prints.length < 3 || sb.prints.length < 3) {
      const which = sa.prints.length < 3 && sb.prints.length < 3 ? 'either channel' : sa.prints.length < 3 ? A.name : B.name;
      return { ok: { verdict: 'unclear', reason: `Couldn't get enough of a picture from ${which}.` } };
    }
    let matched = 0;
    for (const p of sa.prints) if (sb.prints.some((q) => distance(p, q) <= 10)) matched += 1;
    const share = matched / sa.prints.length;
    const verdict = matched >= 3 && share >= 0.4 ? 'same' : matched === 0 ? 'different' : 'unclear';
    return { ok: { verdict, matched, of: sa.prints.length, heights: [sa.height, sb.height] } };
  } catch (err) {
    return { ok: { verdict: 'unclear', reason: err.code === 'unreachable' ? 'A server didn\'t answer.' : 'One of them wouldn\'t open.' } };
  } finally {
    for (const o of opened) jf.closeLive(o.server, o.id);
  }
}

ipcMain.handle('live:check-pair', async (event, a, b) => {
  if (!fromHome(event)) return null;
  return checkPair(String(a), String(b));
});

// ---- mpv's own log (only with debug logging on); kept where a Flatpak mpv can write it

let lastMpvLog = null;
function mpvLogFile(how) {
  if (!log.debugOn) return null;
  lastMpvLog = path.join(player.sharedDir(how.via), 'sofa-king-mpv.log');
  try { fs.rmSync(lastMpvLog, { force: true }); } catch { /* fine */ }
  return lastMpvLog;
}

// ---- Settings → Advanced → Gamescope fixes

let saidListener = null;
async function gamescopeState() {
  const plugin = await gamescope.deckyPlugin();
  const said = JSON.stringify(plugin);
  if (said !== saidListener) {
    saidListener = said;
    log.info(`[gamescope] game mode: ${gamescope.inGameMode()}; plugin installed: ${plugin.installed}; "don't dim" answered by: ${plugin.listener ? `${plugin.listener.name}${plugin.listener.decky ? ' (inside Decky)' : ''}` : 'nothing'}`);
  }
  return {
    ...CONFIG.gamescope,
    gameMode: gamescope.inGameMode(),
    steamFound: gamescope.steamDirs().length > 0,
    portFile: gamescope.flagOn(),
    portOpen: await gamescope.steamPortOpen(),
    decky: gamescope.hasDecky(),
    python: Boolean(gamescope.PYTHON),
    uinput: gamescope.uinputOk(),
    plugin,
  };
}
ipcMain.handle('gamescope:state', async (event) => (fromHome(event) ? gamescopeState() : null));
ipcMain.handle('gamescope:set', async (event, key, value) => {
  if (!fromHome(event)) return null;
  if (key === 'steamDim') {
    const on = Boolean(value);
    // On: Steam opens its debugging port from its next start (a file in Steam's folder). Off:
    // closed again, if we opened it and Decky Loader doesn't need it.
    if (on && !gamescope.flagOn()) { const r = gamescope.setFlag(true); if (r.ok) saveGamescope({ madePort: true }); }
    if (!on && CONFIG.gamescope.madePort && !gamescope.hasDecky()) { gamescope.setFlag(false); saveGamescope({ madePort: false }); }
    if (!on && CONFIG.gamescope.dimmedOff) await steamDimmingBack();
    saveGamescope({ steamDim: on });
  } else if (key === 'person') {
    saveGamescope({ person: Boolean(value) });
    if (!value) pretendPerson.stop();
  } else if (key === 'personHow') {
    saveGamescope({ personHow: value === 'keyboard' ? 'keyboard' : 'controller' });
    if (pretendPerson.running) { pretendPerson.stop(); pretendPerson.start(CONFIG.gamescope.personHow); }
  }
  return gamescopeState();
});

// ---- Settings → Developer

function developerState() {
  return { debug: log.debugOn, size: log.sizes(), file: log.file };
}
ipcMain.handle('dev:state', (event) => (fromHome(event) ? developerState() : null));
ipcMain.handle('dev:debug', (event, on) => {
  if (!fromHome(event)) return null;
  CONFIG.debugLog = Boolean(on);
  saveUserConfig({ debugLog: CONFIG.debugLog });
  log.setDebug(CONFIG.debugLog);
  return developerState();
});
ipcMain.handle('dev:clear', (event) => { if (fromHome(event)) log.clear(); return developerState(); });
// The log, for the phone (QR code in Settings → Developer).
function logForPhone() {
  return [
    `SOFA King log, ${new Date().toString()}`,
    `Debug logging: ${log.debugOn ? 'on' : 'off'}`,
    '',
    log.collect(lastMpvLog ? [{ name: 'mpv (last time it played something)', path: lastMpvLog }] : []),
  ].join('\n');
}
ipcMain.handle('dev:phone-log', async (event) => {
  if (!fromHome(event)) return null;
  const info = await phone.start().catch(() => null);
  if (!info || info.error) return info || { error: 'no-network' };
  const url = info.url.replace('/?t=', '/log?t=');
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0b10', light: '#ffffff' } }).catch(() => '');
  return { ok: { qr, address: info.address, network: info.network } };
});

// ---- the local address mpv tunes in through

const liveToken = crypto.randomBytes(16).toString('hex');
let liveRedirect = null; // Promise<port>

function liveRedirector() {
  if (liveRedirect) return liveRedirect;
  liveRedirect = new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://local');
      const m = /^\/live\/([^/]+)$/.exec(u.pathname);
      if (!m || u.searchParams.get('t') !== liveToken) { res.writeHead(403); res.end(); return; }
      const sess = liveSess;
      const ch = findChannel(decodeURIComponent(m[1]));
      if (!sess || !ch || !ch.sources.length) { res.writeHead(404); res.end(); return; }
      const attempt = sess.failed.get(ch.id) || 0;
      const src = ch.sources[attempt % ch.sources.length];
      sess.used.set(ch.id, src.key);
      log.debug(`[live] tuning ${ch.name}: copy ${attempt % ch.sources.length + 1} of ${ch.sources.length} (${liveSourceName(src.sourceId)}, ${src.play.type})`);
      try {
        let url;
        if (src.play.type === 'url') url = src.play.url;
        else if (sess.direct.get(ch.id) && sess.direct.get(ch.id).now) {
          // Second go at a Jellyfin channel: straight from where Jellyfin gets it.
          url = sess.direct.get(ch.id).url;
          log.info(`[live] ${ch.name}: second try, the other way (${url.split('?')[0]})`);
        } else {
          const server = serverFor(src.play.serverId);
          const r = await jf.openLive(server, src.play.channelId);
          if (r.liveStreamId) sess.openStreams.push({ channelId: ch.id, server, id: r.liveStreamId });
          if (r.alt && !sess.direct.has(ch.id)) sess.direct.set(ch.id, { url: r.alt, now: false });
          if (r.directFirst) log.info(`[live] ${ch.name}: ${r.why === 'same-machine' ? `playing it from where ${liveSourceName(src.sourceId)} gets it (same machine as the server)` : `${liveSourceName(src.sourceId)} can't pass this stream on, so playing it from where it gets it`}`);
          url = r.url;
        }
        log.debug(`[live] ${ch.name} -> ${url}`);
        res.writeHead(302, { Location: url });
        res.end();
      } catch (err) {
        // Say why, on screen, when mpv gives up on it.
        const why = err.code === 'unreachable' ? `${liveSourceName(src.sourceId)} didn't answer in time`
          : err.status ? `${liveSourceName(src.sourceId)} said no (error ${err.status})` : `${liveSourceName(src.sourceId)} couldn't open it`;
        sess.why.set(ch.id, why);
        log.warn(`[live] ${ch.name} from ${liveSourceName(src.sourceId)}: ${err.message}${err.status ? ` (HTTP ${err.status})` : ''}`);
        res.writeHead(502);
        res.end();
      }
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  return liveRedirect;
}

function closeStreams(sess, channelId) {
  const keep = [];
  for (const s of sess.openStreams) {
    if (!channelId || s.channelId === channelId) jf.closeLive(s.server, s.id); else keep.push(s);
  }
  sess.openStreams = keep;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "5 · CNN — Now: Anderson Cooper 360 (until 9:00) · Next: 9:00 CNN Tonight"
function sayOnNow(sess, ctl, i) {
  const c = findChannel(sess.chans[i] && sess.chans[i].id) || sess.chans[i];
  if (!c) return;
  const now = Date.now();
  const on = c.programmes.find((p) => p.start <= now && p.stop > now);
  const next = c.programmes.find((p) => p.start >= (on ? on.stop - 1000 : now));
  const lines = [`${c.number ? `${c.number} · ` : ''}${c.name}`];
  if (on) lines.push(`Now: ${on.title}${on.sub ? ` · ${on.sub}` : ''} (until ${hhmm(on.stop)})`);
  if (next) lines.push(`Next: ${hhmm(next.start)} ${next.title}`);
  ctl.say(lines.join('\n'), 5000);
}

async function playLive(ids, startId) {
  if (externalApp) throw Object.assign(new Error('busy'), { code: 'busy' });
  const how = await apps.locate('mpv');
  if (!how) return { error: 'no-mpv' };
  const chans = ids.map(findChannel).filter(Boolean);
  if (!chans.length) return { error: 'failed' };
  const port = await liveRedirector();
  const start = Math.max(0, chans.findIndex((c) => c.id === startId));
  const sess = { chans, index: start, failed: new Map(), why: new Map(), used: new Map(), direct: new Map(), openStreams: [], lastActivity: Date.now(), asking: false, stopAskedAt: 0, askTimer: null };
  liveSess = sess;
  stepAside('mpv');
  const ctl = playMpv({
    how,
    screenArgs: mpvScreenArgs(),
    entries: chans.map((c) => {
      const direct = c.sources.map((s) => s.play).find((p) => p && p.type === 'url');
      // A channel is always one stream: never let mpv read it as a list of files (which would
      // shuffle the playlist, and the channel buttons with it).
      const opts = ['--demuxer=lavf',
        // A proper buffer for live streams, so a slow segment doesn't pause playback every few
        // seconds: start a few segments behind live, and read well ahead.
        '--cache=yes', '--cache-secs=30', '--demuxer-readahead-secs=20', '--demuxer-max-bytes=256MiB',
        '--cache-pause-wait=3', '--demuxer-lavf-o=live_start_index=-3', '--hls-bitrate=max'];
      if (direct && direct.ua) opts.push(`--user-agent=${direct.ua}`);
      if (direct && direct.referrer) opts.push(`--referrer=${direct.referrer}`);
      return { url: `http://127.0.0.1:${port}/live/${encodeURIComponent(c.id)}?t=${liveToken}`, title: `${c.number ? `${c.number} · ` : ''}${c.name}`, opts };
    }),
    log, logFile: mpvLogFile(how),
    loadingText: (i) => `Tuning in to ${sess.chans[i] ? `${sess.chans[i].number ? `${sess.chans[i].number} · ` : ''}${sess.chans[i].name}` : 'the channel'}…`,
    onPlaying: (i) => {
      sayOnNow(sess, ctl, i);
      const c = sess.chans[i];
      rememberLiveChannel(findChannel(c.id) || c);
      // It works: remember that (and forget any "doesn't work" from an earlier check).
      for (const s of (findChannel(c.id) || c).sources) if (s.play && s.play.type === 'url' && liveHealth[s.play.url] && liveHealth[s.play.url].ok === false && (sess.failed.get(c.id) || 0) === (findChannel(c.id) || c).sources.indexOf(s)) liveHealth[s.play.url] = { ok: true, at: Date.now() };
    },
    startIndex: start,
    token: null, // never send the Jellyfin token to other places
    bindings: CONFIG.mpvBindings,
    help: mpvHelp('live'),
    kind: 'live',
    ...mpvCommon(),
    keepAwake: true,
    autoplay: true,
    onFileStart: (i) => {
      sess.index = i;
      sess.lastActivity = Date.now();
    },
    onFileEnd: (i, reason) => {
      const c = sess.chans[i];
      if (!c) return;
      closeStreams(sess, c.id);
      if (reason === 'error') log.warn(`[live] mpv couldn't play ${c.name} (${sess.why.get(c.id) || 'the stream failed to open'})`);
      if (reason !== 'error') return;
      // A Jellyfin channel that opened but wouldn't play: try the stream behind it directly, once.
      const alt = sess.direct.get(c.id);
      if (alt && !alt.now) {
        alt.now = true;
        ctl.say(`${c.name}: trying it another way…`, 3000);
        setTimeout(() => ctl.command(['playlist-play-index', String(i)]), 300);
        return;
      }
      if (alt) sess.direct.delete(c.id);
      // That source didn't work: try the channel's next one, if it has one.
      const tries = (sess.failed.get(c.id) || 0) + 1;
      const ch = findChannel(c.id) || c;
      if (tries < ch.sources.length) {
        sess.failed.set(c.id, tries);
        ctl.say(`${c.name}: ${sess.why.get(c.id) || 'that didn\'t work'}. Trying another source…`, 4000);
        setTimeout(() => ctl.command(['playlist-play-index', String(i)]), 300);
      } else {
        sess.failed.delete(c.id);
        ctl.say(`${c.name} isn't working right now${sess.why.get(c.id) ? ` (${sess.why.get(c.id)})` : ''}.`, 7000);
        // Every source failed: count it as not working (hidden next time, if that's on).
        for (const s of ch.sources) if (s.play && s.play.type === 'url') liveHealth[s.play.url] = { ok: false, at: Date.now() };
        saveLiveHealth();
      }
    },
    onState: (st) => {
      // How sharp this copy really is: next time, the sharpest copy goes first.
      const cur = sess.chans[sess.index];
      const usedKey = cur && sess.used.get(cur.id);
      if (usedKey && st.height && liveQuality[usedKey] !== st.height) { liveQuality[usedKey] = st.height; saveLiveQuality(); }
      // "Are you still watching?" for live TV: by time since you last changed channel.
      const sw = CONFIG.playback.stillWatching || {};
      if (st.paused) { if (sess.asking) return; sess.lastActivity = Date.now(); return; }
      if (sess.asking) { sess.asking = false; sess.lastActivity = Date.now(); ctl.say('', 1); return; }
      if (sw.mode !== 'off' && sw.minutes > 0 && Date.now() - sess.lastActivity > sw.minutes * 60000) {
        sess.asking = true;
        ctl.command(['set', 'pause', 'yes']);
        ctl.say(`Are you still watching? Press ${buttonName(CONFIG.mpvBindings.pause)} to keep watching.`, 3600000);
      }
    },
    onMessage: (args) => {
      if (args[0] === 'tv-overlay-skip') { sess.lastActivity = Date.now(); sayOnNow(sess, ctl, sess.index); }
      if (args[0] === 'tv-overlay-stop') confirmStop(sess, ctl);
    },
    onExit: (error) => {
      closeStreams(sess);
      if (liveSess === sess) liveSess = null;
      stepBack();
      home.webContents.send('live:played', { error });
    },
  });
  return { ok: true };
}

// ---------------------------------------------------------------- startup

function setupServiceSession() {
  const s = session.fromPartition(SERVICE_PARTITION);
  // Look like plain Chrome: some services turn away browsers that announce "Electron".
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|sofa-king)\/\S+/g, ''));
  const allowed = new Set(['fullscreen', 'media', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock']);
  s.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
}

// ------------------------------------------------------------ updates (the AppImage)

// The AppImage checks SOFA King's GitHub page for a newer release: a few seconds after starting,
// then once a day while it stays open. A new version is offered once (a small screen with "Show
// me", which goes to Settings → General → Updates). Nothing is downloaded until you choose Update.
const updater = createUpdater({ version: VERSION, appImage: process.env.APPIMAGE || null, apiBase: process.env.SOFA_UPDATE_API || undefined, log });
const UPD = { status: 'idle', latest: null, error: null, got: 0, total: 0 };
const updateState = () => ({
  version: VERSION, can: updater.canUpdate(), check: CONFIG.updates.check, prerelease: CONFIG.updates.prerelease,
  lastCheck: CONFIG.updates.lastCheck, status: UPD.status, error: UPD.error, got: UPD.got, total: UPD.total,
  latest: UPD.latest && { version: UPD.latest.version, name: UPD.latest.name, date: UPD.latest.date, prerelease: UPD.latest.prerelease, news: UPD.latest.news, size: UPD.latest.file ? UPD.latest.file.size : 0 },
});
const pushUpdate = () => { if (home && !home.webContents.isDestroyed()) home.webContents.send('update', updateState()); };
const busyUpdating = () => ['checking', 'downloading'].includes(UPD.status);

async function checkForUpdate({ quiet = false } = {}) {
  if (busyUpdating() || UPD.status === 'ready') return updateState();
  UPD.status = 'checking'; UPD.error = null;
  pushUpdate();
  try {
    const r = await updater.check(CONFIG.updates.prerelease);
    UPD.latest = r.latest;
    UPD.status = r.newer ? 'available' : 'none';
    CONFIG.updates.lastCheck = Date.now();
    saveUserConfig({ updates: CONFIG.updates });
    log.info(`[update] checked: this is ${VERSION}, newest ${r.latest ? r.latest.version : 'none'}${CONFIG.updates.prerelease ? ' (test versions included)' : ''}`);
    // Offered once for each new version, when the check happened by itself. (Home says when it's
    // actually been shown, with update:offered.)
    if (r.newer && quiet && CONFIG.updates.toldAbout !== r.latest.version && (updater.canUpdate().ok || process.env.SOFA_UPDATE_API)) {
      UPD.status = 'available';
      if (home && !home.webContents.isDestroyed()) home.webContents.send('update:offer', updateState());
    }
  } catch (err) {
    UPD.status = 'error'; UPD.error = err.code || 'failed';
    log.warn(`[update] couldn't check: ${err.code || err.message}`);
  }
  pushUpdate();
  return updateState();
}

function scheduleUpdateChecks() {
  if (!updater.canUpdate().ok && !process.env.SOFA_UPDATE_API) return;
  const due = () => CONFIG.updates.check && Date.now() - CONFIG.updates.lastCheck > 20 * 3600e3;
  // Every start, once Home has had a moment to load; then once a day.
  setTimeout(() => { if (CONFIG.updates.check) checkForUpdate({ quiet: true }); }, process.env.SOFA_UPDATE_API ? 2000 : 5000);
  setInterval(() => { if (due()) checkForUpdate({ quiet: true }); }, 3600e3);
}

ipcMain.handle('update:state', (event) => (fromHome(event) ? updateState() : null));
ipcMain.handle('update:check', (event) => (fromHome(event) ? checkForUpdate() : null));
ipcMain.handle('update:offered', (event, version) => {
  if (!fromHome(event) || !UPD.latest || String(version) !== UPD.latest.version) return;
  CONFIG.updates.toldAbout = UPD.latest.version;
  saveUserConfig({ updates: CONFIG.updates });
});
ipcMain.handle('update:set', (event, key, on) => {
  if (!fromHome(event) || !['check', 'prerelease'].includes(key)) return null;
  CONFIG.updates[key] = Boolean(on);
  saveUserConfig({ updates: CONFIG.updates });
  if (key === 'prerelease' && !busyUpdating() && UPD.status !== 'ready') { UPD.status = 'idle'; UPD.latest = null; }
  return updateState();
});
ipcMain.handle('update:install', async (event) => {
  if (!fromHome(event) || UPD.status !== 'available' || !UPD.latest) return null;
  UPD.status = 'downloading'; UPD.got = 0; UPD.total = UPD.latest.file ? UPD.latest.file.size : 0; UPD.error = null;
  pushUpdate();
  let last = 0;
  try {
    await updater.install(UPD.latest, (got, total) => {
      UPD.got = got; UPD.total = total;
      if (Date.now() - last > 400) { last = Date.now(); pushUpdate(); }
    });
    UPD.status = 'ready';
  } catch (err) {
    UPD.status = 'available'; UPD.error = err.code || 'failed';
    log.warn(`[update] couldn't install ${UPD.latest.version}: ${err.code || err.message}`);
  }
  pushUpdate();
  return updateState();
});
// Start the new AppImage, then close this one.
ipcMain.handle('update:restart', (event) => {
  if (!fromHome(event) || UPD.status !== 'ready' || !process.env.APPIMAGE) return null;
  log.info('[update] restarting into the new version');
  try {
    const child = require('child_process').spawn(process.env.APPIMAGE, process.argv.slice(1).filter((a) => a.startsWith('--windowed')), { detached: true, stdio: 'ignore', env: apps.cleanEnv() });
    child.unref();
  } catch (err) {
    log.warn(`[update] couldn't start the new version: ${err.message}`);
    return { error: 'failed' };
  }
  setTimeout(() => app.quit(), 300);
  return { ok: true };
});

app.whenReady().then(async () => {
  CONFIG = loadConfig();
  // Paths set by hand in Settings → Apps. (Only once the settings are read: done any earlier, it
  // saw the defaults, so a path you'd set was forgotten every time the app restarted.)
  for (const [id, p] of Object.entries(CONFIG.appPaths || {})) if (p) apps.setCustomPath(id, p);
  log.setDebug(CONFIG.debugLog);
  // The app quit while a film had Steam's dimming off: put it back (Steam may still be starting).
  if (CONFIG.gamescope.dimmedOff) {
    let tries = 0;
    const again = () => steamDimmingBack().then(() => { if (CONFIG.gamescope.dimmedOff && ++tries < 6) setTimeout(again, 10000); });
    setTimeout(again, 3000);
  }
  refreshAudio();
  watchmode = createWatchmode({
    getKey: () => CONFIG.watchmodeKey, getRegion: () => CONFIG.region,
    cacheFile: path.join(app.getPath('userData'), 'watchmode-cache.json'),
  });
  // Plex servers' addresses can change: check them once at start (in the background).
  if (CONFIG.plex.accountToken) setTimeout(() => refreshPlexServers().catch((err) => log.warn(`[plex] couldn't check servers: ${err.code || err.message}`)), 4000);
  if (!CONFIG.plex.clientId) {
    CONFIG.plex.clientId = crypto.randomUUID();
    saveUserConfig({ plex: CONFIG.plex });
  }
  if (!CONFIG.jellyfinDeviceId) {
    CONFIG.jellyfinDeviceId = crypto.randomUUID();
    saveUserConfig({ jellyfinDeviceId: CONFIG.jellyfinDeviceId });
  }
  checkVacuumTube();
  if (components) {
    try {
      await components.whenReady();
      console.log('[widevine] ready:', components.status());
    } catch (err) {
      console.error('[widevine] failed to load, DRM video will not play:', err);
    }
  } else {
    console.warn('[widevine] not the castLabs build of Electron: DRM video will not play.');
  }
  setupServiceSession();
  protocol.handle('jfimg', (request) => serverImage(request.url));
  createWindow();
  // Live TV: last known channels straight away, then fresh ones (and every few hours).
  loadLiveHealth();
  loadLiveQuality();
  loadLiveCache();
  setTimeout(() => { if (liveSources().length) refreshLive(); }, 5000);
  setInterval(() => { if (liveSources().length) refreshLive(); }, LIVE_REFRESH_MS);
  scheduleUpdateChecks();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { phone.stop(); pretendPerson.stop(); forgetCovers(); });
