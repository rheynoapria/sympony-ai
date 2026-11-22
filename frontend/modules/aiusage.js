// AI usage tab (shown while a service is on, Settings → AI usage): how much of the Claude and Codex plan limits is
// used, one service per page: its name, plan and when it was read at the top, then each limit set against its time:
// a bar of what's used with a tick where the time of its window has got to, so a glance tells whether it lasts till
// it resets ("On track", "Plenty left") or, used faster than time goes, about when it would run out at this pace
// (amber; red from 90 %). The mouse wheel or a two-finger swipe over the panel moves one service on or back (it snaps,
// and stops at both ends), as does the next service's name at the top right; the last one seen comes back next time.
// The numbers come from main (aiusage.rs, st.aiUsage), which reads them only while something shows them.
(function () {
  const { st, api, $, $$, esc, fa } = N;
  const SERVICES = {
    claude: { name: 'Claude', icon: fa('asterisk'), color: '#d97757', key: 'aiUsageClaude' },
    codex: { name: 'Codex', icon: fa('terminal'), color: '#3a3a3c', key: 'aiUsageCodex' },
  };
  let page;
  let tick;
  let beats = 0;
  let idx = 0;
  const wheel = { acc: 0, used: false, quiet: 0 };

  const list = () => Object.keys(SERVICES).filter((k) => st.settings && st.settings[SERVICES[k].key]);
  function saved() { try { return localStorage.getItem('sympony.aiUsage') || ''; } catch (e) { return ''; } }
  function remember(k) { try { localStorage.setItem('sympony.aiUsage', k); } catch (e) { /* storage off */ } }
  // the service seen last, while it's on
  function pickSaved() { const i = list().indexOf(saved()); idx = Math.max(0, i); }

  // the whole week for Claude says it's all models' (its models' own weeks follow)
  function label(r, k) {
    if (r.kind === 'session') return !r.hours || r.hours === 5 ? _t('5-hour session') : _t('{n}-hour session', { n: r.hours });
    if (r.model) return `${_t('This week')} · ${r.model}`;
    return k === 'claude' ? _t('This week · all models') : _t('This week');
  }
  const day = (t) => new Date(t).toLocaleDateString(_tLocale(), { weekday: 'short' });
  // a time today, or its day and time
  const when = (t) => (new Date(t).toDateString() === new Date().toDateString() ? N.hm(t) : `${day(t)} ${N.hm(t)}`);
  // how far a window's time has got (0-1; null while unknown): a session of its hours, a week of 7 days, up to its reset
  function passed(r, now) {
    if (!r.resetsAt || r.resetsAt <= now) return null;
    const span = (r.hours > 0 ? r.hours : r.kind === 'session' ? 5 : 168) * 3600000;
    return Math.min(1, Math.max(0, (now - (r.resetsAt - span)) / span));
  }
  // used against time: under it it lasts till the reset, over it (at this pace) it runs out at `at` before that; too
  // early in a window (under 3 % of its time) to tell
  function pace(r, pct, now) {
    const p = passed(r, now);
    if (p == null || p < 0.03) return null;
    if (pct / 100 <= p) return { ok: true, text: pct <= p * 50 ? _t('Plenty left') : _t('On track') };
    const start = r.resetsAt - (r.hours > 0 ? r.hours : r.kind === 'session' ? 5 : 168) * 3600000;
    const at = start + (now - start) * (100 / Math.max(pct, 1));
    return at < r.resetsAt ? { ok: false, text: _t('Runs out around {time} at this pace', { time: when(at) }) } : { ok: true, text: _t('On track') };
  }
  // "resets in 3h 50m", or its day and time when that's more than a day off
  function resets(at, now) {
    if (!at || at <= now) return '';
    if (at - now < 86400000) return _t('resets in {time}', { time: N.dur(Math.max(60, (at - now) / 1000)) });
    return _t('resets {day} {time}', { day: day(at), time: N.hm(at) });
  }
  function updated(t) {
    if (!t) return '';
    return _t('Updated {time}', { time: when(t) });
  }

  // `dense` (four limits or more): no line under the bar, its reset at the right instead
  function row(r, k, now, dense) {
    // a window whose reset time has passed starts again from nothing
    const pct = r.resetsAt && r.resetsAt <= now ? 0 : Number(r.pct) || 0;
    const p = passed(r, now);
    const s = pace(r, pct, now);
    const reset = resets(r.resetsAt, now);
    const used = dense ? [`${Math.round(pct)}%`, reset].filter(Boolean).join(' · ')
      : p == null ? `${Math.round(pct)}%` : _t('{used}% used · {passed}% of the time gone', { used: Math.round(pct), passed: Math.round(p * 100) });
    const state = s ? `<span class="aiu-state ${s.ok ? 'ok' : 'fast'}">${esc(s.text)}</span>` : '';
    // under the bar: a model's share of the week, else when its window started; at the right, when it resets
    const from = r.share ? _t('Up to {n}% of the week', { n: Math.round(r.share) }) : p != null ? when(r.resetsAt - (r.hours > 0 ? r.hours : r.kind === 'session' ? 5 : 168) * 3600000) : '';
    return `<div class="aiu-row ${pct >= 90 ? 'aiu-red' : (s && !s.ok) || pct >= 70 ? 'aiu-amber' : ''}">
      <div class="aiu-line"><span class="aiu-label">${esc(label(r, k))}</span>${state}<span class="aiu-used">${esc(used)}</span></div>
      <div class="aiu-bar"><i style="width:${Math.min(100, pct)}%"></i>${p != null ? `<em style="left:${(p * 100).toFixed(1)}%"></em>` : ''}</div>
      ${dense ? '' : `<div class="aiu-sub"><span>${esc(from)}</span><span>${esc(reset)}</span></div>`}</div>`;
  }

  // nothing to show (yet): why, and the way to Settings when it's about the PC
  function empty(k, d) {
    const n = d && d.note;
    let text = _t('Loading…'); let settings = false;
    if (n === 'notfound') {
      // a Mac: nothing in the Keychain under Claude Code's name (aiusage.rs keychain)
      text = k === 'claude' ? (N.MAC ? _t('Not found: sign in to Claude Code on this Mac first') : _t('Claude Code isn’t signed in on this PC.')) : _t('No Codex CLI logs on this PC yet.');
      settings = true;
    }
    // a Mac where the Keychain prompt was answered no: turning Claude off and on asks again
    else if (n === 'denied') { text = _t('Not connected: macOS didn’t let Sympony read Claude Code’s sign-in in the Keychain. Turn this off and on to be asked again, then click Always Allow'); settings = true; }
    else if (n === 'nodata') text = _t('No limits in Codex’s logs yet. They show once you use Codex signed in with ChatGPT.');
    else if (n === 'expired') text = _t('Open Claude Code to refresh its sign-in.');
    else if (n === 'error') text = _t('Couldn’t get the numbers: {error}', { error: d.error || '' });
    return `<div class="empty-state">${fa('gauge')}<span>${esc(text)}</span>${settings ? `<button class="pill-btn" data-aiu-set>${fa('gear')} ${_t('AI usage settings')}</button>` : ''}</div>`;
  }

  function service(k, d, now, i, ks) {
    const sv = SERVICES[k];
    // the way to the next service (or back from the last one), by its name
    const to = ks.length < 2 ? -1 : i + 1 < ks.length ? i + 1 : i - 1;
    const nav = to < 0 ? '' : `<button class="aiu-go" data-i="${to}">${to < i ? '‹ ' : ''}${SERVICES[ks[to]].name}${to > i ? ' ›' : ''}</button>`;
    const rows = (d && d.rows) || [];
    // at the top right: when it was read; a sign-in to refresh, or an error (the numbers stay as they were)
    let stamp = esc(updated(d && d.updatedAt));
    let cls = '';
    if (d && d.note === 'expired' && rows.length) { stamp = `${fa('triangle-exclamation')} ${esc(_t('Open Claude Code to refresh'))}`; cls = 'warn'; }
    else if (d && d.note === 'error' && rows.length) stamp = `<span title="${esc(d.error || '')}">${fa('triangle-exclamation')}</span> ${stamp}`;
    return `<div class="aiu-svc">
      <div class="aiu-head"><span class="aiu-logo" style="background:${sv.color}">${sv.icon}</span><b>${sv.name}</b>${d && d.plan ? `<span class="aiu-plan">${esc(d.plan)}</span>` : ''}<span class="aiu-when ${cls}">${rows.length ? stamp : ''}</span>${nav}</div>
      ${rows.length ? `<div class="aiu-rows ${rows.length > 2 ? 'tight' : ''}">${rows.map((r) => row(r, k, now, rows.length > 3)).join('')}</div>` : empty(k, d)}
    </div>`;
  }

  function render() {
    if (!page) return;
    const ks = list();
    idx = Math.min(idx, Math.max(0, ks.length - 1));
    const k = ks[idx] || 'claude';
    const sv = SERVICES[k] || SERVICES.claude;
    const now = Date.now();
    const data = st.aiUsage || {};
    const d = data[k] || {};
    const rows = d.rows || [];
    const iconUrl = N.agentIconUrl ? N.agentIconUrl(sv.name) : null;
    const ico = N.appIconImg(iconUrl, 22, 5, sv.icon);
    const navHtml = ks.length > 1
      ? `<div class="seg2" style="margin-inline-start:auto">${ks.map((id, i) => `<button type="button" data-aiu-i="${i}" class="${i === idx ? 'on' : ''}" style="height:22px;padding:0 8px;font-size:10.5px">${esc(SERVICES[id].name)}</button>`).join('')}</div>`
      : '';

    const leftBody = rows.length
      ? rows.map((r) => {
        const pct = r.resetsAt && r.resetsAt <= now ? 0 : Math.round(Number(r.pct) || 0);
        const col = N.meter(pct);
        const rst = resets(r.resetsAt, now);
        const p = pace(r, pct, now);
        const sub = [rst, p && !p.ok ? p.text : ''].filter(Boolean).join(' · ');
        return `<div style="margin-top:10px"><div class="row" style="justify-content:space-between;font-size:12px"><span class="t1">${esc(label(r, k))}</span><b class="n" style="color:${col};flex:none">${pct}%</b></div>`
          + `<div class="bar" style="height:8px;margin-top:5px"><i style="background:${col};transform:scaleX(${Math.min(1, pct / 100)})"></i></div>`
          + (sub ? `<div class="sub t1" style="font-size:10.5px;margin-top:3px">${esc(sub)}</div>` : '') + `</div>`;
      }).join('')
      : `<div style="margin:auto 0">${empty(k, d)}</div>`;

    const extraRows = rows.slice(2);
    const dayBars = Array.isArray(d.history) && d.history.length
      ? d.history.slice(-7)
      : rows.slice(0, 7).map((r) => ({ lbl: (r.model || (r.kind === 'session' ? '5h' : '7d')).slice(0, 6), pct: Math.round(Number(r.pct) || 0) }));
    const rightContent = dayBars.length
      ? `<div style="display:flex;align-items:flex-end;gap:6px;flex:1;margin-top:10px;min-height:0;min-width:0">`
        + dayBars.map((b) => {
          const v = Math.max(6, Math.min(100, Number(b.pct ?? b) || 0));
          const lbl = typeof b === 'object' ? (b.lbl || '') : '';
          return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end"><i style="width:100%;height:${v}%;border-radius:5px;background:${N.meter(v)}"></i><span class="t1" style="font-size:9px;color:var(--mute);max-width:100%">${esc(lbl)}</span></div>`;
        }).join('') + `</div>`
      : `<div class="sub" style="margin:auto;text-align:center">${esc(updated(d.updatedAt) || _t('No history yet'))}</div>`;

    page.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c sc-y"><div class="row" style="gap:8px">${ico}<b style="font-size:14px">${esc(sv.name)}</b>`
      + (d.plan ? `<span class="pill" style="background:var(--pill);color:var(--dim)">${esc(d.plan)}</span>` : '')
      + `${navHtml}</div>${leftBody}</div>`
      + `<div class="c">${N.hd('gauge', extraRows.length ? _t('By model') : _t('Limits overview'), updated(d.updatedAt))}${rightContent}</div></div>`;

    $$('[data-aiu-i]', page).forEach((b) => { b.onclick = () => { idx = +b.dataset.aiuI; remember(ks[idx]); render(); }; });
    $$('[data-aiu-set]', page).forEach((b) => { b.onclick = () => api.openSettings('aiusage'); });
  }

  function go(i) {
    const ks = list();
    const n = Math.max(0, Math.min(ks.length - 1, i));
    if (n === idx || !ks[n]) return;
    idx = n;
    remember(ks[n]);
    render();
  }

  // ------------------------------------------------------------ 1×1 AI Usage bar card (matches modules.html)
  const cards = new Set();

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#d97757');
    const ks = list();
    const k = ks[Math.min(idx, Math.max(0, ks.length - 1))] || 'claude';
    const sv = SERVICES[k] || SERVICES.claude;
    const d = (st.aiUsage || {})[k] || {};
    const rows = d.rows || [];
    const now = Date.now();
    const pctOf = (r) => (r ? (r.resetsAt && r.resetsAt <= now ? 0 : Math.round(Number(r.pct) || 0)) : null);
    const sess = rows.find((r) => r.kind === 'session');
    const week = rows.find((r) => r.kind !== 'session');
    const p1 = pctOf(sess);
    const p2 = pctOf(week);
    const iconUrl = N.agentIconUrl ? N.agentIconUrl(sv.name) : null;
    const ico = N.appIconImg(iconUrl, 13, 3, sv.icon);
    const title = [sv.name, d.plan].filter(Boolean).join(' · ');

    const barRow = (lbl, pct) => {
      const v = pct == null ? 0 : pct;
      const col = N.meter(v);
      return `<div><div class="row" style="justify-content:space-between;font-size:10.5px"><span class="dim">${esc(lbl)}</span><b class="n" style="font-size:12px;color:${pct == null ? 'var(--mute)' : col}">${pct == null ? '–' : `${v}%`}</b></div>`
        + `<div class="bar" style="height:6px;margin-top:3px"><i style="background:${col};transform:scaleX(${v / 100})"></i></div></div>`;
    };

    el.innerHTML = `${N.hd(ico, title)}`
      + `<div style="margin-top:auto;display:flex;flex-direction:column;gap:7px">${barRow(_t('Session'), p1)}${barRow(_t('Week'), p2)}</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'aiusage',
    tall: true,
    init(p) {
      page = p;
      // one service per wheel notch, or per swipe with its glide: the next step counts once the wheel has been still a moment
      page.addEventListener('wheel', (e) => {
        if (list().length < 2) return;
        e.preventDefault();
        clearTimeout(wheel.quiet);
        wheel.quiet = setTimeout(() => { wheel.acc = 0; wheel.used = false; }, 160);
        if (wheel.used) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        wheel.acc += e.deltaMode === 1 ? d * 33 : d;
        if (Math.abs(wheel.acc) >= 30) { wheel.used = true; go(idx + Math.sign(wheel.acc)); }
      }, { passive: false });
    },
    // main reads the numbers while the tab shows (and the resets count down): it's told so every minute
    show() {
      pickSaved(); render();
      api.svc('aiusage', 'watch', true).catch(() => {});
      clearInterval(tick); beats = 0;
      tick = setInterval(() => { render(); if (++beats % 2 === 0) api.svc('aiusage', 'watch', true).catch(() => {}); }, 30000);
    },
    hide() { clearInterval(tick); api.svc('aiusage', 'watch', false).catch(() => {}); },
    update() { if (page && page.classList.contains('active')) render(); refreshCards(); },
    onSettings() { if (page && page.classList.contains('active')) { pickSaved(); render(); } refreshCards(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('aiusage'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
