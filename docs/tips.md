# Tips and troubleshooting

[← Back to the README](../README.md)

## Tips

- **Steam / Steam Deck:** as a non-Steam game, Steam Input can hide the controller from the app. Turn Steam Input off for it. [Adding it to Steam](install.md#adding-it-to-steam-and-the-steam-deck) has the steps, and pictures for its library tile, banner, logo and icon.
- **Sharper picture (FSR / NIS):** run the app inside gamescope, which can upscale with FSR or NIS. The Steam Deck's Game Mode already uses gamescope; on a desktop, try `gamescope -F fsr -- ./SOFA-King-*.AppImage` (or `-F nis`).
- **TV remotes:** a Flirc USB receiver (or a CEC adapter) can turn remote buttons into arrow keys, Enter, Escape and F10.
- **Video quality:** on Linux, Netflix and the like play at about 720p–1080p. That's a limit set by the services, not the app.
- **Your services:** `services.json` lists the streaming services you use, including free ones. Remove the ones you don't have.
- **Pausing for the menu:** the menu leaves your video playing. *Pause the video while the menu is open* (Settings → Controller) changes that.

## The log

If something goes wrong, the log helps. It's at `~/.config/sofa-king/logs/sofa-king.log`, and passwords, keys and sign-ins are always hidden in it.

**Settings → Developer:**

- **Debug logging** adds much more detail. With it on, when a website's video won't play (Hulu's "Error playing video", say), the log also says why: what the site's player complained about, what the copy protection on this computer can do, and how the site's licence server answered. Switch it on *before* opening the website.
- **Get the log on my phone** shows a code to scan, which downloads the log as a text file.
- **Clear the log** empties it.
