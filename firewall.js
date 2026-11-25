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

const SAFE_NET = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

async function detect(port) {
  const ufw = findBin('ufw');
  if (ufw) {
    let enabled = false;
    try { enabled = /^\s*ENABLED\s*=\s*yes/im.test(fs.readFileSync('/etc/ufw/ufw.conf', 'utf8')); } catch { /* unreadable */ }
    if (enabled) return { kind: 'ufw', bin: ufw };
  }
  const fwc = findBin('firewall-cmd');
  if (fwc) {
    const state = await run(fwc, ['--state']);
    if (state.code === 0 && /running/.test(state.stdout)) {
      const q = await run(fwc, ['--query-port', `${port}/tcp`]);
      return { kind: 'firewalld', bin: fwc, open: q.code === 0 && /yes/.test(q.stdout) };
    }
  }
  // Plain nftables/iptables rules can't be read without admin rights, so we can't tell.
  return { kind: 'none' };
}

// The command a person could run themselves, and what we'll run through pkexec.
function plan(fw, network, port) {
  if (!SAFE_NET.test(network) || !Number.isInteger(port)) return null;
  if (fw.kind === 'ufw') {
    const args = ['allow', 'from', network, 'to', 'any', 'port', String(port), 'proto', 'tcp', 'comment', COMMENT];
    return {
      display: `sudo ufw allow from ${network} to any port ${port} proto tcp comment '${COMMENT}'`,
      exec: [fw.bin, ...args],
    };
  }
  if (fw.kind === 'firewalld') {
    const rule = `rule family="ipv4" source address="${network}" port port="${port}" protocol="tcp" accept`;
    const script = `${fw.bin} --permanent --add-rich-rule='${rule}' && ${fw.bin} --reload`;
    return {
      display: `sudo firewall-cmd --permanent --add-rich-rule='${rule}' && sudo firewall-cmd --reload`,
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

async function allow(fw, network, port) {
  const p = plan(fw, network, port);
  if (!p) return { error: 'unsupported' };
  const pkexec = findBin('pkexec');
  if (!pkexec) return { error: 'no-pkexec', command: p.display };

  const restoreKeyboard = await enableGnomeKeyboard();
  try {
    const r = await run(pkexec, p.exec, 5 * 60 * 1000);
    if (r.code === 0) return { ok: true };
    // 126: the person closed the prompt; 127: wrong password or no password agent running.
    if (r.code === 126 || r.code === 127) return { error: 'cancelled', command: p.display };
    return { error: 'failed', detail: (r.stderr || r.stdout).trim().slice(0, 300), command: p.display };
  } finally {
    await restoreKeyboard();
  }
}

module.exports = { detect, plan, allow, networkOf, keyboardTips };
