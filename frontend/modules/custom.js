// Declarative OLED Custom Modules Runtime & Safe Expression Engine (Phase 1).
// Zero eval(), zero raw innerHTML on untrusted data, strict prototype-pollution & https:// guards,
// visibility-aware polling, per-card error boundaries, and zero-restart carousel hot-reload.
(function () {
  'use strict';

  const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const ACCENT_HEX = {
    emerald: '#30d158',
    sky: '#38bdf8',
    amber: '#f59e0b',
    rose: '#fb7185',
    violet: '#a78bfa',
    cyan: '#22d3ee',
    lime: '#a3e635',
    neutral: '#e4e4e7',
  };

  const ICON_PATHS = {
    Boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/>',
    Sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    TrendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    Activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    Flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    Heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    Zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    Globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    Clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    CheckCircle2: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    Server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
    Database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    Terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    Code2: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    Coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/>',
    DollarSign: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    Wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    Newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M10 6h8M10 10h8M10 14h5"/>',
    Rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
    Cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    Sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    Moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    Music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    Coffee: '<path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
    Dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
    Droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
    BookOpen: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    Target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    Bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    Shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    Cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    Wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
    Gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    Star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    Rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
    Calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    Timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
    ListTodo: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
    Bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    Compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  };

  function iconSvg(name, style) {
    const body = ICON_PATHS[name] || ICON_PATHS.Boxes;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${style ? ` style="${style}"` : ''} aria-hidden="true">${body}</svg>`;
  }

  function accentColor(accent) {
    if (typeof accent !== 'string') return ACCENT_HEX.emerald;
    const key = accent.trim().toLowerCase();
    if (ACCENT_HEX[key]) return ACCENT_HEX[key];
    if (/^#[0-9a-f]{6}$/i.test(key)) return key;
    return ACCENT_HEX.emerald;
  }

  function safeUrl(raw) {
    if (typeof raw !== 'string') return '';
    const u = raw.trim();
    return /^https:\/\/[^\s]+$/i.test(u) ? u : '';
  }

  // ---- Pure safe expression & pipe evaluator (zero eval / Function)
  function evalPath(ctx, exprPath) {
    if (!ctx || typeof exprPath !== 'string') return undefined;
    const parts = exprPath.trim().split('.');
    let cur = ctx;
    for (const seg of parts) {
      if (!seg || BLOCKED_KEYS.has(seg)) return undefined;
      if (cur == null || typeof cur !== 'object') return undefined;
      if (Array.isArray(cur)) {
        const idx = Number(seg);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
        cur = cur[idx];
      } else {
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
        cur = cur[seg];
      }
    }
    return cur;
  }

  function formatTimeAgo(val, nowMs) {
    const ts = Number(val);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const diffSec = Math.max(0, Math.round(((nowMs || Date.now()) - ts) / 1000));
    if (diffSec < 60) return `${diffSec}s`;
    const m = Math.round(diffSec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  function formatPipe(val, pipeSpec, nowMs) {
    const colon = pipeSpec.indexOf(':');
    const name = (colon >= 0 ? pipeSpec.slice(0, colon) : pipeSpec).trim().toLowerCase();
    const argRaw = colon >= 0 ? pipeSpec.slice(colon + 1).trim() : '';
    const arg = argRaw.replace(/^["']|["']$/g, '');

    if (name === 'fallback') {
      return (val == null || val === '') ? (arg || '—') : val;
    }
    if (val == null || val === '') return '';

    switch (name) {
      case 'number': {
        const n = Number(val);
        if (!Number.isFinite(n)) return String(val);
        const dec = arg !== '' ? Math.max(0, Math.min(6, Number(arg) || 0)) : 0;
        return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      }
      case 'currency': {
        const n = Number(val);
        if (!Number.isFinite(n)) return String(val);
        const cur = (arg || 'USD').toUpperCase();
        const dec = cur === 'IDR' || cur === 'JPY' || cur === 'KRW' ? 0 : (Math.abs(n) >= 100 ? 0 : 2);
        try {
          return new Intl.NumberFormat(cur === 'IDR' ? 'id-ID' : 'en-US', {
            style: 'currency',
            currency: cur,
            minimumFractionDigits: dec,
            maximumFractionDigits: dec,
          }).format(n);
        } catch {
          return `${cur} ${n.toFixed(dec)}`;
        }
      }
      case 'compact': {
        const n = Number(val);
        if (!Number.isFinite(n)) return String(val);
        try {
          return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
        } catch {
          return String(n);
        }
      }
      case 'percent': {
        const n = Number(val);
        if (!Number.isFinite(n)) return String(val);
        const dec = arg !== '' ? Math.max(0, Math.min(4, Number(arg) || 0)) : 1;
        return `${n.toFixed(dec)}%`;
      }
      case 'signedpercent': {
        const n = Number(val);
        if (!Number.isFinite(n)) return String(val);
        const dec = arg !== '' ? Math.max(0, Math.min(4, Number(arg) || 0)) : 1;
        return `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`;
      }
      case 'timeago':
        return formatTimeAgo(val, nowMs);
      case 'truncate': {
        const s = String(val);
        const lim = Math.max(4, Math.min(200, Number(arg) || 40));
        return s.length > lim ? `${s.slice(0, lim - 1)}…` : s;
      }
      case 'upper':
        return String(val).toUpperCase();
      case 'lower':
        return String(val).toLowerCase();
      default:
        return val;
    }
  }

  function evalSingleToken(token, ctx, nowMs) {
    const parts = token.split('|').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    let val = evalPath(ctx, parts[0]);
    for (let i = 1; i < parts.length; i++) {
      val = formatPipe(val, parts[i], nowMs);
    }
    return val;
  }

  /** Evaluates a raw value expression (`"{{src.items}}"` -> actual array/number/object). */
  function resolveValue(template, ctx, nowMs) {
    if (typeof template !== 'string') return template;
    const trimmed = template.trim();
    const whole = /^\{\{([^{}]+)\}\}$/.exec(trimmed);
    if (whole) return evalSingleToken(whole[1], ctx, nowMs);
    return resolveExpr(template, ctx, nowMs);
  }

  /** Evaluates a display string template (`"BTC: {{mkt.btc | currency:USD}}"` -> string). */
  function resolveExpr(template, ctx, nowMs) {
    if (template == null) return '';
    if (typeof template !== 'string') return String(template);
    if (!template.includes('{{')) return template;
    return template.replace(/\{\{([^{}]+)\}\}/g, (_, inner) => {
      const v = evalSingleToken(inner, ctx, nowMs);
      return v == null ? '' : String(v);
    });
  }

  /** Builds normalized polyline points (`"x1,y1 x2,y2 ..."`) for inline OLED SVG sparklines. */
  function buildSparklinePoints(rawArr, width, height) {
    const nums = (Array.isArray(rawArr) ? rawArr : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .slice(-60);
    if (nums.length < 2) return '';
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pad = 2;
    const innerH = Math.max(4, height - pad * 2);
    const stepX = width / (nums.length - 1);
    return nums
      .map((v, i) => {
        const x = (i * stepX).toFixed(1);
        const y = (pad + innerH - ((v - min) / span) * innerH).toFixed(1);
        return `${x},${y}`;
      })
      .join(' ');
  }

  let svgUid = 0;
  function buildSparklineGeometry(rawArr, width, height) {
    const nums = (Array.isArray(rawArr) ? rawArr : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .slice(-60);
    if (nums.length < 2) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const padX = 5;
    const padTop = 6;
    const padBot = 4;
    const innerH = Math.max(4, height - padTop - padBot);
    const stepX = (width - padX * 2) / (nums.length - 1);
    const pts = nums.map((v, i) => ({
      x: padX + i * stepX,
      y: padTop + (1 - (v - min) / span) * innerH,
    }));
    let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      line += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    line += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    const baseY = height - 1;
    const area = `${line} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;
    return { line, area, last, baseY: height - padBot };
  }

  function appendFormattedMetricValue(container, rawText) {
    const m = /^(\$|€|£|¥|Rp[\u00a0 ]?)(.+)$/.exec(String(rawText || ''));
    if (m) {
      container.appendChild(el('span', 'cm-cur', m[1]));
      container.appendChild(document.createTextNode(m[2]));
    } else {
      container.textContent = String(rawText || '—');
    }
  }

  const Engine = {
    ACCENT_HEX,
    ICON_PATHS,
    iconSvg,
    accentColor,
    safeUrl,
    evalPath,
    formatPipe,
    resolveExpr,
    resolveValue,
    buildSparklinePoints,
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = Engine;
  }
  if (typeof window === 'undefined') return;
  window.CustomModEngine = Engine;

  // ---- Notch Browser Runtime
  const N = window.N;
  if (!N) return;
  const { st, api } = N;
  const _t = typeof window._t === 'function' ? window._t : (s) => s;

  // Live store of installed custom modules keyed by bare slug
  const registry = new Map(); // slug -> { manifest, state, config, data, errors, approvedDomains, missingDomains, updatedAt, loading, pollTimer, cards: Set<HTMLElement>, pages: Set<HTMLElement>, visible: bool }

  function buildContext(rec, extra) {
    const ctx = {
      state: rec.state || {},
      config: rec.config || {},
      meta: { updatedAt: rec.updatedAt || 0, slug: rec.manifest.slug, name: rec.manifest.name },
    };
    if (rec.data && typeof rec.data === 'object') {
      for (const [k, v] of Object.entries(rec.data)) ctx[k] = v;
    }
    if (extra && typeof extra === 'object') Object.assign(ctx, extra);
    return ctx;
  }

  function openCreatorPrompt(promptText) {
    if (typeof N.openModuleCreator === 'function') {
      N.openModuleCreator(promptText || '');
      return;
    }
    if (typeof N.openModule === 'function') N.openModule('chat');
    else if (typeof N.setTab === 'function') N.setTab('chat');
  }

  async function fetchModuleData(slug, force) {
    const rec = registry.get(slug);
    if (!rec) return;
    const sources = rec.manifest.dataSources || [];
    if (!sources.length) return;
    if (rec.missingDomains && rec.missingDomains.length) return;
    rec.loading = true;
    rerenderRecord(rec);
    try {
      const r = await api.svc('custommod', 'fetch', slug, !!force);
      if (r && r.ok) {
        rec.data = r.data || {};
        rec.errors = r.errors || {};
        rec.missingDomains = Array.isArray(r.missingDomains) ? r.missingDomains : [];
        rec.updatedAt = r.updatedAt || Date.now();
      } else if (r && r.error) {
        rec.errors = { _fetch: r.error };
      }
    } catch (e) {
      rec.errors = { _fetch: String(e && e.message ? e.message : e) };
    } finally {
      rec.loading = false;
      rerenderRecord(rec);
    }
  }

  async function runAction(slug, actionName, payload, itemCtx) {
    const rec = registry.get(slug);
    if (!rec || !actionName) return;

    if (actionName.startsWith('__step:') || actionName.startsWith('__toggle:')) {
      const r = await api.svc('custommod', 'action', slug, actionName, payload || {});
      if (r && r.ok && r.state) {
        rec.state = r.state;
        rerenderRecord(rec);
      }
      return;
    }

    const def = rec.manifest.actions && rec.manifest.actions[actionName];
    if (!def) return;
    const ctx = buildContext(rec, itemCtx);

    switch (def.kind) {
      case 'refresh':
        await fetchModuleData(slug, true);
        return;
      case 'openUrl': {
        const u = safeUrl(resolveExpr(def.url || '', ctx));
        if (u) api.openExternal(u);
        return;
      }
      case 'copyText': {
        const txt = resolveExpr(def.text || '', ctx);
        if (txt && navigator.clipboard && navigator.clipboard.writeText) {
          try { await navigator.clipboard.writeText(txt); } catch { /* ignore */ }
        }
        return;
      }
      case 'askPony': {
        const prompt = resolveExpr(def.prompt || '', ctx);
        openCreatorPrompt(prompt);
        return;
      }
      default: {
        const r = await api.svc('custommod', 'action', slug, actionName, payload || {});
        if (r && r.ok && r.state) {
          rec.state = r.state;
          rerenderRecord(rec);
        }
      }
    }
  }

  function toneClass(tone) {
    if (tone === 'ok' || tone === 'warn' || tone === 'err' || tone === 'accent') return `t-${tone}`;
    return '';
  }

  function autoDeltaTone(deltaText) {
    const s = String(deltaText || '').trim();
    if (s.startsWith('+')) return 't-ok';
    if (s.startsWith('-')) return 't-err';
    return '';
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function renderNode(node, rec, ctx, depth) {
    if (!node || typeof node !== 'object' || depth > 7) return null;
    const slug = rec.manifest.slug;

    switch (node.type) {
      case 'stack': {
        const d = el('div', `cm-stack cm-${node.dir === 'row' ? 'row' : 'col'} gap-${node.gap || 'sm'}`);
        if (node.align) d.style.alignItems = node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : node.align;
        if (node.justify) d.style.justifyContent = node.justify === 'between' ? 'space-between' : node.justify === 'end' ? 'flex-end' : 'flex-start';
        for (const ch of (node.children || [])) {
          const cEl = renderNode(ch, rec, ctx, depth + 1);
          if (cEl) d.appendChild(cEl);
        }
        return d;
      }
      case 'grid': {
        const cols = node.cols === 3 ? 3 : 2;
        const d = el('div', `cm-grid cols-${cols} gap-${node.gap || 'sm'}`);
        for (const ch of (node.children || [])) {
          const cEl = renderNode(ch, rec, ctx, depth + 1);
          if (cEl) d.appendChild(cEl);
        }
        return d;
      }
      case 'scroll': {
        const d = el('div', 'cm-scroll');
        if (node.maxHeight) d.style.maxHeight = `${Math.max(48, Math.min(260, Number(node.maxHeight) || 140))}px`;
        d.addEventListener('wheel', (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.stopPropagation();
        }, { passive: true });
        for (const ch of (node.children || [])) {
          const cEl = renderNode(ch, rec, ctx, depth + 1);
          if (cEl) d.appendChild(cEl);
        }
        return d;
      }
      case 'divider':
        return el('div', 'cm-divider');

      case 'header': {
        const h = el('div', 'cm-hd');
        const left = el('div', 'cm-hd-l');
        const ico = el('span', 'cm-hd-ico');
        ico.innerHTML = iconSvg(rec.manifest.icon, 'width:13px;height:13px');
        left.appendChild(ico);
        left.appendChild(el('span', 'cm-hd-title', resolveExpr(node.title || rec.manifest.name, ctx)));
        const hasErr = rec.errors && Object.keys(rec.errors).length > 0;
        const hasSources = (rec.manifest.dataSources || []).length > 0;
        if (hasSources) {
          const pill = el('span', `cm-live-pill ${hasErr ? 'err' : rec.loading ? 'spin' : ''}`);
          const dot = el('span', `cm-dot ${rec.loading ? 'spin' : hasErr ? 'err' : 'live'}`);
          pill.title = hasErr ? Object.values(rec.errors)[0] : (rec.loading ? _t('Updating…') : _t('Live'));
          pill.appendChild(dot);
          if (node.subtitle) pill.appendChild(el('span', 'cm-live-txt', resolveExpr(node.subtitle, ctx)));
          left.appendChild(pill);
        } else if (node.subtitle) {
          left.appendChild(el('span', 'cm-hd-sub', resolveExpr(node.subtitle, ctx)));
        }
        h.appendChild(left);
        if (node.rightAction) {
          const btn = el('button', 'cm-hd-btn', node.rightLabel ? resolveExpr(node.rightLabel, ctx) : '↻');
          btn.type = 'button';
          btn.onclick = (e) => { e.stopPropagation(); runAction(slug, node.rightAction, {}, ctx); };
          h.appendChild(btn);
        }
        return h;
      }

      case 'metric': {
        const dt = node.delta ? resolveExpr(node.delta, ctx) : '';
        const dtTone = dt ? autoDeltaTone(dt) : '';
        const wash = dtTone === 't-ok' ? 'has-ok' : dtTone === 't-err' ? 'has-err' : node.tone === 'accent' ? 'has-accent' : '';
        const box = el('div', `cm-metric ${toneClass(node.tone)} ${wash}`.trim());
        if (node.label || dt) {
          const top = el('div', 'cm-metric-top');
          if (node.label) top.appendChild(el('div', 'cm-metric-lbl', resolveExpr(node.label, ctx)));
          if (dt) top.appendChild(el('span', `cm-delta ${dtTone}`, dt));
          box.appendChild(top);
        }
        const row = el('div', 'cm-metric-row');
        const valText = resolveExpr(node.value, ctx) || '—';
        const valEl = el('span', 'cm-metric-val');
        appendFormattedMetricValue(valEl, valText);
        row.appendChild(valEl);
        if (node.unit) row.appendChild(el('span', 'cm-metric-unit', resolveExpr(node.unit, ctx)));
        box.appendChild(row);
        return box;
      }

      case 'sparkline': {
        const raw = resolveValue(node.data, ctx);
        const hPx = Math.max(22, Math.min(64, Number(node.height) || 34));
        const geom = buildSparklineGeometry(raw, 200, hPx);
        const wrap = el('div', `cm-spark ${toneClass(node.tone || 'accent')}`);
        if (!geom) {
          wrap.appendChild(el('span', 'cm-muted', '—'));
          return wrap;
        }
        const svgNS = 'http://www.w3.org/2000/svg';
        const gid = `cm-sp-${++svgUid}`;
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 200 ${hPx}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.height = `${hPx}px`;

        const defs = document.createElementNS(svgNS, 'defs');
        const grad = document.createElementNS(svgNS, 'linearGradient');
        grad.setAttribute('id', gid);
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0');
        grad.setAttribute('y2', '1');
        const s1 = document.createElementNS(svgNS, 'stop');
        s1.setAttribute('offset', '0%');
        s1.setAttribute('stop-color', 'currentColor');
        s1.setAttribute('stop-opacity', '0.28');
        const s2 = document.createElementNS(svgNS, 'stop');
        s2.setAttribute('offset', '100%');
        s2.setAttribute('stop-color', 'currentColor');
        s2.setAttribute('stop-opacity', '0');
        grad.append(s1, s2);
        defs.appendChild(grad);
        svg.appendChild(defs);

        const base = document.createElementNS(svgNS, 'line');
        base.setAttribute('x1', '4');
        base.setAttribute('x2', '196');
        base.setAttribute('y1', geom.baseY.toFixed(1));
        base.setAttribute('y2', geom.baseY.toFixed(1));
        base.setAttribute('class', 'cm-spark-base');
        svg.appendChild(base);

        const area = document.createElementNS(svgNS, 'path');
        area.setAttribute('d', geom.area);
        area.setAttribute('fill', `url(#${gid})`);
        svg.appendChild(area);

        const line = document.createElementNS(svgNS, 'path');
        line.setAttribute('d', geom.line);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-linejoin', 'round');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.setAttribute('class', 'cm-spark-line');
        svg.appendChild(line);

        wrap.appendChild(svg);
        const beacon = el('span', 'cm-spark-beacon');
        beacon.style.left = `${((geom.last.x / 200) * 100).toFixed(2)}%`;
        beacon.style.top = `${((geom.last.y / hPx) * 100).toFixed(2)}%`;
        wrap.appendChild(beacon);
        return wrap;
      }

      case 'progress': {
        const v = Number(resolveValue(node.value, ctx)) || 0;
        const m = Math.max(1e-6, Number(resolveValue(node.max, ctx)) || 100);
        const pct = Math.max(0, Math.min(100, (v / m) * 100));
        if (node.variant === 'ring') {
          const wrap = el('div', 'cm-ring-wrap');
          const svgNS = 'http://www.w3.org/2000/svg';
          const sz = 48;
          const r = 18.5;
          const circ = 2 * Math.PI * r;
          const dashOff = circ * (1 - pct / 100);
          const rgId = `cm-rg-${++svgUid}`;
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', `0 0 ${sz} ${sz}`);
          svg.setAttribute('class', 'cm-ring-svg');
          const defs = document.createElementNS(svgNS, 'defs');
          const lg = document.createElementNS(svgNS, 'linearGradient');
          lg.setAttribute('id', rgId);
          lg.setAttribute('x1', '0%');
          lg.setAttribute('y1', '0%');
          lg.setAttribute('x2', '100%');
          lg.setAttribute('y2', '100%');
          const c1 = document.createElementNS(svgNS, 'stop');
          c1.setAttribute('offset', '0%');
          c1.setAttribute('stop-color', '#ffffff');
          c1.setAttribute('stop-opacity', '0.92');
          const c2 = document.createElementNS(svgNS, 'stop');
          c2.setAttribute('offset', '35%');
          c2.setAttribute('stop-color', accentColor(rec.manifest.accent));
          const c3 = document.createElementNS(svgNS, 'stop');
          c3.setAttribute('offset', '100%');
          c3.setAttribute('stop-color', accentColor(rec.manifest.accent));
          lg.append(c1, c2, c3);
          defs.appendChild(lg);
          svg.appendChild(defs);
          const bg = document.createElementNS(svgNS, 'circle');
          bg.setAttribute('cx', String(sz / 2));
          bg.setAttribute('cy', String(sz / 2));
          bg.setAttribute('r', String(r));
          bg.setAttribute('class', 'cm-ring-bg');
          const fg = document.createElementNS(svgNS, 'circle');
          fg.setAttribute('cx', String(sz / 2));
          fg.setAttribute('cy', String(sz / 2));
          fg.setAttribute('r', String(r));
          fg.setAttribute('class', 'cm-ring-fg');
          fg.setAttribute('stroke', `url(#${rgId})`);
          fg.setAttribute('stroke-dasharray', circ.toFixed(2));
          fg.setAttribute('stroke-dashoffset', dashOff.toFixed(2));
          svg.append(bg, fg);
          const ringBox = el('div', 'cm-ring-box');
          ringBox.appendChild(svg);
          if (node.showPercent !== false) {
            const pctEl = el('span', 'cm-ring-pct');
            pctEl.appendChild(document.createTextNode(String(Math.round(pct))));
            pctEl.appendChild(el('span', 'cm-ring-unit', '%'));
            ringBox.appendChild(pctEl);
          }
          wrap.appendChild(ringBox);
          if (node.label) {
            const meta = el('div', 'cm-ring-meta');
            meta.appendChild(el('div', 'cm-prog-lbl', resolveExpr(node.label, ctx)));
            meta.appendChild(el('div', 'cm-ring-sub', `${v} / ${m}`));
            wrap.appendChild(meta);
          }
          return wrap;
        }
        const box = el('div', 'cm-prog');
        if (node.label || node.showPercent !== false) {
          const top = el('div', 'cm-prog-top');
          top.appendChild(el('span', 'cm-prog-lbl', node.label ? resolveExpr(node.label, ctx) : ''));
          if (node.showPercent !== false) top.appendChild(el('span', 'cm-prog-pct', `${Math.round(pct)}%`));
          box.appendChild(top);
        }
        const track = el('div', 'cm-prog-track');
        const fill = el('div', 'cm-prog-fill');
        fill.style.width = `${pct.toFixed(1)}%`;
        track.appendChild(fill);
        box.appendChild(track);
        return box;
      }

      case 'list': {
        const raw = resolveValue(node.items, ctx);
        const arr = Array.isArray(raw) ? raw : [];
        const lim = Math.max(1, Math.min(20, Number(node.maxItems) || 6));
        const list = el('div', 'cm-list');
        if (!arr.length) {
          list.appendChild(el('div', 'cm-empty', resolveExpr(node.emptyText || _t('Nothing here yet'), ctx)));
          return list;
        }
        const tpl = node.item || {};
        arr.slice(0, lim).forEach((item, index) => {
          const itemCtx = { ...ctx, item, index };
          const row = el('div', 'cm-li');
          if (tpl.checked) {
            const isDone = !!resolveValue(tpl.checked, itemCtx);
            if (isDone) row.classList.add('done');
          }
          const main = el('div', 'cm-li-main');
          main.appendChild(el('div', 'cm-li-title', resolveExpr(tpl.title || '{{item.title}}', itemCtx)));
          if (tpl.subtitle) {
            const stxt = resolveExpr(tpl.subtitle, itemCtx);
            if (stxt) main.appendChild(el('div', 'cm-li-sub', stxt));
          }
          row.appendChild(main);
          if (tpl.badge) {
            const btxt = resolveExpr(tpl.badge, itemCtx);
            if (btxt) row.appendChild(el('span', 'cm-badge t-accent', btxt));
          }
          if (tpl.right) {
            const rtxt = resolveExpr(tpl.right, itemCtx);
            if (rtxt) row.appendChild(el('span', 'cm-li-right', rtxt));
          }
          if (tpl.onClick) {
            row.classList.add('clickable');
            row.onclick = (e) => {
              e.stopPropagation();
              runAction(slug, tpl.onClick, { index, id: item && item.id }, itemCtx);
            };
          }
          if (tpl.onRemove) {
            const rm = el('button', 'cm-li-rm', '×');
            rm.type = 'button';
            rm.onclick = (e) => {
              e.stopPropagation();
              runAction(slug, tpl.onRemove, { index, id: item && item.id }, itemCtx);
            };
            row.appendChild(rm);
          }
          list.appendChild(row);
        });
        return list;
      }

      case 'kv': {
        const box = el('div', 'cm-kv');
        for (const r of (node.rows || [])) {
          const row = el('div', 'cm-kv-row');
          row.appendChild(el('span', 'cm-kv-k', resolveExpr(r.key || '', ctx)));
          row.appendChild(el('span', `cm-kv-v ${toneClass(r.tone)}`, resolveExpr(r.value || '', ctx) || '—'));
          box.appendChild(row);
        }
        return box;
      }

      case 'badge':
        return el('span', `cm-badge ${toneClass(node.tone)}`, resolveExpr(node.text || '', ctx));

      case 'text': {
        const cls = [
          'cm-text',
          `sz-${node.size || 'sm'}`,
          node.mono ? 'mono' : '',
          node.muted ? 'muted' : '',
          node.weight === 'bold' ? 'bold' : node.weight === 'medium' ? 'med' : '',
          node.lines ? `clamp-${Math.min(3, Math.max(1, Number(node.lines) || 1))}` : '',
        ].filter(Boolean).join(' ');
        return el('div', cls, resolveExpr(node.value || '', ctx));
      }

      case 'empty':
        return el('div', 'cm-empty', resolveExpr(node.text || _t('No data'), ctx));

      case 'button': {
        const b = el('button', `cm-btn v-${node.variant || 'ghost'} sz-${node.size || 'sm'}`, resolveExpr(node.label || '', ctx));
        b.type = 'button';
        b.onclick = (e) => { e.stopPropagation(); runAction(slug, node.action, {}, ctx); };
        return b;
      }

      case 'stepper': {
        const sk = node.stateKey;
        const cur = Number((rec.state || {})[sk]) || 0;
        const step = Number(node.step) || 1;
        const box = el('div', 'cm-stepper');
        box.appendChild(el('span', 'cm-step-lbl', resolveExpr(node.label || sk, ctx)));
        const ctrls = el('div', 'cm-step-ctrls');
        const minus = el('button', 'cm-step-btn', '−');
        minus.type = 'button';
        minus.onclick = (e) => {
          e.stopPropagation();
          runAction(slug, `__step:${sk}`, { delta: -step, min: node.min, max: node.max }, ctx);
        };
        const val = el('span', 'cm-step-val', node.unit ? `${cur} ${node.unit}` : String(cur));
        const plus = el('button', 'cm-step-btn cm-step-plus', '+');
        plus.type = 'button';
        plus.onclick = (e) => {
          e.stopPropagation();
          runAction(slug, `__step:${sk}`, { delta: step, min: node.min, max: node.max }, ctx);
        };
        ctrls.append(minus, val, plus);
        box.appendChild(ctrls);
        return box;
      }

      case 'toggleRow': {
        const sk = node.stateKey;
        const on = !!(rec.state || {})[sk];
        const row = el('button', `cm-toggle ${on ? 'on' : ''}`);
        row.type = 'button';
        row.setAttribute('aria-pressed', on ? 'true' : 'false');
        row.appendChild(el('span', 'cm-toggle-dot', on ? '✓' : ''));
        row.appendChild(el('span', 'cm-toggle-lbl', resolveExpr(node.label || sk, ctx)));
        row.onclick = (e) => {
          e.stopPropagation();
          runAction(slug, `__toggle:${sk}`, {}, ctx);
        };
        return row;
      }

      case 'quickInput': {
        const form = el('form', 'cm-qinput');
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = resolveExpr(node.placeholder || _t('Add…'), ctx);
        inp.onfocus = () => { if (N.focusField) N.focusField(inp); };
        inp.onclick = (e) => e.stopPropagation();
        const btn = el('button', 'cm-btn v-accent sz-xs', node.buttonLabel || '+');
        btn.type = 'submit';
        btn.onclick = (e) => e.stopPropagation();
        form.onsubmit = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const val = inp.value.trim();
          if (!val) return;
          inp.value = '';
          runAction(slug, node.action, { input: val }, ctx);
        };
        form.append(inp, btn);
        return form;
      }

      default:
        return null;
    }
  }

  function renderInto(host, rec, mode) {
    if (!host) return;
    host.innerHTML = '';
    const root = el('div', `cm-root cm-mode-${mode}`);
    root.style.setProperty('--cm-accent', accentColor(rec.manifest.accent));

    // Domain approval banner (e.g. after backup import disarm or unapproved domain)
    if (rec.missingDomains && rec.missingDomains.length > 0) {
      const banner = el('div', 'cm-banner');
      banner.appendChild(el('span', 'cm-banner-txt', `${_t('Approve HTTPS')}: ${rec.missingDomains.join(', ')}`));
      const approveBtn = el('button', 'cm-btn v-accent sz-xs', _t('Allow'));
      approveBtn.type = 'button';
      approveBtn.onclick = async (e) => {
        e.stopPropagation();
        const next = [...new Set([...(rec.approvedDomains || []), ...rec.missingDomains])];
        await api.svc('custommod', 'approveDomains', rec.manifest.slug, next);
      };
      banner.appendChild(approveBtn);
      root.appendChild(banner);
    }

    // Per-card error boundary
    const tree = mode === 'expanded' && rec.manifest.view.expanded ? rec.manifest.view.expanded : rec.manifest.view.compact;
    try {
      const ctx = buildContext(rec);
      const rendered = renderNode(tree, rec, ctx, 0);
      if (rendered) root.appendChild(rendered);
    } catch (err) {
      const errBox = el('div', 'cm-banner err');
      errBox.appendChild(el('span', 'cm-banner-txt', String(err && err.message ? err.message : err)));
      const fixBtn = el('button', 'cm-btn v-ghost sz-xs', _t('Fix with Pony'));
      fixBtn.type = 'button';
      fixBtn.onclick = (e) => {
        e.stopPropagation();
        openCreatorPrompt(`Fix custom module custom:${rec.manifest.slug}: ${err && err.message ? err.message : err}`);
      };
      errBox.appendChild(fixBtn);
      root.appendChild(errBox);
    }

    // Non-blocking fetch error footer with Retry + Fix with Pony
    const errs = rec.errors && Object.values(rec.errors).filter(Boolean);
    if (errs && errs.length > 0) {
      const eb = el('div', 'cm-banner err');
      eb.appendChild(el('span', 'cm-banner-txt', errs[0]));
      const retry = el('button', 'cm-btn v-ghost sz-xs', _t('Retry'));
      retry.type = 'button';
      retry.onclick = (e) => { e.stopPropagation(); fetchModuleData(rec.manifest.slug, true); };
      const fix = el('button', 'cm-btn v-ghost sz-xs', _t('Fix with Pony'));
      fix.type = 'button';
      fix.onclick = (e) => {
        e.stopPropagation();
        openCreatorPrompt(`Fix custom module custom:${rec.manifest.slug} fetch error: ${errs[0]}`);
      };
      eb.append(retry, fix);
      root.appendChild(eb);
    }

    // In expanded/full mode, add a refined OLED footer bar with Edit with Pony pill
    if (mode === 'expanded') {
      const foot = el('div', 'cm-foot');
      foot.appendChild(el('span', 'cm-foot-tag', `custom:${rec.manifest.slug}`));
      const editBtn = el('button', 'cm-foot-edit');
      editBtn.type = 'button';
      editBtn.appendChild(el('span', 'cm-foot-spark', '✦'));
      editBtn.appendChild(document.createTextNode(_t('Edit with Pony')));
      editBtn.onclick = (e) => {
        e.stopPropagation();
        openCreatorPrompt(`Edit custom module custom:${rec.manifest.slug}: `);
      };
      foot.appendChild(editBtn);
      root.appendChild(foot);
    }

    host.appendChild(root);
  }

  function rerenderRecord(rec) {
    for (const c of Array.from(rec.cards)) {
      if (!c.isConnected) { rec.cards.delete(c); continue; }
      renderInto(c, rec, 'compact');
    }
    for (const p of Array.from(rec.pages)) {
      if (!p.isConnected) { rec.pages.delete(p); continue; }
      renderInto(p, rec, 'expanded');
    }
  }

  function startPoll(rec) {
    stopPoll(rec);
    const sources = rec.manifest.dataSources || [];
    if (!sources.length) return;
    const minSec = Math.max(30, Math.min(...sources.map((d) => Number(d.pollSeconds) || 60)));
    rec.pollTimer = setInterval(() => {
      if (st.open && rec.visible) fetchModuleData(rec.manifest.slug, false);
    }, minSec * 1000);
  }

  function stopPoll(rec) {
    if (rec.pollTimer) {
      clearInterval(rec.pollTimer);
      rec.pollTimer = null;
    }
  }

  function registerOne(summary) {
    const m = summary.manifest;
    if (!m || !m.slug) return;
    const slug = m.slug;
    const id = `custom:${slug}`;
    const prev = registry.get(slug);
    const rec = prev || {
      data: {},
      errors: {},
      updatedAt: 0,
      loading: false,
      pollTimer: null,
      visible: false,
      cards: new Set(),
      pages: new Set(),
    };
    rec.manifest = m;
    rec.state = summary.state || {};
    rec.config = summary.config || {};
    rec.approvedDomains = summary.approvedDomains || [];
    rec.missingDomains = summary.missingDomains || [];
    registry.set(slug, rec);

    N.register({
      id,
      custom: true,
      tall: m.defaultSize === '1x2' || m.defaultSize === '2x2',
      init(page) {
        page.classList.add('cm-page');
        rec.pages.add(page);
        renderInto(page, rec, 'expanded');
      },
      show() {
        rec.visible = true;
        rerenderRecord(rec);
        fetchModuleData(slug, false);
        startPoll(rec);
      },
      hide() {
        rec.visible = false;
        stopPoll(rec);
      },
      card(cardEl, size) {
        cardEl.classList.add('cm-card');
        cardEl.dataset.cmSize = size || 'm';
        rec.cards.add(cardEl);
        renderInto(cardEl, rec, 'compact');
        if (!rec.updatedAt && (rec.manifest.dataSources || []).length && !rec.missingDomains.length) {
          queueMicrotask(() => fetchModuleData(slug, false));
        }
        cardEl.setAttribute('role', 'button');
        cardEl.setAttribute('tabindex', '0');
        cardEl.onclick = (e) => {
          if (e.target && e.target.closest('button, a, input, form')) return;
          if (typeof N.openModule === 'function') N.openModule(id);
        };
      },
    });
    rerenderRecord(rec);
  }

  async function loadCustomModules(evt) {
    if (!api || typeof api.svc !== 'function') return;
    let res;
    try {
      res = await api.svc('custommod', 'list');
    } catch (e) {
      console.error('custommod.list', e);
      return;
    }
    const list = (res && res.ok && Array.isArray(res.modules)) ? res.modules : [];
    const nextSlugs = new Set(list.map((x) => x.slug));

    let structureChanged = false;
    for (const [slug, rec] of Array.from(registry.entries())) {
      if (!nextSlugs.has(slug)) {
        stopPoll(rec);
        registry.delete(slug);
        if (typeof N.unregister === 'function') N.unregister(`custom:${slug}`);
        structureChanged = true;
      }
    }
    for (const item of list) {
      if (!registry.has(item.slug)) structureChanged = true;
      registerOne(item);
    }
    if (structureChanged || (evt && (evt.reason === 'created' || evt.reason === 'updated' || evt.reason === 'deleted'))) {
      if (N.carousel && typeof N.carousel.rebuild === 'function') N.carousel.rebuild();
    }
    if (evt && evt.slug && (evt.reason === 'created' || evt.reason === 'updated' || evt.reason === 'permissions' || evt.reason === 'config')) {
      const rec = registry.get(evt.slug);
      if (rec) {
        fetchModuleData(evt.slug, true);
        if (evt.reason === 'created' && st.open && typeof N.toast === 'function') {
          N.toast(iconSvg(rec.manifest.icon, 'width:13px;height:13px'), `${_t('Custom module ready')}: ${rec.manifest.name}`, { ms: 3200 });
        }
      }
    }
  }

  // Expose metadata helpers for carousel.js (modLabel, modIcon, packCards defaultSize)
  N.loadCustomModules = loadCustomModules;
  N.customModMeta = (id) => {
    const slug = typeof id === 'string' && id.startsWith('custom:') ? id.slice(7) : '';
    const rec = slug ? registry.get(slug) : null;
    return rec ? rec.manifest : null;
  };
  N.customModIcon = (id, style) => {
    const m = N.customModMeta(id);
    return iconSvg(m ? m.icon : 'Boxes', style);
  };
  N.customModDefaultSizes = () => {
    const out = {};
    for (const [slug, rec] of registry.entries()) {
      out[`custom:${slug}`] = rec.manifest.defaultSize || '2x1';
    }
    return out;
  };

  if (api && typeof api.on === 'function') {
    api.on('custommod:changed', (evt) => {
      loadCustomModules(evt || {});
    });
  }
})();
