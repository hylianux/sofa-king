# SOFA King

A free, open-source alternative to smart TV apps, Fire TV, Roku, Apple TV and Android TV, running on your own PC. Jellyfin, Plex, Netflix, YouTube, live TV, music and radio, all in one place, with a controller.

**S**treaming, **O**pen, **F**ree, **A**ll-in-one.

*It used to be called TV Overlay. The first time SOFA King starts, your settings, themes, sign-ins and logs move over from `~/.config/tv-overlay` to `~/.config/sofa-king` by themselves.*

A controller-first TV launcher for Linux. The home screen picks up where you left off on Jellyfin, shows what's up next, suggests things like what you've watched, and lists what's trending and popular on the services you have; search for anything else. Pick a title to see which of your services streams it, and open it there. While watching, one button brings up a menu that gets you back home or into Settings.

## Installing

Download the newest **SOFA-King-….AppImage** from [Releases](https://github.com/hylianux/sofa-king/releases), make it runnable (right-click → Properties → Permissions → *Is executable*, or `chmod +x SOFA-King-*.AppImage`), and start it. It runs on any recent Linux (x86-64) without installing anything else, apart from **mpv** for films, shows and music (`sudo pacman -S mpv`, `sudo apt install mpv` or `sudo dnf install mpv`).

To have it in your apps menu, [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher adds it for you.

### Updates

The AppImage keeps itself up to date. Each time it starts (and then once a day while it's open), it asks SOFA King's GitHub page whether there's a newer release. When there is, a small screen says so, with what's new: **Show me** takes you straight to the Update button, **Not now** (or B) carries on. Each new version is offered once. **Settings → General → Updates** shows the new version and what's new in it; **Update now** downloads it in the background, checks it against the release's checksum file (a download that doesn't match is thrown away), and puts it in place of your AppImage under the same name, so anything that starts it keeps working. **Restart now** switches to it straight away; otherwise it's used next time.

- *Look for updates by itself* switches the daily check off (*Check now* still works).
- *Include test versions* also offers pre-releases (like 0.2.0-beta.1). It's on to begin with if the version you have is a test version itself.
- The only thing sent is the request for the release list, from "SOFA-King/<version>". Nothing about you or what you watch.
- Running from the source code, it never replaces itself: it only says when there's a newer version (`git pull` gets it).

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

### Search setup (TMDB key)

Search uses a free key from TMDB. Open **Settings** (the gear at the top right of the home screen) and pick one:

- **Paste it from my phone:** scan the QR code, then paste your key on your phone and tap Save. The phone page has a link straight to TMDB's API settings, so you can copy the key there first.
- **Find it on themoviedb.org:** opens TMDB's API settings in the app. Sign in with the controller keyboard, copy the **API Read Access Token**, then press View and pick *Back to settings*. The copied key is picked up from the clipboard and you just press *Save this key*. If copying doesn't work, *Use the key on this page* in that same menu reads it off the page instead.
- **Use copied key:** if the key is already on your clipboard.

The key is checked with TMDB before it's saved, and lives in `~/.config/sofa-king/config.json`. You can also put `tmdbKey` (and `region`, if you're not in the US) in a `config.json` next to `main.js`, like `config.example.json`.

## Getting around

The top of the home screen has three views; **L1 / R1** switch between them.

- **Home:** your rows, laid out however you like (see **Layouts and colours** below; the default is the Netflix-style big view, where whatever you're on fills the top of the screen with its picture, score, overview and where you can watch it: your services, rent-or-buy, and your Jellyfin and Plex servers, which always come first). Moving up to a row always shows its title. **Jump back in** has everything you're partway through on your Jellyfin and Plex servers (pick one to open its page, where **Resume** picks up exactly where you stopped), **Up next** has the next episode of shows you're watching, and **Inspired by what you've watched** has suggestions based on what you've played on Jellyfin and the titles you've opened here. Then **Trending** and what's popular **on your services**. Cards show just the title; the year and kind show on the selected one, and which episode and which server are in the panel and on the title's page. Left and right loop round each row; **More** opens the whole list as a big grid that keeps loading as you scroll. In the Netflix view the big picture at the front stays put and the cards roll under it: forward, the front title slides off to the left and the next card slides in, growing into its wide picture; back, the last title comes in from the left. Moving between rows is a quick slide in every layout: the rows scroll smoothly, and in one-row-at-a-time layouts (Netflix, PS5, PS3) the old row slides away as the new one slides in. Tabs (L1 / R1) switch straight away, however fast you press: Live, Genres and Library only load once you stop on them, and Live keeps its guide drawn for next time.
- **Genres:** each tile has its genre's own colours and a still from one of its best-known titles (from TMDB). The usual genres plus **Holiday classics**, then **See all genres** for 50-odd more: holidays and seasons (Halloween, Thanksgiving…), themes (superheroes, heists, time travel, zombies…), styles (anime, musicals, stand-up, cult classics…), around the world (K-dramas, Bollywood, British TV, Nordic noir…) and by era and acclaim (new releases, all-time greats, hidden gems, the '80s…). Each opens a grid of movies *and* shows (filter to just one with *Movies / Shows*), endless like More.
- **A show's episodes (Jellyfin):** **L1 / R1** go to the previous / next season from anywhere on the screen, and the button prompts stay at the bottom.
- **Library:** everything on a Jellyfin server, movies or shows, A to Z with a heading for each letter. The letter bar on the left jumps to a letter. Shows open their episodes; movies play.

## Themes, layouts and sounds

**Settings → Look** sets the look and feel. A look is made of pieces: a colour scheme, a heading font and a text font, a sound pack, a moving background and any number of effects.

**Mood** sets all the pieces in one go. The moods are:

| Mood | Feel |
|---|---|
| Classic (the default) | the original: midnight colours and soft clicks |
| Valentine | wine and rose, flowing handwriting, a music box and a heartbeat, a slowly breathing glow |
| Playtime | for kids: bright cream and sky blue, big bubbly letters, pops and boings, rounder corners |
| Horror | fog and rust, an old typewriter, PS1-style menu beeps, film grain and a flickering light |
| Halloween | pumpkin and midnight purple, drippy letters, theremins and creaky doors, drifting mist |
| Christmas | pine green and berry red, festive lettering, sleigh bells, falling snow |
| Heavy metal | black steel and fire, band-logo letters, distorted power chords, glowing embers and rising sparks |
| Country | barnwood and copper, Wild West lettering, banjo plucks |
| Gamer | a neon terminal, old computer lettering, 8-bit blips, scanlines |
| Artist | sketchbook paper and ink, an elegant serif, pencil ticks and page turns |
| Glam | bubblegum pink and lilac, retro brush script, sparkly harp runs |
| Autumn | warm browns and golds, an elegant serif, falling leaves |
| Rainy day | grey skies and gentle rain |
| Deep space | a starfield drifting past, chiming blips |
| Northern lights | arctic blues, the aurora overhead and a little snow |
| Console wave | ribbons of light rolling behind a clean menu, like an old games console |
| Soft focus | out-of-focus lights drifting about, pastel colours, marimba |
| Summer night | a warm purple dusk and fireflies |
| Party | bright flowing colours, confetti, cartoon boings and zaps |

**Saved themes:** ten squares for looks of your own, each with a small picture of how it looks. Choose an empty square to save the look you're using there; choose a full one to use it. When all ten are used, saving asks which one to replace (B keeps them all).

**Layout** is how Home is arranged, and how the controller moves around it. Any layout works with any theme. The layouts are:

- **Big view** (the default): Netflix-style. The selected title fills the top of the screen, and below it is one whole row at a time, with the selected card wide at the front. Left and right change title; up and down change row.
- **Rows:** several rows of posters at once.
- **Big posters:** one row at a time, with large posters.
- **Grid:** Roku and Apple TV style, with wide picture tiles.
- **PlayStation 5:** one row of square tiles, with the selected title's picture behind everything.
- **PS3 cross bar:** sections across the top and titles listed down; left and right change section.

Every layout names the rows above and below what's on screen ("▼ Trending this week · 2 more"), just outside the rows, so the hints never cover a title. Netflix-style, Rows and Big posters size their cards so whole rows always fit (one, two and one respectively): nothing is half in view or cut off. Rows loop: More is the last stop in each row, and one more step goes back to the first title. While Home loads, it shows placeholder rows in the layout's own shape, and the rest of the app works in the meantime.

**Preview:** in Settings → Look, highlighting anything (a layout, mood, saved theme, colour scheme, font, background or effect) shows a small Home on the right with it applied, before you choose it.

**Advanced theming** changes any piece:

- **Colours:** 22 schemes, including Dracula, Nord, Gruvbox, Catppuccin, Solarized, Light and High contrast.
- **Highlight colour**
- **Heading font** and **text font:** 15 fonts, each shown in its own lettering, including Atkinson Hyperlegible, which is made to be easy to read.
- **Sounds:** 14 sound packs, including **Cartoon** (wood-block taps, boings, whips, zaps, slide whistles and a clang). Selecting one plays a sample.
- **Instrument:** plays the pack's notes on something else. Made on the fly: chime, marimba, pluck, organ, 8-bit, soft and plucked string. Synths (from Tone.js): FM bell, electric piano, dreamy lead and drums (low notes are kicks and toms, middle ones snares, high ones cymbals). Recorded, from the free Fluid R3 GM sound font: piano, music box, celesta, marimba, vibraphone, harp, kalimba, and overdriven and distortion guitar. You can add recorded instruments of your own.
- **Sound effects:** bitcrush, chorus, phaser and echo on every sound, as many at once as you like.
- **Background:** a moving picture behind every screen, one at a time: PS3 wave, blurry lights (like RetroArch), aurora, flowing colours, starfield or particles. Or None.
- **Effects:** extra touches over every screen, each with its own switch, as many at once as you like: snow, rain, film grain, flickering light, scanlines, paper, sparkles, mist, embers, breathing glow, fireflies, falling leaves, floating hearts, bubbles, confetti and rounder corners.

Backgrounds and effects loop without a visible jump, and only move things in ways that are cheap for the graphics card. With **Settings → General → Screen → Animations** off, they hold still.

Changing anything makes the look **Custom**. **Save as a theme** puts it in the first empty square of your saved themes (or asks which to replace), and **Delete this theme** removes a saved one.

Sounds are synthesized on the fly from little recipes of notes, so no recordings are copied. Sound sets of your own can use recordings or recipes. **Foggy town** is plain PS1-era menu beeps and boops. Its notes are easy to change in its `sound.json`, by note name (`"E6"`), so you can match any beeps you like. **Rust & static** is the darker, survival-horror ambience: static, rusty clanks and a drone.

**Make your own** moods, layouts, colour schemes, fonts, sound packs, recorded instruments, effects and backgrounds. They're plain files in `~/.config/sofa-king/themes/`, one folder for each kind of piece; the app makes the folders, with templates and a guide. (Folders from older versions are renamed to match the first time it runs: `themes/` becomes `moods/`, `colors/` becomes `colorschemes/` and `sounds/` becomes `soundpacks/`.) Choose **Look for new themes** to pick them up. `themes/README.md` is the full guide. Anything from someone else is checked before it's used: colours must be colours, nothing can load from the internet, and nothing runs code. Sound files the app can't play itself (AIFF, WMA, APE, CAF, WavPack and Apple Lossless) are converted with ffmpeg, if it's installed: **Convert other sound formats**, under Make your own.

## The on-screen keyboard

For typing into websites, and for naming things in the app:

- **Typing:** A types the highlighted key, X deletes and Y types a space.
- **Capitals:** hold L2 or R2 for capitals and the second character on each key (! @ # …). Press both together for caps lock; while it's on, holding either gives small letters.
- **Moving:** left and right loop around each row.
- **Badges:** the keys with a button of their own show it (Delete, Space, Shift, Done).
- **Your phone:** the typing screen shows a code to scan; what you type on your phone goes into the box (dots for passwords), and its Enter button finishes.
- **Finishing:** Start is Done and B cancels. Each asks "are you sure?" first, with No chosen (the chosen answer is lit up and slightly bigger, the other faded), unless that's switched off in Settings → Controller → On-screen keyboard.
- **Suggestions:** a row above the keys offers things to pick instead of spelling them out; press Up to reach it, and A puts the one you pick in what you've typed (the highlight goes back to the key you came from). It finishes the word you're typing, from the commonest words in films and TV. On the Search screen it also offers the titles it found (or artists, albums and songs on music search) and your earlier searches; station searches remember earlier ones too. Over a website, search boxes get titles and your earlier searches there, email fields get endings like @gmail.com, and password fields get nothing. The keys never move as suggestions come and go. Earlier searches are only kept once you open something a search found (or send a website search), and stay on this computer. **Settings → Controller → On-screen keyboard** turns suggestions off, stops remembering searches (which also forgets them), or forgets them with one press.

## Music

The **Music** tab (between Live and Genres) works the way movies do: find an artist, album or song first, then see where it's streaming.

- **The tab:** a search bar, then *New on your servers* (when you've added one), *Radio* (your favourite stations and your own), *Made for you* (when you've given your ListenBrainz name, below), and what's popular (albums, artists and songs).
- **Search:** artists, albums and songs, from Deezer (quick, with pictures) and MusicBrainz (which also knows bootlegs, old promos and tributes). A song opens its album with that song marked.
- **An artist's page:** their picture and a line about them, then shelves: *Albums*, *EPs*, *Singles*, *Live*, *Compilations*, *Soundtracks*, *Remixes*, *Demos* and *Other releases*, newest first. Then, a moment later, *Unofficial* (bootlegs like Outcesticide), *Unofficial live recordings*, *Tributes and covers*, *Appears on* (other people's albums they're on: compilations, soundtracks, guest spots) and, last, *Related artists*. Albums you have on your servers get a green dot. They're matched by their MusicBrainz tags when you've tagged them (so a copy named anything at all still matches), otherwise by title, and then by title without volume numbers ("Outcesticide I: In Memory of Kurt Cobain" is plain "Outcesticide: In Memory of Kurt Cobain" in the catalogue) as long as only one of yours fits. Albums by others that credit the artist (tributes tagged with them among the album artists, for example) join *Tributes and covers*, and anything else of theirs on your servers that the catalogue doesn't list gets its own shelf, *Only on your servers*.
- **An album's page:** the cover, the tracks, and where to listen. *Play from your servers* (Navidrome, Jellyfin, Plex) plays the whole album in mpv; OK on a track starts from that track. Your servers come first, and the highlight starts there. *Listen on* has a button for each music service you use, YouTube Music first: filled when it goes straight to the album (Apple Music and Deezer usually do, Spotify, Tidal and the rest when MusicBrainz has their link), outlined when it opens that service's search for it. The services open as websites, like the video services.
- **A playlist made for you** (from *Made for you*): its songs, with a dot on the ones found on your servers. *Play from your servers* plays those, in order, even when they're spread over several servers; OK on a song starts there. A song you don't have plays on YouTube Music.

**Settings → Music:**

- **Subsonic servers:** Navidrome, or any other server that speaks the Subsonic language (Gonic, Airsonic-Advanced, Ampache, LMS, Supysonic, Nextcloud Music and others). *Add a server* asks for its address (`my-server:4533`; Navidrome's port 4533 is assumed if you leave the port out), your user name and password. The password isn't saved: only a scrambled form of it that the server can check. It's sent in the body of each request, which Navidrome and other newer servers read; a server that only reads it from the web address (older Subsonic servers) is noticed when you add it and gets it there instead, which is the standard Subsonic way. Either way it only ever goes to that server and never in the log, and songs reach mpv through a little relay on this computer, so mpv never sees it. A server that can only check a plain password (some do, behind LDAP for example) can't be added unless it can make an app password or API key to use instead. The server is told what's playing, for its play counts.
- **Folders:** which of the server's folders (libraries) the Music tab looks in. With none picked, all of them. To keep a folder out (an unsorted pile, say), make it a separate library on the server and leave it unpicked here.
- **Music services:** which services get a button on album pages. Your Jellyfin and Plex servers' music can be switched off here too.
- **Recommendations:** your **ListenBrainz** name, for the *Made for you* playlists (ListenBrainz makes them from what you listen to; Navidrome can send it your plays). Your name is public on ListenBrainz anyway, and nothing else is sent. **Related artists** come from ListenBrainz with no setup; *Set up Last.fm* walks you through getting a free Last.fm key (on your phone, or here on the TV) for Last.fm's instead, which often know more artists. The key is kept out of the log.
- **Scrobbling:** the key alone can't scrobble: it lets the app look things up, but doesn't say whose profile to add plays to, so Last.fm has you allow it once. With a Last.fm key, *Sign in to scrobble* opens Last.fm's page here, where you press Allow (once; you come back by yourself). From then on, songs you play from your servers go on your Last.fm profile: "now playing" while each one plays, and the song once you've heard half of it or four minutes (songs under 30 seconds never count, as Last.fm asks). It's on as soon as you've signed in; *Scrobble what I play* turns it off. It needs your key's **shared secret** too, the second code Last.fm shows on the page right after you make a key. **Last.fm only shows the secret that once**: your API accounts page shows the key later, but not the secret. On that page, *Use the key on this page* reads both; from your phone, paste the key and the secret one after the other (either order). If you didn't keep the secret, *Sign in to scrobble* explains and offers to make a new key (the old one just stops being used), or to type the secret if you saved it somewhere. Once it's on, each of your music servers (Subsonic, Jellyfin and Plex) gets its own switch: switch off any server that already sends its plays to Last.fm itself (Navidrome can, and Jellyfin with its Last.fm plugin), or each song from it counts twice. New servers start switched on. The secret and the sign-in are kept out of the log, and only ever go to Last.fm.
- **Artist pages:** switch off any of the slower shelves (unofficial releases, tributes, appears on, related artists).

Only Last.fm needs a key, and it's optional (scrobbling needs you to sign in too). The catalogue only ever sees what you searched for.

### Radio

*All stations* on the Music tab's Radio shelf opens **Radio**: *★ Favourites*, *Your stations*, *Popular in* your country, *SomaFM*, *Search*, and *Country* (which country *Popular* shows). ☆ beside a station makes it a favourite. Stations play in mpv, and ◀ / ▶ (previous and next) move to the station before or after it in the list. The screen shows the station and the song playing, when the station sends it (most do; a few send nothing). B, twice, stops (the same as for films and albums: *Ask "are you sure?" before stopping* in Settings).

Stations come from **Radio Browser** (a free list kept by its listeners: it's told when a station is played, which keeps its popular lists honest) and **SomaFM**. **Settings → Music → Radio** adds your own (a stream's address, or an M3U or PLS playlist) and switches SomaFM off. Only web addresses (http and https) are ever played.

## Live TV

The **Live** tab (next to Home; L1 / R1 get there too) has live channels from:

- **IPTV channel lists:** an M3U playlist, with an XMLTV guide if there is one. Add one with **Settings → Live TV → Add a channel list** (paste the address from your phone, or type it). **FastChannels:** just its address, like `http://192.168.1.10:5523`; the playlist and guide are found for you.
- **Jellyfin Live TV:** every signed-in server that has Live TV set up, automatically (turn this off in Settings → Live TV).

- **iptv-org:** a free, community-run collection of public live streams. The first time you open the Live tab, the app offers your country's channels (it works out the country from the system's time zone, then its language setting); say yes, pick another country, or not now, and it won't ask again. **Settings → Live TV → Choose iptv-org channels** adds or removes countries, languages and categories. iptv-org has no TV guide, so its channels show without one unless the same channel comes from somewhere that has one.

**Channels that don't work are hidden** (Settings → Live TV → Hide channels that don't work, on by default): channels from lists are checked in the background, every 12 hours or so and whenever one fails to play, and the guide says how many are hidden. Streams that need a particular browser name or referring page (lists say so with `#EXTVLCOPT`) get it, both in the checks and in mpv.

While a channel (or a Jellyfin film or episode) is opening, mpv shows a small animation with what's loading.

**The same channel in several places shows once.** Channels are matched by their schedule (the same programmes at the same times), by station or guide ids, and by logo and name. Two cities' stations of one network, or East and West feeds, stay separate because their schedules differ. Channels with the same name whose guides don't confirm a match are listed under **Possible duplicates** in Settings, with **Same channel** / **Different** buttons; your answers stick.

**Checking by picture:** next to each possible duplicate, **Check** watches both channels for about 40 seconds (with mpv, in the background) and compares a picture every few seconds. Live streams run seconds or minutes apart, so every moment of one is compared with every moment of the other. Matching pictures in most moments means the same channel; none at all means different; anything else is "can't tell". **Check all** goes through every pair, merges the same ones and separates the different ones, and leaves the rest for you. A check uses both streams while it runs (for a Jellyfin channel, a tuner).

**HD and SD copies** of a channel in the same list ("ESPN" and "ESPN HD") become one channel with two copies. With **Play the sharpest copy of a channel first** (on by default), copies are tried sharpest first, then in your source order. Sharpness comes from the name ("SD", "HD", "FHD", "4K", "1080p"…) and is measured whenever a copy plays (and during a check), kept in `live-quality.json`. The guide shows the best copy's quality next to the name, and the side panel lists every copy in the order they're tried.

Each channel plays from the first source in your list (Settings → Live TV, ↑ ↓ to reorder) that has it, and **if that source fails, the next one** is tried automatically.

In the guide: A tunes in, Right then A stars a channel (★ Favourites appear first), and categories from your lists are along the top. Channels play in mpv as a playlist, so **L1 / R1 flip channels**, Y shows what's on now and next, and B stops (twice, as usual). "Are you still watching?" uses its time setting (time since you last changed channel). The Jellyfin sign-in is never sent to other channel sources.

**Jellyfin channels that come from another tuner or IPTV source** (Tunarr, FastChannels, an M3U tuner) are passed on by Jellyfin, so they work away from home too. Live streams play with a generous buffer, so a slow segment doesn't pause the picture. The app asks Jellyfin to repackage them into a stream it can send: usually just a change of container, with no re-encoding. If one still won't play from a server you don't run, the person who runs it needs to turn on **"Allow video playback that requires conversion without re-encoding"** for your user (Dashboard → Users → your user → Media playback). If they're happy to let Jellyfin transcode too, **"Allow video playback that requires transcoding"** covers the rest. The channel's own address is only tried first when Jellyfin can't pass the stream on at all.

Channels and guides refresh every 3 hours (and from Settings → Live TV → Refresh channels). The last ones are kept in `live-cache.json`, so the tab opens instantly. The latest version is fetched in the background, and the guide changes only if something did. Reading big lists and guides, and matching channels up, happens on a background thread (`livetv-worker.js`), so the app never freezes while it works. The very first time, the Live tab shows a loading animation, and you can carry on around the app meanwhile. Long guides draw in batches and stay quick to move through, even with thousands of channels.

## More free services: Watchmode (optional)

TMDB's where-to-watch data often misses titles on Tubi, Pluto TV, The Roku Channel and other free services. **Settings → More free services → Set up Watchmode** walks you through getting a free key: it opens Watchmode's sign-up in the app, and you bring the key back with **Start → Use the key on this page**, from your phone, or by copying it.

**Loading:** while a title's details are on their way, shimmering placeholders hold their place: on Home's panel (the length, and where to watch) and on the title page. Your own Jellyfin servers are checked at the same time and always come first: on the panel, their names are the first labels (shown as soon as the servers answer), and on the title page their buttons go first in **Watch on**. Streaming services follow.

**Find it on YouTube:** every title page has a button that searches YouTube for uploads of the title (with the year, and "full movie" for films). It opens wherever YouTube opens (see *YouTube and VacuumTube*). It's separate from YouTube's own rent or buy.

With a key, every title page also asks Watchmode. Titles it finds on your services become **Watch on** buttons, and some open straight to the title instead of a search. The free plan is for personal use and gives 2,500 lookups a month; each title page uses one or two, and answers are kept for a day (in `watchmode-cache.json`), so normal use stays well inside it. Settings shows how many you've used.

## Trakt (optional)

Trakt keeps track of what you watch, on any service, and suggests what to watch next. **Settings → Trakt → Set up Trakt** is a three-step guide:

1. **Account:** make a free one in the app, or skip ahead if you have one.
2. **Developer app:** Trakt lets apps connect through a developer app you make on your account, at developer.trakt.tv/apps. Trakt asks you to **connect a GitHub account** first (a free one is fine). Make a new app named `SOFA King` with the redirect URI `urn:ietf:wg:oauth:2.0:oob` (or `http://localhost` if Trakt won't take it), save it and copy the **Client ID**. Apps made since October 2026 show the Client Secret as "Not issued" because they sign in with PKCE; the app doesn't need it. Bring the Client ID over from your phone, or with **Start → Use the Client ID on this page**. This step is easiest on a phone or computer, so the guide offers that first.
3. **Sign in:** the TV shows a code. Enter it at trakt.tv/activate on your phone, or choose **Enter it here on the TV** and it's filled in for you. The screen moves on by itself.

Once connected, Home shows **Your Trakt watchlist** and **Recommended for you on Trakt**, what you've watched on Trakt feeds **Inspired by what you've watched**, and title pages get **Add to watchlist** (and **Mark as watched** for films). In Settings you can hide the rows, or turn on **Tell Trakt what I watch in mpv** (off by default; leave it off if the Jellyfin Trakt plugin already does this, or plays count twice).

Free Trakt accounts can have one connected app at a time, so connecting this one may disconnect another (a Jellyfin plugin, say).

## Settings

Settings is split into tabs: **General · Look · Live TV · Jellyfin · Apps · Controller · Developer**. L1 / R1 switch between them, as do the tabs themselves at the top. Each tab has a menu of its sections down the left, and one section shows at a time, so nothing jumps around:

- **Moving around:** Right goes into a section, and Left goes back to the menu.
- **Long lists:** lists of options (sound packs, fonts, colours) scroll inside their own box, with a scrollbar.
- **Remembering your place:** Settings reopens where you left it.

While you're watching something:

- **Start** opens the menu.
- **Start** closes the menu, or Settings opened from it, straight away. The next **Start** opens whichever it was again, where you left it.
- **B** steps back: from a section to the menu of sections, then to the menu, then to your show.

Up from the Home / Live / Genres / Library tabs jumps to the Settings gear, and left and right along the top bar stay in it. In Settings, up and down stay inside the section you're in (left goes back to the menu of sections), and arriving at the first or last option scrolls its box all the way to that end.

## The log

The app keeps a log in `~/.config/sofa-king/logs/sofa-king.log`. At 1 MB it's moved aside and a new one starts; only the 3 most recent old ones are kept (about 4 MB at most). Jellyfin tokens, API keys and sign-ins are replaced with «hidden» before anything is written.

**Settings → Developer:**
- **Debug logging** adds much more: every request to your Jellyfin servers (and how long it took), what a live channel offers when it's opened, which copy of a channel is tuned and where it leads, the mpv command line, and mpv's own detailed log of the last thing it played.
- **Get the log on my phone** shows a QR code; scan it (same Wi-Fi) and the log (with mpv's last log) downloads as a text file.
- **Clear the log** empties it.

When a Jellyfin live channel opens but won't play (a Tunarr channel, say), the app tries once more straight from the stream Jellyfin itself gets the channel from, before giving up.

## Controls

These are the defaults. Change any of them in **Settings → Controller**: pick an action, press the button you want. The D-pad always moves around.

| Button | Does |
|---|---|
| D-pad / left stick | Move around |
| A | Select |
| B | Back: a page back on websites (opens the menu when there's nothing left), a screen back in the app |
| Start | Open or close the menu (F10 on a keyboard) |
| Select | Esc: leave full screen on websites |
| R3 | On-screen keyboard on websites (A on a text box works too) |
| Y | Play / pause the video; types a space on keyboards |
| X | Delete a letter |
| Right stick | Move the pointer on websites; A clicks while it's showing |
| R2 / L2 | Click / right-click at the pointer |
| R1 / L1 | Scroll down / up on websites; switch views on the home screen |

Moving, choosing and going back make small sounds, on websites too. Turn them off with **Settings → Controller → Sound effects**.

A real keyboard works everywhere too. **Quit SOFA King** is the last item in the menu, and asks before closing the whole program: both answers look alike until you choose one, and "Yes, quit" only turns red once it's chosen (Alt+F4 also quits).

Logins are saved in the app's own profile, so you sign in to each service once.

## Plex

Settings → Servers → **Plex** → *Sign in to Plex* shows a 4-letter code: enter it at **plex.tv/link** on a phone or computer. Every server on the account (yours and ones shared with you) is found, each with the address that answers best (on your network, then over the internet, then Plex's relay), and each can be switched off. *Look for servers again* picks up new servers or addresses (also checked each time the app starts).

Plex servers work like Jellyfin ones: **Jump back in** and **Up next** (from Plex's On Deck), the server's name first on a title's panel and its button first on the title's page when it's there (matched by TMDB id, or name and year), Library, and a show's seasons and episodes. Titles play in mpv: the original file, with resume points and watched marks kept in step (Plex's timeline, and marked watched when you stop near the end), external subtitles, and intro and credits skipping when your server has marked them. Without mpv they open in Plex's own web player.

The server's token only ever goes to that server, as a header (never in an address), the account's token only to plex.tv, and both are hidden in the log.

## Jellyfin

Add your servers in **Settings → Jellyfin → Add a server**. The app looks for servers on your network (and on this computer); you can also type an address. Then sign in with **Quick Connect**: the TV shows a 6-digit code, and you approve it from any phone or computer that's signed in to Jellyfin (your profile → Quick Connect). Username and password work too.

On a title's page (which uses the whole screen), every server that has it gets a button with the server's name. The page and the big panel on Home show how long it runs and when it would end if you started now ("1h 56m · Ends at 9:42 PM"), or, partway through, the time left and when you'd finish. The page also has the tagline and overview, and **cast & crew** with photos: the director, creators and writers, then the main cast with their characters. Pick a person to see what else they're in.

- **Movies** play straight away, or ask *Resume from 41:40* / *Start over* if you're partway through.
- **Shows** open an episodes screen: a **Continue** button for your next episode, season tabs, watched marks and progress bars.

### Playing: mpv (recommended)

With **mpv** installed (Flathub: `io.mpv.Mpv`, or your distro's `mpv` package), the app plays the original file straight from your server: no transcoding, surround passthrough, HDR, and every subtitle format. It's the same player Jellyfin Desktop uses, with no separate app to sign in to. Your progress is reported to Jellyfin as you watch, so resume points and watched marks stay in sync with every other Jellyfin app.

**Shows play as a playlist** of every episode, before and after the one you picked, so you can go back and forth and episodes play one after another. Each episode is reported to Jellyfin separately: finished ones are marked watched, ones you skip out of keep their resume point.

mpv's default controller layout (change any of it in **Settings → Controller → In mpv**):

| Button | Does |
|---|---|
| A | Pause / play |
| B | Stop and go back to the app (press twice: the first press asks "Stop watching?") |
| Y | Skip the intro or credits |
| L1 / R1 | Previous / next episode |
| X | Next subtitle track |
| Select | Next audio track |
| L2 / R2 | Back / ahead 1 minute |
| D-pad ◀ ▶ | Back 10 seconds / ahead 30 seconds |
| D-pad ▲ ▼ | Volume |
| Start | Show the time |

The usual mpv keyboard shortcuts work too. If the controller doesn't respond in mpv while running under Steam, turn Steam Input off for the app (see Notes).

**Playback options** (Settings → Jellyfin, under *When playing in mpv*):

- **Play the next episode automatically:** on by default. Off, mpv stops at the end of each episode, and R1 still moves on.
- **Skip intros / credits automatically:** off by default. Either way, when an intro or the credits start, mpv shows *Press Y to skip*. Skipping the credits goes to the next episode when autoplay is on. This needs your server to have the intros and credits marked: Jellyfin 10.10 or newer, usually with the Intro Skipper plugin.
- **Ask "are you sure?" before stopping:** on by default. Pressing stop shows *Stop watching? Press B again to stop*; a second press within 3 seconds stops. (The `q` key on a keyboard still stops straight away.)
- **Ask "Are you still watching?":** after a set time of watching (default 3 hours, counted from when you started from the app), after a number of episodes in a row, or never. It asks between episodes, never in the middle of one, by pausing with a message. Press pause (A) to carry on; with no answer for 20 minutes, mpv stops.

**Settings → Jellyfin → Play with** chooses the player: *mpv* (default), *Jellyfin Desktop* (opens it to the title's page; it needs its own sign-in), or the *built-in player* (Jellyfin's web player inside the app, signed in for you). If mpv isn't installed, titles use the built-in player, and the title page suggests installing mpv.

Titles are matched by their TMDB id, or by name and year when a library item has no TMDB id.

When an episode on your server has no proper title (its name is just the filename) or no description, the app fills them in from TMDB by season and episode number, on the episodes screen, in the rows and in mpv's title.

## YouTube and VacuumTube

**Settings → YouTube → Where it opens** decides where everything YouTube goes: the YouTube tile, *Find it on YouTube*, YouTube links on other sites (trailers), and YouTube Music's button on an album's page.

- **Automatic** (the default): VacuumTube when it's installed (Flatpak, AppImage, or a regular install from your distro or the AUR, found through its app-launcher entry), otherwise **YouTube for TV** here.
- **YouTube for TV, here:** YouTube's own TV page (the one smart TVs and VacuumTube show), opened inside the app. It's made for a remote, so the D-pad, A and B work as on a TV; B on its home screen opens the menu.
- **The website:** youtube.com, as it looks on a computer.

**Extras for YouTube for TV** (all off until you switch them on; VacuumTube has its own):

- *Block ads:* ads are taken out of YouTube's answers before the page reads them, so there are no ad breaks, ad tiles or "Sponsored" results.
- *SponsorBlock:* skips sponsor spots and anything else you pick under *What SponsorBlock skips*, with a small note in the corner.
- *Return YouTube Dislike:* likes and dislikes in the corner when a video starts.
- *DeArrow:* the community's plainer titles in place of clickbait ones (titles only).

SponsorBlock and DeArrow are only told the first few characters of a scrambled video id; Return YouTube Dislike is told which video is playing.

**YouTube Music's button** on an album's page plays the album: it's found on YouTube Music, then the first song plays with the rest of the album after it, in VacuumTube or YouTube for TV. On an album that isn't on your servers, OK on a song plays that song the same way. Something YouTube Music doesn't have becomes a YouTube search.

VacuumTube is the better app for watching YouTube on a TV; *Learn more* (on a title's page and in Settings → Apps) opens its site.

When the app hands off to VacuumTube or Jellyfin Desktop, it hides itself and comes back as a fresh window when that app closes, ready for the controller (desktops bring a newly shown window to the front, where many, Wayland ones especially, won't let an app un-minimise itself). mpv opens on the same screen as the app (Settings → Apps → *mpv's screen* picks a screen by hand, for desktops that decide for themselves), *on top* (`--ontop`) with the app waiting full screen underneath, so when mpv closes the app is simply the window that's left.

Other apps start with a clean environment: started with `npm start`, the app's own PATH begins with its `node_modules/.bin`, and a launcher like Arch's `/usr/bin/startvacuumtube` (which runs `electron`) would otherwise pick up this app's Electron instead of the system one and crash. npm's and Electron's own variables are left out too, and the desktop's `XDG_CURRENT_DESKTOP` is put back.

VacuumTube gets `--fullscreen` (so it fills the screen even if its own setting says otherwise) and, for a video, an album or a search, the address as its last argument; it opens with your own VacuumTube profile and sign-in. (VacuumTube hands that address to YouTube's TV page, which understands video links and `youtube.com/search?q=…`, but quietly ignores the website's `results?search_query=…` and stays on its home screen; searches use the first kind.) If it doesn't start (it quits straight away with an error), the app comes back, says so, and opens YouTube for TV here instead; what VacuumTube printed is in the log. If VacuumTube is installed somewhere the app can't find, Settings → Apps → *Tell it where VacuumTube is* takes its path.

## Getting around websites

- **D-pad:** moves between links and buttons. Whatever's selected gets a thick yellow outline, even on sites that normally hide it. The outline disappears while a video is playing.
- **Controller mouse:** for anything the D-pad can't reach (Prime Video, for one), push the right stick. A pointer appears. R2 clicks, L2 right-clicks, and A also clicks while the pointer is showing. R1 and L1 scroll. Press the D-pad (or leave it for 5 seconds) and the pointer hides again, so A goes back to selecting.
- **Full screen:** Select sends Esc, which leaves a video's full screen.
- **Controls strip:** a small bar at the bottom of any website lists these controls. It steps aside while a video plays and when the menu or keyboard is open. Turn it off in Settings → Controller.

## Typing

- **On-screen keyboard for websites:** select a text field (like a login box) and press A. A keyboard slides up and types into the page. *Next* moves to the next field, *Done* submits, B closes it. Password fields show dots.
- **Phone as a keyboard:** every keyboard screen shows a QR code. Scan it, and whatever you type on your phone goes to the TV: into the search screen on the home page, or into the selected field on a website. The phone page also has Delete, Next field and Enter buttons.

The phone link only works on your home network, and only with the code from the QR (it changes every time the app starts). The app listens on port 8765; if your computer has a firewall, allow that port on your local network. Set `phonePort` in config.json to use a different one.

**If the phone page never loads:** after 15 seconds with no phone connecting, Settings shows a *Phone not connecting?* panel.

- If your PC runs ufw or firewalld and it's blocking the remote, the panel has an **Allow on my home network** button. It asks for your computer password in the system's own prompt (the app never sees it) and adds a rule for your home network only, never the internet. The exact command is shown too, if you'd rather run it yourself.
- No keyboard for the password? On GNOME, the app switches on GNOME's on-screen keyboard for the prompt. If Steam is running, Steam + X brings up Steam's keyboard. KDE's on-screen keyboard doesn't reliably appear without a touchscreen yet, so plug in a keyboard for that one step.
- If the firewall isn't the problem, check your phone is on the same Wi-Fi as the PC (not a guest network) and has no VPN on.
- The address the phone connects to is shown under the QR code and printed in the terminal as `[phone] remote at ...`. Each phone request is logged as `[phone] GET ...`.

Logins are saved in the app's own profile, so you sign in to each service once.

## How search works

- Results update as you type: movies, shows and people. Pick a person to see what they're known for.
- Pick a title to see its details and which of **your** services stream it (from JustWatch's data, via TMDB). Each button says how: **Included**, **Free** or **Free with ads**. When one of your services only rents or sells it (Prime Video members often see this: Amazon has it, but not with Prime), its button is outlined instead of filled and says **Not included · Rent or buy**, with prices when Watchmode is set up.
- Other services that stream it, and stores that rent or sell it, are listed underneath in separate rows.
- **Also available** lists everywhere else, each marked *streaming* or *rent or buy*, and every one opens: the stores in `stores.json` (Amazon, Apple TV, Google Play, Fandango at Home, Microsoft) open their own search for the title, and anything else opens TMDB's where-to-watch page for it, which links to the provider.
- **Not listed? Search your free services** offers Tubi, Pluto TV, The Roku Channel and the rest anyway. JustWatch's data for free services is patchy (their catalogues rotate often), and Pluto TV is mostly live channels, which aren't tracked at all, so a title can be there without being listed.
- Pressing a service opens that service's own search for the title. Going straight to the title page needs per-service links, which is a later step.

The search URLs in `services.json` for Netflix, YouTube and Apple TV are well known. The rest are best guesses; if one lands on the wrong page, tell me which and I'll find the right format.

## Notes

- **Steam / Steam Deck:** If you add this as a non-Steam game, Steam Input may turn the controller into a mouse and keyboard and hide it from the app. Either turn Steam Input off for this game, or use a layout that maps the D-pad to arrow keys, A to Enter, B to Escape and View to F10.
- **TV remotes:** A Flirc USB receiver (or a CEC adapter) can map remote buttons to arrow keys, Enter, Escape and F10.
- **Video quality:** On Linux, Widevine runs at L3, so expect about 720p–1080p depending on the service. That's a limit of the services, not the app.
- **Your services:** `services.json` lists the streaming services you use, including free ones (Tubi, Pluto TV, The Roku Channel, Plex, Kanopy and Hoopla; Kanopy and Hoopla need a library card). It decides the *on your services* rows and which *Watch on* buttons a title gets. Remove the ones you don't have. `match` is how a service is recognised in TMDB's where-to-watch data; `searchUrl` is where its search lives, with `{q}` for the title.
- **The menu** (Start / F10) always has **Settings**. Opened while watching, Settings appears over the show, and B takes you straight back to it. The menu leaves your video playing; switch on *Pause the video while the menu is open* in Settings → Controller if you'd rather it paused (it picks up again when you close the menu).

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

## Making a release

`npm run dist` builds the AppImage here, in `dist/`. Releases on GitHub are built by GitHub itself (`.github/workflows/release.yml`):

1. Set `version` in `package.json` (say `0.2.0`) and commit it.
2. Tag that commit with the same version and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. GitHub builds the AppImage and publishes the release with it, a checksum file, notes on what changed since the last release, and the source code.

A tag with a dash (`v0.2.0-beta.1`) makes a **pre-release**, which people looking for the latest stable version won't get. *Run workflow* on the Actions tab builds an AppImage to try, without releasing it.

## Still to come

- "Pick for me": something to watch, chosen for you.
- Noticing when a service has signed you out, and signing in to services from your phone.

## Licence

SOFA King is free software: you can share it and change it under the terms of the **GNU General Public License, version 3 or (at your option) any later version**. See [`LICENSE`](LICENSE). It comes with no warranty.

Parts made by others keep their own licences: Tone.js and qrcode (MIT), the recorded instruments from the Fluid R3 GM sound font (CC BY 3.0, credited in `themes/instruments/CREDITS.md`), and the fonts in `themes/fonts/` (SIL Open Font License or Apache 2.0, each with its licence beside it), and the word list in `data/words-en.txt` (the commonest words in film and TV subtitles, from Hermit Dave's [FrequencyWords](https://github.com/hermitdave/FrequencyWords), CC BY-SA 4.0; swear words taken out). Removing ads from YouTube's TV page follows how [VacuumTube](https://github.com/shy1132/VacuumTube) (MIT) does it.
