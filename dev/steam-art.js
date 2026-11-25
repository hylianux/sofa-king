// Makes the pictures Steam shows for a non-Steam game (library tile, wide tile, banner, logo and
// icon), into build/steam/. Run with: node_modules/.bin/electron dev/steam-art.js
// Each picture is a small page drawn here, photographed at its exact size.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'steam');
const FONT = (w) => 'file://' + path.join(ROOT, 'themes', 'fonts', 'fredoka', `fredoka-${w}.woff2`);

// The icon's picture (a sofa in front of a glowing screen), without its rounded square.
// `cards` draws rows of little posters on the screen, as on the app's home screen.
function sofa({ cards = false } = {}) {
  const rows = cards ? [0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) =>
    `<rect x="${112 + c * 60}" y="${100 + r * 50}" width="50" height="38" rx="6" fill="#fff" opacity="${r === 0 && c === 1 ? 0.55 : 0.16}"/>`).join('')).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 60 392 410">
    <defs>
      <linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#b54bd6"/></linearGradient>
      <linearGradient id="so" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#d9482b"/></linearGradient>
    </defs>
    <rect x="96" y="78" width="320" height="180" rx="22" fill="url(#scr)" opacity="0.95"/>${rows}
    <rect x="226" y="258" width="60" height="22" fill="#3a3948"/>
    <rect x="122" y="292" width="268" height="78" rx="30" fill="url(#so)"/>
    <rect x="108" y="352" width="296" height="62" rx="22" fill="#e85a3a"/>
    <rect x="76" y="318" width="70" height="112" rx="30" fill="url(#so)"/>
    <rect x="366" y="318" width="70" height="112" rx="30" fill="url(#so)"/>
    <rect x="104" y="428" width="22" height="26" rx="6" fill="#3a3948"/>
    <rect x="386" y="428" width="22" height="26" rx="6" fill="#3a3948"/>
  </svg>`;
}

const BASE = `
  @font-face { font-family: Fredoka; src: url('${FONT(700)}'); font-weight: 700; }
  @font-face { font-family: Fredoka; src: url('${FONT(400)}'); font-weight: 400; }
  html, body { margin: 0; overflow: hidden; }
  body { font-family: Fredoka, sans-serif; color: #fff; }
  .bg { position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at var(--gx, 50%) var(--gy, 35%), rgba(143,211,255,.30), transparent 45%),
      radial-gradient(ellipse at calc(var(--gx, 50%) + 12%) calc(var(--gy, 35%) + 10%), rgba(181,75,214,.32), transparent 50%),
      linear-gradient(#22212e, #0f0f15); }
  .name { font-weight: 700; line-height: .95; letter-spacing: -.01em; white-space: nowrap; }
  .name b { color: #ff8a6a; font-weight: 700; }
  .tag { font-weight: 400; opacity: .7; letter-spacing: .04em; }
  svg { display: block; filter: drop-shadow(0 0 40px rgba(181,75,214,.45)); }
`;
const NAME = '<span class="name"><b>SOFA</b> King</span>';
const TAG = 'Streaming · Open · Free · All-in-one';

// Steam's names for each picture (the file names it uses in its own grid folder, with "<id>"
// standing for the shortcut's number) are in docs/tips.md.
const PICTURES = [
  { file: 'library-600x900.png', w: 600, h: 900, html: `
    <div class="bg" style="--gy: 30%"></div>
    <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:44px">
      <div style="width:400px">${sofa({ cards: true })}</div>
      <div style="font-size:108px">${NAME}</div>
      <div class="tag" style="font-size:25px; margin-top:-22px">${TAG}</div>
    </div>` },
  { file: 'wide-920x430.png', w: 920, h: 430, html: `
    <div class="bg" style="--gx: 24%; --gy: 40%"></div>
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:48px">
      <div style="width:290px">${sofa({ cards: true })}</div>
      <div style="display:flex; flex-direction:column; gap:22px">
        <div style="font-size:100px">${NAME}</div>
        <div class="tag" style="font-size:22px">${TAG}</div>
      </div>
    </div>` },
  // The banner across the top of the game's page. Steam puts the logo over its lower left, so the
  // picture sits to the right, and there's no writing.
  { file: 'hero-3840x1240.png', w: 3840, h: 1240, html: `
    <div class="bg" style="--gx: 66%; --gy: 38%"></div>
    <div style="position:absolute; right:700px; top:120px; width:960px">${sofa({ cards: true })}</div>` },
  // Transparent, laid over the banner: the name with a soft shadow so it reads on anything.
  { file: 'logo-1280x400.png', w: 1280, h: 400, transparent: true, html: `
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:40px; filter: drop-shadow(0 6px 18px rgba(0,0,0,.6))">
      <div style="width:250px">${sofa()}</div>
      <div style="font-size:190px">${NAME}</div>
    </div>` },
];

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep going between pictures
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-art-'));
  for (const p of PICTURES) {
    const page = path.join(tmp, p.file + '.html');
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>${BASE}
      html, body { width: ${p.w}px; height: ${p.h}px; background: ${p.transparent ? 'transparent' : '#0f0f15'}; }</style>${p.html}`);
    const win = new BrowserWindow({ show: false, width: p.w, height: p.h, useContentSize: true, transparent: Boolean(p.transparent),
      frame: false, webPreferences: { offscreen: true, zoomFactor: 1 } });
    win.setContentSize(p.w, p.h);
    await win.loadFile(page);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => 0)');
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: p.w, height: p.h });
    fs.writeFileSync(path.join(OUT, p.file), img.resize({ width: p.w, height: p.h }).toPNG());
    console.log('made', p.file, img.getSize());
    win.destroy();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
});
