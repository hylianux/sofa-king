require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Round 3: YouTube for people without VacuumTube. YouTube's TV page opened here, with every extra on:
// ads taken out, SponsorBlock, Return YouTube Dislike, DeArrow; the controller (B steps back);
// "Find it on YouTube"; the YouTube Music button (an album found and played); Settings → YouTube.
// Needs the internet. VacuumTube is told to be "the TV page here" so the test never opens it.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-youtube');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  live: { iptvOrgAsked: true }, layout: 'netflix', debugLog: true,
  youtube: { open: 'tv', adblock: true, sponsorblock: true, dislikes: true, dearrow: true, sbCategories: ['sponsor', 'music_offtopic'] },
}));
const SHOTS = path.join(__dirname, 'out', 'shots-youtube'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'youtube.txt'); fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* page changing */ } await wait(400); } return false; };

app.whenReady().then(async () => {
  try {
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(3000);
    const win = BaseWindow.getAllWindows()[0];
    const home = win.contentView.children[0].webContents;
    const js = (c) => home.executeJavaScript(c);
    const site = () => win.contentView.children.map((v) => v.webContents).find((w) => /youtube\.com/.test(w.getURL()));
    const sjs = (c) => site().executeJavaScript(c);
    const shot = async (wc, f) => fs.writeFileSync(path.join(SHOTS, `${f}.png`), (await wc.capturePage()).toPNG());
    const log = () => fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');

    // Settings → YouTube.
    await js("go('settings'); setSettingsTab('youtube'); 0"); await wait(800);
    say('youtube section:', await js("[...document.querySelectorAll('.s-panel[data-tab=\"youtube\"] .rail-item')].map(b=>b.textContent).join(', ')"));
    say('open in:', await js("document.querySelector('#yt-open .chosen').textContent"), '|', await js("document.getElementById('yt-open-note').textContent"));
    say('extras on:', await js("['adblock','sponsorblock','dislikes','dearrow'].filter(k=>document.getElementById('yt-'+k).classList.contains('on')).join(', ')"));
    await js("document.querySelector('.s-panel[data-tab=\"youtube\"] .rail-item[data-group=\"Extras\"]').focus()"); await wait(500);
    await shot(home, '1-settings');
    const flip = await js("tv.youtubeSet({ dearrow: false }).then(()=>tv.youtubeSet({ dearrow: true }))");
    say('switch saved:', flip && flip.dearrow, '| bad mode ignored, still:', (await js("tv.youtubeSet({ open: 'nonsense' })")).open);
    if ((await js('tv.youtubeSettings()')).open !== 'tv') throw new Error('not on the TV page: stopping before VacuumTube opens');
    await js("go('home'); 0");

    // "Find it on YouTube": the TV page here, searching.
    await js("tv.findOnYouTube ? tv.findOnYouTube('nirvana lithium') : 0");
    await until(() => site() && /#\/search/.test(site().getURL()), 20000);
    await wait(12000);
    say('page:', site().getURL(), '| title:', site().getTitle());
    say('the app can be asked:', await sjs('typeof window.__tvoAsk'));
    say('extras inside:', await sjs('Boolean(window.__tvoExtras)'), '| page sees controllers:', await sjs('navigator.getGamepads().length'));
    const text = await sjs('document.body.innerText');
    say('results on screen:', /Lithium/i.test(text), '| "Sponsored" tile:', /Sponsored/.test(text) ? 'YES (ad got through)' : 'none');
    await shot(site(), '2-search');

    // The YouTube Music button: Nevermind, found and played (its first song, the album after it).
    const r = await js("tv.musicYouTube('album', 'Nevermind', 'Nirvana')");
    say('youtube music:', JSON.stringify(r));
    await until(() => /#\/watch\?v=/.test(site().getURL()), 20000);
    say('playing:', site().getURL());
    await until(() => sjs("Boolean(document.querySelector('video') && document.querySelector('video').currentTime > 1)"), 40000);
    await wait(4000);
    say('video time:', await sjs("document.querySelector('video') ? document.querySelector('video').currentTime.toFixed(1) : 'no video'"));
    await shot(site(), '3-playing');
    const l = log();
    say('asked SponsorBlock:', /skipSegments\/… -> \d+/.test(l), '| asked for votes:', /returnyoutubedislikeapi.com\/votes -> \d+/.test(l), '| asked DeArrow:', /api\/branding\/… -> \d+/.test(l));
    say('note on screen:', await sjs("[...document.querySelectorAll('div')].filter(d=>d.style.zIndex==='2147483647').map(d=>d.textContent).join(' | ')"));

    // B: steps back on the TV page (Escape), and on its home screen offers the menu.
    const before = site().getURL();
    const { ipcMain } = require('electron');
    const B = async () => { ipcMain.emit('pad', { sender: site() }, 'back'); await wait(2500); };
    await B(); say('B once while playing:', before.replace(/^.*#/, '#').slice(0, 30), '->', site().getURL().replace(/^.*#/, '#').slice(0, 30));
    await B(); say('B twice:', site().getURL().replace(/^.*#/, '#').slice(0, 30));
    await shot(site(), '4-after-b');
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
