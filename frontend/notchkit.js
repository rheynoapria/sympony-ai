// Pure view-layer decisions for Sympony's carousel OLED notch (meters, spring curve, page grouping,
// closed-notch bubble splitting, Windows/macOS shell state, media wave presets, agent bundle mapping).
(function () {
  function meterLevel(pct, inverse) {
    const raw = Number.isFinite(pct) ? pct : 0;
    const v = inverse ? 100 - raw : raw;
    if (v < 50) return 1;
    if (v < 70) return 2;
    if (v < 85) return 3;
    return 4;
  }

  function meter(pct, inverse) {
    return 'var(--m' + meterLevel(pct, inverse) + ')';
  }

  function springCurve(k = 230, c = 22, n = 48) {
    let x = 0;
    let v = 0;
    let t = 0;
    const dt = 1 / 600;
    const pts = [[0, 0]];
    while (t < 2) {
      const a = -k * (x - 1) - c * v;
      v += a * dt;
      x += v * dt;
      t += dt;
      pts.push([t, x]);
      if (t > 0.2 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
    }
    const out = [];
    for (let i = 0; i <= n; i++) {
      const p = pts[Math.min(pts.length - 1, Math.round((i / n) * (pts.length - 1)))];
      out.push(p[1].toFixed(4));
    }
    out[0] = '0';
    out[n] = '1';
    return { css: 'linear(' + out.join(', ') + ')', dur: Number(t.toFixed(2)) };
  }

  const CARD_SIZES = {
    home: [4, 2],
    prayer: [1, 2],
    calendar: [2, 2],
    chat: [2, 1],
    todo: [2, 1],
    control: [2, 1],
    shelf: [2, 1],
    stats: [2, 1],
    translate: [2, 1],
    notifs: [2, 1],
    launcher: [2, 1],
    hitl: [2, 1],
    notes: [1, 1],
    pomodoro: [1, 1],
    weather: [1, 1],
    health: [1, 1],
    dayprogress: [1, 1],
    aiusage: [1, 1],
    screentime: [1, 1],
    bluetooth: [1, 1],
    github: [1, 1],
    radio: [1, 1],
    bookmarks: [1, 1],
    worldclock: [1, 1],
    teleprompter: [1, 1],
  };

  function parseGridSize(raw, fallback) {
    if (Array.isArray(raw) && raw.length === 2) {
      const w = Math.max(1, Math.min(4, Math.round(Number(raw[0]) || 1)));
      const h = Math.max(1, Math.min(2, Math.round(Number(raw[1]) || 1)));
      return [w, h];
    }
    if (typeof raw === 'string') {
      const m = /^([1-4])x([1-2])$/i.exec(raw.trim());
      if (m) return [Number(m[1]), Number(m[2])];
    }
    return fallback || [1, 1];
  }

  function packCards(ids, opts) {
    const raw = Array.isArray(ids) ? ids : [];
    const customSizes = (opts && opts.sizes && typeof opts.sizes === 'object') ? opts.sizes : null;
    const seen = new Set();
    const list = [];
    if (opts && opts.hitl) {
      seen.add('hitl');
      list.push('hitl');
    }
    for (const id of raw) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push(id);
    }
    const pages = [];
    const fits = (grid, x, y, w, h) => {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          if (j > 1 || i > 3 || grid[j][i]) return false;
        }
      }
      return true;
    };
    for (const id of list) {
      const defSz = CARD_SIZES[id] || [1, 1];
      const sz = customSizes && customSizes[id] ? parseGridSize(customSizes[id], defSz) : defSz;
      const w = sz[0];
      const h = sz[1];
      let placed = false;
      for (const pg of pages) {
        for (let y = 0; y < 2 && !placed; y++) {
          for (let x = 0; x < 4 && !placed; x++) {
            if (fits(pg._grid, x, y, w, h)) {
              for (let j = y; j < y + h; j++) {
                for (let i = x; i < x + w; i++) pg._grid[j][i] = id;
              }
              pg.cards.push({ id, x, y, w, h });
              placed = true;
            }
          }
        }
        if (placed) break;
      }
      if (!placed) {
        const grid = [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ];
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) grid[j][i] = id;
        }
        pages.push({ _grid: grid, cards: [{ id, x: 0, y: 0, w, h }] });
      }
    }
    return pages.map((pg) => ({ cards: pg.cards }));
  }

  function sectionOrder(enabledOrdered, opts) {
    const raw = Array.isArray(enabledOrdered) ? enabledOrdered : [];
    const seen = new Set();
    const out = [];
    if (opts && opts.hitl) {
      seen.add('hitl');
      out.push('hitl');
    }
    for (const id of raw) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  function splitActivities(list, rotIdx) {
    if (!Array.isArray(list) || list.length === 0) return { main: null, bubble: null };
    if (list.length === 1) return { main: list[0], bubble: null };
    const bubble = list[1];
    const mains = [list[0], ...list.slice(2)];
    const idx = ((rotIdx || 0) % mains.length + mains.length) % mains.length;
    return { main: mains[idx], bubble };
  }

  function shellState(i) {
    const s = i || {};
    const form = s.form || 'notch';
    const fg = s.fg || 'normal';
    if (s.alert) return 'alert';
    if (s.open) return 'open';
    if (s.summoned) return 'summoned';
    if (form === 'hidden') return 'hidden';
    if (fg === 'full' && form !== 'drawer' && (s.win || s.hideInFullscreen)) return 'hidden';
    if (s.win && fg === 'max' && form === 'notch' && !s.reserveTop) return 'tuck';
    if (s.autoHidden || s.tucked) return 'tuck';
    if (form === 'drawer') return 'handle';
    if (s.stepAside) return 'aside';
    return 'pill';
  }

  const WAVES = {
    classic: { amplitude: 2.5, tilt: (72 * Math.PI) / 180, zoom: 2.4, height: 5.5, brightness: 0.8, grain: 0.2, sheen: 0, speed: 0.4 },
    tide: { amplitude: 2.1, tilt: (70 * Math.PI) / 180, zoom: 2.2, height: 6.5, brightness: 0.66, grain: 0.05, sheen: 0.35, speed: 0.3 },
    horizon: { amplitude: 1.6, tilt: (78 * Math.PI) / 180, zoom: 3.0, height: 7, brightness: 0.8, grain: 0.04, sheen: 0.8, speed: 0.26 },
  };

  function waveTune(style) {
    return Object.prototype.hasOwnProperty.call(WAVES, style) ? WAVES[style] : WAVES.tide;
  }

  function agentBundle(name) {
    const s = String(name || '').toLowerCase();
    if (s.includes('claude')) return 'com.anthropic.claudefordesktop';
    if (s.includes('codex')) return 'com.openai.codex';
    return 'com.apple.Terminal';
  }

  function ponyMood(state) {
    const s = state || {};
    if (s.asking || s.cardWaiting) return 'attention';
    if (s.listening) return 'listening';
    if (s.thinking) return 'think';
    const now = Number.isFinite(s.now) ? s.now : 0;
    if (Number.isFinite(s.doneUntil) && now < s.doneUntil) return 'done';
    if (s.playing) return 'music';
    if ((Number.isFinite(s.idleMs) && s.idleMs >= 600000) || s.locked) return 'sleep';
    return 'idle';
  }

  function voiceBars(rmsHistory, n = 24) {
    const count = Math.max(1, Number(n) || 24);
    const floor = 0.08;
    const raw = Array.isArray(rmsHistory) ? rmsHistory : [];
    const slice = raw.slice(-count);
    const out = new Array(count).fill(floor);
    const offset = count - slice.length;
    for (let i = 0; i < slice.length; i++) {
      const r = Number(slice[i]);
      if (!Number.isFinite(r) || r <= 0) {
        out[offset + i] = floor;
      } else {
        // Gentle non-linear boost so normal speech RMS (~0.02..0.2) fills the 24 bars smoothly.
        const scaled = Math.pow(Math.min(1, r * 4.5), 0.65);
        out[offset + i] = Math.max(floor, Math.min(1, scaled));
      }
    }
    return out;
  }

  // ---- YouTube video mode (spec 2026-11-21-youtube-video-mode-design.md)
  // the Music section shows the video: a video found for what's playing, the setting on, not refused by YouTube
  // (blocked) and not put away with ♫ (dismissed)
  function ytView(m, s, blocked, dismissed) {
    return !!(m && m.active && m.video && (s || {}).ytVideo !== false && !blocked.has(m.video) && !dismissed.has(m.video));
  }
  // what the notch's muted copy does: t/d its time and length as it last reported them (ageMs ago, playing when
  // state is 1, at rate: its speed now), target the tab's position, npDur the tab's length. Lengths more than 3 s
  // apart = the tab plays an ad (hold). Where the copy is now = t, run on since the report while it plays; drift > 0:
  // ahead of the tab. A little off while playing (more than 0.08 s, up to 1.5 s): nudge, a little faster (1.25×) or
  // slower (0.75×) until within 0.03 s (nudging: it's doing so), which neither jumps nor buffers. More than 1.5 s off:
  // seek, `lead` s ahead for the time a seek takes (learned: ytLead). Never while it settles (buffering, or just
  // seeked): seeking a copy that is still buffering starts its buffering over, and it never plays. A tab without a
  // timeline (live) can't be followed: left alone.
  function ytSync({ t, ageMs = 0, state = 1, rate = 1, d, target, npDur, playing, settling, nudging = false, lead = 0 }) {
    const ad = d > 0 && npDur > 0 && Math.abs(d - npDur) > 3;
    const drift = (state === 1 ? t + (Math.max(0, ageMs) / 1000) * rate : t) - target;
    let seek = null; let nudge = 1;
    if (!ad && !settling && npDur > 0) {
      const off = Math.abs(drift);
      if (off > 1.5) seek = Math.round((target + (playing ? lead : 0)) * 100) / 100;
      else if (playing && (off > 0.08 || (nudging && off > 0.03))) nudge = drift > 0 ? 0.75 : 1.25;
    }
    return { ad, seek, play: !!playing && !ad, nudge, drift };
  }
  // the lead for the next seek: the last one landed `landed` s ahead (> 0) or behind (< 0) of the tab once the copy
  // played steadily, so aim that much less (more) next time; 0 to 2 s
  function ytLead(lead, landed) {
    return Math.max(0, Math.min(2, Math.round((lead - landed) * 100) / 100));
  }

  // whether the video's thumbnail covers the player: until it has played 2.5 s since it was loaded (YouTube shows
  // its title over the start), and while paused, ended or cued (YouTube's own pause and end screens)
  // (stateMs: how long it has been in this state; buffering longer than 0.6 s shows YouTube's spinner and title)
  function ytCover(state, playedMs, stateMs = 0) {
    return state === 2 || state === 0 || state === 5 || state === -1 || playedMs < 2500 || (state === 3 && stateMs > 600);
  }

  // play/pause from what the player reports (state), not from the last command sent: YouTube may drop a pause sent
  // while it loads, and that must be sent again; at most once a second
  function ytCommand({ wantPlay, state, sinceCmdMs }) {
    if (sinceCmdMs < 1000) return null;
    const going = state === 1 || state === 3;
    if (wantPlay && !going) return 'play';
    if (!wantPlay && going) return 'pause';
    return null;
  }
  // between two videos in the same tab Now Playing has no video for a moment: the player stays (and loads the next
  // one) instead of flashing the music view and being built again
  function ytGrace(hasFrame, msSinceVideo) {
    return !!hasFrame && msSinceVideo < 3000;
  }

  // Activities that may keep the time alongside them when "Keep the time while music or a timer plays" is on
  const CLOCK_ACTIVITIES = new Set(['music', 'pomodoro', 'timer', 'stopwatch']);
  function isClockActivity(kind) {
    return CLOCK_ACTIVITIES.has(kind);
  }

  // Closed-notch layout over a MacBook camera notch: places the clock on the empty or narrower side of the camera so
  // each wing only grows to fit what actually lives on THAT side (instead of summing side + clock on both sides).
  function camClosedLayout({ camW, leftW = 0, rightW = 0, clockW = 0, pad = 0, notchWidth = 0, maxW = 0 }) {
    const cam = Math.max(0, Number(camW) || 0);
    const lw = Math.max(0, Number(leftW) || 0);
    const rw = Math.max(0, Number(rightW) || 0);
    const cw = Math.max(0, Number(clockW) || 0);
    const p = Math.max(0, Number(pad) || 0);
    const nw = Math.max(0, Number(notchWidth) || 0);
    const cap = Math.max(0, Number(maxW) || 0);
    const hasL = lw > 0;
    const hasR = rw > 0;
    const hasClock = cw > 0;
    const gap = 6;
    const camGap = 2;
    const clockRight = hasClock ? (!hasR || (hasL && rw < lw)) : false;
    let leftNeed = lw;
    let rightNeed = rw;
    if (hasClock) {
      if (clockRight) rightNeed = rw + (hasR ? gap : 0) + cw + camGap;
      else leftNeed = lw + (hasL ? gap : 0) + cw + camGap;
    }
    const wing = Math.max(leftNeed, rightNeed);
    let width = Math.max(nw, Math.ceil(cam + (wing + p) * 2));
    let showClock = hasClock;
    if (showClock && cap > 0 && width > cap && (hasL || hasR)) {
      const noClockW = Math.max(nw, Math.ceil(cam + (Math.max(lw, rw) + p) * 2));
      if (noClockW < width) {
        showClock = false;
        width = noClockW;
      }
    }
    if (cap > 0) width = Math.min(width, Math.max(Math.ceil(cam), cap));
    const halfCam = cam / 2;
    let clockL = 0;
    let clockSpan = 0;
    if (showClock) {
      if (clockRight) {
        clockL = width / 2 + halfCam + camGap;
        clockSpan = Math.max(0, width - p - (hasR ? rw + gap : 0) - clockL);
      } else {
        clockL = p + (hasL ? lw + gap : 0);
        clockSpan = Math.max(0, width / 2 - halfCam - camGap - clockL);
      }
    }
    return {
      width,
      showClock,
      clockRight,
      clockL: Math.round(clockL),
      clockW: Math.round(clockSpan),
    };
  }

  // Closed-notch width on a display without a physical camera cutout: avoids adding an empty middle on top of side * 2.
  function closedWidthNoCam({ notchWidth = 200, midNeed = 0, side = 0, pad = 28, maxW = 0 }) {
    const nw = Math.max(0, Number(notchWidth) || 0);
    const mid = Math.max(0, Number(midNeed) || 0);
    const s = Math.max(0, Number(side) || 0);
    const p = Math.max(0, Number(pad) || 0);
    const cap = Math.max(0, Number(maxW) || 0);
    let width = Math.max(nw, Math.ceil(mid + p + s * 2));
    if (cap > 0) width = Math.min(width, cap);
    return width;
  }

  // Open-notch frame dimensions for a module's chosen Style & Size override.
  // Default ('auto') uses one uniform size across every notch card (expandedWidth × defaultHeight);
  // 'fit' adopts the style's compact tailored height; presets & custom W×H are clamped safely.
  const FRAME_SIZE_HEIGHTS = { compact: 148, standard: 204, tall: 272 };
  function resolveModuleFrame({ styleDef, pref, expandedWidth = 660, defaultHeight = 268, maxW = 780, maxH = 340 }) {
    const def = styleDef && typeof styleDef === 'object' ? styleDef : { id: 'bento', height: 272, surface: 'oled' };
    const p = pref && typeof pref === 'object' ? pref : {};
    const sizeMode = ['auto', 'fit', 'compact', 'standard', 'tall', 'custom'].includes(p.size) ? p.size : 'auto';
    const baseW = Number.isFinite(Number(expandedWidth)) ? Number(expandedWidth) : 660;
    const baseH = Number.isFinite(Number(defaultHeight)) && Number(defaultHeight) > 0 ? Number(defaultHeight) : 268;
    const styleH = Number.isFinite(Number(def.height)) ? Number(def.height) : baseH;

    let wantW = baseW;
    let wantH = baseH;
    if (sizeMode === 'fit') {
      wantH = styleH;
    } else if (sizeMode === 'custom') {
      if (Number.isFinite(Number(p.width)) && Number(p.width) > 0) wantW = Number(p.width);
      if (Number.isFinite(Number(p.height)) && Number(p.height) > 0) wantH = Number(p.height);
    } else if (sizeMode !== 'auto' && FRAME_SIZE_HEIGHTS[sizeMode]) {
      wantH = FRAME_SIZE_HEIGHTS[sizeMode];
    }

    const capW = Math.max(420, Number(maxW) || 780);
    const capH = Math.max(116, Number(maxH) || 340);
    const width = Math.round(Math.max(420, Math.min(780, capW, wantW)));
    const height = Math.round(Math.max(116, Math.min(320, capH, wantH)));
    const stageH = Math.max(60, height - (height <= 148 ? 50 : 54));
    const rawSurf = p.surface;
    const surface = ['oled', 'borderless', 'outline', 'glass'].includes(rawSurf)
      ? rawSurf
      : (def.surface || 'oled');

    return {
      styleId: def.id || 'bento',
      sizeMode,
      width,
      height,
      stageH,
      surface,
    };
  }

  // Unified closed-notch state key shared by the 1 s poll and renderClosed() so Pony idle / notifications / Claude
  // cards never falsely trigger a 1 Hz swap re-animation (especially visible in #closedMid on non-camera Macs).
  function closedStateKey({ actKey = '', claude = false, notif = false, ponyMood = '' } = {}) {
    return String(actKey || '')
      + (claude ? '|cc' : '')
      + (notif ? '|nf' : '')
      + (ponyMood ? `|pony:${ponyMood}` : '');
  }

  // ---- Pure, XSS-safe GitHub-Flavored Markdown renderer for Pony AI chat & live streams
  function escMdHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isSafeHttpUrl(url) {
    return /^https?:\/\/[^\s<>"]+$/i.test(String(url || '').trim());
  }

  function trimTrailingUrlPunct(raw) {
    let url = raw;
    let tail = '';
    while (url.length) {
      const last = url[url.length - 1];
      if (/[.,!?:;'"]/.test(last)) {
        tail = last + tail;
        url = url.slice(0, -1);
        continue;
      }
      if (last === ')') {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes > opens) {
          tail = last + tail;
          url = url.slice(0, -1);
          continue;
        }
      }
      if (last === ']') {
        const opens = (url.match(/\[/g) || []).length;
        const closes = (url.match(/\]/g) || []).length;
        if (closes > opens) {
          tail = last + tail;
          url = url.slice(0, -1);
          continue;
        }
      }
      break;
    }
    return [url, tail];
  }

  function renderMdInline(raw) {
    const slots = [];
    const hold = (html) => {
      const idx = slots.length;
      slots.push(html);
      return `\u0000MD${idx}\u0000`;
    };

    let s = String(raw == null ? '' : raw);

    // 1. Protect inline code spans first (`code` or ``code with ` inside``) so emphasis/links never touch code.
    s = s.replace(/(`+)([^\n]+?)\1/g, (m, ticks, inner) => {
      const trimmed = ticks.length > 1 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()
        ? inner.slice(1, -1)
        : inner;
      return hold(`<code>${escMdHtml(trimmed)}</code>`);
    });

    // 2. Protect backslash-escaped punctuation (\*, \_, \~, \`, \|, \[, \])
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (m, ch) => hold(escMdHtml(ch)));

    // 3. Markdown links [label](https://...) — only allow http/https URLs (supports balanced parens in URLs)
    s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]+|\([^()\s]*\))+)(?:\s+"([^"\n]*)")?\)/g, (m, label, url, title) => {
      if (!isSafeHttpUrl(url)) return m;
      const tAttr = title ? ` title="${escMdHtml(title)}"` : '';
      return hold(`<a data-href="${escMdHtml(url)}"${tAttr}>${renderMdInline(label)}</a>`);
    });

    // 4. Bare auto-links https://... or http://...
    s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<]+)/g, (m, pre, rawUrl) => {
      const [url, tail] = trimTrailingUrlPunct(rawUrl);
      if (!isSafeHttpUrl(url)) return m;
      return pre + hold(`<a data-href="${escMdHtml(url)}">${escMdHtml(url)}</a>`) + tail;
    });

    // 5. Escape all remaining raw HTML before applying text emphasis tags
    s = escMdHtml(s);

    // 6. Emphasis & strikethrough (word-boundary safe for underscores so snake_case_ids stay intact)
    s = s.replace(/\*\*\*([^*\n]+?)\*\*\*/g, (m, inner) => (
      inner.startsWith(' ') || inner.endsWith(' ') ? m : `<strong><em>${inner}</em></strong>`
    ));
    s = s.replace(/(^|[\s(\[—–“‘;>\-])___([^_\n]+?)___(?=[\s).,!?:;\]—–”’<&\-]|$)/g, '$1<strong><em>$2</em></strong>');
    s = s.replace(/\*\*((?:[^*\n]|\*(?!\*))+?)\*\*/g, (m, inner) => (
      inner.startsWith(' ') || inner.endsWith(' ') ? m : `<strong>${inner}</strong>`
    ));
    s = s.replace(/(^|[\s(\[—–“‘;>\-])__([^_\n]+?)__(?=[\s).,!?:;\]—–”’<&\-]|$)/g, '$1<strong>$2</strong>');
    s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[\s(\[—–“‘;>\-])\*([^*\n]+?)\*(?=[\s).,!?:;\]—–”’<&\-]|$)/g, (m, pre, inner) => (
      inner.startsWith(' ') || inner.endsWith(' ') ? m : `${pre}<em>${inner}</em>`
    ));
    s = s.replace(/(^|[\s(\[—–“‘;>\-])_([^_\n]+?)_(?=[\s).,!?:;\]—–”’<&\-]|$)/g, (m, pre, inner) => (
      inner.startsWith(' ') || inner.endsWith(' ') ? m : `${pre}<em>${inner}</em>`
    ));

    // 7. Restore protected HTML fragments (iteratively in case links contained nested spans)
    let guard = 0;
    while (s.includes('\u0000MD') && guard++ < 6) {
      s = s.replace(/\u0000MD(\d+)\u0000/g, (_, idx) => slots[Number(idx)] ?? '');
    }
    return s;
  }

  function splitMdTableRow(line) {
    let trimmed = String(line || '').trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
    const cells = [];
    let cur = '';
    let inCode = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '\\' && trimmed[i + 1] === '|') {
        cur += '|';
        i++;
        continue;
      }
      if (ch === '`') {
        inCode = !inCode;
        cur += ch;
        continue;
      }
      if (ch === '|' && !inCode) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseMdTableAlign(line) {
    if (!line || !line.includes('|')) return null;
    const cells = splitMdTableRow(line);
    if (!cells.length) return null;
    const aligns = [];
    for (const c of cells) {
      if (!/^:?-{2,}:?$/.test(c)) return null;
      const left = c.startsWith(':');
      const right = c.endsWith(':');
      aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : '');
    }
    return aligns;
  }

  function isMdHr(line) {
    const t = line.trim();
    return /^(?:-\s*){3,}$/.test(t) || /^(?:\*\s*){3,}$/.test(t) || /^(?:_\s*){3,}$/.test(t);
  }

  function parseMdListLine(line) {
    const expanded = line.replace(/\t/g, '  ');
    const ul = /^(\s*)([-*+•])\s+(.*)$/.exec(expanded);
    if (ul) {
      let text = ul[3];
      let task = null;
      const tm = /^\[([ xX])\]\s+(.*)$/.exec(text);
      if (tm) {
        task = tm[1].toLowerCase() === 'x';
        text = tm[2];
      }
      return { indent: ul[1].length, tag: 'ul', start: 1, text, task };
    }
    const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(expanded);
    if (ol) {
      return { indent: ol[1].length, tag: 'ol', start: Number(ol[2]) || 1, text: ol[3], task: null };
    }
    return null;
  }

  function isMdBlockStart(lines, idx) {
    const line = lines[idx];
    if (line == null) return false;
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) return true;
    if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
    if (/^\s{0,3}>\s?/.test(line)) return true;
    if (isMdHr(line)) return true;
    if (parseMdListLine(line)) return true;
    if (line.includes('|') && idx + 1 < lines.length && parseMdTableAlign(lines[idx + 1])) return true;
    return false;
  }

  function renderMdListNodes(items) {
    if (!items.length) return '';
    const renderItems = (list, baseIndent) => {
      let html = '';
      let i = 0;
      while (i < list.length) {
        const tag = list[i].tag;
        const start = list[i].start;
        const startAttr = tag === 'ol' && start !== 1 ? ` start="${start}"` : '';
        const hasTasks = list[i].task !== null;
        html += `<${tag}${startAttr}${hasTasks ? ' class="md-tasks"' : ''}>`;
        while (i < list.length && list[i].tag === tag && list[i].indent === baseIndent) {
          const cur = list[i];
          i++;
          const children = [];
          while (i < list.length && list[i].indent > baseIndent) {
            children.push(list[i]);
            i++;
          }
          const bodyHtml = cur.lines.map(renderMdInline).join('<br>');
          const childHtml = children.length ? renderItems(children, children[0].indent) : '';
          if (cur.task !== null) {
            html += `<li class="md-task${cur.task ? ' done' : ''}"><span class="md-chk${cur.task ? ' on' : ''}" aria-hidden="true">${cur.task ? '✓' : ''}</span><span class="md-task-body">${bodyHtml}${childHtml}</span></li>`;
          } else {
            html += `<li>${bodyHtml}${childHtml}</li>`;
          }
        }
        html += `</${tag}>`;
      }
      return html;
    };
    return renderItems(items, items[0].indent);
  }

  function renderMarkdown(src, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const copyTitle = escMdHtml(o.copyTitle || 'Copy code');
    const copyIcon = o.copyIcon || 'Copy';
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    if (!text.trim()) return '';

    const lines = text.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Blank line
      if (!line.trim()) {
        i++;
        continue;
      }

      // 1. Fenced code block (```lang or ~~~lang, tolerates unclosed fence during live streaming)
      const fence = /^\s{0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
      if (fence) {
        const marker = fence[1];
        const ch = marker[0];
        const minLen = marker.length;
        const lang = fence[2].trim().split(/\s+/)[0] || '';
        const closeRe = new RegExp(`^\\s{0,3}${ch}{${minLen},}\\s*$`);
        i++;
        const body = [];
        while (i < lines.length && !closeRe.test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        if (i < lines.length && closeRe.test(lines[i])) i++;
        const codeHtml = escMdHtml(body.join('\n'));
        if (lang) {
          out.push(`<div class="md-code"><div class="md-code-hd"><span class="md-code-lang">${escMdHtml(lang)}</span><button type="button" class="ch-copy" title="${copyTitle}">${copyIcon}</button></div><pre><code>${codeHtml}</code></pre></div>`);
        } else {
          out.push(`<div class="md-code plain"><pre><button type="button" class="ch-copy" title="${copyTitle}">${copyIcon}</button><code>${codeHtml}</code></pre></div>`);
        }
        continue;
      }

      // 2. GFM Table (header row + delimiter row + 0..N body rows)
      if (line.includes('|') && i + 1 < lines.length) {
        const aligns = parseMdTableAlign(lines[i + 1]);
        if (aligns) {
          const headers = splitMdTableRow(line);
          const colCount = Math.max(headers.length, aligns.length);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
            if (/^\s{0,3}(`{3,}|~{3,}|#{1,6}\s+|>\s?)/.test(lines[i]) || isMdHr(lines[i])) break;
            rows.push(splitMdTableRow(lines[i]));
            i++;
          }
          const cellStyle = (c) => (aligns[c] ? ` style="text-align:${aligns[c]}"` : '');
          const ths = Array.from({ length: colCount }, (_, c) => `<th${cellStyle(c)}>${renderMdInline(headers[c] || '')}</th>`).join('');
          const trs = rows.map((r) => `<tr>${Array.from({ length: colCount }, (_, c) => `<td${cellStyle(c)}>${renderMdInline(r[c] || '')}</td>`).join('')}</tr>`).join('');
          out.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead>${trs ? `<tbody>${trs}</tbody>` : ''}</table></div>`);
          continue;
        }
      }

      // 3. ATX Heading (# through ######)
      const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const clsLevel = Math.min(4, level);
        out.push(`<h${level} class="md-h md-h${clsLevel}">${renderMdInline(heading[2])}</h${level}>`);
        i++;
        continue;
      }

      // 4. Horizontal rule (---, ***, ___)
      if (isMdHr(line)) {
        out.push('<hr class="md-hr">');
        i++;
        continue;
      }

      // 5. Blockquote (> ...)
      if (/^\s{0,3}>\s?/.test(line)) {
        const bq = [];
        while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
          bq.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push(`<blockquote class="md-bq">${renderMarkdown(bq.join('\n'), o)}</blockquote>`);
        continue;
      }

      // 6. Lists (ul, ol, nested, task lists)
      const firstList = parseMdListLine(line);
      if (firstList) {
        const items = [];
        while (i < lines.length) {
          if (!lines[i].trim()) {
            // Look ahead: stay in same list only if next non-blank line continues a list
            let peek = i + 1;
            while (peek < lines.length && !lines[peek].trim()) peek++;
            if (peek < lines.length && parseMdListLine(lines[peek])) {
              i = peek;
              continue;
            }
            break;
          }
          const li = parseMdListLine(lines[i]);
          if (li) {
            items.push({ indent: li.indent, tag: li.tag, start: li.start, task: li.task, lines: [li.text] });
            i++;
          } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !isMdBlockStart(lines, i)) {
            items[items.length - 1].lines.push(lines[i].trim());
            i++;
          } else {
            break;
          }
        }
        out.push(renderMdListNodes(items));
        continue;
      }

      // 7. Paragraph (collect until blank line or next block starter)
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isMdBlockStart(lines, i))) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) {
        out.push(`<p>${para.map(renderMdInline).join('<br>')}</p>`);
      }
    }

    return out.join('');
  }

  const api = {
    meterLevel,
    meter,
    springCurve,
    CARD_SIZES,
    packCards,
    sectionOrder,
    splitActivities,
    shellState,
    WAVES,
    waveTune,
    agentBundle,
    ponyMood,
    voiceBars,
    ytView,
    ytSync,
    ytLead,
    ytCover,
    ytCommand,
    ytGrace,
    isClockActivity,
    camClosedLayout,
    closedWidthNoCam,
    resolveModuleFrame,
    closedStateKey,
    renderMarkdown,
  };

  if (typeof window !== 'undefined') window.NotchKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
