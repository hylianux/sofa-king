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

const kb = { buffer: '', field: null, confirm: true, suggest: true, timer: 0, seq: 0 };

// The keys themselves (and Shift, caps lock, "are you sure?"): see keyboard.js.
const keys = window.TVKeyboard.create({
  root: $('kb-rows'),
  extras: { com: true, next: true },
  onType: (t) => type(t),
  onErase: () => erase(),
  onNext: () => window.tv.kbKey('Tab'),
  onSubmit: () => {
    window.tvSound('close');
    if (kb.field && kb.field.kind === 'search' && kb.buffer.trim()) window.tv.suggestRemember(kb.buffer, 'web');
    window.tv.kbClose(true);
  },
  onPick: (item) => replaceWith(item.value),
  onCancel: () => { window.tvSound('close'); window.tv.kbClose(false); },
  confirm: () => kb.confirm,
  buttonName: (a) => window.tvButtons.buttonFor(a),
  describe: () => (kb.field && kb.field.kind === 'password' ? '•'.repeat(kb.buffer.length) : kb.buffer),
});

// Suggestions (not for passwords), after a short pause in typing. The app answers for the field
// that's focused on the website: search boxes get titles and earlier searches too.
const suggesting = () => kb.suggest && !(kb.field && kb.field.kind === 'password');
function suggestSoon() {
  if (!suggesting()) return;
  clearTimeout(kb.timer);
  kb.timer = setTimeout(async () => {
    const seq = ++kb.seq;
    const list = await window.tv.suggest(kb.buffer, 'web');
    if (seq === kb.seq && !$('kb').hidden) keys.suggestions(list);
  }, 250);
}

// A suggestion picked: delete back to where it differs from what's typed, then type the rest.
function replaceWith(value) {
  let same = 0;
  while (same < kb.buffer.length && same < value.length && kb.buffer[same] === value[same]) same++;
  for (let i = kb.buffer.length; i > same; i--) window.tv.kbKey('Backspace');
  const rest = value.slice(same);
  kb.buffer = value;
  if (rest) window.tv.kbType(rest);
  showBuffer();
}

function showBuffer() {
  const secret = kb.field && kb.field.kind === 'password';
  $('kb-text').textContent = secret ? '•'.repeat(kb.buffer.length) : kb.buffer;
  $('kb-preview').classList.toggle('empty', !kb.buffer);
  $('kb-preview').classList.toggle('secret', secret);
  const p = $('kb-preview');
  p.scrollLeft = p.scrollWidth;
  suggestSoon();
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
  kb.suggest = state.suggest !== false;
  kb.field = field || { label: 'Text', kind: 'text' };
  keys.reset({ suggest: suggesting() });
  setField(field);
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

// Another field focused while the keyboard is up (Next, or the website moved on by itself).
window.tv.onKbField((field) => {
  const was = suggesting();
  kb.field = field || { label: 'Text', kind: 'text' };
  if (was !== suggesting()) keys.reset({ suggest: suggesting() });
  else keys.suggestions([]);
  setField(field);
});

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
