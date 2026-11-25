'use strict';

// Sound files the app can't play as they are (AIFF, WMA, APE, CAF, WavPack, and ALAC inside .m4a)
// are turned into WAV with ffmpeg, when it's installed and Settings → Look → Make your own →
// "Convert other sound formats" is on. The copies are kept in a cache folder, named after the
// file, its size and when it was changed, so each is only converted once.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ALWAYS = /\.(aif|aiff|aifc|wma|ape|caf|wv)$/i; // never playable as they are
const MAYBE = /\.(m4a|mp4|m4b)$/i;                   // playable, unless it's ALAC inside

function run(cmd, args, env, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function createAudioConvert({ cacheDir, env = process.env, log = () => {} }) {
  let found = null;             // null: not looked yet; '' : not installed; else ffmpeg's version
  const done = new Map();       // original file -> converted copy

  async function ffmpeg() {
    if (found !== null) return found;
    const r = await run('ffmpeg', ['-hide_banner', '-version'], env, 5000);
    found = r.err ? '' : (/ffmpeg version (\S+)/.exec(r.stdout) || [])[1] || 'yes';
    log(`audio: ffmpeg ${found ? `found (${found})` : 'not installed: other sound formats can\'t be converted'}`);
    return found;
  }

  async function isAlac(file) {
    const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file], env, 5000);
    return !r.err && r.stdout.trim() === 'alac';
  }

  async function convert(file) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
    const out = path.join(cacheDir, `${key}.wav`);
    if (fs.existsSync(out)) return out;
    fs.mkdirSync(cacheDir, { recursive: true });
    // (At most 10 seconds: these are short sounds.)
    const r = await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-t', '10', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', `${out}.part.wav`], env);
    if (r.err) { log(`audio: couldn't convert ${path.basename(file)}: ${(r.stderr.trim().split('\n').pop() || r.err.message).slice(0, 200)}`); return null; }
    fs.renameSync(`${out}.part.wav`, out);
    log(`audio: converted ${path.basename(file)}`);
    return out;
  }

  // Converts whichever of these files need it. Returns how many copies are in use.
  async function prepare(files, enabled) {
    done.clear();
    const need = [];
    for (const f of new Set(files)) {
      if (ALWAYS.test(f)) need.push(f);
      else if (MAYBE.test(f) && enabled && await ffmpeg() && await isAlac(f)) need.push(f);
    }
    if (!need.length) return 0;
    if (!enabled) { log(`audio: ${need.length} sound file(s) need converting, but converting is switched off`); return 0; }
    if (!await ffmpeg()) return 0;
    for (const f of need) { const out = await convert(f); if (out) done.set(f, out); }
    return done.size;
  }

  return {
    prepare,
    playable: (file) => done.get(file) || file,
    status: async () => ({ ffmpeg: await ffmpeg(), converted: done.size }),
  };
}

module.exports = { createAudioConvert };
