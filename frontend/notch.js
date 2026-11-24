/* global ICONS, MODULE_ICONS, MODULE_TITLES, fa */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = window.notch;
const notchEl = $('#notch');
const bubbleEl = $('#bubble');

// Real spring curve from NotchKit.springCurve() when CSS linear() is supported; smooth fallback under reduced motion.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function applySpringCurve() {
  const root = document.documentElement.style;
  if (reducedMotion.matches) {
    root.setProperty('--spring', 'var(--smooth)');
    root.setProperty('--spring-dur', '0.2s');
    return;
  }
  if (window.NotchKit && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)')) {
    const sp = NotchKit.springCurve();
    root.setProperty('--spring', sp.css);
    root.setProperty('--spring-dur', sp.dur + 's');
  } else {
    root.setProperty('--spring', 'cubic-bezier(0.34, 1.2, 0.5, 1)');
    root.setProperty('--spring-dur', '0.55s');
  }
}
applySpringCurve();
if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', applySpringCurve);

const meterLevel = (pct, inverse) => (window.NotchKit ? NotchKit.meterLevel(pct, inverse) : 1);
const meter = (pct, inverse) => (window.NotchKit ? NotchKit.meter(pct, inverse) : 'var(--m1)');
function ring(pct, col, size, sw, inner = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${50 - sw}" fill="none" stroke="#1e1e25" stroke-width="${sw}"/><circle cx="50" cy="50" r="${50 - sw}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" pathLength="100" stroke-dasharray="${p} 100"/></svg>${inner ? `<div>${inner}</div>` : ''}</div>`;
}
function appIconImg(src, size = 20, radius, fallback) {
  const r = radius == null ? Math.round(size * 0.25 * 2) / 2 : radius;
  const fb = fallback || fa('music');
  const fs = Math.max(8, Math.round(size * 0.52));
  const box = `width:${size}px;height:${size}px;border-radius:${r}px`;
  if (!src) return `<span class="appic appic-fb" style="${box};font-size:${fs}px">${fb}</span>`;
  return `<span class="appic-box" style="${box}"><img class="appic" src="${esc(src)}" alt="" style="${box}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="appic appic-fb" style="${box};font-size:${fs}px;display:none">${fb}</span></span>`;
}

// Cache of real macOS app icons fetched via notch.appIcon(bundleId) for coding agents (HITL cards).
const agentIconCache = new Map();
function agentIconUrl(agentName) {
  const bid = window.NotchKit ? NotchKit.agentBundle(agentName || '') : 'com.apple.Terminal';
  if (agentIconCache.has(bid)) return agentIconCache.get(bid);
  agentIconCache.set(bid, null);
  if (api.appIcon) {
    api.appIcon(bid).then((url) => {
      agentIconCache.set(bid, url || null);
      if (url && claudeShowing()) {
        const box = $('.claude-stack', notchEl);
        if (box) delete box.dataset.sig;
        renderClosed();
        layout();
      }
      if (url && typeof refreshHitlCards === 'function') refreshHitlCards();
    }).catch(() => {});
  }
  return null;
}

const st = {
  settings: null,
  open: false,
  tab: 'home',
  page: 'home',          // what's actually shown (a tab, or 'drop' / 'snap')
  hover: false,
  dragging: false,
  typing: false,
  openedByShortcut: false,
  keyOpen: false,        // opened with the shortcut (← / → switch tabs without the mouse on it)
  media: { active: false },
  mediaAt: 0,
  volume: null,
  brightness: null,
  lockKeys: null,        // { caps, num, scroll } toggle states from main
  inputLang: null,       // { code, name, count } the keyboard language of the window in front, from main
  power: null,
  bluetooth: null,
  pomodoro: null,
  activity: null,        // temporary live activity { kind, until, data }
  rotIdx: 0,
  bubbleSwap: false,     // user clicked the split bubble to swap main and bubble activities
  below: null,           // under-camera alert row dimensions { extra, wide }
  peekUntil: 0,
  notifs: [],          // Windows notifications on screen, newest first: { …from main, until }
  notifUnseen: 0,      // history items since the history was last opened (the bell's badge)
  events: [],
  calErrors: {},
  selDay: startOfDay(Date.now()),
  remindedIds: new Set(),
  shelf: [],
  selected: new Set(),
  seeking: false,
  ctxOpen: false,
  snap: null,            // { hwnd, layouts } while a window is being dragged
  snapLayout: null,
  dragKinds: [],
  shell: 'pill',         // single shell state from NotchKit.shellState()
  fg: 'normal',          // foreground window state ('normal'|'max'|'full') from shell:fg
  summoned: false,       // hidden-form summon state (idle notch shown until timeout or mouse leave)
  devShell: null,        // dev-only override when SYMPONY_SHELL_DEV=1
  voice: { state: 'idle', since: 0, lang: 'ID', partial: '', prevPartial: '', text: '', error: '', action: null, rms: [] },
};

const timers = {};
function later(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }
function cancel(name) { clearTimeout(timers[name]); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ================================================================== module registry
const modules = new Map(); // id -> { id, tall, init(page), show(), hide(), onSettings(s), built }
const BUILTIN = { home: { id: 'home', builtin: true }, shelf: { id: 'shelf', builtin: true }, stats: { id: 'stats', builtin: true }, hitl: { id: 'hitl', builtin: true } };
// On a Mac (main says the system: SYMPONY_OS) the tab that needs Windows stays out: Screen Time. (Control shows
// only what works there: the volume, the sound devices, the mic and eye breaks; Bluetooth & Wi-Fi is the Speed test
// alone, named so: modules/bluetooth.js, icons.js.) On Linux (phase 1) Screen Time and the Radio (no player of its own
// there yet) stay out; System stays (main reads the PC's numbers there), Control and Bluetooth & Wi-Fi are as on a Mac.
const MAC = window.SYMPONY_OS === 'macos';
const LINUX = window.SYMPONY_OS === 'linux';
const MAC_TABS_OFF = []; // (System and Screen Time: Sympony reads the Mac's numbers, watchers.rs / everyday.rs)
const LINUX_TABS_OFF = ['screentime', 'radio'];
function register(mod) { modules.set(mod.id, mod); }
function moduleOf(id) { return modules.get(id) || BUILTIN[id]; }
function moduleEnabled(id) {
  const s = st.settings;
  if (MAC && MAC_TABS_OFF.includes(id)) return false;
  if (LINUX && LINUX_TABS_OFF.includes(id)) return false;
  if (id === 'shelf' && !s.shelfEnabled) return false;
  if (id === 'stats' && !s.statsEnabled) return false;
  // the Prayer Times tab only while prayer times are on (Settings → Prayer Times)
  if (id === 'prayer' && !s.prayerEnabled) return false;
  // the AI usage tab only while one of its services is on (Settings → AI usage)
  if (id === 'aiusage' && !(s.aiUsageClaude || s.aiUsageCodex)) return false;
  const m = (s.modules || []).find((x) => x.id === id);
  return !!(m && m.on && moduleOf(id));
}
function enabledTabs() { return (st.settings.modules || []).map((m) => m.id).filter(moduleEnabled); }

function buildTabs() {
  if (window.N && N.carousel) N.carousel.rebuild();
  renderShelfBadge();
}

function ensurePage(id) {
  const mod = modules.get(id);
  if (!mod) return $('#page-' + id);
  let page = $('#page-' + id);
  if (!page) {
    page = document.createElement('section');
    page.className = 'tab-page mod-page';
    page.id = 'page-' + id;
    ($('#pageVault') || $('#open')).appendChild(page);
  }
  if (!mod.built) { mod.built = true; try { mod.init(page); } catch (e) { console.error(id, e); } }
  return page;
}

// ================================================================== static icons
function paintIcons() {
  $$('.battery-bolt').forEach((b) => { b.innerHTML = ICONS.bolt; });
  $('#btnPrev').innerHTML = ICONS.prev;
  $('#btnNext').innerHTML = ICONS.next;
  $('#btnPlay').innerHTML = ICONS.play;
  $('#btnShuffle').innerHTML = ICONS.shuffle;
  $('#btnRepeat').innerHTML = ICONS.repeat;
  $('#btnLyrics').innerHTML = fa('quote-left');
  $('#artFallback').innerHTML = ICONS.music;
  $('#calAdd').innerHTML = ICONS.plus;
  $('.mirror-icon').innerHTML = ICONS.video;
  $$('.drop-icon').forEach((e) => { e.innerHTML = ICONS.tray; });
  $('.share-icon').innerHTML = ICONS.share;
  $('#shelfAdd').innerHTML = ICONS.plus;
  $('#shelfClear').innerHTML = ICONS.trash;
  $('#statCpu .stat-ico').innerHTML = ICONS.cpu;
  $('#statMem .stat-ico').innerHTML = ICONS.memory;
  $('#statNet .stat-ico').innerHTML = ICONS.net;
  $('#statDisk .stat-ico').innerHTML = ICONS.disk;
  $('#statTemp .stat-ico').innerHTML = fa('temperature-half');
}

// ================================================================== layout / sizing
function effectiveSizes(s = st.settings) {
  const cfg = s || {};
  const disp = st.display || {};
  const cam = gapSetting() > 0 ? null : st.cam;
  const fallbackW = (typeof screen !== 'undefined' && screen.width) ? screen.width : 1512;
  const fallbackH = (typeof screen !== 'undefined' && screen.height) ? screen.height : 982;
  if (window.NotchKit && typeof NotchKit.displayNotchSizes === 'function') {
    return NotchKit.displayNotchSizes({
      settings: cfg,
      displayW: disp.w || fallbackW,
      displayH: disp.h || fallbackH,
      camW: cam ? cam.w : 0,
      camH: cam ? cam.h : 0,
    });
  }
  return {
    mode: cfg.notchSizeMode === 'custom' ? 'custom' : 'auto',
    notchWidth: Number(cfg.notchWidth) || 200,
    notchHeight: Number(cfg.notchHeight) || 32,
    expandedWidth: Number(cfg.expandedWidth) || 660,
    expandedHeight: Number(cfg.expandedHeight) || 196,
    expandedHeightTall: Number(cfg.expandedHeightTall) || 268,
  };
}

function closedHeight() {
  const h = effectiveSizes().notchHeight;
  const cam = camera();
  return cam ? Math.max(h, Math.ceil(cam.h)) : h;
}

// A MacBook's camera notch: main says where it is in this window (notch:camera, macOS). While Sympony hangs from the top
// edge over it, Sympony takes the camera's middle and is at least as tall: the part over the camera stays empty and
// black, what Sympony shows goes to the sides of it (the time too), and the open notch's top bar keeps it free.
// macOS auxiliaryTopLeftArea..auxiliaryTopRightArea already includes horizontal buffer around the physical camera.
const CAM_MARGIN = 0;
function camera() { return gapSetting() > 0 ? null : camNear(); }
// the camera, when Sympony (where main puts its middle) would be over it at all
function camNear() {
  const c = st.cam;
  if (!c) return null;
  const want = st.anchor == null ? window.innerWidth / 2 : st.anchor;
  return Math.abs(want - c.x) < c.w / 2 + effectiveSizes().notchWidth / 2 ? c : null;
}
function onDisplay(d) {
  st.display = d && d.w > 0 && d.h > 0 ? d : null;
  renderClosed(); layout();
}
function onCamera(c) {
  st.cam = c && c.w > 0 && c.h > 0 ? c : null;
  notchEl.style.setProperty('--cam-w', st.cam ? Math.round(st.cam.w + CAM_MARGIN * 2) + 'px' : '0px');
  notchEl.style.setProperty('--cam-h', st.cam ? Math.ceil(st.cam.h) + 'px' : '0px');
  renderClosed(); layout();
}
api.on('notch:camera', onCamera);
if (api.onNotchDisplay) api.onNotchDisplay(onDisplay);

function isTall(page) {
  const m = modules.get(page);
  return !!(m && m.tall);
}

function isWinShell() {
  if (st.devShell && typeof st.devShell.win === 'boolean') return st.devShell.win;
  return !MAC && !LINUX;
}
function shellFormOf() {
  if (st.devShell && st.devShell.form) return st.devShell.form;
  const raw = (st.settings && st.settings.shellForm) || 'notch';
  if (!isWinShell() && (raw === 'island' || raw === 'drawer')) return 'notch';
  return ['notch', 'island', 'drawer', 'hidden'].includes(raw) ? raw : 'notch';
}
function reserveTopOf() {
  if (st.devShell && typeof st.devShell.reserveTop === 'boolean') return st.devShell.reserveTop;
  return !!(st.settings && st.settings.reserveTop);
}
function fgStateOf() {
  if (st.devShell && st.devShell.fg) return st.devShell.fg;
  return st.fg || 'normal';
}
function hasShellAlert() {
  if (st.open) return false;
  const now = Date.now();
  return !!(voiceActive() || feedSumActive() || st.hudOnly || notifShowing() || claudeShowing() || st.adhan || teleStrip()
    || (st.below && st.below.extra > 0)
    || (st.activity && st.activity.until > now)
    || now < st.peekUntil || now < (st.islandUntil || 0));
}
function dismissSummon() {
  if (!st.summoned) return;
  st.summoned = false;
  cancel('summon');
  renderClosed(true);
  layout();
}
if (api.onShellFg) {
  api.onShellFg((d) => {
    st.fg = (d && d.state) || 'normal';
    renderClosed(true);
    layout();
  });
}

function layout() {
  const s = st.settings;
  if (!s) return;
  let w; let h; let r; let ear;
  const winShell = isWinShell();
  const form = shellFormOf();
  const fg = fgStateOf();
  const formCls = form === 'island' ? 'f-island' : form === 'drawer' ? 'f-drawer' : 'f-top';
  const islandAnchor = (s.islandAnchor || 'bottom');
  const drawerLeft = s.drawerEdge === 'left';
  notchEl.classList.toggle('f-top', formCls === 'f-top');
  notchEl.classList.toggle('f-island', formCls === 'f-island');
  notchEl.classList.toggle('f-drawer', formCls === 'f-drawer');
  notchEl.classList.toggle('isl-top', formCls === 'f-island' && islandAnchor === 'top');
  notchEl.classList.toggle('isl-br', formCls === 'f-island' && islandAnchor === 'bottom-right');
  notchEl.classList.toggle('drawer-left', formCls === 'f-drawer' && drawerLeft);

  const ch = formCls === 'f-island' ? Math.max(36, closedHeight()) : closedHeight();
  const cam = (winShell || formCls !== 'f-top') ? null : camera();
  notchEl.classList.toggle('cam', !!cam);
  const under = lyricsUnder(); // the line being sung, under the closed notch
  notchEl.classList.toggle('lyrics-under', under);
  // …or inside it, in place of the time; with a second line it's a little taller, like a pill
  const inline = lyricsInline(); const two = inline && !!inlineSecond();
  notchEl.classList.toggle('lyrics-inline', inline);
  notchEl.classList.toggle('lyrics-two', two);
  // the lyrics' size and weight (Settings → Media), for the CSS and the heights below
  const lf = lyricFonts();
  notchEl.style.setProperty('--ly-fs', lf.one + 'px'); notchEl.style.setProperty('--ly-fs2', lf.two + 'px');
  notchEl.style.setProperty('--ly-fs-sub', lf.sub + 'px'); notchEl.style.setProperty('--ly-fw', lf.w1); notchEl.style.setProperty('--ly-fw2', lf.w2);
  paintInline(inline);
  // the usual heights, unless Large lyrics need a little more
  const rowH = two ? Math.max(ch + 12, 42, Math.ceil((lf.two + lf.sub) * 1.34) + 6) : inline ? Math.max(ch, Math.ceil(lf.one * 1.34) + 4) : ch;
  notchEl.style.setProperty('--closed-h', rowH + 'px');
  notchEl.style.setProperty('--clock-fs', clockFont() + 'px'); // the time's size (Settings → General → Clock size)
  // the romanization / translation under the strip's line (not while the strip shows the song's title)
  const lineUnder = under && Date.now() >= st.peekUntil;
  const extraUnder = lineUnder && lyr.hasEx;
  notchEl.classList.toggle('lyrics-line', lineUnder);
  notchEl.classList.toggle('lyrics-extra', extraUnder);
  // With a gap from the top edge the notch floats below it: a pill, rounded all round, without the ears
  const gap = formCls === 'f-top' ? topGap() : 0;
  const floating = formCls === 'f-island' || gap > 0;
  notchEl.classList.toggle('floating', formCls === 'f-top' && gap > 0);
  notchEl.style.setProperty('--gap', gap + 'px');
  const ts = teleStrip();
  notchEl.classList.toggle('tele-on', ts);

  // Single shell state from NotchKit.shellState() (spec §9)
  const shell = window.NotchKit ? NotchKit.shellState({
    alert: hasShellAlert(),
    open: !!st.open,
    summoned: !!st.summoned,
    form,
    fg,
    win: winShell,
    reserveTop: reserveTopOf(),
    hideInFullscreen: s.hideInFullscreen !== false,
    autoHidden: autoHidden(),
    tucked: !!st.tucked,
    stepAside: steppedAside(),
  }) : (st.open ? 'open' : 'pill');
  st.shell = shell;

  const sz = effectiveSizes(s);
  let tiny = false;
  if (shell === 'open') {
    const maxW = window.innerWidth - 40;
    w = (window.N && N.carousel && N.carousel.width) ? N.carousel.width(maxW) : Math.min(sz.expandedWidth, maxW);
    if (window.N && N.carousel) N.carousel.syncWidth(w);
    // (room under it for its shadow, ~50 px, and a haptic bump: wm.rs WIN_H)
    const maxH = window.innerHeight - 70 - gap;
    h = (window.N && N.carousel) ? N.carousel.height(maxH) : Math.min(isTall(st.page) ? sz.expandedHeightTall : sz.expandedHeight, maxH);
    const topInset = cam ? Math.max(40, Math.ceil(cam.h) + 4) : 40;
    const botInset = h <= 148 ? 10 : 14;
    const stageH = Math.max(60, h - topInset - botInset);
    r = formCls === 'f-top' ? Math.min(38, Math.max(20, Math.round(h * 0.16))) : 24;
    ear = (formCls === 'f-top' && !floating) ? Math.min(22, Math.max(14, Math.round(r * 0.6))) : 0;
    notchEl.style.setProperty('--stage-top', topInset + 'px');
    notchEl.style.setProperty('--open-h', h + 'px');
    notchEl.style.setProperty('--stage-h', stageH + 'px');
  } else if (shell === 'handle') {
    w = 5; h = 64; r = 3; ear = 0; tiny = true;
  } else if (shell === 'tuck') {
    w = 120; h = 5; r = 3; ear = 0; tiny = true;
  } else if (ts) {
    // the Teleprompter reading: the closed notch grows into its strip, right under the camera (modules/teleprompter.js)
    const t = N.tele.size();
    w = Math.min(t.w, window.innerWidth - 40); h = Math.min(t.h, window.innerHeight - 70 - gap);
    r = 26; ear = (formCls === 'f-top' && !floating) ? 18 : 0;
  } else {
    const act = currentActivity();
    const side = closedSide(act);
    let camRes = null;
    if (cam) {
      camRes = camLayoutFor(act, side, cam);
      w = camRes.width;
      st.camClockOk = camRes.showClock;
    } else {
      st.camClockOk = true;
      w = closedWidthFlat(act, side);
    }
    notchEl.classList.toggle('cam-tight', !!cam && !side && !(camRes && camRes.showClock) && !ponyIdleOn());
    h = rowH;
    // under-camera alert row (#below: prayer, device/charging, meeting, toast/todo alerts)
    const belowExtra = st.below && st.below.extra ? st.below.extra : 0;
    const belowWide = st.below && st.below.wide ? st.below.wide : 0;
    notchEl.style.setProperty('--below-h', belowExtra + 'px');
    if (belowExtra) { h += belowExtra; w = Math.max(w, belowWide); }
    // the title peek after a song change, or the lyrics line, in a strip under the closed notch
    const strip = !st.hudOnly && !belowExtra && (Date.now() < st.peekUntil || under);
    const stripH = extraUnder ? Math.max(36, Math.ceil((lf.one + lf.sub) * 1.34) + 5) : lineUnder ? Math.max(24, Math.ceil(lf.one * 1.34) + 6) : 24;
    if (strip) h += stripH;
    const island = !st.hudOnly && !belowExtra && Date.now() < (st.islandUntil || 0);
    if (island) { h += ISLAND_H; w = Math.max(w, ISLAND_W); }
    notchEl.style.setProperty('--strip-h', stripH + 'px');
    notchEl.style.setProperty('--peek-h', strip ? stripH + 'px' : '0px'); // the notifications go below it
    const underW = under ? lyricsWidth() : 0;
    if (underW) w = Math.max(w, Math.min(underW, sz.notchWidth + 300));
    // inside: room for the song's widest line between the art and the visualizer, within limits; with Long
    // lines inside → scroll, only for about the notch's own width + 120 px of text (longer lines scroll)
    notchEl.style.setProperty('--lyr-side', side + 8 + 'px');
    const textW = inline ? (s.lyricsLongLines === 'scroll' ? Math.min(inlineWidth(), sz.notchWidth + 120) : inlineWidth()) : 0;
    if (inline) w = Math.max(w, Math.min(textW + (side + 8) * 2 + 4, sz.notchWidth + 340, window.innerWidth - 80));
    if (act && act.kind.startsWith('hud') && s.hudStyle === 'panel') { h += 34; w = Math.max(w, sz.notchWidth + 140); }
    const rows = todoPanelRows();
    if (rows) { h += rows * 20 + 8; w = Math.max(w, sz.notchWidth + 220); }
    notchEl.style.setProperty('--todo-panel-h', (rows ? rows * 20 + 8 : 0) + 'px'); // the track-title peek goes below it
    // Claude Code's card under that (the notifications go below it)
    const ccH = claudeHeight();
    notchEl.style.setProperty('--claude-h', ccH + 'px');
    if (ccH) {
      const maxClosedH = Math.max(rowH + 120, window.innerHeight - gap - 14);
      h = Math.min(maxClosedH, h + ccH + 6);
      w = Math.max(w, 520, sz.notchWidth + 280);
    }
    // Windows notifications: a stack of cards under all of that
    if (notifShowing()) { h += notifStackHeight(); w = Math.max(w, 440, sz.notchWidth + 240); }
    // the song's progress line (Settings → Media) stays right under the music: its row, or the lyrics line in the
    // strip under it; whatever stretches Sympony further down (notifications…) goes below the line
    const musicH = rowH + (strip ? (rows ? rows * 20 + 8 : 0) + stripH : 0);
    progTop = h > musicH + 1 ? musicH - 2 : -1;
    // the room the lines inside end up with: a longer one may scroll
    inlineAvail = inline ? w - (side + 8) * 2 : 0;
    if (inline) inlineMarquee();
    const expandedClosed = belowExtra > 0 || h > rowH;
    r = formCls === 'f-island' ? (expandedClosed ? 26 : 18) : floating ? Math.round(rowH / 2) : expandedClosed ? 26 : 16;
    ear = (formCls === 'f-top' && !floating) ? (expandedClosed ? 18 : 14) : 0;
    if (cam && camRes) {
      notchEl.style.setProperty('--clock-l', camRes.clockL + 'px');
      notchEl.style.setProperty('--clock-w', camRes.clockW + 'px');
      const clockEl = $('#idleClock');
      if (clockEl && !camRes.showClock && clockEl.classList.contains('show')) {
        clockEl.classList.remove('show');
        clockKey = '';
      }
    }
  }
  if (shell === 'open' || shell === 'tuck' || shell === 'handle' || shell === 'hidden' || ts) progTop = -1;

  // Horizontal position: main tells us where the notch centre should be (it can be dragged along the
  // top edge); clamp so the current size always stays inside the window.
  const want = cam ? cam.x : st.anchor == null ? window.innerWidth / 2 : st.anchor;
  const left = Math.round(Math.max(w / 2 + ear + 2, Math.min(window.innerWidth - w / 2 - ear - 2, want)));
  if (formCls === 'f-drawer' || (formCls === 'f-island' && islandAnchor === 'bottom-right')) {
    notchEl.style.removeProperty('left');
  } else {
    notchEl.style.left = left + 'px';
  }
  notchEl.style.setProperty('--w', w + 'px');
  notchEl.style.setProperty('--h', h + 'px');
  notchEl.style.setProperty('--r', r + 'px');
  notchEl.style.setProperty('--ear', ear + 'px');

  const aside = shell === 'aside';
  const tucked = shell === 'tuck' && !!st.tucked;
  const gone = shell === 'hidden';
  const hidden = aside || shell === 'tuck' || gone;
  notchEl.classList.toggle('tiny', tiny);
  notchEl.classList.toggle('gone', gone);
  notchEl.classList.toggle('autohidden', aside);
  notchEl.classList.toggle('aside', aside);
  notchEl.classList.toggle('tucked', tucked);

  // Split bubble: second persistent activity melts off to the right of the closed notch / island
  const bbAct = bubbleActivity();
  const showBb = !!bbAct && (shell === 'pill' || shell === 'summoned') && !ts && !st.hudOnly && !(st.below && st.below.extra) && !notifShowing() && !claudeShowing() && formCls !== 'f-drawer';
  const bbLeft = Math.round(Math.min(window.innerWidth - 38, left + w / 2 + 6));
  if (bubbleEl) {
    bubbleEl.classList.toggle('show', showBb);
    bubbleEl.classList.toggle('floating', formCls === 'f-top' && gap > 0);
    bubbleEl.classList.toggle('isl', formCls === 'f-island');
    bubbleEl.classList.toggle('isl-top', formCls === 'f-island' && islandAnchor === 'top');
    bubbleEl.style.left = bbLeft + 'px';
    if (formCls === 'f-island') bubbleEl.style.removeProperty('top');
    else bubbleEl.style.top = gap + 'px';
    bubbleEl.setAttribute('aria-hidden', showBb ? 'false' : 'true');
  }

  st.box = { left: left - w / 2, right: left + w / 2, bottom: hidden ? (tucked ? 10 : 5) : gap + h, w, h };
  const reach = autoHideOn() || stepAsideOn() ? 0 : gap;
  const edge = asideMode() && !st.hover;
  let hit;
  if (gone) {
    // Hidden form: nothing on screen; fullscreen smart-notch: thin 2 px top wake strip
    hit = (form !== 'hidden' && formCls === 'f-top') ? { x: left - 180, y: 0, w: 360, h: 2 } : { x: 0, y: 0, w: 0, h: 0 };
  } else if (formCls === 'f-drawer') {
    const dy = Math.round((window.innerHeight - h) / 2);
    const dw = shell === 'handle' ? 12 : w;
    hit = { x: drawerLeft ? 0 : window.innerWidth - dw, y: dy, w: dw, h };
  } else if (formCls === 'f-island') {
    const iy = islandAnchor === 'top' ? 10 : window.innerHeight - 60 - h;
    const ix = islandAnchor === 'bottom-right' ? window.innerWidth - 16 - w : left - w / 2;
    hit = { x: ix, y: iy, w, h };
  } else if (shell === 'open') {
    hit = { x: left - w / 2 - ear, y: reach, w: w + ear * 2, h: gap - reach + h + 4 };
  } else if (edge) {
    hit = { x: left - w / 2 + 2, y: 0, w: Math.max(0, w - 4), h: 2 };
  } else if (shell === 'tuck' || aside) {
    hit = { x: left - w / 2 - 20, y: 0, w: w + 40, h: tucked ? 14 : 8 };
  } else {
    hit = { x: left - w / 2 + 2, y: reach, w: Math.max(0, w - 4), h: Math.max(0, gap - reach + h - 2) };
  }
  const bbY = formCls === 'f-island' ? (islandAnchor === 'top' ? 10 : window.innerHeight - 96) : gap;
  const bbRect = showBb ? { x: bbLeft, y: bbY, w: formCls === 'f-island' ? 36 : 34, h: formCls === 'f-island' ? 36 : 32 } : null;

  // Separate menu notch (#pill): 8 px below the open main notch; included in hit-test/vis ONLY while shown
  const pillEl = $('#pill');
  const pillShown = !!(shell === 'open' && window.N && N.carousel && N.carousel.pillShown && N.carousel.pillShown());
  let pillRect = null;
  let pillBridge = null;
  if (pillEl) {
    pillEl.style.setProperty('--pill-max-w', w + 'px');
    let pLeft = left;
    let pTop = gap + h + 8;
    let above = false;
    if (formCls === 'f-island') {
      const iy = islandAnchor === 'top' ? 10 : window.innerHeight - 60 - h;
      const ix = islandAnchor === 'bottom-right' ? window.innerWidth - 16 - w : left - w / 2;
      pLeft = Math.round(ix + w / 2);
      if (islandAnchor === 'top') {
        pTop = iy + h + 8;
      } else {
        above = true;
        pTop = Math.max(8, iy - 48);
      }
    } else if (formCls === 'f-drawer') {
      const dy = Math.round((window.innerHeight - h) / 2);
      pLeft = drawerLeft ? Math.round(w / 2) : Math.round(window.innerWidth - w / 2);
      pTop = Math.min(window.innerHeight - 46, dy + h + 8);
    }
    pillEl.classList.toggle('above', above);
    pillEl.style.left = pLeft + 'px';
    pillEl.style.top = pTop + 'px';
    if (pillShown) {
      const pw = Math.min(w, pillEl.offsetWidth || w);
      const ph = pillEl.offsetHeight || 40;
      const px = Math.round(pLeft - pw / 2);
      pillRect = { x: px - 4, y: pTop - 2, w: pw + 8, h: ph + 4 };
      pillBridge = above
        ? { x: pLeft - w / 2, y: pTop + ph, w, h: 10 }
        : { x: pLeft - w / 2, y: pTop - 10, w, h: 12 };
    }
  }

  const vis = gone ? [] : [shell === 'open' ? { x: hit.x, y: Math.max(0, hit.y), w: hit.w, h: hit.h }
    : ts ? { x: hit.x - 36, y: Math.max(0, hit.y), w: hit.w + 72, h: hit.h + 46 }
    : (shell === 'tuck' || aside || shell === 'handle') ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h + 8 }
    : { x: hit.x - ear - 2, y: hit.y, w: hit.w + ear * 2 + 4, h: hit.h + 12 }];

  // Pony peek host under the closed notch: included in hit & vis ONLY while shown
  const peekEl = $('#ponyPeek');
  let peekRect = null;
  if (peekEl) {
    if (ponyPeekShown && canPonyPeek()) {
      const pTop = gap + h - 24;
      peekEl.style.left = left + 'px';
      peekEl.style.top = pTop + 'px';
      peekRect = { x: left - 38, y: gap + h - 4, w: 76, h: 38 };
      hit = { ...hit, h: Math.max(hit.h, (gap + h + 34) - hit.y) };
    } else if (ponyPeekShown) {
      hidePonyPeek(true);
    }
  }
  if (peekRect) vis.push(peekRect);
  if (pillBridge) vis.push(pillBridge);
  if (pillRect) vis.push(pillRect);
  const devBar = window.SYMPONY_SHELL_DEV ? $('#shellDevBar') : null;
  const devRect = devBar ? devBar.getBoundingClientRect() : null;
  if (devRect && devRect.width > 0) vis.push({ x: devRect.left, y: devRect.top, w: devRect.width, h: devRect.height });
  if (bbRect) vis.push(bbRect);
  if (outline.vis.length) vis.push(...outline.vis);
  const round = (rc) => ({ x: Math.round(rc.x), y: Math.round(rc.y), w: Math.round(rc.w), h: Math.round(rc.h) });
  const near = asideMode() ? round({ x: left - w / 2 - ear - 6, y: 0, w: w + ear * 2 + 12, h: gap + h + 12 }) : null;
  const peekBand = canPonyPeek()
    ? round({ x: left - w / 2 - 40, y: gap + h - 10, w: w + 80, h: 70 })
    : null;
  st.hitMsg = { x: Math.round(hit.x), y: Math.round(hit.y), w: Math.round(hit.w), h: Math.round(hit.h),
    extra: bbRect ? round(bbRect) : null, vis: vis.map(round), strip: stripTint(artOpacity(inline), w, rowH, ear, left), near, near2: null, peek: peekBand };
  sendHit();
  paintProgress();
  syncArrows();
  outlineSync();
  if (typeof syncShellDevBar === 'function') syncShellDevBar();
}
// Settings → General → Gap from the top edge (CSS px; 0: attached to the edge), or the app’s own while main says
// an app with a gap of its own is on top of this display (Different gap for these apps)
function gapSetting() { const g = Number(st.gapApp != null ? st.gapApp : st.settings && st.settings.notchTopGap); return Number.isFinite(g) ? Math.max(0, Math.min(120, g)) : 0; }
// …counted from the bottom of a MacBook's camera notch when Sympony is over it, so a floating Sympony never hangs behind it
function topGap() { const g = gapSetting(); const c = g > 0 && camNear(); return c ? g + Math.ceil(c.h) : g; }
api.on('notch:topGap', (g) => { st.gapApp = g == null ? null : Number(g); layout(); });
api.on('notch:anchor', (a) => { st.anchor = a; layout(); });
// main: no input for a while (Settings → General → Come down when idle): an auto-hidden Sympony shows itself
api.on('notch:standby', (v) => { st.standby = !!v; renderClosed(true); layout(); });
// main: an app from Settings → General → "Auto-hide while these apps are in front" came to the front (or went)
api.on('notch:autohideApp', (v) => { st.autoHideApp = !!v; renderClosed(true); layout(); });

// Auto-hide is on: for good (Settings → General), or while one of the apps picked for it is in front
function autoHideOn() { const s = st.settings; return !!(s && (s.autoHide || st.autoHideApp)); }

function autoHidden() {
  const s = st.settings;
  if (!s || !autoHideOn() || st.open || st.hover || st.dragging || st.moving || st.snap || st.standby || st.adhan || st.hudOnly || st.typing || teleStrip()) return false;
  const now = Date.now();
  // stays down for a moment after the mouse leaves, and while an alert or a song title shows
  return now >= (st.hoverUntil || 0) && !feedSumActive() && !(st.activity && st.activity.until > now) && now >= st.peekUntil && now >= (st.islandUntil || 0) && !claudeShowing();
}

// Settings → General → Step aside, the other way round from Auto-hide: Sympony stays down with the time, and when the
// mouse comes to it from below (for a tab or a button under it) the closed notch slides up out of the way like an
// auto-hidden one; it comes back once the mouse has left its spot. The very top edge opens it, as with Auto-hide.
function stepAsideOn() { const s = st.settings; return !!(s && s.stepAside && !autoHideOn()); }
// It's at work: the closed notch takes the mouse only at the very top edge (layout). Not while it shows something to
// click (Windows notifications, the adhan's stop button, an alert with a check): that stays reachable as without it.
function asideMode() {
  if (!stepAsideOn() || st.open || st.tucked || st.dragging || st.moving || st.snap || st.hudOnly || teleStrip()) return false;
  return !(notifShowing() || claudeShowing() || st.adhan || (st.activity && st.activity.until > Date.now() && tickShowing()));
}
// …and it's slid up now: the mouse is in its spot (or left it a moment ago); alerts still show
function steppedAside() {
  if (!asideMode() || st.hover) return false;
  const now = Date.now();
  return (st.near || now < (st.asideUntil || 0)) && !(st.activity && st.activity.until > now);
}
// main: the mouse came into the notch's spot or left it (`near` in layout). It counts when it comes from elsewhere,
// not while it's on the notch after coming down from the top edge (asideHover).
api.on('notch:near', (v) => {
  st.nearIn = !!v;
  if (!v) { cancel('rearm'); if (st.near) { st.asideUntil = Date.now() + 600; later('aside', 620, layout); } }
  st.near = !!v && !st.hover;
  layout();
});
// The top edge brought Sympony down (hover), and it stays down while the mouse goes on down onto it and off it again.
// Still in its spot a moment later (gone along the top edge beside it, say), it steps aside again.
function asideHover(inside) {
  if (inside) { st.near = false; cancel('rearm'); return; }
  if (st.nearIn && stepAsideOn()) later('rearm', 700, () => { if (st.nearIn && !st.hover && !st.near) { st.near = true; layout(); } });
}

// ================================================================== look (black, glass, color)
let progTop = -1; // where the song's progress line goes (layout); -1: along the bottom edge, as it always was
function lookOf(s) {
  const raw = (s || st.settings || {}).notchLook;
  return raw === 'glass' || raw === 'color' ? raw : 'black';
}
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [28, 43, 77];
}
function applyLook(s) {
  const cfg = s || st.settings || {};
  const look = lookOf(cfg);
  if (window.Tint) Tint.wall(false);
  document.documentElement.dataset.look = look;
  const targets = [notchEl, bubbleEl, $('#pill'), $('#dockTip'), $('#catBubble')].filter(Boolean);
  for (const el of targets) el.dataset.look = look;
  if (look === 'color') {
    const col = /^#[0-9a-f]{6}$/i.test(cfg.notchColor || '') ? cfg.notchColor.toLowerCase() : '#1c2b4d';
    const rgb = hexToRgb(col);
    const light = window.Tint && typeof Tint.darkInk === 'function'
      ? Tint.darkInk(rgb)
      : (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.65;
    for (const el of targets) {
      el.style.setProperty('--notch-color', col);
      el.classList.toggle('look-light', light);
    }
  } else {
    for (const el of targets) {
      el.style.removeProperty('--notch-color');
      el.classList.remove('look-light');
    }
  }
  notchEl.style.removeProperty('--bg');
}
if (window.Tint) Tint.onChange((what) => { if (what === 'warm') paintAccent(); });
function sendHit() {
  if (!st.hitMsg) return;
  api.setHitRect({ ...st.hitMsg, frost: null });
}

function sideWidth(act) {
  switch (act.kind) {
    case 'music': return showMiniControls() ? 84 : 36;
    case 'hud-volume': case 'hud-brightness': case 'hud-lock': return st.settings.hudStyle === 'panel' ? 34 : 104;
    case 'hud-airplane': return st.settings.hudStyle === 'panel' ? 34 : 128;
    case 'hud-switch': return st.settings.hudStyle === 'panel' ? 34 : 112;
    case 'hud-lang': return st.settings.hudStyle === 'panel' ? 34 : langHudSide(act.data.text);
    case 'charging': case 'unplugged': case 'battery-low': return 84;
    case 'meeting': case 'event-soon': return 120;
    case 'pomodoro': return 74;
    case 'stopwatch': return 78;
    case 'timer': return 74;
    case 'adhan': return 96;
    case 'sys': return sysSide();
    case 'fps': return fpsSide();
    case 'todo-due': case 'todo-alert': return 110 + (todoTickable(act.data) ? 24 : 0) + (todoSnoozable(act.data) ? 24 : 0);
    case 'todo-sum': return 74;
    case 'prayer-soon': case 'prayer': return 84;
    case 'shelf': return 70;
    case 'toast': return ((act.data && act.data.side) || 120) + (act.data && act.data.tick ? 24 : 0);
    case 'brief': return 100;
    case 'tele': return teleSide();
    case 'voice': return 110;
    default: return 60;
  }
}
// Each side's width in the closed notch. The Caps Lock mark (Settings → HUD) sits at its left edge, the keyboard
// language's at its right: with something on the sides, both make room for the wider one (so the notch stays
// centred); with nothing there the Caps Lock mark fits as it is, the language's widens the middle (closedMid).
const CAPS_ROOM = 18;
function closedSide(act) {
  const base = act ? sideWidth(act) : idleSlots().side;
  // (the AI usage ring sits at the left edge too, beside the Caps Lock mark)
  const room = base > 0 ? Math.max((capsMarkShown() ? CAPS_ROOM : 0) + aiMarkRoom(), langMarkShown() ? langRoom() : 0) : 0;
  notchEl.style.setProperty('--mark-pad', room + 'px');
  return base + room;
}
function capsMarkShown() { return !!(st.settings && st.settings.capsLockMark && st.lockKeys && st.lockKeys.caps && !st.open && !st.hudOnly); }

// ================================================================== open / close
function openNotch(page) {
  // not while it's in over a fullscreen app for a HUD (the shortcut, a snap drag…): Sympony doesn't open over the app
  if (st.hudOnly) return;
  // the Teleprompter's strip makes way: it waits paused in the closed notch
  if (teleStrip()) N.tele.minimize();
  cancel('close'); cancel('open');
  if (page) showPage(page);
  if (st.open) { layout(); return; }
  st.open = true;
  notchEl.classList.remove('closing');
  notchEl.classList.add('open');
  api.setOpened(true);
  if (window.N && N.carousel) {
    N.carousel.renderTop();
    if (!N.carousel.isSpecial() && !N.carousel.fullModule()) {
      N.carousel.go(N.carousel.current(), { instant: true, silent: true });
    }
    if (N.carousel.onOpen) N.carousel.onOpen();
  }
  layout();
  renderOpenVoice();
  renderMusic(true);
  renderCalendar();
  if (typeof refreshStatsCards === 'function') refreshStatsCards();
  const active = window.N && N.carousel ? N.carousel.activeModule() : null;
  if (active) {
    callModule(active, 'show');
    if (active === 'stats') drawStats();
    if (active === 'hitl') renderHitlSection();
  }
}

function closeNotch() {
  cancel('close'); cancel('open'); cancel('summon');
  if (!st.open) return;
  if (st.typing) endTyping();
  st.open = false;
  st.summoned = false;
  st.openedByShortcut = false;
  st.keyOpen = false;
  st.previewing = false;
  hideCtx();
  notchEl.classList.add('closing');
  notchEl.classList.remove('open', 'dragging', 'on-share');
  api.setOpened(false);
  stopMirror();
  if (window.N && N.carousel) {
    if (N.carousel.hidePill) N.carousel.hidePill(true);
    if (N.carousel.hideDockTip) N.carousel.hideDockTip();
    const active = N.carousel.activeModule();
    if (active && N.carousel.viewMode() === 'modules') callModule(active, 'hide');
    N.carousel.setSpecial(null, true);
    N.carousel.closeFull(true);
    if (N.carousel.viewMode() !== 'modules' && !st.settings.rememberTab && !tabMemory.on()) {
      N.carousel.goTo(st.settings.defaultTab || 0, { instant: true, silent: true });
    }
  }
  renderClosed();
  layout();
}

// "Reopen on the last tab" (Settings → Modules → Default): the page you last picked is kept in localStorage.
const tabMemory = {
  on() { try { return localStorage.getItem('sympony.restoreTab') !== '0'; } catch (e) { return true; } },
  get() { try { return localStorage.getItem('sympony.lastPage') || localStorage.getItem('sympony.lastTab'); } catch (e) { return null; } },
  set(t) { try { localStorage.setItem('sympony.lastPage', String(t)); } catch (e) { /* ignore */ } },
};
function startTab() {
  const saved = tabMemory.on() ? tabMemory.get() : null;
  if (saved != null && /^\d+$/.test(saved)) return Number(saved);
  return (st.settings && st.settings.defaultTab) || 0;
}

function validTab(t) {
  const tabs = enabledTabs();
  return tabs.includes(t) ? t : (tabs[0] || 'home');
}

function callModule(id, fn, ...args) {
  const m = modules.get(id);
  if (!m) return;
  if (m.built && typeof m[fn] === 'function') { try { m[fn](...args); } catch (e) { console.error(id, fn, e); } }
  if ((fn === 'update' || fn === 'onMedia' || fn === 'onSettings') && typeof m.refreshCards === 'function') {
    try { m.refreshCards(...args); } catch (e) { console.error(id, 'refreshCards', e); }
  }
}

// Pages that take over the whole open notch (drop actions & window snap zones).
const SPECIAL_PAGES = ['drop', 'snap'];

// Shows a carousel page, a module section, or a special full-notch state.
function showPage(page, silent) {
  if (!window.N || !N.carousel) { st.page = page; return; }
  if (SPECIAL_PAGES.includes(page)) { N.carousel.setSpecial(page, silent); return; }
  if (typeof page === 'number' || /^\d+$/.test(String(page)) || String(page).startsWith('page-')) {
    N.carousel.goTo(page, { instant: !!silent, silent });
    return;
  }
  if (silent) {
    N.carousel.goTo(page, { instant: true, silent: true });
    return;
  }
  if (moduleOf(page)) { N.openModule(page); return; }
  N.carousel.goTo(page, { instant: !!silent, silent });
}
function setTab(tab) { showPage(tab); }

function navigate(dir) {
  if (!st.open || !window.N || !N.carousel) return;
  N.carousel.step(dir);
}

function bump() {
  if (!st.settings.haptics) return;
  notchEl.classList.remove('bump');
  void notchEl.offsetWidth;
  notchEl.classList.add('bump');
}

function scheduleClose() {
  if (st.open && !st.hover && !st.dragging && !st.ctxOpen && !st.seeking && !st.typing && !st.snap && !st.moving && !voiceActive()) {
    later('close', st.settings.closeDelay, closeNotch);
  }
}

api.onHover((inside) => {
  st.hover = inside;
  notchEl.classList.toggle('hovering', inside);
  asideHover(inside);
  if (inside) {
    cancel('close');
    cancel('summon');
    st.openedByShortcut = false;
    if (st.snap) { openNotch('snap'); return; }
    // with notifications showing, Sympony doesn't open on hover (their X and cards stay reachable); a click on the
    // notch opens it
    // (not while the adhan's stop button or a check button is there to be pressed, nor the Teleprompter's strip or its
    // paused pill: a click on that one brings the strip back)
    const overBubble = !!(bubbleEl && bubbleEl.matches(':hover'));
    const belowInteractive = !!$('#below.show button');
    if (!overBubble && !belowInteractive && !notifShowing() && !claudeShowing() && !st.adhan && !tickShowing() && !teleMode() && !st.open && !st.typing && st.settings.openOnHover && !st.moving && !st.tucked) later('open', Math.max(st.settings.hoverDelay, 60), () => { if (!st.moving && !st.typing && !(bubbleEl && bubbleEl.matches(':hover'))) openNotch(feedSumActive() ? 'feed' : undefined); });
    if (!st.open) { renderClosed(); layout(); }
  } else {
    cancel('open');
    if (st.snap) { st.snapLayout = null; highlightSnap(null); if (st.open) closeNotch(); return; }
    if (autoHideOn()) { st.hoverUntil = Date.now() + 700; later('autohide', 720, layout); }
    // Hidden-form summon: hides again 1.5 s after the mouse leaves
    if (st.summoned && !st.open) later('summon', 1500, () => { if (st.summoned && !st.open && !st.hover) dismissSummon(); });
    // notifications whose time ran out while the mouse was on them get a moment more (alerts with a check too)
    st.notifs.forEach((x) => { x.until = Math.max(x.until, Date.now() + 2000); });
    holdAlert(2000);
    if (!st.open) { renderClosed(); layout(); }
    if (window.N && N.carousel && N.carousel.scheduleHidePill) N.carousel.scheduleHidePill();
    scheduleClose();
  }
  syncArrows();
});

// Click the closed notch to open it; press and drag it (or the empty part of the open notch's top
// bar) sideways to move it along the top edge of the screen.
notchEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const closedArea = !st.open && !e.target.closest('.mini-ctl, .notif-stack, .claude-stack, .tele-strip, #below button');
  const headerArea = st.open && e.target.closest('#top') && !e.target.closest('button, #topBars, input, select');
  if (!closedArea && !headerArea) return;
  const startX = e.screenX;
  let moving = false;
  const move = (ev) => {
    if (!moving && Math.abs(ev.screenX - startX) > 5 && !st.settings.lockPosition) {
      moving = true;
      st.moving = true;
      cancel('open'); cancel('close');
      notchEl.classList.add('moving');
      api.drag('start');
    }
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (moving) {
      api.drag('end');
      st.moving = false;
      setTimeout(() => notchEl.classList.remove('moving'), 50);
      scheduleClose();
    } else if (closedArea) {
      if (st.tucked) { untuck(); return; }
      if (singleNotifInBelow() && e.target.closest('#below')) {
        const n = st.notifs[0];
        if (n) {
          api.svc('notif', 'open', n.aumid, n.launch || '', n.activation || '');
          if (n.hid) api.svc('notif', 'read', n.hid).catch(() => {});
          dropNotif(n.id);
        }
        return;
      }
      const act = currentActivity();
      if (act && act.kind === 'tele') { N.tele.resume(); return; }
      if (feedSumActive()) { openNotch('feed'); return; }
      if (act && act.kind === 'brief') { st.activity = null; openNotch('chat'); return; }
      if (act && act.kind === 'toast' && act.data && act.data.onboard) {
        st.activity = null; renderClosed(true); layout();
        if (window.__TAURI__ && window.__TAURI__.core) window.__TAURI__.core.invoke('onboarding_cancel_wait').catch(() => {});
        return;
      }
      if (act && act.kind === 'toast' && act.data && act.data.settings) { const sec = act.data.settings; st.activity = null; renderClosed(); layout(); api.openSettings(sec); return; }
      if (act && act.kind === 'toast' && act.data && act.data.tab) { const tab = act.data.tab; st.activity = null; openNotch(tab); return; }
      if (act && act.kind === 'timer') { openNotch('pomodoro'); if (N.showTimer) N.showTimer(); return; }
      const todo = (act && ['todo-due', 'todo-alert', 'todo-sum'].includes(act.kind)) || e.target.closest('.todo-panel');
      if (act && act.kind === 'stopwatch') { openNotch('pomodoro'); if (N.showStopwatch) N.showStopwatch(); } else openNotch(todo ? 'todo' : undefined);
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
// Right-click the closed Sympony twice to tuck it away (only a handle at the top edge stays), and twice on
// the handle to bring it back (a click or tap on the handle does too).
let lastRightClick = 0;
notchEl.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.item')) e.preventDefault();
  if (st.open || e.target.closest('.mini-ctl, .tele-strip')) return;
  const now = Date.now();
  if (now - lastRightClick < 400) { lastRightClick = 0; if (st.tucked) untuck(); else tuck(); return; }
  lastRightClick = now;
});
function tuck() {
  st.tucked = true;
  cancel('open');
  if (st.open) closeNotch(); else { renderClosed(); layout(); }
}
function untuck() { st.tucked = false; renderClosed(); layout(); }

function handleToggle() {
  if (st.tucked) {
    st.tucked = false;
    st.keyOpen = true;
    openNotch();
    st.openedByShortcut = true;
    later('close', 5000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
    return;
  }
  if (shellFormOf() === 'hidden') {
    if (st.open) {
      st.summoned = false;
      cancel('summon');
      closeNotch();
    } else if (st.summoned) {
      cancel('summon');
      st.keyOpen = true;
      openNotch();
      st.openedByShortcut = true;
      later('close', 5000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
    } else {
      st.summoned = true;
      cancel('close');
      renderClosed(true);
      layout();
      later('summon', 5000, () => { if (st.summoned && !st.open && !st.hover) dismissSummon(); });
    }
    return;
  }
  if (st.open) closeNotch();
  else {
    st.keyOpen = true;
    openNotch();
    st.openedByShortcut = true;
    later('close', 5000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
  }
}
api.onToggle(handleToggle);
api.on('notch:navigate', navigate);
// The Dock's next prayer was clicked (dock.rs, to the notch on that Dock's display): Sympony comes down open on that
// tab, and goes back up by itself if the mouse doesn't come to it. With the tab turned off: its Settings page.
api.on('notch:openTab', (tab) => {
  if (tab !== 'notifs' && !enabledTabs().includes(tab)) { api.openSettings(tab); return; }
  openNotch(tab);
  st.openedByShortcut = true;
  later('close', 8000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
});

// Diagnostics: log the first few clicks after the notch (re)starts, to confirm input arrives.
let diagClicks = 0;
document.addEventListener('mousedown', (e) => {
  if (diagClicks++ >= 4) return;
  const t = e.target;
  api.log(`click #${diagClicks} reached the notch: <${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${typeof t.className === 'string' && t.className ? '.' + t.className.split(' ').join('.') : ''}> page=${st.page} open=${st.open}`);
}, true);
window.addEventListener('error', (e) => api.log(`error: ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));

// Main asks for a clean slate (PC locked/unlocked, woke from sleep, notch hidden/shown): drop any
// half-finished interaction and close.
api.on('notch:reset', () => {
  st.hover = false; st.dragging = false; st.moving = false; st.seeking = false; st.openedByShortcut = false; st.summoned = false;
  cancel('open'); cancel('dragEnd'); cancel('summon');
  notchEl.classList.remove('moving', 'dragging', 'on-share');
  hideCtx();
  endTyping();
  if (st.open) closeNotch(); else { renderClosed(); layout(); }
});
// Hands needs to click/drag near the top of the screen: fold the expanded notch cleanly out of the way.
if (api.onNotchYield) api.onNotchYield(() => {
  cancel('open');
  st.hover = false;
  if (st.open) closeNotch();
});
// Floating Pony Chat requested docking back to the notch (or opening a module from an action chip).
if (api.onNotchOpenMod) api.onNotchOpenMod((mod) => {
  const target = typeof mod === 'string' && mod ? mod : 'chat';
  openNotch(target);
  if (N.openModule) N.openModule(target);
  if (target === 'chat') {
    const inp = $('#chIn');
    if (inp) N.focusField(inp);
  }
});

// Leaving (wm.rs update_visibility): a fullscreen app came up on this display (Settings → General → Hide when an app
// is fullscreen), or Sympony was hidden or snoozed from the tray. Sympony, with the cat and all that hangs under it, slides
// up out of the top edge and fades, and main hides the window once it's gone; coming back, the window shows with it
// still up there and it slides down. Main may turn it round half way (the fullscreen app went again). With reduced
// motion main hides and shows the window at once, and this doesn't move either.
const leaveSt = { out: false, anim: null };
api.on('notch:leaving', (on) => leaveTo(!!on));
function leaveTo(out) {
  if (out === leaveSt.out) return;
  leaveSt.out = out;
  const a = leaveSt.anim;
  // turning round half way: from where it is; else from its place, or from up there, as far up as it needs to be now
  // (it may have closed meanwhile)
  const turning = !!a && a.playState === 'running';
  const cs = turning ? getComputedStyle(document.body) : null;
  const home = { translate: '0px 0px', opacity: 1 };
  const up = { translate: `0px ${-leaveLift()}px`, opacity: 0 };
  const from = turning ? { translate: cs.translate === 'none' ? '0px 0px' : cs.translate, opacity: Number(cs.opacity) } : out ? home : up;
  if (a) a.cancel();
  const anim = leaveSt.anim = document.body.animate([from, out ? up : home], {
    duration: reducedMotion.matches ? 0 : out ? 240 : 320,
    // away gathering speed (as the Dock goes down), back easing into its place (as the notch moves)
    easing: out ? 'cubic-bezier(0.4, 0, 0.7, 0.2)' : 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards',
  });
  // back in its place: nothing of it stays on the page
  if (!out) anim.onfinish = () => { if (leaveSt.anim === anim) { anim.cancel(); leaveSt.anim = null; } };
}
// how far up it goes: past all that's drawn (the notch and its shadow)
function leaveLift() {
  const bottom = st.box ? st.box.bottom : notchEl.getBoundingClientRect().bottom;
  return Math.ceil(bottom + 24);
}

// Settings → HUD → Show over fullscreen apps: while this window is out of sight for a fullscreen app (or on its way
// out), a HUD asks main to bring Sympony in for its moment (wm.rs hud). Main says so (notch:hudOnly) and brings it down
// as when it comes back: the closed notch shows that HUD alone (the last one while it slides away again), without
// alerts, notifications, the song's title or lyrics, the marks or the cat, and nothing opens it (main sends no hover
// while it's out of sight, and the mouse goes through to the app). Then main slides it away and hides the window.
api.on('notch:visible', (v) => { st.unseen = !v; });
function bringInForHud(ms) {
  const s = st.settings;
  if (api.hud && s && s.hudEnabled && s.hudOverFullscreen !== false && (st.unseen || leaveSt.out || st.hudOnly)) api.hud(ms);
}
api.on('notch:hudOnly', (on) => {
  st.hudOnly = !!on;
  if (st.hudOnly) {
    st.hover = false; notchEl.classList.remove('hovering'); cancel('open');
    if (st.open) closeNotch();
  }
  notchEl.classList.toggle('hud-only', st.hudOnly);
  renderClosed(true); layout();
});

// ---- keyboard focus for text fields (notes, todo, translate)
// The notch window is normally unfocusable so it never steals focus. Clicking into a text field
// asks main to make it focusable; it stays open until you click elsewhere or press Esc.
function beginTyping() { if (st.typing) return; st.typing = true; cancel('close'); api.setFocus(true); syncArrows(); }
function endTyping() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (!st.typing) return;
  st.typing = false; api.setFocus(false); syncArrows();
}
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('input[type=text], input[type=search], input[type=time], input[type=password], input:not([type]), textarea, [contenteditable=true], select')) beginTyping();
}, true);
document.addEventListener('focusin', (e) => {
  if (e.target && e.target.closest && e.target.closest('input[type=text], input[type=search], input[type=time], input[type=password], input:not([type]), textarea, [contenteditable=true], select')) beginTyping();
});
api.on('notch:blur', () => { if (st.typing) { endTyping(); scheduleClose(); } });
function isEditableFocused(target) {
  const sel = 'input, textarea, select, [contenteditable]:not([contenteditable=false])';
  if (st.typing) return true;
  if (target && target.closest && target.closest(sel)) return true;
  const ae = document.activeElement;
  return !!(ae && ae.closest && ae.closest(sel));
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (claudeShowing() && st.claude && st.claude[0]) {
      e.preventDefault();
      endTyping();
      ccSend(st.claude[0], 'close');
      return;
    }
    if (isEditableFocused(e.target)) { endTyping(); return; }
    if (window.N && N.carousel && N.carousel.fullModule()) { N.carousel.closeFull(); return; }
    if (window.N && N.carousel && N.carousel.isSpecial()) { N.carousel.setSpecial(null); return; }
    if (st.open) { closeNotch(); return; }
    if (st.summoned) { dismissSummon(); return; }
    return;
  }
  // Keyboard shortcuts for active question card (closed notch, open HITL section, or inline Pony ask in chat)
  const ccActive = claudeShowing()
    ? (st.claude && st.claude[0])
    : (st.open && st.page === 'hitl')
      ? (st.claude && st.claude[0])
      : (st.open && st.page === 'chat' && st.claude && st.claude.find((x) => x.source === 'pony'));
  if (ccActive && ccActive.kind === 'question' && ccActive.answer && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey && !isEditableFocused(e.target)) {
    const sel = ccGetSel(ccActive.id);
    const qs = ccActive.questions || [];
    const q = qs[sel.step];
    if (!e.shiftKey && /^[1-9]$/.test(e.key) && q && (q.o || [])[Number(e.key) - 1]) {
      e.preventDefault();
      ccPickOption(ccActive, sel.step, Number(e.key) - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      ccNext(ccActive, sel);
      return;
    }
    if (e.key === 'Backspace' && sel.step > 0) {
      e.preventDefault();
      ccClick(ccActive, 'back');
      return;
    }
  }
  if (!st.open || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (isEditableFocused(e.target) || arrowsBusy()) return;
  // YouTube video mode: Shift+←/→ (or Shift+,/. `<`/`>`) seeks ±5s, J/L seeks ±10s, Space/K toggles playback,
  // while plain ←/→ always slides between notch modules/pages.
  if (isYtActive()) {
    if (
      (e.shiftKey && (e.key === 'ArrowRight' || e.code === 'Period'))
      || e.key === '>'
      || (!e.shiftKey && (e.key === 'l' || e.key === 'L'))
    ) {
      e.preventDefault();
      ytSeekBy((e.key === 'l' || e.key === 'L') ? 10 : 5);
      return;
    }
    if (
      (e.shiftKey && (e.key === 'ArrowLeft' || e.code === 'Comma'))
      || e.key === '<'
      || (!e.shiftKey && (e.key === 'j' || e.key === 'J'))
    ) {
      e.preventDefault();
      ytSeekBy((e.key === 'j' || e.key === 'J') ? -10 : -5);
      return;
    }
    if (!e.shiftKey && (e.key === ' ' || e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      cmd('toggle');
      return;
    }
  }
  if (!st.settings || st.settings.moduleShortcuts === false) return;
  const arrow = !e.shiftKey && (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
  if (arrow) {
    e.preventDefault();
    arrowTab(arrow);
    return;
  }
  if (!e.shiftKey && e.key >= '1' && e.key <= '9' && window.N && N.carousel && !N.carousel.isSpecial()) {
    const k = Number(e.key) - 1;
    if (k < N.carousel.pages().length) {
      e.preventDefault();
      N.carousel.go(k);
      if (N.carousel.flashPill) N.carousel.flashPill(1200);
    }
  }
});

// ---- ← / → switch carousel pages while Sympony is open (stopping at the ends)
const NO_ARROW_PAGES = ['drop', 'snap'];
let arrowsAsked = false; let hoverKeys = false;
function syncArrows() {
  const s = st.settings;
  const ytOn = isYtActive();
  const want = !!(st.open && !st.typing && !NO_ARROW_PAGES.includes(st.page) && (st.hover || st.keyOpen) && (ytOn || (s && s.moduleShortcuts !== false)));
  if (want !== arrowsAsked) { arrowsAsked = want; api.setArrows(want); }
  const ccKeys = !!(claudeShowing() && st.hover && !st.typing);
  const kb = (want || ccKeys) && st.hover && !st.typing;
  if (kb !== hoverKeys) { hoverKeys = kb; if (kb || !st.typing) api.setFocus(kb); }
}
function arrowsBusy() {
  if (st.ctxOpen || st.seeking) return true;
  const active = window.N && N.carousel ? (N.carousel.fullModule() || N.carousel.activeModule()) : null;
  const m = active ? modules.get(active) : null;
  return !!(m && m.built && typeof m.usesArrows === 'function' && m.usesArrows());
}
function arrowTab(dir) {
  if (!st.open || NO_ARROW_PAGES.includes(st.page) || isEditableFocused(null) || arrowsBusy()) return;
  if (st.openedByShortcut) later('close', 5000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
  if (window.N && N.carousel) {
    N.carousel.step(dir);
    if (N.carousel.flashPill) N.carousel.flashPill(1200);
  }
}
api.on('notch:arrow', (dir) => {
  if (isEditableFocused(null)) return;
  arrowTab(dir);
});

// ================================================================== live activities (closed state)
function showActivity(kind, ms, data) {
  st.activity = { kind, until: Date.now() + ms, data };
  // a HUD: what Sympony shows while it's in over a fullscreen app for one (which it may ask for now)
  if (kind.startsWith('hud-')) { st.hudLast = st.activity; bringInForHud(ms); }
  renderClosed(true);
  layout();
  later('activity', ms + 20, () => { renderClosed(true); layout(); });
}

// A moment's info floating in the open notch's top row (volume, brightness, a toast).
function headerHud(html, ms, mod) {
  const el = $('#headerFloat');
  if (!el) return;
  el.dataset.mod = mod || '';
  el.innerHTML = html;
  el.classList.add('show');
  later('headerHud', ms, () => { el.classList.remove('show'); delete el.dataset.mod; });
}

function toast(icon, text, opts = {}) {
  if (st.open) {
    const activeMod = (window.N && N.carousel) ? (N.carousel.fullModule() || N.carousel.activeModule()) : st.page;
    if (opts.mod && activeMod === opts.mod) return;
    headerHud(`<div class="act-icon" style="color:${esc(opts.color || 'inherit')}">${icon}</div><span class="title">${esc(text)}</span>`, opts.ms || 2500, opts.mod);
    return;
  }
  // `tab`: a click on the closed notch while it shows opens that tab
  // `settings`: a click opens that Settings page instead; `hold`: like an alert with a check, hovering doesn't
  // open Sympony over it and it waits while the mouse is on it
  // `glow`: the outline glows in that color while it shows (Settings → Animations; `glowLoops: 2` for a short one)
  showActivity('toast', opts.ms || 3000, { icon, text, sub: opts.sub, color: opts.color, side: opts.side, tab: opts.tab, tick: opts.tick, settings: opts.settings, hold: opts.hold, glow: opts.glow, glowLoops: opts.glowLoops, device: opts.device });
  bump();
}

api.on('onboard:hint', (h) => {
  if (!h || h.state === 'clear' || !h.text) {
    if (st.activity && st.activity.kind === 'toast' && st.activity.data && st.activity.data.onboard) {
      st.activity = null; renderClosed(true); layout();
    }
    return;
  }
  const ask = h.state === 'ask';
  const ready = h.state === 'ready';
  const icon = ask ? '<i class="fa-solid fa-circle-notch fa-spin"></i>' : fa('check');
  const color = ask ? '#9ec5ff' : '#30d158';
  // the wing fits the whole text ("Sympony is ready" was cut to "Sympony is r…" in the default 120 px)
  const side = Math.min(240, Math.max(120, Math.ceil(h.text.length * 7.2) + 44));
  toast(icon, h.text, { hold: ask, ms: ask ? 60000 : ready ? 2600 : 2200, color, side, glow: ready ? '#30d158' : undefined });
  if (st.activity && st.activity.data) st.activity.data.onboard = true;
});

// ------------------------------------------------------------------ Windows notifications
// main reads new ones from Windows (notif.rs, Settings → Notifications) and sends them here. They pile up as
// cards under the closed notch, newest on top, each for its own time (Settings: seconds, minutes or until you
// close it); while the mouse is on them the time waits. A card's X closes it, a click on it opens its app.
// While Sympony is open a new one shows briefly in its top bar too.
const NOTIF_SHOW = 4;      // cards at once; more say "+N more"
const NOTIF_CARD_H = 64;
function notifShowing() { return !st.open && !st.hudOnly && st.notifs.length > 0; }
function singleNotifInBelow() {
  return notifShowing() && st.notifs.length === 1 && !currentActivity() && !claudeShowing();
}
function notifStackHeight() {
  if (singleNotifInBelow()) return 0;
  if (notifPileOn()) return pileHeight();
  const n = Math.min(st.notifs.length, NOTIF_SHOW);
  return n * (NOTIF_CARD_H + 4) + (st.notifs.length > NOTIF_SHOW ? 20 : 0) + 6;
}
api.on('notif', (n) => {
  const secs = Number(st.settings.notifSeconds);
  const forSecs = Number.isFinite(secs) ? secs : 6;
  st.notifs = [{ ...n, until: forSecs > 0 ? Date.now() + forSecs * 1000 : Infinity }, ...st.notifs.filter((x) => x.id !== n.id)].slice(0, 20);
  // (Paseo's own notifications, an agent done or waiting, sound like the agents' cards do)
  if ((n.aumid === 'sh.paseo.desktop' || /^paseo$/i.test(n.app || '')) && st.settings.claudeSound !== false) chime();
  if (st.open) toast(n.icon ? `<img class="act-app" src="${esc(n.icon)}" alt="">` : fa('bell'), [n.app, n.title].filter(Boolean).join(': '), { ms: 4000 });
  if (!st.open) {
    outline.notifUntil = Date.now() + 3600;
    outline.notifKey = String(n.id || Date.now());
    later('notifGlow', 3650, outlineSync);
  }
  renderClosed(); layout();
  bump();
});
function dropNotif(id) { st.notifs = st.notifs.filter((x) => String(x.id) !== String(id)); renderClosed(); layout(); }
setInterval(() => {
  if (!st.notifs.length) return;
  const now = Date.now();
  // time runs out only while the mouse isn't on Sympony (nor a finger swiping a card away)
  const left = st.hover || nfSwipe.card ? st.notifs : st.notifs.filter((x) => x.until > now);
  if (left.length !== st.notifs.length) { st.notifs = left; renderClosed(); layout(); } else renderNotifs();
}, 1000);
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? _t('now') : m < 60 ? _t('{n}m', { n: m }) : _t('{n}h', { n: Math.floor(m / 60) }); };
let notifSig = '';
function renderNotifs() {
  if (singleNotifInBelow()) { const box = $('.notif-stack', notchEl); if (box) box.remove(); notifSig = ''; return; }
  if (notifPiled()) return; // Settings → Animations → Stacked notifications (below)
  let box = $('.notif-stack', notchEl);
  if (!notifShowing()) { if (box) box.remove(); notifSig = ''; return; }
  const shown = st.notifs.slice(0, NOTIF_SHOW);
  const sig = shown.map((n) => n.id + ':' + ago(n.at)).join('|') + '|' + st.notifs.length;
  if (box && sig === notifSig) return;
  notifSig = sig;
  if (!box) { notchEl.insertAdjacentHTML('beforeend', '<div class="notif-stack"></div>'); box = $('.notif-stack', notchEl); }
  box.innerHTML = shown.map((n) => {
    const pic = n.image || n.icon;
    return `<div class="nf-card" data-id="${esc(n.id)}">`
      + appIconImg(pic, 36, 9, fa('bell'))
      + '<div class="nf-text">'
      + `<div class="nf-app">${n.icon && n.image ? `<img src="${esc(n.icon)}" alt="" onerror="this.remove()">` : ''}<span>${esc(n.app)}</span><i>${ago(n.at)}</i></div>`
      + `<b dir="auto">${esc(n.title || n.app)}</b>${n.body ? `<span dir="auto">${esc(n.body)}</span>` : ''}</div>`
      + `<button type="button" class="nf-x" title="${esc(_t('Close'))}" aria-label="${esc(_t('Close'))}">${fa('xmark')}</button></div>`;
  }).join('') + (st.notifs.length > NOTIF_SHOW ? `<div class="nf-more">${_t('+{n} more', { n: st.notifs.length - NOTIF_SHOW })}</div>` : '');
  $$('.nf-card', box).forEach((c) => {
    const n = st.notifs.find((x) => String(x.id) === c.dataset.id);
    // opens where the notification's own pop-up would (main hands its launch arguments to the app)
    c.onclick = () => {
      if (n) api.svc('notif', 'open', n.aumid, n.launch || '', n.activation || '');
      if (n && n.hid) api.svc('notif', 'read', n.hid).catch(() => {}); // its unread dot in the history goes too
      dropNotif(c.dataset.id);
    };
    $('.nf-x', c).onclick = (e) => { e.stopPropagation(); dropNotif(c.dataset.id); };
  });
}

// ---- Settings → Animations → Stacked notifications (fxNotifStack): the cards pile up under the closed notch like a
// deck, the newest in front (it drops out of the notch), each older one 12 px lower and 6 % smaller behind it, fading;
// three show, and "+N more" under them as without it. Only the front one takes the mouse: drag it sideways (or swipe it
// with a finger) and it follows, tilts and fades while the next one comes forward; let go past ~90 px (or flick it) and
// it flies off and closes as its X does, otherwise it springs back. The cards stay the same elements as they move up
// the pile, so the moves are CSS transitions; nothing runs while nobody touches them.
const NF_PILE = 3; const NF_STEP = 12; const NF_SHRINK = 0.06; const NF_AWAY = 90;
// the card being dragged: where the pointer went down, how far it's gone, how fast; `until`: the click after a drag
// isn't a click on the card; `redraw`: something changed meanwhile, drawn once it's let go
const nfSwipe = { card: null, id: '', x: 0, y: 0, dx: 0, moved: false, t: 0, v: 0, until: 0, redraw: false };
const nfShown = new Set(); // cards the pile has shown (a new one drops in)
function notifPileOn() { return !!(st.settings && st.settings.fxNotifStack); }
function pileHeight() {
  const n = Math.min(st.notifs.length, NF_PILE);
  return 4 + NOTIF_CARD_H + (n - 1) * NF_STEP + (st.notifs.length > NF_PILE ? 20 : 0) + 6;
}
// draws them as a pile while that's on (true); the cards as a list go first when it's turned on, the pile when it's off
function notifPiled() {
  const box = $('.notif-stack', notchEl);
  if (!notifPileOn()) {
    if (box && box.classList.contains('pile')) { box.remove(); notifSig = ''; }
    return false;
  }
  if (box && !box.classList.contains('pile')) box.remove();
  renderPile();
  return true;
}
// where a card sits: q = 0 in front, 1 and 2 behind, 3 out of sight (in between while the front one is swiped away).
// Behind, only the strip under the card before it shows: the cards are see-through, so the rest is cut off (not its
// shadow at the sides and below, which sets it off from the one behind it).
function pilePlace(c, q) {
  const s = 1 - NF_SHRINK * q; const f = Math.min(1, Math.max(0, q));
  const cut = f * (NOTIF_CARD_H - NF_STEP / s) - (1 - f) * 12;
  c.style.transform = `translateY(${(NF_STEP * q).toFixed(1)}px) scale(${s.toFixed(4)})`;
  c.style.clipPath = `inset(${cut.toFixed(1)}px -12px -12px -12px)`;
  c.style.opacity = String(q <= 2 ? 1 - 0.18 * q : Math.max(0, (NF_PILE - q) * 0.64));
  c.style.zIndex = String(NF_PILE + 1 - Math.ceil(q - 0.01));
  c.style.setProperty('--nf-in', (1 - f).toFixed(2)); // what it says shows as it comes to the front
}
function renderPile() {
  let box = $('.notif-stack', notchEl);
  // (the last one swiped away finishes its flight first)
  if (!notifShowing()) { if (box) { if ($('.nf-away', box) && !st.open) $$('.nf-card:not(.nf-away), .nf-more', box).forEach((x) => x.remove()); else box.remove(); } return; }
  if (nfSwipe.card) { nfSwipe.redraw = true; return; }
  if (!box) { notchEl.insertAdjacentHTML('beforeend', '<div class="notif-stack pile"></div>'); box = $('.notif-stack', notchEl); }
  // the three that show, and the next one out of sight behind them, to come up while the front one is swiped away
  const shown = st.notifs.slice(0, NF_PILE + 1);
  const ids = shown.map((n) => String(n.id));
  const cards = $$('.nf-card:not(.nf-away)', box);
  cards.forEach((c) => { if (!ids.includes(c.dataset.id)) c.remove(); });
  shown.forEach((n, k) => {
    let c = cards.find((x) => x.dataset.id === String(n.id) && x.isConnected);
    if (!c) {
      c = document.createElement('div');
      c.className = 'nf-card';
      c.dataset.id = n.id;
      bindPileCard(c);
      // the newest drops out of the notch (once: not again when the pile comes back after Sympony was open)
      if (k === 0 && !nfShown.has(c.dataset.id)) { c.classList.add('nf-new'); c.addEventListener('animationend', () => c.classList.remove('nf-new'), { once: true }); }
      box.appendChild(c);
    }
    if (nfShown.size > 100) nfShown.clear();
    nfShown.add(c.dataset.id);
    // its insides again only when they change (the "5m" ago)
    const sig = ago(n.at);
    if (c.dataset.sig !== sig) {
      const pic = n.image || n.icon;
      c.innerHTML = appIconImg(pic, 36, 9, fa('bell'))
        + '<div class="nf-text">'
        + `<div class="nf-app">${n.icon && n.image ? `<img src="${esc(n.icon)}" alt="" onerror="this.remove()">` : ''}<span>${esc(n.app)}</span><i>${sig}</i></div>`
        + `<b dir="auto">${esc(n.title || n.app)}</b>${n.body ? `<span dir="auto">${esc(n.body)}</span>` : ''}</div>`
        + `<button type="button" class="nf-x" title="${esc(_t('Close'))}" aria-label="${esc(_t('Close'))}">${fa('xmark')}</button>`;
      c.dataset.sig = sig;
    }
    c.dataset.k = k;
    c.classList.toggle('front', k === 0);
    pilePlace(c, k);
  });
  let more = $('.nf-more', box);
  if (st.notifs.length > NF_PILE) {
    if (!more) { box.insertAdjacentHTML('beforeend', '<div class="nf-more"></div>'); more = $('.nf-more', box); }
    more.style.top = NOTIF_CARD_H + (Math.min(st.notifs.length, NF_PILE) - 1) * NF_STEP + 4 + 'px';
    more.textContent = _t('+{n} more', { n: st.notifs.length - NF_PILE });
  } else if (more) more.remove();
}
function bindPileCard(c) {
  // a click on the front card opens its app, its X closes it (as on a card in the list)
  c.addEventListener('click', (e) => {
    if (!c.classList.contains('front') || performance.now() < nfSwipe.until) return;
    const id = c.dataset.id; const n = st.notifs.find((x) => String(x.id) === id);
    if (e.target.closest('.nf-x')) { e.stopPropagation(); dropNotif(id); return; }
    if (n) api.svc('notif', 'open', n.aumid, n.launch || '', n.activation || '');
    if (n && n.hid) api.svc('notif', 'read', n.hid).catch(() => {});
    dropNotif(id);
  });
  c.addEventListener('pointerdown', (e) => {
    if (!c.classList.contains('front') || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.nf-x')) return;
    Object.assign(nfSwipe, { card: c, id: c.dataset.id, x: e.clientX, y: e.clientY, dx: 0, moved: false, t: e.timeStamp, v: 0, redraw: false });
    try { c.setPointerCapture(e.pointerId); } catch { /* gone meanwhile */ }
  });
  c.addEventListener('pointermove', (e) => {
    const w = nfSwipe;
    if (w.card !== c) return;
    const dx = e.clientX - w.x;
    if (!w.moved) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - w.y)) return;
      w.moved = true;
      c.parentNode.classList.add('swiping');
    }
    const dt = e.timeStamp - w.t;
    if (dt > 0) w.v = 0.6 * w.v + 0.4 * ((dx - w.dx) / dt); // px per ms, smoothed
    w.t = e.timeStamp; w.dx = dx;
    c.style.transform = `translateX(${dx}px) rotate(${(dx / 30).toFixed(2)}deg)`;
    c.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 260));
    // the ones behind come forward as it goes
    const p = Math.min(1, Math.abs(dx) / NF_AWAY);
    $$('.nf-card:not(.front, .nf-away)', c.parentNode).forEach((x) => pilePlace(x, Number(x.dataset.k) - p));
  });
  const up = (e) => {
    const w = nfSwipe;
    if (w.card !== c) return;
    w.card = null;
    const box = c.parentNode;
    if (!w.moved) { if (w.redraw) renderNotifs(); return; } // a click: the click handler's
    w.until = performance.now() + 350;
    box.classList.remove('swiping');
    // (a flick: still moving fast when let go, not held still first)
    const flick = e.timeStamp - w.t < 80 && Math.abs(w.v) > 0.9 && Math.abs(w.dx) > 30 && Math.sign(w.v) === Math.sign(w.dx);
    if (e.type !== 'pointercancel' && (Math.abs(w.dx) > NF_AWAY || flick)) {
      // off it goes, and it's closed now: the pile moves up while it flies
      const dir = Math.sign(w.dx) || 1;
      c.classList.add('nf-away');
      c.classList.remove('front');
      c.style.transform = `translateX(${dir * (c.offsetWidth + 60)}px) rotate(${dir * 16}deg)`;
      c.style.opacity = '0';
      setTimeout(() => { c.remove(); if (!$('.nf-card', box) && !notifShowing()) box.remove(); }, 280);
      dropNotif(w.id);
    } else {
      $$('.nf-card:not(.nf-away)', box).forEach((x) => pilePlace(x, Number(x.dataset.k)));
      if (w.redraw) renderNotifs();
    }
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  // the pointer lost along the way (off Sympony the window lets the mouse through): let go there
  c.addEventListener('lostpointercapture', up);
  c.pileLetGo = up;
}
api.on('notch:hover', (inside) => { const c = nfSwipe.card; if (!inside && c && c.pileLetGo) c.pileLetGo({ type: 'pointerup', timeStamp: performance.now() }); });

// ------------------------------------------------------------------ Claude Code
// Settings → Claude Code: Claude Code's hooks tell main (claude.rs) when Claude needs a permission, has a question or
// is done, and main sends the whole list on every change. One card at a time under the closed notch (the oldest one
// waiting first), "1 more waiting · project" under it. Allow / Deny or an option answer right here; Open lets Claude
// ask in its own window and brings that forward. A card goes once answered, when Claude stops waiting for it (after a
// minute), or when that session moves on.
const CLAUDE_COLOR = '#e8946f';
const CC_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const CC_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const CC_PONY_ICO = '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="9" fill="#c9b6ff" fill-opacity="0.22"/><circle cx="9" cy="11.5" r="2" fill="#f5f5f7"/><circle cx="15" cy="11.5" r="2" fill="#f5f5f7"/><circle cx="9.6" cy="10.9" r="0.65" fill="#18181f"/><circle cx="15.6" cy="10.9" r="0.65" fill="#18181f"/><path d="M10.4 15.2c.9.9 2.3.9 3.2 0" stroke="#f5f5f7" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ccSel = new Map(); // a question card's answers so far: id → { step, picks: [[labels], …], texts: [str, …] }
let ccAdvanceTimer = null;
st.claude = [];
function claudeShowing() { return !st.open && !st.hudOnly && !!(st.claude && st.claude.length); }
function ccGetSel(id) {
  let sel = ccSel.get(id);
  if (!sel) { sel = { step: 0, picks: [], texts: [] }; ccSel.set(id, sel); }
  if (!Array.isArray(sel.picks)) sel.picks = [];
  if (!Array.isArray(sel.texts)) sel.texts = [];
  return sel;
}
function ccMeta(c) {
  if (c.source === 'pony') {
    const who = c.agent || ponyLook().name;
    return { who, via: 'Sympony', heading: _t('{name} asks', { name: who }), isPaseo: false, isPony: true };
  }
  const raw = c.agent || 'Claude Code';
  const isPaseo = c.source === 'paseo' || raw.startsWith('Paseo · ');
  const who = raw.startsWith('Paseo · ') ? raw.slice(8) : raw;
  const via = isPaseo
    ? ['Paseo', c.project].filter(Boolean).join(' · ')
    : (c.project || '');
  const heading = c.kind === 'done'
    ? _t('{name} is done', { name: who })
    : c.kind === 'question'
      ? _t('{name} asks', { name: who })
      : _t('{name} needs permission', { name: who });
  return { who, via, heading, isPaseo, isPony: false };
}
// (the agent that asks: Claude Code, or another agent's hooks (hooks.rs); Claude's own wording for Claude)
function claudeTitle(c) {
  return ccMeta(c).heading;
}
function ccCanSendStep(c, sel, idx) {
  const q = (c.questions || [])[idx];
  if (!q) return false;
  const p = sel.picks[idx] || [];
  const t = (sel.texts[idx] || '').trim();
  const hasOpts = (q.o || []).length > 0;
  return p.length > 0 || t.length > 0 || (!hasOpts && !!q.allowEmpty);
}
function ccCanType(c, q) {
  const opts = q.o || [];
  return opts.length === 0 || !!q.allowOther || c.source !== 'paseo';
}
function addPonyAsk(item) {
  if (!item || !item.id) return;
  const prevAny = st.claude.length > 0;
  st.claude = [...st.claude.filter((c) => c.source !== 'pony' && c.id !== item.id), item];
  ccSel.delete(item.id);
  if (st.settings) {
    if (!st.open) bump();
    else if (st.page !== 'chat') toast(fa('asterisk'), claudeTitle(item), { ms: 5000, color: '#c9b6ff', mod: 'chat' });
  }
  if ((st.claude.length > 0) !== prevAny && window.N && N.carousel) N.carousel.rebuild();
  if (typeof refreshHitlCards === 'function') refreshHitlCards();
  renderClosed(); layout();
}
function removePonyAsk(id) {
  const had = st.claude.length > 0;
  const next = st.claude.filter((c) => (id ? c.id !== id : c.source !== 'pony'));
  if (next.length === st.claude.length) return;
  st.claude = next;
  if (id) ccSel.delete(id);
  if (had && !st.claude.length && window.N && N.carousel) N.carousel.rebuild();
  else if (typeof refreshHitlCards === 'function') refreshHitlCards();
  renderClosed(); layout();
}
api.on('claude', (d) => {
  const prevAny = st.claude.length > 0;
  const had = new Set(st.claude.map((c) => c.id));
  const ponyItems = st.claude.filter((c) => c.source === 'pony');
  const ext = (d && d.items) || [];
  st.claude = [...ext, ...ponyItems];
  for (const id of [...ccSel.keys()]) if (!st.claude.some((c) => c.id === id)) ccSel.delete(id);
  const nu = ext.find((c) => !had.has(c.id));
  if (!st.settings) return;
  if (nu) {
    if (d.sound) chime();
    // while Sympony is open its top bar says so; the card shows once it closes
    if (st.open) toast(fa('asterisk'), [claudeTitle(nu), nu.project].filter(Boolean).join(' · '), { ms: 5000, color: CLAUDE_COLOR, mod: 'hitl' });
    else bump();
  }
  if ((st.claude.length > 0) !== prevAny && window.N && N.carousel) N.carousel.rebuild();
  if (typeof refreshHitlCards === 'function') refreshHitlCards();
  renderClosed(); layout();
});
// a notch window that comes later (a display added, the notch rebuilt after unlocking) shows what's waiting too
(function claudeFirst() {
  if (!st.settings) { setTimeout(claudeFirst, 500); return; }
  if (!st.settings.claudeHooks) return;
  api.svc('claude', 'list').then((items) => {
    if (Array.isArray(items) && items.length) {
      const ponyItems = st.claude.filter((c) => c.source === 'pony');
      if (st.claude.length === ponyItems.length) {
        st.claude = [...items, ...ponyItems];
        if (window.N && N.carousel) N.carousel.rebuild();
        if (typeof refreshHitlCards === 'function') refreshHitlCards();
        renderClosed(); layout();
      }
    }
  }).catch(() => {});
})();
// the card's height (with the gap above it), drawn first at the width it gets; 0 while there's none
function claudeHeight() {
  if (claudeShowing()) notchEl.style.setProperty('--cc-w', Math.max(500, Math.min(540, effectiveSizes().notchWidth + 260)) + 'px');
  renderClaude();
  const box = $('.claude-stack', notchEl);
  return box ? box.offsetHeight + 4 : 0;
}
function renderClaude() {
  let box = $('.claude-stack', notchEl);
  if (!claudeShowing()) { if (box) box.remove(); return; }
  const c = st.claude[0];
  const sel = ccGetSel(c.id);
  const next = st.claude[1];
  const iconUrl = agentIconUrl(c.agent || 'Claude Code');
  // drawn again only when the card identity, queue tail, or icon changes; step/picks/texts sync in-place to keep input focus & smooth slide
  const sig = JSON.stringify([c.id, c.kind, c.answer, (c.questions || []).length, st.claude.length, next && next.project, next && next.answer, !!iconUrl]);
  if (box && sig === box.dataset.sig) {
    ccSyncContainer(box, c, sel);
    return;
  }
  if (!box) { notchEl.insertAdjacentHTML('beforeend', '<div class="claude-stack"></div>'); box = $('.claude-stack', notchEl); }
  box.dataset.sig = sig;
  const more = st.claude.length - 1;
  box.innerHTML = ccCard(c, sel, iconUrl)
    + (more ? `<div class="cc-more">${esc(ccMore(more, next))}</div>` : '');
  ccWireContainer(box, c);
}
// "1 more waiting · project" (the next one's project; "1 more" when the next one is only telling)
function ccMore(n, next) {
  if (!next.answer) return next.project ? _t('{n} more · {project}', { n, project: next.project }) : _t('{n} more', { n });
  return next.project ? _t('{n} more waiting · {project}', { n, project: next.project }) : _t('{n} more waiting', { n });
}
function ccCard(c, sel, iconUrl, opts) {
  const meta = ccMeta(c);
  const inline = !!(opts && opts.inline);
  const openLabel = meta.isPaseo ? _t('Open in Paseo') : _t('Open');
  const openLnk = inline ? '' : `<button type="button" class="cc-lnk" data-cc="open">${CC_OUT}<span>${esc(openLabel)}</span></button>`;
  const icoInner = meta.isPony
    ? (window.Pony && window.Pony.snapshot ? `<img src="${window.Pony.snapshot({ shape: (st.settings && st.settings.ponyShape) || 'Classic', color: (st.settings && st.settings.ponyColor) || 'Lavender', mood: 'attention', size: 28 })}" alt="">` : CC_PONY_ICO)
    : (iconUrl ? `<img src="${esc(iconUrl)}" alt="">` : fa('asterisk'));
  let right = '';
  let body = '';
  let foot = '';

  if (c.kind === 'question') {
    const qs = c.questions || [];
    const n = qs.length;
    if (n > 1) {
      right = `<div class="cc-steps">${qs.map((_, i) => `<i class="${i === sel.step ? 'on' : ccCanSendStep(c, sel, i) ? 'done' : ''}"></i>`).join('')}<em>${sel.step + 1}/${n}</em></div>`;
    }
    const pages = qs.map((q, i) => {
      const multi = !!q.m;
      const opts = q.o || [];
      const picked = sel.picks[i] || [];
      const txt = sel.texts[i] || '';
      const headerTag = q.header || q.h;
      const tagHtml = headerTag ? `<span class="cc-tag" dir="auto">${esc(headerTag)}</span>` : '';
      const hintHtml = multi ? `<div class="cc-hint">${esc(_t('You can pick more than one'))}</div>` : '';
      const optsHtml = opts.length
        ? `<div class="cc-opts ${opts.length === 1 ? 'one' : ''}">${opts.map((o, k) => `<button type="button" class="cc-opt ${picked.includes(o.l) ? 'on' : ''}" data-cc="pick" data-q="${i}" data-o="${k}" data-label="${esc(o.l)}"><span class="cc-mark"></span><span class="cc-ot" dir="auto"><b>${esc(o.l)}</b>${o.d ? `<span>${esc(o.d)}</span>` : ''}</span>${k < 9 ? `<span class="cc-key">${k + 1}</span>` : ''}</button>`).join('')}</div>`
        : '';
      let otherHtml = '';
      if (c.answer && ccCanType(c, q)) {
        if (opts.length) {
          otherHtml = `<label class="cc-other ${txt.trim() ? 'on' : ''}">${CC_PEN}<input type="text" data-cc-input="${i}" dir="auto" value="${esc(txt)}" placeholder="${esc(q.placeholder || _t('Type your own answer…'))}"><kbd>↵</kbd></label>`;
        } else {
          otherHtml = `<label class="cc-other">${CC_PEN}<textarea data-cc-input="${i}" dir="auto" placeholder="${esc(q.placeholder || _t('Type your answer…'))}">${esc(txt)}</textarea></label>`;
        }
      }
      return `<div class="cc-qpage ${multi ? 'multi' : ''} ${opts.length ? '' : 'big'}">${tagHtml}<div class="cc-q" dir="auto">${esc(q.q || '')}</div>${hintHtml}${optsHtml}${otherHtml}</div>`;
    }).join('');
    body = `<div class="cc-qwrap sc-y"><div class="cc-qtrack" style="transform:translateX(${-sel.step * 100}%)">${pages}</div></div>`;
    if (c.answer) {
      const last = sel.step >= n - 1;
      const midBtn = sel.step > 0
        ? `<button type="button" class="cc-btn sec" data-cc="back">${esc(_t('Back'))}</button>`
        : `<button type="button" class="cc-btn ghost" data-cc="skip">${esc(_t('Skip'))}</button>`;
      const goBtn = `<button type="button" class="cc-btn pri" data-cc="next"${ccCanSendStep(c, sel, sel.step) ? '' : ' disabled'}><span>${esc(last ? _t('Send') : _t('Continue|ask'))}</span><kbd>↵</kbd></button>`;
      foot = `${openLnk}<span class="cc-sp"></span>${midBtn}${goBtn}`;
    } else {
      foot = `<span class="cc-sp"></span><button type="button" class="cc-btn ghost" data-cc="close">${esc(_t('Close'))}</button><button type="button" class="cc-btn pri" data-cc="open">${esc(openLabel)}</button>`;
    }
  } else if (c.kind === 'done') {
    if (c.text) body = `<div class="cc-text" dir="auto">${esc(c.text)}</div>`;
    foot = `${openLnk}<span class="cc-sp"></span><button type="button" class="cc-btn sec" data-cc="close">${esc(_t('Close'))}</button>`;
  } else {
    body = `<div class="cc-cmd"><b>${esc(c.tool || '')}</b>${c.detail ? `<span dir="auto">${esc(c.detail)}</span>` : ''}</div>`;
    foot = c.answer
      ? `${openLnk}<span class="cc-sp"></span><button type="button" class="cc-btn deny" data-cc="deny">${esc(_t('Deny'))}</button><button type="button" class="cc-btn pri" data-cc="allow">${esc(_t('Allow'))}</button>`
      : `<span class="cc-sp"></span><button type="button" class="cc-btn ghost" data-cc="close">${esc(_t('Close'))}</button><button type="button" class="cc-btn pri" data-cc="open">${esc(openLabel)}</button>`;
  }

  return `<div class="cc-card" data-id="${esc(c.id)}">`
    + `<div class="cc-head"><span class="cc-ico">${icoInner}</span><div class="cc-who" dir="auto"><b>${esc(meta.heading)}</b>${meta.via ? `<span>${esc(meta.via)}</span>` : ''}</div>${right}</div>`
    + `${body}`
    + `<div class="cc-ft">${foot}</div>`
    + `</div>`;
}
function ccSyncContainer(root, c, sel) {
  if (!root || c.kind !== 'question') return;
  const qs = c.questions || [];
  const track = $('.cc-qtrack', root);
  if (track) track.style.transform = `translateX(${-sel.step * 100}%)`;
  const stepsEl = $('.cc-steps', root);
  if (stepsEl) {
    $$('i', stepsEl).forEach((d, k) => {
      d.className = k === sel.step ? 'on' : ccCanSendStep(c, sel, k) ? 'done' : '';
    });
    const em = $('em', stepsEl);
    if (em) em.textContent = `${sel.step + 1}/${qs.length}`;
  }
  $$('.cc-opt', root).forEach((b) => {
    const qi = Number(b.dataset.q);
    const lbl = b.dataset.label;
    b.classList.toggle('on', (sel.picks[qi] || []).includes(lbl));
  });
  $$('[data-cc-input]', root).forEach((inp) => {
    const qi = Number(inp.dataset.ccInput);
    const val = sel.texts[qi] || '';
    if (document.activeElement !== inp && inp.value !== val) inp.value = val;
    const wrap = inp.closest('.cc-other');
    if (wrap && (qs[qi] && (qs[qi].o || []).length > 0)) wrap.classList.toggle('on', !!val.trim());
  });
  const midBtn = $('[data-cc="back"], [data-cc="skip"]', root);
  if (midBtn) {
    if (sel.step > 0) {
      midBtn.dataset.cc = 'back';
      midBtn.className = 'cc-btn sec';
      midBtn.textContent = _t('Back');
    } else {
      midBtn.dataset.cc = 'skip';
      midBtn.className = 'cc-btn ghost';
      midBtn.textContent = _t('Skip');
    }
  }
  const goBtn = $('[data-cc="next"]', root);
  if (goBtn) {
    goBtn.disabled = !ccCanSendStep(c, sel, sel.step);
    const sp = $('span', goBtn);
    if (sp) sp.textContent = sel.step >= qs.length - 1 ? _t('Send') : _t('Continue|ask');
  }
}
function ccSyncAll(c) {
  const sel = ccGetSel(c.id);
  const box = $('.claude-stack', notchEl);
  if (box) ccSyncContainer(box, c, sel);
  const hitlPage = $('#page-hitl');
  if (hitlPage) ccSyncContainer(hitlPage, c, sel);
  const chatAsk = $('#page-chat .ch-ask-wrap');
  if (chatAsk && chatAsk.dataset.askId === c.id) ccSyncContainer(chatAsk, c, sel);
  for (const el of hitlCards) {
    if (el.isConnected) paintHitlCard(el);
  }
}
function ccWireContainer(root, c) {
  $$('[data-cc]', root).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const act = b.dataset.cc;
      if (act === 'pick') {
        ccPickOption(c, Number(b.dataset.q), Number(b.dataset.o));
        return;
      }
      ccClick(c, act, b.dataset.label);
    };
  });
  $$('[data-cc-input]', root).forEach((inp) => {
    inp.onfocus = () => { beginTyping(); };
    inp.oninput = () => {
      if (ccAdvanceTimer) { clearTimeout(ccAdvanceTimer); ccAdvanceTimer = null; }
      const i = Number(inp.dataset.ccInput);
      const sel = ccGetSel(c.id);
      const q = (c.questions || [])[i];
      sel.texts[i] = inp.value;
      // Typing in "Other" on a single-choice question clears the picked option (as Paseo does)
      if (inp.value.trim() && q && !q.m) sel.picks[i] = [];
      ccSyncAll(c);
    };
    inp.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        ccNext(c, ccGetSel(c.id));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endTyping();
        if (claudeShowing()) ccSend(c, 'close');
        return;
      }
      e.stopPropagation();
    };
  });
}
function ccPickOption(c, qIdx, optIdx) {
  const q = (c.questions || [])[qIdx];
  if (!q) return;
  const o = (q.o || [])[optIdx];
  if (!o) return;
  const sel = ccGetSel(c.id);
  const cur = sel.picks[qIdx] || [];
  if (ccAdvanceTimer) { clearTimeout(ccAdvanceTimer); ccAdvanceTimer = null; }
  if (q.m) {
    sel.picks[qIdx] = cur.includes(o.l) ? cur.filter((x) => x !== o.l) : [...cur, o.l];
    ccSyncAll(c);
    return;
  }
  sel.picks[qIdx] = [o.l];
  sel.texts[qIdx] = '';
  ccSyncAll(c);
  // Single choice auto-advances smoothly
  const id = c.id;
  ccAdvanceTimer = setTimeout(() => {
    ccAdvanceTimer = null;
    if (!st.claude.some((x) => x.id === id)) return;
    ccNext(c, ccGetSel(id));
  }, 220);
}
function ccClick(c, act, label) {
  if (ccAdvanceTimer) { clearTimeout(ccAdvanceTimer); ccAdvanceTimer = null; }
  if (act === 'pick') {
    const sel = ccGetSel(c.id);
    const q = (c.questions || [])[sel.step];
    if (!q) return;
    const idx = (q.o || []).findIndex((o) => o.l === label);
    if (idx >= 0) ccPickOption(c, sel.step, idx);
    return;
  }
  if (act === 'back') {
    const sel = ccGetSel(c.id);
    if (sel.step > 0) {
      sel.step--;
      ccSyncAll(c);
      if (claudeShowing()) layout();
    }
    return;
  }
  if (act === 'next') { ccNext(c, ccGetSel(c.id)); return; }
  ccSend(c, act);
}
// the next question, or all of them answered: sent
function ccNext(c, sel) {
  if (!sel || !ccCanSendStep(c, sel, sel.step)) return;
  const qs = c.questions || [];
  if (sel.step + 1 < qs.length) {
    sel.step++;
    ccSyncAll(c);
    if (claudeShowing()) layout();
    return;
  }
  const picks = qs.map((_, i) => sel.picks[i] || []);
  const texts = qs.map((_, i) => sel.texts[i] || '');
  ccSend(c, 'answer', picks, texts);
}
function ccSend(c, choice, picks, texts) {
  if (ccAdvanceTimer) { clearTimeout(ccAdvanceTimer); ccAdvanceTimer = null; }
  endTyping();
  if (c.source === 'pony') {
    if (choice === 'open') {
      openNotch('chat');
      return;
    }
    const had = st.claude.length > 0;
    st.claude = st.claude.filter((x) => x.id !== c.id);
    ccSel.delete(c.id);
    if (had && !st.claude.length && window.N && N.carousel) N.carousel.rebuild();
    else if (typeof refreshHitlCards === 'function') refreshHitlCards();
    renderClosed(); layout();
    if (window.N && N.chat) {
      if (choice === 'answer') {
        const answers = {};
        (c.questions || []).forEach((q, i) => {
          const key = q.header || q.h || q.q || `Q${i + 1}`;
          const p = (picks && picks[i]) || [];
          const t = ((texts && texts[i]) || '').trim();
          if (q.m) {
            answers[key] = [...p, t].filter(Boolean).join(', ');
          } else {
            answers[key] = t || p[0] || '';
          }
        });
        if (N.chat.answerAsk) N.chat.answerAsk(c.id, answers, false);
      } else if (choice === 'skip') {
        if (N.chat.answerAsk) N.chat.answerAsk(c.id, null, true);
      } else if (N.chat.dismissAsk) {
        N.chat.dismissAsk(c.id);
      }
    }
    return;
  }
  // gone here at once; main tells every notch
  const had = st.claude.length > 0;
  st.claude = st.claude.filter((x) => x.id !== c.id);
  ccSel.delete(c.id);
  api.svc('claude', 'answer', c.id, choice, picks || null, texts || null).catch(() => {});
  if (had && !st.claude.length && window.N && N.carousel) N.carousel.rebuild();
  else if (typeof refreshHitlCards === 'function') refreshHitlCards();
  renderClosed(); layout();
}

// ------------------------------------------------------------------ notification history (the bell)
// main keeps what it shows, and what Do not disturb holds back (notifhist.rs); the bell in the top bar opens
// the list (modules/notifs.js), its badge counts the ones since it was last opened.
// (Linux: other apps' notifications aren't read yet, so there's no history behind the bell)
function notifBellOn() { const s = st.settings; return !LINUX && !!(s && s.notifEnabled && s.notifHistory !== false); }
function renderNotifBadge() {
  const n = st.notifUnseen || 0;
  const b = $('#notifBadge');
  if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n);
  b.classList.toggle('show', n > 0 && notifBellOn());
}
api.on('notif:history', (h) => {
  st.notifUnseen = (h && h.unseen) || 0;
  renderNotifBadge();
  callModule('notifs', 'update', h);
});
// Do not disturb ended with notifications held back during it: say how many; a click opens the history
api.on('notif:dndSummary', (d) => {
  const n = (d && d.count) || 0;
  if (!n || !st.settings.notifEnabled) return;
  const history = st.settings.notifHistory !== false;
  toast(fa('moon'), n === 1 ? _t('{n} notification while Do not disturb', { n }) : _t('{n} notifications while Do not disturb', { n }),
    { sub: history ? _t('View') : '', color: '#a78bfa', ms: 12000, side: 150, tab: history ? 'notifs' : undefined, hold: history });
  bump();
});
// Do not disturb held one back and Settings → Notifications → "Quiet pop-ups during Do not disturb" is on:
// Sympony only says one came, with its app's icon and a count (going up while it shows), never its title or
// text; no bump. A click opens the history.
let quiet = { n: 0, until: 0 };
api.on('notif:quiet', (d) => {
  if (!st.settings.notifEnabled || !st.settings.notifDndPeek) return;
  const ms = 5000;
  quiet = { n: Date.now() < quiet.until ? quiet.n + 1 : 1, until: Date.now() + ms };
  const icon = `<span class="act-quiet">${d && d.icon ? `<img class="act-app" src="${d.icon}" alt="">` : fa('bell')}<b>+${quiet.n}</b></span>`;
  const text = quiet.n === 1 ? _t('{n} new notification', { n: quiet.n }) : _t('{n} new notifications', { n: quiet.n });
  if (st.open) { toast(icon, text, { ms, color: '#a78bfa' }); return; }
  const history = st.settings.notifHistory !== false;
  showActivity('toast', ms, { icon, text, color: '#a78bfa', side: 150, tab: history ? 'notifs' : undefined, hold: history, quiet: true });
});

// ------------------------------------------------------------------ scheduled briefs
// main says one is due (brief.rs, Settings → AI Chat & Agents): AI Chat gets the message and Sympony comes down
// open on AI Chat (and closes by itself after a while if the mouse never comes); with the AI Chat tab turned off,
// the closed notch says the brief is ready.
api.on('chat:brief', (b) => {
  const chat = window.N.chat;
  if (!chat || !b || !b.text) return;
  if (enabledTabs().includes('chat')) {
    openNotch('chat');
    st.openedByShortcut = true;
    later('close', 120000, () => { if (st.openedByShortcut && !st.hover && !st.typing) closeNotch(); });
  } else {
    showActivity('brief', 120000, {});
  }
  bump();
  chat.send(b.text, { brief: true });
});

// Cute cursors (Settings → Cursor): main asks the first notch to draw the set at the size the screen
// needs; cursor.rs puts the PNGs in place for every app.
api.on('cursor:render', async (r) => {
  if (!window.SymponyCursors || !r) return;
  try { api.svc('cursor', 'set', await window.SymponyCursors.render(r.theme, r.px, r.scale, r.roles)); } catch (e) { console.warn('cursor render', e); }
});

// Long-lived activities rotate in the closed notch: music, a running Pomodoro, an event starting soon.
function persistentActivities() {
  const s = st.settings;
  // the Teleprompter paused down here (minimized): it alone, until a click brings its strip back
  if (teleMode() === 'paused') return [{ kind: 'tele' }];
  // (the page's first moment, before main sent the settings: nothing yet)
  if (!s) return [];
  // a game in front with the FPS counter on (Settings → System Monitor): its FPS, with CPU and GPU, stays in
  // the closed notch (only the adhan's stop button takes its place)
  const fps = s.fpsCounter && st.stats && st.stats.fps;
  if (fps) return [st.adhan ? { kind: 'adhan', data: st.adhan.t } : { kind: 'fps', data: fps }];
  if (!s.liveActivity) return [];
  const src = s.liveSources || {};
  const out = [];
  // the adhan playing: shown with its stop button
  if (st.adhan) out.push({ kind: 'adhan', data: st.adhan.t });
  // the next prayer (or Terbit), counting down for the last few minutes before it
  const next = s.prayerEnabled && s.prayerBefore > 0 && nextPrayer(true);
  if (next && next.at - Date.now() <= s.prayerBefore * 60000) out.push({ kind: 'prayer-soon', data: next });
  // paused music stays while the hover controls show, so ⏯ can start it again
  if (src.music !== false && s.mediaEnabled && st.media.active && (st.media.playing || showMiniControls())) out.push({ kind: 'music' });
  if (src.pomodoro !== false && st.pomodoro && st.pomodoro.running) out.push({ kind: 'pomodoro' });
  if (src.pomodoro !== false && window.N && N.swRunning && N.swRunning()) out.push({ kind: 'stopwatch' });
  // the Pomodoro tab's Timer (running alongside a Pomodoro, the two take turns like the rest)
  if (src.pomodoro !== false && st.timer && st.timer.running) out.push({ kind: 'timer' });
  if (src.calendar !== false && s.calendarEnabled) {
    const now = Date.now();
    const soon = st.events.find((e) => !e.allDay && e.start > now && e.start - now <= 15 * 60000);
    if (soon) out.push({ kind: 'event-soon', data: soon });
  }
  // Tasks due within the hour are one activity (taking turns with music, Focus, …): a single task fits
  // the row; several are listed together in a panel under it (todoPanelTasks).
  const tasks = dueSoonTodos();
  if (tasks.length === 1) out.push({ kind: 'todo-due', data: tasks[0] });
  else if (tasks.length > 1) out.push({ kind: 'todo-sum', data: tasks });
  return out;
}

// ================================================================== Teleprompter (modules/teleprompter.js)
// While it reads, its strip takes the closed notch's place ('strip': counting down, reading, or paused there);
// minimized it waits paused in the closed notch ('paused': a click brings the strip back); '' when it isn't reading.
// Not while Sympony is in over a fullscreen app for a HUD.
function teleMode() { return (!st.hudOnly && window.N && N.tele && N.tele.mode()) || ''; }
function teleStrip() { return !st.open && teleMode() === 'strip'; }
// the paused pill's right side, "Paused · 0:32": the time left at the speed picked
function teleLeftText() { return `${_t('Paused')} · ${fmt(N.tele.left())}`; }
function teleSide() {
  const need = Math.max(textWidth([_t('Teleprompter')], '600 12px'), textWidth([teleLeftText()], '500 12px')) + 25;
  return Math.max(84, Math.min(170, Math.ceil(need) + 4));
}
// it started, stopped, was minimized or came back: the closed notch follows
window.addEventListener('sympony:tele', () => { renderClosed(true); layout(); });

// ================================================================== prayer times
// Today's and tomorrow's times come from the backend (prayer.rs: Kemenag RI in Indonesia, the local
// authority via Aladhan elsewhere); the reminders happen here.
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
// `sunrise`: with Terbit among them (GitHub #60), for the reminders: the end of Subuh's time, counted down to like the
// prayers and then a short note (sunriseNote). On unless unticked under Prayer Times (missing counts as on).
function prayerTimes(sunrise) {
  const p = st.prayer; const s = st.settings;
  if (!s || !s.prayerEnabled || !p || !p.ok) return [];
  const on = s.prayerList || {};
  const keys = sunrise ? [...PRAYERS, 'sunrise'] : PRAYERS;
  return (p.days || []).flatMap((d) => keys.filter((k) => on[k] !== false && d[k])
    .map((k) => ({ key: k, name: (p.names || {})[k] || k, at: d[k], id: d.date + ':' + k }))).sort((a, b) => a.at - b.at);
}
function nextPrayer(sunrise) { const now = Date.now(); return prayerTimes(sunrise).find((t) => t.at > now) || null; }
// a prayer's name in Sympony's language (modules/prayer.js; the regional names main sends stay as they are)
const prayerName = (n) => (window.N && N.prayerName ? N.prayerName(n) : n);

// Main says when (prayer.rs, once for every notch window): every display shows it, and only the notch on the
// display you're working on (`sound`) plays the adhan or the chime.
api.on('prayer:due', (d) => {
  const s = st.settings; const t = d && d.t;
  if (!s || !s.prayerEnabled || !t) return;
  const now = Date.now();
  if (d.soon) {
    // the countdown takes its turn in the closed notch from now on; show it on its own for a moment
    // first (that also brings an auto-hidden Sympony down)
    if (!st.open && !(st.activity && st.activity.until > now)) { showActivity('prayer-soon', 8000, t); bump(); }
    return;
  }
  prayerTime(t, !!d.sound);
});

// It's a prayer's time: main said so (above), or this notch saw the time come and main's word didn't follow
// (prayerWatch). Shown once and its sound played once, whichever came first; `sound`: this notch makes it.
const prayerHad = new Map(); // prayer id → { shown, sound }
function prayerTime(t, sound) {
  const s = st.settings;
  let had = prayerHad.get(t.id);
  if (!had) {
    had = { shown: false, sound: false };
    prayerHad.set(t.id, had);
    if (prayerHad.size > 12) prayerHad.delete(prayerHad.keys().next().value);
  }
  const ring = sound && !had.sound;
  if (had.shown && !ring) return;
  // the user's own adhan recording (Settings → Prayer Times → Adhan), else the chime; while the adhan
  // plays, the closed notch shows it (with a stop button) instead of the brief reminder. Terbit: its note, and the
  // chime at most
  const adhan = s.adhanOn && s.adhanFile && t.key !== 'sunrise';
  if (!had.shown) {
    if (t.key === 'sunrise') sunriseNote(t);
    else if (st.open) toast(fa('mosque'), `${prayerName(t.name)} · ${hm(t.at)}`, { ms: 8000, color: 'var(--green)' });
    else { if (!adhan) showActivity('prayer', 20000, t); bump(); }
  }
  if (adhan) { if (ring) playAdhan(t); else if (!had.shown) showAdhan(t); }
  else if (ring && s.prayerSound !== false) chime('prayer', true);
  had.shown = true;
  if (ring) had.sound = true;
}
// Terbit (sunrise) came: Subuh's time is over. A short note with the time ("Fajr time is over · 05:42"), on every
// display; a click on the closed one opens the Prayer Times tab.
function sunriseNote(t) {
  const text = _t('{prayer} time is over', { prayer: prayerName(((st.prayer || {}).names || {}).fajr || 'Fajr') });
  if (st.open) { toast(fa('sun'), `${text} · ${hm(t.at)}`, { ms: 8000, color: 'var(--orange)' }); return; }
  const side = Math.max(120, Math.min(200, Math.ceil(textWidth([text], '600 12px')) + 40));
  toast(fa('sun'), text, { sub: hm(t.at), ms: 20000, color: 'var(--orange)', side, tab: 'prayer', glow: 'amber' });
}

// GitHub #60: the time came and the closed notch was left at "0:00" with no sound (main's reminder never came).
// The countdown now goes at the time (the 1 s tick above draws what shows instead), main's reminder normally
// follows within a second or two, and if it hasn't come 5 s after the time, this notch shows the prayer time itself,
// with the sound where main would have played it (the display you're working on). Only for a prayer this window saw
// coming, so a notch made again after the time (sleep, a display change) doesn't remind twice.
let prayerAhead = null; // the next prayer (or Terbit), as last seen before its time
function prayerWatch() {
  const s = st.settings;
  if (!s || !s.prayerEnabled) { prayerAhead = null; return; }
  const now = Date.now();
  const t = prayerAhead;
  if (t && t.at <= now) {
    if (now < t.at + 5000) return;
    // (10 minutes is as late as main reminds; still one of the prayers picked)
    if (now - t.at < 10 * 60000 && prayerTimes(true).some((x) => x.id === t.id)) prayerTime(t, st.soundHere !== false);
  }
  prayerAhead = nextPrayer(true);
}

// The adhan: the file the user picked, fetched from main when it's time (Subuh can have its own). While it
// plays, the closed notch shows it with a stop button — on every display, though only one notch plays it.
async function playAdhan(t) {
  stopAdhan();
  const s = st.settings;
  st.adhan = { t, audio: null };
  renderClosed(true); layout();
  const r = await api.svc('adhan', 'data', t.key === 'fajr' && s.adhanFajrFile ? 'fajr' : 'default').catch(() => null);
  if (!st.adhan || st.adhan.t !== t) return;
  if (!r || !r.ok) { chime('prayer', true); endAdhan(true); return; }
  const audio = new Audio(r.url);
  audio.volume = Math.max(0, Math.min(1, (s.adhanVolume ?? 80) / 100));
  st.adhan.audio = audio;
  audio.addEventListener('ended', () => endAdhan());
  await adhanStarts(t, audio);
  if (!st.adhan || st.adhan.audio !== audio) return;
  audio.play().catch(() => { chime('prayer', true); endAdhan(true); });
}
// Just before it plays, main pauses the music and videos playing (Settings → Prayer Times → Adhan) and plays them
// again when the adhan ends; it's told the length in case this window goes first. A slow player holds it up 2 s at most.
async function adhanStarts(t, audio) {
  if (!(audio.duration > 0)) {
    await new Promise((ok) => { audio.addEventListener('loadedmetadata', ok, { once: true }); audio.addEventListener('error', ok, { once: true }); setTimeout(ok, 1500); });
  }
  if (audio.error) return;
  const secs = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
  await Promise.race([api.svc('adhan', 'start', t.id, secs).catch(() => null), new Promise((ok) => setTimeout(ok, 2000))]);
}
// the card without the sound, on the other displays (gone with the adhan, or after 10 minutes at the latest)
function showAdhan(t) {
  stopAdhan();
  st.adhan = { t, audio: null };
  later('adhanCard', 10 * 60000, () => { if (st.adhan && st.adhan.t === t) stopAdhan(); });
  renderClosed(true); layout();
}
function stopAdhan() {
  if (!st.adhan) return;
  const a = st.adhan.audio;
  st.adhan = null;
  if (a) { try { a.pause(); a.src = ''; } catch (e) { /* gone */ } }
  renderClosed(true); layout();
}
// It ended or was stopped here: main takes the card down on every display (`failed`: it couldn't play, so
// the plain prayer reminder shows instead).
function endAdhan(failed = false) {
  api.svc('adhan', 'stop', !!failed).catch(() => stopAdhan());
}
api.on('prayer:adhanStop', (d) => {
  const t = st.adhan && st.adhan.t;
  stopAdhan();
  if (d && d.failed && t && !st.open) { showActivity('prayer', 20000, t); bump(); }
});

function dueSoonTodos() {
  if (!st.settings || (st.settings.liveSources || {}).todo === false) return [];
  const now = Date.now();
  return dueTodos().filter((t) => t.due - now <= 60 * 60000);
}

// The tasks listed in the panel under the closed notch: only while the todo group is the activity shown.
function todoPanelTasks() {
  if (st.open || !st.settings) return [];
  const act = currentActivity();
  return act && act.kind === 'todo-sum' ? act.data : [];
}
const TODO_PANEL_MAX = 3;
function todoPanelRows() { const n = todoPanelTasks().length; return Math.min(n, TODO_PANEL_MAX) + (n > TODO_PANEL_MAX ? 1 : 0); }

// A task in the closed notch's countdown (due within the hour, now or late) has a check button next to its
// time, from the start of the countdown, to tick it off without opening Sympony; so does the water reminder. While
// one is there, hovering doesn't open Sympony (a click on the rest does), and an alert waits while the mouse is on it.
function todoTickable(t) { return !!t && !!t.due && t.due - Date.now() <= 60 * 60000; }
function tickShowing() {
  if (st.open) return false;
  const act = currentActivity();
  if (!act) return false;
  if (act.kind === 'todo-alert' || act.kind === 'todo-due') return todoTickable(act.data);
  if (act.kind === 'todo-sum') return act.data.slice(0, TODO_PANEL_MAX).some(todoTickable);
  return act.kind === 'toast' && !!(act.data && (act.data.tick || act.data.hold));
}
// keep a brief alert with a check (or a toast to click) up at least `ms` more
function holdAlert(ms) {
  const a = st.activity;
  if (!a || a.until <= Date.now() || !(a.kind === 'todo-alert' || (a.kind === 'toast' && a.data && (a.data.tick || a.data.hold)))) return;
  a.until = Math.max(a.until, Date.now() + ms);
  later('activity', a.until - Date.now() + 20, () => { renderClosed(true); layout(); });
}
function tickTodo(id) {
  const items = (N.data.todo || {}).items || [];
  const t = items.find((x) => x.id === id);
  if (!t || t.done) return;
  N.saveStore('todo', { items: N.todoDone(items, id) });
  for (let i = todoAlerts.length - 1; i >= 0; i--) if (todoAlerts[i].id === id) todoAlerts.splice(i, 1);
  st.activity = null;
  showActivity('toast', 1800, { icon: fa('circle-check'), text: t.repeat ? _t('Done · next one is set') : _t('Done'), color: 'var(--green)', side: t.repeat ? 150 : 90 });
}
// Snooze, next to the check once a task is due (and on each late row of the panel): its time moves to N minutes from
// now (Settings → Todo), so the alert goes and comes back then, and a late task isn't late any more. A repeating one
// keeps its repeat: only this time moves (ticked off, the next one counts from it).
function snoozeMin() { const m = Number(st.settings.todoSnoozeMinutes); return m > 0 ? m : 10; }
function todoSnoozable(t) { return !!t && !!t.due && t.due <= Date.now(); }
function snoozeBtn(t) { return `<button class="snooze" data-snooze="${esc(t.id)}" title="${_t('Snooze {n} min', { n: snoozeMin() })}">${fa('bell-slash')}</button>`; }
function snoozeTodo(id) {
  const items = (N.data.todo || {}).items || [];
  const t = items.find((x) => x.id === id);
  if (!t || t.done) return;
  const min = snoozeMin();
  N.saveStore('todo', { items: items.map((x) => (x.id === id ? { ...x, due: Date.now() + min * 60000, alerted: undefined } : x)) });
  for (let i = todoAlerts.length - 1; i >= 0; i--) if (todoAlerts[i].id === id) todoAlerts.splice(i, 1);
  st.activity = null;
  showActivity('toast', 1800, { icon: fa('bell-slash'), text: _t('Snoozed for {n} min', { n: min }), color: 'var(--orange)', side: 150 });
}
// when the water toast's check last logged a glass: its own toast says the goal, so health:goal stays quiet
let waterTickAt = 0;
async function logWater() {
  st.activity = null;
  waterTickAt = Date.now();
  const h = await api.svc('health', 'water', 1).catch(() => null);
  const day = h && h.today;
  const sub = day ? `${day.water}/${(h.goals || {}).water || ''}` : '';
  if (h && h.goalReached) { showActivity('toast', 3000, { icon: fa('glass-water'), text: _t('Water goal reached'), sub, color: '#64d2ff', side: 170 }); return; }
  showActivity('toast', 1800, { icon: fa('glass-water'), text: _t('+1 glass'), sub, color: '#64d2ff', side: 110 });
}

// "4:19", "Now", "5m late", "14:30" for a task's due time
function dueText(t) {
  const left = t.due - Date.now();
  if (Math.abs(left) <= 60000) return { text: _t('Now'), color: 'var(--orange)' };
  if (left < 0) return { text: _t('{n}m late', { n: Math.round(-left / 60000) }), color: 'var(--red)' };
  return { text: left < 3600000 ? fmt(left / 1000) : hm(t.due), color: '' };
}

// Open tasks with a time, soonest first (overdue ones stay up to 12 hours, until they're done).
function openTodos() { return (((window.N && N.data && N.data.todo) || {}).items || []).filter((t) => t.due && !t.done && !t.deletedAt); }
function dueTodos() {
  const from = Date.now() - 12 * 3600000;
  return openTodos().filter((t) => t.due > from).sort((a, b) => a.due - b.due);
}

// When a task comes due: alert once (remembered in the store, so a restart doesn't repeat it).
// Several due together are alerted one after another.
const todoAlerts = [];
function checkTodoDue() {
  if (!st.settings || !window.N || !N.saveStore) return;
  const now = Date.now();
  const due = openTodos().filter((t) => t.due <= now && !t.alerted).sort((a, b) => a.due - b.due);
  if (due.length) {
    const ids = new Set(due.map((t) => t.id));
    N.saveStore('todo', { items: N.data.todo.items.map((t) => (ids.has(t.id) ? { ...t, alerted: now } : t)) });
    if (st.open) toast(fa('clock', 'regular'), due.length > 1 ? _t('{n} tasks due now', { n: due.length }) : _t('Due now: {text}', { text: due[0].text }), { ms: 6000, color: 'var(--orange)' });
    else todoAlerts.push(...due);
    chime();
  }
  // late for longer than the task's own choice or Settings → Todo allows: ticked off by itself (a repeating
  // one comes back for its next time). Every notch window may do it; they save the same thing.
  {
    const stale = openTodos().filter((t) => { const m = N.todoLateMin(t); return m > 0 && t.due <= now - m * 60000; });
    if (stale.length) {
      let list = N.data.todo.items;
      for (const t of stale) list = N.todoDone(list, t.id, true);
      N.saveStore('todo', { items: list });
      for (let i = todoAlerts.length - 1; i >= 0; i--) if (stale.some((t) => t.id === todoAlerts[i].id)) todoAlerts.splice(i, 1);
    }
  }
  if (st.open) { todoAlerts.length = 0; return; }
  if (todoAlerts.length && !(st.activity && st.activity.until > now)) {
    showActivity('todo-alert', todoAlerts.length > 1 ? 7000 : 12000, todoAlerts.shift());
    bump();
  }
}
setInterval(checkTodoDue, 1500);

// ================================================================== animations: a done day (Settings → Animations)
// Celebrate a done day (fxCelebrate): the last task due today ticked off by hand (in the Todo tab, with the check in the
// closed notch, or by AI Chat): confetti bursts from Sympony and the Buddy hops with hearts. At most once a day, on the
// display that sees it first (remembered across restarts); not for tasks ticked off by themselves (Done if late), and
// unticking one and ticking it again doesn't start it over.
let doneDayOpen = null; // id → due of the open tasks seen last
let doneDayShown = '';
function doneDayCheck(v) {
  const items = (v && v.items) || [];
  const prev = doneDayOpen;
  doneDayOpen = new Map(items.filter((t) => !t.done && !t.deletedAt).map((t) => [t.id, t.due || 0]));
  const s = st.settings;
  if (!prev || !s || !s.fxCelebrate || st.hudOnly || st.unseen || leaveSt.out) return;
  const now = Date.now(); const day = startOfDay(now);
  const today = (due) => due >= day && due < day + DAY;
  if (!items.some((t) => t.done && !t.autoDone && today(prev.get(t.id)) && now - (t.doneAt || 0) < 10000)) return;
  if ([...doneDayOpen.values()].some(today)) return;
  let seen = doneDayShown;
  try { seen = localStorage.getItem('sympony.fxDoneDay') || seen; } catch (e) { /* storage off */ }
  if (seen === String(day)) return;
  doneDayShown = String(day);
  try { localStorage.setItem('sympony.fxDoneDay', doneDayShown); } catch (e) { /* storage off */ }
  celebrateDay();
}
window.addEventListener('load', () => { if (N.watch) N.watch('todo', doneDayCheck); });
// ~60 pieces in six colors burst from the bottom middle of Sympony (lower down in an open one), slowed by the air and
// drifting down, spinning and flipping, gone after 1.4–2.1 s; and the Buddy, if it's on, hops twice with hearts
function celebrateDay() {
  const b = notchEl.getBoundingClientRect();
  const ox = b.left + b.width / 2; const oy = Math.max(0, Math.min(b.bottom - 6, window.innerHeight - 230));
  const up = oy > 90; // room above it (the open Sympony): some go up first
  const COLORS = ['#ff9f2e', '#30d158', '#5ac8fa', '#ff453a', '#bf5af2', '#ffd60a'];
  const layer = document.createElement('div');
  layer.className = 'day-confetti';
  let longest = 0;
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    if (i % 4 === 3) p.className = 'dot';
    p.style.background = COLORS[i % COLORS.length];
    layer.appendChild(p);
    const a = (Math.random() * 2 - 1) * (up ? 2.2 : 1.35); // from straight down
    const v = 220 + Math.random() * 320; const vx = Math.sin(a) * v; const vy = Math.cos(a) * v;
    const tau = 0.3 + Math.random() * 0.12; const fall = 60 + Math.random() * 50; // the air slows it, then it drifts down
    const spin = (Math.random() * 2 - 1) * 720; const flip = 5 + Math.random() * 6; const sway = 3 + Math.random() * 7;
    const dur = 1400 + Math.random() * 700;
    longest = Math.max(longest, dur);
    const frames = [];
    for (let k = 0; k <= 14; k++) {
      const t = (k / 14) * dur / 1000; const slow = tau * (1 - Math.exp(-t / tau));
      const x = ox + vx * slow + Math.sin(t * flip) * sway; const y = oy + vy * slow + fall * (t - slow);
      frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg) scaleY(${Math.cos(t * flip).toFixed(2)})`,
        opacity: k > 10 ? (14 - k) / 4 : 1 });
    }
    p.animate(frames, { duration: dur, fill: 'forwards' });
  }
  document.body.appendChild(layer);
  // touchscreen mode: the window takes the burst's shape too while it's there
  outline.burst = { x: ox - 330, y: 0, w: 660, h: window.innerHeight };
  outlineSync();
  setTimeout(() => { layer.remove(); outline.burst = null; outlineSync(); }, longest + 50);
}

function activitySplit() {
  const list = persistentActivities();
  if (!list.length) { st.bubbleSwap = false; return { main: null, bubble: null }; }
  if (list.length === 1) { st.bubbleSwap = false; return { main: list[0], bubble: null }; }
  const kinds = list.map((a) => a.kind);
  const sp = window.NotchKit ? NotchKit.splitActivities(kinds, st.rotIdx) : { main: kinds[0], bubble: kinds[1] || null };
  let mainKind = sp.main;
  let bubbleKind = sp.bubble;
  if (st.bubbleSwap && bubbleKind) [mainKind, bubbleKind] = [bubbleKind, mainKind];
  // While hovered, keep the current main activity steady so the notch doesn't jump under the cursor
  if (st.hover && st.heldKind && kinds.includes(st.heldKind) && st.heldKind !== mainKind) {
    if (st.heldKind === bubbleKind) bubbleKind = mainKind;
    mainKind = st.heldKind;
  }
  const main = list.find((a) => a.kind === mainKind) || list[0];
  const bubble = bubbleKind ? list.find((a) => a.kind === bubbleKind) || null : null;
  if (!st.hover && main) st.heldKind = main.kind;
  return { main, bubble };
}

function voiceActive() {
  return !!(st.voice && st.voice.state && st.voice.state !== 'idle');
}

st.feedSum = null;
function feedSumActive() {
  return !!(st.feedSum && st.feedSum.active);
}
function setFeedSum(next) {
  st.feedSum = next && next.active ? { ...next } : null;
  renderClosed();
  layout();
}
function revealFeedSummary(title) {
  st.feedSum = null;
  st.ponyDoneUntil = Date.now() + 2800;
  if (st.hudOnly) { renderClosed(); layout(); return; }
  if (!st.open) {
    if (st.tucked) st.tucked = false;
    openNotch('feed');
    st.openedByShortcut = true;
    bump();
    later('close', 18000, () => {
      if (st.openedByShortcut && !st.hover && !st.typing) closeNotch();
    });
    return;
  }
  const activeMod = window.N && N.carousel && N.carousel.activeModule ? N.carousel.activeModule() : st.page;
  if (activeMod !== 'feed') {
    if (st.typing) {
      toast(fa('wand-magic-sparkles'), _t('Summary ready: {title}', { title: String(title || '').slice(0, 42) }), {
        ms: 6500, color: '#c084fc', side: 235, tab: 'feed',
      });
    } else {
      openNotch('feed');
      bump();
    }
  } else {
    syncPonyMood();
    outlineSync();
  }
}

function voiceFmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function voiceTailHtml(text, prevText) {
  const full = String(text || '').trim();
  if (!full) return '';
  const tail = full.length > 48 ? '…' + full.slice(-47) : full;
  const prev = String(prevText || '').trim();
  if (prev && full.startsWith(prev) && full.length > prev.length) {
    const addedLen = full.length - prev.length;
    const splitAt = Math.max(0, tail.length - addedLen);
    return `<span class="v-w-old">${esc(tail.slice(0, splitAt))}</span><span class="v-w-new">${esc(tail.slice(splitAt))}</span>`;
  }
  return `<span class="v-w-old">${esc(tail)}</span>`;
}

function voiceErrorLabel(err) {
  if (!err) return _t('Voice error');
  return _t(err);
}

function paintVoiceBars() {
  $$('.v-bars', notchEl).forEach((wrap) => {
    const count = wrap.children.length || 24;
    const bars = window.NotchKit && NotchKit.voiceBars ? NotchKit.voiceBars(st.voice.rms, count) : new Array(count).fill(0.08);
    const nodes = wrap.children;
    for (let i = 0; i < nodes.length && i < bars.length; i++) {
      nodes[i].style.transform = `scaleY(${bars[i].toFixed(3)})`;
    }
  });
}

function renderOpenVoice() {
  const el = $('#openVoice');
  if (!el) return;
  const v = st.voice;
  const active = !!(st.open && voiceActive());
  el.classList.toggle('show', active);
  el.classList.toggle('is-error', active && v.state === 'error');
  el.classList.toggle('is-done', active && v.state === 'done');
  if (!active) {
    delete el.dataset.ponyMood;
    return;
  }
  const showLive = !st.settings || st.settings.voiceLive !== false;
  const steerBadge = v.agent && v.steer ? `<span class="v-lang v-steer">${fa('route')} ${esc(_t('Steer'))}</span>` : '';
  const autoBadge = v.agent && !v.steer && v.autoUi ? `<span class="v-lang v-autoui">${fa('wand-magic-sparkles')} ${esc(_t('Auto UI'))}</span>` : '';
  const badge = `${steerBadge}${autoBadge}<span class="v-lang">${esc(v.agent ? 'Pony' : (v.lang || 'ID'))}</span>`;
  if (v.state === 'listening') {
    el.dataset.ponyMood = 'listening';
    const bars = window.NotchKit && NotchKit.voiceBars ? NotchKit.voiceBars(v.rms, 12) : new Array(12).fill(0.08);
    const barsHtml = bars.map((b) => `<i style="transform:scaleY(${b.toFixed(3)})"></i>`).join('');
    el.innerHTML = `<div class="ov-top">${ponyEyeHtml('listening', 2)}<span class="v-dot" role="status" aria-label="${esc(_t('Microphone active'))}"></span><span class="v-time clk">${esc(voiceFmtTime(Date.now() - v.since))}</span><div class="v-bars ov-bars" aria-hidden="true">${barsHtml}</div>${badge}</div>`
      + (showLive ? `<div class="v-live" dir="auto">${voiceTailHtml(v.partial, v.prevPartial)}</div>` : '');
  } else if (v.state === 'transcribing') {
    el.dataset.ponyMood = 'think';
    const lbl = v.agent ? _t('Sending to Pony…') : _t('Writing…');
    el.innerHTML = `<div class="ov-top">${ponyEyeHtml('think', 2)}<span class="v-spin-dot"></span><span class="v-status-lbl">${esc(lbl)}</span><div class="v-shimmer" style="flex:1;min-width:60px" aria-hidden="true"><i></i></div>${badge}</div>`
      + (showLive && v.partial ? `<div class="v-live dim" dir="auto">${voiceTailHtml(v.partial, '')}</div>` : '');
  } else if (v.state === 'done') {
    el.dataset.ponyMood = 'done';
    el.innerHTML = `<div class="ov-top">${ponyEyeHtml('done', 2)}<span class="v-done-ico">${fa('check')}</span><span class="v-status-lbl">${esc(_t('Inserted'))}</span>${badge}</div>`
      + (v.text ? `<div class="v-done-text" dir="auto">${esc(v.text)}</div>` : '');
  } else if (v.state === 'error') {
    delete el.dataset.ponyMood;
    const actLabel = v.action === 'download' ? _t('Download') : v.action === 'mic' ? _t('Open Settings') : '';
    const actBtn = actLabel ? `<button class="btn primary" data-voice-action="${esc(v.action)}">${esc(actLabel)}</button>` : '';
    el.innerHTML = `<div class="ov-top"><span class="v-err-ico">${fa('circle-exclamation')}</span><span class="v-err-text">${esc(voiceErrorLabel(v.error))}</span>${actBtn}</div>`;
    $$('[data-voice-action]', el).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.voiceAction;
        if (a === 'download') { api.openSettings('voice'); }
        else if (a === 'mic') { api.svc('perm', 'request', 'microphone').catch(() => {}); }
      };
    });
  }
}

let voiceClockIv = null;
function stopVoiceClock() {
  if (voiceClockIv) { clearInterval(voiceClockIv); voiceClockIv = null; }
}
function startVoiceClock() {
  stopVoiceClock();
  voiceClockIv = setInterval(() => {
    if (!st.voice || st.voice.state !== 'listening') { stopVoiceClock(); return; }
    const txt = voiceFmtTime(Date.now() - st.voice.since);
    $$('.v-time', notchEl).forEach((el) => { el.textContent = txt; });
  }, 250);
}

api.on('voice:state', (d) => {
  const info = d || {};
  const next = info.state || 'idle';
  cancel('voiceDone');
  if (next === 'listening') {
    cancel('close');
    notchEl.style.setProperty('--v-energy', '0');
    st.voice = {
      state: 'listening',
      agent: !!info.agent,
      autoUi: !!info.autoUi,
      steer: !!info.steer,
      since: Date.now(),
      lang: (info.lang || (st.settings && st.settings.voiceLanguage) || 'id').toUpperCase(),
      partial: '',
      prevPartial: '',
      text: '',
      error: '',
      action: null,
      rms: [],
    };
    startVoiceClock();
    renderClosed(true);
    renderOpenVoice();
    layout();
  } else if (next === 'transcribing') {
    stopVoiceClock();
    notchEl.style.setProperty('--v-energy', '0');
    st.voice.state = 'transcribing';
    renderClosed(true);
    renderOpenVoice();
    layout();
  } else if (next === 'done') {
    stopVoiceClock();
    notchEl.style.setProperty('--v-energy', '0');
    st.voice.state = 'done';
    if (info.text != null) st.voice.text = String(info.text);
    renderClosed(true);
    renderOpenVoice();
    layout();
    later('voiceDone', 1200, () => {
      if (st.voice.state === 'done') {
        st.voice.state = 'idle';
        renderClosed(true);
        renderOpenVoice();
        layout();
      }
    });
  } else if (next === 'error') {
    stopVoiceClock();
    notchEl.style.setProperty('--v-energy', '0');
    st.voice.state = 'error';
    st.voice.error = String(info.error || 'Voice error');
    st.voice.action = info.action || null;
    renderClosed(true);
    renderOpenVoice();
    layout();
    later('voiceDone', 3500, () => {
      if (st.voice.state === 'error') {
        st.voice.state = 'idle';
        renderClosed(true);
        renderOpenVoice();
        layout();
      }
    });
  } else if (next === 'cancelled' || next === 'idle') {
    stopVoiceClock();
    notchEl.style.setProperty('--v-energy', '0');
    if (st.voice.state !== 'done' || next === 'cancelled') {
      st.voice.state = 'idle';
      st.voice.partial = '';
      st.voice.text = '';
      st.voice.error = '';
      st.voice.action = null;
      st.voice.rms = [];
      renderClosed(true);
      renderOpenVoice();
      layout();
    }
  }
});

api.on('voice:level', (d) => {
  if (!st.voice || st.voice.state !== 'listening') return;
  const r = d && typeof d.rms === 'number' ? d.rms : 0;
  st.voice.rms.push(r);
  if (st.voice.rms.length > 24) st.voice.rms.shift();
  const energy = Math.min(1, Math.pow(Math.min(1, Math.max(0, r) * 5.0), 0.65));
  notchEl.style.setProperty('--v-energy', energy.toFixed(3));
  paintVoiceBars();
});

api.on('voice:partial', (d) => {
  if (!st.voice || st.voice.state !== 'listening') return;
  const txt = d && d.text ? String(d.text) : '';
  if (!txt || txt === st.voice.partial) return;
  st.voice.prevPartial = st.voice.partial;
  st.voice.partial = txt;
  const html = voiceTailHtml(st.voice.partial, st.voice.prevPartial);
  $$('.v-live', notchEl).forEach((liveEl) => { liveEl.innerHTML = html; });
});

api.on('voice:result', (d) => {
  if (!d) return;
  st.voice.text = String(d.text || '');
});

api.on('voice:command', (d) => {
  const txt = d && d.text ? String(d.text).trim() : '';
  const isStop = !!(d && d.stop);
  const isSteer = !!(d && d.steer);
  const chat = window.N && N.chat;
  const chatBusy = !!(chat && typeof chat.pending === 'function' && chat.pending());

  // Live voice stop or mid-run steering: keep the screen unobstructed (don't yank the Notch open)
  if (isStop) {
    if (chatBusy && typeof chat.stop === 'function') chat.stop();
    return;
  }
  if (isSteer) {
    if (txt && chatBusy && typeof chat.steer === 'function') {
      chat.steer(txt, { alreadySent: !!(d && d.steeredSession), session: (d && d.steeredSession) || '' });
    }
    return;
  }

  stopVoiceClock();
  notchEl.style.setProperty('--v-energy', '0');
  if (st.voice) {
    st.voice.state = 'idle';
    st.voice.partial = '';
    st.voice.rms = [];
  }
  renderOpenVoice();
  if (!txt) { renderClosed(true); layout(); return; }
  openNotch('chat');
  setTimeout(() => {
    if (window.N && N.chat && typeof N.chat.send === 'function') {
      // (if a run started in the meantime, route as live steer instead of dropping the voice command)
      if (typeof N.chat.pending === 'function' && N.chat.pending() && typeof N.chat.steer === 'function') {
        N.chat.steer(txt);
        return;
      }
      // (with Eyes on, pass front-window hint silently in context so Pony uses screen_read only when user intent refers to the screen)
      const sc = d.screen;
      const screenContext = sc && sc.app
        ? `Background hint (not an attached file; ignore unless the user's intent actually refers to their screen): the app in front when they spoke was ${sc.app}${sc.title ? ` — "${sc.title}"` : ''}.`
        : '';
      const sendOpts = {};
      if (screenContext) sendOpts.screenContext = screenContext;
      if (typeof d.autoUi === 'boolean') sendOpts.autoUi = d.autoUi;
      N.chat.send(txt, sendOpts);
    } else {
      const inp = $('#page-chat textarea, #page-chat input[type="text"]');
      if (inp) { inp.value = txt; inp.focus(); }
    }
  }, 80);
});

function currentActivity() {
  // in over a fullscreen app for a HUD: that HUD alone, the last one while Sympony slides away again
  if (st.hudOnly) return st.hudLast || null;
  if (voiceActive()) return { kind: 'voice', data: st.voice };
  const now = Date.now();
  if (st.activity && st.activity.until > now) return st.activity;
  return activitySplit().main;
}

function bubbleActivity() {
  if (st.open || st.hudOnly || teleStrip() || voiceActive()) return null;
  if (st.activity && st.activity.until > Date.now()) return null;
  if (st.settings && st.settings.shellForm === 'drawer') return null;
  return activitySplit().bubble;
}

function musicMiniArt(m) {
  const paused = m.playing ? '' : 'paused';
  const fallbackTile = `<span class="mini-art mini-art-app ${paused}">${m.radio ? fa('radio') : ICONS.music}</span>`;
  const artHtml = m.artwork
    ? `<img class="mini-art ${paused}" src="${esc(m.artwork)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="mini-art mini-art-app ${paused}" style="display:none">${m.radio ? fa('radio') : ICONS.music}</span>`
    : fallbackTile;
  const badgeHtml = (m.appIcon || m.artwork)
    ? `<span class="mini-art-badge">${appIconImg(m.appIcon, 13, 3.5, m.radio ? fa('radio') : fa('music'))}</span>`
    : '';
  return `<span class="mini-art-wrap">${artHtml}${badgeHtml}</span>`;
}

function renderBubble(act) {
  if (!bubbleEl) return;
  if (!act) { bubbleEl.innerHTML = ''; return; }
  let html = '';
  switch (act.kind) {
    case 'pomodoro': {
      const p = st.pomodoro || {};
      const left = Math.max(0, (p.endsAt || 0) - Date.now());
      const pct = p.total ? Math.round((1 - left / p.total) * 100) : 0;
      html = ring(pct, p.phase === 'work' ? 'var(--red)' : 'var(--emerald)', 18, 14);
      break;
    }
    case 'timer': {
      const leftMs = N.timerLeft ? N.timerLeft(st.timer) : 0;
      const totalMs = (st.timer && st.timer.total) || leftMs || 1;
      const pct = Math.round((1 - leftMs / totalMs) * 100);
      html = ring(pct, 'var(--red)', 18, 14);
      break;
    }
    case 'stopwatch':
      html = `<span style="color:var(--amber);font-size:12px">${fa('stopwatch')}</span>`;
      break;
    case 'music':
      html = musicMiniArt(st.media);
      break;
    case 'prayer-soon':
    case 'adhan':
      html = `<span style="color:var(--emerald);font-size:12px">${fa('moon')}</span>`;
      break;
    case 'event-soon':
      html = `<span style="color:var(--sky);font-size:12px">${ICONS.calendar}</span>`;
      break;
    case 'todo-due':
    case 'todo-sum':
      html = `<span style="color:var(--amber);font-size:12px">${fa('clock', 'regular')}</span>`;
      break;
    default:
      html = `<span style="color:var(--dim);font-size:12px">${fa('circle-dot')}</span>`;
  }
  if (bubbleEl.innerHTML !== html) bubbleEl.innerHTML = html;
}

if (bubbleEl) {
  bubbleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!bubbleActivity()) return;
    st.bubbleSwap = !st.bubbleSwap;
    st.heldKind = null;
    renderClosed(true);
    layout();
  });
}

setInterval(() => {
  // (not while it has stepped aside either: a new size could move its spot from under the mouse)
  if (st.open || !st.settings || !st.settings.liveRotate || st.hover || steppedAside()) return;
  const list = persistentActivities();
  if (list.length > 2 && !(st.activity && st.activity.until > Date.now())) { st.rotIdx++; renderClosed(true); layout(); }
}, 6000);

// Pomodoro / countdown text refresh in the closed notch.
setInterval(() => {
  prayerWatch();
  if (st.open || !st.settings) return;
  const act = currentActivity();
  const bb = bubbleActivity();
  if ((act && ['pomodoro', 'stopwatch', 'timer', 'sys', 'fps', 'event-soon', 'todo-due', 'todo-sum', 'prayer-soon'].includes(act.kind))
    || (bb && ['pomodoro', 'timer', 'stopwatch'].includes(bb.kind))) renderClosed();
  // a countdown whose time came (the prayer's, an event's) leaves the list: what shows instead is drawn now, rather
  // than the countdown staying at 0:00 until something else draws the closed notch (GitHub #60)
  else if (closedStateKeyOf(act) !== lastActKey) { renderClosed(true); layout(); }
  // an alert with a check waits while the mouse is on it
  if (st.hover) holdAlert(1500);
  // the System summary (and the FPS line) may need more room as its numbers change
  if (act && (act.kind === 'sys' || act.kind === 'fps')) layout();
}, 1000);

function showMiniControls() {
  return st.hover && st.settings.hoverMediaControls && !st.settings.openOnHover && st.media.active;
}

function ponyReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ponyIdleOn() {
  return !!(st.settings && st.settings.ponyFace && !st.open && !currentActivity() && !notifShowing() && !claudeShowing() && !st.hudOnly);
}

function currentPonyMood() {
  if (!window.NotchKit || !NotchKit.ponyMood) return 'idle';
  const now = Date.now();
  const voiceDone = st.voice && st.voice.state === 'done' ? now + 1000 : 0;
  return NotchKit.ponyMood({
    asking: !!(st.ponyAsking || (st.claude && st.claude.some((c) => c.source === 'pony'))),
    cardWaiting: !!(st.claude && st.claude.length > 0),
    listening: !!(st.voice && st.voice.state === 'listening'),
    thinking: !!((st.voice && st.voice.state === 'transcribing') || feedSumActive() || (window.N && N.chat && N.chat.pending && N.chat.pending())),
    doneUntil: Math.max(st.ponyDoneUntil || 0, voiceDone),
    now,
    playing: !!(st.media && st.media.playing),
    idleMs: st.ponyIdleMs || 0,
    locked: !!st.locked,
  });
}

function ponyLook() {
  return window.Pony && window.Pony.look
    ? window.Pony.look(st.settings)
    : { shape: 'Classic', color: 'Lavender', name: 'Pony', persona: 'friendly' };
}

function ponyEyeHtml(mood, count) {
  let glyph;
  if (mood === 'sleep') {
    glyph = '<svg class="eye-arc" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 6.5Q7 11 12 6.5" stroke="#d6fbff" stroke-width="2.2" stroke-linecap="round"/></svg>';
  } else if (mood === 'done' || mood === 'music') {
    glyph = '<svg class="eye-arc" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 8.5Q7 2.8 12 8.5" stroke="#d6fbff" stroke-width="2.2" stroke-linecap="round"/></svg>';
  } else {
    glyph = '<i class="eye"></i>';
  }
  const badge = mood === 'sleep' && count === 2
    ? '<span class="pony-zzz" aria-hidden="true">z</span>'
    : mood === 'music' && count === 2
      ? '<span class="pony-note" aria-hidden="true">♪</span>'
      : '';
  return `<span class="eyew${count === 1 ? ' one' : ''}">${count === 2 ? glyph + glyph : glyph}${badge}</span>`;
}

// Pony peek host under the closed notch
let ponyPeekShown = false;
let ponyPeekByCursor = false;
let ponyPeekTimer = null;
let ponyPeekHandle = null;
let lastPonyMood = 'idle';

function canPonyPeek() {
  const s = st.settings;
  if (!s || s.ponyPeek === false || ponyReducedMotion()) return false;
  if (st.open || st.hudOnly || claudeShowing() || notifShowing()) return false;
  if (st.shell === 'hidden' || st.shell === 'tuck' || st.shell === 'aside' || st.shell === 'handle') return false;
  return true;
}

function ensurePonyPeekHandle() {
  if (ponyPeekHandle) return ponyPeekHandle;
  const cv = $('#ponyPeekCanvas');
  if (!cv || !window.Pony) return null;
  const lk = ponyLook();
  ponyPeekHandle = window.Pony.mount(cv, {
    scale: 0.96,
    shape: lk.shape,
    color: lk.color,
    mood: currentPonyMood(),
    floorFrac: 0.80,
  });
  const host = $('#ponyPeek');
  if (host) {
    host.onclick = (e) => {
      e.stopPropagation();
      if (ponyPeekHandle) ponyPeekHandle.poke();
      openNotch('chat');
    };
  }
  return ponyPeekHandle;
}

function showPonyPeek(ms = 3000, byCursor = false) {
  if (!canPonyPeek()) return false;
  const host = $('#ponyPeek');
  if (!host) return false;
  const handle = ensurePonyPeekHandle();
  const lk = ponyLook();
  if (handle) {
    if (handle.resume) handle.resume();
    handle.setLook(lk.shape, lk.color);
    handle.setMood(currentPonyMood());
  }
  const was = ponyPeekShown;
  ponyPeekShown = true;
  ponyPeekByCursor = !!byCursor;
  host.classList.add('show');
  host.setAttribute('aria-hidden', 'false');
  if (ponyPeekTimer) clearTimeout(ponyPeekTimer);
  if (ms > 0) {
    ponyPeekTimer = setTimeout(() => {
      ponyPeekTimer = null;
      hidePonyPeek();
    }, ms);
  }
  if (!was) layout();
  return true;
}

function hidePonyPeek(skipLayout) {
  if (ponyPeekTimer) { clearTimeout(ponyPeekTimer); ponyPeekTimer = null; }
  if (ponyPeekHandle && ponyPeekHandle.pause) ponyPeekHandle.pause();
  const host = $('#ponyPeek');
  const was = ponyPeekShown;
  ponyPeekShown = false;
  ponyPeekByCursor = false;
  if (host) {
    host.classList.remove('show');
    host.setAttribute('aria-hidden', 'true');
  }
  if (was && !skipLayout) layout();
}

function syncPonyMood() {
  const mood = currentPonyMood();
  const closed = $('#closed');
  if (closed) closed.dataset.ponyMood = mood;
  if (notchEl) notchEl.dataset.ponyMood = mood;
  const lk = ponyLook();
  if (ponyPeekHandle) {
    ponyPeekHandle.setLook(lk.shape, lk.color);
    ponyPeekHandle.setMood(mood);
  }
  if (!canPonyPeek()) {
    if (ponyPeekShown) hidePonyPeek();
  } else if (mood !== lastPonyMood) {
    if (mood === 'done') showPonyPeek(3000, false);
    else if (mood === 'attention' && !claudeShowing()) showPonyPeek(3000, false);
  }
  if (mood !== lastPonyMood) window.dispatchEvent(new CustomEvent('pony:mood', { detail: mood })); // (the composer's Pony)
  lastPonyMood = mood;
}

// Rust-side cursor polling (hover.rs) drives peek even while the window ignores mouse events outside the hit rect
api.on('pony:near', (near) => {
  if (near) {
    showPonyPeek(3000, true);
  } else if (ponyPeekShown && ponyPeekByCursor) {
    hidePonyPeek();
  }
});

document.addEventListener('pointermove', (e) => {
  if (!st.box || !canPonyPeek()) {
    if (ponyPeekShown) hidePonyPeek();
    return;
  }
  const nearY = e.clientY >= st.box.bottom - 10 && e.clientY <= st.box.bottom + 60;
  const nearX = e.clientX >= st.box.left - 40 && e.clientX <= st.box.right + 40;
  if (nearY && nearX) {
    showPonyPeek(3000, true);
    if (ponyPeekHandle) {
      const cx = (st.box.left + st.box.right) / 2;
      ponyPeekHandle.lookAt((e.clientX - cx) / 100, (e.clientY - (st.box.bottom + 14)) / 60);
    }
  } else if (ponyPeekShown && ponyPeekByCursor) {
    hidePonyPeek();
  }
});
document.addEventListener('pointerleave', () => {
  if (ponyPeekShown && ponyPeekByCursor) hidePonyPeek();
});

let lastActKey = '';
let lastClosedL = null;
let lastClosedM = null;
let lastClosedR = null;
let lastClosedB = null;
// what the closed notch shows, as renderClosed keys it: the activity's kind (and a toast's text)
const actKey = (act) => (act ? act.kind + (act.data && act.data.text ? act.data.text : '') : '');
function closedStateKeyOf(act) {
  const args = {
    actKey: actKey(act),
    claude: claudeShowing(),
    notif: notifShowing(),
    ponyMood: ponyIdleOn() ? currentPonyMood() : '',
  };
  return window.NotchKit && typeof NotchKit.closedStateKey === 'function'
    ? NotchKit.closedStateKey(args)
    : args.actKey + (args.claude ? '|cc' : '') + (args.notif ? '|nf' : '') + (args.ponyMood ? `|pony:${args.ponyMood}` : '');
}
function renderClosed(animate) {
  const left = $('#closedLeft');
  const mid = $('#closedMid');
  const right = $('#closedRight');
  const belowEl = $('#below');
  const act = st.open ? null : currentActivity();
  const cam = !!camera();
  notchEl.classList.toggle('cam', cam);
  let L = ''; let M = ''; let R = ''; let B = ''; let belowMeta = null; let panel = '';
  if (act) {
    switch (act.kind) {
      case 'music': {
        const m = st.media;
        L = musicMiniArt(m);
        if (!cam && !lyricsInline() && m.title) M = `<span class="clk c-title" dir="auto">${esc(m.title)}</span>`;
        R = showMiniControls()
          ? `<div class="mini-ctl"><button data-a="prev">${ICONS.prev}</button><button data-a="toggle">${m.playing ? ICONS.pause : ICONS.play}</button><button data-a="next">${ICONS.next}</button></div>`
          : vizMarkup(m.playing);
        break;
      }
      case 'hud-volume': {
        const v = st.volume || { level: 0, muted: false };
        const lvl = v.muted ? 0 : v.level;
        const ico = v.muted || lvl === 0 ? ICONS.volMute : lvl < 34 ? ICONS.volLow : lvl < 67 ? ICONS.volMid : ICONS.volHigh;
        if (st.settings.hudStyle === 'panel') { L = `<div class="act-icon">${ico}</div>`; panel = hudPanel('volume', lvl); } else {
          L = `<div class="act-icon">${ico}</div><span class="act-text act-dim">${v.muted ? _t('Muted') : _t('Volume')}</span>`;
          R = `<div class="hud-bar"><div style="width:${lvl}%"></div></div><span class="hud-pct">${lvl}</span>`;
        }
        break;
      }
      case 'hud-brightness': {
        const lvl = st.brightness ? st.brightness.level : 0;
        const ico = lvl < 40 ? ICONS.sunDim : ICONS.sun;
        if (st.settings.hudStyle === 'panel') { L = `<div class="act-icon">${ico}</div>`; panel = hudPanel('brightness', lvl); } else {
          L = `<div class="act-icon">${ico}</div><span class="act-text act-dim">${_t('Brightness')}</span>`;
          R = `<div class="hud-bar"><div style="width:${lvl}%"></div></div><span class="hud-pct">${lvl}</span>`;
        }
        break;
      }
      case 'hud-lock': {
        const { key, on } = act.data;
        L = `<div class="act-icon">${lockIcon(key)}</div>`;
        if (st.settings.hudStyle === 'panel') panel = `<div class="hud-panel" data-kind="lock"><span class="act-text">${LOCK_NAMES[key]}</span>${lockState(on)}</div>`;
        else { L += `<span class="act-text">${LOCK_NAMES[key]}</span>`; R = lockState(on); }
        break;
      }
      case 'hud-switch': {
        const { icon, text, state } = act.data;
        L = `<div class="act-icon">${icon}</div>`;
        if (st.settings.hudStyle === 'panel') panel = `<div class="hud-panel" data-kind="lock"><span class="act-text">${text}</span>${state}</div>`;
        else { L += `<span class="act-text">${text}</span>`; R = state; }
        break;
      }
      case 'hud-lang': {
        const { code, text } = act.data;
        L = `<div class="act-icon">${fa('keyboard')}</div>`;
        if (st.settings.hudStyle === 'panel') panel = `<div class="hud-panel" data-kind="lock"><span class="act-text">${esc(text)}</span>${langChip(code)}</div>`;
        else { L += `<span class="act-text">${esc(text)}</span>`; R = langChip(code); }
        break;
      }
      case 'hud-airplane': {
        const { on, marks } = act.data;
        L = `<div class="act-icon">${fa('plane')}</div>`;
        if (st.settings.hudStyle === 'panel') panel = `<div class="hud-panel" data-kind="lock"><span class="act-text">${_t('Airplane mode')}</span><span class="ap-end">${lockState(on)}<span class="ap-radios">${marks}</span></span></div>`;
        else { L += `<span class="act-text">${_t('Airplane mode')}</span>`; R = `${lockState(on)}<span class="ap-radios">${marks}</span>`; }
        break;
      }
      case 'charging':
      case 'unplugged':
      case 'battery-low': {
        const lvl = st.power ? st.power.level : 0;
        const charging = act.kind === 'charging';
        const col = charging ? 'var(--emerald)' : meter(lvl, true);
        const ico = act.kind === 'unplugged' ? ICONS.plug : ICONS.bolt;
        const title = charging ? _t('Charging') : act.kind === 'battery-low' ? _t('Low battery') : _t('On battery');
        const sub = charging && lvl >= 100 ? _t('Fully charged') : `${lvl}%`;
        L = `<div class="act-icon" style="color:${col}">${ico}</div>`;
        R = ring(lvl, col, 18, 14);
        B = `<span class="medal" style="color:${col};background:var(--pill-hi)">${ico}</span><div class="al-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></div>${ring(lvl, col, 38, 11, `<span class="n" style="font-size:11px">${lvl}</span>`)}`;
        belowMeta = { extra: 60, wide: 420 };
        break;
      }
      case 'meeting': {
        const ev = act.data;
        const mins = Math.max(0, Math.ceil((ev.start - Date.now()) / 60000));
        const col = esc(ev.color || 'var(--sky)');
        const when = mins <= 0 ? _t('Now') : fmtIn(mins);
        L = `<div class="act-icon" style="color:${col}">${ICONS.calendar}</div>`;
        R = `<span class="clk" style="color:${mins <= 1 ? 'var(--red)' : 'var(--dim)'};font-size:12px">${esc(when)}</span>`;
        B = `<span class="medal" style="color:${col};background:var(--pill-hi)">${ICONS.calendar}</span><div class="al-txt"><b>${esc(ev.title)}</b><small>${esc(hm(ev.start))} · ${esc(when)}</small></div>`;
        belowMeta = { extra: 60, wide: 420 };
        break;
      }
      case 'event-soon': {
        const ev = act.data;
        const mins = Math.max(0, Math.ceil((ev.start - Date.now()) / 60000));
        L = `<div class="act-icon" style="color:${esc(ev.color || 'var(--sky)')}">${ICONS.calendar}</div><span class="act-text" style="max-width:96px">${esc(ev.title)}</span>`;
        R = `<span class="act-text ${mins <= 1 ? 'red' : 'act-dim'}">${mins <= 0 ? _t('Now') : fmtIn(mins)}</span>`;
        break;
      }
      case 'pomodoro': {
        const p = st.pomodoro;
        const left = Math.max(0, p.endsAt - Date.now());
        const work = p.phase === 'work';
        const pct = p.total ? Math.round((1 - left / p.total) * 100) : 0;
        L = ring(pct, work ? 'var(--red)' : 'var(--emerald)', 18, 14);
        R = `<span class="clk" style="color:${work ? '#ff7a73' : 'var(--emerald)'}">${fmt(left / 1000)}</span>`;
        break;
      }
      case 'stopwatch':
        L = `<div class="act-icon" style="color:var(--amber)">${fa('stopwatch')}</div>`;
        R = `<span class="clk">${esc(N.swText(N.swElapsed(), false))}</span>`;
        break;
      case 'timer': {
        const leftMs = N.timerLeft ? N.timerLeft(st.timer) : 0;
        const totalMs = (st.timer && st.timer.total) || leftMs || 1;
        const pct = Math.round((1 - leftMs / totalMs) * 100);
        L = ring(pct, 'var(--red)', 18, 14);
        R = `<span class="clk" style="color:#ff7a73">${fmt(Math.ceil(leftMs / 1000))}</span>`;
        break;
      }
      case 'fps': {
        const s = st.stats || {};
        const f = act.data;
        const col = f.fps >= 55 ? 'var(--emerald)' : f.fps >= 30 ? 'var(--orange)' : 'var(--red)';
        L = `<span class="sys-it fps-it" title="${esc(f.app || _t('Game'))} · ${_t('frames per second')}"><em>FPS</em><b style="color:${col}">${Math.round(f.fps)}</b></span>`;
        R = sysText('CPU', sysPct('cpu'), SYS_TITLE.cpu, s.temp && s.temp.c) + (s.gpu ? sysText('GPU', sysPct('gpu'), SYS_TITLE.gpu, s.gpu.c) : '');
        break;
      }
      case 'sys': {
        const s = st.stats || {};
        L = ['cpu', 'gpu', 'ram', 'disk'].filter((k) => k !== 'gpu' || s.gpu)
          .map((k) => sysText(SYS_LABEL[k], sysPct(k), SYS_TITLE[k], k === 'cpu' ? s.temp && s.temp.c : k === 'gpu' ? s.gpu.c : null)).join('');
        R = `<span class="sys-it" title="${_t('Download')}">↓${netRate(hist.rx)}</span><span class="sys-it" title="${_t('Upload')}">↑${netRate(hist.tx)}</span>${signalText()}`;
        break;
      }
      case 'todo-due': {
        const t = act.data;
        const d = dueText(t);
        L = `<div class="act-icon" style="color:${d.color === 'var(--red)' ? d.color : 'var(--amber)'}">${fa('clock', 'regular')}</div><span class="act-text" style="max-width:110px">${esc(t.text)}</span>`;
        R = `<span class="${d.color ? 'act-text' : 'act-num'}" style="color:${d.color || 'inherit'}">${esc(d.text)}</span>`
          + (todoTickable(t) ? `<div class="mini-ctl">${todoSnoozable(t) ? snoozeBtn(t) : ''}<button class="tick" data-todo="${esc(t.id)}" title="${_t('Mark as done')}">${fa('check')}</button></div>` : '');
        break;
      }
      case 'todo-alert': {
        const t = act.data;
        L = `<div class="act-icon" style="color:var(--amber)">${fa('clock', 'regular')}</div>`;
        R = `<span class="clk" style="color:var(--amber);font-size:12px">${_t('Now')}</span>`;
        B = `<span class="medal" style="color:var(--amber);background:rgba(251,191,36,.14)">${fa('clock', 'regular')}</span><div class="al-txt"><b>${esc(t.text)}</b><small>${_t('Now')}</small></div>`
          + `${todoSnoozable(t) ? `<button class="btn" data-snooze="${esc(t.id)}">${_t('Snooze')}</button>` : ''}`
          + `<button class="btn primary" data-todo="${esc(t.id)}">${_t('Done')}</button>`;
        belowMeta = { extra: 60, wide: 440 };
        break;
      }
      case 'todo-sum': {
        const d = dueText(act.data[0]);
        L = `<div class="act-icon" style="color:var(--amber)">${fa('clock', 'regular')}</div><span class="act-text">${_t('{n} tasks', { n: act.data.length })}</span>`;
        R = `<span class="${d.color ? 'act-text' : 'act-num'}" style="color:${d.color || 'inherit'}">${esc(d.text)}</span>`;
        break;
      }
      case 'adhan':
      case 'prayer': {
        const t = act.data;
        const sun = t.key === 'sunrise';
        const col = sun ? 'var(--orange)' : 'var(--emerald)';
        const bg = sun ? 'rgba(255,159,10,.14)' : 'rgba(74,222,128,.14)';
        const ico = sun ? fa('sun') : fa('moon');
        const city = (st.prayer && st.prayer.city) || '';
        L = `<div class="act-icon" style="color:${col}">${ico}</div>`;
        R = `<span class="clk">${esc(hm(t.at))}</span>`;
        const sub = [city, act.kind === 'adhan' ? _t('Adhan') : _t('Now')].filter(Boolean).join(' · ');
        const tail = act.kind === 'adhan'
          ? `<button class="btn primary" data-adhan="stop">${_t('Stop')}</button>`
          : `<span class="n" style="font-size:24px">${esc(hm(t.at))}</span>`;
        B = `<span class="medal" style="color:${col};background:${bg}">${ico}</span><div class="al-txt"><b>${esc(prayerName(t.name))}</b><small>${esc(sub)}</small></div>${tail}`;
        belowMeta = { extra: 60, wide: 420 };
        break;
      }
      case 'prayer-soon': {
        const t = act.data;
        const sun = t.key === 'sunrise';
        const col = sun ? 'var(--orange)' : 'var(--emerald)';
        const ico = sun ? fa('sun') : fa('moon');
        if (st.activity === act) {
          const mins = Math.max(1, Math.ceil(Math.max(0, t.at - Date.now()) / 60000));
          const city = (st.prayer && st.prayer.city) || '';
          const sub = [city, _t('in {n} min', { n: mins })].filter(Boolean).join(' · ');
          L = `<div class="act-icon" style="color:${col}">${ico}</div>`;
          R = `<span class="clk">${esc(hm(t.at))}</span>`;
          B = `<span class="medal" style="color:${col};background:${sun ? 'rgba(255,159,10,.14)' : 'rgba(74,222,128,.14)'}">${ico}</span><div class="al-txt"><b>${esc(_t('{prayer} soon', { prayer: prayerName(t.name) }))}</b><small>${esc(sub)}</small></div><span class="n" style="font-size:24px">${esc(hm(t.at))}</span>`;
          belowMeta = { extra: 60, wide: 420 };
        } else {
          L = `<div class="act-icon" style="color:${col}">${ico}</div><span class="act-text">${esc(prayerName(t.name))}</span>`;
          R = `<span class="clk">${fmt(Math.ceil(Math.max(0, t.at - Date.now()) / 1000))}</span>`;
        }
        break;
      }
      case 'shelf':
        L = `<div class="act-icon">${ICONS.tray}</div>`;
        R = `<span class="act-text">${act.data === 1 ? _t('{n} item', { n: act.data }) : _t('{n} items', { n: act.data })}</span>`;
        break;
      case 'toast': {
        const d = act.data;
        if (d.device) {
          const dev = d.device;
          const hasBat = typeof dev.battery === 'number' && dev.battery >= 0;
          const col = hasBat ? meter(dev.battery, true) : '#fff';
          L = `<div class="act-icon" style="color:#fff">${d.icon}</div>`;
          R = hasBat ? ring(dev.battery, col, 18, 14) : `<span class="act-text act-dim">${esc(d.sub || '')}</span>`;
          B = `<span class="medal" style="color:#fff;background:var(--pill-hi)">${d.icon}</span><div class="al-txt"><b>${esc(d.text)}</b><small>${esc(d.sub || '')}</small></div>${hasBat ? ring(dev.battery, col, 38, 11, `<span class="n" style="font-size:11px">${dev.battery}</span>`) : ''}`;
          belowMeta = { extra: 60, wide: 420 };
        } else if (d.timer || d.tick) {
          const col = esc(d.color || '#fff');
          L = `<div class="act-icon" style="color:${col}">${d.icon}</div>`;
          R = d.sub ? `<span class="clk" style="color:var(--dim);font-size:12px">${esc(d.sub)}</span>` : '';
          let btns = '';
          if (d.tick) btns += `<button class="btn primary" data-tick="${esc(d.tick)}">${fa('check')} ${_t('Done')}</button>`;
          if (d.timer) btns += `<button class="btn" data-timer="add">${_t('+{n} min', { n: 5 })}</button><button class="btn primary" data-timer="done">${_t('Done')}</button>`;
          B = `<span class="medal" style="color:${col};background:var(--pill-hi)">${d.icon}</span><div class="al-txt"><b>${esc(d.text)}</b>${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</div>${btns}`;
          belowMeta = { extra: 60, wide: 440 };
        } else {
          L = `<div class="act-icon" style="color:${esc(d.color || 'inherit')}">${d.icon}</div><span class="act-text" style="max-width:${(d.side || 120) - 30}px">${esc(d.text)}</span>`;
          R = d.sub ? `<span class="act-text act-dim">${esc(d.sub)}</span>` : '';
        }
        break;
      }
      case 'brief':
        L = `<div class="act-icon" style="color:var(--lilac)">${fa('wand-magic-sparkles')}</div><span class="act-text">${_t('Your brief')}</span>`;
        R = act.data.cat ? '' : `<span class="act-text act-dim">${_t('Open')}</span>`;
        break;
      case 'tele':
        L = `<div class="act-icon" style="color:var(--orange)">${fa('scroll')}</div><span class="act-text">${_t('Teleprompter')}</span>`;
        R = `<span class="act-text act-dim">${teleLeftText()}</span><div class="act-icon tele-go">${fa('play')}</div>`;
        break;
      case 'voice': {
        const v = st.voice;
        const showLive = !st.settings || st.settings.voiceLive !== false;
        const steerTag = v.agent && v.steer
          ? `<span class="v-lang v-steer">${fa('route')}${cam ? '' : ' ' + esc(_t('Steer'))}</span>`
          : '';
        const autoTag = v.agent && !v.steer && v.autoUi
          ? `<span class="v-lang v-autoui">${fa('wand-magic-sparkles')}${cam ? '' : ' ' + esc(_t('Auto UI'))}</span>`
          : '';
        const langBadge = `${steerTag}${autoTag}<span class="v-lang">${esc(v.agent ? 'Pony' : (v.lang || 'ID'))}</span>`;
        if (v.state === 'listening') {
          const bars = window.NotchKit && NotchKit.voiceBars ? NotchKit.voiceBars(v.rms, 24) : new Array(24).fill(0.08);
          const barsHtml = bars.map((b) => `<i style="transform:scaleY(${b.toFixed(3)})"></i>`).join('');
          const leftCore = `<span class="v-dot" role="status" aria-label="${esc(_t('Microphone active'))}"></span><span class="v-time clk">${esc(voiceFmtTime(Date.now() - v.since))}</span>`;
          if (cam) {
            const eye = ponyEyeHtml('listening', 1);
            L = `<span class="pony-side"><span class="pony-outer">${leftCore}</span>${eye}</span>`;
            R = `<span class="pony-side">${eye}<span class="pony-outer">${langBadge}</span></span>`;
          } else {
            L = leftCore;
            M = ponyEyeHtml('listening', 2);
            R = langBadge;
          }
          B = `<div class="v-below v-listening"><div class="v-bars" aria-hidden="true">${barsHtml}</div>${showLive ? `<div class="v-live" dir="auto">${voiceTailHtml(v.partial, v.prevPartial)}</div>` : ''}</div>`;
          belowMeta = { extra: showLive ? 58 : 36, wide: 420 };
        } else if (v.state === 'transcribing') {
          const leftCore = `<span class="v-spin-dot"></span><span class="v-status-lbl">${esc(_t('Writing…'))}</span>`;
          const rBadge = `<span class="v-lang">${esc(v.lang || 'ID')}</span>`;
          if (cam) {
            const eye = ponyEyeHtml('think', 1);
            L = `<span class="pony-side"><span class="pony-outer">${leftCore}</span>${eye}</span>`;
            R = `<span class="pony-side">${eye}<span class="pony-outer">${rBadge}</span></span>`;
          } else {
            L = leftCore;
            M = ponyEyeHtml('think', 2);
            R = rBadge;
          }
          const dimLive = showLive && v.partial ? `<div class="v-live dim" dir="auto">${voiceTailHtml(v.partial, '')}</div>` : '';
          B = `<div class="v-below v-transcribing"><div class="v-shimmer" aria-hidden="true"><i></i></div>${dimLive}</div>`;
          belowMeta = { extra: dimLive ? 52 : 32, wide: 420 };
        } else if (v.state === 'done') {
          const leftCore = `<span class="v-done-ico">${fa('check')}</span><span class="v-status-lbl">${esc(_t('Inserted'))}</span>`;
          const rBadge = `<span class="v-lang">${esc(v.lang || 'ID')}</span>`;
          if (cam) {
            const eye = ponyEyeHtml('done', 1);
            L = `<span class="pony-side"><span class="pony-outer">${leftCore}</span>${eye}</span>`;
            R = `<span class="pony-side">${eye}<span class="pony-outer">${rBadge}</span></span>`;
          } else {
            L = leftCore;
            M = ponyEyeHtml('done', 2);
            R = rBadge;
          }
          B = `<div class="v-below v-done"><div class="v-done-text" dir="auto">${esc(v.text || '')}</div></div>`;
          belowMeta = { extra: 40, wide: 420 };
        } else if (v.state === 'error') {
          L = `<span class="v-err-ico">${fa('circle-exclamation')}</span><span class="v-status-lbl">${esc(_t('Voice'))}</span>`;
          R = `<span class="v-lang">${esc(v.lang || 'ID')}</span>`;
          const actLabel = v.action === 'download' ? _t('Download') : v.action === 'mic' ? _t('Open Settings') : '';
          const actBtn = actLabel ? `<button class="btn primary" data-voice-action="${esc(v.action)}">${esc(actLabel)}</button>` : '';
          B = `<div class="v-below v-error"><div class="v-err-text">${esc(voiceErrorLabel(v.error))}</div>${actBtn}</div>`;
          belowMeta = { extra: 46, wide: 420 };
        }
        break;
      }
    }
  }
  // Claude / Notifications header strip when no other activity owns the top row
  if (!act && !st.open) {
    if (claudeShowing()) {
      const c = st.claude[0];
      const lbl = c.kind === 'question' ? _t('Has a question') : c.kind === 'done' ? _t('Done') : _t('Needs permission');
      L = `<span class="cc-bar-ai"><i></i>${esc(lbl)}</span>`;
      R = `<span class="clk" style="color:var(--dim);font-weight:600;font-size:11px">${esc(hm(new Date()))}</span>`;
    } else if (notifShowing()) {
      const n = st.notifs[0];
      L = appIconImg(n.icon || n.image, 18, 5, fa('bell'));
      if (st.notifs.length === 1) {
        R = `<span class="clk" style="color:var(--dim);font-weight:600;font-size:11.5px">${esc(ago(n.at))}</span>`;
        const canReply = !!(n.canReply || n.reply || n.launch);
        B = `${appIconImg(n.image || n.icon, 36, 9, fa('bell'))}<div class="al-txt"><b dir="auto">${esc(n.title || n.app)}</b>${n.body ? `<small dir="auto">${esc(n.body)}</small>` : ''}</div>${canReply ? `<button type="button" class="btn" data-nf-open="${esc(n.id)}">${_t('Reply')}</button>` : ''}<button type="button" class="al-x" data-nf-close="${esc(n.id)}" title="${esc(_t('Close'))}" aria-label="${esc(_t('Close'))}">${fa('xmark')}</button>`;
        belowMeta = { extra: 60, wide: 440 };
      } else {
        R = `<span class="clk" style="color:var(--dim);font-weight:600;font-size:11.5px">${st.notifs.length}</span>`;
      }
    } else if (ponyIdleOn()) {
      const now = Date.now();
      const mood = currentPonyMood();
      const batR = st.power && st.power.hasBattery ? ring(st.power.level, st.power.pluggedIn ? 'var(--emerald)' : meter(st.power.level, true), 16, 14) : '';
      const clk = `<span class="clk">${esc(hm(now))}</span>`;
      const eye = ponyEyeHtml(mood, 1);
      const eyes = ponyEyeHtml(mood, 2);
      if (cam) {
        const lOuter = (st.settings.idleLeft && st.settings.idleLeft !== 'none' && slotHtml(st.settings.idleLeft)) || clk;
        const rOuter = (st.settings.idleRight && st.settings.idleRight !== 'none' && slotHtml(st.settings.idleRight)) || batR;
        L = `<span class="pony-side"><span class="pony-outer">${lOuter}</span>${eye}</span>`;
        R = `<span class="pony-side">${eye}<span class="pony-outer">${rOuter}</span></span>`;
      } else {
        L = st.settings.idleLeft && st.settings.idleLeft !== 'none' ? slotHtml(st.settings.idleLeft) : '';
        R = st.settings.idleRight && st.settings.idleRight !== 'none' && st.settings.idleRight !== 'battery' ? slotHtml(st.settings.idleRight) : '';
        M = `<span class="pony-mid">${eyes}${clk}${batR}</span>`;
      }
      lastSlotSig = L + '|' + M + '|' + R;
    } else {
      const sl = idleSlots();
      L = sl.L; R = sl.R;
      lastSlotSig = L + '|' + M + '|' + R;
    }
  }
  const key = closedStateKeyOf(act);
  syncPonyMood();
  // a brief alert or HUD shows at full strength even if the closed notch is set to be see-through
  notchEl.classList.toggle('alerting', st.hudOnly || feedSumActive() || !!(st.activity && st.activity.until > Date.now()));
  const closed = $('#closed');
  if (animate && key && key !== lastActKey) {
    closed.classList.remove('swap');
    void closed.offsetWidth;
    closed.classList.add('swap');
    // Remove `.swap` after swapIn finishes so subsequent minute/battery/title updates inside #closedMid never re-blink
    later('closedSwap', 540, () => closed.classList.remove('swap'));
  }
  lastActKey = key;
  closed.classList.toggle('kind-music', !!act && act.kind === 'music');
  if (lastClosedL !== L) { left.innerHTML = L; lastClosedL = L; }
  if (mid && lastClosedM !== M) { mid.innerHTML = M; lastClosedM = M; }
  if (lastClosedR !== R) { right.innerHTML = R; lastClosedR = R; }
  left.classList.toggle('show', !!L);
  right.classList.toggle('show', !!R);
  st.below = !st.open && belowMeta ? belowMeta : null;
  if (belowEl) {
    const nextB = !st.open ? B : '';
    const belowChanged = lastClosedB !== nextB;
    if (belowChanged) {
      belowEl.innerHTML = nextB;
      lastClosedB = nextB;
    }
    belowEl.classList.toggle('show', !st.open && !!B);
    if (belowChanged) {
      $$('button', belowEl).forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          if (b.dataset.adhan) endAdhan();
          else if (b.dataset.todo) tickTodo(b.dataset.todo);
          else if (b.dataset.snooze) snoozeTodo(b.dataset.snooze);
          else if (b.dataset.timer) timerAlertDone(b.dataset.timer === 'add');
          else if (b.dataset.tick === 'water') logWater();
          else if (b.dataset.voiceAction) {
            const act = b.dataset.voiceAction;
            if (act === 'download') api.svc('voice', 'download', '0.6b').catch(() => {});
            else if (api.openSettings) api.openSettings('voice');
          }
          else if (b.dataset.nfClose) {
            dropNotif(b.dataset.nfClose);
          }
          else if (b.dataset.nfOpen) {
            const n = st.notifs.find((x) => String(x.id) === b.dataset.nfOpen);
            if (n) {
              api.svc('notif', 'open', n.aumid, n.launch || '', n.activation || '');
              if (n.hid) api.svc('notif', 'read', n.hid).catch(() => {});
            }
            dropNotif(b.dataset.nfOpen);
          }
        };
      });
    }
  }
  renderBubble(bubbleActivity());
  renderClock();
  $$('.mini-ctl button', right).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (b.dataset.adhan) endAdhan(); else if (b.dataset.todo) tickTodo(b.dataset.todo); else if (b.dataset.snooze) snoozeTodo(b.dataset.snooze);
      else if (b.dataset.timer) timerAlertDone(b.dataset.timer === 'add');
      else if (b.dataset.tick === 'water') logWater(); else cmd(b.dataset.a);
    };
  });
  const oldPanel = $('.hud-panel', notchEl);
  if (oldPanel) oldPanel.remove();
  if (panel) { notchEl.insertAdjacentHTML('beforeend', panel); bindHudPanel(); }
  // tasks due within the hour, all at once, under the closed notch
  const tasks = todoPanelTasks();
  let tp = $('.todo-panel', notchEl);
  if (!tasks.length) { if (tp) tp.remove(); } else {
    if (!tp) { notchEl.insertAdjacentHTML('beforeend', '<div class="todo-panel"></div>'); tp = $('.todo-panel', notchEl); }
    // with a late row's snooze there, the other rows keep its room, so the times line up
    const late = tasks.slice(0, TODO_PANEL_MAX).some(todoSnoozable);
    const html = tasks.slice(0, TODO_PANEL_MAX).map((t) => {
      const d = dueText(t);
      return `<div class="tp-row"><span class="tp-ico" style="color:${d.color === 'var(--red)' ? d.color : 'var(--orange)'}">${fa('clock', 'regular')}</span><span class="tp-text">${esc(t.text)}</span><span class="tp-time" style="color:${d.color || 'inherit'}">${esc(d.text)}</span>`
        + `${todoTickable(t) ? `<span class="mini-ctl">${todoSnoozable(t) ? snoozeBtn(t) : late ? '<i class="tp-gap"></i>' : ''}<button class="tick" data-todo="${esc(t.id)}" title="${_t('Mark as done')}">${fa('check')}</button></span>` : ''}</div>`;
    }).join('') + (tasks.length > TODO_PANEL_MAX ? `<div class="tp-row tp-more">${_t('+{n} more', { n: tasks.length - TODO_PANEL_MAX })}</div>` : '');
    // Rebuilt only when its rows or buttons change; otherwise just the times (they tick every second): a
    // rebuild between pressing and releasing a button lost the click.
    const shape = tasks.slice(0, TODO_PANEL_MAX).map((t) => `${t.id}|${esc(t.text)}|${todoTickable(t)}|${todoSnoozable(t)}`).join('/') + `/${late}/${tasks.length}`;
    if (tp.dataset.shape !== shape) {
      tp.dataset.shape = shape;
      tp.innerHTML = html;
      $$('.tick', tp).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); tickTodo(b.dataset.todo); }; });
      $$('.snooze', tp).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); snoozeTodo(b.dataset.snooze); }; });
    } else {
      const fresh = document.createElement('div'); fresh.innerHTML = html;
      $$('.tp-row', tp).forEach((row, i) => {
        const [a, b] = [$('.tp-time', row), $('.tp-time', fresh.children[i] || fresh)];
        if (a && b && (a.textContent !== b.textContent || a.style.color !== b.style.color)) { a.textContent = b.textContent; a.style.color = b.style.color; }
      });
    }
  }
  renderNotifs();
  renderCapsMark();
  renderLangMark();
  renderAiMark();
  renderClaude();
  renderOpenVoice();
  if (act && act.kind === 'music' && st.settings.realVisualizer) viz.ensure();
}

// ------------------------------------------------------------------ idle slots
// While nothing else is going on, the closed notch can show small things on its left and right:
// weather, battery, date, the next prayer, event or task, or the time. Each side gets the same width,
// so the notch stays centred.
// How wide they are: what they show, measured off screen (a number counted with at least two digits, and every
// digit as a 0), the wider side for both. Within a minute that only grows, so the notch doesn't twitch as the CPU
// or the battery goes from 99% to 100%; once the minute turns (or another slot is picked) it fits again.
const slotProbe = document.createElement('div');
slotProbe.id = 'slotProbe'; slotProbe.setAttribute('aria-hidden', 'true');
notchEl.appendChild(slotProbe);
const slotSizes = new Map(); // html → its width
let slotFit = { key: '', l: 0, r: 0, w: 0 };
function slotSize(html) {
  const key = (notchEl.classList.contains('cam') ? 'cam|' : '') + html;
  let w = slotSizes.get(key);
  if (w != null) return w;
  slotProbe.innerHTML = html;
  const walk = document.createTreeWalker(slotProbe, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) n.nodeValue = n.nodeValue.replace(/\d+/g, (d) => '0'.repeat(Math.max(2, d.length)));
  w = Math.ceil(slotProbe.getBoundingClientRect().width);
  slotProbe.innerHTML = '';
  if (slotSizes.size > 60) slotSizes.clear();
  slotSizes.set(key, w);
  return w;
}
function slotsMeasure(L, R) {
  const s = st.settings;
  const lw = L ? slotSize(L) : 0;
  const rw = R ? slotSize(R) : 0;
  const key = [notchEl.classList.contains('cam') ? '1' : '0', s.idleLeft, s.idleRight, s.clock24h, s.showBatteryPercent, s.batteryStyle, Math.floor(Date.now() / 60000)].join('|');
  slotFit = key === slotFit.key
    ? { key, l: Math.max(slotFit.l, lw), r: Math.max(slotFit.r, rw), w: Math.max(slotFit.w, lw, rw) }
    : { key, l: lw, r: rw, w: Math.max(lw, rw) };
  return { leftW: slotFit.l, rightW: slotFit.r, side: slotFit.w };
}
function slotsWidth(L, R) {
  return slotsMeasure(L, R).side;
}
let lastSlotSig = '';
function slotHtml(kind) {
  const now = Date.now();
  switch (kind) {
    case 'time': return `<span class="act-num">${esc(hm(now))}</span>`;
    case 'date': return `<span class="act-text">${esc(new Date().toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric' }))}</span>`;
    case 'weather': {
      const w = window.N && N.data && N.data.weather;
      if (!w || !w.current) return '';
      return `<div class="act-icon">${window.weatherIcon(w.current.code, w.current.day)}</div><span class="act-num">${Math.round(w.current.temp)}°</span>`;
    }
    case 'temp': {
      const s = st.stats;
      if (!s || !s.temp) return '';
      const t = tempInfo(s.temp.c);
      return `<div class="act-icon" style="color:${t.color}">${fa('temperature-half')}</div><span class="act-num">${t.text}</span>`;
    }
    case 'cpu': case 'ram': case 'disk': {
      const v = sysPct(kind);
      if (v === '–') return '';
      return `<span class="act-lbl" title="${SYS_TITLE[kind]}">${SYS_LABEL[kind]}</span><span class="act-num">${v}</span>`;
    }
    case 'wifi': {
      const w = (st.stats || {}).wifi;
      if (!w) return st.wired ? '<span class="act-text" title="Ethernet">LAN</span>' : '';
      return `<span class="act-lbl" title="Wi-Fi ${esc(w.ssid || '')}">Wi-Fi</span><span class="act-num">${w.quality}%</span>`;
    }
    // the internet speed (onNet draws it again with each reading): down over up in two small lines, or one of them;
    // its unit small and dim after it, written out on one line ("640 Kbps", "1.3 Mbps"), a letter in two ("640K")
    case 'net': case 'netDown': case 'netUp': {
      if (!hist.rx.length) return '';
      const line = (down, cls) => {
        const v = mbps(down ? hist.rx : hist.tx);
        const unit = kind === 'net' ? v.unit.charAt(0) : v.unit;
        return `<span class="${cls} net-${down ? 'dn' : 'up'}${v.idle ? ' idle' : ''}" title="${down ? _t('Download') : _t('Upload')}${v.unit ? ` · ${v.unit}` : ''}"><b>${down ? '↓' : '↑'}</b><i>${v.text}</i><small class="net-u">${unit}</small></span>`;
      };
      return kind === 'net' ? `<span class="act-net">${line(true, 'net-l')}${line(false, 'net-l')}</span>` : line(kind === 'netDown', 'act-net1');
    }
    case 'battery': {
      const p = st.power;
      if (!p || !p.hasBattery) return '';
      const col = p.pluggedIn ? 'var(--emerald)' : meter(p.level, true);
      const pct = st.settings.showBatteryPercent ? `<span class="batt-mini">${p.level}%</span>` : '';
      return `${pct}${ring(p.level, col, 16, 14)}`;
    }
    case 'prayer': {
      const t = st.settings.prayerEnabled && nextPrayer();
      if (!t) return '';
      return `<span class="act-text">${esc(prayerName(t.name))} <span class="act-dim">${esc(hm(t.at))}</span></span>`;
    }
    case 'event': {
      const e = (st.events || []).find((x) => !x.allDay && x.end > now && x.start - now < 12 * 3600000);
      if (!e) return '';
      return `<span class="act-text" style="max-width:84px">${esc(e.title)}</span><span class="act-text act-dim">${esc(hm(e.start))}</span>`;
    }
    case 'todo': {
      const t = (((window.N && N.data && N.data.todo) || {}).items || []).filter((x) => !x.done && !x.deletedAt)
        .sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || (b.created || 0) - (a.created || 0))[0];
      if (!t) return '';
      return `<span class="act-text" style="max-width:${t.due ? 84 : 120}px">${esc(t.text)}</span>${t.due ? `<span class="act-text act-dim">${esc(hm(t.due))}</span>` : ''}`;
    }
    // the first place of the world clock (Settings → General → Clock): its name and the time there
    case 'world': {
      const p = window.SymponyClock && SymponyClock.places(st.settings)[0];
      if (!p) return '';
      return `<span class="act-text act-dim" style="max-width:76px">${esc(p.name)}</span><span class="act-num">${esc(SymponyClock.time(p.tz, now, st.settings.clock24h !== false))}</span>`;
    }
    default: return '';
  }
}
function idleSlots() {
  const s = st.settings;
  if (!s || st.open) return { L: '', R: '', leftW: 0, rightW: 0, side: 0 };
  if (ponyIdleOn()) {
    if (camera()) {
      const lCustom = s.idleLeft && s.idleLeft !== 'none' ? slotHtml(s.idleLeft) : '';
      const rCustom = s.idleRight && s.idleRight !== 'none' ? slotHtml(s.idleRight) : '';
      const outer = lCustom || rCustom
        ? Math.max(slotsWidth(lCustom, rCustom), clockWidth('time'))
        : clockWidth('time');
      const side = Math.max(48, outer + 18);
      return { L: '', R: '', leftW: side, rightW: side, side };
    }
    const L = s.idleLeft && s.idleLeft !== 'none' ? slotHtml(s.idleLeft) : '';
    const R = s.idleRight && s.idleRight !== 'none' && s.idleRight !== 'battery' ? slotHtml(s.idleRight) : '';
    const m = L || R ? slotsMeasure(L, R) : { leftW: 0, rightW: 0, side: 0 };
    return { L, R, ...m };
  }
  const L = slotHtml(s.idleLeft); const R = slotHtml(s.idleRight);
  const m = L || R ? slotsMeasure(L, R) : { leftW: 0, rightW: 0, side: 0 };
  return { L, R, ...m };
}
function clockAllowedWith(act) {
  if (!act) return true;
  if (!st.settings || st.settings.clockWithActivities === false) return false;
  if (st.activity && st.activity.until > Date.now()) return false;
  return window.NotchKit && typeof NotchKit.isClockActivity === 'function'
    ? NotchKit.isClockActivity(act.kind)
    : ['music', 'pomodoro', 'timer', 'stopwatch'].includes(act.kind);
}
// Closed-notch width on a display without a physical camera cutout: fits the time and sides cleanly without stacking
// an empty `notchWidth` middle on top of `side * 2`.
function closedWidthFlat(act, side) {
  const s = st.settings; const mode = s.idleClock || 'time';
  const nw = effectiveSizes(s).notchWidth;
  const maxW = Math.max(320, window.innerWidth - 80);
  if (st.open) return nw;
  if (ponyIdleOn()) {
    const mid = Math.max(168, nw - side * 2);
    return Math.min(maxW, Math.max(nw, mid + side * 2));
  }
  if (act && act.kind === 'music' && !camera() && !lyricsInline() && st.media.title) {
    return window.NotchKit && NotchKit.closedWidthNoCam
      ? NotchKit.closedWidthNoCam({ notchWidth: nw, midNeed: 168, side, pad: 0, maxW })
      : Math.min(maxW, Math.max(nw, 168 + side * 2));
  }
  const marks = !side ? Math.max(langMarkShown() ? langRoom() : 0, aiMarkRoom()) * 2 : 0;
  let midNeed = 0;
  if (mode !== 'off') {
    if (act) {
      midNeed = clockAllowedWith(act) ? Math.max(clockBeside(act, side, mode), clockWidth('time') + 24) : 0;
    } else {
      midNeed = clockWidth(mode) + (side ? 24 : 0) + marks;
    }
  } else {
    midNeed = marks;
  }
  return window.NotchKit && NotchKit.closedWidthNoCam
    ? NotchKit.closedWidthNoCam({ notchWidth: nw, midNeed, side, pad: 28, maxW })
    : Math.min(maxW, Math.max(nw, midNeed + 28 + side * 2));
}
// how wide the time (or the day and time) is in the closed notch, every digit counted as a 0
function clockWidth(mode) {
  const now = Date.now(); const fs = clockFont();
  const n = (t) => t.replace(/\d+/g, (d) => '0'.repeat(Math.max(2, d.length)));
  const day = mode === 'date' ? textWidth([n(new Date(now).toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric' }))], `500 ${fs}px`) + 6 : 0;
  return Math.ceil(day + textWidth([n(hm(now))], `600 ${fs}px`));
}

// Over a MacBook's camera (camera()): the camera's width in the middle, then balanced wings on each side so Sympony
// stays centred on the camera. The time goes on the empty or narrower wing (and during music/timers uses compact time).
function camClockMode(act) {
  const mode = (st.settings && st.settings.idleClock) || 'time';
  if (mode === 'off') return 'off';
  return act ? 'time' : mode;
}
function camClockShown(act) {
  const s = st.settings;
  if (ponyIdleOn()) return false;
  if ((s.idleClock || 'time') === 'off' || st.open || lyricsInline()) return false;
  if (claudeShowing() || notifShowing()) return false;
  if (voiceActive()) return false; // dictating: the sides are the mic, timer and language, never the time
  return clockAllowedWith(act);
}
// (the marks at the edges, Caps Lock, AI usage, keyboard language: their room as closedSide made it, or with nothing
// on the sides as closedMid gives it)
function camPad(act, side, clockShown) {
  const marks = side > 0 ? parseFloat(notchEl.style.getPropertyValue('--mark-pad')) || 0 : Math.max(langMarkShown() ? langRoom() : 0, aiMarkRoom());
  // ponytail: nothing beside the camera but the edge marks (or nothing at all): hug the camera. The marks move to
  // 4 px from the edge (.cam-tight in notch.css) and keep 4 px to the camera: 4 + mark + 4 a side.
  if (!side && !clockShown) return marks && marks - 4;
  return 8 + marks;
}
function camSideWidths(act, side) {
  if (!act && !ponyIdleOn() && !claudeShowing() && !notifShowing()) {
    const sl = idleSlots();
    return { leftW: sl.leftW, rightW: sl.rightW };
  }
  if (ponyIdleOn()) return { leftW: side, rightW: side };
  const lHtml = $('#closedLeft') ? $('#closedLeft').innerHTML : '';
  const rHtml = $('#closedRight') ? $('#closedRight').innerHTML : '';
  let leftW = lHtml ? slotSize(lHtml) : 0;
  let rightW = rHtml ? slotSize(rHtml) : 0;
  if (act) {
    if (act.kind === 'music') {
      leftW = Math.max(leftW, 24);
      rightW = Math.max(rightW, showMiniControls() ? 70 : 26);
    } else if (act.kind === 'pomodoro' || act.kind === 'timer' || act.kind === 'stopwatch') {
      leftW = Math.max(leftW, 20);
      rightW = Math.max(rightW, 42);
    } else {
      leftW = lHtml ? Math.max(leftW, Math.min(side, leftW)) : side;
      rightW = rHtml ? Math.max(rightW, Math.min(side, rightW)) : side;
    }
  }
  return { leftW, rightW };
}
function camLayoutFor(act, side, cam) {
  const s = st.settings;
  const nw = effectiveSizes(s).notchWidth;
  const wantClock = camClockShown(act);
  const mode = camClockMode(act);
  const clockW = wantClock && mode !== 'off' ? clockWidth(mode) : 0;
  const { leftW, rightW } = camSideWidths(act, side);
  const pad = camPad(act, Math.max(leftW, rightW, side), clockW > 0);
  const maxW = Math.min(window.innerWidth - 80, Math.max(Math.ceil(cam.w) + 260, 480));
  if (window.NotchKit && typeof NotchKit.camClosedLayout === 'function') {
    return NotchKit.camClosedLayout({
      camW: cam.w + CAM_MARGIN * 2,
      leftW,
      rightW,
      clockW,
      pad,
      notchWidth: nw,
      maxW,
    });
  }
  const wing = Math.max(leftW, rightW) + (clockW ? clockW + 6 : 0);
  const width = Math.min(maxW, Math.max(nw, Math.ceil(cam.w + CAM_MARGIN * 2 + (wing + pad) * 2)));
  return { width, showClock: clockW > 0, clockRight: !rightW, clockL: pad, clockW };
}
// Settings → General → Clock size: the closed Sympony's time follows its Height. Normal is the size it always had (38 % of
// the Height, 10 to 14 px), Small a little under it; Large and Extra large grow past 14 px, never over 70 % of the Height.
const CLOCK_SCALE = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 };
function clockFont() {
  const h = closedHeight(); const k = CLOCK_SCALE[(st.settings || {}).clockSize] || 1;
  if (k > 1) return Math.round(Math.min(h * 0.7, Math.max(10, h * 0.38) * k) * 4) / 4;
  const fs = Math.max(10, Math.min(14, h * 0.38));
  return k < 1 ? Math.max(9, Math.round(fs * k * 4) / 4) : fs;
}
// Beside music, a timer… (Keep the time while music or a timer plays): a Large or Extra large time gets the middle it
// needs, 10 px from what shows on either side. Small and Normal leave the notch as it is and step out when they don't
// fit, as before. Not while an alert covers the time, or a long title takes the middle (renderClock: `roomy`).
function clockBeside(act, side, mode) {
  const s = st.settings;
  if ((CLOCK_SCALE[s.clockSize] || 1) <= 1 || s.clockWithActivities === false || st.hudOnly || lyricsInline()) return 0;
  if ((st.activity && st.activity.until > Date.now()) || $('#closed').classList.contains('roomy')) return 0;
  const clock = clockWidth(mode);
  // how far in from its edge each side's content reaches: #closed's padding (notch.css; the marks' room is in both
  // that and `side`) and the wider side's content
  const pad = (act.kind === 'music' ? 13 : 10) + (parseFloat(notchEl.style.getPropertyValue('--mark-pad')) || 0);
  const reach = pad + Math.max($('#closedLeft').scrollWidth, $('#closedRight').scrollWidth);
  return clock + 20 + 2 * (reach - side);
}

// ------------------------------------------------------------------ clock
// The time sits in the middle of the closed notch (also next to music and timers, unless that's turned
// off), and with the date in the middle of the open notch's top bar on every tab.
let clockKey = '';
let lastPonyMin = '';
function renderClock() {
  const s = st.settings;
  if (!s) return;
  const now = new Date();
  // Pony idle slot shows the clock itself: refresh when the minute ticks, mood changes, or battery changes
  if (ponyIdleOn()) {
    const mm = hm(now) + '|' + currentPonyMood() + '|' + (st.power ? st.power.level + ':' + st.power.pluggedIn : '');
    if (mm !== lastPonyMin) { lastPonyMin = mm; renderClosed(); layout(); return; }
  } else if (!st.open && !currentActivity() && !claudeShowing() && !notifShowing()) {
    const sl = idleSlots();
    if (sl.L + '||' + sl.R !== lastSlotSig) { renderClosed(); layout(); return; }
  }
  const mode = s.idleClock || 'time';
  const el = $('#idleClock');
  const act = currentActivity();
  const cam = !!camera();
  const dispMode = cam && act ? 'time' : mode;
  const html = (dispMode === 'date' ? `<span class="d">${esc(now.toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric' }))}</span>` : '') + `<span>${esc(hm(now))}</span>`;
  const hasMid = !!($('#closedMid') && $('#closedMid').innerHTML);
  const long = !cam && !!act && $$('#closed .act-text[style*="max-width"]').some((t) => t.scrollWidth > parseFloat(t.style.maxWidth) + 1);
  $('#closed').classList.toggle('roomy', long && !hasMid);
  let idle = mode !== 'off' && !st.open && !st.hudOnly && !lyricsInline() && !ponyIdleOn() && !hasMid && !claudeShowing() && !notifShowing() && !voiceActive()
    && (!cam || st.camClockOk !== false)
    && (!act || (clockAllowedWith(act) && !long));
  if (idle && act && !cam) { if (el.innerHTML !== html) el.innerHTML = html; idle = clockFits(el); }
  const key = [html, idle, s.headerClock !== false].join('|');
  if (key === clockKey) return;
  clockKey = key;
  if (idle) el.innerHTML = html;
  el.classList.toggle('show', idle);
  const hc = $('#headerClock');
  if (hc) {
    hc.innerHTML = s.headerClock === false ? ''
      : `<span class="t">${esc(hm(now))}</span><span class="d">${esc(now.toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric', month: 'short' }))}</span>`;
  }
  if (st.open && window.N && N.carousel) N.carousel.renderTop();
}
setInterval(renderClock, 1000);

// Mochi's eyes follow the cursor gently (±3px X, ±1.5px Y via transform only; disabled under reduced motion)
window.addEventListener('mousemove', (e) => {
  if (reducedMotion.matches || st.open) return;
  const eyes = $$('.eyew', notchEl);
  if (!eyes.length) return;
  const r = notchEl.getBoundingClientRect();
  const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 400));
  const dy = Math.max(-1, Math.min(1, (e.clientY - r.bottom) / 300));
  const tf = `translate(${(dx * 3).toFixed(1)}px, ${(dy * 1.5).toFixed(1)}px)`;
  for (const el of eyes) el.style.transform = tf;
});
// room between the time and what the activity shows on each side (checked every second, so a notch that is
// still growing gets the time a moment later)
function clockFits(el) {
  const edge = (list, side) => list.map((x) => x.getBoundingClientRect()[side]);
  const c = $$('span', el);
  if (!c.length) return true;
  const left = Math.max(...edge($$('#closedLeft > *'), 'right'));
  const right = Math.min(...edge($$('#closedRight > *'), 'left'));
  return Math.min(...edge(c, 'left')) - left >= 10 && right - Math.max(...edge(c, 'right')) >= 10;
}

function progressRing(frac, color) {
  const r = 7; const c = 2 * Math.PI * r;
  return `<svg class="mini-ring" viewBox="0 0 18 18"><circle cx="9" cy="9" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2.4"/>
    <circle cx="9" cy="9" r="${r}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, frac)))}" transform="rotate(-90 9 9)"/></svg>`;
}

function hudPanel(kind, lvl) {
  return `<div class="hud-panel" data-kind="${kind}"><div class="progress" style="height:6px"><div class="progress-fill" style="width:${lvl}%;background:#fff"></div><div class="progress-knob" style="left:${lvl}%"></div></div><span class="hud-pct">${lvl}</span></div>`;
}
function bindHudPanel() {
  const p = $('.hud-panel', notchEl);
  if (!p || !$('.progress', p)) return; // the lock keys' panel has no slider
  bindSlider($('.progress', p), (frac) => {
    const v = Math.round(frac * 100);
    if (p.dataset.kind === 'volume') api.helper({ cmd: 'volume.set', value: v });
    else api.helper({ cmd: 'brightness.set', value: v });
    st.activity.until = Date.now() + 1800;
    later('activity', 1820, () => { renderClosed(); layout(); });
  });
}

// `charging`: plugged in, with a bolt inside like the open Sympony's battery (the closed Sympony's battery slot)
function miniBattery(color, charging) {
  const lvl = st.power ? st.power.level : 0;
  const bolt = charging ? `<div class="battery-bolt">${ICONS.bolt}</div>` : '';
  const cls = charging ? ' charging' : '';
  if (st.settings.batteryStyle === 'ring') {
    return `<div class="battery-ring mini${cls}"><svg viewBox="0 0 18 18" aria-hidden="true"><circle class="br-track" cx="9" cy="9" r="7"/><circle class="br-level" cx="9" cy="9" r="7" pathLength="100" style="stroke:${color};stroke-dasharray:${Math.max(3, lvl)} 100"/></svg>${bolt}</div>`;
  }
  return `<div class="battery-shell mini${cls}"><div class="battery-fill" style="width:${lvl}%;background:${color}"></div>${bolt}</div>`;
}

function vizMarkup(playing) {
  const fake = !st.settings.realVisualizer || !viz.ok;
  const spectrum = st.settings.visualizerStyle === 'spectrum';
  const n = spectrum ? 8 : 5;
  return `<div class="viz ${fake ? 'fake' : 'real'} ${spectrum ? 'spectrum' : ''} ${playing ? '' : 'paused'}">${'<i></i>'.repeat(n)}</div>`;
}

// ------------------------------------------------------------------ visualizer
// The Rust backend captures system audio (WASAPI loopback), runs an FFT and sends 8 band levels
// (~30/s) while music plays. Until the first frame arrives the bars use a CSS animation.
const viz = {
  ok: false, tried: false, bands: new Array(8).fill(0),
  ensure() {
    if (this.tried) return;
    this.tried = true;
    api.on('viz', (b) => {
      this.bands = b;
      if (!this.ok) { this.ok = true; renderClosed(); }
      const bars = $$('.viz.real i');
      if (!bars.length) return;
      const n = bars.length;
      for (let i = 0; i < n; i++) {
        const v = this.bands[Math.min(7, Math.floor((i * 8) / n))] || 0;
        bars[i].style.transform = `scaleY(${Math.max(0.18, Math.min(1, v * 1.1)).toFixed(3)})`;
      }
    });
  },
};

// ================================================================== media
function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function dur(secs) {
  secs = Math.round(secs || 0);
  const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60);
  if (h) return _t('{h}h {m}m', { h, m });
  if (m) return _t('{n}m', { n: m });
  return _t('{n}s', { n: secs });
}

// The song-change card (design B): artwork (or the app's colour tile), title, artist · app, visualizer, progress
var ISLAND_MS = 4000, ISLAND_H = 64, ISLAND_W = 400; // (var: layout() may run before this line is reached)
function renderIsland() {
  const m = st.media;
  if (!m || !m.active) return;
  const lab = appLabel(m.app);
  const art = m.artwork ? `<img class="isl-art" src="${esc(m.artwork)}" alt="">` : `<div class="isl-art mini-art-app">${ICONS.music}</div>`;
  const pct = m.duration ? Math.round((mediaPosition() / m.duration) * 100) : 0;
  const sub = [m.artist, lab && lab.name].filter(Boolean).map(esc).join(' · ');
  $('#island').innerHTML = `<div class="isl-row">${art}<div class="isl-text"><span class="isl-title" dir="auto">${esc(m.title)}</span>`
    + `<span class="isl-sub" dir="auto">${sub}</span></div>${vizMarkup(m.playing)}</div><div class="isl-prog"><i style="width:${pct}%"></i></div>`;
}

function mediaPosition() {
  const m = st.media;
  if (!m.active || !m.duration) return 0;
  let pos = m.position || 0;
  if (m.playing) {
    // GSMTC gives a timestamped snapshot; extrapolate from it.
    const since = m.positionUpdated ? (Date.now() - m.positionUpdated) / 1000 : (Date.now() - st.mediaAt) / 1000;
    pos += Math.max(0, Math.min(since * (m.rate || 1), m.duration)); // (at the tab's speed: 1.5×, 2×…)
  }
  return Math.min(pos, m.duration);
}

function appLabel(id) {
  if (!id) return '';
  const s = id.toLowerCase();
  const known = [['sympony.radio', 'Radio', '#ff375f'], ['spotify', 'Spotify', '#1db954'], ['chrome', 'Chrome', '#4285f4'], ['msedge', 'Edge', '#0c8ce9'], ['firefox', 'Firefox', '#ff7139'],
    ['zunemusic', 'Media Player', '#e3008c'], ['music', 'Music', '#fa243c'], ['vlc', 'VLC', '#ff8800'], ['brave', 'Brave', '#fb542b'],
    ['opera', 'Opera', '#ff1b2d'], ['tidal', 'TIDAL', '#000'], ['deezer', 'Deezer', '#a238ff'], ['youtube', 'YouTube', '#ff0000'], ['foobar', 'foobar', '#555'],
    ['edgemac', 'Edge', '#0c8ce9'], ['safari', 'Safari', '#1e90ff'], ['thebrowser', 'Arc', '#fa5a5a']];
  for (const [k, name, color] of known) if (s.includes(k)) return { name, color };
  // (a Mac bundle id, e.g. com.vivaldi.Vivaldi: its last part)
  const base = /^[\w-]+(\.[\w-]+){2,}$/.test(id) ? id.split('.').pop() : id.split(/[\\!]/).pop().replace(/\.exe$/i, '');
  return { name: base, color: '#3a3a3c' };
}

let lastArt = null;
function renderMusic(force) {
  const m = st.media;
  const has = m.active && (m.title || m.artist);
  notchEl.classList.toggle('has-media', !!has);
  if (window.N && N.carousel) N.carousel.renderTop();
  if (!st.open && !force) return;
  const titleEl = $('#title');
  const t = has ? m.title || _t('Unknown') : _t('Nothing playing');
  if (titleEl.textContent !== t) { titleEl.textContent = t; setupMarquee(); }
  $('#artist').textContent = has ? [m.artist, m.album].filter(Boolean).join(' — ') || appLabel(m.app).name : _t('Play something in Spotify, YouTube, Apple Music…');
  $('#btnPlay').innerHTML = m.playing ? ICONS.pause : ICONS.play;
  $('#btnPrev').disabled = !has || m.canPrev === false;
  $('#btnNext').disabled = !has || m.canNext === false;
  $('#btnPlay').disabled = !has;
  $('#btnShuffle').style.display = has && m.canShuffle ? '' : 'none';
  $('#btnRepeat').style.display = has && m.canRepeat ? '' : 'none';
  $('#btnShuffle').classList.toggle('on', !!m.shuffle);
  $('#btnRepeat').classList.toggle('on', m.repeat && m.repeat !== 'none');
  $('#btnRepeat').innerHTML = m.repeat === 'track' ? ICONS.repeatOne : ICONS.repeat;
  const art = $('#art');
  if (m.artwork !== lastArt) {
    lastArt = m.artwork;
    if (m.artwork) { art.src = m.artwork; $('#artBlur').src = m.artwork; art.style.display = ''; $('#artBlur').classList.add('on'); } else { art.removeAttribute('src'); art.style.display = 'none'; $('#artBlur').classList.remove('on'); }
  }
  art.classList.toggle('paused', has && !m.playing);
  const badge = $('#appBadge');
  const app = appLabel(m.app);
  if (has && app) {
    badge.classList.add('show'); badge.title = app.name;
    // the playing app's own icon (macOS sends it), else its first letter on its colour
    badge.classList.toggle('icon', !!m.appIcon);
    if (m.appIcon) { badge.style.background = ''; if (badge.dataset.icon !== m.appIcon) { badge.dataset.icon = m.appIcon; badge.innerHTML = `<img src="${esc(m.appIcon)}" alt="">`; } }
    else { delete badge.dataset.icon; badge.style.background = app.color; badge.textContent = app.name[0]; }
  } else badge.classList.remove('show');
  $('#progress').classList.toggle('disabled', !has || !m.duration || m.canSeek === false);
  updateProgress();
  if (typeof refreshHomeCards === 'function') refreshHomeCards();
  if (st.page === 'home' && typeof renderHomeSection === 'function') renderHomeSection();
}

function updateProgress() {
  if (st.seeking) return;
  const m = st.media;
  const pos = mediaPosition();
  const d = m.duration || 0;
  const pct = d ? (pos / d) * 100 : 0;
  $('#progressFill').style.width = pct + '%';
  $('#progressKnob').style.left = pct + '%';
  // without a length (a live stream, or an app that gives no timeline) there's nothing to count: no "0:00 … 0:00",
  // and "Live" where Sympony knows it is (its own radio)
  $('#tElapsed').textContent = d ? fmt(pos) : '';
  $('#tRemain').textContent = d ? '-' + fmt(d - pos) : m.radio && m.active ? _t('Live') : '';
  if (typeof updateHomeCardProgress === 'function') updateHomeCardProgress();
}

// Settings → Media → Progress bar in the closed Sympony: a 2 px line along the bottom edge fills with the song
// while the closed notch shows it (the music, or its lyrics under it); with notifications under the music, it stays
// between the two
notchEl.insertAdjacentHTML('beforeend', '<div id="mProg"><i></i></div>');
const prog = { key: '', anim: null };
function paintProgress() {
  const s = st.settings; const m = st.media; const act = st.open ? null : currentActivity();
  const show = !!(s.musicProgress && s.mediaEnabled && m.active && m.duration > 0 && !st.open && !st.tucked && !autoHidden() && !steppedAside()
    && ((act && act.kind === 'music') || lyricsUnder()));
  notchEl.classList.toggle('m-prog', show);
  // right under the music when something else is below it (layout); otherwise along the bottom edge
  notchEl.classList.toggle('m-prog-mid', progTop >= 0);
  if (progTop >= 0) notchEl.style.setProperty('--mprog-top', progTop + 'px');
  // hidden: stopped where it is (not snapped back while it fades out)
  if (!show) {
    prog.key = '';
    if (prog.anim) { try { prog.anim.commitStyles(); } catch { /* not rendered */ } prog.anim.cancel(); prog.anim = null; }
    return;
  }
  $('#mProg').classList.toggle('art', !!m.artwork);
  // set again only when the player tells something new, not at every layout
  const key = [m.title, m.duration, m.playing, m.position, m.positionUpdated || st.mediaAt].join('|');
  if (key === prog.key) return;
  prog.key = key;
  if (prog.anim) { prog.anim.cancel(); prog.anim = null; }
  const f = $('#mProg i'); const pos = mediaPosition(); const p = Math.min(1, pos / m.duration);
  f.style.transform = `scaleX(${p})`;
  // playing: one linear animation to the end of the song (on the compositor), so nothing runs every frame
  if (m.playing && p < 1) {
    prog.anim = f.animate([{ transform: `scaleX(${p})` }, { transform: 'scaleX(1)' }], { duration: (m.duration - pos) * 1000, easing: 'linear', fill: 'forwards' });
  }
}

function setupMarquee() {
  const box = $('#titleBox'); const span = $('#title');
  box.classList.remove('scroll');
  requestAnimationFrame(() => {
    const over = span.scrollWidth - box.clientWidth;
    if (over > 4) {
      box.style.setProperty('--mq-dist', -(over + 30) + 'px');
      box.style.setProperty('--mq-dur', Math.max(6, (over + 30) / 18) + 's');
      box.classList.add('scroll');
    }
  });
}

// Pull a vivid-ish accent colour out of the album art.
// A picture from the web (Deezer's or iTunes' cover) is asked for with CORS, so its pixels may be read (both send
// Access-Control-Allow-Origin: *); one that refuses is loaded plainly again, shown, and the palette colours used.
function extractColors(src, plain = false) {
  const img = new Image();
  const web = /^https?:/i.test(src);
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    let d;
    try { d = g.getImageData(0, 0, 24, 24).data; } catch { resetAccent(); return; } // (its pixels can't be read)
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      const max = Math.max(r, gg, b); const min = Math.min(r, gg, b);
      const sat = max ? (max - min) / max : 0;
      const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
      if (lum < 0.12 || lum > 0.95) continue;
      const key = `${r >> 5},${gg >> 5},${b >> 5}`;
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, w: 0 };
      const w = 0.2 + sat * 2;
      e.r += r * w; e.g += gg * w; e.b += b * w; e.w += w;
      buckets.set(key, e);
    }
    const sorted = [...buckets.values()].sort((a, b) => b.w - a.w);
    const toRgb = (e) => boost([e.r / e.w, e.g / e.w, e.b / e.w]);
    const c1 = sorted[0] ? toRgb(sorted[0]) : [255, 255, 255];
    const c2 = sorted[1] ? toRgb(sorted[1]) : c1;
    const c3 = sorted[2] ? toRgb(sorted[2]) : c2;
    paintAccent(c1, c2, c3);
  };
  // a picture that can't be shown: the plain colour again (not the last song's), and the music icon instead
  img.onerror = () => {
    if (web && !plain) { extractColors(src, true); return; }
    resetAccent();
    if (st.media && st.media.artwork === src) { st.media.artwork = null; renderMusic(true); renderClosed(); }
  };
  if (web && !plain) img.crossOrigin = 'anonymous';
  img.src = src;
}
// no album art: the palette picked in Settings → Media → Colors without album art (palettes.js), Ocean by default
function resetAccent() { const P = window.SYMPONY_PALETTES; const c = (P[st.settings && st.settings.mediaColors] || P.ocean).c; paintAccent(c[0], c[1], c[2]); }
// that setting changed: shows at once while a song without art plays (a song with art keeps the art's colours)
function applyMediaColors() { if (!(st.media && st.media.artwork)) resetAccent(); }
// no artwork: the playing app's colour (appLabel), white for an app without one
// The accent colours as the page uses them: the art's (or white), warmed at night (Settings → General → Warmer colors
// at night, tint.js); called again with none when only the warmth changed
const accentSt = { c1: [255, 255, 255], c2: [255, 255, 255], c3: [255, 255, 255] };
function waveStyleOf() {
  const w = (st.settings && st.settings.waveStyle) || 'tide';
  return w === 'horizon' || w === 'classic' ? w : 'tide';
}
function applyWaveStyle(s) {
  const style = (s && (s.waveStyle === 'horizon' || s.waveStyle === 'classic' ? s.waveStyle : 'tide')) || 'tide';
  const g = $('#glow');
  if (g) {
    g.classList.toggle('tide', style === 'tide');
    g.classList.toggle('horizon', style === 'horizon');
  }
  if (window.Waves && window.NotchKit && NotchKit.waveTune) Waves.tune(NotchKit.waveTune(style));
  paintAccent();
}
function paintAccent(c1, c2, c3) {
  if (c1) { accentSt.c1 = c1; accentSt.c2 = c2 || c1; accentSt.c3 = c3 || accentSt.c2; }
  const warm = (c) => (window.Tint ? Tint.warmRgb(c) : c);
  document.documentElement.style.setProperty('--accent', warm(accentSt.c1).join(','));
  document.documentElement.style.setProperty('--accent2', warm(accentSt.c2).join(','));
  document.documentElement.style.setProperty('--accent3', warm(accentSt.c3).join(','));
  if (window.Waves) {
    const k = waveStyleOf() === 'classic' ? 1 : 0.85;
    const sc = (c) => warm(c).map((v) => Math.round(v * k));
    Waves.colors(sc(accentSt.c1), sc(accentSt.c2), sc(accentSt.c3));
  }
}
function boost([r, g, b]) {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b);
  const k = lum < 140 ? 140 / Math.max(lum, 1) : 1;
  return [r, g, b].map((v) => Math.round(Math.min(255, v * k)));
}

// ------------------------------------------------------------------ lyrics
// From LRCLIB through main (lyrics.rs), once per song while lyrics are on. Timed lyrics follow the song:
// the player on Home shows the line before, the one being sung and the next; the closed notch can show the
// one being sung under it or inside it (Settings → Media).
const lyr = { key: '', data: null, loading: false, idx: -2, html: '', exKey: '', roman: null, trans: null, hasEx: false, exRev: 0, picked: false };
// made once here: the lines inside the closed notch, the album art behind them, and the extra line in the strip under it
$('#closed').insertAdjacentHTML('beforeend', '<div id="lyrInline"><span class="li-now" dir="auto"></span><span class="li-sub" dir="auto"></span></div>');
$('#glow').insertAdjacentHTML('afterend', '<div id="lyrArt"><img alt=""></div>');
$('#peek').insertAdjacentHTML('beforeend', '<span id="peekExtra" dir="auto"></span>');
// the lyrics on Home go in #lyBody (laid out as the panel's own children), with the button that searches for
// others over them; Search lyrics (below) takes their place while it's open for the song: find.key
$('#lyrics').insertAdjacentHTML('beforeend', `<div id="lyBody"></div><button class="ly-change" id="lyChange" hidden>${fa('magnifying-glass')}</button>`);
// (busy: searching; lrclibBusy: LRCLIB turned the search away; partly: rows found while part of the search went
// unanswered, its error)
const find = { key: '', busy: false, rows: null, error: '', lrclibBusy: false, partly: '', seq: 0 };
function lyricsKey() {
  const m = st.media;
  // not for the radio (radio.rs): a live stream has no timeline to follow
  return m.active && m.title && !m.radio ? [m.title, m.artist, Math.round(m.duration || 0)].join('|') : '';
}
async function loadLyrics() {
  const m = st.media; const key = st.settings.lyricsEnabled ? lyricsKey() : '';
  if (key === lyr.key) return;
  Object.assign(lyr, { key, data: null, loading: !!key, idx: -2, picked: false });
  lyr.shift = 0; // (the song's own timing nudge comes with its lyrics)
  renderLyrics(); layout();
  if (!key) return;
  const d = await api.svc('lyrics', 'get', { title: m.title, artist: m.artist, album: m.album, duration: m.duration }).catch(() => null);
  if (lyr.key !== key) return; // another song started meanwhile
  lyr.loading = false;
  lyr.data = d && d.found ? d : null;
  lyr.picked = !!(d && d.picked); // lyrics picked by hand for this song (Search lyrics, below)
  lyr.shift = (d && Number(d.shift)) || 0; // its timing nudged by hand (below)
  renderLyrics(); layout();
}
const timedLines = () => (lyr.data && lyr.data.synced) || [];
// where the song is on the lyrics' timeline (ms): a little early so the line doesn't lag behind the voice, and as far
// later or sooner as the song's timing was nudged by hand (lyr.shift, Home → the lyrics → − / +)
function lyricMs() { return mediaPosition() * 1000 + 300 - (lyr.shift || 0); }
// the line being sung (-1 before the first one)
function lyricIndex() {
  const lines = timedLines(); const ms = lyricMs();
  let i = -1;
  for (let k = 0; k < lines.length && lines[k][0] <= ms; k++) i = k;
  return i;
}
// the closed notch shows the line being sung under it (not while it's hidden at the top edge)
function lyricsUnder() {
  const s = st.settings;
  return !!(s.lyricsEnabled && s.lyricsInNotch !== false && (s.lyricsLayout !== 'inline' || camera()) && timedLines().length && st.media.active && st.media.playing
    && !st.open && !st.tucked && !st.hudOnly && !autoHidden());
}
// …or inside it, in place of the time, while it shows the music (Settings → Media → Where the current line shows);
// over a MacBook's camera the line would be behind it, so it goes under the notch there
function lyricsInline() {
  const s = st.settings;
  if (!s || s.lyricsLayout !== 'inline' || !s.lyricsEnabled || s.lyricsInNotch === false || !timedLines().length || camera()) return false;
  if (!st.media.active || !st.media.playing || st.open || st.tucked || autoHidden()) return false;
  const act = currentActivity();
  return !!act && act.kind === 'music';
}
// what the smaller second line inside shows: the romanization / translation whenever the song has one (like
// under the notch), otherwise the chosen line ('' for none; 'extra' was a choice in test builds)
function inlineSecond() {
  if (lyr.hasEx) return 'extra';
  const v = st.settings.lyricsSecondLine || 'none';
  return v === 'none' || v === 'extra' ? '' : v;
}
let measureCtx = null;
function textWidth(list, font) {
  const g = measureCtx || (measureCtx = document.createElement('canvas').getContext('2d'));
  g.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  return Math.max(0, ...list.map((t) => g.measureText(t || '').width));
}
// Settings → Media → Lyrics text size / Bold lyrics: the line being sung in the closed notch (Normal and bold are
// the sizes it always had: 12 px, 12.5 px with a second line), and the smaller line under it scales along
const LYRIC_SCALE = { small: 0.9, normal: 1, large: 1.2 };
function lyricFonts() {
  const s = st.settings || {}; const k = LYRIC_SCALE[s.lyricsTextSize] || 1; const bold = s.lyricsBold !== false;
  const px = (n) => Math.round(n * k * 4) / 4;
  const f = { one: px(12), two: px(12.5), sub: px(10.5), w1: bold ? 600 : 500, w2: bold ? 700 : 500 };
  return { ...f, f1: `${f.w1} ${f.one}px`, f2: `${f.w2} ${f.two}px`, fs: `500 ${f.sub}px` };
}
// one width for the whole song (the widest line as shown, within limits), so the notch doesn't jump at every
// line; measured again when the song, its extras or the lyrics' look change
let stripW = { key: '', w: 0 };
function lyricsWidth() {
  const lines = timedLines(); if (!lines.length) return 0;
  const lf = lyricFonts(); const key = [lyr.key, lyr.exRev, !!lyr.data, lf.f1, lf.fs, romanOnly()].join('|');
  if (key !== stripW.key) {
    const extra = lyr.hasEx ? textWidth(lines.map((_, k) => extraText(k)), lf.fs) : 0;
    stripW = { key, w: Math.max(textWidth(lines.map((_, k) => lineText(k)), lf.f1), extra) + 40 };
  }
  return stripW.w;
}
// the same for the lines inside the closed notch, measured again when the song, its extras, the second line or the look change
let inlineW = { key: '', w: 0 };
function inlineWidth() {
  const sec = inlineSecond(); const lf = lyricFonts();
  const key = [lyr.key, lyr.exRev, sec, !!lyr.data, lf.f1, lf.f2, lf.fs, romanOnly()].join('|');
  if (key !== inlineW.key) {
    const lines = timedLines();
    const top = textWidth(lines.map((_, k) => lineText(k)), sec ? lf.f2 : lf.f1);
    inlineW = { key, w: Math.max(top, sec === 'extra' ? textWidth(lines.map((_, k) => extraText(k)), lf.fs) : 0) };
  }
  return inlineW.w;
}
// Long lines inside → Keep the width and scroll the text: a line wider than the room it has (inlineAvail, from
// layout) slides to its end after a second and stays there until the next line; with reduced motion, or when
// Sympony widens to fit, a line that's still too long just ends in "…"
let inlineAvail = 0; let inlineIdx = -2;
const RTL_START = /^[^\p{L}]*[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
function inlineMarquee() {
  const s = st.settings; const lf = lyricFonts(); const two = notchEl.classList.contains('lyrics-two');
  const on = s && s.lyricsLongLines === 'scroll' && !reducedMotion.matches && inlineAvail > 0 && notchEl.classList.contains('lyrics-inline');
  for (const [el, font] of [[$('#lyrInline .li-now'), two ? lf.f2 : lf.f1], [$('#lyrInline .li-sub'), lf.fs]]) {
    // measured once per line (this runs every 250 ms with the lines inside); a new line starts it again
    const text = el.textContent;
    const key = on && text ? [inlineIdx, text, font, inlineAvail].join('|') : '';
    if (key === (el.dataset.mq || '')) continue;
    el.dataset.mq = key;
    const over = key ? textWidth([text], font) - inlineAvail : 0;
    el.classList.toggle('scrolling', over > 1);
    if (over <= 1) { if (el.firstElementChild) el.textContent = text; continue; }
    // at 30 px a second, or faster (up to 80) when the line would be over before it reached its end
    const lines = timedLines(); const next = lines[inlineIdx + 1] ? lines[inlineIdx + 1][0] : (st.media.duration || 0) * 1000;
    const left = (next - lyricMs() + 300) / 1000;
    const d = Math.ceil(over) + 2; const secs = Math.max(d / 80, Math.min(d / 30, left - 1.6));
    el.innerHTML = `<i class="mq" style="--mq-dist:${RTL_START.test(text) ? d : -d}px;--mq-dur:${secs.toFixed(2)}s">${esc(text)}</i>`;
  }
  karLine($('#lyrInline .li-now'), inlineIdx, notchEl.classList.contains('lyrics-inline')); // Karaoke lyrics (below)
}
// the lines inside the closed notch (kept while they fade out), and the album art blurred behind them
function paintInline(inline) {
  const a = $('#lyrInline .li-now'); const b = $('#lyrInline .li-sub');
  if (!a) return;
  if (inline) {
    const i = lyricIndex(); const sec = inlineSecond();
    const now = i < 0 ? '♪' : lineText(i) || '♪';
    const sub = sec === 'next' ? lineText(i + 1) : sec === 'time' ? hm(Date.now()) : sec === 'extra' ? extraText(i) : '';
    if (a.textContent !== now) a.textContent = now;
    if (b.textContent !== sub) b.textContent = sub;
    inlineIdx = i;
    inlineMarquee();
  }
  // Karaoke lyrics (below), here because layout comes here at every open, close and page change: each line only
  // fills while it shows
  karLine(a, inlineIdx, inline);
  karLine($('#peekText'), lyr.idx, lyricsUnder() && Date.now() >= st.peekUntil);
  karHome(lyr.idx);
  const art = $('#lyrArt'); const img = $('img', art); const src = st.media.artwork;
  const op = artOpacity(inline);
  if (op && img.getAttribute('src') !== src) img.src = src;
  art.style.opacity = String(op);
}
// how strongly the album art shows behind the lines inside (Settings → Media → Album art behind the lyrics)
function artOpacity(inline) { return inline && st.media.artwork ? Math.max(0, Math.min(100, Number(st.settings.lyricsArtBg) || 0)) / 100 : 0; }
// Settings → General → Keep windows below Sympony: while the art shows behind the lines, the strip beside Sympony takes the
// color the art has at each end of the notch (appbar.rs paints the strip's left part like the left end, its right
// part like the right end), so the top bar reads as one piece. Worked out the way the page draws it: the art cropped
// to fill #lyrArt (ears included), blurred and dimmed, over the notch's own color. null: the strip keeps its own look.
let tintMemo = { art: null, key: '', v: null };
function stripTint(op, w, h, ear, left) {
  const s = st.settings; const img = $('#lyrArt img');
  if (!op || !s.reserveTop || s.autoHide || !img.complete || !img.naturalWidth) return null;
  const css = getComputedStyle(notchEl).backgroundColor;
  const bg = (css.match(/[\d.]+/g) || [0, 0, 0]).map((v, i) => (css.startsWith('color(') && i < 3 ? Number(v) * 255 : Number(v)));
  const key = [op, w, h, ear, bg].join('|');
  if (tintMemo.art !== st.media.artwork || tintMemo.key !== key) tintMemo = { art: st.media.artwork, key, v: tintColors(img, op, w + 2 * ear - 1, h, ear, bg) };
  return tintMemo.v && { ...tintMemo.v, x: left };
}
function tintColors(img, op, W, H, ear, bg) {
  try {
    const bw = W + 32; const bh = H + 32;
    const k = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
    const dw = img.naturalWidth * k; const dh = img.naturalHeight * k;
    const box = document.createElement('canvas'); box.width = bw; box.height = bh;
    box.getContext('2d').drawImage(img, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = getComputedStyle(img).filter; // the same blur and tint as on the page
    g.drawImage(box, -16, -16);
    // the notch's color under the art (a see-through one counted over black)
    const under = bg.slice(0, 3).map((v) => v * (bg.length > 3 ? bg[3] : 1));
    // an end: the ear and the edge next to it, as tall as the strip
    const end = (x) => {
      const d = g.getImageData(x, 0, ear + 2, Math.min(H, closedHeight())).data;
      const sum = [0, 0, 0]; let a = 0;
      for (let i = 0; i < d.length; i += 4) { const al = d[i + 3] / 255; sum[0] += d[i] * al; sum[1] += d[i + 1] * al; sum[2] += d[i + 2] * al; a += al; }
      const cover = (a / (d.length / 4)) * op;
      return sum.map((v, i) => Math.round((a ? v / a : 0) * cover + under[i] * (1 - cover)));
    };
    return { l: end(0), r: end(W - ear - 2) };
  } catch (e) { return null; }
}
// the art came in: the strip's colors can be worked out now
$('#lyrArt img').addEventListener('load', () => { if (st.settings && st.settings.reserveTop) layout(); });

// The line under each lyric (Settings → Media → Under each line): the words in Latin letters (worked out in
// main, offline; Japanese kanji by Windows, or the whole song in one request to the AI provider, lyrics.rs) and/or translated (the whole song in one request through the AI Chat & Translate provider).
// Show the lyrics as → Romanized only needs the romanization too, whatever goes under the lines.
const romanOnly = () => !!(st.settings && st.settings.lyricsScript === 'romanized');
function extrasKey() {
  const s = st.settings; const mode = (s.lyricsEnabled && s.lyricsExtra) || 'off'; const roman = !!s.lyricsEnabled && romanOnly();
  if ((mode === 'off' && !roman) || !timedLines().length) return '';
  return [lyr.key, mode, roman ? 'roman' : '', mode === 'translated' || mode === 'both' ? s.lyricsTranslateTo : ''].join('|');
}
function loadExtras() {
  const key = extrasKey();
  if (key === lyr.exKey) return;
  Object.assign(lyr, { exKey: key, roman: null, trans: null, hasEx: false, exRev: lyr.exRev + 1 });
  if (!key) return;
  const mode = st.settings.lyricsExtra; const m = st.media; const texts = timedLines().map(([, t]) => t);
  // each shows as it comes: the romanization at once, a translation a few seconds later
  const got = (field) => (v) => {
    if (lyr.exKey !== key) return; // another song (or setting) meanwhile
    lyr[field] = Array.isArray(v) && v.length === texts.length ? v : null;
    lyr.hasEx = texts.some((_, k) => extraParts(k).length > 0);
    lyr.exRev++;
    renderLyrics(); layout();
  };
  if (mode === 'romanized' || mode === 'both' || romanOnly()) api.svc('lyrics', 'romanize', texts).then(got('roman')).catch(() => {});
  if (mode === 'translated' || mode === 'both') {
    api.svc('lyrics', 'translate', { title: m.title, artist: m.artist, lines: texts })
      .then((r) => got('trans')(r && r.ok ? r.lines : null)).catch(() => {});
  }
}
// line k as shown: with Romanized only, its romanization in its place when it has one that differs from it
function lineText(k) {
  const lines = timedLines(); const t = (lines[k] || [])[1] || '';
  if (!romanOnly() || !lyr.roman) return t;
  const r = (lyr.roman[k] || '').trim();
  return r && r !== t.trim() ? r : t;
}
// what goes under line k: its romanization and/or translation, when they say something the line itself doesn't
// (with Romanized only the romanization is the line already, so only the translation)
function extraParts(k) {
  const lines = timedLines();
  if (k < 0 || k >= lines.length) return [];
  const t = lineText(k).trim(); const out = [];
  for (const x of [!romanOnly() && lyr.roman && lyr.roman[k], lyr.trans && lyr.trans[k]]) {
    const v = (x || '').trim();
    if (v && v !== t && !out.includes(v)) out.push(v);
  }
  return out;
}
const extraText = (k) => extraParts(k).join(' · ');

function renderLyrics() {
  const s = st.settings; const m = st.media;
  loadExtras();
  const song = !!(m.active && (m.title || m.artist));
  // the player with its lyrics while a song is on; without one, the usual Home (the choice stays)
  const mode = !!(s.lyricsEnabled && s.homeLyrics && song);
  const home = $('#page-home');
  if (mode && !home.classList.contains('lyrics-mode')) stopMirror(); // its camera would keep running out of sight
  home.classList.toggle('lyrics-mode', mode);
  $('#btnLyrics').classList.toggle('on', !!(s.lyricsEnabled && s.homeLyrics));
  $('#btnLyrics').title = s.lyricsEnabled && s.homeLyrics ? _t('Back to the calendar') : _t('Lyrics');
  $('#btnLyrics').style.display = song ? '' : 'none';
  const lines = timedLines(); const i = lyricIndex();
  lyr.idx = i;
  if (findOpen()) { if (mode) paintFind(); }
  else if (find.key) closeFind(); // another song
  else if (mode) {
    const line = (k, cls) => `<div class="ly-line ${cls}" dir="auto">${esc(k >= 0 && k < lines.length ? lineText(k) || '♪' : '')}</div>`;
    const extra = (k) => extraParts(k).map((t) => `<div class="ly-extra" dir="auto">${esc(t)}</div>`).join('');
    // with romanization or translation under the line being sung, one line less before and after it
    const far = (k) => (lyr.hasEx ? '' : line(k, ''));
    // the original song's words for a remix or another version LRCLIB doesn't have (lyrics.rs as_version)
    const src = lyr.data && lyr.data.original ? _t('Not timed · The original song’s lyrics, from LRCLIB') : _t('Not timed · Lyrics from LRCLIB');
    const html = lyr.loading ? `<div class="ly-note">${_t('Looking for lyrics…')}</div>`
      : !lyr.data ? `<div class="ly-note">${_t('No lyrics for this song')}</div>${lyr.key ? `<button class="pill-btn ly-find-go">${fa('magnifying-glass')}${_t('Search lyrics')}</button>` : ''}`
      : lyr.data.instrumental ? `<div class="ly-note">♪ ${_t('Instrumental')}</div>`
      : lines.length ? far(i - 2) + line(i - 1, 'near') + (i < 0 ? '<div class="ly-line now">♪</div>' : line(i, 'now') + extra(i)) + line(i + 1, 'near') + far(i + 2)
      : `<div class="ly-plain" dir="auto">${esc(lyr.data.plain || '')}</div><div class="ly-src">${src}</div>`;
    // only when it changed, so plain lyrics keep where they scrolled to
    if (html !== lyr.html) { $('#lyBody').innerHTML = html; lyr.html = html; scrollPlain(); }
  }
  // over lyrics found: search for others (lit when these were picked by hand)
  const change = $('#lyChange'); const canChange = mode && !!lyr.data && !!lyr.key && !findOpen();
  change.hidden = !canChange;
  if (canChange) {
    change.classList.toggle('on', lyr.picked);
    const tip = lyr.picked ? _t('Lyrics you picked. Search again, or go back to the automatic ones') : _t('Wrong lyrics? Search for others');
    if (change.title !== tip) change.title = tip;
  }
  // under the closed notch (the title peek after a song change goes first), with its romanization / translation
  if (lyricsUnder() && Date.now() >= st.peekUntil) {
    $('#peekText').textContent = i < 0 ? '♪' : lineText(i) || '♪';
    $('#peekExtra').textContent = extraText(i);
  }
  paintShift(mode); // the timing nudge (below)
  paintInline(lyricsInline());
  if (typeof refreshHomeCards === 'function') refreshHomeCards();
  if (st.page === 'home' && typeof renderHomeSection === 'function') renderHomeSection();
}
// Lyrics without timings scroll slowly with the song, as far down as the song is through its length, so the
// part being sung is about in view; scrolling them by hand holds that for a few seconds. The closed notch
// shows no line for them: a line guessed from the time would often be the wrong one, and the song's title is
// in the closed notch already.
let plainHeld = 0;
function scrollPlain() {
  const el = $('#lyrics .ly-plain'); const d = st.media.duration;
  if (!el || !d || Date.now() < plainHeld) return;
  const room = el.scrollHeight - el.clientHeight;
  if (room > 0) el.scrollTop = Math.round(room * Math.max(0, Math.min(1, mediaPosition() / d)));
}
// the same for the player's 3-line window (paintMusicPlayer): moved by transform, eased over the 1 s tick; `now`
// places it without the ease (just painted)
function scrollPlainPlayer(root, now) {
  const el = $('.mc-lyr-pl', root); const d = st.media.duration;
  if (!el || !d) return;
  const room = el.scrollHeight - el.parentNode.clientHeight;
  const LH = 17; // .mc-lyr-pl line-height: whole lines, so none shows cut in half
  const y = room > 0 ? Math.min(room, Math.round((room * Math.max(0, Math.min(1, mediaPosition() / d))) / LH) * LH) : 0;
  if (now) { el.style.transition = 'none'; el.style.transform = `translateY(${-y}px)`; void el.offsetHeight; el.style.transition = ''; }
  else el.style.transform = `translateY(${-y}px)`;
}
for (const ev of ['wheel', 'mousedown', 'touchstart']) $('#lyrics').addEventListener(ev, () => { plainHeld = Date.now() + 8000; }, { passive: true });

// ---- Search lyrics by hand (GitHub #34)
// LRCLIB has nothing for many edits and remixes from small channels, and now and then the wrong song. Search
// lyrics (under "No lyrics for this song", or the button over lyrics found) takes the place of the lyrics: the
// title and artist, filled in with the song's (cleaned up by lyrics.rs) and searched right away, and what
// LRCLIB has for them. The one picked shows at once and is remembered for the song (its title and artist) until
// Back to automatic.
const findOpen = () => !!lyr.key && find.key === lyr.key;
async function openFind() {
  const m = st.media; const key = lyr.key;
  Object.assign(find, { key, busy: true, rows: null, error: '', pickError: false });
  lyr.html = ''; $('#lyBody').innerHTML = ''; // (a search left from another song, closed while Home showed the calendar)
  renderLyrics(); layout();
  const q = await api.svc('lyrics', 'suggest', { title: m.title, artist: m.artist, album: m.album }).catch(() => null);
  if (find.key !== key) return;
  const t = $('#lyfTitle'); const a = $('#lyfArtist');
  if (t && !t.value) t.value = (q && q.title) || m.title || '';
  if (a && !a.value) a.value = (q && q.artist) || m.artist || '';
  runFind();
}
async function runFind() {
  const key = find.key; const seq = ++find.seq;
  const title = ($('#lyfTitle') || {}).value || ''; const artist = ($('#lyfArtist') || {}).value || '';
  Object.assign(find, { busy: true, error: '', pickError: false });
  paintFind();
  const r = await api.svc('lyrics', 'search', { title: title.trim(), artist: artist.trim(), duration: st.media.duration || 0 })
    .catch((e) => ({ ok: false, error: String(e) }));
  if (find.key !== key || find.seq !== seq) return; // closed, another song, or searched again meanwhile
  const ok = !!(r && r.ok);
  Object.assign(find, { busy: false, rows: ok ? r.results || [] : null, error: r && !ok ? r.error || '?' : '', lrclibBusy: !!(r && !ok && r.busy),
    partly: ok && r.partly ? r.error || '?' : '' });
  paintFind();
}
function closeFind() {
  // the fields had the keyboard: give it back (not when another tab's field has it and only the song changed)
  const ae = document.activeElement;
  if (st.typing && ae && ae.closest && ae.closest('#lyrics')) endTyping();
  Object.assign(find, { key: '', busy: false, rows: null, error: '', seq: find.seq + 1 });
  lyr.html = '';
  renderLyrics(); layout();
}
// The search in the lyrics' place: built once while it's open (what's typed stays), its list and the line under
// it painted again as they change. Each field says what goes in it at its start, also once it's filled (a
// placeholder goes away, and a title got typed into Artist). The rows: title, artist · album, the length (bright
// when it's about this song's) and timed or not; the lyrics showing now are lit; the first lines show on hover.
// LRCLIB busy or out of reach: why, and Try again; the line under the list names the song a pick is kept for.
function paintFind() {
  const body = $('#lyBody');
  if (!$('.ly-find', body)) {
    body.innerHTML = `<div class="ly-find">
      <div class="ly-find-row">
        <label class="ly-field"><span class="ly-cap">${_t('Title')}</span><input id="lyfTitle" type="text" spellcheck="false"></label>
        <label class="ly-field"><span class="ly-cap">${_t('Artist')}</span><input id="lyfArtist" type="text" spellcheck="false"></label>
        <button class="ly-find-btn ly-run" title="${_t('Search')}">${fa('arrow-right')}</button>
        <button class="ly-find-btn ly-close" title="${_t('Close')}">${fa('xmark')}</button>
      </div>
      <div class="ly-results scroll" id="lyfList"></div>
      <div class="ly-find-foot" id="lyfFoot"></div>
    </div>`;
    find.html = ''; find.foot = '';
  }
  const cur = lyr.data && lyr.data.id; const d = st.media.duration || 0;
  const kinds = { timed: _t('Timed'), plain: _t('Not timed'), instrumental: _t('Instrumental') };
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const row = (r) => {
    const near = d > 0 && r.duration > 0 && Math.abs(r.duration - d) <= 3;
    const sub = [r.artist, same(r.album, r.track) || same(r.album, r.artist) ? '' : r.album].filter(Boolean).join(' · ');
    return `<button class="ly-row${cur && r.id === cur ? ' on' : ''}" data-id="${esc(r.id)}" title="${esc(r.first || '')}">
      <span class="ly-row-t"><b dir="auto">${esc(r.track)}</b><small dir="auto">${esc(sub)}</small></span>
      <span class="ly-row-m"><em class="${near ? 'near' : ''}">${r.duration > 0 ? fmt(r.duration) : ''}</em><small>${kinds[r.kind] || ''}</small></span>
    </button>`;
  };
  // the same search again: a button under the note, a link after the line under a list that may lack some
  const again = (pill) => `<button class="ly-again${pill ? ' pill-btn' : ''}">${pill ? fa('arrows-rotate') : ''}${_t('Try again')}</button>`;
  const html = find.busy ? `<div class="ly-find-note">${_t('Searching LRCLIB…')}</div>`
    : find.error ? `<div class="ly-find-note" title="${esc(find.error)}">${find.lrclibBusy ? _t('LRCLIB is busy right now. Try again in a moment.')
      : _t('Couldn’t reach LRCLIB. Try again in a moment.')}</div>${again(true)}`
    : !find.rows ? ''
    : !find.rows.length ? `<div class="ly-find-note">${_t('Nothing found. Try just the title, or other words.')}</div>`
    : find.rows.map(row).join('') + (find.partly ? `<div class="ly-find-note ly-partly" title="${esc(find.partly)}">${_t('Part of the search got no answer from LRCLIB, so some may be missing.')} ${again(false)}</div>` : '');
  if (html !== find.html) {
    const list = $('#lyfList'); list.innerHTML = html; find.html = html;
    // the lyrics showing now in view (not scrollIntoView: it would scroll the panel around the list too)
    const on = $('.ly-row.on', list);
    if (on) list.scrollTop += on.getBoundingClientRect().top - list.getBoundingClientRect().top - 2;
  }
  const foot = find.pickError ? `<span>${_t('Couldn’t get these lyrics. Try again in a moment.')}</span>`
    : lyr.picked ? `<span>${_t('You picked the lyrics for this song.')}</span><button class="ly-auto">${_t('Back to automatic')}</button>`
    : `<span>${_t('Pick one and Sympony keeps it for {song}.', { song: `<b dir="auto">${esc(st.media.title)}</b>` })}</span>`;
  if (foot !== find.foot) { $('#lyfFoot').innerHTML = foot; find.foot = foot; }
}
async function pickLyrics(r) {
  if (!r) return;
  const m = st.media; const key = lyr.key;
  const d = await api.svc('lyrics', 'pick', { title: m.title, artist: m.artist, id: r.id }).catch(() => null);
  if (lyr.key !== key) return; // another song meanwhile
  if (!d || !d.found) { if (findOpen()) { find.pickError = true; paintFind(); } return; }
  if (findOpen()) closeFind();
  setLyrics(d);
}
async function forgetPick() {
  const m = st.media; const key = lyr.key;
  closeFind();
  Object.assign(lyr, { loading: true, data: null, picked: false });
  renderLyrics(); layout();
  const d = await api.svc('lyrics', 'forget', { title: m.title, artist: m.artist, album: m.album, duration: m.duration }).catch(() => null);
  if (lyr.key !== key) return;
  setLyrics(d);
}
// other lyrics for the same song (picked, or the automatic ones again): shown now, measured again, and their
// romanization / translation asked for again
function setLyrics(d) {
  Object.assign(lyr, { loading: false, data: d && d.found ? d : null, picked: !!(d && d.picked), idx: -2, html: '', exKey: null });
  if (d && d.shift != null) lyr.shift = Number(d.shift) || 0; // (a nudge stays with the song)
  renderLyrics(); layout();
}
$('#lyrics').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.matches('.ly-find-go, .ly-change')) openFind();
  else if (b.matches('.ly-run, .ly-again')) runFind();
  else if (b.matches('.ly-close')) closeFind();
  else if (b.matches('.ly-auto')) forgetPick();
  else if (b.matches('.ly-row')) pickLyrics((find.rows || []).find((r) => String(r.id) === b.dataset.id));
});
$('#lyrics').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('#lyfTitle, #lyfArtist')) { e.preventDefault(); runFind(); }
});
setInterval(() => {
  if (lyr.data && !timedLines().length && st.media.active && st.open) scrollPlain();
  if (!lyr.data || !timedLines().length || !st.media.active) return;
  const i = lyricIndex();
  const under = lyricsUnder(); const inline = lyricsInline();
  if (i !== lyr.idx || under !== notchEl.classList.contains('lyrics-under') || inline !== notchEl.classList.contains('lyrics-inline')) { renderLyrics(); layout(); }
  else if (inline) paintInline(true); // the time as the second line
}, 250);

// ---- Settings → Animations → Karaoke lyrics (fxKaraoke): the line being sung (timed lyrics only) fills with color from
// its start to its end over its own time, and the next one slides up into its place. In the closed notch: the line
// dim, with a colored copy over it that shows from its start as far as the song is into the line (a clip moving one
// way and the copy in it the other way, both on the compositor; the copy's text comes from an attribute, so the line's
// own text stays what the code above reads). On Home, where it may take two lines: the line's own text colored by a
// band that moves along it in reading order. Both follow the song's position (lyricMs), set again whenever the player
// says where it is, so a seek or a pause keeps them right. Lyrics without timings: as without it.
function karOn() { const s = st.settings; return !!(s && s.fxKaraoke && s.lyricsEnabled); }
// how long line i takes to fill: up to the next line (90 % of the way: a line is done a little before the next one),
// but not much longer than it takes to sing it, so a line before a long break doesn't crawl through the break
function karSpan(i) {
  const lines = timedLines(); const start = lines[i][0];
  const next = lines[i + 1] ? lines[i + 1][0] : Math.max(start + 4000, (st.media.duration || 0) * 1000);
  const t = lineText(i).trim();
  // about a word a beat; Chinese, Japanese and Korean (no spaces between words) by their syllables
  const beats = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(t) ? t.replace(/\s+/g, '').length * 0.6 : t.split(/\s+/).filter(Boolean).length;
  return { start, dur: Math.max(300, Math.min((next - start) * 0.9, Math.max(4000, 1000 + beats * 450))) };
}
// the fill where the song is: moving while it plays, held while it's paused (set again only when it's off by more than
// a few frames: this comes here often, and a fill set back and forth by a few ms would shiver)
function karTime(anims, start, dur) {
  const t = Math.max(0, Math.min(dur, lyricMs() - start));
  const run = st.media.playing && t < dur;
  for (const a of anims) {
    if (a.currentTime == null || Math.abs(a.currentTime - t) > 60 || !run) a.currentTime = t;
    if (run) { if (a.playState !== 'running') a.play(); } else if (a.playState !== 'paused') a.pause();
  }
}
// a line in the closed notch (under it, or inside it) while it shows (`live`, and showing that line: the strip under
// the notch keeps the line from before Sympony opened until the next one); a long line that scrolls gets it in the part
// that scrolls
function karLine(el, i, live) {
  if (!el) return;
  const holder = $(':scope > .mq', el) || el;
  let k = el.kar;
  const on = !!live && karOn() && i >= 0 && i < timedLines().length && el.textContent === lineText(i);
  // gone with the text it was over (a new line, the line starting to scroll, the song's title), or no longer wanted
  if (k && (!on || k.i !== i || k.key !== lyr.key || k.clip.parentNode !== holder)) {
    for (const a of k.anims) a.cancel();
    k.clip.remove();
    k = el.kar = null;
  }
  if (!on) { el.karIdx = null; return; }
  if (!k) {
    const text = holder.textContent; const span = karSpan(i);
    holder.insertAdjacentHTML('beforeend', `<i class="kar-clip" aria-hidden="true"><i class="kar-copy" data-t="${esc(text)}"></i></i>`);
    const clip = holder.lastElementChild;
    const d = RTL_START.test(text) ? 1 : -1; // a right-to-left line fills from the right
    const opts = { duration: span.dur, easing: 'linear', fill: 'both' };
    k = el.kar = { i, key: lyr.key, clip, start: span.start, dur: span.dur, anims: [
      clip.animate([{ transform: `translateX(${d * 100}%)` }, { transform: 'none' }], opts),
      clip.firstElementChild.animate([{ transform: `translateX(${-d * 100}%)` }, { transform: 'none' }], opts),
    ] };
  }
  // a new line slides up into the place of the one before
  if (el.karIdx != null && el.karIdx !== i) el.animate([{ transform: 'translateY(60%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
  el.karIdx = i;
  karTime(k.anims, k.start, k.dur);
}
// the line being sung on Home (the lyrics drawn by renderLyrics) while they show, and the lines sliding up as it starts
let karH = null; let karHomeIdx = -2;
function karHome(i) {
  const el = $('#lyBody .ly-line.now');
  const on = st.open && st.page === 'home' && $('#page-home').classList.contains('lyrics-mode') && karOn() && !!el
    && i >= 0 && i < timedLines().length && !findOpen();
  if (karH && (!on || karH.el !== el || karH.i !== i)) {
    karH.anim.cancel();
    const band = $('.kar-band', karH.el);
    if (band && karH.el.isConnected) band.replaceWith(band.textContent);
    karH = null;
  }
  if (!on) { karHomeIdx = -2; return; }
  if (!karH) {
    const text = el.textContent; const span = karSpan(i); const rtl = RTL_START.test(text);
    el.innerHTML = `<span class="kar-band${rtl ? ' rtl' : ''}">${esc(text)}</span>`;
    const ends = rtl ? ['0% 0', '100% 0'] : ['100% 0', '0% 0'];
    const anim = el.firstElementChild.animate([{ backgroundPosition: ends[0] }, { backgroundPosition: ends[1] }], { duration: span.dur, easing: 'linear', fill: 'both' });
    // the line after the one before: every line moves up a place
    if (karHomeIdx === i - 1) for (const x of $$('#lyBody > *')) x.animate([{ transform: 'translateY(16px)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    karH = { el, i, anim, start: span.start, dur: span.dur };
  }
  karHomeIdx = i;
  karTime([karH.anim], karH.start, karH.dur);
}

// ---- Lyrics that run ahead of the song or behind it (a music video on YouTube plays its intro before the album's
// first line): − / + under the lyrics on Home move them half a second sooner or later, for this song (lyrics.rs keeps
// it, like a pick); its number shows how far ("+1.5 s"), ↺ puts the record's own timing back. The lines in the closed
// notch follow the same timing. Only for timed lyrics.
$('#lyrics').insertAdjacentHTML('beforeend', `<div class="ly-shift" id="lyShift" hidden>`
  + `<button class="ly-sh" data-sh="-500" title="${_t('Lyrics sooner')}">${fa('minus')}</button>`
  + `<span class="ly-sh-v" title="${_t('Lyrics timing for this song')}"></span>`
  + `<button class="ly-sh" data-sh="500" title="${_t('Lyrics later')}">${fa('plus')}</button>`
  + `<button class="ly-sh ly-sh-0" data-sh="0" title="${_t('Reset')}">${fa('rotate-left')}</button></div>`);
function paintShift(mode) {
  const box = $('#lyShift');
  const show = !!(mode && timedLines().length && !findOpen());
  box.hidden = !show;
  if (!show) return;
  const v = lyr.shift || 0;
  const n = (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) / 1000).toLocaleString(_tLocale('en'), { maximumFractionDigits: 1 });
  $('.ly-sh-v', box).textContent = _t('{n} s', { n });
  box.classList.toggle('on', v !== 0);
}
$('#lyShift').addEventListener('click', (e) => {
  const b = e.target.closest('.ly-sh');
  if (!b || !lyr.key) return;
  const step = Number(b.dataset.sh);
  const ms = step ? Math.max(-60000, Math.min(60000, (lyr.shift || 0) + step)) : 0;
  if (ms === (lyr.shift || 0)) return;
  lyr.shift = ms;
  renderLyrics(); layout();
  // kept for the song once the clicks stop (calls to main can arrive out of order)
  const m = st.media;
  later('lyShift', 400, () => api.svc('lyrics', 'shift', { title: m.title, artist: m.artist, ms }).catch(() => {}));
});

function onMedia(m) {
  const prev = st.media;
  // ponytail: macOS, the patched helper (helper/media_mac.js) sends the app that plays after \u0001 in the album, as
  // Rust names that slot "Music" whatever plays
  if (typeof m.album === 'string' && m.album.includes('\u0001')) {
    const [album, src] = m.album.split('\u0001');
    m = { ...m, album, app: src || m.app };
  }
  st.media = m;
  st.mediaAt = Date.now();
  if (window.Waves) Waves.playing(m.playing);
  if (m.artwork && m.artwork !== prev.artwork) extractColors(m.artwork);
  if (!m.artwork) resetAccent();
  const changedTrack = m.active && (m.title !== prev.title || m.artist !== prev.artist);
  if (changedTrack && prev.title !== undefined && m.playing && st.settings.sneakPeek && !st.open && m.title) {
    // ponytail: the song change opens Sympony into a Dynamic Island style card (#island, design B) for a few seconds,
    // instead of the title strip; the strip (#peek) stays for the lyrics line
    st.islandUntil = Date.now() + ISLAND_MS;
    renderIsland();
    notchEl.classList.add('islanding');
    later('peek', ISLAND_MS + 20, () => { notchEl.classList.remove('islanding'); renderLyrics(); layout(); });
    bump();
  }
  if (Date.now() < (st.islandUntil || 0)) renderIsland();
  renderMusic();
  renderClosed();
  layout();
  loadLyrics();
  renderLyrics();
}

// a seek from any progress bar (the notch's, the Music section's, the video's): shown at once, then sent
function seekTo(sec) {
  const d = st.media.duration || 0;
  if (!d) return;
  st.media.position = Math.max(0, Math.min(d, sec)); st.media.positionUpdated = Date.now();
  cmd('seek', st.media.position);
  updateProgress();
}

function cmd(action, value) {
  if (action === 'toggle') { st.media.playing = !st.media.playing; st.media.position = mediaPosition(); st.media.positionUpdated = Date.now(); renderMusic(); renderClosed(); layout(); }
  else if (action === 'seek' && Number.isFinite(Number(value))) {
    st.media.position = Math.max(0, Number(value));
    st.media.positionUpdated = Date.now();
  }
  api.helper({ cmd: 'media', action, value });
}
$('#btnPlay').onclick = () => cmd('toggle');
$('#btnNext').onclick = () => cmd('next');
$('#btnPrev').onclick = () => cmd('prev');
$('#btnShuffle').onclick = () => cmd('shuffle');
$('#btnRepeat').onclick = () => cmd('repeat');
// The ❝ button switches Home between the player with the calendar and Mirror, and the player with the
// song's lyrics next to it. The first press also turns lyrics on (that's when Sympony starts asking LRCLIB).
// The choice is a setting, so it's still there after Sympony closes or restarts.
$('#btnLyrics').onclick = () => {
  const s = st.settings;
  // ponytail: lyrics this button turned on go off again with it (else the line under the closed notch stayed, with
  // only Settings → Media to stop it); lyrics turned on in Settings stay. The mark is per Mac, in localStorage.
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } catch (e) { return null; } return null; };
  const byButton = !!store('sympony.lyricsByButton');
  let patch;
  if (!s.lyricsEnabled) { patch = { lyricsEnabled: true, homeLyrics: true }; store('sympony.lyricsByButton', true); }
  else if (s.homeLyrics && byButton) { patch = { lyricsEnabled: false, homeLyrics: false }; store('sympony.lyricsByButton', false); }
  else patch = { homeLyrics: !s.homeLyrics };
  Object.assign(s, patch); // show it now; the saved settings come back a moment later
  api.setSettings(patch);
  loadLyrics(); renderLyrics();
};
$('#art').onclick = () => { const a = (st.media.app || '').toLowerCase(); if (a.includes('spotify')) api.openExternal('spotify:'); };

function bindSlider(bar, onSet, onDrag) {
  bar.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    st.seeking = true;
    bar.classList.add('dragging');
    const rect = bar.getBoundingClientRect();
    const frac = (ev) => Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const move = (ev) => {
      const f = frac(ev);
      const fill = $('.progress-fill', bar); const knob = $('.progress-knob', bar);
      if (fill) fill.style.width = f * 100 + '%';
      if (knob) knob.style.left = f * 100 + '%';
      if (onDrag) onDrag(f); else onSet(f);
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      bar.classList.remove('dragging');
      st.seeking = false;
      onSet(frac(ev));
      scheduleClose();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    move(e);
  });
}

bindSlider($('#progress'), (f) => seekTo(f * (st.media.duration || 0)), (f) => {
  $('#tElapsed').textContent = fmt(f * (st.media.duration || 0));
  $('#tRemain').textContent = '-' + fmt((1 - f) * (st.media.duration || 0));
});

setInterval(() => { if (st.open && st.media.playing && st.page === 'home') updateProgress(); }, 250);

// ================================================================== HUD (volume / brightness)
function onVolume(v) {
  const prev = st.volume;
  st.volume = v;
  if (v.initial || !prev || !st.settings.hudEnabled) return;
  showHud('volume');
  const prevEff = prev.muted ? 0 : prev.level;
  const curEff = v.muted ? 0 : v.level;
  if (curEff <= 0 && prevEff > 0) triggerHudBounce('down');
  else if (curEff >= 100 && prevEff < 100) triggerHudBounce('up');
}
function onBrightness(b) {
  const prev = st.brightness;
  st.brightness = b;
  if (b.initial || !prev || !b.supported || !st.settings.hudEnabled || !st.settings.hudBrightness) return;
  showHud('brightness');
}
function showHud(kind) {
  if (st.open) {
    // the Control tab's own sliders already show it (and the change usually comes from them)
    if (st.page === 'control') return;
    const lvl = kind === 'volume' ? (st.volume.muted ? 0 : st.volume.level) : st.brightness.level;
    const ico = kind === 'volume' ? (lvl === 0 ? ICONS.volMute : lvl < 34 ? ICONS.volLow : lvl < 67 ? ICONS.volMid : ICONS.volHigh) : ICONS.sun;
    headerHud(`<div class="act-icon">${ico}</div><div class="hud-bar"><div style="width:${lvl}%"></div></div><span class="hud-pct">${lvl}</span>`, 1500, 170);
    return;
  }
  const already = st.activity && st.activity.kind === 'hud-' + kind && st.activity.until > Date.now();
  showActivity('hud-' + kind, 1600);
  if (!already) bump();
}
// Settings → Animations → Volume bar bounces at the ends: main says a volume key was pressed where the volume can't
// go further (audio.rs at_the_end, only for the keys Sympony takes over). The HUD shows, its bar stretches past that end
// and springs back, and the speaker wiggles. A held key repeats: one bounce at a time (the HUD drawn again at every
// repeat would start it over each time).
function triggerHudBounce(end) {
  const s = st.settings;
  if (!s || !s.fxHudBounce || !s.hudEnabled || !st.volume || notchEl.classList.contains('hud-bounce')) return;
  if (st.open && st.page === 'control') return; // (its own slider shows the volume)
  showHud('volume');
  notchEl.classList.add('hud-bounce', end === 'down' ? 'hb-down' : 'hb-up');
  later('hudBounce', 460, () => notchEl.classList.remove('hud-bounce', 'hb-down', 'hb-up'));
}
api.on('hud:edge', triggerHudBounce);

// ---- Caps Lock, Num Lock, Scroll Lock
// main reads their toggle state (lockkeys.rs) and says when one changes: On / Off for a moment, like the volume
// (Settings → HUD → Caps Lock, Num Lock and Scroll Lock); while Caps Lock is on, a small A at the closed notch's
// left edge if that's wanted (Keep a mark while Caps Lock is on).
const LOCK_NAMES = { caps: 'Caps Lock', num: 'Num Lock', scroll: 'Scroll Lock' };
// a keycap with A, 1 or ↕ (the marks on keyboards' lock lights)
function lockIcon(key) { return `<span class="lk-key">${{ caps: 'A', num: '1', scroll: '↕' }[key] || ''}</span>`; }
function lockState(on) { return `<span class="lk-state${on ? ' on' : ''}">${on ? _t('On') : _t('Off')}</span>`; }
function onLockKeys(m) {
  const prev = st.lockKeys;
  st.lockKeys = m;
  const s = st.settings;
  if (!s) return;
  if (!st.open && s.capsLockMark && (!prev || prev.caps !== m.caps)) { renderClosed(); layout(); }
  if (m.initial || !prev || !m.changed || !s.hudEnabled || s.hudLockKeys === false) return;
  const on = !!m[m.changed];
  if (st.open) {
    headerHud(`<div class="act-icon">${lockIcon(m.changed)}</div><span class="title">${LOCK_NAMES[m.changed]}</span>${lockState(on)}`, 1500, 170);
    return;
  }
  const already = st.activity && st.activity.kind === 'hud-lock' && st.activity.until > Date.now();
  showActivity('hud-lock', 1500, { key: m.changed, on, text: LOCK_NAMES[m.changed] });
  if (!already) bump();
}
// ---- airplane mode
// main says when it's switched, also by a laptop's airplane key that Windows shows nothing for (radios.rs, once
// the radios have followed): On / Off for a moment with the Wi-Fi and Bluetooth marks lit or crossed out, since
// laptops differ in what airplane mode turns off (Settings → HUD → Airplane mode)
function radioMarks(r) {
  return [['wifi', 'Wi-Fi', fa('wifi')], ['bluetooth', 'Bluetooth', fa('bluetooth-b', 'brands')]].filter(([k]) => r[k])
    .map(([k, name, icon]) => `<span class="ap-radio${r[k] === 'on' ? ' on' : ''}" title="${name}: ${r[k] === 'on' ? _t('On') : _t('Off')}">${icon}</span>`).join('');
}
function onRadios(msg) {
  const prev = st.radios;
  st.radios = msg;
  callModule('bluetooth', 'update'); callModule('control', 'update');
  const s = st.settings;
  if (!prev || typeof prev.airplane !== 'boolean' || typeof msg.airplane !== 'boolean' || prev.airplane === msg.airplane) return;
  if (!s || !s.hudEnabled || s.hudAirplane === false) return;
  const on = msg.airplane;
  const marks = `<span class="ap-radios">${radioMarks(msg)}</span>`;
  if (st.open) {
    headerHud(`<div class="act-icon">${fa('plane')}</div><span class="title">${_t('Airplane mode')}</span>${lockState(on)}${marks}`, 2500, 230);
    return;
  }
  const already = st.activity && st.activity.kind === 'hud-airplane' && st.activity.until > Date.now();
  showActivity('hud-airplane', 2500, { on, marks, text: on ? 'on' : 'off' });
  if (!already) bump();
}
// ---- microphone and touchpad on / off
// main says when the mic's mute changes (audio.rs: a laptop's mic key, Windows + Alt + K, an app, the Control tab)
// and when Windows' touchpad switch does (lockkeys.rs: a laptop's touchpad key, Settings): On / Off (Muted for the
// mic) for a moment, like Caps Lock (Settings → HUD). The first reading only says how they are.
// a touchpad with its buttons' line (Font Awesome has none), crossed out when off
function touchpadIcon(on) {
  return `<svg class="tp-ico" viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="1.5" y="1.5" width="17" height="13" rx="2.5"/><path d="M1.5 10.5h17M10 10.5v4"/>${on ? '' : '<path d="M2.5 1.5l15 13" stroke-width="2"/>'}</svg>`;
}
function switchState(text, cls) { return `<span class="lk-state ${cls}">${text}</span>`; }
function switchHud(icon, text, state) {
  if (st.open) { headerHud(`<div class="act-icon">${icon}</div><span class="title">${text}</span>${state}`, 1600, 180); return; }
  const already = st.activity && st.activity.kind === 'hud-switch' && st.activity.until > Date.now();
  showActivity('hud-switch', 1600, { icon, text, state });
  if (!already) bump();
}
function onMic(m) {
  const prev = st.mic;
  st.mic = m;
  callModule('control', 'update');
  const s = st.settings;
  if (!s || m.initial || !prev || !prev.available || !m.available || prev.muted === m.muted || !s.hudEnabled || s.hudMic === false) return;
  switchHud(fa(m.muted ? 'microphone-slash' : 'microphone'), _t('Microphone'), m.muted ? switchState(_t('Muted'), 'mute') : switchState(_t('On'), 'on'));
}
function onTouchpad(m) {
  const prev = st.touchpad;
  st.touchpad = m;
  const s = st.settings;
  if (!s || m.initial || !prev || typeof m.on !== 'boolean' || typeof prev.on !== 'boolean' || prev.on === m.on || !s.hudEnabled || s.hudTouchpad === false) return;
  switchHud(touchpadIcon(m.on), _t('Touchpad'), switchState(m.on ? _t('On') : _t('Off'), m.on ? 'on' : ''));
}
function renderCapsMark() {
  let el = $('#capsMark');
  if (!el) { $('#closed').insertAdjacentHTML('beforeend', `<span id="capsMark" title="${_t('Caps Lock is on')}">${lockIcon('caps')}</span>`); el = $('#capsMark'); }
  el.classList.toggle('show', capsMarkShown());
}
// ---- keyboard language
// main reads the input language of the window in front (inputlang.rs) and says when it changes: Windows + Space,
// Alt + Shift, the taskbar's menu, or another window in front that keeps a language of its own. Its name for a
// moment with the short code the taskbar shows (Settings → HUD → Keyboard language); and while there's more than
// one, that code at the closed notch's right edge if that's wanted (Show the keyboard language in the closed Sympony),
// across from the Caps Lock mark. The first reading only says how it is.
function langChip(code) { return `<span class="lang-chip">${esc(code)}</span>`; }
function onInputLang(m) {
  const prev = st.inputLang;
  st.inputLang = m;
  const s = st.settings;
  if (!s) return;
  if (!st.open && s.langMark && (!prev || prev.code !== m.code || (prev.count > 1) !== (m.count > 1))) { renderClosed(); layout(); }
  if (m.initial || !prev || !m.changed || !s.hudEnabled || s.hudInputLang === false) return;
  const text = m.name || m.code;
  if (st.open) {
    headerHud(`<div class="act-icon">${fa('keyboard')}</div><span class="title">${esc(text)}</span>${langChip(m.code)}`, 1500, 200);
    return;
  }
  const already = st.activity && st.activity.kind === 'hud-lang' && st.activity.until > Date.now();
  showActivity('hud-lang', 1500, { code: m.code, text });
  if (!already) bump();
}
// the mark: not while the HUD itself shows the language
function langMarkShown() {
  const l = st.inputLang; const a = st.activity;
  return !!(st.settings && st.settings.langMark && l && l.code && l.count > 1 && !st.open && !st.hudOnly && !(a && a.kind === 'hud-lang' && a.until > Date.now()));
}
// its room on a side (as CAPS_ROOM): the chip 9 px from the edge, 6 px clear of what the side shows
function langRoom() { const el = $('#langMark'); return ((el && el.offsetWidth) || 26) + 5; }
function renderLangMark() {
  let el = $('#langMark');
  if (!el) { $('#closed').insertAdjacentHTML('beforeend', '<span id="langMark"></span>'); el = $('#langMark'); }
  const l = st.inputLang || {}; const code = l.code || '';
  if (el.dataset.code !== code) { el.dataset.code = code; el.innerHTML = code ? langChip(code) : ''; }
  el.title = l.name || '';
  el.classList.toggle('show', langMarkShown());
}
// the HUD's sides: the language's name may run on into the middle (a HUD covers the time), so Sympony only grows for a
// long name next to a narrow middle (and a very long one is cut short)
function langHudSide(text) {
  const need = Math.ceil(textWidth([text], '600 12px')) + 25 + 34 + 24; // the keyboard, the name, the code, a gap
  return Math.max(112, Math.min(210, Math.ceil((need - effectiveSizes().notchWidth) / 2)));
}

// ---- AI usage
// main reads how much of the Claude and Codex plan limits is used (aiusage.rs, Settings → AI usage), sends it as it
// changes, and says when a 5-hour session crosses the line picked there (once per session). The tab draws it
// (modules/aiusage.js); the closed notch shows the busiest session as a small ring at its left edge (beside the Caps
// Lock mark when that's there): green, amber from 70 %, red from 90 %.
const AI_NAMES = { claude: 'Claude', codex: 'Codex' };
st.aiUsage = null;
function onAiUsage(v) {
  st.aiUsage = v && typeof v === 'object' ? v : null;
  callModule('aiusage', 'update');
  // a session that resets later: the ring goes back to empty then
  const next = Math.min(...['claude', 'codex'].map((k) => aiSessionRow(k)).filter((r) => r && r.resetsAt > Date.now()).map((r) => r.resetsAt));
  if (Number.isFinite(next) && next - Date.now() < 86400000) later('aiReset', next - Date.now() + 500, () => onAiUsage(st.aiUsage));
  if (st.settings) { renderClosed(); layout(); }
}
api.on('aiusage', onAiUsage);
api.svc('aiusage', 'get').then(onAiUsage).catch(() => {});
function aiSessionRow(k) { const d = st.aiUsage && st.aiUsage[k]; return d && (d.rows || []).find((r) => r.kind === 'session'); }
// the busiest 5-hour session of the services that are on (one whose reset time has passed starts again from nothing),
// or null without any
function aiTopSession() {
  const s = st.settings || {};
  const pcts = ['claude', 'codex'].filter((k) => s[k === 'claude' ? 'aiUsageClaude' : 'aiUsageCodex']).map(aiSessionRow).filter(Boolean)
    .map((r) => (r.resetsAt && r.resetsAt <= Date.now() ? 0 : r.pct));
  return pcts.length ? Math.max(...pcts) : null;
}
function aiColor(pct) { return pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--orange)' : 'var(--green)'; }
function aiMarkShown() { return !!(st.settings && st.settings.aiUsageMark !== false && !st.open && !st.hudOnly && aiTopSession() != null); }
// its room on the left side (as CAPS_ROOM)
function aiMarkRoom() { return aiMarkShown() ? 18 : 0; }
function renderAiMark() {
  let el = $('#aiMark');
  if (!el) { $('#closed').insertAdjacentHTML('beforeend', '<span id="aiMark"></span>'); el = $('#aiMark'); }
  const shown = aiMarkShown();
  if (shown) {
    const pct = aiTopSession();
    const key = `${Math.round(pct)}|${aiColor(pct)}`;
    if (el.dataset.key !== key) { el.dataset.key = key; el.innerHTML = progressRing(pct / 100, aiColor(pct)); }
    el.style.left = 9 + (capsMarkShown() ? CAPS_ROOM : 0) + 'px';
  }
  el.classList.toggle('show', shown);
}
// a session crossed the line: "Claude session 90% used", and when it starts again
api.on('aiusage:alert', (a) => {
  if (!st.settings || !a) return;
  const text = _t('{name} session {n}% used', { name: AI_NAMES[a.service] || a.service, n: Math.floor(a.pct) });
  const left = a.resetsAt ? a.resetsAt - Date.now() : 0;
  const sub = left > 0 ? _t('Resets in {time}, at {at}', { time: left < 3600000 ? _t('{n} min', { n: Math.max(1, Math.ceil(left / 60000)) }) : dur(left / 1000), at: hm(a.resetsAt) }) : '';
  chime();
  if (st.open) { toast(fa('gauge'), sub ? `${text} · ${sub}` : text, { color: aiColor(a.pct), ms: 8000 }); return; }
  // each side as wide as the line on it (with the icon on the left)
  const side = Math.max(150, Math.ceil(Math.max(textWidth([text], '600 12px') + 34, textWidth([sub], '500 12px') + 14)));
  showActivity('toast', 10000, { icon: fa('gauge'), text, sub, color: aiColor(a.pct), side, tab: enabledTabs().includes('aiusage') ? 'aiusage' : undefined });
  bump();
});

// ================================================================== battery
function onPower(p) {
  const prev = st.power;
  st.power = p;
  renderBattery();
  if (!st.open && st.settings && (!prev || prev.level !== p.level || prev.pluggedIn !== p.pluggedIn)) { renderClosed(); layout(); }
  if (!prev || !p.hasBattery || !st.settings.batteryEnabled) return;
  if (st.settings.chargingActivity && p.pluggedIn !== prev.pluggedIn) {
    showActivity(p.pluggedIn ? 'charging' : 'unplugged', 2800);
    bump();
  } else if (!p.pluggedIn && p.level <= st.settings.lowBatteryThreshold && prev.level > st.settings.lowBatteryThreshold) {
    showActivity('battery-low', 4500);
    bump();
  }
}
function renderBattery() {
  if (window.N && N.carousel) N.carousel.renderTop();
  const p = st.power;
  const el = $('#battery');
  if (!el) return;
  const show = p && p.hasBattery && st.settings.batteryEnabled;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  $('#batteryPct').textContent = st.settings.showBatteryPercent ? p.level + '%' : '';
  $('.battery-fill', el).style.width = Math.max(4, p.level) + '%';
  // a ring instead of the bar (Settings → Battery → Icon)
  el.classList.toggle('ring', st.settings.batteryStyle === 'ring');
  $('.br-level', el).style.strokeDasharray = `${Math.max(3, p.level)} 100`;
  el.classList.toggle('charging', p.pluggedIn);
  el.classList.toggle('low', !p.pluggedIn && p.level <= st.settings.lowBatteryThreshold);
  el.classList.toggle('saver', !!p.saver && !p.pluggedIn);
  el.title = p.pluggedIn ? (p.level >= 100 ? _t('Fully charged') : _t('Charging')) : (p.secondsLeft > 0 ? _t('{h}h {m}m remaining', { h: Math.floor(p.secondsLeft / 3600), m: Math.floor((p.secondsLeft % 3600) / 60) }) : _t('On battery'));
}

// ================================================================== bluetooth notices
function onBluetooth(msg) {
  const prev = st.bluetooth;
  st.bluetooth = msg.devices || [];
  callModule('bluetooth', 'update', st.bluetooth);
  callModule('control', 'update');
  if (!prev || !st.settings.bluetoothEnabled || (st.settings.liveSources || {}).bluetooth === false) return;
  for (const d of st.bluetooth) {
    const p = prev.find((x) => x.id === d.id);
    const icon = (window.DEVICE_ICONS || {})[d.kind] || fa('bluetooth-b', 'brands');
    const dev = { kind: d.kind, battery: d.battery, connected: d.connected };
    if (d.connected && (!p || !p.connected)) toast(icon, d.name, { sub: d.battery >= 0 ? `${_t('Connected')} · ${d.battery}%` : _t('Connected'), color: 'var(--sky)', side: 130, glow: 'blue', glowLoops: 2, device: dev });
    else if (!d.connected && p && p.connected) toast(icon, d.name, { sub: _t('Disconnected'), side: 130, device: dev });
    else if (d.connected && d.battery >= 0 && p && p.battery > st.settings.bluetoothLowBattery && d.battery <= st.settings.bluetoothLowBattery) {
      toast(icon, d.name, { sub: _t('Low battery · connected'), color: 'var(--red)', side: 130, ms: 5000, glow: 'red', device: dev });
    }
  }
}

// ================================================================== calendar
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
const DAY = 86400000;

api.onCalendar(({ events, errors }) => {
  st.events = events;
  st.calErrors = errors || {};
  renderCalendar();
  callModule('calendar', 'update');
  callModule('dayprogress', 'update');
});

function renderCalendar() {
  const box = $('#calendarBox');
  if (!box || !st.settings) return;
  box.style.display = st.settings.calendarEnabled ? '' : 'none';
  if (!st.settings.calendarEnabled || !st.open) return;
  const today = startOfDay(Date.now());
  if (st.selDay < today) st.selDay = today;
  const sel = new Date(st.selDay);
  $('#calMonth').innerHTML = `${sel.toLocaleDateString(_tLocale(), { month: 'long' })} <em>${sel.getFullYear()}</em>`;
  const strip = $('#calStrip');
  // two letters in English (We, Th); other languages their own short name, or one letter where that's a whole word
  // (Arabic has no short names; Indonesian Senin and Selasa would both be Se)
  const dayShort = (dt) => {
    const s = dt.toLocaleDateString(_tLocale(), { weekday: 'short' });
    return !_tLocale() ? s.slice(0, 2) : s.length <= 3 ? s : dt.toLocaleDateString(_tLocale(), { weekday: 'narrow' });
  };
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = today + i * DAY;
    const dt = new Date(d);
    const has = st.events.some((e) => e.start < d + DAY && e.end > d);
    html += `<div class="day ${i === 0 ? 'today' : ''} ${d === st.selDay ? 'sel' : ''} ${has ? 'has' : ''}" data-day="${d}">
      <small>${dayShort(dt)}</small><b>${dt.getDate()}</b></div>`;
  }
  strip.innerHTML = html;
  $$('.day', strip).forEach((el) => { el.onclick = () => { st.selDay = +el.dataset.day; renderCalendar(); }; });

  const list = $('#calEvents');
  const dayEvents = st.events.filter((e) => e.start < st.selDay + DAY && e.end > st.selDay);
  if (!dayEvents.length) {
    const noFeeds = !(st.settings.icsFeeds || []).length && !(st.settings.localEvents || []).length;
    list.innerHTML = noFeeds
      ? `<div class="cal-empty">${_t('No calendars yet.')}<br><button id="calConnect">${_t('Connect Google / Outlook calendar')}</button></div>`
      : `<div class="cal-empty">${st.selDay === today ? _t('No more events today 🎉') : _t('No events')}</div>`;
    const b = $('#calConnect'); if (b) b.onclick = () => api.openSettings('calendar');
    return;
  }
  const now = Date.now();
  list.innerHTML = dayEvents.map((e) => {
    const time = e.allDay ? _t('All day') : `${hm(e.start)} – ${hm(e.end)}`;
    const sub = [time, e.location].filter(Boolean).join(' · ');
    const cls = e.end < now ? 'past' : (e.start <= now && !e.allDay ? 'now' : '');
    return `<div class="ev ${cls}" data-id="${esc(e.id)}"><div class="bar" style="background:${esc(e.color || '#0a84ff')}"></div>
      <div class="ev-body"><div class="ev-title">${esc(e.title)}</div><div class="ev-sub">${esc(sub)}</div></div></div>`;
  }).join('');
  $$('.ev', list).forEach((el) => { el.onclick = () => openEvent(st.events.find((x) => x.id === el.dataset.id), st.selDay); });
  const firstUpcoming = $('.ev:not(.past)', list);
  if (firstUpcoming && st.selDay === today) firstUpcoming.scrollIntoView({ block: 'nearest' });
}
// Times follow Sympony's 24-hour setting (it starts out matching Windows), in the local language.
function hm(t) {
  const h24 = !st.settings || st.settings.clock24h !== false;
  return new Date(t).toLocaleTimeString(_tLocale(), { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12' });
}
// An event clicked on Home or the Dashboard: its card in the Calendar tab (`day`: the day it was clicked on).
// With that tab off: its meeting link, else its page in the web calendar, else nothing.
function openEvent(e, day) {
  if (!e) return;
  if (moduleEnabled('calendar')) { setTab('calendar'); callModule('calendar', 'showEvent', e.id, day); return; }
  const link = e.url || e.openUrl;
  if (link) api.openExternal(link);
}

$('#calAdd').onclick = () => api.openSettings('calendar');

function checkReminders() {
  const s = st.settings;
  if (!s || !s.calendarEnabled || !s.meetingReminderMinutes) return;
  const now = Date.now();
  for (const e of st.events) {
    if (e.allDay || st.remindedIds.has(e.id)) continue;
    const until = e.start - now;
    if (until <= s.meetingReminderMinutes * 60000 && until > -60000) {
      st.remindedIds.add(e.id);
      const mins = Math.max(0, Math.ceil(until / 60000));
      // while Sympony is open the reminder shows in its header instead
      if (st.open) toast(ICONS.calendar, `${e.title} · ${mins <= 0 ? _t('now') : fmtIn(mins)}`, { ms: 8000, color: e.color || '#0a84ff' });
      else { showActivity('meeting', 9000, e); bump(); }
      chime();
    }
  }
}
setInterval(checkReminders, 15000);

// ================================================================== sounds (generated, no audio files)
// With Sympony on several displays only the notch on the display you're working on chimes (main says which,
// alerts.rs); `force`: this notch decided it already (a click here, or main chose it).
let audioCtx;
api.on('notch:soundHere', (v) => { st.soundHere = !!v; });
function chime(kind = 'soft', force = false) {
  if (!force && st.soundHere === false) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const notes = kind === 'done' ? [880, 1108.7, 1318.5] : kind === 'prayer' ? [523.25, 659.25, 783.99, 1046.5] : [660, 880];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 1);
    });
  } catch { /* audio unavailable */ }
}

// ================================================================== mirror
let mirrorStream = null;
async function startMirror() {
  try {
    mirrorStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320, facingMode: 'user' }, audio: false });
    $('#mirrorVideo').srcObject = mirrorStream;
    $('#mirror').classList.add('live');
  } catch (e) {
    $('#mirrorIdle span').textContent = _t('No camera');
  }
}
function stopMirror() {
  if (mirrorStream) { mirrorStream.getTracks().forEach((t) => t.stop()); mirrorStream = null; }
  $('#mirrorVideo').srcObject = null;
  $('#mirror').classList.remove('live');
}
$('#mirror').onclick = () => { if (mirrorStream) stopMirror(); else startMirror(); };

// ================================================================== shelf
function bytes(n, perSec) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i] + (perSec ? '/s' : '');
}

function renderShelfBadge() {
  const badge = $('#shelfBadge');
  if (!badge) return;
  badge.textContent = st.shelf.length;
  badge.classList.toggle('show', st.shelf.length > 0);
}

function renderShelf() {
  const page = $('#page-shelf');
  const wrap = $('#shelfItems');
  page.classList.toggle('empty', st.shelf.length === 0);
  renderShelfBadge();
  wrap.innerHTML = st.shelf.map((it) => {
    let thumb;
    if (it.kind === 'file') thumb = it.thumb ? `<div class="thumb ${it.photo ? 'photo' : ''}"><img src="${esc(it.thumb)}" alt=""></div>` : `<div class="thumb">${it.isDir ? ICONS.folder : ICONS.file}</div>`;
    else thumb = `<div class="thumb">${it.kind === 'link' ? ICONS.link : ICONS.text}</div>`;
    const meta = it.kind === 'file' ? (it.isDir ? _t('Folder') : it.size != null ? bytes(it.size) : '') : it.kind === 'link' ? _t('Link') : _t('Text');
    return `<div class="item ${st.selected.has(it.id) ? 'sel' : ''} ${it.missing ? 'missing' : ''}" draggable="true" data-id="${esc(it.id)}" title="${esc(it.path || it.text || '')}">
      ${thumb}<div class="name">${esc(it.name)}</div><div class="meta">${it.from === 'phone' ? `<span class="from-phone" title="${_t('From your phone')}">${fa('mobile-screen')}</span>` : ''}${meta}</div><button class="rm" title="${_t('Remove')}">${ICONS.x}</button></div>`;
  }).join('');
  $$('.item', wrap).forEach((el) => {
    const id = el.dataset.id;
    el.onclick = (e) => {
      if (e.target.closest('.rm')) { removeShelf([id]); return; }
      if (e.ctrlKey || e.shiftKey) { if (st.selected.has(id)) st.selected.delete(id); else st.selected.add(id); } else { st.selected = new Set([id]); }
      renderShelf();
    };
    el.ondblclick = () => api.shelfOpen(id);
    // a drag out of the Shelf: the Mac's own file drag (shelf.rs); while it goes on, the drag coming back over
    // Sympony isn't a drop here (no tiles, no Shelf)
    el.ondragstart = (e) => { e.preventDefault(); shelfDragOut = Date.now(); api.shelfStartDrag(st.selected.has(id) ? [...st.selected] : [id]); };
    el.oncontextmenu = (e) => { e.preventDefault(); if (!st.selected.has(id)) { st.selected = new Set([id]); renderShelf(); } showCtx(e, id); };
  });
  renderClip();
  renderPhone();
  if (typeof refreshShelfCards === 'function') refreshShelfCards();
  if (typeof renderShelfSection === 'function' && st.page === 'shelf') renderShelfSection();
}

async function loadShelf() { st.shelf = await api.shelfList(); renderShelf(); }
async function removeShelf(ids) { st.shelf = await api.shelfRemove(ids); ids.forEach((i) => st.selected.delete(i)); renderShelf(); }
api.onShelfChanged((list) => { st.shelf = list; renderShelf(); });

$('#shelfAdd').onclick = async () => { st.ctxOpen = true; st.shelf = await api.shelfPick(); st.ctxOpen = false; renderShelf(); };
$('#shelfClear').onclick = async () => { st.shelf = await api.shelfClear(); st.selected.clear(); renderShelf(); };
$('#shareTarget').onclick = () => {
  const ids = (st.selected.size ? [...st.selected] : st.shelf.map((s) => s.id)).filter((id) => (st.shelf.find((s) => s.id === id) || {}).kind === 'file');
  const label = $('#shareTarget span');
  label.textContent = ids.length ? _t('Opening…') : _t('Add files first');
  later('shareLabel', 1800, () => { label.textContent = _t('Share'); });
  if (ids.length) api.shelfShare(ids);
};

function showCtx(e, id) {
  const it = st.shelf.find((s) => s.id === id);
  const m = $('#ctxMenu');
  const ids = [...st.selected];
  const items = [
    ['open', _t('Open'), () => api.shelfOpen(id)],
    it.kind === 'file' && ['folder', _t('Show in folder'), () => api.shelfReveal(id)],
    ['copy', it.kind === 'file' ? _t('Copy path') : _t('Copy'), () => api.shelfCopy(id)],
    it.kind === 'file' && ['share', ids.length > 1 ? _t('Share {n} items', { n: ids.length }) : _t('Share…'), () => api.shelfShare(ids)],
    ['trash', ids.length > 1 ? _t('Remove {n} items', { n: ids.length }) : _t('Remove'), () => removeShelf(ids), 'danger'],
  ].filter(Boolean);
  m.innerHTML = items.map(([ic, label, , cls], i) => `<button data-i="${i}" class="${cls || ''}">${ICONS[ic]}${label}</button>`).join('');
  $$('button', m).forEach((b) => { b.onclick = () => { items[+b.dataset.i][2](); hideCtx(); }; });
  const nb = notchEl.getBoundingClientRect();
  m.classList.add('show');
  m.style.left = Math.min(e.clientX - nb.left, nb.width - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(e.clientY - nb.top, nb.height - m.offsetHeight - 6) + 'px';
  st.ctxOpen = true;
}
function hideCtx() { $('#ctxMenu').classList.remove('show'); if (st.ctxOpen) { st.ctxOpen = false; scheduleClose(); } }
document.addEventListener('mousedown', (e) => { if (st.ctxOpen && !e.target.closest('#ctxMenu')) hideCtx(); });

// ================================================================== shelf: clipboard history
// The Shelf's other side (Settings → Drop Actions & Shelf → Remember what you copy): what was copied, pinned ones
// first, then newest first. Main keeps the list (clipboard.rs); a click puts one back on the clipboard.
let clip = [];
let shelfView = 'files';   // which side of the Shelf shows: 'files' or 'clip'
let clipCopied = null;     // { id, ok } for a moment after a click
const clipOn = () => !!(st.settings && st.settings.clipboardHistory);

function clipAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return _t('now');
  if (m < 60) return _t('{n}m', { n: m });
  if (m < 1440) return _t('{n}h', { n: Math.round(m / 60) });
  return _t('{n}d', { n: Math.round(m / 1440) });
}

// a swatch's color as main sends it ("#rrggbb" or "rgba(r, g, b, a)"), else '' (never anything else into a style)
const swatchCss = (c) => (/^#[0-9a-f]{6}$|^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (?:0|1|0?\.\d{1,3})\)$/i.test(c || '') ? c : '');

function clipTile(it) {
  let body; let meta; let tip;
  if (it.kind === 'image') {
    body = it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : `<div class="noimg">${fa('image', 'regular')}</div>`;
    meta = `${fa('image', 'regular')}<span>${it.w}×${it.h}</span>`;
    tip = `${it.w}×${it.h} · ${bytes(it.size || 0)}`;
  } else if (it.kind === 'link') {
    const m = it.text.match(/^https?:\/\/(?:www\.)?([^/?#]+)(.*)$/i) || [null, it.text, ''];
    body = `<div class="body" dir="ltr"><b>${esc(m[1])}</b>${esc(m[2])}</div>`;
    meta = `${ICONS.link}<span>${_t('Link')}</span>`;
    tip = it.text;
  } else if (swatchCss(it.color)) {
    // a color code (the color picker's, or any copied one; main knows it, clipboard.rs): a swatch next to it
    body = `<div class="body" dir="ltr"><span class="clip-sw" style="background:${swatchCss(it.color)}"></span>${esc(it.text.trim())}</div>`;
    meta = `${fa('eye-dropper')}<span>${_t('Color')}</span>`;
    tip = it.text.trim();
  } else {
    // blank lines at the start would only push the text down
    body = `<div class="body" dir="auto">${esc(it.text.replace(/^(?:[ \t]*\r?\n)+/, ''))}</div>`;
    meta = `${ICONS.text}<span>${_t('Text')}</span>`;
    tip = it.text.slice(0, 300) + (it.len > 300 ? '…' : '');
  }
  const done = clipCopied && clipCopied.id === it.id
    ? `<div class="done ${clipCopied.ok ? '' : 'fail'}">${clipCopied.ok ? `${fa('check')}${_t('Copied')}` : _t('Couldn’t copy')}</div>` : '';
  return `<div class="clip ${it.kind} ${swatchCss(it.color) ? 'color' : ''} ${it.pinned ? 'pinned' : ''}" data-id="${esc(it.id)}" title="${esc(tip)}">${body}
    <div class="meta">${meta}${it.pinned ? `<span class="pin" title="${_t('Pinned')}">${ICONS.pin}</span>` : ''}<span class="ago">${clipAgo(it.at)}</span></div>
    <div class="acts"><button data-act="pin" title="${it.pinned ? _t('Unpin') : _t('Pin')}">${it.pinned ? fa('thumbtack-slash') : ICONS.pin}</button><button data-act="rm" title="${_t('Remove')}">${ICONS.x}</button></div>${done}</div>`;
}

function renderClip() {
  const page = $('#page-shelf');
  if (!page || !st.settings) return;
  // the switch shows while the history is on, or pinned copies are left after turning it off
  const shown = clipOn() || clip.length > 0;
  if (!shown) shelfView = 'files';
  $('#shelfSwitch').hidden = !shown;
  $$('#shelfSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.v === shelfView));
  page.classList.toggle('clip-view', shelfView === 'clip');
  page.classList.toggle('clip-empty', clip.length === 0);
  $('#clipCard').classList.toggle('off', !clipOn());
  $('#clipHint').textContent = clipOn() ? _t('Click one to copy it') : _t('Off in Settings');
  if (shelfView !== 'clip') return;
  const wrap = $('#clipItems');
  wrap.innerHTML = clip.map(clipTile).join('');
  $$('.clip', wrap).forEach((el) => {
    const id = el.dataset.id;
    el.onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) { copyClip(id); return; }
      const it = clip.find((c) => c.id === id);
      if (act.dataset.act === 'rm') removeClip(id); else if (it) pinClip(id, !it.pinned);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showClipCtx(e, id); };
  });
  // the one just copied stays in view once it's in its new place (the top of the unpinned ones; a pinned one stays)
  const was = clipCopied && clip.find((c) => c.id === clipCopied.id);
  const done = was && (was.pinned || clip.find((c) => !c.pinned) === was) && $(`.clip[data-id="${CSS.escape(was.id)}"]`, wrap);
  if (done) {
    const r = done.getBoundingClientRect(); const w = wrap.getBoundingClientRect();
    if (r.left < w.left) wrap.scrollLeft -= w.left - r.left + 4;
    else if (r.right > w.right) wrap.scrollLeft += r.right - w.right + 4;
  }
}

async function copyClip(id) {
  const ok = await api.svc('clipboard', 'copy', id).catch(() => false);
  clipCopied = { id, ok: !!ok };
  renderClip();
  later('clipCopied', 1300, () => { clipCopied = null; renderClip(); });
}
async function pinClip(id, on) { clip = await api.svc('clipboard', 'pin', id, on); renderClip(); }
async function removeClip(id) { clip = await api.svc('clipboard', 'remove', id); renderClip(); }

function showClipCtx(e, id) {
  const it = clip.find((c) => c.id === id);
  if (!it) return;
  const m = $('#ctxMenu');
  const items = [
    [ICONS.copy, _t('Copy'), () => copyClip(id)],
    it.kind === 'link' && [ICONS.open, _t('Open link'), () => api.svc('clipboard', 'open', id)],
    [it.pinned ? fa('thumbtack-slash') : ICONS.pin, it.pinned ? _t('Unpin') : _t('Pin'), () => pinClip(id, !it.pinned)],
    [ICONS.trash, _t('Remove'), () => removeClip(id), 'danger'],
  ].filter(Boolean);
  m.innerHTML = items.map(([ic, label, , cls], i) => `<button data-i="${i}" class="${cls || ''}">${ic}${label}</button>`).join('');
  $$('button', m).forEach((b) => { b.onclick = () => { items[+b.dataset.i][2](); hideCtx(); }; });
  const nb = notchEl.getBoundingClientRect();
  m.classList.add('show');
  m.style.left = Math.min(e.clientX - nb.left, nb.width - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(e.clientY - nb.top, nb.height - m.offsetHeight - 6) + 'px';
  st.ctxOpen = true;
}

function setShelfView(v) { shelfView = v; renderClip(); }
$('#shelfSwitch [data-v="files"]').innerHTML = ICONS.tray;
$('#shelfSwitch [data-v="clip"]').innerHTML = fa('clipboard', 'regular');
$('.clip-card-icon').innerHTML = fa('clipboard', 'regular');
$('.clip-empty-icon').innerHTML = fa('clipboard', 'regular');
$('#clipClear').innerHTML = ICONS.trash;
$$('#shelfSwitch button').forEach((b) => { b.onclick = () => setShelfView(b.dataset.v); });
$('#clipClear').onclick = async () => { clip = await api.svc('clipboard', 'clear'); renderClip(); };
// turned off with pinned ones left: the card leads to the setting
$('#clipCard').onclick = () => { if (!clipOn()) { api.openSettings('dropactions'); closeNotch(); } };
// a mouse wheel scrolls the row sideways
$('#clipItems').addEventListener('wheel', (e) => {
  const wrap = $('#clipItems');
  if (wrap.scrollWidth <= wrap.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * wrap.clientWidth : e.deltaY;
  wrap.scrollBy({ left: px, behavior: Math.abs(px) >= 50 ? 'smooth' : 'auto' });
}, { passive: false });
api.on('clipboard:changed', (list) => { clip = list || []; renderClip(); if (typeof refreshShelfCards === 'function') refreshShelfCards(); });
// the screen color picker (colorpick.rs) copied a color: its code with a swatch for a moment
api.on('colorpick:picked', (c) => {
  if (!c || !c.code) return;
  const sw = `<span class="cp-swatch" style="background:${swatchCss(c.css) || 'transparent'}"></span>`;
  const sub = c.ok === false ? _t('Couldn’t copy') : _t('Copied');
  if (st.open) { toast(sw, c.ok === false ? `${c.code} · ${sub}` : _t('{code} copied', { code: c.code }), { ms: 2500 }); return; }
  const side = Math.max(110, Math.ceil(Math.max(textWidth([c.code], '600 12px') + 34, textWidth([sub], '500 12px') + 14)));
  toast(sw, c.code, { sub, ms: 2600, side });
});
// "Remember what you copy" turned on or off (after applySettings has the new settings)
api.onSettings(() => setTimeout(renderClip, 0));
api.svc('clipboard', 'list').then((list) => { clip = list || []; renderClip(); if (typeof refreshShelfCards === 'function') refreshShelfCards(); }).catch(() => {});

// ================================================================== shelf: phone
// The Phone button next to Files | Clipboard (Settings → Drop Actions & Shelf → Phone): it starts sharing and shows a
// QR code; the phone's camera opens a page Sympony serves on this Wi-Fi (phone.rs) to send files, photos, texts and links
// to the PC and to download the Shelf's files. Sharing goes on while Sympony is closed (a green dot on the button) until
// Stop, or 15 minutes without use. The panel takes the files' place; Files, Clipboard or the button again take it away.
let phone = { on: false };   // main's: { on, qr, url, address, pc, connected }, or { on: false, error | why }
let phoneView = false;
let phoneGot = { n: 0, until: 0 }; // files from the phone close together: one toast that counts them
const phoneAllowed = () => !!(st.settings && st.settings.phoneShare !== false);

function phoneMsg(icon, title, sub, act, label) {
  return `<div class="ph-msg"><div class="ph-msg-icon">${icon}</div><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}
    ${act ? `<button class="ph-btn" data-act="${act}">${label}</button>` : ''}</div>`;
}

function renderPhone() {
  const page = $('#page-shelf');
  const btn = $('#shelfPhone');
  if (!page || !btn || !st.settings) return;
  if (!phoneAllowed()) phoneView = false;
  btn.hidden = !phoneAllowed();
  btn.classList.toggle('on', phoneView);
  btn.classList.toggle('live', !!phone.on);
  page.classList.toggle('phone-view', phoneView);
  if (!phoneView) return;
  const box = $('#phonePanel');
  if (phone.starting) box.innerHTML = phoneMsg(fa('spinner fa-spin'), _t('Starting…'));
  else if (phone.on) {
    box.innerHTML = `<div class="ph-qr" title="${esc(phone.url)}">${phone.qr}</div>
      <div class="ph-text">
        <div class="ph-title"><span>${_t('Scan with your phone’s camera')}</span>${phone.connected ? `<span class="ph-tag">${fa('circle-check')}${_t('Phone connected')}</span>` : ''}</div>
        <div class="ph-sub">${_t('Your phone needs to be on the same Wi-Fi. The link stops after 15 minutes without use.')}</div>
        <div class="ph-small"><span dir="ltr">${esc(phone.address)}</span> · ${esc(phone.pc)}</div>
        <div class="ph-small">${MAC ? _t('If the Mac’s firewall is on, macOS may ask to allow Sympony’s incoming connections the first time.') : _t('Windows may ask to allow Sympony on private networks the first time.')}</div>
        <div class="ph-btns"><button class="ph-btn stop" data-act="stop">${fa('stop')}${_t('Stop')}</button></div>
      </div>`;
  } else if (phone.error === 'wifi') {
    box.innerHTML = phoneMsg(fa('wifi'), _t('Connect to Wi-Fi first'), _t('Your phone and this PC need to be on the same Wi-Fi.'), 'start', _t('Try again'));
  } else if (phone.error) {
    box.innerHTML = phoneMsg(fa('circle-exclamation'), _t('Couldn’t start sharing'), esc(phone.message || ''), 'start', _t('Try again'));
  } else {
    // stopped while the panel was up: 15 minutes without use, or Stop on another display
    box.innerHTML = phoneMsg(fa('mobile-screen'), _t('Sharing stopped'), phone.why === 'idle' ? _t('The link stopped after 15 minutes without use.') : '', 'start', _t('Start again'));
  }
}

async function startPhone() {
  phone = { on: false, starting: true };
  renderPhone();
  const s = await api.svc('phone', 'start').catch((e) => ({ on: false, error: 'listen', message: String(e) }));
  phone = s || { on: false };
  // (the Phone button or the Shelf turned off meanwhile)
  if (!phone.on && !phone.error && phoneView) phoneView = false;
  renderPhone();
}
async function stopPhone() {
  phoneView = false;
  phone = { on: false };
  renderPhone();
  await api.svc('phone', 'stop').catch(() => {});
}
function togglePhone() {
  if (phoneView) { phoneView = false; renderPhone(); return; }
  if (shelfView !== 'files') setShelfView('files');
  phoneView = true;
  if (phone.on) renderPhone(); else startPhone();
}

$('#shelfPhone').innerHTML = `${fa('mobile-screen')}<span class="ph-lbl">${_t('Phone')}</span>`;
$('#shelfPhone').onclick = togglePhone;
$('#phonePanel').onclick = (e) => {
  const b = e.target.closest('[data-act]');
  if (b) { if (b.dataset.act === 'stop') stopPhone(); else startPhone(); }
};
// Files or Clipboard picked: the panel goes (sharing goes on)
$$('#shelfSwitch button').forEach((b) => b.addEventListener('click', () => { if (phoneView) { phoneView = false; renderPhone(); } }));
api.on('phone:state', (s) => { phone = s || { on: false }; renderPhone(); if (typeof refreshShelfCards === 'function') refreshShelfCards(); });
api.on('phone:received', () => {
  const now = Date.now();
  phoneGot = { n: now < phoneGot.until ? phoneGot.n + 1 : 1, until: now + 6000 };
  const n = phoneGot.n;
  toast(fa('mobile-screen'), n === 1 ? _t('1 file from your phone') : _t('{n} files from your phone', { n }), { color: '#30d158', ms: 4000, side: 170, tab: 'shelf' });
});
api.on('phone:text', (d) => {
  toast(fa('mobile-screen'), d && d.link ? _t('Link from your phone copied') : _t('Text from your phone copied'), { color: '#0a84ff', ms: 3500, side: 190 });
});
api.onSettings(() => setTimeout(renderPhone, 0));
api.svc('phone', 'state').then((s) => { if (s) { phone = s; renderPhone(); } }).catch(() => {});

// ================================================================== drag & drop: shelf + drop actions
let dropCatalog = [];
function dragHasPayload(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  return t && (t.includes('Files') || t.includes('text/plain') || t.includes('text/uri-list'));
}
function dragKinds(e) {
  // MIME types are visible while dragging (file paths only on drop) — enough to dim tiles that don't apply.
  const kinds = new Set();
  for (const it of e.dataTransfer.items || []) {
    if (it.kind !== 'file') { kinds.add('text'); continue; }
    if (/^image\/(png|jpe?g|bmp|gif|x-icon)/.test(it.type)) kinds.add('image');
    else if (/zip/.test(it.type)) kinds.add('zip');
    else if (!it.type) kinds.add('other'); // folders and drives have no MIME type
    else kinds.add('file');
  }
  return kinds;
}
function useDropActions() { return st.settings.dropActionsEnabled && (st.settings.dropActions || []).length > 0; }

function renderDropTiles(kinds) {
  const order = st.settings.dropActions || [];
  const tiles = order.map((id) => dropCatalog.find((a) => a.id === id)).filter(Boolean)
    .filter((a) => a.id !== 'shelf' || st.settings.shelfEnabled);
  const filesOnly = !kinds.has('text');
  const applies = (id) => {
    if (id === 'shelf') return true;
    if (!filesOnly) return false;
    if (id === 'unzip') return kinds.has('zip');
    if (id === 'convert') return kinds.has('image');
    if (id === 'eject') return kinds.has('other');
    return true;
  };
  $('#dropTiles').innerHTML = tiles.map((a) => `<div class="drop-tile ${applies(a.id) ? '' : 'na'}" data-id="${a.id}"><i class="${a.icon}"></i><span>${esc(a.label)}</span></div>`).join('');
}

// The Rust edition gets file drags from Tauri (real paths + position); text/link drags may still
// arrive as HTML5 events. Both feed the same begin/hover/drop helpers.
function dragBegin(kinds) {
  if (st.dragging) return;
  st.dragging = true;
  notchEl.classList.add('dragging');
  // dropped files go on the Files side: show that one
  if (shelfView === 'clip') setShelfView('files');
  if (phoneView) { phoneView = false; renderPhone(); }
  if (useDropActions()) { renderDropTiles(kinds); openNotch('drop'); }
  else if (st.settings.shelfEnabled && (st.settings.shelfOpenOnDrag || st.open)) openNotch('shelf');
}
function dragHover(target) {
  const tile = target && target.closest && target.closest('.drop-tile');
  $$('.drop-tile').forEach((t) => t.classList.toggle('over', t === tile && !t.classList.contains('na')));
  const onShare = !!(target && target.closest && target.closest('#shareTarget'));
  notchEl.classList.toggle('on-share', onShare);
  $('#shareTarget').classList.toggle('over', onShare);
}
function dragFinish() {
  st.dragging = false;
  cancel('dragEnd');
  notchEl.classList.remove('dragging', 'on-share');
  $('#shareTarget').classList.remove('over');
}
function dragAbort() {
  dragFinish();
  if (st.page === 'drop') showPage(st.tab);
  scheduleClose();
}
function kindsFromPaths(paths) {
  const k = new Set();
  for (const p of paths) {
    const ext = (p.match(/\.([a-z0-9]+)$/i) || [])[1];
    if (!ext) k.add('other');
    else if (/^(png|jpe?g|bmp|gif|ico)$/i.test(ext)) k.add('image');
    else if (/^zip$/i.test(ext)) k.add('zip');
    else k.add('file');
  }
  return k;
}

async function handleDrop(files, target, text) {
  const tile = target && target.closest && target.closest('.drop-tile:not(.na)');
  const onShare = !!(target && target.closest && target.closest('#shareTarget'));
  dragFinish();
  let action = tile ? tile.dataset.id : (onShare ? 'share' : (st.page === 'drop' || st.page === 'shelf' ? 'shelf' : null));
  // text or a link dropped anywhere else on Sympony (the closed notch, any tab, Share) is kept in the Shelf too (GitHub #58)
  if ((!action || action === 'share') && !files.length && text && text.trim() && st.settings.shelfEnabled) action = 'shelf';
  if (st.page === 'drop') showPage(action === 'shelf' ? 'shelf' : st.tab);
  if (!action) { scheduleClose(); return; }
  if (action === 'shelf') {
    if (!st.settings.shelfEnabled) return;
    let items = files.map((p) => ({ kind: 'file', path: p }));
    if (!items.length && text && text.trim()) items = [{ kind: 'text', text: text.trim() }];
    if (!items.length) return;
    const before = st.shelf.length;
    shelfFly(items, before);
    st.shelf = await api.shelfAdd(items);
    renderShelf();
    if (st.shelf.length > before) bump();
    // dropped on the closed notch (no tab to fly into): it shows the Shelf's count for a moment
    if (!st.open && st.shelf.length > before) showActivity('shelf', 2500, st.shelf.length);
    return;
  }
  if (!files.length) return;
  if (action === 'share') { api.shareFiles(files); return; }
  toast(fa('spinner fa-spin'), _t('Working…'), { ms: 60000 });
  const res = await api.svc('actions', 'run', action, files);
  if (res.quiet && res.ok) { st.activity = null; renderClosed(); layout(); const hf = $('#headerFloat'); if (hf) hf.classList.remove('show'); return; }
  toast(res.ok ? fa('circle-check') : fa('circle-exclamation'), res.message, { color: res.ok ? '#30d158' : '#ff453a', ms: 3500, side: 170 });
  scheduleClose();
}

// files from Explorer (Tauri)
let fileDrag = null;
// (set while a Shelf file is dragged out; the mouse moving again here means that drag is over)
let shelfDragOut = 0;
document.addEventListener('mousemove', () => { if (Date.now() - shelfDragOut > 400) shelfDragOut = 0; });
api.onFileDrag(({ type, paths, pos }) => {
  if (shelfDragOut && Date.now() - shelfDragOut < 60000) { if (type === 'drop' || type === 'leave') { fileDrag = null; dragAbort(); } return; }
  // the tab open takes these files itself (a .txt dropped on the Teleprompter's): no drop actions, no Shelf
  const own = st.open && modules.get(st.page);
  if (own && own.built && typeof own.takeFiles === 'function' && own.takeFiles(type, paths || [])) return;
  const at = pos ? document.elementFromPoint(pos.x, pos.y) : null;
  if (pos) shelfDrop.at = pos; // where it's dropped (files fly into the Shelf from there)
  if (type === 'enter') { fileDrag = paths; dragBegin(kindsFromPaths(paths)); dragHover(at); }
  else if (type === 'over') { if (!st.dragging) dragBegin(kindsFromPaths(fileDrag || [])); dragHover(at); }
  else if (type === 'drop') { const p = paths && paths.length ? paths : (fileDrag || []); fileDrag = null; handleDrop(p, at, ''); }
  else { fileDrag = null; dragAbort(); }
});

// text / links (HTML5)
document.addEventListener('dragenter', (e) => {
  if (!dragHasPayload(e) || (e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  dragBegin(new Set(['text']));
});
document.addEventListener('dragover', (e) => { e.preventDefault(); if (st.dragging) dragHover(e.target); later('dragEnd', 400, () => { if (!fileDrag) dragAbort(); }); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if ((e.dataTransfer.types || []).includes('Files')) return; // handled by Tauri
  const text = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#')) || e.dataTransfer.getData('text/plain');
  handleDrop([], e.target, text);
});

// ================================================================== animations: files fly into the Shelf (Settings → Animations)
// A drop that goes to the Shelf (on its page, or on its tile among the drop actions): the file's icon shrinks from where
// it was dropped along a short curve into the Shelf's tab (into its list when the tab isn't in sight), and the count on
// the tab bumps once the Shelf has it. While files are dragged over Sympony, its Shelf swells a little (notch.css).
const shelfDrop = { at: null };
document.addEventListener('drop', (e) => { shelfDrop.at = { x: e.clientX, y: e.clientY }; }, true);
function shelfFly(items, before) {
  const from = shelfDrop.at;
  shelfDrop.at = null;
  if (!st.settings.fxShelfFly || !st.open || !from || !items.length) return;
  // the corner of the Shelf's tab where its count is, if the tab bar shows that tab, else the middle of its list
  let to = null;
  const shelfEl = $(st.shelf.length ? '#shelfItems' : '#shelfEmpty');
  if (shelfEl) {
    const r = shelfEl.getBoundingClientRect();
    if (r.width) to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  if (!to) {
    const r = notchEl.getBoundingClientRect();
    if (!r.width) return;
    to = { x: r.left + r.width / 2, y: r.bottom - 18 };
  }
  const it = items[0];
  const ext = it.kind === 'file' ? ((it.path || '').match(/\.([a-z0-9]+)$/i) || [])[1] : '';
  const icon = it.kind !== 'file' ? (/^https?:\/\//i.test(it.text || '') ? ICONS.link : ICONS.text)
    : !ext ? ICONS.folder : /^(png|jpe?g|gif|bmp|webp|heic|ico|svg)$/i.test(ext) ? fa('image', 'regular') : ICONS.file;
  const el = document.createElement('div');
  el.className = 'shelf-fly';
  el.innerHTML = icon + (items.length > 1 ? `<b>${items.length}</b>` : '');
  document.body.appendChild(el);
  // a curve over the top: from the drop up and across into the tab, shrinking to an eighth and tipping a little
  const c = { x: (from.x + to.x) / 2, y: Math.max(0, Math.min(from.y, to.y) - 36) };
  const frames = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12; const u = 1 - t;
    const x = u * u * from.x + 2 * u * t * c.x + t * t * to.x; const y = u * u * from.y + 2 * u * t * c.y + t * t * to.y;
    frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - 0.88 * t).toFixed(3)}) rotate(${(-18 * t).toFixed(1)}deg)`, opacity: t > 0.85 ? 0.75 : 1 });
  }
  el.animate(frames, { duration: 450, easing: 'cubic-bezier(0.45, 0, 0.7, 0.9)', fill: 'forwards' }).onfinish = () => { el.remove(); shelfFlyLanded(before, 0); };
}
// the count on the Shelf's tab bumps once it went up (the Shelf may take a moment longer than the flight)
function shelfFlyLanded(before, tries) {
  if (st.shelf.length <= before) { if (tries < 15) setTimeout(() => shelfFlyLanded(before, tries + 1), 100); return; }
  const b = $('#shelfBadge') || $('#dock button[data-id="shelf"]');
  if (!b || b.classList.contains('shelf-bump')) return;
  b.classList.add('shelf-bump');
  b.addEventListener('animationend', () => b.classList.remove('shelf-bump'), { once: true });
}

// ================================================================== snap zones
const SNAP_SHAPES = {
  'left-half': [0, 0, 0.5, 1, _t('Left')], 'right-half': [0.5, 0, 0.5, 1, _t('Right')], 'top-half': [0, 0, 1, 0.5, _t('Top')], 'bottom-half': [0, 0.5, 1, 0.5, _t('Bottom')],
  'left-third': [0, 0, 1 / 3, 1, _t('Left ⅓')], 'center-third': [1 / 3, 0, 1 / 3, 1, _t('Center ⅓')], 'right-third': [2 / 3, 0, 1 / 3, 1, _t('Right ⅓')],
  'left-two-thirds': [0, 0, 2 / 3, 1, _t('Left ⅔')], 'right-two-thirds': [1 / 3, 0, 2 / 3, 1, _t('Right ⅔')],
  'top-left': [0, 0, 0.5, 0.5, _t('Top left')], 'top-right': [0.5, 0, 0.5, 0.5, _t('Top right')], 'bottom-left': [0, 0.5, 0.5, 0.5, _t('Bottom left')], 'bottom-right': [0.5, 0.5, 0.5, 0.5, _t('Bottom right')],
  maximize: [0, 0, 1, 1, _t('Maximize')], center: [0.15, 0.1, 0.7, 0.8, _t('Center')],
};
window.SNAP_SHAPES = SNAP_SHAPES;

api.on('snap:state', (s) => {
  if (s.active) {
    st.snap = { hwnd: s.hwnd };
    st.snapLayout = null;
    $('#snapTiles').innerHTML = (s.layouts || []).filter((l) => SNAP_SHAPES[l]).map((l) => {
      const [x, y, w, h, label] = SNAP_SHAPES[l];
      return `<div class="snap-tile" data-l="${l}"><div class="snap-screen"><div style="left:${x * 100}%;top:${y * 100}%;width:calc(${w * 100}% - 2px);height:calc(${h * 100}% - 2px);margin:1px"></div></div><span>${label}</span></div>`;
    }).join('');
  } else {
    const layout = st.snapLayout;
    const hwnd = st.snap && st.snap.hwnd;
    st.snap = null; st.snapLayout = null;
    if (layout && hwnd) { api.svc('snap', 'apply', hwnd, layout); toast(fa('table-columns'), _t('Snapped'), { ms: 1200, side: 90 }); }
    if (st.page === 'snap') { if (st.open) closeNotch(); else showPage(st.tab, true); }
  }
});
api.on('snap:cursor', ({ x, y }) => {
  if (!st.snap || st.page !== 'snap') return;
  const el = document.elementFromPoint(x, y);
  const tile = el && el.closest('.snap-tile');
  highlightSnap(tile);
});
function highlightSnap(tile) {
  $$('.snap-tile').forEach((t) => t.classList.toggle('over', t === tile));
  st.snapLayout = tile ? tile.dataset.l : null;
}

// ================================================================== stats
const hist = { cpu: [], mem: [], rx: [], tx: [], temp: [] };
let lastNet = null;
let lastStats = null;
const HIST_N = 60;
function pushHist(arr, v) { arr.push(v); if (arr.length > HIST_N) arr.shift(); }

api.onStats((s) => {
  lastStats = s;
  st.stats = s; // for the closed notch's temperature slot
  pushHist(hist.cpu, s.cpu);
  pushHist(hist.mem, 1 - s.memFree / s.memTotal);
  if (s.temp) pushHist(hist.temp, s.temp.c);
  if (st.open && st.page === 'stats') drawStats();
  if (st.open && typeof refreshStatsCards === 'function') refreshStatsCards();
});

// bytes a second, short: 46K, 1.2M
function netRate(arr) { const v = arr[arr.length - 1] || 0; return v < 1e6 ? `${Math.round(v / 1e3)}K` : `${(v / 1e6).toFixed(1)}M`; }
// bytes a second in bits, as a speed test gives it, for the closed Sympony's Internet / Download / Upload side, with its
// unit (`unit`): under 1 Mbps in whole Kbps (640), from there in Mbps, 2.4 under 10, then whole (38). Under 50 Kbps it's
// next to nothing (`idle`, dimmed), and what rounds to nothing is a "0" without a unit.
const NET_SLOTS = ['net', 'netDown', 'netUp'];
function mbps(arr) {
  const v = ((arr[arr.length - 1] || 0) * 8) / 1e6;
  const idle = v < 0.05;
  if (v < 0.0005) return { text: '0', unit: '', idle };
  if (v < 0.9995) return { text: String(Math.round(v * 1000)), unit: 'Kbps', idle };
  return { text: v < 9.95 ? v.toFixed(1) : String(Math.round(v)), unit: 'Mbps', idle };
}
// the Wi-Fi signal as four bars (with its % when asked), or a cable when the PC is wired
// The System numbers in the closed notch are written out ("CPU 23%"): easier to read at a glance than icons.
const SYS_LABEL = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', disk: _t('Disk') };
const SYS_TITLE = { cpu: _t('Processor'), gpu: _t('Graphics'), ram: _t('Memory'), disk: _t('Windows drive') };
// how much of the CPU, GPU, memory or Windows drive is in use, as "23%" ("–" before the first reading)
function sysPct(kind) {
  const s = st.stats;
  const v = !s ? null : kind === 'cpu' ? s.cpu : kind === 'gpu' ? (s.gpu ? s.gpu.use : null) : kind === 'ram' ? (s.memTotal ? 1 - s.memFree / s.memTotal : null)
    : (s.disk ? 1 - s.disk.free / s.disk.total : null);
  return v == null ? '–' : `${Math.round(v * 100)}%`;
}
// "CPU 23%", with the temperature after it ("CPU 23% 41°", coloured like the Temperature card) when there is one
function sysText(label, value, title, c) {
  const t = c != null ? tempInfo(c) : null;
  return `<span class="sys-it" title="${esc(title || label)}"><em>${esc(label)}</em>${value}${t ? `<i style="color:${t.color}">${t.text}</i>` : ''}</span>`;
}
// The summary is one line across the notch (the clock makes way while it shows): as wide as what's in it,
// in 10 px steps and only growing while it's up, so the notch doesn't twitch as the numbers change.
let sysWide = { until: 0, side: 0 };
function sysSide() {
  const need = $('#closedLeft').scrollWidth + $('#closedRight').scrollWidth + 28;
  const side = Math.max(90, Math.ceil((need - effectiveSizes().notchWidth) / 20) * 10);
  const until = st.activity ? st.activity.until : 0;
  sysWide = until === sysWide.until ? { until, side: Math.max(sysWide.side, side) } : { until, side };
  return sysWide.side;
}
// The FPS line: as wide as it needs, growing only while the game stays in front (so the notch doesn't twitch
// as the numbers change)
let fpsWide = { pid: 0, side: 0 };
function fpsSide() {
  const need = $('#closedLeft').scrollWidth + $('#closedRight').scrollWidth + 28;
  const side = Math.max(80, Math.ceil((need - effectiveSizes().notchWidth) / 20) * 10);
  const pid = ((st.stats || {}).fps || {}).pid || 0;
  fpsWide = pid === fpsWide.pid ? { pid, side: Math.max(fpsWide.side, side) } : { pid, side };
  return fpsWide.side;
}
// the connection: Wi-Fi with its signal strength, or LAN on a cable
function signalText() {
  const w = (st.stats || {}).wifi;
  if (!w) return st.wired ? '<span class="sys-it" title="Ethernet">LAN</span>' : '';
  return sysText('Wi-Fi', `${w.quality}%`, `Wi-Fi ${w.ssid || ''}`);
}

// The System summary pops up in the closed notch now and then, like a notification, then hands back to
// whatever was showing (Settings → Live Activities). Not while Sympony is open or an alert is up.
let lastSysPeek = Date.now();
setInterval(() => {
  const s = st.settings;
  // (not over a game's FPS line, which already shows CPU and GPU)
  if (!s || !s.liveActivity || !(s.liveSources || {}).system || st.open || !st.stats || (s.fpsCounter && st.stats.fps)) { lastSysPeek = Date.now(); return; }
  if (Date.now() - lastSysPeek < (+s.sysPeekEvery || 120) * 1000 || (st.activity && st.activity.until > Date.now())) return;
  lastSysPeek = Date.now();
  showActivity('sys', 6000);
}, 1000);

function onNet(n) {
  st.wired = !!n.wired;
  if (lastNet) {
    const dt = (n.t - lastNet.t) / 1000 || 1;
    pushHist(hist.rx, Math.max(0, (n.rx - lastNet.rx) / dt));
    pushHist(hist.tx, Math.max(0, (n.tx - lastNet.tx) / dt));
  }
  lastNet = n;
  if (st.open && typeof refreshStatsCards === 'function') refreshStatsCards();
  // a side of the closed Sympony showing the internet speed: drawn again with this reading (renderClock's check, at once),
  // only while one shows
  const s = st.settings;
  if (s && !st.open && NET_SLOTS.some((k) => k === s.idleLeft || k === s.idleRight) && !currentActivity()) {
    const sl = idleSlots();
    if (sl.L + '|' + sl.R !== lastSlotSig) { renderClosed(); layout(); }
  }
}

function spark(canvas, series, colors, max) {
  const g = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  g.clearRect(0, 0, W, H);
  const top = max || Math.max(1e-9, ...series.flat());
  series.forEach((arr, si) => {
    if (arr.length < 2) return;
    const step = W / (HIST_N - 1);
    const off = W - (arr.length - 1) * step;
    g.beginPath();
    arr.forEach((v, i) => { const x = off + i * step; const y = H - (v / top) * (H - 4) - 1; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = colors[si]; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.lineTo(W, H); g.lineTo(off, H); g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, colors[si] + '55'); grad.addColorStop(1, colors[si] + '00');
    g.fillStyle = grad; g.fill();
  });
}

function drawStats() {
  renderStatsSection();
  if (!lastStats) return;
  const s = lastStats;
  const cpu = $('#statCpu');
  $('.stat-value', cpu).textContent = Math.round(s.cpu * 100) + '%';
  $('.stat-sub', cpu).textContent = `${_t('{n} threads', { n: s.cores })} · ${(s.cpuModel || '').replace(/\(R\)|\(TM\)|CPU|Processor/g, '').replace(/\s+/g, ' ').trim()}`;
  spark($('canvas', cpu), [hist.cpu], ['#0a84ff'], 1);
  const mem = $('#statMem');
  const used = s.memTotal - s.memFree;
  $('.stat-value', mem).textContent = Math.round((used / s.memTotal) * 100) + '%';
  $('.stat-sub', mem).textContent = _t('{used} of {total}', { used: bytes(used), total: bytes(s.memTotal) });
  spark($('canvas', mem), [hist.mem], ['#bf5af2'], 1);
  const net = $('#statNet');
  const rx = hist.rx[hist.rx.length - 1] || 0; const tx = hist.tx[hist.tx.length - 1] || 0;
  $('.stat-value', net).textContent = bytes(rx, true);
  const wf = s.wifi;
  $('.stat-sub', net).textContent = `↓ ${bytes(rx, true)}  ↑ ${bytes(tx, true)}${wf ? `  ·  Wi-Fi ${wf.quality}%` : st.wired ? '  ·  Ethernet' : ''}`;
  spark($('canvas', net), [hist.rx, hist.tx], ['#30d158', '#ff9f0a']);
  const disk = $('#statDisk');
  if (s.disk) {
    const usedD = s.disk.total - s.disk.free;
    $('.stat-value', disk).textContent = Math.round((usedD / s.disk.total) * 100) + '%';
    $('.stat-sub', disk).textContent = _t('{free} free of {total}', { free: bytes(s.disk.free), total: bytes(s.disk.total) });
    const c = $('canvas', disk); const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.roundRect(12, c.height - 18, c.width - 24, 8, 4); g.fill();
    g.fillStyle = '#64d2ff'; g.beginPath(); g.roundRect(12, c.height - 18, Math.max(1, (c.width - 24) * (usedD / s.disk.total)), 8, 4); g.fill();
  }
  // the PC's temperature, from the sensor Windows shares (Settings → System Monitor picks which); left out
  // on a PC that shares none
  const temp = $('#statTemp');
  temp.hidden = !s.temp;
  if (s.temp) {
    const t = tempInfo(s.temp.c);
    $('.stat-value', temp).textContent = t.text;
    $('.stat-sub', temp).textContent = t.feel;
    spark($('canvas', temp), [hist.temp.map((c) => Math.max(0, c - 20))], [t.color], 85);
  }
}
// °C → what to show: in the Weather unit, how warm that is, and a colour
function tempInfo(c) {
  const f = st.settings.weatherUnit === 'f';
  const color = c < 60 ? '#30d158' : c < 80 ? '#ff9f0a' : '#ff453a';
  const feel = c < 50 ? _t('Cool') : c < 70 ? _t('Warm') : c < 85 ? _t('Hot') : _t('Very hot');
  return { text: Math.round(f ? c * 9 / 5 + 32 : c) + '°', feel, color };
}

// ================================================================== pomodoro + health notices
api.on('pomodoro', (p) => {
  const wasRunning = st.pomodoro && st.pomodoro.running;
  st.pomodoro = p;
  callModule('pomodoro', 'update', p);
  if (!st.open && wasRunning !== p.running) { renderClosed(true); layout(); }
  else if (!st.open) outlineSync();
});
api.on('pomodoro:done', (d) => {
  if (d.sound) chime('done');
  const msg = d.finished === 'work' ? _t('Focus done! Take a break') : _t('Break over, back to focus');
  toast(fa('stopwatch'), msg, { color: d.finished === 'work' ? '#30d158' : '#ff6b4a', ms: 6000, side: 160 });
});
// The Pomodoro tab's Timer runs in main too (pomodoro.rs), which tells every notch when it ends: "Time's up" with
// "+5 min" (it runs again for 5 minutes) and "Done", for half a minute (longer while the mouse is on it). The sound is
// Pomodoro's Completion sound; main leaves it off while Windows' Do not disturb is on.
api.on('timer', (t) => {
  const was = st.timer && st.timer.running;
  st.timer = t;
  callModule('pomodoro', 'update');
  // running again ("+5 min" on another display, or a new one): its "Time's up" goes on every display
  if (t.active && st.activity && st.activity.data && st.activity.data.timer) st.activity = null;
  if (!st.open && was !== t.running) { renderClosed(true); layout(); }
  else if (!st.open) outlineSync();
});
api.on('timer:done', (d) => {
  if (d.sound) chime('done');
  const text = _t('Time’s up');
  const sub = _t('Timer {time}', { time: N.timerLen(d.total) });
  if (st.open) { toast(fa('hourglass-end'), `${text} · ${sub}`, { color: 'var(--orange)', ms: 8000 }); return; }
  // room for the line and both buttons on the right (each side gets that much)
  const side = Math.ceil(textWidth([sub], '500 12px') + textWidth([_t('+{n} min', { n: 5 })], '600 11px') + textWidth([_t('Done')], '600 11px')) + 52;
  // (it glows amber like a task coming due, after the outline's end blink)
  showActivity('toast', 30000, { icon: fa('hourglass-end'), text, sub, color: 'var(--orange)', side: Math.max(150, side), hold: true, timer: true,
    tab: enabledTabs().includes('pomodoro') ? 'pomodoro' : undefined, glow: 'amber' });
  bump();
});
function timerAlertDone(again) {
  st.activity = null;
  if (again) api.svc('timer', 'add', 5 * 60000);
  renderClosed(true); layout();
}

// ================================================================== animations: the outline (Settings → Animations)
// Glowing outline (fxGlow): while an alert shows in the closed Sympony (a task or reminder coming due, an event about to
// start, a prayer time; the charger plugged in; AI Chat answering, a brief; low battery), a thin light in its color runs
// from the bottom middle out along both sides of the outline, up to the ears on the screen edge (floating below the
// edge, round both ends to the top middle), and fades; again and again while it shows (for the charger, twice).
// Timer outline (fxTimerLine): while a Timer or a Pomodoro session runs, the same two halves stay lit for the share of
// time left, shortening toward the bottom middle, green → amber (half left) → red (a quarter); when it ends the whole
// outline blinks. Both are an SVG on the notch's edge in its real shape (size, corners, ears; a pill when it floats),
// drawn again each frame only while that shape changes. Not while Sympony is open, hidden or in over a fullscreen app.
const OUTLINE_COLOR = { amber: '#ff9f2e', green: '#30d158', blue: '#5ac8fa', red: '#ff453a' };
const GLOW_KINDS = { 'todo-alert': 'amber', meeting: 'amber', prayer: 'amber', 'prayer-soon': 'amber', charging: 'green', 'battery-low': 'red', brief: 'blue' };
const GLOW_MAX = 20000; // an alert that stays up longer (a brief waiting to be opened, the adhan) glows its first 20 s
const GLOW_EASE = 'cubic-bezier(0.45, 0.05, 0.3, 1)';
// grows from the bottom middle to the whole outline, then its tail runs out to the ends
// (uses strokeDashoffset on a static `100 200` dasharray so WebKit/WKWebView interpolates smoothly)
const GLOW_TRACE = [
  { offset: 0, strokeDashoffset: '100', opacity: 0, easing: GLOW_EASE },
  { offset: 0.08, opacity: 1, easing: GLOW_EASE },
  { offset: 0.45, strokeDashoffset: '0', opacity: 1, easing: GLOW_EASE },
  { offset: 0.82, strokeDashoffset: '-100', opacity: 1, easing: GLOW_EASE },
  { offset: 1, strokeDashoffset: '-100', opacity: 0 },
];
const outline = { svg: null, glow: '', anims: [], glowOff: 0, src: null, since: 0, timer: '', blinkUntil: 0, blinkAnim: null, tick: 0,
  live: false, target: '', geom: '', raf: 0, still: 0, vis: [], burst: null, notifUntil: 0, notifKey: '', previewUntil: 0 };

function outlineShown() {
  return !st.open && !st.hudOnly && !st.unseen && !st.tucked && !leaveSt.out
    && !notchEl.classList.contains('autohidden') && !notchEl.classList.contains('gone');
}

// An alert's glow color: its kind's, or for a toast the one it asked for (`glow`: a water or break reminder, the Timer's
// "Time's up", a Bluetooth device connecting or running low); the Timer's comes once its end blink is over
function glowOf(a) {
  if (a.kind !== 'toast') return GLOW_KINDS[a.kind] || '';
  return a.data && a.data.glow && !(a.data.timer && Date.now() < outline.blinkUntil) ? a.data.glow : '';
}
// the alert's glow now: its color, and a key that changes with each new alert (the line starts again)
function outlineGlow() {
  const now = Date.now();
  const a = st.activity && st.activity.until > now && glowOf(st.activity) ? st.activity : null;
  // the adhan's card shows in the prayer reminder's place
  const src = a || st.adhan || null;
  if (src !== outline.src) { outline.src = src; outline.since = now; }
  if (src && now - outline.since < GLOW_MAX) {
    later('glowEnd', GLOW_MAX - (now - outline.since) + 20, outlineSync);
    const c = a ? glowOf(a) : 'amber';
    // (a short one, the charger or a device connecting, runs round twice; AI Chat's blue goes on from a brief's)
    const short = a && (a.kind === 'charging' || (a.data && a.data.glowLoops === 2));
    return { c, key: c === 'blue' && a && a.kind !== 'toast' ? 'ai' : outline.since, loops: short ? 2 : Infinity };
  }
  // Voice dictation actively listening or transcribing: gentle cyan-blue outline glow
  if (st.voice && (st.voice.state === 'listening' || st.voice.state === 'transcribing')) {
    return { c: 'blue', key: 'voice:' + st.voice.state, loops: Infinity };
  }
  // Agent approval / question card waiting in the closed notch
  if (claudeShowing()) return { c: 'amber', key: 'claude', loops: Infinity };
  // AI Chat or Pony Feed Summary working on an answer before Sympony closed: standard outer notch glow
  if ((window.N && N.chat && N.chat.pending()) || feedSumActive()) {
    return { c: 'blue', key: feedSumActive() ? 'feed-sum' : 'ai', loops: Infinity };
  }
  // Fresh notification arriving while closed: brief 2-loop blue outline
  if (now < outline.notifUntil && notifShowing()) return { c: 'blue', key: 'notif:' + outline.notifKey, loops: 2 };
  // Instant 1-loop preview when toggling Glowing outline ON in Settings
  if (now < outline.previewUntil) return { c: 'blue', key: 'preview:' + outline.previewUntil, loops: 1 };
  return null;
}

// What's left of the Timer or the Pomodoro session running (the one ending first), as a share of its length; only
// when the closed notch shows them (Settings → General → Live activities)
function outlineTimer() {
  const s = st.settings;
  if (!s.fxTimerLine || !s.liveActivity || (s.liveSources || {}).pomodoro === false) return null;
  const now = Date.now(); const runs = [];
  const t = st.timer; const p = st.pomodoro;
  if (t && t.active && t.running && t.total > 0) runs.push([t.endsAt - now, t.total]);
  if (p && p.running && p.total > 0) runs.push([p.endsAt - now, p.total]);
  if (!runs.length) return null;
  const [left, total] = runs.sort((x, y) => x[0] - y[0])[0];
  return { f: Math.max(0, Math.min(1, left / total)), step: 1000 / total };
}

function outlineSvg() {
  if (!outline.svg) {
    notchEl.insertAdjacentHTML('beforeend', '<svg id="outlineFx" aria-hidden="true"><g class="ol-glow"><path pathLength="100"/><path pathLength="100"/></g>'
      + '<g class="ol-timer"><path pathLength="100"/><path pathLength="100"/></g></svg>');
    outline.svg = $('#outlineFx', notchEl);
  }
  return outline.svg;
}

// After every layout (and once a second while the timer line shows): what the outline should show now
function outlineSync() {
  const s = st.settings;
  if (!s) return;
  notchEl.classList.toggle('shelf-swell', !!s.fxShelfFly); // files fly into the Shelf: its page swells during a drag (notch.css)
  const shown = outlineShown();
  // (the hourly chime's light and interactive Feed summary glow run directly without waiting for fxGlow)
  const glow = shown ? (((s.fxGlow || feedSumActive()) && outlineGlow()) || chimeLight()) : null;
  const blink = shown && !glow && s.fxTimerLine && Date.now() < outline.blinkUntil;
  const run = shown && !glow && !blink ? outlineTimer() : null;
  const live = !!(glow || blink || run);
  if (!live && !outline.svg) { animVis([]); return; }
  const [g1, g2] = outlineSvg().children;
  // the glow: started for each new alert; when it goes it fades, and the line stops once it's out of sight
  const gk = glow ? `${glow.c}|${glow.key}` : '';
  if (gk !== outline.glow) {
    outline.glow = gk;
    clearTimeout(outline.glowOff);
    const stop = () => { outline.anims.forEach((a) => a.cancel()); outline.anims = []; };
    if (glow) {
      stop();
      g1.style.setProperty('--ol-c', OUTLINE_COLOR[glow.c]);
      // the charger's two rounds fit the moment it shows
      outline.anims = [...g1.children].map((p) => p.animate(GLOW_TRACE, { duration: glow.loops === 2 ? 1400 : 1800, iterations: glow.loops }));
    } else outline.glowOff = setTimeout(stop, 350);
    g1.classList.toggle('on', !!glow);
  }
  // the timer: a blink at the end, else the line for the time left (glided between the once-a-second updates only
  // when that moves it visibly, a short timer)
  if (blink && outline.timer !== 'blink') {
    outline.timer = 'blink';
    g2.style.setProperty('--ol-c', OUTLINE_COLOR.red);
    for (const p of g2.children) { p.style.transition = 'none'; p.style.strokeDasharray = '100 200'; }
    if (outline.blinkAnim) outline.blinkAnim.cancel();
    outline.blinkAnim = g2.animate([{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }], { duration: 450, iterations: 4, easing: 'ease-in-out' });
  } else if (run) {
    const first = outline.timer !== 'run';
    outline.timer = 'run';
    g2.style.setProperty('--ol-c', OUTLINE_COLOR[run.f > 0.5 ? 'green' : run.f > 0.25 ? 'amber' : 'red']);
    const dash = `${(run.f * 100).toFixed(2)} 200`;
    for (const p of g2.children) { p.style.transition = first || run.step < 0.005 ? 'none' : ''; p.style.strokeDasharray = dash; }
  } else if (!blink) outline.timer = '';
  g2.classList.toggle('on', !!(blink || run));
  if (run && !outline.tick) outline.tick = setInterval(outlineSync, 1000);
  else if (!run && outline.tick) { clearInterval(outline.tick); outline.tick = 0; }
  // the shape to follow: drawn again when the notch is heading for another size, or the line just came
  const target = ['--w', '--h', '--r', '--ear'].map((k) => notchEl.style.getPropertyValue(k)).join('|') + notchEl.classList.contains('floating');
  if (live && !outline.geom) outline.geom = outlineDraw();
  if (live && (!outline.live || target !== outline.target)) { outline.live = true; outlineFollow(); }
  outline.live = live; outline.target = target;
  // touchscreen mode: the glow round the edge is part of what's drawn (layout)
  const b = st.box; const ear = parseFloat(notchEl.style.getPropertyValue('--ear')) || 0;
  animVis(live && b ? [{ x: b.left - ear - 16, y: Math.max(0, b.bottom - b.h - 16), w: b.w + ear * 2 + 32, h: b.h + 32 }] : []);
}
// what the animations draw outside the notch, for touchscreen mode (layout sends it with the rest)
function animVis(list) {
  const all = outline.burst ? [...list, outline.burst] : list;
  if (JSON.stringify(all) === JSON.stringify(outline.vis)) return;
  outline.vis = all;
  later('animVis', 0, layout);
}
// Each frame while the notch grows or shrinks (and a few after): the outline drawn for the size it has now
function outlineFollow() {
  outline.still = 0;
  if (outline.raf) return;
  outline.raf = requestAnimationFrame(function step() {
    outline.raf = 0;
    if (!outline.live) return;
    const key = outlineDraw();
    if (key !== outline.geom) { outline.geom = key; outline.still = 0; } else outline.still++;
    if (outline.still < 6) outline.raf = requestAnimationFrame(step);
  });
}
notchEl.addEventListener('transitionrun', (e) => { if (outline.live && (e.target === notchEl || e.target.classList.contains('ear'))) outlineFollow(); });
// The two halves, in the notch's own px: from the bottom middle along the bottom, round the corner and up the side,
// then attached out along the ear to the screen edge, floating round the top corner to the top middle. Each is 100
// long (pathLength), so the glow and the timer work in shares of it.
function outlineDraw() {
  const cs = getComputedStyle(notchEl);
  const w = parseFloat(cs.width) || 0; const h = parseFloat(cs.height) || 0;
  const float = notchEl.classList.contains('floating');
  const ear = float ? 0 : parseFloat(getComputedStyle($('.ear.left', notchEl)).width) || 0;
  const r = Math.max(0, Math.min(parseFloat(cs.borderBottomLeftRadius) || 0, w / 2, float ? h / 2 : h));
  const n = (v) => Math.round(v * 10) / 10;
  const key = [w, h, r, ear].map(n).join('|') + float;
  if (key === outline.geom) return key;
  const half = (left) => {
    const x = (d) => n(left ? d : w - d); // d from that side
    const sw = left ? 1 : 0;
    let d = `M${n(w / 2)},${n(h)} L${x(r)},${n(h)} A${n(r)} ${n(r)} 0 0 ${sw} ${x(0)},${n(h - r)}`;
    if (float) return `${d} L${x(0)},${n(r)} A${n(r)} ${n(r)} 0 0 ${sw} ${x(r)},0 L${n(w / 2)},0`;
    const e = Math.max(0, Math.min(ear, h - r));
    d += ` L${x(0)},${n(e)}`;
    return e ? `${d} A${n(e)} ${n(e)} 0 0 ${1 - sw} ${x(-e)},0` : d;
  };
  const pad = 16; const bw = n(w + (ear + pad) * 2); const bh = n(h + pad * 2);
  const svg = outline.svg;
  svg.setAttribute('viewBox', `${n(-ear - pad)} ${-pad} ${bw} ${bh}`);
  Object.assign(svg.style, { left: `${n(-ear - pad)}px`, top: `${-pad}px`, width: `${bw}px`, height: `${bh}px` });
  const [a, b] = [half(true), half(false)];
  for (const g of svg.children) { g.children[0].setAttribute('d', a); g.children[1].setAttribute('d', b); }
  return key;
}
// the Timer or a Pomodoro session ended: the whole outline blinks, then the next session's line if one runs
function outlineTimerEnd() {
  const s = st.settings;
  if (!s || !s.fxTimerLine || !s.liveActivity || (s.liveSources || {}).pomodoro === false) return;
  outline.blinkUntil = Date.now() + 1850;
  later('blinkEnd', 1870, outlineSync);
  outlineSync();
}
api.on('timer:done', outlineTimerEnd);
api.on('pomodoro:done', outlineTimerEnd);
// gone up for a fullscreen app or from the tray, or back: the outline stops or comes again
api.on('notch:leaving', () => setTimeout(outlineSync, 0));
api.on('notch:visible', () => setTimeout(outlineSync, 0));
window.addEventListener('load', () => { if (N.chat) N.chat.onChange(outlineSync); });

// ================================================================== hourly chime (Settings → General → Clock)
// On the hour (and the half hour, if asked) a soft bell, a short glow round the closed Sympony, or both. One timer to the
// next one (clock.js works out when), set again when the settings change and when Windows' clock or time zone changes
// (main: clock:changed); after sleep Sympony starts with new notch windows, which set their own. Quiet hours skip it. The
// bell stays silent during Do not disturb and while an app is fullscreen (main says), as Sympony's other alerts do, and
// with Sympony on several displays only the notch that makes the sounds rings it; the glow shows where the closed Sympony does.
const chimeSt = { last: 0, lightUntil: 0 };
function armChime(s = st.settings) {
  cancel('hourChime');
  if (!s || !window.SymponyClock || !['sound', 'light', 'both'].includes(s.hourChime)) return;
  const now = Date.now();
  later('hourChime', SymponyClock.nextChime(now, !!s.hourChimeHalf) - now + 50, ringChime);
}
async function ringChime() {
  const s = st.settings; const now = Date.now();
  // the full or half hour this is; too early (the clock was put back) or long past (the clock jumped ahead): only the
  // next one is set
  const at = SymponyClock.lastChime(now, !!s.hourChimeHalf);
  armChime();
  if (now - at > 90000 || at === chimeSt.last) return;
  chimeSt.last = at;
  if (s.hourChimeQuiet !== false && SymponyClock.quietAt(at, s.hourChimeFrom, s.hourChimeTo)) return;
  if (s.hourChime !== 'sound') { chimeSt.lightUntil = Date.now() + 1900; later('chimeLight', 1950, outlineSync); outlineSync(); }
  if (s.hourChime === 'light' || st.soundHere === false) return;
  const q = await api.svc('clock', 'quiet').catch(() => null);
  if (q && (q.dnd || q.fullscreen)) return;
  try { audioCtx = audioCtx || new AudioContext(); SymponyClock.bell(audioCtx, new Date(at).getMinutes() !== 0); } catch { /* audio unavailable */ }
}
// the glow for outlineSync while it lasts: once round, in blue
function chimeLight() { return Date.now() < chimeSt.lightUntil ? { c: 'blue', key: 'chime' + chimeSt.lightUntil, loops: 1 } : null; }
api.getSettings().then((s) => armChime(s)).catch(() => {});
api.onSettings((s) => armChime(s));
// (a moment later: the page learns the new time zone from WebView2 a little after Windows says so)
api.on('clock:changed', () => later('chimeArm', 1500, () => armChime()));

// A language Sympony was waiting for (Same as Windows on a French Windows, say) was downloaded quietly after the start
// (i18n.rs): said once in the closed notch, no sound; a click opens Settings → General, which can restart Sympony in it.
api.on('lang:ready', (l) => {
  toast(fa('language'), _t('{lang} is ready', { lang: l.name }), { sub: _t('Settings → General'), color: '#bf5af2', ms: 10000, side: 150, settings: 'general', hold: true });
});

api.on('health:remind', (r) => {
  chime();
  if (r.kind === 'water') {
    // its check logs the glass right there; a click on the rest opens the Health tab
    toast(fa('glass-water'), _t('Time for a glass of water'), { sub: `${r.glasses}/${r.goal}`, color: '#64d2ff', ms: 10000, side: 160, tab: 'health', tick: 'water', glow: 'blue' });
    return;
  }
  toast(fa('person-walking'), _t('Time for a break'), { sub: _t('{n}m', { n: r.minutes }), color: '#30d158', ms: 8000, side: 140, tab: 'health', glow: 'green' });
});
// a glass logged in the Health tab reached today's goal (no more water reminders today)
api.on('health:goal', (r) => {
  if (Date.now() - waterTickAt < 5000) return;
  toast(fa('glass-water'), st.open ? `${_t('Water goal reached')} · ${r.glasses}/${r.goal}` : _t('Water goal reached'), { sub: `${r.glasses}/${r.goal}`, color: '#64d2ff', ms: 4000, side: 170, tab: 'health' });
});

// ================================================================== helper events
api.onHelper((msg) => {
  switch (msg.type) {
    case 'media': if (st.settings.mediaEnabled) onMedia(msg); break;
    case 'volume': onVolume(msg); callModule('control', 'update'); break;
    case 'brightness': onBrightness(msg); callModule('control', 'update'); break;
    case 'lockkeys': onLockKeys(msg); break;
    case 'inputlang': onInputLang(msg); break;
    case 'power': onPower(msg); break;
    case 'net': onNet(msg); break;
    case 'bluetooth': onBluetooth(msg); break;
    case 'radios': onRadios(msg); break;
    case 'prayer': st.prayer = msg; callModule('prayer', 'update'); renderClosed(); layout(); break;
    case 'mic': onMic(msg); break;
    case 'touchpad': onTouchpad(msg); break;
    case 'theme': st.theme = msg; callModule('control', 'update'); break;
    case 'idle':
      st.ponyIdleMs = Number(msg.idleMs) || 0;
      st.locked = !!msg.locked;
      syncPonyMood();
      if (ponyIdleOn()) renderClosed();
      break;
  }
});

// ================================================================== settings
// Dragging an "Expanded size" slider in Settings opens Sympony on a tab that uses that size, so the change
// shows as you drag; it closes again a moment after you stop.
function previewSize(prev, s) {
  const tall = prev.expandedHeightTall !== s.expandedHeightTall;
  const normal = prev.expandedHeight !== s.expandedHeight;
  const modeChanged = prev.notchSizeMode !== s.notchSizeMode;
  if (!tall && !normal && !modeChanged && prev.expandedWidth === s.expandedWidth) return;
  if (st.open && !st.previewing) return;
  // the width is the same on every tab; a height belongs to either the tall tabs or the others
  const fits = (id) => (!tall && !normal) || isTall(id) === tall;
  const cur = st.open ? st.page : st.tab;
  const page = fits(cur) ? cur : enabledTabs().find(fits) || 'home';
  st.previewing = true;
  openNotch(page);
  later('close', 1500, () => { st.previewing = false; if (!st.hover && !st.typing) closeNotch(); });
}

function applyCardStyle(s) {
  if (!window.StyleLib) return;
  const cs = StyleLib.cardStyleOf(s);
  notchEl.dataset.cardSurface = cs.surface;
  notchEl.dataset.cardRadius = cs.radius;
  notchEl.dataset.cardDensity = cs.density;
  if (window.N && N.carousel && N.carousel.syncStyleAttrs) N.carousel.syncStyleAttrs();
}

function previewStyleChange(prev, s) {
  const prevMap = (prev && prev.moduleStyles) || {};
  const nextMap = (s && s.moduleStyles) || {};
  const prevGrid = window.StyleLib ? JSON.stringify(StyleLib.gridSizesMap(prev)) : '';
  const nextGrid = window.StyleLib ? JSON.stringify(StyleLib.gridSizesMap(s)) : '';
  if (prevGrid !== nextGrid && window.N && N.carousel) N.carousel.rebuild();

  const keys = new Set([...Object.keys(prevMap), ...Object.keys(nextMap)]);
  const changedMods = [];
  for (const k of keys) {
    if (JSON.stringify(prevMap[k] || null) !== JSON.stringify(nextMap[k] || null)) changedMods.push(k);
  }
  const cardChanged = JSON.stringify(prev && prev.cardStyle) !== JSON.stringify(s && s.cardStyle);
  if (!changedMods.length && !cardChanged) return;

  if (changedMods.includes('home')) renderHomeSection();
  if (st.open && !st.previewing) return;

  let target = null;
  if (changedMods.length === 1) {
    const id = changedMods[0];
    // If only gridSize changed in dashboard mode, keep dashboard visible; otherwise open that module directly.
    const onlyGrid = prevMap[id] && nextMap[id]
      && prevMap[id].style === nextMap[id].style
      && prevMap[id].size === nextMap[id].size
      && prevMap[id].width === nextMap[id].width
      && prevMap[id].height === nextMap[id].height
      && prevMap[id].surface === nextMap[id].surface
      && prevMap[id].gridSize !== nextMap[id].gridSize;
    if (!onlyGrid) target = id;
  } else if (changedMods.length > 1) {
    const cur = window.N && N.carousel ? N.carousel.activeModule() : null;
    target = (cur && changedMods.includes(cur)) ? cur : changedMods[0];
  }
  st.previewing = true;
  if (target) {
    openNotch(target);
    if (window.N && N.openModule) N.openModule(target);
  } else {
    openNotch();
  }
  later('close', 2600, () => { st.previewing = false; if (!st.hover && !st.typing) closeNotch(); });
}

function applySettings(s) {
  const prev = st.settings;
  st.settings = s;
  if (prev && prev.mediaColors !== s.mediaColors) applyMediaColors();
  notchEl.classList.toggle('glow-on', !!s.colorGlow);
  notchEl.classList.toggle('no-tab-slide', s.fxTabSlide === false);
  applyWaveStyle(s);
  applyCardStyle(s);
  $('#mirror').classList.toggle('hidden', !s.mirrorEnabled);
  $('#mirror').classList.toggle('circle', s.mirrorShape === 'circle');
  if (!s.mediaEnabled) st.media = { active: false };
  $('#music').style.display = s.mediaEnabled ? '' : 'none';
  buildTabs();
  for (const m of modules.values()) {
    if (m.built && m.onSettings) { try { m.onSettings(s); } catch (e) { console.error(e); } }
    if (typeof m.refreshCards === 'function') { try { m.refreshCards(s); } catch (e) { console.error(e); } }
  }
  if (window.N && N.refreshLauncherCards) N.refreshLauncherCards();
  renderNotifBadge();
  notchEl.style.setProperty('--closed-opacity', String(Math.max(0.2, Math.min(1, (s.notchOpacity ?? 100) / 100))));
  applyLook(s);
  renderBattery();
  renderCalendar();
  renderMusic(true);
  loadLyrics();
  renderLyrics();
  renderClosed();
  layout();
  if (prev && !prev.fxGlow && s.fxGlow) {
    outline.previewUntil = Date.now() + 1900;
    later('glowPreview', 1950, outlineSync);
    outlineSync();
  }
  if (prev) {
    previewSize(prev, s);
    previewStyleChange(prev, s);
  }
}
api.onSettings(applySettings);

window.addEventListener('resize', layout);

// How this page lands on the screen, for main (wm.rs): its size in CSS px and the screen px it draws each with. That
// isn't always the display's scale (Windows' Text size above 100 % makes it draw bigger, and Windows can resize the
// window), and the hover area, the clicks and the frosted glass go by what's drawn (GitHub #61). Told at load and
// whenever either changes: a new scale (another display's, a new Text size) ends the match of a resolution query.
const pageRep = { sent: '', seq: 0, dpr: 0, mq: null, me: window.__TAURI__ ? window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label : '' };
function reportPage() {
  const dpr = window.devicePixelRatio || 1;
  const page = { w: window.innerWidth, h: window.innerHeight, dpr };
  const key = JSON.stringify(page);
  if (key !== pageRep.sent) { pageRep.sent = key; api.svc('notch', 'page', { ...page, seq: ++pageRep.seq }, pageRep.me).catch(() => {}); }
  if (dpr === pageRep.dpr) return;
  if (pageRep.mq) pageRep.mq.removeEventListener('change', reportPage);
  pageRep.dpr = dpr;
  pageRep.mq = matchMedia(`(resolution: ${dpr}dppx)`);
  pageRep.mq.addEventListener('change', reportPage);
}
window.addEventListener('resize', reportPage);
reportPage();

// ================================================================== Task 5 builtin cards (Musik, Rak, AI HITL, Sistem)
const homeCards = new Set();
const shelfCards = new Set();
const statsCards = new Set();
const hitlCards = new Set();
const mediaAppIconCache = new Map();

function mediaBundleFor(appId) {
  if (!appId) return null;
  if (/^[\w-]+(\.[\w-]+){2,}$/.test(appId)) return appId;
  const s = String(appId).toLowerCase();
  if (s.includes('spotify')) return 'com.spotify.client';
  if (s.includes('music')) return 'com.apple.Music';
  if (s.includes('chrome')) return 'com.google.Chrome';
  if (s.includes('safari')) return 'com.apple.Safari';
  if (s.includes('arc') || s.includes('thebrowser')) return 'company.thebrowser.Browser';
  if (s.includes('firefox')) return 'org.mozilla.firefox';
  if (s.includes('brave')) return 'com.brave.Browser';
  if (s.includes('edge')) return 'com.microsoft.edgemac';
  if (s.includes('vlc')) return 'org.videolan.vlc';
  return null;
}

function mediaAppIconUrl(m) {
  if (!m || m.radio) return null;
  if (m.appIcon) return m.appIcon;
  const bid = mediaBundleFor(m.app);
  if (!bid) return null;
  if (mediaAppIconCache.has(bid)) return mediaAppIconCache.get(bid);
  mediaAppIconCache.set(bid, null);
  if (api.appIcon) {
    api.appIcon(bid).then((url) => {
      mediaAppIconCache.set(bid, url || null);
      if (url) refreshHomeCards();
    }).catch(() => {});
  }
  return null;
}

let audioOutName = '';
function loadAudioOutName() {
  api.svc('audio', 'devices', false).then((list) => {
    const cur = Array.isArray(list) ? list.find((d) => d.default) : null;
    const next = cur ? cur.name : '';
    if (next !== audioOutName) {
      audioOutName = next;
      refreshHomeCards();
      renderHomeSection();
    }
  }).catch(() => {});
}
loadAudioOutName();
setInterval(() => { if (st.open) loadAudioOutName(); }, 8000);

function shortOutName(name) {
  if (!name) return _t('Output');
  return name.replace(/\s*\(.*?\)\s*/g, '').replace(/\b(Pro|Max|Air|Speakers)\b/gi, (m) => m).trim().slice(0, 14) || name;
}

let homeSecSub = 'music'; // 'music' | 'lyrics' | 'mirror'

// ---- YouTube video mode: while a youtube.com
// video plays in a browser, the Music section becomes a muted copy of it, in step with the tab. youtube.rs finds the
// video (m.video) while the open notch shows Music (yt.want); the player is helper/yt.html on a localhost server
// (yt.url) in an iframe, driven over postMessage. blocked: refused by YouTube (100/101/150/153); dismissed: ♫.
// state: the player's YT state; played: ms it has played since this video was loaded (NotchKit.ytCover)
// videoAt: when Now Playing last had a video (ytGrace); cmdAt: when play/pause was last sent (ytCommand)
// tAt: when the player last told its time (t); rate: its speed now (the tab's, nudged: nudge); lead: how far ahead
// of the tab a seek aims, learned from where the last one landed (landing: that's still to be seen)
const yt = { url: null, want: false, blocked: new Set(), dismissed: new Set(), frame: null, id: null, ready: false,
  t: 0, tAt: 0, d: 0, state: -1, stateAt: 0, played: 0, seekAt: 0, videoAt: 0, cmdAt: 0, rate: 1, nudge: 1, lead: 0.2, landing: false };
// the video view: kept while the notch is closed (paused, so reopening Music shows it at once) but never built then,
// and kept through the moment between two videos in the same tab
function ytShows(m) {
  if (!yt.url) return false;
  if (NotchKit.ytView(m, st.settings, yt.blocked, yt.dismissed)) return yt.want || !!yt.frame;
  return !!m.active && !m.video && NotchKit.ytGrace(!!yt.frame, Date.now() - yt.videoAt);
}
function isYtActive() {
  const mod = (window.N && N.carousel) ? (N.carousel.fullModule() || N.carousel.activeModule()) : st.page;
  return !!(st.open && mod === 'home' && ytShows(st.media || {}));
}
let ytToastTimer = null;
function ytFlash(text) {
  const box = $('#page-home .mc-video');
  const toastEl = box && $('.mc-v-toast', box);
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (ytToastTimer) clearTimeout(ytToastTimer);
  ytToastTimer = setTimeout(() => { toastEl.classList.remove('show'); ytToastTimer = null; }, 700);
}
function ytSeekBy(deltaSec) {
  const m = st.media || {};
  const d = Number(m.duration) || 0;
  const cur = mediaPosition();
  const target = d > 0 ? Math.max(0, Math.min(d - 0.5, cur + deltaSec)) : Math.max(0, cur + deltaSec);
  cmd('seek', target);
  if (yt.frame && yt.ready) {
    ytPost({ type: 'seek', at: target });
    yt.t = target;
    yt.seekAt = Date.now();
  }
  const box = $('#page-home .mc-video');
  if (box && d > 0) {
    const frac = Math.max(0, Math.min(1, target / d));
    const th = $('.mc-v-thin i', box);
    if (th) th.style.transform = `scaleX(${frac.toFixed(4)})`;
    const barI = $('[data-mseek] i', box);
    if (barI) barI.style.transform = `scaleX(${frac.toFixed(4)})`;
    const elT = $('.mc-p-el', box);
    const remT = $('.mc-p-rem', box);
    if (elT) elT.textContent = fmt(target);
    if (remT) remT.textContent = '-' + fmt(Math.max(0, d - target));
  }
  ytFlash(deltaSec > 0 ? `+${Math.round(deltaSec)}s »` : `« ${Math.round(deltaSec)}s`);
}
function ytPost(msg) {
  if (yt.frame && yt.frame.contentWindow) yt.frame.contentWindow.postMessage(msg, new URL(yt.url).origin);
}
function ytTeardown() {
  if (yt.frame) yt.frame.remove();
  Object.assign(yt, { frame: null, id: null, ready: false, t: 0, tAt: 0, d: 0, state: -1, played: 0, cmdAt: 0, rate: 1, nudge: 1, landing: false });
}
function ytPaint(el, m) {
  const vid = m.video || yt.id; // (between two videos: the last one until the next is found)
  if (!el.classList.contains('mc-video') || !yt.frame || !el.contains(yt.frame)) {
    ytTeardown();
    el.className = 'c bare mc-music mc-video';
    el.innerHTML = '<img class="mc-v-glow" alt=""><iframe class="mc-v-frame" allow="autoplay; encrypted-media"></iframe><img class="mc-v-thumb" alt="">'
      + '<span class="mc-app-chip mc-v-chip"></span><div class="mc-v-toast" aria-live="polite"></div><div class="mc-v-thin"><i></i></div><div class="mc-v-ov"></div>';
    yt.frame = $('.mc-v-frame', el);
    yt.frame.src = yt.url;
  }
  el.classList.toggle('fill', !!(st.settings && st.settings.ytVideoFill));
  el.style.setProperty('--yt-k', ((el.clientWidth || 680) / 388).toFixed(3)); // (look B: the 388 px video scaled to cover)
  if (vid && yt.id !== vid) {
    yt.id = vid;
    const thumb = `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`;
    $('.mc-v-glow', el).src = thumb; $('.mc-v-thumb', el).src = thumb;
    yt.state = -1; yt.played = 0; yt.d = 0; el.classList.add('cover'); // (d: the last video's length is no ad)
    if (yt.ready) { ytPost({ type: 'load', id: vid, at: mediaPosition(), playing: yt.want && !!m.playing }); yt.cmdAt = Date.now(); yt.rate = 1; }
  }
  const app = appLabel(m.app); const iconUrl = mediaAppIconUrl(m);
  const ico = iconUrl ? `<img class="appic" src="${esc(iconUrl)}" style="width:15px;height:15px" alt="">` : fa('play');
  $('.mc-v-chip', el).innerHTML = `${ico}<span>${esc((app && app.name) || 'YouTube')}</span>`;
  const d = m.duration || 0; const pos = mediaPosition();
  const frac = d ? Math.max(0, Math.min(1, pos / d)) : 0;
  const ic = N.ic || (() => '');
  const fill = !!(st.settings && st.settings.ytVideoFill);
  const rate = Number(m.rate) || 1;
  const canSeek = !!(d && m.canSeek !== false);
  const leftBadge = rate !== 1
    ? `<span class="mc-v-badge" title="${esc(_t('Playback speed'))}">${esc(Number(rate.toFixed(2)))}×</span>`
    : `<span class="mc-v-badge" title="${esc('Shift + ← / → (±5s) · ← / → slide')}" style="opacity:0.78">⇧ ← / → 5s</span>`;
  $('.mc-v-ov', el).innerHTML = `<div class="mc-v-ttl t1" dir="auto">${esc(m.title || '')}</div><div class="mc-v-sub t1" dir="auto">${esc(m.artist || '')}</div>`
    + `<div class="row mc-m-prog"><span class="n mc-p-el" style="font-size:11px">${esc(d ? fmt(pos) : '0:00')}</span>`
    + `<div class="bar${d ? '' : ' disabled'}" data-mseek="1"><i style="transform:scaleX(${frac})"></i></div>`
    + `<span class="n mc-p-rem" style="font-size:11px">${esc(d ? '-' + fmt(Math.max(0, d - pos)) : '0:00')}</span></div>`
    + `<div class="mc-v-ctl"><div class="mc-v-left">${leftBadge}</div><div class="mc-v-mid">`
    + `<button type="button" class="mc-m-btn" data-mc="prev" ${m.canPrev === false ? 'disabled' : ''} title="${esc(_t('Previous'))}">${ic('prev', 'width:17px;height:17px')}</button>`
    + `<button type="button" class="mc-v-skip" data-yskip="-10" ${canSeek ? '' : 'disabled'} title="-10s (Shift+← / J)">−10s</button>`
    + `<button type="button" class="mc-m-btn play" data-mc="toggle" title="${esc(m.playing ? _t('Pause') : _t('Play'))}">${ic(m.playing ? 'pause' : 'play', 'width:18px;height:18px')}</button>`
    + `<button type="button" class="mc-v-skip" data-yskip="10" ${canSeek ? '' : 'disabled'} title="+10s (Shift+→ / L)">+10s</button>`
    + `<button type="button" class="mc-m-btn" data-mc="next" ${m.canNext === false ? 'disabled' : ''} title="${esc(_t('Next'))}">${ic('next', 'width:17px;height:17px')}</button>`
    + `</div><div class="mc-v-right">`
    + `<button type="button" class="mc-round-btn" data-mout="1" title="${esc(audioOutName || _t('Sound output'))}">${ic('pods')}</button>`
    + `<button type="button" class="mc-round-btn" data-mfloat="1" title="${esc(_t('Floating video'))}">${ic('pip')}</button>`
    + `<button type="button" class="mc-round-btn" data-mfill="1" title="${esc(fill ? _t('Fit') : _t('Fill'))}">${fa(fill ? 'compress' : 'expand')}</button>`
    + `<button type="button" class="mc-round-btn" data-mmusic="1" title="${esc(_t('Back to the music'))}">${ic('music')}</button>`
    + `</div></div>`;
  $$('[data-mc]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); cmd(b.dataset.mc); }; });
  $$('[data-yskip]', el).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      ytSeekBy(Number(b.dataset.yskip) || 0);
    };
  });
  const seekBar = $('[data-mseek]', el);
  if (seekBar && canSeek) {
    seekBar.onclick = (e) => {
      e.stopPropagation();
      const r = seekBar.getBoundingClientRect();
      const target = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * d;
      cmd('seek', target);
      if (yt.frame && yt.ready) { ytPost({ type: 'seek', at: target }); yt.t = target; yt.seekAt = Date.now(); }
    };
  }
  $('[data-mout]', el).onclick = (e) => { e.stopPropagation(); N.openModule('control'); callModule('control', 'showSound'); };
  $('[data-mfill]', el).onclick = (e) => { e.stopPropagation(); api.setSettings({ ytVideoFill: !fill }); };
  // the video in its own small window over everything (picture in picture), to watch while working; the notch closes
  $('[data-mfloat]', el).onclick = (e) => { e.stopPropagation(); api.svc('yt', 'float', true).catch(() => {}); closeNotch(); };
  $('[data-mmusic]', el).onclick = (e) => { e.stopPropagation(); yt.dismissed.add(vid); ytTeardown(); renderHomeSection(); };
}
window.addEventListener('message', (e) => {
  if (!yt.frame || e.source !== yt.frame.contentWindow || !e.data || typeof e.data !== 'object') return;
  const d = e.data;
  if (d.type === 'ready') {
    yt.ready = true; yt.rate = 1;
    if (yt.id) { ytPost({ type: 'load', id: yt.id, at: mediaPosition(), playing: yt.want && !!st.media.playing }); yt.cmdAt = Date.now(); }
  } else if (d.type === 'state') {
    if (Number(d.s) !== yt.state) { yt.state = Number(d.s); yt.stateAt = Date.now(); }
  } else if (d.type === 'time') {
    yt.t = Number(d.t) || 0; yt.d = Number(d.d) || 0; yt.tAt = Date.now();
  } else if (d.type === 'error' && [100, 101, 150, 153].includes(Number(d.code))) {
    if (yt.id) yt.blocked.add(yt.id);
    ytTeardown(); renderHomeSection();
  }
});
// every 250 ms: whether the open notch shows Music (lookups may then ask macOS), and the copy kept in step with the
// tab while it shows; closed or elsewhere, the copy waits paused
let ytLast = Date.now();
setInterval(() => {
  const now = Date.now(); const dt = now - ytLast; ytLast = now;
  const want = !!(st.open && window.N && N.carousel && N.carousel.activeModule() === 'home');
  if (want !== yt.want) {
    yt.want = want;
    api.svc('yt', 'want', want).catch(() => {});
    if (want && !yt.url) api.svc('yt', 'url').then((u) => { yt.url = u; renderHomeSection(); }).catch(() => {});
  }
  const m = st.media || {};
  if (m.video) yt.videoAt = now;
  const box = $('#page-home .mc-video');
  if (!!box !== ytShows(m) && (want || box)) renderHomeSection(); // (a video found or gone since the last paint)
  if (!yt.frame || !yt.ready || !yt.frame.isConnected) return;
  const settling = yt.state === 3 || yt.state === -1 || now - yt.seekAt < 1000;
  const r = NotchKit.ytSync({ t: yt.t, ageMs: now - yt.tAt, state: yt.state, rate: yt.rate, d: yt.d, target: mediaPosition(),
    npDur: m.duration || 0, playing: !!m.playing, settling, nudging: yt.nudge !== 1, lead: yt.lead });
  // (play/pause from what the player reports: a dropped pause is sent again; closed or elsewhere it waits paused)
  const c = NotchKit.ytCommand({ wantPlay: want && r.play, state: yt.state, sinceCmdMs: now - yt.cmdAt });
  if (c) { ytPost({ type: c }); yt.cmdAt = now; }
  if (!want) return;
  // where the last seek landed, once the copy plays steadily after it: the next one aims better
  if (yt.landing && yt.state === 1 && now - yt.stateAt > 700 && now - yt.seekAt > 1000) { yt.lead = NotchKit.ytLead(yt.lead, r.drift); yt.landing = false; }
  if (r.seek !== null) { ytPost({ type: 'seek', at: r.seek }); yt.t = r.seek; yt.tAt = now; yt.seekAt = now; yt.landing = !!m.playing; }
  yt.nudge = r.seek === null ? r.nudge : 1;
  const rate = (m.rate || 1) * yt.nudge; // (a tab at 1.5×, 2×…; a little faster or slower to catch up)
  if (rate !== yt.rate) { ytPost({ type: 'rate', r: rate }); yt.rate = rate; }
  if (yt.state === 1) yt.played += dt;
  if (box) {
    box.classList.toggle('ad', r.ad);
    box.classList.toggle('cover', NotchKit.ytCover(yt.state, yt.played, now - yt.stateAt));
    const th = $('.mc-v-thin i', box);
    if (th && m.duration) th.style.transform = `scaleX(${Math.max(0, Math.min(1, mediaPosition() / m.duration)).toFixed(4)})`;
  }
}, 250);

function paintMusicPlayer(el, inSection) {
  const m = st.media || {};
  if (inSection && ytShows(m)) { ytPaint(el, m); return; }
  if (el.classList.contains('mc-video')) ytTeardown();
  const has = !!(m.active && (m.title || m.artist));
  const app = appLabel(m.app);
  const iconUrl = mediaAppIconUrl(m);
  const pos = mediaPosition();
  const d = m.duration || 0;
  const frac = d ? Math.max(0, Math.min(1, pos / d)) : 0;

  let chipHtml = '';
  if (has && (m.radio || app)) {
    const chipIco = m.radio
      ? fa('radio')
      : iconUrl
        ? `<img class="appic" src="${esc(iconUrl)}" style="width:15px;height:15px" alt="">`
        : (N.realAppIcon ? N.realAppIcon(m.app || (app && app.name) || 'music', 15, fa('music')) : fa('music'));
    chipHtml = `<span class="mc-app-chip">${chipIco}<span>${esc(m.radio ? _t('Radio') : (app && app.name) || '')}</span></span>`;
  }
  const artHtml = has && m.artwork
    ? `<img src="${esc(m.artwork)}" alt="">${chipHtml}`
    : `<span class="mc-art-fb">${m.radio ? fa('radio') : ICONS.music}</span>${chipHtml}`;

  const lines = st.settings && st.settings.lyricsEnabled ? timedLines() : [];
  const li = lines.length ? lyricIndex() : -1;
  const prevL = li > 0 ? lineText(li - 1) : '';
  const curL = li >= 0 && li < lines.length ? lineText(li) : (lines.length ? lineText(0) : '');
  const nextL = li >= 0 && li + 1 < lines.length ? lineText(li + 1) : (li < 0 && lines.length > 1 ? lineText(1) : '');
  const has3Lyr = has && (prevL || curL || nextL);
  const lyricHtml = has3Lyr
    ? `<div class="mc-lyr3" data-mlyr="1">`
      + `<span class="t1 l-dim">${esc(prevL || '\u00a0')}</span>`
      + `<span class="t1 l-now">${esc(curL || '♪')}</span>`
      + `<span class="t1 l-dim">${esc(nextL || '\u00a0')}</span></div>`
    : has && lyr.data && !lyr.data.instrumental && (lyr.data.plain || '').trim()
      // not timed: a 3-line window that scrolls with the song like the panel's (scrollPlain); no line lit, as which
      // one is being sung can't be known
      ? `<div class="mc-lyr3 mc-lyr-plain" data-mlyr="1" title="${esc(_t('Not timed · Lyrics from LRCLIB'))}"><div class="mc-lyr-pl" dir="auto">${esc(lyr.data.plain.trim())}</div></div>`
      : `<div class="mc-lyr3" data-mlyr="1" style="opacity:${has ? 0.45 : 0.25}"><span class="t1 l-dim">${esc(!has ? '\u00a0'
        : lyr.loading ? _t('Looking for lyrics…') : lyr.data && lyr.data.instrumental ? '♪ ' + _t('Instrumental') : st.settings && st.settings.lyricsEnabled && lyr.key ? _t('No lyrics for this song') : _t('Lyrics'))}</span></div>`;

  const titleStr = has ? (m.title || _t('Unknown')) : _t('Nothing playing');
  const artistStr = has ? ([m.artist, m.album].filter(Boolean).join(' · ') || (app && app.name) || '') : _t('Play something in Spotify, YouTube, Apple Music…');
  const elStr = d ? fmt(pos) : '0:00';
  const remStr = d ? '-' + fmt(Math.max(0, d - pos)) : (m.radio && m.active ? _t('Live') : '0:00');
  const canSeek = has && d > 0 && m.canSeek !== false;
  const eqHtml = `<span class="eq mc-eq${m.playing ? '' : ' off'}"><i></i><i></i><i></i><i></i><i></i></span>`;
  const ic = N.ic || (() => '');
  const outLabel = shortOutName(audioOutName);
  const mirrorBtn = st.settings && st.settings.mirrorEnabled
    ? `<button type="button" class="mc-round-btn${inSection && homeSecSub === 'mirror' ? ' on' : ''}" data-mmirror="1" title="${esc(_t('Mirror'))}">${ic('cam')}</button>`
    : '';

  const homeStyle = inSection && window.StyleLib ? StyleLib.styleIdFor(st.settings, 'home') : 'bento';
  el.className = 'c bare mc-music';
  if (homeStyle === 'strip') {
    el.innerHTML = `<div class="mc-art-box" data-mopen="1">${artHtml}</div>`
      + `<div class="mc-strip-mid">`
      + `<div style="min-width:0" data-mopen="1">`
      + `<div class="t1" dir="auto" style="font-size:16px;font-weight:700;letter-spacing:-0.02em;line-height:1.2">${esc(titleStr)}</div>`
      + `<div class="sub t1" dir="auto" style="font-size:12px;line-height:1.25">${esc(artistStr)}</div></div>`
      + `<div class="row mc-m-prog" style="margin-top:0"><span class="n mc-p-el" style="font-size:10.5px">${esc(elStr)}</span>`
      + `<div class="bar${canSeek ? '' : ' disabled'}" data-mseek="1"><i style="transform:scaleX(${frac})"></i></div>`
      + `<span class="n mc-p-rem" style="font-size:10.5px">${esc(remStr)}</span></div></div>`
      + `<div class="mc-strip-right">`
      + `<button type="button" class="mc-m-btn" data-mc="prev" ${!has || m.canPrev === false ? 'disabled' : ''} title="${esc(_t('Previous'))}">${ic('prev', 'width:16px;height:16px')}</button>`
      + `<button type="button" class="mc-m-btn play" data-mc="toggle" ${!has ? 'disabled' : ''} title="${esc(m.playing ? _t('Pause') : _t('Play'))}">${ic(m.playing ? 'pause' : 'play', 'width:17px;height:17px')}</button>`
      + `<button type="button" class="mc-m-btn" data-mc="next" ${!has || m.canNext === false ? 'disabled' : ''} title="${esc(_t('Next'))}">${ic('next', 'width:16px;height:16px')}</button>`
      + `${eqHtml}`
      + `${mirrorBtn}`
      + `<button type="button" class="mc-round-btn${inSection && homeSecSub === 'lyrics' ? ' on' : ''}" data-mlyr="1" title="${esc(_t('Lyrics'))}">${ic('lyrics')}</button>`
      + `</div>`;
  } else if (homeStyle === 'cover') {
    const oneLyr = has3Lyr && curL ? `<div class="t1 sub" style="font-size:11.5px;color:var(--text);opacity:0.78" data-mlyr="1">♪ ${esc(curL)}</div>` : '';
    el.innerHTML = `<div class="mc-art-box" data-mopen="1">${artHtml}</div>`
      + `<div class="mc-cover-col">`
      + `<div class="row" style="gap:10px;align-items:flex-start"><div style="min-width:0;flex:1" data-mopen="1">`
      + `<div class="t1 mc-cover-ttl" dir="auto">${esc(titleStr)}</div>`
      + `<div class="sub t1" dir="auto" style="font-size:13px;margin-top:1px">${esc(artistStr)}</div></div>${eqHtml}</div>`
      + `${oneLyr}`
      + `<div class="row mc-m-prog" style="margin-top:0"><span class="n mc-p-el" style="font-size:11px">${esc(elStr)}</span>`
      + `<div class="bar${canSeek ? '' : ' disabled'}" data-mseek="1"><i style="transform:scaleX(${frac})"></i></div>`
      + `<span class="n mc-p-rem" style="font-size:11px">${esc(remStr)}</span></div>`
      + `<div class="row mc-m-ctls" style="margin-top:0"><div class="row" style="gap:4px">`
      + `<button type="button" class="mc-m-btn dim${m.shuffle ? ' on' : ''}" data-mc="shuffle" ${!has || !m.canShuffle ? 'disabled' : ''} title="${esc(_t('Shuffle'))}">${ic('shuffle', 'width:15px;height:15px')}</button>`
      + `<button type="button" class="mc-m-btn" data-mc="prev" ${!has || m.canPrev === false ? 'disabled' : ''} title="${esc(_t('Previous'))}">${ic('prev', 'width:17px;height:17px')}</button>`
      + `<button type="button" class="mc-m-btn play" data-mc="toggle" ${!has ? 'disabled' : ''} title="${esc(m.playing ? _t('Pause') : _t('Play'))}">${ic(m.playing ? 'pause' : 'play', 'width:17px;height:17px')}</button>`
      + `<button type="button" class="mc-m-btn" data-mc="next" ${!has || m.canNext === false ? 'disabled' : ''} title="${esc(_t('Next'))}">${ic('next', 'width:17px;height:17px')}</button>`
      + `<button type="button" class="mc-m-btn dim${m.repeat && m.repeat !== 'none' ? ' on' : ''}" data-mc="repeat" ${!has || !m.canRepeat ? 'disabled' : ''} title="${esc(_t('Repeat'))}">${ic('repeat', 'width:15px;height:15px')}</button>`
      + `</div><div class="row" style="gap:6px">`
      + `<button type="button" class="mc-out-chip" data-mout="1" title="${esc(audioOutName || _t('Sound output'))}">${ic('pods')}<span>${esc(outLabel)}</span></button>`
      + `${mirrorBtn}`
      + `<button type="button" class="mc-round-btn${inSection && homeSecSub === 'lyrics' ? ' on' : ''}" data-mlyr="1" title="${esc(_t('Lyrics'))}">${ic('lyrics')}</button>`
      + `</div></div></div>`;
  } else {
    el.innerHTML = `<div class="mc-art-box" data-mopen="1">${artHtml}</div>`
      + `<div class="mc-m-col">`
      + `<div class="row" style="gap:10px"><div style="min-width:0;flex:1" data-mopen="1">`
      + `<div class="t1" dir="auto" style="font-size:21px;font-weight:700;letter-spacing:-0.02em">${esc(titleStr)}</div>`
      + `<div class="sub t1" dir="auto" style="font-size:13px">${esc(artistStr)}</div></div>${eqHtml}</div>`
      + lyricHtml
      + `<div class="row mc-m-prog"><span class="n mc-p-el" style="font-size:11px">${esc(elStr)}</span>`
      + `<div class="bar${canSeek ? '' : ' disabled'}" data-mseek="1"><i style="transform:scaleX(${frac})"></i></div>`
      + `<span class="n mc-p-rem" style="font-size:11px">${esc(remStr)}</span></div>`
      + `<div class="row mc-m-ctls"><div class="row" style="gap:4px">`
      + `<button type="button" class="mc-m-btn dim${m.shuffle ? ' on' : ''}" data-mc="shuffle" ${!has || !m.canShuffle ? 'disabled' : ''} title="${esc(_t('Shuffle'))}">${ic('shuffle', 'width:15px;height:15px')}</button>`
      + `<button type="button" class="mc-m-btn" data-mc="prev" ${!has || m.canPrev === false ? 'disabled' : ''} title="${esc(_t('Previous'))}">${ic('prev', 'width:18px;height:18px')}</button>`
      + `<button type="button" class="mc-m-btn play" data-mc="toggle" ${!has ? 'disabled' : ''} title="${esc(m.playing ? _t('Pause') : _t('Play'))}">${ic(m.playing ? 'pause' : 'play', 'width:18px;height:18px')}</button>`
      + `<button type="button" class="mc-m-btn" data-mc="next" ${!has || m.canNext === false ? 'disabled' : ''} title="${esc(_t('Next'))}">${ic('next', 'width:18px;height:18px')}</button>`
      + `<button type="button" class="mc-m-btn dim${m.repeat && m.repeat !== 'none' ? ' on' : ''}" data-mc="repeat" ${!has || !m.canRepeat ? 'disabled' : ''} title="${esc(_t('Repeat'))}">${ic('repeat', 'width:15px;height:15px')}</button>`
      + `</div><div class="row" style="gap:6px">`
      + `<button type="button" class="mc-out-chip" data-mout="1" title="${esc(audioOutName || _t('Sound output'))}">${ic('pods')}<span>${esc(outLabel)}</span></button>`
      + mirrorBtn
      + (inSection && m.video && yt.dismissed.has(m.video) && !yt.blocked.has(m.video) && st.settings && st.settings.ytVideo !== false
        ? `<button type="button" class="mc-round-btn" data-myt="1" title="${esc(_t('Show the video'))}">${fa('play')}</button>` : '')
      + `<button type="button" class="mc-round-btn${inSection && homeSecSub === 'lyrics' ? ' on' : ''}" data-mlyr="1" title="${esc(_t('Lyrics'))}">${ic('lyrics')}</button>`
      + `</div></div></div>`;
  }

  scrollPlainPlayer(el, true);
  $$('[data-mc]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); cmd(b.dataset.mc); }; });
  $$('[data-mlyr]', el).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (st.settings && !st.settings.lyricsEnabled) api.setSettings({ lyricsEnabled: true, homeLyrics: true });
      else if (st.settings && !st.settings.homeLyrics) api.setSettings({ homeLyrics: true });
      if (inSection && homeSecSub === 'lyrics') { homeSecSub = 'music'; renderHomeSection(); layout(); }
      else { homeSecSub = 'lyrics'; N.openModule('home'); renderHomeSection(); layout(); }
    };
  });
  const ytBtn = $('[data-myt]', el);
  if (ytBtn) ytBtn.onclick = (e) => { e.stopPropagation(); yt.dismissed.delete(m.video); renderHomeSection(); layout(); };
  const mBtn = $('[data-mmirror]', el);
  if (mBtn) {
    mBtn.onclick = (e) => {
      e.stopPropagation();
      if (inSection && homeSecSub === 'mirror') { homeSecSub = 'music'; stopMirror(); renderHomeSection(); layout(); }
      else { homeSecSub = 'mirror'; N.openModule('home'); renderHomeSection(); startMirror(); layout(); }
    };
  }
  const outBtn = $('[data-mout]', el);
  if (outBtn) {
    outBtn.onclick = (e) => {
      e.stopPropagation();
      N.openModule('control');
      callModule('control', 'showSound');
    };
  }
  $$('[data-mopen]', el).forEach((box) => {
    box.onclick = (e) => {
      e.stopPropagation();
      if (!inSection) { homeSecSub = 'music'; N.openModule('home'); renderHomeSection(); }
    };
  });
  const seekBar = $('[data-mseek]', el);
  if (seekBar && canSeek) {
    seekBar.onclick = (e) => {
      e.stopPropagation();
      const r = seekBar.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      cmd('seek', f * d);
      const barI = $('i', seekBar);
      if (barI) barI.style.transform = `scaleX(${f.toFixed(4)})`;
    };
  }
}

function homeNeedsTall() {
  return homeSecSub === 'lyrics' || homeSecSub === 'mirror' || ytShows(st.media || {});
}

function renderHomeSection() {
  const page = $('#page-home');
  if (!page) return;
  page.classList.add('sec-home');
  let wrap = $('.home-sec-wrap', page);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'home-sec-wrap';
    const main = document.createElement('div');
    main.className = 'home-sec-main';
    main.style.cssText = 'flex:1;min-width:0;display:flex;height:100%';
    const side = document.createElement('div');
    side.className = 'home-sec-side';
    side.hidden = true;
    wrap.append(main, side);
    page.appendChild(wrap);
    // Keep legacy #music/#calendarBox hidden in DOM so legacy listeners stay valid
    const legMusic = $('#music', page); if (legMusic) legMusic.hidden = true;
    const legCal = $('#calendarBox', page); if (legCal) legCal.hidden = true;
  }
  const main = $('.home-sec-main', wrap);
  const side = $('.home-sec-side', wrap);
  // the video takes the whole section: no lyrics or Mirror beside it
  if (homeSecSub !== 'music' && ytShows(st.media || {})) { if (homeSecSub === 'mirror') stopMirror(); homeSecSub = 'music'; }
  const lyrEl = $('#lyrics', page);
  const mirEl = $('#mirror', page);
  const split = homeSecSub === 'lyrics' || homeSecSub === 'mirror';
  wrap.classList.toggle('split', split);
  side.hidden = !split;
  if (homeSecSub === 'lyrics' && lyrEl) {
    if (lyrEl.parentNode !== side) side.appendChild(lyrEl);
    lyrEl.hidden = false;
    if (mirEl) mirEl.hidden = true;
    page.classList.add('lyrics-mode');
    renderLyrics();
  } else if (homeSecSub === 'mirror' && mirEl) {
    if (mirEl.parentNode !== side) side.appendChild(mirEl);
    mirEl.hidden = false;
    if (lyrEl) lyrEl.hidden = true;
    page.classList.remove('lyrics-mode');
  } else {
    if (lyrEl) lyrEl.hidden = true;
    if (mirEl) mirEl.hidden = true;
    page.classList.remove('lyrics-mode');
  }
  let player = $('.mc-music', main);
  if (!player) {
    player = document.createElement('div');
    main.appendChild(player);
  }
  paintMusicPlayer(player, true);
}

function paintHomeCard(el) {
  paintMusicPlayer(el, false);
}

function updateHomeCardProgress() {
  const m = st.media || {};
  const d = m.duration || 0;
  const pos = mediaPosition();
  const frac = d ? Math.max(0, Math.min(1, pos / d)) : 0;
  const elStr = d ? fmt(pos) : '0:00';
  const remStr = d ? '-' + fmt(Math.max(0, d - pos)) : (m.radio && m.active ? _t('Live') : '0:00');
  const targets = [...homeCards, ...$$('#page-home .mc-music')];
  for (const el of targets) {
    if (!el.isConnected) { homeCards.delete(el); continue; }
    scrollPlainPlayer(el, false);
    const bar = $('.mc-m-prog .bar i', el);
    if (bar) bar.style.transform = `scaleX(${frac})`;
    const t1 = $('.mc-p-el', el); if (t1) t1.textContent = elStr;
    const t2 = $('.mc-p-rem', el); if (t2) t2.textContent = remStr;
  }
}

function refreshHomeCards() {
  for (const el of homeCards) {
    if (!el.isConnected) { homeCards.delete(el); continue; }
    paintHomeCard(el);
  }
  if (st.page === 'home') renderHomeSection();
}

function fileBadge(it) {
  if (it.kind === 'link') return { ext: 'URL', col: '#60a5fa' };
  if (it.kind === 'text') return { ext: 'TXT', col: '#4ade80' };
  if (it.isDir) return { ext: 'DIR', col: '#8fa2ff' };
  const m = /\.([a-z0-9]{1,5})$/i.exec(it.name || '');
  const ext = (m ? m[1] : 'FILE').toUpperCase().slice(0, 4);
  if (ext === 'PDF') return { ext, col: '#ff6b5e' };
  if (['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'HEIC', 'SVG'].includes(ext)) return { ext, col: '#8fa2ff' };
  if (['FIG', 'SKET', 'PSD', 'AI'].includes(ext)) return { ext, col: '#c9b6ff' };
  if (['M4A', 'MP3', 'WAV', 'FLAC', 'AAC', 'MOV', 'MP4'].includes(ext)) return { ext, col: '#fbbf24' };
  if (['ZIP', 'TAR', 'GZ', 'DMG', 'RAR', '7Z'].includes(ext)) return { ext, col: '#60a5fa' };
  if (['TXT', 'MD', 'JSON', 'CSV', 'DOC', 'DOCX'].includes(ext)) return { ext, col: '#4ade80' };
  return { ext, col: '#a0a0b0' };
}

function paintShelfCard(el) {
  const list = st.shelf || [];
  const totalBytes = list.reduce((sum, it) => sum + (Number(it.size) || 0), 0);
  const fanSpec = [
    { rot: -12, left: 0, fbCol: '#c9b6ff', fbExt: 'FIG' },
    { rot: -3, left: 22, fbCol: '#8fa2ff', fbExt: 'PNG' },
    { rot: 8, left: 44, fbCol: '#ff6b5e', fbExt: 'PDF' },
  ];
  const top3 = list.slice(0, 3);
  const fanHtml = fanSpec.map((sp, i) => {
    const it = top3[top3.length - 1 - i];
    const b = it ? fileBadge(it) : { col: '#1c1c24', ext: '' };
    const fg = it ? 'rgba(0,0,0,0.62)' : 'var(--mute)';
    const content = it && it.photo && it.thumb
      ? `<img src="${esc(it.thumb)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" alt="">`
      : esc(b.ext);
    return `<div style="position:absolute;left:${sp.left}px;top:6px;width:48px;height:60px;border-radius:10px;background:${b.col};transform:rotate(${sp.rot}deg);display:grid;place-items:end center;padding-bottom:${it && it.photo && it.thumb ? 0 : 6}px;font-size:9px;font-weight:800;color:${fg};box-shadow:0 0 0 2px #0f0f12;overflow:hidden">${content}</div>`;
  }).join('');

  const subText = list.length
    ? [totalBytes ? bytes(totalBytes) : '', list[0].name].filter(Boolean).join(' · ')
    : _t('Temporary spot for files');
  const ic = N.ic || (() => '');

  el.style.flexDirection = 'row';
  el.style.gap = '14px';
  el.style.alignItems = 'center';
  el.innerHTML = `<div style="position:relative;width:96px;height:72px;flex:none">${fanHtml}</div>`
    + `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">`
    + `${N.hd ? N.hd('shelf', _t('Shelf')) : ''}`
    + `<div class="big" style="font-size:24px;margin-top:4px">${list.length} <span style="font-size:13px;color:var(--dim);font-weight:600">${esc(list.length === 1 ? _t('file') : _t('files'))}</span></div>`
    + `<div class="sub t1">${esc(subText)}</div>`
    + `<div class="row" style="gap:6px;margin-top:6px;font-size:11px;color:var(--dim)">${ic('upload', 'width:12px;height:12px')}<span class="t1">${esc(_t('Drop files here'))}</span></div></div>`;
  N.cardClick(el, () => N.openModule('shelf'));
}

function refreshShelfCards() {
  for (const el of shelfCards) {
    if (!el.isConnected) { shelfCards.delete(el); continue; }
    paintShelfCard(el);
  }
  renderShelfSection();
}

function renderShelfSection() {
  const page = $('#page-shelf');
  if (!page) return;
  page.classList.add('sec-shelf');
  const list = st.shelf || [];
  const clips = clip || [];
  const showClip = clipOn() || clips.length > 0;
  const showPhone = phoneAllowed();
  const mode = phoneView ? 'phone' : (shelfView === 'clip' && showClip ? 'clip' : 'files');
  const ic = N.ic || (() => '');

  let bodyHtml = '';
  if (mode === 'files') {
    bodyHtml = list.length
      ? `<div class="sh-grid">${list.map((it) => {
          const b = fileBadge(it);
          const fi = it.photo && it.thumb
            ? `<div class="sh-fi img"><img src="${esc(it.thumb)}" alt=""></div>`
            : `<div class="sh-fi" style="background:${b.col}">${esc(b.ext)}</div>`;
          return `<div class="sh-card${st.selected.has(it.id) ? ' sel' : ''}" draggable="true" data-shid="${esc(it.id)}" title="${esc(it.path || it.text || it.name)}">`
            + `<button type="button" class="sh-rm" data-shrm="${esc(it.id)}" title="${esc(_t('Remove'))}">×</button>`
            + `${fi}<span class="t1" style="font-size:11px;font-weight:600;max-width:100%">${esc(it.name)}</span></div>`;
        }).join('')}</div>`
      : `<div class="c grow" style="justify-content:center;align-items:center;text-align:center;gap:4px"><span style="color:var(--mute)">${ic('shelf', 'width:22px;height:22px')}</span><b style="font-size:12.5px">${esc(_t('Drop files here'))}</b><span class="sub">${esc(_t('Keep files handy, then drag them out anywhere'))}</span></div>`;
  } else if (mode === 'clip') {
    bodyHtml = clips.length
      ? `<div class="sh-clip-list">${clips.map((it) => {
          const preview = it.kind === 'image'
            ? (it.thumb ? `<img src="${esc(it.thumb)}" style="height:40px;max-width:100%;object-fit:contain;border-radius:6px" alt="">` : `<span class="sub">${esc(_t('Image'))}</span>`)
            : `<div class="sh-cb" dir="auto">${swatchCss(it.color) ? `<span class="clip-sw" style="background:${swatchCss(it.color)}"></span>` : ''}${esc((it.text || '').trim())}</div>`;
          const copied = clipCopied && clipCopied.id === it.id;
          return `<div class="sh-clip-item" data-cid="${esc(it.id)}">${preview}`
            + `<div class="sh-cm"><span>${esc(copied ? _t('Copied') : (it.kind === 'link' ? _t('Link') : it.kind === 'image' ? _t('Image') : _t('Text')))}</span>`
            + `${it.pinned ? `<span style="color:var(--amber)">${fa('thumbtack')}</span>` : ''}<span style="margin-inline-start:auto">${esc(clipAgo(it.at))}</span></div>`
            + `<div class="sh-clip-acts"><button type="button" data-cact="pin" title="${esc(it.pinned ? _t('Unpin') : _t('Pin'))}">${fa('thumbtack')}</button>`
            + `<button type="button" data-cact="rm" title="${esc(_t('Remove'))}">×</button></div></div>`;
        }).join('')}</div>`
      : `<div class="c grow" style="justify-content:center;align-items:center;text-align:center;gap:4px"><b style="font-size:12.5px">${esc(_t('Nothing copied yet'))}</b><span class="sub">${esc(_t('Texts, links and pictures you copy show up here'))}</span></div>`;
  } else {
    // Phone panel
    const ph = phone || {};
    bodyHtml = ph.starting
      ? `<div class="c grow" style="justify-content:center;align-items:center;gap:6px">${fa('spinner fa-spin')}<span>${esc(_t('Starting…'))}</span></div>`
      : ph.on
        ? `<div class="c grow" style="flex-direction:row;gap:12px;align-items:center;padding:10px 12px">`
          + `<div class="ph-qr" style="width:120px;height:120px;flex:none;background:#fff;border-radius:10px;padding:4px" title="${esc(ph.url || '')}">${ph.qr || ''}</div>`
          + `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">`
          + `<b style="font-size:13px">${esc(_t('Scan with your phone’s camera'))}</b>`
          + `<span class="sub">${esc(_t('Your phone needs to be on the same Wi-Fi.'))}</span>`
          + `<span class="sub n" style="color:#fff">${esc(ph.address || '')}</span>`
          + `<div class="row" style="margin-top:auto"><button type="button" class="sbtn" data-phact="stop">${esc(_t('Stop'))}</button></div></div></div>`
        : `<div class="c grow" style="justify-content:center;align-items:center;gap:8px;text-align:center"><b style="font-size:13px">${esc(ph.error ? _t('Couldn’t start sharing') : _t('Send and receive with your phone'))}</b>`
          + `<button type="button" class="sbtn p" data-phact="start">${esc(_t('Start'))}</button></div>`;
  }

  let wrap = $('.sh-wrap-v3', page);
  if (!wrap) {
    // Hide legacy children without deleting them (listeners in notch.js reference their IDs)
    [...page.children].forEach((ch) => { ch.hidden = true; });
    wrap = document.createElement('div');
    wrap.className = 'sh-wrap-v3';
    page.appendChild(wrap);
  }
  const shareLabel = MAC ? 'AirDrop' : _t('Share');
  wrap.innerHTML = `<div class="sh-main">`
    + `<div class="seg2" style="align-self:flex-start">`
    + `<button type="button" class="${mode === 'files' ? 'on' : ''}" data-shmode="files">${esc(_t('Files'))}${list.length ? ' ' + list.length : ''}</button>`
    + (showClip ? `<button type="button" class="${mode === 'clip' ? 'on' : ''}" data-shmode="clip">${esc(_t('Clipboard'))}${clips.length ? ' ' + clips.length : ''}</button>` : '')
    + (showPhone ? `<button type="button" class="${mode === 'phone' ? 'on' : ''}" data-shmode="phone">${esc(_t('Phone'))}${phone && phone.on ? ' ●' : ''}</button>` : '')
    + `</div>${bodyHtml}</div>`
    + `<div class="sh-side">`
    + `<button type="button" class="sh-drop" data-shact="add">${ic('upload', 'width:18px;height:18px')}<span>${esc(_t('Drop files here'))}</span></button>`
    + `<button type="button" class="sbtn" data-shact="share">${esc(shareLabel)}</button>`
    + `<button type="button" class="sbtn" data-shact="clear">${esc(_t('Clear'))}</button>`
    + `</div>`;

  $$('[data-shmode]', wrap).forEach((b) => {
    b.onclick = () => {
      const m = b.dataset.shmode;
      if (m === 'phone') {
        phoneView = true;
        if (!phone.on && !phone.starting) startPhone();
        else renderShelfSection();
      } else {
        phoneView = false;
        setShelfView(m);
        renderShelfSection();
      }
    };
  });
  const addB = $('[data-shact="add"]', wrap);
  if (addB) addB.onclick = async () => { st.ctxOpen = true; st.shelf = await api.shelfPick(); st.ctxOpen = false; renderShelf(); };
  const shB = $('[data-shact="share"]', wrap);
  if (shB) shB.onclick = () => {
    const ids = (st.selected.size ? [...st.selected] : st.shelf.map((s) => s.id)).filter((id) => (st.shelf.find((s) => s.id === id) || {}).kind === 'file');
    if (ids.length) api.shelfShare(ids);
  };
  const clB = $('[data-shact="clear"]', wrap);
  if (clB) clB.onclick = async () => {
    if (mode === 'clip') { clip = await api.svc('clipboard', 'clear'); renderClip(); renderShelfSection(); }
    else { st.shelf = await api.shelfClear(); st.selected.clear(); renderShelf(); }
  };
  $$('[data-shid]', wrap).forEach((el) => {
    const id = el.dataset.shid;
    el.onclick = (e) => {
      if (e.target.closest('[data-shrm]')) { removeShelf([id]); return; }
      if (e.ctrlKey || e.shiftKey) { if (st.selected.has(id)) st.selected.delete(id); else st.selected.add(id); }
      else st.selected = new Set([id]);
      renderShelfSection();
    };
    el.ondblclick = () => api.shelfOpen(id);
    el.ondragstart = (e) => { e.preventDefault(); shelfDragOut = Date.now(); api.shelfStartDrag(st.selected.has(id) ? [...st.selected] : [id]); };
    el.oncontextmenu = (e) => { e.preventDefault(); if (!st.selected.has(id)) { st.selected = new Set([id]); renderShelfSection(); } showCtx(e, id); };
  });
  $$('[data-cid]', wrap).forEach((el) => {
    const id = el.dataset.cid;
    el.onclick = (e) => {
      const a = e.target.closest('[data-cact]');
      if (!a) { copyClip(id); return; }
      const it = clip.find((c) => c.id === id);
      if (a.dataset.cact === 'rm') removeClip(id);
      else if (it) pinClip(id, !it.pinned);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showClipCtx(e, id); };
  });
  $$('[data-phact]', wrap).forEach((b) => {
    b.onclick = () => { if (b.dataset.phact === 'stop') stopPhone(); else startPhone(); };
  });
}

function shortGig(nBytes) {
  if (!nBytes || nBytes <= 0) return '0G';
  const gb = nBytes / (1024 * 1024 * 1024);
  const dec = _tLocale() && _tLocale().startsWith('id') ? ',' : '.';
  return gb >= 100 ? `${Math.round(gb)}G` : `${gb.toFixed(1).replace('.', dec)}G`;
}

function fmtSysBytes(n, perSec, wholeIfInt) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, Number(n) || 0);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  const dec = _tLocale() && _tLocale().startsWith('id') ? ',' : '.';
  let num;
  if (i === 0 || v >= 100) {
    num = String(Math.round(v));
  } else if (wholeIfInt && Math.abs(v - Math.round(v)) < 0.05) {
    num = String(Math.round(v));
  } else {
    num = v.toFixed(1).replace('.', dec);
  }
  return `${num} ${u[i]}${perSec ? '/s' : ''}`;
}

function sysChipLabel(model) {
  if (!model) return 'CPU';
  const clean = model
    .replace(/\bApple\b/gi, '')
    .replace(/\(R\)|\(TM\)|\bCPU\b|\bProcessor\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return (clean || 'CPU').slice(0, 12);
}

// Flat 2D hardware illustrations:
// neutral hardware (#1b1b21 body, #2c2c35 edge, #34343d pins), colour only where the value is
const SYS_B = '#1b1b21';
const SYS_E = '#2c2c35';
const SYS_PIN = '#34343d';
const SYS_OFF = '#24242b';

function sysSvgCpu(pct, n, label) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const col = meter(p);
  const total = Math.max(2, Math.min(16, Math.round(Number(n) || 8)));
  const lit = Math.round((p / 100) * total);
  const cols = Math.ceil(total / 2);
  const gap = cols > 4 ? 2 : 3;
  const cw = Math.max(2, 38 / cols - gap);
  let s = '';
  for (let k = 0; k < 5; k++) {
    const x = 38 + k * 11;
    const y = 16 + k * 9;
    s += `<rect x="${x}" y="2" width="3" height="8" rx="1.5" fill="${SYS_PIN}"/><rect x="${x}" y="60" width="3" height="8" rx="1.5" fill="${SYS_PIN}"/>`;
    if (k < 4) s += `<rect x="20" y="${y}" width="8" height="3" rx="1.5" fill="${SYS_PIN}"/><rect x="92" y="${y}" width="8" height="3" rx="1.5" fill="${SYS_PIN}"/>`;
  }
  s += `<rect x="28" y="8" width="64" height="54" rx="9" fill="${SYS_B}" stroke="${SYS_E}"/><rect x="38" y="16" width="44" height="30" rx="5" fill="#111115"/>`;
  for (let k = 0; k < total; k++) {
    const cx = (41 + (k % cols) * (38 / cols)).toFixed(2);
    const cy = 19 + Math.floor(k / cols) * 13;
    s += `<rect class="core" x="${cx}" y="${cy}" width="${cw.toFixed(2)}" height="10" rx="2.5" fill="${k < lit ? col : SYS_OFF}"/>`;
  }
  return `${s}<text x="60" y="56" text-anchor="middle" font-size="7" font-weight="700" fill="#6b6b75" letter-spacing=".4">${esc(label || 'CPU')}</text>`;
}

function sysSvgRam(pct, label) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const col = meter(p);
  const lit = Math.round((p / 100) * 8);
  let s = `<rect x="4" y="14" width="112" height="38" rx="5" fill="${SYS_B}" stroke="${SYS_E}"/>`;
  for (let k = 0; k < 8; k++) {
    s += `<rect x="${(10 + k * 13.2).toFixed(1)}" y="20" width="10" height="18" rx="2" fill="${k < lit ? col : SYS_OFF}"/>`;
  }
  for (let k = 0; k < 26; k++) {
    const x = (8 + k * 4.1 + (k > 12 ? 3 : 0)).toFixed(1);
    s += `<rect x="${x}" y="45" width="2.4" height="7" rx=".6" fill="${SYS_PIN}"/>`;
  }
  return `${s}<rect x="58" y="44" width="4" height="9" fill="#0f0f12"/><text x="60" y="64" text-anchor="middle" font-size="7" font-weight="700" fill="#6b6b75" letter-spacing=".4">${esc(label || 'RAM')}</text>`;
}

function sysSvgSsd(pct, label) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const col = meter(p);
  const lit = Math.round((p / 100) * 12);
  let s = `<rect x="16" y="6" width="88" height="58" rx="8" fill="${SYS_B}" stroke="${SYS_E}"/>`;
  for (const [x, y] of [[23, 13], [97, 13], [23, 57], [97, 57]]) {
    s += `<circle cx="${x}" cy="${y}" r="2.2" fill="${SYS_PIN}"/>`;
  }
  s += `<rect x="32" y="14" width="56" height="18" rx="4" fill="#111115"/><text x="60" y="26.5" text-anchor="middle" font-size="7.5" font-weight="800" fill="#6b6b75" letter-spacing="1">${esc(label || 'SSD')}</text>`;
  for (let k = 0; k < 12; k++) {
    s += `<rect x="${(28 + k * 5.5).toFixed(1)}" y="41" width="4" height="12" rx="1.5" fill="${k < lit ? col : SYS_OFF}"/>`;
  }
  return s;
}

function sysSvgWifi(q, opts) {
  const o = opts || {};
  const hasWifi = typeof q === 'number' && !Number.isNaN(q);
  const connected = hasWifi || !!o.wired || (o.rx > 0) || (o.tx > 0);
  const on = '#60a5fa';
  const arc = (r, a) => `<path d="M${60 - r} ${(46 - r * 0.55).toFixed(2)}a${(r * 1.05).toFixed(2)} ${(r * 1.05).toFixed(2)} 0 0 1 ${r * 2} 0" fill="none" stroke="${a ? on : SYS_OFF}" stroke-width="5" stroke-linecap="round"/>`;
  const dotCol = connected ? on : SYS_OFF;
  const dnCls = connected ? ' class="flow-d"' : '';
  const upCls = connected ? ' class="flow-u"' : '';
  const dnCol = connected ? '#60a5fa' : SYS_PIN;
  const upCol = connected ? '#c9b6ff' : SYS_PIN;
  return `<circle cx="60" cy="50" r="4.5" fill="${dotCol}"/>${arc(10, hasWifi && q >= 25)}${arc(19, hasWifi && q >= 55)}${arc(28, hasWifi && q >= 80)}`
    + `<g${dnCls}><rect x="96" y="22" width="18" height="18" rx="6" fill="${SYS_B}" stroke="${SYS_E}"/><path d="M105 27v8m-3.5-3.5L105 35l3.5-3.5" stroke="${dnCol}" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`
    + `<g${upCls}><rect x="6" y="22" width="18" height="18" rx="6" fill="${SYS_B}" stroke="${SYS_E}"/><path d="M15 35v-8m-3.5 3.5L15 27l3.5 3.5" stroke="${upCol}" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`;
}

function sysSvgArea(vals, col, h = 44) {
  const w = 140;
  const mx = 100;
  const src = vals && vals.length >= 2 ? vals : [vals && vals.length ? vals[0] : 0, vals && vals.length ? vals[0] : 0];
  const step = w / (src.length - 1);
  const pts = src.map((v, k) => {
    const c = Math.max(0, Math.min(mx, Number(v) || 0));
    return `${(k * step).toFixed(1)},${(h - (c / mx) * (h - 2) - 1).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block"><polygon points="0,${h} ${pts} ${w},${h}" fill="${col}" opacity=".16"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function sysSvgMirror(dn, up) {
  const w = 140;
  const h = 46;
  const m = h / 2;
  const len = Math.max(2, (dn || []).length, (up || []).length);
  const pad = (arr) => {
    const a = (arr || []).slice(-len);
    while (a.length < len) a.unshift(a.length ? a[0] : 0);
    return a;
  };
  const sd = pad(dn);
  const su = pad(up);
  const maxR = Math.max(1024, ...sd, ...su);
  const step = w / (len - 1);
  const pd = sd.map((v, k) => `${(k * step).toFixed(1)},${(m - (Math.max(0, v) / maxR) * (m - 1)).toFixed(1)}`).join(' ');
  const pu = su.map((v, k) => `${(k * step).toFixed(1)},${(m + (Math.max(0, v) / maxR) * (m - 1)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block"><polygon points="0,${m} ${pd} ${w},${m}" fill="#60a5fa" opacity=".22"/><polyline points="${pd}" fill="none" stroke="#60a5fa" stroke-width="1.4"/><polygon points="0,${m} ${pu} ${w},${m}" fill="#c9b6ff" opacity=".2"/><polyline points="${pu}" fill="none" stroke="#c9b6ff" stroke-width="1.4"/><line x1="0" y1="${m}" x2="${w}" y2="${m}" stroke="#2a2a32" stroke-width=".8"/></svg>`;
}

function paintStatsCard(el) {
  const s = lastStats || st.stats;
  const cpuPct = s ? Math.max(0, Math.min(100, Math.round((s.cpu || 0) * 100))) : 0;
  const hasMem = !!(s && s.memTotal > 0);
  const memUsed = hasMem ? Math.max(0, s.memTotal - s.memFree) : 0;
  const memPct = hasMem ? Math.max(0, Math.min(100, Math.round((memUsed / s.memTotal) * 100))) : 0;
  const hasDisk = !!(s && s.disk && s.disk.total > 0);
  const diskUsed = hasDisk ? Math.max(0, s.disk.total - s.disk.free) : 0;
  const diskPct = hasDisk ? Math.max(0, Math.min(100, Math.round((diskUsed / s.disk.total) * 100))) : 0;
  const rx = hist.rx[hist.rx.length - 1] || 0;
  const tx = hist.tx[hist.tx.length - 1] || 0;
  const wf = s && s.wifi;
  const wfQ = wf && typeof wf.quality === 'number' ? wf.quality : null;

  const model = (s && s.cpuModel)
    ? s.cpuModel.replace(/\(R\)|\(TM\)|CPU|Processor/g, '').replace(/\s+/g, ' ').trim()
    : _t('System');
  const rightMeta = s && s.cores ? _t('{n} cores', { n: s.cores }) : '';
  const chipLbl = sysChipLabel(s && s.cpuModel);
  const ramLbl = hasMem ? fmtSysBytes(s.memTotal, false, true) : 'RAM';

  const items = [
    [sysSvgCpu(cpuPct, s && s.cores, chipLbl), 'CPU', s ? `${cpuPct}%` : '–', meter(cpuPct)],
    [sysSvgRam(memPct, ramLbl), _t('Memory'), hasMem ? shortGig(memUsed) : '–', meter(memPct)],
    [sysSvgSsd(diskPct, 'SSD'), _t('Disk'), hasDisk ? shortGig(diskUsed) : '–', meter(diskPct)],
    [sysSvgWifi(wfQ, { wired: !!st.wired, rx, tx }), _t('Network'), fmtSysBytes(rx, true), '#60a5fa'],
  ];

  el.innerHTML = `${N.hd ? N.hd('cpu', model, rightMeta) : ''}`
    + `<div class="sys-card-grid">`
    + items.map(([svg, lbl, val, col]) => `<div class="sys-card-it">`
      + `<div class="sys-ill"><svg viewBox="0 0 120 70">${svg}</svg></div>`
      + `<span class="t1" style="font-size:9px;color:var(--dim);font-weight:600;line-height:1.2">${esc(lbl)}</span>`
      + `<b class="n t1" style="font-size:12.5px;color:${col};line-height:1.2">${esc(val)}</b>`
      + `</div>`).join('')
    + `</div>`;
  N.cardClick(el, () => N.openModule('stats'));
}

function renderStatsSection() {
  const page = $('#page-stats');
  if (!page) return;
  const s = lastStats || st.stats;
  const cpuPct = s ? Math.max(0, Math.min(100, Math.round((s.cpu || 0) * 100))) : 0;
  const hasMem = !!(s && s.memTotal > 0);
  const memUsed = hasMem ? Math.max(0, s.memTotal - s.memFree) : 0;
  const memPct = hasMem ? Math.max(0, Math.min(100, Math.round((memUsed / s.memTotal) * 100))) : 0;
  const hasDisk = !!(s && s.disk && s.disk.total > 0);
  const diskUsed = hasDisk ? Math.max(0, s.disk.total - s.disk.free) : 0;
  const diskPct = hasDisk ? Math.max(0, Math.min(100, Math.round((diskUsed / s.disk.total) * 100))) : 0;
  const hasTemp = !!(s && s.temp && typeof s.temp.c === 'number');
  const rx = hist.rx[hist.rx.length - 1] || 0;
  const tx = hist.tx[hist.tx.length - 1] || 0;
  const wf = s && s.wifi;
  const wfQ = wf && typeof wf.quality === 'number' ? wf.quality : null;

  let wrap = $('.st-wrap-v3', page);
  if (!wrap) {
    [...page.children].forEach((ch) => { ch.hidden = true; });
    wrap = document.createElement('div');
    wrap.className = 'st-wrap-v3';
    page.appendChild(wrap);
  }

  const col4 = (ill, lbl, val, col, sub, foot) => `<div class="c sys-tile">`
    + `<div class="sys-ill"><svg viewBox="0 0 120 70">${ill}</svg></div>`
    + `<div class="row" style="justify-content:space-between;align-items:baseline;margin-top:4px;gap:4px"><span class="sub t1" style="font-size:10.5px;font-weight:600">${esc(lbl)}</span><b class="n t1" style="font-size:17px;color:${col};flex:none">${esc(val)}</b></div>`
    + `<div class="sub t1" style="font-size:10.5px;min-height:14px">${esc(sub)}</div>`
    + `<div class="sys-foot">${foot}</div>`
    + `</div>`;

  // Tile 1: CPU
  const cpuSeries = hist.cpu.length ? hist.cpu.map((x) => Math.max(0, Math.min(100, (x || 0) * 100))) : [cpuPct, cpuPct];
  const cpuPeak = Math.round(Math.max(cpuPct, ...cpuSeries));
  const cpuParts = [];
  if (s && s.cores) cpuParts.push(_t('{n} cores', { n: s.cores }));
  if (hasTemp) cpuParts.push(tempInfo(s.temp.c).text);
  const cpuFoot = `<div class="row" style="justify-content:space-between;font-size:9.5px;color:var(--mute);margin-bottom:2px"><span>${esc(_t('60 s'))}</span><span class="n">${s ? esc(_t('peak {n}%', { n: cpuPeak })) : '–'}</span></div>`
    + sysSvgArea(cpuSeries, meter(cpuPct), 44);

  // Tile 2: Memory
  const ramLabel = hasMem ? `RAM · ${fmtSysBytes(s.memTotal, false, true)}` : 'RAM';
  const pressureKey = s && (s.memPressure === 'normal' || s.memPressure === 'warn' || s.memPressure === 'critical')
    ? `${s.memPressure}|pressure`
    : null;
  const memParts = [];
  if (hasMem) memParts.push(_t('of {total}', { total: fmtSysBytes(s.memTotal, false, true) }));
  if (pressureKey) memParts.push(_t(pressureKey));
  const hasBreakdown = hasMem
    && typeof s.memApp === 'number'
    && typeof s.memWired === 'number'
    && typeof s.memCompressed === 'number';
  const memCol = meter(memPct);
  let memFoot = '';
  if (hasBreakdown) {
    const appB = Math.max(0, s.memApp);
    const wiredB = Math.max(0, s.memWired);
    const compB = Math.max(0, s.memCompressed);
    const freeB = Math.max(0, s.memTotal - Math.min(s.memTotal, appB + wiredB + compB));
    const segs = [
      [appB, 1],
      [wiredB, 0.55],
      [compB, 0.3],
    ].filter(([v]) => v > 0);
    memFoot = `<div style="display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;margin-bottom:8px;background:#24242b">`
      + segs.map(([v, op]) => `<i style="display:block;flex:${v};background:${memCol};opacity:${op}"></i>`).join('')
      + (freeB > 0 ? `<i style="display:block;flex:${freeB};background:#24242b"></i>` : '')
      + `</div>`
      + [
        [_t('Apps'), fmtSysBytes(appB), 1],
        [_t('Wired'), fmtSysBytes(wiredB), 0.55],
        [_t('Compressed'), fmtSysBytes(compB), 0.3],
      ].map(([name, val, op]) => `<div class="row" style="gap:6px;font-size:10.5px;padding:1px 0"><i style="display:block;width:7px;height:7px;border-radius:2px;background:${memCol};opacity:${op};flex:none"></i><span class="sub t1">${esc(name)}</span><b class="n" style="margin-left:auto;font-size:10.5px;flex:none">${esc(val)}</b></div>`).join('');
  } else if (hasMem) {
    memFoot = `<div class="row" style="justify-content:flex-end;font-size:10.5px;margin-bottom:4px"><b class="n" style="color:${memCol}">${memPct}%</b></div>`
      + `<div style="height:8px;border-radius:4px;background:#24242b;overflow:hidden"><i style="display:block;height:100%;width:100%;background:${memCol};border-radius:4px;transform-origin:0 50%;transform:scaleX(${(memPct / 100).toFixed(4)})"></i></div>`;
  }

  // Tile 3: Disk
  const volName = (s && ((s.disk && s.disk.name) || s.diskName)) || '';
  const diskCol = meter(diskPct);
  const diskSub = hasDisk ? _t('of {total} used', { total: fmtSysBytes(s.disk.total, false, true) }) : '';
  const diskFoot = hasDisk
    ? `<div class="row" style="justify-content:space-between;gap:6px;font-size:10.5px;margin-bottom:4px">${volName ? `<span class="sub t1">${esc(volName)}</span>` : '<span></span>'}<b class="n" style="color:${diskCol};flex:none">${diskPct}%</b></div>`
      + `<div style="height:8px;border-radius:4px;background:#24242b;overflow:hidden;margin-bottom:8px"><i style="display:block;height:100%;width:100%;background:${diskCol};border-radius:4px;transform-origin:0 50%;transform:scaleX(${(diskPct / 100).toFixed(4)})"></i></div>`
      + `<div class="row" style="gap:6px;align-items:baseline;white-space:nowrap;padding:6px 9px;border-radius:10px;background:var(--pill)"><b class="n" style="font-size:13px;color:#fff">${esc(fmtSysBytes(s.disk.free))}</b><span class="sub t1" style="font-size:10.5px">${esc(_t('free'))}</span></div>`
    : '';

  // Tile 4: Network
  let netSub = '';
  if (wf) {
    netSub = [wf.ssid || 'Wi-Fi', wfQ !== null ? `${wfQ}%` : ''].filter(Boolean).join(' · ');
  } else if (st.wired) {
    netSub = _t('Ethernet');
  } else if (rx > 0 || tx > 0) {
    netSub = _t('No Wi-Fi');
  } else {
    netSub = _t('Offline');
  }
  const netFoot = `<div class="row" style="justify-content:space-between;gap:4px;font-size:9.5px;margin-bottom:2px"><span class="n t1" style="color:#60a5fa">↓ ${esc(fmtSysBytes(rx, true))}</span><span class="n t1" style="color:#c9b6ff">↑ ${esc(fmtSysBytes(tx, true))}</span></div>`
    + sysSvgMirror(hist.rx, hist.tx);

  wrap.innerHTML = col4(sysSvgCpu(cpuPct, s && s.cores, sysChipLabel(s && s.cpuModel)), 'CPU', s ? `${cpuPct}%` : '–', meter(cpuPct), cpuParts.join(' · '), cpuFoot)
    + col4(sysSvgRam(memPct, ramLabel), _t('Memory'), hasMem ? fmtSysBytes(memUsed) : '–', memCol, memParts.join(' · '), memFoot)
    + col4(sysSvgSsd(diskPct, 'SSD'), _t('Disk'), hasDisk ? fmtSysBytes(diskUsed) : '–', diskCol, diskSub, diskFoot)
    + col4(sysSvgWifi(wfQ, { wired: !!st.wired, rx, tx }), _t('Network'), fmtSysBytes(rx, true), '#60a5fa', netSub, netFoot);
}

function refreshStatsCards() {
  for (const el of statsCards) {
    if (!el.isConnected) { statsCards.delete(el); continue; }
    paintStatsCard(el);
  }
  if (st.page === 'stats') renderStatsSection();
}

function paintHitlCard(el) {
  const list = st.claude || [];
  if (!list.length) {
    el.innerHTML = `${N.hd ? N.hd('shield', _t('Agent approvals')) : ''}<div class="sub" style="margin-top:auto">${esc(_t('No pending requests'))}</div>`;
    return;
  }
  const c = list[0];
  const sel = ccGetSel(c.id);
  const meta = ccMeta(c);
  const ico = appIconImg(agentIconUrl(c.agent || 'Claude Code'), 16, 4, fa('asterisk'));
  const waiting = list.length > 1 ? _t('{n} waiting', { n: list.length }) : (meta.via || _t('waiting'));

  let bodyHtml = '';
  let footHtml = '';
  if (c.kind === 'question') {
    const qs = c.questions || [];
    const q = qs[sel.step] || { q: '', o: [] };
    const opts = q.o || [];
    const picked = sel.picks[sel.step] || [];
    const txt = sel.texts[sel.step] || '';
    const headerTag = q.header || q.h;
    bodyHtml = `<div class="hitl-card-q">${headerTag ? `<span class="cc-tag" dir="auto">${esc(headerTag)}</span>` : ''}<span class="t1" dir="auto">${esc(q.q || '')}</span></div>`;
    if (c.answer && opts.length) {
      footHtml = `<div class="hitl-card-opts ${opts.length === 1 ? 'one' : ''}">`
        + opts.slice(0, 2).map((o, k) => `<button type="button" class="hitl-card-opt ${q.m ? 'multi' : ''} ${picked.includes(o.l) ? 'on' : ''}" data-cc="pick" data-q="${sel.step}" data-o="${k}" data-label="${esc(o.l)}"><span class="cc-mark"></span><span class="t1" dir="auto">${esc(o.l)}</span></button>`).join('')
        + `</div>`;
    } else if (c.answer && ccCanType(c, q)) {
      footHtml = `<label class="cc-other hitl-card-other">${CC_PEN}<input type="text" data-cc-input="${sel.step}" dir="auto" value="${esc(txt)}" placeholder="${esc(q.placeholder || _t('Type your answer…'))}"><kbd>↵</kbd></label>`;
    } else {
      footHtml = `<div class="hitl-card-opts"><button type="button" class="cc-btn ghost" style="height:26px" data-cc="close">${esc(_t('Close'))}</button><button type="button" class="cc-btn pri" style="height:26px" data-cc="open">${esc(meta.isPaseo ? _t('Open in Paseo') : _t('Open'))}</button></div>`;
    }
  } else if (c.kind === 'done') {
    bodyHtml = `<div class="t1 sub" style="margin-top:4px;font-size:11.5px" dir="auto">${esc(c.text || _t('Done'))}</div>`;
    footHtml = `<div class="hitl-card-opts"><button type="button" class="cc-btn ghost" style="height:26px" data-cc="close">${esc(_t('Close'))}</button><button type="button" class="cc-btn pri" style="height:26px" data-cc="open">${esc(meta.isPaseo ? _t('Open in Paseo') : _t('Open'))}</button></div>`;
  } else {
    bodyHtml = `<div class="cc-cmd hitl-card-cmd"><b>${esc(c.tool || '')}</b>${c.detail ? `<span dir="auto">${esc(c.detail)}</span>` : ''}</div>`;
    footHtml = c.answer
      ? `<div class="hitl-card-opts"><button type="button" class="cc-btn deny" style="height:26px" data-cc="deny">${esc(_t('Deny'))}</button><button type="button" class="cc-btn pri" style="height:26px" data-cc="allow">${esc(_t('Allow'))}</button></div>`
      : `<div class="hitl-card-opts"><button type="button" class="cc-btn ghost" style="height:26px" data-cc="close">${esc(_t('Close'))}</button><button type="button" class="cc-btn pri" style="height:26px" data-cc="open">${esc(meta.isPaseo ? _t('Open in Paseo') : _t('Open'))}</button></div>`;
  }

  // Keep input focus if user is already typing inside this dashboard card
  const focused = el.querySelector('[data-cc-input]') === document.activeElement;
  if (focused && el.dataset.ccId === c.id) return;
  el.dataset.ccId = c.id;
  el.style.setProperty('--tint', '#d97757');
  el.innerHTML = `<div class="hd">${ico}<span class="t1">${esc(meta.heading)}</span><em class="r t1" style="color:var(--amber);max-width:44%">${esc(waiting)}</em></div>`
    + bodyHtml + footHtml;
  ccWireContainer(el, c);
  N.cardClick(el, (e) => {
    if (e && e.target && e.target.closest('[data-cc], [data-cc-input], .cc-other')) return;
    N.openModule('hitl');
  });
}

function fmtIn(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return _t('in {n}m', { n: m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? _t('in {h}h {m}m', { h, m: rem }) : _t('in {h}h', { h });
}

function renderHitlSection() {
  const page = $('#page-hitl');
  if (!page) return;
  const list = st.claude || [];
  if (!list.length) {
    delete page.dataset.sig;
    page.innerHTML = `<div class="c" style="flex:1;justify-content:center;align-items:center;gap:8px;text-align:center">`
      + `<span style="color:var(--dim)">${N.ic ? N.ic('shield', 'width:24px;height:24px') : ''}</span>`
      + `<span class="sub">${esc(_t('No pending requests'))}</span></div>`;
    return;
  }
  const c = list[0];
  const sel = ccGetSel(c.id);
  const iconUrl = agentIconUrl(c.agent || 'Claude Code');
  const sig = JSON.stringify([c.id, c.kind, c.answer, (c.questions || []).length, list.length, list.slice(1).map((x) => x.id), !!iconUrl]);
  if (sig === page.dataset.sig) {
    ccSyncContainer(page, c, sel);
    return;
  }
  page.dataset.sig = sig;
  const waiting = _t('{n} waiting', { n: list.length - 1 });
  const queueHtml = list.length > 1
    ? `<div class="c sc-y" style="padding:10px 12px;gap:6px"><div class="hd"><span style="color:var(--amber)">${esc(waiting)}</span></div>`
      + list.slice(1).map((item) => {
        const im = ccMeta(item);
        return `<div class="row" style="gap:8px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,0.035)">`
          + `${appIconImg(agentIconUrl(item.agent || 'Claude Code'), 18, 4, fa('asterisk'))}`
          + `<div style="flex:1;min-width:0"><div class="t1" style="font-size:12px;font-weight:600">${esc(im.heading)}</div>`
          + `<div class="sub t1" style="font-size:10.5px">${esc(item.detail || im.via || '')}</div></div></div>`;
      }).join('')
      + `</div>`
    : '';

  page.innerHTML = `<div style="display:grid;grid-template-columns:${list.length > 1 ? 'minmax(0,1fr) 168px' : '1fr'};grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
    + `${ccCard(c, sel, iconUrl)}`
    + `${queueHtml}</div>`;
  ccWireContainer(page, c);
}

function mountHitlCard(el) {
  hitlCards.add(el);
  paintHitlCard(el);
}

function refreshHitlCards() {
  for (const el of hitlCards) {
    if (!el.isConnected) { hitlCards.delete(el); continue; }
    paintHitlCard(el);
  }
  renderHitlSection();
}

BUILTIN.home.card = (el) => { homeCards.add(el); paintHomeCard(el); };
BUILTIN.home.refreshCards = refreshHomeCards;
BUILTIN.shelf.card = (el) => { shelfCards.add(el); paintShelfCard(el); };
BUILTIN.shelf.refreshCards = refreshShelfCards;
BUILTIN.stats.card = (el) => { statsCards.add(el); paintStatsCard(el); };
BUILTIN.stats.refreshCards = refreshStatsCards;

// Dev-only shell switcher (mounted ONLY when SYMPONY_SHELL_DEV=1)
let shellDevBar = null;
function setDevShell(patch) {
  if (patch === null) {
    st.devShell = null;
  } else {
    st.devShell = { win: isWinShell(), form: shellFormOf(), reserveTop: reserveTopOf(), fg: fgStateOf(), ...(st.devShell || {}), ...patch };
  }
  renderClosed(true);
  layout();
}
function syncShellDevBar() {
  if (!shellDevBar) return;
  const win = isWinShell();
  const form = shellFormOf();
  const rtop = reserveTopOf();
  const fg = fgStateOf();
  const formKey = form === 'notch' && rtop ? 'space' : form;
  $$('[data-sd-os]', shellDevBar).forEach((b) => b.classList.toggle('on', (b.dataset.sdOs === 'win') === win));
  $$('[data-sd-form]', shellDevBar).forEach((b) => b.classList.toggle('on', b.dataset.sdForm === formKey));
  $$('[data-sd-fg]', shellDevBar).forEach((b) => b.classList.toggle('on', b.dataset.sdFg === fg));
  const badge = $('.sd-state', shellDevBar);
  if (badge) badge.textContent = st.shell || 'pill';
}
function mountShellDevBar() {
  if (!window.SYMPONY_SHELL_DEV || shellDevBar) return;
  const bar = document.createElement('div');
  bar.id = 'shellDevBar';
  bar.innerHTML = `<span class="sd-seg"><button type="button" data-sd-os="mac">Mac</button><button type="button" data-sd-os="win">Win</button></span>`
    + `<span class="sd-seg"><button type="button" data-sd-form="notch">Notch</button><button type="button" data-sd-form="space">Space</button><button type="button" data-sd-form="island">Island</button><button type="button" data-sd-form="drawer">Drawer</button><button type="button" data-sd-form="hidden">Hidden</button></span>`
    + `<span class="sd-seg"><button type="button" data-sd-fg="normal">Norm</button><button type="button" data-sd-fg="max">Max</button><button type="button" data-sd-fg="full">Full</button></span>`
    + `<button type="button" data-sd-act="toggle">Toggle</button><span class="sd-state">pill</span>`;
  document.body.appendChild(bar);
  shellDevBar = bar;
  $$('[data-sd-os]', bar).forEach((b) => { b.onclick = () => setDevShell({ win: b.dataset.sdOs === 'win' }); });
  $$('[data-sd-form]', bar).forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.sdForm;
      if (v === 'space') setDevShell({ form: 'notch', reserveTop: true });
      else setDevShell({ form: v, reserveTop: false });
    };
  });
  $$('[data-sd-fg]', bar).forEach((b) => { b.onclick = () => setDevShell({ fg: b.dataset.sdFg }); });
  $('[data-sd-act="toggle"]', bar).onclick = () => handleToggle();
  syncShellDevBar();
}

// Shared: how far through the waking day we are (wake/bed times from Settings → Day Progress).
function dayInfo(now = Date.now()) {
  const s = st.settings || {};
  const at = (hhmm) => {
    const [h, m] = (hhmm || '00:00').split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  };
  const wake = at(s.wakeTime || '07:00');
  let bed = at(s.bedTime || '23:00');
  if (bed <= wake) bed += 86400000;
  const frac = Math.max(0, Math.min(1, (now - wake) / (bed - wake)));
  return { wake, bed, frac, left: Math.max(0, bed - now) };
}

// Shared helpers for module files.
window.N = {
  MAC, LINUX, st, api, $, $$, esc, fmt, fmtIn, dur, bytes, hm, dayInfo, later, cancel, register, openNotch, closeNotch, tuck, untuck, setTab, toast, bump, layout, effectiveSizes, chime: (kind) => chime(kind, true),
  openEvent, startOfDay, DAY, cmd, mediaPosition, appLabel, progressRing, fa, prayerTimes, nextPrayer,
  meter, meterLevel, ring, appIconImg, agentIconUrl, mountHitlCard, refreshHitlCards, renderHitlSection,
  ccCard, ccGetSel, ccWireContainer, ccSyncContainer, addPonyAsk, removePonyAsk, setFeedSum, revealFeedSummary,
  pony: {
    mood: currentPonyMood,
    sync: () => { renderClosed(); layout(); },
    showPeek: showPonyPeek,
    hidePeek: hidePonyPeek,
    peekShown: () => ponyPeekShown,
    peekHandle: () => ponyPeekHandle,
  },
  handleToggle, devShell: { set: setDevShell, reset: () => setDevShell(null) },
  ensurePage, callModule, enabledTabs, moduleOf, moduleEnabled, drawStats, renderMusic, renderCalendar, renderShelfSection, renderHomeSection, homeNeedsTall, renderStatsSection, stopMirror, endTyping, isTall, syncArrows, arrowsBusy, notifBellOn,
  focusField(el) { beginTyping(); setTimeout(() => el.focus(), 30); },
  async boot() {
    paintIcons();
    applySettings(await api.getSettings());
    // Legacy usage counter stays off; updateCheck & autoUpdate are active for the dual-channel updater.
    { const s = st.settings; if (s.usageCount) api.setSettings({ usageCount: false }); }
    // Listen for dual-channel update state (Stable vs Beta dot badge on Settings button + 1-time subtle notch toast)
    const onUpdateState = (u) => {
      if (!u || typeof u !== 'object') return;
      st.update = u;
      const btn = $('#btnSettings');
      const avail = u.availableVersion && (u.status === 'available' || u.status === 'ready' || u.status === 'downloading');
      const dismissed = u.dismissedVersion && u.dismissedVersion === u.availableVersion;
      const showDot = !!(avail && (!dismissed || u.status === 'ready' || u.status === 'downloading'));
      const isBeta = u.availableChannel === 'beta';
      if (btn) {
        btn.classList.toggle('has-update', showDot);
        btn.classList.toggle('update-beta', showDot && isBeta);
        btn.classList.toggle('update-stable', showDot && !isBeta);
        btn.title = showDot
          ? (isBeta
            ? _t('Beta update available: v{v}', { v: u.availableVersion })
            : _t('Update available: v{v}', { v: u.availableVersion }))
          : _t('Settings');
      }
      if (avail && !dismissed && (u.status === 'available' || u.status === 'ready')) {
        const key = `${u.availableChannel || 'stable'}:${u.availableVersion}`;
        let seen = '';
        try { seen = localStorage.getItem('sympony.updateNotified') || ''; } catch (e) { /* ignore */ }
        if (seen !== key || u.preview) {
          try { if (!u.preview) localStorage.setItem('sympony.updateNotified', key); } catch (e) { /* ignore */ }
          if (isBeta) {
            toast(fa('flask'), _t('Sympony v{v} Beta available', { v: u.availableVersion }), {
              ms: 5500, color: '#f59e0b', glow: '#f59e0b', glowLoops: 2, side: 255, settings: 'about',
            });
          } else {
            toast(fa('arrow-down'), _t('Sympony v{v} available', { v: u.availableVersion }), {
              ms: 5500, color: '#38bdf8', glow: '#38bdf8', glowLoops: 2, side: 235, settings: 'about',
            });
          }
        }
      }
    };
    if (typeof api.onUpdate === 'function') api.onUpdate(onUpdateState);
    if (typeof api.updateState === 'function') api.updateState().then(onUpdateState).catch(() => {});
    // Stacked notifications (swipe one sideways to dismiss it) start out on, once: turning them off in Settings → Animations stays
    try { if (!localStorage.getItem('sympony.stackedOn')) { localStorage.setItem('sympony.stackedOn', '1'); if (!st.settings.fxNotifStack) api.setSettings({ fxNotifStack: true }); } } catch (e) { /* no storage: the setting decides */ }
    dropCatalog = await api.svc('actions', 'catalog');
    const state = await api.helperState();
    // the camera and the notch's place are also in it: their events can come before this page listens
    if ('display' in state) onDisplay(state.display);
    if ('camera' in state) onCamera(state.camera);
    if (state.anchor != null) { st.anchor = state.anchor; layout(); }
    if (state.volume) onVolume({ ...state.volume, initial: true });
    if (state.brightness) onBrightness({ ...state.brightness, initial: true });
    if (state.lockkeys) onLockKeys({ ...state.lockkeys, initial: true });
    if (state.inputlang) onInputLang({ ...state.inputlang, initial: true });
    if (state.power) onPower(state.power);
    if (state.bluetooth) onBluetooth(state.bluetooth);
    if (state.radios) st.radios = state.radios;
    if (state.prayer) st.prayer = state.prayer;
    if (state.mic) st.mic = state.mic;
    if (state.touchpad) st.touchpad = state.touchpad;
    if (state.theme) st.theme = state.theme;
    if (state.idle) {
      st.ponyIdleMs = Number(state.idle.idleMs) || 0;
      st.locked = !!state.idle.locked;
      syncPonyMood();
    }
    if (state.media && st.settings.mediaEnabled) onMedia(state.media);
    st.pomodoro = await api.svc('pomodoro', 'get');
    st.timer = await api.svc('timer', 'get').catch(() => null);
    await loadShelf();
    api.svc('notif', 'history').then((h) => { st.notifUnseen = h.unseen || 0; renderNotifBadge(); }).catch(() => {});
    api.requestCalendar();
    if (!window.N || !N.carousel || N.carousel.viewMode() !== 'modules') showPage(startTab(), true);
    mountShellDevBar();
    api.svc('cursor', 'ready');
    // One-shot safety notice after a backup import that turned off or cleared sensitive settings.
    const bk = st.settings && st.settings.backupImported;
    const disarmed = bk && !bk.notified
      ? (Array.isArray(bk.disarmed) ? bk.disarmed : bk.disarmed ? ['commands', 'hands', 'askAi', 'mcp', 'briefs'] : [])
      : [];
    if (disarmed.length) {
      api.setSettings({ backupImported: { ...bk, notified: true } });
      const labels = {
        commands: _t('Commands'),
        hands: _t('Hands'),
        askAi: _t('Ask AI'),
        mcp: _t('MCP'),
        briefs: _t('briefs'),
        phoneFolder: _t('phone folder'),
        brainUrl: _t('AI server URL'),
      };
      const items = disarmed.map((k) => labels[k]).filter(Boolean).join(', ');
      setTimeout(() => toast(fa('shield-halved'), _t('Backup imported · Reset for safety: {items}', { items }), { ms: 7500, color: 'var(--amber)', side: 280 }), 600);
    }
  },
};
