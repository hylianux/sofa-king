'use strict';

// The on-screen keyboard: used for typing into websites (in the menu page) and for "type a name"
// screens in Home. Moving around it is done here (a highlighted key, not real focus), so the same
// keyboard works whether or not the page it's in has focus.
//
//   - Hold L2 or R2: capitals, and the second character on the number and punctuation keys.
//   - Press L2 and R2 together: caps lock on (again: off). With caps lock on, holding either one
//     types small letters.
//   - Left and right loop around each row.
//   - The keys that have a button of their own show it (Delete, Space, Shift, Done).
//   - Start: Done. Asks "are you sure?" first (and B asks before cancelling), unless that's
//     switched off in Settings → Controller.
//   - Suggestions (when the page asks for them): a row above the keys, reached with Up. Picking
//     one puts it in what you've typed and goes back to the key you came from. The row keeps its
//     height while it's empty, so the keys never move as suggestions come and go.
(function () {
  const LETTERS = [
    [...'1234567890'],
    [...'qwertyuiop'],
    [...'asdfghjkl-'],
    ['⇧', ...'zxcvbnm', '.', '/'],
  ];
  const SYMBOLS = [
    [...'1234567890'],
    [...'!@#$%^&*()'],
    [...'-_=+[]{};:'],
    [...'\'",.<>/?\\|'],
  ];
  // The second character of each key, with Shift (L2 / R2) held.
  const ALT = {
    1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')',
    '-': '_', '.': '>', '/': '?', ',': '<', ';': ':', "'": '"', '=': '+', '[': '{', ']': '}', '\\': '|',
  };
  const isLetter = (k) => k.length === 1 && /[a-z]/.test(k);

  function create({ root, extras = {}, onType, onErase, onSubmit, onCancel, onNext, onPick, confirm = () => true, buttonName = () => '', describe = () => '' }) {
    const kb = {
      layout: 'letters', held: new Set(), caps: false, chord: false, sel: null, dialog: null, keys: [],
      suggOn: false, sugg: [], suggRow: null, chips: [], cameFrom: null,
    };

    const bottomRow = () => [kb.layout === 'letters' ? '?123' : 'ABC', 'space', ...(extras.com ? ['.com'] : []), '⌫', ...(extras.next ? ['Next'] : []), 'Done'];
    const shiftHeld = () => kb.held.size > 0;
    const upper = () => kb.caps !== shiftHeld(); // caps lock, flipped while L2 / R2 is held
    const charOf = (k) => {
      if (isLetter(k)) return upper() ? k.toUpperCase() : k;
      if (shiftHeld() && ALT[k] && kb.layout === 'letters') return ALT[k];
      return k;
    };
    const LABEL = { space: 'Space', '⌫': '⌫ Delete', Done: 'Done' };
    const CLASS = { '⇧': 'fn', '?123': 'fn mid', ABC: 'fn mid', space: 'space', '.com': 'fn mid', '⌫': 'fn mid', Next: 'fn mid', Done: 'done mid' };
    // Which button does each special key (shown on the key).
    const BADGE = { '⌫': ['delete'], space: ['playpause'], Done: ['menu'], '⇧': ['rclick', 'lclick'] };

    function render(keepKey) {
      root.replaceChildren();
      root.classList.add('tvkb');
      kb.keys = [];
      for (const row of [...(kb.layout === 'letters' ? LETTERS : SYMBOLS), bottomRow()]) {
        const r = document.createElement('div');
        r.className = 'kb-row';
        for (const k of row) {
          const key = document.createElement('div');
          key.className = `k${CLASS[k] ? ` ${CLASS[k]}` : ''}`;
          key.dataset.k = k;
          const face = document.createElement('span');
          face.className = 'face';
          key.append(face);
          const names = (BADGE[k] || []).map((a) => buttonName(a)).filter((n) => n && n !== '—');
          if (names.length) {
            const b = document.createElement('kbd');
            b.className = 'kb-badge';
            b.textContent = names.join('/');
            key.append(b);
          }
          key.addEventListener('click', () => { select(key); press(k); });
          r.append(key);
          kb.keys.push(key);
        }
        root.append(r);
      }
      // A line above the keys saying what L2 / R2 do, and whether Shift or caps lock is on now.
      const help = document.createElement('p');
      help.className = 'kb-help';
      root.prepend(help);
      kb.help = help;
      kb.suggRow = null;
      kb.chips = [];
      if (kb.suggOn) {
        kb.suggRow = document.createElement('div');
        kb.suggRow.className = 'kb-row kb-sugg';
        help.after(kb.suggRow);
        fillSuggestions();
      }
      relabel();
      const keep = keepKey && kb.keys.find((n) => n.dataset.k === keepKey);
      select(keep || kb.keys.find((n) => n.dataset.k === 'q') || kb.keys.find((n) => n.dataset.k === '!') || kb.keys[0]);
    }

    // The keys' faces follow Shift and caps lock as they change.
    function relabel() {
      for (const key of kb.keys) {
        const k = key.dataset.k;
        key.querySelector('.face').textContent = LABEL[k] || (k === '⇧' ? (kb.caps ? '⇪' : '⇧') : charOf(k));
        if (k === '⇧') key.classList.toggle('on', kb.caps || shiftHeld());
      }
      if (kb.help) {
        const l = buttonName('lclick') || 'L2';
        const r = buttonName('rclick') || 'R2';
        const state = kb.caps ? (shiftHeld() ? 'Caps lock on · Shift held: small letters' : 'Caps lock on')
          : (shiftHeld() ? 'Shift held' : '');
        kb.help.textContent = `${l} or ${r} alone: hold for Shift · ${l} + ${r} together: caps lock on / off`;
        if (state) { const st = document.createElement('b'); st.textContent = ` — ${state}`; kb.help.append(st); }
      }
      root.classList.toggle('shifted', shiftHeld());
      root.classList.toggle('caps', kb.caps);
    }

    // The suggestion row's chips, from kb.sugg. If the highlight was on a chip, it stays at the
    // same place in the row (or goes back to the keys when the row is empty).
    function fillSuggestions() {
      if (!kb.suggRow) return;
      const at = kb.chips.indexOf(kb.sel);
      kb.chips = kb.sugg.map((item) => {
        const chip = document.createElement('div');
        chip.className = `k sugg ${item.kind || ''}`;
        const face = document.createElement('span');
        face.className = 'face';
        face.textContent = item.label;
        chip.append(face);
        chip.tvItem = item;
        chip.addEventListener('click', () => pick(chip));
        return chip;
      });
      kb.suggRow.replaceChildren(...kb.chips);
      if (at >= 0) {
        if (kb.chips.length) select(kb.chips[Math.min(at, kb.chips.length - 1)]);
        else select(kb.cameFrom && kb.cameFrom.isConnected ? kb.cameFrom : kb.keys[0]);
      }
    }
    function pick(chip) {
      if (onPick) onPick(chip.tvItem);
      select(kb.cameFrom && kb.cameFrom.isConnected ? kb.cameFrom : kb.keys.find((n) => n.dataset.k === 'q') || kb.keys[0]);
    }

    function select(node) {
      if (node && kb.chips.includes(node) && !kb.chips.includes(kb.sel)) kb.cameFrom = kb.sel;
      if (kb.sel) kb.sel.classList.remove('sel');
      kb.sel = node;
      if (node) node.classList.add('sel');
    }

    function move(dir) {
      if (!kb.sel) return select(kb.keys[0]);
      const a = kb.sel.getBoundingClientRect();
      const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
      const vertical = dir === 'up' || dir === 'down';
      if (!vertical) {
        // Along the row, looping round at either end.
        const row = [...kb.sel.parentElement.children];
        const i = row.indexOf(kb.sel);
        return select(row[(i + (dir === 'right' ? 1 : -1) + row.length) % row.length]);
      }
      let best = null;
      let bestScore = Infinity;
      for (const n of [...kb.chips, ...kb.keys]) {
        if (n === kb.sel) continue;
        const b = n.getBoundingClientRect();
        if (dir === 'up' ? b.bottom > a.top + 1 : b.top < a.bottom - 1) continue;
        const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        const score = Math.abs(bc.y - ac.y) + Math.abs(bc.x - ac.x) * 2;
        if (score < bestScore) { bestScore = score; best = n; }
      }
      if (best) select(best);
    }

    function press(k) {
      switch (k) {
        case '⇧': kb.caps = !kb.caps; relabel(); break;
        case '?123': kb.layout = 'symbols'; render('ABC'); break;
        case 'ABC': kb.layout = 'letters'; render('?123'); break;
        case 'space': onType(' '); break;
        case '.com': onType('.com'); break;
        case '⌫': onErase(); break;
        case 'Next': if (onNext) onNext(); break;
        case 'Done': ask('submit'); break;
        default: onType(charOf(k));
      }
    }

    // ---------------------------------------------------------------- "are you sure?"
    function ask(kind) {
      if (!confirm()) return finish(kind, true);
      const box = document.createElement('div');
      box.className = 'kb-dialog';
      const text = describe();
      const q = document.createElement('p');
      q.className = 'kb-q';
      q.textContent = kind === 'submit'
        ? (text ? `Send “${text.length > 40 ? `${text.slice(0, 40)}…` : text}”?` : 'Send it empty?')
        : 'Cancel? What you typed will be lost.';
      const btns = document.createElement('div');
      btns.className = 'kb-dialog-btns';
      // Both answers look alike until chosen: the chosen one is lit up and the other fades back
      // (a coloured "Yes" used to look chosen when it wasn't).
      const no = document.createElement('div');
      no.className = 'k mid choice sel';
      no.textContent = 'No, keep typing';
      const yes = document.createElement('div');
      yes.className = 'k mid choice';
      yes.textContent = kind === 'submit' ? 'Yes, send it' : 'Yes, cancel';
      no.addEventListener('click', () => closeDialog());
      yes.addEventListener('click', () => finish(kind, true));
      btns.append(no, yes);
      const how = document.createElement('p');
      how.className = 'kb-dialog-how';
      how.textContent = `Left / right to choose · ${buttonName('ok') || 'A'} to answer · ${buttonName('back') || 'B'}: keep typing`;
      box.append(q, btns, how);
      root.append(box);
      kb.dialog = { kind, box, no, yes, onYes: false };
      if (window.tvSound) window.tvSound('open');
    }
    function closeDialog() {
      if (!kb.dialog) return;
      kb.dialog.box.remove();
      kb.dialog = null;
      if (window.tvSound) window.tvSound('close');
    }
    function finish(kind, yes) {
      closeDialog();
      if (!yes) return;
      if (kind === 'submit') onSubmit(); else onCancel();
    }
    function dialogAction(action) {
      const d = kb.dialog;
      if (action === 'left' || action === 'right') {
        d.onYes = !d.onYes;
        d.no.classList.toggle('sel', !d.onYes);
        d.yes.classList.toggle('sel', d.onYes);
        if (window.tvSound) window.tvSound('move');
      } else if (action === 'ok') {
        finish(d.kind, d.onYes);
      } else if (action === 'back' || action === 'esc') {
        closeDialog();
      }
      return true;
    }

    // ---------------------------------------------------------------- buttons
    // A press (up / down / left / right / ok / back / esc / delete / playpause / menu).
    function handle(action) {
      if (kb.dialog) return dialogAction(action);
      if (['up', 'down', 'left', 'right'].includes(action)) { move(action); if (window.tvSound) window.tvSound('move'); return true; }
      if (action === 'ok' && kb.sel && kb.chips.includes(kb.sel)) { pick(kb.sel); if (window.tvSound) window.tvSound('type'); return true; }
      if (action === 'ok' && kb.sel) { press(kb.sel.dataset.k); if (window.tvSound) window.tvSound('type'); return true; }
      if (action === 'delete') { onErase(); return true; }
      if (action === 'playpause') { onType(' '); return true; }
      if (action === 'menu') { ask('submit'); return true; }
      if (action === 'back' || action === 'esc') { ask('cancel'); return true; }
      return false;
    }
    // L2 / R2 (or Shift on a real keyboard) held down or let go.
    function hold(action, down) {
      if (down) {
        // The second one going down while the first is held: caps lock on / off.
        if (kb.held.size === 1 && !kb.held.has(action)) { kb.caps = !kb.caps; kb.chord = true; }
        kb.held.add(action);
      } else {
        kb.held.delete(action);
        if (!kb.held.size) kb.chord = false;
      }
      relabel();
    }
    // suggest: whether this keyboard shows a suggestion row this time.
    function reset({ suggest = false } = {}) {
      kb.layout = 'letters'; kb.caps = false; kb.held.clear(); kb.chord = false;
      kb.suggOn = Boolean(suggest); kb.sugg = []; kb.chips = []; kb.cameFrom = null;
      closeDialog();
      render();
    }
    // New suggestions ([{ label, value, kind }]); an empty list empties the row.
    function suggestions(list) {
      if (!kb.suggOn) return;
      kb.sugg = Array.isArray(list) ? list.slice(0, 6) : [];
      fillSuggestions();
    }
    return { render, handle, hold, reset, suggestions, get dialogOpen() { return Boolean(kb.dialog); } };
  }

  window.TVKeyboard = { create };
})();
