# Watching: services, search and websites

[← Back to the README](../README.md)

## Search and title pages

Results update as you type: films, shows and people. Pick a person to see what else they're in.

A title's page shows where you can watch it:

- **Your servers** first, then **Watch on**: the services you have that stream it. Each says **Included**, **Free** or **Free with ads**. An outlined button means your service only rents or sells it.
- Other services and stores are listed underneath, and **Also available** lists everywhere else.
- **Not listed? Search your free services** tries Tubi, Pluto TV, The Roku Channel and the rest anyway, since the listings for free services are often incomplete.
- **Find it on YouTube** searches YouTube for the title.

Pressing a service opens its own search for the title. Which services you have is set in `services.json`.

## Using websites with a controller

- **D-pad:** moves between links and buttons, with a thick outline on what's selected.
- **Right stick:** a mouse pointer, for anything the D-pad can't reach. R2 clicks, L2 right-clicks. Press the D-pad and the pointer hides again.
- **R1 / L1:** scroll.
- **Select:** leave a video's full screen.
- **Start:** the menu (home, Settings, reload, quit).

A small bar at the bottom lists these controls. It hides while a video plays; turn it off in Settings → Controller.

## More free services: Watchmode (optional)

The listings often miss titles on Tubi, Pluto TV and other free services. A free Watchmode key fills those gaps, and some buttons then open the title itself instead of a search. **Settings → General → More free services** walks you through getting one. The free plan is plenty for normal use; Settings shows how much you've used.

## Trakt (optional)

Trakt keeps track of what you watch, wherever you watch it, and suggests what's next. **Settings → General → Trakt → Set up Trakt** guides you through it in three steps: an account, a "developer app" on your account (Trakt requires one, and asks you to connect a free GitHub account first), then signing in with a code.

Once it's connected, Home gets **Your Trakt watchlist** and **Recommended for you**, and title pages get **Add to watchlist**. **Tell Trakt what I watch in mpv** is off by default. Leave it off if Jellyfin's Trakt plugin already does this, or plays count twice.

Free Trakt accounts can have one connected app at a time.
