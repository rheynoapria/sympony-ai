// Radio: internet radio inside Sympony. On the left the station playing (or the last one) with play / stop, favourite
// and its own volume; on the right the popular stations of your country (Windows' region, or one picked here), your
// favourites, the recently played, or what a search by name or genre finds. The stream plays in main (radio.rs, with
// Windows' own player), so it goes on while Sympony is closed, and the closed notch shows it like other music.
// Stations come from Radio Browser (radio-browser.info), a free and open directory.
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let rs = null;          // main's radio state: { station, status, error, song, volume, favs, recent, country, region }
  let view = 'top';       // 'top' | 'favs' | 'recent'; a search shows over it while the field has text
  let query = '';
  let top = null;         // { ok, list, country, error } for `topFor`
  let topFor = null;
  let found = null;       // the same for `foundFor`
  let foundFor = '';
  let busy = false;
  let countries = null;
  let volAt = 0;

  // "ID" → "Indonesia"
  const region = (cc) => { try { return new Intl.DisplayNames([_tLocale('en')], { type: 'region' }).of(cc) || cc; } catch { return cc; } };
  const isFav = (id) => !!(rs && (rs.favs || []).some((s) => s.id === id));
  const playingNow = () => !!(rs && (rs.status === 'playing' || rs.status === 'connecting'));
  // "pop, dangdut · MP3 128k"
  function meta(s) {
    const fmt = [s.codec && s.codec !== 'UNKNOWN' ? s.codec : '', s.bitrate ? `${s.bitrate}k` : ''].filter(Boolean).join(' ');
    return [s.tags, fmt].filter(Boolean).join(' · ') || region(s.country || '') || _t('Internet radio');
  }
  // the station's logo from the directory (an icon when it has none, or it doesn't load)
  function logo(s) {
    return s && /^https?:/i.test(s.favicon || '') ? `<img src="${esc(s.favicon)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : fa('radio');
  }

  api.onHelper((m) => { if (m && m.type === 'radio') { rs = m; paint(); refreshCards(); } });

  const SWATCH = ['#f472b6', '#fb923c', '#60a5fa', '#c9b6ff', '#4ade80'];

  function paintNow() {
    const s = rs && rs.station && rs.station.id ? rs.station : null;
    const status = rs ? rs.status : 'stopped';
    const on = playingNow();
    const lg = $('#rdLogo', page);
    if (lg && lg.dataset.id !== (s ? s.id : '')) {
      lg.dataset.id = s ? s.id : '';
      lg.innerHTML = s && /^https?:/i.test(s.favicon || '') ? `<img src="${esc(s.favicon)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:22px">` : 'FM';
    }
    const live = $('#rdLive', page);
    if (live) live.style.display = status === 'playing' ? '' : 'none';
    const eq = $('#rdEq', page);
    if (eq) eq.classList.toggle('off', !on);
    const nm = $('#rdName', page);
    if (nm) nm.textContent = s ? s.name : _t('Radio');
    const sub = !s ? _t('Pick a station to listen') : status === 'connecting' ? _t('Connecting…') : status === 'error' ? (rs.error || _t('This station can’t be played')) : (rs.song || meta(s));
    const subEl = $('#rdSub', page);
    if (subEl) subEl.textContent = sub;
    const play = $('#rdPlay', page);
    if (play) {
      play.disabled = !s;
      play.innerHTML = N.ic(on ? 'pause' : 'play', 'width:16px;height:16px');
      play.title = on ? _t('Stop') : _t('Play');
    }
    const fav = $('#rdFav', page);
    if (fav) {
      const f = !!s && isFav(s.id);
      fav.disabled = !s;
      fav.style.color = f ? '#fbbf24' : '#fff';
      fav.innerHTML = `${N.ic('star', 'width:12px;height:12px')}${esc(_t('Favourite'))}`;
    }
    paintVolume();
  }

  function paintVolume() {
    const bar = $('#rdVol', page);
    if (!bar || bar.classList.contains('drag') || Date.now() - volAt < 600) return;
    const v = rs ? Math.round(rs.volume) : 60;
    bar.style.setProperty('--v', String(v / 100));
  }
  function setVolume(f) {
    const v = Math.max(0, Math.min(100, Math.round(f * 100)));
    volAt = Date.now();
    const bar = $('#rdVol', page);
    if (bar) bar.style.setProperty('--v', String(v / 100));
    api.svc('radio', 'volume', v).catch(() => {});
  }
  function setCountry(v) {
    api.svc('radio', 'country', v).then((r) => { rs = r; top = null; paintHead(); renderList(); loadTop(); }).catch(() => {});
  }

  function current() {
    if (query.length >= 2) return found && foundFor === query ? found : null;
    if (view === 'favs') return { ok: true, list: (rs && rs.favs) || [] };
    if (view === 'recent') return { ok: true, list: (rs && rs.recent) || [] };
    return top && topFor === wantCountry() ? top : null;
  }
  const wantCountry = () => (rs && rs.country) || '';
  const listKey = () => (query.length >= 2 ? 'q:' + query : view + ':' + (view === 'favs' ? ((rs && rs.favs) || []).map((s) => s.id).join() : view === 'recent' ? ((rs && rs.recent) || []).map((s) => s.id).join() : wantCountry()));

  async function loadTop() {
    const cc = wantCountry();
    if (busy || (top && topFor === cc)) return;
    busy = true;
    const r = await api.svc('radio', 'list', 'top', cc).catch((e) => ({ ok: false, error: String(e) }));
    busy = false;
    top = r; topFor = cc;
    paintHead();
    renderList();
    if (wantCountry() !== cc) loadTop();
  }
  async function search() {
    const q = query;
    if (q.length < 2 || (found && foundFor === q)) return;
    const r = await api.svc('radio', 'list', 'search', q).catch((e) => ({ ok: false, error: String(e) }));
    if (q !== query) return;
    found = r; foundFor = q;
    renderList();
  }

  function renderList() {
    const el = $('#rdList', page);
    if (!el) return;
    const r = current();
    const searching = query.length >= 2;
    if (!r) { el.innerHTML = `<div class="sub" style="margin:auto;text-align:center">${esc(searching ? _t('Searching…') : _t('Loading stations…'))}</div>`; return; }
    if (!r.ok) { el.innerHTML = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('Couldn’t reach Radio Browser'))}</div>`; return; }
    const list = r.list || [];
    if (!list.length) {
      el.innerHTML = `<div class="sub" style="margin:auto;text-align:center">${esc(searching ? _t('No stations found') : view === 'favs' ? _t('Star a station to keep it here') : _t('No stations here'))}</div>`;
      return;
    }
    const curId = rs && rs.station && rs.station.id;
    el.dataset.key = listKey();
    el.innerHTML = list.slice(0, 20).map((s, i) => {
      const on = s.id === curId && playingNow();
      return `<div class="row rd-row" data-i="${i}" style="gap:9px;padding:5px 6px;border-radius:10px;cursor:pointer;${on ? 'background:var(--pill-hi)' : ''}">`
        + `<i style="width:22px;height:22px;border-radius:7px;background:${SWATCH[i % SWATCH.length]};flex:none;display:block"></i>`
        + `<span class="t1" style="flex:1;font-size:12.5px;font-weight:${on ? 700 : 500}">${esc(s.name)}</span>`
        + `<span class="sub n" style="font-size:10.5px;flex:none">${esc(s.bitrate ? `${s.bitrate}k` : 'FM')}</span>`
        + (view === 'recent' && !searching ? `<button type="button" class="mini-btn" data-rx="${i}" title="${esc(_t('Remove from Recent'))}" style="width:18px;height:18px;font-size:9px">×</button>` : '')
        + `</div>`;
    }).join('');
    $$('.rd-row', el).forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('[data-rx]')) return;
        const s = list[+row.dataset.i];
        if (rs && rs.station && rs.station.id === s.id && playingNow()) api.svc('radio', 'stop');
        else api.svc('radio', 'play', s);
      };
    });
    $$('[data-rx]', el).forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); api.svc('radio', 'forget', list[+b.dataset.rx].id); };
    });
  }

  function paintRows() { renderList(); }

  function paintHead() {
    $$('#rdSeg button', page).forEach((b) => b.classList.toggle('on', query.length < 2 && b.dataset.v === view));
    const cc = $('#rdCc', page);
    if (!cc) return;
    const code = (top && topFor === wantCountry() && top.ok ? top.country : wantCountry() || (rs && rs.region)) || '';
    cc.hidden = view !== 'top' || query.length >= 2;
    if (countries) {
      const reg = rs && rs.region;
      const sys = N.MAC
        ? (reg ? _t('{country} (Mac region)', { country: region(reg) }) : _t('Mac region'))
        : (reg ? _t('{country} (Windows region)', { country: region(reg) }) : _t('Windows region'));
      const opts = [['', sys], ...countries.map((c) => [c.code, `${region(c.code)} · ${c.count}`])];
      N.pick(cc, { options: opts, value: wantCountry(), onChange: setCountry });
    } else {
      cc.onclick = async () => {
        const r = await api.svc('radio', 'countries').catch(() => null);
        countries = Array.isArray(r) ? r : [];
        paintHead();
        cc.click();
      };
    }
    cc.textContent = code || 'All';
    cc.title = code ? _t('Popular in {country}', { country: region(code) }) : _t('Popular worldwide');
  }

  function build() {
    page.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c" style="padding:12px 14px"><div class="row" style="gap:14px;height:100%">`
      + `<div id="rdLogo" style="width:120px;height:120px;border-radius:22px;background:#f472b6;display:grid;place-items:center;flex:none;color:#000;font:800 30px var(--round);overflow:hidden">FM</div>`
      + `<div style="flex:1;min-width:0;display:flex;flex-direction:column;height:100%;padding:4px 0">`
      + `<span id="rdLive" class="pill" style="background:#f472b622;color:#f472b6;align-self:flex-start;display:none">● LIVE</span>`
      + `<div id="rdName" class="t1" style="font-size:19px;font-weight:700;margin-top:6px"></div>`
      + `<div id="rdSub" class="sub t1"></div>`
      + `<span id="rdEq" class="eq off" style="color:#f472b6;margin-top:8px"><i></i><i></i><i></i><i></i><i></i></span>`
      + `<div class="row" style="gap:6px;margin-top:auto">`
      + `<button type="button" id="rdPlay" style="width:36px;height:36px;border-radius:50%;background:#fff;color:#000;display:grid;place-items:center;cursor:pointer;flex:none"></button>`
      + `<button type="button" class="sbtn" id="rdFav" style="height:28px;padding:0 8px"></button>`
      + `<div class="mc-sl-bar" id="rdVol" style="flex:1;height:22px;min-width:44px;--v:0.6" title="${esc(_t('Radio volume'))}"><i></i>${N.ic('vol', 'width:11px;height:11px')}</div>`
      + `</div></div></div></div>`
      + `<div class="c" style="padding:10px 12px;gap:6px">`
      + `<div class="row" style="gap:5px;flex:none"><div class="seg2" id="rdSeg"><button type="button" data-v="top" style="height:22px;padding:0 6px;font-size:10px">${esc(_t('Popular'))}</button><button type="button" data-v="favs" style="height:22px;padding:0 6px;font-size:10px">${esc(_t('Favourites'))}</button><button type="button" data-v="recent" style="height:22px;padding:0 6px;font-size:10px">${esc(_t('Recent'))}</button></div>`
      + `<button type="button" class="sbtn" id="rdCc" style="height:22px;padding:0 6px;font-size:10px"></button>`
      + `<input type="search" id="rdQ" placeholder="${esc(_t('Search'))}" spellcheck="false" style="flex:1;min-width:0;height:22px;border-radius:8px;background:var(--pill);border:0;padding:0 7px;font-size:10.5px;color:#fff;outline:none"></div>`
      + `<div id="rdList" class="sc-y" style="display:flex;flex-direction:column;gap:3px;flex:1"></div>`
      + `</div></div>`;

    $('#rdPlay', page).onclick = () => { if (playingNow()) api.svc('radio', 'stop'); else if (rs && rs.station) api.svc('radio', 'play', rs.station); };
    $('#rdFav', page).onclick = () => { if (rs && rs.station) api.svc('radio', 'fav', rs.station); };
    const volBar = $('#rdVol', page);
    if (volBar) {
      const updateVol = (e) => {
        const r = volBar.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        setVolume(f);
      };
      volBar.onpointerdown = (e) => {
        volBar.classList.add('drag');
        volBar.setPointerCapture(e.pointerId);
        updateVol(e);
      };
      volBar.onpointermove = (e) => { if (volBar.classList.contains('drag')) updateVol(e); };
      volBar.onpointerup = () => { volBar.classList.remove('drag'); };
    }
    $$('#rdSeg button', page).forEach((b) => {
      b.onclick = () => {
        view = b.dataset.v;
        if (query) { query = ''; $('#rdQ', page).value = ''; }
        paintHead(); renderList();
        if (view === 'top') loadTop();
      };
    });
    const input = $('#rdQ', page);
    input.oninput = () => {
      query = input.value.trim();
      paintHead(); renderList();
      N.later('radio-search', 450, search);
    };
  }

  function paint() {
    if (!page || !page.firstChild) return;
    paintNow();
    paintHead();
    if ($('#rdList', page).dataset.key !== listKey()) renderList(); else paintRows();
  }

  // ------------------------------------------------------------ 1×1 Radio FM card (matches modules.html)
  const cards = new Set();
  let stateLoaded = false;

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#f472b6');
    el.style.flexDirection = 'row';
    el.style.gap = '10px';
    el.style.alignItems = 'center';
    if (!stateLoaded) {
      stateLoaded = true;
      api.svc('radio', 'state').then((v) => { if (v) { rs = v; refreshCards(); } }).catch(() => {});
    }
    const s = rs && rs.station && rs.station.id ? rs.station : null;
    const on = playingNow();
    const sub = s ? (s.bitrate ? `${s.bitrate}k FM` : 'Online') : _t('Radio');
    el.innerHTML = `<div style="width:44px;height:44px;border-radius:12px;background:#f472b6;display:grid;place-items:center;flex:none;color:#000;font:800 13px var(--round);overflow:hidden">${s && /^https?:/i.test(s.favicon || '') ? `<img src="${esc(s.favicon)}" style="width:100%;height:100%;object-fit:cover" alt="">` : 'FM'}</div>`
      + `<div style="min-width:0;display:flex;flex-direction:column;gap:3px"><span class="eq${on ? '' : ' off'}" style="height:12px;color:#f472b6"><i></i><i></i><i></i><i></i></span>`
      + `<span class="t1" style="font-size:12.5px;font-weight:700">${esc(s ? s.name : _t('Radio'))}</span>`
      + `<span class="sub t1">${esc(sub)}</span></div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'radio',
    tall: true,
    async init(p) {
      page = p;
      build();
      rs = await api.svc('radio', 'state').catch(() => null);
      paint();
      renderList();
      loadTop();
    },
    show() { paint(); loadTop(); },
    update() { paint(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('radio'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
