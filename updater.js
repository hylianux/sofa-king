'use strict';

// Updates for the AppImage. The newest release on SOFA King's GitHub page is downloaded next to
// the AppImage you're running, checked against the release's SHA256SUMS.txt, then put in its
// place under the same name (so launcher entries keep working). The running copy carries on until
// the app restarts. Running from the source code, nothing is ever replaced.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { Readable } = require('stream');

const REPO = 'hylianux/sofa-king';
const ARCH = { x64: 'x86_64', arm64: 'arm64' };

// Which version is newer: 1, -1 or 0. "0.2.0-beta.1" comes before "0.2.0".
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
    return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p > +q ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

// A few lines of what's new, from the notes GitHub writes ("## What's Changed").
function whatsNew(body) {
  const text = String(body || '');
  const at = text.search(/^##\s*What'?s Changed/im);
  if (at < 0) return [];
  return text.slice(at).split('\n').slice(1)
    .filter((l) => /^\s*[*-]\s+/.test(l))
    .map((l) => l.replace(/^\s*[*-]\s+/, '').replace(/\s+by @\S+ in https?:\/\/\S+$/, '').replace(/\*\*|`|\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .filter(Boolean).slice(0, 8);
}

function createUpdater({ version, appImage = null, apiBase = 'https://api.github.com', arch = process.arch, log = console }) {
  const headers = { 'User-Agent': `SOFA-King/${version}`, Accept: 'application/vnd.github+json' };
  const assetEnd = `-${ARCH[arch] || arch}.AppImage`;
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

  async function get(url) {
    let res;
    try { res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); } catch { throw fail('unreachable'); }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw fail('busy'); // GitHub's limit for asking: try later
    if (!res.ok) throw fail('failed', `GitHub answered ${res.status}`);
    return res.json();
  }

  const shape = (r) => {
    const tag = String(r.tag_name || '');
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const file = assets.find((a) => String(a.name).endsWith(assetEnd));
    const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
    return {
      version: tag.replace(/^v/, ''), name: String(r.name || tag), date: String(r.published_at || ''),
      prerelease: Boolean(r.prerelease), page: String(r.html_url || ''), news: whatsNew(r.body),
      file: file ? { name: String(file.name), url: String(file.browser_download_url), size: Number(file.size) || 0 } : null,
      sums: sums ? String(sums.browser_download_url) : null,
    };
  };

  // The newest release: stable ones only, or test versions (pre-releases) too.
  async function latest(prerelease = false) {
    if (!prerelease) {
      const r = await get(`${apiBase}/repos/${REPO}/releases/latest`);
      return r ? shape(r) : null;
    }
    const list = (await get(`${apiBase}/repos/${REPO}/releases?per_page=30`)) || [];
    const ok = list.filter((r) => !r.draft && /^v?\d+\.\d+\.\d+/.test(r.tag_name || ''));
    ok.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
    return ok.length ? shape(ok[0]) : null;
  }

  async function check(prerelease = false) {
    const rel = await latest(prerelease);
    return { latest: rel, newer: Boolean(rel && compareVersions(rel.version, version) > 0) };
  }

  // Can this copy update itself? Only an AppImage, in a folder we're allowed to write to.
  function canUpdate() {
    if (!appImage) return { ok: false, why: 'not-appimage' };
    try {
      fs.accessSync(appImage, fs.constants.W_OK);
      fs.accessSync(path.dirname(appImage), fs.constants.W_OK);
    } catch { return { ok: false, why: 'read-only' }; }
    return { ok: true };
  }

  // Download, check, replace. onProgress(got, total) as it comes in.
  async function install(rel, onProgress = () => {}) {
    const can = canUpdate();
    if (!can.ok) throw fail(can.why);
    if (!rel || !rel.file) throw fail('no-file');
    if (!rel.sums) throw fail('no-checksum');
    // What the file must add up to.
    let sums;
    try {
      const r = await fetch(rel.sums, { headers: { 'User-Agent': headers['User-Agent'] }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(String(r.status));
      sums = await r.text();
    } catch { throw fail('unreachable'); }
    const line = sums.split('\n').map((l) => /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(l)).find((m) => m && m[2] === rel.file.name);
    if (!line) throw fail('no-checksum');
    const want = line[1].toLowerCase();

    const tmp = path.join(path.dirname(appImage), `.${path.basename(appImage)}.update`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp, { mode: 0o755 });
    try {
      let res;
      try { res = await fetch(rel.file.url, { headers: { 'User-Agent': headers['User-Agent'] } }); } catch { throw fail('unreachable'); }
      if (!res.ok || !res.body) throw fail('failed', `download answered ${res.status}`);
      const total = Number(res.headers.get('content-length')) || rel.file.size || 0;
      let got = 0;
      for await (const chunk of Readable.fromWeb(res.body)) {
        hash.update(chunk);
        got += chunk.length;
        if (!out.write(chunk)) await once(out, 'drain');
        onProgress(got, total);
      }
      await new Promise((ok, no) => out.end((err) => (err ? no(err) : ok())));
      const have = hash.digest('hex');
      if (have !== want) throw fail('bad-checksum', `expected ${want}, got ${have}`);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, appImage);
      log.info(`[update] installed ${rel.version} (${got} bytes, checksum ok)`);
      return { ok: true, version: rel.version };
    } catch (err) {
      out.destroy();
      try { fs.rmSync(tmp, { force: true }); } catch { /* already gone */ }
      if (err.code && !/^E[A-Z]+$/.test(err.code)) throw err;
      throw fail(err.code === 'ENOSPC' ? 'no-space' : 'failed', err.message);
    }
  }

  return { check, latest, canUpdate, install };
}

module.exports = { createUpdater, compareVersions, whatsNew, REPO };
