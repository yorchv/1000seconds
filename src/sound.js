/* 1000 Seconds to AGI — tiny WebAudio synth. No audio files; muted until the player turns it on. */
(function (root) {
  'use strict';
  let ctx = null;
  let master = null;
  let enabled = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, dur, opts) {
    if (!enabled || !ensure()) return;
    opts = opts || {};
    const t0 = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    const vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const Sound = {
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      if (enabled && ensure() && ctx.state === 'suspended') ctx.resume();
    },
    // Must be called from a user gesture on iOS to unlock audio.
    unlock() { if (enabled && ensure() && ctx.state === 'suspended') ctx.resume(); },
    pitch(streak, charged) {
      const f = 520 * Math.pow(2, Math.min(streak, 24) / 24);
      tone(f, 0.07, { type: 'triangle', vol: 0.18 });
      if (charged) { tone(f * 1.5, 0.18, { type: 'sine', vol: 0.22, delay: 0.03 }); tone(f * 2, 0.22, { type: 'sine', vol: 0.12, delay: 0.07 }); }
    },
    buy() { tone(880, 0.05, { type: 'square', vol: 0.06 }); tone(1320, 0.06, { type: 'square', vol: 0.05, delay: 0.04 }); },
    deny() { tone(180, 0.09, { type: 'square', vol: 0.06 }); },
    train() { tone(330, 0.25, { type: 'sawtooth', vol: 0.06, slide: 660 }); },
    level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); },
    win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.2, delay: i * 0.1 })); },
    lose() { tone(392, 0.5, { type: 'sawtooth', vol: 0.1, slide: 98 }); },
    tick(urgent) { tone(urgent ? 1400 : 1000, 0.05, { type: 'square', vol: urgent ? 0.12 : 0.07 }); },
    alarm() { tone(220, 0.35, { type: 'sawtooth', vol: 0.12, slide: 140 }); },
    event(good) { good ? tone(988, 0.15, { vol: 0.15 }) : tone(294, 0.2, { type: 'triangle', vol: 0.18 }); tone(good ? 1319 : 247, 0.2, { vol: 0.12, delay: 0.1 }); },
    heartbeat() { tone(70, 0.09, { vol: 0.35 }); tone(62, 0.1, { vol: 0.28, delay: 0.14 }); },
  };

  root.AGISound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
