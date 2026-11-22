// GitHub: 1×1 contribution-grid card + 632×218 2-column PR review + contribution activity section.
(function () {
  const { api, st, $, $$, esc } = N;
  let page;

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return _t('{n}m ago', { n: m });
    if (m < 1440) return _t('{n}h ago', { n: Math.round(m / 60) });
    return _t('{n}d ago', { n: Math.round(m / 1440) });
  }

  const SHADES = ['#1a1a20', '#14532d', '#16a34a', '#22c55e', '#4ade80'];

  function activityCells(items, total) {
    // Derive a deterministic activity heat pattern from real PR updated timestamps (or quiet grid if empty)
    const buckets = new Array(total).fill(0);
    const now = Date.now();
    for (const it of items) {
      const daysAgo = Math.max(0, Math.min(total - 1, Math.floor((now - (it.updated || now)) / 86400000)));
      const pos = total - 1 - daysAgo;
      buckets[pos] = Math.min(4, buckets[pos] + 2);
      if (pos > 0) buckets[pos - 1] = Math.min(4, buckets[pos - 1] + 1);
    }
    return buckets.map((v) => `<i style="aspect-ratio:1;border-radius:2px;background:${SHADES[v]}"></i>`).join('');
  }

  function render(g) {
    if (!page) return;
    g = g || N.data.github || {};
    const items = g.items || [];
    const review = items.filter((i) => i.kind === 'review').length;
    let leftInner = '';

    if (!st.settings.has_githubToken || g.needsSetup) {
      leftInner = `<div style="margin:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">`
        + `<span class="sub">${esc(_t('Add a GitHub token in Settings → GitHub to see pull requests.'))}</span>`
        + `<button type="button" class="sbtn p" id="ghSetup">${esc(_t('Set up'))}</button></div>`;
    } else if (g.error && !items.length) {
      leftInner = `<div class="sub" style="margin:auto;text-align:center">${esc(g.error)}</div>`;
    } else if (!items.length) {
      leftInner = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('No pull requests waiting. Inbox zero! 🎉'))}</div>`;
    } else {
      leftInner = `<div class="sc-y" style="display:flex;flex-direction:column;gap:5px;margin-top:8px;flex:1">`
        + items.map((i) => {
          const col = i.draft ? '#8b8b94' : i.kind === 'mine' ? '#60a5fa' : '#4ade80';
          const tag = i.kind === 'mine' ? _t('YOURS') : i.draft ? _t('DRAFT') : _t('REVIEW');
          return `<div class="row gh-item" data-url="${esc(i.url)}" style="gap:9px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,0.035);cursor:pointer">`
            + `<span style="color:${col};flex:none">${N.ic('git', 'width:13px;height:13px')}</span>`
            + `<div style="flex:1;min-width:0"><div class="t1" style="font-size:12.5px;font-weight:600">${esc(i.title)}</div>`
            + `<div class="sub t1" style="font-size:10.5px">${esc(i.repo)} #${i.number} · ${esc(ago(i.updated))}</div></div>`
            + `<span class="pill" style="background:${col}22;color:${col}">${esc(tag)}</span></div>`;
        }).join('') + `</div>`;
    }

    page.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c"><div class="row" style="justify-content:space-between">${N.hd('git', _t('Waiting for review'), `${review} PR`)}<button type="button" class="sbtn" id="ghRefresh" style="height:22px;padding:0 8px;font-size:10.5px">${esc(_t('Refresh'))}</button></div>${leftInner}</div>`
      + `<div class="c">${N.hd('git', _t('Activity'), items.length ? _t('{n} open', { n: items.length }) : '')}`
      + `<div style="display:grid;grid-template-columns:repeat(15,1fr);gap:3px;margin-top:auto">${activityCells(items, 105)}</div></div></div>`;

    const setup = $('#ghSetup', page);
    if (setup) setup.onclick = () => api.openSettings('github');
    const ref = $('#ghRefresh', page);
    if (ref) ref.onclick = async () => { render(await api.svc('github', 'refresh').catch(() => null)); };
    $$('.gh-item', page).forEach((el) => { el.onclick = () => { api.openExternal(el.dataset.url); N.closeNotch(); }; });
  }

  // ------------------------------------------------------------ 1×1 GitHub card
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('github', () => refreshCards());
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#4ade80');
    const g = N.data.github || {};
    const items = g.items || [];
    const review = items.filter((i) => i.kind === 'review').length;
    const sub = !st.settings.has_githubToken || g.needsSetup
      ? _t('Set up in Settings')
      : items.length ? _t('{n} review · {mine} yours', { n: review, mine: items.length - review })
      : _t('Inbox zero');

    el.innerHTML = `${N.hd('git', 'GitHub', `${items.length} PR`)}`
      + `<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:2.5px;margin-top:auto">${activityCells(items, 48)}</div>`
      + `<div class="sub t1" style="margin-top:5px">${esc(sub)}</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'github',
    tall: true,
    init(p) { page = p; N.watch('github', render); },
    show() { render(); },
    onSettings() { render(); refreshCards(); },
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('github'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
