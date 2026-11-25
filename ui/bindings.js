'use strict';

// Button names, and filling in <kbd data-bind="action"> hints with whichever button does that action.
(function () {
  const NAMES = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
    8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'Home',
  };
  const nameOf = (i) => (i == null ? '—' : NAMES[i] || `Button ${i}`);

  let current = {};
  function label(bindings) {
    current = bindings || {};
    for (const k of document.querySelectorAll('[data-bind]')) {
      const i = bindings[k.dataset.bind];
      k.textContent = nameOf(i);
      k.parentElement.hidden = i == null; // an action with no button: don't advertise it
    }
  }

  // The button for an action (its name), as set in Settings → Controller.
  const buttonFor = (action) => (current[action] == null ? '' : nameOf(current[action]));
  window.tvButtons = { nameOf, label, buttonFor };
  if (window.tv && window.tv.bindings) {
    window.tv.bindings().then(label);
    window.tv.onBindings(label);
  }
})();
