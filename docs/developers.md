# For developers

[← Back to the README](../README.md)

## Running it from the source code

You need Node.js 20 or newer.

```bash
git clone https://github.com/hylianux/sofa-king.git
cd sofa-king
npm install      # downloads castLabs Electron (Electron + Widevine), ~120 MB
npm run dev      # in a normal window, for testing
npm start        # full-screen kiosk mode, for the TV
```

`npm run dev` always opens a normal window. Settings → General → *Screen* → **Animations** switches off the small movements everywhere (things fading and rising in as they appear); they're also off when your system is set to reduce motion. Otherwise the app opens full screen; Settings → General → *Screen* → **Full screen** switches that off or on (and it's remembered).

The included `.npmrc` and the `allowScripts` entry in `package.json` let npm 12 install castLabs Electron, which comes from GitHub. If `npm start` says Electron failed to install correctly, run `node node_modules/electron/install.js` once to download it.

On first launch Widevine downloads in the background. The terminal prints `[widevine] ready:` when it's done. If it prints a failure, DRM video (Netflix, Hulu...) won't play.

## Files

- `main.js` – window, views, overlay and input routing
- `tmdb.js` – TMDB search, people, where-to-watch, rows, genres and suggestions
- `phone.js` – the phone remote: a small local web server and the page your phone sees
- `firewall.js` – spots a firewall blocking the remote and opens it for your home network, with permission
- `jellyfin.js` – finding Jellyfin servers, signing in, checking libraries, and telling Jellyfin Desktop what to show
- `plex.js` – Plex: signing in with a code, finding servers, rows, matching titles, the library, episodes, and playback reports (answering in the same shapes as `jellyfin.js`)
- `apps.js` – finding and launching VacuumTube, mpv and Jellyfin Desktop
- `lastfm.js` – scrobbling to Last.fm: signing in (token, allow page, session) and the signed calls
- `youtube.js` – YouTube for TV (its address, and the extras that run inside it), and finding albums and songs on YouTube Music
- `player.js` – playing Jellyfin files in mpv, with controller controls and progress reporting
- `preload.js` – controller reading, text-field detection on websites, and the bridge for our own pages
- `ui/` – the home, search, detail and settings screens (`home.*`), and the menu and keyboard (`overlay.*`)
- `watchmode.js` – the optional Watchmode lookup (more free services, direct links)
- `livetv.js` – live TV: reading M3U playlists and XMLTV guides, and matching up the same channel from different sources
- `livetv-store.js`, `livetv-worker.js` – live TV's channel store, on a background thread: reads lists, matches channels, keeps the cache, and says whether anything changed
- `music.js` – the music catalogue: search, artists' shelves (official, unofficial, tributes), albums and where they're streaming (MusicBrainz, the Cover Art Archive, Deezer, Apple)
- `subsonic.js` – Navidrome and other Subsonic servers (the sign-in in the request body, or the address for servers that only read it there)
- `suggest.js`, `data/words-en.txt` – suggestions while typing: earlier searches, titles, finished words and email endings
- `radio.js` – internet radio: Radio Browser (popular, search, countries) and SomaFM
- `ui/music.js` – the Music tab, an artist's page, an album's page, the Radio page, and Settings → Music
- `trakt.js` – the optional Trakt connection: sign-in with a code, watchlist, picks, history, scrobbling
- `ui/sounds.js` – the sound engine: plays a sound pack's note recipes (or its recordings), with filters, echo, distortion, the instrument swap (made on the fly, Tone.js or recorded) and the sound effects
- `audioconvert.js` – converts sound files the app can't play (AIFF, WMA, APE, Apple Lossless...) with ffmpeg, once each
- `themes.js` – loading the pieces of a look (moods, layouts, colour schemes, fonts, sound packs, effects and backgrounds; built in and your own), checking them, and your ten saved themes
- `themes/` – the built-in pieces, one folder for each kind (fonts with their licences), the templates, and the guide to making your own (`README.md`)
- `services.json` – the service list
- `stores.json` – rent-or-buy stores, so every *Also available* entry opens somewhere
- `config.example.json` – optional manual config

## Tests

`dev/tests/` has a script for each part of the app. Each one starts the real app with pretend TMDB, Jellyfin and Plex servers (and a throwaway settings folder), drives it with button presses, and writes what it saw, with screenshots, to `dev/tests/out/`. They never touch your own settings. For example:

```bash
node_modules/.bin/electron dev/tests/navaudit.js --layout=netflix
# without a screen: xvfb-run -a -s "-screen 0 1920x1080x24" before it
```

`navaudit.js` checks that the highlight can reach everything and never jumps between lines; run it after changing how anything moves. Some tests (music, YouTube) need the internet.

## Making a release

`npm run dist` builds the AppImage here, in `dist/`. Releases on GitHub are built by GitHub itself (`.github/workflows/release.yml`):

1. Set `version` in `package.json` (say `0.2.0`) and commit it.
2. Tag that commit with the same version and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. GitHub builds the AppImage and publishes the release with it, a checksum file, notes on what changed since the last release, and the source code.

A tag with a dash (`v0.2.0-beta.1`) makes a **pre-release**, which people looking for the latest stable version won't get. *Run workflow* on the Actions tab builds an AppImage to try, without releasing it.
