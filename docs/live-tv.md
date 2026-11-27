# Live TV

[← Back to the README](../README.md)

## Where channels come from

The **Live** tab gathers channels from:

- **Channel lists:** any M3U playlist, with its XMLTV guide if it has one. Add one with **Settings → Live TV → Add a channel list**. For **FastChannels**, just its address is enough; the rest is found for you.
- **Jellyfin Live TV:** from any of your servers that has it, automatically. Channels Jellyfin gets from Tunarr, FastChannels or another tuner work away from home too.
- **iptv-org:** a free, community-run collection of public channels. The first time you open Live, the app offers your country's channels. **Settings → Live TV → Choose iptv-org channels** changes countries, languages and categories. It has no guide of its own.

## Watching

- **A** tunes in. **Right, then A** stars a channel; favourites come first.
- **Recently watched** (among the categories) lists the channels you've tuned in to lately, newest first.
- Categories from your lists run along the top. **B** in the channel list jumps back up to them. Along the categories, ◀ ▶ stop at either end, and **B** goes back to the first category (B there goes to the tabs).
- **L2 / R2** jump a screenful of channels up or down.
- While watching: **L1 / R1** flip channels, **Y** shows what's on now and next, and **B** (twice) stops.

## Tidying up

- **Broken channels are hidden.** Channels are checked in the background now and then, and the guide says how many are hidden.
- **The same channel from several places shows once.** If a channel fails to play from one source, the next one is tried. **Settings → Live TV** sets which source to try first.
- **HD and SD copies** ("ESPN" and "ESPN HD") become one channel, and the sharpest copy plays first.
- **Possible duplicates:** channels with the same name that might or might not be the same (two cities' stations of one network, say) are listed in Settings. Tell it **Same channel** or **Different**, or let **Check** compare their pictures for you.

Channels and guides refresh every few hours, in the background, without slowing the app down, even with thousands of channels.

## A Jellyfin server you don't run

If a channel from someone else's Jellyfin server won't play, ask whoever runs it to turn on **"Allow video playback that requires conversion without re-encoding"** for your user (Dashboard → Users → your user → Media playback).
