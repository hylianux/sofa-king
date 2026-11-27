# Music and radio

[← Back to the README](../README.md)

## The Music tab

Music works the way films do: find an artist, album or song, then see where you can play it.

- **The tab:** a search bar, then *New on your servers*, *Radio*, *Made for you* and what's popular.
- **Search:** artists, albums and songs, from Deezer and MusicBrainz. MusicBrainz also knows bootlegs, promos and tributes.
- **An artist's page:** shelves for albums, EPs, singles, live albums and so on, then *Unofficial* (bootlegs), *Tributes and covers*, *Appears on* and *Related artists*. Albums you have on your servers get a green dot (matched by their MusicBrainz tags if they have them, otherwise by title). Anything of theirs on your servers that the catalogue doesn't know about gets its own shelf, *Only on your servers*.
- **An album's page:** your servers first (*Play from your servers*, plays in mpv), then *Listen on*, with YouTube Music first. A filled button opens the album itself; an outlined one opens that service's search for it.
- **Made for you:** playlists from ListenBrainz. Songs you have play from your servers; the rest play on YouTube Music.

## Settings → Music

- **Subsonic servers:** Navidrome, Gonic, Airsonic, Ampache, LMS, Nextcloud Music, or anything else that speaks Subsonic. Give it the address, your name and password. Your password isn't kept, only a scrambled form the server can check, and it only ever goes to that server.
- **Folders:** which of a server's libraries to use (none picked means all of them). To leave a pile of unsorted music out, make it a separate library on the server and don't pick it.
- **Music services:** which services get a button on album pages, and whether your Jellyfin and Plex music shows.
- **Recommendations:** your ListenBrainz name, for *Made for you*. *Related artists* come from ListenBrainz with no setup, or from Last.fm if you add a free Last.fm key (*Set up Last.fm* walks you through it).
- **Pictures:** what's on screen while music and radio play (see below).
- **Artist pages:** switch off any of the slower shelves.

## Pictures while music plays

While songs and stations play, the screen shows the album's cover (or the station's logo) or a visualiser that moves with the music, with what's playing written on it. **R3** (press the right stick) changes the picture, and the one you end on is used next time. You can also pick it in **Settings → Music → Pictures**.

- **Album art:** the cover, big, over a blurred copy of itself, with soft light rising from the bottom.
- **Light bars:** bars of light for each note, mirrored in a glossy floor.
- **Waterfall:** notes fall down the screen like a piano roll as they're played.
- **Laser:** the left and right channels drawn against each other, leaving glowing trails.
- **Waves:** the sound wave itself, glowing.
- **Kaleidoscope:** the laser folded four ways, slowly turning.
- **Spectrogram:** the sound as heat, scrolling sideways.
- **Off:** black, with just what's playing.

Most of them have the blurred cover behind them too. mpv draws them with your computer's processor: on a slow computer (or to save a Steam Deck's battery), Album art, Waterfall and Spectrogram are the lightest. Songs with their own video (music videos) show that instead.

## Scrobbling to Last.fm

Scrobbling adds what you play from your servers to your Last.fm profile.

It needs three things:

- **A Last.fm key,** which lets the app talk to Last.fm.
- **The key's shared secret.** This is the second code shown on the page right after you make the key. **Last.fm only shows it that once.** If you didn't keep it, make a new key (it takes a minute); *Sign in to scrobble* offers to.
- **Your permission, once.** *Sign in to scrobble* opens Last.fm's page, where you press Allow. The key alone doesn't say whose profile to add plays to. You're never asked again.

The easiest way to bring the key and secret over is your phone: scan the code during setup and paste each one into the page, in either order.

Once you're signed in, each of your music servers gets its own switch. Switch off any server that already sends its plays to Last.fm itself (Navidrome can, and so can Jellyfin with its Last.fm plugin), or its songs will count twice.

A song counts once you've heard half of it or four minutes of it, whichever comes first. Songs under 30 seconds never count.

## Radio

*All stations* on the Music tab's Radio shelf opens the Radio screen: *Favourites*, *Your stations*, *Recently played* (newest first; ✕ takes a station off, *Clear all* empties it after asking), *Popular* in your country, *SomaFM*, *Search* and *Country*. ☆ beside a station makes it a favourite. **L1 / R1** switch between the tabs (passing over Search, which asks you to type).

Stations play in mpv. Previous and next move between stations, and the screen shows the song playing if the station sends it. Press B twice to stop.

**Settings → Music → Radio** adds your own stations (a stream's address, or an M3U or PLS playlist) and switches SomaFM off.
