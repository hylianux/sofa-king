# Themes: the look, sound and feel

Everything about how the app looks and sounds is in **Settings → Look**. Going down the menu on the left:

| In Settings → Look | What it does |
|---|---|
| **Layout** | How Home is arranged, and how you move around it. Big view (Netflix-style) is the default. Any layout goes with any look. |
| **Mood** | A ready-made look: Classic, Valentine, Playtime, Horror, Halloween, Christmas, Heavy metal, Country, Gamer, Artist, Glam and more. Choosing one sets everything below in one go. |
| **Saved themes** | Ten squares for looks of your own, each with a small picture of how it looks. Choose an empty square to save the look you're using there. When all ten are used, saving asks which one to replace (B keeps them all). |
| **Your theme** | Says what you're using. As soon as you change any part below, it becomes **Custom**: **Save as a theme** puts it in a free square, and **Delete this theme** removes a saved one. |
| **Colours**, **Highlight colour** | The colour scheme, and an optional highlight colour to put on it. |
| **Heading font**, **Text font** | One font for titles, one for everything else. |
| **Sounds** | The sound pack. Selecting one plays a sample. |
| **Instrument** | Plays the pack's notes on something else: made on the fly (chime, marimba, pluck, organ, 8-bit, soft, plucked string), synths (FM bell, electric piano, dreamy lead, drums) or recorded (piano, music box, celesta, marimba, vibraphone, harp, kalimba, overdriven and distortion guitar). |
| **Sound effects** | Bitcrush, chorus, phaser and echo on every sound, as many at once as you like. |
| **Background** | A moving picture behind every screen: PS3 wave, blurry lights, aurora, flowing colours, starfield or particles. One at a time, or None. |
| **Effects** | Extra touches over every screen: snow, rain, film grain, scanlines, sparkles, falling leaves and more. Each has its own switch, and you can have several on at once (snow and film grain, say). |
| **Make your own** | Where your own pieces go, and **Look for new themes**, which picks up anything you've added or changed. You don't need to restart. **Convert other sound formats** turns AIFF, WMA, APE, CAF, WavPack and Apple Lossless files into ones the app can play, using ffmpeg if it's installed. |

The preview on the right shows whatever you've highlighted, before you choose it.

When **Settings → General → Screen → Animations** is off (or your computer is set to reduce motion), backgrounds and effects hold still.

## Pieces and moods

A look is made of pieces, and each kind of piece has a folder:

| Piece | Folder | What's in it |
|---|---|---|
| Colour scheme | `colorschemes/` | one `<id>.json` file |
| Font | `fonts/<id>/` | `font.json` and the font files |
| Sound pack | `soundpacks/<id>/` | `sound.json`, plus any recordings it uses |
| Recorded instrument | `instruments/<id>/` | `instrument.json` and a recording of each note |
| Effect | `effects/<id>/` | `effect.json` and `effect.css` |
| Background | `backgrounds/<id>/` | `background.json` and `background.css` |
| Layout | `layouts/<id>/` | `layout.json` and `layout.css` |

A **mood** (`moods/<id>/mood.json`) is a set of pieces with a name: it names one colour scheme, two fonts, a sound pack, any effects and a background. Your **saved themes** are moods too, kept in `saved/saved-1` to `saved/saved-10`, each with a `preview.png`.

## Where your own go

The built-in pieces are inside the app, in `themes/`. Yours go in your own themes folder, which **Settings → Look → Make your own** names. On Linux it's `~/.config/sofa-king/themes/`. It has the same folders as above, and also:

- `README.md`: this guide.
- `templates/`: a starting point for each kind of piece. Copy one into the matching folder, rename it, and change it. (The app keeps the templates up to date, so don't edit them in place.)
- `saved/`: your saved themes.

After adding or changing anything, choose **Look for new themes**. Things you made are marked "Yours" (or with the author's name) in Settings.

An **id** is the folder or file name. An id uses lower-case letters, numbers and dashes, like `spooky-nights` or `apple-tv`. If yours has the same id as a built-in one, "-yours" is added to it rather than replacing the built-in one.

If something can't be read, it's skipped, and the reason is written to the app's log (switch on Settings → Developer → Debug logging).

## Making a mood

The easy way: set everything up in Settings → Look, then save it as one of your themes. To share it, or to have more than ten, copy its folder from `saved/` into `moods/` and give it a new id.

By hand: copy `templates/my-mood/` into `moods/` and rename the folder to your id.

```json
{
  "name": "My mood",
  "description": "One sentence about the feel.",
  "author": "Your name",
  "order": 50,
  "colors": "midnight",
  "accent": "#ff5c8a",
  "fonts": { "display": "creepster", "text": "nunito" },
  "sounds": "haunted",
  "instrument": "",
  "soundFx": [],
  "effects": ["mist", "film-grain"],
  "background": "aurora"
}
```

- `colors`, `fonts`, `sounds`, `effects` and `background` name pieces by their ids. They can be built-in ones or yours. To find an id, look at the folder names in `themes/` in the app, or in yours.
- `accent` (optional) is a highlight colour that replaces the scheme's own.
- `instrument` (optional) plays the sound pack's notes on another instrument: `chime`, `marimba`, `pluck`, `organ`, `retro`, `soft`, `string`, `bell`, `e-piano`, `duo`, `drums`, or the id of a recorded one (`piano`, `harp`... or yours).
- `soundFx` (optional) is a list of effects on every sound: `bitcrush`, `chorus`, `phaser` and `delay` (echo).
- `effects` is a list (up to 8), and `background` is one id, or `""` for none.
- `order` sets where it appears in the list (the built-in moods use 1 to 20).

Themes made for older versions of the app (a `themes/` folder with `theme.json` and `effects.css`) still work. The app renames the folder to `moods/` the first time it runs, and an old `effects.css` becomes an effect of its own called "Extras".

## Making an effect

Copy `templates/my-effect/` into `effects/` and rename the folder to your id. In `effect.css`, change every `my-effect` to your id.

The app gives each effect that's switched on a full-screen box, `.fx-<id>`, over every screen. Draw on the box and on its `::before` and `::after`. Nothing you draw can be clicked or get in the way.

```css
.fx-my-effect::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: -300px;
  background-image: radial-gradient(3px 3px at 60px 80px, rgba(var(--accent-rgb), 0.6), transparent);
  background-size: 300px 300px;
  animation: my-effect-rise 30s linear infinite;
}
@keyframes my-effect-rise { to { transform: translateY(-300px); } }
```

While an effect is on, the page also has the class `with-<id>`, so an effect can change how things look. The built-in Rounder corners does only that: `body.with-rounder .card .poster { border-radius: 22px; }`.

## Making a background

Copy `templates/my-background/` into `backgrounds/` and rename the folder to your id. In `background.css`, change every `my-background` to your id.

The chosen background gets a full-screen box, `.bg-<id>`, behind every screen. Draw on it and on its `::before` and `::after`. Usually the box itself gets a colour or gradient that fills the screen, and the other two layers move. Keep it dim and slow, so text stays easy to read on top of it.

## Seamless loops, and keeping it light

Effects and backgrounds run all the time, so:

- **Loop without a jump.** Make the last frame the same as the first. Either slide a repeating picture by exactly one repeat (its `background-size`), go to and fro with `animation-direction: alternate`, or use keyframes that end where they started (`0%` and `100%` the same). The built-in snow, rain and starfield slide repeating pictures; aurora and mist go to and fro; blurry lights go round in a loop.
- **Move things with `transform` and `opacity` only.** The graphics card can move a layer around almost for free, but changing a gradient, a `background-position` or a blur on every frame makes it redraw the whole screen.
- **No `filter: blur()`.** Soft-edged `radial-gradient`s look the same and cost nothing.
- **Add `will-change: transform`** to a layer that moves the whole time.

## Making a sound pack

Copy `templates/my-sounds/` (notes made on the fly) or `templates/my-sounds-from-files/` (your own recordings) into `soundpacks/`, and rename the folder to your id. You can mix the two in one pack.

**Notes, made on the fly.** Each event is a list of notes:

```json
"select": [
  { "w": "square", "f": "D6", "d": 0.06, "v": 0.03 },
  { "w": "square", "f": "G6", "at": 0.06, "d": 0.09, "v": 0.03 }
]
```

| Field | Meaning |
|---|---|
| `f` | pitch: a note name (`"A4"`, `"C#5"`, `"Eb3"`) or Hz (`440`) |
| `to` | glide to this pitch over the note |
| `w` | `sine` (default), `triangle`, `square`, `sawtooth`, or `noise` (static, shakers, swishes; `f` then sets how bright it is) |
| `at` | when it starts, in seconds after the event (for chords and runs) |
| `d` | how long it lasts, in seconds (default 0.06) |
| `v` | volume, 0 to 0.5. Keep it around 0.02 to 0.08. |
| `a` | attack: seconds to fade in (default 0.006; larger is softer) |
| `lp`, `lpTo`, `hp`, `q` | low-pass (can sweep from `lp` to `lpTo`) and high-pass filters, in Hz |
| `det` | adds a second voice this many cents off, for a thicker, chorus-like sound |
| `vib` | vibrato: `[speed per second, depth in Hz]` |
| `trem` | tremolo: `[speed per second, depth from 0 to 1]` |
| `drive` | distortion, 0 to 1 |

The pack as a whole can have `"reverb": { "mix": 0.3, "time": 1.5, "dark": 0.4 }`, which gives the room an echo, and `"volume"`.

**Recordings.** An event can name an audio file in the same folder (`"select": "select.wav"`): WAV, MP3, OGG, Opus, FLAC, AAC, M4A or WebM, up to 2 MB each. AIFF, WMA, APE, CAF, WavPack and Apple Lossless work too, if ffmpeg is installed (see **Convert other sound formats** above): the app converts each once and keeps the copy in `audio-cache/` in its settings folder. Keep them short. Recordings are turned down to match the made-up sounds; use `"volume"` (up to 2) if yours come out too quiet.

**Events:**

| Event | When it plays |
|---|---|
| `move` | moving around |
| `select` | choosing something |
| `back` | going back |
| `edge` | you can't go any further that way |
| `open` / `close` | the menu |
| `type` | a key on the on-screen keyboard |
| `screen` | arriving at a new screen or view |

Any event you leave out uses Classic's sound.

Only use sounds you have the right to share. Your own recordings, sounds you've made, and sounds under a free licence are all fine. Rips from games or films aren't, if you'll share the pack. A pack can imitate a style (simple console beeps, say) without copying anyone's recordings.

## Adding a recorded instrument

Copy `templates/my-instrument/` into `instruments/`, rename the folder to your id, and add a recording of each note you have:

```json
{
  "name": "My instrument",
  "description": "One sentence about how it sounds.",
  "author": "Who recorded it",
  "license": "CC0-1.0",
  "ring": 1.2,
  "volume": 1,
  "notes": { "C3": "C3.ogg", "C4": "C4.ogg", "C5": "C5.ogg", "C6": "C6.ogg" }
}
```

- `notes` maps note names (`"C4"`, `"F#5"`, `"Bb3"`) to files in the same folder, the same formats as sound packs, up to 2 MB each and up to 48 notes. Any note in between plays the nearest recording, pitched up or down, so one or two notes per octave is plenty.
- Each recording should start straight away, with no silence before the note.
- `ring` is how long (in seconds, up to 4) a note may ring before it fades out. `volume` (up to 2) evens it out with the other instruments.
- The built-in recorded instruments come from the Fluid R3 GM sound font (Creative Commons Attribution 3.0); `instruments/CREDITS.md` has the details.

## Adding a font

Copy `templates/my-font/` into `fonts/`, rename the folder to your id, add the font files, and list them by weight:

```json
{ "name": "My font", "family": "My Font", "files": { "400": "my-font-regular.woff2", "700": "my-font-bold.woff2" }, "scale": 100, "license": "OFL-1.1" }
```

- WOFF2, WOFF, TTF or OTF, up to 2 MB each.
- `scale` (50 to 200) makes a font that looks small or large sit at the same size as the others. VT323, for example, uses 135.
- Fonts are built into the pages, so nothing is downloaded while the app runs.
- Only add fonts you're allowed to share. Google Fonts and Fontsource are all free to use; the built-in fonts are under the SIL Open Font License or Apache 2.0, with each licence in its folder.

## Making a colour scheme

Copy `templates/my-colors.json` into `colorschemes/`, rename it to your id (`colorschemes/my-colors.json`, say), and change the name, description, author and colours.

Each colour is a hex value: `#rgb` or `#rrggbb`. Any you leave out come from Midnight.

| Colour | Used for |
|---|---|
| `bg` | The background of every screen |
| `surface` | Panels, cards before their picture loads, buttons |
| `surface2` | Raised parts on top of panels: keys, badges, the controls strip |
| `line` | Dividers and empty progress steps |
| `text` | Main text. Its see-through shades also give borders and hover tints, so a dark `text` gives dark borders. |
| `textSoft` | Descriptions and secondary text |
| `muted` | Labels and small print |
| `faint` | The quietest text: addresses, placeholders |
| `focus` | The background of whatever is selected (white in Midnight) |
| `onFocus` | Text on a selected item: it must be readable on `focus` |
| `onFocusSoft` | Secondary text on a selected item |
| `accent` | Highlights: the chosen option, links, your own pieces' labels |
| `gold` | Ratings and stars |
| `good` | "On", "installed", "working" |
| `bad` | Errors and Quit |
| `glow1`, `glow2` | The two soft glows in the corners of the background (several backgrounds use them too). Set them to `bg` to turn them off. |

For a light scheme, add `"light": true`. That makes scrollbars and form controls light too.

Make sure `text` on `bg` and `onFocus` on `focus` are easy to read from across a room. High contrast is a good reference.

## Using the colours in CSS

Layouts, effects and backgrounds should use the scheme's colours rather than fixed ones, so they suit every scheme:

- `var(--bg)`, `var(--bg-raised)`, `var(--surface-2)`, `var(--glow-1)`, `var(--glow-2)`
- `var(--text)`, `var(--text-soft)`, `var(--muted)`
- `var(--focus)`, `var(--on-focus)`, `var(--accent)`, `var(--gold)`
- for see-through shades: `rgba(var(--ink), 0.1)` (the text colour), `rgba(var(--bg-rgb), 0.8)`, `rgba(var(--accent-rgb), 0.3)`, `rgba(var(--gold-rgb), 0.3)` and `rgba(var(--good-rgb), 0.3)`

And `var(--font-display)` / `var(--font-text)` for the fonts.

## Making a layout

1. Copy `templates/my-layout/` into `layouts/`, and rename the folder to your id.
2. In `layout.css`, change every `body.layout-my-layout` to `body.layout-<your id>`.
3. Edit `layout.json` (described below) and `layout.css`.

### layout.json

```json
{
  "name": "My layout",
  "description": "One sentence about what it looks like and how you move around it.",
  "author": "Your name",
  "order": 50,
  "colors": "",
  "behavior": { "...": "see below" }
}
```

- `order` sets where your layout appears in the list (built-in layouts use 1 to 6).
- `colors` is optional: it names a colour scheme that suits the layout. Settings marks that scheme "goes with this layout", but doesn't switch to it.
- `behavior` covers the things CSS can't do. Leave any of them out to use the default.

| Behaviour | Default | What it does |
|---|---|---|
| `featured` | `false` | Fills the big panel (`#hero`) with the selected title: its picture, name, score, overview and where to watch it. Your CSS decides where the panel goes and how it looks. |
| `widenSelected` | `false` | Turns the selected card into a wide picture (`.card.wide`) and moves it to the front of its row. |
| `rowKeys` | `"free"` | How to move between rows. `"free"` goes to whatever is nearest. `"up-down"` goes straight to the row above or below, landing where you last were in it. `"left-right"` is the same, sideways (for a layout where rows are side by side, like the PS3 cross bar). |
| `oneRowAtATime` | `false` | Marks the current row `.active`. Your CSS hides the others, with `body.layout-x .row:not(.active) { display: none; }`. |
| `sectionBar` | `false` | Fills `#xmb-bar` with every row's name, the current one with `.on`. Your CSS shows it. |
| `widePictures` | `false` | Cards use wide 16:9 pictures instead of posters. |
| `bigCards` | `false` | Starts from the bigger card sizes of Big posters, instead of the smaller sizes of Rows. |
| `rowScroll` | `"nearest"` | When a row comes into view, `"nearest"` scrolls just enough to show it (with its title) and `"start"` scrolls it to the top. |
| `fillRows` | `0` | For rows your CSS wraps into a grid: show just enough titles to fill this many lines exactly, with More as the last tile, whatever the screen width. Titles left out get the class `.beyond`, which hides them. `0` shows every title. |
| `fillScreen` | `false` | For rows your CSS wraps into a grid: as many whole lines as fit on screen, filled exactly, with More as the last tile. If only one line of the usual size fits, the tiles shrink so there are two. |
| `maxTitles` | `0` | Show at most this many titles in each row, with More right after them (Grid uses `9`, so More is the tenth tile). Titles left out get `.beyond`. `0` shows every title. |
| `carousel` | `false` | Loop each row like a tape: the selected title stays at the left, and moving right slides the next one in; after the last title comes the first again. |
| `moreAt` | `"end"` | Where each row's More goes: `"end"` (a tile after the last title) or `"title"` (a small button at the right of the row's name: Up from the row's titles reaches it, Down goes back). |

Every layout gets the "▲ / ▼ more rows" hints at the edges of the rows, and placeholder rows while Home loads. Both use the same pieces as real rows, so your CSS shapes them too.

Your layout also appears in the preview in Settings → Look. The preview is a small copy of Home, and your CSS is applied to it as-is: `body.layout-<id>` becomes `.pv-root.layout-<id>`, `#view-home` becomes `.pv-view-home` and `#screen-home` becomes `.pv-screen`. So keep to those selectors and the classes listed below.

### layout.css

Your layout starts from **Rows**, and your CSS changes what you want. These are the parts of Home you'll want:

```
#view-home                    everything on Home under the tabs
  .searchbar                  the search box (Big view hides it and shows #hero-search instead)
  #xmb-bar                    the row names (sectionBar)
  #hero.hero                  the big panel (featured)
    img#hero-art              its picture (.shown once loaded)
    .hero-text                #hero-row, #hero-title, #hero-meta, #hero-overview, #hero-chips
  #rows.rows                  the rows, scrolling up and down
    .row  (.active)           one row: data-title has its name
      h2                      the row's name
      .row-cards              the cards, scrolling sideways
        .card  (.wide)        a title: .poster (with an img), .name, .sub
        .row-end              the More and Back buttons at the end of a row
```

The built-in layouts are worked examples. Each is a `layout.json` and a `layout.css` in `themes/layouts/`:

| Layout | Shows how to |
|---|---|
| `netflix` (Big view) | use the featured panel, widen the selected card, show one whole row at a time, and move between rows with up and down |
| `rows` | add nothing at all: it's the starting point |
| `big-posters` | use bigCards |
| `grid` (Roku / Apple TV) | wide pictures filling the screen (`fillScreen`): as many columns and lines as fit, with More as the last tile |
| `ps5` (PlayStation 5) | show one row at a time, put the picture full-screen behind everything, and change the order of things |
| `ps3-xmb` (PS3 cross bar) | use the section bar, show a row as a list going down, move with left and right, and animate the background |

## What's not allowed

Pieces can come from anyone, so the app checks everything before using it:

- Colours must be hex values.
- CSS can't load anything from the internet: `@import`, `image-set()` and any `url()` other than a `data:` one are removed. Each CSS file is limited to 200 KB. Pictures written into the CSS as `data:` (an SVG, say) are fine; the built-in rain, leaves and PS3 wave are drawn that way.
- Nothing has a script. A layout's behaviour comes only from its `layout.json` settings, and a sound pack's notes only from the fields above, each kept within sensible limits.
- Font and audio files must be font or audio files, each up to 2 MB, from the piece's own folder.

## Sharing

A colour scheme is one `.json` file. Anything else is its folder. A mood names the pieces it uses, so share your own pieces along with it.

To use something someone shared, drop it into the matching folder in your themes folder and choose **Look for new themes**.
