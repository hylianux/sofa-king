require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true }); // (results, screenshots and test settings go in out/)
// Round 2 sounds: recorded instruments (and how loud they are next to the made-up notes), Tone.js
// instruments and sound effects in every page, the Cartoon pack, and converting other formats.
const path = require('path'); const fs = require('fs');
const { execFileSync } = require('child_process');
const { app, BaseWindow, webContents } = require('electron');
const UD = path.join(__dirname, 'out', 'userdata-sounds2');
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
app.setPath('userData', UD);
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ live: { iptvOrgAsked: true } }));
// A sound pack of your own with an AIFF and an Apple Lossless file (made here with ffmpeg).
const PACK = path.join(UD, 'themes/soundpacks/odd-formats');
fs.mkdirSync(PACK, { recursive: true });
const tone = (out, args) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2', ...args, out]);
tone(path.join(PACK, 'select.aiff'), []);
tone(path.join(PACK, 'move.m4a'), ['-c:a', 'alac']);
fs.writeFileSync(path.join(PACK, 'sound.json'), JSON.stringify({ name: 'Odd formats', sounds: { select: 'select.aiff', move: 'move.m4a' } }));
const SHOTS = path.join(__dirname, 'out', 'shots-sounds2'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS);
const OUT = path.join(__dirname, 'out', 'sounds2.txt');
fs.writeFileSync(OUT, '');
const say = (...a) => fs.appendFileSync(OUT, `${a.join(' ')}\n`);
require(path.join(__dirname, '..', '..', 'main.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// How loud a run of sounds comes out: peak and average (RMS), from 0 to 1.
const LEVEL = `(async (steps) => {
  const b = await tvSoundRender(steps, 3);
  let peak = 0, sum = 0; const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; sum += x * x; }
  return peak.toFixed(3) + ' / ' + Math.sqrt(sum / d.length).toFixed(4);
})`;

app.whenReady().then(async () => {
  try {
    for (let i = 0; i < 80 && !(BaseWindow.getAllWindows()[0] && BaseWindow.getAllWindows()[0].contentView.children[0]); i++) await wait(250);
    await wait(3000);
    const wc = BaseWindow.getAllWindows()[0].contentView.children[0].webContents;
    const js = (c) => wc.executeJavaScript(c);
    const pages = () => webContents.getAllWebContents().filter((w) => /ui\/(home|overlay|hints)\.html/.test(w.getURL()));
    const steps = JSON.stringify([['move', 0], ['move', 0.25], ['select', 0.5], ['back', 1.2], ['edge', 1.7], ['screen', 2.3]]);
    const level = () => js(`${LEVEL}(${steps})`);

    say('classic, as designed:', await level());
    for (const id of ['soft', 'string', 'piano', 'music-box', 'celesta', 'real-marimba', 'vibraphone', 'harp', 'kalimba', 'overdriven-guitar', 'distortion-guitar']) {
      await js(`setPart({ instrument: '${id}' })`); await wait(1200);
      const info = await js('tvSoundInfo()');
      say(`${id}:`, info.kind, `${info.samples} notes`, '| level', await level());
    }

    // Tone.js instruments, in every page (each page has its own security rules).
    for (const id of ['bell', 'e-piano', 'duo', 'drums']) {
      await js(`setPart({ instrument: '${id}' })`); await wait(1500);
      const all = [];
      for (const w of pages()) {
        const info = await w.executeJavaScript('tvSoundInfo()');
        all.push(`${w.getURL().split('/').pop()}: ${info.kind} tone=${info.tone}`);
      }
      // Play a few notes for real (any error shows up below).
      await js("tvSound('select', { force: true }); tvSound('move', { force: true }); tvSound('edge', { force: true }); 0"); await wait(600);
      say(`${id}:`, all.join(' | '));
    }
    await js("setPart({ instrument: '' })");

    // Sound effects, one at a time and all together.
    for (const fx of ['bitcrush', 'chorus', 'phaser', 'delay']) {
      await js(`setPart({ soundFx: '${fx}', on: true })`); await wait(1200);
      await js("tvSound('select', { force: true }); 0"); await wait(200);
      const info = await js('tvSoundInfo()');
      say(`sound effects now: ${info.soundFx.join('+')} | chain ready: ${info.chainReady}`);
    }
    for (const w of pages()) say(`  in ${w.getURL().split('/').pop()}:`, JSON.stringify(await w.executeJavaScript('tvSoundInfo().soundFx')));
    for (const fx of ['bitcrush', 'chorus', 'phaser', 'delay']) await js(`setPart({ soundFx: '${fx}', on: false })`);
    await wait(500);

    // The Cartoon pack: every event makes a sound, none too loud.
    await js("setPart({ sounds: 'cartoon' })"); await wait(800);
    for (const ev of ['move', 'select', 'back', 'edge', 'open', 'close', 'type', 'screen']) say(`cartoon ${ev}:`, await js(`${LEVEL}([['${ev}', 0]])`));

    // Other formats, converted with ffmpeg.
    await js("setPart({ sounds: 'odd-formats' })"); await wait(1500);
    say('odd formats, decoded:', JSON.stringify((await js('tvSoundInfo()')).files), '| converting:', JSON.stringify(await js('tv.audioStatus()')));
    say('cache:', fs.readdirSync(path.join(UD, 'audio-cache')).length, 'files');
    const off = await js('tv.setConvertAudio(false)'); await wait(1200);
    say('switched off:', JSON.stringify(off), '| decoded now:', JSON.stringify((await js('tvSoundInfo()')).files));
    await js('tv.setConvertAudio(true)'); await wait(1200);

    // Settings → Look: the new sections.
    await js("openSettings({ tab: 'look' })"); await wait(800);
    say('look rails:', await js("[...document.querySelectorAll('.s-panel:not([hidden]) .rail-item')].map(b=>b.textContent).join(', ')"));
    await js("document.querySelector('#s-instrument [data-instrument=\"harp\"]').focus()"); await wait(500);
    say('preview label:', await js('pv.label.textContent'), '|', await js('pv.caption.textContent'));
    say('after a direct refresh:', await js('updatePreview(), pv.label.textContent'), '|', await js('pv.caption.textContent'));
    await wc.capturePage().then((i) => fs.writeFileSync(path.join(SHOTS, 'instrument.png'), i.toPNG()));
    await js("document.querySelector('#s-sound-fx [data-sound-fx=\"chorus\"]').focus()"); await wait(500);
    await wc.capturePage().then((i) => fs.writeFileSync(path.join(SHOTS, 'sound-fx.png'), i.toPNG()));
    await js("document.getElementById('s-convert-audio').focus()"); await wait(500);
    await wc.capturePage().then((i) => fs.writeFileSync(path.join(SHOTS, 'convert.png'), i.toPNG()));
    say('remembered place:', await js('placeKey(document.querySelector(\'#s-sound-fx [data-sound-fx="chorus"]\'))'));

    // Errors from any page while all this ran.
    const log = fs.readFileSync(path.join(UD, 'logs', 'sofa-king.log'), 'utf8');
    say('log, audio lines:', log.split('\n').filter((l) => /audio:/.test(l)).map((l) => l.replace(/^\S+ \w+\s+/, '')).join(' | '));
  } catch (err) { say('ERROR', err.stack); }
  app.exit(0);
});
for (const ev of ['console-message']) app.on('web-contents-created', (e, w) => w.on(ev, (event) => { const m = event.message || ''; if (/error|refused|Tone/i.test(m)) say('page says:', m.slice(0, 300)); }));
