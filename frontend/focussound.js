// Pomodoro's background sound (Settings → Pomodoro → Background sound, or the button in the Pomodoro tab): noise and
// nature sounds made right here with Web Audio, nothing downloaded. Each sound is a few seconds of noise generated
// once into looping buffers (of different lengths, so together they don't repeat for minutes), shaped by filters and
// slow swells; while it plays no script runs at all. It plays in one notch window only (main says which, alerts.rs
// `notch:focusHere`), and that window stays loaded while Sympony is closed, so the sound goes on with the session: it
// fades in while a focus session runs (and in breaks with "Keep playing in breaks"), fades out when the session is
// paused or ends, and the AudioContext is closed while nothing plays. Picking a sound or a volume while no session
// runs plays it for a few seconds, to hear it.
(function () {
  const TAU = Math.PI * 2;
  /** Control curves (the slow swells) move slowly: a few thousand values a second are plenty. */
  const CR = 3000;

  // seeded random numbers (mulberry32): a test can make the same sound twice
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // noise colours, a sample at a time (brown leans the same way at any sample rate)
  function colour(kind, r, sr) {
    if (kind === 'pink') { // Paul Kellet's refined filter
      let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
      return () => {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        return out * 0.11;
      };
    }
    if (kind === 'brown') { let b = 0; const k = 0.02 * 48000 / sr; return () => { b = (b + k * (r() * 2 - 1)) / (1 + k); return b; }; }
    return () => r() * 2 - 1;
  }

  // a biquad filter (RBJ's cookbook) over the samples, in place. `circular`: the samples loop, so the filter runs over
  // them twice and keeps the second pass, which carries on from their end into their start without a seam
  function biquad(x, sr, type, f, q = 0.707, circular = false) {
    const w = TAU * Math.min(f, sr * 0.45) / sr; const cs = Math.cos(w); const al = Math.sin(w) / (2 * q);
    let b0; let b1; let b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al; const c1 = -2 * cs / a0; const c2 = (1 - al) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let pass = circular ? 2 : 1; pass > 0; pass--) {
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        const y = b0 * v + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
        x2 = x1; x1 = v; y2 = y1; y1 = y;
        if (pass === 1) x[i] = y;
      }
    }
  }

  function rms(chs) { let s = 0; let n = 0; for (const c of chs) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; } return Math.sqrt(s / n) || 1; }
  function scale(chs, k) { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }

  // `secs` of stereo noise (each side its own) that loops without a seam: made half a second longer, and that end
  // faded into its start (equal power, so the level doesn't dip); RMS 0.1. Low sounds (rumble) are made at a lower
  // `rate`: a quarter of the work and the memory, and nothing lost
  function noise(ctx, secs, kind, filters, r, rate = ctx.sampleRate) {
    const sr = rate; const n = Math.round(secs * sr); const F = Math.round(0.5 * sr); const W = Math.round(0.25 * sr);
    const buf = ctx.createBuffer(2, n, sr); const chs = [];
    for (let c = 0; c < 2; c++) {
      const next = colour(kind, rng(r() * 4294967296), sr);
      const x = new Float32Array(W + n + F);
      for (let i = 0; i < x.length; i++) x[i] = next();
      for (const [type, f, q] of filters) biquad(x, sr, type, f, q);
      const out = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] = x[W + i];
      for (let i = 0; i < F; i++) { const a = ((i + 0.5) / F) * Math.PI / 2; out[i] = x[W + i] * Math.sin(a) + x[W + n + i] * Math.cos(a); }
      chs.push(out);
    }
    scale(chs, 0.1 / rms(chs));
    return buf;
  }

  // a stereo loop of short sounds (drops, crackles): add(at seconds, sample(i), length, pan 0-1); one that runs past
  // the end comes in at the start, so the loop has no seam
  function events(ctx, secs) {
    const sr = ctx.sampleRate; const n = Math.round(secs * sr);
    const buf = ctx.createBuffer(2, n, sr); const L = buf.getChannelData(0); const R = buf.getChannelData(1);
    const add = (t, f, len, pan) => {
      const s = Math.floor(t * sr) % n; const p = Math.max(0, Math.min(1, pan)) * Math.PI / 2; const gl = Math.cos(p); const gr = Math.sin(p);
      for (let i = 0; i < len; i++) { const v = f(i); const j = (s + i) % n; L[j] += v * gl; R[j] += v * gr; }
    };
    return { buf, add, sr, secs };
  }

  // a smooth wandering curve from 0 to 1 that loops after `n` values: slow waves of whole cycles over the loop
  function wander(r, parts, n) {
    const x = new Float32Array(n);
    for (let k = 1; k <= parts; k++) {
      const a = (0.6 + 0.8 * r()) / k ** 0.9; const ph = r() * TAU; const cw = Math.cos(TAU * k / n); const sw = Math.sin(TAU * k / n);
      // (a turning pointer instead of a sine per value)
      let c = Math.cos(ph); let s = Math.sin(ph);
      for (let i = 0; i < n; i++) { x[i] += a * s; const t = c * cw - s * sw; s = s * cw + c * sw; c = t; }
    }
    let lo = Infinity; let hi = -Infinity;
    for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < n; i++) x[i] = (x[i] - lo) / (hi - lo || 1);
    return x;
  }

  // ocean swells over `secs`: waves of 7-11 s that fill the loop exactly. [the swell itself, the foam once it breaks]
  function swells(r, n, secs) {
    const A = new Float32Array(n); const B = new Float32Array(n);
    const lens = []; let sum = 0;
    while (sum < secs - 6) { const l = 7 + 4 * r(); lens.push(l); sum += l; }
    let start = 0;
    for (const l of lens) {
      const P = l * secs / sum; const a = 0.55 + 0.45 * r(); const rise = 0.45 * P; const fall = 0.3 * P; const wash = 0.5 * P;
      // over two periods (its tail runs on under the next wave), round the loop's end
      const m = Math.round(2 * P * CR); const s0 = Math.round(start * CR);
      for (let i = 0; i < m; i++) {
        const u = i / CR; let ea; let eb;
        if (u < rise) { ea = a * (0.5 - 0.5 * Math.cos(Math.PI * u / rise)) ** 1.6; eb = 0.25 * ea; } else {
          const d = u - rise;
          ea = a * Math.exp(-d / fall);
          eb = a * (d < 0.35 ? 0.25 + 0.75 * (d / 0.35) : Math.exp(-(d - 0.35) / wash));
        }
        const j = (s0 + i) % n;
        if (ea > A[j]) A[j] = ea;
        if (eb > B[j]) B[j] = eb;
      }
      start += P;
    }
    return [A, B];
  }

  // a looping source of control curves; ch[i] is curve i, to drive() parameters with
  function control(ctx, secs, make) {
    const n = Math.round(secs * CR);
    const curves = make(n);
    const buf = ctx.createBuffer(curves.length, n, CR);
    curves.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const sp = ctx.createChannelSplitter(curves.length); src.connect(sp);
    const ch = curves.map((_, i) => { const g = ctx.createGain(); sp.connect(g, i); return g; });
    return { src, ch };
  }
  // the parameter = `base` + the curve (0-1) × `depth`
  function drive(ctx, from, param, base, depth) { param.value = base; const g = ctx.createGain(); g.gain.value = depth; from.connect(g).connect(param); }

  // a looping buffer → (a filter) → a gain → `dest`
  function layer(ctx, buffer, dest, gain = 1, filter = null) {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const g = ctx.createGain(); g.gain.value = gain;
    (filter ? src.connect(filter) : src).connect(g).connect(dest);
    return { src, g, filter };
  }
  function filt(ctx, type, f, q = 0.707) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  function rainDrops(ctx, secs, r) {
    const e = events(ctx, secs); const { sr } = e;
    // the patter: lots of tiny ticks, most of them faint
    for (let k = Math.round(secs * 140); k > 0; k--) {
      const len = Math.round(sr * (0.0006 + r() * 0.0018)); const tau = len / 3; const a = 0.04 + 0.5 * r() ** 4;
      e.add(r() * secs, (i) => (r() * 2 - 1) * a * Math.exp(-i / tau), len, r());
    }
    // and drops: a short "plink" whose pitch rises a little
    for (let k = Math.round(secs * 7); k > 0; k--) {
      const f0 = 1700 * 2.3 ** r(); const tau = sr * (0.006 + r() * 0.014); const len = Math.round(tau * 5); const a = 0.05 + 0.2 * r() ** 2;
      let ph = 0;
      e.add(r() * secs, (i) => { ph += TAU * f0 * (1 + 0.3 * i / len) / sr; return Math.sin(ph) * a * Math.exp(-i / tau); }, len, 0.15 + 0.7 * r());
    }
    // (the ticks' low thump out)
    for (let c = 0; c < 2; c++) biquad(e.buf.getChannelData(c), sr, 'highpass', 1200, 0.7, true);
    return e.buf;
  }

  function fireCrackles(ctx, secs, r) {
    const e = events(ctx, secs); const { sr } = e;
    // bursts of tiny clicks, most of them faint, a few loud
    for (let k = Math.round(secs * 5); k > 0; k--) {
      const t0 = r() * secs; const pan = 0.2 + 0.6 * r();
      for (let j = 1 + Math.floor(r() * 7); j > 0; j--) {
        const len = Math.round(sr * (0.0003 + r() * 0.0012)); const tau = len / 4; const a = Math.min(0.35, 0.04 / Math.max(0.02, r()) ** 0.7);
        e.add(t0 + r() * 0.07, (i) => (r() * 2 - 1) * a * Math.exp(-i / tau), len, pan + 0.1 * (r() - 0.5));
      }
    }
    for (let c = 0; c < 2; c++) biquad(e.buf.getChannelData(c), sr, 'highpass', 900, 0.7, true);
    // now and then a soft pop: a quick, low knock
    for (let k = Math.round(secs * 0.5); k > 0; k--) {
      const f0 = 300 + 400 * r(); const tau = sr * (0.01 + 0.015 * r()); const len = Math.round(tau * 5); const a = 0.12 + 0.16 * r();
      e.add(r() * secs, (i) => Math.sin(TAU * f0 * i / sr) * a * Math.exp(-i / tau) * Math.min(1, i / 24), len, 0.25 + 0.5 * r());
    }
    return e.buf;
  }

  /** The rate the low layers are made at. */
  const LOW = 12000;
  // Each sound: (ctx, out, r) → its sources, wired to `out`.
  const BUILD = {
    white: (ctx, out, r) => [layer(ctx, noise(ctx, 7.1, 'white', [['lowpass', 11000]], r), out).src],
    pink: (ctx, out, r) => [layer(ctx, noise(ctx, 7.3, 'pink', [['highpass', 30]], r), out).src],
    brown: (ctx, out, r) => [layer(ctx, noise(ctx, 7.7, 'brown', [['highpass', 28]], r), out).src],
    rain(ctx, out, r) {
      // a steady hiss, a soft rumble, and the drops, all a little heavier now and then
      const swell = control(ctx, 31, (n) => [wander(r, 8, n)]);
      const bed = layer(ctx, noise(ctx, 6.1, 'pink', [['highpass', 450, 0.6], ['lowpass', 8500, 0.6]], r), out, 0);
      drive(ctx, swell.ch[0], bed.g.gain, 0.8, 0.3);
      const rumble = layer(ctx, noise(ctx, 5.3, 'brown', [['highpass', 30], ['lowpass', 260]], r, LOW), out, 0.35);
      const drops = layer(ctx, rainDrops(ctx, 7.9, r), out, 0);
      drive(ctx, swell.ch[0], drops.g.gain, 0.6, 0.5);
      return [swell.src, bed.src, rumble.src, drops.src];
    },
    waves(ctx, out, r) {
      // the swell (low rumble, brighter as it rises) and the foam's hiss after it breaks
      const env = control(ctx, 47, (n) => swells(r, n, 47));
      const deep = layer(ctx, noise(ctx, 7.7, 'brown', [['highpass', 30], ['lowpass', 2500]], r, LOW), out, 0, filt(ctx, 'lowpass', 250, 0.5));
      drive(ctx, env.ch[0], deep.g.gain, 0.15, 0.85);
      drive(ctx, env.ch[0], deep.filter.frequency, 250, 1100);
      const foam = layer(ctx, noise(ctx, 6.3, 'pink', [['highpass', 700], ['lowpass', 9000]], r), out, 0);
      drive(ctx, env.ch[1], foam.g.gain, 0.03, 0.55);
      return [env.src, deep.src, foam.src];
    },
    wind(ctx, out, r) {
      // gusts: louder and higher together; a faint whistle in the strongest; a low rumble under it all
      const gust = control(ctx, 43, (n) => [wander(r, 10, n).map((v) => v ** 1.7), wander(r, 14, n).map((v) => v ** 3)]);
      const body = layer(ctx, noise(ctx, 7.9, 'pink', [['highpass', 60], ['lowpass', 5000]], r, 2 * LOW), out, 0, filt(ctx, 'bandpass', 220, 0.7));
      drive(ctx, gust.ch[0], body.g.gain, 0.3, 1.1);
      drive(ctx, gust.ch[0], body.filter.frequency, 220, 650);
      const whistle = layer(ctx, noise(ctx, 6.7, 'pink', [['lowpass', 3000]], r, LOW), out, 0, filt(ctx, 'bandpass', 650, 9));
      drive(ctx, gust.ch[1], whistle.g.gain, 0, 1);
      drive(ctx, gust.ch[1], whistle.filter.frequency, 650, 900);
      const low = layer(ctx, noise(ctx, 6.1, 'brown', [['highpass', 25], ['lowpass', 180]], r, LOW), out, 0.4);
      return [gust.src, body.src, whistle.src, low.src];
    },
    fire(ctx, out, r) {
      // a low roar that flickers, a faint hiss, and the crackles
      const flick = control(ctx, 29, (n) => [wander(r, 24, n)]);
      const roar = layer(ctx, noise(ctx, 7.1, 'brown', [['highpass', 40], ['lowpass', 450]], r, LOW), out, 0);
      drive(ctx, flick.ch[0], roar.g.gain, 0.3, 0.35);
      const hiss = layer(ctx, noise(ctx, 5.9, 'pink', [['highpass', 2000], ['lowpass', 6000]], r), out, 0.15);
      const crackle = layer(ctx, fireCrackles(ctx, 8.9, r), out, 1.4);
      return [flick.src, roar.src, hiss.src, crackle.src];
    },
  };
  // Each sound's own gain, so that all of them are about as loud at the same volume: −21 LUFS at 100% (measured
  // offline, BS.1770 loudness), with their peaks still under full scale; the default 70% is about −27 LUFS, well
  // under music.
  const CAL = { white: 0.45, pink: 0.56, brown: 0.71, rain: 0.5, waves: 1.17, wind: 1.17, fire: 1.36 };

  // The sound `kind` into `dest`, its sources started at `when`; returns them (to stop).
  function build(ctx, dest, kind, seed, when = 0) {
    const cal = ctx.createGain(); cal.gain.value = CAL[kind]; cal.connect(dest);
    const srcs = BUILD[kind](ctx, cal, rng(seed));
    for (const s of srcs) s.start(when);
    return srcs;
  }

  // the tests (an offline render in a page of its own) use the same code
  window.symponyFocusSound = { build, kinds: Object.keys(BUILD), CAL };

  // ------------------------------------------------------------------ playing it
  const api = window.notch;
  if (!api || !window.N) return;
  const NAMES = { off: _t('Off'), white: _t('White noise'), pink: _t('Pink noise'), brown: _t('Brown noise'), rain: _t('Rain'), waves: _t('Ocean waves'), wind: _t('Wind'), fire: _t('Fireplace') };
  // [value, name] for the Pomodoro tab's list
  N.focusSounds = Object.entries(NAMES);

  const FADE_IN = 2.5; const FADE_OUT = 1.5; const SWITCH = 0.8; const PREVIEW = 4000;
  let ctx = null;      // only while something plays (and for the fade after)
  let vol = null;      // its volume
  let cur = null;      // { kind, fade, srcs }
  let closeT = 0;
  let here = null;     // this notch is the one that plays it (main says, a moment after a sound is picked)
  let pomo = null;
  let set = null;
  let previewUntil = 0;
  let previewT = 0;

  // 0-100 % → gain, steeper at the low end (as loudness goes)
  const level = () => { const v = Math.max(0, Math.min(100, Number(set && set.focusSoundVolume != null ? set.focusSoundVolume : 70))) / 100; return v * v; };

  function wanted() {
    const k = set && set.focusSound;
    if (!here || !BUILD[k]) return null;
    if (Date.now() < previewUntil) return k;
    if (!pomo || !pomo.running) return null;
    return pomo.phase === 'work' || set.focusSoundBreaks ? k : null;
  }

  function sync() { const k = wanted(); if (k) play(k); else stop(); }

  function play(kind) {
    clearTimeout(closeT);
    if (!ctx) {
      try { ctx = new AudioContext({ latencyHint: 'playback' }); } catch (e) { return; }
      vol = ctx.createGain(); vol.gain.value = level(); vol.connect(ctx.destination);
    }
    // (a page that hasn't been clicked yet may start suspended: the next click lets it play)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    vol.gain.setTargetAtTime(level(), ctx.currentTime, 0.08);
    if (cur && cur.kind === kind) return;
    const switching = !!cur;
    if (cur) fadeOut(cur, SWITCH);
    const fade = ctx.createGain(); fade.connect(vol);
    const t = ctx.currentTime;
    fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + (switching ? SWITCH : FADE_IN));
    let srcs;
    try { srcs = build(ctx, fade, kind, (Math.random() * 4294967296) >>> 0, t); } catch (e) { console.error(e); return; }
    cur = { kind, fade, srcs };
  }

  function fadeOut(p, secs) {
    const t = ctx.currentTime; const g = p.fade.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(0, t + secs);
    for (const s of p.srcs) { try { s.stop(t + secs + 0.05); } catch (e) { /* already stopped */ } }
    setTimeout(() => { try { p.fade.disconnect(); } catch (e) { /* gone with the context */ } }, (secs + 0.3) * 1000);
  }

  function stop() {
    if (!ctx) return;
    if (cur) { fadeOut(cur, FADE_OUT); cur = null; }
    clearTimeout(closeT);
    closeT = setTimeout(() => {
      if (cur || !ctx) return;
      ctx.close().catch(() => {});
      ctx = null; vol = null;
    }, (FADE_OUT + 0.4) * 1000);
  }

  // (for the tests: what plays here, and whether there's a context)
  window.symponyFocusSound.now = () => ({ playing: cur ? cur.kind : null, context: ctx ? ctx.state : null });

  // a click lets a suspended context play (only while it should)
  document.addEventListener('pointerdown', () => { if (ctx && cur && ctx.state === 'suspended') ctx.resume().catch(() => {}); }, true);

  function onSettings(s) {
    const prev = set;
    set = s || {};
    // a sound or volume picked while no session plays it: a few seconds of it
    if (prev && (prev.focusSound !== set.focusSound || prev.focusSoundVolume !== set.focusSoundVolume) && BUILD[set.focusSound]) {
      const k = set.focusSound;
      previewUntil = 0;
      if (wanted() !== k) {
        previewUntil = Date.now() + PREVIEW;
        clearTimeout(previewT);
        previewT = setTimeout(sync, PREVIEW + 50);
      }
    }
    sync();
  }

  api.on('notch:focusHere', (v) => { here = !!v; sync(); });
  api.on('pomodoro', (p) => { pomo = p; sync(); });
  api.onSettings(onSettings);
  Promise.all([api.getSettings(), api.svc('pomodoro', 'get')]).then(([s, p]) => {
    if (!set) set = s || {};
    if (!pomo) pomo = p;
    sync();
  }).catch(() => {});
})();
