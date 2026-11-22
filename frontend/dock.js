// The Dock: pinned apps and open apps at the bottom of the screen, like the macOS Dock. main (dock.rs)
// sends what's pinned and what's open ('dock:state'); this page draws it, magnifies the icons near the
// mouse, and tells main which part of the window takes clicks (everything else passes through). There's one
// Dock window per display it's on: the calls about this one carry its window's label last.
(function () {
  const api = window.notch;
  const me = window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dock = $('#dock'); const itemsEl = $('#items'); const label = $('#label'); const menu = $('#menu'); const statusEl = $('#status');
  const winsEl = $('#wins');

  let S = {};
  let state = { pinned: [], open: [], trash: '' };
  let list = []; // what's drawn, in order: { kind: 'pinned' | 'open' | 'sep' | 'trash' | 'start' | 'search' | 'taskview', … }
  const icons = new Map(); // icon source → data URL (null: none; undefined: asked)
  const st = {
    hover: false, hoverEl: null, hidden: false, menu: null, press: null, drag: null, dropping: false, pending: false,
    scales: [], target: [], raf: 0, hideT: 0, leaveT: 0, shapeKey: '', bouncing: new Set(),
    anchorX: null, wins: null, winsFor: null, winsT: 0, winsOffT: 0, wheelAt: 0, grow: [0, 0], growKey: '',
    showT: 0, sliding: null, slideT: 0, slideSeq: 0, standby: false,
    leaving: false, // on its way out for main to hide the window (dock:leaving)
    reached: false, // the mouse has been on the bar since it last came up (rects: the gap under a lifted bar)
  };

  // hidden until the mouse reaches the bottom edge: always (Settings → Dock → Hide the Dock until the mouse
  // reaches the bottom), or while main says a window is maximized on this Dock's display (Hide while a window is
  // maximized)
  const autoHide = () => !!(S.dockAutoHide || (S.dockHideMaximized && state.maximized));
  const size = () => clamp(Number(S.dockSize) || 50, 16, 96);
  const gap = () => clamp(Number(S.dockGap ?? 4), 0, 24);
  // Settings → Dock → Gap from the bottom edge: how much higher the bar floats (main makes the window that much taller)
  const lift = () => clamp(Number(S.dockLift) || 0, 0, 60);
  const maxScale = () => 1 + clamp(Number(S.dockMagnify ?? 60), 0, 100) / 100;

  // Settings → Dock → Style ("dark" and "glass" from before the five styles are Black and Frosted Glass).
  // Frosted Glass needs Windows to frost the window under the bar: with its transparency effects off or energy
  // saver on (main says, state.frost) it takes the Clear Glass look instead.
  const STYLES = ['black', 'white', 'clear', 'frosted', 'midnight', 'wallpaper'];
  const style = () => ({ dark: 'black', glass: 'frosted' }[S.dockStyle] || (STYLES.includes(S.dockStyle) ? S.dockStyle : 'black'));
  const frosted = () => style() === 'frosted' && state.frost !== false;
  const look = () => (style() === 'frosted' && !frosted() ? 'clear' : style());
  // Wallpaper color: the bar in the main colour of this display's wallpaper (tint.js asks main, wallcolor.rs; a dark
  // gray until it comes), --wall as "r, g, b"; on a light one the text and marks turn dark as on White (data-ink)
  function paintWall() {
    const on = look() === 'wallpaper';
    const hex = window.Tint ? Tint.wall(on) : null;
    const rgb = on && /^#[0-9a-f]{6}$/i.test(hex || '') ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
    const root = document.documentElement;
    // (set only when they change: render runs at every change of the open apps)
    const wall = rgb ? rgb.join(', ') : '';
    if (root.style.getPropertyValue('--wall') !== wall) { if (wall) root.style.setProperty('--wall', wall); else root.style.removeProperty('--wall'); }
    const ink = rgb && Tint.darkInk(rgb) ? 'dark' : '';
    if ((root.dataset.ink || '') !== ink) { if (ink) root.dataset.ink = ink; else delete root.dataset.ink; }
  }
  // Settings → Dock → Open-app marker: dots under the icon (one per window), a dot in its top corner (the number
  // of windows with two or more), a short line inside it at the bottom, or nothing
  const runMark = () => (['corner', 'line', 'none'].includes(S.dockRunMark) ? S.dockRunMark : 'dot');

  // ------------------------------------------------------------------ what's in the Dock
  function build() {
    const open = state.open || [];
    const pinned = state.pinned || [];
    // with the Windows taskbar hidden, the Dock has a Start button of its own, and Task View after it
    const start = !S.dockHideTaskbar ? [] : [{ kind: 'start', name: _t('Start|the Windows Start menu'), key: 'start' }]
      .concat(S.dockTaskView === false ? [] : [{ kind: 'taskview', name: _t('Task View'), key: 'taskview' }], [{ kind: 'sep' }]);
    // …and Search between the two when that's on (Settings → Dock, off by default), in the Windows 11 taskbar's order
    if (start.length && S.dockSearch) start.splice(1, 0, { kind: 'search', name: _t('Search'), key: 'search' });
    list = start.concat(pinned.map((p, i) => {
      const o = open.find((a) => a.keys.includes(p.key)) || null;
      return { kind: 'pinned', i, name: p.name || (o && o.name) || '', path: p.path, key: p.key, icon: p.icon, custom: p.custom, open: o };
    }));
    // open apps that aren't pinned, after a divider
    const extra = S.dockShowRunning === false ? [] : open.filter((o) => !pinned.some((p) => o.keys.includes(p.key)));
    if (extra.length) list.push({ kind: 'sep' });
    for (const o of extra) list.push({ kind: 'open', name: o.name, path: o.path, key: o.key, icon: o.icon, open: o });
    // the Recycle Bin at the end, unless it was taken off (Settings → Dock brings it back)
    if (S.dockTrash !== false) list.push({ kind: 'sep' }, { kind: 'trash', name: _t('Recycle Bin'), key: 'trash', icon: state.trash });
    // no divider at either end or two in a row (nothing pinned, no Recycle Bin…)
    list = list.filter((it, k) => it.kind !== 'sep' || (k > 0 && k < list.length - 1 && list[k + 1].kind !== 'sep'));
  }

  // the Start button's logo on Windows 11 (main says, state.win11): its four squares (GitHub #33); Windows 10
  // keeps its slanted panes (Font Awesome's)
  const WIN11 = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">'
    + '<rect x="0" y="0" width="9.3" height="9.3"/><rect x="10.7" y="0" width="9.3" height="9.3"/>'
    + '<rect x="0" y="10.7" width="9.3" height="9.3"/><rect x="10.7" y="10.7" width="9.3" height="9.3"/></svg>';

  // Windows' Task View icon: a window in front of another
  const TASKVIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="3" y="8.5" width="12.5" height="12.5" rx="2.6" fill="currentColor" fill-opacity="0.22"/>'
    + '<path d="M8.5 8.5V5.5A2.5 2.5 0 0 1 11 3h7.5A2.5 2.5 0 0 1 21 5.5V13a2.5 2.5 0 0 1-2.5 2.5h-3"/></svg>';

  // the Search button's magnifying glass, drawn like Task View's
  const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true">'
    + '<circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" fill-opacity="0.22"/><path d="M15.4 15.4L20.5 20.5"/></svg>';

  // the icon (asked from main per source), or a tile with a glyph or letter; one that didn't come is asked
  // for again a couple of times
  const iconTries = new Map();
  function iconHtml(it) {
    if (it.kind === 'start') return `<div class="ic tile start">${state.win11 ? WIN11 : fa('windows', 'brands')}</div>`;
    if (it.kind === 'taskview') return `<div class="ic tile taskview">${TASKVIEW}<b class="badge" hidden></b></div>`;
    if (it.kind === 'search') return `<div class="ic tile search">${SEARCH}</div>`;
    if (calendarOf(it)) return calendarHtml();
    const src = it.icon || '';
    if (src && !icons.has(src)) {
      icons.set(src, undefined);
      const got = (u) => {
        icons.set(src, u || null);
        if (!u) {
          const n = (iconTries.get(src) || 0) + 1;
          iconTries.set(src, n);
          if (n < 3) setTimeout(() => { if (icons.get(src) === null) { icons.delete(src); render(); } }, 3000 * n);
        }
        render();
      };
      api.svc('dock', 'icon', src).then(got).catch(() => got(null));
    }
    const u = src ? icons.get(src) : null;
    if (u) {
      const sh = uniform() ? shapeOf(u) : null;
      // tinted (the squared picture, once that's worked out): a faint square until its one-colour picture is
      // made, rather than its colours for a moment
      const pic = !tinted() ? (sh ? sh.url : u) : sh === undefined ? null : tintOf(sh ? sh.url : u);
      if (!pic) return '<div class="ic loading"></div>';
      if (sh) return `<div class="ic uni${sh.full ? '' : ' plate'}"><img src="${pic}" alt=""></div>`;
      return `<div class="ic"><img src="${pic}" alt=""></div>`;
    }
    if (u === undefined) return '<div class="ic loading"></div>';
    const glyph = /^(https?|ms-settings):/i.test(it.path || '') ? fa('globe') : esc((it.name || '?').trim().charAt(0).toUpperCase());
    return `<div class="ic tile">${glyph}</div>`;
  }

  // Show today's date on calendar icons (Settings → Dock, on by default): an app whose name, app id or path says it's
  // a calendar (Windows' Calendar, Outlook's calendar, a Google Calendar shortcut, web link or web app, "Kalender"…)
  // is drawn as a page with the short month on a red band and the day under it, in Sympony's language (dock.css .cal);
  // its own icon isn't asked for. Not a folder or a document with such a name, nor an app whose icon was changed by
  // hand (Change icon). Drawn again at midnight (calendarTimer); main sends the date with the state too, so after
  // the PC wakes or the clock is changed it turns over at once.
  const CALENDAR = /calendar|kalender|calendrier|kalendarz|calendario|calendário|takvim|календар|カレンダー|日历|日曆/i;
  function calendarOf(it) {
    if (S.dockCalendarDate === false || it.custom || (it.kind !== 'pinned' && it.kind !== 'open')) return false;
    const p = it.path || '';
    const app = /^(shell:|aumid:|https?:|outlookcal:|webcal:)/i.test(p) || /\.(exe|lnk|url|appref-ms)$/i.test(p) || (it.kind === 'open' && !p);
    return app && CALENDAR.test(`${it.name || ''}\n${it.key || ''}\n${p}`);
  }
  function calendarHtml() {
    const now = new Date();
    // the month as Sympony's language shortens it, in capitals without a full stop ("Nov", "nov." → "NOV")
    const loc = _tLocale();
    const month = now.toLocaleDateString(loc, { month: 'short' }).replace(/\.$/, '').toLocaleUpperCase(loc);
    return `<div class="ic cal${uniform() ? ' uni' : ''}"><b class="cm">${esc(month)}</b><b class="cd">${now.getDate()}</b></div>`;
  }
  // one timer, to just after the next midnight, while the Dock has a calendar (none otherwise)
  let calendarT = 0;
  function calendarTimer() {
    clearTimeout(calendarT);
    if (!list.some(calendarOf)) return;
    const now = new Date();
    calendarT = setTimeout(render, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now + 1000);
  }

  // Same shape for every icon (Settings → Dock): each becomes the same rounded square. A picture that already
  // fills a square is cropped to its solid part and clipped to it; any other shape (a circle, a folder, a page)
  // sits smaller on a plate that follows the Style (dock.css --plate). Worked out once per picture, on a canvas;
  // until then the icon shows as it is.
  const shapes = new Map(); // icon data URL → { url, full } (undefined: being worked out; null: couldn't)
  function uniform() { return S.dockUniformIcons !== false; }
  function shapeOf(u) {
    if (shapes.has(u)) return shapes.get(u);
    shapes.set(u, undefined);
    const img = new Image();
    img.onload = () => {
      try { shapes.set(u, squared(img)); } catch (e) { shapes.set(u, null); }
      render();
    };
    img.onerror = () => { shapes.set(u, null); render(); };
    img.src = u;
    return undefined;
  }
  function squared(img) {
    const N = 128;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const px = g.getImageData(0, 0, N, N).data;
    const alpha = (x, y) => px[(Math.round(y) * N + Math.round(x)) * 4 + 3];
    // what's drawn (with any soft shadow or glow around it), and its solid part
    const box = (min) => {
      let x0 = N, y0 = N, x1 = -1, y1 = -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (alpha(x, y) > min) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const drawn = box(24);
    if (!drawn) return null;
    // a square picture: its solid part about as wide as tall, and solid near its four corners (a circle isn't)
    // and at the middle of its four sides (a page or a cone isn't)
    const solid = box(180) || drawn;
    const at = (fx, fy) => alpha(solid.x0 + fx * (solid.w - 1), solid.y0 + fy * (solid.h - 1)) > 180;
    const full = solid.w >= drawn.w * 0.7 && Math.abs(solid.w - solid.h) <= Math.max(solid.w, solid.h) * 0.08
      && [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86], [0.5, 0.05], [0.5, 0.95], [0.05, 0.5], [0.95, 0.5]].every(([fx, fy]) => at(fx, fy));
    const out = document.createElement('canvas'); out.width = out.height = N;
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    const k = img.naturalWidth / N; const kh = img.naturalHeight / N;
    if (full) {
      // cropped to the solid part (a faint margin around it would show in the corners of the clip)
      const { x0, y0, w, h } = solid;
      o.drawImage(img, x0 * k, y0 * kh, w * k, h * kh, 0, 0, N, N);
      // an icon with rounder corners of its own than the Dock's clip (dock.css: 23 %) keeps them: what's left
      // of a margin outside them goes, so no light or dark corners show between its corner and the clip
      const own = ownRadius(alpha, solid);
      if (own > 0.22) {
        o.globalCompositeOperation = 'destination-in';
        o.beginPath(); o.roundRect(0, 0, N, N, Math.min(0.5, own + 0.02) * N); o.fill();
      }
    } else {
      const { x0, y0, w, h } = drawn;
      const s = (N * 0.7) / Math.max(w, h);
      o.drawImage(img, x0 * k, y0 * kh, w * k, h * kh, (N - w * s) / 2, (N - h * s) / 2, w * s, h * s);
    }
    return { url: out.toDataURL('image/png'), full };
  }
  // How round a square icon's own corners are (their radius as a share of its width): from each corner of its
  // solid part, along the diagonal to where it's solid (on a rounded corner that's radius × (1 − 1/√2) in).
  function ownRadius(alpha, { x0, y0, w, h }) {
    let most = 0;
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x0 + w - 1, y0, -1, 1], [x0, y0 + h - 1, 1, -1], [x0 + w - 1, y0 + h - 1, -1, -1]]) {
      let t = 0;
      while (t < w / 2 && alpha(cx + dx * t, cy + dy * t) <= 180) t++;
      most = Math.max(most, t / (1 - Math.SQRT1_2) / w);
    }
    return most;
  }

  // Tint icons (Settings → Dock): every app's icon in one colour that follows the Style (dock.css --tint-lo and
  // --tint-hi). Pixel by pixel, its lightness on a ramp from the first colour to the second; the icon's own range
  // of lightness is stretched part of the way to the whole ramp, so a dim or a pale icon keeps its details, and one
  // in a single colour keeps how light it is. Its alpha stays, so its shape does. With Same shape for every icon,
  // the squared picture is the one tinted. Made on a canvas once per picture and Style; each picture is kept once
  // loaded, so another Style is made right away.
  const tints = new Map(); // the Style's colours + picture → its tinted data URL (null: couldn't)
  const pics = new Map(); // picture → its loaded Image (null: couldn't load; undefined: loading)
  let ramp = { look: '', key: '', lo: [76, 76, 85], hi: [242, 242, 246] };
  function tinted() { return !!S.dockIconTint; }
  // the Style's two colours (read again when the look changes, after data-style is set; Wallpaper color's when its
  // text turns dark or light)
  function readRamp() {
    const lk = look() + (document.documentElement.dataset.ink || '');
    if (ramp.look === lk) return;
    const cs = getComputedStyle(document.documentElement);
    const lo = cs.getPropertyValue('--tint-lo').trim(); const hi = cs.getPropertyValue('--tint-hi').trim();
    const rgb = (s, def) => { const m = /^#([0-9a-f]{6})$/i.exec(s); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : def; };
    ramp = { look: lk, key: `${lo}/${hi}`, lo: rgb(lo, [76, 76, 85]), hi: rgb(hi, [242, 242, 246]) };
  }
  // the tinted picture (as it is if that can't be made; null while the picture loads, render() follows)
  function tintOf(u) {
    const key = `${ramp.key}|${u}`;
    if (tints.has(key)) return tints.get(key) || u;
    const img = pics.get(u);
    if (img) {
      let out = null;
      try { out = tintPic(img, ramp); } catch (e) { out = null; }
      tints.set(key, out);
      return out || u;
    }
    if (img === null) return u;
    if (!pics.has(u)) {
      pics.set(u, undefined);
      const im = new Image();
      im.onload = () => { pics.set(u, im); render(); };
      im.onerror = () => { pics.set(u, null); render(); };
      im.src = u;
    }
    return null;
  }
  // where an icon's tint is (for render's signature): its squared picture still being worked out, its picture
  // loading, or ready to be made (made at once when drawn)
  function tintState(src) {
    const u = tinted() ? icons.get(src || '') : null;
    if (!u) return '';
    const sh = uniform() ? shapes.get(u) : null;
    if (sh === undefined) return ':s';
    const base = sh ? sh.url : u;
    return tints.has(`${ramp.key}|${base}`) || pics.get(base) !== undefined ? ':t' : ':w';
  }
  const LIN = Float32Array.from({ length: 256 }, (_, v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  function tintPic(img, { lo, hi }) {
    // (at most 256 px a side: Explorer's icons and the squared ones are 128, a picture of your own may be bigger)
    const nw = img.naturalWidth || 128; const nh = img.naturalHeight || 128;
    const k = Math.min(1, 256 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k)); const h = Math.max(1, Math.round(nh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h); const px = data.data;
    // each pixel's lightness (CIE L*, 0 to 1), and how much of the icon has each (its solid part, by alpha)
    const L = new Float32Array(w * h); const hist = new Float32Array(101); let all = 0;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const Y = 0.2126 * LIN[px[i]] + 0.7152 * LIN[px[i + 1]] + 0.0722 * LIN[px[i + 2]];
      const l = Y > 0.008856 ? 1.16 * Math.cbrt(Y) - 0.16 : Y * 9.033;
      L[p] = l;
      const a = px[i + 3] / 255;
      if (a > 0.4) { hist[Math.round(clamp(l, 0, 1) * 100)] += a; all += a; }
    }
    // its range without its darkest and lightest 3 %, its ends taken 60 % of the way to the ramp's
    const share = (q) => { let s = 0; for (let b = 0; b <= 100; b++) { s += hist[b]; if (s >= q * all) return b / 100; } return 1; };
    const a0 = all ? share(0.03) : 0; const b0 = all ? share(0.97) : 1;
    const span = b0 - a0; const t0 = a0 * 0.4; const t1 = b0 + (1 - b0) * 0.6;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      if (!px[i + 3]) continue;
      const t = span < 0.02 ? clamp(L[p], 0, 1) : clamp(t0 + ((L[p] - a0) / span) * (t1 - t0), 0, 1);
      px[i] = lo[0] + (hi[0] - lo[0]) * t;
      px[i + 1] = lo[1] + (hi[1] - lo[1]) * t;
      px[i + 2] = lo[2] + (hi[2] - lo[2]) * t;
    }
    g.putImageData(data, 0, 0);
    return c.toDataURL('image/png');
  }

  // Rebuilt only when the items themselves change; an app opening, closing or coming to the front just
  // flips its dots (so the icons don't flicker every time you switch windows).
  let structure = '';
  function render() {
    if (st.drag || st.menu) { st.pending = true; return; }
    st.pending = false;
    document.documentElement.style.setProperty('--size', size() + 'px');
    document.documentElement.style.setProperty('--gap', gap() + 'px');
    // small icons: the clock on one line
    dock.classList.toggle('small', size() < 36);
    // tiny ones (under 24 px): less room around them in the bar (a quarter of their size, whole px), smaller
    // markers and status area (dock.css)
    dock.classList.toggle('tiny', size() < 24);
    document.documentElement.style.setProperty('--pad', Math.round(clamp(size() / 4, 4, 6)) + 'px');
    document.documentElement.style.setProperty('--lift', lift() + 'px');
    document.documentElement.dataset.style = look();
    paintWall();
    dock.dataset.mark = runMark();
    dock.classList.toggle('tinted', tinted());
    if (tinted()) readRamp();
    deskEl.hidden = !(S.dockHideTaskbar && S.dockShowDesktop !== false);
    build();
    const iconState = (src) => {
      const u = icons.get(src || '');
      // (switched on with its shape not worked out yet: a state of its own, so the icon is drawn again and asks)
      if (u && uniform()) return shapes.get(u) ? 3 : shapes.has(u) ? 1 : 4;
      return u ? 1 : u === null ? 2 : 0;
    };
    // (a calendar's tile by the day, so it's drawn again when that turns over)
    const day = `${new Date().toDateString()}:${uniform()}`;
    const sig = (state.win11 ? '11;' : '') + (tinted() ? `tint ${ramp.key};` : '')
      + list.map((it) => (it.kind === 'sep' ? '|' : calendarOf(it) ? `${it.kind}:${it.key}:cal ${day}`
        : `${it.kind}:${it.key}:${it.icon}:${iconState(it.icon)}${tintState(it.icon)}`)).join(',');
    if (sig !== structure) {
      structure = sig;
      itemsEl.innerHTML = list.map((it, n) => (it.kind === 'sep' ? '<div class="sep"></div>' : `<div class="item" data-n="${n}"><div class="mag">${iconHtml(it)}</div></div>`)).join('');
      st.hoverEl = null;
      st.scales = [];
      st.target = st.hover && st.mouseX != null ? targets(st.mouseX) : [];
      // a window list stays with its app's new icon
      if (st.wins) {
        const n = list.findIndex((it) => it.kind === st.wins.it.kind && it.key === st.wins.it.key);
        if (n < 0) hideWins(); else { st.wins.el = itemsEl.querySelector(`.item[data-n="${n}"]`); st.wins.it = list[n]; }
      }
    }
    [...itemsEl.children].forEach((el, n) => {
      const it = list[n];
      if (!it || it.kind === 'sep') return;
      el.classList.toggle('running', !!it.open);
      // a dot for each window, up to three (a longer line for the line marker)
      const w = it.open && it.open.windows > 1 ? String(Math.min(3, it.open.windows)) : '';
      if ((el.dataset.w || '') !== w) { if (w) el.dataset.w = w; else delete el.dataset.w; }
      // the corner marker's number of windows
      const mag = el.firstElementChild; const wn = it.open ? it.open.windows : 0;
      const c = wn > 9 ? '9+' : wn > 1 ? String(wn) : '';
      if ((mag.dataset.c || '') !== c) { if (c) mag.dataset.c = c; else delete mag.dataset.c; }
      el.classList.toggle('active', !!(it.open && it.open.active));
      el.classList.toggle('bounce', st.bouncing.has(it.key));
      // Task View: the number of the desktop in front, when there's more than one
      if (it.kind === 'taskview') {
        const b = el.querySelector('.badge'); const d = state.desks;
        const txt = d && d.n > 1 ? String(d.cur + 1) : '';
        if (b && b.textContent !== txt) { b.textContent = txt; b.hidden = !txt; }
      }
      // an icon with a badge of its own: the corner marker takes the other corner
      el.classList.toggle('badged', !!el.querySelector('.badge:not([hidden])'));
    });
    renderStatus();
    renderPrayer();
    calendarTimer();
    if (paint() && !st.raf) st.raf = requestAnimationFrame(tick);
    shape();
  }

  // ------------------------------------------------------------------ other apps' tray icons
  // The arrow at the start of the status area opens a grid of the icons in Windows' notification area (main finds
  // them: tray_icons.rs). Clicking one there clicks it in the taskbar itself: left for what the app does on a
  // click, right for its own menu (which may open at the bottom of the screen). Below them, Windows' own box of
  // hidden icons. The grid takes the Style's colours (on the glass styles it's glass like the bar, frosted by main
  // too on Frosted Glass: reportGlass), its icons the size picked in Settings → Dock.
  const trayEl = document.createElement('div');
  trayEl.id = 'tray'; trayEl.hidden = true;
  document.body.appendChild(trayEl);
  const tray = { open: false, items: [], note: '', seq: 0, clicks: 0, menu: 0 };
  async function toggleTray() {
    if (tray.open) { hideTray(); return; }
    tray.open = true;
    magnify(null);
    label.hidden = true;
    drawTray(true);
    const n = ++tray.seq;
    const items = await api.svc('trayIcons', 'list').catch(() => []);
    if (n !== tray.seq || !tray.open) return;
    tray.items = Array.isArray(items) ? items : [];
    await Promise.all(tray.items.map((t) => toneOf(t.icon)));
    if (n !== tray.seq || !tray.open) return;
    drawTray(false);
  }
  // Windows draws tray icons for its taskbar (light ones in dark mode, dark ones in light mode), so one may be
  // hard to see on the Style's grid: it gets a small plate of the other kind (light on the dark grids, dark on
  // White's). Judged once per picture by how much of it stands out from a dark and from a light grid; only plain
  // (grey) pictures are Windows' kind, a colourful one is made to show on either taskbar and gets none.
  const tones = new Map(); // icon data URL → { onDark, onLight }: the share of its pixels that read on each (null: none needed)
  function toneOf(u) {
    if (!u || tones.has(u)) return Promise.resolve();
    return new Promise((done) => {
      const img = new Image();
      img.onload = () => {
        try {
          const N = 32; const c = document.createElement('canvas'); c.width = c.height = N;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, N, N);
          const px = g.getImageData(0, 0, N, N).data;
          const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          let all = 0; let onDark = 0; let onLight = 0; let colour = 0;
          for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3] / 255;
            if (a < 0.3) continue;
            const L = 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
            all += a;
            // a contrast of 3:1 or more with a grid of about #24242a, or of about #f4f4f6
            if (L >= 0.16) onDark += a;
            if (L <= 0.27) onLight += a;
            if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 60) colour += a;
          }
          tones.set(u, all && colour / all < 0.3 ? { onDark: onDark / all, onLight: onLight / all } : null);
        } catch { tones.set(u, null); }
        done();
      };
      img.onerror = () => { tones.set(u, null); done(); };
      img.src = u;
    });
  }
  const needsPlate = (u) => { const t = tones.get(u); return !!t && (look() === 'white' ? t.onLight : t.onDark) < 0.3; };
  function drawTray(loading) {
    const coming = trayEl.hidden; // (Settings → Animations: out of its button, genie)
    const cells = tray.items.map((t, k) => `<button class="ti${t.icon && needsPlate(t.icon) ? ' plate' : ''}" data-k="${k}" title="${esc(t.name)}">${t.icon ? `<img src="${esc(t.icon)}" alt="">` : `<span>${esc((t.name || '?').trim().charAt(0).toUpperCase())}</span>`}</button>`).join('');
    const body = cells || `<div class="empty">${loading ? '…' : _t('No tray icons')}</div>`;
    trayEl.innerHTML = `<div class="grid" style="--cols:${clamp(tray.items.length, 1, 5)}">${body}</div>`
      + (tray.note ? `<div class="note">${esc(tray.note)}</div>` : '')
      + `<button class="more" data-more="1">${fa('ellipsis')}<span>${_t('Windows’ hidden icons')}</span></button>`;
    // Settings → Dock → Tray icon size
    trayEl.dataset.size = ['small', 'large'].includes(S.dockTraySize) ? S.dockTraySize : 'medium';
    if (coming) genieHold(trayEl);
    trayEl.hidden = false;
    renderStatus();
    placeTray();
    if (coming) genieOpen(trayEl, 'tray', elSrc(() => statusEl.querySelector('[data-tray]')));
    // again once the icons have shrunk back and the bar (with the arrow) has settled
    setTimeout(placeTray, 350);
  }
  // above the arrow, its right edge in line with the bar's right end (GitHub #18: centred on the arrow, it stuck
  // out past the end of the Dock)
  function placeTray() {
    if (!tray.open) return;
    const bar = dock.getBoundingClientRect();
    const w = trayEl.offsetWidth; const h = trayEl.offsetHeight;
    trayEl.style.left = clamp(bar.right - w, 8, innerWidth - w - 8) + 'px';
    trayEl.style.top = Math.max(4, bar.top - h - 10) + 'px';
    genieRefresh(trayEl);
    shape();
  }
  function hideTray() {
    if (!tray.open) return;
    // a tray icon's menu still up goes with it, as a click elsewhere closes it
    if (tray.menu) { tray.menu = 0; api.svc('trayIcons', 'dismiss').catch(() => {}); }
    tray.open = false; tray.note = ''; tray.seq++;
    genieClose(trayEl);
    trayEl.hidden = true;
    renderStatus();
    shape();
  }
  async function trayClick(t, right) {
    // a left click brings up the app's window: the grid goes. A right click's menu opens over the grid (Windows'
    // box with the hidden icons opens unseen, see tray_icons.rs), which stays open until that menu has gone.
    if (!right) hideTray();
    const seq = tray.seq; const click = ++tray.clicks;
    const r = await api.svc('trayIcons', 'click', t.id, right).catch(() => null);
    if (r && r.ok) {
      if (!right) return;
      tray.menu = click;
      const w = await api.svc('trayIcons', 'menuWait').catch(() => null);
      if (tray.menu === click) tray.menu = 0;
      if (w && w.gone && tray.open && tray.seq === seq && tray.clicks === click) hideTray();
      return;
    }
    tray.open = true; tray.note = _t('Couldn’t reach {name}. Try Windows’ hidden icons.', { name: t.name });
    drawTray(false);
  }
  trayEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.more) { hideTray(); api.svc('trayIcons', 'hidden'); return; }
    const t = tray.items[+b.dataset.k];
    if (t) trayClick(t, false);
  });
  trayEl.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.ti');
    const t = b && tray.items[+b.dataset.k];
    if (t) trayClick(t, true);
  });
  // a click anywhere else in the Dock closes it
  document.addEventListener('pointerdown', (e) => {
    if (tray.open && !trayEl.contains(e.target) && !e.target.closest('[data-tray]')) hideTray();
  });

  // ------------------------------------------------------------------ status area
  // While the Dock stands in for the taskbar: the arrow for other apps' tray icons (see above), the input
  // language, the connection, volume and battery, and the time and date. They open Windows' own panels. With
  // only the arrow on (`full` false), just that.
  function renderStatus() {
    const s = state.status;
    if (!s) { if (!statusEl.hidden) { statusEl.hidden = true; statusEl.innerHTML = ''; } hideTray(); return; }
    const arrow = s.tray ? `<button data-tray="1" class="tray${tray.open ? ' on' : ''}" title="${_t('Other apps’ tray icons')}"><i class="fa-solid fa-chevron-up"></i></button>` : '';
    if (!s.tray) hideTray();
    if (!s.full) {
      if (statusEl.innerHTML !== arrow) statusEl.innerHTML = arrow;
      statusEl.hidden = !arrow;
      return;
    }
    // airplane mode takes the connection's place while nothing's connected, like on the taskbar
    const net = s.airplane && !s.wifi && !s.wired ? `<i class="fa-solid fa-plane" title="${_t('Airplane mode on')}"></i>`
      : s.wifi ? `<i class="fa-solid fa-wifi" title="Wi-Fi ${esc(s.wifi.ssid || '')} · ${s.wifi.quality}%"></i>`
      : s.wired ? '<i class="fa-solid fa-ethernet" title="Ethernet"></i>' : `<i class="fa-solid fa-globe dim" title="${_t('Not connected')}"></i>`;
    const v = s.volume;
    const vol = !v ? '' : `<i class="fa-solid fa-${v.muted || v.level === 0 ? 'volume-xmark' : v.level < 34 ? 'volume-low' : 'volume-high'}" title="${v.muted ? _t('Volume muted') : _t('Volume {level}%', { level: v.level })}"></i>`;
    const b = s.battery;
    const bat = !b ? '' : `<i class="fa-solid fa-${b.charging ? 'battery-full' : ['battery-empty', 'battery-quarter', 'battery-half', 'battery-three-quarters', 'battery-full'][Math.min(4, Math.round(b.level / 25))]}" title="${b.charging ? _t('Battery {level}%, charging', { level: b.level }) : _t('Battery {level}%', { level: b.level })}"></i>${b.charging ? '<i class="fa-solid fa-bolt" style="font-size:10px;margin-left:-5px"></i>' : ''}`;
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: S.clock24h === false });
    // the date as the taskbar writes it, in Windows' regional format (main sends it, a new one after midnight);
    // WebView2's own is in its language's order, M/D/YYYY for most
    const date = s.date || now.toLocaleDateString();
    const html = arrow + `${s.lang ? `<button data-st="space" class="lang" title="${_t('Input language (Windows + Space)')}">${esc(s.lang)}</button>` : ''}`
      + `<button data-st="a" title="${_t('Quick Settings (Windows + A)')}">${net}${vol}${bat}</button>`
      + `<button data-st="n" class="clock" title="${_t('Notifications and calendar (Windows + N)')}"><span>${esc(time)}</span><small>${esc(date)}</small></button>`;
    if (statusEl.innerHTML !== html) statusEl.innerHTML = html;
    statusEl.hidden = false;
  }
  statusEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tray) { toggleTray(); return; }
    if (b.dataset.st === 'space') { if (st.menu && st.menu.lang) hideMenu(); else langMenu(b); return; }
    api.svc('dock', 'start', b.dataset.st);
  });
  // the clock
  setInterval(() => { if (state.status) { renderStatus(); shape(); } }, 10000);

  // ------------------------------------------------------------------ Show desktop
  // While the taskbar is hidden: a small desktop button at the very end of the Dock, after a line, where the
  // taskbar has its far corner (Settings → Dock → Show desktop button). A click shows the desktop, the next brings
  // the windows back.
  const deskEl = document.createElement('button');
  deskEl.id = 'desk'; deskEl.title = _t('Show desktop'); deskEl.hidden = true;
  deskEl.innerHTML = fa('desktop');
  dock.appendChild(deskEl);
  deskEl.addEventListener('click', () => api.svc('dock', 'showDesktop').catch(() => {}));

  // ------------------------------------------------------------------ next prayer
  // While Prayer Times is on (Settings → Dock → Next prayer on the Dock): the next prayer and its time near the
  // right end, before the status area, named and written as in the closed notch. In the minutes before it that
  // the notch counts down (Settings → Prayer Times) the time left instead, and lit up for a minute when it's time
  // (the adhan, if there is one, plays in the notch as always). Main sends today's and tomorrow's times
  // (state.prayer); the page keeps the clock: every second while counting down, else at least each minute.
  // A click opens Sympony on Prayer Times.
  const prayerEl = document.createElement('div');
  prayerEl.id = 'prayer'; prayerEl.hidden = true;
  dock.insertBefore(prayerEl, statusEl);
  const PRAYER_LIT = 60000;
  let prayerT = 0; let prayerHtml = '';
  // a time as the notch writes it (notch.js hm), and the time left as it counts down (fmt)
  const hm = (t) => {
    const h24 = S.clock24h !== false;
    return new Date(t).toLocaleTimeString([], { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12' });
  };
  const countdown = (ms) => {
    const sec = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };
  function renderPrayer() {
    clearTimeout(prayerT);
    const p = S.dockPrayer !== false && S.prayerEnabled ? state.prayer : null;
    const now = Date.now();
    const times = (p && p.times) || [];
    const lit = times.find((t) => t.at <= now && now - t.at < PRAYER_LIT);
    const t = lit || times.find((x) => x.at > now);
    const wasW = prayerEl.hidden ? 0 : prayerEl.offsetWidth;
    if (!t) {
      if (!prayerEl.hidden) { prayerEl.hidden = true; prayerEl.innerHTML = ''; prayerHtml = ''; shape(); }
      return;
    }
    const before = Math.max(0, Number(p.before) || 0) * 60000;
    // the name in Sympony's language: the English names are texts of modules/prayer.js (the regional ones stay)
    const name = _t(t.name);
    const mode = lit ? 'now' : before > 0 && t.at - now <= before ? 'soon' : '';
    const title = mode === 'now' ? _t('{name} · {time}. Click for Prayer Times', { name, time: hm(t.at) })
      : _t('Next prayer: {name} at {time}. Click for Prayer Times', { name, time: hm(t.at) });
    const html = `<button class="${mode}" title="${esc(title)}">${fa('mosque')}<span class="pt"><b>${esc(name)}</b><small>${esc(mode === 'soon' ? countdown(t.at - now) : hm(t.at))}</small></span></button>`;
    if (html !== prayerHtml) { prayerHtml = html; prayerEl.innerHTML = html; }
    prayerEl.hidden = false;
    if (prayerEl.offsetWidth !== wasW) shape();
    // again when the time left drops a second while counting down (so it's lit right on time), when the light
    // goes out, else on the next minute or when the countdown starts
    const wait = mode === 'soon' ? (t.at - now) % 1000 || 1000 : mode === 'now' ? t.at + PRAYER_LIT - now
      : Math.min(60000 - (now % 60000), t.at - before - now);
    prayerT = setTimeout(renderPrayer, Math.max(20, wait + 20));
  }
  prayerEl.addEventListener('click', (e) => { if (e.target.closest('button')) api.svc('dock', 'prayer', me).catch(() => {}); });
  // timers wait while the window is hidden: right on time again when it shows
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderPrayer(); });

  // ------------------------------------------------------------------ magnification
  // Icons near the mouse grow (a cosine falloff over ~2.4 icons), measured on the resting layout so the
  // growing icons don't push the effect around.
  // What's after the icons in the bar (the next prayer, the status area, Show desktop), with the space before
  // each: from the end of the icons to the end of the last one.
  function tail() {
    const end = [deskEl, statusEl, prayerEl].find((el) => !el.hidden);
    return end ? end.offsetLeft + end.offsetWidth - (itemsEl.offsetLeft + itemsEl.offsetWidth) : 0;
  }
  const hasTail = () => !statusEl.hidden || !deskEl.hidden || !prayerEl.hidden;
  // Where the items and dividers rest (left edge and width each, from the bar's first one): the bar is centred
  // with the status area in it, so the icons start left of centre.
  function layout() {
    const els = [...itemsEl.children];
    const sz = size();
    let pos = 0; const spans = [];
    els.forEach((el, k) => {
      const w = el.classList.contains('sep') ? 7 : sz;
      spans.push([pos, w]);
      pos += w + (k < els.length - 1 ? gap() : 0);
    });
    return { els, spans, left: innerWidth / 2 - (pos + tail()) / 2 };
  }
  function targets(x) {
    const { els, spans, left } = layout();
    const sz = size(); const M = maxScale(); const R = sz * 2.4 + gap() * 2;
    return els.map((el, k) => {
      if (x == null || el.classList.contains('sep')) return 1;
      const d = Math.abs(x - (left + spans[k][0] + spans[k][1] / 2));
      return d >= R ? 1 : 1 + (M - 1) * Math.cos((d / R) * Math.PI / 2);
    });
  }

  // The icons grow out of the top of the bar (scaled from their foot) and move aside for each other, each by what
  // the icons between it and the mouse grew, so the one under the mouse stays under it; the bar grows wider with
  // them, its ends going out with the icons at the ends, so none sticks out past them. The status area (and Show
  // desktop) stay where they are: with them there, the icons make room to the left only (the one under the mouse
  // then moves a little left of it). The bar's height doesn't change.
  function paint() {
    const { els, spans, left } = layout();
    const sz = size();
    let moving = false;
    const grow = els.map((el, k) => {
      if (el.classList.contains('sep')) return 0;
      const cur = st.scales[k] ?? 1; const t = st.target[k] ?? 1;
      let v = cur + (t - cur) * 0.32;
      if (Math.abs(t - v) < 0.003) v = t; else moving = true;
      st.scales[k] = v;
      return sz * (v - 1);
    });
    let leftOf = 0; let all = 0;
    els.forEach((el, k) => {
      all += grow[k];
      if (st.anchorX != null) leftOf += grow[k] * clamp((st.anchorX - left - spans[k][0]) / spans[k][1], 0, 1);
    });
    // the last icon goes at most 8 px past its place (into the gap before the status area's line)
    const fixedEnd = hasTail();
    if (fixedEnd) leftOf = Math.max(leftOf, all - 8);
    growBar(leftOf, fixedEnd ? 0 : all - leftOf);
    let before = -leftOf;
    els.forEach((el, k) => {
      const x = (before + grow[k] / 2).toFixed(2);
      before += grow[k];
      if (el.classList.contains('sep')) { el.style.transform = x === '0.00' || x === '-0.00' ? '' : `translateX(${x}px)`; return; }
      el.style.setProperty('--x', x + 'px');
      el.style.setProperty('--s', (st.scales[k] ?? 1).toFixed(4));
    });
    // the icons move under a mouse that holds still: the one under it now is the one hovered
    if (st.hover && !st.drag && !st.menu && !st.wins && !tray.open && st.mouseY != null) {
      const t = document.elementFromPoint(st.mouseX, st.mouseY);
      const el = t && t.closest ? t.closest('.item') : null;
      if (el !== st.hoverEl) { st.hoverEl = el; hoverWins(el); }
    }
    placeLabel();
    reportGlass();
    return moving;
  }
  // the bar's ends out by what the icons grew on each side of where they rest (dock.css: --grow-l, --grow-r);
  // what's between them stays in its place
  function growBar(l, r) {
    const key = `${l.toFixed(2)},${r.toFixed(2)}`;
    if (key === st.growKey) return;
    st.growKey = key; st.grow = [l, r];
    dock.style.setProperty('--grow-l', l.toFixed(2) + 'px');
    dock.style.setProperty('--grow-r', r.toFixed(2) + 'px');
  }
  function tick() {
    st.raf = 0;
    if (paint()) st.raf = requestAnimationFrame(tick);
    else if (!st.hover) shape(); // back at rest: the clickable area shrinks to the bar again
  }
  function magnify(x) {
    if (x != null) st.anchorX = x;
    st.target = targets(x);
    if (!st.raf) st.raf = requestAnimationFrame(tick);
  }

  // the name above the icon under the mouse (with how many windows it has, or the desktop in front)
  function labelText(it) {
    const n = it.open ? it.open.windows : 0;
    if (n > 1) return `${it.name} · ${_t('{n} windows', { n })}`;
    const d = state.desks;
    if (it.kind === 'taskview' && d && d.n > 1) return `${it.name} · ${d.name || _t('Desktop {n}', { n: d.cur + 1 })}`;
    return it.name;
  }
  function placeLabel() {
    if (st.dropping) { placeDrop(); return; } // (files dragged over it: what dropping them does)
    const el = st.hoverEl;
    if (!el || !el.isConnected || st.menu || st.drag || st.wins) { label.hidden = true; return; }
    const it = list[+el.dataset.n];
    if (!it) { label.hidden = true; return; }
    const text = labelText(it);
    if (label.textContent !== text) label.textContent = text;
    const r = (el.querySelector('.mag') || el).getBoundingClientRect();
    label.hidden = false;
    label.style.left = (r.left + r.width / 2) + 'px';
    label.style.top = (r.top - 34) + 'px';
  }

  // ------------------------------------------------------------------ the window's clickable shape
  // the window's size in CSS px to the fraction (innerWidth is whole px; at 125 % or 175 % the window isn't)
  const vv = () => (window.visualViewport && visualViewport.scale === 1 ? visualViewport : null);
  const viewW = () => (vv() && vv().width) || innerWidth;
  const viewH = () => (vv() && vv().height) || innerHeight;
  // where the bar is at rest (not where it is mid-slide while it comes up or goes down, nor as wide as it grows
  // with the icons)
  function barRect() {
    const w = dock.offsetWidth - st.grow[0] - st.grow[1]; const h = dock.offsetHeight;
    const left = viewW() / 2 - w / 2; const top = viewH() - 6 - lift() - h;
    return { left, top, width: w, height: h, right: left + w, bottom: top + h };
  }
  // The icons still on their way back to their size after the mouse left (or growing, magnify's tick running): the
  // window keeps the room they take until they're at rest (tick then shapes it to the bar). Cut to the bar at once,
  // the bar's ends and the big icons showed cut square for a few frames as they shrank back (GitHub #65).
  const settling = () => !!st.raf || st.scales.some((v) => v > 1.001);
  function rects() {
    const r = barRect();
    const H = innerHeight; const sz = size(); const M = maxScale();
    const out = [];
    // Under a bar that floats higher (Gap from the bottom edge) the window takes no clicks, so what's there (the
    // status bar of a maximized app) stays in reach; only while it auto-hides, on the way up from the bottom edge,
    // until the mouse that brought it up is on the bar (st.reached)
    const low = autoHide() && !st.reached ? H : H - lift();
    if (st.hidden && !st.sliding) {
      out.push({ x: r.left, y: H - 3, w: r.width, h: 3 }); // a strip at the bottom edge brings it back
    } else if (st.hover || st.drag || st.menu || st.dropping || st.wins || settling()) {
      // room for the icons as they grow (taller, and the bar wider with them: all they grow, up to about 3 times
      // what the icon under the mouse grows, goes to the left with the status area there, else up to about
      // twice that to one side) and their name
      const extra = sz * (M - 1) * (hasTail() ? 3.1 : 2.1) + 16;
      const top = Math.max(0, r.top - sz * (M - 1) - 46);
      out.push({ x: r.left - extra, y: top, w: r.width + extra * 2, h: low - top });
    } else if (st.sliding) {
      // coming up or going down (see show): the bar down to the screen edge, with room for the few px it goes past
      // its place on the way up and for it starting a little smaller (dock.css)
      out.push({ x: r.left - 8, y: r.top - 12, w: r.width + 16, h: H - r.top + 12 });
    } else {
      // the bar (down to the screen edge when it auto-hides, so the mouse that brought it up keeps it)
      out.push({ x: r.left, y: r.top, w: r.width, h: (autoHide() ? low : r.bottom) - r.top });
    }
    for (const [on, el] of [[st.menu, menu], [st.wins, winsEl]]) {
      if (!on || el.hidden) continue;
      const m = el.getBoundingClientRect();
      out.push({ x: m.left - 4, y: m.top - 4, w: m.width + 8, h: m.height + 8 });
    }
    if (tray.open && !trayEl.hidden) {
      const m = trayEl.getBoundingClientRect();
      out.push({ x: m.left - 4, y: m.top - 4, w: m.width + 8, h: m.height + 18 });
    }
    // a popup on its way out of its icon or back into it (genie): all the way between the two
    const g = genieBox();
    if (g) out.push(g);
    // an icon bouncing (the app it opened is starting): room above it for its jumps (dock.css: up to 38 % of its
    // height), over it only; the mouse gone, the bar's rect cut its top flat at each jump
    if (!st.hidden && st.bouncing.size) {
      for (const el of itemsEl.querySelectorAll('.item.bounce')) {
        const m = (el.querySelector('.mag') || el).getBoundingClientRect();
        out.push({ x: m.left, y: m.top - m.height * 0.4, w: m.width, h: m.height * 0.4 });
      }
    }
    // outwards to whole px (left and top down, right and bottom up), so the right and bottom edges aren't cut
    return out.map((q) => { const x = Math.floor(q.x); const y = Math.floor(q.y); return { x, y, w: Math.ceil(q.x + q.w) - x, h: Math.ceil(q.y + q.h) - y }; });
  }
  // How main places this window and keeps it (dock.rs): the screen px per CSS px this page draws with (the shape
  // and the glass go by it, whatever the display's scale is said to be), and how much of the bottom of the screen
  // the bar takes with the gap under it (Settings → Dock → Keep windows above the Dock keeps that strip). The bar
  // is measured only at rest: never with icons magnified, a list, menu or the tray open over it.
  let dprSent = 0; let barSent = 0;
  function reportPlace() {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== dprSent) { dprSent = dpr; api.svc('dock', 'scale', dpr, me).catch(() => {}); }
    // (not before the first drawing, with the settings in: a wrong strip would make maximized windows jump)
    if (!structure || st.hover || st.drag || st.menu || st.dropping || st.wins || st.raf || tray.open) return;
    const h = Math.ceil(viewH() - barRect().top) + 2;
    if (h !== barSent) { barSent = h; api.svc('dock', 'bar', h, me).catch(() => {}); }
  }
  // Frosted Glass: main frosts what's behind the bar with a window of its own, so it needs to know where the bar
  // is (and its corners), or that it's hidden; the same for the tray grid while it's open (glass like the bar,
  // with a frosted window of its own). The bar grows wider with the icons: told at most every 40 ms.
  let glassSent = ''; let glassAt = 0; let glassT = 0;
  const glassOf = (el) => {
    const r = el.getBoundingClientRect();
    const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return [r.left, r.top, r.width, r.height, rad].map((n) => Math.round(n * 10) / 10);
  };
  function reportGlass() {
    // (while it slides it's followed every frame instead, followGlass)
    if (frosted() && st.sliding) { followGlass(); return; }
    let v = null;
    if (frosted() && !st.hidden) {
      v = [glassOf(dock)];
      // (the grid's once it's at rest, not while it comes out of its button: genie)
      if (tray.open && !trayEl.hidden && !trayEl.classList.contains('genie-hide')) v.push(glassOf(trayEl));
    }
    const key = JSON.stringify([v, 1]);
    if (key === glassSent) return;
    const wait = 40 - (performance.now() - glassAt);
    if (wait > 0) { clearTimeout(glassT); glassT = setTimeout(reportGlass, wait + 2); return; }
    sendGlass(v, 1, key);
  }
  // to main, with when it was made (a sliding bar's reports come every frame, and the calls may arrive out of order)
  // and how faded the bar is (its glass fades with it)
  function sendGlass(v, fade, key) {
    glassAt = performance.now(); glassSent = key;
    api.svc('dock', 'glass', v, me, { at: performance.timeOrigin + glassAt, fade }).catch(() => {});
  }
  // While it slides (comes up, goes down, leaves for a fullscreen app) the frosted window follows the bar every
  // frame, faded with it, as the notch's does (notch.js followFrost): told where the bar is drawn (moved and a little
  // smaller), but never past where it's heading over the next two frames, so placed a frame or two late it's still
  // inside the bar (one frame ahead, as the notch's, it stuck out up to 12 px above a bar speeding up on its way
  // down when placed two frames late); main cuts it at the bottom of the window as the bar goes past it. Only while
  // it slides: no frames at rest.
  const glide = { raf: 0, prev: null };
  function followGlass() {
    if (glide.raf) return;
    glide.prev = null;
    glide.raf = requestAnimationFrame(function step() {
      glide.raf = 0;
      if (!frosted() || !st.sliding) { glide.prev = null; return; }
      const { v, fade } = slidingGlass();
      const key = JSON.stringify([v, fade]);
      if (key !== glassSent) { clearTimeout(glassT); sendGlass(v, fade, key); }
      glide.raf = requestAnimationFrame(step);
    });
  }
  function slidingGlass() {
    const b = dock.getBoundingClientRect(); const cs = getComputedStyle(dock);
    const now = { l: b.left, t: b.top, r: b.right, b: b.bottom, f: Number(cs.opacity) };
    const p = glide.prev || now;
    glide.prev = now;
    const ahead = (x, was) => 3 * x - 2 * was; // (two frames on at this frame's speed)
    const l = Math.max(now.l, ahead(now.l, p.l)); const t = Math.max(now.t, ahead(now.t, p.t));
    const r = Math.min(now.r, ahead(now.r, p.r)); const btm = Math.min(now.b, ahead(now.b, p.b));
    const fade = clamp(Math.min(now.f, ahead(now.f, p.f)), 0, 1);
    // (its corners as drawn: a little smaller while it's low)
    const rad = (parseFloat(cs.borderTopLeftRadius) || 0) * (dock.offsetHeight ? b.height / dock.offsetHeight : 1);
    const v = [[l, t, Math.max(0, r - l), Math.max(0, btm - t), rad].map((n) => Math.round(n * 10) / 10)];
    return { v, fade: Math.round(fade * 100) / 100 };
  }
  dock.addEventListener('transitionend', reportGlass);
  // the window moved or changed size (taller for Gap from the bottom edge): told again even if the bar's place in it
  // is the same, so main puts the glass under it from where the window is now
  api.on('dock:moved', () => { glassSent = ''; reportGlass(); });

  // Left alone for a while, the Dock asks WebView2 to keep its memory low (it trims caches, like the closed
  // notch); in use (hovered, a menu, list, the tray or a drag) it's back to normal at once.
  let memLow = false; let memT = 0;
  function reportMemory() {
    const busy = !!(st.hover || st.drag || st.menu || st.dropping || st.wins || tray.open || st.sliding);
    clearTimeout(memT);
    if (busy) { if (memLow) { memLow = false; api.svc('dock', 'memory', false, me).catch(() => {}); } return; }
    if (!memLow) memT = setTimeout(() => { memLow = true; api.svc('dock', 'memory', true, me).catch(() => {}); }, 8000);
  }

  // (done once main has the new shape, or right away when it's the same)
  function shape() {
    reportPlace();
    reportGlass();
    reportMemory();
    const rs = rects();
    const key = JSON.stringify(rs);
    const done = key === st.shapeKey ? Promise.resolve() : api.svc('dock', 'shape', rs, me).catch(() => {});
    st.shapeKey = key;
    dropShadow(done);
    return done;
  }
  // The shadow the bar casts (dock.css #dock.flat): only while rects() makes the window bigger than the bar, from
  // once main has that shape; shaped to the bar's rect it would show cut square in the corners outside the round ones.
  const roomy = () => !(st.hidden && !st.sliding) && !!(st.hover || st.drag || st.menu || st.dropping || st.wins || settling());
  function dropShadow(shaped) {
    if (!roomy()) { dock.classList.add('flat'); return; }
    shaped.then(() => { if (roomy()) dock.classList.remove('flat'); });
  }

  // ------------------------------------------------------------------ hover, auto-hide
  // Settings → Dock → Hover delay: how long the mouse stays at the bottom edge before the hidden Dock comes up
  // (0: at once); Close delay: how long it stays after the mouse has left it (GitHub #18)
  const hoverDelay = () => clamp(Number(S.dockHoverDelay ?? 0), 0, 2000);
  const closeDelay = () => clamp(Number(S.dockCloseDelay ?? 650), 0, 5000);

  // Coming up and going down (dock.css #dock.hidden), with the window's shape following the slide (GitHub #18):
  // it takes the bar's shape first and the bar then slides up into it (a shape that came late cut off the start),
  // and keeps that shape until the bar is down (cut to the strip at once, the slide down never showed).
  function show() {
    clearTimeout(st.hideT);
    clearTimeout(st.showT); st.showT = 0;
    if (!st.hidden || st.leaving) return; // (it stays down while it leaves)
    st.hidden = false;
    const seq = ++st.slideSeq;
    slideEnds();
    // on its way down: it turns back from where it is (the window still has the bar's shape)
    if (st.sliding === 'out') { st.sliding = 'in'; dock.classList.remove('hidden'); return; }
    st.sliding = 'in';
    const go = () => { if (seq === st.slideSeq && !st.hidden) dock.classList.remove('hidden'); };
    Promise.race([shape(), new Promise((r) => setTimeout(r, 150))]).then(() => requestAnimationFrame(go));
  }
  function hide(force) {
    if (st.hidden || (!force && (st.hover || st.menu || st.drag || st.dropping || st.wins || st.standby))) return;
    st.hidden = true;
    st.reached = false;
    st.slideSeq++;
    // (still down, waiting for its shape to start coming up: nothing to slide)
    if (dock.classList.contains('hidden')) { clearTimeout(st.slideT); st.sliding = null; shape(); return; }
    st.sliding = 'out';
    slideEnds();
    dock.classList.add('hidden');
    shape();
  }
  // the slide is over: the window takes the bar's shape at rest, or the strip at the bottom edge (also if the end
  // isn't heard, e.g. the window was hidden meanwhile)
  function slideEnds() {
    clearTimeout(st.slideT);
    st.slideT = setTimeout(slideEnded, 900);
  }
  function slideEnded() {
    clearTimeout(st.slideT);
    if (!st.sliding) return;
    st.sliding = null;
    shape();
  }
  dock.addEventListener('transitionend', (e) => { if (e.target === dock && e.propertyName === 'transform') slideEnded(); });
  function scheduleHide() {
    clearTimeout(st.hideT);
    clearTimeout(st.showT); st.showT = 0;
    if (!autoHide()) return;
    st.hideT = setTimeout(hide, closeDelay());
  }
  // the mouse reached the strip at the bottom edge (or came back while the bar goes down): up after the hover delay,
  // unless it left meanwhile
  function comeUp() {
    clearTimeout(st.hideT);
    if (!st.hidden || st.showT) return;
    const wait = st.sliding === 'out' ? 0 : hoverDelay();
    if (!wait) { show(); return; }
    st.showT = setTimeout(() => { st.showT = 0; if (st.hover) show(); }, wait);
  }

  document.addEventListener('pointermove', (e) => {
    clearTimeout(st.leaveT);
    if (st.press && !st.drag && Math.hypot(e.clientX - st.press.x, e.clientY - st.press.y) > 6) startDrag();
    if (st.drag) { dragMove(e); return; }
    if (st.leaving) return; // (on its way out: the mouse waits until it's back)
    if (!st.hover) { st.hover = true; comeUp(); shape(); }
    const el = e.target.closest ? e.target.closest('.item') : null;
    st.hoverEl = el;
    st.mouseX = e.clientX; st.mouseY = e.clientY;
    // up on the bar: the gap under a lifted one stops taking the mouse (rects)
    if (!st.reached && !st.hidden && e.clientY <= barRect().bottom) { st.reached = true; if (lift() && autoHide()) shape(); }
    // on an app's window list (or on the way up to it): the icons hold still
    const onWins = !!st.wins && (!!e.target.closest('#wins') || towardWins(e));
    if (!st.menu && !tray.open && !onWins) magnify(e.clientX);
    // off it: gone at once on another icon (its name shows), after a moment elsewhere
    if (st.wins) {
      clearTimeout(st.winsOffT);
      if (!onWins && el !== st.wins.el) { if (el) hideWins(); else st.winsOffT = setTimeout(hideWins, 220); }
    }
    if (!onWins) hoverWins(el);
    placeLabel();
  });
  document.documentElement.addEventListener('pointerleave', () => {
    if (st.drag) return;
    // a short grace period, so moving to the menu (or back) doesn't close things
    clearTimeout(st.leaveT);
    st.leaveT = setTimeout(() => {
      st.hover = false; st.hoverEl = null; st.mouseX = null; st.mouseY = null;
      hideMenu();
      hideWins();
      hideTray();
      magnify(null);
      label.hidden = true;
      shape();
      scheduleHide();
    }, st.menu || tray.open ? 450 : st.wins ? 300 : 60);
  });

  // ------------------------------------------------------------------ an app's windows
  // Resting on an app with two or more windows lists them over its icon (after a moment, so sweeping along the
  // Dock doesn't flash lists): click one to go to it (back from minimized), × to close just that one. The list
  // stays while the mouse goes up to it; the same rows top the app's right-click menu.
  const fetchWins = (it) => api.svc('dock', 'windows', it.open.key, me).then((v) => (Array.isArray(v) ? v : [])).catch(() => []);

  // a window's title without the app's name repeated at its end ("Inbox - Gmail - Google Chrome" → "Inbox - Gmail")
  function cleanTitle(title, name) {
    const plain = (s) => String(s || '').replace(/[​-‍﻿]/g, '').trim();
    const t = plain(title); const n = plain(name).toLowerCase();
    for (const sep of [' - ', ' – ', ' — ', ' | ']) {
      if (n && t.toLowerCase().endsWith(sep + n) && t.length > sep.length + n.length) return t.slice(0, t.length - sep.length - n.length).trim();
    }
    return t || plain(name);
  }
  function winRows(wins, name) {
    return wins.map((w) => `<div class="win${w.active ? ' active' : ''}${w.min ? ' min' : ''}${w.here === false ? ' away' : ''}" data-h="${w.h}" title="${esc(w.title)}">`
      + `<span class="mark"></span><span class="t">${esc(cleanTitle(w.title, name))}</span>`
      + (w.min ? `<i class="fa-solid fa-window-minimize st" title="${_t('Minimized')}"></i>` : '')
      + (w.here === false ? `<i class="fa-solid fa-display st" title="${_t('On another display')}"></i>` : '')
      + `<button class="x" title="${_t('Close this window')}">${fa('xmark')}</button></div>`).join('');
  }
  // where an item's icon is now ([x, y, w, h]; null: not drawn), for its window going into it or coming out of it
  // (Settings → Animations: main draws that, wingenie.rs)
  function iconBox(it) {
    const r = it && itemSrc(it)();
    return r ? [r.left, r.top, r.width, r.height] : null;
  }
  // A click on a row goes to that window (`it`: the app whose icon the list is over); on its × closes it (the row
  // goes right away and the list is asked again, in case the window stayed: a "save changes?" question).
  // `done(h, closed)` after.
  function winClick(e, done, it) {
    const row = e.target.closest('.win');
    if (!row) return false;
    const h = Number(row.dataset.h);
    const closing = !!e.target.closest('.x');
    if (closing) api.svc('dock', 'closeWindow', h).catch(() => {});
    else api.svc('dock', 'focusWindow', h, me, iconBox(it)).catch(() => {});
    if (closing) row.remove();
    done(h, closing);
    return true;
  }

  function hoverWins(el) {
    if (st.wins ? st.wins.el === el : st.winsFor === el) return;
    clearTimeout(st.winsT);
    st.winsFor = el;
    const it = el && list[+el.dataset.n];
    if (it && it.open && it.open.windows > 1 && !st.menu && !st.press && !tray.open) st.winsT = setTimeout(() => showWins(el, it), 420);
  }
  async function showWins(el, it) {
    const wins = await fetchWins(it);
    // the mouse moved on meanwhile
    if (st.winsFor !== el || st.hoverEl !== el || !el.isConnected || st.menu || st.drag || st.press || wins.length < 2) return;
    st.winsFor = null;
    st.wins = { el, it, wins };
    drawWins();
    genieOpen(winsEl, 'wins:' + it.key, itemSrc(it));
    shape();
  }
  function drawWins() {
    const { el, it, wins } = st.wins;
    winsEl.innerHTML = `<div class="head">${esc(it.name)} · ${_t('{n} windows', { n: wins.length })}</div><div class="rows">${winRows(wins, it.name)}</div>`;
    winsEl.hidden = false;
    label.hidden = true;
    // over the icon, above the height the icons grow to, so it never covers one
    const bottom = itemsEl.getBoundingClientRect().bottom - size() * maxScale() - 10;
    winsEl.style.maxHeight = Math.max(90, bottom - 6) + 'px';
    const r = (el.querySelector('.mag') || el).getBoundingClientRect();
    const w = winsEl.offsetWidth; const h = winsEl.offsetHeight;
    winsEl.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px';
    winsEl.style.top = Math.max(4, bottom - h) + 'px';
    genieRefresh(winsEl);
  }
  // the way up from the icon to its list (so crossing the gap doesn't close it)
  function towardWins(e) {
    const l = winsEl.getBoundingClientRect(); const i = (st.wins.el.querySelector('.mag') || st.wins.el).getBoundingClientRect();
    return e.clientY >= l.bottom - 2 && e.clientY <= i.top + 4 && e.clientX >= Math.min(l.left, i.left) - 8 && e.clientX <= Math.max(l.right, i.right) + 8;
  }
  function hideWins() {
    clearTimeout(st.winsT); clearTimeout(st.winsOffT);
    st.winsFor = null;
    if (!st.wins) return;
    st.wins = null;
    genieClose(winsEl);
    winsEl.hidden = true;
    winsEl.innerHTML = '';
    placeLabel();
    shape();
  }
  winsEl.addEventListener('click', (e) => winClick(e, (h, closed) => {
    if (!closed || !st.wins) { hideWins(); return; }
    const w = st.wins;
    w.wins = w.wins.filter((x) => x.h !== h);
    if (w.wins.length < 2) { hideWins(); return; }
    drawWins(); shape();
    setTimeout(async () => {
      if (st.wins !== w) return;
      const fresh = await fetchWins(w.it);
      if (st.wins !== w) return;
      if (fresh.length < 2) { hideWins(); return; }
      w.wins = fresh; drawWins(); shape();
    }, 700);
  }, st.wins && st.wins.it));

  // ------------------------------------------------------------------ click, drag to rearrange or remove
  itemsEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.item');
    if (!el) return;
    hideMenu();
    hideWins();
    el.classList.add('pressed');
    st.press = { el, it: list[+el.dataset.n], x: e.clientX, y: e.clientY };
    try { (e.target.closest('.mag') || el).setPointerCapture(e.pointerId); } catch {}
  });
  document.addEventListener('pointerup', () => {
    const p = st.press;
    if (!p) return;
    st.press = null;
    p.el.classList.remove('pressed');
    if (st.drag) endDrag(); else activate(p.it);
  });

  async function activate(it) {
    if (!it) return;
    if (it.kind === 'trash') { api.svc('dock', 'trash'); return; }
    if (it.kind === 'start') { api.svc('dock', 'start'); return; }
    if (it.kind === 'search') { api.svc('dock', 'start', 's'); return; } // Windows + S
    if (it.kind === 'taskview') { api.svc('dock', 'taskView'); return; }
    const r = await api.svc('dock', 'click', it.key || '', it.path || '', me, iconBox(it)).catch(() => null);
    if (r && r.launched) bounce(it.key);
  }
  function bounce(key) {
    st.bouncing.add(key);
    render();
    setTimeout(() => { st.bouncing.delete(key); render(); }, 1900);
  }

  // the mouse wheel over Task View: the next or the previous desktop (one per turn of the wheel, not per tick)
  itemsEl.addEventListener('wheel', (e) => {
    const el = e.target.closest('.item');
    const it = el && list[+el.dataset.n];
    if (!it || it.kind !== 'taskview') return;
    e.preventDefault();
    const now = performance.now();
    if (!e.deltaY || now - st.wheelAt < 450) return;
    st.wheelAt = now;
    api.svc('dock', 'desktopStep', e.deltaY > 0 ? 1 : -1).catch(() => {});
  }, { passive: false });

  // pinned items move along the Dock; dragged up out of it they're removed
  function startDrag() {
    const p = st.press;
    if (!p.it || p.it.kind !== 'pinned') { return; }
    st.drag = { ...p, to: p.it.i, out: false };
    p.el.classList.add('dragging');
    label.hidden = true;
    shape();
  }
  function dragMove(e) {
    const d = st.drag;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y;
    d.out = dy < -Math.max(size(), 24) * 1.3; // (as far up for tiny icons as for 24 px ones)
    d.el.style.transform = `translate(${dx}px, ${Math.min(0, dy)}px)`;
    d.el.classList.toggle('out', d.out);
    const others = [...itemsEl.querySelectorAll('.item')].filter((el) => el !== d.el && list[+el.dataset.n].kind === 'pinned');
    d.to = others.filter((el) => { const r = el.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; }).length;
  }
  function endDrag() {
    const d = st.drag;
    st.drag = null;
    d.el.style.transform = '';
    d.el.classList.remove('dragging', 'out');
    if (d.out) api.svc('dock', 'unpin', d.from ?? d.it.i);
    else if (d.to !== d.it.i) api.svc('dock', 'move', d.it.i, d.to);
    render();
  }

  // ------------------------------------------------------------------ right-click menu
  // On an item: what it can do; on an empty spot of the Dock: Show desktop, Task Manager and the Dock's settings,
  // like the taskbar's own menu (the last two end every menu).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target.closest('#menu, #wins, #tray')) return;
    const el = e.target.closest('.item');
    if (el) openMenu(list[+el.dataset.n], el);
    else if (e.target.closest('#dock')) openMenu(null, null, e.clientX);
  });
  let menuSeq = 0;
  async function openMenu(it, el, x) {
    const seq = ++menuSeq;
    hideWins();
    const o = it && it.open;
    // Settings → Dock → End task in the right-click menu: only where main can end something (not File Explorer, Sympony
    // or an app run as administrator); asked with the rest
    const ending = o && S.dockEndTask && o.key !== state.sympony ? api.svc('dock', 'endable', o.key).catch(() => false) : false;
    // an app's windows (listed when it has two or more), the desktops for Task View: asked first
    const [wins, desks] = await Promise.all([
      o ? fetchWins(it) : [],
      it && it.kind === 'taskview' ? api.svc('dock', 'desktops').catch(() => null) : null,
    ]);
    const endable = !!(await ending);
    if (seq !== menuSeq || (el && !el.isConnected)) return;
    const entries = [];
    const isFile = it && /^[a-z]:\\/i.test(it.path || '');
    if (!it) {
      // an empty spot (or the Show desktop sliver)
      entries.push(['desktop', _t('Show desktop'), () => api.svc('dock', 'showDesktop')]);
    } else if (it.kind === 'trash') {
      entries.push(['folder-open', _t('Open'), () => api.svc('dock', 'trash')]);
      entries.push(['thumbtack-slash', _t('Remove from Dock'), () => api.setSettings({ dockTrash: false })]);
    } else if (it.kind === 'start') {
      entries.push(['table-cells-large', _t('Open Start'), () => api.svc('dock', 'start')]);
      entries.push(['power-off', _t('Power and system menu'), () => api.svc('dock', 'start', 'x')]);
    } else if (it.kind === 'taskview') {
      entries.push(['clone', _t('Open Task View'), () => api.svc('dock', 'taskView')]);
      const names = (desks && desks.names) || [];
      if (names.length) entries.push(null);
      names.forEach((name, i) => entries.push([i === desks.cur ? 'check' : 'none', name, () => api.svc('dock', 'desktop', i)]));
      entries.push(null);
      entries.push(['plus', _t('New desktop'), () => api.svc('dock', 'desktopNew')]);
      if (names.length > 1) entries.push(['xmark', _t('Close this desktop'), () => api.svc('dock', 'desktopClose')]);
    } else {
      // (not for Sympony's own Settings: a new one would only bring it forward again)
      if (o && it.path && o.key !== state.sympony) entries.push(['plus', _t('New window'), () => { api.svc('dock', 'launch', it.path); bounce(it.key); }]);
      if (!o && it.path) entries.push(['arrow-up-right-from-square', _t('Open'), () => activate(it)]);
      if (it.kind === 'pinned') entries.push(['thumbtack-slash', _t('Remove from Dock'), () => api.svc('dock', 'unpin', it.i)]);
      else if (it.path) entries.push(['thumbtack', _t('Keep in Dock'), () => api.svc('dock', 'pin', it.name, it.path)]);
      if (it.kind === 'pinned') {
        entries.push(['image', _t('Change icon…'), () => api.svc('dock', 'setIcon', it.i)]);
        if (it.custom) entries.push(['rotate-left', _t('Use the original icon'), () => api.svc('dock', 'resetIcon', it.i)]);
      }
      if (isFile) entries.push(['folder', _t('Show in File Explorer'), () => api.svc('dock', 'reveal', it.path)]);
      if (o) entries.push(['xmark', o.windows > 1 ? _t('Close {n} windows', { n: o.windows }) : _t('Close'), () => api.svc('dock', 'close', it.key, me)]);
      // ends the app's processes at once, as Task Manager does (red: what's unsaved in it is lost); the Dock follows
      // once they're gone
      if (endable) entries.push(['ban', _t('End task'), () => api.svc('dock', 'endTask', o.key), 'danger']);
    }
    if (entries.length) entries.push(null);
    entries.push(['chart-line', _t('Task Manager'), () => api.svc('dock', 'taskManager')]);
    entries.push(['gear', _t('Dock settings'), () => api.openSettings('dock')]);
    const head = it ? `<div class="head">${esc(it.name)}</div>` : '';
    const winList = wins.length > 1 ? `<div class="wins">${winRows(wins, it.name)}</div><hr>` : '';
    if (st.menu) genieClose(menu); // (another one open: back into its icon first)
    menu.innerHTML = head + winList + entries.map((e, k) => (e ? `<button data-k="${k}"${e[3] ? ` class="${e[3]}"` : ''}>${fa(e[0])}<span>${esc(e[1])}</span></button>` : '<hr>')).join('');
    menu.hidden = false;
    const cx = el ? (() => { const r = (el.querySelector('.mag') || el).getBoundingClientRect(); return r.left + r.width / 2; })() : x;
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    menu.style.left = clamp(cx - mw / 2, 8, innerWidth - mw - 8) + 'px';
    menu.style.top = Math.max(4, dock.getBoundingClientRect().top - mh - 10) + 'px';
    st.menu = { it, entries };
    genieOpen(menu, it ? `menu:${it.kind}:${it.key}` : `menu:${x}`, it ? itemSrc(it) : barSrc(x));
    label.hidden = true;
    magnify(null);
    shape();
  }
  menu.addEventListener('click', (e) => {
    // a window at the top: go to it, or close it (its row goes; the others stay to close more)
    if (winClick(e, (h, closed) => {
      if (!closed) { hideMenu(); return; }
      const box = menu.querySelector('.wins');
      if (box && !box.children.length) { box.nextElementSibling?.remove(); box.remove(); }
      if (st.menu) { const mh = menu.offsetHeight; menu.style.top = Math.max(4, dock.getBoundingClientRect().top - mh - 10) + 'px'; }
      shape();
    }, st.menu && st.menu.it)) return;
    const b = e.target.closest('button[data-k]');
    if (!b || !st.menu) return;
    const f = st.menu.entries[+b.dataset.k][2];
    hideMenu();
    f();
  });
  function hideMenu() {
    menuSeq++;
    if (!st.menu) return;
    st.menu = null;
    genieClose(menu);
    menu.hidden = true;
    if (st.pending) render(); else shape();
  }

  // The input language (ENG) clicked: the keyboard languages in the menu above it, the one in use ticked; a pick
  // switches the app in front (dock.rs layouts). Windows + Space only switched, its own list never showed.
  async function langMenu(el) {
    const seq = ++menuSeq;
    hideWins();
    hideTray();
    const langs = await api.svc('dock', 'layouts').catch(() => []);
    if (seq !== menuSeq || !el.isConnected) return;
    const entries = (langs || []).map((l) => [l.on ? 'check' : 'none', l.name || l.code, () => api.svc('dock', 'layout', l.hkl), l.code]);
    if (entries.length) entries.push(null);
    entries.push(['gear', _t('Language settings'), () => api.svc('dock', 'langSettings')]);
    if (st.menu) genieClose(menu);
    menu.innerHTML = entries.map((e, k) => (e ? `<button data-k="${k}">${fa(e[0])}<span>${esc(e[1])}</span>${e[3] ? `<small class="code">${esc(e[3])}</small>` : ''}</button>` : '<hr>')).join('');
    menu.hidden = false;
    const r = el.getBoundingClientRect();
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    menu.style.left = clamp(r.left + r.width / 2 - mw / 2, 8, innerWidth - mw - 8) + 'px';
    menu.style.top = Math.max(4, dock.getBoundingClientRect().top - mh - 10) + 'px';
    st.menu = { it: null, entries, lang: true };
    genieOpen(menu, 'lang', elSrc(() => statusEl.querySelector('.lang')));
    label.hidden = true;
    magnify(null);
    shape();
  }

  // ------------------------------------------------------------------ files dragged in from Explorer
  // Dropped on an app's icon (pinned or open; its middle, not its edges) they open with that app (dock.rs
  // open_files: started with them, a Store app activated for them, folders opened in File Explorer), and held still
  // over an open app's icon for a moment its window comes to the top, so they can be dropped in there instead, as on
  // the taskbar. Anywhere else (between icons, on a file or folder in the Dock, the empty bar, the Recycle Bin)
  // they're pinned at that place, with a line showing where. The icons don't grow meanwhile: magnified, the one under
  // a pointer that holds still moves away from it (with the status area at the end, by up to half an icon).
  function indexAt(x) {
    const pins = [...itemsEl.querySelectorAll('.item')].filter((el) => list[+el.dataset.n].kind === 'pinned');
    return pins.filter((el) => { const r = el.getBoundingClientRect(); return x > r.left + r.width / 2; }).length;
  }
  // kinds: each item's path → how it opens files ('app', 'explorer'; main says as they come in, dropInfo); t: the
  // app under them; at: else where they'd be pinned; still/raiseT/raised: held still over an open app
  const fd = { seq: 0, kinds: new Map(), folders: false, info: null, pos: null, t: null, at: null, still: null, raiseT: 0, raised: '' };
  const dropMark = document.createElement('div');
  dropMark.id = 'dropmark'; dropMark.hidden = true;
  document.body.appendChild(dropMark);
  function dragInfo(paths) {
    const seq = ++fd.seq;
    const items = list.filter((it) => it.kind === 'pinned' || it.kind === 'open').map((it) => it.path || '');
    fd.kinds = new Map(); fd.folders = false;
    fd.info = api.svc('dock', 'dropInfo', items, paths).then((v) => {
      if (seq !== fd.seq || !v) return;
      items.forEach((p, k) => fd.kinds.set(p, (v.kinds || [])[k] || null));
      fd.folders = !!v.folders;
      if (st.dropping && fd.pos) dragAt(fd.pos);
    }).catch(() => {});
  }
  // the app's icon in that column, if it's in its middle (the edges and the gaps are for pinning)
  function itemAt(pos) {
    for (const el of itemsEl.querySelectorAll('.item')) {
      const it = list[+el.dataset.n];
      if (!it || (it.kind !== 'pinned' && it.kind !== 'open')) continue;
      const r = (el.querySelector('.mag') || el).getBoundingClientRect();
      if (pos.x >= r.left + r.width * 0.2 && pos.x <= r.right - r.width * 0.2 && pos.y >= r.top - 6) return { el, it };
    }
    return null;
  }
  // (Sympony's own Settings is only brought to the top)
  const kindOf = (it) => (it.open && it.open.key === state.sympony ? null : fd.kinds.get(it.path || '') || null);
  // an app to open them with ({ el, it, kind }, kind null: one that's open but can't take them, only brought to the top)
  function dropOn(pos) {
    const hit = pos && itemAt(pos);
    const kind = hit && kindOf(hit.it);
    return hit && (kind || hit.it.open) ? { ...hit, kind } : null;
  }
  function dragAt(pos) {
    fd.pos = pos;
    const t = pos ? dropOn(pos) : null;
    if ((t && t.el) !== (fd.t && fd.t.el)) {
      if (fd.t) fd.t.el.classList.remove('droptarget');
      clearTimeout(fd.raiseT); fd.still = null; fd.raised = '';
    }
    if (t) t.el.classList.toggle('droptarget', !!t.kind);
    fd.t = t;
    // held still (a few px either way) over an open app: its window to the top, once while they stay on its icon
    const key = t && t.it.open ? t.it.open.key : '';
    if (key && fd.raised !== key && (!fd.still || Math.hypot(pos.x - fd.still.x, pos.y - fd.still.y) > 6)) {
      fd.still = pos;
      clearTimeout(fd.raiseT);
      fd.raiseT = setTimeout(() => {
        // (still that app: the bar may have moved under them, coming up)
        const now = st.dropping && fd.pos ? dropOn(fd.pos) : null;
        if (!now || !now.it.open || now.it.open.key !== key) return;
        fd.raised = key;
        api.svc('dock', 'dragRaise', key, me).catch(() => {});
      }, 600);
    }
    fd.at = pos && !t ? indexAt(pos.x) : null;
    placeDrop();
  }
  // over the app's icon: "Open with …" (with only files over File Explorer: Show in File Explorer); over a place to
  // pin them: the line there and Keep in Dock
  function placeDrop() {
    const t = fd.t;
    let text = ''; let x = 0; let top = 0;
    if (t && t.el.isConnected) {
      const r = (t.el.querySelector('.mag') || t.el).getBoundingClientRect();
      text = t.kind === 'explorer' && !fd.folders ? _t('Show in File Explorer') : t.kind ? _t('Open with {app}', { app: t.it.name }) : labelText(t.it);
      x = r.left + r.width / 2; top = r.top;
    }
    const m = fd.at != null ? markAt(fd.at) : null;
    dropMark.hidden = !m;
    if (m) {
      dropMark.style.left = m.x + 'px'; dropMark.style.top = m.top + 'px'; dropMark.style.height = size() + 'px';
      text = _t('Keep in Dock'); x = m.x; top = m.over;
    }
    label.hidden = !text;
    if (!text) return;
    if (label.textContent !== text) label.textContent = text;
    label.style.left = x + 'px';
    label.style.top = (top - 34) + 'px';
  }
  // the line between the pinned items before and after place `n` (after the last one; with none pinned, before the
  // first item after Start), the icons' height at rest; `over`: the top of the icons next to it, for the name
  function markAt(n) {
    const els = [...itemsEl.querySelectorAll('.item')];
    const rect = (el) => (el.querySelector('.mag') || el).getBoundingClientRect();
    const pins = els.filter((el) => list[+el.dataset.n].kind === 'pinned').map(rect);
    const g = gap() / 2 + 1;
    const a = pins[n - 1]; const b = pins[n];
    let x;
    if (a && b) x = (a.right + b.left) / 2;
    else if (a) x = a.right + g;
    else if (b) x = b.left - g;
    else {
      const next = els.find((el) => !['start', 'search', 'taskview'].includes(list[+el.dataset.n].kind));
      x = next ? rect(next).left - g : itemsEl.getBoundingClientRect().right + g;
    }
    const top = itemsEl.getBoundingClientRect().bottom - size();
    return { x, top, over: Math.min(top, a ? a.top : top, b ? b.top : top) };
  }
  function dragEnds() {
    clearTimeout(fd.raiseT);
    if (fd.t) fd.t.el.classList.remove('droptarget');
    fd.t = null; fd.at = null; fd.pos = null; fd.still = null; fd.raised = '';
    dropMark.hidden = true;
    label.hidden = true;
  }
  // (the app under them and the place to pin them are taken as they're dropped; how the app opens them may still
  // be on its way from main)
  async function dropped(paths, hit, at, info) {
    await info;
    if (hit && kindOf(hit.it)) {
      if (await api.svc('dock', 'openFiles', hit.it.path, paths).catch(() => false)) bounce(hit.it.key);
      return;
    }
    api.svc('dock', 'pinFiles', paths, at);
  }
  api.onFileDrag(({ type, paths, pos }) => {
    if (type === 'enter' || type === 'over') {
      if (!st.dropping) { st.dropping = true; show(); dock.classList.add('dragover'); shape(); }
      if (type === 'enter') dragInfo(paths);
      dragAt(pos);
    } else {
      const hit = type === 'drop' && pos ? itemAt(pos) : null;
      const at = pos ? indexAt(pos.x) : null;
      st.dropping = false;
      dock.classList.remove('dragover');
      dragEnds();
      if (type === 'drop' && paths.length) dropped(paths, hit, at, fd.info);
      shape();
      scheduleHide();
    }
  });

  // auto-hide turned on (it slides away unless the mouse is on it) or off (it comes back)
  function autoHideChanged() {
    if (autoHide()) { if (!st.hover) scheduleHide(); } else show();
    shape();
  }

  // ------------------------------------------------------------------ popups out of their icon (genie)
  // Settings → Animations → Windows and popups come out of their Dock icon (fxGenie): an app's window list, the tray
  // grid and the menus stretch up out of their icon (or button) and are sucked back into it (the apps' own windows:
  // main, wingenie.rs). Only while one moves: copies of it cut into thin strips, each eased from the icon's width and
  // place to the popup's, the bottom ones last, the whole growing up out of the icon; the popup itself waits at its
  // place unseen (it already takes the mouse) and shows once they're there. Closed on its way out, it turns back from where it is; one opening while another goes back
  // into its icon comes out after. One rAF loop, only while they move; the icon is followed as it moves.
  const genieEl = document.createElement('div');
  genieEl.id = 'genie'; genieEl.hidden = true; genieEl.setAttribute('aria-hidden', 'true');
  // (over the bar, under the name over the icons: the next icon's name shows while a list goes back in)
  document.body.insertBefore(genieEl, label);
  const GENIE_OPEN = 360; const GENIE_CLOSE = 300; // ms, all the way
  const GENIE_LAG = 0.38; // how much of the time the bottom strip starts after the top one
  // cur: the one moving ({ el, key, src, from, to, strips, band, t, t0, goal, at, dur }); next: one waiting to come
  // out; srcs: each popup's icon, from when it came out (for going back in)
  const gn = { cur: null, next: null, raf: 0, clearT: 0, srcs: new Map() };
  const genieOn = () => !!S.fxGenie;
  // where an item's icon is now (found again by its key once the Dock is drawn again), else where it was last
  function itemSrc(it) {
    let last = null;
    return () => {
      const n = list.findIndex((x) => x.kind === it.kind && x.key === it.key);
      const el = n >= 0 && itemsEl.querySelector(`.item[data-n="${n}"] .mag`);
      const r = el && el.getBoundingClientRect();
      if (r && r.width) last = r;
      return last;
    };
  }
  // a button's (the status area's are drawn again now and then)
  function elSrc(get) {
    let last = null;
    return () => {
      const el = get();
      const r = el && el.isConnected && el.getBoundingClientRect();
      if (r && r.width) last = r;
      return last;
    };
  }
  // the spot on the bar where it was right-clicked
  function barSrc(x) {
    return () => {
      const d = dock.getBoundingClientRect(); const s = Math.min(size(), d.height);
      return { left: x - s / 2, top: d.top + (d.height - s) / 2, width: s, height: s };
    };
  }
  // The strips: a copy of the popup in each, moved up to show its band (made as it starts, again if it changes).
  function genieCut(a) {
    const r = a.el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // (whole px each, about 5, at most 30 of them)
    const band = Math.ceil(r.height / clamp(Math.ceil(r.height / 5), 10, 30)); const n = Math.ceil(r.height / band);
    // (a long window list scrolled down: its copies scrolled as far)
    const scrolls = [...a.el.querySelectorAll('.rows, .wins')].map((x) => x.scrollTop);
    a.to = r; a.band = band; a.strips = [];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'gs'; s.style.width = r.width + 'px'; s.style.height = band + 'px';
      const c = a.el.cloneNode(true);
      c.removeAttribute('hidden'); c.classList.remove('genie-hide');
      Object.assign(c.style, { left: '0px', top: -i * band + 'px', width: r.width + 'px', height: r.height + 'px', maxHeight: 'none' });
      s.appendChild(c);
      a.strips.push(s);
    }
    clearTimeout(gn.clearT);
    genieEl.replaceChildren(...a.strips);
    genieEl.hidden = false;
    if (scrolls.some((v) => v)) a.strips.forEach((s) => s.firstChild.querySelectorAll('.rows, .wins').forEach((x, j) => { x.scrollTop = scrolls[j] || 0; }));
    return true;
  }
  // t from 0 (in the icon) to 1 (at rest): each strip's width and middle from the icon's to the popup's (eased in and
  // out, later the lower it is), its top from the icon up to its place, the whole as tall as it has grown (eased out);
  // faded in over the first quarter. Each strip ends on a whole screen px where the next one starts (no seams, and
  // none overlapping: on a see-through style that showed as stripes).
  const inOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  function genieDraw(a) {
    const f = a.from; const p = a.to; const t = a.t;
    const up = 1 - (1 - t) ** 3;
    const ix = f.left + f.width / 2; const iy = f.top + f.height * 0.15; const iw = f.width / p.width;
    const dpr = window.devicePixelRatio || 1;
    const yAt = (i) => Math.round((iy + (p.top + i * a.band - iy) * up) * dpr) / dpr;
    genieEl.style.opacity = clamp(t * 4, 0, 1).toFixed(3);
    let y = yAt(0);
    a.strips.forEach((s, i) => {
      const e = inOut(clamp((t - ((i + 0.5) / a.strips.length) * GENIE_LAG) / (1 - GENIE_LAG), 0, 1));
      const x = ix + (p.left + p.width / 2 - ix) * e - p.width / 2;
      const below = yAt(i + 1);
      s.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(iw + (1 - iw) * e).toFixed(4)}, ${Math.max(0.002, (below - y) / a.band).toFixed(4)})`;
      y = below;
    });
  }
  // on its way to 1 (out) or 0 (back in) from where it is, in its share of the whole time
  function genieGo(a, goal) {
    a.t0 = a.t; a.goal = goal; a.at = performance.now();
    a.dur = Math.abs(goal - a.t) * (goal ? GENIE_OPEN : GENIE_CLOSE);
    genieDraw(a);
    if (!gn.raf) gn.raf = requestAnimationFrame(genieStep);
    shape();
  }
  function genieStep(now) {
    gn.raf = 0;
    const a = gn.cur;
    if (!a) return;
    // (switched off meanwhile: at its end at once)
    const k = !genieOn() || !a.dur ? 1 : clamp((now - a.at) / a.dur, 0, 1);
    const f = a.src();
    if (f) a.from = f;
    a.t = a.t0 + (a.goal - a.t0) * k;
    genieDraw(a);
    if (k < 1) gn.raf = requestAnimationFrame(genieStep); else genieEnd(a);
  }
  function genieClear() {
    clearTimeout(gn.clearT);
    genieEl.hidden = true;
    genieEl.replaceChildren();
  }
  // (one that can't move, switched off or with nothing to come out of: as without the animation)
  function genieStart(a, goal) {
    a.from = a.src();
    if (genieOn() && a.from && !(goal && a.el.hidden) && genieCut(a)) {
      if (goal) a.el.classList.add('genie-hide');
      gn.cur = a; genieGo(a, goal);
      return;
    }
    if (goal) a.el.classList.remove('genie-hide');
    genieClear();
    genieNext();
  }
  function genieNext() {
    const next = gn.next; gn.next = null;
    if (next) genieStart(next, 1);
  }
  // There: the popup itself shows (out), or it's gone (in); then the one waiting comes out (`chain` false: another one
  // starts moving at once instead, and that one waits on)
  function genieEnd(a, chain = true) {
    if (gn.cur !== a) return;
    gn.cur = null;
    cancelAnimationFrame(gn.raf); gn.raf = 0;
    if (a.goal || !gn.next || gn.next.el !== a.el) a.el.classList.remove('genie-hide');
    // (Frosted Glass: the tray grid's frosted window comes once it's at rest; its copy stays over it till then)
    if (a.goal && a.el === trayEl && frosted()) { clearTimeout(gn.clearT); gn.clearT = setTimeout(() => { if (!gn.cur) genieClear(); }, 90); } else genieClear();
    if (chain) genieNext();
    shape();
  }
  // unseen from the start, before it's placed (the tray grid: its frosted window isn't asked for meanwhile)
  function genieHold(el) { if (genieOn()) el.classList.add('genie-hide'); }
  // A popup was just drawn at its place, to come out of its icon (`src`: where that is now). `key`: whose it is (the
  // same popup for another app or icon waits for this one to be back in its icon).
  function genieOpen(el, key, src) {
    if (!genieOn()) return;
    gn.srcs.set(el, { key, src });
    el.classList.add('genie-hide');
    const c = gn.cur;
    // on its way back into the same icon: out again from where it is (copied again, it may have changed)
    if (c && c.el === el && c.key === key) {
      c.src = src;
      if (genieCut(c)) genieGo(c, 1); else genieEnd(c);
      return;
    }
    const a = { el, key, src, t: 0 };
    if (c && !c.goal) {
      if (gn.next && gn.next.el !== el) gn.next.el.classList.remove('genie-hide');
      gn.next = a;
      return;
    }
    // (another one still on its way out: at rest at once)
    if (c) genieEnd(c, false);
    genieStart(a, 1);
  }
  // A popup is about to go (still drawn): back into the icon it came out of.
  function genieClose(el) {
    // (waiting to come out: it never did)
    if (gn.next && gn.next.el === el) { gn.next = null; el.classList.remove('genie-hide'); return; }
    const c = gn.cur;
    if (c && c.el === el) {
      if (c.goal) { genieGo(c, 0); el.classList.remove('genie-hide'); }
      return;
    }
    const rec = gn.srcs.get(el);
    if (!genieOn() || !rec || el.hidden) return;
    if (c) genieEnd(c, false);
    genieStart({ el, key: rec.key, src: rec.src, t: 1 }, 0);
  }
  // the popup changed (drawn again, moved) on its way out: copied again where it is now
  function genieRefresh(el) {
    const c = gn.cur;
    if (!c || c.el !== el || !c.goal) return;
    if (genieCut(c)) { genieDraw(c); shape(); } else genieEnd(c);
  }
  // all a moving one goes over, from the popup's place to its icon (rects)
  function genieBox() {
    const a = gn.cur;
    if (!a || !a.to || !a.from) return null;
    const p = a.to; const f = a.from;
    const l = Math.min(p.left, f.left); const t = Math.min(p.top, f.top);
    const r = Math.max(p.left + p.width, f.left + f.width); const b = Math.max(p.top + p.height, f.top + f.height);
    return { x: l - 2, y: t - 2, w: r - l + 4, h: b - t + 4 };
  }

  // ------------------------------------------------------------------ start
  api.on('dock:state', (s) => { const was = autoHide(); state = s; render(); if (autoHide() !== was) autoHideChanged(); });
  // a window was maximized on this display, or none is any more (Hide while a window is maximized)
  api.on('dock:maximized', (v) => { const was = autoHide(); state.maximized = !!v; if (autoHide() !== was) autoHideChanged(); });
  // no mouse or keyboard for a while, or input again (Settings → Dock → Come up when you're idle; main only says so
  // while this Dock is hidden): up meanwhile, then away again as after the mouse left it, unless the mouse is on it
  api.on('dock:standby', (v) => {
    st.standby = !!v;
    if (st.standby) show(); else if (!st.hover) scheduleHide();
  });
  // Leaving (dock.rs apply_visibility): a fullscreen app came up on this display (Settings → Dock → Hide when an app
  // is fullscreen), or Sympony was hidden from the tray. What's open over the bar goes and the bar slides down as when it
  // auto-hides, a little quicker (dock.css #dock.leaving); main hides the window once it's down. Coming back (or
  // turned round half way) it comes up again, unless it auto-hides: then it stays down.
  api.on('dock:leaving', (on) => {
    on = !!on;
    if (on === st.leaving) return;
    st.leaving = on;
    dock.classList.toggle('leaving', on);
    if (!on) { if (!autoHide() || st.standby) show(); else shape(); return; }
    clearTimeout(st.leaveT); clearTimeout(st.hideT);
    st.hover = false; st.hoverEl = null; st.mouseX = null; st.mouseY = null;
    hideMenu(); hideWins(); hideTray(); magnify(null); label.hidden = true;
    hide(true);
  });
  api.on('dock:moved', () => { st.shapeKey = ''; shape(); });
  // this display's wallpaper colour came or changed (Style → Wallpaper color); Warmer colors at night is dock.css's
  if (window.Tint) Tint.onChange((what) => { if (what === 'wall' && look() === 'wallpaper') render(); });
  // the window's size changed (moved to fit its display, or Windows changed its scale): the bar stands elsewhere in it
  addEventListener('resize', () => { st.shapeKey = ''; shape(); });
  // the bar changed size by itself at rest (the status area's icon font came in late): its shape follows at once
  if (window.ResizeObserver) new ResizeObserver(() => { if (structure && !st.hover && !st.raf) shape(); }).observe(dock);
  api.onSettings((s) => {
    S = s;
    render();
    autoHideChanged();
  });
  Promise.all([api.getSettings(), api.svc('dock', 'state', me)]).then(([s, ds]) => {
    S = s; state = ds;
    if (autoHide()) { st.hidden = true; dock.classList.add('hidden'); }
    render();
  });
})();
