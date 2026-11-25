'use strict';

// Sound effects for moving around and choosing things. A sound set (Settings → Look → Sounds) is a
// recipe in JSON: each event is a list of notes made on the fly, or an audio file of your own.
// See themes/README.md for the recipe format. Switch sounds off in Settings → Controller.
//
// Events: move, select, back, edge (can't go further), open (a menu), close, type (a key on the
// keyboard), screen (a new screen or view).
(function () {
  let on = true;
  let ctx = null;
  let set = null;          // the sound set from the app: { id, volume, reverb, sounds: { event: notes | file } }
  let buffers = {};        // event -> decoded audio, for sets with audio files
  let reverbFor = null;    // { key, node }
  let instrument = '';     // play every note on this instrument instead (Settings → Look → Instrument)
  let kind = 'synth';      // what that instrument is: 'synth' (made here), 'tone' (Tone.js) or 'recorded'
  let samples = [];        // a recorded instrument's notes: [{ midi, buffer }], lowest first
  let soundFx = [];        // effects on the whole sound: bitcrush, chorus, phaser, delay

  const audio = () => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  // What every set falls back to for events it leaves out.
  const CLASSIC = {
    move: [{ w: 'triangle', f: 1250, to: 1150, d: 0.035, v: 0.035 }],
    select: [{ f: 880, d: 0.05, v: 0.06 }, { f: 1320, at: 0.045, d: 0.08, v: 0.055 }],
    back: [{ f: 700, d: 0.05, v: 0.055 }, { f: 470, at: 0.045, d: 0.08, v: 0.05 }],
    edge: [{ w: 'triangle', f: 220, to: 160, d: 0.06, v: 0.07 }],
    open: [{ f: 523, d: 0.06, v: 0.05 }, { f: 659, at: 0.04, d: 0.06, v: 0.05 }, { f: 784, at: 0.08, d: 0.1, v: 0.05 }],
    close: [{ f: 784, d: 0.05, v: 0.045 }, { f: 523, at: 0.045, d: 0.08, v: 0.045 }],
    type: [{ w: 'triangle', f: 1500, to: 1400, d: 0.025, v: 0.03 }],
    screen: [{ f: 660, to: 700, d: 0.05, v: 0.03 }],
  };

  // Pitches can be numbers (Hz) or note names: "A4" is 440, "C#5", "Eb3"...
  const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  function hz(v) {
    if (typeof v === 'number') return v;
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(v || '').trim());
    if (!m) return 0;
    const semis = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
    return 440 * Math.pow(2, semis / 12);
  }

  // The same notes on a different instrument. Each turns one note into the notes that make its sound.
  // (Noise, like static or a shaker, stays as it is.)
  const INSTRUMENTS = {
    chime: (n) => [{ ...n, w: 'sine', a: 0.002, d: Math.max(0.25, n.d * 3), lp: 0, drive: 0 },
      { ...n, w: 'sine', f: n.f * 2.76, to: n.to && n.to * 2.76, a: 0.001, d: Math.max(0.12, n.d * 1.5), v: n.v * 0.3, lp: 0, drive: 0 }],
    marimba: (n) => [{ ...n, w: 'sine', a: 0.002, d: Math.max(0.14, n.d * 2), lp: 0, drive: 0, vib: null },
      { ...n, w: 'sine', f: n.f * 4, to: n.to && n.to * 4, a: 0.001, d: 0.04, v: n.v * 0.4, lp: 0, drive: 0, vib: null }],
    pluck: (n) => [{ ...n, w: 'sawtooth', a: 0.002, d: Math.max(0.2, n.d * 3), lp: Math.min(7000, n.f * 6), lpTo: n.f * 1.2, drive: 0 }],
    organ: (n) => [{ ...n, w: 'sine', a: 0.012, lp: 0, drive: 0 }, { ...n, w: 'sine', f: n.f * 2, to: n.to && n.to * 2, v: n.v * 0.5, lp: 0, drive: 0 },
      { ...n, w: 'sine', f: n.f * 3, to: n.to && n.to * 3, v: n.v * 0.25, lp: 0, drive: 0 }],
    retro: (n) => [{ ...n, w: 'square', v: n.v * 0.7, lp: 0, drive: 0 }],
    soft: (n) => [{ ...n, w: 'sine', a: Math.max(0.015, n.a || 0), v: n.v * 0.8, lp: 0, drive: 0 }],
  };

  // ------------------------------------------------------------ building blocks

  let noiseBuf = null;
  function noise(a) {
    if (noiseBuf) return noiseBuf;
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // A room: a burst of noise that dies away, made once per set. dark: how muffled it is.
  function reverb(a) {
    const r = set && set.reverb;
    if (!r || !(r.mix > 0)) return null;
    const time = Math.min(6, Math.max(0.2, r.time || 1.5));
    const key = `${set.id}:${time}:${r.dark || 0}`;
    if (reverbFor && reverbFor.key === key) return reverbFor.node;
    const len = Math.floor(a.sampleRate * time);
    const ir = a.createBuffer(2, len, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last + (white - last) * (1 - Math.min(0.95, r.dark || 0)); // darker: smoother noise
        d[i] = last * Math.pow(1 - i / len, 2.2);
      }
    }
    const conv = a.createConvolver();
    conv.buffer = ir;
    const wet = a.createGain();
    wet.gain.value = Math.min(1, r.mix);
    conv.connect(wet).connect(a.destination);
    reverbFor = { key, node: conv };
    return conv;
  }

  function shaper(a, amount) {
    const ws = a.createWaveShaper();
    const k = amount * 100;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    ws.curve = curve;
    return ws;
  }

  // Where every sound goes: through the sound effects (if any are on), and into the room if the
  // pack has one.
  function out(a) {
    const master = a.createGain();
    master.gain.value = Math.min(2, Math.max(0, set && set.volume != null ? set.volume : 1));
    master.connect(a === ctx ? fxInput(a) : a.destination);
    const room = reverb(a);
    if (room) master.connect(room);
    return master;
  }

  // ------------------------------------------------------------ sound effects (Settings → Look)
  //
  // One chain, made once for the effects that are on: bitcrush (here), then chorus, phaser and
  // echo (from Tone.js, once it has loaded). Sounds go straight out until the chain is ready.
  let chain = null; // { key, input }
  function fxInput(a) {
    const key = soundFx.join('+');
    if (!key) return a.destination;
    if (chain && chain.key === key && chain.ready) return chain.input;
    if (!chain || chain.key !== key) buildChain(a, key);
    return chain.ready ? chain.input : a.destination;
  }
  function buildChain(a, key) {
    const old = chain;
    chain = { key, input: a.createGain(), ready: false, nodes: [] };
    const mine = chain;
    if (old) setTimeout(() => { try { old.input.disconnect(); for (const n of old.nodes) n.dispose ? n.dispose() : n.disconnect(); } catch { /* gone */ } }, 3000);
    const wantTone = soundFx.some((id) => id !== 'bitcrush');
    const finish = (Tone) => {
      if (chain !== mine) return;
      let last = mine.input;
      if (soundFx.includes('bitcrush')) {
        // Fewer steps of loudness (5 bits), and a little muffled: the sound of an old sampler.
        const crush = a.createWaveShaper();
        const steps = 16;
        const curve = new Float32Array(4096);
        for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.round(x * steps) / steps; }
        crush.curve = curve;
        const tone = a.createBiquadFilter();
        tone.type = 'lowpass'; tone.frequency.value = 6000;
        last.connect(crush).connect(tone);
        last = tone;
        mine.nodes.push(crush, tone);
      }
      if (Tone) {
        const add = (node) => { Tone.connect(last, node); last = node; mine.nodes.push(node); };
        if (soundFx.includes('chorus')) add(new Tone.Chorus({ frequency: 1.6, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start());
        if (soundFx.includes('phaser')) add(new Tone.Phaser({ frequency: 0.6, octaves: 3, baseFrequency: 500, wet: 0.6 }));
        if (soundFx.includes('delay')) add(new Tone.FeedbackDelay({ delayTime: 0.16, feedback: 0.35, wet: 0.3 }));
        Tone.connect(last, a.destination);
      } else last.connect(a.destination);
      mine.ready = true;
    };
    if (wantTone) loadTone().then(finish, () => finish(null)); else finish(null);
  }

  // ------------------------------------------------------------ Tone.js (loaded when needed)

  let tonePromise = null;
  function loadTone() {
    if (!tonePromise) {
      tonePromise = new Promise((resolve) => {
        const done = () => {
          const Tone = window.Tone;
          if (!Tone) { resolve(null); return; }
          try {
            // Tone.js plays through the same audio as everything else, with no delay added.
            Tone.setContext(audio());
            Tone.getContext().lookAhead = 0;
          } catch { /* already set */ }
          resolve(Tone);
        };
        if (window.Tone) { done(); return; }
        const tag = document.createElement('script');
        tag.src = '../node_modules/tone/build/Tone.js';
        tag.onload = done;
        tag.onerror = () => resolve(null);
        document.head.append(tag);
      });
    }
    return tonePromise;
  }

  // Tone.js instruments, made once each. Every one plays into one bus, which goes out like any
  // other sound.
  const toneKit = { Tone: null, bus: null, made: {} };
  const TONE_MAKERS = {
    bell: (T) => new T.PolySynth(T.FMSynth, { harmonicity: 3.01, modulationIndex: 12, envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.6 }, modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 } }),
    'e-piano': (T) => new T.PolySynth(T.FMSynth, { harmonicity: 1, modulationIndex: 3.5, oscillator: { type: 'sine' }, modulation: { type: 'sine' }, envelope: { attack: 0.004, decay: 0.8, sustain: 0.1, release: 0.5 }, modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.4 } }),
    duo: (T) => new T.PolySynth(T.DuoSynth, { vibratoAmount: 0.3, vibratoRate: 5, harmonicity: 1.5, voice0: { envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.4 } }, voice1: { envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.4 } } }),
    drums: (T) => ({
      kick: new T.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 } }),
      tom: new T.MembraneSynth({ pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 } }),
      snare: new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }),
      hat: new T.MetalSynth({ envelope: { attack: 0.001, decay: 0.08, release: 0.02 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5 }),
    }),
  };
  function toneInstrument(id) {
    const T = toneKit.Tone;
    if (!T || !TONE_MAKERS[id]) return null;
    if (!toneKit.bus) { toneKit.bus = audio().createGain(); toneKit.bus.gain.value = 0.5; }
    if (!toneKit.made[id]) {
      const made = TONE_MAKERS[id](T);
      const outs = id === 'drums' ? Object.values(made) : [made];
      for (const o of outs) T.connect(o, toneKit.bus);
      toneKit.made[id] = made;
    }
    return toneKit.made[id];
  }
  // One note on a Tone.js instrument. Returns false if it isn't ready yet (the note is then
  // played the ordinary way).
  function toneNote(a, n, when) {
    if (a !== ctx) return false;
    const inst = toneInstrument(instrument);
    if (!inst) return false;
    // (The bus goes to the sound effects, or straight out: moved only when they change, so notes
    // still ringing aren't cut off.)
    const to = fxInput(a);
    if (toneKit.bus.connected !== to) {
      try { toneKit.bus.disconnect(); } catch { /* not connected yet */ }
      toneKit.bus.connect(to);
      toneKit.bus.connected = to;
    }
    toneKit.bus.gain.value = 0.5 * Math.min(2, Math.max(0, set && set.volume != null ? set.volume : 1));
    const t = a.currentTime + 0.005 + when + (n.at || 0);
    const dur = Math.max(0.03, Math.min(2, n.d || 0.06));
    const vel = Math.min(1, Math.max(0.05, (n.v || 0.05) * 9));
    try {
      if (instrument === 'drums') {
        // Low notes are kicks, then toms, then snares; high ones are cymbals.
        if (n.w === 'noise' || (n.f >= 900 && n.f < 2500)) inst.snare.triggerAttackRelease(dur, t, vel);
        else if (n.f < 140) inst.kick.triggerAttackRelease(Math.max(40, n.f / 2), dur, t, vel);
        else if (n.f < 900) inst.tom.triggerAttackRelease(n.f / 2, dur, t, vel);
        else inst.hat.triggerAttackRelease(Math.min(800, n.f / 8), dur, t, vel * 0.5);
      } else inst.triggerAttackRelease(n.f, dur, t, vel);
      return true;
    } catch { return false; }
  }

  // ------------------------------------------------------------ the plucked string
  //
  // A burst of noise fed round a loop as long as one cycle of the note, a little softened each time
  // round (Karplus-Strong): it rings like a real string. Each pitch is worked out once and kept.
  const strings = new Map(); // "sample rate:pitch" -> AudioBuffer
  function stringBuffer(a, f) {
    const key = `${a.sampleRate}:${Math.round(f)}`;
    if (strings.has(key)) return strings.get(key);
    const len = Math.floor(a.sampleRate * 1.2);
    const period = Math.max(2, Math.round(a.sampleRate / f));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    const loop = new Float32Array(period);
    for (let i = 0; i < period; i++) loop[i] = Math.random() * 2 - 1;
    // (Centred on zero: otherwise the string carries a steady offset that adds up as notes overlap.)
    const mean = loop.reduce((x, y) => x + y, 0) / period;
    for (let i = 0; i < period; i++) loop[i] -= mean;
    const keep = 0.996 - Math.min(0.02, f / 200000); // high notes die away a little sooner
    for (let i = 0, j = 0; i < len; i++, j = (j + 1) % period) {
      const next = loop[(j + 1) % period];
      d[i] = loop[j];
      loop[j] = keep * 0.5 * (loop[j] + next);
    }
    if (strings.size > 200) strings.clear();
    strings.set(key, buf);
    return buf;
  }
  function stringNote(a, dest, n, when) {
    if (!(n.f > 0)) return false;
    const t = a.currentTime + 0.005 + when + (n.at || 0);
    const dur = Math.max(0.02, Math.min(4, n.d || 0.06));
    const end = t + Math.max(dur, Math.min(1.1, 0.3 + dur * 3));
    const s = a.createBufferSource();
    s.buffer = stringBuffer(a, Math.min(4000, n.f));
    s.playbackRate.setValueAtTime(1, t);
    if (n.to > 0) s.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, n.to / n.f), t + dur);
    const g = a.createGain();
    const vol = Math.min(1, (n.v || 0.05) * 1.1);
    // (Silent until the note starts: a gain starts at full volume, and the string's first sample
    // can land a hair before the note's own start, as a loud click.)
    g.gain.value = 0;
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, end - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    s.connect(g).connect(dest);
    s.start(t);
    s.stop(end + 0.05);
    return true;
  }

  // ------------------------------------------------------------ recorded instruments

  // One note from a recording: the nearest recorded note, pitched up or down to match, ringing
  // for a moment and then fading.
  function sampleNote(a, dest, n, when) {
    if (!samples.length || !(n.f > 0)) return false;
    const midi = 69 + 12 * Math.log2(n.f / 440);
    let best = samples[0];
    for (const x of samples) if (Math.abs(x.midi - midi) < Math.abs(best.midi - midi)) best = x;
    const t = a.currentTime + 0.005 + when + (n.at || 0);
    const dur = Math.max(0.02, Math.min(4, n.d || 0.06));
    const ring = (set.instrument && set.instrument.ring) || 1.2;
    const end = t + Math.max(dur, Math.min(ring, 0.25 + dur * 3));
    const rate = Math.pow(2, (midi - best.midi) / 12);
    const s = a.createBufferSource();
    s.buffer = best.buffer;
    s.playbackRate.setValueAtTime(rate, t);
    if (n.to > 0) s.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, rate * (n.to / n.f)), t + dur);
    // Recordings are much louder than the made-up notes: brought down to match.
    const vol = Math.min(1, Math.max(0.0001, (n.v || 0.05) * 5 * ((set.instrument && set.instrument.volume) || 1)));
    const g = a.createGain();
    g.gain.value = 0; // (silent until the note starts: see stringNote)
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.max(0.002, Math.min(0.05, n.a || 0.003)));
    g.gain.setValueAtTime(vol, t + Math.min(dur, 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    s.connect(g).connect(dest);
    s.start(t);
    s.stop(end + 0.05);
    return true;
  }

  // One note. Every field is optional apart from f (or w: 'noise'):
  //   w: wave (sine, triangle, square, sawtooth, noise)   f / to: pitch in Hz, gliding from f to `to`
  //   at: start (s)   d: length (s)   v: volume (0-1)   a: attack (s)
  //   lp / lpTo / hp / q: filters (Hz), lp can sweep to lpTo   det: a second voice, this many cents off
  //   vib: [rate, depth in Hz]   trem: [rate, depth 0-1]   drive: distortion 0-1
  function note(a, dest, n, when = 0) {
    const t = a.currentTime + 0.005 + when + (n.at || 0);
    const dur = Math.max(0.01, Math.min(4, n.d || 0.06));
    const vol = Math.min(0.5, Math.max(0.0001, n.v || 0.05));
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(dur * 0.8, n.a || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let chain = g;
    if (n.drive) { const ws = shaper(a, Math.min(1, n.drive)); ws.connect(chain); chain = ws; }
    if (n.lp > 0) {
      const f = a.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = n.q || 0.8;
      f.frequency.setValueAtTime(n.lp, t);
      if (n.lpTo) f.frequency.exponentialRampToValueAtTime(n.lpTo, t + dur);
      f.connect(chain); chain = f;
    }
    if (n.hp) {
      const f = a.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = n.hp; f.Q.value = n.q || 0.7;
      f.connect(chain); chain = f;
    }
    if (n.trem) {
      const lfo = a.createOscillator();
      const depth = a.createGain();
      const amp = a.createGain();
      amp.gain.value = 1 - n.trem[1] / 2;
      lfo.frequency.value = n.trem[0];
      depth.gain.value = n.trem[1] / 2;
      lfo.connect(depth).connect(amp.gain);
      amp.connect(chain); chain = amp;
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    g.connect(dest);

    const sources = [];
    if (n.w === 'noise') {
      const s = a.createBufferSource();
      s.buffer = noise(a);
      s.loop = true;
      s.playbackRate.value = n.f > 0 ? Math.max(0.05, n.f / 1000) : 1;
      sources.push(s);
    } else {
      const voices = n.det ? [0, n.det] : [0];
      for (const cents of voices) {
        const o = a.createOscillator();
        o.type = ['sine', 'triangle', 'square', 'sawtooth'].includes(n.w) ? n.w : 'sine';
        const f0 = Math.max(20, n.f || 440);
        o.frequency.setValueAtTime(f0, t);
        if (n.to > 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, n.to), t + dur);
        o.detune.value = cents;
        if (n.vib) {
          const lfo = a.createOscillator();
          const depth = a.createGain();
          lfo.frequency.value = n.vib[0]; depth.gain.value = n.vib[1];
          lfo.connect(depth).connect(o.frequency);
          lfo.start(t); lfo.stop(t + dur + 0.05);
        }
        sources.push(o);
      }
    }
    for (const s of sources) {
      if (sources.length > 1) { const half = a.createGain(); half.gain.value = 0.6; s.connect(half).connect(chain); } else s.connect(chain);
      s.start(t);
      s.stop(t + dur + 0.05);
    }
  }

  function play(name, a = audio(), when = 0) {
    const dest = out(a);
    const buf = buffers[name];
    if (buf) {
      const s = a.createBufferSource();
      s.buffer = buf;
      // Recordings are usually much louder than the made-up sounds: bring them down to match.
      // (A set's "volume" adjusts from there.)
      const level = a.createGain();
      level.gain.value = 0.25;
      s.connect(level).connect(dest);
      s.start(a.currentTime + when);
      return;
    }
    const own = set && set.sounds && set.sounds[name];
    const notes = Array.isArray(own) ? own : CLASSIC[name];
    if (!notes) return;
    for (const raw of notes.slice(0, 24)) {
      if (!raw || typeof raw !== 'object') continue;
      const n = { ...raw, f: hz(raw.f), to: hz(raw.to), d: raw.d || 0.06, v: raw.v || 0.05 };
      if (kind === 'recorded' && n.w !== 'noise' && sampleNote(a, dest, n, when)) continue;
      if (instrument === 'string' && n.w !== 'noise' && stringNote(a, dest, n, when)) continue;
      if (kind === 'tone' && (n.w !== 'noise' || instrument === 'drums') && toneNote(a, n, when)) continue;
      const swap = kind === 'synth' && instrument && n.w !== 'noise' && INSTRUMENTS[instrument];
      for (const x of swap ? swap(n) : [n]) note(a, dest, x, when);
    }
  }

  // A sound set from the app. Audio files arrive as bytes and are decoded here.
  let useCount = 0;
  async function useSet(s) {
    const mine = ++useCount; // (a newer choice wins over one still loading)
    set = s && typeof s === 'object' ? s : null;
    // (Older versions sent just the instrument's name.)
    const inst = set && (typeof set.instrument === 'string' ? { id: set.instrument, kind: 'synth' } : set.instrument) || {};
    instrument = typeof inst.id === 'string' ? inst.id : '';
    kind = ['synth', 'tone', 'recorded'].includes(inst.kind) ? inst.kind : 'synth';
    if (kind === 'synth' && !INSTRUMENTS[instrument] && instrument !== 'string') instrument = '';
    soundFx = Array.isArray(set && set.soundFx) ? set.soundFx.filter((x) => ['bitcrush', 'chorus', 'phaser', 'delay'].includes(x)) : [];
    buffers = {};
    samples = [];
    reverbFor = null;
    if (kind === 'tone') loadTone().then((T) => { toneKit.Tone = T; if (T) toneInstrument(instrument); });
    if (soundFx.length && ctx) fxInput(ctx);
    if (kind === 'recorded') {
      const got = [];
      for (const [midi, bytes] of Object.entries(inst.samples || {})) {
        try {
          const copy = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
          got.push({ midi: Number(midi), buffer: await audio().decodeAudioData(copy.slice(0)) });
        } catch { /* not audio we can play */ }
      }
      if (mine !== useCount) return;
      samples = got.sort((x, y) => x.midi - y.midi);
    }
    const files = (s && s.files) || {};
    const decoded = {};
    for (const [name, bytes] of Object.entries(files)) {
      try {
        const copy = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
        decoded[name] = await audio().decodeAudioData(copy.slice(0));
      } catch { /* not audio we can play: falls back to the recipe or Classic */ }
    }
    if (mine === useCount) buffers = decoded;
  }

  window.tvSound = (name, { force = false } = {}) => {
    if ((!on && !force) || !(CLASSIC[name] || (set && set.sounds && set.sounds[name]))) return;
    try { play(name); } catch { /* no audio device */ }
  };
  // Records a run of sounds without playing them: [[event, seconds from the start], ...] -> an
  // AudioBuffer. (Used to check sound sets, and to make samples of them.)
  window.tvSoundRender = async (steps, seconds = 3) => {
    const off = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    const keep = reverbFor;
    reverbFor = null;
    try {
      for (const [name, when] of steps) play(name, off, when);
      return await off.startRendering();
    } finally { reverbFor = keep; }
  };
  window.tvSoundInfo = () => ({ id: set && set.id, instrument, kind, samples: samples.length, soundFx, chainReady: Boolean(chain && chain.ready), tone: Boolean(toneKit.Tone), files: Object.keys(buffers) });

  // A short sample of a set, for choosing one in Settings.
  window.tvSoundSample = () => {
    const steps = ['move', 'move', 'select', 'screen'];
    steps.forEach((n, i) => setTimeout(() => window.tvSound(n, { force: true }), i * 230));
  };

  if (window.tv && window.tv.soundsOn) {
    window.tv.soundsOn().then((v) => { on = v !== false; }, () => {});
    window.tv.onSounds((v) => { on = v !== false; });
    window.tv.onPlaySound((name) => window.tvSound(name)); // presses on websites, sent by the app
    if (window.tv.soundSet) {
      window.tv.soundSet().then(useSet, () => {});
      window.tv.onSoundSet(useSet);
    }
  }
})();
