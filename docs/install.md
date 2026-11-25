# Installing and updating

[← Back to the README](../README.md)

## Installing

1. Download **SOFA-King-….AppImage** from the [newest release](https://github.com/hylianux/sofa-king/releases/latest).
2. Make it runnable: right-click it → Properties → Permissions → *Is executable* (or `chmod +x SOFA-King-*.AppImage`).
3. Start it.

It runs on any recent 64-bit Linux. The only other thing you need is **mpv**, for films, shows and music (`sudo pacman -S mpv`, `sudo apt install mpv` or `sudo dnf install mpv`).

To have it in your apps menu, [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher adds it for you.

The first time it starts, Widevine (what Netflix and the like need) downloads in the background.

## Updates

The app updates itself. Each time it starts, it checks for a newer version. When there is one, it says so, with what's new: **Show me** takes you to the Update button in **Settings → General → Updates**.

**Update** downloads it in the background, checks it isn't damaged, and swaps it in, under the same name. **Restart now** switches to it straight away; otherwise it's used next time you start.

- **Look for updates by itself** switches the checking off.
- **Include test versions** also offers versions still being tested (like 0.2.0-beta.1).
- Checking sends nothing about you or what you watch.
