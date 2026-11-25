'use strict';

// Phone remote: a small web page served on your home network. Scan the QR code on the TV,
// and your phone can type into the TV or paste a TMDB key into settings.
// Every request needs the random token that's in the QR code's link, so only a phone
// that has seen the TV screen can use it. The token changes each time the app starts.

const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

// Networks that only exist inside this computer (containers, VMs, Waydroid, VPNs).
const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|waydroid|lxc|lxd|incus|podman|cni|flannel|kube|tailscale|zt|wg|nordlynx|proton|tun|tap|vnet|anbox|lo)/i;

// The network card this computer uses to reach the internet: the one with the default route.
function defaultRouteInterface() {
  try {
    const rows = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/));
    const defaults = rows.filter((r) => r[1] === '00000000' && !VIRTUAL.test(r[0])).sort((a, b) => Number(a[6]) - Number(b[6]));
    return defaults.length ? defaults[0][0] : null;
  } catch {
    return null;
  }
}

function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) found.push({ name, address: n.address, cidr: n.cidr });
    }
  }
  const preferred = defaultRouteInterface();
  const rank = (a) =>
    (a.name === preferred ? -100 : 0) +
    (VIRTUAL.test(a.name) ? 50 : 0) +
    (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
  return found.sort((a, b) => rank(a) - rank(b));
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function createPhoneRemote({ getPort, handlers }) {
  const token = crypto.randomBytes(16).toString('base64url');
  const tokenBuf = Buffer.from(token);
  let server = null;
  let info = null;
  let starting = null;
  let state = { mode: 'text', label: 'Search', kind: 'text', keyFor: 'tmdb' };

  const validToken = (t) => {
    const b = Buffer.from(String(t || ''));
    return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
  };

  function send(res, status, type, body) {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  }
  const json = (res, status, obj) => send(res, status, 'application/json', JSON.stringify(obj));

  async function handle(req, res) {
    if (handlers.seen) handlers.seen(); // something on the network reached us
    const url = new URL(req.url, 'http://phone.local');
    if (!validToken(url.searchParams.get('t') || req.headers['x-token'])) return send(res, 403, 'text/plain', 'Scan the code on the TV to connect.');

    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
      // The app's log, as a file to keep or send (Settings → Developer → Get the log on my phone).
      if (req.method === 'GET' && url.pathname === '/log' && handlers.log) {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="sofa-king-log-${stamp}.txt"`,
          'cache-control': 'no-store',
        });
        return res.end(await handlers.log());
      }
      if (req.method === 'POST' && url.pathname === '/api/text') {
        const { text } = await readBody(req);
        handlers.text(String(text || ''));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/key') {
        const { name } = await readBody(req);
        handlers.key(String(name || ''));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/setkey') {
        const { key, kind } = await readBody(req);
        if (!['tmdb', 'watchmode', 'trakt', 'live', 'lastfm'].includes(kind)) return json(res, 400, { error: 'bad-request' });
        return json(res, 200, await handlers.setKey(kind, String(key || '')));
      }
      if (req.method === 'POST' && url.pathname === '/api/tmdb') {
        const { key } = await readBody(req);
        return json(res, 200, await handlers.tmdb(String(key || '')));
      }
      return json(res, 404, { error: 'not-found' });
    } catch (err) {
      return json(res, 400, { error: 'bad-request' });
    }
  }

  function listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.off('listening', onListening); reject(err); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    });
  }

  async function start() {
    if (info) return info;
    if (starting) return starting;
    starting = (async () => {
      const addresses = lanAddresses();
      if (!addresses.length) return { error: 'no-network' };
      server = http.createServer((req, res) => {
        console.log(`[phone] ${req.method} ${req.url.split('?')[0]} from ${req.socket.remoteAddress}`);
        handle(req, res);
      });
      try { await listen(getPort()); } catch { await listen(0); } // port taken: let the system pick one
      const port = server.address().port;
      const url = `http://${addresses[0].address}:${port}/?t=${token}`;
      const qr = await QRCode.toString(url, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0b10', light: '#ffffff' },
      });
      console.log(`[phone] remote at http://${addresses[0].address}:${port}/ (${addresses[0].name}); ` +
        `other addresses: ${addresses.slice(1).map((a) => `${a.address} (${a.name})`).join(', ') || 'none'}`);
      info = { url, qr, port, address: `${addresses[0].address}:${port}`, network: addresses[0].name, cidr: addresses[0].cidr };
      return info;
    })();
    try { return await starting; } finally { starting = null; }
  }

  return {
    start,
    setState(next) { state = { ...state, ...next }; },
    stop() { if (server) server.close(); server = null; info = null; },
  };
}

// ------------------------------------------------------------------ the phone's page

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>TV Remote</title>
<style>
  :root { --bg:#0b0b10; --card:#17161f; --line:#2a2935; --text:#f4f2ee; --muted:#9b98a6; --accent:#ffffff; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text);
    font: 17px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-text-size-adjust:100%;
    padding: max(20px, env(safe-area-inset-top)) 18px 32px; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:22px; color:var(--muted); font-size:14px; }
  .dot { width:9px; height:9px; border-radius:50%; background:#3ddc84; box-shadow:0 0 0 4px rgba(61,220,132,.15); }
  .dot.off { background:#e5484d; box-shadow:0 0 0 4px rgba(229,72,77,.15); }
  h1 { margin:0 0 6px; font-size:26px; letter-spacing:-.01em; }
  p { margin:0 0 16px; color:var(--muted); }
  .label { color:var(--text); font-weight:600; }
  input, textarea { width:100%; padding:14px 16px; border-radius:14px; border:1px solid var(--line);
    background:var(--card); color:var(--text); font:inherit; font-size:18px; outline:none; }
  input:focus, textarea:focus { border-color:#6b6880; }
  textarea { min-height:120px; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:14px; word-break:break-all; }
  button { font:inherit; border:0; border-radius:14px; padding:14px 18px; background:var(--card); color:var(--text);
    border:1px solid var(--line); font-weight:600; }
  button.primary { background:var(--accent); color:#0b0b10; border-color:var(--accent); }
  button:active { transform: scale(.98); }
  .row { display:flex; gap:10px; margin-top:12px; }
  .row > * { flex:1; }
  .status { min-height:1.45em; margin-top:14px; font-size:15px; }
  .status.good { color:#3ddc84; } .status.bad { color:#ff6b6b; }
  a { color:#7cc4ff; }
  .switch { margin-top:34px; text-align:center; font-size:15px; }
  .switch button { background:none; border:0; color:#7cc4ff; padding:6px; font-weight:500; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
  <header><span class="dot" id="dot"></span><span id="conn">Connected to your TV</span></header>

  <section id="text-mode">
    <h1>Type on the TV</h1>
    <p>Typing into <span class="label" id="field">Search</span></p>
    <form id="text-form" autocomplete="off">
      <input id="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="Type here">
      <div class="row"><button class="primary" type="submit">Send</button></div>
    </form>
    <div class="row">
      <button type="button" data-key="Backspace">⌫ Delete</button>
      <button type="button" data-key="Tab">Next field</button>
      <button type="button" data-key="Enter">Enter ⏎</button>
    </div>
    <div class="status" id="text-status"></div>
  </section>

  <section id="key-mode" hidden>
    <h1 id="key-title">Add your TMDB key</h1>
    <p id="key-how"></p>
    <p><a id="key-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">Open TMDB API settings ↗</a></p>
    <textarea id="key" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste your key"></textarea>
    <div class="row">
      <button type="button" id="paste">Paste</button>
      <button type="button" class="primary" id="save">Save key</button>
    </div>
    <div class="status" id="key-status"></div>
  </section>

  <div class="switch"><button type="button" id="switch">Paste a key instead</button></div>

<script>
  const token = new URLSearchParams(location.search).get('t');
  const $ = (id) => document.getElementById(id);
  let mode = 'text';
  let keyFor = 'tmdb';
  // What to say for each kind of key.
  const KEYS = {
    tmdb: {
      title: 'Add your TMDB key', name: 'TMDB', link: 'https://www.themoviedb.org/settings/api', linkText: 'Open TMDB API settings ↗',
      how: 'Open your TMDB API settings, copy the <b>API Read Access Token</b> (the long one), then paste it here.',
      done: 'Saved. Search is ready on your TV.', placeholder: 'Paste your key',
      notKey: 'That doesn\\'t look like a TMDB key. Copy the API Read Access Token.',
    },
    watchmode: {
      title: 'Add your Watchmode key', name: 'Watchmode', link: 'https://api.watchmode.com/requestApiKey/', linkText: 'Get a free Watchmode key ↗',
      how: '1. Tap the link below and sign up (choose the <b>free</b> plan). 2. Watchmode shows your API key, and emails it to you: copy it. 3. Come back to this page, paste it in the box and tap Save Key.',
      done: 'Saved. Title pages now check Watchmode too.', placeholder: 'Paste your Watchmode API key',
      notKey: 'That doesn\\'t look like a Watchmode key. It\\'s a long mix of letters and numbers.',
    },
    trakt: {
      title: 'Add your Trakt Client ID', name: 'Trakt', link: 'https://developer.trakt.tv/apps', linkText: 'Open Trakt\\'s developer apps ↗',
      how: '1. Open the link below and sign in to Trakt. 2. <b>Connect GitHub</b> in the Developer panel (Trakt requires it to make an app; a free GitHub account is fine). 3. Make a new app: name <b>SOFA King</b>, Redirect URI <b>urn:ietf:wg:oauth:2.0:oob</b> (or <b>http://localhost</b> if Trakt won\\'t take it). 4. Save, copy the <b>Client ID</b>, come back here, paste it and tap Save. The Client Secret says "Not issued" on new apps: you don\\'t need it.',
      done: 'Saved. Now sign in with the code on your TV.', placeholder: 'Paste the Client ID',
      notKey: 'That doesn\\'t look like a Client ID. Copy the code shown next to Client ID on your Trakt app.',
    },
    lastfm: {
      title: 'Add your Last.fm key', name: 'Last.fm', link: 'https://www.last.fm/api/account/create', linkText: 'Get a free Last.fm key ↗',
      how: '1. Tap the link below and sign in to Last.fm (or make a free account). 2. Fill in the form: only <b>Application name</b> is needed (say, <b>SOFA King</b>). 3. Submit, copy the <b>API key</b> (not the shared secret), come back here, paste it and tap Save.',
      done: 'Saved. Artist pages now use Last.fm for related artists.', placeholder: 'Paste your Last.fm API key',
      notKey: 'That doesn\\'t look like a Last.fm key. Copy the API key: 32 letters and numbers.',
    },
    live: {
      title: 'Add a live TV channel list', name: 'your channel list', link: 'https://github.com/kineticman/FastChannels', linkText: 'What\\'s FastChannels? ↗',
      how: 'Paste the address of your channel list (an M3U playlist). If there\\'s a separate guide (XMLTV) address, paste it on the next line. <b>FastChannels:</b> just its address, like <b>http://192.168.1.10:5523</b>: the playlist and guide are found for you.',
      done: 'Added. Your channels are on the TV now.', placeholder: 'http://…  (playlist address, then guide address)',
      notKey: 'That doesn\\'t look like a web address. It starts with http:// or https://.',
    },
  };
  function showKeyFor(k) {
    keyFor = KEYS[k] ? k : 'tmdb';
    const c = KEYS[keyFor];
    $('key-title').textContent = c.title;
    $('key-how').innerHTML = c.how;
    $('key-link').href = c.link;
    $('key-link').textContent = c.linkText;
    $('key').placeholder = c.placeholder;
  }
  let pinned = false; // the person picked a mode themselves

  async function api(path, body) {
    const res = await fetch(path + '?t=' + encodeURIComponent(token), body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  function setStatus(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'status ' + (cls || ''); }

  function showMode(m) {
    mode = m;
    $('text-mode').hidden = m !== 'text';
    $('key-mode').hidden = m !== 'key';
    $('switch').textContent = m === 'key' ? 'Type on the TV instead' : 'Paste a ' + KEYS[keyFor].name + ' key instead';
  }

  async function poll() {
    try {
      const s = await api('/api/state');
      $('dot').className = 'dot'; $('conn').textContent = 'Connected to your TV';
      if (s.keyFor && s.keyFor !== keyFor) { showKeyFor(s.keyFor); showMode(mode); }
      if (!pinned && s.mode !== mode) showMode(s.mode);
      $('field').textContent = s.label || 'the TV';
      $('text').type = s.kind === 'password' ? 'password' : 'text';
    } catch {
      $('dot').className = 'dot off'; $('conn').textContent = 'Can\\'t reach the TV';
    }
  }

  $('text-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('text').value;
    if (!text) return;
    try { await api('/api/text', { text }); $('text').value = ''; setStatus('text-status', 'Sent', 'good'); }
    catch { setStatus('text-status', 'Couldn\\'t send. Is the TV app still open?', 'bad'); }
    setTimeout(() => setStatus('text-status', ''), 1500);
  });

  for (const b of document.querySelectorAll('[data-key]')) {
    b.addEventListener('click', () => api('/api/key', { name: b.dataset.key }).catch(() => {}));
  }

  // Phones only let pages read the clipboard over https, and this page lives on your home network
  // (plain http). So the button tries, and otherwise opens the box ready for a long-press → Paste.
  $('paste').addEventListener('click', async () => {
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.readText) {
      try { $('key').value = (await navigator.clipboard.readText()).trim(); save(); return; } catch { /* fall through */ }
    }
    $('key').focus();
    $('key').select();
    setStatus('key-status', 'Long-press in the box above and tap Paste. It saves by itself.');
  });
  // Pasting into the box saves straight away: no extra tap.
  $('key').addEventListener('paste', () => setTimeout(() => { if ($('key').value.trim()) save(); }, 50));

  $('save').addEventListener('click', () => save());
  async function save() {
    const key = $('key').value.trim();
    if (!key) return setStatus('key-status', 'Paste your key first.', 'bad');
    const c = KEYS[keyFor];
    setStatus('key-status', 'Checking with ' + c.name + '…');
    try {
      const r = await api('/api/setkey', { key, kind: keyFor });
      if (r.ok) { setStatus('key-status', c.done, 'good'); $('key').value = ''; }
      else setStatus('key-status', {
        'not-a-key': c.notKey,
        'bad-key': c.name + ' didn\\'t accept that key. Check you copied all of it.',
        'bad-client': 'Trakt didn\\'t recognise that Client ID. Check you copied both codes.',
        'quota': 'That key has used up this month\\'s lookups.',
        'not-a-url': c.notKey,
        'unreachable': 'Couldn\\'t reach that address from the TV. Check it\\'s right, and that the TV can reach it.',
        'no-channels': 'That address answered, but there were no channels in it.',
      }[r.error] || 'Couldn\\'t check with ' + c.name + '. Try again.', 'bad');
    } catch { setStatus('key-status', 'Couldn\\'t reach the TV.', 'bad'); }
  }

  $('switch').addEventListener('click', () => { pinned = true; showMode(mode === 'key' ? 'text' : 'key'); });

  showKeyFor('tmdb');
  poll();
  setInterval(poll, 2000);
</script>
</body>
</html>`;

module.exports = { createPhoneRemote };
