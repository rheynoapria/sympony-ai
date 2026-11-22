// World clock tab: the time here first, then each place of the world clock (`worldClocks`, the same list as
// Settings → General → Clock, the Dashboard widget and the side slot): its name, the time there, day or night, how far
// from here (and the day, when it isn't today there). Each place has a strip of this PC's day, 00 to 24, coloured by
// night and day there, with a tick at now; pointing at the strips shows every place's time at that moment ("when it's
// 15:00 here"), a click or a drag keeps it until Now. Places are added, renamed, moved and removed right here. The
// times come from clock.js (window.SymponyClock, Windows' own time zone data); the page ticks once a minute, on the minute,
// and only while it shows.
(function () {
  const { st, api, $, $$, esc, fa } = N;
  const MIN = 60000;
  const DAY_MIN = 1440;
  let page;
  let tick = 0;
  let shape = '';      // what the page was built from: built again only when that changes
  let editing = false; // the rename / move / remove buttons in place of the strips
  let adding = false;  // the add box in place of the line at the top
  let hoverAt = null;  // minutes into today here under the pointer on a strip, or null
  let keepAt = null;   // …kept by a click or a drag, until Now
  let dragging = false;
  let sug = null;      // the add box's suggestions: { box, found, at }

  const W = () => window.SymponyClock;
  const shown = () => !!(page && st.open && st.page === 'worldclock');
  const h24 = () => !st.settings || st.settings.clock24h !== false;
  const places = () => (W() && st.settings ? W().places(st.settings) : []);
  const save = (l) => api.setSettings({ worldClocks: l.slice(0, W().MAX) });
  const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
  // a time `m` minutes into today on this PC's clock (a day with a summer time change still gets 24 hours here)
  const atMinute = (now, m) => { const d = new Date(now); d.setHours(0, m, 0, 0); return d.getTime(); };
  const minuteOf = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
  const nightHere = (t) => { const h = new Date(t).getHours(); return h < 6 || h >= 18; };
  const sign = (night) => fa(night ? 'moon' : 'sun');
  // a time big, its AM / PM (in any language) small beside it
  const clock = (s) => String(s).split(/([^\d:.\s]+)/).map((p, i) => (i % 2 ? `<small>${esc(p)}</small>` : esc(p))).join('');
  const pct = (m) => `${(m / DAY_MIN) * 100}%`;
  // the places fade out at the bottom while more of them are below (no scroll bar, like the calendar's events)
  function fade() { const l = page && $('.wk-list', page); if (l) l.classList.toggle('more', l.scrollTop + l.clientHeight < l.scrollHeight - 2); }
  const sized = new ResizeObserver(fade);

  // A place's strip: this PC's day from 00 to 24, night there dark and day light (6 to 18 there, like the sun and
  // moon), an hour of dusk and dawn blended. `diff`: minutes it's ahead of here.
  function stripBg(diff) {
    const NIGHT = 'var(--wk-night)'; const DAY = 'var(--wk-day)';
    const wrap = (m) => ((m % DAY_MIN) + DAY_MIN) % DAY_MIN;
    const up = wrap(360 - diff); const down = wrap(1080 - diff);
    const p = (m) => `${((m / DAY_MIN) * 100).toFixed(2)}%`;
    const turn = (m, from, to) => `${from} ${p(m - 30)}, ${to} ${p(m + 30)}`;
    const stops = up < down
      ? [`${NIGHT} 0%`, turn(up, NIGHT, DAY), turn(down, DAY, NIGHT), `${NIGHT} 100%`]
      : [`${DAY} 0%`, turn(down, DAY, NIGHT), turn(up, NIGHT, DAY), `${DAY} 100%`];
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  // the hours along the top of the strips: 06, 12 and 18 here
  function axis(now) {
    return [6, 12, 18].map((h) => `<span style="left:${pct(h * 60)}">${esc(new Date(atMinute(now, h * 60)).toLocaleTimeString(_tLocale(), { hour: h24() ? '2-digit' : 'numeric', hourCycle: h24() ? 'h23' : 'h12' }))}</span>`).join('');
  }

  function row(p, i, n) {
    const tools = i < 0 ? '<span></span>' : `<span class="wk-tools"><button class="wk-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="${_t('Move up')}">${fa('chevron-up')}</button><button class="wk-btn" data-down="${i}" ${i === n - 1 ? 'disabled' : ''} title="${_t('Move down')}">${fa('chevron-down')}</button><button class="wk-btn del" data-rm="${i}" title="${_t('Remove')}">${fa('xmark')}</button></span>`;
    const name = editing && i >= 0
      ? `<input type="text" class="wk-rn" data-rn="${i}" value="${esc(p.name)}" maxlength="30" spellcheck="false" title="${esc(p.tz.replace(/_/g, ' '))}">`
      : `<b>${esc(p.name)}</b>`;
    return `<div class="wk-row${i < 0 ? ' here' : ''}" data-tz="${esc(p.tz)}">
      <span class="wk-ic"></span><span class="wk-name" ${i < 0 ? '' : `title="${esc(p.tz.replace(/_/g, ' '))}"`}>${name}<small class="wk-sub"></small></span><span class="wk-time"></span>
      ${editing ? tools : '<span class="wk-strip"><i class="wk-tick"></i><i class="wk-mark"></i></span>'}</div>`;
  }

  function analogClock(tz, t, size = 40, ticks = false) {
    let h = new Date(t).getHours();
    let m = new Date(t).getMinutes();
    if (tz) {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
        h = Number(parts.find((p) => p.type === 'hour')?.value ?? h);
        m = Number(parts.find((p) => p.type === 'minute')?.value ?? m);
      } catch { /* fallback local */ }
    }
    const night = h < 6 || h >= 18;
    const hAng = (((h % 12) + m / 60) / 12) * 2 * Math.PI;
    const mAng = (m / 60) * 2 * Math.PI;
    const tickHtml = ticks ? [0, 90, 180, 270].map((d) => `<line x1="20" y1="3" x2="20" y2="6" stroke="${night ? '#55555e' : '#bbb'}" stroke-width="1.5" transform="rotate(${d} 20 20)"/>`).join('') : '';
    return `<svg viewBox="0 0 40 40" style="width:${size}px;height:${size}px;flex:none"><circle cx="20" cy="20" r="19" fill="${night ? '#16161c' : '#f5f5f7'}"/>${tickHtml}`
      + `<line x1="20" y1="20" x2="${(20 + 9 * Math.sin(hAng)).toFixed(1)}" y2="${(20 - 9 * Math.cos(hAng)).toFixed(1)}" stroke="${night ? '#fff' : '#000'}" stroke-width="2.6" stroke-linecap="round"/>`
      + `<line x1="20" y1="20" x2="${(20 + 14 * Math.sin(mAng)).toFixed(1)}" y2="${(20 - 14 * Math.cos(mAng)).toFixed(1)}" stroke="${night ? '#fff' : '#000'}" stroke-width="1.6" stroke-linecap="round"/>`
      + `<circle cx="20" cy="20" r="2" fill="#fb923c"/></svg>`;
  }

  function build() {
    if (!page || !W()) return;
    const list = places();
    const full = list.length >= W().MAX;
    if (full) adding = false;
    shape = JSON.stringify([list, h24(), editing, adding]);
    closeSug();
    const now = Date.now();
    const at = hoverAt != null ? hoverAt : keepAt;
    const t = at != null ? atMinute(now, at) : now;
    const localName = (localTz() ? W().cityOf(localTz()) : '') || _t('Here');
    const allCities = [{ name: localName, tz: '', local: true }, ...list];
    const workColors = ['#8fa2ff', '#4ade80', '#fb923c', '#c9b6ff'];

    const cardsHtml = allCities.map((c, idx) => {
      const info = c.tz ? W().info(c.tz, t) : { night: nightHere(t), diff: 0 };
      const tm = W().time(c.tz || undefined, t, h24());
      const sub = c.local ? `0h · ${_t('You')}` : W().diffLine(info);
      const rmBtn = !c.local
        ? `<button type="button" data-rm="${idx - 1}" title="${esc(_t('Remove'))}" style="position:absolute;top:6px;right:6px;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.08);color:var(--dim);font-size:9px;display:grid;place-items:center;cursor:pointer">×</button>`
        : '';
      return `<div class="c" style="padding:8px;position:relative;flex:0 0 calc((100% - 24px) / 4);min-width:142px">`
        + `${rmBtn}<div style="display:flex;flex-direction:column;align-items:center;gap:4px;margin:auto 0">`
        + `${analogClock(c.tz, t, 52, true)}<b class="t1" style="font-size:12.5px;margin-top:2px;max-width:100%">${esc(c.name)}</b>`
        + `<span class="big" style="font-size:18px">${esc(tm)}</span>`
        + `<span class="sub t1" style="font-size:10px;max-width:100%">${esc(sub)}</span></div></div>`;
    }).join('');

    const bandsHtml = allCities.slice(0, 4).map((c, k) => {
      const diff = c.tz ? W().info(c.tz, now).diff : 0;
      const startM = (((540 - diff) % DAY_MIN) + DAY_MIN) % DAY_MIN; // 09:00 local in that zone
      const l = (startM / DAY_MIN) * 100;
      const w = (480 / DAY_MIN) * 100; // 8h workday
      return `<i style="position:absolute;top:3px;bottom:3px;left:${l.toFixed(1)}%;width:${Math.min(100 - l, w).toFixed(1)}%;border-radius:3px;background:${workColors[k % workColors.length]}55"></i>`;
    }).join('');
    const nowPct = ((at != null ? at : minuteOf(now)) / DAY_MIN) * 100;

    page.innerHTML = `<div class="wk" style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%">`
      + `<div class="sc-x" style="display:flex;gap:8px;flex:1;min-height:0">${cardsHtml}</div>`
      + `<div class="c" style="padding:8px 12px;flex:none;gap:6px">`
      + (adding
        ? `<div class="row" style="gap:6px"><input type="text" class="field wk-add" placeholder="${esc(_t('Add a city…'))}" autocomplete="off" spellcheck="false" style="flex:1;height:24px;border-radius:7px;background:var(--pill);border:0;padding:0 8px;font-size:12px"><button type="button" class="sbtn" data-act="noadd" style="height:24px;padding:0 8px">${esc(_t('Close'))}</button></div>`
        : `<div class="row" style="gap:8px;font-size:10px;color:var(--mute)">`
          + `<span style="flex:none">${esc(at != null ? W().time(undefined, t, h24()) : _t('Work hours'))}</span>`
          + `<div class="wk-strip" style="flex:1;position:relative;height:16px;border-radius:5px;background:#1a1a20;overflow:hidden;cursor:ew-resize">${bandsHtml}<i style="position:absolute;top:0;bottom:0;left:${nowPct.toFixed(1)}%;width:2px;background:#fff"></i></div>`
          + (keepAt != null ? `<button type="button" class="sbtn" data-act="now" style="height:20px;padding:0 7px;font-size:10px">${esc(_t('Now'))}</button>` : '')
          + `<button type="button" class="sbtn" data-act="add" ${full ? 'disabled' : ''} style="height:20px;padding:0 8px;font-size:10px">${N.ic('plus', 'width:10px;height:10px')}${esc(_t('City'))}</button>`
          + `</div>`)
      + `</div></div>`;

    $$('[data-rm]', page).forEach((b) => { b.onclick = () => save(places().filter((_, k) => k !== +b.dataset.rm)); });
    const box = $('.wk-add', page);
    if (box) suggest(box);
  }

  function paint() { build(); }

  // ------------------------------------------------------------------ pointer scrubbing on the work-hours strip
  function minuteAt(e, strip) {
    const s = strip || (e.target && e.target.closest && e.target.closest('.wk-strip'));
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    return Math.min(DAY_MIN - 15, Math.round((f * DAY_MIN) / 15) * 15);
  }
  function point(e) {
    if (dragging) { const m = minuteAt(e, dragging); if (m !== keepAt) { keepAt = m; paint(); } return; }
    if (e.pointerType === 'touch') return;
    const m = minuteAt(e);
    if (m !== hoverAt) { hoverAt = m; paint(); }
  }
  function press(e) {
    const s = e.button === 0 && e.target.closest && e.target.closest('.wk-strip');
    if (!s) return;
    e.preventDefault();
    dragging = s;
    try { s.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    if (e.pointerType !== 'touch') { hoverAt = null; keepAt = minuteAt(e, s); paint(); }
  }
  function release(e) {
    if (dragging && e.type === 'pointerup' && e.pointerType === 'touch') { keepAt = minuteAt(e, dragging); paint(); }
    dragging = false;
  }
  function leave() { if (!dragging && hoverAt != null) { hoverAt = null; paint(); } }
  function toNow() { hoverAt = null; keepAt = null; dragging = false; paint(); }

  // ------------------------------------------------------------------ adding a place
  function suggest(box) {
    let timer = 0;
    const find = () => {
      const q = box.value.trim();
      clearTimeout(timer);
      if (q.length < 3) { closeSug(); return; }
      timer = setTimeout(() => { if (box.isConnected) openSug(box, W().search(q, 5)); }, 120);
    };
    box.addEventListener('input', find);
    box.addEventListener('blur', () => { clearTimeout(timer); setTimeout(closeSug, 0); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sug) { e.stopPropagation(); closeSug(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const z = sug && sug.at >= 0 ? sug.found[sug.at] : W().search(box.value, 1)[0];
        if (z) add(z);
        return;
      }
      if (!sug || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const n = sug.found.length;
      sug.at = e.key === 'ArrowDown' ? (sug.at + 1) % n : (sug.at <= 0 ? n : sug.at) - 1;
      paintSug();
    });
  }
  function add(z) {
    closeSug();
    const list = places();
    adding = false;
    if (z && !list.some((p) => p.tz === z.tz && p.name === z.name) && list.length < W().MAX) save([...list, { name: z.name, tz: z.tz }]);
    else build();
  }
  function openSug(box, found) {
    if (!found.length) { closeSug(); return; }
    if (!sug) {
      const menu = document.createElement('div');
      menu.className = 'pick-menu wk-sug';
      menu.addEventListener('mousedown', (e) => e.preventDefault());
      menu.onclick = (e) => { const b = e.target.closest('[data-s]'); if (b && sug) add(sug.found[+b.dataset.s]); };
      page.appendChild(menu);
      sug = { menu };
    }
    Object.assign(sug, { box, found, at: -1 });
    paintSug();
    const pr = page.getBoundingClientRect(); const br = box.getBoundingClientRect(); const m = sug.menu;
    const below = pr.bottom - br.bottom - 4; const h = m.offsetHeight;
    m.style.top = `${h <= below || br.top - pr.top < h ? br.bottom - pr.top + 4 : br.top - pr.top - 4 - h}px`;
    m.style.left = `${Math.max(0, Math.min(br.left - pr.left, pr.width - m.offsetWidth))}px`;
  }
  function paintSug() {
    if (!sug) return;
    const now = Date.now();
    sug.menu.innerHTML = sug.found.map((z, i) => `<button type="button" data-s="${i}" class="${i === sug.at ? 'on' : ''}">${fa('clock', 'regular')}<span>${esc(z.name)}</span><small>${esc(z.tz.replace(/_/g, ' '))} · ${esc(W().time(z.tz, now, h24()))}</small></button>`).join('');
  }
  function closeSug() { if (sug) { sug.menu.remove(); sug = null; } }

  // ------------------------------------------------------------ 1×1 Dual Analog Clock Card (matches modules.html)
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
    el.style.setProperty('--tint', '#9eeaff');
    el.style.flexDirection = 'row';
    el.style.justifyContent = 'space-around';
    el.style.alignItems = 'center';
    const w = W();
    const now = Date.now();
    const list = places().slice(0, 2);
    if (!w || !list.length) {
      const localName = (localTz() ? (w ? w.cityOf(localTz()) : '') : '') || _t('Local');
      el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">${analogClock('', now, 42, false)}<span style="font-size:11px;font-weight:600">${esc(localName)}</span><span style="font-size:9.5px;color:var(--mute)">${esc(N.hm(now))}</span></div>`;
      return;
    }
    el.innerHTML = list.map((c) => {
      const info = w.info(c.tz, now);
      const diffH = Math.round((info.diff || 0) / 60);
      const diffStr = diffH === 0 ? '0h' : (diffH > 0 ? `+${diffH}h` : `−${Math.abs(diffH)}h`);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0">${analogClock(c.tz, now, 40, false)}<span class="t1" style="font-size:11px;font-weight:600;max-width:62px">${esc(c.name)}</span><span style="font-size:9.5px;color:var(--mute)">${esc(diffStr)}</span></div>`;
    }).join('');
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'worldclock',
    tall: true,
    init(p) {
      page = p;
      page.addEventListener('pointermove', point);
      page.addEventListener('pointerdown', press);
      page.addEventListener('pointerup', release);
      page.addEventListener('pointercancel', release);
      page.addEventListener('pointerleave', leave);
      page.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'now') { toNow(); return; }
        if (act === 'edit') editing = !editing;
        if (act === 'add') { adding = true; editing = false; }
        if (act === 'noadd') adding = false;
        build();
        const box = adding && $('.wk-add', page);
        if (box) N.focusField(box);
      });
    },
    // built afresh each time it shows, then every minute on the minute while it shows
    show() {
      hoverAt = null; keepAt = null; dragging = false;
      build();
      const next = () => {
        clearTimeout(tick);
        tick = setTimeout(() => { tick = 0; if (!shown()) return; paint(true); next(); }, MIN - (Date.now() % MIN) + 50);
      };
      next();
    },
    hide() {
      clearTimeout(tick); tick = 0;
      closeSug(); sized.disconnect();
      adding = false; editing = false; hoverAt = null; keepAt = null; dragging = false;
    },
    update() { if (shown()) paint(true); refreshCards(); },
    // the places changed (here or in Settings) or 24-hour time: built again while it shows
    onSettings() {
      refreshCards();
      if (!shown() || !W()) return;
      if (JSON.stringify([places(), h24(), editing, adding]) !== shape) build();
    },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      ensureCardTick();
      N.cardClick(el, () => N.openModule('worldclock'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
