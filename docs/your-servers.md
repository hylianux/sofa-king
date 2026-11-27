# Your servers: Jellyfin, Plex and mpv

[← Back to the README](../README.md)

## Jellyfin

**Settings → Servers → Add a server** looks for Jellyfin servers on your network, or you can type an address. Sign in with **Quick Connect**: the TV shows a code, and you approve it from any phone or computer signed in to Jellyfin (your profile → Quick Connect). A name and password work too.

## Plex

**Settings → Servers → Plex → Sign in to Plex** shows a 4-letter code: enter it at **plex.tv/link**. Every server on your account is found, including ones shared with you, and each can be switched off.

## What you get

Your servers show up all over the app:

- **Jump back in** and **Up next** on Home.
- **Library**, with everything on your server, A to Z.
- On a title's page, a button for each server that has it, always first. Movies offer *Resume* or *Start over*; shows open their episodes. Titles are matched by their TMDB id, so your copy is found even when its name on the server differs from TMDB's ("Christmas Vacation" on the server, "National Lampoon's Christmas Vacation" on TMDB).

Episodes with no proper name or description get them from TMDB.

## Playing in mpv (recommended)

With **mpv** installed, titles play straight from your server: the original file, no transcoding, with surround sound, HDR and every subtitle format. Where you stopped and what you've watched stay in step with your other Jellyfin and Plex apps.

A show plays as a playlist, so the next episode follows on.

| Button | Does |
|---|---|
| A | Pause / play |
| B | Stop (press twice: the first press asks first) |
| Y | Skip the intro or credits |
| L1 / R1 | Previous / next episode |
| X | Next subtitles |
| Select | Next audio track |
| Hold L2 or R2 | While held, ◀ ▶ go back / ahead 1 minute and ▲ ▼ change the volume (kept for whatever plays next). Press both together to lock this on (no holding needed); B, or both again, unlocks |
| D-pad ◀ ▶ | Back 10 seconds / ahead 30 seconds (how far is up to you, see below) |
| D-pad ▲ or Start | The menu (below) |
| D-pad ▼ | Show the time and these buttons |
| L3 (press the left stick) | Speakers: Automatic, Stereo, 5.1 or 7.1 (the one you pick is kept for next time) |
| R3 (press the right stick) | Music and radio: the next picture (cover or visualiser; see [Music](music.md#pictures-while-music-plays)) |

**Forgot the buttons?** They show along the bottom when something starts playing, whenever you pause (until you carry on), and when you press ▼.

**The menu** (▲ or Start) runs along the bottom, with what's playing and how far in. **◀ ▶** choose, **A** picks, **B** closes it.

- **Playhead:** **◀ ▶** move a marker along the bar, faster the longer you hold, showing the time you'd land on. **A** jumps there; **B** leaves it where it was.
- **Play / Pause, Skip intro, Previous, Next, Stop.**
- **Subtitles, Audio, Speakers** (and **Picture** for music): a short list, the one in use marked. **▲ ▼** and **A** choose.
- **QR codes:** the title's TMDB and IMDb pages, to open on your phone (an episode shows its show's pages).

Change any of these in **Settings → Controller → In mpv**. The app reads the controller and tells mpv what to do, so this works the same with every mpv (Flathub's can't read a controller itself). If you'd rather mpv read it itself, switch off *The app's menu and hold buttons in mpv* there: you keep the buttons, but lose the menu and the hold buttons.

**Playback options** (Settings → Servers): play the next episode automatically, skip intros and credits automatically (your server needs to have them marked, e.g. with Jellyfin's Intro Skipper plugin), ask before stopping, and ask "Are you still watching?" after a while.

**Skipping** (Settings → Servers → Skipping): how far each skip button goes, anywhere from 5 seconds to 10 minutes, back and ahead set separately. *After a pause, carry on from a second earlier* (off to start with) backs up a second whenever you carry on after pausing, so you don't miss the line you paused on.

**Play with** can also be *Jellyfin Desktop*, or the *built-in player* (Jellyfin's web player inside the app). Without mpv, the built-in player is used.

Your server's sign-in only ever goes to that server, and never appears in the log.
