// Pony: the Sympony character (2026-11 brand): a soft lavender blob under a purple fringe ("poni"), oval eyes, pink cheeks.
// Brand board: docs/brand/pony.html. Varieties Classic / Soft (fluffy) / Pro (headset); the colour is the fringe's.
// Plain IIFE exposing window.Pony for both notch.html and settings-ui.
// Idle-smart rAF: runs only while springs/blink/mood animation move, stopping completely at rest.
(function () {
  'use strict';

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class Spring {
    constructor(v, k = 170, d = 16) {
      this.v = v;
      this.t = v;
      this.vel = 0;
      this.k = k;
      this.d = d;
    }
    step(dt) {
      const f = -this.k * (this.v - this.t) - this.d * this.vel;
      this.vel += f * dt;
      this.v += this.vel * dt;
      return this.v;
    }
    settled() {
      return Math.abs(this.v - this.t) < 0.002 && Math.abs(this.vel) < 0.01;
    }
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // the fringe's colour (light, mid, dark); the body stays a soft lavender white
  const COLOR_STOPS = {
    Lavender: ['#c6bbff', '#8f7bff', '#5a42df'],
    Berry: ['#ffc6e3', '#f06fb4', '#b8357f'],
    Mint: ['#bff5df', '#4fcfa3', '#1d9672'],
    Sky: ['#c6e6ff', '#5aaef7', '#2c6fd0'],
    Peach: ['#ffd8c2', '#ff9a6b', '#d4602f'],
    Midnight: ['#9096bd', '#43486e', '#1f2140'],
  };

  // the body's outline (superellipse: n, width, height, flat bottom `dome`, wider bottom with a negative `taper`)
  const BODY = { n: 1.95, w: 0.72, h: 0.68, dome: 0.22, taper: -0.2 };
  const SHAPE_DEFS = { Classic: { ...BODY }, Soft: { ...BODY, n: 1.9 }, Pro: { ...BODY } };

  const SHAPE_KEYS = ['n', 'w', 'h', 'dome', 'drop', 'taper'];
  const SHAPES = Object.keys(SHAPE_DEFS);
  const COLORS = Object.keys(COLOR_STOPS);

  const DEFAULTS = {
    shape: 'Classic',
    color: 'Lavender',
    name: 'Pony',
    persona: 'friendly',
  };

  function validShape(name) {
    return Object.prototype.hasOwnProperty.call(SHAPE_DEFS, name) ? name : DEFAULTS.shape;
  }
  function validColor(name) {
    return Object.prototype.hasOwnProperty.call(COLOR_STOPS, name) ? name : DEFAULTS.color;
  }
  function look(settings) {
    const s = settings || {};
    return {
      shape: validShape(s.ponyShape),
      color: validColor(s.ponyColor),
      name: (typeof s.ponyName === 'string' && s.ponyName.trim()) ? s.ponyName.trim() : DEFAULTS.name,
      persona: (typeof s.ponyPersona === 'string' && s.ponyPersona.trim()) ? s.ponyPersona.trim() : DEFAULTS.persona,
    };
  }

  function createBuddy(opt) {
    const shape = validShape(opt && opt.shape);
    const color = validColor(opt && opt.color);
    const b = {
      face: (opt && opt.face) || 'bot',
      shape,
      color,
      mood: (opt && opt.mood) || 'idle',
      scale: (opt && typeof opt.scale === 'number') ? opt.scale : 0.72,
      floorFrac: (opt && typeof opt.floorFrac === 'number') ? opt.floorFrac : 0.82,
      hopScale: (opt && typeof opt.hop === 'number') ? opt.hop : 1, // how high hops go (small spaces use less)
      shadow: !(opt && opt.shadow === false), // no ground under it (peeking from the notch)
      form: {},
      shut: new Spring(0, 60, 14),
      badge: new Spring(0, 180, 16),
      badgeKind: null,
      bt: -1,
      look: { x: new Spring(0, 100, 18), y: new Spring(0, 100, 18) },
      sx: new Spring(1, 240, 12),
      sy: new Spring(1, 240, 12),
      lean: new Spring(0, 70, 12),
      open: { v: 1 },
      smile: new Spring(0, 70, 15),
      y: 0,
      vy: 0,
      t: 0,
      nextBlink: rnd(3.2, 5.8),
      nextDart: rnd(2.2, 4.0),
      lastMouse: -10000,
      clicks: [],
      dizzyUntil: 0,
      parts: [],
      target: null,
      hopTimer: null,
      pokeTimer: null,
      // little mitten paws, only when asked (setHands): none | rest | grip (on an edge at canvas y gripY) | up | wave
      hands: {
        pose: 'none',
        gripY: 0,
        gripLocal: -0.3,
        p: [-1, 1].map((side) => ({ x: new Spring(side * 0.8, 130, 14), y: new Spring(0.4, 130, 14), s: new Spring(0, 170, 15), r: new Spring(0, 120, 13) })),
      },
    };
    for (const k of SHAPE_KEYS) {
      b.form[k] = new Spring(SHAPE_DEFS[shape][k] ?? 0, 150, 12);
    }
    // Snap initial mood springs so first render matches immediately
    if (b.mood === 'sleep') { b.shut.v = 1; b.shut.t = 1; }
    if (b.mood === 'done' || b.mood === 'music' || b.mood === 'happy') { b.smile.v = 1; b.smile.t = 1; }
    const initKind = { think: 'think', attention: 'attention', done: 'done' }[b.mood];
    if (initKind) { b.badgeKind = initKind; b.badge.v = 1; b.badge.t = 1; }

    b.setShape = (name) => {
      const s = validShape(name);
      if (b.shape === s) return;
      b.shape = s;
      for (const k of SHAPE_KEYS) b.form[k].t = SHAPE_DEFS[s][k] ?? 0;
      if (!reducedMotion()) {
        b.sy.vel -= 5;
        b.sx.vel += 5;
      }
    };
    b.hop = (power = 1) => {
      if (reducedMotion() || b.y < -1) return;
      b.sy.t = 0.84;
      b.sx.t = 1.14;
      if (b.hopTimer) clearTimeout(b.hopTimer);
      b.hopTimer = setTimeout(() => {
        b.hopTimer = null;
        b.vy = -520 * power * b.scale * b.hopScale;
        b.sy.t = 1.12;
        b.sx.t = 0.9;
      }, 110);
    };
    b.poke = () => {
      const now = performance.now();
      b.clicks = b.clicks.filter((c) => now - c < 700).concat(now);
      if (!reducedMotion()) {
        b.sx.vel += 6;
        b.sy.vel -= 6;
        b.sy.t = 0.86;
        b.sx.t = 1.14;
        if (b.pokeTimer) clearTimeout(b.pokeTimer);
        b.pokeTimer = setTimeout(() => {
          b.pokeTimer = null;
          b.sy.t = 1;
          b.sx.t = 1;
        }, 120);
      }
      if (b.clicks.length >= 3 && !reducedMotion()) {
        b.dizzyUntil = now + 3000;
        b.clicks = [];
      }
    };
    return b;
  }

  function spark(b) {
    const c = ['#ffd60a', '#ff6b9a', '#64d2ff', '#30d158', '#bf5af2'][Math.floor(rnd(0, 5))];
    return {
      x: 0,
      y: -40 * b.scale,
      vx: rnd(-180, 180) * b.scale,
      vy: rnd(-420, -200) * b.scale,
      life: rnd(0.6, 1.1),
      c,
      r: rnd(2, 4) * b.scale,
    };
  }

  function update(b, dt, now) {
    const reduced = reducedMotion();
    b.t += dt;
    const mood = now < b.dizzyUntil ? 'dizzy' : b.mood;
    if (b.target && now - b.lastMouse < 2500 && mood !== 'sleep' && mood !== 'think') {
      b.look.x.t = Math.max(-1, Math.min(1, b.target.x));
      b.look.y.t = Math.max(-1, Math.min(1, b.target.y));
    } else if (mood === 'think') {
      b.look.x.t = 0.55;
      b.look.y.t = -0.55;
    } else if (mood === 'sleep') {
      b.look.x.t = 0;
      b.look.y.t = 0.25;
    } else if (mood === 'idle') {
      // stay resting at the settled glance target until cursor moves or mood changes
    } else if ((b.nextDart -= dt) < 0) {
      b.nextDart = rnd(1.8, 3.4);
      b.look.x.t = rnd(-0.45, 0.45);
      b.look.y.t = rnd(-0.25, 0.25);
    }

    let lid = 1;
    if (b.bt > -1) {
      b.bt += dt;
      const p = (b.bt < 0 ? b.bt + 0.34 : b.bt) / 0.17;
      if (p >= 0 && p < 1) lid = 1 - 0.95 * Math.sin(Math.PI * p) ** 2;
      else if (b.bt >= 0.17) b.bt = -1;
    }
    b.open.v = lid;
    b.shut.t = mood === 'sleep' ? 1 : 0;
    const kind = { think: 'think', attention: 'attention', done: 'done' }[mood];
    if (kind) b.badgeKind = kind;
    b.badge.t = kind ? 1 : 0;
    b.smile.t = mood === 'happy' || mood === 'done' || mood === 'music' ? 1 : 0;

    if (b.y < 0 || b.vy < 0) {
      b.vy += 3200 * b.scale * dt;
      b.y += b.vy * dt;
      if (b.y >= 0) {
        b.y = 0;
        const hit = Math.min(1, b.vy / (600 * b.scale));
        b.vy = 0;
        b.sy.t = 1;
        b.sx.t = 1;
        b.sy.vel -= 9 * hit;
        b.sx.vel += 9 * hit;
      }
    }

    if (!reduced) {
      if (mood === 'done' && b.y === 0 && Math.random() < dt * 0.8) {
        b.hop(1);
        for (let i = 0; i < 10; i++) b.parts.push(spark(b));
      }
      if (mood === 'attention' && b.y === 0 && Math.random() < dt * 1.1) b.hop(0.55);
      if (mood === 'happy' && b.y === 0 && Math.random() < dt * 0.35) b.hop(0.6);
    }

    const sway = mood === 'music' && !reduced ? Math.sin(b.t * 2 * Math.PI * 1.9) : 0;
    b.lean.t = mood === 'dizzy' ? Math.sin(b.t * 9) * 0.9 : sway * 0.7 + b.look.x.v * 0.25;

    b.hands.p.forEach((p, i) => {
      const [x, y, sz, r] = pawTarget(b.hands, i ? 1 : -1, b.t, reduced);
      p.x.t = x;
      p.y.t = y;
      p.s.t = sz;
      p.r.t = r;
    });
    const springs = [b.look.x, b.look.y, b.sx, b.sy, b.lean, b.smile, b.shut, b.badge, ...Object.values(b.form), ...pawSprings(b)];
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const sp of springs) sp.step(h);
    }
    b.parts = b.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of b.parts) {
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // where a paw wants to be: [x in body half-widths, y in body half-heights from the centre, size, tilt]
  function pawTarget(h, side, t, still) {
    const w = still ? 0 : 1;
    switch (h.pose) {
      case 'rest': return [side * 0.97, 0.42, 1, -side * 0.45];
      case 'grip': return [side * 1.0, h.gripLocal, 1.15, side * 0.1];
      case 'up': return [side * (1.06 + 0.05 * Math.sin(t * 13 + side) * w), -1.02 + 0.09 * Math.sin(t * 15 + side * 1.7) * w, 1, side * 0.55];
      case 'wave':
        return side > 0
          ? [1.12 + 0.05 * Math.sin(t * 10) * w, -0.5, 1, 0.45 + 0.42 * Math.sin(t * 10) * w]
          : [-0.97, 0.42, 1, 0.45];
      default: return [side * 0.75, 0.4, 0, 0];
    }
  }
  const pawSprings = (b) => b.hands.p.flatMap((p) => [p.x, p.y, p.s, p.r]);

  function isAtRest(b, now) {
    const reduced = reducedMotion();
    const mood = now < b.dizzyUntil ? 'dizzy' : b.mood;
    if (now < b.dizzyUntil) return false;
    if (b.hopTimer || b.pokeTimer) return false;
    if (b.y < 0 || b.vy !== 0) return false;
    if (b.bt > -1) return false;
    if (b.parts.length > 0) return false;
    // Active non-idle moods (and waving or reaching paws) animate continuously unless reduced motion is set
    if (!reduced && mood !== 'idle') return false;
    if (!reduced && (b.hands.pose === 'up' || b.hands.pose === 'wave')) return false;
    const springs = [b.look.x, b.look.y, b.sx, b.sy, b.lean, b.smile, b.shut, b.badge, ...Object.values(b.form), ...pawSprings(b)];
    for (const sp of springs) {
      if (!sp.settled()) return false;
    }
    return true;
  }

  // the body: a superellipse with a flatter, wider bottom; Soft has a fluffy, cloud-like rim below the middle
  function bodyPath(ctx, a, bb, f, fluffy) {
    ctx.beginPath();
    const n = Math.max(1.6, f.n.v);
    const dome = f.dome.v;
    const taper = f.taper.v;
    for (let i = 0; i <= 160; i++) {
      const th = (i / 160) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const e = s > 0 ? n + dome * 5 : n;
      let x = a * Math.sign(c) * Math.abs(c) ** (2 / e);
      let y = bb * Math.sign(s) * Math.abs(s) ** (2 / e);
      if (s > 0) y *= 1 - 0.35 * dome;
      x *= 1 - taper * (y / bb + 1) * 0.5;
      if (fluffy && s > -0.15) {
        const k = 1 + 0.045 * Math.abs(Math.sin(th * 9));
        x *= k;
        y *= s > 0 ? k : 1;
      }
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // the fringe: a big soft swoop over the top, longer on the left, with three locks along the forehead
  function hairPath(ctx, a, bb, dy = 0) {
    ctx.beginPath();
    ctx.moveTo(-1.3 * a, 0.1 * bb + dy);
    ctx.bezierCurveTo(-1.44 * a, -0.45 * bb, -1.02 * a, -1.32 * bb, -0.1 * a, -1.34 * bb);
    ctx.bezierCurveTo(0.76 * a, -1.35 * bb, 1.24 * a, -0.96 * bb, 1.16 * a, -0.42 * bb + dy);
    ctx.bezierCurveTo(1.13 * a, -0.2 * bb + dy, 1.0 * a, -0.1 * bb + dy, 0.86 * a, -0.2 * bb + dy);
    ctx.bezierCurveTo(0.62 * a, -0.36 * bb + dy, 0.36 * a, -0.5 * bb + dy, 0.12 * a, -0.42 * bb + dy);
    ctx.bezierCurveTo(-0.12 * a, -0.34 * bb + dy, -0.36 * a, -0.52 * bb + dy, -0.6 * a, -0.36 * bb + dy);
    ctx.bezierCurveTo(-0.86 * a, -0.2 * bb + dy, -1.0 * a, 0.06 * bb + dy, -1.3 * a, 0.1 * bb + dy);
    ctx.closePath();
  }

  // the paws: soft mittens in the body's colours, no outline
  function paws(ctx, b, a, bb, S) {
    for (const p of b.hands.p) {
      const k = p.s.v;
      if (k < 0.02) continue;
      const rx = a * 0.16;
      const ry = a * 0.21;
      ctx.save();
      ctx.translate(p.x.v * a, p.y.v * bb);
      ctx.rotate(p.r.v);
      ctx.scale(k, k);
      ctx.filter = `blur(${S * 0.014}px)`;
      ctx.fillStyle = 'rgba(90,64,200,.22)';
      ctx.beginPath();
      ctx.ellipse(0, ry * 0.16, rx * 1.02, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.filter = 'none';
      const g = ctx.createRadialGradient(-rx * 0.4, -ry * 0.45, 0, 0, 0, ry * 1.25);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#f4f0ff');
      g.addColorStop(1, '#c9bdf3');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      if (b.hands.pose === 'grip') {
        // curled fingers over the edge: three soft dimples along the tip, no lines
        ctx.filter = `blur(${S * 0.006}px)`;
        ctx.fillStyle = 'rgba(110,86,210,.32)';
        for (const fx of [-0.45, 0, 0.45]) {
          ctx.beginPath();
          ctx.ellipse(fx * rx + rx * 0.22, ry * 0.62, rx * 0.06, ry * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.filter = 'none';
      }
      ctx.restore();
    }
  }

  const INK = '#2a2245';

  // Pony in one colour, for tiny icons (the menu bar's template): solid body and fringe, a thin gap between them,
  // two eye holes; fills a `size` square
  function glyph(ctx, size, color = '#000') {
    const f = {};
    for (const k of SHAPE_KEYS) f[k] = { v: BODY[k] ?? 0 };
    const a = size * 0.36;
    const bb = (a * BODY.h) / BODY.w;
    ctx.save();
    ctx.translate(size / 2 + a * 0.1, size / 2 + bb * 0.3);
    ctx.fillStyle = color;
    bodyPath(ctx, a, bb, f, false);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = size * 0.07;
    hairPath(ctx, a, bb);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * a * 0.34, bb * 0.3, a * 0.16, bb * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    hairPath(ctx, a, bb);
    ctx.fill();
    ctx.restore();
  }

  function face(ctx, b, mood, a, bb, S) {
    const open = Math.max(0.08, b.open.v);
    const ey = bb * 0.22;
    const gap = a * 0.3;
    const rx = a * 0.1;
    const ry = bb * 0.2;
    const lw = Math.max(1.1, S * 0.03);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = lw;

    // cheeks
    if (mood !== 'dizzy') {
      ctx.save();
      ctx.filter = `blur(${Math.max(0.5, S * 0.014)}px)`;
      ctx.fillStyle = 'rgba(255,140,195,.5)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * a * 0.56, ey + ry * 1.0, a * 0.18, bb * 0.085, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * gap, ey);
      if (mood === 'dizzy') {
        ctx.beginPath();
        for (let i = 0; i < 40; i++) {
          const t = (i / 40) * Math.PI * 4 + b.t * 8 * side;
          const r = (i / 40) * rx * 1.4;
          if (i) ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r);
          else ctx.moveTo(0, 0);
        }
        ctx.lineWidth = lw * 0.7;
        ctx.stroke();
      } else if (mood === 'happy') {
        ctx.beginPath(); // ^
        ctx.moveTo(-rx * 1.35, ry * 0.35);
        ctx.quadraticCurveTo(0, -ry * 0.95, rx * 1.35, ry * 0.35);
        ctx.stroke();
      } else if (mood === 'think' || mood === 'done') {
        ctx.beginPath(); // > <
        const d = side < 0 ? 1 : -1;
        ctx.moveTo(-d * rx * 1.1, -ry * 0.6);
        ctx.lineTo(d * rx * 0.95, 0);
        ctx.lineTo(-d * rx * 1.1, ry * 0.6);
        ctx.stroke();
      } else if (mood === 'sleep' || mood === 'working') {
        ctx.beginPath(); // ‿
        ctx.moveTo(-rx * 1.35, -ry * 0.05);
        ctx.quadraticCurveTo(0, ry * 0.85, rx * 1.35, -ry * 0.05);
        ctx.stroke();
      } else {
        const k = mood === 'attention' ? 0.78 : 1;
        const h = Math.max(0.6, ry * open * k);
        const g = ctx.createLinearGradient(0, -h, 0, h);
        g.addColorStop(0, '#3b3160');
        g.addColorStop(1, '#18132c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * k, h, 0, 0, Math.PI * 2);
        ctx.fill();
        if (open > 0.45) {
          ctx.fillStyle = 'rgba(255,255,255,.92)';
          ctx.beginPath();
          ctx.arc(-rx * 0.32 * k, -h * 0.42, rx * 0.36 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // mouths only where the board has one
    const my = ey + ry * 1.35;
    ctx.fillStyle = INK;
    if (mood === 'done') {
      ctx.beginPath(); // D
      ctx.moveTo(-a * 0.13, my - ry * 0.15);
      ctx.quadraticCurveTo(0, my + ry * 1.3, a * 0.13, my - ry * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.ellipse(0, my + ry * 0.75, a * 0.08, ry * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (mood === 'attention' || mood === 'dizzy') {
      ctx.beginPath();
      ctx.ellipse(0, my + ry * 0.15, a * 0.045, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === 'working' || mood === 'sleep') {
      ctx.lineWidth = lw * 0.75;
      ctx.beginPath();
      ctx.moveTo(-a * 0.06, my);
      ctx.quadraticCurveTo(0, my + ry * 0.4, a * 0.06, my);
      ctx.stroke();
    }
  }

  // what a mood adds around the head: "…" bubble, "!!", rays, "Zz", sound arcs, sparkles
  function adorn(ctx, b, mood, cx, top, a, bb, S) {
    const reduced = reducedMotion();
    const t = reduced ? 0 : b.t;
    const x = cx + a * 0.95;
    const y = top - S * 0.02;
    ctx.save();
    ctx.lineCap = 'round';
    if (mood === 'think') {
      const w = S * 0.26;
      const h = S * 0.15;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(60,40,140,.25)';
      ctx.shadowBlur = S * 0.04;
      ctx.beginPath();
      ctx.roundRect(x - w * 0.55, y - h * 0.9, w, h, h / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x - w * 0.5, y + h * 0.25, h * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b3160';
      for (let i = -1; i <= 1; i++) {
        ctx.globalAlpha = 0.45 + 0.55 * Math.max(0, Math.sin(t * 6 - i));
        ctx.beginPath();
        ctx.arc(x - w * 0.05 + i * w * 0.22, y - h * 0.4, h * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mood === 'attention') {
      ctx.fillStyle = '#6a4cff';
      ctx.font = `900 ${S * 0.2}px -apple-system, system-ui`;
      ctx.textAlign = 'center';
      ctx.translate(x, y);
      ctx.rotate(0.18 + (reduced ? 0 : Math.sin(t * 9) * 0.06));
      ctx.fillText('!!', 0, 0);
    } else if (mood === 'done') {
      ctx.strokeStyle = '#ffc23d';
      ctx.lineWidth = Math.max(1.2, S * 0.032);
      for (let i = 0; i < 3; i++) {
        const ang = -1.25 + i * 0.42;
        const r0 = S * (0.07 + (reduced ? 0 : 0.015 * Math.sin(t * 8 + i)));
        ctx.beginPath();
        ctx.moveTo(x - a * 0.2 + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
        ctx.lineTo(x - a * 0.2 + Math.cos(ang) * (r0 + S * 0.08), y + Math.sin(ang) * (r0 + S * 0.08));
        ctx.stroke();
      }
    } else if (mood === 'sleep') {
      ctx.fillStyle = '#7b61ff';
      ctx.textAlign = 'center';
      for (let i = 0; i < 2; i++) {
        const p = reduced ? 0.4 + i * 0.3 : (b.t * 0.45 + i / 2) % 1;
        ctx.globalAlpha = reduced ? 1 : Math.sin(p * Math.PI);
        ctx.font = `900 ${S * (0.1 + (1 - i) * 0.06)}px -apple-system, system-ui`;
        ctx.fillText(i ? 'z' : 'Z', x - a * 0.1 + i * S * 0.1 + p * S * 0.05, y - p * S * 0.12 + i * S * 0.04);
      }
    } else if (mood === 'music' || mood === 'listening') {
      ctx.strokeStyle = '#7b61ff';
      ctx.lineWidth = Math.max(1.1, S * 0.03);
      const cy = top + bb * 1.2;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          ctx.globalAlpha = reduced ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - i * 1.2));
          const r = S * (0.08 + i * 0.07);
          ctx.beginPath();
          ctx.arc(cx + side * (a * 1.08), cy, r, side < 0 ? Math.PI * 0.72 : -Math.PI * 0.28, side < 0 ? Math.PI * 1.28 : Math.PI * 0.28);
          ctx.stroke();
        }
      }
    } else if (mood === 'working') {
      ctx.fillStyle = '#ffc23d';
      for (let i = 0; i < 3; i++) {
        const s0 = S * (i === 0 ? 0.07 : 0.045) * (reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 4 + i * 2));
        const px = x - a * 0.15 + [0, S * 0.11, S * 0.03][i];
        const py = y + [0, -S * 0.07, -S * 0.13][i];
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const r = k % 2 ? s0 * 0.3 : s0;
          const an = (k / 8) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(px + Math.cos(an) * r, py + Math.sin(an) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw(ctx, b, W, H, ox, floor) {
    const S = Math.min(W, H) * b.scale;
    const f = b.form;
    const hair = COLOR_STOPS[b.color] || COLOR_STOPS.Lavender;
    const a = (S * f.w.v) / 2;
    const bb = (S * f.h.v) / 2;
    const bot = bb * (1 - 0.35 * f.dome.v);
    const reduced = reducedMotion();
    const mood = performance.now() < b.dizzyUntil ? 'dizzy' : b.mood;
    const breath = reduced || mood === 'idle' ? 0 : Math.sin(b.t * 2 * Math.PI * 0.3) * 0.012;
    const sx = b.sx.v * (1 - breath * 0.7);
    const sy = b.sy.v * (1 + breath);
    const lx = b.look.x.v;
    const ly = b.look.y.v;
    const fluffy = b.shape === 'Soft';

    const air = Math.min(1, -b.y / (S * 0.5));
    ctx.save();
    if (!b.shadow) ctx.globalAlpha = 0;
    ctx.filter = `blur(${S * 0.035}px)`;
    ctx.fillStyle = `rgba(40,20,90,${0.32 - air * 0.18})`;
    ctx.beginPath();
    ctx.ellipse(ox, floor + S * 0.015, a * sx * (1 - air * 0.35), S * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(ox, floor + b.y);
    ctx.rotate(b.lean.v * 0.08);
    ctx.scale(sx, sy);
    ctx.translate(0, -bot);

    // Pro: the headset's ear cups sit behind the cheeks
    if (b.shape === 'Pro') {
      for (const side of [-1, 1]) {
        const g = ctx.createLinearGradient(0, -bb * 0.4, 0, bb * 0.4);
        g.addColorStop(0, hair[1]);
        g.addColorStop(1, hair[2]);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(side * a * 1.0, bb * 0.02, a * 0.17, bb * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // body: soft white to lavender, lit from the top left
    bodyPath(ctx, a, bb, f, fluffy);
    const base = ctx.createRadialGradient(-a * 0.35 - lx * a * 0.2, -bb * 0.35, 0, -a * 0.1, 0, a * 1.7);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(0.42, '#f4f0ff');
    base.addColorStop(1, '#cbbff5');
    ctx.fillStyle = base;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const shade = ctx.createRadialGradient(a * 0.55, bb * 0.8, 0, a * 0.55, bb * 0.8, a * 1.25);
    shade.addColorStop(0, 'rgba(105,80,210,.26)');
    shade.addColorStop(1, 'rgba(105,80,210,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(-a * 1.3, -bb * 1.3, a * 2.6, bb * 2.6);
    const glow = ctx.createLinearGradient(0, bb * 0.5, 0, bb);
    glow.addColorStop(0, 'rgba(255,255,255,0)');
    glow.addColorStop(1, 'rgba(255,240,255,.22)');
    ctx.fillStyle = glow;
    ctx.fillRect(-a * 1.3, -bb * 1.3, a * 2.6, bb * 2.6);
    // the fringe's soft shadow on the forehead
    ctx.filter = `blur(${S * 0.022}px)`;
    ctx.fillStyle = 'rgba(90,64,200,.2)';
    hairPath(ctx, a, bb, bb * 0.09);
    ctx.fill();
    ctx.filter = 'none';
    ctx.restore();

    // face, following the look
    ctx.save();
    ctx.translate(lx * a * 0.22, ly * bb * 0.14);
    ctx.scale(1 - Math.abs(lx) * 0.12, 1 - Math.abs(ly) * 0.08);
    face(ctx, b, mood, a, bb, S);
    ctx.restore();

    // the fringe (a touch of parallax against the face)
    ctx.save();
    ctx.translate(-lx * a * 0.05, -ly * bb * 0.03);
    hairPath(ctx, a, bb);
    const hg = ctx.createLinearGradient(-a * 0.4, -bb * 1.34, a * 0.3, -bb * 0.1);
    hg.addColorStop(0, hair[0]);
    hg.addColorStop(0.5, hair[1]);
    hg.addColorStop(1, hair[2]);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // the underside turns away from the light: a darker band along the fringe's lower edge
    ctx.filter = `blur(${S * 0.03}px)`;
    ctx.strokeStyle = 'rgba(35,12,110,.38)';
    ctx.lineWidth = S * 0.07;
    hairPath(ctx, a, bb, bb * 0.05);
    ctx.stroke();
    // a soft gloss on the dome
    ctx.filter = `blur(${S * 0.025}px)`;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath();
    ctx.ellipse(-a * 0.38, -bb * 1.06, a * 0.5, bb * 0.13, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Pro: the band over the fringe and the mic
    if (b.shape === 'Pro') {
      ctx.strokeStyle = hair[2];
      ctx.lineWidth = Math.max(1.4, S * 0.04);
      ctx.beginPath();
      ctx.moveTo(-a * 1.0, -bb * 0.2);
      ctx.bezierCurveTo(-a * 1.05, -bb * 1.45, a * 1.05, -bb * 1.45, a * 1.0, -bb * 0.2);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, S * 0.022);
      ctx.beginPath();
      ctx.moveTo(-a * 1.02, bb * 0.2);
      ctx.quadraticCurveTo(-a * 0.9, bb * 0.62, -a * 0.38, bb * 0.58);
      ctx.stroke();
      ctx.fillStyle = hair[2];
      ctx.beginPath();
      ctx.arc(-a * 0.36, bb * 0.58, S * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    // a gripping paw stays on its edge (canvas y gripY) as the body moves or squashes
    b.hands.gripLocal = ((b.hands.gripY - floor - b.y) / sy + bot + a * 0.13) / bb;
    paws(ctx, b, a, bb, S);
    ctx.restore();

    for (const p of b.parts) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(ox + p.x, floor + b.y + p.y - bot, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    adorn(ctx, b, mood, ox, floor + b.y - (bb + bot) * sy - bb * 0.3 * sy, a * sx, bb * sy, S);
  }

  // ================================================================== 3D (Three.js)
  // Pony as a real 3D character (brand guide "Three.js"): a soft matte body (a deformed sphere), a satin fringe (a
  // separate, deformed cap), dark non-reflective eyes, soft blush, studio light. One shared WebGL renderer draws every
  // Pony on the page (browsers allow only a few WebGL contexts): each canvas gets its frame copied in, then the mood's
  // 2D touches ("…", "!!", Zz…) go on top. Without window.THREE, the 2D drawing above is used.
  let R3 = null;

  function radialTexture(T, inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  // the body's surface: x, y on the face → the point and its outward normal (for eyes, cheeks, mouth)
  const BODY3 = { w: 1.08, h: 0.98, d: 0.98 };
  function bodyShape(T, x, y, z, fluffy) {
    // a soft blob: wider and flatter at the bottom, a little narrower on top
    const k = y < 0 ? 1 + 0.3 * -y : 1 - 0.16 * y;
    let py = y > -0.55 ? y : -0.55 + (y + 0.55) * 0.42;
    let px = x * BODY3.w * k;
    let pz = z * BODY3.d * k;
    if (fluffy && y < 0.15) {
      const f = 1 + 0.035 * Math.sin(Math.atan2(z, x) * 11) * Math.min(1, (0.15 - y) * 2);
      px *= f;
      pz *= f;
    }
    return new T.Vector3(px, py * BODY3.h, pz);
  }
  function onFace(T, body, x, y, lift) {
    // cast from the front onto the body mesh (in its own coordinates), then lift to where the body stands
    body.updateMatrixWorld(true);
    const ray = new T.Raycaster(new T.Vector3(x, y + lift, 5), new T.Vector3(0, 0, -1));
    const hit = ray.intersectObject(body, false)[0];
    if (!hit) return { p: new T.Vector3(x, y + lift, 0.95), n: new T.Vector3(0, 0, 1) };
    const n = hit.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(body.matrixWorld)).normalize();
    return { p: hit.point, n };
  }

  function buildRig(T) {
    const rig = new T.Group();
    const lean = new T.Group(); // squash / lean / hop pivot at the bottom
    rig.add(lean);
    const head = new T.Group(); // turns with the look
    lean.add(head);

    const mats = {
      body: new T.MeshPhysicalMaterial({ color: 0xfffaff, roughness: 0.55, sheen: 1.0, sheenColor: new T.Color(0xffd2ec), sheenRoughness: 0.5, emissive: 0x3a2060, emissiveIntensity: 0.05 }),
      hair: new T.MeshPhysicalMaterial({ color: 0x8f7bff, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new T.Color(0xd9ccff) }),
      ink: new T.MeshBasicMaterial({ color: 0x1d1730 }),
      shine: new T.MeshBasicMaterial({ color: 0xffffff }),
      blush: new T.MeshBasicMaterial({ map: radialTexture(T, 'rgba(255,135,190,.75)', 'rgba(255,135,190,0)'), transparent: true, depthWrite: false }),
      shadow: new T.MeshBasicMaterial({ map: radialTexture(T, 'rgba(40,18,90,.55)', 'rgba(40,18,90,0)'), transparent: true, depthWrite: false }),
      tongue: new T.MeshBasicMaterial({ color: 0xff7aa8 }),
    };

    const bodies = {};
    for (const fluffy of [false, true]) {
      const g = new T.SphereGeometry(1, 96, 72);
      const pos = g.attributes.position;
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const p = bodyShape(T, v.x, v.y, v.z, fluffy);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
      bodies[fluffy ? 'Soft' : 'Classic'] = new T.Mesh(g, mats.body);
    }
    // (the body's bottom sits at y = 0 of the lean group)
    const bottom = 0.55 * BODY3.h + 0.45 * 0.42 * BODY3.h;
    for (const m of Object.values(bodies)) { m.position.y = bottom; head.add(m); }

    // the fringe ("poni"): a soft, thick pillow laid over the head (a superellipsoid: a box with round edges), wider
    // than the head, bent to follow it front to back, drooping into a swoop on the left and rounder, higher on the
    // right, its front edge waving softly over the forehead
    const hg = new T.SphereGeometry(1, 128, 96);
    {
      const pos = hg.attributes.position;
      const v = new T.Vector3();
      const sp = (t, e) => Math.sign(t) * Math.abs(t) ** e;
      const A = 1.24, B = 0.34, C = 1.1;
      const topY = bottom + 0.86 * BODY3.h * 0.98;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let x = A * sp(v.x, 0.62);
        let y = B * sp(v.y, 0.7);
        let z = C * sp(v.z, 0.62);
        const nx = x / A;
        const nz = z / C;
        // follow the head: droop at the sides and front/back
        y -= (nx < 0 ? 0.5 : 0.42) * nx * nx;
        y -= 0.42 * nz * nz;
        // the swoop: the front left corner hangs further down and out
        const swoop = Math.max(0, -nx) ** 2 * Math.max(0, 0.2 + nz);
        y -= 0.24 * swoop;
        x -= 0.06 * swoop;
        // the right end curls up a little
        y += 0.1 * Math.max(0, nx) ** 3 * Math.max(0, nz);
        // soft waves along the front edge, underneath
        if (v.y < 0 && nz > 0.2) y += 0.05 * Math.sin(nx * 7 + 0.4) * nz;
        pos.setXYZ(i, x - 0.04, y + topY + 0.06, z + 0.06);
      }
      hg.computeVertexNormals();
    }
    const hair = new T.Mesh(hg, mats.hair);
    hair.rotation.z = 0.05;
    head.add(hair);

    // the face: eyes (ovals, and the drawn ones for other moods), cheeks, mouths; placed on the Classic body
    const face = new T.Group();
    head.add(face);
    const eyeY = -0.08; // (in the body's coordinates)
    const parts = { oval: [], shine: [], happy: [], wink: [], closed: [], eyeMat: mats.ink.clone() };
    const tube = (pts, r = 0.03) => new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, r, 8, false), mats.ink);
    for (const side of [-1, 1]) {
      const at = onFace(T, bodies.Classic, side * 0.3, eyeY, bottom);
      const holder = new T.Group();
      holder.position.copy(at.p);
      holder.lookAt(at.p.clone().add(at.n));
      face.add(holder);
      const eye = new T.Mesh(new T.SphereGeometry(1, 32, 24), parts.eyeMat);
      eye.scale.set(0.085, 0.145, 0.04);
      holder.add(eye);
      parts.oval.push(eye);
      const sh = new T.Mesh(new T.SphereGeometry(1, 16, 12), mats.shine);
      sh.scale.set(0.026, 0.03, 0.012);
      sh.position.set(-0.026, 0.06, 0.03);
      holder.add(sh);
      parts.shine.push(sh);
      const V = (x, y) => new T.Vector3(x, y, 0.012);
      const happy = tube([V(-0.1, -0.035), V(0, 0.07), V(0.1, -0.035)]); // ^
      const closed = tube([V(-0.1, 0.025), V(0, -0.065), V(0.1, 0.025)]); // ‿
      const d = side < 0 ? 1 : -1;
      const wink = tube([V(-d * 0.085, 0.085), V(d * 0.07, 0), V(-d * 0.085, -0.085)], 0.028); // > <
      for (const m of [happy, closed, wink]) holder.add(m);
      parts.happy.push(happy);
      parts.closed.push(closed);
      parts.wink.push(wink);
      // cheek
      const ca = onFace(T, bodies.Classic, side * 0.56, eyeY - 0.17, bottom);
      const cheek = new T.Mesh(new T.PlaneGeometry(0.34, 0.17), mats.blush);
      cheek.position.copy(ca.p).add(ca.n.clone().multiplyScalar(0.01));
      cheek.lookAt(ca.p.clone().add(ca.n));
      face.add(cheek);
    }
    const ma = onFace(T, bodies.Classic, 0, eyeY - 0.24, bottom);
    const mouth = new T.Group();
    mouth.position.copy(ma.p);
    mouth.lookAt(ma.p.clone().add(ma.n));
    face.add(mouth);
    const mouthO = new T.Mesh(new T.SphereGeometry(1, 20, 16), mats.ink);
    mouthO.scale.set(0.035, 0.05, 0.015);
    const mouthD = new T.Mesh(new T.CircleGeometry(0.11, 32, Math.PI, Math.PI), mats.ink);
    mouthD.position.set(0, 0.05, 0.006);
    const tongue = new T.Mesh(new T.CircleGeometry(0.055, 24, Math.PI, Math.PI), mats.tongue);
    tongue.position.set(0, -0.035, 0.002);
    mouthD.add(tongue);
    const mouthSmile = tube([new T.Vector3(-0.05, 0.01, 0.01), new T.Vector3(0, -0.025, 0.01), new T.Vector3(0.05, 0.01, 0.01)], 0.014);
    mouth.add(mouthO, mouthD, mouthSmile);
    parts.mouthO = mouthO;
    parts.mouthD = mouthD;
    parts.mouthSmile = mouthSmile;

    // Pro: a headset band over the fringe, ear cups, a mic
    const pro = new T.Group();
    const band = new T.Mesh(new T.TorusGeometry(1.1, 0.045, 12, 64, Math.PI), mats.hair);
    band.position.y = bottom + 0.18;
    band.scale.set(1.08, 1.06, 1);
    pro.add(band);
    for (const side of [-1, 1]) {
      const cup = new T.Mesh(new T.SphereGeometry(1, 24, 16), mats.hair);
      cup.scale.set(0.11, 0.2, 0.17);
      cup.position.set(side * 1.2, bottom + 0.06, 0);
      pro.add(cup);
    }
    const mic = tube([new T.Vector3(-1.2, bottom - 0.05, 0.1), new T.Vector3(-1.05, bottom - 0.45, 0.55), new T.Vector3(-0.45, bottom - 0.42, 0.95)], 0.02);
    mic.material = mats.hair;
    pro.add(mic);
    head.add(pro);

    const shadow = new T.Mesh(new T.PlaneGeometry(2.8, 0.9), mats.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    rig.add(shadow);

    return { rig, lean, head, bodies, hair, parts, pro, shadow, mats, bottom, top: bottom + 1.0 };
  }

  function r3() {
    const T = typeof window !== 'undefined' && window.THREE;
    if (!T) return null;
    if (R3) return R3;
    try {
      const canvas = document.createElement('canvas');
      const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.NeutralToneMapping || T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setClearColor(0x000000, 0);
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(24, 1, 0.1, 50);
      camera.position.set(0, 1.45, 7.4);
      camera.lookAt(0, 0.82, 0);
      scene.add(new T.HemisphereLight(0xfbf8ff, 0x8d76e0, 1.6));
      const key = new T.DirectionalLight(0xffffff, 2.3);
      key.position.set(-3.2, 4.5, 5);
      scene.add(key);
      const rim = new T.DirectionalLight(0xc9b8ff, 2.0);
      rim.position.set(3.5, 2.5, -4);
      scene.add(rim);
      const fill = new T.DirectionalLight(0xffd6ec, 0.55);
      fill.position.set(2.5, -0.5, 3.5);
      scene.add(fill);
      const rig = buildRig(T);
      scene.add(rig.rig);
      R3 = { T, renderer, canvas, scene, camera, rig, size: 0 };
    } catch (e) {
      R3 = null;
      window.__ponyNo3d = true;
    }
    return R3;
  }

  // one frame of `b` into ctx, in the same frame as the 2D drawing: centred on ox, standing on floor, about S wide
  function draw3d(ctx, b, W, H, ox, floor) {
    const r = r3();
    if (!r) return draw(ctx, b, W, H, ox, floor);
    const { T, renderer, camera, rig } = r;
    const S = Math.min(W, H) * b.scale;
    const dpr = (ctx.getTransform && ctx.getTransform().a) || 1;
    const px = Math.max(16, Math.round(S * 1.25 * dpr));
    if (px > r.size) {
      r.size = Math.min(2048, Math.max(px, 256));
      renderer.setSize(r.size, r.size, false);
    }
    const mood = performance.now() < b.dizzyUntil ? 'dizzy' : b.mood;
    const reduced = reducedMotion();
    const lx = b.look.x.v;
    const ly = b.look.y.v;

    // pose
    rig.lean.scale.set(b.sx.v, b.sy.v, b.sx.v);
    rig.lean.rotation.z = -b.lean.v * 0.1;
    const hopUnits = -b.y / (S * 0.42);
    const float = !reduced && mood !== 'idle' && mood !== 'sleep' ? Math.sin(b.t * 2.2) * 0.03 : 0;
    rig.lean.position.y = hopUnits + float;
    rig.head.rotation.y = lx * 0.42;
    rig.head.rotation.x = ly * 0.2;
    rig.shadow.visible = b.shadow;
    rig.shadow.scale.setScalar(1 - Math.min(0.4, hopUnits * 0.5));
    rig.shadow.material.opacity = 1 - Math.min(0.6, hopUnits);
    // look
    const hairStops = COLOR_STOPS[b.color] || COLOR_STOPS.Lavender;
    rig.mats.hair.color.set(hairStops[1]);
    rig.mats.hair.sheenColor.set(hairStops[0]);
    const shape = b.shape;
    rig.bodies.Classic.visible = shape !== 'Soft';
    rig.bodies.Soft.visible = shape === 'Soft';
    rig.pro.visible = shape === 'Pro';
    // face
    const P = rig.parts;
    const ovals = !['happy', 'think', 'done', 'sleep', 'working', 'dizzy'].includes(mood);
    const open = Math.max(0.08, b.open.v) * (mood === 'attention' ? 0.82 : 1);
    // (looking at the user's screen: the eyes glow cyan)
    P.eyeMat.color.setHex(mood === 'looking' ? 0x22d3ee : 0x1d1730);
    P.oval.forEach((m) => { m.visible = ovals; m.scale.y = 0.145 * open; m.scale.x = 0.085 * (mood === 'attention' ? 0.85 : 1); });
    P.shine.forEach((m) => { m.visible = ovals && open > 0.45; });
    P.happy.forEach((m) => { m.visible = mood === 'happy'; });
    P.wink.forEach((m) => { m.visible = mood === 'think' || mood === 'done' || mood === 'dizzy'; });
    P.closed.forEach((m) => { m.visible = mood === 'sleep' || mood === 'working'; });
    P.mouthO.visible = mood === 'attention' || mood === 'dizzy';
    P.mouthD.visible = mood === 'done';
    P.mouthSmile.visible = mood === 'working' || mood === 'sleep';

    // render into the top-left px×px of the shared canvas
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    const n = r.size;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, n, n);
    renderer.clear();
    renderer.setViewport(0, n - px, px, px);
    renderer.render(r.scene, camera);

    // where the feet and the top land in that frame, so it stands on `floor` centred on `ox`
    const foot = new T.Vector3(0, 0, 0).project(camera);
    const top = new T.Vector3(0, rig.top + 0.12, 0).project(camera);
    const fx = ((foot.x + 1) / 2) * px;
    const fy = ((1 - foot.y) / 2) * px;
    const k = 1 / dpr;
    const dw = px * k;
    ctx.drawImage(r.canvas, 0, 0, px, px, ox - fx * k, floor - fy * k + (b.y < 0 ? 0 : 0), dw, dw);

    // the mood's 2D touches, at the head's top right
    const headTop = floor - (fy - ((1 - top.y) / 2) * px) * k;
    const a = S * 0.36;
    for (const p of b.parts) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(ox + p.x, floor + p.y - S * 0.2, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    adorn(ctx, b, mood, ox, headTop + b.y * 0, a, S * 0.33, S);
  }

  // the drawing every canvas uses: 3D when Three.js is on the page, else 2D
  function paint(ctx, b, W, H, ox, floor) {
    return typeof window !== 'undefined' && window.THREE && !window.__ponyNo3d ? draw3d(ctx, b, W, H, ox, floor) : draw(ctx, b, W, H, ox, floor);
  }

  function mount(canvas, opts) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const b = createBuddy(opts || {});
    let destroyed = false;
    let paused = false;
    let rafId = 0;
    let blinkTimer = null;
    let lastTs = performance.now();

    function fit() {
      const r = canvas.getBoundingClientRect();
      const w = r.width || canvas.clientWidth || Number(canvas.getAttribute('width')) || 72;
      const h = r.height || canvas.clientHeight || Number(canvas.getAttribute('height')) || 56;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.max(1, Math.round(w * d));
      const ph = Math.max(1, Math.round(h * d));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(d, 0, 0, d, 0, 0);
      return { w, h };
    }

    function paintOnce() {
      const { w, h } = fit();
      ctx.clearRect(0, 0, w, h);
      paint(ctx, b, w, h, w / 2, h * b.floorFrac);
    }

    function isVisible() {
      return !destroyed && !paused && canvas.isConnected && canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
    }

    function scheduleBlink() {
      if (!isVisible() || blinkTimer || b.mood === 'sleep') return;
      const delay = Math.round(rnd(4200, 5500));
      blinkTimer = setTimeout(() => {
        blinkTimer = null;
        if (!isVisible()) return;
        if (b.mood !== 'sleep') {
          b.bt = Math.random() < 0.2 ? -0.34 : 0;
          wake();
        }
      }, delay);
    }

    function tick(now) {
      rafId = 0;
      if (!isVisible()) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      update(b, dt, now);
      if (isAtRest(b, now)) {
        for (const sp of [b.look.x, b.look.y, b.sx, b.sy, b.lean, b.smile, b.shut, b.badge, ...Object.values(b.form), ...pawSprings(b)]) {
          sp.v = sp.t;
          sp.vel = 0;
        }
        paintOnce();
        scheduleBlink();
      } else {
        paintOnce();
        rafId = requestAnimationFrame(tick);
      }
    }

    function wake() {
      if (!isVisible()) return;
      if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
      if (!rafId) {
        lastTs = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    }

    // Draw first frame immediately, then let springs settle if needed
    paintOnce();
    if (!isAtRest(b, performance.now())) wake();
    else scheduleBlink();

    return {
      setMood(m) {
        const next = m || 'idle';
        if (b.mood === next) return;
        b.mood = next;
        if (next === 'done') b.hop(1);
        wake();
      },
      setLook(shape, color) {
        let changed = false;
        if (shape && validShape(shape) !== b.shape) {
          b.setShape(shape);
          changed = true;
        }
        if (color && validColor(color) !== b.color) {
          b.color = validColor(color);
          changed = true;
        }
        if (changed) wake();
      },
      lookAt(x, y) {
        b.target = { x: Number(x) || 0, y: Number(y) || 0 };
        b.lastMouse = performance.now();
        wake();
      },
      hop(power) {
        b.hop(power);
        wake();
      },
      poke() {
        b.poke();
        wake();
      },
      // paws: 'none' | 'rest' | 'grip' (holding an edge at canvas y `gripY`, CSS px) | 'up' | 'wave'
      setHands(pose, gripY) {
        b.hands.pose = pose || 'none';
        if (typeof gripY === 'number') b.hands.gripY = gripY;
        wake();
      },
      repaint() {
        paintOnce();
      },
      pause() {
        paused = true;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
      },
      resume() {
        if (!paused) return;
        paused = false;
        paintOnce();
        if (!isAtRest(b, performance.now())) wake();
        else scheduleBlink();
      },
      destroy() {
        destroyed = true;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
        if (b.hopTimer) { clearTimeout(b.hopTimer); b.hopTimer = null; }
        if (b.pokeTimer) { clearTimeout(b.pokeTimer); b.pokeTimer = null; }
      },
    };
  }

  // A small inline SVG of Pony (fringe in the chosen colour) for tiny UI icons
  function faceIcon(mood, colorName) {
    const c = validColor(colorName);
    const col = COLOR_STOPS[c];
    const m = mood || 'idle';
    const eyes = m === 'sleep' || m === 'working'
      ? '<path d="M8.2 14.6q1.2 1.3 2.4 0M13.4 14.6q1.2 1.3 2.4 0" stroke="#2a2245" stroke-width="1.3" stroke-linecap="round" fill="none"/>'
      : m === 'happy' || m === 'done'
        ? '<path d="M8.1 15q1.3-1.8 2.6 0M13.3 15q1.3-1.8 2.6 0" stroke="#2a2245" stroke-width="1.3" stroke-linecap="round" fill="none"/>'
        : '<ellipse cx="9.4" cy="14.4" rx="1.05" ry="1.7" fill="#2a2245"/><ellipse cx="14.6" cy="14.4" rx="1.05" ry="1.7" fill="#2a2245"/>';
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><linearGradient id="ph_${c}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col[0]}"/><stop offset=".5" stop-color="${col[1]}"/><stop offset="1" stop-color="${col[2]}"/></linearGradient></defs>`
      + `<path d="M3.6 14.2c0-4.6 3.8-7.6 8.4-7.6s8.4 3 8.4 7.6c0 3.8-3.1 6.3-8.4 6.3s-8.4-2.5-8.4-6.3z" fill="#f2eeff"/>`
      + `<ellipse cx="7.2" cy="16.4" rx="1.6" ry=".8" fill="#ff8cc3" opacity=".55"/><ellipse cx="16.8" cy="16.4" rx="1.6" ry=".8" fill="#ff8cc3" opacity=".55"/>`
      + eyes
      + `<path d="M2.3 12.6C1.9 8.4 5.6 4.2 12 4.2s10 3.4 9.6 7.4c-.3 1-1.4.9-2.2.3-1.2-.9-2.5-.3-3.6-.9-1.3-.6-2.4.4-3.8-.1-1.4-.5-2.6.6-4.1.6-1.7 0-3.6 1.7-5.6 1.1z" fill="url(#ph_${c})"/>`
      + `</svg>`;
  }

  // One still frame of Pony, drawn by the same renderer as the live canvas (so avatars match the composer and
  // the notch): settled springs, eyes looking ahead. Cached per look; returns a PNG data URL.
  const snapCache = new Map();
  function snapshot(opts) {
    const o = Object.assign({ size: 32, scale: 1, floorFrac: 0.76, mood: 'idle' }, opts || {});
    o.shape = validShape(o.shape);
    o.color = validColor(o.color);
    const key = [o.shape, o.color, o.mood, o.size, o.scale, o.floorFrac].join('|');
    if (snapCache.has(key)) return snapCache.get(key);
    const d = 2;
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(o.size * d);
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const b = createBuddy(o);
    update(b, 1 / 60, performance.now()); // let the mood set its targets
    b.look.x.t = 0;
    b.look.y.t = 0;
    for (const sp of [b.look.x, b.look.y, b.sx, b.sy, b.lean, b.smile, b.shut, b.badge, ...Object.values(b.form)]) {
      sp.v = sp.t;
      sp.vel = 0;
    }
    b.y = 0;
    b.parts = [];
    paint(ctx, b, o.size, o.size, o.size / 2, o.size * o.floorFrac);
    const url = c.toDataURL('image/png');
    snapCache.set(key, url);
    return url;
  }

  window.Pony = {
    snapshot,
    mount,
    DEFAULTS,
    look,
    SHAPES,
    COLORS,
    COLOR_STOPS,
    SHAPE_DEFS,
    faceIcon,
    glyph,
  };
})();
