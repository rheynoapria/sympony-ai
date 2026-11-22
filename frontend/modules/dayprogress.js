// Day Progress: 1×1 day-arc card + 632×218 section (percentage + segmented day bar + 3 summary tiles).
(function () {
  const { st, $, esc } = N;
  let page;
  let timer;

  function periodFrac(kind) {
    const now = new Date();
    let a; let b;
    if (kind === 'week') { a = new Date(now); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() - ((a.getDay() + 6) % 7)); b = new Date(a); b.setDate(b.getDate() + 7); }
    if (kind === 'month') { a = new Date(now.getFullYear(), now.getMonth(), 1); b = new Date(now.getFullYear(), now.getMonth() + 1, 1); }
    if (kind === 'year') { a = new Date(now.getFullYear(), 0, 1); b = new Date(now.getFullYear() + 1, 0, 1); }
    return Math.max(0, Math.min(1, (now - a) / (b - a)));
  }

  function render() {
    if (!page) return;
    const d = N.dayInfo();
    const pct = Math.round(d.frac * 100);
    const now = Date.now();
    const h = Math.floor(d.left / 3600000);
    const m = Math.floor((d.left % 3600000) / 60000);
    const remStr = d.left ? _t('{h}h {m}m', { h, m }) : _t('0m');
    const wakeStr = N.hm(d.wake);
    const bedStr = N.hm(d.bed);
    const ticks = [];
    for (let k = 0; k <= 5; k++) ticks.push(N.hm(d.wake + ((d.bed - d.wake) * k) / 5));

    const nextEv = (st.events || []).filter((e) => !e.allDay && e.end > now && e.start < d.bed).sort((a, b) => a.start - b.start)[0];
    const nextPr = N.nextPrayer ? N.nextPrayer() : null;
    const wkPct = Math.round(periodFrac('week') * 100);
    const moPct = Math.round(periodFrac('month') * 100);
    const yrPct = Math.round(periodFrac('year') * 100);

    const tile1 = nextEv
      ? [_t('Next event'), N.hm(nextEv.start), '#8fa2ff', nextEv.title]
      : [_t('Week / Month'), `${wkPct}% · ${moPct}%`, '#8fa2ff', `${_t('Year')} ${yrPct}%`];
    const tile2 = nextPr
      ? [_t('Next prayer'), N.hm(nextPr.at), '#4ade80', N.prayerName ? N.prayerName(nextPr.name) : nextPr.name]
      : [_t('This year'), `${yrPct}%`, '#4ade80', `${_t('Month')} ${moPct}%`];
    const tile3 = [_t('Bedtime'), bedStr, '#c9b6ff', d.left ? _t('{left} left', { left: remStr }) : _t('Past bedtime')];

    const bands = [
      [_t('Morning'), 25, '#fbbf24'],
      [_t('Work'), 45, '#8fa2ff'],
      [_t('Evening'), 15, '#4ade80'],
      [_t('Night'), 15, '#c9b6ff'],
    ];

    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;height:100%;width:100%">`
      + `<div class="c" style="flex:none">`
      + `<div class="row" style="align-items:flex-end;gap:12px"><div class="big" style="font-size:44px">${pct}<span style="font-size:18px;color:var(--dim)">%</span></div>`
      + `<div style="padding-bottom:6px;min-width:0"><b>${esc(_t('of today elapsed'))}</b><div class="sub t1">${esc(_t('Wake {wake} · bed {bed} · {left} left', { wake: wakeStr, bed: bedStr, left: remStr }))}</div></div></div>`
      + `<div style="position:relative;height:30px;border-radius:9px;background:#1a1a20;margin-top:10px;overflow:hidden;display:flex">`
      + bands.map(([lbl, w, col]) => `<div style="flex:${w};border-right:2px solid #0f0f12;display:flex;align-items:center;padding-left:8px;font-size:10.5px;font-weight:700;color:${col};background:${col}1f">${esc(lbl)}</div>`).join('')
      + `<i style="position:absolute;top:0;bottom:0;left:${pct}%;width:2px;background:#fff"></i></div>`
      + `<div class="row n" style="justify-content:space-between;font-size:10px;color:var(--mute);margin-top:4px">${ticks.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`
      + `</div>`
      + `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:10px;flex:1;min-height:0">`
      + [tile1, tile2, tile3].map(([lbl, val, col, sub]) => `<div class="c" style="padding:10px 12px"><div class="sub t1" style="font-size:11px">${esc(lbl)}</div><div class="big t1" style="font-size:24px;color:${col};margin-top:auto">${esc(val)}</div><div class="sub t1" style="font-size:10.5px">${esc(sub)}</div></div>`).join('')
      + `</div></div>`;
  }

  // ------------------------------------------------------------ 1×1 Day Arc Card
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
    el.style.setProperty('--tint', '#c9b6ff');
    const d = N.dayInfo();
    const pct = Math.round(d.frac * 100);
    const t = d.frac;
    // Quadratic bezier (4,38) -> (61,-14) -> (118,38)
    const u = 1 - t;
    const sx = u * u * 4 + 2 * u * t * 61 + t * t * 118;
    const sy = u * u * 38 + 2 * u * t * -14 + t * t * 38;
    const h = Math.floor(d.left / 3600000);
    const m = Math.floor((d.left % 3600000) / 60000);
    const leftShort = d.left ? (h ? _t('{h}h left', { h }) : _t('{n}m left', { n: m })) : _t('Done');

    el.innerHTML = `${N.hd('day', _t('Today'), `${pct}%`)}`
      + `<svg viewBox="0 0 122 40" style="width:100%;height:38px;margin-top:6px;overflow:visible">`
      + `<path d="M4 38 Q61 -14 118 38" fill="none" stroke="#24242c" stroke-width="2.5"/>`
      + `<path d="M4 38 Q61 -14 118 38" fill="none" stroke="#c9b6ff" stroke-width="2.5" pathLength="100" stroke-dasharray="${pct} 100" stroke-linecap="round"/>`
      + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="#fbbf24"/></svg>`
      + `<div class="row" style="justify-content:space-between;font-size:10.5px;color:var(--dim);margin-top:auto">`
      + `<span class="n">${esc(N.hm(d.wake))}</span><b style="color:#fff;font-weight:600">${esc(leftShort)}</b><span class="n">${esc(N.hm(d.bed))}</span></div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'dayprogress',
    tall: true,
    init(p) { page = p; N.watch('todo', () => { if (st.open && st.page === 'dayprogress') render(); }); },
    show() { render(); clearInterval(timer); timer = setInterval(render, 30000); },
    hide() { clearInterval(timer); },
    update() { if (st.open && st.page === 'dayprogress') render(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      ensureCardTick();
      N.cardClick(el, () => N.openModule('dayprogress'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
