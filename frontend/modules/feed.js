// Feed & RSS: 2×1 headline card + 3 Module Styling Library layouts (`bento` Reader + Pony,
// `headlines` Compact Ticker, `focus` Briefing Spotlight) with authentic brand SVG icons & cached
// origin favicons, plus on-demand multi-language 3-bullet "Ringkas dengan Pony".
(function () {
  const { api, st, $, $$, esc, fa } = N;
  let page;
  let activeFilter = 'all';
  let selectedId = '';
  let tickerPreviewOpen = false;
  let refreshing = false;
  let savedListScroll = 0;
  let savedGridScroll = 0;
  let savedQueueScroll = 0;
  let savedChipsScroll = 0;
  let lastScrollFilter = 'all';
  let hoverPrefetchTimer = null;
  let interactiveJob = null;
  const summarizing = new Set();
  const sumErrors = {};
  const sumStreams = {};
  const prefetchedIds = new Set();

  // ---- Authentic crisp SVG brand marks (never plain alphabet circles)
  const BRAND_SVGS = {
    hn: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#FF6600"/><path d="M6.8 6.2h2.6l2.6 5.3 2.6-5.3h2.6l-4 7.7v4h-2.4v-4l-4-7.7z" fill="#fff"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#24292F"/><path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M12 4.6a7.4 7.4 0 0 0-2.34 14.42c.37.07.5-.16.5-.36v-1.27c-2.06.45-2.49-.99-2.49-.99-.34-.85-.82-1.08-.82-1.08-.67-.46.05-.45.05-.45.74.05 1.13.76 1.13.76.66 1.13 1.73.8 2.15.61.07-.48.26-.8.47-.99-1.64-.19-3.37-.82-3.37-3.65 0-.81.29-1.47.76-1.99-.08-.19-.33-.94.07-1.96 0 0 .62-.2 2.03.76a7.1 7.1 0 0 1 3.7 0c1.41-.96 2.03-.76 2.03-.76.4 1.02.15 1.77.07 1.96.47.52.76 1.18.76 1.99 0 2.84-1.73 3.46-3.38 3.64.27.23.5.68.5 1.37v2.03c0 .2.13.43.51.36A7.4 7.4 0 0 0 12 4.6z"/></svg>',
    gnews: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#1F2430"/><rect x="4" y="4.5" width="16" height="4.5" rx="1.2" fill="#4285F4"/><rect x="4" y="9" width="7.5" height="10.5" rx="1.2" fill="#EA4335"/><rect x="11.5" y="9" width="8.5" height="5.2" fill="#FBBC05"/><rect x="11.5" y="14.2" width="8.5" height="5.3" rx="1" fill="#34A853"/><rect x="6" y="11" width="3.8" height="3.8" rx=".8" fill="#fff" opacity=".92"/><path d="M13 11.2h5.2M13 16.5h5.2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>',
    techcrunch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#0A9E01"/><path d="M4.5 7.5h8.2v2.7h-2.7v6.3H7.2v-6.3H4.5V7.5zm8.5 0h6.5v2.7H13V7.5zm0 3.6h2.7v2.7h3.8v2.7H13v-5.4z" fill="#fff"/></svg>',
    verge: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#E5127D"/><path d="M5.5 6.8h3.4l3.1 7.6 3.1-7.6h3.4L13.4 18h-2.8L5.5 6.8z" fill="#fff"/></svg>',
    devto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B" stroke="#3F3F46"/><path d="M5 9.2h2.1c1.3 0 2.1.8 2.1 2.8s-.8 2.8-2.1 2.8H5V9.2zm1.5 1.3v3h.6c.4 0 .7-.4.7-1.5s-.3-1.5-.7-1.5h-.6zm3.7-1.3h3.2v1.3h-1.8v.8h1.5v1.3h-1.5v.9h1.8v1.3h-3.2V9.2zm3.9 0h1.5l.9 3.6.9-3.6H19l-1.7 5.6h-1.5l-1.7-5.6z" fill="#fff"/></svg>',
    lobsters: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#AC130D"/><path d="M12 5.2c1.6 0 2.6 1.5 2.6 3.7 0 2.4-1 5.3-1.5 7.4h-2.2c-.5-2.1-1.5-5-1.5-7.4 0-2.2 1-3.7 2.6-3.7zm-4.9 1.6c1.1.3 1.7 1.3 1.4 2.4l-1.3.4c-.9-.5-1.4-1.5-1.1-2.5l1-.3zm9.8 0 1 .3c.3 1-.2 2-1.1 2.5l-1.3-.4c-.3-1.1.3-2.1 1.4-2.4zM9.2 17.3h5.6l1 1.7H8.2l1-1.7z" fill="#fff"/></svg>',
    producthunt: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="#DA552F"/><path d="M13.3 12H10.5V8.8h2.8a1.6 1.6 0 0 1 0 3.2zm0-5.4H8.3v10.8h2.2v-3.2h2.8a3.8 3.8 0 0 0 0-7.6z" fill="#fff"/></svg>',
    bbc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#BB1919"/><rect x="3.2" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="9.4" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="15.6" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><path d="M4.8 10.2h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H4.8v-3.1zm6.2 0h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H11v-3.1zm7.9.8a.9.9 0 0 0-.8-.5c-.6 0-1 .5-1 1.2s.4 1.2 1 1.2c.4 0 .6-.2.8-.5l.6.5a1.7 1.7 0 0 1-1.4.8c-1.1 0-1.8-.8-1.8-2s.7-2 1.8-2c.6 0 1.1.3 1.4.8l-.6.5z" fill="#BB1919"/></svg>',
    npr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B"/><rect x="2.6" y="7.8" width="6" height="8.4" rx=".8" fill="#D62021"/><rect x="9" y="7.8" width="6" height="8.4" rx=".8" fill="#111113" stroke="#52525B" stroke-width=".7"/><rect x="15.4" y="7.8" width="6" height="8.4" rx=".8" fill="#237BBD"/><path d="M4.4 14v-3.8h1l1.2 2v-2h.9V14h-1l-1.2-2v2h-.9zm6.3 0v-3.8h1.7c.8 0 1.3.4 1.3 1.2s-.5 1.2-1.3 1.2h-.7V14h-1zm1-2.1h.6c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-.6v1zm5.4 2.1v-3.8h1.8c.8 0 1.2.4 1.2 1.1 0 .5-.2.9-.7 1.1l.8 1.6h-1.1l-.7-1.4h-.4V14h-.9zm.9-2.1h.7c.3 0 .5-.2.5-.5s-.2-.4-.5-.4H18v.9z" fill="#fff"/></svg>',
    rss: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#F59E0B"/><circle cx="7.5" cy="16.5" r="2" fill="#fff"/><path d="M5.5 10.5a8 8 0 0 1 8 8M5.5 5.8a12.7 12.7 0 0 1 12.7 12.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };

  // Clean modern 4-point AI sparkle & smooth ring spinner (replaces spinning magic wand)
  const SPARKLE_SVG = '<svg class="fd-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 2.5c.3 4.3 1.7 5.7 6 6-4.3.3-5.7 1.7-6 6-.3-4.3-1.7-5.7-6-6 4.3-.3 5.7-1.7 6-6zm7.3 11.2c.18 2.1.85 2.75 2.9 2.9-2.05.18-2.72.85-2.9 2.9-.18-2.05-.85-2.72-2.9-2.9 2.05-.15 2.72-.8 2.9-2.9z"/></svg>';
  const SPINNER_SVG = '<svg class="fd-ring-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.4"/><path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  const LANG_CYCLE = ['auto', 'id', 'en', 'original'];
  const LANG_SHORT = {
    auto: () => _t('Auto'),
    id: () => 'ID',
    en: () => 'EN',
    original: () => _t('Original'),
    ms: () => 'MS',
    ja: () => 'JA',
  };

  function summaryLangPref() {
    const raw = (st.settings && st.settings.feedSummaryLang) || 'auto';
    return String(raw).trim() || 'auto';
  }

  function effectiveSummaryLang() {
    const pref = summaryLangPref();
    if (pref !== 'auto') return pref;
    const uiLang = (st.settings && st.settings.language) || 'auto';
    if (uiLang && uiLang !== 'auto') return uiLang;
    const docLang = (window.SYMPONY_LANG || (st.settings && st.settings.voiceLanguage) || 'en').toLowerCase();
    return docLang.startsWith('id') ? 'id' : 'en';
  }

  const SUMMARY_VER = 'v2';

  function cachedSummaryFor(summaries, id) {
    if (!summaries || !id) return null;
    const lang = effectiveSummaryLang();
    return summaries[`${SUMMARY_VER}:${id}:${lang}`] || null;
  }

  function fmtInline(raw) {
    let s = esc(String(raw || ''));
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    return s;
  }

  function parseLiveBullets(raw) {
    return String(raw || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^(?:[-•*]|\d+[.)])\s+/, '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  function prefetchStory(it) {
    if (!it || !it.id || !it.url || prefetchedIds.has(it.id)) return;
    if (cachedSummaryFor(feedData().summaries, it.id)) return;
    prefetchedIds.add(it.id);
    api.svc('feed', 'prefetch', it.id, it.url, it.title || '').catch(() => {});
  }

  function captureScrollState() {
    if (!page) return;
    const listEl = $('.fd-list', page);
    if (listEl) savedListScroll = listEl.scrollTop;
    const gridEl = $('.fd-ticker-grid', page);
    if (gridEl) savedGridScroll = gridEl.scrollTop;
    const qEl = $('.fd-spot-q', page);
    if (qEl) savedQueueScroll = qEl.scrollTop;
    const chipsEl = $('.fd-chips', page);
    if (chipsEl) savedChipsScroll = chipsEl.scrollLeft;
  }

  function restoreScrollState() {
    if (!page) return;
    const listEl = $('.fd-list', page);
    if (listEl) {
      listEl.scrollTop = savedListScroll;
      listEl.onscroll = () => { savedListScroll = listEl.scrollTop; };
    }
    const gridEl = $('.fd-ticker-grid', page);
    if (gridEl) {
      gridEl.scrollTop = savedGridScroll;
      gridEl.onscroll = () => { savedGridScroll = gridEl.scrollTop; };
    }
    const qEl = $('.fd-spot-q', page);
    if (qEl) {
      qEl.scrollTop = savedQueueScroll;
      qEl.onscroll = () => { savedQueueScroll = qEl.scrollTop; };
    }
    const chipsEl = $('.fd-chips', page);
    if (chipsEl) {
      chipsEl.scrollLeft = savedChipsScroll;
      chipsEl.onscroll = () => { savedChipsScroll = chipsEl.scrollLeft; };
    }
  }

  function storyThumb(item, images, favicons, cls = '', icoSize = 15) {
    let thumbUrl = (item && item.image) || (images && item && images[item.id]) || '';
    if (thumbUrl.includes('opengraph.githubassets.com/')) {
      const parts = thumbUrl.split('opengraph.githubassets.com/')[1]?.split('/').filter(Boolean) || [];
      thumbUrl = parts[1] ? `https://github.com/${parts[1]}.png?size=128` : '';
    }
    const isGhAvatar = (item && (item.sourceId === 'github_trending' || item.iconHost === 'github.com'))
      || thumbUrl.includes('avatars.githubusercontent.com')
      || /^https:\/\/github\.com\/[^/]+\.png/i.test(thumbUrl);
    const tint = (item && item.color) || '#8b5cf6';
    const imgHtml = thumbUrl
      ? `<img class="fd-thumb-img" src="${esc(thumbUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : '';
    return `<span class="fd-thumb${cls ? ' ' + cls : ''}${isGhAvatar ? ' avatar' : ''}${thumbUrl ? '' : ' empty'}" style="--thumb-tint:${esc(tint)}">`
      + `<span class="fd-thumb-ph">${sourceIcon(item, favicons, icoSize)}</span>`
      + `${imgHtml}</span>`;
  }

  function bindThumbFallbacks(root) {
    if (!root) return;
    $$('.fd-thumb-img', root).forEach((img) => {
      img.onerror = () => {
        const wrap = img.closest('.fd-thumb');
        if (wrap) wrap.classList.add('empty');
        img.remove();
      };
    });
  }

  function cycleSummaryLang() {
    const cur = summaryLangPref();
    const idx = LANG_CYCLE.indexOf(cur);
    const next = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    if (st.settings) st.settings.feedSummaryLang = next;
    api.setSettings({ feedSummaryLang: next });
    render();
  }

  function sourceIcon(item, favicons, size = 18) {
    const map = favicons || {};
    const host = (item && item.iconHost) || '';
    const brand = (item && item.brand) || 'rss';
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
    return N.data.feed || { items: [], updatedAt: 0, errors: {}, favicons: {}, images: {}, summaries: {} };
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
    if (!it) return;
    const lang = effectiveSummaryLang();
    const busyKey = `${it.id}:${lang}`;
    if (summarizing.has(busyKey)) return;
    selectedId = it.id;
    tickerPreviewOpen = true;
    delete sumErrors[busyKey];
    delete sumStreams[busyKey];
    const hasCached = !force && !!cachedSummaryFor(feedData().summaries, it.id);
    const job = {
      id: it.id,
      lang,
      title: it.title || '',
      source: it.publisher || it.sourceName || 'Feed',
      since: Date.now(),
    };
    if (!hasCached) {
      interactiveJob = job;
      if (N.setFeedSum) {
        N.setFeedSum({
          active: true,
          id: job.id,
          title: job.title,
          source: job.source,
          since: job.since,
          phase: 'reading',
          preview: '',
          chars: 0,
        });
      }
    }
    summarizing.add(busyKey);
    if (!updateBentoRightInPlace()) render();
    let didFinishLive = false;
    let errMsg = '';
    try {
      const res = await api.svc('feed', 'summarize', it.id, it.url, it.title, it.publisher || it.sourceName, it.snippet || '', !!force, lang);
      if (res && res.ok) {
        const cur = feedData();
        const key = res.key || `${SUMMARY_VER}:${busyKey}`;
        const nextSums = { ...(cur.summaries || {}), [key]: { summary: res.summary, bullets: res.bullets || [], source: res.source || 'article', at: Date.now() } };
        N.setData('feed', { ...cur, summaries: nextSums });
        didFinishLive = !hasCached && (!res.cached || !st.open);
      } else {
        errMsg = (res && res.error) || _t('Couldn’t summarize this article');
        sumErrors[busyKey] = errMsg;
      }
    } catch (e) {
      errMsg = String(e || _t('Couldn’t summarize this article'));
      sumErrors[busyKey] = errMsg;
    } finally {
      delete sumStreams[busyKey];
      summarizing.delete(busyKey);
      const isLatestJob = interactiveJob === job;
      if (isLatestJob) interactiveJob = null;
      if (didFinishLive) {
        selectedId = it.id;
        tickerPreviewOpen = true;
      }
      if (!updateBentoRightInPlace()) render();
      if (isLatestJob) {
        if (didFinishLive && N.revealFeedSummary) {
          N.revealFeedSummary(it.title);
        } else {
          if (N.setFeedSum) N.setFeedSum(null);
          if (errMsg && !st.open && N.toast) {
            N.toast(fa('circle-exclamation'), errMsg, { ms: 5500, color: 'var(--red)', side: 220, tab: 'feed' });
          }
        }
      }
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
    const sum = cachedSummaryFor(feedData().summaries, it.id);
    const bullets = sum && Array.isArray(sum.bullets) && sum.bullets.length
      ? `\n\n${_t('Pony Summary')}:\n${sum.bullets.map((b) => `- ${b}`).join('\n')}`
      : (it.snippet ? `\n\n${it.snippet}` : '');
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

  function buildSummaryBody(sel, summaries, ponyOn) {
    const lang = effectiveSummaryLang();
    const busyKey = `${sel.id}:${lang}`;
    const cachedSum = cachedSummaryFor(summaries, sel.id);
    const streamText = sumStreams[busyKey] || '';
    const busy = summarizing.has(busyKey);
    const err = sumErrors[busyKey];
    let bodyHtml = '';
    if (streamText && (busy || !cachedSum)) {
      const liveBullets = parseLiveBullets(streamText);
      const streamView = liveBullets.length
        ? `<ul class="fd-bullets live sc-y">${liveBullets.map((b) => `<li>${fmtInline(b)}</li>`).join('')}</ul>`
        : `<div class="fd-sum-text sc-y">${fmtInline(streamText)}</div>`;
      bodyHtml = `${streamView}<span class="fd-sum-status compact"><span class="fd-spark-pulse">${SPARKLE_SVG}</span><span>${esc(_t('Pony is writing…'))}</span></span>`;
    } else if (busy) {
      bodyHtml = `<div class="fd-sum-load"><div class="fd-shimmer"></div><div class="fd-shimmer w85"></div><div class="fd-shimmer w70"></div>`
        + `<span class="fd-sum-status"><span class="fd-spark-pulse">${SPARKLE_SVG}</span><span>${esc(_t('Pony is reading and summarizing…'))}</span></span></div>`;
    } else if (ponyOn && cachedSum && Array.isArray(cachedSum.bullets) && cachedSum.bullets.length) {
      bodyHtml = `<ul class="fd-bullets sc-y">${cachedSum.bullets.map((b) => `<li>${fmtInline(b)}</li>`).join('')}</ul>`;
    } else if (ponyOn && cachedSum && cachedSum.summary) {
      bodyHtml = `<div class="fd-sum-text sc-y">${fmtInline(cachedSum.summary)}</div>`;
    } else if (err) {
      bodyHtml = `<div class="fd-sum-err"><span class="sub">${esc(err)}</span>`
        + `<div class="row" style="gap:6px"><button type="button" class="sbtn" id="fdRetrySum">${esc(_t('Try again'))}</button>`
        + `<button type="button" class="sbtn" id="fdAiSet">${esc(_t('Pony Settings'))}</button></div></div>`;
    } else {
      bodyHtml = sel.snippet
        ? `<div class="fd-snip sc-y">${esc(sel.snippet)}</div>`
        : `<div class="fd-snip sub">${esc(_t('Tap Summarize with Pony for 3 key takeaways, or open the original article.'))}</div>`;
    }
    const showRunCta = ponyOn && !cachedSum && !busy && !err;
    return { bodyHtml, cachedSum, busy, showRunCta };
  }

  function summaryFooterHtml(ponyOn, showRunCta) {
    if (showRunCta) {
      return `<div class="fd-sum-foot">`
        + `<button type="button" class="fd-pony-cta" id="fdRunSum">${SPARKLE_SVG}<span>${esc(_t('Summarize with Pony'))}</span></button>`
        + `<button type="button" class="fd-act icon-only" id="fdAskPony" title="${esc(_t('Ask Pony'))}">${fa('comment-dots', 'regular')}</button>`
        + `<button type="button" class="fd-act icon-only" id="fdSaveBm" title="${esc(_t('Save to Bookmarks'))}">${fa('bookmark', 'regular')}</button>`
        + `<button type="button" class="fd-act compact" id="fdOpenUrl"><span>${esc(_t('Open'))}</span>${fa('arrow-up-right-from-square')}</button>`
        + `</div>`;
    }
    return `<div class="fd-sum-foot">`
      + `<button type="button" class="fd-act" id="fdSaveBm">${fa('bookmark', 'regular')}<span>${esc(_t('Save'))}</span></button>`
      + (ponyOn ? `<button type="button" class="fd-act p" id="fdAskPony">${SPARKLE_SVG}<span>${esc(_t('Ask Pony'))}</span></button>` : '')
      + `<button type="button" class="fd-act" id="fdOpenUrl"><span>${esc(_t('Open'))}</span>${fa('arrow-up-right-from-square')}</button>`
      + `</div>`;
  }

  function langPillHtml() {
    const pref = summaryLangPref();
    const fn = LANG_SHORT[pref] || (() => pref.toUpperCase());
    return `<button type="button" class="fd-lang-btn" id="fdSumLang" title="${esc(_t('Summary language'))}">${esc(fn())}</button>`;
  }

  function filterBarHtml(defs) {
    const chipsHtml = defs.map((f) => {
      const ico = f.brand && BRAND_SVGS[f.brand]
        ? `<span class="fd-chip-ico">${BRAND_SVGS[f.brand]}</span>`
        : '';
      return `<button type="button" class="fd-chip${activeFilter === f.id ? ' on' : ''}" data-filt="${esc(f.id)}">${ico}<span>${esc(f.label)}</span></button>`;
    }).join('');
    return `<div class="fd-bar"><div class="fd-chips sc-x">${chipsHtml}</div>`
      + `<div class="fd-tools">`
      + `<button type="button" class="fd-tbtn${refreshing ? ' spin' : ''}" id="fdRefresh" title="${esc(_t('Refresh'))}">${fa('arrows-rotate')}</button>`
      + `<button type="button" class="fd-tbtn" id="fdSettings" title="${esc(_t('Settings'))}">${fa('gear')}</button>`
      + `</div></div>`;
  }

  function bentoRightHtml(sel, favicons, summaries, ponyOn) {
    if (!sel) {
      return `<div class="fd-sum-empty">${SPARKLE_SVG}<span>${esc(_t('Select any story to read or summarize with Pony'))}</span></div>`;
    }
    const { bodyHtml, cachedSum, showRunCta } = buildSummaryBody(sel, summaries, ponyOn);
    const sumTag = cachedSum
      ? `<button type="button" class="fd-regen" id="fdRegenSum" title="${esc(_t('Regenerate summary'))}">${fa('arrows-rotate')}</button>`
      : '';
    return `<div class="fd-sum-head">`
      + `<span class="fd-sum-lbl">${SPARKLE_SVG}<span>${esc(ponyOn ? _t('Pony Summary') : _t('Preview'))}</span></span>`
      + `<span class="fd-sum-src t1">${esc(sel.publisher || sel.sourceName)}</span>`
      + `${ponyOn ? langPillHtml() : ''}${sumTag}</div>`
      + `<div class="fd-sum-title-row">${sourceIcon(sel, favicons, 16)}<div class="fd-sum-title">${esc(sel.title)}</div></div>`
      + `<div class="fd-sum-body">${bodyHtml}</div>`
      + summaryFooterHtml(ponyOn, showRunCta);
  }

  function bindDetailActions(sel, ponyOn) {
    if (!page) return;
    const langBtn = $('#fdSumLang', page);
    if (langBtn) langBtn.onclick = cycleSummaryLang;
    if (!sel) return;
    if (ponyOn) prefetchStory(sel);
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

  // Updates ONLY `.fd-right` + row selection/button badges in Bento mode so `.fd-list` DOM & scroll position never jump!
  function updateBentoRightInPlace() {
    if (!page || page.dataset.style !== 'bento') return false;
    const rightEl = $('.fd-right', page);
    const listEl = $('.fd-list', page);
    if (!rightEl || !listEl) return false;
    const d = feedData();
    const allItems = Array.isArray(d.items) ? d.items : [];
    const items = filteredItems(allItems);
    const favicons = d.favicons || {};
    const summaries = d.summaries || {};
    const ponyOn = !st.settings || st.settings.feedPonySummary !== false;
    const sel = items.find((i) => i.id === selectedId) || items[0] || null;
    if (sel) selectedId = sel.id;
    const curLang = effectiveSummaryLang();

    $$('.fd-row', listEl).forEach((row) => {
      const id = row.dataset.id || '';
      row.classList.toggle('on', !!sel && id === sel.id);
      const sumBtn = $('[data-sum]', row);
      if (sumBtn) {
        const hasSum = !!cachedSummaryFor(summaries, id);
        const isBusy = summarizing.has(`${id}:${curLang}`);
        sumBtn.classList.toggle('has', hasSum);
        sumBtn.classList.toggle('busy', isBusy);
        sumBtn.innerHTML = isBusy ? SPINNER_SVG : SPARKLE_SVG;
      }
    });

    rightEl.innerHTML = bentoRightHtml(sel, favicons, summaries, ponyOn);
    bindDetailActions(sel, ponyOn);
    return true;
  }

  function render() {
    if (!page) return;
    captureScrollState();
    const style = window.StyleLib ? StyleLib.styleIdFor(st.settings, 'feed') : 'bento';
    page.dataset.style = style;

    const d = feedData();
    const allItems = Array.isArray(d.items) ? d.items : [];
    const favicons = d.favicons || {};
    const images = d.images || {};
    const summaries = d.summaries || {};
    const ponyOn = !st.settings || st.settings.feedPonySummary !== false;

    const defs = filterDefs(allItems);
    if (!defs.some((f) => f.id === activeFilter)) activeFilter = 'all';
    if (activeFilter !== lastScrollFilter) {
      savedListScroll = 0;
      savedGridScroll = 0;
      savedQueueScroll = 0;
      lastScrollFilter = activeFilter;
    }
    const items = filteredItems(allItems);

    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      selectedId = items[0] ? items[0].id : '';
    }
    const selIdx = Math.max(0, items.findIndex((i) => i.id === selectedId));
    const sel = items[selIdx] || null;
    const barHtml = filterBarHtml(defs);

    const emptyHtml = !allItems.length && refreshing
      ? `<div class="fd-empty"><span class="fd-spin">${fa('arrows-rotate')}</span><span>${esc(_t('Loading feeds…'))}</span></div>`
      : !allItems.length
        ? `<div class="fd-empty"><span>${esc(_t('No feed items yet. Pick sources in Settings → Feed & RSS or tap Refresh.'))}</span>`
          + `<div class="row" style="gap:6px"><button type="button" class="sbtn p" id="fdEmptyRef">${esc(_t('Refresh'))}</button>`
          + `<button type="button" class="sbtn" id="fdEmptySet">${esc(_t('Settings'))}</button></div></div>`
        : !items.length
          ? `<div class="fd-empty"><span>${esc(_t('No items in this filter'))}</span></div>`
          : '';

    if (style === 'headlines') {
      // ---- Compact Ticker: borderless 2-column headline cards + full-stage inline Pony summary sheet on click
      if (emptyHtml) {
        page.innerHTML = `<div class="fd-ticker">${barHtml}${emptyHtml}</div>`;
      } else if (tickerPreviewOpen && sel) {
        const { bodyHtml, cachedSum, showRunCta } = buildSummaryBody(sel, summaries, ponyOn);
        const sumTag = cachedSum
          ? `<button type="button" class="fd-regen" id="fdRegenSum" title="${esc(_t('Regenerate summary'))}">${fa('arrows-rotate')}</button>`
          : '';
        const sheetHtml = `<div class="fd-ticker-sheet">`
          + `<div class="fd-sum-head">`
          + `<button type="button" class="fd-back-pill" id="fdCloseSheet">${fa('chevron-left')}<span>${esc(_t('Back'))}</span></button>`
          + `${sourceIcon(sel, favicons, 16)}<span class="fd-sum-title one-line" style="flex:1">${esc(sel.title)}</span>`
          + `<span class="fd-sum-src t1">${esc(sel.publisher || sel.sourceName)}</span>`
          + `${ponyOn ? langPillHtml() : ''}${sumTag}`
          + `<button type="button" class="fd-regen" id="fdPrev" title="${esc(_t('Previous'))}">${fa('chevron-left')}</button>`
          + `<button type="button" class="fd-regen" id="fdNext" title="${esc(_t('Next'))}">${fa('chevron-right')}</button></div>`
          + `<div class="fd-sum-body">${bodyHtml}</div>`
          + summaryFooterHtml(ponyOn, showRunCta)
          + `</div>`;
        page.innerHTML = `<div class="fd-ticker in-sheet">${sheetHtml}</div>`;
      } else {
        const gridHtml = `<div class="fd-ticker-grid sc-y">` + items.slice(0, 18).map((it) => {
          const hasSum = !!cachedSummaryFor(summaries, it.id);
          const isBusy = summarizing.has(`${it.id}:${effectiveSummaryLang()}`);
          return `<div class="fd-tcard" data-id="${esc(it.id)}" data-url="${esc(it.url)}">`
            + storyThumb(it, images, favicons, 'sm', 14)
            + `<div class="fd-row-body"><div class="fd-row-title">${esc(it.title)}</div>`
            + `<div class="fd-row-meta t1">${esc(itemMeta(it))}</div></div>`
            + (ponyOn ? `<button type="button" class="fd-mini${hasSum ? ' has' : ''}${isBusy ? ' busy' : ''}" data-sum="${esc(it.id)}" title="${esc(_t('Summarize with Pony'))}">${isBusy ? SPINNER_SVG : SPARKLE_SVG}</button>` : '')
            + `</div>`;
        }).join('') + `</div>`;
        page.innerHTML = `<div class="fd-ticker">${barHtml}${gridHtml}</div>`;
      }
    } else if (style === 'focus') {
      // ---- Briefing Spotlight: hero story + inline Pony briefing left, Next Up queue right
      if (emptyHtml) {
        page.innerHTML = `<div class="fd-spot-wrap">${barHtml}${emptyHtml}</div>`;
      } else {
        const { bodyHtml, cachedSum, showRunCta } = buildSummaryBody(sel, summaries, ponyOn);
        const sumTag = cachedSum
          ? `<button type="button" class="fd-regen" id="fdRegenSum" title="${esc(_t('Regenerate summary'))}">${fa('arrows-rotate')}</button>`
          : '';
        const queueHtml = `<div class="fd-spot-q sc-y">` + items.slice(0, 18).map((it) => {
          const isSel = sel && sel.id === it.id;
          const hasSum = !!cachedSummaryFor(summaries, it.id);
          return `<button type="button" class="fd-qrow${isSel ? ' on' : ''}" data-id="${esc(it.id)}">`
            + storyThumb(it, images, favicons, 'xs', 12)
            + `<span class="fd-qrow-txt">${esc(it.title)}</span>`
            + (hasSum ? `<span class="fd-qdot" aria-hidden="true"></span>` : '')
            + `</button>`;
        }).join('') + `</div>`;

        page.innerHTML = `<div class="fd-spot">`
          + `<div class="fd-spot-hero">`
          + `<div class="fd-sum-head">${sourceIcon(sel, favicons, 16)}<span class="fd-sum-lbl t1">${esc(sel.publisher || sel.sourceName)}</span>`
          + `<span class="fd-sum-src">${esc(ago(sel.publishedAt))}</span>`
          + `${ponyOn ? langPillHtml() : ''}${sumTag}`
          + `<button type="button" class="fd-regen" id="fdPrev" title="${esc(_t('Previous'))}">${fa('chevron-left')}</button>`
          + `<button type="button" class="fd-regen" id="fdNext" title="${esc(_t('Next'))}">${fa('chevron-right')}</button></div>`
          + `<div class="fd-spot-title">${esc(sel.title)}</div>`
          + `<div class="fd-sum-body">${bodyHtml}</div>`
          + summaryFooterHtml(ponyOn, showRunCta)
          + `</div>`
          + `<div class="fd-spot-side">`
          + `<div class="fd-bar"><span class="fd-spot-qlbl">${esc(_t('Next Up'))}</span>`
          + `<div class="fd-tools"><button type="button" class="fd-tbtn${refreshing ? ' spin' : ''}" id="fdRefresh" title="${esc(_t('Refresh'))}">${fa('arrows-rotate')}</button>`
          + `<button type="button" class="fd-tbtn" id="fdSettings" title="${esc(_t('Settings'))}">${fa('gear')}</button></div></div>`
          + `${queueHtml}</div></div>`;
      }
    } else {
      // ---- Bento (default): Reader + Pony 2-column OLED split
      let listHtml = emptyHtml;
      if (!listHtml) {
        listHtml = `<div class="fd-list sc-y">` + items.map((it) => {
          const isSel = sel && sel.id === it.id;
          const hasSum = !!cachedSummaryFor(summaries, it.id);
          const isBusy = summarizing.has(`${it.id}:${effectiveSummaryLang()}`);
          return `<div class="fd-row${isSel ? ' on' : ''}" data-id="${esc(it.id)}" data-url="${esc(it.url)}">`
            + storyThumb(it, images, favicons, '', 15)
            + `<div class="fd-row-body"><div class="fd-row-title">${esc(it.title)}</div>`
            + `<div class="fd-row-meta t1">${esc(itemMeta(it))}</div></div>`
            + `<div class="fd-row-acts">`
            + (ponyOn ? `<button type="button" class="fd-mini${hasSum ? ' has' : ''}${isBusy ? ' busy' : ''}" data-sum="${esc(it.id)}" title="${esc(_t('Summarize with Pony'))}">${isBusy ? SPINNER_SVG : SPARKLE_SVG}</button>` : '')
            + `<button type="button" class="fd-mini" data-bm="${esc(it.id)}" title="${esc(_t('Save to Bookmarks'))}">${fa('bookmark', 'regular')}</button>`
            + `</div></div>`;
        }).join('') + `</div>`;
      }

      const rightHtml = bentoRightHtml(sel, favicons, summaries, ponyOn);
      page.innerHTML = `<div class="fd-grid">`
        + `<div class="c fd-left">${barHtml}${listHtml}</div>`
        + `<div class="c fd-right">${rightHtml}</div></div>`;
    }

    restoreScrollState();

    // ---- Shared event wiring across all 3 styles
    bindThumbFallbacks(page);
    $$('.fd-chip', page).forEach((b) => {
      b.onclick = () => { activeFilter = b.dataset.filt || 'all'; tickerPreviewOpen = false; render(); };
    });
    const refBtn = $('#fdRefresh', page);
    if (refBtn) refBtn.onclick = doRefresh;
    const setBtn = $('#fdSettings', page);
    if (setBtn) setBtn.onclick = () => api.openSettings('feed');
    const emptyRef = $('#fdEmptyRef', page);
    if (emptyRef) emptyRef.onclick = doRefresh;
    const emptySet = $('#fdEmptySet', page);
    if (emptySet) emptySet.onclick = () => api.openSettings('feed');
    const closeSheet = $('#fdCloseSheet', page);
    if (closeSheet) closeSheet.onclick = () => { tickerPreviewOpen = false; render(); };

    const prevBtn = $('#fdPrev', page);
    if (prevBtn && items.length > 1) {
      prevBtn.onclick = () => { selectedId = items[(selIdx - 1 + items.length) % items.length].id; render(); };
    }
    const nextBtn = $('#fdNext', page);
    if (nextBtn && items.length > 1) {
      nextBtn.onclick = () => { selectedId = items[(selIdx + 1) % items.length].id; render(); };
    }

    $$('.fd-row, .fd-tcard', page).forEach((row) => {
      const it = items.find((x) => x.id === row.dataset.id);
      if (!it) return;
      if (ponyOn) {
        row.onmouseenter = () => {
          clearTimeout(hoverPrefetchTimer);
          hoverPrefetchTimer = setTimeout(() => prefetchStory(it), 120);
        };
      }
      row.onclick = (e) => {
        if (e.target.closest('button')) return;
        selectedId = it.id;
        if (style === 'headlines') {
          tickerPreviewOpen = true;
          render();
          return;
        }
        if (!updateBentoRightInPlace()) render();
      };
      row.ondblclick = () => {
        api.openExternal(it.url);
        N.closeNotch();
      };
    });
    $$('.fd-qrow', page).forEach((row) => {
      const it = items.find((x) => x.id === row.dataset.id);
      if (ponyOn && it) {
        row.onmouseenter = () => {
          clearTimeout(hoverPrefetchTimer);
          hoverPrefetchTimer = setTimeout(() => prefetchStory(it), 120);
        };
      }
      row.onclick = () => { selectedId = row.dataset.id || ''; render(); };
    });
    $$('[data-sum]', page).forEach((b) => {
      const it = items.find((x) => x.id === b.dataset.sum);
      b.onclick = (e) => { e.stopPropagation(); if (it) triggerSummarize(it, false); };
    });
    $$('[data-bm]', page).forEach((b) => {
      const it = items.find((x) => x.id === b.dataset.bm);
      b.onclick = (e) => { e.stopPropagation(); if (it) saveToBookmarks(it); };
    });

    bindDetailActions(sel, ponyOn);
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
    const images = d.images || {};
    const right = items.length ? _t('{n} stories', { n: items.length }) : (d.updatedAt ? ago(d.updatedAt) : '');
    const body = items.length
      ? `<div class="fd-card-list">` + items.slice(0, 2).map((it) =>
        `<div class="fd-card-row">${storyThumb(it, images, favicons, 'xs', 12)}`
        + `<div class="fd-card-txt"><div class="t1">${esc(it.title)}</div>`
        + `<div class="sub t1">${esc(itemMeta(it))}</div></div></div>`).join('') + `</div>`
      : `<div class="sub" style="margin-top:auto">${esc(_t('Hacker News, GitHub Trending & Indonesian news'))}</div>`;
    el.innerHTML = `${N.hd('rss', _t('Feed & RSS'), right)}${body}`;
    bindThumbFallbacks(el);
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
      if (api.onFeedSumDelta) {
        api.onFeedSumDelta((d) => {
          if (!d || !d.id || !d.text) return;
          const lang = d.lang || effectiveSummaryLang();
          sumStreams[`${d.id}:${lang}`] = d.text;
          if (!page || selectedId !== d.id) return;
          const bodyEl = $('.fd-sum-body', page);
          if (bodyEl) {
            const ponyOn = !st.settings || st.settings.feedPonySummary !== false;
            const dAll = feedData();
            const sel = (dAll.items || []).find((i) => i.id === d.id);
            if (sel) {
              bodyEl.innerHTML = buildSummaryBody(sel, dAll.summaries || {}, ponyOn).bodyHtml;
            }
          }
        });
      }
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
