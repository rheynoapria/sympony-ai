// Pomodoro: focus / short break / long break cycles. The timer runs in the main process.
// The switch at the top of the tab has two more: a Timer and a stopwatch. The Timer counts down any length set on
// its wheel or a preset, and runs in main too (pomodoro.rs), so it keeps going while Sympony is closed or restarts; it
// takes its turn in the closed notch and says "Time's up" there when it ends (notch.js). The stopwatch counts up,
// takes laps, and keeps running while Sympony is closed (shown in the closed notch). Its state is the shared
// "stopwatch" store (data.js), so every screen and a restart see the same time.
// The headphones button next to the switch picks Pomodoro's background sound and its volume (focussound.js).
(function () {
  const { api, st, $, $$, esc, fa } = N;
  let page;
  let tick;
  const LABEL = { work: _t('Focus'), short: _t('Short break'), long: _t('Long break') };
  const COLOR = { work: '#ff6b4a', short: '#30d158', long: '#64d2ff' };
  const SW = '#ffd60a';
  const MODES = { pomodoro: _t('Pomodoro'), timer: _t('Timer'), stopwatch: _t('Stopwatch') };
  // which of the three shows (the tab used to remember only whether the stopwatch did)
  let view = 'pomodoro';
  try { view = localStorage.getItem('sympony.pomoMode') || (localStorage.getItem('sympony.pomoView') === 'stopwatch' ? 'stopwatch' : 'pomodoro'); } catch (e) { /* storage off */ }
  if (!MODES[view]) view = 'pomodoro';

  // 1:02.3 / 12:34.5 / 1:02:03.4
  function swText(ms, tenths = true) {
    const t = Math.floor(ms / 100);
    const d = t % 10; const s = Math.floor(t / 10) % 60; const m = Math.floor(t / 600) % 60; const h = Math.floor(t / 36000);
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}${tenths ? '.' + d : ''}`;
  }
  N.swText = swText;

  const sw = () => N.data.stopwatch || { running: false, elapsed: 0, laps: [] };
  const swSave = (s) => N.saveStore('stopwatch', s);
  function swToggle() {
    const s = sw();
    if (s.running) swSave({ ...s, running: false, elapsed: N.swElapsed(), startedAt: null });
    else swSave({ ...s, running: true, startedAt: Date.now() });
  }
  function swReset() { swSave({ running: false, elapsed: 0, laps: [], startedAt: null }); }
  function swLap() { const s = sw(); if (s.running) swSave({ ...s, laps: [...(s.laps || []), N.swElapsed()].slice(-99) }); }

  // ---- the Timer (st.timer from main: { active, running, left, endsAt, total, last }, in ms)
  const MIN = 60000;
  const TM = '#ff9f0a';
  // Settings → Pomodoro → Timer → Presets: whole minutes from 1 to 600, each once, shortest first, at most 8
  N.timerPresets = (list) => [...new Set((Array.isArray(list) ? list : []).map((m) => Math.round(Number(m))).filter((m) => m >= 1 && m <= 600))]
    .sort((a, b) => a - b).slice(0, 8);
  // a timer's length: "37 min", "2 h", "1 h 30 min"
  N.timerLen = (ms) => {
    const t = Math.max(0, Math.round(ms / MIN)); const h = Math.floor(t / 60); const m = t % 60;
    return h ? (m ? _t('{h} h {m} min', { h, m }) : _t('{h} h', { h })) : _t('{n} min', { n: m });
  };
  // what's left of it now
  N.timerLeft = (t) => (!t || !t.active ? 0 : t.running ? Math.max(0, t.endsAt - Date.now()) : Math.max(0, t.left || 0));
  // a preset chip: "5m", "1h 30m"
  const chipText = (min) => (min < 60 ? _t('{n}m', { n: min }) : min % 60 ? _t('{h}h {m}m', { h: Math.floor(min / 60), m: min % 60 }) : _t('{n}h', { n: min / 60 }));

  // The wheel: hours 0–23 and minutes 0–59 side by side, the value in the band across the middle, the numbers above
  // and below fading out. A column turns with the mouse wheel or a drag; a click on a number above or below takes it,
  // and lets the keyboard in: ↑ / ↓ turn it (Page Up / Down by 5), ← / → go to the other one, Enter starts. Both go
  // round, as a clock's do.
  const ROW = 22;
  const UNITS = { h: 24, m: 60 };
  const pick = { h: 0, m: 25 };
  const offs = { h: 0, m: 0 };  // how far a column is turned between two numbers (px), while dragged or gliding
  const glides = {};
  const wrap = (u, v) => ((v % UNITS[u]) + UNITS[u]) % UNITS[u];
  const pickMs = () => (pick.h * 60 + pick.m) * MIN;
  N.timerPick = (ms) => { const t = Math.max(0, Math.min(23 * 60 + 59, Math.round(ms / MIN))); return { h: Math.floor(t / 60), m: t % 60 }; };
  function setPick(ms) { Object.assign(pick, N.timerPick(ms)); offs.h = 0; offs.m = 0; paintWheel(); paintStart(); }
  // where the wheel starts: at the length last started (Remember the last duration), else the first preset
  function wheelStart() {
    const s = st.settings || {}; const t = st.timer || {};
    setPick(s.timerRemember !== false && t.last > 0 ? t.last : (N.timerPresets(s.timerPresets)[0] || 25) * MIN);
  }
  function paintWheel() {
    if (!page) return;
    $$('.tw-col', page).forEach((col) => {
      const u = col.dataset.u;
      $('.tw-rows', col).innerHTML = [-3, -2, -1, 0, 1, 2, 3].map((k) => {
        const y = k * ROW + offs[u]; const far = Math.min(1, Math.abs(y) / (ROW * 2.6));
        return `<i class="${k ? '' : 'on'}" style="transform:translateY(${y.toFixed(1)}px) scale(${(1 - far * 0.22).toFixed(3)});opacity:${(1 - far * 0.85).toFixed(3)}">${String(wrap(u, pick[u] + k)).padStart(2, '0')}</i>`;
      }).join('');
      col.setAttribute('aria-valuenow', pick[u]);
    });
    const hu = $('.tw-unit[data-u="h"]', page);
    if (hu) hu.textContent = pick.h === 1 ? _t('hour') : _t('hours');
  }
  // the turned column eases into place
  function glide(u, from) {
    cancelAnimationFrame(glides[u]);
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / 160);
      offs[u] = from * (1 - p) ** 3;
      paintWheel();
      if (p < 1) glides[u] = requestAnimationFrame(frame);
    };
    glides[u] = requestAnimationFrame(frame);
  }
  function turn(u, by) {
    if (!by) return;
    pick[u] = wrap(u, pick[u] + by);
    glide(u, Math.sign(by) * ROW);
    paintStart();
  }
  function bindWheel(col) {
    const u = col.dataset.u;
    let acc = 0;
    col.addEventListener('wheel', (e) => {
      e.preventDefault();
      // a mouse wheel's notch turns it once; a touchpad's small steps add up
      acc += e.deltaY;
      if (Math.abs(acc) >= 30) { turn(u, Math.sign(acc)); acc = 0; }
    }, { passive: false });
    col.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      cancelAnimationFrame(glides[u]);
      col.setPointerCapture(e.pointerId);
      const y0 = e.clientY; const v0 = pick[u]; let moved = false;
      const move = (ev) => {
        const dy = ev.clientY - y0;
        if (Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        const steps = Math.round(-dy / ROW);
        pick[u] = wrap(u, v0 + steps);
        offs[u] = dy + steps * ROW;
        paintWheel(); paintStart();
      };
      const up = (ev) => {
        col.removeEventListener('pointermove', move); col.removeEventListener('pointerup', up); col.removeEventListener('pointercancel', up);
        if (moved) { glide(u, offs[u]); return; }
        const r = col.getBoundingClientRect();
        turn(u, Math.round((ev.clientY - (r.top + r.height / 2)) / ROW));
        N.focusField(col);
      };
      col.addEventListener('pointermove', move); col.addEventListener('pointerup', up); col.addEventListener('pointercancel', up);
    });
    col.addEventListener('keydown', (e) => {
      const by = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (by) turn(u, by);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') $(`.tw-col[data-u="${u === 'h' ? 'm' : 'h'}"]`, page).focus();
      else if (e.key === 'Enter') startTimer();
      else return;
      e.preventDefault();
    });
  }
  function startTimer() { const ms = pickMs(); if (ms) api.svc('timer', 'start', ms); }

  // the wheel's length on the Start button, when it would end, and the preset it matches
  function paintStart() {
    const b = page && $('#tmStart', page);
    if (!b) return;
    const ms = pickMs();
    b.disabled = !ms;
    // (drawn again only when it changes: the tab redraws ten times a second)
    const html = `${fa('play')} ${ms ? _t('Start {time}', { time: N.timerLen(ms) }) : _t('Start')}`;
    if (b.dataset.html !== html) { b.dataset.html = html; b.innerHTML = html; }
    const ends = ms ? _t('Ends at {time}', { time: N.hm(Date.now() + ms) }) : '';
    const endsEl = $('#tmEnds', page);
    if (endsEl && endsEl.textContent !== ends) endsEl.textContent = ends;
    $$('.tm-chip[data-min]', page).forEach((c) => c.classList.toggle('on', +c.dataset.min * MIN === ms));
  }
  // (null, not '': an empty list still gets its edit chip)
  let chipsKey = null;
  function paintChips() {
    const list = N.timerPresets((st.settings || {}).timerPresets);
    const key = list.join();
    if (key === chipsKey) return;
    chipsKey = key;
    const box = $('.tm-chips', page);
    box.innerHTML = list.map((m) => `<button class="tm-chip" data-min="${m}" title="${N.timerLen(m * MIN)}">${chipText(m)}</button>`).join('')
      + `<button class="tm-chip tm-edit" title="${_t('Edit presets')}">${fa('pen')}</button>`;
    $$('.tm-chip[data-min]', box).forEach((c) => { c.onclick = () => setPick(+c.dataset.min * MIN); });
    $('.tm-edit', box).onclick = () => { api.openSettings('pomodoro/timer'); N.closeNotch(); };
    paintStart();
  }

  let wasActive = null;
  function renderTimer() {
    const t = st.timer || {};
    const on = !!t.active;
    // a timer just ended or was stopped (or none yet): the wheel at its starting length
    if (on !== wasActive) { page.classList.toggle('tm-on', on); if (!on) wheelStart(); wasActive = on; }
    paintChips();
    if (!on) { paintStart(); return; }
    const left = N.timerLeft(t);
    $('#tmLeft', page).textContent = N.fmt(Math.ceil(left / 1000));
    $('#tmOf', page).textContent = t.running ? _t('of {time} · ends {at}', { time: N.timerLen(t.total), at: N.hm(t.endsAt) }) : _t('of {time} · paused', { time: N.timerLen(t.total) });
    $('#tmBar', page).style.width = `${Math.max(0, Math.min(100, (1 - left / Math.max(1, t.total)) * 100))}%`;
    const play = $('#tmPlay', page);
    play.innerHTML = fa(t.running ? 'pause' : 'play');
    play.title = t.running ? _t('Pause') : _t('Resume');
  }

  // ---- the background sound: the button shows the one picked; its list (and a volume) opens under it
  let sndPop = null;
  let sndVolAt = 0;
  // a name Sympony doesn't know (a volume saved here by an older test build, say) counts as off
  const sndOf = () => { const k = (st.settings || {}).focusSound; return (N.focusSounds || []).some(([v]) => v === k) ? k : 'off'; };
  const sndVol = () => { const v = Number((st.settings || {}).focusSoundVolume ?? 70); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 70; };
  function paintSound() {
    const b = page && $('#pomoSound', page);
    if (!b) return;
    const k = sndOf();
    const name = k === 'off' ? _t('Sound') : ((N.focusSounds || []).find(([v]) => v === k) || [k, k])[1];
    const html = `${fa('headphones')}<span>${esc(name)}</span>${fa('chevron-down')}`;
    if (b.dataset.html !== html) { b.dataset.html = html; b.innerHTML = html; }
    b.classList.toggle('on', k !== 'off');
    if (sndPop) paintPop();
  }
  // (drawn again only when it changes: the tab redraws ten times a second)
  function paintPop() {
    const k = sndOf();
    if (sndPop.dataset.k !== k) {
      sndPop.dataset.k = k;
      $$('.fs-list [data-v]', sndPop).forEach((o) => { const on = o.dataset.v === k; o.classList.toggle('on', on); o.setAttribute('aria-selected', on); o.innerHTML = `<span>${esc(o.dataset.l)}</span>${on ? fa('check') : ''}`; });
    }
    const bar = $('#fsVol', sndPop);
    if (bar.classList.contains('dragging') || Date.now() - sndVolAt < 600) return;
    const v = sndVol();
    // (its own data-vol: data-v marks the list's options)
    if (bar.dataset.vol === String(v)) return;
    bar.dataset.vol = v;
    $('.progress-fill', bar).style.width = v + '%';
    $('.progress-knob', bar).style.left = v + '%';
    paintVolText(v);
  }
  function paintVolText(v) {
    if (!sndPop) return;
    $('#fsVolIc', sndPop).innerHTML = fa(v === 0 ? 'volume-xmark' : v < 50 ? 'volume-low' : 'volume-high');
    $('#fsVolN', sndPop).textContent = `${v}%`;
  }
  function setSndVol(f, dragging) {
    const v = Math.round(f * 100);
    paintVolText(v);
    // (while dragging, a few times a second: each one is saved)
    if (dragging && Date.now() - sndVolAt < 150) return;
    sndVolAt = Date.now();
    api.setSettings({ focusSoundVolume: v });
  }
  function closePop() {
    if (!sndPop) return;
    sndPop.remove(); sndPop = null;
    const b = page && $('#pomoSound', page);
    if (b) { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }
  }
  function openPop() {
    closePop();
    const host = $('#notch'); const b = $('#pomoSound', page);
    sndPop = document.createElement('div');
    sndPop.className = 'pick-menu fs-pop';
    sndPop.innerHTML = `<div class="fs-head">${_t('Background sound')}<small>${_t('Plays while you focus')}</small></div>
      <div class="fs-list" role="listbox">${(N.focusSounds || []).map(([v, l]) => `<button type="button" role="option" data-v="${esc(v)}" data-l="${esc(l)}"></button>`).join('')}</div>
      <div class="fs-vol" dir="ltr"><span id="fsVolIc"></span><div class="progress" id="fsVol" title="${_t('Background sound volume')}"><div class="progress-fill"></div><div class="progress-knob"></div></div><b id="fsVolN"></b></div>`;
    host.appendChild(sndPop);
    // under the button, at its end; moved up when Sympony is too short for it
    const h = host.getBoundingClientRect(); const r = b.getBoundingClientRect(); const pad = 8;
    const top = Math.max(pad, Math.min(r.bottom - h.top + 4, h.height - pad - sndPop.offsetHeight));
    const rtl = getComputedStyle(page).direction === 'rtl';
    const left = rtl ? r.left - h.left : r.right - h.left - sndPop.offsetWidth;
    sndPop.style.top = top + 'px';
    sndPop.style.left = Math.max(pad, Math.min(left, h.width - sndPop.offsetWidth - pad)) + 'px';
    sndPop.onclick = (e) => {
      const o = e.target.closest('.fs-list [data-v]');
      if (o && o.dataset.v !== sndOf()) api.setSettings({ focusSound: o.dataset.v });
    };
    bindSlider($('#fsVol', sndPop), (f) => setSndVol(f, false), (f) => setSndVol(f, true));
    b.classList.add('open'); b.setAttribute('aria-expanded', 'true');
    paintPop();
  }
  document.addEventListener('mousedown', (e) => { if (sndPop && !sndPop.contains(e.target) && !e.target.closest('#pomoSound')) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (sndPop && e.key === 'Escape') { e.stopImmediatePropagation(); closePop(); } }, true);

  function ring(frac, color, big, small) {
    const r = 50; const c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 116 116"><circle cx="58" cy="58" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/>
      <circle cx="58" cy="58" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" style="transition:stroke-dashoffset .5s linear"/></svg>
      <div class="lbl"><b>${big}</b><small>${small}</small></div>`;
  }

  function render() {
    if (!page) return;
    const s = st.settings || {};
    const p = st.pomodoro || { remaining: (s.pomoWork || 25) * 60000, total: (s.pomoWork || 25) * 60000, phase: 'work', running: false, cycle: 0, cycles: s.pomoCycles || 4, doneToday: 0, focusToday: 0 };
    const workM = s.pomoWork || 25; const shortM = s.pomoShort || 5; const longM = s.pomoLong || 15;
    const pills = [
      ['work', `${_t('Focus')} ${workM}`, view === 'pomodoro' && p.phase === 'work'],
      ['short', `${_t('Break')} ${shortM}`, view === 'pomodoro' && p.phase === 'short'],
      ['long', `${_t('Long')} ${longM}`, view === 'pomodoro' && p.phase === 'long'],
      ['timer', _t('Timer'), view === 'timer'],
      ['stopwatch', _t('Stopwatch'), view === 'stopwatch'],
    ];
    $$('[data-ppill]', page).forEach((b) => {
      const hit = pills.find(([k]) => k === b.dataset.ppill);
      const on = !!(hit && hit[2]);
      b.style.background = on ? '#ff5a52' : 'var(--pill)';
      b.style.color = on ? '#fff' : 'var(--dim)';
      if (hit) b.textContent = hit[1];
    });
    paintSound();

    const leftBox = $('#pomoLeftTile', page);
    const midBox = $('#pomoMidTile', page);
    const actBox = $('#pomoActsRow', page);

    if (view === 'stopwatch') {
      const sws = sw();
      const ms = N.swElapsed();
      const pct = ((ms % 60000) / 60000) * 100;
      leftBox.innerHTML = `<div style="margin:auto">${N.ring(pct, SW, 150, 7, `<div><div class="big" style="font-size:32px">${esc(swText(ms))}</div><div class="sub">${esc(sws.running ? _t('Stopwatch') : ms ? _t('Paused') : _t('Stopwatch'))}</div></div>`)}</div>`;
      const laps = sws.laps || [];
      midBox.innerHTML = `<div class="sub">${esc(_t('Laps'))}</div>`
        + (laps.length
          ? `<div class="sc-y" style="display:flex;flex-direction:column;gap:3px;margin-top:4px;flex:1">${laps.map((t, i) => ({ n: i + 1, split: t - (laps[i - 1] || 0), total: t })).reverse().slice(0, 5).map((l) => `<div class="row" style="justify-content:space-between;font-size:11.5px"><span class="mute">${esc(_t('Lap {n}', { n: l.n }))}</span><b class="n">${esc(swText(l.split))}</b><span class="sub n">${esc(swText(l.total))}</span></div>`).join('')}</div>`
          : `<div class="sub" style="margin-top:6px">${esc(sws.running ? _t('Lap marks a split') : _t('Counts up from zero.'))}</div>`);
      actBox.innerHTML = `<button type="button" class="sbtn p" data-pa="sw-toggle" style="flex:1">${esc(sws.running ? _t('Pause') : _t('Start'))}</button>`
        + `<button type="button" class="sbtn" data-pa="sw-lap" style="flex:1"${sws.running ? '' : ' disabled'}>${esc(_t('Lap'))}</button>`
        + `<button type="button" class="sbtn" data-pa="sw-reset" style="flex:1">${esc(_t('Reset'))}</button>`;
      return;
    }

    if (view === 'timer') {
      const t = st.timer || {};
      const on = !!t.active;
      const presets = N.timerPresets(s.timerPresets);
      if (on) {
        const left = N.timerLeft(t);
        const pct = Math.max(0, Math.min(100, (1 - left / Math.max(1, t.total)) * 100));
        leftBox.innerHTML = `<div style="margin:auto">${N.ring(pct, TM, 150, 7, `<div><div class="big" style="font-size:36px">${esc(N.fmt(Math.ceil(left / 1000)))}</div><div class="sub">${esc(t.running ? _t('Ends at {time}', { time: N.hm(t.endsAt) }) : _t('Paused'))}</div></div>`)}</div>`;
        midBox.innerHTML = `<div class="sub">${esc(_t('Timer'))}</div><div class="t1" style="font-size:15px;font-weight:700;margin-top:2px">${esc(N.timerLen(t.total))}</div>`
          + `<div class="row" style="gap:6px;margin-top:auto"><button type="button" class="sbtn" data-tadd="1" style="height:26px;flex:1">${esc(_t('+{n} min', { n: 1 }))}</button><button type="button" class="sbtn" data-tadd="5" style="height:26px;flex:1">${esc(_t('+{n} min', { n: 5 }))}</button></div>`;
        actBox.innerHTML = `<button type="button" class="sbtn p" data-pa="tm-toggle" style="flex:1">${esc(t.running ? _t('Pause') : _t('Resume'))}</button>`
          + `<button type="button" class="sbtn" data-pa="tm-stop" style="flex:1">${esc(_t('Stop'))}</button>`;
      } else {
        const ms = pickMs();
        leftBox.innerHTML = `<div style="margin:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px">`
          + `<div class="big" style="font-size:36px;color:${TM}">${esc(N.timerLen(ms || 25 * MIN))}</div>`
          + `<div class="row" style="gap:6px"><button type="button" class="mini-btn" data-tstep="-5">−5</button><button type="button" class="mini-btn" data-tstep="-1">−1</button><button type="button" class="mini-btn" data-tstep="1">+1</button><button type="button" class="mini-btn" data-tstep="5">+5</button></div>`
          + `<div class="sub">${ms ? esc(_t('Ends at {time}', { time: N.hm(Date.now() + ms) })) : ''}</div></div>`;
        midBox.innerHTML = `<div class="sub">${esc(_t('Presets'))}</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">`
          + presets.map((m) => `<button type="button" class="pill" data-tmin="${m}" style="height:24px;padding:0 10px;background:${m * MIN === ms ? TM : 'var(--pill)'};color:${m * MIN === ms ? '#000' : 'var(--dim)'};cursor:pointer">${esc(chipText(m))}</button>`).join('')
          + `</div>`;
        actBox.innerHTML = `<button type="button" class="sbtn p" data-pa="tm-start" style="flex:1">${esc(_t('Start'))}</button>`
          + `<button type="button" class="sbtn" data-pa="tm-edit" style="flex:1">${esc(_t('Edit presets'))}</button>`;
      }
      return;
    }

    // Pomodoro view (matches modules.html line 503)
    const left = p.running ? Math.max(0, (p.endsAt || 0) - Date.now()) : (p.remaining || workM * 60000);
    const total = Math.max(1, p.total || workM * 60000);
    const pct = Math.max(0, Math.min(100, (1 - left / total) * 100));
    const col = p.phase === 'work' ? '#ff5a52' : p.phase === 'short' ? '#4ade80' : '#60a5fa';
    const cycles = p.cycles || s.pomoCycles || 4;
    const inCycle = (p.cycle || 0) % cycles;
    const sessNum = inCycle + 1;
    const activeTask = (((N.data && N.data.todo && N.data.todo.items) || []).find((t) => !t.deletedAt && !t.done) || {}).text || _t('{n} sessions today · {time}', { n: p.doneToday || 0, time: p.focusToday ? N.dur(p.focusToday / 1000) : '0m' });
    const sndKey = sndOf();
    const sndName = sndKey === 'off' ? _t('Sound') : ((N.focusSounds || []).find(([v]) => v === sndKey) || [sndKey, sndKey])[1];

    leftBox.innerHTML = `<div style="margin:auto">${N.ring(pct, col, 150, 7, `<div><div class="big" id="pomoT" style="font-size:36px">${esc(N.fmt(Math.ceil(left / 1000)))}</div><div class="sub">${esc(LABEL[p.phase] || _t('Focus'))} · ${esc(_t('session {n}/{t}', { n: sessNum, t: cycles }))}</div></div>`)}</div>`;
    midBox.innerHTML = `<div class="row" style="justify-content:space-between"><span class="sub">${esc(_t('Current focus'))}</span><span class="sub">${esc(p.running ? _t('Ends at {time}', { time: N.hm(p.endsAt) }) : _t('Paused'))}</span></div>`
      + `<div class="t1" style="font-size:15px;font-weight:700;margin-top:2px">${esc(activeTask)}</div>`
      + `<div class="row" style="gap:6px;margin-top:auto">${Array.from({ length: cycles }, (_, k) => `<i style="flex:1;height:5px;border-radius:3px;background:${k < inCycle ? col : k === inCycle ? col + '66' : '#24242c'}"></i>`).join('')}</div>`;
    actBox.innerHTML = `<button type="button" class="sbtn p" data-pa="toggle" style="flex:1">${esc(p.running ? _t('Pause') : _t('Start'))}</button>`
      + `<button type="button" class="sbtn" data-pa="skip" style="flex:1">${esc(_t('Skip'))}</button>`
      + `<button type="button" class="sbtn" data-pa="reset" title="${esc(_t('Reset'))}" style="padding:0 10px">${fa('rotate-left')}</button>`
      + `<button type="button" class="sbtn" id="pomoSound" data-pa="sound" style="flex:1">${fa('headphones')} ${esc(sndName)}</button>`;
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('sympony.pomoMode', v); } catch (e) { /* storage off */ }
    render();
  }
  N.showStopwatch = () => setView('stopwatch');
  N.showTimer = () => setView('timer');

  // ------------------------------------------------------------ 1×1 Pomodoro segmented-ring card (matches modules.html)
  const cards = new Set();
  let cardTick = null;

  function ensureCardTick() {
    if (cardTick) return;
    cardTick = setInterval(() => {
      if (!st.open || !cards.size) return;
      const p = st.pomodoro;
      if (p && p.running) refreshCards();
    }, 1000);
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#ff5a52');
    el.style.flexDirection = 'row';
    el.style.alignItems = 'center';
    el.style.gap = '10px';
    const p = st.pomodoro || { remaining: 25 * 60000, total: 25 * 60000, phase: 'work', running: false, cycle: 0, cycles: 4 };
    const left = p.running ? Math.max(0, (p.endsAt || 0) - Date.now()) : (p.remaining || 0);
    const col = p.phase === 'work' ? '#ff5a52' : '#4ade80';
    const mmss = N.fmt(Math.ceil(left / 1000));
    const cycles = p.cycles || (st.settings && st.settings.pomoCycles) || 4;
    const inCycle = (p.cycle || 0) % cycles;
    const segLen = Math.max(8, Math.floor(100 / cycles) - 4);
    const step = 100 / cycles;
    const circles = Array.from({ length: cycles }, (_, k) => {
      const done = k < inCycle;
      const cur = k === inCycle;
      return `<circle cx="50" cy="50" r="42" fill="none" stroke="${done || cur ? col : '#24242c'}" stroke-opacity="${cur ? 0.55 : 1}" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="${segLen} 100" stroke-dashoffset="${(-k * step).toFixed(1)}"/>`;
    }).join('');
    el.innerHTML = `<div class="ring" style="width:66px;height:66px"><svg viewBox="0 0 100 100">${circles}</svg><div><span class="n" style="font-size:14px">${esc(mmss)}</span></div></div>`
      + `<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;min-width:0">`
      + `<span style="font-size:11px;font-weight:600;color:${col}">${esc(LABEL[p.phase] || _t('Focus'))}</span>`
      + `<span class="sub" style="margin-top:-6px">${esc(_t('session {n}/{t}', { n: inCycle + 1, t: cycles }))}</span>`
      + `<button type="button" class="mini-btn w" data-pact="toggle" title="${esc(p.running ? _t('Pause') : _t('Start'))}">${N.ic(p.running ? 'pause' : 'play')}</button></div>`;
    const tb = $('[data-pact="toggle"]', el);
    if (tb) tb.onclick = (e) => { e.stopPropagation(); api.svc('pomodoro', 'toggle'); };
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'pomodoro',
    init(p) {
      page = p;
      page.innerHTML = `<div style="display:grid;grid-template-columns:200px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
        + `<div class="c" id="pomoLeftTile" style="padding:10px"></div>`
        + `<div style="display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;height:100%">`
        + `<div class="row" style="gap:5px;flex-wrap:nowrap;flex:none">`
        + ['work', 'short', 'long', 'timer', 'stopwatch'].map((k) => `<button type="button" class="pill" data-ppill="${k}" style="height:26px;padding:0 9px;font-size:11px;cursor:pointer"></button>`).join('')
        + `</div>`
        + `<div class="c grow" id="pomoMidTile" style="padding:12px 14px"></div>`
        + `<div class="row" id="pomoActsRow" style="gap:8px;flex:none"></div>`
        + `</div></div>`;

      page.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-ppill]');
        if (pill) {
          const k = pill.dataset.ppill;
          if (k === 'timer' || k === 'stopwatch') setView(k);
          else { view = 'pomodoro'; api.svc('pomodoro', 'setPhase', k); render(); }
          return;
        }
        const tmin = e.target.closest('[data-tmin]');
        if (tmin) { setPick(+tmin.dataset.tmin * MIN); render(); return; }
        const tstep = e.target.closest('[data-tstep]');
        if (tstep) { setPick(Math.max(MIN, pickMs() + +tstep.dataset.tstep * MIN)); render(); return; }
        const tadd = e.target.closest('[data-tadd]');
        if (tadd) { api.svc('timer', 'add', +tadd.dataset.tadd * MIN); return; }
        const pa = e.target.closest('[data-pa]');
        if (!pa) return;
        const a = pa.dataset.pa;
        if (a === 'toggle') api.svc('pomodoro', 'toggle');
        else if (a === 'skip') api.svc('pomodoro', 'skip');
        else if (a === 'reset') api.svc('pomodoro', 'reset');
        else if (a === 'sound') { e.stopPropagation(); if (sndPop) closePop(); else openPop(); }
        else if (a === 'sw-toggle') swToggle();
        else if (a === 'sw-lap') swLap();
        else if (a === 'sw-reset') swReset();
        else if (a === 'tm-start') startTimer();
        else if (a === 'tm-toggle') api.svc('timer', 'toggle');
        else if (a === 'tm-stop') api.svc('timer', 'stop');
        else if (a === 'tm-edit') { api.openSettings('pomodoro/timer'); N.closeNotch(); }
      });
      N.watch('stopwatch', () => { if (view === 'stopwatch') render(); });
    },
    show() { wasActive = null; wheelStart(); render(); clearInterval(tick); tick = setInterval(render, 500); },
    hide() { clearInterval(tick); closePop(); },
    update() { render(); refreshCards(); },
    onSettings() { paintSound(); render(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      ensureCardTick();
      N.cardClick(el, () => N.openModule('pomodoro'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
