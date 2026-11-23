// Control: 2×1 card (2×2 round toggles + 2 vertical sliders + output device tile) + responsive section
// (2×2 big toggle tiles | 2 tall vertical sliders with value on top | sound output list with BT battery +
// quick chips for dark mode, Night Shift, mic, plus sub-views for input devices & extra quick actions).
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let view = 'main'; // 'main' | 'sound' | 'more'
  let devs = { out: [], in: [] };
  let devsLoaded = false;
  let poll;
  let wifiNow = null;
  let dndOn = false;

  function split(name) {
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name || '');
    return m ? [m[1], m[2]] : [name || _t('Audio device'), ''];
  }
  function devIcon(name, input) {
    const n = (name || '').toLowerCase();
    if (input) return /camera|webcam/.test(n) ? 'video' : /headset|headphone|earbud|buds|airpods/.test(n) ? 'headset' : 'microphone';
    if (/headphone|headset|earbud|buds|airpods|earphone/.test(n)) return 'headphones';
    if (/display|monitor|hdmi|ultrawide|tv\b|\btv/.test(n)) return 'tv';
    return 'volume-high';
  }
  function devSvg(name) {
    const n = (name || '').toLowerCase();
    if (/airpods|headphone|headset|earbud|buds|beats|sony/.test(n)) return 'pods';
    if (/homepod|sonos|airplay/.test(n)) return 'radio';
    return 'vol';
  }
  function devBattery(name) {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    const hit = (st.bluetooth || []).find((d) => {
      if (!d || !d.connected || typeof d.battery !== 'number' || d.battery < 0) return false;
      const dn = String(d.name || '').trim().toLowerCase();
      return dn === target || target.includes(dn) || dn.includes(target);
    });
    return hit ? Math.round(hit.battery) : null;
  }

  const radio = (k) => st.radios && st.radios[k] === 'on';
  const statsLive = () => !!(st.stats && st.stats.at && Date.now() - st.stats.at < 10000);
  function loadWifi() {
    if (statsLive()) return;
    api.svc('stats', 'wifi').then((w) => {
      const changed = ((w && w.ssid) || '') !== ((wifiNow && wifiNow.ssid) || '');
      wifiNow = w;
      if (changed && !statsLive()) { renderSection(); refreshCards(); }
    }).catch(() => {});
  }
  function loadDnd() {
    const req = N.MAC
      ? api.svc('clock', 'quiet').then((q) => !!(q && q.dnd))
      : api.svc('notif', 'dnd').then((d) => !!(d && d.on));
    req.then((on) => {
      if (on !== dndOn) {
        dndOn = on;
        renderSection();
        refreshCards();
      }
    }).catch(() => {});
  }
  function toggleFocus() {
    if (N.MAC) {
      api.openExternal('x-apple.systempreferences:com.apple.Focus-Settings.extension');
      N.closeNotch();
      return;
    }
    const want = !dndOn;
    dndOn = want;
    renderSection();
    refreshCards();
    api.svc('notif', 'setDnd', want).catch(() => null).then(() => setTimeout(loadDnd, 350));
  }

  function wifiSub() {
    if (!radio('wifi')) return _t('Off');
    const w = statsLive() ? st.stats.wifi : wifiNow;
    return (w && w.ssid) || _t('On');
  }
  function btSub() {
    if (!radio('bluetooth')) return _t('Off');
    const on = (st.bluetooth || []).filter((d) => d.connected);
    return on.length ? (on.length > 1 ? `${on[0].name} +${on.length - 1}` : on[0].name) : _t('On');
  }

  const EXTRA_TILES = [
    { id: 'dark', icon: 'circle-half-stroke', label: () => _t('Dark mode'), on: () => !!(st.theme && st.theme.dark) },
    { id: 'mic', icon: () => (st.mic && st.mic.muted ? 'microphone-slash' : 'microphone'), label: () => (st.mic && st.mic.muted ? _t('Mic muted') : _t('Microphone')), on: () => !!(st.mic && st.mic.muted) },
    { id: 'eyeBreaks', icon: 'eye', label: () => _t('Eye breaks'), on: () => !!(st.settings && st.settings.healthEyeBreaks) },
    { id: 'screenshot', icon: 'crop-simple', label: () => _t('Screenshot'), on: () => false },
    { id: 'colorPick', icon: 'eye-dropper', label: () => _t('Color picker'), on: () => false, winOnly: true },
    { id: 'airplane', icon: 'plane', label: () => _t('Airplane mode'), on: () => !!(st.radios && st.radios.airplane === true), winOnly: true },
    { id: 'lock', icon: 'lock', label: () => _t('Lock'), on: () => false },
  ];

  // Vertical slider: bottom = 0, top = 1; draggable, scrollable (wheel), and keyboard accessible (arrows/Home/End).
  function bindVertSlider(el, initFrac, onVal) {
    if (!el || el.classList.contains('na')) return;
    let cur = Math.max(0, Math.min(1, Number(initFrac) || 0));
    let dragging = false;

    const apply = (f, commit = true) => {
      cur = Math.max(0, Math.min(1, f));
      const pct = Math.round(cur * 100);
      el.style.setProperty('--v', cur.toFixed(4));
      el.classList.toggle('low', cur < 0.22);
      el.classList.toggle('hi', cur >= 0.86);
      el.setAttribute('aria-valuenow', String(pct));
      const bEl = $('b', el);
      if (bEl) bEl.textContent = String(pct);
      if (commit) onVal(cur);
    };
    const fromPointer = (e) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (r.bottom - e.clientY) / Math.max(1, r.height)));
    };

    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      apply(fromPointer(e));
    };
    el.onpointermove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      apply(fromPointer(e));
    };
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('drag');
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    el.onpointerup = end;
    el.onpointercancel = end;
    el.onclick = (e) => e.stopPropagation();

    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY < 0 ? 0.04 : -0.04;
      apply(cur + step);
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = cur + 0.05;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = cur - 0.05;
      else if (e.key === 'PageUp') next = cur + 0.15;
      else if (e.key === 'PageDown') next = cur - 0.15;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 1;
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      apply(next);
    });
  }

  // Horizontal slider: left = 0, right = 1; draggable, scrollable (wheel), and keyboard accessible.
  function bindHorizSlider(el, initFrac, onVal) {
    if (!el || el.classList.contains('na')) return;
    let cur = Math.max(0, Math.min(1, Number(initFrac) || 0));
    let dragging = false;

    const apply = (f, commit = true) => {
      cur = Math.max(0, Math.min(1, f));
      const pct = Math.round(cur * 100);
      el.style.setProperty('--v', cur.toFixed(4));
      el.classList.toggle('low', cur < 0.18);
      el.classList.toggle('hi', cur >= 0.84);
      el.setAttribute('aria-valuenow', String(pct));
      const bEl = $('b', el);
      if (bEl) bEl.textContent = pct + '%';
      if (commit) onVal(cur);
    };
    const fromPointer = (e) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    };

    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      apply(fromPointer(e));
    };
    el.onpointermove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      apply(fromPointer(e));
    };
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('drag');
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    el.onpointerup = end;
    el.onpointercancel = end;
    el.onclick = (e) => e.stopPropagation();

    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) < 1 && Math.abs(e.deltaX) < 1) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
      apply(cur + (delta > 0 ? 0.04 : -0.04));
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + 0.05;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - 0.05;
      else if (e.key === 'PageUp') next = cur + 0.15;
      else if (e.key === 'PageDown') next = cur - 0.15;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 1;
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      apply(next);
    });
  }

  function setView(nextView) {
    if (view === nextView) return;
    view = nextView;
    renderSection();
    if (N.layout) N.layout();
  }

  async function loadDevices() {
    devsLoaded = true;
    const [out, inp] = await Promise.all([api.svc('audio', 'devices', false).catch(() => []), api.svc('audio', 'devices', true).catch(() => [])]);
    devs = { out: Array.isArray(out) ? out : [], in: Array.isArray(inp) ? inp : [] };
    renderSection();
    refreshCards();
  }

  function renderSound() {
    const mic = st.mic;
    const rowHtml = (list, input) => (list.length ? list.map((d) => {
      const [kind, what] = split(d.name);
      return `<button type="button" class="nrow${d.default ? ' on' : ''}" data-dev="${esc(d.id)}" style="flex-direction:row;align-items:center;gap:8px;padding:7px 9px;width:100%;text-align:start">`
        + `<span style="color:${d.default ? '#4ade80' : 'var(--dim)'}">${fa(devIcon(d.name, input))}</span>`
        + `<span class="t1" style="flex:1;font-size:12.5px"><b>${esc(kind)}</b>${what ? ` <span class="sub">${esc(what)}</span>` : ''}</span>`
        + `${d.default ? '<span style="color:#4ade80">✓</span>' : ''}</button>`;
    }).join('') : `<div class="sub" style="padding:10px">${esc(input ? _t('No microphone') : _t('No sound output'))}</div>`);

    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%">`
      + `<div class="row" style="justify-content:space-between;flex:none">`
      + `<button type="button" class="sbtn" id="ctlBack" style="height:26px">${N.ic('left', 'width:12px;height:12px')}${esc(_t('Control'))}</button>`
      + `<div class="row" style="gap:6px">`
      + (mic && mic.available ? `<button type="button" class="sbtn${mic.muted ? '' : ' p'}" id="ctlMic" style="height:26px">${fa(mic.muted ? 'microphone-slash' : 'microphone')} ${esc(mic.muted ? _t('Mic muted') : _t('Microphone'))}</button>` : '')
      + `</div></div>`
      + `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr);gap:10px;flex:1;min-height:0">`
      + `<div class="c sc-y" style="padding:10px;gap:2px">${N.hd('vol', _t('Sound output'))}<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">${rowHtml(devs.out, false)}</div></div>`
      + `<div class="c sc-y" style="padding:10px;gap:2px">${N.hd('sliders', _t('Microphone'))}<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">${rowHtml(devs.in, true)}</div></div>`
      + `</div></div>`;

    $('#ctlBack', page).onclick = () => setView('main');
    const mBtn = $('#ctlMic', page);
    if (mBtn) mBtn.onclick = () => api.helper({ cmd: 'mic.toggle' });
    $$('[data-dev]', page).forEach((b) => {
      b.onclick = async () => {
        await api.svc('audio', 'setDefault', b.dataset.dev).catch(() => false);
        setTimeout(loadDevices, 250);
      };
    });
  }

  function renderMore() {
    const shown = EXTRA_TILES.filter((t) => !t.winOnly || (!N.MAC && !N.LINUX));
    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%;min-height:0">`
      + `<div class="row" style="justify-content:space-between;flex:none">`
      + `<button type="button" class="sbtn" id="ctlBack" style="height:26px">${N.ic('left', 'width:12px;height:12px')}${esc(_t('Control'))}</button>`
      + `<span class="sub">${esc(_t('Quick actions'))}</span></div>`
      + `<div class="sc-y" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;flex:1;min-height:0;align-content:start">`
      + shown.map((t) => {
        const on = t.on();
        const icoName = typeof t.icon === 'function' ? t.icon() : t.icon;
        return `<button type="button" class="tg${on ? ' on' : ''}" data-tgl="${t.id}" style="--a:#4361ff;height:52px">`
          + `<span style="width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;background:${on ? '#4361ff' : 'var(--pill-hi)'};color:#fff">${fa(icoName)}</span>`
          + `<b class="t1" style="font-size:12px">${esc(t.label())}</b></button>`;
      }).join('')
      + `</div></div>`;
    $('#ctlBack', page).onclick = () => setView('main');
    $$('[data-tgl]', page).forEach((b) => {
      b.onclick = () => {
        // Windows' snip overlay freezes the screen as it is when it opens: the notch closes first (0.4 s)
        if (b.dataset.tgl === 'screenshot' && !N.MAC) {
          N.closeNotch();
          setTimeout(() => api.svc('system', 'toggle', 'screenshot'), 450);
          return;
        }
        api.svc('system', 'toggle', b.dataset.tgl).then(() => setTimeout(() => { renderSection(); refreshCards(); }, 350));
      };
    });
  }

  function renderSection() {
    if (!page) return;
    if (view === 'sound') { renderSound(); return; }
    if (view === 'more') { renderMore(); return; }
    // Don't tear down sliders mid-drag
    if ($('.vsl.drag, .hsl.drag', page)) return;
    const focusEl = document.activeElement && page.contains(document.activeElement)
      && (document.activeElement.classList.contains('vsl') || document.activeElement.classList.contains('hsl'))
      ? document.activeElement : null;
    const focusId = focusEl ? focusEl.id : '';

    const wifiOn = radio('wifi');
    const btOn = radio('bluetooth');
    const awakeOn = !!(st.settings && st.settings.keepAwake);
    const darkOn = !!(st.theme && st.theme.dark);
    const warmOn = !!(st.settings && st.settings.warmNight);
    const micMuted = !!(st.mic && st.mic.muted);

    const b = st.brightness;
    const briOk = !!(b && b.supported);
    const briPct = briOk ? Math.max(0, Math.min(100, Math.round(b.level || 0))) : 0;
    const briFrac = briPct / 100;
    const v = st.volume || { level: 50, muted: false };
    const volPct = v.muted ? 0 : Math.max(0, Math.min(100, Math.round(v.level || 0)));
    const volFrac = volPct / 100;

    const outs = Array.isArray(devs.out) ? devs.out : [];
    const curOut = outs.find((d) => d.default) || outs[0] || null;
    const curOutName = curOut ? split(curOut.name)[0] : _t('Sound output');
    const curOutBat = curOut ? devBattery(curOut.name) : null;
    const style = window.StyleLib ? StyleLib.styleIdFor(st.settings, 'control') : 'minimal';

    const bindCommonToggles = () => {
      $$('[data-tgl]', page).forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.tgl;
          if (id === 'focus') { toggleFocus(); return; }
          api.svc('system', 'toggle', id).then(() => setTimeout(() => { renderSection(); refreshCards(); }, 350));
        };
      });
      $$('[data-chip]', page).forEach((btn) => {
        btn.onclick = () => {
          const c = btn.dataset.chip;
          if (c === 'dark') api.svc('system', 'toggle', 'dark').then(() => setTimeout(() => { renderSection(); refreshCards(); }, 350));
          else if (c === 'warm') api.setSettings({ warmNight: !(st.settings && st.settings.warmNight) });
          else if (c === 'mic') api.helper({ cmd: 'mic.toggle' });
        };
      });
      const sndBtn = $('#ctlSoundBtn', page);
      if (sndBtn) sndBtn.onclick = () => { loadDevices(); setView('sound'); };
      const moreBtn = $('#ctlMoreBtn', page);
      if (moreBtn) moreBtn.onclick = () => setView('more');
      if (focusId) {
        const f = $('#' + focusId, page);
        if (f) f.focus({ preventScroll: true });
      }
    };

    if (style === 'minimal') {
      const icoToggles = [
        { attr: 'data-tgl="wifi"', ico: 'wifi', on: wifiOn, col: '#4361ff', tip: `Wi‑Fi · ${wifiSub()}` },
        { attr: 'data-tgl="bluetooth"', ico: 'bt', on: btOn, col: '#4361ff', tip: `Bluetooth · ${btSub()}` },
        { attr: 'data-tgl="focus"', ico: 'moonz', on: dndOn, col: '#8fa2ff', tip: `${_t('Focus')} · ${dndOn ? _t('On') : _t('Off')}` },
        { attr: 'data-tgl="keepAwake"', ico: 'cup', on: awakeOn, col: '#fbbf24', fg: '#000', tip: `${_t('Keep awake')} · ${awakeOn ? _t('On') : _t('Off')}` },
        { attr: 'data-chip="dark"', ico: 'contrast', on: darkOn, col: '#e4e4ec', fg: '#000', tip: `${_t('Dark mode')} · ${darkOn ? _t('On') : _t('Off')}` },
        { attr: 'data-chip="warm"', ico: 'sun', on: warmOn, col: '#fb923c', fg: '#000', tip: `${_t('Night Shift')} · ${warmOn ? _t('On') : _t('Off')}` },
        { attr: 'data-chip="mic"', ico: micMuted ? 'micOff' : 'mic', on: !micMuted, col: '#34d399', fg: '#000', tip: micMuted ? _t('Mic muted') : _t('Microphone') },
      ];
      const batTag = curOutBat != null
        ? `<span class="ctl-out-bat n" style="color:${N.meter(curOutBat, true)}">${curOutBat}%</span>`
        : '';
      page.innerHTML = `<div class="ctl-min-wrap sl-pane">`
        + `<div class="ctl-min-top">`
        + `<div class="ctl-min-togs">`
        + icoToggles.map((t) => `<button type="button" class="ctl-ico-btn${t.on ? ' on' : ''}" ${t.attr} title="${esc(t.tip)}" aria-label="${esc(t.tip)}" aria-pressed="${t.on}" style="${t.on ? `--a:${t.col};--afg:${t.fg || '#fff'}` : ''}">${N.ic(t.ico, 'width:15px;height:15px')}</button>`).join('')
        + `</div>`
        + `<div class="row" style="gap:6px;min-width:0;flex:none">`
        + `<button type="button" class="ctl-out-pill" id="ctlSoundBtn" title="${esc(_t('Sound output'))}">`
        + `${N.ic(curOut ? devSvg(curOut.name) : 'vol', 'width:13px;height:13px;flex:none')}`
        + `<span class="t1">${esc(curOutName)}</span>${batTag}`
        + `${N.ic('right', 'width:11px;height:11px;opacity:0.55;flex:none')}</button>`
        + `<button type="button" class="ctl-ico-btn" id="ctlMoreBtn" title="${esc(_t('Quick actions'))}" aria-label="${esc(_t('Quick actions'))}">${N.ic('sliders', 'width:14px;height:14px')}</button>`
        + `</div></div>`
        + `<div class="ctl-min-sliders">`
        + `<div class="hsl${briOk ? '' : ' na'}${briFrac < 0.18 ? ' low' : ''}${briFrac >= 0.84 ? ' hi' : ''}" id="ctlBriHsl" role="slider" tabindex="0" aria-label="${esc(_t('Brightness'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${briPct}" style="--v:${briFrac}">`
        + `<i></i><span>${N.ic('sun', 'width:15px;height:15px')}</span><b>${briOk ? briPct + '%' : '–'}</b></div>`
        + `<div class="hsl${volFrac < 0.18 ? ' low' : ''}${volFrac >= 0.84 ? ' hi' : ''}" id="ctlVolHsl" role="slider" tabindex="0" aria-label="${esc(_t('Volume'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}" style="--v:${volFrac}">`
        + `<i></i><span>${N.ic(v.muted || volPct === 0 ? 'volMute' : 'vol', 'width:15px;height:15px')}</span><b>${volPct}%</b></div>`
        + `</div></div>`;

      bindCommonToggles();
      bindHorizSlider($('#ctlBriHsl', page), briFrac, (f) => api.helper({ cmd: 'brightness.set', value: Math.round(f * 100) }));
      bindHorizSlider($('#ctlVolHsl', page), volFrac, (f) => api.helper({ cmd: 'volume.set', value: Math.round(f * 100) }));
      return;
    }

    if (style === 'compact') {
      const pills = [
        ['wifi', 'wifi', 'Wi‑Fi', wifiSub(), wifiOn ? '#4361ff' : '', '#fff'],
        ['bluetooth', 'bt', 'Bluetooth', btSub(), btOn ? '#4361ff' : '', '#fff'],
        ['focus', 'moonz', _t('Focus'), dndOn ? _t('On') : _t('Off'), dndOn ? '#8fa2ff' : '', '#fff'],
        ['keepAwake', 'cup', _t('Keep awake|short'), awakeOn ? _t('On') : _t('Off'), awakeOn ? '#fbbf24' : '', '#000'],
      ];
      const batTag = curOutBat != null
        ? `<span class="ctl-out-bat n" style="color:${N.meter(curOutBat, true)}">${curOutBat}%</span>`
        : '';
      page.innerHTML = `<div class="ctl-cmp-wrap sl-pane">`
        + `<div class="ctl-cmp-grid">`
        + pills.map(([id, ico, name, sub, col, fg]) => `<button type="button" class="ctl-cmp-pill${col ? ' on' : ''}" data-tgl="${id}" style="${col ? `--a:${col};--afg:${fg}` : ''}">`
          + `<span class="dot">${N.ic(ico, 'width:13px;height:13px')}</span>`
          + `<span style="min-width:0;flex:1"><b class="t1">${esc(name)}</b><small class="t1">${esc(sub)}</small></span></button>`).join('')
        + `</div>`
        + `<div class="ctl-cmp-right">`
        + `<div class="hsl sm${briOk ? '' : ' na'}${briFrac < 0.18 ? ' low' : ''}${briFrac >= 0.84 ? ' hi' : ''}" id="ctlBriHsl" role="slider" tabindex="0" aria-label="${esc(_t('Brightness'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${briPct}" style="--v:${briFrac}">`
        + `<i></i><span>${N.ic('sun', 'width:14px;height:14px')}</span><b>${briOk ? briPct + '%' : '–'}</b></div>`
        + `<div class="hsl sm${volFrac < 0.18 ? ' low' : ''}${volFrac >= 0.84 ? ' hi' : ''}" id="ctlVolHsl" role="slider" tabindex="0" aria-label="${esc(_t('Volume'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}" style="--v:${volFrac}">`
        + `<i></i><span>${N.ic(v.muted || volPct === 0 ? 'volMute' : 'vol', 'width:14px;height:14px')}</span><b>${volPct}%</b></div>`
        + `<div class="ctl-cmp-foot">`
        + `<button type="button" class="ctl-out-pill sm" id="ctlSoundBtn" title="${esc(_t('Sound output'))}">`
        + `${N.ic(curOut ? devSvg(curOut.name) : 'vol', 'width:13px;height:13px;flex:none')}`
        + `<span class="t1" style="flex:1;text-align:start">${esc(curOutName)}</span>${batTag}`
        + `${N.ic('right', 'width:11px;height:11px;opacity:0.55;flex:none')}</button>`
        + `<button type="button" class="ctl-ico-btn sm${darkOn ? ' on' : ''}" data-chip="dark" title="${esc(_t('Dark mode'))}" style="${darkOn ? '--a:#e4e4ec;--afg:#000' : ''}">${N.ic('contrast', 'width:13px;height:13px')}</button>`
        + `<button type="button" class="ctl-ico-btn sm${warmOn ? ' on' : ''}" data-chip="warm" title="${esc(_t('Night Shift'))}" style="${warmOn ? '--a:#fb923c;--afg:#000' : ''}">${N.ic('sun', 'width:13px;height:13px')}</button>`
        + `<button type="button" class="ctl-ico-btn sm${!micMuted ? ' on' : ''}" data-chip="mic" title="${esc(micMuted ? _t('Mic muted') : _t('Microphone'))}" style="${!micMuted ? '--a:#34d399;--afg:#000' : ''}">${N.ic(micMuted ? 'micOff' : 'mic', 'width:13px;height:13px')}</button>`
        + `<button type="button" class="ctl-ico-btn sm" id="ctlMoreBtn" title="${esc(_t('Quick actions'))}">${N.ic('sliders', 'width:13px;height:13px')}</button>`
        + `</div></div></div>`;

      bindCommonToggles();
      bindHorizSlider($('#ctlBriHsl', page), briFrac, (f) => api.helper({ cmd: 'brightness.set', value: Math.round(f * 100) }));
      bindHorizSlider($('#ctlVolHsl', page), volFrac, (f) => api.helper({ cmd: 'volume.set', value: Math.round(f * 100) }));
      return;
    }

    const tiles = [
      ['wifi', 'wifi', 'Wi‑Fi', wifiSub(), wifiOn ? '#4361ff' : ''],
      ['bluetooth', 'bt', 'Bluetooth', btSub(), btOn ? '#4361ff' : ''],
      ['focus', 'moonz', _t('Focus'), dndOn ? _t('On') : _t('Off'), dndOn ? '#8fa2ff' : ''],
      ['keepAwake', 'cup', _t('Keep awake|short'), awakeOn ? _t('On') : _t('Off'), awakeOn ? '#fbbf24' : ''],
    ];

    const outRowsHtml = outs.length
      ? outs.map((d) => {
        const [kind] = split(d.name);
        const bat = devBattery(d.name);
        const batHtml = bat != null
          ? `<span class="n" style="font-size:11px;color:${N.meter(bat, true)};flex:none">${bat}%</span>`
          : '';
        return `<button type="button" class="row" data-out="${esc(d.id)}" style="gap:9px;padding:5px 6px;border-radius:10px;width:100%;text-align:start;cursor:pointer;${d.default ? 'background:#1d1d24' : ''}">`
          + `<span style="color:${d.default ? '#fff' : 'var(--dim)'};flex:none">${N.ic(devSvg(d.name), 'width:14px;height:14px')}</span>`
          + `<span class="t1" style="flex:1;font-size:12px;font-weight:${d.default ? 700 : 500};color:${d.default ? '#fff' : 'var(--dim)'}">${esc(kind)}</span>`
          + `${batHtml}`
          + `${d.default ? `<span style="color:#4ade80;flex:none">${N.ic('todo', 'width:12px;height:12px')}</span>` : ''}</button>`;
      }).join('')
      : `<div class="sub" style="padding:8px 4px">${esc(_t('No sound output'))}</div>`;

    page.innerHTML = `<div style="display:grid;grid-template-columns:200px 132px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px;min-width:0;min-height:0">`
      + tiles.map(([id, ico, name, sub, col]) => `<button type="button" class="tg2${col ? ' on' : ''}" data-tgl="${id}" style="--a:${col || '#1d1d24'}">`
        + `<span class="dot2" style="background:${col || '#1d1d24'};color:${col === '#fbbf24' ? '#000' : col ? '#fff' : 'var(--dim)'}">${N.ic(ico, 'width:17px;height:17px')}</span>`
        + `<b class="t1">${esc(name)}</b><span class="t1">${esc(sub)}</span></button>`).join('')
      + `</div>`
      + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0;min-height:0">`
      + `<div class="vsl big${briOk ? '' : ' na'}${briFrac < 0.22 ? ' low' : ''}${briFrac >= 0.86 ? ' hi' : ''}" id="ctlBriVsl" role="slider" tabindex="0" aria-label="${esc(_t('Brightness'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${briPct}" style="--v:${briFrac}">`
      + `<b class="n">${briOk ? briPct : '–'}</b><i></i><span>${N.ic('sun', 'width:18px;height:18px')}</span></div>`
      + `<div class="vsl big${volFrac < 0.22 ? ' low' : ''}${volFrac >= 0.86 ? ' hi' : ''}" id="ctlVolVsl" role="slider" tabindex="0" aria-label="${esc(_t('Volume'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}" style="--v:${volFrac}">`
      + `<b class="n">${volPct}</b><i></i><span>${N.ic(v.muted || volPct === 0 ? 'volMute' : 'vol', 'width:18px;height:18px')}</span></div>`
      + `</div>`
      + `<div style="display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0">`
      + `<div class="c grow sc-y" style="padding:10px;gap:2px;min-height:0">`
      + `<div class="row" style="justify-content:space-between;gap:4px;flex:none">`
      + `${N.hd('vol', _t('Sound output'))}`
      + `<div class="row" style="gap:4px;flex:none">`
      + `<button type="button" class="mini-btn" id="ctlSoundBtn" title="${esc(_t('Inputs'))}" style="width:20px;height:20px;background:var(--pill)">${N.ic('pods', 'width:11px;height:11px')}</button>`
      + `<button type="button" class="mini-btn" id="ctlMoreBtn" title="${esc(_t('More'))}" style="width:20px;height:20px;background:var(--pill)">${N.ic('sliders', 'width:11px;height:11px')}</button>`
      + `</div></div>`
      + `<div style="display:flex;flex-direction:column;gap:2px;margin-top:6px">${outRowsHtml}</div></div>`
      + `<div class="row" style="gap:6px;flex:none">`
      + `<button type="button" class="chip2${darkOn ? ' on' : ''}" data-chip="dark">${N.ic('contrast', 'width:12px;height:12px')}<span class="t1">${esc(_t('Dark mode'))}</span></button>`
      + `<button type="button" class="chip2${warmOn ? ' on' : ''}" data-chip="warm">${N.ic('sun', 'width:12px;height:12px')}<span class="t1">${esc(_t('Night Shift'))}</span></button>`
      + `<button type="button" class="chip2${!micMuted ? ' on' : ''}" data-chip="mic" style="flex:0 0 auto;padding:0 10px">${N.ic(micMuted ? 'micOff' : 'mic', 'width:12px;height:12px')}<span class="t1">${esc(_t('Mic'))}</span></button>`
      + `</div></div></div>`;

    bindCommonToggles();
    bindVertSlider($('#ctlBriVsl', page), briFrac, (f) => api.helper({ cmd: 'brightness.set', value: Math.round(f * 100) }));
    bindVertSlider($('#ctlVolVsl', page), volFrac, (f) => api.helper({ cmd: 'volume.set', value: Math.round(f * 100) }));
    $$('[data-out]', page).forEach((btn) => {
      btn.onclick = async () => {
        await api.svc('audio', 'setDefault', btn.dataset.out).catch(() => false);
        setTimeout(loadDevices, 250);
      };
    });
  }

  // ------------------------------------------------------------ 2×1 Control Card (matches modules.html)
  const cards = new Set();

  function paintCard(slot) {
    const { el } = slot;
    if ($('.vsl.drag', el)) return;
    const focusSl = document.activeElement && el.contains(document.activeElement) && document.activeElement.classList.contains('vsl')
      ? document.activeElement.dataset.csl : '';
    if (!devsLoaded) { loadDevices(); loadDnd(); }

    el.style.flexDirection = 'row';
    el.style.gap = '10px';
    el.style.alignItems = 'stretch';
    el.style.padding = '12px';

    const wifiOn = radio('wifi');
    const btOn = radio('bluetooth');
    const awakeOn = !!(st.settings && st.settings.keepAwake);

    const b = st.brightness;
    const briOk = !!(b && b.supported);
    const briPct = briOk ? Math.max(0, Math.min(100, Math.round(b.level || 0))) : 0;
    const briFrac = briPct / 100;
    const v = st.volume || { level: 50, muted: false };
    const volPct = v.muted ? 0 : Math.max(0, Math.min(100, Math.round(v.level || 0)));
    const volFrac = volPct / 100;

    const outs = Array.isArray(devs.out) ? devs.out : [];
    const curOut = outs.find((d) => d.default) || outs[0] || null;
    const outName = curOut ? split(curOut.name)[0] : _t('Sound output');

    const togs = [
      ['wifi', 'wifi', 'Wi‑Fi', wifiOn ? '#4361ff' : ''],
      ['bluetooth', 'bt', 'Bluetooth', btOn ? '#4361ff' : ''],
      ['focus', 'moonz', _t('Focus'), dndOn ? '#8fa2ff' : ''],
      ['keepAwake', 'cup', _t('Keep awake'), awakeOn ? '#fbbf24' : ''],
    ];

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,36px);grid-template-rows:repeat(2,36px);gap:8px;align-content:center;flex:none">`
      + togs.map(([id, ico, lbl, col]) => `<button type="button" data-ctgl="${id}" title="${esc(lbl)}" style="width:36px;height:36px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${col || '#1d1d24'};color:${col === '#fbbf24' ? '#000' : col ? '#fff' : 'var(--dim)'};cursor:pointer">${N.ic(ico, 'width:15px;height:15px')}</button>`).join('')
      + `</div>`
      + `<div class="vsl${briOk ? '' : ' na'}${briFrac < 0.22 ? ' low' : ''}" data-csl="bri" role="slider" tabindex="0" aria-label="${esc(_t('Brightness'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${briPct}" style="--v:${briFrac}"><i></i><span>${N.ic('sun', 'width:15px;height:15px')}</span></div>`
      + `<div class="vsl${volFrac < 0.22 ? ' low' : ''}" data-csl="vol" role="slider" tabindex="0" aria-label="${esc(_t('Volume'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}" style="--v:${volFrac}"><i></i><span>${N.ic(v.muted || volPct === 0 ? 'volMute' : 'vol', 'width:15px;height:15px')}</span></div>`
      + `<button type="button" data-cout="1" style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:2px;padding:0 10px;border-radius:16px;background:#16161c;text-align:start;cursor:pointer">`
      + `<span style="color:#fff">${N.ic(curOut ? devSvg(curOut.name) : 'pods', 'width:16px;height:16px')}</span>`
      + `<b class="t1" style="font-size:12px;margin-top:4px;max-width:100%">${esc(outName)}</b>`
      + `<span class="sub t1" style="font-size:10.5px;max-width:100%">${esc(_t('Output'))}</span></button>`;

    $$('[data-ctgl]', el).forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.ctgl;
        if (id === 'focus') { toggleFocus(); return; }
        api.svc('system', 'toggle', id).then(() => setTimeout(refreshCards, 350));
      };
    });
    bindVertSlider($('[data-csl="bri"]', el), briFrac, (f) => api.helper({ cmd: 'brightness.set', value: Math.round(f * 100) }));
    bindVertSlider($('[data-csl="vol"]', el), volFrac, (f) => api.helper({ cmd: 'volume.set', value: Math.round(f * 100) }));
    const outBtn = $('[data-cout]', el);
    if (outBtn) outBtn.onclick = (e) => { e.stopPropagation(); N.openModule('control'); };
    if (focusSl) {
      const f = $(`[data-csl="${focusSl}"]`, el);
      if (f) f.focus({ preventScroll: true });
    }
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.controlNeedsTall = () => view !== 'main';

  N.register({
    id: 'control',
    tall: true,
    init(p) { page = p; renderSection(); },
    show() {
      view = 'main';
      renderSection();
      loadDevices();
      loadWifi();
      loadDnd();
      clearInterval(poll);
      poll = setInterval(() => { loadDevices(); loadWifi(); loadDnd(); }, 4000);
    },
    showSound() { view = 'sound'; renderSection(); loadDevices(); if (N.layout) N.layout(); },
    hide() { view = 'main'; clearInterval(poll); },
    update() { renderSection(); refreshCards(); },
    onSettings() { renderSection(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('control'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
