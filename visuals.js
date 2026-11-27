'use strict';

// Pictures for music and radio in mpv: the album cover (or the station's logo) and visualisers
// that move with the sound. Each is an ffmpeg filter graph that mpv runs as its "lavfi-complex":
// the sound goes in, comes out untouched for your speakers, and a copy becomes the picture. They
// can be switched while the music plays without it stopping. All draw on a 1280×720 picture
// (mpv scales it to the screen), 30 times a second.

// The visualisers draw at a quarter of 1280×720 (mpv's graphics card scales it up for nothing),
// which keeps them light enough for a Steam Deck: glows and blends cost by the pixel.
const W = 640;
const H = 360;
const FPS = 30;

// A cover picture, as a filter source. Only safe paths are used (no characters the filter
// graph would read as its own), so a strange file name can't change the graph.
const pathOk = (p) => typeof p === 'string' && /^[A-Za-z0-9/._-]+$/.test(p);
const cover = (p) => `movie=${p}`;

// What's behind the visualisers: the cover blurred to fill the screen and dimmed, or, without a
// cover, a dark wash of colour. (Made once: it doesn't move.)
const backdrop = (p, dim = 0.45) => (pathOk(p)
  ? `${cover(p)},scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},gblur=sigma=10,scale=${W}:${H}:flags=bicubic,eq=saturation=1.3,format=gbrp,colorchannelmixer=rr=${1 - dim}:gg=${1 - dim}:bb=${1 - dim}`
  : `gradients=s=${W}x${H}:d=0.1:c0=0x2a1650:c1=0x0b3048:c2=0x3a1238:nb_colors=3:type=radial:x0=100:y0=60:x1=560:y1=320,format=gbrp,colorchannelmixer=rr=${1.3 - dim}:gg=${1.3 - dim}:bb=${1.3 - dim}`);
// Lay the moving picture [in] over the backdrop with "screen" (dark parts let it show through).
// (Blended as red, green and blue: blending the colour channels of yuv tints everything purple.)
const overBackdrop = (inp, p, dim, out) => [`${backdrop(p, dim)}[bg]`, `[${inp}]format=gbrp[fg]`, `[fg][bg]blend=all_mode=screen:shortest=0:repeatlast=1,format=yuv420p[${out}]`];
// A soft glow round bright lines: a blurred copy, made small (cheap) and laid back on top.
const glow = (inp, out, sigma = 3, w = W, h = H) => [`[${inp}]format=gbrp,split[g1][g2]`, `[g2]scale=${w / 2}:${h / 2},gblur=sigma=${sigma},scale=${w}:${h}[g3]`, `[g1][g3]blend=all_mode=screen[${out}]`];

// [a] is a copy of the sound; each visualiser turns it into [vo].
const VISUALS = [
  {
    // The cover, big and sharp, over a blurred copy of itself, with soft light rising from the
    // bottom. (Drawn full size, so the cover stays crisp.)
    id: 'cover', name: 'Album art',
    graph: (p) => [
      `[a]showcqt=s=${W}x${H}:r=${FPS}:axis=0:sono_h=0:bar_g=2:bar_t=0.6:bar_v=10,colorchannelmixer=rr=0.5:gg=0.5:bb=0.5[bars]`,
      ...overBackdrop('bars', p, 0.55, 'back'),
      ...(pathOk(p)
        ? ['[back]scale=1280:720:flags=fast_bilinear[big]', `${cover(p)},scale=440:440:force_original_aspect_ratio=decrease[c]`, '[big][c]overlay=x=150+(440-w)/2:y=(720-h)/2:repeatlast=1[vo]']
        : ['[back]null[vo]']),
    ],
  },
  {
    // Bars of light across the screen, mirrored in a glossy floor.
    id: 'bars', name: 'Light bars',
    graph: (p) => [
      `[a]showcqt=s=${W}x220:r=${FPS}:axis=0:sono_h=0:bar_g=2.2:bar_t=0.4:bar_v=14:basefreq=30:endfreq=12000,lagfun=decay=0.9,split[top][r]`,
      `[r]vflip,crop=${W}:140:0:0,colorchannelmixer=rr=0.3:gg=0.3:bb=0.3,boxblur=2[floor]`,
      '[top][floor]vstack[vis]',
      ...overBackdrop('vis', p, 0.75, 'vo'),
    ],
  },
  {
    // A piano-roll waterfall: notes fall down the screen as they're played, bars above.
    id: 'waterfall', name: 'Waterfall',
    graph: () => [`[a]showcqt=s=1280x720:r=${FPS}:axis=0:bar_h=240:sono_g=3.5:sono_v=14:bar_g=2:basefreq=30:endfreq=12000,format=yuv420p[vo]`],
  },
  {
    // A laser drawing the left and right channels against each other, leaving glowing trails,
    // slowly changing colour.
    id: 'laser', name: 'Laser',
    graph: (p) => [
      `[a]avectorscope=s=${H}x${H}:r=${FPS}:m=lissajous_xy:draw=aaline:scale=sqrt:zoom=0.9:rc=200:gc=70:bc=230:ac=255:rf=70:gf=70:bf=70:af=70,hue=h=t*12:s=1.4,pad=${W}:${H}:${(W - H) / 2}:0[l]`,
      ...glow('l', 'vis', 4),
      ...overBackdrop('vis', p, 0.75, 'vo'),
    ],
  },
  {
    // The sound wave itself, glowing, its colour drifting.
    id: 'waves', name: 'Waves',
    graph: (p) => [
      `[a]aformat=channel_layouts=mono,showwaves=s=${W}x${H}:r=${FPS}:mode=p2p:scale=lin:draw=full:colors=0x55ccff,lagfun=decay=0.75,hue=h=t*15[w]`,
      ...glow('w', 'vis', 3),
      ...overBackdrop('vis', p, 0.75, 'vo'),
    ],
  },
  {
    // The laser's picture, slowly turning, folded four ways like a kaleidoscope.
    id: 'kaleidoscope', name: 'Kaleidoscope',
    graph: () => [
      `[a]avectorscope=s=${W}x${H}:r=${FPS}:m=lissajous:draw=aaline:scale=sqrt:zoom=1.6:rc=255:gc=140:bc=60:ac=255:rf=45:gf=45:bf=45:af=45,hue=h=t*20:s=1.5,format=gbrp,rotate=a=t*0.2:c=black,crop=${W / 2}:${H / 2}:0:0,split[k1][k2]`,
      '[k2]hflip[k2f]', '[k1][k2f]hstack,split[t1][t2]', '[t2]vflip[t3]', '[t1][t3]vstack[k]',
      ...glow('k', 'kg', 3),
      '[kg]format=yuv420p[vo]',
    ],
  },
  {
    // Sound as heat: a spectrogram scrolling sideways in fiery colours.
    id: 'spectrum', name: 'Spectrogram',
    graph: () => [`[a]showspectrum=s=320x${H}:slide=scroll:mode=combined:color=nebulae:scale=cbrt:fscale=log:legend=0,scale=${W}:${H},fps=${FPS},format=yuv420p[vo]`],
  },
  // No picture: black, with just the words. (Still a picture as far as mpv is concerned: on a
  // radio stream, going from no picture to one later freezes the sound, so there's always one.)
  { id: 'off', name: 'Off', graph: null },
];

const visualIds = VISUALS.map((v) => v.id);
const visualName = (id) => (VISUALS.find((v) => v.id === id) || VISUALS[0]).name;
const nextVisual = (id) => visualIds[(visualIds.indexOf(id) + 1) % visualIds.length];

// The whole lavfi-complex for a visualiser. coverPath: the cover picture on disk, or null.
function graphFor(id, coverPath) {
  const v = VISUALS.find((x) => x.id === id);
  if (!v) return '';
  if (!v.graph) return '[aid1]anull[ao];color=c=black:s=64x36:r=2[vo]';
  return ['[aid1]asplit[ao][a]', ...v.graph(pathOk(coverPath) ? coverPath : null)].join(';');
}

// Where the "now playing" words go for each: beside the big cover, or the top-left corner.
const cardSpot = (id, hasCover) => (id === 'cover' && hasCover ? 'beside' : id === 'cover' || id === 'off' ? 'middle' : 'corner');

module.exports = { VISUALS, visualIds, visualName, nextVisual, graphFor, cardSpot, pathOk };
