// Notification history: what Sympony showed, and what Do not disturb held back (notifhist.rs), opened from the bell
// in the top bar (a special page, not a tab). Filters on the left (all, held during DND, one row per app), the
// list by day on the right; a click opens the notification where its own pop-up would and marks it read.
// Above the filters, Windows' Do not disturb switch (notif.rs dnd_set) and the "Quiet pop-ups" option.
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let data = null;         // the last notif.history
  let filter = 'all';      // 'all', 'dnd' or 'app:<aumid>'
  let confirming = false;  // "Clear all" asks right there first
  let dnd = null;          // notif.dnd: { known, on, mode }
  let dndBusy = false;     // switching it
  let dndNote = '';        // Windows didn't take it: its settings opened instead
  let dndPoll;

  const on = () => !!st.settings && st.settings.notifHistory !== false;
  const visible = () => st.open && st.page === 'notifs';

  async function load() {
    if (on()) {
      const h = await api.svc('notif', 'history').catch(() => null);
      if (h) data = h;
    }
    render();
  }

  // Do not disturb can change elsewhere (Windows' own button, its schedule): looked at every 2 s while this shows
  async function loadDnd() {
    const d = await api.svc('notif', 'dnd').catch(() => null);
    if (!d || dndBusy || JSON.stringify(d) === JSON.stringify(dnd)) return;
    dnd = d;
    if (visible()) render();
  }

  function dndBlock() {
    // a Mac: Sympony only reads macOS's notifications, its Focus isn't followed (macnotif.rs); Linux reads none yet
    if (N.MAC || N.LINUX) return '';
    const s = st.settings;
    const isOn = !!(dnd && dnd.on);
    const state = dndNote || (!dnd ? '' : !dnd.known ? _t('Unknown') : isOn ? (dnd.mode === 'alarms' ? _t('Alarms only') : _t('On')) : _t('Off'));
    // only matters while Sympony follows Do not disturb (Settings → Notifications)
    const peek = s.notifFollowDnd === false ? ''
      : `<button class="nh-peek ${s.notifDndPeek ? 'on' : ''}" data-act="peek" title="${_t('While Do not disturb holds them back, a small pop-up still says one came: the app’s icon and how many, never the title or text')}"><b class="nh-sw"></b><span>${_t('Quiet pop-ups')}</span></button>`;
    return `<div class="nh-dnd-box"><button class="nh-dnd ${isOn ? 'on' : ''}" data-act="dnd" ${!dnd || dndBusy ? 'disabled' : ''} title="${isOn ? _t('Turn Windows’ Do not disturb off') : _t('Turn Windows’ Do not disturb on')}">`
      + `${fa('moon')}<span><b>${_t('Do not disturb')}</b><small>${esc(state)}</small></span></button>${peek}</div><div class="nh-sep"></div>`;
  }

  function switchDnd() {
    if (!dnd || dndBusy) return;
    const want = !dnd.on;
    dndBusy = true;
    dndNote = '';
    dnd = { ...dnd, on: want, mode: want ? 'priority' : 'off' };
    render();
    api.svc('notif', 'setDnd', want).catch(() => null).then((r) => {
      dndBusy = false;
      dnd = null; // read again below
      // Windows didn't take it from Sympony: its notification settings opened, with the switch
      if (!r || !r.ok) { dndNote = _t('In Windows’ settings'); N.later('nhDndNote', 8000, () => { dndNote = ''; if (visible()) render(); }); }
      loadDnd();
    });
  }

  function dayLabel(t) {
    const d = N.startOfDay(t);
    const today = N.startOfDay(Date.now());
    if (d === today) return _t('Today');
    if (d === N.startOfDay(today - 1)) return _t('Yesterday');
    return new Date(t).toLocaleDateString(_tLocale('en-GB'), { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function agoShort(t) {
    if (!t) return '';
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return _t('now');
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  }

  function notifIcon(apps, it, size) {
    const appInfo = apps[it.aumid] || {};
    if (appInfo.icon) return `<img class="appic" src="${esc(appInfo.icon)}" style="width:${size}px;height:${size}px" alt="">`;
    return N.realAppIcon ? N.realAppIcon(it.aumid || appInfo.name || it.app, size, fa('bell')) : `<span class="appic-fb" style="width:${size}px;height:${size}px">${fa('bell')}</span>`;
  }

  function render() {
    if (!page) return;
    const items = (data && data.items) || [];
    const apps = (data && data.apps) || {};
    const appName = (aumid, fallback) => (apps[aumid] && apps[aumid].name) || fallback || aumid;
    const perApp = new Map();
    for (const it of items) perApp.set(it.aumid, (perApp.get(it.aumid) || 0) + 1);
    if (filter.startsWith('app:') && !perApp.has(filter.slice(4))) filter = 'all';
    const shown = items.filter((i) => filter === 'all' || (filter === 'dnd' ? i.dnd : filter === 'app:' + i.aumid));
    const unread = items.some((i) => !i.read);

    if (!on()) {
      page.innerHTML = `<div class="c" style="flex:1;justify-content:center;align-items:center;gap:10px;text-align:center">`
        + `<b>${esc(_t('History is off'))}</b>`
        + `<button type="button" class="sbtn p" data-act="settings">${esc(_t('Turn it on in Settings'))}</button></div>`;
      bind();
      return;
    }

    const topApps = [...perApp].slice(0, 2);
    const segBtns = `<button type="button" class="${filter === 'all' ? 'on' : ''}" data-f="all">${esc(_t('All'))}${items.length ? ' ' + items.length : ''}</button>`
      + topApps.map(([a, n]) => {
        const sample = items.find((i) => i.aumid === a);
        const lbl = appName(a, sample && sample.app);
        return `<button type="button" class="${filter === 'app:' + a ? 'on' : ''}" data-f="${esc('app:' + a)}">${esc(lbl.slice(0, 12))} ${n}</button>`;
      }).join('');

    const rightActs = confirming
      ? `<button type="button" class="sbtn p" data-act="clear-yes" style="height:28px">${esc(_t('Clear'))}</button><button type="button" class="sbtn" data-act="clear-no" style="height:28px">${esc(_t('Cancel'))}</button>`
      : `${unread ? `<button type="button" class="sbtn" data-act="read" style="height:28px">${esc(_t('Mark all read'))}</button>` : ''}`
        + `<button type="button" class="sbtn" data-act="clear" ${items.length ? '' : 'disabled'} style="height:28px">${esc(_t('Clear all'))}</button>`;

    const rowsHtml = shown.length
      ? shown.map((it) => {
        const name = appName(it.aumid, it.app);
        const title = it.title ? (name && name !== it.title ? `${name} · ${it.title}` : it.title) : name;
        return `<div class="row nh-item" data-id="${esc(it.id)}" style="gap:10px;padding:6px 8px;border-radius:12px;cursor:pointer;${it.read ? 'opacity:0.65' : ''}">`
          + `${notifIcon(apps, it, 26)}`
          + `<div style="flex:1;min-width:0"><div class="t1" style="font-size:12.5px;font-weight:600">${esc(title)}</div>`
          + `${it.body ? `<div class="t1 sub" style="font-size:11.5px">${esc(it.body)}</div>` : ''}</div>`
          + `<span class="sub" style="font-size:10.5px;flex:none">${esc(agoShort(it.at || it.ts))}</span>`
          + `<button type="button" class="nh-x" title="${esc(_t('Remove'))}" style="color:var(--mute);cursor:pointer;flex:none">×</button></div>`;
      }).join('')
      : `<div class="sub" style="margin:auto;text-align:center;padding:16px">${esc(_t('No notifications yet'))}</div>`;

    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%;min-height:0">`
      + `<div class="row" style="gap:8px;flex:none"><div class="seg2 sc-x" style="max-width:65%">${segBtns}</div><span style="flex:1"></span>${rightActs}</div>`
      + `<div class="c grow sc-y" style="padding:4px;gap:2px">${rowsHtml}</div></div>`;
    bind();
  }

  function bind() {
    $$('[data-act]', page).forEach((b) => { b.onclick = () => act(b.dataset.act); });
    $$('[data-f]', page).forEach((b) => { b.onclick = () => { filter = b.dataset.f; render(); }; });
    $$('.nh-item', page).forEach((el) => {
      const it = ((data && data.items) || []).find((x) => x.id === el.dataset.id);
      if (!it) return;
      el.onclick = () => {
        api.svc('notif', 'open', it.aumid, it.launch || '', it.activation || '');
        if (!it.read) { it.read = true; api.svc('notif', 'read', it.id).catch(() => {}); render(); refreshCards(); }
      };
      const rm = $('.nh-x', el);
      if (rm) rm.onclick = (e) => {
        e.stopPropagation();
        data.items = data.items.filter((x) => x !== it);
        api.svc('notif', 'remove', it.id).catch(() => {});
        render();
        refreshCards();
      };
    });
  }

  function act(a) {
    const items = (data && data.items) || [];
    switch (a) {
      case 'back': N.carousel && N.carousel.closeFull(); break;
      case 'read': items.forEach((i) => { i.read = true; }); api.svc('notif', 'read', 'all').catch(() => {}); render(); refreshCards(); break;
      case 'clear': confirming = true; render(); break;
      case 'clear-no': confirming = false; render(); break;
      case 'clear-yes':
        confirming = false;
        if (data) data.items = [];
        api.svc('notif', 'clear').catch(() => {});
        render();
        refreshCards();
        break;
      case 'settings': case 'change': api.openSettings('notifications'); N.closeNotch(); break;
      case 'dnd': switchDnd(); break;
      case 'peek': api.setSettings({ notifDndPeek: !st.settings.notifDndPeek }); break;
    }
  }

  // ------------------------------------------------------------ 2×1 Stacked Notifications card (matches modules.html)
  const cards = new Set();
  let cardLoaded = false;

  function paintCard(slot) {
    const { el } = slot;
    el.style.paddingTop = '10px';
    if (!data && !cardLoaded && on()) {
      cardLoaded = true;
      api.svc('notif', 'history').then((h) => { if (h) { data = h; refreshCards(); } }).catch(() => {});
    }
    const items = (data && data.items) || [];
    const apps = (data && data.apps) || {};
    if (!items.length) {
      el.innerHTML = `${N.hd('bell', _t('Notifications'))}<div class="sub" style="margin-top:auto">${esc(_t('No notifications yet'))}</div>`;
      return;
    }
    const top = items[0];
    const extra = items.length - 1;
    const appInfo = apps[top.aumid] || {};
    const sender = top.title || appInfo.name || top.app || _t('Notification');
    const bodyText = top.body || appInfo.name || '';
    const backCard = extra > 0
      ? `<div style="position:absolute;left:10px;right:10px;top:0;height:52px;border-radius:14px;background:#16161b"></div>`
      : '';
    const frontCard = `<div class="row" style="position:absolute;left:0;right:0;top:${extra > 0 ? 8 : 2}px;padding:8px 10px;border-radius:14px;background:#1f1f26;gap:9px">`
      + `${notifIcon(apps, top, 28)}<div style="flex:1;min-width:0">`
      + `<div class="row" style="justify-content:space-between"><b class="t1" style="font-size:12px">${esc(sender)}</b><span class="sub" style="font-size:10.5px;flex:none">${esc(agoShort(top.at || top.ts))}</span></div>`
      + `<div class="t1 sub" style="font-size:11.5px">${esc(bodyText)}</div></div></div>`;

    el.innerHTML = `<div style="position:relative;flex:1">${backCard}${frontCard}</div>`
      + `<div class="sub" style="font-size:10.5px;text-align:center;margin-top:auto">${extra > 0 ? esc(_t('+{n} more', { n: extra })) : esc(_t('Notifications'))}</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'notifs',
    tall: true,
    init(p) { page = p; },
    show() {
      confirming = false;
      load();
      clearInterval(dndPoll);
      if (!N.MAC && !N.LINUX) { loadDnd(); dndPoll = setInterval(loadDnd, 2000); }
      // the badge clears; the unread dots stay until they're opened or all are marked read
      if (on()) api.svc('notif', 'seen').catch(() => {});
    },
    hide() { confirming = false; clearInterval(dndPoll); },
    // ← / → stay here while "Clear all" asks
    usesArrows() { return confirming; },
    // main: the history changed (a new one, one read, pruned…) or was seen
    update(h) {
      if (h && (!data || h.rev !== data.rev)) {
        api.svc('notif', 'history').then((full) => { if (full) { data = full; refreshCards(); if (visible()) render(); } }).catch(() => {});
      }
      if (!visible()) return;
      if (!data || !h || h.rev !== data.rev) load();
      if (h && h.unseen > 0) api.svc('notif', 'seen').catch(() => {});
    },
    onSettings() { if (visible()) load(); refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('notifs'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
