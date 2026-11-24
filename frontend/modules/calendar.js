// Calendar tab: the whole month on the left (a dot for days with events, an orange one for tasks with a
// time), the chosen day's agenda on the right: all-day and timed events, and the Todo tasks due that day.
// Clicking an event shows its card there instead (Esc or the day goes back to the list).
// + Event, or a Sympony event's Edit, shows a form there to add or change one of Sympony's own events.
// Events come from the calendars in Settings → Calendar (main loads five weeks back and two months ahead).
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let month = null; // the month shown: [year, month]
  let sel = null; // the chosen day: start of day (ms)
  let detail = null; // the event whose card shows in place of the day's list (its id)
  let askDelete = false; // the card asks "Delete this event?" (Sympony's own events)
  // the form in place of the day's list: { id: the Sympony event it changes (null: a new one), back: the card it was
  // opened from, minutes, repeat, ask: it asks "Delete this event?" }
  let form = null;
  let dayField; let timeField; // the form's day and time fields (datetime.js: drawn inside the notch)
  let saved = null; // the event just saved: { id, until }, its row lights up in the day's list
  let gcal = null; // live Google Calendar OAuth state (pony:gcal)
  api.svc('pony', 'gcalState').then((v) => { gcal = v; }).catch(() => {});
  api.on('pony:gcal', (v) => { gcal = v; });
  const gcalWriteCal = () => {
    if (!gcal || !gcal.signedIn || !gcal.hasCalendarScope) return null;
    const cals = gcal.calendars || [];
    return cals.find((c) => c.id === gcal.defaultCalendarId && c.writable)
      || cals.find((c) => c.primary && c.selected && c.writable)
      || cals.find((c) => c.selected && c.writable)
      || cals.find((c) => c.writable)
      || null;
  };

  const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const isoDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayShort = (t) => new Date(t).toLocaleDateString(_tLocale('en-GB'), { weekday: 'short', day: 'numeric' });
  const next = (t) => { const d = new Date(t); d.setDate(d.getDate() + 1); return d.getTime(); }; // DST-safe
  const events = () => st.events || [];
  const tasks = () => ((N.data.todo || {}).items || []).filter((t) => t.due && !t.deletedAt);

  function dayItems(d) {
    const end = next(d);
    return {
      ev: events().filter((e) => e.start < end && e.end > d).sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.start - b.start),
      td: tasks().filter((t) => t.due >= d && t.due < end).sort((a, b) => a.due - b.due),
    };
  }

  function renderMonth() {
    const [y, m] = month;
    const first = new Date(y, m, 1);
    $('.calm-title', page).innerHTML = `${esc(first.toLocaleDateString(_tLocale(), { month: 'long' }))} ${y}`;
    const lead = (first.getDay() + 6) % 7;
    const today = sod(Date.now());
    let html = '';
    for (let i = 0; i < 7; i++) html += `<span style="color:var(--mute);font-size:9.5px;font-weight:700">${esc(new Date(2024, 0, 1 + i).toLocaleDateString(_tLocale(), { weekday: 'narrow' }))}</span>`;
    for (let i = 0; i < 35; i++) {
      const d = new Date(y, m, 1 - lead + i).getTime();
      const dt = new Date(d);
      const { ev, td } = dayItems(d);
      const isOut = dt.getMonth() !== m;
      const isToday = d === today;
      const isSel = d === sel;
      const hasDot = ev.length > 0 || td.some((t) => !t.done);
      const bg = isToday ? 'background:#ff5a52;color:#fff' : isSel ? 'background:var(--pill-hi);color:#fff' : isOut ? 'color:#2c2c34' : 'color:#d6d6dc';
      const dotCol = ev[0] ? (ev[0].color || '#8fa2ff') : '#fb923c';
      html += `<button type="button" class="n" data-day="${d}" style="min-height:18px;height:100%;max-height:24px;display:grid;place-items:center;border-radius:11px;font-size:11px;position:relative;cursor:pointer;${bg}">${dt.getDate()}${hasDot && !isToday ? `<i style="position:absolute;bottom:1px;width:3px;height:3px;border-radius:2px;background:${esc(dotCol)}"></i>` : ''}</button>`;
    }
    const grid = $('.calm-grid', page);
    grid.innerHTML = html;
    $$('[data-day]', grid).forEach((b) => {
      b.onclick = () => {
        sel = +b.dataset.day;
        detail = null;
        const d = new Date(sel);
        if (d.getMonth() !== m) month = [d.getFullYear(), d.getMonth()];
        if (form) formDay();
        render();
      };
    });
  }

  function renderDay() {
    const d = new Date(sel);
    const today = sod(Date.now());
    const label = d.toLocaleDateString(_tLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
    $('.calm-dayhead', page).innerHTML = `<b style="font-size:14px">${esc(label)}</b>`;
    const { ev, td } = dayItems(sel);
    const now = Date.now();
    const lit = saved && saved.until > now ? saved.id : null;
    const rows = ev.map((e) => {
      const link = e.url || (isUrl(e.location) ? e.location.trim() : '');
      const meet = link ? meetingName(link) : '';
      const joinLbl = link ? (['Google Meet', 'Zoom', 'Microsoft Teams', 'Webex'].includes(meet) ? _t('Join') : _t('Open')) : '';
      const col = e.color || '#8fa2ff';
      const past = e.end < now;
      return `<div class="row" data-ev="${esc(e.id)}" style="gap:10px;padding:6px 8px;border-radius:12px;background:${lit && e.uid === lit ? 'rgba(74,222,128,0.14)' : 'rgba(255,255,255,0.035)'};opacity:${past ? 0.52 : 1};cursor:pointer">`
        + `<div class="n" style="width:38px;font-size:11px;line-height:1.2;flex:none"><b>${esc(e.allDay ? _t('All') : N.hm(e.start))}</b><br><span class="mute">${esc(e.allDay ? _t('day') : N.hm(e.end))}</span></div>`
        + `<i style="width:3px;height:28px;border-radius:2px;background:${esc(col)};flex:none"></i>`
        + `<span class="t1" style="flex:1;font-size:12.5px;font-weight:600">${esc(e.title)}</span>`
        + `${N.eventAppIcon(e, 20, 5)}`
        + `${joinLbl ? `<button type="button" class="sbtn${joinLbl === _t('Join') ? ' p' : ''}" data-join="${esc(link)}" style="height:24px;padding:0 10px">${esc(joinLbl)}</button>` : ''}</div>`;
    }).concat(td.map((t) => `<div class="row" data-task="${esc(t.id)}" style="gap:10px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,0.035);opacity:${t.done ? 0.5 : 1};cursor:pointer">`
      + `<div class="n" style="width:38px;font-size:11px;line-height:1.2;flex:none"><b>${esc(N.hm(t.due))}</b><br><span class="mute">${esc(_t('Todo'))}</span></div>`
      + `<i style="width:3px;height:28px;border-radius:2px;background:#fb923c;flex:none"></i>`
      + `<span class="t1" style="flex:1;font-size:12.5px;font-weight:600">${t.done ? '<s>' : ''}${esc(t.text)}${t.done ? '</s>' : ''}</span></div>`));

    const noCalendars = !(st.settings.icsFeeds || []).length && !(st.settings.localEvents || []).length
      && !(st.events || []).some((e) => e.provider === 'mac' || e.provider === 'gcal')
      && !(gcal && gcal.signedIn && gcal.hasCalendarScope);
    const far = sel < today - 35 * 86400000 || sel > today + 64 * 86400000;
    $('.calm-list', page).innerHTML = rows.length ? rows.join('')
      : `<div class="sub" style="margin:auto;text-align:center;padding:12px">${far ? _t('Sympony loads events from five weeks back to two months ahead.') : noCalendars ? `${_t('No calendars yet.')}<br><button type="button" class="sbtn" style="margin-top:8px" data-cal="settings">${_t('Connect Google / Outlook calendar')}</button>` : _t('Nothing on this day')}</div>`;
    $$('[data-join]', page).forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); api.openExternal(b.dataset.join); N.closeNotch(); }; });
    $$('[data-ev]', page).forEach((el) => { el.onclick = () => { detail = el.dataset.ev; askDelete = false; render(); if (N.layout) N.layout(); }; });
    $$('[data-task]', page).forEach((el) => { el.onclick = () => N.openModule('todo'); });
    const c = $('[data-cal="settings"]', page); if (c) c.onclick = () => api.openSettings('calendar');
  }

  // ------------------------------------------------------------------ the event's card
  const PROVIDER = { google: 'Google', gcal: 'Google Calendar', outlook: 'Outlook' };
  const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
  // a location that only says the meeting is online (Outlook puts "Microsoft Teams Meeting" there): no map for it
  const ONLINE = /^(microsoft teams( meeting)?|teams meeting|zoom( meeting)?|google meet|webex( meeting)?|online( meeting)?)$/i;
  // "Mon 26 Oct", with the year when it isn't this one
  const dayText = (t) => new Date(t).toLocaleDateString(_tLocale('en-GB'), { weekday: 'short', day: 'numeric', month: 'short',
    ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });

  function meetingName(url) {
    const host = ((url.match(/^\w+:\/\/([^/?#]+)/) || [])[1] || '').toLowerCase().replace(/^www\./, '');
    if (/(^|\.)meet\.google\.com$/.test(host)) return 'Google Meet';
    if (/(^|\.)zoom\.us$/.test(host)) return 'Zoom';
    if (/(^|\.)teams\.(microsoft|live)\.com$/.test(host)) return 'Microsoft Teams';
    if (/(^|\.)webex\.com$/.test(host)) return 'Webex';
    return host;
  }

  function whenText(e) {
    if (e.allDay) {
      const last = e.end - 1; // all-day events end at the next midnight
      return `${sod(last) > e.start ? `${dayText(e.start)} – ${dayText(last)}` : dayText(e.start)} · ${_t('All day')}`;
    }
    return sod(e.end - 1) > sod(e.start) ? `${dayText(e.start)} ${N.hm(e.start)} – ${dayText(e.end)} ${N.hm(e.end)}`
      : `${dayText(e.start)} · ${N.hm(e.start)} – ${N.hm(e.end)}`;
  }

  // the pill next to the time: [text, class] (go: green, past: grey)
  function status(e) {
    const now = Date.now();
    if (e.end <= now) return [_t('ended'), 'past'];
    if (e.start <= now) return [e.allDay ? _t('today') : _t('now'), 'go'];
    const mins = Math.ceil((e.start - now) / 60000);
    if (!e.allDay && mins < 60) return [_t('in {n} min', { n: mins }), 'go'];
    const days = Math.round((sod(e.start) - sod(now)) / 86400000); // rounded: a day can be 23 or 25 hours
    if (days === 0) return [N.fmtIn ? N.fmtIn(mins) : _t('in {n} h', { n: Math.round(mins / 60) }), ''];
    return [days === 1 ? _t('tomorrow') : _t('in {n} days', { n: days }), ''];
  }

  const initials = (name) => {
    const w = String(name).replace(/@.*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
    return w.slice(0, 2).map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
  };
  const tint = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360; return `hsl(${h} 40% 34%)`; };

  // the address in plain text, the rest escaped (escape first: the text is from the calendar)
  function linkify(text) {
    const re = /https?:\/\/[^\s<>"]+/gi;
    let out = ''; let at = 0; let m;
    while ((m = re.exec(text))) {
      let url = m[0];
      // a sentence's full stop or a closing bracket isn't part of the address
      while (/[.,;:!?'\]]$/.test(url) || (url.endsWith(')') && !url.includes('('))) url = url.slice(0, -1);
      out += `${esc(text.slice(at, m.index))}<a data-href="${esc(url)}" title="${esc(url)}">${esc(url)}</a>`;
      at = re.lastIndex = m.index + Math.max(url.length, 1);
    }
    return out + esc(text.slice(at));
  }

  function renderDetail(e) {
    const card = $('.cald', page);
    const s = st.settings;
    const local = e.provider === 'sympony';
    const editableGcal = e.provider === 'gcal' && !!e.writable;
    const editable = local || editableGcal;
    const link = e.url || (isUrl(e.location) ? e.location.trim() : '');
    const meet = link ? meetingName(link) : '';
    const known = ['Google Meet', 'Zoom', 'Microsoft Teams', 'Webex'].includes(meet);
    const place = e.location && !isUrl(e.location) && !(link && ONLINE.test(e.location.trim())) ? e.location.trim() : '';
    const [pill, pillCls] = status(e);
    const from = PROVIDER[e.provider];
    const src = local ? 'Sympony' : from ? `${e.source} · ${from}` : e.source;
    const row = (icon, html, attrs = '') => `<div class="cald-row" ${attrs}>${icon}<span class="cald-txt">${html}</span></div>`;
    const rows = [];
    const bare = esc(link.replace(/^https?:\/\//i, ''));
    if (link) rows.push(row(fa(known ? 'video' : 'link'), known ? `<b>${esc(meet)}</b> <span class="muted">${bare}</span>` : bare, `data-act="join" title="${esc(link)}"`));
    if (place) rows.push(row(fa('location-dot'), esc(place), `data-act="map" title="${_t('Show on the map')}"`));
    // (Sympony's own and the feeds' say daily…yearly; the Mac's calendars only that it repeats)
    if (e.repeat) rows.push(row(fa('repeat'), esc((LocalEvents.repeats().find(([v]) => v === e.repeat) || [, _t('Repeats')])[1])));
    const guests = e.attendees || [];
    const count = e.attendeeCount || guests.length;
    if (e.organizer || count) {
      const people = [e.organizer, ...guests].filter(Boolean);
      const faces = people.slice(0, 3).map((p) => `<i style="background:${tint(p)}">${esc(initials(p))}</i>`).join('');
      const text = [e.organizer && _t('{name} (organizer)', { name: e.organizer }), count && (count === 1 ? _t('{n} guest', { n: count }) : _t('{n} guests', { n: count }))].filter(Boolean).join(' · ');
      rows.push(row(fa('user-group'), `<span class="cald-faces">${faces}</span>${esc(text)}`, `title="${esc(people.join(', '))}"`));
    }
    if (s.calendarEnabled && s.meetingReminderMinutes > 0 && !e.allDay && e.start > Date.now()) {
      rows.push(row(fa('bell', 'regular'), _t('Sympony reminds you {n} min before', { n: s.meetingReminderMinutes })));
    }
    // a calendar shared with free/busy only: every event is called "Busy"
    const busy = from && /^busy$/i.test(String(e.title).trim());
    const hint = busy ? `<div class="cald-hint">${fa('triangle-exclamation')}<span>${e.provider === 'google'
      ? _t('This calendar only shares busy times. In Google Calendar, share it with the <b>Secret address in iCal format</b>, then paste the new link in Settings.')
      : _t('This calendar only shares busy times. In Outlook on the web, publish it again with <b>Can view titles and locations</b>, then paste the new link in Settings.')}</span></div>` : '';
    const acts = askDelete
      ? `<span class="cald-ask">${e.repeat ? _t('Delete this event and its repeats?') : _t('Delete this event?')}</span>
        <button class="pill-btn cald-del" data-act="del-yes">${_t('Yes')}</button><button class="pill-btn" data-act="del-no">${_t('No')}</button>`
      : [busy && `<button class="pill-btn" data-act="settings">${fa('gear')} ${_t('Calendar settings')}</button>`,
        link && `<button class="pill-btn cald-join" data-act="join">${fa(known ? 'video' : 'link')} ${known ? _t('Join') : _t('Open link')}</button>`,
        e.openUrl && from && `<button class="pill-btn" data-act="open">${fa('up-right-from-square')} ${_t('Open in {app}', { app: (e.provider === 'google' || e.provider === 'gcal') ? 'Google Calendar' : 'Outlook' })}</button>`,
        link && `<button class="pill-btn" data-act="copy">${fa('copy', 'regular')} ${_t('Copy link')}</button>`,
        place && `<button class="pill-btn" data-act="map">${fa('map-location-dot')} ${_t('Map')}</button>`,
        editable && `<button class="pill-btn" data-act="edit">${fa('pen')} ${_t('Edit')}</button>`,
        editable && `<button class="pill-btn cald-del" data-act="delete">${fa('trash-can', 'regular')} ${_t('Delete')}</button>`].filter(Boolean).join('');
    // a re-render (every minute) keeps where the card was scrolled to
    const same = card.dataset.ev === e.id;
    const scrolled = same ? ['.cald-body', '.cald-desc'].map((q) => { const x = $(q, card); return x ? x.scrollTop : 0; }) : [];
    card.dataset.ev = e.id;
    card.innerHTML = `
      <div class="cald-top">
        <button class="cald-back" data-act="back" title="${_t('Back to the day (Esc)')}">${fa('chevron-left')} ${esc(new Date(sel).toLocaleDateString(_tLocale('en-GB'), { weekday: 'short', day: 'numeric' }))}</button>
        <span class="cald-src" title="${esc(src)}"><i style="background:${esc(e.color || '#0a84ff')}"></i><span>${esc(src)}</span></span>
      </div>
      <div class="cald-body scroll">
        <div class="cald-title" title="${esc(e.title)}">${esc(e.title)}</div>
        <div class="cald-when"><span>${esc(whenText(e))}</span><span class="cald-pill ${pillCls}">${esc(pill)}</span></div>
        ${rows.join('')}${hint}
        ${e.description ? `<div class="cald-desc scroll">${linkify(e.description)}</div>` : ''}
      </div>
      ${acts ? `<div class="cald-acts">${acts}</div>` : ''}`;
    if (same) ['.cald-body', '.cald-desc'].forEach((q, i) => { const x = $(q, card); if (x) x.scrollTop = scrolled[i]; });
    // a fade at the bottom while there's more to scroll to, so a cut-off line reads as "scroll for more"
    ['.cald-body', '.cald-desc'].forEach((q) => {
      const x = $(q, card); if (!x) return;
      const more = () => x.classList.toggle('more', x.scrollHeight - x.scrollTop - x.clientHeight > 2);
      x.onscroll = more; requestAnimationFrame(more);
    });
  }

  function back() { detail = null; askDelete = false; render(); if (N.layout) N.layout(); }

  function onCardClick(ev) {
    const e = events().find((x) => x.id === detail);
    const a = ev.target.closest('[data-act], [data-href]');
    if (!e || !a) return;
    if (a.dataset.href) { api.openExternal(a.dataset.href); return; }
    const link = e.url || (isUrl(e.location) ? e.location.trim() : '');
    switch (a.dataset.act) {
      case 'back': back(); break;
      case 'join': if (link) { api.openExternal(link); N.closeNotch(); } break;
      case 'open': if (e.openUrl) { api.openExternal(e.openUrl); N.closeNotch(); } break;
      case 'copy': navigator.clipboard.writeText(link).then(() => N.toast(fa('copy', 'regular'), _t('Link copied')), () => N.toast(fa('copy', 'regular'), _t("Couldn't copy the link"))); break;
      case 'map': api.openExternal('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.location.trim())); break;
      case 'settings': api.openSettings('calendar'); break;
      case 'edit': openForm(e.provider === 'gcal' ? e.gcalKey : e.uid, e.provider === 'gcal' ? e : null); break;
      case 'delete': askDelete = true; renderDetail(e); break;
      case 'del-no': askDelete = false; renderDetail(e); break;
      case 'del-yes':
        if (e.provider === 'gcal') {
          api.svc('pony', 'gcalDelete', e.gcalKey || e.uid).then(() => back()).catch((err) => N.toast(fa('triangle-exclamation'), String(err)));
        } else {
          // the whole event goes, with its repeats: it's one entry in Settings → Calendar → Local events
          LocalEvents.remove(st.settings.localEvents, e.uid);
          back();
        }
        break;
    }
  }

  // ------------------------------------------------------------------ the form for Sympony's own events
  // In place of the day's list: the title (it has the keyboard), the day, time and length, the repeat and a place.
  // Enter saves, Esc goes back (an open day or time pop-up or list closes first). Google / Outlook / ICS events are
  // only read here (their card has "Open in …"). The checking and saving is localevents.js, as in Settings.
  const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
  const durText = (m) => (m < 60 ? _t('{n} min', { n: m }) : m % 60 ? _t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : _t('{h} h', { h: m / 60 }));
  const own = (id) => (st.settings.localEvents || []).find((x) => x.id === id);

  // `id`: the Sympony or Google Calendar event to change, else a new one on the chosen day: at the next whole hour
  // today, at 9 on another day (saved to Google Calendar when connected, else Sympony local events)
  function openForm(id, gcalEv) {
    const isGcalEdit = !!gcalEv;
    const writeCal = !id ? gcalWriteCal() : null;
    const useGcal = isGcalEdit || !!writeCal;
    const prev = !useGcal && id ? own(id) : null;
    if (!useGcal && id && !prev) return;
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const gcalFields = (ev) => {
      const sd = new Date(ev.start);
      const mins = Math.max(15, Math.round(((ev.end || ev.start + 1800000) - ev.start) / 60000));
      return {
        title: ev.title || '',
        day: isoDay(ev.start),
        time: `${pad2(sd.getHours())}:${pad2(sd.getMinutes())}`,
        minutes: mins,
        location: ev.location || '',
        repeat: 'none',
      };
    };
    const f = isGcalEdit ? gcalFields(gcalEv)
      : prev ? LocalEvents.fields(prev)
      : { title: '', day: isoDay(sel), time: `${pad2(sel === sod(now) ? Math.min(23, now.getHours() + 1) : 9)}:00`, minutes: 30, location: '', repeat: 'none' };
    form = {
      id: isGcalEdit ? (gcalEv.gcalKey || id) : (prev ? id : null),
      gcal: useGcal,
      calendarId: isGcalEdit ? gcalEv.calendarId : (writeCal ? writeCal.id : null),
      calendarName: isGcalEdit ? (gcalEv.calendarName || gcalEv.source || 'Google Calendar') : (writeCal ? writeCal.summary : ''),
      back: detail,
      minutes: f.minutes,
      repeat: f.repeat,
      ask: false,
      busy: false,
    };
    detail = null; askDelete = false;
    const box = $('.calf', page);
    const badgeCol = isGcalEdit ? (gcalEv.color || '#4285f4') : writeCal ? (writeCal.color || '#4285f4') : ((prev && prev.color) || '#a78bfa');
    const heading = useGcal
      ? `${isGcalEdit ? _t('Edit event') : _t('New event')} · ${form.calendarName || 'Google Calendar'}`
      : (prev ? _t('Edit event') : _t('New event'));
    box.innerHTML = `
      <div class="calf-top">
        <button class="cald-back" data-f="cancel" title="${_t('Cancel')} (Esc)"></button>
        <span class="cald-src"><i style="background:${esc(badgeCol)}"></i><span>${esc(heading)}</span></span>
      </div>
      <input type="text" class="field calf-title" maxlength="200" placeholder="${_t('Event title')}" spellcheck="false">
      <div class="calf-row"><input class="field calf-day" placeholder="${_t('Day')}"><input class="field calf-time" placeholder="${_t('Time')}"><button class="pick-btn calf-dur" title="${_t('Duration')}"></button></div>
      <div class="calf-row">${useGcal ? '' : `<button class="pick-btn calf-rep" title="${_t('Repeat')}"></button>`}<input type="text" class="field calf-loc" maxlength="500" placeholder="${_t('Location or meeting link')}" spellcheck="false"></div>
      <div class="calf-acts"></div>`;
    $('.calf-title', box).value = f.title;
    $('.calf-loc', box).value = f.location;
    dayField = N.dateField($('.calf-day', box), { value: f.day });
    timeField = N.timeField($('.calf-time', box), { value: f.time });
    paintBack();
    paintPicks();
    paintActs();
    render();
    if (N.layout) N.layout();
    N.focusField($('.calf-title', box));
  }

  // the way back names the chosen day
  function paintBack() { $('.calf-top .cald-back', page).innerHTML = `${fa('chevron-left')} ${esc(dayShort(sel))}`; }
  // a day picked in the month while the form is open: the event's day too
  function formDay() { dayField.set(isoDay(sel)); paintBack(); }

  function paintPicks() {
    const mins = DURATIONS.includes(form.minutes) ? DURATIONS : [...DURATIONS, form.minutes].sort((a, b) => a - b);
    N.pick($('.calf-dur', page), { options: mins.map((m) => [m, durText(m)]), value: form.minutes, onChange: (v) => { form.minutes = +v; paintPicks(); } });
    if (!form.gcal && $('.calf-rep', page)) {
      N.pick($('.calf-rep', page), { options: LocalEvents.repeats(), value: form.repeat, icon: fa('repeat'), onChange: (v) => { form.repeat = v; paintPicks(); } });
    }
  }

  function paintActs() {
    const prev = !form.gcal && form.id && own(form.id);
    const label = form.busy ? _t('Saving…') : (form.id ? _t('Save') : _t('Add event'));
    $('.calf-acts', page).innerHTML = form.ask
      ? `<span class="cald-ask">${prev && prev.repeat && prev.repeat !== 'none' ? _t('Delete this event and its repeats?') : _t('Delete this event?')}</span>
        <button class="pill-btn cald-del" data-f="del-yes">${_t('Yes')}</button><button class="pill-btn" data-f="del-no">${_t('No')}</button>`
      : `<button class="pill-btn primary" data-f="save" ${form.busy ? 'disabled' : ''} title="${label} (Enter)">${fa('check')} ${label}</button>
        <button class="pill-btn" data-f="cancel" title="${_t('Cancel')} (Esc)">${_t('Cancel')}</button>
        ${form.id ? `<button class="pill-btn cald-del calf-del" data-f="delete" ${form.busy ? 'disabled' : ''}>${fa('trash-can', 'regular')} ${_t('Delete')}</button>` : ''}`;
  }

  // a field that won't do blinks and gets the keyboard
  function shake(el) { el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); el.focus(); }

  async function saveForm() {
    if (form.busy) return;
    const box = $('.calf', page);
    if (form.gcal) {
      const title = $('.calf-title', box).value.trim();
      if (!title) { shake($('.calf-title', box)); return; }
      const day = (dayField.value || '').trim();
      const dm = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dm) { shake($('.calf-day', box)); return; }
      const tm = (timeField.value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!tm) { shake($('.calf-time', box)); return; }
      const start = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]).getTime();
      const end = start + (form.minutes || 30) * 60000;
      const location = $('.calf-loc', box).value.trim();
      form.busy = true;
      paintActs();
      try {
        const res = form.id
          ? await api.svc('pony', 'gcalUpdate', { id: form.id, title, start, end, location })
          : await api.svc('pony', 'gcalCreate', { title, start, end, location, calendarId: form.calendarId || undefined });
        if (!form) return;
        sel = sod(start); month = null;
        saved = { id: (res && res.eventId) || null, until: Date.now() + 1500 };
        form = null;
        render();
        if (N.layout) N.layout();
      } catch (e) {
        if (form) { form.busy = false; paintActs(); }
        N.toast(fa('triangle-exclamation'), String(e));
      }
      return;
    }
    const r = LocalEvents.save(st.settings.localEvents, {
      title: $('.calf-title', box).value, day: dayField.value, time: timeField.value, minutes: form.minutes, location: $('.calf-loc', box).value, repeat: form.repeat,
    }, form.id ? own(form.id) : null);
    if (r.bad) { shake($(`.calf-${r.bad}`, box)); return; }
    // to the event's day, where its row lights up (once main has sent the events again)
    sel = sod(r.event.start); month = null;
    saved = { id: r.event.id, until: Date.now() + 1500 };
    form = null;
    render();
    if (N.layout) N.layout();
  }

  // back to where the form was opened from: the event's card, or the day
  function closeForm() { detail = form.back; form = null; render(); if (N.layout) N.layout(); }

  function onFormClick(ev) {
    const a = ev.target.closest('[data-f]');
    if (!form || !a) return;
    switch (a.dataset.f) {
      case 'save': void saveForm(); break;
      case 'cancel': closeForm(); break;
      case 'delete': form.ask = true; paintActs(); break;
      case 'del-no': form.ask = false; paintActs(); break;
      case 'del-yes':
        if (form.gcal) {
          const id = form.id;
          api.svc('pony', 'gcalDelete', id).then(() => { form = null; detail = null; render(); }).catch((e) => N.toast(fa('triangle-exclamation'), String(e)));
        } else {
          LocalEvents.remove(st.settings.localEvents, form.id); form = null; render();
        }
        break;
    }
  }

  function onFormKey(e) {
    if (!form) return;
    if (e.key === 'Escape') {
      e.stopPropagation(); // before notch.js closes Sympony with it
      if (form.ask) { form.ask = false; paintActs(); } else closeForm();
    } else if (e.key === 'Enter' && !e.isComposing && e.target.matches('input')) {
      e.preventDefault();
      if (!form.ask) saveForm();
    }
  }

  function renderTodayBadge() {
    const el = $('.cal-td-badge', page);
    if (!el) return;
    const d = new Date(sel);
    const today = sod(Date.now());
    const { ev, td } = dayItems(sel);
    const total = ev.length + td.filter((t) => !t.done).length;
    const countStr = total === 0 ? _t('Free day') : total === 1 ? _t('{n} item', { n: 1 }) : _t('{n} items', { n: total });
    el.innerHTML = `<div class="sub" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--red)">${esc(d.toLocaleDateString(_tLocale(), { weekday: 'short' }))}</div>`
      + `<div class="cal-td-daynum">${d.getDate()}</div>`
      + `<div class="sub t1" style="font-size:11.5px;margin-top:4px">${esc(d.toLocaleDateString(_tLocale(), { month: 'long', year: 'numeric' }))}</div>`
      + `<div class="row" style="gap:6px;margin-top:8px">`
      + `<span class="sub" style="font-size:10.5px">${esc(countStr)}</span>`
      + (sel !== today ? `<button type="button" class="sl-pill" data-nav="0" style="height:20px;padding:0 8px;font-size:10px">${esc(_t('Today'))}</button>` : '')
      + `</div>`;
    const tb = $('[data-nav="0"]', el);
    if (tb) tb.onclick = () => { sel = sod(Date.now()); month = null; detail = null; if (form) formDay(); render(); };
  }

  function renderWeekStrip() {
    const el = $('.cal-wk-strip', page);
    if (!el) return;
    const mon = mondayOf(sel);
    const today = sod(Date.now());
    let html = '';
    for (let i = 0; i < 7; i++) {
      const dt = new Date(mon);
      dt.setDate(dt.getDate() + i);
      const ts = dt.getTime();
      const { ev, td } = dayItems(ts);
      const hasDot = ev.length > 0 || td.some((t) => !t.done);
      const wd = dt.toLocaleDateString(_tLocale(), { weekday: 'short' });
      html += `<button type="button" class="cal-wk-day${ts === today ? ' today' : ''}${ts === sel ? ' sel' : ''}" data-wday="${ts}">`
        + `<span style="font-size:9.5px;font-weight:700;opacity:0.75">${esc(wd)}</span>`
        + `<b class="n" style="font-size:13px">${dt.getDate()}</b>`
        + `${hasDot ? '<i class="wd-dot"></i>' : ''}</button>`;
    }
    html += `<button type="button" class="sbtn calm-add-wk" style="height:36px;padding:0 10px" title="${esc(_t('Add event'))}">${N.ic('plus', 'width:12px;height:12px')}</button>`;
    el.innerHTML = html;
    $$('[data-wday]', el).forEach((b) => {
      b.onclick = () => {
        sel = +b.dataset.wday;
        const d = new Date(sel);
        month = [d.getFullYear(), d.getMonth()];
        detail = null;
        if (form) formDay();
        render();
      };
    });
    const add = $('.calm-add-wk', el);
    if (add) add.onclick = () => openForm(null);
  }

  function render() {
    if (!page || !st.settings) return;
    if (sel == null) sel = sod(Date.now());
    if (!month) { const d = new Date(sel); month = [d.getFullYear(), d.getMonth()]; }
    const style = window.StyleLib ? StyleLib.styleIdFor(st.settings, 'calendar') : 'bento';
    const root = $('.calm-root', page);
    const monthEl = $('.calm-month', page);
    const badgeEl = $('.cal-td-badge', page);
    const weekEl = $('.cal-wk-strip', page);
    const pane = $('.calm-day-pane', page);
    const dayHeadRow = $('.calm-dayhead-row', page);
    if (root) {
      if (style === 'today') {
        root.className = 'calm-root cal-td-wrap sl-pane';
        root.style.cssText = '';
        if (monthEl) monthEl.hidden = true;
        if (badgeEl) badgeEl.hidden = false;
        if (weekEl) weekEl.hidden = true;
        if (dayHeadRow) dayHeadRow.hidden = false;
        renderTodayBadge();
      } else if (style === 'week') {
        root.className = 'calm-root cal-wk-wrap sl-pane';
        root.style.cssText = '';
        if (monthEl) monthEl.hidden = true;
        if (badgeEl) badgeEl.hidden = true;
        if (weekEl) weekEl.hidden = false;
        if (dayHeadRow) dayHeadRow.hidden = true;
        renderWeekStrip();
      } else {
        root.className = 'calm-root';
        root.style.cssText = 'display:grid;grid-template-columns:226px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%';
        if (monthEl) monthEl.hidden = false;
        if (badgeEl) badgeEl.hidden = true;
        if (weekEl) weekEl.hidden = true;
        if (dayHeadRow) dayHeadRow.hidden = false;
        renderMonth();
      }
    } else {
      renderMonth();
    }
    pane.classList.toggle('form', !!form);
    // the form keeps what's typed in it (the events coming again every minute leave it alone)
    if (form) { pane.classList.remove('detail'); return; }
    const e = detail && events().find((x) => x.id === detail);
    if (!e) { detail = null; askDelete = false; }
    pane.classList.toggle('detail', !!e);
    if (e) renderDetail(e); else renderDay();
  }

  function shift(n) {
    const d = new Date(month[0], month[1] + n, 1);
    month = [d.getFullYear(), d.getMonth()];
    renderMonth();
  }

  // ------------------------------------------------------------ 2×2 Calendar card (day strip + now-line + next events)
  const cards = new Set();

  function mondayOf(dayTs) {
    const d = new Date(dayTs);
    d.setHours(0, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#ff5a52');
    const now = Date.now();
    const curDay = slot.day || sod(now);
    const dt = new Date(curDay);
    const allEvs = events();
    const dayEnd = next(curDay);
    const dayEvs = allEvs
      .filter((e) => e.start < dayEnd && e.end > curDay)
      .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));

    const weekday = dt.toLocaleDateString(_tLocale(), { weekday: 'long' });
    const monShort = dt.toLocaleDateString(_tLocale(), { month: 'short' });
    const countStr = dayEvs.length === 1 ? _t('{n} event', { n: 1 }) : _t('{n} events', { n: dayEvs.length });

    // Week mini-dots (Mon..Sun)
    const mon = mondayOf(curDay);
    const todayTs = sod(now);
    let weekDots = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      const ts = d.getTime();
      const endTs = next(ts);
      const isSel = ts === curDay;
      const isTod = ts === todayTs;
      const hasEv = allEvs.some((e) => e.start < endTs && e.end > ts);
      const wd = d.toLocaleDateString(_tLocale(), { weekday: 'narrow' });
      const dotBg = hasEv ? (isSel || isTod ? '#ff5a52' : '#55555e') : 'transparent';
      weekDots += `<button type="button" data-wday="${ts}" style="width:16px;text-align:center;font-size:9.5px;font-weight:700;color:${isSel ? '#fff' : 'var(--mute)'};cursor:pointer">${esc(wd)}<i style="display:block;width:4px;height:4px;border-radius:2px;margin:3px auto 0;background:${dotBg}"></i></button>`;
    }

    // Today's hour strip (07:00 – 21:00) with event bars & red "now" line
    const H0 = 7; const H1 = 21;
    const toH = (ms) => { const x = new Date(ms); return x.getHours() + x.getMinutes() / 60; };
    const clampP = (h) => Math.max(0, Math.min(100, ((h - H0) / (H1 - H0)) * 100));
    const timed = dayEvs.filter((e) => !e.allDay);
    const stripBars = timed.map((e) => {
      const l = clampP(toH(e.start));
      const r = clampP(toH(e.end));
      const w = Math.max(2, r - l);
      return `<i style="position:absolute;top:4px;bottom:4px;left:${l.toFixed(1)}%;width:${w.toFixed(1)}%;min-width:6px;border-radius:4px;background:${esc(e.color || '#8fa2ff')}"></i>`;
    }).join('');
    const nowLine = curDay === todayTs
      ? `<i style="position:absolute;top:0;bottom:0;left:${clampP(toH(now)).toFixed(1)}%;width:2px;background:#ff5a52"></i>`
      : '';

    // Next 2 upcoming (or day's) events
    const upcoming = dayEvs.filter((e) => e.end > now);
    const shown = (upcoming.length ? upcoming : dayEvs).slice(0, 2);
    const rowsHtml = shown.length
      ? shown.map((e) => {
        const mins = !e.allDay && e.start > now ? Math.ceil((e.start - now) / 60000) : null;
        const rel = mins != null && mins < 180 ? (N.fmtIn ? N.fmtIn(mins) : _t('in {n}m', { n: mins })) : (e.location || '');
        const sub = [e.allDay ? _t('All day') : N.hm(e.start), rel].filter(Boolean).join(' · ');
        return `<div class="row" data-cev="${esc(e.id)}" style="gap:9px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,0.035);cursor:pointer">`
          + `${N.eventAppIcon(e, 24, 6)}`
          + `<div style="flex:1;min-width:0"><div class="t1" dir="auto" style="font-size:12.5px;font-weight:600">${esc(e.title)}</div>`
          + `<div class="sub n t1" style="font-weight:600;font-size:11px">${esc(sub)}</div></div>`
          + `<i style="width:6px;height:6px;border-radius:3px;background:${esc(e.color || '#8fa2ff')};flex:none"></i></div>`;
      }).join('')
      : `<div class="sub" style="padding:8px 2px">${esc(_t('No events'))}</div>`;

    el.innerHTML = `<div class="row" style="align-items:flex-end;gap:10px">`
      + `<div class="big" style="font-size:40px;color:#ff5a52">${dt.getDate()}</div>`
      + `<div style="padding-bottom:3px;min-width:0"><div class="t1" style="font-size:14px;font-weight:700">${esc(weekday)}</div><div class="sub t1">${esc(monShort)} · ${esc(countStr)}</div></div>`
      + `<div style="margin-inline-start:auto;display:flex;gap:3px;padding-bottom:4px;flex:none">${weekDots}</div></div>`
      + `<div style="position:relative;height:22px;border-radius:7px;background:#1a1a20;margin-top:10px;overflow:hidden">${stripBars}${nowLine}</div>`
      + `<div class="row n" style="justify-content:space-between;font-size:9.5px;color:var(--mute);margin-top:3px">${[7, 10, 13, 16, 19, 21].map((h) => `<span>${String(h).padStart(2, '0')}</span>`).join('')}</div>`
      + `<div style="display:flex;flex-direction:column;gap:7px;margin-top:auto">${rowsHtml}</div>`;

    $$('[data-wday]', el).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        slot.day = +b.dataset.wday;
        paintCard(slot);
      };
    });
    $$('[data-cev]', el).forEach((row) => {
      row.onclick = (e) => {
        e.stopPropagation();
        const ev = allEvs.find((x) => x.id === row.dataset.cev);
        if (ev) N.openCalendarEvent(ev, curDay);
      };
    });
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.calendarNeedsTall = () => !!(form || detail);
  N.openCalendarEvent = (ev, day) => {
    N.openModule('calendar');
    const mod = N.moduleOf('calendar');
    if (mod && mod.showEvent && ev && ev.id) mod.showEvent(ev.id, day);
    if (N.layout) N.layout();
  };

  N.register({
    id: 'calendar',
    tall: true,
    init(p) {
      page = p;
      page.innerHTML = `<div class="calm-root" style="display:grid;grid-template-columns:226px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
        + `<div class="cal-td-badge" hidden></div>`
        + `<div class="cal-wk-strip" hidden></div>`
        + `<div class="c calm-month" style="padding:12px;width:auto;min-width:0;min-height:0">`
        + `<div class="row" style="justify-content:space-between"><b class="calm-title" style="font-size:14px"></b>`
        + `<span class="row" style="gap:4px;color:var(--dim)"><button type="button" class="mini-btn" style="width:22px;height:22px" data-nav="-1" title="${esc(_t('Previous month'))}">${N.ic('prev', 'width:10px;height:10px')}</button><button type="button" class="mini-btn" style="width:22px;height:22px" data-nav="1" title="${esc(_t('Next month'))}">${N.ic('next', 'width:10px;height:10px')}</button></span></div>`
        + `<div class="calm-grid" style="display:grid;grid-template-columns:repeat(7,1fr);grid-template-rows:auto repeat(5,minmax(0,1fr));gap:2px;margin-top:6px;flex:1;min-height:0;text-align:center"></div>`
        + `</div>`
        + `<div class="c calm-day-pane" style="padding:12px 14px;min-width:0;min-height:0;position:relative;border:0;flex:1">`
        + `<div class="row calm-dayhead-row" style="justify-content:space-between;flex:none"><span class="calm-dayhead"></span><button type="button" class="sbtn calm-add" style="height:26px;padding:0 10px" title="${esc(_t('Add event'))}">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('Event'))}</button></div>`
        + `<div class="calm-list sc-y" style="display:flex;flex-direction:column;gap:6px;margin-top:6px;flex:1"></div>`
        + `<div class="cald" style="padding:0;background:transparent;border-radius:0"></div>`
        + `<div class="calf" style="padding:0;background:transparent;border-radius:0"></div>`
        + `</div></div>`;
      $$('[data-nav]', page).forEach((b) => {
        b.onclick = () => {
          if (b.dataset.nav === '0') { sel = sod(Date.now()); month = null; detail = null; if (form) formDay(); render(); } else shift(+b.dataset.nav);
        };
      });
      $('.cald', page).addEventListener('click', onCardClick);
      // Esc goes back from the card to the day (before notch.js closes Sympony with it)
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && detail && !form && st.open && st.page === 'calendar') { e.stopPropagation(); back(); }
      }, true);
      const box = $('.calf', page);
      box.addEventListener('click', onFormClick);
      box.addEventListener('keydown', onFormKey);
      box.addEventListener('animationend', (e) => e.target.classList.remove('bad'));
      // while the form is open, a click on its buttons, its lists or the month keeps the keyboard in the field it was
      // in (so Enter and Esc still reach the form)
      document.addEventListener('mousedown', (e) => {
        if (form && st.page === 'calendar' && !e.target.closest('input') && e.target.closest('.calf, .calm-month, .pick-menu')) e.preventDefault();
      });
      // the wheel turns the months
      let wheelAt = 0;
      $('.calm-grid', page).addEventListener('wheel', (e) => {
        e.preventDefault();
        if (Date.now() - wheelAt < 250 || Math.abs(e.deltaY) < 4) return;
        wheelAt = Date.now();
        shift(e.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      $('.calm-add', page).onclick = () => openForm(null);
      N.watch('todo', () => render());
    },
    show() { render(); },
    // Sympony opens on the day's list next time
    hide() { detail = null; askDelete = false; form = null; saved = null; },
    // ← / → don't switch tabs while an event's card or the form is open (Esc goes back from it first)
    usesArrows() { return !!detail || !!form; },
    update() { render(); refreshCards(); },
    onSettings() { render(); refreshCards(); },
    card(el, size) {
      const slot = { el, size, day: sod(Date.now()) };
      cards.add(slot);
      N.cardClick(el, () => {
        sel = slot.day;
        const d = new Date(sel);
        month = [d.getFullYear(), d.getMonth()];
        N.openModule('calendar');
      });
      paintCard(slot);
    },
    refreshCards,
    // an event clicked elsewhere (Home, Dashboard): its card, next to the day it was clicked on (else its first day)
    showEvent(id, day) {
      const e = events().find((x) => x.id === id);
      if (!e) return;
      sel = day != null && e.start < next(day) && e.end > day ? day : sod(e.start);
      const d = new Date(sel);
      month = [d.getFullYear(), d.getMonth()];
      detail = id; askDelete = false; form = null;
      render();
    },
  });
})();
