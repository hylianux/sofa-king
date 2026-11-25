require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Suggestions while typing, on all three keyboards, with a pretend TMDB and a pretend website:
//   - the suggester by itself (words, capitals, email endings, earlier searches, titles);
//   - Search: the row above the keys, Up into it, picking a title, earlier searches remembered
//     once something found is opened, the keys never moving;
//   - the typing screen: a radio search with suggestions, an address without;
//   - a website: a search box (titles), an email field (words, @gmail.com), a password field
//     (nothing), picking a suggestion fixing up what the website got;
//   - Settings → Controller: off hides the row, forgetting empties the earlier searches.
const path = require('path'); const fs = require('fs');
const { app, BaseWindow, ipcMain, session } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-suggest');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  tmdbKey: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJnb29kZ29vZGdvb2QifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
  live: { iptvOrgAsked: true }, layout: 'netflix', kbConfirm: false,
}));
const SHOTS = path.join(__dirname, 'out', 'shots-suggest'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'suggest.txt'); fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);

// The suggester by itself.
const { createSuggester, rememberIn } = require('../../suggest');
const sg = createSuggester();
const show = (t, o) => sg.suggest(t, o).map((x) => `${x.kind[0]}:${x.value}`).join(' | ');
say('unit "brea" + titles:', show('brea', { titles: ['Breaking Bad', 'Bryan Cranston', 'The Breakfast Club'] }));
say('unit "Hel":', show('Hel'));
say('unit "me@g":', show('me@g'));
say('unit "" + past:', show('', { past: ['nirvana', 'korn'] }));
say('unit "ni" + past:', show('ni', { past: ['nirvana', 'Neil Young'] }));
say('unit no swear words for "fu":', show('fu', { limit: 20 }));
say('unit remember:', JSON.stringify(rememberIn(rememberIn(['Korn'], 'nirvana'), ' KORN ')));

// Pretend TMDB.
const TITLES = ['Breaking Bad', 'The Breakfast Club', 'Breathe', 'Bryan Cranston'];
const realFetch = globalThis.fetch;
const tmdbAsked = [];
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.themoviedb.org') return realFetch(url, opts);
  const p = u.pathname.replace('/3', '');
  const J = (o) => new Response(JSON.stringify(o));
  if (p.startsWith('/search')) {
    tmdbAsked.push(u.searchParams.get('query'));
    return J({ results: TITLES.map((t, i) => ({ id: 100 + i, media_type: i === 3 ? 'person' : i % 2 ? 'movie' : 'tv', title: t, name: t, poster_path: null, release_date: '2010-01-01', first_air_date: '2008-01-20', overview: '', known_for_department: 'Acting' })) });
  }
  if (/^\/(movie|tv)\/\d+$/.test(p)) return J({ id: 100, name: 'Breaking Bad', overview: 'x', genres: [], credits: { cast: [], crew: [] }, 'watch/providers': { results: {} } });
  return J({ results: [], genres: [] });
};

// The pretend website: a search box, an email field and a password field.
const SITE = `<!doctype html><title>Pretend</title><body style="background:#123;color:#fff;font:20px sans-serif">
<input id="s" type="search" name="q" placeholder="Search"><input id="e" type="email" name="email" placeholder="Email address">
<input id="p" type="password" name="pw"></body>`;

require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    session.fromPartition('persist:tv').protocol.handle('https', async () => new Response(SITE, { headers: { 'content-type': 'text/html' } }));
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(2500);
    const views = () => BaseWindow.getAllWindows()[0].contentView.children;
    const wc = views()[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(150); } };
    const shot = async (f, w = wc) => fs.writeFileSync(path.join(SHOTS, `${f}.png`), (await w.capturePage()).toPNG());
    const focused = () => js("(document.activeElement.className || document.activeElement.id) + ' | ' + (document.activeElement.textContent || '').trim().slice(0, 40)");
    const chips = (sel) => js(`[...document.querySelectorAll('${sel}')].map((c) => c.className.replace(/\\b(sugg|k|sel)\\b/g, '').trim()[0] + ':' + c.textContent.trim()).join(' | ')`);
    const cfg = () => JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).suggest || {};

    // ---- Search
    await js('openSearch(); 0'); await wait(500);
    const keysAt = await js("JSON.stringify(document.getElementById('osk').getBoundingClientRect().top)");
    say('search, nothing typed:', JSON.stringify(await chips('#osk-sugg .sugg')));
    for (const ch of 'brea') await js(`type('${ch}'); 0`);
    await wait(1500);
    say('search "brea":', await chips('#osk-sugg .sugg'));
    say('keys stayed put:', keysAt === await js("JSON.stringify(document.getElementById('osk').getBoundingClientRect().top)"));
    await shot('1-search');
    // Up from the top row (on "c") goes into the row; picking goes back to "c".
    await js("[...document.querySelectorAll('#osk .key')].find((k) => k.textContent === 'c').focus(); 0");
    await key('Up'); say('up from c:', await focused());
    await key('Right'); say('right:', await focused());
    await key('Left'); await key('Left'); say('left twice (loops):', await focused());
    await key('Right');
    say('picking:', await focused());
    ipcMain.emit('pad', { sender: wc }, 'ok'); await wait(1200);
    say('picked → query:', JSON.stringify(await js('search.query')), '| focus back on:', await focused());
    say('remembered before opening anything:', JSON.stringify((cfg().past || {}).search || []));
    await js("document.querySelector('#results .card').click(); 0"); await wait(800);
    say('remembered after opening a result:', JSON.stringify((cfg().past || {}).search || []));
    await js('openSearch(); setQuery(""); 0'); await wait(800);
    say('search again, nothing typed:', await chips('#osk-sugg .sugg'));

    // ---- The typing screen
    await js("window.__r = 'pending'; askFor({ label: 'Search for a station', suggest: 'radio' }).then((v) => { window.__r = v; }); 0"); await wait(500);
    for (const ch of 'jaz') await js(`askType('${ch}'); 0`);
    await wait(700);
    say('ask radio "jaz":', await chips('#ask-keys .k.sugg'));
    const qTop = await js("document.querySelector('#ask-keys .k[data-k=\"p\"]').getBoundingClientRect().top");
    await js("askKeys.render('q'); 0"); // (the highlight on q, as when starting)
    await key('Up'); await key('Up'); say('up twice from q:', await js("document.querySelector('#ask-keys .sel').textContent"));
    await key('Enter'); await wait(500);
    say('picked → typed:', JSON.stringify(await js('ask.value')), '| highlight back on (where Up left from):', await js("document.querySelector('#ask-keys .sel').dataset.k"));
    await wait(500);
    say('then:', await chips('#ask-keys .k.sugg'), '| keys stayed put:', qTop === await js("document.querySelector('#ask-keys .k[data-k=\"p\"]').getBoundingClientRect().top"));
    await shot('2-ask');
    await js('finishAsk(ask.value); 0'); await wait(300);
    say('radio search remembered:', JSON.stringify((cfg().past || {}).radio || []));
    await js("askFor({ label: 'Server address' }); 0"); await wait(400);
    for (const ch of 'hel') await js(`askType('${ch}'); 0`);
    await wait(700);
    say('ask address (no suggestions): row?', await js("Boolean(document.querySelector('#ask-keys .kb-sugg'))"));
    await js('finishAsk(null); 0'); await wait(300);

    // ---- A website
    await js("tv.open('netflix'); 0");
    let site = null;
    for (let i = 0; i < 40 && !site; i++) { await wait(250); site = views().map((v) => v.webContents).find((w) => /netflix/.test(w.getURL())); }
    await wait(1500);
    const overlay = views().map((v) => v.webContents).find((w) => /overlay\.html/.test(w.getURL()));
    const ojs = (c) => overlay.executeJavaScript(c);
    const pad = async (a) => { ipcMain.emit('pad', { sender: site }, a); await wait(150); };
    const field = async (id) => { await site.executeJavaScript(`document.getElementById('${id}').focus(); 0`); await wait(300); await pad('ok'); await wait(700); };
    const otype = async (t) => { for (const ch of t) { await ojs(`type(${JSON.stringify(ch)}); 0`); } await wait(900); };
    const ochips = () => ojs("[...document.querySelectorAll('#kb-rows .k.sugg')].map((c) => c.className.replace(/\\b(sugg|k|sel)\\b/g, '').trim()[0] + ':' + c.textContent.trim()).join(' | ')");

    await field('s');
    await otype('brea');
    say('website search box "brea":', await ochips());
    await shot('3-website', overlay);
    await pad('up'); await pad('up'); await pad('up'); await pad('up'); await pad('up');
    say('up ×5 lands on:', await ojs("document.querySelector('#kb-rows .sel').textContent"));
    await pad('ok'); await wait(400);
    say('picked → website has:', JSON.stringify(await site.executeJavaScript("document.getElementById('s').value")), '| keyboard shows:', JSON.stringify(await ojs('kb.buffer')));
    await pad('menu'); await wait(500);
    say('website search remembered:', JSON.stringify((cfg().past || {}).web || []));

    await field('e');
    await otype('me');
    say('website email "me" (no words):', JSON.stringify(await ochips()));
    await otype('@g');
    say('then "@g":', await ochips());
    await pad('up'); await pad('up'); await pad('up'); await pad('up'); await pad('up'); await pad('ok'); await wait(300);
    say('website email has:', JSON.stringify(await site.executeJavaScript("document.getElementById('e').value")));
    await pad('menu'); await wait(500);
    say('email not remembered:', JSON.stringify((cfg().past || {}).web || []));

    await field('p');
    await otype('hel');
    say('website password: row?', await ojs("Boolean(document.querySelector('#kb-rows .kb-sugg'))"), '| asked main anyway:', JSON.stringify(await ojs("window.tv.suggest('hel', 'web')")));
    await pad('back'); await wait(500);

    // ---- Settings
    await js("tv.setSuggest({ forget: true }).then((s) => { window.__s = s.suggest; }); 0"); await wait(300);
    say('forget:', JSON.stringify(await js('window.__s')), JSON.stringify(cfg().past));
    await js("tv.setSuggest({ on: false }).then((s) => renderSuggestSettings(s.suggest)); 0"); await wait(300);
    await js("askFor({ label: 'Search for a station', suggest: 'radio' }); 0"); await wait(400);
    say('switched off: row?', await js("Boolean(document.querySelector('#ask-keys .kb-sugg'))"), '| main answers:', JSON.stringify(await js("tv.suggest('jaz', 'radio')")));
    await js('finishAsk(null); 0');
    say('tmdb asked:', JSON.stringify(tmdbAsked));
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
app.on('web-contents-created', (e, w) => w.on('console-message', (event) => { const m = event.message || ''; if (/error|refused|Uncaught/i.test(m)) say('page says:', m.slice(0, 300), `(${String(event.sourceId || '').split('/').pop()}:${event.lineNumber})`); }));
