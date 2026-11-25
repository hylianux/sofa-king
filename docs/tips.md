# Tips and troubleshooting

[← Back to the README](../README.md)

## Tips

- **Steam / Steam Deck:** as a non-Steam game, Steam Input can hide the controller from the app. Turn Steam Input off for it.
- **TV remotes:** a Flirc USB receiver (or a CEC adapter) can turn remote buttons into arrow keys, Enter, Escape and F10.
- **Video quality:** on Linux, Netflix and the like play at about 720p–1080p. That's a limit set by the services, not the app.
- **Your services:** `services.json` lists the streaming services you use, including free ones. Remove the ones you don't have.
- **Pausing for the menu:** the menu leaves your video playing. *Pause the video while the menu is open* (Settings → Controller) changes that.

## The log

If something goes wrong, the log helps. It's at `~/.config/sofa-king/logs/sofa-king.log`, and passwords, keys and sign-ins are always hidden in it.

**Settings → Developer:**

- **Debug logging** adds much more detail.
- **Get the log on my phone** shows a code to scan, which downloads the log as a text file.
- **Clear the log** empties it.
