// Floating Pony Chat window host: provides the shared `window.N` runtime for `modules/chat.js`
// so the floating window shares the exact same Pony engine, Markdown, tools, history, and Glass/OLED themes.
(function () {
  const api = window.notch;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fa = (name, style = 'solid') => `<i class="fa-${style} fa-${name}"></i>`;
  // Crisp stroke SVG icons matching carousel.js (`N.ic(name, style)`)
  const SVG_PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.2 19.7l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  const ic = (name, style = '') => {
    const body = SVG_PATHS[name] || '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${style ? ` style="${style}"` : ''} aria-hidden="true">${body}</svg>`;
  };

  const MAC = window.SYMPONY_OS === 'macos' || /Mac/i.test(navigator.platform || '');
  const LINUX = window.SYMPONY_OS === 'linux' || /Linux/i.test(navigator.platform || '');
  const shellEl = $('#notch');
  const titleEl = $('#fcTitle');
  const modelEl = $('#fcModel');
  const dotEl = $('#fcDot');
  const newBtn = $('#fcNew');
  const histBtn = $('#fcHist');
  const pinBtn = $('#fcPin');
  const dockBtn = $('#fcDock');
  const settingsBtn = $('#fcSettings');
  const closeBtn = $('#fcClose');
  const toastEl = $('#fcToast');
  const dragEl = $('.fc-drag');

  const st = {
    open: true,
    settings: {},
    events: [],
    media: {},
    volume: null,
    mic: null,
    brightness: null,
    power: null,
    stats: null,
    pomodoro: null,
    prayer: null,
    radios: null,
    wired: false,
  };

  const timers = new Map();
  function later(key, ms, fn) {
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms));
  }
  function cancel(key) {
    if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); }
  }

  function hm(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    const h24 = (st.settings && st.settings.clock24) !== false;
    return d.toLocaleTimeString(typeof _tLocale === 'function' ? _tLocale() : undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !h24,
    });
  }

  let toastTimer = 0;
  function toast(iconHtml, text) {
    if (!toastEl) return;
    toastEl.innerHTML = `${iconHtml || ''}<span>${esc(text || '')}</span>`;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2100);
  }

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [28, 43, 77];
  }

  function applyLook(s) {
    const cfg = s || st.settings || {};
    const raw = cfg.notchLook;
    const look = raw === 'glass' || raw === 'color' ? raw : 'black';
    document.documentElement.dataset.look = look;
    shellEl.dataset.look = look;
    if (look === 'color') {
      const col = /^#[0-9a-f]{6}$/i.test(cfg.notchColor || '') ? cfg.notchColor.toLowerCase() : '#1c2b4d';
      const rgb = hexToRgb(col);
      const light = window.Tint && typeof Tint.darkInk === 'function'
        ? Tint.darkInk(rgb)
        : (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.65;
      shellEl.style.setProperty('--notch-color', col);
      shellEl.classList.toggle('look-light', light);
    } else {
      shellEl.style.removeProperty('--notch-color');
      shellEl.classList.remove('look-light');
    }
    if (window.Tint && typeof Tint.warm === 'function') {
      Tint.warm(!!cfg.warmNight, cfg.lat, cfg.lon);
    }
  }

  let chatMod = null;
  let pinned = true;

  function syncPinUi(on) {
    pinned = !!on;
    if (!pinBtn) return;
    pinBtn.classList.toggle('on', pinned);
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pinBtn.title = pinned ? _t('Unpin window') : _t('Always on top');
  }

  function syncChrome() {
    const s = st.settings || {};
    const name = s.ponyName || 'Pony';
    if (titleEl) titleEl.textContent = name;
    document.title = name;
    const prov = N.chat && N.chat.provider ? N.chat.provider() : null;
    if (modelEl) modelEl.textContent = (prov && prov.label) || '';
    const busy = !!(N.chat && N.chat.pending && N.chat.pending());
    const ready = !(prov && prov.ready === false);
    if (dotEl) {
      dotEl.classList.toggle('busy', busy);
      dotEl.classList.toggle('off', !busy && !ready);
    }
    if (newBtn && N.chat) {
      const inHist = N.chat.isHistory && N.chat.isHistory();
      const hasMsgs = N.chat.hasMessages && N.chat.hasMessages();
      newBtn.disabled = (!hasMsgs && !inHist) || busy;
    }
    if (histBtn && N.chat) {
      const inHist = !!(N.chat.isHistory && N.chat.isHistory());
      const hasHist = !!(N.chat.hasHistory && N.chat.hasHistory());
      histBtn.classList.toggle('on', inHist);
      histBtn.disabled = !hasHist && !inHist;
    }
    const mood = busy ? 'working' : ready ? 'idle' : 'sleep';
    window.dispatchEvent(new CustomEvent('pony:mood', { detail: mood }));
  }

  // ---- Lightweight interactive Pony ask_user card controller (reused by modules/chat.js)
  const CC_PEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1L5.8 12.4l-3 .8.8-3 7.7-7.5z"/></svg>';
  const ccSels = new Map();
  function ccGetSel(id) {
    if (!ccSels.has(id)) ccSels.set(id, { step: 0, picks: {}, texts: {} });
    return ccSels.get(id);
  }
  function ccCanType(c, q) { return !q || q.allowOther !== false; }
  function ccCanSendStep(c, sel, idx) {
    const q = (c.questions || [])[idx];
    if (!q) return false;
    if (q.allowEmpty) return true;
    return ((sel.picks[idx] || []).length > 0) || !!String(sel.texts[idx] || '').trim();
  }
  function ccCard(c, sel) {
    const qs = c.questions || [];
    const n = qs.length;
    const ico = window.Pony && window.Pony.snapshot
      ? `<img src="${window.Pony.snapshot({ shape: (st.settings && st.settings.ponyShape) || 'Classic', color: (st.settings && st.settings.ponyColor) || 'Lavender', mood: 'attention', size: 28 })}" alt="">`
      : fa('wand-magic-sparkles');
    const right = n > 1
      ? `<div class="cc-steps">${qs.map((_, i) => `<i class="${i === sel.step ? 'on' : ccCanSendStep(c, sel, i) ? 'done' : ''}"></i>`).join('')}<em>${sel.step + 1}/${n}</em></div>`
      : '';
    const pages = qs.map((q, i) => {
      const multi = !!q.m;
      const opts = q.o || [];
      const picked = sel.picks[i] || [];
      const txt = sel.texts[i] || '';
      const tag = q.header || q.h;
      const tagHtml = tag ? `<span class="cc-tag" dir="auto">${esc(tag)}</span>` : '';
      const hintHtml = multi ? `<div class="cc-hint">${esc(_t('You can pick more than one'))}</div>` : '';
      const optsHtml = opts.length
        ? `<div class="cc-opts ${opts.length === 1 ? 'one' : ''}">${opts.map((o, k) => `<button type="button" class="cc-opt ${picked.includes(o.l) ? 'on' : ''}" data-cc="pick" data-q="${i}" data-o="${k}" data-label="${esc(o.l)}"><span class="cc-mark"></span><span class="cc-ot" dir="auto"><b>${esc(o.l)}</b>${o.d ? `<span>${esc(o.d)}</span>` : ''}</span>${k < 9 ? `<span class="cc-key">${k + 1}</span>` : ''}</button>`).join('')}</div>`
        : '';
      let otherHtml = '';
      if (c.answer && ccCanType(c, q)) {
        otherHtml = opts.length
          ? `<label class="cc-other ${txt.trim() ? 'on' : ''}">${CC_PEN}<input type="text" data-cc-input="${i}" dir="auto" value="${esc(txt)}" placeholder="${esc(q.placeholder || _t('Type your own answer…'))}"><kbd>↵</kbd></label>`
          : `<label class="cc-other">${CC_PEN}<textarea data-cc-input="${i}" dir="auto" placeholder="${esc(q.placeholder || _t('Type your answer…'))}">${esc(txt)}</textarea></label>`;
      }
      return `<div class="cc-qpage ${multi ? 'multi' : ''} ${opts.length ? '' : 'big'}">${tagHtml}<div class="cc-q" dir="auto">${esc(q.q || '')}</div>${hintHtml}${optsHtml}${otherHtml}</div>`;
    }).join('');
    const last = sel.step >= n - 1;
    const midBtn = sel.step > 0
      ? `<button type="button" class="cc-btn sec" data-cc="back">${esc(_t('Back'))}</button>`
      : `<button type="button" class="cc-btn ghost" data-cc="skip">${esc(_t('Skip'))}</button>`;
    const goBtn = `<button type="button" class="cc-btn pri" data-cc="next"${ccCanSendStep(c, sel, sel.step) ? '' : ' disabled'}><span>${esc(last ? _t('Send') : _t('Continue|ask'))}</span><kbd>↵</kbd></button>`;
    return `<div class="cc-card" data-id="${esc(c.id)}">`
      + `<div class="cc-head"><span class="cc-ico">${ico}</span><div class="cc-who" dir="auto"><b>${esc(c.agent || (st.settings && st.settings.ponyName) || 'Pony')}</b></div>${right}</div>`
      + `<div class="cc-qwrap sc-y"><div class="cc-qtrack" style="transform:translateX(${-sel.step * 100}%)">${pages}</div></div>`
      + `<div class="cc-ft"><span class="cc-sp"></span>${midBtn}${goBtn}</div>`
      + `</div>`;
  }
  function ccSyncContainer(root, c, sel) {
    if (!root) return;
    const qs = c.questions || [];
    const track = $('.cc-qtrack', root);
    if (track) track.style.transform = `translateX(${-sel.step * 100}%)`;
    const stepsEl = $('.cc-steps', root);
    if (stepsEl) {
      $$('i', stepsEl).forEach((d, k) => { d.className = k === sel.step ? 'on' : ccCanSendStep(c, sel, k) ? 'done' : ''; });
      const em = $('em', stepsEl);
      if (em) em.textContent = `${sel.step + 1}/${qs.length}`;
    }
    $$('.cc-opt', root).forEach((b) => {
      const qi = Number(b.dataset.q);
      b.classList.toggle('on', (sel.picks[qi] || []).includes(b.dataset.label));
    });
    $$('[data-cc-input]', root).forEach((inp) => {
      const qi = Number(inp.dataset.ccInput);
      const val = sel.texts[qi] || '';
      if (document.activeElement !== inp && inp.value !== val) inp.value = val;
      const wrap = inp.closest('.cc-other');
      if (wrap && qs[qi] && (qs[qi].o || []).length > 0) wrap.classList.toggle('on', !!val.trim());
    });
    const midBtn = $('[data-cc="back"], [data-cc="skip"]', root);
    if (midBtn) {
      if (sel.step > 0) { midBtn.dataset.cc = 'back'; midBtn.className = 'cc-btn sec'; midBtn.textContent = _t('Back'); }
      else { midBtn.dataset.cc = 'skip'; midBtn.className = 'cc-btn ghost'; midBtn.textContent = _t('Skip'); }
    }
    const goBtn = $('[data-cc="next"]', root);
    if (goBtn) {
      goBtn.disabled = !ccCanSendStep(c, sel, sel.step);
      const sp = $('span', goBtn);
      if (sp) sp.textContent = sel.step >= qs.length - 1 ? _t('Send') : _t('Continue|ask');
    }
  }
  function ccSubmit(c, sel, skipped) {
    ccSels.delete(c.id);
    if (!N.chat || !N.chat.answerAsk) return;
    if (skipped) { N.chat.answerAsk(c.id, {}, true); return; }
    const answers = {};
    (c.questions || []).forEach((q, idx) => {
      const key = q.header || q.q || String(idx);
      const picks = sel.picks[idx] || [];
      const txt = String(sel.texts[idx] || '').trim();
      answers[key] = [...picks, ...(txt ? [txt] : [])].join(', ');
    });
    N.chat.answerAsk(c.id, answers, false);
  }
  function ccWireContainer(root, c) {
    const sel = ccGetSel(c.id);
    $$('[data-cc]', root).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const act = b.dataset.cc;
        if (act === 'pick') {
          const qi = Number(b.dataset.q);
          const q = (c.questions || [])[qi];
          const lbl = b.dataset.label;
          if (!q) return;
          const cur = sel.picks[qi] || [];
          if (q.m) sel.picks[qi] = cur.includes(lbl) ? cur.filter((x) => x !== lbl) : [...cur, lbl];
          else { sel.picks[qi] = [lbl]; sel.texts[qi] = ''; }
          ccSyncContainer(root, c, sel);
        } else if (act === 'back') {
          sel.step = Math.max(0, sel.step - 1);
          ccSyncContainer(root, c, sel);
        } else if (act === 'skip') {
          ccSubmit(c, sel, true);
        } else if (act === 'next') {
          if (!ccCanSendStep(c, sel, sel.step)) return;
          if (sel.step < (c.questions || []).length - 1) {
            sel.step += 1;
            ccSyncContainer(root, c, sel);
          } else {
            ccSubmit(c, sel, false);
          }
        }
      };
    });
    $$('[data-cc-input]', root).forEach((inp) => {
      inp.oninput = () => {
        const qi = Number(inp.dataset.ccInput);
        const q = (c.questions || [])[qi];
        sel.texts[qi] = inp.value;
        if (inp.value.trim() && q && !q.m) sel.picks[qi] = [];
        ccSyncContainer(root, c, sel);
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          const goBtn = $('[data-cc="next"]', root);
          if (goBtn && !goBtn.disabled) goBtn.click();
        }
      };
    });
  }

  function focusChatInput() {
    const inp = $('#chIn');
    if (inp) setTimeout(() => inp.focus(), 40);
  }

  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    st.settings = s;
    applyLook(s);
    if (chatMod && chatMod.onSettings) chatMod.onSettings(s);
    syncChrome();
  }

  function applyHelper(h) {
    if (!h || typeof h !== 'object') return;
    if (h.media) st.media = h.media;
    if (h.volume) st.volume = h.volume;
    if (h.mic) st.mic = h.mic;
    if (h.brightness) st.brightness = h.brightness;
    if (h.power) st.power = h.power;
    if (h.radios) st.radios = h.radios;
    if (h.prayer) st.prayer = h.prayer;
  }

  const swText = (ms, tenths = true) => {
    const t = Math.max(0, Math.floor(ms / 100));
    const s = Math.floor(t / 10);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const base = h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    return tenths ? `${base}.${t % 10}` : base;
  };

  window.MODULE_TITLES = {
    home: _t('Home'),
    todo: _t('Todo'),
    notes: _t('Notes'),
    pomodoro: _t('Pomodoro'),
    calendar: _t('Calendar'),
    weather: _t('Weather'),
    prayer: _t('Prayer Times'),
    bookmarks: _t('Bookmarks'),
    control: _t('Control'),
    chat: _t('Pony'),
  };

  window.N = {
    isFloatingChat: true,
    MAC,
    LINUX,
    api,
    st,
    $,
    $$,
    esc,
    fa,
    ic,
    hm,
    swText,
    later,
    cancel,
    toast,
    focusField(el) { if (el) setTimeout(() => el.focus(), 20); },
    openNotch() { if (api.openFloatingChat) api.openFloatingChat(); },
    closeNotch() { if (api.closeFloatingChat) api.closeFloatingChat(); },
    openModule(id) { if (api.openNotchModule) api.openNotchModule(id || 'chat'); },
    cardClick() {},
    register(mod) {
      if (mod && mod.id === 'chat') chatMod = mod;
    },
    ccCard,
    ccGetSel,
    ccSyncContainer,
    ccWireContainer,
    addPonyAsk() {},
    removePonyAsk(id) { ccSels.delete(id); },
    pony: {
      mood: () => (N.chat && N.chat.pending && N.chat.pending() ? 'working' : 'idle'),
      sync: syncChrome,
    },
    async bootFloatingChat() {
      if (newBtn) {
        newBtn.innerHTML = fa('plus');
        newBtn.title = _t('New chat (this one stays in History)');
        newBtn.onclick = () => {
          if (N.chat && N.chat.newChat) N.chat.newChat();
          focusChatInput();
        };
      }
      if (histBtn) {
        histBtn.innerHTML = fa('clock-rotate-left');
        histBtn.title = _t('History');
        histBtn.onclick = () => {
          if (N.chat && N.chat.toggleHistory) N.chat.toggleHistory();
        };
      }
      if (pinBtn) pinBtn.innerHTML = fa('thumbtack');
      if (dockBtn) {
        dockBtn.innerHTML = fa('arrow-up-from-bracket');
        dockBtn.title = _t('Dock back to notch');
      }
      if (settingsBtn) {
        settingsBtn.innerHTML = fa('gear');
        settingsBtn.title = _t('Settings');
      }
      if (closeBtn) {
        closeBtn.innerHTML = fa('xmark');
        closeBtn.title = _t('Close');
      }

      if (dragEl) {
        dragEl.addEventListener('mousedown', (e) => {
          if (e.button === 0 && api.startDragging) api.startDragging();
        });
      }
      if (pinBtn) {
        pinBtn.onclick = async () => {
          const next = !pinned;
          syncPinUi(next);
          if (api.setFloatingChatPin) await api.setFloatingChatPin(next).catch(() => {});
        };
      }
      if (dockBtn) {
        dockBtn.onclick = () => { if (api.dockFloatingChat) api.dockFloatingChat(); };
      }
      if (settingsBtn) {
        settingsBtn.onclick = () => api.openSettings('ai');
      }
      if (closeBtn) {
        closeBtn.onclick = () => { if (api.closeFloatingChat) api.closeFloatingChat(); };
      }

      window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
          e.preventDefault();
          if (api.closeFloatingChat) api.closeFloatingChat();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          if (N.chat && N.chat.newChat) N.chat.newChat();
          focusChatInput();
        } else if (e.key === 'Escape') {
          const inp = $('#chIn');
          if (!inp || document.activeElement !== inp || !inp.value) {
            if (api.closeFloatingChat) api.closeFloatingChat();
          }
        }
      });

      const [settings, helper, fstate] = await Promise.all([
        api.getSettings().catch(() => ({})),
        api.helperState().catch(() => ({})),
        api.floatingChatState ? api.floatingChatState().catch(() => ({ pinned: true })) : Promise.resolve({ pinned: true }),
      ]);
      applySettings(settings);
      applyHelper(helper);
      syncPinUi(fstate ? fstate.pinned !== false : true);
      if (N.loadData) N.loadData().catch(() => {});
      if (N.loadAgents) N.loadAgents().then(syncChrome).catch(() => {});
      if (api.requestCalendar) api.requestCalendar().catch(() => {});

      const pageEl = $('#page-chat');
      if (chatMod && pageEl) {
        chatMod.init(pageEl);
        if (chatMod.show) chatMod.show();
      }
      if (N.chat && N.chat.onChange) N.chat.onChange(syncChrome);
      syncChrome();
      focusChatInput();

      api.onSettings(applySettings);
      api.onHelper(applyHelper);
      api.onCalendar((evs) => { if (Array.isArray(evs)) st.events = evs; });
      api.onStats((s) => { if (s) st.stats = s; });
      if (api.onFloatingChatState) {
        api.onFloatingChatState((s) => { if (s && typeof s.pinned === 'boolean') syncPinUi(s.pinned); });
      }
      if (api.onFloatingChatFocus) {
        api.onFloatingChatFocus(focusChatInput);
      }
      if (api.onFileDrag) {
        api.onFileDrag(({ type, paths }) => {
          if (chatMod && chatMod.takeFiles) chatMod.takeFiles(type, paths);
        });
      }
      if (api.on) {
        api.on('voice:command', (d) => {
          if (!d || !d.steer || !N.chat || !N.chat.pending || !N.chat.pending()) return;
          if (d.stop) {
            if (N.chat.stop) N.chat.stop();
            toast(fa('stop'), _t('Stopped'));
            return;
          }
          const txt = d.text ? String(d.text).trim() : '';
          if (txt && N.chat.steer) {
            N.chat.steer(txt, { alreadySent: !!d.steeredSession, session: d.steeredSession || '' });
          }
        });
      }
      window.addEventListener('focus', focusChatInput);
    },
  };
})();
