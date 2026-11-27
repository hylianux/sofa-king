# SOFA King

**S**treaming, **O**pen, **F**ree, **A**ll-in-one.

A free, open-source alternative to smart TV apps, Fire TV, Roku, Apple TV and Android TV, running on your own Linux PC and driven with a controller. Your Jellyfin and Plex servers, Netflix and the other streaming sites, YouTube, live TV, music and radio, all in one place.

- **One home screen** picks up where you left off, shows what's up next, suggests things like what you've watched, and lists what's popular on the services you have.
- **Search for anything** and see which of your services streams it, then open it there.
- **While watching,** one button brings up a menu that gets you home or into Settings.
- **Make it yours:** layouts that look like Netflix, a PS5 or a PS3, colours, fonts, sounds and moving backgrounds.

It's made for TVs and handhelds, especially the **Steam Deck**. Running it inside **gamescope** lets you use **FSR or NIS upscaling** for a sharper picture, if you'd like: add it to Steam as a non-Steam game (on the Deck, Game Mode already runs everything in gamescope), or start it with something like `gamescope -F fsr -- ./SOFA-King-*.AppImage`.

*It used to be called TV Overlay. The first time SOFA King starts, your settings move over from `~/.config/tv-overlay` to `~/.config/sofa-king` by themselves.*

## Download and install

1. Download **SOFA-King-….AppImage** from the [newest release](https://github.com/hylianux/sofa-king/releases/latest).
2. Make it runnable: right-click it → Properties → Permissions → *Is executable* (or `chmod +x SOFA-King-*.AppImage`).
3. Start it.

It runs on any recent 64-bit Linux without installing anything else, apart from **mpv** for films, shows and music:

```bash
sudo pacman -S mpv      # Arch, CachyOS, Manjaro
sudo apt install mpv    # Debian, Ubuntu, Mint
sudo dnf install mpv    # Fedora
```

To have it in your apps menu, [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher adds it for you. After that, it **updates itself**: when there's a new version, it tells you when it starts and takes you to the Update button. More in [Installing and updating](docs/install.md).

## Building it yourself

You need Node.js 20 or newer and git.

```bash
git clone https://github.com/hylianux/sofa-king.git
cd sofa-king
npm install      # also downloads castLabs Electron (Electron with Widevine, for Netflix and the like), ~120 MB
npm run dev      # in a window, for trying things
npm start        # full screen, as on a TV
npm run dist     # builds the AppImage, in dist/
```

The code's layout, the tests and how releases are made are in [For developers](docs/developers.md).

## Learn more

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Setting up search (a free TMDB key), getting around, the controls, and Settings |
| [Watching](docs/watching.md) | How search works, using streaming websites with a controller, Watchmode and Trakt |
| [Your servers](docs/your-servers.md) | Jellyfin, Plex, and playing in mpv |
| [Live TV](docs/live-tv.md) | Channel lists, guides, and Live TV from Jellyfin |
| [Music and radio](docs/music.md) | Artists and albums, your music servers, Last.fm scrobbling, internet radio |
| [YouTube](docs/youtube.md) | YouTube for TV, VacuumTube, and the ad, SponsorBlock and dislike extras |
| [Typing](docs/typing.md) | The on-screen keyboard, suggestions, and typing on your phone |
| [Themes](docs/themes.md) | Layouts, moods, colours, fonts, sounds, effects and backgrounds ([making your own](themes/README.md)) |
| [Tips and troubleshooting](docs/tips.md) | Steam, TV remotes, video quality, and the log |
| [For developers](docs/developers.md) | Running from source, the files, and making a release |

## Still to come

- "Pick for me": something to watch, chosen for you.
- Noticing when a service has signed you out, and signing in to services from your phone.

## About AI

Yes, this was made with AI, but as it's free, I don't see how it benefits me to go to the extra trouble of coding everything by hand. The added marketing of organic gluten-free zero-carb no saturated fats sugar-free app might help it sell, but nobody's making any money here anyway, so let's just enjoy a product that WORKS, and that I can produce rapid updates for.

If the fact that it was created with AI still bothers you, let me close with: This app was <ins>**created**</ins> out of spite for "TV OS's", <ins>**coded**</ins> out of spite for the anti-ai group, and I hope all users <ins>**use**</ins> it out of spite for both. Enjoy!

## Licence

SOFA King is free software: you can share it and change it under the terms of the **GNU General Public License, version 3 or (at your option) any later version**. See [`LICENSE`](LICENSE). It comes with no warranty.

Parts made by others keep their own licences: Tone.js and qrcode (MIT), the recorded instruments from the Fluid R3 GM sound font (CC BY 3.0, credited in `themes/instruments/CREDITS.md`), and the fonts in `themes/fonts/` (SIL Open Font License or Apache 2.0, each with its licence beside it), and the word list in `data/words-en.txt` (the commonest words in film and TV subtitles, from Hermit Dave's [FrequencyWords](https://github.com/hermitdave/FrequencyWords), CC BY-SA 4.0; swear words taken out). Removing ads from YouTube's TV page follows how [VacuumTube](https://github.com/shy1132/VacuumTube) (MIT) does it.
