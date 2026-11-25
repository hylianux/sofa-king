'use strict';

// Loaded into every layer: our own pages and the streaming sites.
//  - Our pages (file://) get a small `window.tv` bridge to the app.
//  - Every page reads the game controller and reports presses to the main process,
//    which turns them into arrow keys / Enter for that page, or opens the overlay.

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => ipcRenderer.on(channel, (_event, ...args) => fn(...args));
const STATION_KEYS = ['id', 'name', 'url', 'logo', 'about', 'source', 'uuid'];
// Only these fields, as plain strings or numbers (nothing else crosses over).
const plain = (o, keys) => {
  const out = {};
  for (const k of keys) if (o && (typeof o[k] === 'string' || typeof o[k] === 'number')) out[k] = o[k];
  return out;
};

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('tv', {
    services: () => ipcRenderer.invoke('ui:services'),
    stores: () => ipcRenderer.invoke('ui:stores'),
    openWatchPage: (kind, id) => ipcRenderer.send('ui:open-watch-page', String(kind), Number(id)),
    plexState: () => ipcRenderer.invoke('plex:state'),
    plexStart: () => ipcRenderer.invoke('plex:start'),
    plexWait: () => ipcRenderer.invoke('plex:wait'),
    plexCancel: () => ipcRenderer.invoke('plex:cancel'),
    plexRefresh: () => ipcRenderer.invoke('plex:refresh'),
    plexToggle: (id) => ipcRenderer.invoke('plex:toggle', String(id)),
    plexSignOut: () => ipcRenderer.invoke('plex:signout'),
    onPlexChanged: listen('plex:changed'),
    mediaServers: () => ipcRenderer.invoke('media:servers'),
    findOnYouTube: (query) => ipcRenderer.send('ui:find-youtube', String(query || '').slice(0, 200)),
    open: (id, query) => ipcRenderer.send('ui:open', String(id), query == null ? null : String(query)),
    action: (name, arg) => ipcRenderer.send('ui:action', String(name), arg == null ? null : String(arg)),

    // music (home page)
    musicSearch: (q) => ipcRenderer.invoke('music:search', String(q || '')),
    musicCharts: () => ipcRenderer.invoke('music:charts'),
    musicArtist: (spec) => ipcRenderer.invoke('music:artist', plain(spec, ['name', 'mbid', 'deezerId'])),
    musicExtra: (mbid, which) => ipcRenderer.invoke('music:extra', String(mbid || ''), String(which || '')),
    musicGroups: (ids) => ipcRenderer.invoke('music:groups', (Array.isArray(ids) ? ids : []).slice(0, 20).map(String)),
    musicRelated: (spec) => ipcRenderer.invoke('music:related', plain(spec, ['mbid', 'name'])),
    musicMadeFor: () => ipcRenderer.invoke('music:made-for'),
    musicPlaylist: (id) => ipcRenderer.invoke('music:playlist', String(id)),
    musicFindSongs: (list) => ipcRenderer.invoke('music:find-songs', (Array.isArray(list) ? list : []).slice(0, 200).map((t) => plain(t, ['title', 'artist']))),
    musicPlaySongs: (list, start) => ipcRenderer.invoke('music:play-songs', (Array.isArray(list) ? list : []).slice(0, 300).map((t) => plain(t, ['serverId', 'id'])), Number(start) || 0),
    musicListenBrainz: (name) => ipcRenderer.invoke('music:listenbrainz', String(name || '')),
    musicShelf: (id, on) => ipcRenderer.invoke('music:shelf', String(id), Boolean(on)),
    lastfmSignIn: () => ipcRenderer.invoke('music:lastfm-signin'),
    lastfmScrobble: (on) => ipcRenderer.invoke('music:lastfm-scrobble', Boolean(on)),
    lastfmSignOut: () => ipcRenderer.invoke('music:lastfm-signout'),
    lastfmServer: (id, on) => ipcRenderer.invoke('music:lastfm-server', String(id), Boolean(on)),
    onLastfmSignedIn: listen('lastfm:signed-in'),
    musicAlbum: (spec) => ipcRenderer.invoke('music:album', plain(spec, ['mbid', 'deezerId', 'title', 'artist', 'serverId', 'itemId'])),
    musicYouTube: (kind, title, artist) => ipcRenderer.invoke('music:youtube', { kind: String(kind), title: String(title || ''), artist: String(artist || '') }),
    youtubeSettings: () => ipcRenderer.invoke('youtube:settings'),
    youtubeSet: (patch) => {
      const p = patch && typeof patch === 'object' ? patch : {};
      const out = {};
      if (typeof p.open === 'string') out.open = p.open;
      for (const k of ['adblock', 'sponsorblock', 'dislikes', 'dearrow']) if (typeof p[k] === 'boolean') out[k] = p[k];
      if (Array.isArray(p.sbCategories)) out.sbCategories = p.sbCategories.map(String).slice(0, 20);
      return ipcRenderer.invoke('youtube:set', out);
    },
    musicPlay: (serverId, itemId, start) => ipcRenderer.invoke('music:play', String(serverId), String(itemId), Number(start) || 0),
    musicSettings: () => ipcRenderer.invoke('music:settings'),
    musicAddServer: (url, user, password) => ipcRenderer.invoke('music:add-server', String(url || ''), String(user || ''), String(password || '')),
    musicRemoveServer: (id) => ipcRenderer.invoke('music:remove-server', String(id)),
    musicFolders: (id) => ipcRenderer.invoke('music:folders', String(id)),
    musicSetFolder: (id, folder, on) => ipcRenderer.invoke('music:set-folder', String(id), String(folder), Boolean(on)),
    musicSetService: (id, on) => ipcRenderer.invoke('music:set-service', String(id), Boolean(on)),
    musicUse: (kind, on) => ipcRenderer.invoke('music:use', String(kind), Boolean(on)),
    onMusicChanged: listen('music:changed'),
    radioState: () => ipcRenderer.invoke('radio:state'),
    radioList: (kind, arg) => ipcRenderer.invoke('radio:list', String(kind), arg == null ? null : String(arg)),
    radioCountries: () => ipcRenderer.invoke('radio:countries'),
    radioSetCountry: (code) => ipcRenderer.invoke('radio:set-country', String(code || '')),
    radioSomafm: (on) => ipcRenderer.invoke('radio:somafm', Boolean(on)),
    radioFavorite: (station, on) => ipcRenderer.invoke('radio:favorite', plain(station, STATION_KEYS), Boolean(on)),
    radioAdd: (name, url) => ipcRenderer.invoke('radio:add', String(name || ''), String(url || '')),
    radioRemove: (id) => ipcRenderer.invoke('radio:remove', String(id)),
    radioPlay: (list, index) => ipcRenderer.invoke('radio:play', (Array.isArray(list) ? list : []).slice(0, 300).map((x) => plain(x, STATION_KEYS)), Number(index) || 0),
    onMusicPlayed: listen('music:played'),

    // search (home page)
    search: (query) => ipcRenderer.invoke('tmdb:search', String(query)),
    person: (id) => ipcRenderer.invoke('tmdb:person', Number(id)),
    details: (kind, id) => ipcRenderer.invoke('tmdb:details', String(kind), Number(id)),
    home: () => ipcRenderer.invoke('tmdb:home'),

    // settings and phone remote (home page)
    settings: () => ipcRenderer.invoke('ui:settings'),
    setKey: (key) => ipcRenderer.invoke('ui:set-key', String(key)),
    clipboardKey: (kind = 'tmdb') => ipcRenderer.invoke('ui:clipboard-key', String(kind)),
    phone: (mode, keyFor = 'tmdb') => ipcRenderer.invoke('ui:phone', String(mode), String(keyFor)),
    phoneMode: (mode, keyFor = 'tmdb') => ipcRenderer.send('ui:phone-mode', String(mode), String(keyFor)),
    phoneAsk: (label, secret) => ipcRenderer.invoke('ui:phone-ask', String(label || ''), Boolean(secret)),
    setAnyKey: (kind, key) => ipcRenderer.invoke('ui:set-any-key', String(kind), String(key)),
    wmStatus: () => ipcRenderer.invoke('wm:status'),
    openLink: (url, serviceId) => ipcRenderer.send('ui:open-link', String(url), serviceId ? String(serviceId) : null),
    traktStart: () => ipcRenderer.invoke('trakt:start'),
    traktCancel: () => ipcRenderer.invoke('trakt:cancel'),
    traktActivateHere: () => ipcRenderer.send('trakt:activate-here'),
    traktRemove: (what) => ipcRenderer.invoke('trakt:remove', String(what)),
    traktOptions: (patch) => ipcRenderer.invoke('trakt:options', patch),
    traktTitle: (kind, id) => ipcRenderer.invoke('trakt:title', String(kind), Number(id)),
    traktWatchlist: (kind, id, on) => ipcRenderer.invoke('trakt:watchlist', String(kind), Number(id), Boolean(on)),
    traktWatched: (kind, id) => ipcRenderer.invoke('trakt:watched', String(kind), Number(id)),
    onTraktSignIn: listen('trakt:signin'),
    onSetupKeySaved: listen('setup:key-saved'),
    soundsOn: () => ipcRenderer.invoke('ui:sounds'),
    setSounds: (on) => ipcRenderer.invoke('ui:set-sounds', Boolean(on)),
    onSounds: listen('sounds:changed'),
    onPlaySound: listen('sound:play'),
    soundSet: () => ipcRenderer.invoke('sound:set'),
    // Typing on Home: Start means "done" rather than opening the menu, and L2 / R2 are Shift.
    setTyping: (on) => ipcRenderer.send('typing', Boolean(on)),
    setMpvScreen: (n) => ipcRenderer.invoke('ui:set-mpv-screen', n == null ? null : Number(n)),
    screens: () => ipcRenderer.invoke('ui:screens'),
    setMotion: (on) => ipcRenderer.invoke('ui:set-motion', Boolean(on)),
    onMotion: listen('motion'),
    setFullScreen: (on) => ipcRenderer.invoke('ui:set-fullscreen', Boolean(on)),
    setKbConfirm: (on) => ipcRenderer.invoke('ui:set-kb-confirm', Boolean(on)),
    setSuggest: (patch) => ipcRenderer.invoke('ui:set-suggest', {
      ...(typeof patch.on === 'boolean' ? { on: patch.on } : {}),
      ...(typeof patch.remember === 'boolean' ? { remember: patch.remember } : {}),
      ...(patch.forget ? { forget: true } : {}),
    }),
    onTypingDone: listen('typing:done'),
    onHold: (cb) => { holdListeners.push(cb); },
    setAppPath: (id, p) => ipcRenderer.invoke('apps:set-path', String(id), String(p || '')),
    onSoundSet: listen('sound:set'),
    onConfirmQuit: listen('overlay:confirm-quit'),
    liveState: (paged) => ipcRenderer.invoke('live:state', Boolean(paged)),
    livePage: (version, from, count) => ipcRenderer.invoke('live:page', Number(version), Number(from), Number(count)),
    liveRefresh: () => ipcRenderer.invoke('live:refresh'),
    liveAddList: (text) => ipcRenderer.invoke('live:add-list', String(text)),
    liveRemove: (id) => ipcRenderer.invoke('live:remove', String(id)),
    liveMove: (id, dir) => ipcRenderer.invoke('live:move', String(id), Number(dir)),
    liveUseJellyfin: (on) => ipcRenderer.invoke('live:use-jellyfin', Boolean(on)),
    liveFavorite: (id, on) => ipcRenderer.invoke('live:favorite', String(id), Boolean(on)),
    livePair: (a, b, same) => ipcRenderer.invoke('live:pair', String(a), String(b), Boolean(same)),
    livePlay: (ids, startId) => ipcRenderer.invoke('live:play', ids.map(String), String(startId)),
    onLiveChanged: listen('live:changed'),
    iptvMeta: () => ipcRenderer.invoke('iptv:meta'),
    iptvSet: (type, code, on, name) => ipcRenderer.invoke('iptv:set', String(type), String(code), Boolean(on), String(name || '')),
    iptvAsked: () => ipcRenderer.invoke('iptv:asked'),
    liveHideBroken: (on) => ipcRenderer.invoke('live:hide-broken', Boolean(on)),
    livePreferQuality: (on) => ipcRenderer.invoke('live:prefer-quality', Boolean(on)),
    liveCheckPair: (a, b) => ipcRenderer.invoke('live:check-pair', String(a), String(b)),
    themes: () => ipcRenderer.invoke('themes:list'),
    setTheme: (choice) => ipcRenderer.invoke('themes:set', { layout: choice && choice.layout, colors: choice && choice.colors }),
    reloadThemes: () => ipcRenderer.invoke('themes:reload'),
    setLookTheme: (id) => ipcRenderer.invoke('look:theme', String(id)),
    setLookPart: (patch) => ipcRenderer.invoke('look:custom', patch && typeof patch === 'object' ? {
      colors: patch.colors, accent: patch.accent, display: patch.display, text: patch.text,
      sounds: patch.sounds, instrument: patch.instrument, background: patch.background,
      effect: patch.effect, soundFx: patch.soundFx, on: Boolean(patch.on),
    } : {}),
    saveLook: (name, slot, rect) => ipcRenderer.invoke('look:save', String(name || ''), Number(slot) || 0,
      rect ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } : null),
    deleteLook: (id) => ipcRenderer.invoke('look:delete', String(id)),
    audioStatus: () => ipcRenderer.invoke('audio:status'),
    setConvertAudio: (on) => ipcRenderer.invoke('audio:set-convert', Boolean(on)),
    devState: () => ipcRenderer.invoke('dev:state'),
    devDebug: (on) => ipcRenderer.invoke('dev:debug', Boolean(on)),
    devClear: () => ipcRenderer.invoke('dev:clear'),
    devPhoneLog: () => ipcRenderer.invoke('dev:phone-log'),
    onLivePlayed: listen('live:played'),
    bindings: () => ipcRenderer.invoke('bindings:get'),
    setBinding: (action, index) => ipcRenderer.invoke('bindings:set', String(action), Number(index)),
    resetBindings: () => ipcRenderer.invoke('bindings:reset'),
    onBindings: listen('bindings:changed'),
    captureButton: () => captureButton(),
    setHints: (on) => ipcRenderer.invoke('ui:set-hints', Boolean(on)),
    setPauseOnMenu: (on) => ipcRenderer.invoke('ui:set-pause-on-menu', Boolean(on)),
    onSettings: listen('settings:changed'),
    onHomeShown: listen('home:shown'),
    onRemoteText: listen('remote:text'),
    onRemoteKey: listen('remote:key'),
    onPhoneConnected: listen('phone:connected'),
    onOpenSettings: listen('open-settings'),

    // other apps and Jellyfin (home page)
    apps: (again) => ipcRenderer.invoke('apps:status', Boolean(again)),
    onExternalClosed: listen('external:closed'),
    onToast: listen('toast'),
    // Updates (the AppImage).
    updateState: () => ipcRenderer.invoke('update:state'),
    updateCheck: () => ipcRenderer.invoke('update:check'),
    updateSet: (key, on) => ipcRenderer.invoke('update:set', String(key), Boolean(on)),
    updateInstall: () => ipcRenderer.invoke('update:install'),
    updateRestart: () => ipcRenderer.invoke('update:restart'),
    onUpdate: listen('update'),
    jfList: () => ipcRenderer.invoke('jf:list'),
    jfDiscover: () => ipcRenderer.invoke('jf:discover'),
    jfProbe: (url) => ipcRenderer.invoke('jf:probe', String(url)),
    jfQcStart: (url) => ipcRenderer.invoke('jf:qc-start', String(url)),
    jfQcWait: () => ipcRenderer.invoke('jf:qc-wait'),
    jfQcCancel: () => ipcRenderer.invoke('jf:qc-cancel'),
    jfSignIn: (url, user, pass) => ipcRenderer.invoke('jf:signin', String(url), String(user), String(pass)),
    jfRemove: (id) => ipcRenderer.invoke('jf:remove', String(id)),
    jfFind: (kind, tmdbId, title, year) => ipcRenderer.invoke('jf:find', String(kind), Number(tmdbId), String(title), year == null ? null : String(year)),
    jfItem: (serverId, itemId) => ipcRenderer.invoke('jf:item', String(serverId), String(itemId)),
    jfSeasons: (serverId, seriesId) => ipcRenderer.invoke('jf:seasons', String(serverId), String(seriesId)),
    jfEpisodes: (serverId, seriesId, seasonId) => ipcRenderer.invoke('jf:episodes', String(serverId), String(seriesId), String(seasonId)),
    jfNextUp: (serverId, seriesId) => ipcRenderer.invoke('jf:nextup', String(serverId), String(seriesId)),
    jfPlay: (serverId, itemId, itemType, name, resume) =>
      ipcRenderer.invoke('jf:play', String(serverId), String(itemId), String(itemType), String(name), Boolean(resume)),
    onJfPlayed: listen('jf:played'),
    browseHome: () => ipcRenderer.invoke('browse:home'),
    browsePage: (spec, n) => ipcRenderer.invoke('browse:page', spec, n),
    genres: () => ipcRenderer.invoke('tmdb:genres'),
    genreArt: (id) => ipcRenderer.invoke('tmdb:genre-art', String(id)),
    remember: (kind, id, title) => ipcRenderer.send('ui:remember', kind, id, title),
    onViewStep: listen('view:step'),
    setJfPlayer: (choice) => ipcRenderer.invoke('ui:set-jf-player', String(choice)),
    setPlayback: (patch) => ipcRenderer.invoke('ui:set-playback', patch),
    mpvBindings: () => ipcRenderer.invoke('mpvb:get'),
    setMpvBinding: (action, index) => ipcRenderer.invoke('mpvb:set', String(action), Number(index)),
    resetMpvBindings: () => ipcRenderer.invoke('mpvb:reset'),
    onJfChanged: listen('jf:changed'),
    firewall: () => ipcRenderer.invoke('ui:firewall'),
    firewallAllow: () => ipcRenderer.invoke('ui:firewall-allow'),

    // menu and keyboard (overlay page)
    onOverlayState: listen('overlay-state'),
    onNotice: listen('overlay-notice'),
    onKbPad: listen('kb:pad'),
    onKbHold: listen('kb:hold'),
    onKbField: listen('kb:field'),
    onKbTyped: listen('kb:typed'),
    kbType: (text) => ipcRenderer.send('kb:type', String(text)),
    kbKey: (name) => ipcRenderer.send('kb:key', String(name)),
    kbClose: (submit) => ipcRenderer.send('kb:close', Boolean(submit)),

    // suggestions while typing (both pages)
    suggest: (text, where, titles) => ipcRenderer.invoke('suggest:get', String(text || ''), String(where || ''),
      Array.isArray(titles) ? titles.filter((t) => typeof t === 'string').slice(0, 40) : []),
    suggestRemember: (text, where) => ipcRenderer.send('suggest:remember', String(text || ''), String(where || '')),
  });
} else {
  // Websites: tell the app when a text field is focused, so A can bring up the keyboard.
  const NOT_TEXT = /^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i;
  const isTextField = (el) =>
    el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NOT_TEXT.test(el.type)));

  const labelOf = (el) => {
    const forLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = el.getAttribute('aria-label') || (forLabel && forLabel.textContent) ||
      el.placeholder || el.name || (el.type === 'password' ? 'Password' : '') || 'Text';
    return text.trim().replace(/\s+/g, ' ');
  };

  // A search box (so the keyboard can suggest titles and your earlier searches): the field says so
  // itself, or its name or label mentions searching.
  const isSearch = (el) => el.type === 'search' || el.getAttribute('role') === 'searchbox' ||
    /search|query|find/i.test(`${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`) ||
    Boolean(el.closest && el.closest('form[role="search"], [role="search"]'));
  const isEmail = (el) => el.type === 'email' || /email/i.test(`${el.name || ''} ${el.getAttribute('autocomplete') || ''}`);
  const kindOf = (el) => (el.type === 'password' ? 'password' : isEmail(el) ? 'email' : isSearch(el) ? 'search' : 'text');

  window.addEventListener('focusin', (e) => {
    if (isTextField(e.target)) {
      ipcRenderer.send('field', { focused: true, kind: kindOf(e.target), label: labelOf(e.target) });
    }
  }, true);
  window.addEventListener('focusout', (e) => {
    if (isTextField(e.target)) ipcRenderer.send('field', { focused: false });
  }, true);
}

// Standard gamepad layout: A=0, B=1, X=2, Y=3, L1=4, R1=5, L2=6, R2=7, Select=8, Start=9,
// L3=10, R3=11, D-pad=12-15. The D-pad always moves; every other button is set in Settings.
const DPAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const FALLBACK_BINDINGS = {
  ok: 0, back: 1, delete: 2, playpause: 3, scrollup: 4, scrolldown: 5,
  rclick: 6, lclick: 7, esc: 8, menu: 9, keyboard: 11,
};
const buttonsFrom = (bindings) => {
  const map = { ...DPAD };
  for (const [action, index] of Object.entries(bindings || {})) {
    if (Number.isInteger(index) && !(index in DPAD)) map[index] = action;
  }
  return map;
};
let BUTTONS = buttonsFrom(FALLBACK_BINDINGS);
ipcRenderer.invoke('bindings:get').then((b) => { if (b) BUTTONS = buttonsFrom(b); }, () => {});
ipcRenderer.on('bindings:changed', (_event, b) => { BUTTONS = buttonsFrom(b); });

const REPEATS = new Set(['up', 'down', 'left', 'right', 'delete', 'scrollup', 'scrolldown']);
const NAV = new Set(['up', 'down', 'left', 'right']);
const STICK = 0.6;
const REPEAT_DELAY = 400;
const REPEAT_RATE = 120;

const held = new Map(); // action -> { since, last }

function readPads() {
  const active = new Set();
  const raw = new Set(); // button numbers held down, for "press a button" in Settings
  let rx = 0;
  let ry = 0;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    pad.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.5)) raw.add(i); });
    for (const [index, action] of Object.entries(BUTTONS)) {
      if (raw.has(Number(index))) active.add(action);
    }
    const [x = 0, y = 0, x2 = 0, y2 = 0] = pad.axes;
    if (y < -STICK) active.add('up');
    if (y > STICK) active.add('down');
    if (x < -STICK) active.add('left');
    if (x > STICK) active.add('right');
    if (Math.abs(x2) > Math.abs(rx)) rx = x2;
    if (Math.abs(y2) > Math.abs(ry)) ry = y2;
  }
  return { active, raw, rx, ry };
}

// Settings asks "press a button": the next newly pressed button's number (or null after a while).
let capture = null; // { resolve, before: Set, until }
function captureButton() {
  return new Promise((resolve) => {
    if (capture) capture.resolve(null);
    capture = { resolve, before: null, until: performance.now() + 8000 };
  });
}

// ------------------------------------------------------------ controller mouse (websites only)
//
// The right stick moves a pointer; while it's showing, A clicks where it points.
// R2 left-clicks and L2 right-clicks (bringing the pointer up if it's hidden); L1 / R1 scroll.
// Using the D-pad (or a few idle seconds) hides it again.

const IS_WEB = location.protocol === 'http:' || location.protocol === 'https:';
const DEADZONE = 0.18;
const MAX_SPEED = 1500; // px per second at full tilt
const HIDE_AFTER = 5000;
const pointer = { x: 0, y: 0, visible: false, lastMove: 0, lastSent: 0, el: null, placed: false };

function pointerEl() {
  if (pointer.el && pointer.el.isConnected) return pointer.el;
  const root = document.body || document.documentElement;
  if (!root) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M3 2 L3 19 L7.5 14.8 L10.6 21.6 L13.6 20.3 L10.6 13.6 L16.8 13.6 Z');
  path.setAttribute('fill', '#ffffff');
  path.setAttribute('stroke', '#0b0b10');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  const styles = {
    position: 'fixed', left: '0', top: '0', width: '34px', height: '34px', margin: '0', padding: '0',
    'z-index': '2147483647', 'pointer-events': 'none', display: 'none',
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.55))', transform: 'translate(-3px, -2px)',
  };
  for (const [k, v] of Object.entries(styles)) svg.style.setProperty(k, v, 'important');
  root.appendChild(svg);
  pointer.el = svg;
  return svg;
}

function placePointer() {
  if (!pointer.placed) {
    pointer.x = innerWidth / 2;
    pointer.y = innerHeight / 2;
    pointer.placed = true;
  }
  const el = pointerEl();
  if (el) {
    el.style.setProperty('left', `${pointer.x}px`, 'important');
    el.style.setProperty('top', `${pointer.y}px`, 'important');
  }
}

function showPointer(on) {
  const el = pointerEl();
  pointer.visible = on;
  if (el) el.style.setProperty('display', on ? 'block' : 'none', 'important');
}

function movePointer(rx, ry, dt, time) {
  const mag = Math.hypot(rx, ry);
  if (mag < DEADZONE) return false;
  if (!pointer.placed) {
    pointer.x = innerWidth / 2;
    pointer.y = innerHeight / 2;
    pointer.placed = true;
  }
  const speed = MAX_SPEED * Math.pow((Math.min(mag, 1) - DEADZONE) / (1 - DEADZONE), 2) * (dt / 1000);
  pointer.x = Math.min(innerWidth - 2, Math.max(0, pointer.x + (rx / mag) * speed));
  pointer.y = Math.min(innerHeight - 2, Math.max(0, pointer.y + (ry / mag) * speed));
  const el = pointerEl();
  if (el) {
    el.style.setProperty('left', `${pointer.x}px`, 'important');
    el.style.setProperty('top', `${pointer.y}px`, 'important');
  }
  if (!pointer.visible) showPointer(true);
  pointer.lastMove = time;
  if (time - pointer.lastSent > 40) { // hover effects need real mouse moves
    pointer.lastSent = time;
    ipcRenderer.send('pointer', { type: 'move', x: pointer.x, y: pointer.y });
  }
  return true;
}

// Buttons held and let go (only those that act as Shift on the keyboard: L2 and R2 by default).
// On a website they go to the app (which sends them on to the keyboard); on our pages, straight
// to whoever's listening.
const HOLDS = new Set(['rclick', 'lclick']);
const holdListeners = [];
function holdChange(action, down) {
  if (!HOLDS.has(action)) return;
  if (IS_WEB) ipcRenderer.send('pad-hold', action, down);
  else for (const cb of holdListeners) { try { cb(action, down); } catch { /* their problem */ } }
}
// While the on-screen keyboard is up over a website, L2 / R2 are Shift there, not mouse clicks.
let keyboardUp = false;
ipcRenderer.on('kb:mode', (_e, on) => { keyboardUp = Boolean(on); });

// Turn a button press into what it means here: a click, a scroll, or a plain action for the app.
function fire(action) {
  if (IS_WEB && keyboardUp) return ipcRenderer.send('pad', action);
  if (IS_WEB) {
    if (NAV.has(action) && pointer.visible) showPointer(false);
    if (action === 'ok' && pointer.visible) {
      return ipcRenderer.send('pointer', { type: 'click', button: 'left', x: pointer.x, y: pointer.y });
    }
    if (action === 'lclick' || action === 'rclick') {
      placePointer();
      showPointer(true);
      pointer.lastMove = performance.now();
      return ipcRenderer.send('pointer', { type: 'click', button: action === 'rclick' ? 'right' : 'left', x: pointer.x, y: pointer.y });
    }
    if (action === 'scrollup' || action === 'scrolldown') {
      const at = pointer.visible ? pointer : { x: innerWidth / 2, y: innerHeight / 2 };
      return ipcRenderer.send('pointer', { type: 'scroll', dir: action === 'scrollup' ? -1 : 1, x: at.x, y: at.y });
    }
  }
  if (action === 'lclick' || action === 'rclick') return; // website-only buttons
  ipcRenderer.send('pad', action);
}

// While a video plays, hide the selection highlight so it doesn't frame the picture.
if (IS_WEB) {
  let wasPlaying = false;
  setInterval(() => {
    const playing = [...document.querySelectorAll('video')].some((v) => !v.paused && v.readyState > 2);
    if (document.documentElement) document.documentElement.toggleAttribute('data-tv-playing', playing);
    if (playing !== wasPlaying) {
      wasPlaying = playing;
      ipcRenderer.send('playing', playing); // lets the app hide the controls strip during playback
    }
  }, 700);
}

// ------------------------------------------------------------ polling

let lastTime = 0;

function poll(time) {
  const { active, raw, rx, ry } = readPads();

  if (capture && document.hasFocus()) {
    if (!capture.before) capture.before = new Set(raw); // ignore whatever was already held (the A that started this)
    for (const b of [...capture.before]) if (!raw.has(b)) capture.before.delete(b);
    const pressed = [...raw].find((b) => !capture.before.has(b));
    if (pressed != null || time > capture.until) {
      const done = capture;
      capture = null;
      done.resolve(pressed == null ? null : pressed);
      held.clear();
      for (const action of active) held.set(action, { since: time, last: time }); // don't also act on it
    }
    lastTime = time;
    requestAnimationFrame(poll);
    return;
  }
  // A long gap means this page was hidden (hidden pages don't run this loop), like the menu
  // between visits. Whatever's held now was pressed before it appeared, such as the Start that just
  // opened it, so it mustn't count as a new press.
  const paused = lastTime && time - lastTime > 250;
  const dt = Math.min(50, time - (lastTime || time));
  lastTime = time;

  if (!document.hasFocus() || paused) {
    // Not our turn: remember what's held so a button already down
    // (like the one that just opened the overlay) doesn't fire when we gain focus.
    held.clear();
    for (const action of active) held.set(action, { since: time, last: time });
  } else {
    if (IS_WEB) {
      movePointer(rx, ry, dt, time);
      if (pointer.visible && time - pointer.lastMove > HIDE_AFTER) showPointer(false);
    }
    for (const action of active) {
      const h = held.get(action);
      if (!h) {
        held.set(action, { since: time, last: time });
        holdChange(action, true);
        fire(action);
      } else if (REPEATS.has(action) && time - h.since > REPEAT_DELAY && time - h.last > REPEAT_RATE) {
        h.last = time;
        fire(action);
      }
    }
    for (const action of [...held.keys()]) if (!active.has(action)) { held.delete(action); holdChange(action, false); }
  }
  requestAnimationFrame(poll);
}

window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
// Gaining focus: the same goes for buttons held at that moment.
window.addEventListener('focus', () => {
  const now = performance.now();
  held.clear();
  for (const action of readPads().active) held.set(action, { since: now, last: now });
});
