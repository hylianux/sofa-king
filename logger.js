'use strict';

// The app's log: ~/.config/sofa-king/logs/sofa-king.log.
// - Everything the app already prints (console.log / warn / error) goes in, plus "debug" lines
//   from around the app when Settings → Developer → Debug logging is on.
// - Secrets never go in: Jellyfin and Plex tokens, API keys and sign-in tokens are replaced with «hidden».
// - When the file reaches 1 MB it's moved aside (sofa-king.1.log, .2, .3) and a new one starts;
//   only 3 old ones are kept.

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

function createLogger({ dir, getSecrets = () => [] }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sofa-king.log');
  let debugOn = false;
  let size = 0;
  try { size = fs.statSync(file).size; } catch { size = 0; }

  // Hide anything that could let someone else into your accounts.
  function redact(text) {
    let s = String(text);
    s = s.replace(/([?&](?:api_key|apiKey|t|token|access_token|refresh_token|X-Emby-Token|X-Plex-Token)=)[^&\s"']+/gi, '$1«hidden»');
    s = s.replace(/(X-(?:Emby|Plex)-Token[:=]\s*)[A-Za-z0-9_-]+/gi, '$1«hidden»');
    s = s.replace(/(Token=")[^"]*(")/g, '$1«hidden»$2');
    s = s.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1«hidden»');
    s = s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '«hidden»');
    for (const secret of getSecrets()) {
      if (secret && secret.length >= 8) s = s.split(secret).join('«hidden»');
    }
    return s;
  }

  function rotate() {
    try {
      for (let i = KEEP; i >= 1; i--) {
        const from = i === 1 ? file : path.join(dir, `sofa-king.${i - 1}.log`);
        const to = path.join(dir, `sofa-king.${i}.log`);
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      // Anything older than we keep (left over from before): gone.
      for (const f of fs.readdirSync(dir)) {
        const m = /^sofa-king\.(\d+)\.log$/.exec(f);
        if (m && Number(m[1]) > KEEP) fs.rmSync(path.join(dir, f), { force: true });
      }
    } catch { /* keep logging into the same file */ }
    size = 0;
  }

  function write(level, args) {
    const text = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 }))).join(' ');
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${redact(text)}\n`;
    if (size + line.length > MAX_BYTES) rotate();
    try { fs.appendFileSync(file, line); size += Buffer.byteLength(line); } catch { /* disk full: nothing to do */ }
  }

  // Route the app's existing console output through the log too (still printed as before).
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { original.log(...a); write('info', a); };
  console.warn = (...a) => { original.warn(...a); write('warn', a); };
  console.error = (...a) => { original.error(...a); write('error', a); };

  const log = {
    file, dir,
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    // Only written when debug logging is on (Settings → Developer).
    debug: (...a) => { if (debugOn) write('debug', a); },
    setDebug: (on) => { debugOn = Boolean(on); write('info', [`debug logging ${debugOn ? 'on' : 'off'}`]); },
    get debugOn() { return debugOn; },
    redact,
    // Everything, newest last, for sending to a phone: old files first, then the current one.
    collect(extra = []) {
      const parts = [];
      for (let i = KEEP; i >= 1; i--) {
        const f = path.join(dir, `sofa-king.${i}.log`);
        if (fs.existsSync(f)) parts.push(`===== ${path.basename(f)} =====\n${fs.readFileSync(f, 'utf8')}`);
      }
      if (fs.existsSync(file)) parts.push(`===== sofa-king.log =====\n${fs.readFileSync(file, 'utf8')}`);
      for (const { name, path: p } of extra) {
        try { if (fs.existsSync(p)) parts.push(`===== ${name} =====\n${redact(fs.readFileSync(p, 'utf8').slice(-400000))}`); } catch { /* skip */ }
      }
      return parts.join('\n');
    },
    sizes() {
      let total = 0;
      for (const f of fs.readdirSync(dir)) { try { total += fs.statSync(path.join(dir, f)).size; } catch { /* gone */ } }
      return total;
    },
    clear() {
      for (const f of fs.readdirSync(dir)) if (/^sofa-king(\.\d+)?\.log$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      size = 0;
      write('info', ['log cleared']);
    },
  };
  process.on('uncaughtException', (err) => write('error', ['uncaught:', err && err.stack ? err.stack : err]));
  process.on('unhandledRejection', (err) => write('error', ['unhandled rejection:', err && err.stack ? err.stack : err]));
  return log;
}

module.exports = { createLogger };
