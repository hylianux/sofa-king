# Installing and updating

[← Back to the README](../README.md)

## Installing

1. Download **SOFA-King-….AppImage** from the [newest release](https://github.com/hylianux/sofa-king/releases/latest).
2. Make it runnable: right-click it → Properties → Permissions → *Is executable* (or `chmod +x SOFA-King-*.AppImage`).
3. Start it.

It runs on any recent 64-bit Linux. The only other thing you need is **mpv**, for films, shows and music (`sudo pacman -S mpv`, `sudo apt install mpv` or `sudo dnf install mpv`).

To have it in your apps menu, [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher adds it for you.

The first time it starts, Widevine (what Netflix and the like need) downloads in the background.

## Adding it to Steam (and the Steam Deck)

On the Steam Deck, do this in **Desktop Mode** (Steam's artwork options are only in its desktop window).

1. In Steam: **Games → Add a Non-Steam Game to My Library → Browse**, pick the AppImage, then **Add Selected Programs**.
2. Right-click it in your library → **Properties** → **Controller**: set it to **Disable Steam Input**. Otherwise Steam keeps the controller to itself and the app can't see it.

**Its pictures.** Steam shows a plain grey tile for non-Steam games. Ready-made pictures are in the [build/steam](https://github.com/hylianux/sofa-king/tree/main/build/steam) folder (open each and use *Download raw file*):

| Picture | Where Steam shows it | How to set it |
|---|---|---|
| `library-600x900.png` | The tall tile in your library | Right-click the game in the library's grid → **Manage → Set custom artwork** |
| `wide-920x430.png` | The wide tile in *Recent games* | Right-click its tile in *Recent games* → **Manage → Set custom artwork** |
| `hero-3840x1240.png` | The banner on the game's page | On the game's page, right-click the banner → **Set custom background** |
| `logo-1280x400.png` | The name over that banner | Right-click the banner again → **Set custom logo** |
| `icon-256.png` | The small icon in lists | **Properties**, then click the empty square next to the name |

There's no need to send them to SteamGridDB for yourself. (If the Decky *SteamGridDB* plugin is how you'd rather do it, those pictures are only there once someone uploads them.)

## Updates

The app updates itself. Each time it starts, it checks for a newer version. When there is one, it says so, with what's new: **Show me** takes you to the Update button in **Settings → General → Updates**.

**Update** downloads it in the background, checks it isn't damaged, and swaps it in, under the same name. **Restart now** switches to it straight away; otherwise it's used next time you start.

- **Look for updates by itself** switches the checking off.
- **Include test versions** also offers versions still being tested (like 0.2.0-beta.1).
- Checking sends nothing about you or what you watch.
