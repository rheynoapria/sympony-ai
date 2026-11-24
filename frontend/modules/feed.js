// Feed & RSS: 2×1 headline card + 2-column OLED Notch reader (Hacker News, GitHub Trending,
// Google News Indonesia + custom topics, Indonesian news portals, custom RSS/Atom) with authentic
// brand SVG icons & cached origin favicons, plus on-demand 3-bullet "Ringkas dengan Pony".
(function () {
  const { api, st, $, $$, esc, fa } = N;
  let page;
  let activeFilter = 'all';
  let selectedId = '';
  let refreshing = false;
  const summarizing = new Set();
  const sumErrors = {};

  // ---- Authentic crisp SVG brand marks (never plain alphabet circles)
  const BRAND_SVGS = {
    // Y Combinator / Hacker News iconic orange square + white Y fork
    hn: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#FF6600"/><path d="M6.8 6.2h2.6l2.6 5.3 2.6-5.3h2.6l-4 7.7v4h-2.4v-4l-4-7.7z" fill="#fff"/></svg>',
    // GitHub Octocat silhouette
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#24292F"/><path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M12 4.6a7.4 7.4 0 0 0-2.34 14.42c.37.07.5-.16.5-.36v-1.27c-2.06.45-2.49-.99-2.49-.99-.34-.85-.82-1.08-.82-1.08-.67-.46.05-.45.05-.45.74.05 1.13.76 1.13.76.66 1.13 1.73.8 2.15.61.07-.48.26-.8.47-.99-1.64-.19-3.37-.82-3.37-3.65 0-.81.29-1.47.76-1.99-.08-.19-.33-.94.07-1.96 0 0 .62-.2 2.03.76a7.1 7.1 0 0 1 3.7 0c1.41-.96 2.03-.76 2.03-.76.4 1.02.15 1.77.07 1.96.47.52.76 1.18.76 1.99 0 2.84-1.73 3.46-3.38 3.64.27.23.5.68.5 1.37v2.03c0 .2.13.43.51.36A7.4 7.4 0 0 0 12 4.6z"/></svg>',
    // Google News 4-color newspaper emblem
    gnews: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#1F2430"/><rect x="4" y="4.5" width="16" height="4.5" rx="1.2" fill="#4285F4"/><rect x="4" y="9" width="7.5" height="10.5" rx="1.2" fill="#EA4335"/><rect x="11.5" y="9" width="8.5" height="5.2" fill="#FBBC05"/><rect x="11.5" y="14.2" width="8.5" height="5.3" rx="1" fill="#34A853"/><rect x="6" y="11" width="3.8" height="3.8" rx=".8" fill="#fff" opacity=".92"/><path d="M13 11.2h5.2M13 16.5h5.2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>',
    // TechCrunch iconic pixel-block green TC emblem
    techcrunch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#0A9E01"/><path d="M4.5 7.5h8.2v2.7h-2.7v6.3H7.2v-6.3H4.5V7.5zm8.5 0h6.5v2.7H13V7.5zm0 3.6h2.7v2.7h3.8v2.7H13v-5.4z" fill="#fff"/></svg>',
    // The Verge angular V emblem
    verge: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#E5127D"/><path d="M5.5 6.8h3.4l3.1 7.6 3.1-7.6h3.4L13.4 18h-2.8L5.5 6.8z" fill="#fff"/></svg>',
    // DEV Community badge
    devto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B" stroke="#3F3F46"/><path d="M5 9.2h2.1c1.3 0 2.1.8 2.1 2.8s-.8 2.8-2.1 2.8H5V9.2zm1.5 1.3v3h.6c.4 0 .7-.4.7-1.5s-.3-1.5-.7-1.5h-.6zm3.7-1.3h3.2v1.3h-1.8v.8h1.5v1.3h-1.5v.9h1.8v1.3h-3.2V9.2zm3.9 0h1.5l.9 3.6.9-3.6H19l-1.7 5.6h-1.5l-1.7-5.6z" fill="#fff"/></svg>',
    // Lobste.rs crimson emblem
    lobsters: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#AC130D"/><path d="M12 5.2c1.6 0 2.6 1.5 2.6 3.7 0 2.4-1 5.3-1.5 7.4h-2.2c-.5-2.1-1.5-5-1.5-7.4 0-2.2 1-3.7 2.6-3.7zm-4.9 1.6c1.1.3 1.7 1.3 1.4 2.4l-1.3.4c-.9-.5-1.4-1.5-1.1-2.5l1-.3zm9.8 0 1 .3c.3 1-.2 2-1.1 2.5l-1.3-.4c-.3-1.1.3-2.1 1.4-2.4zM9.2 17.3h5.6l1 1.7H8.2l1-1.7z" fill="#fff"/></svg>',
    // Product Hunt iconic coral circle + geometric P mark
    producthunt: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="#DA552F"/><path d="M13.3 12H10.5V8.8h2.8a1.6 1.6 0 0 1 0 3.2zm0-5.4H8.3v10.8h2.2v-3.2h2.8a3.8 3.8 0 0 0 0-7.6z" fill="#fff"/></svg>',
    // BBC 3-block mark
    bbc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#BB1919"/><rect x="3.2" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="9.4" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="15.6" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><path d="M4.8 10.2h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H4.8v-3.1zm6.2 0h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H11v-3.1zm7.9.8a.9.9 0 0 0-.8-.5c-.6 0-1 .5-1 1.2s.4 1.2 1 1.2c.4 0 .6-.2.8-.5l.6.5a1.7 1.7 0 0 1-1.4.8c-1.1 0-1.8-.8-1.8-2s.7-2 1.8-2c.6 0 1.1.3 1.4.8l-.6.5z" fill="#BB1919"/></svg>',
    // NPR 3-color block mark
    npr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B"/><rect x="2.6" y="7.8" width="6" height="8.4" rx=".8" fill="#D62021"/><rect x="9" y="7.8" width="6" height="8.4" rx=".8" fill="#111113" stroke="#52525B" stroke-width=".7"/><rect x="15.4" y="7.8" width="6" height="8.4" rx=".8" fill="#237BBD"/><path d="M4.4 14v-3.8h1l1.2 2v-2h.9V14h-1l-1.2-2v2h-.9zm6.3 0v-3.8h1.7c.8 0 1.3.4 1.3 1.2s-.5 1.2-1.3 1.2h-.7V14h-1zm1-2.1h.6c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-.6v1zm5.4 2.1v-3.8h1.8c.8 0 1.2.4 1.2 1.1 0 .5-.2.9-.7 1.1l.8 1.6h-1.1l-.7-1.4h-.4V14h-.9zm.9-2.1h.7c.3 0 .5-.2.5-.5s-.2-.4-.5-.4H18v.9z" fill="#fff"/></svg>',
    // Generic vector RSS emblem (only fallback when a custom feed has no favicon yet)
    rss: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#F59E0B"/><circle cx="7.5" cy="16.5" r="2" fill="#fff"/><path d="M5.5 10.5a8 8 0 0 1 8 8M5.5 5.8a12.7 12.7 0 0 1 12.7 12.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };

  function sourceIcon(item, favicons, size = 18) {
    const map = favicons || {};
    const host = (item && item.iconHost) || '';
    const brand = (item && item.brand) || 'rss';
    // Use authentic fetched publisher favicon for favicon-based sources (Indonesian portals, custom RSS)
    // AND for Google News articles when we cached the actual news outlet's favicon!
    if (host && map[host] && (brand === 'favicon' || brand === 'gnews')) {
      return `<span class="fd-ico fd-ico-fav" style="width:${size}px;height:${size}px"><img src="${esc(map[host])}" alt=""></span>`;
    }
    const svg = BRAND_SVGS[brand] || BRAND_SVGS.rss;
    return `<span class="fd-ico" style="width:${size}px;height:${size}px">${svg}</span>`;
  }

  function ago(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return _t('just now');
    if (m < 60) return _t('{n}m ago', { n: m });
    if (m < 1440) return _t('{n}h ago', { n: Math.round(m / 60) });
    return _t('{n}d ago', { n: Math.round(m / 1440) });
  }

  function fmtCount(n) {
    if (n == null) return '';
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }

  function feedData() {
    return N.data.feed || { items: [], updatedAt: 0, errors: {}, favicons: {}, summaries: {} };
  }

  function filterDefs(items) {
    const has = (fn) => items.some(fn);
    const defs = [{ id: 'all', label: _t('All'), brand: '' }];
    if (has((i) => i.sourceId === 'hn')) defs.push({ id: 'hn', label: 'HN', brand: 'hn' });
    if (has((i) => i.sourceId === 'github_trending')) defs.push({ id: 'github_trending', label: 'GitHub', brand: 'github' });
    if (has((i) => i.sourceId === 'gnews_id' || i.sourceId === 'gnews_id_tech' || i.category === 'topics')) {
      defs.push({ id: 'gnews', label: 'Google News', brand: 'gnews' });
    }
    if (has((i) => i.sourceId === 'cnn_id' || i.sourceId === 'tempo_id' || i.sourceId === 'antara_id')) {
      defs.push({ id: 'id_news', label: _t('Indonesia'), brand: '' });
    }
    if (has((i) => i.category === 'tech' && i.sourceId !== 'hn' && i.sourceId !== 'github_trending')) {
      defs.push({ id: 'tech', label: _t('Tech'), brand: '' });
    }
    if (has((i) => i.category === 'world')) defs.push({ id: 'world', label: _t('World'), brand: '' });
    if (has((i) => i.category === 'custom')) defs.push({ id: 'custom', label: _t('Custom'), brand: 'rss' });
    return defs;
  }

  function filteredItems(items) {
    if (activeFilter === 'all') return items;
    if (activeFilter === 'gnews') return items.filter((i) => i.brand === 'gnews' || i.category === 'topics');
    if (activeFilter === 'id_news') return items.filter((i) => i.sourceId === 'cnn_id' || i.sourceId === 'tempo_id' || i.sourceId === 'antara_id');
    if (activeFilter === 'tech') return items.filter((i) => i.category === 'tech');
    if (activeFilter === 'world') return items.filter((i) => i.category === 'world');
    if (activeFilter === 'custom') return items.filter((i) => i.category === 'custom');
    return items.filter((i) => i.sourceId === activeFilter);
  }

  function itemMeta(it) {
    const parts = [];
    const pub = it.publisher && it.publisher !== it.sourceName ? it.publisher : it.sourceName;
    if (pub) parts.push(pub);
    if (it.publishedAt) parts.push(ago(it.publishedAt));
    if (it.sourceId === 'hn' && it.points != null) {
      parts.push(`▲ ${it.points}`);
    } else if (it.sourceId === 'github_trending') {
      if (it.language) parts.push(it.language);
      if (it.points != null) parts.push(`★ ${fmtCount(it.points)}`);
      if (it.starsToday) parts.push(it.starsToday);
    }
    return parts.join(' · ');
  }

  async function triggerSummarize(it, force = false) {
    if (!it || summarizing.has(it.id)) return;
    selectedId = it.id;
    delete sumErrors[it.id];
    summarizing.add(it.id);
    render();
    try {
      const res = await api.svc('feed', 'summarize', it.id, it.url, it.title, it.publisher || it.sourceName, it.snippet || '', !!force);
      if (res && res.ok) {
        const cur = feedData();
        const nextSums = { ...(cur.summaries || {}), [it.id]: { summary: res.summary, bullets: res.bullets || [], source: res.source || 'article', at: Date.now() } };
        N.setData('feed', { ...cur, summaries: nextSums });
      } else {
        sumErrors[it.id] = (res && res.error) || _t('Couldn’t summarize this article');
      }
    } catch (e) {
      sumErrors[it.id] = String(e || _t('Couldn’t summarize this article'));
    } finally {
      summarizing.delete(it.id);
      render();
    }
  }

  async function saveToBookmarks(it) {
    if (!it || !it.url) return;
    if (N.bookmarks && typeof N.bookmarks.add === 'function') {
      const r = await N.bookmarks.add(it.url, 'Feed').catch(() => null);
      if (r && r.ok) {
        N.toast(fa('bookmark'), r.existed ? _t('Already in Bookmarks') : _t('Saved to Bookmarks'));
        return;
      }
    }
    navigator.clipboard.writeText(it.url).catch(() => {});
    N.toast(fa('copy', 'regular'), _t('Link copied'));
  }

  function askPonyAbout(it) {
    if (!it) return;
    const sum = (feedData().summaries || {})[it.id];
    const bullets = sum && Array.isArray(sum.bullets) && sum.bullets.length
      ? `\n\nRingkasan sebelumnya:\n${sum.bullets.map((b) => `- ${b}`).join('\n')}`
      : (it.snippet ? `\n\nCuplikan: ${it.snippet}` : '');
    const prompt = `${_t('Let’s discuss this article')}: "${it.title}" (${it.publisher || it.sourceName})\n${it.url}${bullets}`;
    N.openModule('chat');
    setTimeout(() => {
      if (N.chat && typeof N.chat.send === 'function') {
        if (N.chat.pending && N.chat.pending() && N.chat.steer) N.chat.steer(prompt);
        else N.chat.send(prompt);
      }
    }, 80);
  }

  async function doRefresh() {
    if (refreshing) return;
    refreshing = true;
    render();
    try {
      const res = await api.svc('feed', 'refresh').catch(() => null);
      if (res && typeof res === 'object') N.setData('feed', res);
    } finally {
      refreshing = false;
      render();
      refreshCards();
    }
  }

  function render() {
    if (!page) return;
    const d = feedData();
    const allItems = Array.isArray(d.items) ? d.items : [];
    const favicons = d.favicons || {};
    const summaries = d.summaries || {};
    const ponyOn = !st.settings || st.settings.feedPonySummary !== false;

    const defs = filterDefs(allItems);
    if (!defs.some((f) => f.id === activeFilter)) activeFilter = 'all';
    const items = filteredItems(allItems);

    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      selectedId = items[0] ? items[0].id : '';
    }
    const sel = items.find((i) => i.id === selectedId) || null;

    // Filter chips bar
    const chipsHtml = defs.map((f) => {
      const ico = f.brand && BRAND_SVGS[f.brand]
        ? `<span class="fd-chip-ico">${BRAND_SVGS[f.brand]}</span>`
        : '';
      return `<button type="button" class="fd-chip${activeFilter === f.id ? ' on' : ''}" data-filt="${esc(f.id)}">${ico}<span>${esc(f.label)}</span></button>`;
    }).join('');

    // Left list body
    let listHtml = '';
    if (!allItems.length && refreshing) {
      listHtml = `<div class="fd-empty"><span class="fd-spin">${fa('arrows-rotate')}</span><span>${esc(_t('Loading feeds…'))}</span></div>`;
    } else if (!allItems.length) {
      listHtml = `<div class="fd-empty"><span>${esc(_t('No feed items yet. Pick sources in Settings → Feed & RSS or tap Refresh.'))}</span>`
        + `<div class="row" style="gap:6px"><button type="button" class="sbtn p" id="fdEmptyRef">${esc(_t('Refresh'))}</button>`
        + `<button type="button" class="sbtn" id="fdEmptySet">${esc(_t('Settings'))}</button></div></div>`;
    } else if (!items.length) {
      listHtml = `<div class="fd-empty"><span>${esc(_t('No items in this filter'))}</span></div>`;
    } else {
      listHtml = `<div class="fd-list sc-y">` + items.map((it) => {
        const isSel = sel && sel.id === it.id;
        const hasSum = !!summaries[it.id];
        const isBusy = summarizing.has(it.id);
        return `<div class="fd-row${isSel ? ' on' : ''}" data-id="${esc(it.id)}" data-url="${esc(it.url)}">`
          + sourceIcon(it, favicons, 18)
          + `<div class="fd-row-body"><div class="fd-row-title">${esc(it.title)}</div>`
          + `<div class="fd-row-meta t1">${esc(itemMeta(it))}</div></div>`
          + `<div class="fd-row-acts">`
          + (ponyOn ? `<button type="button" class="fd-mini${hasSum ? ' has' : ''}${isBusy ? ' busy' : ''}" data-sum="${esc(it.id)}" title="${esc(_t('Summarize with Pony'))}">${fa('wand-magic-sparkles')}</button>` : '')
          + `<button type="button" class="fd-mini" data-bm="${esc(it.id)}" title="${esc(_t('Save to Bookmarks'))}">${fa('bookmark', 'regular')}</button>`
          + `</div></div>`;
      }).join('') + `</div>`;
    }

    // Right column: Pony Summary & Reader Preview
    let rightHtml = '';
    if (!sel) {
      rightHtml = `<div class="fd-sum-empty">${fa('wand-magic-sparkles')}<span>${esc(_t('Select any story to read or summarize with Pony'))}</span></div>`;
    } else {
      const cachedSum = summaries[sel.id];
      const busy = summarizing.has(sel.id);
      const err = sumErrors[sel.id];
      let bodyHtml = '';
      if (busy) {
        bodyHtml = `<div class="fd-sum-load"><div class="fd-shimmer"></div><div class="fd-shimmer w85"></div><div class="fd-shimmer w70"></div>`
          + `<span class="sub">${fa('wand-magic-sparkles')} ${esc(_t('Pony is reading and summarizing…'))}</span></div>`;
      } else if (ponyOn && cachedSum && Array.isArray(cachedSum.bullets) && cachedSum.bullets.length) {
        bodyHtml = `<ul class="fd-bullets sc-y">${cachedSum.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
      } else if (ponyOn && cachedSum && cachedSum.summary) {
        bodyHtml = `<div class="fd-sum-text sc-y">${esc(cachedSum.summary)}</div>`;
      } else if (err) {
        bodyHtml = `<div class="fd-sum-err"><span class="sub">${esc(err)}</span>`
          + `<div class="row" style="gap:6px"><button type="button" class="sbtn" id="fdRetrySum">${esc(_t('Try again'))}</button>`
          + `<button type="button" class="sbtn" id="fdAiSet">${esc(_t('Pony Settings'))}</button></div></div>`;
      } else {
        const snip = sel.snippet
          ? `<div class="fd-snip sc-y">${esc(sel.snippet)}</div>`
          : `<div class="fd-snip sub">${esc(_t('Tap Summarize with Pony for 3 key takeaways, or open the original article.'))}</div>`;
        const cta = ponyOn
          ? `<button type="button" class="fd-pony-cta" id="fdRunSum">${fa('wand-magic-sparkles')}<span>${esc(_t('Summarize with Pony'))}</span></button>`
          : '';
        bodyHtml = `${snip}${cta}`;
      }

      const sumTag = cachedSum
        ? `<button type="button" class="fd-regen" id="fdRegenSum" title="${esc(_t('Regenerate summary'))}">${fa('arrows-rotate')}</button>`
        : '';

      rightHtml = `<div class="fd-sum-head">`
        + `<span class="fd-sum-lbl">${fa('wand-magic-sparkles')}<span>${esc(ponyOn ? _t('Pony Summary') : _t('Preview'))}</span></span>`
        + `<span class="fd-sum-src t1">${esc(sel.publisher || sel.sourceName)}</span>${sumTag}</div>`
        + `<div class="fd-sum-title-row">${sourceIcon(sel, favicons, 16)}<div class="fd-sum-title">${esc(sel.title)}</div></div>`
        + `<div class="fd-sum-body">${bodyHtml}</div>`
        + `<div class="fd-sum-foot">`
        + `<button type="button" class="fd-act" id="fdSaveBm">${fa('bookmark', 'regular')}<span>${esc(_t('Save'))}</span></button>`
        + (ponyOn ? `<button type="button" class="fd-act p" id="fdAskPony">${fa('wand-magic-sparkles')}<span>${esc(_t('Ask Pony'))}</span></button>` : '')
        + `<button type="button" class="fd-act" id="fdOpenUrl"><span>${esc(_t('Open'))}</span>${fa('arrow-up-right-from-square')}</button>`
        + `</div>`;
    }

    page.innerHTML = `<div class="fd-grid">`
      + `<div class="c fd-left">`
      + `<div class="fd-bar"><div class="fd-chips sc-x">${chipsHtml}</div>`
      + `<div class="fd-tools">`
      + `<button type="button" class="fd-tbtn${refreshing ? ' spin' : ''}" id="fdRefresh" title="${esc(_t('Refresh'))}">${fa('arrows-rotate')}</button>`
      + `<button type="button" class="fd-tbtn" id="fdSettings" title="${esc(_t('Settings'))}">${fa('gear')}</button>`
      + `</div></div>${listHtml}</div>`
      + `<div class="c fd-right">${rightHtml}</div></div>`;

    // Wire events
    $$('.fd-chip', page).forEach((b) => {
      b.onclick = () => { activeFilter = b.dataset.filt || 'all'; render(); };
    });
    const refBtn = $('#fdRefresh', page);
    if (refBtn) refBtn.onclick = doRefresh;
    const setBtn = $('#fdSettings', page);
    if (setBtn) setBtn.onclick = () => api.openSettings('feed');
    const emptyRef = $('#fdEmptyRef', page);
    if (emptyRef) emptyRef.onclick = doRefresh;
    const emptySet = $('#fdEmptySet', page);
    if (emptySet) emptySet.onclick = () => api.openSettings('feed');

    $$('.fd-row', page).forEach((row) => {
      const it = items.find((x) => x.id === row.dataset.id);
      if (!it) return;
      row.onclick = (e) => {
        if (e.target.closest('button')) return;
        selectedId = it.id;
        render();
      };
      row.ondblclick = () => {
        api.openExternal(it.url);
        N.closeNotch();
      };
    });
    $$('[data-sum]', page).forEach((b) => {
      const it = items.find((x) => x.id === b.dataset.sum);
      b.onclick = (e) => { e.stopPropagation(); if (it) triggerSummarize(it, false); };
    });
    $$('[data-bm]', page).forEach((b) => {
      const it = items.find((x) => x.id === b.dataset.bm);
      b.onclick = (e) => { e.stopPropagation(); if (it) saveToBookmarks(it); };
    });

    if (sel) {
      const runBtn = $('#fdRunSum', page);
      if (runBtn) runBtn.onclick = () => triggerSummarize(sel, false);
      const retryBtn = $('#fdRetrySum', page);
      if (retryBtn) retryBtn.onclick = () => triggerSummarize(sel, true);
      const regenBtn = $('#fdRegenSum', page);
      if (regenBtn) regenBtn.onclick = () => triggerSummarize(sel, true);
      const aiSetBtn = $('#fdAiSet', page);
      if (aiSetBtn) aiSetBtn.onclick = () => api.openSettings('ai');
      const bmBtn = $('#fdSaveBm', page);
      if (bmBtn) bmBtn.onclick = () => saveToBookmarks(sel);
      const askBtn = $('#fdAskPony', page);
      if (askBtn) askBtn.onclick = () => askPonyAbout(sel);
      const openBtn = $('#fdOpenUrl', page);
      if (openBtn) openBtn.onclick = () => { api.openExternal(sel.url); N.closeNotch(); };
    }
  }

  // ---- 2×1 Dashboard card
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('feed', () => refreshCards());
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#f59e0b');
    const d = feedData();
    const items = Array.isArray(d.items) ? d.items : [];
    const favicons = d.favicons || {};
    const right = items.length ? _t('{n} stories', { n: items.length }) : (d.updatedAt ? ago(d.updatedAt) : '');
    const body = items.length
      ? `<div class="fd-card-list">` + items.slice(0, 2).map((it) =>
        `<div class="fd-card-row">${sourceIcon(it, favicons, 15)}`
        + `<div class="fd-card-txt"><div class="t1">${esc(it.title)}</div>`
        + `<div class="sub t1">${esc(itemMeta(it))}</div></div></div>`).join('') + `</div>`
      : `<div class="sub" style="margin-top:auto">${esc(_t('Hacker News, GitHub Trending & Indonesian news'))}</div>`;
    el.innerHTML = `${N.hd('rss', _t('Feed & RSS'), right)}${body}`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'feed',
    tall: true,
    init(p) {
      page = p;
      N.watch('feed', () => { render(); refreshCards(); });
    },
    show() {
      render();
      const d = feedData();
      if (!d.items || !d.items.length) doRefresh();
    },
    onSettings() { render(); refreshCards(); },
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('feed'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
