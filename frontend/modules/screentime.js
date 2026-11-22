// Screen Time: 1×1 segmented app-bar + real icons card + 632×218 2-column section.
(function () {
  const { api, $, $$, esc, fa } = N;
  let page;
  let range = 'today';
  let timer;
  const PALETTE = ['#4361ff', '#d97757', '#fbbf24', '#4ade80', '#c9b6ff', '#60a5fa'];

  const cards = new Set();
  let lastSummary = null;
  let fetchedAt = 0;

  function fetchCardSummary(force) {
    const now = Date.now();
    if (!force && lastSummary && now - fetchedAt < 10000) return;
    fetchedAt = now;
    api.svc('screentime', 'summary', 'today').then((s) => {
      if (s && typeof s.total === 'number') {
        lastSummary = s;
        renderCards();
      }
    }).catch(() => {});
  }

  function bucket7(hours) {
    const arr = Array.isArray(hours) && hours.length ? hours : new Array(24).fill(0);
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    for (let h = 0; h < Math.min(24, arr.length); h++) {
      const idx = Math.min(6, Math.floor((h * 7) / 24));
      buckets[idx] += Number(arr[h]) || 0;
    }
    return buckets;
  }

  function appIconHtml(a, size) {
    if (a && a.icon) return `<img class="appic" src="${esc(a.icon)}" style="width:${size}px;height:${size}px" alt="">`;
    return N.realAppIcon ? N.realAppIcon((a && (a.bundleId || a.name)) || '', size, fa('window-maximize', 'regular')) : fa('window-maximize', 'regular');
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#8fa2ff');
    const s = lastSummary;
    const total = s ? s.total : 0;
    const apps = (s && Array.isArray(s.apps) ? s.apps : []);
    const top3 = apps.slice(0, 3);
    const rest = Math.max(0, apps.length - 3);
    const topSum = top3.reduce((acc, a) => acc + (a.secs || 0), 0);
    const otherSecs = Math.max(0, total - topSum);
    const segs = top3.map((a, i) => [PALETTE[i % PALETTE.length], Math.max(5, a.secs || 0)]);
    if (otherSecs > 0 || !segs.length) segs.push(['#3a3a44', Math.max(10, otherSecs || 100)]);

    el.innerHTML = `${N.hd('hour', _t('Screen today'))}`
      + `<div class="big" style="font-size:22px;margin-top:5px">${esc(N.dur(total))}</div>`
      + `<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:2px;margin-top:auto">${segs.map(([col, flex]) => `<i style="flex:${flex};background:${col}"></i>`).join('')}</div>`
      + `<div class="row" style="gap:4px;margin-top:6px">${top3.map((a) => appIconHtml(a, 15)).join('')}${rest > 0 ? `<span style="font-size:10px;color:var(--mute);margin-left:2px">+${rest}</span>` : (!top3.length ? `<span class="sub" style="font-size:10px">${esc(_t('No data yet'))}</span>` : '')}</div>`;
  }

  function renderCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  async function load() {
    const s = await api.svc('screentime', 'summary', range).catch(() => null);
    if (!page) return;
    if (!s || !Array.isArray(s.hours)) {
      page.innerHTML = `<div class="c" style="flex:1;justify-content:center;align-items:center;text-align:center;gap:6px"><span style="color:#8fa2ff">${N.ic('hour', 'width:24px;height:24px')}</span><span class="sub">${esc(_t('Screen Time starts counting now.'))}</span></div>`;
      return;
    }
    if (range === 'today') { lastSummary = s; fetchedAt = Date.now(); renderCards(); }
    const apps = Array.isArray(s.apps) ? s.apps : [];
    const maxApp = Math.max(1, ...apps.map((a) => a.secs || 0));
    const b7 = bucket7(s.hours);
    const maxB = Math.max(1, ...b7);
    const curIdx = Math.min(6, Math.floor((new Date().getHours() * 7) / 24));
    const hasB = b7.some((v) => v > 0);

    page.innerHTML = `<div style="display:grid;grid-template-columns:180px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c">`
      + `<div class="row" style="justify-content:space-between">${N.hd('hour', range === 'today' ? _t('Today') : _t('7 days'))}</div>`
      + `<div class="big" style="font-size:32px;margin-top:8px">${esc(N.dur(s.total))}</div>`
      + `<div class="sub t1" style="margin-top:4px">${esc(_t('{n} app switches', { n: s.switches || 0 }))}</div>`
      + `<div class="seg2" style="margin-top:8px;align-self:flex-start"><button type="button" data-r="today" class="${range === 'today' ? 'on' : ''}" style="height:22px;padding:0 8px;font-size:10.5px">${esc(_t('Today'))}</button><button type="button" data-r="week" class="${range === 'week' ? 'on' : ''}" style="height:22px;padding:0 8px;font-size:10.5px">${esc(_t('7 days'))}</button></div>`
      + `<div style="display:flex;align-items:flex-end;gap:4px;height:40px;margin-top:auto">${b7.map((v, k) => `<i style="flex:1;height:${hasB ? Math.max(12, Math.round((v / maxB) * 100)) : 16}%;border-radius:3px;background:${k === curIdx ? '#8fa2ff' : '#24242c'}"></i>`).join('')}</div>`
      + `</div>`
      + `<div class="c sc-y" style="padding:10px 12px;gap:2px">`
      + (apps.length
        ? apps.slice(0, 8).map((a, i) => `<div class="row" style="gap:9px;padding:3px 0">${appIconHtml(a, 20)}<div style="flex:1;min-width:0">`
          + `<div class="row" style="justify-content:space-between;font-size:12px"><span class="t1">${esc(a.name)}</span><b class="n" style="font-size:11.5px;flex:none">${esc(N.dur(a.secs))}</b></div>`
          + `<div class="bar" style="height:4px;margin-top:3px"><i style="background:${PALETTE[i % PALETTE.length]};transform:scaleX(${Math.max(0.03, (a.secs || 0) / maxApp)})"></i></div></div></div>`).join('')
        : `<div class="sub" style="margin:auto;text-align:center">${esc(_t('Screen Time starts counting now.'))}</div>`)
      + `</div></div>`;
    $$('[data-r]', page).forEach((b) => { b.onclick = () => { range = b.dataset.r; load(); }; });
  }

  N.register({
    id: 'screentime',
    tall: true,
    init(p) { page = p; },
    show() { load(); clearInterval(timer); timer = setInterval(load, 10000); },
    hide() { clearInterval(timer); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('screentime'));
      paintCard(slot);
      fetchCardSummary(false);
    },
    refreshCards() { renderCards(); fetchCardSummary(false); },
  });
})();
