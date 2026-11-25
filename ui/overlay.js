'use strict';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ menu

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => window.tv.action(button.dataset.action));
}

function showMenu({ service }) {
  window.tvSound('open');
  $('confirm-quit').hidden = true;
  $('kb').hidden = true;
  $('menu').hidden = false;
  $('notice').hidden = true;

  const watching = Boolean(service);
  $('eyebrow').textContent = watching ? (service.grabKey ? 'Setting up' : 'Now watching') : 'Menu';
  $('title').textContent = watching ? service.name : 'Home';
  $('resume').textContent = 'Close menu';
  $('home').textContent = (service && service.returnLabel) || 'Back to home';
  $('home').hidden = !watching;
  $('reload').hidden = !watching;
  $('grab-key').hidden = !(service && service.grabKey);
  if (service && service.grabLabel) $('grab-key').textContent = service.grabLabel;

  (service && service.grabKey ? $('grab-key') : $('resume')).focus();
}

// Quitting asks first (the app tells us to show the question, and to drop it on Back).
window.tv.onConfirmQuit((show) => {
  $('confirm-quit').hidden = !show;
  if (show) $('cq-cancel').focus();
  else $('quit').focus();
});

window.tv.onNotice((text) => {
  $('notice').textContent = text;
  $('notice').hidden = false;
});

// ------------------------------------------------------------ keyboard
//
// The website keeps keyboard focus while this is up, so keys here are "selected" with a
// class rather than real focus, and the app forwards controller presses to us.

const kb = { buffer: '', field: null, confirm: true };

// The keys themselves (and Shift, caps lock, "are you sure?"): see keyboard.js.
const keys = window.TVKeyboard.create({
  root: $('kb-rows'),
  extras: { com: true, next: true },
  onType: (t) => type(t),
  onErase: () => erase(),
  onNext: () => window.tv.kbKey('Tab'),
  onSubmit: () => { window.tvSound('close'); window.tv.kbClose(true); },
  onCancel: () => { window.tvSound('close'); window.tv.kbClose(false); },
  confirm: () => kb.confirm,
  buttonName: (a) => window.tvButtons.buttonFor(a),
  describe: () => (kb.field && kb.field.kind === 'password' ? '•'.repeat(kb.buffer.length) : kb.buffer),
});

function showBuffer() {
  const secret = kb.field && kb.field.kind === 'password';
  $('kb-text').textContent = secret ? '•'.repeat(kb.buffer.length) : kb.buffer;
  $('kb-preview').classList.toggle('empty', !kb.buffer);
  $('kb-preview').classList.toggle('secret', secret);
  const p = $('kb-preview');
  p.scrollLeft = p.scrollWidth;
}

function type(text) {
  kb.buffer += text;
  window.tv.kbType(text);
  showBuffer();
}

function erase() {
  kb.buffer = kb.buffer.slice(0, -1);
  window.tv.kbKey('Backspace');
  showBuffer();
}

function setField(field) {
  kb.field = field || { label: 'Text', kind: 'text' };
  kb.buffer = '';
  $('kb-label').textContent = kb.field.label;
  showBuffer();
}

function showKeyboard(state) {
  const { field, phone } = state;
  $('menu').hidden = true;
  $('kb').hidden = false;
  kb.confirm = state.kbConfirm !== false;
  setField(field);
  keys.reset();
  $('kb-phone').hidden = !phone;
  // The QR code is an SVG the app generated itself from the remote's link.
  if (phone) $('kb-qr').innerHTML = phone.qr;
  $('kb-addr').textContent = phone ? phone.address || '' : '';
  clearTimeout(kb.troubleTimer);
  $('kb-trouble').hidden = true;
  if (phone && !phone.seen) kb.troubleTimer = setTimeout(() => { $('kb-trouble').hidden = false; }, 15000);
}

window.tv.onKbPad((action) => {
  if (action === 'keyboard') { window.tvSound('close'); window.tv.kbClose(false); return; }
  keys.handle(action);
});
// L2 / R2 held or let go (on the website's page, sent on by the app): Shift and caps lock.
window.tv.onKbHold((action, down) => keys.hold(action, down));

window.tv.onKbField((field) => setField(field));

window.tv.onPhoneConnected(() => {
  clearTimeout(kb.troubleTimer);
  $('kb-trouble').hidden = true;
});

window.tv.onKbTyped((text) => {
  kb.buffer = text === '\b' ? kb.buffer.slice(0, -1) : kb.buffer + text;
  showBuffer();
});

// ------------------------------------------------------------ mode switch

window.tv.onOverlayState((state) => {
  document.body.classList.toggle('less-motion', state.motion === false);
  if (state.mode === 'keyboard') showKeyboard(state);
  else showMenu(state);
});

if (window.tv.onMotion) window.tv.onMotion((on) => document.body.classList.toggle('less-motion', !on));
