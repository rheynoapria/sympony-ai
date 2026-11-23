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

  function packCards(ids, opts) {
    const raw = Array.isArray(ids) ? ids : [];
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
      const sz = CARD_SIZES[id] || [1, 1];
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
  // what the notch's muted copy does: t/d its time and length, target the tab's position, npDur the tab's length.
  // Lengths more than 3 s apart = the tab plays an ad (hold). More than 1.5 s off = seek, 0.5 s ahead for the
  // buffering a seek costs; never while it settles (buffering, or just seeked): seeking a copy that is still
  // buffering starts its buffering over, and it never plays.
  function ytSync({ t, d, target, npDur, playing, settling }) {
    const ad = d > 0 && npDur > 0 && Math.abs(d - npDur) > 3;
    const seek = !ad && !settling && Math.abs(t - target) > 1.5 ? Math.round((target + 0.5) * 10) / 10 : null;
    return { ad, seek, play: !!playing && !ad };
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
    ytCover,
    ytCommand,
    ytGrace,
  };

  if (typeof window !== 'undefined') window.NotchKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
