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
- On a title's page, a button for each server that has it, always first. Movies offer *Resume* or *Start over*; shows open their episodes.

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
| L2 / R2 | Back / ahead 1 minute |
| D-pad ◀ ▶ | Back 10 seconds / ahead 30 seconds |
| D-pad ▲ ▼ | Volume |
| Start | Show the time |

Change any of these in **Settings → Controller → In mpv**.

**Playback options** (Settings → Servers): play the next episode automatically, skip intros and credits automatically (your server needs to have them marked, e.g. with Jellyfin's Intro Skipper plugin), ask before stopping, and ask "Are you still watching?" after a while.

**Play with** can also be *Jellyfin Desktop*, or the *built-in player* (Jellyfin's web player inside the app). Without mpv, the built-in player is used.

Your server's sign-in only ever goes to that server, and never appears in the log.
