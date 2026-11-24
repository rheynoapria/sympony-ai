/* global NotchKit, MODULE_ICONS, MODULE_TITLES, _t, _tLocale, fa */
'use strict';

// Open notch shell (v3): 272 px open notch (40 top + 218 stage + 14 bottom), sideways slide-only transitions
// (one module = one page default, optional 4×2 dashboard), and a separate floating 40 px menu notch (#pill)
// below the main notch revealed on bottom-edge hover, keyboard focus, or 1–9 / ← / → navigation.
(function () {
  const N = window.N;
  if (!N) return;
  const { $, $$, esc, hm, st, api, ring, meter } = N;
  const notchEl = $('#notch');
  const openEl = $('#open');
  const viewEl = $('#view');
  const trackEl = $('#track');
  const secEl = $('#sec');
  const pillEl = $('#pill');
  const hotzoneEl = $('#hotzone');
  const dockEl = $('#dock');
  const dockTipEl = $('#dockTip');
  const prevBtn = $('#prev');
  const nextBtn = $('#next');
  const backBtn = $('#btnBack');
  const hideBtn = $('#btnHide');
  const collapseBtn = $('#btnCollapse');
  const settingsBtn = $('#btnSettings');
  const topMetaEl = $('#topMeta');
  const topSecTitleEl = $('#topSecTitle');
  const topTitleEl = $('#topTitle');
  const topBarsEl = $('#topBars');
  const pageVault = $('#pageVault');
  const specialStage = $('#specialStage');

  // Crisp stroke SVG icon paths
  const P = {
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    pip: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    todo: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    shelf: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l1.41 1.41"/>',
    cloudsun: '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l1.41 1.41M15.95 12.66A4 4 0 0 0 8.05 11.34"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    day: '<path d="M3 12h4M17 12h4M12 3v4M12 17v4"/><circle cx="12" cy="12" r="3"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    hour: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    bt: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
    lang: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
    git: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    tele: '<path d="M2 6h20v12H2z"/><path d="M6 10h12M6 14h8"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M19 20 9 12l10-8z" fill="currentColor"/><path d="M5 19V5"/>',
    next: '<path d="m5 4 10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lyrics: '<path d="M3 6h18M3 12h12M3 18h7"/>',
    shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.45-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.97a4 4 0 0 1 3.3 1.7l5.45 8.6a4 4 0 0 0 3.3 1.7H22"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
    moonz: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    cup: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>',
    vol: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    volMute: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="m22 9-6 6M16 9l6 6"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    micOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    pods: '<path d="M7 4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3v6"/><path d="M17 4a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3v6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    cam: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.2 19.7l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };

  const MOD_SVG = {
    home: 'music',
    prayer: 'moon',
    calendar: 'cal',
    chat: 'chat',
    todo: 'todo',
    notes: 'note',
    control: 'sliders',
    shelf: 'shelf',
    pomodoro: 'timer',
    weather: 'cloudsun',
    health: 'heart',
    dayprogress: 'day',
    aiusage: 'gauge',
    screentime: 'hour',
    stats: 'cpu',
    bluetooth: 'bt',
    translate: 'lang',
    github: 'git',
    feed: 'rss',
    radio: 'radio',
    bookmarks: 'star',
    worldclock: 'globe',
    teleprompter: 'tele',
    notifs: 'bell',
    launcher: 'rocket',
    hitl: 'shield',
  };

  function ic(name, style = '') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${style ? ` style="${style}"` : ''} aria-hidden="true">${P[name] || ''}</svg>`;
  }

  function modIcon(id, style = '') {
    return ic(MOD_SVG[id] || 'sliders', style);
  }

  function hd(icon, name, right = '', color = '') {
    const ico = String(icon || '').startsWith('<') ? icon : ic(icon);
    return `<div class="hd"${color ? ` style="color:${color}"` : ''}>${ico}<span>${esc(name)}</span>${right ? `<em class="r">${esc(right)}</em>` : ''}</div>`;
  }

  function modLabel(id) {
    if (id === 'home') return _t('Music');
    if (id === 'hitl') return _t('Agent approvals');
    if (id === 'prayer') return _t('Prayer');
    if (id === 'chat') return (window.Pony && window.Pony.look ? window.Pony.look(st.settings).name : _t('Pony'));
    if (id === 'bluetooth' && (N.LINUX || N.MAC)) return _t('Bluetooth');
    return (window.MODULE_TITLES && window.MODULE_TITLES[id]) || _t(id);
  }

  // Paint static chrome icons
  prevBtn.innerHTML = ic('left');
  nextBtn.innerHTML = ic('right');
  backBtn.innerHTML = ic('left', 'width:15px;height:15px');
  if (hideBtn) hideBtn.innerHTML = ic('eyeOff');
  collapseBtn.innerHTML = ic('up');
  settingsBtn.innerHTML = ic('gear');

  // ------------------------------------------------------------ Real macOS app icon cache
  const APP_BUNDLES = {
    spotify: 'com.spotify.client',
    chrome: 'com.google.Chrome',
    vscode: 'com.microsoft.VSCode',
    code: 'com.microsoft.VSCode',
    figma: 'com.figma.Desktop',
    notion: 'notion.id',
    slack: 'com.tinyspeck.slackmacgap',
    claude: 'com.anthropic.claudefordesktop',
    codex: 'com.openai.codex',
    telegram: 'ru.keepcoder.Telegram',
    discord: 'com.hnc.Discord',
    mail: 'com.apple.mail',
    calendar: 'com.apple.iCal',
    zoom: 'us.zoom.xos',
    music: 'com.apple.Music',
    podcasts: 'com.apple.podcasts',
    whatsapp: 'net.whatsapp.WhatsApp',
    safari: 'com.apple.Safari',
    terminal: 'com.apple.Terminal',
    finder: 'com.apple.finder',
    arc: 'company.thebrowser.Browser',
    firefox: 'org.mozilla.firefox',
    edge: 'com.microsoft.edgemac',
    teams: 'com.microsoft.teams2',
  };

  const appIconCache = new Map();
  const appIconWaiters = new Set();

  function bundleForAppName(nameOrBundle) {
    const raw = String(nameOrBundle || '').trim();
    if (!raw) return null;
    if (raw.includes('.') && !raw.includes(' ')) return raw;
    const low = raw.toLowerCase();
    if (APP_BUNDLES[low]) return APP_BUNDLES[low];
    for (const [k, bid] of Object.entries(APP_BUNDLES)) {
      if (low.includes(k)) return bid;
    }
    return null;
  }

  function resolveAppIcon(bundleId, altBundleId, onReady) {
    if (!bundleId) return null;
    if (appIconCache.has(bundleId)) return appIconCache.get(bundleId);
    appIconCache.set(bundleId, null);
    if (onReady) appIconWaiters.add(onReady);
    if (api.appIcon) {
      api.appIcon(bundleId).then((url) => {
        if (url) {
          appIconCache.set(bundleId, url);
          notifyAppIcons();
          return;
        }
        if (altBundleId && !appIconCache.has(altBundleId)) {
          return api.appIcon(altBundleId).then((altUrl) => {
            if (altUrl) {
              appIconCache.set(bundleId, altUrl);
              notifyAppIcons();
            }
          });
        }
      }).catch(() => {});
    }
    return null;
  }

  function notifyAppIcons() {
    for (const fn of [...appIconWaiters]) {
      try { fn(); } catch { /* ignore */ }
    }
    if (N.carousel && N.carousel.onOpen) {
      // Refresh visible cards cleanly
      N.later('appIconRefresh', 60, () => {
        refreshVisible();
      });
    }
  }

  function realAppIcon(keyOrBundle, size = 18, fallbackFa = '') {
    const bid = bundleForAppName(keyOrBundle);
    const url = bid ? resolveAppIcon(bid) : null;
    const r = Math.round(size * 0.22);
    if (url) {
      return `<img class="appic" src="${esc(url)}" style="width:${size}px;height:${size}px;border-radius:${r}px" alt="">`;
    }
    const fb = fallbackFa || fa('cube');
    return `<span class="appic-fb" style="width:${size}px;height:${size}px;border-radius:${r}px;font-size:${Math.max(9, Math.round(size * 0.5))}px">${fb}</span>`;
  }

  function eventSourceInfo(ev) {
    const raw = String((ev && (ev.link || ev.location)) || '').toLowerCase();
    if (/zoom\.us|zoomgov\.com/.test(raw)) return { bundle: 'us.zoom.xos', name: 'Zoom', fb: fa('video') };
    if (/slack\.com/.test(raw)) return { bundle: 'com.tinyspeck.slackmacgap', name: 'Slack', fb: fa('hashtag') };
    if (/meet\.google\.com/.test(raw)) return { bundle: 'com.google.Chrome', alt: 'com.apple.Safari', name: 'Google Meet', fb: fa('video') };
    if (/teams\.(microsoft|live)\.com/.test(raw)) return { bundle: 'com.microsoft.teams2', alt: 'com.apple.Safari', name: 'Teams', fb: fa('video') };
    if (/webex\.com/.test(raw)) return { bundle: 'com.cisco.webexmeetingsapp', alt: 'com.apple.Safari', name: 'Webex', fb: fa('video') };
    if (/^https?:\/\//.test(raw)) return { bundle: 'com.apple.Safari', alt: 'com.google.Chrome', name: (ev && ev.calendar) || _t('Link'), fb: fa('video') };
    return { bundle: 'com.apple.iCal', name: (ev && ev.calendar) || _t('Calendar'), fb: fa('calendar-days') };
  }

  function eventAppIcon(ev, size = 22, radius) {
    const info = eventSourceInfo(ev);
    const url = resolveAppIcon(info.bundle, info.alt);
    return N.appIconImg(url, size, radius == null ? Math.round(size * 0.22) : radius, info.fb);
  }

  // ------------------------------------------------------------ Carousel & Section state
  const cs = {
    view: 'modules', // 'modules' (1 section per page) | 'dashboard' (4×2 card grid + #sec)
    pages: [],       // dashboard: [{ cards }], modules: [{ id, cards }]
    modIds: [],      // ordered module ids in 'modules' view
    idx: 0,
    sw: 632,
    activeMod: null, // active module id in 'modules' view
    lastMod: null,   // remembered in memory for the session
    fullMod: null,   // active #sec overlay module id (dashboard mode, or disabled-module fallback)
    special: null,   // 'drop' | 'snap' | null
    closeTimer: null,
    pillShown: false,
    pillHideTimer: null,
    pillFlashTimer: null,
    pillOver: false,
    pillFocus: false,
    drag: null,
    swallowClickUntil: 0,
    wAcc: 0,
    wLock: 0,
  };

  function isModulesView() {
    return !st.settings || st.settings.notchView !== 'dashboard';
  }

  const tabMemory = {
    on() { try { return localStorage.getItem('sympony.restoreTab') !== '0'; } catch { return true; } },
    get() { try { return localStorage.getItem('sympony.lastPage'); } catch { return null; } },
    set(v) { try { localStorage.setItem('sympony.lastPage', String(v)); } catch { /* ignore */ } },
  };

  function currentPage() { return cs.pages[cs.idx] || cs.pages[0] || { cards: [] }; }

  function enabledModulesList() {
    return N.enabledTabs();
  }

  function dockModules() {
    if (cs.view === 'modules') return cs.modIds.slice();
    const hitl = !!(st.claude && st.claude.length);
    const ordered = window.NotchKit
      ? NotchKit.sectionOrder(enabledModulesList(), { hitl })
      : enabledModulesList();
    return ordered.filter((id) => id === 'hitl' || !!N.moduleOf(id));
  }

  function hideDockTip() {
    if (dockTipEl) dockTipEl.hidden = true;
  }

  function showDockTip(btn, label) {
    if (!dockTipEl || !btn || !label || !cs.pillShown) return;
    dockTipEl.textContent = label;
    dockTipEl.hidden = false;
    const br = btn.getBoundingClientRect();
    const pr = pillEl ? pillEl.getBoundingClientRect() : br;
    const tw = dockTipEl.offsetWidth || 60;
    const th = dockTipEl.offsetHeight || 22;
    const vw = window.innerWidth || 820;
    const vh = window.innerHeight || 420;
    const cx = br.left + br.width / 2;
    const clampedX = Math.max(8 + tw / 2, Math.min(vw - 8 - tw / 2, cx));
    const belowY = Math.round(pr.bottom + 6);
    const aboveY = Math.round(pr.top - th - 6);
    const topY = (belowY + th <= vh - 6) ? belowY : Math.max(6, aboveY);
    dockTipEl.style.left = `${clampedX.toFixed(1)}px`;
    dockTipEl.style.top = `${topY}px`;
  }

  function showPill() {
    if (!pillEl || !st.open || cs.special) return;
    if (cs.pillHideTimer) { clearTimeout(cs.pillHideTimer); cs.pillHideTimer = null; }
    if (cs.pillFlashTimer) { clearTimeout(cs.pillFlashTimer); cs.pillFlashTimer = null; }
    const was = cs.pillShown;
    cs.pillShown = true;
    pillEl.classList.add('show');
    pillEl.setAttribute('aria-hidden', 'false');
    if (!was && N.layout) N.layout();
  }

  function hidePillNow(skipLayout) {
    if (cs.pillHideTimer) { clearTimeout(cs.pillHideTimer); cs.pillHideTimer = null; }
    if (cs.pillFlashTimer) { clearTimeout(cs.pillFlashTimer); cs.pillFlashTimer = null; }
    const was = cs.pillShown;
    cs.pillShown = false;
    cs.pillOver = false;
    hideDockTip();
    if (pillEl) {
      pillEl.classList.remove('show');
      pillEl.setAttribute('aria-hidden', 'true');
    }
    if (was && !skipLayout && N.layout) N.layout();
  }

  function scheduleHidePill(ms = 280) {
    if (cs.pillOver || cs.pillFocus) return;
    if (cs.pillHideTimer) clearTimeout(cs.pillHideTimer);
    cs.pillHideTimer = setTimeout(() => {
      cs.pillHideTimer = null;
      if (!cs.pillOver && !cs.pillFocus && !cs.pillFlashTimer) hidePillNow();
    }, ms);
  }

  function flashPill(ms = 1200) {
    if (!pillEl || !st.open || cs.special) return;
    if (cs.pillHideTimer) { clearTimeout(cs.pillHideTimer); cs.pillHideTimer = null; }
    if (cs.pillFlashTimer) { clearTimeout(cs.pillFlashTimer); cs.pillFlashTimer = null; }
    const was = cs.pillShown;
    cs.pillShown = true;
    pillEl.classList.add('show');
    pillEl.setAttribute('aria-hidden', 'false');
    if (!was && N.layout) N.layout();
    cs.pillFlashTimer = setTimeout(() => {
      cs.pillFlashTimer = null;
      if (!cs.pillOver && !cs.pillFocus) hidePillNow();
    }, ms);
  }

  function uniformOpenHeight(s) {
    const raw = Number((s || st.settings || {}).expandedHeightTall);
    return Number.isFinite(raw) && raw >= 116 ? Math.min(320, raw) : 268;
  }

  function frameForModule(modId, maxW, maxH) {
    const s = st.settings || {};
    const expW = Number(s.expandedWidth) || 660;
    const defH = uniformOpenHeight(s);
    const capW = Number.isFinite(maxW) ? maxW : 780;
    const capH = Number.isFinite(maxH) ? maxH : 340;
    if (!modId || !window.StyleLib || !window.NotchKit || !NotchKit.resolveModuleFrame) {
      const h = Math.min(capH, defH);
      return { styleId: 'bento', surface: 'oled', width: Math.min(expW, capW), height: h, stageH: Math.max(96, h - 54) };
    }
    return NotchKit.resolveModuleFrame({
      styleDef: StyleLib.styleDefFor(s, modId),
      pref: StyleLib.prefFor(s, modId),
      expandedWidth: expW,
      defaultHeight: defH,
      maxW: capW,
      maxH: capH,
    });
  }

  function applyPageStyleAttrs(pageEl, modId) {
    if (!pageEl || !modId) return;
    const f = frameForModule(modId, 780, 340);
    pageEl.dataset.modStyle = f.styleId;
    pageEl.dataset.modSurface = f.surface;
  }

  function syncAllPageStyleAttrs() {
    $$('.tab-page', openEl).forEach((el) => {
      const id = el.id && el.id.startsWith('page-') ? el.id.slice(5) : '';
      if (id && !['drop', 'snap'].includes(id)) applyPageStyleAttrs(el, id);
    });
  }

  function hydrateSection(modId) {
    const pageEl = $('#page-' + modId);
    if (pageEl) applyPageStyleAttrs(pageEl, modId);
    if (modId === 'home') { N.renderMusic(true); N.renderCalendar(); if (N.renderHomeSection) N.renderHomeSection(); }
    else if (modId === 'shelf' && N.renderShelfSection) N.renderShelfSection();
    else if (modId === 'stats') N.drawStats();
    else if (modId === 'hitl' && N.renderHitlSection) N.renderHitlSection();
  }

  function returnAllPagesToVault() {
    $$('.tab-page', trackEl).forEach((el) => {
      const id = el.id && el.id.startsWith('page-') ? el.id.slice(5) : '';
      if (id && !['drop', 'snap'].includes(id)) {
        el.classList.remove('active');
        pageVault.appendChild(el);
      }
    });
    $$('.tab-page', secEl).forEach((el) => {
      const id = el.id && el.id.startsWith('page-') ? el.id.slice(5) : '';
      if (id && !['drop', 'snap'].includes(id)) {
        el.classList.remove('active');
        pageVault.appendChild(el);
      }
    });
  }

  function cardClick(el, fn) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const run = (e) => {
      if (Date.now() < cs.swallowClickUntil) return;
      if (e && e.target && e.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
      fn(e);
    };
    el.onclick = run;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(e); } };
  }

  function renderGenericCard(el, modId) {
    const title = modLabel(modId);
    el.innerHTML = `${hd(MOD_SVG[modId] || 'sliders', title)}<div class="sub" style="margin-top:auto">${esc(_t('Open'))}</div>`;
    cardClick(el, () => openModule(modId));
  }

  function mountCardSlot(pageEl, card, n) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.id = card.id;
    slot.style.gridColumn = `${card.x + 1} / span ${card.w}`;
    slot.style.gridRow = `${card.y + 1} / span ${card.h}`;
    slot.style.setProperty('--i', String(n));

    const el = document.createElement('div');
    el.className = card.id === 'home' ? 'c bare' : 'c';
    el.dataset.mod = card.id;
    slot.appendChild(el);
    pageEl.appendChild(slot);

    if (card.id === 'hitl') {
      if (typeof N.mountHitlCard === 'function') N.mountHitlCard(el);
      else renderGenericCard(el, 'hitl');
      return;
    }

    const mod = N.moduleOf(card.id);
    const size = card.w === 4 ? 'xl' : (card.w === 2 && card.h === 2) ? 'l' : (card.w === 2 || card.h === 2) ? 'm' : 's';
    if (mod && typeof mod.card === 'function') {
      try {
        mod.card(el, size);
        return;
      } catch (e) {
        console.error('card', card.id, e);
      }
    }
    renderGenericCard(el, card.id);
  }

  function returnPageToVault(modId, onlyInside) {
    if (!modId || ['drop', 'snap'].includes(modId)) return;
    const pageEl = $('#page-' + modId);
    if (!pageEl) return;
    if (onlyInside && !onlyInside.contains(pageEl)) return;
    if (pageEl.parentNode !== pageVault) {
      pageEl.classList.remove('active');
      pageVault.appendChild(pageEl);
    }
  }

  function rebuild() {
    if (!st.settings || !window.NotchKit) return;
    const prevIdx = cs.idx;
    const prevFull = cs.fullMod;
    const prevView = cs.view;
    const hadHitl = cs.modIds.includes('hitl');
    if (cs.closeTimer) { clearTimeout(cs.closeTimer); cs.closeTimer = null; }
    hideDockTip();
    returnAllPagesToVault();
    secEl.innerHTML = '';
    cs.fullMod = null;
    cs.activeMod = null;
    notchEl.classList.remove('in-sec');
    openEl.classList.remove('in-sec', 'full-view');

    cs.view = isModulesView() ? 'modules' : 'dashboard';
    notchEl.classList.toggle('view-modules', cs.view === 'modules');
    openEl.classList.toggle('view-modules', cs.view === 'modules');

    const hitl = !!(st.claude && st.claude.length);
    const ids = enabledModulesList();

    if (cs.view === 'modules') {
      cs.modIds = NotchKit.sectionOrder(ids, { hitl });
      if (!cs.modIds.length) cs.modIds = ['home'];
      cs.pages = cs.modIds.map((id) => ({ id, cards: [{ id, x: 0, y: 0, w: 4, h: 2 }] }));

      const single = cs.pages.length <= 1;
      openEl.classList.toggle('single-page', single);

      trackEl.innerHTML = '';
      cs.modIds.forEach((modId, k) => {
        const section = document.createElement('section');
        section.className = 'page mod-page';
        section.dataset.k = String(k);
        section.dataset.mod = modId;
        const pageEl = N.ensurePage(modId);
        if (pageEl) {
          pageEl.classList.add('active');
          section.appendChild(pageEl);
        }
        trackEl.appendChild(section);
        if (pageEl) hydrateSection(modId);
      });

      const onlyPonyHitl = hitl && st.claude.every((c) => c.source === 'pony');
      let targetId = null;
      if (hitl && !hadHitl && !(onlyPonyHitl && st.open && (st.page === 'chat' || cs.lastMod === 'chat'))) targetId = 'hitl';
      else if (prevFull && cs.modIds.includes(prevFull)) targetId = prevFull;
      else if (cs.lastMod && cs.modIds.includes(cs.lastMod)) targetId = cs.lastMod;
      else targetId = cs.modIds[0];

      const nextIdx = Math.max(0, cs.modIds.indexOf(targetId));
      renderDock();
      go(nextIdx, { instant: true, silent: true });
      if (st.open) {
        const cur = cs.modIds[cs.idx];
        if (cur) N.callModule(cur, 'show');
      }
      return;
    }

    cs.modIds = [];
    const customSizes = window.StyleLib ? StyleLib.gridSizesMap(st.settings) : null;
    cs.pages = NotchKit.packCards(ids, { hitl, sizes: customSizes });
    if (!cs.pages.length) cs.pages = [{ cards: [{ id: 'home', x: 0, y: 0, w: 4, h: 2 }] }];

    const single = cs.pages.length <= 1;
    openEl.classList.toggle('single-page', single);

    trackEl.innerHTML = '';
    cs.pages.forEach((pg, k) => {
      const section = document.createElement('section');
      section.className = 'page';
      section.dataset.k = String(k);
      pg.cards.forEach((c, n) => mountCardSlot(section, c, n));
      trackEl.appendChild(section);
    });

    let nextIdx = prevView === 'dashboard' ? prevIdx : 0;
    if (nextIdx < 0 || nextIdx >= cs.pages.length) {
      const remembered = tabMemory.on() ? tabMemory.get() : null;
      const savedIdx = remembered != null && /^\d+$/.test(remembered) ? Number(remembered) : -1;
      if (savedIdx >= 0 && savedIdx < cs.pages.length) {
        nextIdx = savedIdx;
      } else {
        const defMod = st.settings.defaultTab || 'home';
        const found = cs.pages.findIndex((pg) => pg.cards.some((c) => c.id === defMod));
        nextIdx = found >= 0 ? found : 0;
      }
    }
    go(Math.max(0, Math.min(cs.pages.length - 1, nextIdx)), { instant: true, silent: true });
    renderDock();

    if (prevFull && (N.moduleEnabled(prevFull) || prevFull === 'notifs' || prevFull === 'home')) {
      openModule(prevFull, { silent: true });
    }
  }

  function renderDock() {
    const ids = dockModules();
    const active = cs.fullMod || (cs.view === 'modules' ? cs.modIds[cs.idx] : null);
    if (cs.fullMod && !ids.includes(cs.fullMod) && N.moduleOf(cs.fullMod)) ids.push(cs.fullMod);
    dockEl.innerHTML = ids.map((id) => `<button type="button" data-id="${esc(id)}" class="${active === id ? 'on' : ''}" aria-label="${esc(modLabel(id))}">${modIcon(id)}</button>`).join('');
    $$('button', dockEl).forEach((b) => {
      const id = b.dataset.id;
      const lbl = modLabel(id);
      b.onclick = (e) => {
        hideDockTip();
        if (e && e.detail > 0) b.blur();
        openModule(id);
      };
      b.onmouseenter = () => showDockTip(b, lbl);
      b.onfocus = () => { if (cs.pillFocus) showDockTip(b, lbl); };
      b.onmouseleave = hideDockTip;
      b.onblur = hideDockTip;
    });
    const activeBtn = $('button.on', dockEl);
    if (activeBtn && activeBtn.scrollIntoView) {
      try { activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
    }
    if (cs.pillShown && N.layout) N.layout();
  }
  dockEl.addEventListener('scroll', hideDockTip, { passive: true });

  function syncMusicWaves() {
    const isMusic = cs.fullMod
      ? cs.fullMod === 'home'
      : cs.view === 'modules'
        ? cs.modIds[cs.idx] === 'home'
        : !!(currentPage().cards && currentPage().cards.some((c) => c.id === 'home'));
    notchEl.classList.toggle('on-home', isMusic);
    notchEl.classList.toggle('on-music', isMusic);
    if (window.Waves && isMusic) window.Waves.wake();
  }

  function closeFull(silent) {
    if (!cs.fullMod) return;
    const modId = cs.fullMod;
    if (st.typing) N.endTyping();
    if (!silent) N.callModule(modId, 'hide');
    if (modId === 'home') N.stopMirror();

    cs.fullMod = null;
    notchEl.classList.remove('in-sec');
    openEl.classList.remove('in-sec', 'full-view');
    st.page = 'page-' + cs.idx;
    st.tab = String(cs.idx);

    const cleanup = () => {
      cs.closeTimer = null;
      if (cs.fullMod) return;
      [...secEl.children].forEach((sl) => {
        const m = sl.dataset.mod;
        if (m) returnPageToVault(m, sl);
        sl.remove();
      });
    };
    if (cs.closeTimer) clearTimeout(cs.closeTimer);
    if (silent) cleanup();
    else cs.closeTimer = setTimeout(cleanup, 520);

    syncMusicWaves();
    renderTop();
    renderDock();
    refreshVisible();
    if (!silent) N.layout();
    if (N.syncArrows) N.syncArrows();
  }

  function openModule(moduleId, opts = {}) {
    if (!moduleId) return;
    if (moduleId === 'drop' || moduleId === 'snap') { setSpecial(moduleId); return; }
    setSpecial(null, true);
    if (cs.view === 'modules') {
      const idx = cs.modIds.indexOf(moduleId);
      if (idx >= 0) {
        go(idx, { instant: !!opts.silent, silent: !!opts.silent });
        return;
      }
    }
    if (cs.closeTimer) { clearTimeout(cs.closeTimer); cs.closeTimer = null; }

    const prevMod = cs.fullMod;
    if (prevMod === moduleId && secEl.querySelector(`.sl[data-mod="${CSS.escape(moduleId)}"]`)) {
      renderTop();
      renderDock();
      return;
    }

    if (prevMod && prevMod !== moduleId) {
      if (st.typing) N.endTyping();
      if (!opts.silent) N.callModule(prevMod, 'hide');
      if (prevMod === 'home') N.stopMirror();
    }

    const pageEl = N.ensurePage(moduleId);
    if (!pageEl) return;
    applyPageStyleAttrs(pageEl, moduleId);

    const order = dockModules();
    const prevIdx = prevMod ? order.indexOf(prevMod) : -1;
    const nextIdx = order.indexOf(moduleId);
    const slideOn = !st.settings || st.settings.fxTabSlide !== false;
    const dir = (prevMod && prevMod !== moduleId && !opts.silent && slideOn)
      ? (nextIdx >= prevIdx ? 1 : -1)
      : 0;

    const layer = document.createElement('div');
    layer.className = 'sl';
    layer.dataset.mod = moduleId;
    layer.appendChild(pageEl);
    pageEl.classList.add('active');

    const oldLayers = [...secEl.children];
    if (dir) {
      layer.style.transition = 'none';
      layer.style.transform = `translateX(${dir * 100}%)`;
      secEl.appendChild(layer);
      void layer.offsetWidth;
      layer.style.transition = '';
      layer.style.transform = '';
      oldLayers.forEach((o) => {
        const oldMod = o.dataset.mod;
        o.style.transform = `translateX(${-dir * 100}%)`;
        setTimeout(() => {
          if (oldMod && oldMod !== cs.fullMod) returnPageToVault(oldMod, o);
          o.remove();
        }, 520);
      });
    } else {
      oldLayers.forEach((o) => {
        const oldMod = o.dataset.mod;
        if (oldMod && oldMod !== moduleId) returnPageToVault(oldMod, o);
        o.remove();
      });
      secEl.appendChild(layer);
    }

    cs.fullMod = moduleId;
    st.page = moduleId;
    notchEl.classList.add('in-sec');
    openEl.classList.add('in-sec', 'full-view');

    syncMusicWaves();
    renderTop();
    renderDock();
    if (moduleId === 'home') { N.renderMusic(true); N.renderCalendar(); if (N.renderHomeSection) N.renderHomeSection(); }
    if (moduleId === 'shelf' && N.renderShelfSection) N.renderShelfSection();
    if (moduleId === 'stats') N.drawStats();
    if (!opts.silent && st.open) N.callModule(moduleId, 'show');
    if (!opts.silent) N.layout();
    if (N.syncArrows) N.syncArrows();
  }

  function setSpecial(id, silent) {
    if (id === cs.special) return;
    if (id && cs.fullMod) closeFull(true);
    cs.special = id || null;
    notchEl.classList.toggle('special-mode', !!cs.special);
    openEl.classList.toggle('special-mode', !!cs.special);
    if (cs.special) hidePillNow(true);
    $$('.tab-page', specialStage).forEach((p) => p.classList.toggle('active', !!cs.special && p.id === 'page-' + cs.special));
    if (cs.special) {
      st.page = cs.special;
    } else {
      st.page = cs.fullMod || ('page-' + cs.idx);
    }
    renderTop();
    if (!silent) N.layout();
    if (N.syncArrows) N.syncArrows();
  }

  function go(k, opts = {}) {
    if (!cs.pages.length) return;
    k = Math.max(0, Math.min(cs.pages.length - 1, k));
    if (cs.special) setSpecial(null, true);
    if (cs.fullMod) closeFull(true);
    hideDockTip();

    if (cs.view === 'modules') {
      const prevMod = cs.activeMod;
      const nextMod = cs.modIds[k] || cs.modIds[0];
      if (prevMod && prevMod !== nextMod) {
        if (st.typing) N.endTyping();
        if (!opts.silent) N.callModule(prevMod, 'hide');
        if (prevMod === 'home') N.stopMirror();
      }
      cs.idx = k;
      cs.activeMod = nextMod;
      if (nextMod && nextMod !== 'hitl') cs.lastMod = nextMod;
      st.tab = nextMod;
      st.page = nextMod;

      const instant = !!opts.instant || (st.settings && st.settings.fxTabSlide === false);
      if (instant) trackEl.classList.add('drag');
      trackEl.style.transform = `translate3d(${-k * cs.sw}px, 0, 0)`;
      if (instant) { void trackEl.offsetWidth; trackEl.classList.remove('drag'); }

      prevBtn.classList.toggle('end', k === 0 || cs.pages.length <= 1);
      nextBtn.classList.toggle('end', k === cs.pages.length - 1 || cs.pages.length <= 1);

      $$('button', dockEl).forEach((b) => b.classList.toggle('on', b.dataset.id === nextMod));
      const activeBtn = $('button.on', dockEl);
      if (activeBtn && activeBtn.scrollIntoView) {
        try { activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
      }

      syncMusicWaves();
      renderTop();
      hydrateSection(nextMod);
      if (st.open && !opts.silent) {
        N.callModule(nextMod, 'show');
        if (nextMod === 'aiusage') api.svc('aiusage', 'watch', true).catch(() => {});
      }
      if (!opts.silent) N.layout();
      if (N.syncArrows) N.syncArrows();
      return;
    }

    cs.idx = k;
    st.tab = String(k);
    st.page = 'page-' + k;
    if (!opts.silent) tabMemory.set(k);

    const instant = !!opts.instant || (st.settings && st.settings.fxTabSlide === false);
    if (instant) trackEl.classList.add('drag');
    trackEl.style.transform = `translate3d(${-k * cs.sw}px, 0, 0)`;
    if (instant) { void trackEl.offsetWidth; trackEl.classList.remove('drag'); }

    prevBtn.classList.toggle('end', k === 0 || cs.pages.length <= 1);
    nextBtn.classList.toggle('end', k === cs.pages.length - 1 || cs.pages.length <= 1);

    syncMusicWaves();
    renderTop();
    refreshVisible();
    if (!opts.silent) N.layout();
    if (N.syncArrows) N.syncArrows();
  }

  function refreshVisible() {
    if (cs.fullMod) {
      hydrateSection(cs.fullMod);
      return;
    }
    if (cs.view === 'modules') {
      const cur = cs.modIds[cs.idx];
      if (cur) {
        hydrateSection(cur);
        if (st.open && cur === 'aiusage') api.svc('aiusage', 'watch', true).catch(() => {});
      }
      return;
    }
    const page = currentPage();
    if (!page || !page.cards) return;
    for (const c of page.cards) {
      if (c.id === 'hitl') {
        if (typeof N.refreshHitlCards === 'function') N.refreshHitlCards();
        continue;
      }
      const m = N.moduleOf(c.id);
      if (m && typeof m.refreshCards === 'function') {
        try { m.refreshCards(); } catch (e) { console.error('refreshCards', c.id, e); }
      }
    }
    if (st.open && page.cards.some((c) => c.id === 'aiusage')) {
      api.svc('aiusage', 'watch', true).catch(() => {});
    }
  }

  function goTo(pageOrModId, opts = {}) {
    if (pageOrModId == null) return;
    if (pageOrModId === 'drop' || pageOrModId === 'snap') { setSpecial(pageOrModId); return; }
    if (typeof pageOrModId === 'number' || /^\d+$/.test(String(pageOrModId))) {
      go(Number(pageOrModId), opts);
      return;
    }
    if (String(pageOrModId).startsWith('page-')) {
      const k = Number(String(pageOrModId).slice(5));
      if (!Number.isNaN(k)) { go(k, opts); return; }
    }
    if (cs.view === 'modules') {
      const idx = cs.modIds.indexOf(pageOrModId);
      if (idx >= 0) { go(idx, opts); return; }
    }
    const idx = cs.pages.findIndex((pg) => pg.cards.some((c) => c.id === pageOrModId));
    if (idx >= 0) go(idx, opts);
  }

  function step(dir) {
    if (!cs.pages.length) return;
    if (cs.fullMod) {
      const order = dockModules();
      const i = order.indexOf(cs.fullMod);
      if (i >= 0) {
        const next = i + dir;
        if (next >= 0 && next < order.length) openModule(order[next]);
      }
      return;
    }
    const next = cs.idx + dir;
    if (next < 0 || next >= cs.pages.length) return;
    go(next);
  }

  function syncWidth(openW) {
    const sw = Math.max(240, openW - 28);
    if (sw !== cs.sw) {
      cs.sw = sw;
      notchEl.style.setProperty('--sw', sw + 'px');
      trackEl.classList.add('drag');
      trackEl.style.transform = `translate3d(${-cs.idx * sw}px, 0, 0)`;
      void trackEl.offsetWidth;
      trackEl.classList.remove('drag');
    } else {
      notchEl.style.setProperty('--sw', sw + 'px');
    }
  }

  function activeStyledModule() {
    if (cs.special) return null;
    if (cs.fullMod) return cs.fullMod;
    if (cs.view === 'modules') return cs.modIds[cs.idx] || null;
    return null;
  }

  // Dynamic open width & height: follows the active module's Style & Size override (Dashboard grid stays 272 px).
  function width(maxW) {
    const s = st.settings || {};
    const expW = Number(s.expandedWidth) || 660;
    const modId = activeStyledModule();
    if (!modId) return Math.min(expW, maxW);
    return frameForModule(modId, maxW, 340).width;
  }

  function height(maxH) {
    const modId = activeStyledModule();
    if (!modId) return Math.min(maxH, uniformOpenHeight(st.settings));
    let h = frameForModule(modId, 780, maxH).height;
    if (modId === 'home' && N.homeNeedsTall && N.homeNeedsTall()) h = Math.max(h, 236);
    else if (modId === 'control' && N.controlNeedsTall && N.controlNeedsTall()) h = Math.max(h, 232);
    else if (modId === 'calendar' && N.calendarNeedsTall && N.calendarNeedsTall()) h = Math.max(h, 232);
    return Math.min(maxH, h);
  }

  function renderTop() {
    const inSec = !!cs.fullMod && !cs.special;
    backBtn.hidden = !inSec;
    topSecTitleEl.hidden = !inSec;
    topMetaEl.hidden = inSec;

    if (inSec) {
      const html = `${modIcon(cs.fullMod, 'width:14px;height:14px')}<span>${esc(modLabel(cs.fullMod))}</span>`;
      if (topSecTitleEl.innerHTML !== html) topSecTitleEl.innerHTML = html;
    } else {
      const now = new Date();
      const s = st.settings || {};
      const p = st.power;
      const batHtml = (p && p.hasBattery)
        ? ring(p.level, p.pluggedIn ? 'var(--emerald)' : meter(p.level, true), 16, 14)
        : '';
      const dateStr = now.toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
      const clockHtml = s.headerClock === false ? '' : `<span class="clk"><i>${esc(dateStr)}</i>${esc(hm(now))}</span>`;
      const curMod = cs.view === 'modules' && !cs.special ? cs.modIds[cs.idx] : null;
      const modHtml = curMod ? `<span class="top-mod">${modIcon(curMod)}<span>${esc(modLabel(curMod))}</span></span>` : '';
      const metaHtml = batHtml + clockHtml + modHtml;
      if (topMetaEl.innerHTML !== metaHtml) topMetaEl.innerHTML = metaHtml;
    }

    const m = st.media || {};
    const hasMedia = !!(m.active && (m.title || m.artist));
    topBarsEl.style.display = hasMedia ? '' : 'none';
    topBarsEl.classList.toggle('off', !m.playing);

    if (hideBtn) {
      const s = st.settings || {};
      const showHide = s.hideButton !== false && !s.autoHide && s.shellForm !== 'hidden' && s.shellForm !== 'drawer';
      hideBtn.hidden = !showHide;
    }

    let title = '';
    if (cs.special === 'drop') title = _t('Drop actions');
    else if (cs.special === 'snap') title = _t('Snap zones');
    if (topTitleEl.textContent !== title) topTitleEl.textContent = title;

    // Hide redundant top-bar activity chip when viewing that activity's own module
    const hf = $('#headerFloat');
    const activeMod = cs.fullMod || (cs.view === 'modules' && !cs.special ? cs.modIds[cs.idx] : null);
    if (hf && hf.classList.contains('show') && hf.dataset.mod && hf.dataset.mod === activeMod) {
      hf.classList.remove('show');
      delete hf.dataset.mod;
    }
  }

  // ------------------------------------------------------------ input: drag, wheel, arrows, top buttons
  prevBtn.onclick = () => step(-1);
  nextBtn.onclick = () => step(1);
  backBtn.onclick = () => closeFull();
  if (hideBtn) hideBtn.onclick = () => N.tuck();
  collapseBtn.onclick = () => N.closeNotch();
  settingsBtn.onclick = () => { api.openSettings(); N.closeNotch(); };
  topBarsEl.onclick = () => {
    if (cs.view === 'modules') { openModule('home'); return; }
    const idx = cs.pages.findIndex((pg) => pg.cards.some((c) => c.id === 'home'));
    if (idx >= 0) go(idx);
    else openModule('home');
  };

  viewEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || cs.fullMod || cs.special) return;
    if (e.target.closest('button, a, input, textarea, select, [contenteditable], .bar, .mc-sl-bar, .vsl, .hsl, .wk-strip, [data-mseek], [draggable=true]')) return;
    const scx = e.target.closest('.sc-x');
    if (scx && scx.scrollWidth > scx.clientWidth + 2) return;
    cs.drag = { x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    const d = cs.drag;
    if (!d || e.pointerId !== d.id) return;
    let dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { cs.drag = null; return; }
      d.on = true;
      try { viewEl.setPointerCapture(d.id); } catch { /* ignore */ }
      trackEl.classList.add('drag');
      viewEl.classList.add('drag');
      N.cancel('close');
    }
    if ((cs.idx === 0 && dx > 0) || (cs.idx === cs.pages.length - 1 && dx < 0)) dx /= 3;
    d.dx = dx;
    trackEl.style.transform = `translate3d(${-cs.idx * cs.sw + dx}px, 0, 0)`;
  });
  function endDrag(e) {
    const d = cs.drag;
    if (!d || (e && e.pointerId != null && e.pointerId !== d.id)) return;
    cs.drag = null;
    trackEl.classList.remove('drag');
    viewEl.classList.remove('drag');
    if (!d.on) return;
    cs.swallowClickUntil = Date.now() + 200;
    const commit = Math.abs(d.dx) > cs.sw * 0.16 && cs.pages.length > 1;
    go(commit ? cs.idx - Math.sign(d.dx) : cs.idx);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // Horizontal trackpad swipe between pages
  viewEl.addEventListener('wheel', (e) => {
    if (cs.special || cs.fullMod || cs.pages.length <= 1) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const scx = e.target.closest('.sc-x');
    if (scx && scx.scrollWidth > scx.clientWidth + 2) return;
    e.preventDefault();
    if (Date.now() < cs.wLock) return;
    cs.wAcc += e.deltaX;
    if (Math.abs(cs.wAcc) > 40) {
      step(Math.sign(cs.wAcc));
      cs.wAcc = 0;
      cs.wLock = Date.now() + 450;
    }
  }, { passive: false });

  // Menu notch (#pill) hover / focus reveal (bottom ~36 px of #notch, #hotzone, #pill; 280 ms hide delay)
  if (hotzoneEl) {
    hotzoneEl.addEventListener('mouseenter', () => { cs.pillOver = true; showPill(); });
    hotzoneEl.addEventListener('mouseleave', (e) => {
      if (pillEl && e.relatedTarget && pillEl.contains(e.relatedTarget)) return;
      cs.pillOver = false;
      scheduleHidePill(280);
    });
  }
  if (pillEl) {
    let pillPointerDown = false;
    pillEl.addEventListener('pointerdown', () => {
      pillPointerDown = true;
      setTimeout(() => { pillPointerDown = false; }, 0);
    }, { passive: true });
    pillEl.addEventListener('mouseenter', () => { cs.pillOver = true; showPill(); });
    pillEl.addEventListener('mouseleave', (e) => {
      if (hotzoneEl && e.relatedTarget && (e.relatedTarget === hotzoneEl || hotzoneEl.contains(e.relatedTarget))) return;
      cs.pillOver = false;
      scheduleHidePill(280);
    });
    pillEl.addEventListener('focusin', () => {
      if (pillPointerDown) return;
      cs.pillFocus = true;
      showPill();
    });
    pillEl.addEventListener('focusout', (e) => {
      if (!pillEl.contains(e.relatedTarget)) {
        cs.pillFocus = false;
        scheduleHidePill(280);
      }
    });
  }
  document.addEventListener('pointermove', (e) => {
    if (!st.open || cs.special || !pillEl) return;
    const nr = notchEl.getBoundingClientRect();
    const pr = pillEl.getBoundingClientRect();
    const above = pillEl.classList.contains('above');
    const inHot = e.clientX >= nr.left && e.clientX <= nr.right && (above
      ? (e.clientY >= nr.top - 10 && e.clientY <= nr.top + 36)
      : (e.clientY >= nr.bottom - 36 && e.clientY <= nr.bottom + 10));
    const inPill = cs.pillShown && e.clientX >= pr.left - 4 && e.clientX <= pr.right + 4
      && e.clientY >= pr.top - 4 && e.clientY <= pr.bottom + 4;
    if (inHot || inPill) {
      cs.pillOver = true;
      showPill();
    } else if (cs.pillOver) {
      cs.pillOver = false;
      scheduleHidePill(280);
    }
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => {
    cs.pillOver = false;
    scheduleHidePill(280);
  });

  setInterval(() => { if (st.open && !cs.fullMod) renderTop(); }, 1000);

  N.carousel = {
    go,
    goTo,
    step,
    current: () => cs.idx,
    pages: () => cs.pages,
    rebuild,
    closeFull,
    fullModule: () => cs.fullMod,
    activeModule: () => (cs.fullMod || (cs.view === 'modules' ? cs.modIds[cs.idx] || null : null)),
    viewMode: () => cs.view,
    width,
    height,
    syncWidth,
    syncStyleAttrs: syncAllPageStyleAttrs,
    renderTop,
    renderDock,
    hideDockTip,
    pillShown: () => !!cs.pillShown,
    pillEl: () => pillEl,
    hidePill: hidePillNow,
    scheduleHidePill: () => { cs.pillOver = false; scheduleHidePill(280); },
    flashPill,
    onOpen: refreshVisible,
    setSpecial,
    isSpecial: () => cs.special,
  };
  N.openModule = openModule;
  N.cardClick = cardClick;
  N.ic = ic;
  N.MOD_SVG = MOD_SVG;
  N.modIcon = modIcon;
  N.hd = hd;
  N.realAppIcon = realAppIcon;
  N.resolveAppIcon = resolveAppIcon;
  N.bundleForAppName = bundleForAppName;
  N.eventSourceInfo = eventSourceInfo;
  N.eventAppIcon = eventAppIcon;
})();
