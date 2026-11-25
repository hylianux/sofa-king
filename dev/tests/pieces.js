require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Round 2: themes as pieces. Old folders and old themes are carried over; backgrounds and effects
// (several at once) show on Home and in the preview; saving fills the ten slots, then asks which
// one to replace.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-pieces');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
// Settings from before: a custom look based on Christmas, with its effects switched on.
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  live: { iptvOrgAsked: true },
  look: { theme: 'custom', base: 'christmas', custom: { colors: 'nord', display: 'clean', text: 'clean', sounds: 'classic', effects: true } },
}));
// A theme of your own, made the old way (themes/<id>/theme.json and effects.css).
fs.mkdirSync(path.join(UD, 'themes/themes/old-one'), { recursive: true });
fs.writeFileSync(path.join(UD, 'themes/themes/old-one/theme.json'), JSON.stringify({ name: 'Old one', colors: 'dracula', sounds: 'haunted' }));
fs.writeFileSync(path.join(UD, 'themes/themes/old-one/effects.css'), 'body.theme-old-one::after { content: ""; position: fixed; inset: 0; background: rgba(255,0,0,0.1); }');
const SHOTS = path.join(__dirname, 'out', 'shots-pieces'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'pieces.txt');
fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  let id = 1;
  const items = Array.from({ length: 14 }, (_, i) => ({ id: id++, media_type: 'movie', title: `Title ${i}`, poster_path: `/p${i}.jpg`, backdrop_path: `/b${i}.jpg`, vote_average: 7, vote_count: 100, overview: 'A story.', release_date: '2023-01-01' }));
  return new Response(JSON.stringify({ results: items, page: 1, total_pages: 1 }));
};
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    session.defaultSession.protocol.handle('https', async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#3a5f8a"/></svg>', { headers: { 'content-type': 'image/svg+xml' } }));
    await wait(4500);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(220); } };
    const shot = async (f) => fs.writeFileSync(path.join(SHOTS, `${f}.png`), (await wc.capturePage()).toPNG());
    const layers = () => js("JSON.stringify({ bg: [...document.querySelectorAll('#bg-layer > div')].map(d => d.className), fx: [...document.querySelectorAll('#fx-layer > div')].map(d => d.className), body: [...document.body.classList].filter(c => c.startsWith('with-')) })");

    say('folders:', fs.readdirSync(path.join(UD, 'themes')).sort().join(' '));
    say('old custom look carried over:', await layers());
    const list = await js('tv.themes()');
    say('moods:', list.themes.map((t) => t.id).join(' '));
    say('effects:', list.effects.map((t) => t.id).join(' '));
    say('backgrounds:', list.backgrounds.map((t) => t.id).join(' '));
    say('old-one effects:', JSON.stringify(list.themes.find((t) => t.id === 'old-one').look.effects));
    await shot('1-home-old-custom');

    // A background and two effects at once.
    await js("setPart({ background: 'aurora' })"); await wait(300);
    await js("setPart({ effect: 'snow', on: false })"); await wait(200);
    await js("setPart({ effect: 'rain', on: true })"); await wait(200);
    await js("setPart({ effect: 'film-grain', on: true })"); await wait(600);
    say('aurora + rain + grain:', await layers());
    say('a layer has a moving ::before:', await js("getComputedStyle(document.querySelector('.fx-rain'), '::before').animationName"));
    await shot('2-home-aurora-rain-grain');
    for (const b of list.backgrounds) { await js(`setPart({ background: '${b.id}' })`); await wait(900); await shot(`bg-${b.id}`); }
    await js("setPart({ effect: 'rain', on: false })"); await js("setPart({ effect: 'film-grain', on: false })");
    for (const e of list.effects) { await js(`setPart({ effect: '${e.id}', on: true })`); await wait(700); await shot(`fx-${e.id}`); await js(`setPart({ effect: '${e.id}', on: false })`); }
    await js("setPart({ background: 'ps3-wave' })"); await js("setPart({ effect: 'snow', on: true })"); await wait(300);

    // Settings → Look, and the preview showing a highlighted background and effect.
    await js("openSettings({ tab: 'look' })"); await wait(800);
    say('look rails:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
    await js("document.querySelector('#s-backgrounds [data-background=\"starfield\"]').focus()"); await wait(500);
    say('preview on starfield:', await js("pv.label.textContent + ' | ' + [...pv.bg.children].map(d=>d.className)"));
    await shot('3-preview-starfield');
    await js("document.querySelector('#s-effects [data-effect=\"confetti\"]').focus()"); await wait(500);
    say('preview on confetti:', await js("pv.label.textContent + ' | ' + [...pv.fx.children].map(d=>d.className)"));
    await shot('4-preview-confetti');
    await js("document.querySelector('#s-saved [data-slot=\"1\"]').focus()"); await wait(400);
    await shot('5-saved-empty');

    // Save into the first slot (typing the name the way the keyboard would hand it back).
    say('preview frame:', await js("JSON.stringify(document.querySelector('.pv-frame').getBoundingClientRect()) + ' shown: ' + Boolean(document.querySelector('.pv-frame').offsetParent)"));
    js('saveTheme(); 0'); await wait(600);
    say('asking for a name:', await js('screen'));
    await js("finishAsk('Snowy waves'); 0"); await wait(1500);
    const after = await js('tv.themes()');
    say('slot 1:', JSON.stringify(after.saved[0] && { id: after.saved[0].id, name: after.saved[0].name, effects: after.saved[0].look.effects, background: after.saved[0].look.background, picture: after.saved[0].preview.length }));
    say('on disk:', fs.readdirSync(path.join(UD, 'themes/saved/saved-1')).join(' '));
    say('in use:', await js('lookNow.theme'), '| focus:', await js('document.activeElement.dataset.slot'));
    await shot('6-saved-one');

    // Fill the rest, then saving asks which to replace; B keeps them all.
    for (let n = 2; n <= 10; n++) await js(`tv.saveLook('Theme ${n}', ${n}, null); 0`);
    await js('tv.themes().then(t => { themeList = t; renderThemes(); }); 0'); await wait(500);
    await js("setPart({ colors: 'gruvbox' })"); await wait(300);
    js('saveTheme(); 0'); await wait(600);
    say('all ten used:', await js('screen'), '| focus on slot', await js('document.activeElement.dataset.slot'));
    await key('Right', 2); await key('Down');
    say('moved to slot', await js('document.activeElement.dataset.slot'));
    await shot('7-replace-which');
    await js("document.dispatchEvent(new Event('tvback', { cancelable: true }))"); await wait(500);
    say('B: back on', await js('screen'), '| focus', await js('document.activeElement.id || document.activeElement.className'));
    // Replace slot 4.
    js('saveTheme(); 0'); await wait(600);
    await js("document.querySelector('#slots-grid [data-slot=\"4\"]').click(); 0"); await wait(600);
    say('then asks:', await js('screen'), '|', await js("document.getElementById('ask-eyebrow').textContent"));
    await js("finishAsk('Gruvbox night'); 0"); await wait(1500);
    say('slot 4 now:', (await js('tv.themes()')).saved[3].name);

    // Delete it again.
    await js("document.getElementById('s-look-delete').click(); 0"); await wait(800);
    say('after delete, slot 4:', JSON.stringify((await js('tv.themes()')).saved[3]), '| in use:', await js('lookNow.theme'));

    // Fewer animations: everything holds still.
    await js("document.body.classList.add('less-motion')"); await wait(300);
    say('less motion, snow playing:', await js("getComputedStyle(document.querySelector('.fx-snow'), '::before').animationIterationCount"));
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
