// Prayer Times: 1×2 sun-path arc card + 632×218 section (sun path, live countdown, Qibla compass,
// 5 prayers with per-prayer notification bell toggle, Imsak/Terbit/Malam, place & countdown-before pickers).
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let tick;
  const KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const KEY_ICONS = { fajr: 'moonz', dhuhr: 'sun', asr: 'cloudsun', maghrib: 'sun', isha: 'moonz' };
  const KAABA = [21.4225, 39.8262];
  const NAMES = { Imsak: _t('Imsak'), Fajr: _t('Fajr'), Sunrise: _t('Sunrise'), Dhuhr: _t('Dhuhr'), Asr: _t('Asr'), Maghrib: _t('Maghrib'), Isha: _t('Isha') };
  N.prayerName = (n) => (Object.prototype.hasOwnProperty.call(NAMES, n) ? NAMES[n] : n);

  const pad = (n) => String(n).padStart(2, '0');
  function clockParts(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return { hm: `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`, sec: pad(s % 60) };
  }

  function qiblaDeg() {
    const s = st.settings || {};
    const loc = s.prayerLocation && typeof s.prayerLocation.lat === 'number' ? s.prayerLocation : s.weatherLocation;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;
    const r = Math.PI / 180;
    const [p1, p2, dl] = [loc.lat * r, KAABA[0] * r, (KAABA[1] - loc.lon) * r];
    const deg = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / r + 360) % 360;
    return Math.round(deg);
  }

  function hijriDate() {
    try {
      return new Intl.DateTimeFormat(_tLocale('en'), { calendar: 'islamic-umalqura', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).replace(/\s*AH$/i, '');
    } catch {
      return '';
    }
  }

  function activeDay(p, now) {
    const [today, tomorrow] = (p && p.days) || [];
    const showTomorrow = tomorrow && today && KEYS.every((k) => !today[k] || today[k] < now);
    return { day: (showTomorrow ? tomorrow : today) || {}, tomorrow: tomorrow || {}, showTomorrow };
  }

  function sunProgress(day, now) {
    const f = day.fajr; const isha = day.isha;
    if (!f || !isha || isha <= f) return 0.5;
    return Math.max(0, Math.min(1, (now - f) / (isha - f)));
  }

  // Piecewise-linear progress mapped to the 5 evenly spaced timeline dots (0%, 25%, 50%, 75%, 100%)
  // so the filled rail & "now" tick always align accurately with the active prayer dot.
  function timelineProgress(day, keys, now) {
    if (!keys.length) return 0;
    if (keys.length === 1) return now >= day[keys[0]] ? 1 : 0;
    const times = keys.map((k) => day[k]);
    if (now <= times[0]) return 0;
    if (now >= times[times.length - 1]) return 1;
    const n = times.length - 1;
    for (let i = 0; i < n; i++) {
      if (now >= times[i] && now <= times[i + 1]) {
        const span = Math.max(1, times[i + 1] - times[i]);
        return (i + (now - times[i]) / span) / n;
      }
    }
    return 0;
  }

  function prayerPos(day, k) {
    const f = day.fajr; const isha = day.isha;
    const fallback = { fajr: 0.04, dhuhr: 0.47, asr: 0.66, maghrib: 0.86, isha: 0.96 };
    if (!f || !isha || !day[k] || isha <= f) return fallback[k] ?? 0.5;
    return Math.max(0.04, Math.min(0.96, 0.04 + ((day[k] - f) / (isha - f)) * 0.92));
  }

  function midnightOf(day, tomorrow) {
    if (!day.maghrib) return null;
    const nextFajr = tomorrow && tomorrow.fajr ? tomorrow.fajr : (day.fajr ? day.fajr + 86400000 : null);
    if (!nextFajr || nextFajr <= day.maghrib) return null;
    return day.maghrib + Math.round((nextFajr - day.maghrib) / 2);
  }

  function compassDir(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function render() {
    if (!page) return;
    const p = st.prayer; const s = st.settings || {};
    if (!p || !p.ok) {
      page.innerHTML = `<div class="c" style="flex:1;justify-content:center;align-items:center;gap:10px;text-align:center">`
        + `<span style="color:#4ade80">${N.ic('moon', 'width:24px;height:24px')}</span>`
        + `<span class="sub">${esc((p && p.error) || _t('Loading the prayer times…'))}</span>`
        + `<button type="button" class="sbtn p" id="prtSet">${esc(_t('Prayer Times settings'))}</button></div>`;
      const btn = $('#prtSet', page); if (btn) btn.onclick = () => api.openSettings('prayer');
      return;
    }

    const now = Date.now();
    const next = N.nextPrayer();
    const names = p.names || {};
    const { day, tomorrow, showTomorrow } = activeDay(p, now);
    const keys = KEYS.filter((k) => day[k]);
    const listMap = s.prayerList || {};
    const qDeg = qiblaDeg();
    const hijri = hijriDate();
    const mid = midnightOf(day, tomorrow);
    const style = window.StyleLib ? StyleLib.styleIdFor(s, 'prayer') : 'bento';
    const cd = next ? clockParts(next.at - now) : { hm: '--:--', sec: '--' };
    const placeLine = [p.place, p.source].filter(Boolean).join(' · ') || _t('Prayer');
    const placeShort = (p.place || _t('Prayer')).split(',')[0].trim();
    const beforeOpts = [[0, _t('Off')], [5, _t('{n} min before', { n: 5 })], [10, _t('{n} min before', { n: 10 })], [15, _t('{n} min before', { n: 15 })], [30, _t('{n} min before', { n: 30 })]];
    const beforeOptsShort = [[0, _t('Off')], [5, _t('{n}m', { n: 5 })], [10, _t('{n}m', { n: 10 })], [15, _t('{n}m', { n: 15 })], [30, _t('{n}m', { n: 30 })]];

    const bindCommon = (optsList) => {
      const placeBtn = $('#prtPlace', page);
      if (placeBtn) placeBtn.onclick = () => api.openSettings('prayer');
      const beforeBtn = $('#prtBefore', page);
      if (beforeBtn && N.pick) {
        N.pick(beforeBtn, { icon: fa('hourglass-half'), options: optsList, value: +(s.prayerBefore || 0), onChange: (v) => api.setSettings({ prayerBefore: v }) });
      }
      $$('[data-pbell]', page).forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.pbell;
          const cur = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true, ...(st.settings.prayerList || {}) };
          cur[k] = cur[k] === false;
          api.setSettings({ prayerList: cur });
        };
      });
    };

    if (style === 'timeline') {
      const nowT = timelineProgress(day, keys, now);
      const pct = Math.max(0, Math.min(100, nowT * 100));
      const edgeCls = pct < 10 ? ' edge-l' : pct > 90 ? ' edge-r' : '';
      const metaParts = [
        day.imsak ? `${_t('Imsak')} ${N.hm(day.imsak)}` : null,
        day.sunrise ? `${N.prayerName(names.sunrise || 'Sunrise')} ${N.hm(day.sunrise)}` : null,
        qDeg != null ? `${_t('Qibla')} ${qDeg}° ${compassDir(qDeg)}` : null,
      ].filter(Boolean).join(' · ');
      const whenLbl = showTomorrow ? _t('tomorrow') : _t('today');
      page.innerHTML = `<div class="prt-tl-wrap sl-pane">`
        + `<div class="prt-tl-left">`
        + `<div class="prt-tl-name">${esc(next ? N.prayerName(next.name) : _t('Prayer Times'))}</div>`
        + `<div class="prt-tl-cd" id="prtLeft" data-mode="plain">${esc(cd.hm)}:${esc(cd.sec)}</div>`
        + `<div class="prt-tl-at">${esc(next ? N.hm(next.at) : '--:--')} <span>${esc(whenLbl)}</span></div>`
        + `<button type="button" class="prt-tl-loc" id="prtPlace" title="${esc(_t('Change place'))}">`
        + `${fa('location-dot')}<span class="t1">${esc(placeShort)}</span><span class="edit-ico">${fa('pen')}</span></button>`
        + `</div>`
        + `<div class="prt-tl-right">`
        + `<div class="prt-tl-meta"><span class="prt-tl-meta-txt">${esc(metaParts || hijri)}</span>`
        + `<button type="button" id="prtBefore" class="sl-pill" title="${esc(_t('When the closed Sympony starts counting down to a prayer'))}"></button></div>`
        + `<div class="prt-tl-track">`
        + `<div class="prt-tl-rail"><div class="prt-tl-fill" style="width:${pct.toFixed(1)}%"></div>`
        + `<div class="prt-tl-now${edgeCls}" style="left:${pct.toFixed(1)}%"><b>${esc(N.hm(now))}</b></div></div>`
        + `<div class="prt-tl-dots">`
        + keys.map((k) => {
          const isNext = !!(next && next.at === day[k]);
          const isDone = day[k] <= now && !isNext;
          const bellOn = listMap[k] !== false;
          const cls = (isNext ? 'next' : isDone ? 'done' : 'future') + (bellOn ? '' : ' muted');
          const lbl = N.prayerName(names[k] || k);
          return `<button type="button" class="prt-tl-pt ${cls}" data-pbell="${k}" title="${esc(lbl)} · ${esc(bellOn ? _t('Reminder on') : _t('Reminder off'))}">`
            + `<span class="prt-tl-dot"></span><span class="p-lbl">${esc(lbl)}</span><span class="p-tm">${esc(N.hm(day[k]))}</span></button>`;
        }).join('')
        + `</div></div></div></div>`;
      bindCommon(beforeOpts);
      return;
    }

    if (style === 'focus') {
      const topMeta = [qDeg != null ? `${_t('Qibla')} ${qDeg}° ${compassDir(qDeg)}` : null, hijri || null].filter(Boolean).join(' · ');
      page.innerHTML = `<div class="prt-fc-wrap sl-pane">`
        + `<div class="prt-fc-top">`
        + `<button type="button" class="hd" id="prtPlace" style="cursor:pointer">${N.ic('moon', 'width:12px;height:12px;color:#4ade80')}<span>${esc(placeShort)}</span></button>`
        + `<div class="row" style="gap:8px;flex:none"><span class="sub" style="font-size:10.5px">${esc(topMeta)}</span>`
        + `<button type="button" id="prtBefore" class="sl-pill" style="height:20px;font-size:10px" title="${esc(_t('When the closed Sympony starts counting down to a prayer'))}"></button></div></div>`
        + `<div class="prt-fc-hero">`
        + `<span style="font-size:16px;font-weight:700;color:var(--text)">${esc(next ? N.prayerName(next.name) : _t('Prayer Times'))}</span>`
        + `<div class="prt-fc-big" id="prtLeft" data-mode="plain">${esc(cd.hm)}:${esc(cd.sec)}</div>`
        + `<span class="sub n" style="font-size:13px;font-weight:600">${esc(next ? N.hm(next.at) : '')}</span></div>`
        + `<div class="prt-fc-strip">`
        + keys.map((k) => {
          const isNext = !!(next && next.at === day[k]);
          const isDone = day[k] <= now && !isNext;
          const bellOn = listMap[k] !== false;
          const lbl = N.prayerName(names[k] || k);
          return `<button type="button" class="prt-fc-chip${isNext ? ' next' : isDone ? ' done' : ''}" data-pbell="${k}" style="opacity:${!bellOn && !isNext ? 0.4 : ''}" title="${esc(bellOn ? _t('Reminder on') : _t('Reminder off'))}">`
            + `<span class="t1" style="font-weight:600">${esc(lbl)}</span><b class="n">${esc(N.hm(day[k]))}</b></button>`;
        }).join('')
        + `</div></div>`;
      bindCommon(beforeOptsShort);
      return;
    }

    // Default Style 1: Bento Sun-Arc
    // Sun-path SVG (matching modules.html)
    const W = 290; const H = 78;
    const nowT = sunProgress(day, now);
    const at = (t) => { const a = Math.PI * (1 - t); return [W / 2 + (W / 2 - 10) * Math.cos(a), H - 6 - (H - 20) * Math.sin(a)]; };
    const arc = (t0, t1) => {
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const [x, y] = at(t0 + ((t1 - t0) * k) / 40);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return pts.join(' ');
    };
    const [sx, sy] = at(nowT);

    const extras = [
      day.imsak ? [_t('Imsak'), N.hm(day.imsak)] : null,
      day.sunrise ? [N.prayerName(names.sunrise || 'Sunrise'), N.hm(day.sunrise)] : null,
      mid ? [_t('Midnight|short'), N.hm(mid)] : null,
    ].filter(Boolean);

    const estW = (txt) => Math.ceil(String(txt || '').length * 5.6 + 2);
    const ptsMeta = keys.map((k, idx) => {
      const t = prayerPos(day, k);
      const [x, y] = at(t);
      const lbl = N.prayerName(names[k] || k);
      const w = estW(lbl);
      const isFirst = idx === 0;
      const isLast = idx === keys.length - 1;
      let anchor = 'middle';
      let lx = x;
      if (isFirst) {
        anchor = 'start';
        lx = Math.max(2, x - 6);
      } else if (isLast) {
        anchor = 'end';
        lx = Math.min(W - 2, x + 6);
      } else if (x + w / 2 > W - 2) {
        anchor = 'end';
        lx = W - 2;
      } else if (x - w / 2 < 2) {
        anchor = 'start';
        lx = 2;
      }
      const left = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
      const right = left + w;
      return { k, x, y, lbl, w, isFirst, isLast, anchor, lx, left, right, ly: H + 9, above: false };
    });

    let lastBaseRight = -Infinity;
    for (let i = 0; i < ptsMeta.length; i++) {
      const cur = ptsMeta[i];
      const nextPt = ptsMeta[i + 1];
      const hitsLeft = cur.left < lastBaseRight + 6;
      const squeezesLast = !cur.isLast && nextPt && nextPt.isLast && (cur.right + 6 > nextPt.left);
      if (hitsLeft || squeezesLast) {
        cur.above = true;
        cur.ly = Math.max(10, cur.y - 10);
        if (cur.x + cur.w / 2 > W - 2) {
          cur.anchor = 'end';
          cur.lx = Math.min(W - 2, cur.x + 6);
        }
      } else {
        lastBaseRight = cur.right;
      }
    }

    page.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.18fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c" style="padding:10px 14px;min-height:0">`
      + `<div class="row" style="justify-content:space-between;gap:6px;flex:none">`
      + `<button type="button" class="hd" id="prtPlace" title="${esc(_t('Change place'))}" style="color:var(--dim);cursor:pointer">${N.ic('moon', 'width:12px;height:12px;color:#4ade80')}<span>${esc(placeLine)}</span></button>`
      + `<div class="row" style="gap:6px;flex:none"><span class="sub" style="font-size:10px">${esc(hijri)}</span><button type="button" id="prtBefore" class="pill" style="background:var(--pill);color:var(--dim);cursor:pointer;height:18px" title="${esc(_t('When the closed Sympony starts counting down to a prayer'))}"></button></div></div>`
      + `<svg viewBox="0 0 ${W} ${H + 14}" class="prt-bento-svg" preserveAspectRatio="xMidYMid meet">`
      + `<line x1="4" y1="${H - 6}" x2="${W - 4}" y2="${H - 6}" stroke="#24242c" stroke-width="1.5"/>`
      + `<polyline points="${arc(0, 1)}" fill="none" stroke="#24242c" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`
      + `<polyline points="${arc(0, nowT)}" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round"/>`
      + ptsMeta.map(({ k, x, y, lbl, anchor, lx, ly }) => {
        const isNext = !!(next && next.at === day[k]);
        const isDone = day[k] <= now && !isNext;
        return `<g><line x1="${x.toFixed(1)}" y1="${(y + 6).toFixed(1)}" x2="${x.toFixed(1)}" y2="${H - 6}" stroke="${isNext ? '#ffffff33' : '#ffffff12'}" stroke-dasharray="2 3"/>`
          + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isNext ? 5.5 : 4}" fill="${isDone ? '#4ade80' : isNext ? '#fff' : '#0f0f12'}" stroke="${isDone ? '#4ade80' : isNext ? '#fff' : '#55555e'}" stroke-width="2"/>`
          + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="9" font-weight="700" fill="${isNext ? '#fff' : isDone ? '#4ade80' : '#6b6b74'}" font-family="-apple-system,system-ui">${esc(lbl)}</text></g>`;
      }).join('')
      + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="#fbbf24"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="14" fill="none" stroke="#fbbf2455" stroke-width="2"/>`
      + `</svg>`
      + `<div class="row" style="margin-top:auto;align-items:flex-end;gap:12px;flex:none">`
      + `<div style="flex:1;min-width:0"><div class="sub t1" style="font-size:11px">${next ? `${esc(_t('Until'))} <b style="color:#fff">${esc(N.prayerName(next.name))}</b> · ${esc(N.hm(next.at))}` : esc(_t('Prayer Times'))}</div>`
      + `<div class="big prt-bento-cd" id="prtLeft">${esc(cd.hm)}<span style="font-size:0.6em;color:#4ade8099">:${esc(cd.sec)}</span></div></div>`
      + (qDeg != null ? `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;flex:none"><svg viewBox="0 0 48 48" class="prt-bento-qibla"><circle cx="24" cy="24" r="22" fill="none" stroke="#24242c" stroke-width="2"/>`
        + [0, 90, 180, 270].map((d) => `<line x1="24" y1="3" x2="24" y2="7" stroke="#55555e" stroke-width="2" transform="rotate(${d} 24 24)"/>`).join('')
        + `<g transform="rotate(${qDeg} 24 24)"><path d="M24 6 L28 24 L24 21 L20 24 Z" fill="#4ade80"/><circle cx="24" cy="24" r="3" fill="#fff"/></g></svg>`
        + `<span style="font-size:8.5px;color:var(--mute);font-weight:700">${esc(_t('QIBLA'))} ${qDeg}°</span></div>` : '')
      + `</div></div>`
      + `<div style="display:flex;flex-direction:column;gap:5px;min-height:0">`
      + `<div class="c sc-y" style="padding:4px 6px;gap:1px;flex:1;min-height:0;justify-content:space-between">`
      + keys.map((k) => {
        const isNext = !!(next && next.at === day[k]);
        const isDone = day[k] <= now && !isNext;
        const bellOn = listMap[k] !== false;
        const lbl = N.prayerName(names[k] || k);
        return `<div class="row prt-bento-row" style="${isNext ? 'background:rgba(74,222,128,0.13)' : ''};opacity:${isDone ? 0.52 : 1}">`
          + `<span class="prt-bento-ico" style="background:${isNext ? '#4ade80' : '#1d1d24'};color:${isNext ? '#000' : isDone ? '#4ade80' : 'var(--dim)'}">${N.ic(KEY_ICONS[k] || 'moon', 'width:11px;height:11px')}</span>`
          + `<span class="prt-bento-lbl t1" style="font-weight:${isNext ? 700 : 500};color:${isNext ? '#4ade80' : '#fff'}">${esc(lbl)}</span>`
          + `${isDone ? '<span style="font-size:10px;color:#4ade80;font-weight:700">✓</span>' : ''}`
          + `<b class="n prt-bento-tm" style="color:${isNext ? '#4ade80' : '#fff'}">${esc(N.hm(day[k]))}</b>`
          + `<button type="button" data-pbell="${k}" title="${esc(bellOn ? _t('Reminder on') : _t('Reminder off'))}" style="color:${!bellOn ? 'var(--mute)' : isNext ? '#4ade80' : 'var(--dim)'};opacity:${bellOn ? 1 : 0.4};cursor:pointer">${N.ic('bell', 'width:11px;height:11px')}</button></div>`;
      }).join('')
      + `</div>`
      + (extras.length ? `<div class="row" style="gap:5px;min-width:0;flex:none">${extras.map(([lbl, tm]) => `<div class="row prt-bento-extra"><span class="t1" style="font-size:9.5px;color:var(--mute);font-weight:600">${esc(lbl)}</span><b class="n" style="font-size:10.5px;flex:none">${esc(tm)}</b></div>`).join('')}</div>` : '')
      + `</div></div>`;

    bindCommon(beforeOptsShort);
  }

  let lastKey = '';
  function second() {
    const next = N.nextPrayer();
    const key = `${next ? next.id : ''}|${Math.floor(Date.now() / 60000)}`;
    if (key !== lastKey) { lastKey = key; render(); return; }
    const el = page && $('#prtLeft', page);
    if (el && next) {
      const cd = clockParts(next.at - Date.now());
      el.innerHTML = el.dataset.mode === 'plain'
        ? `${esc(cd.hm)}:${esc(cd.sec)}`
        : `${esc(cd.hm)}<span style="font-size:0.6em;color:#4ade8099">:${esc(cd.sec)}</span>`;
    }
  }

  // ------------------------------------------------------------ 1×2 Sun-path Prayer Card
  const cards = new Set();
  let cardTick = null;

  function ensureCardTick() {
    if (cardTick) return;
    cardTick = setInterval(() => {
      if (!st.open || !cards.size) return;
      refreshCards();
    }, 30000);
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#4ade80');
    const p = st.prayer;
    const next = N.nextPrayer();
    const now = Date.now();

    if (!p || !p.ok) {
      el.innerHTML = `${N.hd('moon', _t('Prayer'))}`
        + `<div style="margin-top:auto"><div class="big" style="font-size:28px">--.--</div>`
        + `<div class="sub" style="margin-top:4px">${esc((p && p.error) || _t('Loading…'))}</div></div>`;
      return;
    }

    const names = p.names || {};
    const { day } = activeDay(p, now);
    const keys = KEYS.filter((k) => day[k]);
    const nowT = sunProgress(day, now);
    const at = (t) => { const a = Math.PI * (1 - t); return [61 + 52 * Math.cos(a), 56 - 46 * Math.sin(a)]; };
    const [sx, sy] = at(nowT);
    const placeShort = p.place ? String(p.place).split(',')[0].trim() : '';
    const headTitle = placeShort ? `${_t('Prayer')} · ${placeShort}` : _t('Prayer');

    const mins = next ? Math.max(1, Math.ceil((next.at - now) / 60000)) : 0;
    const leftStr = next
      ? (mins >= 60 ? _t('in {h}h {m}m', { h: Math.floor(mins / 60), m: mins % 60 }) : _t('in {n}m', { n: mins }))
      : '';

    const nextIdx = next ? keys.findIndex((k) => day[k] === next.at) : -1;
    const following = (nextIdx >= 0 ? keys.slice(nextIdx + 1, nextIdx + 3) : keys.slice(-2)).map((k) => [N.prayerName(names[k] || k), N.hm(day[k])]);

    el.innerHTML = `${N.hd('moon', headTitle)}`
      + `<svg viewBox="0 0 122 62" style="width:100%;height:56px;margin-top:6px;overflow:visible">`
      + `<path d="M9 56 A52 46 0 0 1 113 56" fill="none" stroke="#24242c" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`
      + `<path d="M9 56 A52 46 0 0 1 ${sx.toFixed(1)} ${sy.toFixed(1)}" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round"/>`
      + `<line x1="2" y1="56" x2="120" y2="56" stroke="#24242c" stroke-width="1.5"/>`
      + keys.map((k) => {
        const t = prayerPos(day, k);
        const [x, y] = at(t);
        const isNext = !!(next && next.at === day[k]);
        const isDone = day[k] <= now && !isNext;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isNext ? 3.5 : 2.5}" fill="${isDone ? '#4ade80' : isNext ? '#fff' : '#3a3a44'}"/>`;
      }).join('')
      + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#fbbf24"/>`
      + `</svg>`
      + `<div style="margin-top:8px"><div class="sub t1" style="color:var(--text);font-weight:600">${esc(next ? N.prayerName(next.name) : _t('Prayer'))}</div>`
      + `<div class="big" style="font-size:30px;margin-top:2px">${esc(next ? N.hm(next.at) : '--.--')}</div></div>`
      + (leftStr ? `<span class="pill" style="background:rgba(74,222,128,0.14);color:#4ade80;margin-top:6px">${esc(leftStr)}</span>` : '')
      + `<div style="margin-top:auto;display:flex;flex-direction:column;gap:4px">`
      + following.map(([nm, tm]) => `<div class="row" style="justify-content:space-between;font-size:12px"><span class="dim">${esc(nm)}</span><b class="n" style="font-size:12px">${esc(tm)}</b></div>`).join('')
      + `</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'prayer',
    init(p) { page = p; },
    show() { lastKey = ''; render(); clearInterval(tick); tick = setInterval(second, 1000); },
    hide() { clearInterval(tick); },
    update() { render(); refreshCards(); },
    onSettings() { render(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      ensureCardTick();
      N.cardClick(el, () => N.openModule('prayer'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
