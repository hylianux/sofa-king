'use strict';

// Focus movement for our own screens. Any element with [data-nav] can take focus;
// arrows move to the nearest one in that direction, Enter activates, Escape goes back.
(function () {
  const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  function items() {
    return [...document.querySelectorAll('[data-nav]')].filter((el) => !el.disabled && el.offsetParent !== null);
  }

  const sound = (name) => { if (window.tvSound) window.tvSound(name); };

  // The nearest container around el that scrolls up and down.
  function scrollingParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  }

  // Arriving at the first or last thing in a scrolling box scrolls it all the way to that end, so
  // whatever's above the first (a heading) or below the last (a note) comes back into view.
  function showEnds(el) {
    for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
      if (box.scrollHeight <= box.clientHeight + 1 || box.hasAttribute('data-own-scroll')) continue; // (a list that scrolls itself)
      const style = getComputedStyle(box).overflowY;
      if (style !== 'auto' && style !== 'scroll') continue;
      const inBox = [...box.querySelectorAll('[data-nav]')].filter((x) => x.offsetParent && !x.disabled);
      if (inBox[0] === el) box.scrollTo({ top: 0 });
      else if (inBox[inBox.length - 1] === el) box.scrollTo({ top: box.scrollHeight });
    }
  }

  function centre(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function move(dir) {
    const all = items();
    if (!all.length) return;
    const cur = document.activeElement;
    if (!all.includes(cur)) return all[0].focus();

    const a = cur.getBoundingClientRect();
    const ac = centre(a);
    const vertical = dir === 'up' || dir === 'down';
    // Within a row of cards, left and right stay in that row: at either end, nothing happens
    // (no jumping into the row above or below).
    const row = vertical ? null : cur.closest('[data-row]');
    // A fenced area (a section of Settings): up, down and right stay inside it; only left can
    // leave (to the menu beside it).
    // A zone keeps up / down / right inside it (left can leave). data-zone="column" (a menu down
    // the side) only keeps down inside: right goes on to what it opens, up from the top to the tabs.
    let zone = dir === 'left' ? null : cur.closest('[data-zone]');
    if (zone && zone.dataset.zone === 'column' && dir !== 'down') zone = null;

    // Up and down look inside the scrolling list you're in first (rows of cards, a settings tab,
    // a grid), even at things scrolled out of sight, before anything outside it. Otherwise the
    // menu at the top of the screen looks "nearer" than a row that has scrolled off the top.
    const scroller = vertical ? scrollingParent(cur) : null;

    const pick = (inside) => {
      let best = null;
      let bestScore = Infinity;
      for (const el of all) {
        if (el === cur) continue;
        if (row && !row.contains(el)) continue;
        if (zone && !zone.contains(el)) continue;
        if (inside && !inside.contains(el)) continue;
        const b = el.getBoundingClientRect();
        const inDirection =
          dir === 'up' ? b.bottom <= a.top + 1 :
          dir === 'down' ? b.top >= a.bottom - 1 :
          dir === 'left' ? b.right <= a.left + 1 :
          b.left >= a.right - 1;
        if (!inDirection) continue;
        // Left and right only ever go along the same line: never up or down as well. (At the end
        // of a line, nothing happens.)
        if (!vertical && !(b.top < a.bottom - 1 && b.bottom > a.top + 1)) continue;
        // (Nor to something scrolled out of sight that happens to be level with you.)
        if (!vertical) {
          const box = scrollingParent(el);
          if (box) { const r = box.getBoundingClientRect(); const mid = (b.top + b.bottom) / 2; if (mid < r.top || mid > r.bottom) continue; }
        }
        // Distance between the edges, not the centres: a wide toggle right below a small button
        // is "straight down" even though its centre is far to the right.
        const along = vertical
          ? Math.max(0, dir === 'down' ? b.top - a.bottom : a.top - b.bottom)
          : Math.max(0, dir === 'right' ? b.left - a.right : a.left - b.right);
        const across = vertical
          ? Math.max(0, b.left - a.right, a.left - b.right)
          : Math.max(0, b.top - a.bottom, a.top - b.bottom);
        const bc = centre(b);
        const drift = vertical ? Math.abs(bc.x - ac.x) : Math.abs(bc.y - ac.y); // tie-break: most in line
        const score = along + across * 2 + drift * 0.01;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      return best;
    };
    let best = (scroller && pick(scroller)) || pick(null);
    // Leaving a fenced section to the left, for the menu beside it: always back to the menu's
    // chosen item (the section you're in), whatever's level with you, and wherever it is.
    if (dir === 'left' && cur.closest('[data-zone]:not([data-zone="column"])')) {
      const inZone = best && cur.closest('[data-zone]').contains(best);
      if (!inZone) {
        const panel = cur.closest('[data-zone]').parentElement && cur.closest('[data-zone]').parentElement.parentElement;
        const menu = panel && panel.querySelector('[data-zone="column"]');
        const chosen = menu && (menu.querySelector('.chosen[data-nav]') || [...menu.querySelectorAll('[data-nav]')].find((x) => x.offsetParent));
        if (chosen) best = chosen;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      showEnds(best);
      sound('move');
    } else {
      sound('edge'); // nowhere to go that way
    }
  }

  document.addEventListener('keydown', (e) => {
    if (ARROWS[e.key]) {
      e.preventDefault();
      move(ARROWS[e.key]);
    } else if (e.key === 'Enter' && document.activeElement && document.activeElement.matches('[data-nav]')) {
      sound('select');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sound('back');
      // The page gets first go at "back" (e.g. close a detail screen); otherwise tell the app.
      const handled = !document.dispatchEvent(new CustomEvent('tvback', { cancelable: true }));
      if (!handled && window.tv) window.tv.action('back');
    }
  });

  window.tvNav = {
    focusFirst() {
      const first = items()[0];
      if (first) first.focus();
    },
    focusIn(container) {
      const first = items().find((el) => container.contains(el));
      if (first) first.focus();
    },
  };
})();
