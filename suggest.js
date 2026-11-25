'use strict';

// Suggestions for the on-screen keyboards: as you type, a row of things to pick instead of
// spelling them out. They come from (in this order) what you searched for before, titles the
// screen already knows about (films and shows, artists and albums), and common words, which
// finish the word you're in the middle of. After an @, common email endings are offered instead.
//
// The words are data/words-en.txt: the 25,000 commonest words in film and TV subtitles, commonest
// first (from Hermit Dave's FrequencyWords, CC BY-SA 4.0), with swear words taken out.

const fs = require('fs');
const path = require('path');

const EMAIL_ENDS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'live.com', 'aol.com'];
const PAST_KEPT = 50;

// For comparing: small letters, no accents, punctuation as spaces.
const plain = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}']+/gu, ' ').trim();

function createSuggester({ wordsFile = path.join(__dirname, 'data', 'words-en.txt') } = {}) {
  let words = null; // read the first time it's needed
  const wordList = () => {
    if (!words) {
      try { words = fs.readFileSync(wordsFile, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean); } catch { words = []; }
    }
    return words;
  };

  // The word being typed (after the last space), finished from the list, commonest first. It
  // keeps your capital letter if you typed one.
  function finishWord(text, n) {
    const m = /(^|\s)([\p{L}']+)$/u.exec(text);
    if (!m) return [];
    const typed = m[2];
    const low = typed.toLowerCase();
    const head = text.slice(0, text.length - typed.length);
    const out = [];
    for (const w of wordList()) {
      const wl = w.toLowerCase();
      if (wl.length <= low.length || !wl.startsWith(low)) continue;
      let word = w;
      if (typed.length > 1 && typed === typed.toUpperCase() && typed !== low) word = w.toUpperCase();
      else if (typed[0] !== typed[0].toLowerCase()) word = w[0].toUpperCase() + w.slice(1);
      out.push({ label: word, value: `${head}${word} `, kind: 'word' });
      if (out.length >= n) break;
    }
    return out;
  }

  // After an @: gmail.com, outlook.com and so on.
  function emailEnds(text) {
    const m = /(^|\s)[^\s@]+@([^\s@]*)$/.exec(text);
    if (!m) return null;
    const part = m[2].toLowerCase();
    const head = text.slice(0, text.length - m[2].length);
    return EMAIL_ENDS.filter((e) => e.startsWith(part) && e !== part)
      .map((e) => ({ label: `@${e}`, value: `${head}${e}`, kind: 'word' }));
  }

  // Does this title fit what's typed so far? Every word typed must start one of its words (the
  // last one may be half typed).
  function fits(title, typed) {
    const have = plain(title).split(' ');
    return typed.every((t) => have.some((h) => h.startsWith(t)));
  }

  // text: what's typed. past: your earlier searches here, newest first. titles: names the screen
  // knows that could be meant. words: whether to finish words. Gives [{ label, value, kind }],
  // where value is the whole text once it's picked.
  function suggest(text, { past = [], titles = [], words: useWords = true, limit = 6 } = {}) {
    const t = String(text || '').replace(/^\s+/, '').slice(0, 300);
    const low = plain(t);
    const typed = low ? low.split(' ') : [];
    const out = [];
    const seen = new Set([low]);
    const add = (item) => {
      const key = plain(item.value);
      if (!key || seen.has(key) || out.length >= limit) return;
      seen.add(key);
      out.push(item);
    };
    // Earlier searches: those starting with what's typed first, then any that fit.
    const pastFit = past.filter((p) => !low || plain(p).startsWith(low));
    const pastAlso = low ? past.filter((p) => !pastFit.includes(p) && fits(p, typed)) : [];
    for (const p of [...pastFit, ...pastAlso].slice(0, low ? 3 : 5)) add({ label: p, value: p, kind: 'past' });
    if (!low) return out;
    let n = 0;
    for (const title of titles) {
      if (n >= 4) break;
      if (typeof title !== 'string' || !title.trim() || !fits(title, typed)) continue;
      const before = out.length;
      add({ label: title.trim(), value: title.trim(), kind: 'title' });
      if (out.length > before) n++;
    }
    const email = emailEnds(t);
    if (email) email.forEach(add);
    else if (useWords && !/\s$/.test(t)) finishWord(t, limit).forEach(add);
    return out;
  }

  return { suggest, finishWord };
}

// Remember a search: newest first, no repeats (ignoring capitals), at most 50.
function rememberIn(list, text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 100) return list;
  const key = plain(t);
  return [t, ...list.filter((p) => plain(p) !== key)].slice(0, PAST_KEPT);
}

module.exports = { createSuggester, rememberIn, plain };
