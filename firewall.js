'use strict';

// Helps the phone remote through a firewall that blocks incoming connections.
//  - detect() works out which firewall is on, without admin rights.
//  - allow() asks for permission (the system's own password prompt, via pkexec) to open
//    the remote's port to this home network only, never the whole internet.
// The app never sees the password: it goes straight into the system's prompt.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BIN_DIRS = ['/usr/sbin', '/usr/bin', '/sbin', '/bin', '/usr/local/sbin', '/usr/local/bin'];
const COMMENT = 'sofa-king phone remote';

function findBin(name) {
  for (const dir of BIN_DIRS) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

// "192.168.1.23/22" -> "192.168.0.0/22"
function networkOf(cidr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(cidr || ''));
  if (!m) return null;
  const bits = Number(m[5]);
  if (bits < 8 || bits > 32) return null;
  const ip = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (ip & mask) >>> 0;
  return `${[24, 16, 8, 0].map((s) => (net >>> s) & 255).join('.')}/${bits}`;
}

const toInt = (ip) => ip.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
function inNetwork(ip, network) {
  const [base, bits] = String(network).split('/');
  if (!base || bits === undefined) return false;
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
}

// Which addresses count as "your home network". Not just this computer's own slice of it: mesh
// Wi-Fi and some routers hand phones addresses from a different slice (this PC 192.168.4.x, the
// phone 192.168.5.x), and a rule for the narrow slice would still block the phone. So the whole
// private range the computer is in, which never includes the internet.
const PRIVATE = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];
function homeRange(cidr) {
  const ip = String(cidr || '').split('/')[0];
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  return PRIVATE.find((n) => inNetwork(ip, n)) || networkOf(cidr);
}

const SAFE_NET = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const portText = (ports, sep) => (ports.from === ports.to ? String(ports.from) : `${ports.from}${sep}${ports.to}`);

// Does ufw already let the remote in from the whole of network? Its own rules file can usually
// be read without admin rights; when it can't, we don't know (null).
function ufwAllows(network, port) {
  if (!network) return null;
  const [base, bits] = network.split('/');
  let text;
  try { text = fs.readFileSync('/etc/ufw/user.rules', 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    const m = /^-A ufw-user-input\b(.*)-j ACCEPT/.exec(line.trim());
    if (!m) continue;
    const rule = m[1];
    if (/-p udp/.test(rule)) continue;
    // --dport 8765, --dport 8765:8774, or --dports 80,8765:8774 (several); none means every port.
    const spec = /--dports? (\S+)/.exec(rule);
    const hit = !spec || spec[1].split(',').some((part) => {
      const [a, b] = part.split(':').map(Number);
      return port >= a && port <= (b || a);
    });
    if (!hit) continue;
    const src = /-s (\S+)/.exec(rule);
    if (src && !(src[1].includes('/') && Number(src[1].split('/')[1]) <= Number(bits) && inNetwork(base, src[1]))) continue;
    return true;
  }
  return false;
}

// fw: { kind, bin, zone?, open } (open: true, false, or null when we can't tell).
async function detect({ port, cidr, iface, ports }) {
  const network = homeRange(cidr);
  const ufw = findBin('ufw');
  if (ufw) {
    let enabled = false;
    try { enabled = /^\s*ENABLED\s*=\s*yes/im.test(fs.readFileSync('/etc/ufw/ufw.conf', 'utf8')); } catch { /* unreadable */ }
    if (enabled) return { kind: 'ufw', bin: ufw, open: ufwAllows(network, port) };
  }
  const fwc = findBin('firewall-cmd');
  if (fwc) {
    const state = await run(fwc, ['--state']);
    if (state.code === 0 && /running/.test(state.stdout)) {
      // The rule has to go in the zone this network connection is in, which isn't always the
      // default one.
      let zone = iface ? (await run(fwc, [`--get-zone-of-interface=${iface}`])).stdout.trim() : '';
      if (!/^[\w-]+$/.test(zone)) zone = (await run(fwc, ['--get-default-zone'])).stdout.trim();
      if (!/^[\w-]+$/.test(zone)) zone = '';
      const z = zone ? [`--zone=${zone}`] : [];
      const q = await run(fwc, [...z, '--query-port', `${port}/tcp`]);
      let open = q.code === 0 && /yes/.test(q.stdout);
      if (!open && network && ports) {
        const r = await run(fwc, [...z, `--query-rich-rule=${richRule(network, ports)}`]);
        open = r.code === 0 && /yes/.test(r.stdout);
      }
      return { kind: 'firewalld', bin: fwc, zone, open };
    }
  }
  // Plain nftables/iptables rules can't be read without admin rights, so we can't tell.
  return { kind: 'none', open: null };
}

const richRule = (network, ports) =>
  `rule family="ipv4" source address="${network}" port port="${portText(ports, '-')}" protocol="tcp" accept`;

// The command a person could run themselves, and what we'll run through pkexec.
// ports: { from, to }, every port the remote might use (it tries a few in turn).
function plan(fw, network, ports) {
  if (!SAFE_NET.test(network) || !Number.isInteger(ports.from) || !Number.isInteger(ports.to)) return null;
  if (fw.kind === 'ufw') {
    const args = ['allow', 'from', network, 'to', 'any', 'port', portText(ports, ':'), 'proto', 'tcp', 'comment', COMMENT];
    return {
      display: `sudo ufw allow from ${network} to any port ${portText(ports, ':')} proto tcp comment '${COMMENT}'`,
      exec: [fw.bin, ...args],
    };
  }
  if (fw.kind === 'firewalld') {
    if (fw.zone && !/^[\w-]+$/.test(fw.zone)) return null;
    const z = fw.zone ? ` --zone=${fw.zone}` : '';
    const rule = richRule(network, ports);
    // Now (no reload, which would drop other changes made only for now) and after a restart.
    const script = `${fw.bin}${z} --add-rich-rule='${rule}' && ${fw.bin} --permanent${z} --add-rich-rule='${rule}'`;
    return {
      display: `sudo firewall-cmd${z} --add-rich-rule='${rule}' && sudo firewall-cmd --permanent${z} --add-rich-rule='${rule}'`,
      exec: ['/bin/sh', '-c', script],
    };
  }
  return null;
}

// ------------------------------------------------------------ typing the password without a keyboard

function steamRunning() {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try { if (fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'steam') return true; } catch { /* gone */ }
    }
  } catch { /* no /proc */ }
  return false;
}

function desktop() {
  const d = String(process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  if (d.includes('gnome')) return 'gnome';
  if (d.includes('kde')) return 'kde';
  return 'other';
}

// Which keyboard help we can offer: 'steam', 'gnome' (we switch its on-screen keyboard on), 'kde'.
function keyboardTips() {
  const tips = [];
  if (steamRunning()) tips.push('steam');
  const d = desktop();
  if (d === 'gnome' && findBin('gsettings')) tips.push('gnome');
  if (d === 'kde') tips.push('kde');
  return tips;
}

// Switch GNOME's on-screen keyboard on for the prompt; returns a function that puts it back.
async function enableGnomeKeyboard() {
  const gs = findBin('gsettings');
  if (!gs || desktop() !== 'gnome') return async () => {};
  const KEY = ['org.gnome.desktop.a11y.applications', 'screen-keyboard-enabled'];
  const cur = await run(gs, ['get', ...KEY]);
  if (cur.code !== 0 || cur.stdout.trim() !== 'false') return async () => {};
  await run(gs, ['set', ...KEY, 'true']);
  return async () => { await run(gs, ['set', ...KEY, 'false']); };
}

// ------------------------------------------------------------ allow

// What pkexec's failure means. 126: the person closed the prompt. 127: no prompt could be shown
// (no "authentication agent" running, as in Steam's Game Mode and other TV-style sessions), or
// the password was refused.
function pkexecError(r, command) {
  const said = (r.stderr || r.stdout).trim();
  if (r.code === 126) return { error: 'cancelled', command };
  if (/no authentication agent/i.test(said)) return { error: 'no-agent', command, detail: said.slice(0, 300) };
  if (r.code === 127) return { error: 'not-allowed', command, detail: said.slice(0, 300) };
  return { error: 'failed', detail: said.slice(0, 300), command };
}

async function allow(fw, network, ports) {
  const p = plan(fw, network, ports);
  if (!p) return { error: 'unsupported' };
  const pkexec = findBin('pkexec');
  if (!pkexec) return { error: 'no-agent', command: p.display };

  const restoreKeyboard = await enableGnomeKeyboard();
  try {
    const r = await run(pkexec, p.exec, 5 * 60 * 1000);
    if (r.code === 0) return { ok: true };
    return pkexecError(r, p.display);
  } finally {
    await restoreKeyboard();
  }
}

// When there's no system password prompt: the password typed on our own keyboard goes to sudo
// once, through its input, and nowhere else (not saved, not logged, not in any command line).
function allowWithPassword(fw, network, ports, password) {
  const p = plan(fw, network, ports);
  if (!p) return Promise.resolve({ error: 'unsupported' });
  const sudo = findBin('sudo');
  if (!sudo) return Promise.resolve({ error: 'no-sudo', command: p.display });
  return new Promise((resolve) => {
    // -S: read the password from input; -k: don't reuse an earlier sign-in; -p '': no prompt text.
    const child = execFile(sudo, ['-S', '-k', '-p', '', '--', ...p.exec], { timeout: 60 * 1000 }, (err, stdout, stderr) => {
      const said = String(stderr || stdout || '').trim();
      if (!err) return resolve({ ok: true });
      if (/incorrect password|sorry, try again|password attempts?/i.test(said)) return resolve({ error: 'wrong-password', command: p.display });
      if (/not in the sudoers|not allowed to/i.test(said)) return resolve({ error: 'not-sudoer', command: p.display });
      resolve({ error: 'failed', detail: said.slice(0, 300), command: p.display });
    });
    child.stdin.on('error', () => { /* sudo may finish before reading */ });
    child.stdin.end(`${password}\n`);
  });
}

module.exports = { detect, plan, allow, allowWithPassword, networkOf, homeRange, inNetwork, ufwAllows, keyboardTips };
