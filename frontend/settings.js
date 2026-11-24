'use strict';
const api = window.notch;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fa = (n, style = 'solid') => `<i class="fa-${style} fa-${n}"></i>`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = {};
window.addEventListener('error', (e) => api.log && api.log(`settings error: ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => api.log && api.log(`settings rejection: ${e.reason && (e.reason.message || e.reason)}`));
let info = {};
let current = 'general';
let calErrors = {};
let helper = {};

const MODULE_META = {
  home: ['house', _t('Home'), _t('Music, calendar and mirror')], calendar: ['calendar-days', _t('Calendar'), _t('The whole month, with your events and tasks')], prayer: ['mosque', _t('Prayer Times'), _t('Today’s prayers with a countdown. Shows while Prayer Times is on')], control: ['sliders', _t('Control'), _t('Volume, sound output and input, brightness, quick toggles')],
  shelf: ['inbox', _t('Shelf'), _t('Temporary spot for files')], todo: ['list-check', _t('Todo'), _t('Tasks with trash & restore')],
  notes: ['note-sticky', _t('Notes'), _t('Scratchpad')], pomodoro: ['stopwatch', _t('Pomodoro'), _t('Focus sessions, timer & stopwatch')],
  weather: ['cloud-sun', _t('Weather'), _t('Open-Meteo forecast')], health: ['heart-pulse', _t('Health'), _t('Water, breaks, breathing')],
  screentime: ['hourglass-half', _t('Screen Time'), _t('Where your time goes')], dayprogress: ['chart-gantt', _t('Day Progress'), _t('Timeline of today')],
  bluetooth: ['bluetooth-b', _t('Bluetooth & Wi-Fi'), _t('Devices, battery, Wi-Fi networks and a speed test')], stats: ['gauge-high', _t('System'), _t('CPU, RAM, network, disk')],
  translate: ['language', _t('Translate'), _t('LLM translation (Gemini / Claude / OpenAI-compatible / Ollama)')],
  chat: ['wand-magic-sparkles', _t('Pony'), _t('Your assistant with persona, skills, memory, and scheduled briefs')], github: ['github', 'GitHub', _t('Pull requests to review')],
  radio: ['radio', _t('Radio'), _t('Internet radio stations from Radio Browser')],
  bookmarks: ['bookmark', _t('Bookmarks'), _t('Links you save, in categories of your own')],
  aiusage: ['gauge', _t('AI usage'), _t('Claude and Codex plan limits. Shows while a service is on in AI usage')],
  worldclock: ['earth-asia', _t('World clock'), _t('The time in other places, with a meeting planner')],
  teleprompter: ['scroll', _t('Teleprompter'), _t('Your script scrolls right under the camera while you talk')],
  launcher: ['rocket', _t('Launcher'), _t('Quick access to your favourite apps and folders')],
  notifs: ['bell', _t('Notifications'), _t('Recent notifications from your Mac and browser')],
};
// what the closed notch can show on its left and right while nothing else is going on
const IDLE_SLOTS = [['none', _t('Nothing')], ['weather', _t('Weather')], ['battery', _t('Battery')], ['date', _t('Date')], ['prayer', _t('Next prayer')],
  ['event', _t('Next event')], ['todo', _t('Next task')], ['time', _t('Time')], ['temp', _t('Temperature')], ['cpu', 'CPU'], ['ram', _t('Memory (RAM)')], ['disk', _t('Disk')], ['wifi', _t('Wi-Fi signal')]];
// the internet speed in Mbps, as a speed test gives it: down over up in two small lines on one side, or one of them
IDLE_SLOTS.push(['net', _t('Internet ↓↑')], ['netDown', _t('Download')], ['netUp', _t('Upload')]);

const MAC_SYS = () => window.SYMPONY_OS === 'macos';
// Which of the PC's thermal zones is "the temperature": Windows shares a few without admin, and what each
// one measures differs per PC (one may sit near 100 °C whatever the PC does), so you can pick it. A PC that
// shares none just says so (and the Temperature slot for the closed Sympony isn't offered).
let tempSupported = null; // null: not known yet
async function tempZones() {
  const r = await api.svc('temp', 'zones').catch(() => null);
  if (r && r.checked) tempSupported = r.zones.length > 0;
  return r || { checked: false, zones: [] };
}
// Media → Colors without album art: a preview as the notch draws it (its Gradient Waves, art tile, visualizer and
// progress) on the left, the swatches on the right (palettes.js: solids, then three-colour gradients). Picking one
// changes the colours in place: they glide over, nothing is drawn again.
function renderMediaColors(el) {
  const P = window.SYMPONY_PALETTES || {};
  const keys = Object.keys(P);
  const solid = (p) => p.c[0].join() === p.c[2].join();
  const look = (p) => (solid(p) ? `rgb(${p.c[0]})` : `linear-gradient(135deg, rgb(${p.c[0]}), rgb(${p.c[1]}), rgb(${p.c[2]}))`);
  const sw = (k) => `<button class="mc-sw" data-k="${k}" title="${esc(_t(P[k].name))}" style="background:${look(P[k])}"></button>`;
  el.innerHTML = `<div class="row mc-row"><span class="lbl">${_t('Colors without album art')}<small>${_t('When the song has no album art. With album art, the colours always come from the art.')}</small></span>`
    + `<div class="mc-body"><div class="mc-preview"><div class="mc-waves"></div>`
    + `<div class="mc-art">${fa('music')}</div>`
    + `<div class="mc-meta"><b>${_t('A song without art')}</b><small class="mc-name"></small><div class="mc-prog"><i></i></div></div>`
    + `<div class="mc-viz">${[0, 1, 2, 3, 4].map((i) => `<i style="animation-delay:${-i * 0.17}s"></i>`).join('')}</div></div>`
    + `<div class="mc-pick"><div class="mc-set"><span class="mc-cap">${_t('Solid')}</span>${keys.filter((k) => solid(P[k])).map(sw).join('')}</div>`
    + `<div class="mc-set"><span class="mc-cap">${_t('Gradient')}</span>${keys.filter((k) => !solid(P[k])).map(sw).join('')}</div></div></div></div>`;
  const preview = $('.mc-preview', el);
  const waves = window.makeWaves ? makeWaves($('.mc-waves', el), () => preview.isConnected) : null;
  const paint = (k) => {
    const c = P[k].c;
    c.forEach((v, i) => preview.style.setProperty(`--mc${i + 1}`, `rgb(${v})`));
    $('.mc-name', el).textContent = _t(P[k].name);
    $$('.mc-sw', el).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    if (waves) waves.colors(c[0], c[1], c[2]);
  };
  paint(P[S.mediaColors] ? S.mediaColors : 'ocean');
  $$('.mc-sw', el).forEach((b) => { b.onclick = () => { S.mediaColors = b.dataset.k; paint(b.dataset.k); api.setSettings({ mediaColors: b.dataset.k }); }; });
}

async function renderTempZone(el) {
  const { checked, zones } = await tempZones();
  if (!checked) { el.innerHTML = `<div class="row"><span class="lbl">${_t('Temperature')}<small>${_t('Checking the sensors…')}</small></span></div>`; setTimeout(() => renderTempZone(el), 2000); return; }
  if (!zones.length) {
    el.innerHTML = `<div class="row"><span class="lbl">${_t('Temperature')}<small>${_t('This PC doesn’t share its temperature with apps, so Sympony can’t show it. (Some PCs only let tools with an admin driver read it.)')}</small></span></div>`;
    return;
  }
  const cur = S.tempZone || '';
  const short = (n) => n.replace(/^\\+_?/, '').split('.').slice(-2).join('.');
  const opts = [['', _t('Automatic')], ...zones.map((z) => [z.name, `${short(z.name)} · ${_t('{c} °C now', { c: Math.round(z.c) })}`])];
  if (cur && !zones.some((z) => z.name === cur)) opts.push([cur, short(cur)]);
  const sub = _t('The sensors Windows shares on this PC: board or CPU-area readings, not the CPU cores. What each measures differs per PC; Automatic skips one that keeps reading 95 °C or more.');
  el.innerHTML = `<label class="row"><span class="lbl">${_t('Temperature sensor')}<small>${sub}</small></span><select id="tempZone">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  $('#tempZone', el).onchange = (e) => api.setSettings({ tempZone: e.target.value });
}
tempZones(); // so the closed-Sympony slots know whether to offer Temperature

// The FPS counter's state under its switch: Windows only lets a program read a game's frames once the user is
// in the "Performance Log Users" group (asked once, through a UAC prompt) and has signed out and back in.
async function renderFps(el) {
  if (!S.fpsCounter) { el.innerHTML = ''; return; }
  const f = await api.svc('fps', 'state').catch(() => null);
  if (!f) { el.innerHTML = ''; return; }
  const row = (sub, btn = '') => `<div class="row"><span class="lbl">${sub}</span>${btn}</div>`;
  let html;
  if (f.running) html = row(`${_t('Counting. Start a game to see its FPS in the closed notch.')}<small>${_t('Shows while the game is in front; the desktop and most apps draw no frames, so nothing shows there.')}</small>`);
  else if (f.allow === 'waiting') html = row(`${_t('Waiting for the Windows permission prompt…')}<small>${_t('Choose Yes there.')}</small>`);
  else if (f.problem === 'permission' && (f.granted || f.allow === 'ok')) html = row(`${_t('Allowed. Sign out of Windows and back in to finish')}<small>${_t('Windows applies the permission only after signing in again.')}</small>`);
  else if (f.problem === 'permission') {
    html = row(`${_t('Windows needs to let Sympony read the game’s frames')}<small>${f.allow === 'cancelled' ? _t('The permission wasn’t given.') + ' ' : f.allow === 'failed' ? _t('That didn’t work.') + ' ' : ''}${_t('This asks once for administrator permission and adds you to Windows’ “Performance Log Users” group (what Game Bar asks for too); then sign out and back in.')}</small>`,
      `<button class="btn primary" id="fpsAllow">${_t('Allow…')}</button>`);
  } else if (f.problem) html = row(`${_t('The FPS counter couldn’t start')}<small>${_t('Windows said: {problem}', { problem: esc(f.problem) })}</small>`);
  else html = row(_t('Starting…'));
  // a fullscreen game hides Sympony unless General → "Hide when an app is fullscreen" is off
  if (S.hideInFullscreen !== false) {
    html += row(`${_t('Fullscreen games hide Sympony')}<small>${_t('To see the FPS over a fullscreen game, Sympony has to stay over fullscreen apps (General → Hide when an app is fullscreen).')}</small>`,
      `<button class="btn" id="fpsShowFs">${_t('Stay over them')}</button>`);
  }
  el.innerHTML = html;
  const allow = $('#fpsAllow', el); if (allow) allow.onclick = () => { allow.disabled = true; api.svc('fps', 'allow').finally(() => setTimeout(() => renderFps(el), 500)); };
  const fs = $('#fpsShowFs', el); if (fs) fs.onclick = () => api.setSettings({ hideInFullscreen: false });
  // follow it while this page is open (the prompt, the trace starting)
  clearTimeout(el.fpsT);
  el.fpsT = setTimeout(() => { if (el.isConnected) renderFps(el); }, 2000);
}
// Notifications → Clear history: asks right in the row (no dialog), then empties it
async function renderNotifClear(el) {
  if (S.notifHistory === false) { el.innerHTML = ''; return; }
  const h = await api.svc('notif', 'history').catch(() => null);
  const n = h ? h.items.length : 0;
  const row = (btns) => `<div class="row"><span class="lbl">${_t('Clear history')}<small>${n ? (n === 1 ? _t('{n} notification kept now', { n }) : _t('{n} notifications kept now', { n })) : _t('Nothing kept yet')}</small></span><span style="display:flex;gap:6px">${btns}</span></div>`;
  el.innerHTML = row(n ? `<button class="btn danger" id="nhClear">${fa('trash-can')} ${_t('Clear')}</button>` : '');
  if (n) $('#nhClear', el).onclick = () => {
    el.innerHTML = row(`<button class="btn" id="nhNo">${_t('Cancel')}</button><button class="btn danger" id="nhYes">${fa('trash-can')} ${_t('Clear {n}', { n })}</button>`);
    $('#nhNo', el).onclick = () => renderNotifClear(el);
    $('#nhYes', el).onclick = async () => { await api.svc('notif', 'clear').catch(() => {}); renderNotifClear(el); };
  };
}
// Notifications → a hint when Telegram is here but draws its own pop-ups (they never reach Windows, so Sympony can’t
// see them). Asked once when the page opens; a setting changed on the page draws it again from that answer.
let telegramHint = null;
async function renderTelegramHint(el) {
  if (!S.notifEnabled) { el.innerHTML = ''; return; }
  if (!telegramHint || !show.keepScroll) telegramHint = api.svc('notif', 'telegram').catch(() => null);
  const t = await telegramHint;
  el.innerHTML = t && t.show ? `<div class="row"><div class="note" style="margin:0;flex:1">${fa('circle-info')} ${_t('Telegram shows its own pop-ups, so Sympony can’t see them. In Telegram, open Settings → Notifications and turn on <b>Use Windows notifications</b>.')}</div></div>` : '';
}
// Notifications on a Mac: macOS keeps them where only an app with Full Disk Access may read them (macnotif.rs). Asked
// when the page opens, then every few seconds while the answer is no (the user may be giving it in System Settings).
async function renderNotifAccess(el) {
  clearTimeout(el.accessT);
  if (!S.notifEnabled) { el.innerHTML = ''; return; }
  const a = await api.svc('notif', 'access').catch(() => null);
  if (!el.isConnected) return;
  if (!a) { el.innerHTML = ''; return; }
  // Accessibility: banners read the moment they show (and closed with Don't show them twice)
  const ax = a.banners ? ''
    : `<div class="row nf-need"><span class="lbl"><span class="nf-warn">${fa('triangle-exclamation')} ${_t('Allow Accessibility for instant notifications')}</span><small>${_t('With it Sympony reads each banner the moment macOS shows it (without it, a few seconds later) and can close macOS’s own banner. In System Settings → Privacy & Security → Accessibility, turn Sympony on (add it with + if it’s not listed).')}</small></span><button class="btn" id="nfAx">${fa('universal-access')} ${_t('Open Accessibility')}</button></div>`;
  const bindAx = () => { const b = $('#nfAx', el); if (b) b.onclick = () => api.svc('notif', 'grantBanners'); };
  // granted: says so, with a test notification to see it work (checked again in a while, it can be taken back)
  if (a.ok) {
    el.innerHTML = `<div class="row"><span class="lbl"><span class="nf-ok">${fa('circle-check')} ${_t('Sympony can read your notifications')}</span><small>${a.banners ? _t('Full Disk Access and Accessibility are on: notifications show under the notch the moment they arrive.') : _t('Full Disk Access is on.')}</small></span><button class="btn" id="nfTest">${fa('paper-plane')} ${_t('Send a test')}</button></div>` + ax;
    bindAx();
    $('#nfTest', el).onclick = (e) => { api.svc('notif', 'test'); e.currentTarget.disabled = true; e.currentTarget.innerHTML = `${fa('hourglass-half')} ${_t('Coming in a few seconds…')}`; };
    el.accessT = setTimeout(() => { if (el.isConnected && !$('#nfTest:disabled', el)) renderNotifAccess(el); }, a.banners ? 10000 : 3000);
    return;
  }
  el.innerHTML = a.reason === 'fullDiskAccess'
    ? `<div class="row nf-need"><span class="lbl"><span class="nf-warn">${fa('triangle-exclamation')} ${_t('Sympony needs Full Disk Access to read notifications')}</span><small>${_t('macOS keeps your notifications in a protected place. In System Settings → Privacy & Security → Full Disk Access, add Sympony with the + button (it’s in Applications) and turn it on. If macOS offers Quit & Reopen, click it.')}</small></span><button class="btn" id="nfGrant">${fa('lock-open')} ${_t('Open Full Disk Access')}</button></div>`
    : `<div class="row"><div class="note" style="margin:0;flex:1">${fa('circle-info')} ${_t('Sympony can’t find macOS’s notifications on this Mac.')}</div></div>`;
  el.innerHTML += ax;
  bindAx();
  const b = $('#nfGrant', el);
  if (b) b.onclick = () => api.svc('notif', 'grant');
  el.accessT = setTimeout(() => { if (el.isConnected) renderNotifAccess(el); }, 3000);
}
// AI usage → a switch per service, with whether Sympony finds it on this PC (aiusage.rs): asked once when the page opens,
// a setting changed on the page draws it again from that answer
let aiUsageStatus = null;
let aiUsageAsked = 0;
let aiUsageFound = null;
async function renderAiUsageService(el, r) {
  const k = r.svc === 'claude' ? 'aiUsageClaude' : 'aiUsageCodex';
  const draw = (f) => {
    const s = f && f[r.svc];
    let line = '';
    if (s && r.svc === 'claude') {
      // a Mac: Claude Code's sign-in is in the Keychain (aiusage.rs keychain): read once macOS allows it, or not given
      const mac = () => (s.denied ? `<span style="color:#ff9f0a">● ${_t('Not connected: macOS didn’t let Sympony read Claude Code’s sign-in in the Keychain. Turn this off and on to be asked again, then click Always Allow')}</span>`
        : !s.asked ? _t('Sympony reads Claude Code’s sign-in from the Keychain: macOS asks once, click Always Allow') : _t('Not found: sign in to Claude Code on this Mac first'));
      line = !s.found ? (MAC ? mac() : _t('Not found: sign in to Claude Code on this PC first'))
        : s.expired ? `<span style="color:#ff9f0a">● ${_t('Found, but its sign-in has expired: open Claude Code to refresh it')}</span>`
          : `<span class="ok">● ${s.plan ? _t('Found: {plan} plan', { plan: esc(s.plan) }) : _t('Found on this PC')}</span>`;
    } else if (s) line = s.found ? `<span class="ok">● ${_t('Found on this PC')}</span>` : _t('Not found: use Codex CLI on this PC first');
    el.innerHTML = `<label class="row"><span class="lbl">${r.label}<small>${r.sub}${line ? `<br>${line}` : ''}</small></span><input type="checkbox" ${S[k] ? 'checked' : ''}></label>`;
    $('input', el).onchange = (e) => api.setSettings({ [k]: e.target.checked });
  };
  draw(aiUsageFound);
  if (!aiUsageStatus || (!show.keepScroll && Date.now() - aiUsageAsked > 1000)) { aiUsageAsked = Date.now(); aiUsageStatus = api.svc('aiusage', 'status').catch(() => null); }
  aiUsageFound = await aiUsageStatus;
  if (el.isConnected) draw(aiUsageFound);
}
// Integrations → the overview: one card per connection with its state (Claude Code's hooks, Paseo, the agents that
// can't ask through Sympony yet, and why)
async function renderIntegrations(el) {
  const [c, p, agents] = await Promise.all([api.svc('claude', 'status').catch(() => null), api.svc('paseo', 'status').catch(() => null),
    api.svc('ai', 'agents').catch(() => [])]);
  if (!el.isConnected) return;
  const ag = (id) => (agents || []).find((a) => a.id === id) || {};
  const img = (icon, mono) => `<img src="vendor/ai-icons/${icon}.svg" class="${mono ? 'mono' : ''}" alt="">`;
  const card = (ic, name, cls, txt) => `<div class="ag-card ig-card ${cls === 'off' ? 'dim' : ''}"><span class="ag-ic">${ic}</span>
    <span class="ag-txt"><b>${esc(name)}</b><small class="ag-${cls}"><i></i>${esc(txt)}</small></span></div>`;
  const cc = !c ? ['off', _t('Unknown')] : c.state === 'installed' ? (S.claudeHooks ? ['ok', _t('Connected')] : ['warn', _t('Connected · requests hidden')])
    : c.state === 'nodir' ? ['off', _t('Not on this Mac')] : c.state === 'bad' ? ['warn', _t('Settings file has an error')] : ['warn', _t('Not connected: Install below')];
  const ps = !p || !p.found ? ['off', _t('Not on this Mac')] : !p.running ? ['warn', _t('Paseo isn’t running')]
    : S.paseoEnabled === false || !S.claudeHooks ? ['warn', _t('Found · off')]
      : ['ok', p.pending ? _t('Watching · {n} waiting', { n: p.pending }) : _t('Watching')];
  const later = (id, why) => { const a = ag(id); return card(img(a.icon || 'openai', !/-color$/.test(a.icon || '')), a.name || id, 'off', a.installed ? why : _t('Not installed')); };
  el.innerHTML = `<div class="ag-grid">
    ${card(img('claudecode-color'), 'Claude Code', ...cc)}
    ${card('<img src="vendor/ai-icons/paseo.png" class="app" alt="">', 'Paseo', ...ps)}
    ${later('antigravity', _t('Has no hooks to ask through'))}
    ${later('codex', ag('codex').update ? _t('Update it for hooks') : _t('Coming'))}
    ${later('gemini', _t('Coming: sign in to it first'))}
    ${later('cursor', _t('Coming: sign in to it first'))}
  </div>`;
}
// Integrations → Paseo: what Sympony sees of it
async function renderPaseo(el) {
  const p = await api.svc('paseo', 'status').catch(() => null);
  if (!el.isConnected) return;
  const t = !p || !p.found ? _t('Paseo isn’t installed on this Mac.')
    : !p.running ? _t('Paseo is installed but its daemon isn’t running: open Paseo.')
      : S.paseoEnabled === false || !S.claudeHooks ? _t('Paseo runs; its requests aren’t shown (turn on the switches above).')
        : p.reached === false ? _t('Paseo runs but didn’t answer Sympony (its local sign-in may have changed): restart Paseo.')
        : `${p.pending ? _t('{n} waiting now.', { n: p.pending }) : _t('Nothing waiting.')} ${_t('Checking every 2 s.')}`;
  el.innerHTML = `<div class="row"><span class="lbl">${_t('State')}<small>${esc(t)}</small></span><button class="btn" id="psOpen">${fa('up-right-from-square')} ${_t('Open Paseo')}</button></div>`;
  $('#psOpen', el).onclick = () => api.svc('paseo', 'open');
}
// Claude Code → Install / Remove: Sympony's hooks in Claude Code's own settings file, put in or taken out only on these
// clicks (claude.rs); the line says what's there now. `said`: what the last click ran into.
async function renderClaudeHooks(el, said = '') {
  const c = await api.svc('claude', 'status').catch(() => null);
  if (!c) { el.innerHTML = ''; return; }
  const file = esc(c.file);
  const install = `<button class="btn primary" data-cc="install">${_t('Install')}</button>`;
  const remove = `<button class="btn" data-cc="remove">${_t('Remove')}</button>`;
  let text; let sub; let btns = '';
  if (c.state === 'installed') {
    text = _t('Connected to Claude Code');
    sub = _t('Sympony’s hooks are in {file}. A Claude Code session already running may need a restart to use them.', { file });
    if (!S.claudeHooks) sub += ' ' + _t('Turn on Show Claude Code’s requests to see them in Sympony.');
    btns = remove;
  } else if (c.state === 'partial' || c.state === 'other') {
    text = c.state === 'other' ? _t('Connected to a Sympony in another folder') : _t('Partly connected');
    sub = _t('Install points Claude Code at this Sympony, with all of its hooks ({file}).', { file });
    btns = install + remove;
  } else if (c.state === 'bad') {
    text = _t('Claude Code’s settings file has an error');
    sub = c.line ? _t('{file} isn’t valid JSON (line {line}), so Sympony leaves it alone. Fix it in an editor, then come back.', { file, line: c.line })
      : _t('{file} isn’t valid JSON, so Sympony leaves it alone. Fix it in an editor, then come back.', { file });
  } else if (c.state === 'nodir') {
    text = _t('Claude Code isn’t set up here');
    sub = _t('Its settings folder wasn’t found ({file}). Start Claude Code once, then come back.', { file: esc(c.file.replace(/[\\/]settings\.json$/, '')) });
  } else {
    text = _t('Not connected');
    sub = _t('Install adds Sympony’s hooks to Claude Code’s settings ({file}) and keeps a copy of the file first; nothing else there changes. Remove takes out only Sympony’s.', { file });
    btns = install;
  }
  if (said) sub = `<b>${said}</b> ${sub}`;
  el.innerHTML = `<div class="row"><span class="lbl">${text}<small>${sub}</small></span><span style="display:flex;gap:6px">${btns}</span></div>`;
  $$('[data-cc]', el).forEach((b) => {
    b.onclick = async () => {
      $$('[data-cc]', el).forEach((x) => { x.disabled = true; });
      const r = await api.svc('claude', b.dataset.cc).catch(() => null);
      const why = { write: _t('Sympony couldn’t write the file.'), bad: _t('Sympony can’t read the hooks in that file, so it left the file alone.') }[r && r.error];
      renderClaudeHooks(el, r && r.ok ? '' : why || _t('That didn’t work.'));
    };
  });
}
// General → Clock → World clock: its first place for a side of the closed Sympony
IDLE_SLOTS.push(['world', _t('World clock')]);

// General → Clock → World clock (`worldClocks`, [{ name, tz }]): up to eight places, each with a name of your own and a
// time zone found by its city as you type (clock.js: Windows' own time zone data, nothing online), with the time there
// now and how far from here; the arrows move one up or down, × removes it
function renderWorldClocks(el) {
  const W = window.SymponyClock;
  if (!W) { el.innerHTML = ''; return; }
  const row = SECTIONS.find((s) => s.id === 'general').rows.find((r) => r.render === renderWorldClocks);
  const list = W.places(S);
  const full = list.length >= W.MAX;
  const save = (l) => api.setSettings({ worldClocks: l.slice(0, W.MAX) });
  const now = Date.now(); const h24 = S.clock24h !== false;
  const sign = (night) => (night ? fa('moon') : fa('sun')).replace('<i ', `<i style="color:${night ? '#a9b6ff' : '#ffd60a'};width:14px;text-align:center" `);
  el.innerHTML = `<div class="row${list.length ? ' ah-row' : ''}"><span class="lbl">${row.label}<small>${full ? _t('Up to {n}. Remove one to add another.', { n: W.MAX }) : row.sub}</small></span>
    ${full ? '' : `<input type="text" id="wcAdd" class="short" placeholder="${_t('Add a city…')}" autocomplete="off" spellcheck="false">`}</div>`
    + list.map((p, i) => {
      const inf = W.info(p.tz, now);
      // (the line under the last one too: the Hourly chime row follows in the same group)
      return `<div class="row" style="padding-left:28px;border-bottom:1px solid var(--line)"><span class="lbl" style="flex:1"><span style="display:flex;align-items:center;gap:8px">${sign(inf.night)}<input type="text" data-wn="${i}" value="${esc(p.name)}" maxlength="30" style="width:180px"></span>
        <small>${esc(p.tz.replace(/_/g, ' '))} · ${esc(W.time(p.tz, now, h24))} · ${esc(W.diffLine(inf))}</small></span>
        <span style="display:flex;gap:2px"><button class="icon-btn" data-wup="${i}" ${i === 0 ? 'disabled' : ''} title="${_t('Move up')}">${fa('chevron-up')}</button><button class="icon-btn" data-wdown="${i}" ${i === list.length - 1 ? 'disabled' : ''} title="${_t('Move down')}">${fa('chevron-down')}</button><button class="icon-btn del" data-wrm="${i}" title="${_t('Remove')}">${fa('xmark')}</button></span></div>`;
    }).join('');
  $$('[data-wn]', el).forEach((inp) => {
    inp.onchange = () => { const l = list.map((p) => ({ ...p })); const p = l[+inp.dataset.wn]; p.name = inp.value.trim() || W.cityOf(p.tz); save(l); };
  });
  $$('[data-wup]', el).forEach((b) => { b.onclick = () => { const i = +b.dataset.wup; const l = list.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; save(l); }; });
  $$('[data-wdown]', el).forEach((b) => { b.onclick = () => { const i = +b.dataset.wdown; const l = list.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; save(l); }; });
  $$('[data-wrm]', el).forEach((b) => { b.onclick = () => save(list.filter((_, k) => k !== +b.dataset.wrm)); });
  const box = $('#wcAdd', el);
  if (!box) return;
  const add = (z) => { box.value = ''; box.blur(); if (z && !list.some((p) => p.tz === z.tz && p.name === z.name)) save([...list, { name: z.name, tz: z.tz }]); };
  suggestPlaces(box, async (q) => W.search(q, 6), (z) => `${fa('clock', 'regular')} ${esc(z.name)} <small style="color:var(--dim)">${esc(z.tz.replace(/_/g, ' '))} · ${esc(W.time(z.tz, Date.now(), h24))}</small>`, add);
  // Enter without one picked: the best match
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const z = W.search(box.value, 1)[0]; if (z) add(z); } });
}

// General → Clock → under Hourly chime, while it's on: the half hours too, quiet hours (from / until, on or off), and the
// bell to try here
function renderHourChime(el) {
  const s = S.hourChime;
  if (!['sound', 'light', 'both'].includes(s)) { el.innerHTML = ''; return; }
  const row = SECTIONS.find((x) => x.id === 'general').rows.find((r) => r.render === renderHourChime);
  const quiet = S.hourChimeQuiet !== false;
  el.innerHTML = `<label class="row"><span class="lbl">${_t('On the half hour too')}<small>${_t('One note at half past, two on the hour')}</small></span><input type="checkbox" id="hcHalf" ${S.hourChimeHalf ? 'checked' : ''}></label>
    <div class="row"><span class="lbl">${row.label}<small>${row.sub}</small></span><span style="display:flex;align-items:center;gap:8px">
      <input type="time" id="hcFrom" value="${esc(S.hourChimeFrom || '22:00')}" ${quiet ? '' : 'disabled'}><span>–</span><input type="time" id="hcTo" value="${esc(S.hourChimeTo || '06:00')}" ${quiet ? '' : 'disabled'}>
      <input type="checkbox" id="hcQuiet" ${quiet ? 'checked' : ''} title="${_t('Quiet hours')}"></span></div>`
    + (s !== 'light' ? `<div class="row"><span class="lbl">${_t('The bell')}<small>${_t('As it sounds on the hour')}</small></span><button class="btn" id="hcTry">${fa('play')} ${_t('Try')}</button></div>` : '');
  $('#hcHalf', el).onchange = (e) => api.setSettings({ hourChimeHalf: e.target.checked });
  $('#hcQuiet', el).onchange = (e) => api.setSettings({ hourChimeQuiet: e.target.checked });
  // (a time that isn't one yet, while it's being typed, isn't saved)
  for (const [id, k] of [['#hcFrom', 'hourChimeFrom'], ['#hcTo', 'hourChimeTo']]) {
    $(id, el).onchange = (e) => { if (window.SymponyClock && SymponyClock.minutes(e.target.value) != null) api.setSettings({ [k]: e.target.value }); };
  }
  const tryBtn = $('#hcTry', el);
  if (tryBtn) tryBtn.onclick = () => { try { renderHourChime.ctx = renderHourChime.ctx || new AudioContext(); SymponyClock.bell(renderHourChime.ctx, false); } catch (e) { /* no sound here */ } };
}

// Wallpaper → the switch and the file (wallpaper.rs keeps the path; the file stays where it is). Turning it on without
// a file asks for one (it stays off if none is picked). The line under the file follows it while the page is open:
// playing, paused and why, or what went wrong.
function renderWallpaper(el) {
  const file = S.wallpaperFile || '';
  el.innerHTML = `<label class="row"><span class="lbl">${_t('Moving wallpaper')}<small>${_t('Turning it off brings back your Windows wallpaper.')}</small></span><input type="checkbox" id="wpOn" ${S.wallpaperOn && file ? 'checked' : ''}></label>
    <div class="row"><span class="lbl">${_t('Video or picture')}<small><span>${file ? esc(file.split(/[\\/]/).pop()) : _t('No file chosen')}</span><span id="wpLine"></span></small></span>
      <span style="display:flex;gap:6px">${file ? `<button class="btn" id="wpClear" title="${_t('Remove')}">${fa('trash-can', 'regular')}</button>` : ''}<button class="btn" id="wpPick">${fa('folder-open')} ${_t('Choose file…')}</button></span></div>
    <div class="row" id="wpMsg" hidden></div>`;
  const msg = (t) => { const m = $('#wpMsg', el); m.hidden = !t; m.innerHTML = t ? `<span class="lbl">${fa('circle-exclamation')} ${esc(t)}</span>` : ''; };
  const pick = async () => {
    const r = await api.svc('wallpaper', 'pick').catch(() => null);
    msg(r && r.ok === false ? r.message : '');
    return !!(r && r.ok);
  };
  $('#wpOn', el).onchange = async (e) => {
    if (!e.target.checked) return api.setSettings({ wallpaperOn: false });
    if (S.wallpaperFile) return api.setSettings({ wallpaperOn: true });
    if (!(await pick())) e.target.checked = false;
  };
  $('#wpPick', el).onclick = pick;
  const clear = $('#wpClear', el); if (clear) clear.onclick = () => api.svc('wallpaper', 'clear');
  renderWallpaperLine(el);
}
const WALLPAPER_WAITS = { fullscreen: _t('Paused while an app is fullscreen'), covered: _t('Paused while a window covers the screen'), battery: _t('Paused on battery'),
  locked: _t('Paused while the PC is locked'), screen: _t('Paused while the screen is off'), sleep: _t('Paused while the PC sleeps') };
const WALLPAPER_ERRORS = { missing: _t('The file isn’t there any more. Choose it again.'), type: _t('Pick a video (MP4, MKV, WebM…) or a picture'),
  format: _t('Windows can’t play this video. An MP4 (H.264) always works.'), play: _t('Windows can’t play this video. An MP4 (H.264) always works.'),
  novideo: _t('This file has sound but no picture.'), picture: _t('Windows can’t open this picture.'), desktop: _t('Sympony can’t find the desktop. It tries again when Explorer restarts.'),
  crashed: _t('It stopped working. Turn it off and on again.') };
async function renderWallpaperLine(el) {
  const line = $('#wpLine', el);
  if (!line || !S.wallpaperFile) return;
  const w = await api.svc('wallpaper', 'state').catch(() => null);
  if (!w || !line.isConnected) return;
  let t = '';
  if (w.missing) t = WALLPAPER_ERRORS.missing;
  else if (!S.wallpaperOn) t = '';
  else if (w.state === 'error') t = WALLPAPER_ERRORS[w.error] || _t('That didn’t work.');
  else if (w.state === 'paused' && w.why) t = WALLPAPER_WAITS[w.why] || _t('Paused');
  else if (w.state === 'playing') t = w.width ? _t('Playing · {w}×{h}', { w: w.width, h: w.height }) : _t('Playing');
  else t = _t('Starting…');
  line.textContent = t ? ` · ${t}` : '';
  line.style.color = w.missing || w.state === 'error' ? '#ff9f0a' : '';
  // follow it while the page is open
  clearTimeout(el.wpT);
  if (S.wallpaperOn) el.wpT = setTimeout(() => { if (el.isConnected) renderWallpaperLine(el); }, 2000);
}
// the slot choices, without Temperature on a PC that has none (unless that side already shows it)
const slotOptions = (k) => IDLE_SLOTS.filter(([v]) => v !== 'temp' || tempSupported !== false || S[k] === 'temp');
const SNAP = [['left-half', _t('Left half')], ['right-half', _t('Right half')], ['top-half', _t('Top half')], ['bottom-half', _t('Bottom half')], ['left-third', _t('Left third')],
  ['center-third', _t('Center third')], ['right-third', _t('Right third')], ['left-two-thirds', _t('Left two-thirds')], ['right-two-thirds', _t('Right two-thirds')],
  ['top-left', _t('Top left')], ['top-right', _t('Top right')], ['bottom-left', _t('Bottom left')], ['bottom-right', _t('Bottom right')], ['maximize', _t('Maximize')], ['center', _t('Center')]];

// ------------------------------------------------------------------ section schema
const brands = new Set(['bluetooth-b', 'github']);
const icon = (n, color) => `<i class="fa-${brands.has(n) ? 'brands' : 'solid'} fa-${n}" style="background:${color}"></i>`;

// Todo sync with Microsoft To Do / Google Tasks (tasksync.rs) is built, but waits for Sympony's own app registrations
const TODO_SYNC_READY = true; // (Google Tasks: todosync.rs; Microsoft To Do not yet)
// Media → Translate lyrics into: saved (and sent to the AI) by the English name, shown in Sympony's language
const LYRICS_LANGS = { English: _t('English'), Indonesian: _t('Indonesian'), Javanese: _t('Javanese'), Sundanese: _t('Sundanese'), Malay: _t('Malay'),
  Arabic: _t('Arabic'), Chinese: _t('Chinese'), Japanese: _t('Japanese'), Korean: _t('Korean'), Thai: _t('Thai'), Vietnamese: _t('Vietnamese'),
  Filipino: _t('Filipino'), Hindi: _t('Hindi'), French: _t('French'), German: _t('German'), Spanish: _t('Spanish'), Portuguese: _t('Portuguese'),
  Italian: _t('Italian'), Dutch: _t('Dutch'), Russian: _t('Russian'), Turkish: _t('Turkish') };

const SECTIONS = [
  { group: 'Sympony' },
  { id: 'welcome', icon: 'hand-sparkles', color: '#ff9f0a', title: _t('Welcome'), render: renderWelcome },
  {
    id: 'general', icon: 'gear', color: '#8e8e93', title: _t('General'), rows: [
      // each language by its own name (i18n.rs); one that isn't built in is downloaded first; a change restarts Sympony
      { t: 'custom', label: _t('Language'), sub: _t('Sympony restarts to switch. Words not translated yet stay in English.'), render: renderLanguage },
      // mirrored for a language written right to left by itself; picked by hand to try it, or to keep it either way
      { t: 'select', k: 'layoutDirection', label: _t('Layout direction'), sub: _t('Right to left mirrors Sympony, as Arabic and Hebrew are read. Follow the language does it by itself for those languages. Sympony restarts to switch.'), options: [['auto', _t('Follow the language')], ['ltr', _t('Left to right')], ['rtl', _t('Right to left')]] },
      { t: 'toggle', k: 'launchAtLogin', label: _t('Launch at login') },
      { t: 'select', k: 'display', label: _t('Show Sympony on'), options: () => [['primary', _t('Primary display')], ['all', _t('All displays')], ['cursor', _t('Display with the mouse cursor')], ...(info.displays || []).map((d) => [String(d.id), d.label])] },
      { t: 'custom', render: renderPosition },
      { t: 'toggle', k: 'lockPosition', label: _t('Lock position'), sub: _t('Stop Sympony from being dragged by accident') },
      { t: 'toggle', k: 'hideInFullscreen', label: _t('Hide when an app is fullscreen'), sub: _t('Games, videos and presentations. To bring Sympony over one for a moment, press the open shortcut or click the tray icon.') },
      { t: 'toggle', k: 'autoHide', label: _t('Auto-hide'), sub: _t('Sympony waits above the top edge of the screen and comes down when you move the mouse there, so maximized windows get the whole screen. Alerts, reminders and the volume HUD still show.') },
      { t: 'toggle', k: 'standbyShow', label: _t('Come down when you’re idle'), sub: _t('With Auto-hide on: after a few seconds without the mouse or keyboard, Sympony comes down to show the time, music, lyrics, prayer times… and tucks away again as soon as you move the mouse or type. Not over fullscreen apps.') },
      { t: 'number', k: 'standbySecs', label: _t('Idle for'), sub: _t('Seconds without the mouse or keyboard before Sympony comes down (1 to 3600)'), min: 1, max: 3600, unit: _t('seconds') },
      { t: 'toggle', k: 'hideButton', label: _t('Hide button'), sub: _t('An eye button at the top of the open Sympony that tucks it away to a thin handle at the top edge, out of the way of tabs and title bars. Click the handle, right-click twice, or press the Open / close Sympony shortcut (default Option+N / Alt+N) to bring it back.') },
      { t: 'custom', render: renderAutoHideApps },
      { t: 'toggle', k: 'stepAside', label: _t('Step aside for the mouse'), sub: _t('Sympony stays down with the time, but slides up out of the way when the mouse comes to it from below, so a tab or button under it can be clicked. It comes back when the mouse moves away. Push the mouse to the very top edge, or press the shortcut, to open it. Not used while Auto-hide is on.') },
      { t: 'range', k: 'notchTopGap', label: _t('Gap from the top edge'), sub: _t('Let Sympony float below the top edge of the screen as a rounded pill. 0 keeps it attached to the edge. Hidden or auto-hidden, it still waits above the edge.'), min: 0, max: 120, step: 2, unit: 'px' },
      { t: 'custom', label: _t('Different gap for these apps'), sub: _t('While one of them is in front on a display, Sympony on that display floats at the app’s own gap instead, and goes back to the gap above when another app is in front there. Each display decides for itself. With Keep windows below Sympony on, maximized windows make room for it. Pick from the apps open now.'), render: renderGapApps },
      { t: 'toggle', k: 'touchMode', label: _t('Touchscreen support'), sub: _t('A tap on Sympony reaches Sympony. Without it, Sympony only takes clicks once the mouse points at it, so a finger’s tap goes to the window below. Taps beside Sympony still go there.') },
      { t: 'toggle', k: 'reserveTop', label: _t('Keep windows below Sympony'), sub: _t('Maximized windows start under Sympony, so it never covers tabs or title bars. Uses a thin strip at the top of the screen. Not used while Auto-hide is on.') },
      { t: 'range', k: 'reserveBlur', label: _t('Frosted strip beside Sympony'), sub: _t('With Keep windows below Sympony on: the strip left and right of Sympony blurs what’s behind it. 0% leaves it clear; higher is more frosted.'), min: 0, max: 100, step: 5, unit: '%' },
      { t: 'toggle', k: 'reserveMatch', label: _t('Color the strip like the app below'), sub: _t('With Keep windows below Sympony on: the strip takes the color at the top of the window under it (a browser’s tab bar, an app’s title bar), so it looks like part of the app. Where that isn’t one color, the strip stays frosted or clear. While the lyrics show inside Sympony with the album art behind them, the strip takes the art’s color either way.') },
      { t: 'toggle', k: 'showInScreenshots', label: _t('Show Sympony in screenshots & recordings'), sub: _t('Turn off to hide it from screen sharing, Snipping Tool and recordings') },
      { t: 'toggle', k: 'haptics', label: _t('Bounce on events'), sub: _t('Small spring animation for new activity') },
      { t: 'h2', text: _t('Closed Sympony') },
      // idleLeft, idleClock with clockSize, idleRight: the closed Sympony drawn with its three parts to click (renderClosedSlots);
      // the search finds it by the names those settings had as rows of their own too
      { t: 'custom', label: _t('What the closed Sympony shows'), sub: _t('Shown while nothing else is going on. Music, timers and alerts take over when they come.'), render: renderClosedSlots, also: [[_t('Left side'), 'left'], [_t('Middle'), 'middle'], [_t('Clock size'), 'middle'], [_t('Right side'), 'right']], words: () => [...IDLE_SLOTS, ...CLOCK_MODES].map(([, l]) => l).join(' ') + ' internet speed mbps kbps' },
      { t: 'toggle', k: 'clockWithActivities', label: _t('Keep the time while music or a timer plays'), sub: _t('Also during Pomodoro and countdowns. Short alerts and the volume HUD still cover it for a moment.') },
      { t: 'h2', text: _t('Clock') },
      { t: 'toggle', k: 'headerClock', label: _t('Time and date at the top of the open Sympony'), sub: _t('On every tab') },
      { t: 'toggle', k: 'clock24h', label: _t('24-hour time'), sub: _t('Starts out the same as Windows') },
      { t: 'custom', label: _t('World clock'), sub: _t('Up to 8 places, each in its own time zone (from Windows’ time zone data). They show in the World clock tab (turn it on in Modules), the first 4 in the World clock widget on the Dashboard, and the first one can show on a side of the closed Sympony (What the closed Sympony shows, above).'), render: renderWorldClocks },
      { t: 'select', k: 'hourChime', label: _t('Hourly chime'), sub: _t('A soft bell, a short glow around the closed Sympony, or both, every hour on the hour. The bell stays silent during Do not disturb and while an app is fullscreen.'), options: [['off', _t('Off')], ['sound', _t('Sound')], ['light', _t('Light|glow')], ['both', _t('Sound and light')]] },
      { t: 'custom', label: _t('Quiet hours'), sub: _t('No chime from the first time until the second'), render: renderHourChime },
      { t: 'h2', text: _t('Opening') },
      { t: 'toggle', k: 'openOnHover', label: _t('Open on hover'), sub: _t('Otherwise click to open') },
      { t: 'range', k: 'hoverDelay', label: _t('Hover delay'), min: 0, max: 800, step: 10, unit: 'ms' },
      { t: 'range', k: 'closeDelay', label: _t('Close delay'), min: 0, max: 1500, step: 50, unit: 'ms' },
      { t: 'h2', text: _t('Keyboard shortcuts') },
      { t: 'text', k: 'toggleShortcut', label: _t('Open / close Sympony'), sub: _t('e.g. Alt+N, Ctrl+Shift+Space'), cls: 'short' },
      { t: 'toggle', k: 'moduleShortcuts', label: _t('Switch tabs with ← / →'), sub: _t('While Sympony is open with the mouse on it, or opened with the shortcut. Alt+Shift+← / → works too.') },
      { t: 'text', k: 'snoozeShortcut', label: _t('Snooze Sympony'), sub: _t('Hides it for the snooze duration; press again to wake it'), cls: 'short' },
      { t: 'range', k: 'snoozeMinutes', label: _t('Snooze duration'), min: 5, max: 240, step: 5, unit: _t('min') },
      // the screen color picker (colorpick.rs); the Control tab has a button for it too
      { t: 'text', k: 'colorPickShortcut', label: _t('Pick a color from the screen'), sub: _t('Off while empty, e.g. Alt+Shift+C. A magnifier follows the mouse: click or press Enter to copy the color, Esc to cancel. The arrow keys move one pixel (with Shift, ten). Also a button in the Control tab.'), cls: 'short' },
      { t: 'select', k: 'colorPickFormat', label: _t('Copy colors as'), options: [['hex', 'HEX · #4A90E2'], ['rgb', 'RGB · rgb(74, 144, 226)'], ['hsl', 'HSL · hsl(212, 72%, 59%)']] },
      { t: 'h2', text: _t('Size') },
      { t: 'range', k: 'notchWidth', label: _t('Width'), sub: _t('The middle of the closed Sympony. The left and right sides add what they show, and it stays wide enough for the time.'), min: 80, max: 320, step: 2, unit: 'px' },
      { t: 'range', k: 'notchHeight', label: _t('Height'), min: 22, max: 44, step: 1, unit: 'px' },
      { t: 'select', k: 'shellForm', label: _t('Notch form'), sub: _t('How Sympony sits on screen. Hidden keeps the screen clear until you press the toggle shortcut.'), options: window.SYMPONY_OS === 'windows' ? [['notch', _t('Notch')], ['island', _t('Island')], ['drawer', _t('Drawer')], ['hidden', _t('Hidden')]] : [['notch', _t('Notch')], ['hidden', _t('Hidden')]] },
      { t: 'toggle', k: 'warmNight', label: _t('Warmer colors at night'), sub: _t('After sunset Sympony’s own colors turn warmer, easing in over about 45 minutes, and back at sunrise. Sunset comes from the city in Prayer Times or Weather (18:00 to 06:00 without one). The rest of the screen stays as it is.') },
      { t: 'range', k: 'warmNightStrength', label: _t('Night warmth'), min: 10, max: 100, step: 5, unit: '%', sub: _t('How warm it gets at night. Shown for a moment while you drag it.') },
      { t: 'range', k: 'notchOpacity', label: _t('Opacity when closed'), min: 20, max: 100, step: 5, unit: '%', sub: _t('Lower it to see apps behind Sympony while it’s closed. It turns solid while you hover, when it opens, and for alerts.') },
      { t: 'range', k: 'expandedWidth', label: _t('Expanded width'), min: 560, max: 780, step: 10, unit: 'px', sub: _t('Sympony opens while you drag, so you can see the size') },
      { t: 'range', k: 'expandedHeight', label: _t('Expanded height'), min: 170, max: 260, step: 2, unit: 'px', sub: _t('Home, Dashboard, Shelf, Pomodoro and System') },
      { t: 'range', k: 'expandedHeightTall', label: _t('Expanded height (tall modules)'), min: 220, max: 340, step: 2, unit: 'px', sub: _t('Todo, Notes, Pony, Bluetooth & Wi-Fi, Weather, Health, Screen Time, Translate…') },
    ],
  },
  { id: 'modules', icon: 'cubes', color: '#5e5ce6', title: _t('Modules'), render: renderModules },
  {
    id: 'live', icon: 'wave-square', color: '#ff375f', title: _t('Live Activities'), rows: [
      { t: 'lead', html: _t('What Sympony shows while it’s closed. When several things are going on, they take turns.') },
      { t: 'toggle', k: 'liveActivity', label: _t('Live activities while Sympony is closed') },
      { t: 'toggle', k: 'liveRotate', label: _t('Rotate between activities'), sub: _t('Every 6 seconds') },
      { t: 'toggle', k: 'liveSources.music', label: _t('Music'), sub: _t('Album art + visualizer while playing') },
      { t: 'toggle', k: 'liveSources.pomodoro', label: _t('Pomodoro, timer and stopwatch') },
      { t: 'toggle', k: 'liveSources.system', label: _t('System summary now and then'), sub: _t('CPU and GPU (with their temperatures when the PC shares them), memory, disk, network speed and Wi-Fi signal pop up for a few seconds, like a notification, then whatever was showing comes back') },
      { t: 'select', k: 'sysPeekEvery', label: _t('Show the System summary every'), options: [[30, _t('30 seconds')], [60, _t('1 minute')], [120, _t('2 minutes')], [300, _t('5 minutes')], [600, _t('10 minutes')], [1800, _t('30 minutes')]] },
      { t: 'toggle', k: 'liveSources.calendar', label: _t('Events starting within 15 minutes') },
      { t: 'toggle', k: 'liveSources.bluetooth', label: _t('Bluetooth connect / disconnect / low battery') },
      { t: 'toggle', k: 'liveSources.todo', label: _t('Todo deadlines'), sub: _t('Counts down the next task due within an hour. The alert when a task is due always shows.') },
      { t: 'toggle', k: 'sneakPeek', label: _t('Sneak peek on song change'), sub: _t('Briefly shows the title under Sympony') },
      { t: 'toggle', k: 'hoverMediaControls', label: _t('Hover-reveal ⏮ ⏯ ⏭ while Sympony is closed'), sub: _t('Works when "Open on hover" is off') },
    ],
  },
  {
    id: 'cursor', icon: 'arrow-pointer', color: '#ff9f0a', title: _t('Cursor'), rows: [
      { t: 'lead', html: _t('Cute mouse pointers in every app: a paw arrow, a paw for links, a ball of yarn while something loads, and the rest of the set to match. Or use a cursor pack you downloaded. Your own Windows pointers come back when you turn this off or quit Sympony.') },
      { t: 'select', k: 'cursorTheme', label: _t('Pointers'), options: [['off', _t('Windows (off)')], ['ginger', _t('Ginger paws')], ['black', _t('Black paws')], ['white', _t('White paws')], ['gray', _t('Gray paws')], ['calico', _t('Calico paws')], ['pink', _t('Pink paws')], ['mint', _t('Mint paws')], ['custom', _t('My own cursor pack')]] },
      { t: 'range', k: 'cursorScale', label: _t('Size'), sub: _t('Of the pointer size set in Windows (Settings → Accessibility → Mouse pointer). Windows draws every pointer at that size, so Sympony’s stay sharp up to 100%; for bigger ones, make them bigger there.'), min: 40, max: 100, step: 5, unit: '%' },
      { t: 'custom', render: renderCursor },
    ],
  },
  // each effect on its own (a new install has them on but Genie and Stacked notifications, an update keeps them off:
  // settings.rs FX_KEYS); not tied to
  // Windows' animation effects
  {
    id: 'effects', icon: 'wand-magic-sparkles', color: '#bf5af2', title: _t('Animations'), rows: [
      { t: 'lead', html: _t('Little animations around Sympony and the Dock. Turn each one on or off here; they don’t follow Windows’ animation effects.') },
      { t: 'toggle', k: 'fxGlow', label: _t('Glowing outline for alerts'), sub: _t('A thin light runs round the closed Sympony for reminders, events, charging, Pony answers and low battery, in their color') },
      { t: 'toggle', k: 'fxTimerLine', label: _t('Timer outline'), sub: _t('While a Timer or Pomodoro runs, a light round the closed Sympony shortens with the time left') },
      { t: 'toggle', k: 'fxGenie', label: _t('Windows and popups come out of their Dock icon'), sub: _t('A window minimized or brought back with a click on its Dock icon, an app’s window list, the tray icons and the menus stretch out of the icon and back into it') },
      { t: 'toggle', k: 'fxShelfFly', label: _t('Files fly into the Shelf'), sub: _t('A file you drop on Sympony shrinks into the Shelf') },
      { t: 'toggle', k: 'fxNotifStack', label: _t('Stacked notifications'), sub: _t('Notifications pile up under Sympony; swipe one sideways to dismiss it') },
      { t: 'toggle', k: 'fxTabSlide', label: _t('Tabs slide in from their side'), sub: _t('Picking a tab to the right slides it in from the right, and the other way round') },
      { t: 'toggle', k: 'fxHudBounce', label: _t('Volume bar bounces at the ends'), sub: _t('A volume key pressed at 0% or 100% stretches the bar a little (with HUD → Take over volume keys)') },
      { t: 'toggle', k: 'fxKaraoke', label: _t('Karaoke lyrics'), sub: _t('The line being sung fills with color as it goes (timed lyrics only)') },
      { t: 'toggle', k: 'fxCelebrate', label: _t('Celebrate a done day'), sub: _t('Confetti from Sympony when the last task due today is ticked off') },
    ],
  },
  // Sympony’s own moving wallpaper behind the desktop icons (wallpaper.rs), off by default. Windows’ wallpaper setting is
  // never changed: turning it off (or quitting Sympony) shows the Windows wallpaper again
  {
    id: 'wallpaper', icon: 'image', color: '#30b0c7', title: _t('Wallpaper'), rows: [
      { t: 'lead', html: _t('A moving wallpaper behind your desktop icons: a video (MP4, MKV, WebM) or a picture, on every display. It plays without sound on the graphics card.') },
      { t: 'custom', label: _t('Moving wallpaper'), sub: _t('Turning it off brings back your Windows wallpaper.'), render: renderWallpaper },
      { t: 'select', k: 'wallpaperFit', label: _t('Fit'), options: [['fill', _t('Fill')], ['fit', _t('Fit')], ['stretch', _t('Stretch')], ['center', _t('Center')]] },
      { t: 'h2', text: _t('Pause') },
      { t: 'lead', html: _t('It always stops while the PC is locked or the screen is off, and goes on where it was.') },
      { t: 'toggle', k: 'wallpaperPauseFullscreen', label: _t('While an app is fullscreen'), sub: _t('Stops while a game, a video or another fullscreen app runs.') },
      { t: 'toggle', k: 'wallpaperPauseCovered', label: _t('While a window covers the screen'), sub: _t('A maximized window hides it anyway.') },
      { t: 'toggle', k: 'wallpaperPauseBattery', label: _t('On battery'), sub: _t('Plays again when the PC is plugged in.') },
    ],
  },
  // each feature's settings (not the tab list: that's Modules above), so Media / Prayer Times here aren't taken for tabs
  { group: _t('Features') },
  {
    id: 'todo', icon: 'list-check', color: '#ff9f0a', title: _t('Todo'), rows: [
      { t: 'lead', html: _t('Give a task a time with the clock button (or end it with 15m, 2h or 14:30) and Sympony counts it down in the closed notch and alerts when it’s due. In the same picker, <b>Repeat</b> makes it come back on the days and at the time you choose: tick it off and the next one appears. Pony can set them too (“ingetin minum obat tiap hari jam 8”).') },
      { t: 'select', k: 'todoLateMinutes', label: _t('Mark late tasks as done'), sub: _t('This long past its time, a task is ticked off by itself and moves to Done (open it there to bring it back); a repeating one comes back for its next time. For all tasks, except those with their own choice: in the Todo tab’s clock picker, <b>Done if late</b>.'), options: [[0, _t('Off: keep them until I tick them off')], [1, _t('1 minute after their time')], [3, _t('3 minutes after their time')], [5, _t('5 minutes after their time')], [10, _t('10 minutes after their time')], [30, _t('30 minutes after their time')], [60, _t('1 hour after their time')]] },
      // Todo sync is built but held back until Sympony has its own Microsoft / Google app ids (TODO_SYNC_READY)
      ...(TODO_SYNC_READY ? [
        { t: 'select', k: 'todoSync', label: _t('Sync with'), sub: _t('Keeps your tasks here and one list in Microsoft To Do or Google Tasks the same, both ways: new tasks, names, done, due days and deletes. Google Tasks keeps only the day of a due time (Sympony keeps the time); To Do gets the time as a reminder, and a repeat when it fits.'), options: [['off', _t('Off')], ['microsoft', 'Microsoft To Do'], ['google', 'Google Tasks']] },
        { t: 'custom', render: renderTodoSync },
      ] : []),
      { t: 'select', k: 'todoSnoozeMinutes', label: _t('Snooze a due task for'), sub: _t('When a task is due, the closed notch has a snooze button next to its check: it moves the task this far ahead, and Sympony alerts again then. A repeating task keeps its repeat.'), options: [[5, _t('5 minutes')], [10, _t('10 minutes')], [15, _t('15 minutes')], [30, _t('30 minutes')], [60, _t('1 hour')]] },
      { t: 'range', k: 'todoTrashDays', label: _t('Keep deleted tasks in Trash for'), min: 1, max: 30, step: 1, unit: _t('days') },
    ],
  },
  {
    id: 'media', icon: 'music', color: '#ff2d55', title: _t('Media'), rows: [
      window.SYMPONY_OS === 'macos'
        ? { t: 'lead', html: _t('Works with whatever plays on this Mac: browsers (YouTube, SoundCloud…), Spotify, the Music app and other players. For Spotify and Music, macOS asks once whether Sympony may control them: click <b>OK</b> (or later: System Settings → Privacy & Security → Automation → Sympony). Music shows on the <b>Home</b> tab and in the closed Sympony; it has no tab of its own.') }
        : { t: 'lead', html: _t('Works with any app in the Windows media flyout (Spotify, Apple Music, Media Player, YouTube/YouTube Music in Edge, Chrome or Firefox, TIDAL, Deezer…) and with VLC. Music shows on the <b>Home</b> tab and in the closed Sympony; it has no tab of its own.') },
      { t: 'toggle', k: 'mediaEnabled', label: _t('Music controls') },
      { t: 'toggle', k: 'realVisualizer', label: _t('Real audio visualizer'), sub: _t('Reacts to system audio (analysed locally, never recorded)') },
      { t: 'select', k: 'visualizerStyle', label: _t('Visualizer style'), options: [['bars', _t('Bars (5)')], ['spectrum', _t('Spectrum (8)')]] },
      { t: 'custom', render: renderMediaColors },
      { t: 'toggle', k: 'colorGlow', label: _t('Color glow from album art') },
      { t: 'select', k: 'waveStyle', label: _t('Wave style'), sub: _t('How album-art waves sit behind the Music page.'), options: [['tide', _t('Tide')], ['horizon', _t('Horizon')], ['classic', _t('Classic')]] },
      { t: 'toggle', k: 'artOnline', label: _t('Find missing album art online'), sub: _t('When the music app or browser sends no album art, Sympony looks the cover up on iTunes and Deezer: the song’s artist and title are sent to itunes.apple.com and deezer.com. Turn off to keep song info off the network.') },
      { t: 'toggle', k: 'musicProgress', label: _t('Progress bar in the closed Sympony'), sub: _t('A thin line along the bottom edge fills as the song plays, in the album art’s color. With lyrics under Sympony, it runs under them.') },
      { t: 'h2', text: 'VLC' },
      { t: 'toggle', k: 'vlcWeb', label: _t('VLC web interface'), sub: _t('VLC doesn’t show in the Windows media flyout, so Sympony reads what’s playing from VLC’s window title: the title only, with no album art, progress, timed lyrics or seeking. A player that’s playing in the flyout comes first. For the rest, turn on VLC’s web interface: in VLC, Tools → Preferences, Show settings: All, then Interface → Main interfaces → tick Web, and Main interfaces → Lua → set a password. Restart VLC and enter the same password below. Sympony only talks to VLC on this PC.') },
      { t: 'custom', render: renderVlcPassword },
      { t: 'number', k: 'vlcPort', label: _t('Web interface port'), sub: _t('8080 unless you changed HTTP server port in VLC (Preferences → All → Input / Codecs)'), min: 1, max: 65535 },
      { t: 'custom', render: renderVlcStatus },
      { t: 'h2', text: 'YouTube' },
      { t: 'toggle', k: 'ytVideo', label: _t('Show YouTube videos in Music'), sub: _t('While a video plays on youtube.com in Brave, Chrome, Edge, Arc, Vivaldi, Opera or Safari, the Music section plays it too, muted and in step with the tab. Sympony reads the browser’s tab addresses to find it (macOS asks once). YouTube Music stays the music view.') },
      { t: 'toggle', k: 'ytVideoFill', label: _t('Fill the section with the video'), sub: _t('Off: the whole video in the middle, its colours glowing at the sides. On: edge to edge, top and bottom cropped.') },
      { t: 'h2', text: _t('Lyrics') },
      { t: 'toggle', k: 'lyricsEnabled', label: _t('Lyrics'), sub: _t('The words of the song, in time with it when there are timings; lyrics without them scroll slowly as the song plays (marked Not timed). The ❝ button in the player on Home shows the player with the lyrics next to it, and goes back to the calendar. They come from LRCLIB: the song’s title, artist, album and length are sent to lrclib.net.') },
      { t: 'toggle', k: 'lyricsInNotch', label: _t('Current line under the closed Sympony'), sub: _t('While a song with timed lyrics plays') },
      { t: 'select', k: 'lyricsLayout', label: _t('Where the current line shows'), sub: _t('Under: in a strip under the closed Sympony, which grows to make room. Inside: in the middle of the closed Sympony in place of the time, between the album art and the visualizer, so Sympony stays small. Both need the switch above on.'), options: [['under', _t('Under the closed Sympony')], ['inline', _t('Inside the closed Sympony')]] },
      { t: 'select', k: 'lyricsSecondLine', label: _t('Second line inside'), sub: _t('With Inside: a smaller line under the one being sung, and Sympony gets a little taller while it shows. When Under each line (below) gives the song a romanization or translation, that goes here instead.'), options: [['none', _t('Nothing')], ['next', _t('The next line')], ['time', _t('The time')]] },
      { t: 'select', k: 'lyricsLongLines', label: _t('Long lines inside'), sub: _t('With Inside: Widen makes room for the song’s longest line. Keep the width gives the lines at most the closed Sympony’s width plus 120 px; a longer line scrolls to show its end.'), options: [['widen', _t('Widen Sympony to fit')], ['scroll', _t('Keep the width and scroll the text')]] },
      { t: 'select', k: 'lyricsTextSize', label: _t('Lyrics text size'), sub: _t('The line being sung in the closed Sympony, inside or under it. The smaller line under it follows.'), options: [['small', _t('Small')], ['normal', _t('Normal')], ['large', _t('Large')]] },
      { t: 'toggle', k: 'lyricsBold', label: _t('Bold lyrics'), sub: _t('Off: the line being sung in the closed Sympony in regular weight') },
      { t: 'range', k: 'lyricsArtBg', label: _t('Album art behind the lyrics'), sub: _t('With Inside: the album art, blurred and dimmed, behind the line. 0% keeps Sympony black.'), min: 0, max: 100, step: 5, unit: '%' },
      { t: 'select', k: 'lyricsScript', label: _t('Show the lyrics as'), sub: _t('Romanized only: Korean, Japanese and Chinese lines in Latin letters in place of the original, in the closed Sympony and on Home, worked out by the AI agent picked in Pony Assistant. Lines without a romanization stay as they are; Under each line then adds only the translation.'), options: [['original', _t('Original')], ['romanized', _t('Romanized only')]] },
      { t: 'select', k: 'lyricsExtra', label: _t('Under each line'), sub: _t('Korean, Japanese and Chinese lyrics in Latin letters, the lyrics translated, or both. Shown in the player on Home and under the line in the closed Sympony. Both go through the AI agent picked in Pony Assistant: each song is sent once (lyrics already in Latin letters aren’t) and the result is kept on this Mac.'), options: [['off', _t('Nothing')], ['romanized', _t('Romanization')], ['translated', _t('Translation')], ['both', _t('Romanization and translation')]] },
      { t: 'select', k: 'lyricsTranslateTo', label: _t('Translate lyrics into'), sub: _t('For Translation in Under each line'), options: () => [...new Set([S.lyricsTranslateTo, 'English', 'Indonesian', 'Javanese', 'Sundanese', 'Malay', 'Arabic', 'Chinese', 'Japanese', 'Korean', 'Thai', 'Vietnamese', 'Filipino', 'Hindi', 'French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Russian', 'Turkish'].filter(Boolean))].map((l) => [l, LYRICS_LANGS[l] || l]) },
    ],
  },
  { id: 'calendar', icon: 'calendar-days', color: '#ff3b30', title: _t('Calendar'), render: renderCalendar },
  { id: 'weather', icon: 'cloud-sun', color: '#32ade6', title: _t('Weather'), render: renderWeather },
  { id: 'prayer', icon: 'mosque', color: '#30d158', title: _t('Prayer Times'), render: renderPrayer },
  {
    id: 'pomodoro', icon: 'stopwatch', color: '#ff6b4a', title: _t('Pomodoro'), rows: [
      { t: 'range', k: 'pomoWork', label: _t('Focus'), min: 5, max: 90, step: 5, unit: _t('min') },
      { t: 'range', k: 'pomoShort', label: _t('Short break'), min: 1, max: 30, step: 1, unit: _t('min') },
      { t: 'range', k: 'pomoLong', label: _t('Long break'), min: 5, max: 60, step: 5, unit: _t('min') },
      { t: 'range', k: 'pomoCycles', label: _t('Focus sessions before a long break'), min: 2, max: 8, step: 1, unit: '' },
      { t: 'toggle', k: 'pomoAutoBreak', label: _t('Start breaks automatically') },
      { t: 'toggle', k: 'pomoAutoWork', label: _t('Start focus automatically after a break') },
      { t: 'toggle', k: 'pomoSound', label: _t('Completion sound'), sub: _t('The Timer’s too. Quiet while Windows’ Do not disturb is on.') },
      { t: 'h2', text: _t('Background sound') },
      { t: 'select', k: 'focusSound', label: _t('Sound while you focus'), sub: _t('Fades in while a focus session runs and out when it’s paused or ends. Made by Sympony itself, nothing is downloaded. The headphones button in the Pomodoro tab changes it too.'),
        options: [['off', _t('Off')], ['white', _t('White noise')], ['pink', _t('Pink noise')], ['brown', _t('Brown noise')], ['rain', _t('Rain')], ['waves', _t('Ocean waves')], ['wind', _t('Wind')], ['fire', _t('Fireplace')]] },
      { t: 'range', k: 'focusSoundVolume', label: _t('Volume'), sub: _t('Changing the sound or its volume plays it for a few seconds.'), min: 0, max: 100, step: 5, unit: '%' },
      { t: 'toggle', k: 'focusSoundBreaks', label: _t('Keep playing in breaks'), sub: _t('Off: it fades out when a break starts and comes back with the next focus session.') },
      { t: 'h2', text: _t('Timer') },
      { t: 'custom', label: _t('Presets'), sub: _t('The lengths under the Timer’s wheel, in minutes (1 to 600, up to 8). A click on one there sets the wheel.'), render: renderTimerPresets },
      { t: 'toggle', k: 'timerRemember', label: _t('Remember the last duration'), sub: _t('The Timer’s wheel opens at the length you last started. Off: at the first preset.') },
      { t: 'toggle', k: 'timerThenBreak', label: _t('Start a break after the timer'), sub: _t('When the Timer ends, Pomodoro’s short break starts (unless a Pomodoro is running).') },
    ],
  },
  {
    id: 'health', icon: 'heart-pulse', color: '#30d158', title: _t('Health'), rows: [
      { t: 'lead', html: _t('Desk wellbeing: three daily rings for breaks, water and mindful minutes. Stepping away from your PC for 5 minutes, or locking it for 2, counts as a break. Nothing leaves this PC.') },
      { t: 'toggle', k: 'healthEnabled', label: _t('Track health') },
      { t: 'range', k: 'healthWaterGoal', label: _t('Water goal'), min: 2, max: 16, step: 1, unit: _t('glasses') },
      { t: 'range', k: 'healthBreakGoal', label: _t('Break goal'), min: 1, max: 16, step: 1, unit: _t('breaks') },
      { t: 'range', k: 'healthMindfulGoal', label: _t('Mindful minutes goal'), min: 1, max: 30, step: 1, unit: _t('min') },
      { t: 'h2', text: _t('Reminders') },
      { t: 'toggle', k: 'healthBreakReminders', label: _t('Remind me to take a break') },
      { t: 'range', k: 'healthBreakInterval', label: _t('After working continuously for'), min: 15, max: 120, step: 5, unit: _t('min') },
      { t: 'toggle', k: 'healthWaterReminders', label: _t('Remind me to drink water'), sub: _t('Sympony chimes and shows “Time for a glass of water” with today’s count. Counted while you’re at the PC, from the last glass you logged. Click it to open Health and add the glass. Reminders stop once the day’s goal is reached and start again the next day.') },
      { t: 'range', k: 'healthWaterInterval', label: _t('Water reminder every'), min: 5, max: 180, step: 5, unit: _t('min') },
      { t: 'toggle', k: 'healthEyeBreaks', label: _t('20-20-20 eye breaks'), sub: _t('Now and then (Eye break every, below), the screen dims and asks you to look 20 feet away for a moment. Skip anytime with Esc.') },
      { t: 'range', k: 'healthEyeInterval', label: _t('Eye break every'), min: 10, max: 60, step: 5, unit: _t('min') },
      { t: 'range', k: 'healthEyeDuration', label: _t('Eye break length'), min: 10, max: 60, step: 5, unit: 's' },
    ],
  },
  {
    id: 'screentime', icon: 'hourglass-half', color: '#5856d6', title: _t('Screen Time'), rows: [
      { t: 'lead', html: _t('Counts time in the foreground app (idle time excluded) and app switches. Browser tabs are categorised by their title. Data stays in <code>screentime.json</code> on this PC (35 days).') },
      { t: 'toggle', k: 'screenTimeEnabled', label: _t('Track screen time') },
      { t: 'range', k: 'screenTimeIdle', label: _t('Stop counting after idle'), min: 30, max: 600, step: 30, unit: 's' },
      { t: 'list', k: 'screenTimeExcluded', label: _t('Excluded apps'), sub: MAC_SYS() ? _t('Comma-separated app names, e.g. Steam, 1Password') : _t('Comma-separated .exe names, e.g. keepass.exe, steam.exe') },
    ],
  },
  {
    id: 'dayprogress', icon: 'chart-gantt', color: '#007aff', title: _t('Day Progress'), rows: [
      { t: 'lead', html: _t('One timeline for today, from when you wake up to bedtime, with calendar events and completed tasks.') },
      { t: 'time', k: 'wakeTime', label: _t('Day starts') },
      { t: 'time', k: 'bedTime', label: _t('Bedtime') },
    ],
  },
  {
    id: 'bluetooth', icon: 'bluetooth-b', color: '#0a84ff', title: _t('Bluetooth & Wi-Fi'), rows: [
      { t: 'toggle', k: 'bluetoothEnabled', label: _t('Bluetooth devices & battery'), sub: _t('Shows a device when it connects or disconnects, and when its battery runs low') },
      { t: 'range', k: 'bluetoothLowBattery', label: _t('Low battery alert at'), min: 5, max: 50, step: 5, unit: '%' },
      { t: 'custom', render: (el) => { el.innerHTML = `<div class="list" id="btList"></div>`; renderBt(); } },
    ],
  },
  { group: _t('Sympony & system') },
  {
    id: 'dock', icon: 'icons', color: '#0a84ff', title: _t('Dock'), rows: [
      { t: 'lead', html: _t('A Dock at the bottom of the screen: the apps you pin and the ones that are open, with icons that grow as the mouse passes over them. Click an app to open it or switch to it (click the one in front to minimize it), right-click for more, drag an icon along the Dock to move it or up out of it to remove it, and drop an app, shortcut, file or folder on it to pin it. Right-click → Change icon to use your own PNG.') },
      { t: 'toggle', k: 'dockEnabled', label: _t('Show the Dock') },
      { t: 'custom', label: _t('Show the Dock on'), sub: _t('Sympony’s display, all displays, or the displays you choose'), render: renderDockDisplays },
      { t: 'select', k: 'dockAppsOn', label: _t('Open apps on each Dock'), sub: _t('With a Dock on more than one display: all open apps on every Dock, or on each Dock only the apps with a window on its display. The pinned apps are on every Dock either way.'), options: [['all', _t('All open apps')], ['own', _t('Only the ones on its display')]] },
      { t: 'custom', render: renderDockPins },
      { t: 'toggle', k: 'dockTrash', label: _t('Recycle Bin'), sub: _t('At the end of the Dock. Right-click it → Remove from Dock takes it off; this brings it back') },
      { t: 'custom', label: _t('Style'), sub: _t('Black or White: a solid bar. Clear Glass: see-through with a bright edge, no blur. Frosted Glass: blurs what’s behind it; while Windows’ transparency effects are off or energy saver is on it looks like Clear Glass. Midnight: a solid deep blue bar. Wallpaper color: a solid bar in the main color of the wallpaper behind it.'), render: renderDockStyle },
      { t: 'toggle', k: 'dockUniformIcons', label: _t('Same shape for every icon'), sub: _t('Every icon in the same rounded square. An icon of another shape sits on a small plate that follows the Style') },
      { t: 'toggle', k: 'dockIconTint', label: _t('Tint icons'), sub: _t('Every app icon in one colour that follows the Style') },
      { t: 'toggle', k: 'dockCalendarDate', label: _t('Show today’s date on calendar icons'), sub: _t('A calendar app in the Dock (Windows Calendar, Outlook’s calendar, Google Calendar…) shows the month and today’s date on its icon. An icon you changed yourself stays') },
      { t: 'select', k: 'dockRunMark', label: _t('Open-app marker'), sub: _t('How the Dock marks the apps that are open: a dot under the icon for each window, a dot in its top corner (with the number of windows when there’s more than one), a short line inside the icon, or nothing'), options: [['dot', _t('Dot under the icon')], ['corner', _t('Dot in the top corner')], ['line', _t('Line inside the icon')], ['none', _t('None')]] },
      { t: 'range', k: 'dockSize', label: _t('Icon size'), min: 16, max: 80, step: 2, unit: 'px' },
      { t: 'range', k: 'dockGap', label: _t('Space between icons'), min: 0, max: 20, step: 1, unit: 'px' },
      { t: 'range', k: 'dockMagnify', label: _t('Magnification'), min: 0, max: 100, step: 5, unit: '%' },
      { t: 'range', k: 'dockLift', label: _t('Gap from the bottom edge'), sub: _t('Raise the Dock above the bottom of the screen. Maximized windows still fill the screen behind it, so an app’s status bar shows under the raised Dock'), min: 0, max: 60, step: 2, unit: 'px' },
      { t: 'toggle', k: 'dockShowRunning', label: _t('Show open apps that aren’t pinned'), sub: _t('After a divider; open apps are marked as chosen in Open-app marker') },
      { t: 'toggle', k: 'dockEndTask', label: _t('End task in the right-click menu'), sub: _t('Ends an app that stopped responding, like Task Manager does. Anything unsaved in it is lost') },
      { t: 'toggle', k: 'dockAutoHide', label: _t('Hide the Dock until the mouse reaches the bottom'), sub: _t('Always, on every display with a Dock. Maximized windows fill the whole screen behind the Dock in any case') },
      { t: 'toggle', k: 'dockHideMaximized', label: _t('Hide while a window is maximized'), sub: _t('Only on the display with the maximized window. Move the mouse to the bottom edge to bring the Dock up. Not used while Keep windows above the Dock is on') },
      { t: 'toggle', k: 'dockStandby', label: _t('Come up when you’re idle'), sub: _t('While the Dock is hidden (until the mouse reaches the bottom, or for a maximized window): after a few seconds without the mouse or keyboard, it comes up to show the time and your apps, and goes down again as soon as you move the mouse or type. Not over fullscreen apps, nor while a video or music plays with a window maximized on that display.') },
      { t: 'number', k: 'dockStandbySecs', label: _t('Idle for'), sub: _t('Seconds without the mouse or keyboard before the Dock comes up (1 to 3600)'), min: 1, max: 3600, unit: _t('seconds') },
      { t: 'range', k: 'dockHoverDelay', label: _t('Hover delay'), sub: _t('How long the mouse stays at the bottom edge before the hidden Dock comes up. 0 brings it up at once'), min: 0, max: 800, step: 10, unit: 'ms' },
      { t: 'range', k: 'dockCloseDelay', label: _t('Close delay'), sub: _t('While the Dock hides: how long it stays up after the mouse leaves it'), min: 0, max: 1500, step: 50, unit: 'ms' },
      { t: 'toggle', k: 'dockReserve', label: _t('Keep windows above the Dock'), sub: _t('Maximized windows stop above the Dock, as they do above the taskbar, so it never covers their bottom. Uses a strip as tall as the Dock at the bottom of each display with a Dock; the desktop shows beside the Dock. Not used while the Dock hides until the mouse reaches the bottom') },
      { t: 'toggle', k: 'dockHideInFullscreen', label: _t('Hide when an app is fullscreen'), sub: _t('Games, videos and presentations (the Docks on other displays stay). Apart from Sympony’s own choice in General, so Sympony can stay over a game (for its FPS) while the Dock hides') },
      { t: 'toggle', k: 'dockHideTaskbar', label: _t('Hide the Windows taskbar'), sub: _t('Takes the taskbar off the displays that have a Dock while the Dock is on, and each Dock gets a Start button (right-click it for the power and system menu). The Windows key, Windows + A (quick settings) and Windows + N (notifications) still work. Displays without a Dock keep their taskbar, set to auto-hide meanwhile (Windows has one auto-hide switch for all taskbars): it slides up when the mouse reaches the bottom of the screen. The taskbar comes back when you turn this or the Dock off, while Sympony is snoozed or hidden, and when you quit Sympony.') },
      { t: 'toggle', k: 'dockSearch', label: _t('Search button'), sub: _t('While the taskbar is hidden: a button after Start that opens Windows search (like Windows + S).') },
      { t: 'toggle', k: 'dockTaskView', label: _t('Task View button'), sub: _t('While the taskbar is hidden: a button after Start that shows your windows and desktops (like Windows + Tab), with the number of the desktop you’re on when there’s more than one. Right-click it to switch to another desktop, add one or close this one; scroll over it for the next or previous desktop.') },
      { t: 'toggle', k: 'dockShowDesktop', label: _t('Show desktop button'), sub: _t('While the taskbar is hidden: a small desktop button at the very end of the Dock, after the time. Click it to show the desktop, and again to bring your windows back. Right-click an empty spot on the Dock for the same.') },
      { t: 'toggle', k: 'dockStatus', label: _t('Time and status on the Dock'), sub: _t('While the taskbar is hidden: the input language, network, volume, battery, time and date at the right end of the Dock. Click them for Windows’ own panels: switch the language, Quick Settings, or notifications and the calendar.') },
      { t: 'toggle', k: 'dockPrayer', label: _t('Next prayer on the Dock'), sub: _t('While Prayer Times is on: the next prayer and its time near the right end of the Dock, counting down in the minutes before it (as set under Prayer Times) and lit up when it’s time. Click it to open Sympony on Prayer Times.') },
      { t: 'toggle', k: 'dockTray', label: _t('Other apps’ tray icons on the Dock'), sub: _t('While the taskbar is hidden: an arrow at the right end of the Dock opens the icons of the notification area (WhatsApp, OneDrive, Steam…). Click one as you would on the taskbar, or right-click it for the app’s own menu, which may open at the bottom of the screen. The taskbar comes back for a moment while Sympony clicks it there.') },
      { t: 'select', k: 'dockTraySize', label: _t('Tray icon size'), sub: _t('The icons in the grid the arrow opens'), options: [['small', _t('Small')], ['medium', _t('Medium')], ['large', _t('Large')]] },
    ],
  },
  {
    id: 'notifications', icon: 'bell', color: '#ff3b30', title: _t('Notifications'), rows: [
      { t: 'lead', html: _t('Notifications from your apps and browsers (messages, mail, sites you allowed) show in Sympony as they arrive: the app, the picture, the title and the text, stacked under the closed Sympony. Click one to open its app. Sympony reads them from Windows on this PC; nothing is sent anywhere.') },
      { t: 'toggle', k: 'notifEnabled', label: window.SYMPONY_OS === 'macos' ? _t('Show macOS notifications in Sympony') : _t('Show Windows notifications in Sympony') },
      { t: 'custom', render: renderTelegramHint },
      { t: 'toggle', k: 'notifFollowDnd', label: _t('Follow Do not disturb'), sub: _t('While Windows’ Do not disturb is on, Sympony doesn’t show them either. They stay in Windows’ notification centre') },
      { t: 'toggle', k: 'notifDndPeek', label: _t('Quiet pop-ups during Do not disturb'), sub: _t('Sympony still tells you one came: a small pop-up with the app’s icon and how many, never the title or text. They wait in the history as before') },
      { t: 'toggle', k: 'notifHideBanners', label: _t('Don’t show them twice'), sub: _t('Turns off Windows’ own pop-up for each app Sympony shows, so it appears only in Sympony. They still collect in the Windows notification center. The pop-ups come back when you turn this or the option above off, or quit Sympony. The first notification from an app Sympony hasn’t seen yet may still pop up once.') },
      { t: 'select', k: 'notifSeconds', label: _t('Show each for'), sub: _t('New ones pile up under the older ones; the time waits while the mouse is on them. Each has an X to close it.'), options: [[6, _t('6 seconds')], [10, _t('10 seconds')], [30, _t('30 seconds')], [60, _t('1 minute')], [300, _t('5 minutes')], [0, _t('Until I close it')]] },
      { t: 'toggle', k: 'notifHistory', label: _t('Notification history'), sub: window.SYMPONY_OS === 'macos' ? _t('Keeps the notifications Sympony shows on this Mac (encrypted). Turning it off deletes them.') : _t('Keeps the notifications Sympony shows, and the ones held back during Do not disturb, on this PC (encrypted). Turning it off deletes them.') },
      { t: 'number', k: 'notifHistoryDays', label: _t('Keep for'), sub: _t('Older ones are removed (1 to 90 days). The bell at the top of the open Sympony lists them'), min: 1, max: 90, unit: _t('days') },
      { t: 'number', k: 'notifHistoryMax', label: _t('Keep at most'), sub: _t('The oldest go first (20 to 1000)'), min: 20, max: 1000, unit: _t('notifications') },
      { t: 'custom', render: renderNotifClear },
    ],
  },
  { id: 'dropactions', icon: 'hand-holding', color: '#ff9f0a', title: _t('Drop Actions & Shelf'), render: renderDropActions },
  { id: 'snap', icon: 'table-columns', color: '#64d2ff', title: _t('Snap Zones'), render: renderSnap },
  { id: 'hud', icon: 'sliders', color: '#8e8e93', title: _t('HUD'), render: renderHud },
  {
    id: 'battery', icon: 'battery-three-quarters', color: '#34c759', title: _t('Battery'), rows: [
      { t: 'toggle', k: 'batteryEnabled', label: _t('Show battery') },
      { t: 'toggle', k: 'showBatteryPercent', label: _t('Show percentage'), sub: _t('Next to the battery in the open Sympony’s top bar and on the closed Sympony’s side') },
      { t: 'select', k: 'batteryStyle', label: _t('Icon'), options: [['bar', _t('Bar')], ['ring', _t('Ring')]] },
      { t: 'toggle', k: 'chargingActivity', label: _t('Charging animation'), sub: _t('When you plug in or unplug the charger') },
      { t: 'range', k: 'lowBatteryThreshold', label: _t('Low battery warning at'), min: 5, max: 50, step: 1, unit: '%' },
      { t: 'custom', render: (el) => { el.innerHTML = '<p class="hint" id="batteryInfo"></p>'; renderBattery(); } },
    ],
  },
  {
    id: 'mirror', icon: 'video', color: '#af52de', title: _t('Mirror'), rows: [
      { t: 'lead', html: _t('A tiny mirror in Sympony. The camera only turns on when you click the mirror tile and turns off as soon as Sympony closes.') },
      { t: 'toggle', k: 'mirrorEnabled', label: _t('Show mirror') },
      { t: 'select', k: 'mirrorShape', label: _t('Shape'), options: [['rounded', _t('Rounded square')], ['circle', _t('Circle')]] },
    ],
  },
  { id: 'stats', icon: 'gauge-high', color: '#636366', title: _t('System Monitor'), rows: [
    { t: 'toggle', k: 'statsEnabled', label: _t('Show the System tab'), sub: window.SYMPONY_OS === 'macos' ? _t('CPU, memory, network and disk') : _t('CPU, memory, network, disk and temperature') },
    { t: 'custom', render: renderTempZone },
    { t: 'toggle', k: 'fpsCounter', label: _t('FPS counter'), sub: _t('While a game is in front, the closed notch shows how many frames per second it draws, with CPU and GPU. For DirectX games (most Windows games); nothing is added to the game, so anti-cheat has nothing to object to.') },
    { t: 'custom', render: renderFps },
  ] },
  { group: _t('Integrations') },
  { id: 'ai', icon: 'wand-magic-sparkles', color: '#bf5af2', title: _t('Pony Assistant'), render: renderAi },
  {
    id: 'aiusage', icon: 'gauge', color: '#d97757', title: _t('AI usage'), rows: [
      { t: 'lead', html: _t('How much of your Claude and Codex plan limits you’ve used, in a tab of its own: the 5-hour session and the week. Sympony reads them on this PC. For Claude it asks Anthropic with Claude Code’s own sign-in, as Claude Code’s /usage does; Codex’s come from its logs, offline. Nothing else is sent anywhere.') },
      { t: 'custom', svc: 'claude', label: 'Claude Code', sub: _t('Reads Claude Code’s sign-in on this PC'), render(el) { renderAiUsageService(el, this); } },
      { t: 'custom', svc: 'codex', label: 'Codex', sub: _t('Reads Codex CLI’s logs on this PC'), render(el) { renderAiUsageService(el, this); } },
      { t: 'toggle', k: 'aiUsageMark', label: _t('Show in the closed Sympony'), sub: _t('A small ring at the left with the busiest 5-hour session: green, amber from 70 %, red from 90 %') },
      { t: 'select', k: 'aiUsageWarn', label: _t('Warn at'), sub: _t('Once per 5-hour session, in the closed Sympony, with when it resets'), options: [[0, _t('Off')], [80, '80 %'], [90, '90 %'], [95, '95 %']] },
    ],
  },
  // Integrations: what connects Sympony to other apps, in one place (hooks.rs): the agents that ask under the notch
  // (Claude Code's hooks, Paseo), with each one's state
  { id: 'integrations', icon: 'plug', color: '#5e5ce6', title: _t('Integrations'), rows: [
    { t: 'lead', html: _t('When an AI agent needs a permission, has a question or is done, Sympony shows it under the closed notch and you answer there. Every connection to another app is set up here.') },
    { t: 'custom', render: renderIntegrations },
    { t: 'h2', text: _t('Requests under the notch') },
    { t: 'toggle', k: 'claudeHooks', label: _t('Show the agents’ requests'), sub: _t('Permissions, questions and “done” from the agents connected below') },
    { t: 'toggle', k: 'claudeAnswer', label: _t('Answer permissions from Sympony'), sub: _t('Allow, Deny or pick an answer right in Sympony. Without a click within a minute, the agent asks in its own window as usual; Open does that at once and brings that window forward. A command too long to show whole can only be opened.') },
    { t: 'toggle', k: 'claudeDone', label: _t('Tell me when an agent is done'), sub: _t('With the start of its last message and a soft sound') },
    { t: 'h2', text: 'Claude Code' },
    { t: 'custom', render: renderClaudeHooks },
    { t: 'h2', text: 'Paseo' },
    { t: 'toggle', k: 'paseoEnabled', label: _t('Show Paseo’s permission requests'), sub: _t('The agents you run in Paseo (Claude Code, Antigravity, Codex…): Sympony asks Paseo’s app on this Mac every 2 seconds, with the command or the question in full. Allow, Deny and your answers go back to Paseo; a plan opens Paseo.') },
    { t: 'custom', render: renderPaseo },
  ] },
  { id: 'github', icon: 'github', color: '#24292f', title: 'GitHub', render: renderGithub },
  { group: '' },
  { id: 'about', icon: 'circle-info', color: '#8e8e93', title: _t('About'), render: renderAbout },
];

// ------------------------------------------------------------------ macOS and Linux
// On a Mac (main says the system: SYMPONY_OS) Settings leaves out what needs Windows, or isn't wanted there: pages, rows by
// their setting or by the function that draws them, choices in a list, the tabs (as notch.js's MAC_TABS_OFF) and the
// Dashboard's widgets (as dashboard.js). Linux (phase 1) the same way, with a list of its own (LINUX_OFF below).
const MAC = window.SYMPONY_OS === 'macos';
const LINUX = window.SYMPONY_OS === 'linux';
const MAC_OFF = {
  // (since 1.6: the moving wallpaper, Windows' own)
  // (Screen Time and Bluetooth: Sympony's own on a Mac since phase 4c, screentime.rs / bluetooth in watchers.rs)
  pages: ['cursor', 'dock', 'snap', 'wallpaper'],
  keys: ['hideInFullscreen', 'touchMode', 'reserveTop', 'reserveBlur', 'reserveMatch',
    'snoozeShortcut', 'snoozeMinutes',
    // System Monitor on a Mac (watchers.rs): CPU, memory, disk and network; no temperature sensor or FPS counter
    'fpsCounter',
    'realVisualizer', 'vlcWeb', 'vlcPort',
    // Notifications: macOS's own banners and Focus stay as they are (macnotif.rs only reads)
    'notifFollowDnd', 'notifDndPeek',
    // the screen colour picker (colorpick.rs), the Dock's genie (wingenie.rs): Windows' own
    'colorPickShortcut', 'colorPickFormat', 'fxGenie'],
  rows: [renderAutoHideApps, renderGapApps, renderVlcPassword, renderVlcStatus, renderTempZone, renderFps],
  // (Wallpaper color reads Windows' wallpaper, wallcolor.rs)
  options: { idleLeft: ['temp', 'wifi'], idleRight: ['temp', 'wifi'] },
  // (the Bluetooth & Wi-Fi tab stays: on a Mac it's the Speed test alone, modules/bluetooth.js)
  tabs: [],
  widgets: [],
  // the Welcome page's cards, by icon: notifications, Control and HUD, Screen Time, System, Bluetooth, Snap Zones, cursors
  cards: ['bell', 'sliders', 'table-columns', 'arrow-pointer'],
};
// Linux (phase 1, X11 and XWayland): what a Mac leaves out, but the System tab, its slots in the closed Sympony and the
// System summary stay (main reads the PC's numbers there, the Wi-Fi signal too); and what Linux has no part for yet:
// other apps' notifications, the keyboard language, the radio's player, Sympony kept out of screenshots, the FPS
// counter, the clipboard history (renderDropActions)
const LINUX_OFF = {
  pages: ['cursor', 'dock', 'snap', 'bluetooth', 'screentime', 'wallpaper', 'notifications'],
  keys: ['hideInFullscreen', 'touchMode', 'reserveTop', 'reserveBlur', 'reserveMatch', 'showInScreenshots',
    'toggleShortcut', 'moduleShortcuts', 'snoozeShortcut', 'snoozeMinutes', 'liveSources.bluetooth',
    'realVisualizer', 'vlcWeb', 'vlcPort', 'colorPickShortcut', 'colorPickFormat', 'fxGenie', 'fpsCounter'],
  rows: [renderAutoHideApps, renderGapApps, renderVlcPassword, renderVlcStatus, renderFps],
  options: {},
  tabs: ['screentime', 'radio'],
  widgets: ['toggles', 'screentime'],
  // the Welcome page's cards, by icon: notifications, Screen Time, Bluetooth, Snap Zones, cursors
  cards: ['bell', 'hourglass-half', 'bluetooth-b', 'table-columns', 'arrow-pointer'],
};
// what this system leaves out (none on Windows)
const OFF = MAC ? MAC_OFF : LINUX ? LINUX_OFF : null;
// …and pages that read differently there, by page id: Notifications talks about the Mac, and says when Sympony may not
// read them yet
const MAC_ROWS = {
  notifications: (rows) => {
    const out = rows.map((r) => (r.t === 'lead' ? { ...r, html: _t('Notifications from your apps (messages, mail, calendars, sites you allowed) show in Sympony as they arrive: the app, the title and the text, stacked under the closed Sympony. Click one to open its app. Sympony reads them from macOS on this Mac; nothing is sent anywhere.') }
      : r.k === 'notifEnabled' ? { ...r, label: _t('Show Mac notifications in Sympony') }
      : r.k === 'notifHideBanners' ? { ...r, sub: _t('Sympony reads each of macOS’s notification banners the moment it shows and closes it, so notifications appear only in Sympony, stacked under the notch. Needs Accessibility (below).') } : r));
    out.splice(out.findIndex((r) => r.k === 'notifEnabled') + 1, 0, { t: 'custom', render: renderNotifAccess });
    return out;
  },
};
// …and on Linux: Media talks about the players there (MPRIS), General's clock doesn't start out as Windows'
const LINUX_ROWS = {
  media: (rows) => rows.map((r) => (r.t === 'lead' ? { ...r, html: _t('Works with the players your desktop’s media controls show (MPRIS): Spotify, VLC, Rhythmbox, Firefox, Chrome and more. Music shows on the <b>Home</b> tab and in the closed Sympony; it has no tab of its own.') } : r)),
  general: (rows) => rows.map((r) => (r.k === 'clock24h' ? { ...r, sub: '' } : r)),
};
const OS_ROWS = MAC ? MAC_ROWS : LINUX ? LINUX_ROWS : {};
if (OFF) {
  // the Bluetooth & Wi-Fi tab is the Speed test alone on a Mac and on Linux (modules/bluetooth.js)
  MODULE_META.bluetooth = ['gauge-high', _t('Speed test'), _t('Ping, download and upload, against Cloudflare’s speed test')];
  for (let i = SECTIONS.length - 1; i >= 0; i--) {
    const s = SECTIONS[i];
    if (OFF.pages.includes(s.id)) { SECTIONS.splice(i, 1); continue; }
    if (!s.rows) continue;
    if (OS_ROWS[s.id]) s.rows = OS_ROWS[s.id](s.rows);
    s.rows = s.rows.filter((r) => !OFF.keys.includes(r.k) && !OFF.rows.includes(r.render))
      // a heading left with nothing under it goes too
      .filter((r, j, rows) => r.t !== 'h2' || (rows[j + 1] && rows[j + 1].t !== 'h2'));
    for (const r of s.rows) {
      const off = OFF.options[r.k];
      const all = r.options;
      if (off) r.options = () => (typeof all === 'function' ? all() : all).filter(([v]) => !off.includes(v));
    }
  }
}

// ------------------------------------------------------------------ generic helpers
const getK = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), S);
function setK(k, v) {
  const parts = k.split('.');
  if (parts.length === 1) return api.setSettings({ [k]: v });
  const top = { ...(S[parts[0]] || {}) };
  top[parts[1]] = v;
  return api.setSettings({ [parts[0]]: top });
}

function rowHtml(r, i) {
  const lbl = `<span class="lbl">${r.label || ''}${r.sub ? `<small>${r.sub}</small>` : ''}</span>`;
  const v = getK(r.k || '');
  switch (r.t) {
    case 'h2': return `</div><h2>${r.text}</h2><div class="group">`;
    case 'lead': return `</div><p class="lead">${r.html}</p><div class="group">`;
    case 'toggle': return `<label class="row">${lbl}<input type="checkbox" data-i="${i}" ${v ? 'checked' : ''}></label>`;
    case 'range': return `<label class="row">${lbl}<span class="range"><input type="range" data-i="${i}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"><output>${v}</output>${r.unit}</span></label>`;
    case 'select': {
      const opts = typeof r.options === 'function' ? r.options() : r.options;
      return `<label class="row">${lbl}<select data-i="${i}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    }
    case 'text': return `<label class="row">${lbl}<input type="text" class="${r.cls || 'wide'}" data-i="${i}" value="${esc(v)}" placeholder="${esc(r.placeholder || '')}"></label>`;
    case 'time': return `<label class="row">${lbl}<input type="time" data-i="${i}" value="${esc(v)}"></label>`;
    // any whole number in min..max (e.g. seconds), with its unit after the box
    case 'number': return `<label class="row">${lbl}<span class="num"><input type="number" class="short" data-i="${i}" min="${r.min}" max="${r.max}" step="${r.step || 1}" value="${esc(v)}">${r.unit || ''}</span></label>`;
    case 'list': return `<label class="row">${lbl}<input type="text" class="wide" data-i="${i}" value="${esc((v || []).join(', '))}"></label>`;
    case 'custom': return `<div class="custom" data-i="${i}"></div>`;
    default: return '';
  }
}

function renderRows(sec, el) {
  el.innerHTML += `<div class="group">${sec.rows.map(rowHtml).join('')}</div>`;
  $$('.group', el).forEach((g) => { if (!g.children.length) g.remove(); });
  $$('[data-i]', el).forEach((input) => {
    const r = sec.rows[+input.dataset.i];
    if (r.t === 'custom') { r.render(input); return; }
    const commit = () => {
      let v;
      if (r.t === 'toggle') v = input.checked;
      else if (r.t === 'range') v = Number(input.value);
      else if (r.t === 'number') {
        const n = Math.round(Number(input.value));
        if (!Number.isFinite(n) || input.value === '') { input.value = getK(r.k); return; }
        v = Math.min(r.max, Math.max(r.min, n));
        if (String(v) !== input.value) input.value = v;
      } else if (r.t === 'list') v = input.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      else v = input.value;
      // a choice between numbers is saved as a number (main reads it as one; "30" read as 0 made every
      // standby delay act like 1 second)
      if (r.t === 'select') {
        const opts = typeof r.options === 'function' ? r.options() : r.options;
        if (opts.length && typeof opts[0][0] === 'number') v = Number(v);
      }
      if (r.k === 'display' && /^\d+$/.test(v)) v = Number(v);
      setK(r.k, v);
    };
    if (r.t === 'range') input.addEventListener('input', () => { input.parentElement.querySelector('output').textContent = input.value; commit(); });
    else input.addEventListener('change', commit);
  });
}

function show(id) {
  // "pomodoro/timer": the page, scrolled to a spot on it (the Pomodoro tab's pencil opens the Timer rows)
  const [secId, spot] = String(id || '').split('/');
  const sec = SECTIONS.find((s) => s.id === secId) || SECTIONS.find((s) => s.id === 'general');
  current = sec.id;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.sec === sec.id));
  const main = $('#main');
  const scroll = main.scrollTop;
  const again = !!show.keepScroll; // (the same page drawn again for a setting: no entrance, same scroll)
  main.innerHTML = `<section class="${again ? '' : 'enter'}"><h1>${icon(sec.icon, sec.color)}${sec.title}</h1></section>`;
  const el = $('section', main);
  if (sec.render) sec.render(el); else renderRows(sec, el);
  if (again) main.scrollTop = scroll;
  show.keepScroll = false; // (after the page's renderers, which reuse what they asked for while it's set)
  if (spot) revealSpot(spot);
}
// the spot's heading at the top, its rows lit up for a moment
function revealSpot(spot) {
  setTimeout(() => {
    const el = $(`#main [data-spot="${spot}"]`);
    const group = el && el.closest('.group');
    if (!group) return;
    const h = group.previousElementSibling;
    (h && h.tagName === 'H2' ? h : group).scrollIntoView({ block: 'start' });
    $$('.row', group).forEach((r) => { r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1600); });
  }, 60);
}

// ------------------------------------------------------------------ search
// Every setting by its label and description, searched as you type. The pages drawn by hand get a few words
// of their own; common Indonesian words find the English labels too.
const SEARCH_WORDS = {
  general: 'color colour picker eyedropper pipette hex rgb hsl screen pixel ambil warna pipet',
  modules: 'tabs order default module remember last turn on off teleprompter prompter autocue script read camera naskah glance ringkas',
  calendar: 'google outlook icloud ical ics link feeds local events meeting reminder show calendar refresh',
  weather: 'city location unit celsius fahrenheit forecast show weather detect my location gps lokasi',
  prayer: 'prayer times reminders city kemenag regency method asr hanafi count down sound adhan subuh fajr dhuhr maghrib isha volume detect my location gps lokasi sunrise terbit syuruq syuruk',
  dropactions: 'drop actions shelf files convert compress image pdf share clipboard copy copied paste history pin remember salin tempel riwayat phone mobile qr code wi-fi wifi send receive hp ponsel kirim terima app launcher apps',
  snap: 'snap zones window layouts drag halves thirds',
  hud: 'volume brightness hud style panel caps num scroll lock keyboard indicator airplane microphone mic mute touchpad windows pop-up osd input language layout fullscreen full screen game games video',
  dock: 'search button find magnifier magnifying glass windows+s cari pencarian calendar date today day icon tanggal hari ini',
  effects: 'animation animations effects motion glow light outline border timer genie popup window minimize restore confetti celebrate karaoke lyrics swipe stack notifications bounce volume slide tabs shelf fly',
  wallpaper: 'wallpaper background desktop live moving animated video mp4 mkv webm picture image photo lively wallpaper engine fit fill stretch center pause fullscreen game battery latar belakang bergerak',
  ai: 'ai chat translate agent agents claude code codex antigravity gemini cursor opencode qwen hermes model share my day scheduled briefs web search',
  integrations: 'integration integrations connect hooks claude code paseo permission permissions allow deny question ask user hitl agent done notch request requests',
  aiusage: 'ai usage limits limit plan claude code codex openai anthropic session 5-hour weekly week reset quota percent ring warn warning pemakaian kuota batas',
  pomodoro: 'focus background sound noise white pink brown rain ocean waves sea wind fire fireplace ambient ambience music volume breaks',
  github: 'github token pull requests repositories',
  about: 'about version updates check install automatically data folder reset all settings backup restore export import move another new pc computer cadangan pindah',
};
const SYNONYMS = {
  suara: 'sound volume audio adhan', audio: 'sound volume', adzan: 'adhan', azan: 'adhan', jam: 'clock time', waktu: 'time',
  baterai: 'battery ring icon', gambar: 'picture image', karakter: 'character', pesawat: 'airplane', notifikasi: 'notification', notif: 'notification', sembunyi: 'hide', sembunyikan: 'hide', kursor: 'cursor', ukuran: 'size',
  warna: 'color colour', bahasa: 'language', cuaca: 'weather', sholat: 'prayer', salat: 'prayer', shalat: 'prayer', pengingat: 'reminder remind',
  minum: 'water', air: 'water', kalender: 'calendar', layar: 'display screen', tugas: 'todo task', catatan: 'notes', lirik: 'lyrics',
  musik: 'music media', lagu: 'music song lyrics', suhu: 'temperature', mulai: 'launch start', pintasan: 'shortcut', tombol: 'button shortcut',
  istirahat: 'break', mata: 'eye', kecerahan: 'brightness', jaringan: 'network wifi', taskbar: 'taskbar dock', otomatis: 'automatically auto',
  selesai: 'done', terlambat: 'late', telat: 'late', game: 'fps game', permainan: 'fps game',
  malam: 'night', hangat: 'warm warmer warmth', latar: 'wallpaper', terbenam: 'sunset', tampilan: 'look style',
  dunia: 'world', zona: 'zone time', kota: 'city', lonceng: 'chime bell', bel: 'chime bell', setiap: 'every', besar: 'large size', timezone: 'time zone',
  hujan: 'rain', ombak: 'ocean waves', laut: 'ocean sea', angin: 'wind', perapian: 'fireplace', derau: 'noise', fokus: 'focus',
};
const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
let searchIndex = null;
function buildSearchIndex() {
  const out = [];
  for (const s of SECTIONS) {
    if (!s.id) continue;
    out.push({ sec: s, label: s.title, sub: '', text: `${s.title} ${s.id} ${SEARCH_WORDS[s.id] || ''}` });
    let h2 = '';
    for (const r of s.rows || []) {
      if (r.t === 'h2') { h2 = r.text; continue; }
      if (!r.label) continue;
      out.push({ sec: s, label: plain(r.label), sub: plain(r.sub), text: [s.title, h2, plain(r.label), plain(r.sub), r.words ? r.words() : ''].join(' ') });
      // a row that holds several settings is found by each of their names too, and opens at that one (`part`)
      for (const [label, part] of r.also || []) out.push({ sec: s, label: plain(label), sub: plain(r.label), text: [s.title, h2, plain(label), plain(r.label)].join(' '), row: plain(r.label), part });
    }
  }
  return out;
}
function searchHits(q) {
  // each word (or one of its Indonesian→English matches) has to start a word somewhere: "cat" finds Cat Buddy,
  // not "notification"
  const re = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => [w, ...(SYNONYMS[w] || '').split(' ').filter(Boolean)].map(re));
  searchIndex = searchIndex || buildSearchIndex();
  return searchIndex.filter((e) => { const t = e.text.toLowerCase(); return words.every((alts) => alts.some((r) => r.test(t))); });
}
function showSearch(q) {
  const hits = searchHits(q).slice(0, 80);
  $$('#nav a').forEach((a) => a.classList.remove('active'));
  const main = $('#main');
  main.innerHTML = `<section><h1>${icon('magnifying-glass', '#8e8e93')}${_t('Search')}</h1>${hits.length
    ? `<div class="group">${hits.map((h, i) => `<a class="row search-hit" data-n="${i}"><span class="lbl">${esc(h.label)}<small>${esc(h.label === h.sec.title ? _t('Page') : h.sec.title)}${h.sub ? ' · ' + esc(h.sub.length > 150 ? h.sub.slice(0, 150) + '…' : h.sub) : ''}</small></span>${fa('chevron-right')}</a>`).join('')}</div>`
    : `<p class="lead">${_t('Nothing found for “{q}”. Try another word, in English or Indonesian.', { q: esc(q) })}</p>`}</section>`;
  main.scrollTop = 0;
  $$('.search-hit', main).forEach((a) => {
    a.onclick = () => {
      const h = hits[+a.dataset.n];
      $('#search').value = '';
      show.keepScroll = false;
      if (h.part) closedPart = h.part; // General → Closed Sympony: that part's choices open
      show(h.sec.id);
      if (h.label !== h.sec.title) revealRow(h.row || h.label);
    };
  });
}
// scroll to a setting on its page and light it up for a moment
function revealRow(label) {
  setTimeout(() => {
    const lbl = $$('#main .row .lbl').find((l) => plain(l.firstChild ? l.firstChild.textContent : '') === label);
    const row = lbl && lbl.closest('.row');
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1600);
  }, 60);
}
function initSearch() {
  const box = $('#search');
  box.addEventListener('input', () => { const q = box.value.trim(); if (q) showSearch(q); else { show.keepScroll = false; show(current); } });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { box.value = ''; show.keepScroll = false; show(current); }
    if (e.key === 'Enter') { const first = $('#main .search-hit'); if (first) first.click(); }
  });
}

function buildNav() {
  $('#nav').innerHTML = SECTIONS.map((s) => (s.group !== undefined
    ? (s.group ? `<div class="nav-group">${s.group}</div>` : '<div style="height:10px"></div>')
    : `<a data-sec="${s.id}">${icon(s.icon, s.color)}${s.title}</a>`)).join('');
  $$('#nav a').forEach((a) => { a.onclick = () => { show.keepScroll = false; show(a.dataset.sec); }; });
}

// ponytail: macOS WebKit doesn't focus a range input on click, so the activeElement checks below never saw a drag
// there: every step re-rendered the page under the pointer and the slider couldn't be dragged. Track the drag itself.
let rangeDrag = false;
document.addEventListener('pointerdown', (e) => { if (e.target.type === 'range') rangeDrag = true; }, true);
const rangeDone = () => { if (rangeDrag) { rangeDrag = false; refresh(); } };
document.addEventListener('pointerup', rangeDone, true);
document.addEventListener('pointercancel', rangeDone, true);

// Re-render the current section after a settings change without losing scroll or focus.
function refresh() {
  if (rangeDrag) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' && ['text', 'password', 'time', 'range'].includes(active.type))) return;
  // search results stay up (with what changed)
  const q = $('#search') && $('#search').value.trim();
  if (q) { showSearch(q); return; }
  // keep anything typed in a key field that hasn't been saved yet
  const typed = $$('input[type=password]').filter((i) => i.id && i.value).map((i) => [i.id, i.value]);
  show.keepScroll = true;
  show(current);
  typed.forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
}

// ------------------------------------------------------------------ cursor (preview, or the pack's folder)
let cursorThemeSeen = null;

async function renderCursor(el) {
  const theme = S.cursorTheme || 'off';
  const justPicked = cursorThemeSeen !== null && cursorThemeSeen !== theme;
  cursorThemeSeen = theme;
  if (theme === 'off' || !window.SymponyCursors) { el.innerHTML = ''; return; }
  const PC = window.SymponyCursors;
  const on = new Set(Array.isArray(S.cursorRoles) ? S.cursorRoles : PC.ROLES);
  let pack = null;
  if (theme === 'custom') {
    el.innerHTML = `<div class="row"><span class="lbl">${_t('Cursor pack')}<small id="cursorPackInfo">${S.cursorPack ? esc(S.cursorPack) : _t('A folder with .cur or .ani files (most packs come as a .zip: unzip it first). Sympony matches them by the pack’s install.inf, or by names like Normal, Link, Text, Busy. A pack’s pointers are as big as Windows’ own; the Size slider is for Sympony’s sets.')}</small></span>
      <button class="btn" id="cursorPick">${fa('folder-open')} ${_t('Choose folder…')}</button></div>`;
    $('#cursorPick', el).onclick = async () => {
      const r = await api.svc('cursor', 'pick');
      if (r && r.ok === false) $('#cursorPackInfo', el).textContent = r.message;
    };
    if (!S.cursorPack) {
      // picked "My own cursor pack" without a folder yet: ask for it right away
      if (justPicked) $('#cursorPick', el).click();
      return;
    }
    pack = await api.svc('cursor', 'pack', S.cursorPack).catch(() => null);
    const info = $('#cursorPackInfo', el);
    if (pack && info) info.textContent = `${S.cursorPack} · ${_t('{n} of {total} pointers found', { n: pack.count, total: pack.of })} · ${_t('A pack’s pointers are as big as Windows’ own')}`;
  }
  // which pointers Sympony replaces; the others keep Windows' look
  const pics = theme === 'custom' ? null : Object.fromEntries(PC.previews(theme).map((p) => [p.role, p.url]));
  const tiles = PC.ROLES.map((role) => {
    const missing = pack && !(pack.roles || []).includes(role);
    const state = missing ? _t('Not in the pack') : on.has(role) ? (pics ? 'Sympony' : _t('From the pack')) : 'Windows';
    const pic = pics ? `<span class="cr-pics"><span class="light"><img src="${pics[role]}" alt=""></span><span class="dark"><img src="${pics[role]}" alt=""></span></span>` : '';
    return `<button class="cur-role ${on.has(role) && !missing ? 'on' : ''}" data-role="${role}" ${missing ? 'disabled' : ''}>${pic}<span class="cr-name">${PC.NAMES[role]}</span><small>${state}</small></button>`;
  }).join('');
  el.insertAdjacentHTML('beforeend', `<div class="row cursor-preview"><span class="lbl">${_t('Which pointers')}<small>${pics ? _t('Click one to keep Windows’ own look for it (or to give it back to Sympony).') : _t('Click one to keep Windows’ own look for it (or to give it back to the pack).')}<span id="cursorWinSize"></span></small></span></div><div class="cursor-roles">${tiles}</div>`);
  $$('.cur-role', el).forEach((b) => {
    b.onclick = () => {
      const r = b.dataset.role;
      if (on.has(r)) on.delete(r); else on.add(r);
      const list = PC.ROLES.filter((x) => on.has(x));
      api.setSettings({ cursorRoles: list.length === PC.ROLES.length ? null : list });
    };
  });
  const w = await api.svc('cursor', 'info').catch(() => null);
  const ws = $('#cursorWinSize', el);
  if (w && ws) ws.textContent = ` ${_t('Windows draws pointers at {n} px on this PC.', { n: w.windowsSize })}`;
}

// ------------------------------------------------------------------ scheduled briefs (in AI Chat & Translate)
// each day's first letter, taken from its name in Sympony's language
const BRIEF_DAYS = [_t('Sunday'), _t('Monday'), _t('Tuesday'), _t('Wednesday'), _t('Thursday'), _t('Friday'), _t('Saturday')].map((name) => [name.charAt(0).toUpperCase(), name]);
function renderBriefs(box) {
  const list = (S.chatBriefs || []).map((b) => ({ ...b, days: [...(b.days || [])] }));
  const save = () => api.setSettings({ chatBriefs: list });
  box.innerHTML = list.map((b, i) => `<div class="row brief" data-i="${i}">
      <div class="brief-top">
        <input type="checkbox" data-k="on" title="${_t('On')}" ${b.on !== false ? 'checked' : ''}>
        <input type="time" data-k="time" value="${esc(b.time || '07:30')}">
        <span class="brief-days">${BRIEF_DAYS.map(([d, name], n) => `<button class="day ${b.days.includes(n) ? 'on' : ''}" data-day="${n}" title="${name}">${d}</button>`).join('')}</span>
        <span class="brief-btns"><button class="btn" data-send title="${_t('Ask it now')}">${fa('paper-plane')} ${_t('Try')}</button><button class="btn danger" data-del title="${_t('Remove')}">${fa('trash-can')}</button></span>
      </div>
      <input type="text" class="brief-text" data-k="text" placeholder="${_t('What to ask, e.g. Brief me on today')}" value="${esc(b.text || '')}">
    </div>`).join('') + `<div class="row"><span class="lbl">${list.length ? _t('Another one, e.g. a wrap-up in the evening') : _t('A brief every morning, a wrap-up in the evening…')}</span><button class="btn" id="briefAdd">${fa('plus')} ${_t('Add a brief')}</button></div>`;
  $$('.brief', box).forEach((row) => {
    const b = list[+row.dataset.i];
    $('[data-k=on]', row).onchange = (e) => { b.on = e.target.checked; save(); };
    $('[data-k=time]', row).onchange = (e) => { if (e.target.value) { b.time = e.target.value; save(); } };
    $('[data-k=text]', row).onchange = (e) => { b.text = e.target.value.trim(); save(); };
    $$('.day', row).forEach((d) => {
      d.onclick = () => {
        const n = +d.dataset.day;
        b.days = b.days.includes(n) ? b.days.filter((x) => x !== n) : [...b.days, n].sort();
        save();
      };
    });
    $('[data-send]', row).onclick = () => { const t = $('[data-k=text]', row).value.trim(); if (t) api.svc('brief', 'now', t); };
    $('[data-del]', row).onclick = () => { list.splice(+row.dataset.i, 1); save(); };
  });
  $('#briefAdd', box).onclick = () => {
    list.push({ id: Date.now().toString(36), on: true, time: list.length ? '18:00' : '07:30', days: [1, 2, 3, 4, 5],
      text: list.length ? 'Wrap up my day: what got done, what is still open, and what is on tomorrow.' : 'Brief me on today: my events, open todos, the weather and prayer times. Short and friendly.' });
    save();
  };
}

// ------------------------------------------------------------------ custom sections
// General → Language (i18n.rs): English and Bahasa Indonesia are built in; another language is downloaded the first
// time it’s picked (“Downloading…” here, then Sympony restarts in it; if that fails, the language stays as it was). A
// language Sympony is waiting for (Same as Windows, or its file gone) says how that stands, with a way on.
let langState = null; // main’s view (lang.state); the last one shows until a fresh one comes
let langPick = null;  // a pick here: { code, value, busy } while it downloads, { …, error, missing } if that failed, { …, saved } once saved
async function renderLanguage(el) {
  const row = SECTIONS.find((s) => s.id === 'general').rows.find((r) => r.render === renderLanguage);
  const draw = () => {
    const st = langState || { using: window.SYMPONY_LANG || 'en', langs: (window.SYMPONY_LANGS || []).map(([code, name, have]) => ({ code, name, have: have !== false })) };
    const lang = (c) => st.langs.find((l) => l.code === c) || { code: c, name: c, have: true };
    const why = (x) => (x.missing ? _t('it isn’t available for this version yet') : x.error);
    const busy = !!(langPick && langPick.busy);
    let sub = row.sub; let act = '';
    if (busy) sub = `${fa('spinner fa-spin')} ${_t('Downloading {lang}…', { lang: esc(lang(langPick.code).name) })}`;
    else if (langPick && langPick.saved) sub = row.sub; // (saved: Sympony restarts in a moment)
    else if (langPick) sub = `<span style="color:#ff453a">${_t('Couldn’t download {lang} ({error}). The language stays as it was.', { lang: esc(lang(langPick.code).name), error: esc(why(langPick)) })}</span>`;
    else if (st.want && st.want !== st.using) {
      // waiting for a language: downloaded since the start (shown from the next one), on its way, or not here yet
      const w = lang(st.want); const job = st.job && st.job.code === st.want ? st.job : {};
      if (w.have) {
        sub = _t('{lang} is downloaded. Sympony shows it from the next start.', { lang: esc(w.name) });
        act = `<button class="btn primary" data-langact="restart">${fa('rotate')} ${_t('Restart now')}</button>`;
      } else if (job.state === 'downloading') sub = `${fa('spinner fa-spin')} ${_t('Downloading {lang}…', { lang: esc(w.name) })}`;
      else {
        sub = job.state === 'failed' ? _t('Couldn’t download {lang} ({error}). Sympony shows English for now and tries again later.', { lang: esc(w.name), error: esc(why(job)) })
          : _t('{lang} isn’t downloaded yet. Sympony shows English until it is.', { lang: esc(w.name) });
        act = `<button class="btn" data-langact="get">${fa('download')} ${_t('Download')}</button>`;
      }
    }
    const value = busy ? langPick.value : (S.language || 'auto');
    const opts = [['auto', MAC || LINUX ? _t('Same as the system') : _t('Same as Windows')], ['en', 'English'], ...st.langs.map((l) => [l.code, l.have ? l.name : _t('{lang} (download)', { lang: l.name })])];
    // (the line under it, as the other rows: alone in its box, it's the box's last child)
    el.innerHTML = `<div class="row" style="border-bottom:1px solid var(--line)"><span class="lbl">${row.label}<small>${sub}</small></span>
      <span style="display:flex;gap:6px;align-items:center">${act}<select id="langSel" ${busy ? 'disabled' : ''}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></span></div>`;
    $('#langSel', el).onchange = (e) => pickLanguage(e.target.value);
    $$('[data-langact]', el).forEach((b) => { b.onclick = () => (b.dataset.langact === 'restart' ? api.svc('lang', 'restart') : pickLanguage(S.language || 'auto')); });
  };
  draw();
  const st = await api.svc('lang', 'state').catch(() => null);
  if (st && st.langs) langState = st;
  if (el.isConnected) draw();
}
// A language picked (or Download): fetched first when it isn’t here, then saved, which restarts Sympony. Picked
// again as it was (Download), it waits for the restart button.
async function pickLanguage(v) {
  if (langPick && langPick.busy) return;
  const st = langState || {};
  const target = v === 'auto' ? st.windows : v;
  const l = (st.langs || []).find((x) => x.code === target);
  langPick = l && !l.have ? { code: target, value: v, busy: true } : null;
  if (langPick) refresh();
  const r = await api.svc('lang', 'prepare', v).catch((e) => ({ ok: false, error: String(e) }));
  langPick = r && r.ok ? null : { code: (r && r.code) || target, value: v, missing: !!(r && r.missing), error: (r && r.error) || '' };
  const fresh = await api.svc('lang', 'state').catch(() => null);
  if (fresh && fresh.langs) langState = fresh;
  if (!langPick && v !== (S.language || 'auto')) { langPick = { code: target, value: v, saved: true }; setK('language', v); } else refresh();
}
// the quiet download at start has news (main tells an open Settings)
api.on('lang', (s) => { if (s && s.langs) { langState = s; if (current === 'general') refresh(); } });

// General → "Auto-hide while these apps are in front": the chosen apps (saved as exe names) as chips, and the
// apps open now to add one from (the last list shows until a fresh one comes, so the page doesn't flicker)
let ahOpen = null;
async function renderAutoHideApps(el) {
  const list = (S.autoHideApps || []).map((x) => String(x).toLowerCase());
  const save = (l) => api.setSettings({ autoHideApps: l });
  const draw = (open) => {
    const name = (exe) => ((open || []).find((a) => a.exe === exe) || {}).name || exe;
    const add = (open || []).filter((a) => !list.includes(a.exe)).sort((a, b) => a.name.localeCompare(b.name));
    const opts = !open ? `<option disabled>${_t('Looking for open apps…')}</option>`
      : add.length ? add.map((a) => `<option value="${esc(a.exe)}">${esc(a.name)}</option>`).join('') : `<option disabled>${_t('No other apps are open')}</option>`;
    el.innerHTML = `<div class="row ah-row"><span class="lbl">${_t('Auto-hide while these apps are in front')}<small>${_t('While one of them is in front on a display, Sympony on that display waits above the top edge as with Auto-hide (so the app’s tabs and title bar are free) and comes back when another app is in front there. Each display decides for itself, whichever one you’re using. Pick from the apps open now.')}</small></span>
      <select id="ahAdd"><option value="">${_t('Add…')}</option>${opts}</select></div>`
      + (list.length ? `<div class="ah-apps">${list.map((exe) => `<span class="ah-chip" title="${esc(exe)}">${esc(name(exe))}<button data-rm="${esc(exe)}" title="${_t('Remove')}">${fa('xmark')}</button></span>`).join('')}</div>` : '');
    $('#ahAdd', el).onchange = (e) => { if (e.target.value) save([...list, e.target.value]); };
    $$('[data-rm]', el).forEach((b) => { b.onclick = () => save(list.filter((x) => x !== b.dataset.rm)); });
  };
  draw(ahOpen);
  const open = await api.svc('apps', 'open').catch(() => []);
  ahOpen = Array.isArray(open) ? open : [];
  if (el.isConnected) draw(ahOpen);
}

// Pomodoro → Timer → Presets (`timerPresets`): the lengths under the Timer's wheel, each a chip with an × under the
// row, and a box to add one. Whole minutes from 1 to 600, each once, shortest first, at most 8 (as the tab reads them).
const cleanPresets = (l) => [...new Set((Array.isArray(l) ? l : []).map((m) => Math.round(Number(m))).filter((m) => m >= 1 && m <= 600))]
  .sort((a, b) => a - b).slice(0, 8);
function renderTimerPresets(el) {
  const row = SECTIONS.find((s) => s.id === 'pomodoro').rows.find((r) => r.render === renderTimerPresets);
  const list = cleanPresets(S.timerPresets);
  const full = list.length >= 8;
  const save = (l) => api.setSettings({ timerPresets: cleanPresets(l) });
  el.dataset.spot = 'timer'; // Settings opened from the tab's pencil scrolls here
  el.innerHTML = `<div class="row ah-row"><span class="lbl">${row.label}<small>${full ? _t('Up to 8. Remove one to add another.') : row.sub}</small></span>
    ${full ? '' : `<span class="num"><input type="number" class="short" id="tpAdd" min="1" max="600" step="1" placeholder="45">${_t('min')}<button class="btn sm" id="tpAddBtn">${fa('plus')} ${_t('Add')}</button></span>`}</div>`
    + (list.length ? `<div class="ah-apps">${list.map((m) => `<span class="ah-chip tp-chip" data-v="${m}">${_t('{n} min', { n: m })}<button class="tp-x" data-rm="${m}" title="${_t('Remove')}">${fa('xmark')}</button></span>`).join('')}</div>` : '');
  $$('[data-rm]', el).forEach((b) => { b.onclick = () => save(list.filter((m) => m !== +b.dataset.rm)); });
  if (full) return;
  const add = () => {
    const box = $('#tpAdd', el);
    const v = Math.round(Number(box.value));
    if (box.value === '' || !Number.isFinite(v)) return;
    save([...list, Math.min(600, Math.max(1, v))]);
  };
  $('#tpAdd', el).onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $('#tpAddBtn', el).onclick = add;
}

// General → "Different gap for these apps" (`notchTopGapApps`, [{ exe, gap }]): under Gap from the top edge, each
// chosen app with a gap of its own, and the apps open now to add one from (the same last look as the auto-hide list)
async function renderGapApps(el) {
  const row = SECTIONS.find((s) => s.id === 'general').rows.find((r) => r.render === renderGapApps);
  const list = (Array.isArray(S.notchTopGapApps) ? S.notchTopGapApps : []).filter((a) => a && a.exe)
    .map((a) => ({ exe: String(a.exe).toLowerCase(), gap: Math.max(0, Math.min(120, Number(a.gap) || 0)) }));
  const save = (l) => api.setSettings({ notchTopGapApps: l });
  const draw = (open) => {
    const name = (exe) => ((open || []).find((a) => a.exe === exe) || {}).name || exe;
    const add = (open || []).filter((a) => !list.some((x) => x.exe === a.exe)).sort((a, b) => a.name.localeCompare(b.name));
    const opts = !open ? `<option disabled>${_t('Looking for open apps…')}</option>`
      : add.length ? add.map((a) => `<option value="${esc(a.exe)}">${esc(a.name)}</option>`).join('') : `<option disabled>${_t('No other apps are open')}</option>`;
    el.innerHTML = `<div class="row${list.length ? ' ah-row' : ''}"><span class="lbl">${row.label}<small>${row.sub}</small></span>
      <select id="gapAdd"><option value="">${_t('Add…')}</option>${opts}</select></div>`
      + list.map((a, i) => `<div class="row" style="padding-left:28px"><span class="lbl">${esc(name(a.exe))}<small>${esc(a.exe)}</small></span>
        <span class="range"><input type="range" data-gi="${i}" min="0" max="120" step="2" value="${a.gap}"><output>${a.gap}</output>px
        <button class="btn sm" data-grm="${i}" title="${_t('Remove')}">${fa('xmark')}</button></span></div>`).join('');
    // a new one starts attached to the edge when Sympony floats, else floating a little
    $('#gapAdd', el).onchange = (e) => { if (e.target.value) save([...list, { exe: e.target.value, gap: Number(S.notchTopGap) > 0 ? 0 : 12 }]); };
    $$('[data-gi]', el).forEach((r) => {
      r.addEventListener('input', () => { list[+r.dataset.gi].gap = Number(r.value); r.nextElementSibling.textContent = r.value; save(list.map((x) => ({ ...x }))); });
    });
    $$('[data-grm]', el).forEach((b) => { b.onclick = () => save(list.filter((_, i) => i !== +b.dataset.grm)); });
  };
  draw(ahOpen);
  const open = await api.svc('apps', 'open').catch(() => []);
  ahOpen = Array.isArray(open) ? open : [];
  // not while one of the sliders is being dragged
  const busy = rangeDrag || (document.activeElement && document.activeElement.type === 'range' && el.contains(document.activeElement));
  if (el.isConnected && !busy) draw(ahOpen);
}

function renderPosition(el) {
  const pct = Math.round((S.notchPosition ?? 0.5) * 100);
  el.innerHTML = `<div class="row"><span class="lbl">${_t('Position along the top')}<small>${_t('Or just drag Sympony left/right (when it’s open: drag its top bar). It snaps to the centre.')}</small></span>
    <span class="range" dir="ltr"><span style="display:flex;gap:4px">
      <button class="btn sm" data-pos="0.06" title="${_t('Left')}">${fa('align-left')}</button><button class="btn sm" data-pos="0.5" title="${_t('Centre')}">${fa('align-center')}</button><button class="btn sm" data-pos="0.94" title="${_t('Right')}">${fa('align-right')}</button></span>
      <input type="range" min="0" max="100" step="1" value="${pct}" id="posRange" style="width:150px"><output>${pct}%</output></span></div>`;
  $$('[data-pos]', el).forEach((b) => { b.onclick = () => api.setSettings({ notchPosition: Number(b.dataset.pos) }); });
  const r = $('#posRange', el);
  r.addEventListener('input', () => { r.nextElementSibling.textContent = r.value + '%'; api.setSettings({ notchPosition: Number(r.value) / 100 }); });
}

// General → Closed Sympony (`idleLeft`, `idleClock` with `clockSize`, `idleRight`): the closed Sympony drawn as it looks, black
// at its Height, each part with its icon and a made-up value. Its left, middle and right are buttons: a click opens that
// part's choices as tiles under it (the picked one lit), a click on it again closes them. The search opens a part by the
// name it had as a row of its own (the row's `also`).
let closedPart = null; // 'left', 'middle' or 'right': whose tiles show
let closedFocus = null; // { f, until }: the button to focus again once the page is drawn anew after a pick
const SLOT_ICONS = { none: 'ban', off: 'ban', weather: 'cloud-sun', battery: 'battery-three-quarters', date: 'calendar-day', prayer: 'mosque', event: 'calendar-check',
  todo: 'list-check', time: 'clock', temp: 'temperature-half', cpu: 'microchip', ram: 'memory', disk: 'hard-drive', wifi: 'wifi',
  net: 'arrows-up-down', netDown: 'arrow-down', netUp: 'arrow-up', world: 'earth-americas' };
const CLOCK_MODES = [['time', _t('Time')], ['date', _t('Day and time')], ['off', _t('Nothing')]];
const CLOCK_SIZES = [['small', 'S', _t('Small')], ['normal', 'M', _t('Normal')], ['large', 'L', _t('Large')], ['xlarge', 'XL', _t('Extra large')]];
const slotIcon = (v) => `<i class="fa-solid fa-${SLOT_ICONS[v] || 'circle'}"${{ netDown: ' style="color:#30d158"', netUp: ' style="color:#ff9f0a"' }[v] || ''}></i>`;
// what a side shows in the preview: about what the closed Sympony shows there, with made-up numbers (the date, the time
// and the world clock's are today's)
function slotSample(kind) {
  const h24 = S.clock24h !== false;
  const hm = (d) => d.toLocaleTimeString(_tLocale(), { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12' });
  const at = (h, m) => hm(new Date(2026, 0, 1, h, m));
  // (with its unit after it, as the closed Sympony writes it: out on one line, a letter in two)
  const net = (down, v, unit) => `<span class="cn-net ${down ? 'dn' : 'up'}"><b>${down ? '↓' : '↑'}</b>${v}<small>${unit}</small></span>`;
  switch (kind) {
    case 'weather': return `${slotIcon(kind)}<b>31°</b>`;
    case 'battery': return `${S.showBatteryPercent ? '<b>66%</b>' : ''}<span class="cn-batt"><i></i></span>`;
    case 'date': return `<b>${esc(new Date().toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric' }))}</b>`;
    case 'prayer': return `<b>${_t('Asr')}</b><em>${at(15, 12)}</em>`;
    case 'event': return `${slotIcon(kind)}<em>${at(14, 30)}</em>`;
    case 'todo': return `${slotIcon(kind)}<em>${at(16, 0)}</em>`;
    case 'time': return `<b>${hm(new Date())}</b>`;
    case 'temp': return `<i class="fa-solid fa-temperature-half" style="color:#30d158"></i><b>48°</b>`;
    case 'cpu': return '<em>CPU</em><b>23%</b>';
    case 'ram': return '<em>RAM</em><b>54%</b>';
    case 'disk': return `<em>${_t('Disk')}</em><b>61%</b>`;
    case 'wifi': return '<em>Wi-Fi</em><b>82%</b>';
    case 'net': return `<span class="cn-net2">${net(true, '24', 'M')}${net(false, '640', 'K')}</span>`;
    case 'netDown': return net(true, '24', 'Mbps');
    case 'netUp': return net(false, '640', 'Kbps');
    case 'world': {
      const p = window.SymponyClock && SymponyClock.places(S)[0];
      return p ? `<em>${esc(p.name)}</em><b>${esc(SymponyClock.time(p.tz, Date.now(), h24))}</b>` : slotIcon(kind);
    }
    default: return '';
  }
}
function renderClosedSlots(el) {
  const row = SECTIONS.find((s) => s.id === 'general').rows.find((r) => r.render === renderClosedSlots);
  const mode = S.idleClock || 'time';
  const size = S.clockSize || 'normal';
  // the closed Sympony's Height, and its time's size from it as notch.js clockFont() works it out
  const h = Math.max(26, Math.min(44, Number(S.notchHeight) || 32));
  const k = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 }[size] || 1;
  const base = Math.max(10, Math.min(14, h * 0.38));
  const fs = k > 1 ? Math.round(Math.min(h * 0.7, Math.max(10, h * 0.38) * k) * 4) / 4 : k < 1 ? Math.max(9, Math.round(base * k * 4) / 4) : base;
  const clock = mode === 'off' ? '' : (mode === 'date' ? `<em>${esc(new Date().toLocaleDateString(_tLocale(), { weekday: 'short', day: 'numeric' }))}</em>` : '') + slotSample('time');
  const PARTS = { left: [_t('Left side'), slotSample(S.idleLeft)], middle: [_t('Middle'), clock], right: [_t('Right side'), slotSample(S.idleRight)] };
  const part = (p) => `<button type="button" class="cn-part cn-${p}${closedPart === p ? ' on' : ''}${PARTS[p][1] ? '' : ' empty'}" data-part="${p}" data-f="part:${p}"
    title="${PARTS[p][0]}" aria-expanded="${closedPart === p}">${PARTS[p][1] || fa('plus')}</button>`;
  const cur = { idleLeft: S.idleLeft || 'none', idleRight: S.idleRight || 'none', idleClock: mode, clockSize: size };
  const tile = (key, v, label) => `<button type="button" class="cn-tile${cur[key] === v ? ' on' : ''}" data-ck="${key}" data-v="${esc(v)}" data-f="${key}:${esc(v)}"
    aria-pressed="${cur[key] === v}">${slotIcon(v)}<span>${esc(label)}</span></button>`;
  let pick = '';
  if (closedPart === 'middle') {
    pick = `<div class="cn-tiles">${CLOCK_MODES.map(([v, l]) => tile('idleClock', v, l)).join('')}</div>
      <div class="cn-size"><span class="lbl">${_t('Clock size')}<small>${_t('The time in the middle. It grows with the Height below; Large and Extra large make Sympony a little wider where they need the room.')}</small></span>
      <span class="cn-seg">${CLOCK_SIZES.map(([v, l, title]) => `<button type="button" class="${size === v ? 'on' : ''}" data-ck="clockSize" data-v="${v}" data-f="clockSize:${v}" title="${title}" aria-pressed="${size === v}"${mode === 'off' ? ' disabled' : ''}>${l}</button>`).join('')}</span></div>`;
  } else if (closedPart) {
    const key = closedPart === 'left' ? 'idleLeft' : 'idleRight';
    pick = `<div class="cn-tiles">${slotOptions(key).map(([v, l]) => tile(key, v, l)).join('')}</div>`;
  }
  el.innerHTML = `<div class="row cn-row"><span class="lbl">${row.label}<small>${row.sub}</small></span>
    <div class="cn-stage" dir="ltr"><div class="cn-notch" style="--h:${h}px;--fs:${fs}px">${part('left')}${part('middle')}${part('right')}</div></div>
    ${closedPart ? `<div class="cn-pick"><b class="cn-for">${PARTS[closedPart][0]}</b>${pick}</div>` : `<small class="cn-hint">${_t('Click the left, middle or right part, then pick what it shows.')}</small>`}</div>`;
  $$('.cn-part', el).forEach((b) => {
    b.onclick = () => { closedPart = closedPart === b.dataset.part ? null : b.dataset.part; closedFocus = { f: b.dataset.f, until: Date.now() + 1500 }; renderClosedSlots(el); };
  });
  $$('[data-ck]', el).forEach((b) => {
    b.onclick = () => {
      if (cur[b.dataset.ck] === b.dataset.v) return;
      closedFocus = { f: b.dataset.f, until: Date.now() + 1500 };
      api.setSettings({ [b.dataset.ck]: b.dataset.v });
    };
  });
  // the arrow keys move between the parts, and between the tiles (up and down: the tile above or below)
  const arrows = (box, sel) => box && box.addEventListener('keydown', (e) => {
    const list = $$(sel, box).filter((b) => !b.disabled);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const back = getComputedStyle(box).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const cols = list.filter((b) => b.offsetTop === list[0].offsetTop).length;
    const j = { [back]: i - 1, [back === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft']: i + 1, ArrowUp: i - cols, ArrowDown: i + cols, Home: 0, End: list.length - 1 }[e.key];
    if (j == null || j < 0 || j >= list.length) return;
    e.preventDefault();
    list[j].focus();
  });
  arrows($('.cn-notch', el), '.cn-part');
  arrows($('.cn-tiles', el), '.cn-tile');
  arrows($('.cn-seg', el), 'button');
  if (closedFocus && closedFocus.until > Date.now()) { const f = $$('[data-f]', el).find((b) => b.dataset.f === closedFocus.f); if (f) f.focus({ preventScroll: true }); }
  closedFocus = null;
}

// General → Look → Color: a few to pick, or any other with the picker (saved once the picker closes: the page is
// drawn again on every change, which would close it)
const NOTCH_COLORS = [['#1c2b4d', _t('Navy')], ['#3b1f5e', _t('Plum')], ['#0f4a46', _t('Teal')], ['#5c1a24', _t('Wine')], ['#2c2c2e', _t('Graphite')], ['#f2f2f7', _t('White')], ['#f6c1d0', _t('Pink')], ['#ffd166', _t('Sun|color')]];
function renderNotchColor(el) {
  if (S.notchLook !== 'color') { el.innerHTML = ''; return; }
  const cur = /^#[0-9a-f]{6}$/i.test(S.notchColor || '') ? S.notchColor.toLowerCase() : '#1c2b4d';
  const dot = ([c, n]) => `<button type="button" data-color="${c}" title="${n}" style="width:22px;height:22px;padding:0;border:0;border-radius:50%;cursor:pointer;background:${c};box-shadow:${c === cur ? '0 0 0 2px var(--panel), 0 0 0 4px var(--accent)' : 'inset 0 0 0 1px rgba(255,255,255,0.2)'}"></button>`;
  el.innerHTML = `<div class="row"><span class="lbl">${_t('Color')}<small>${_t('Pick one, or any color with the last button')}</small></span>
    <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">${NOTCH_COLORS.map(dot).join('')}<input type="color" id="notchColorPick" value="${cur}" title="${_t('Any color')}"></span></div>`;
  $$('[data-color]', el).forEach((b) => { b.onclick = () => api.setSettings({ notchColor: b.dataset.color }); });
  $('#notchColorPick', el).addEventListener('change', (e) => api.setSettings({ notchColor: e.target.value }));
}

// Dock: its pinned apps can be copied from the taskbar (same apps, same order)
function renderDockPins(el) {
  el.innerHTML = `<div class="row"><span class="lbl">${_t('Pinned apps')}<small>${_t('Make the Dock’s pinned apps the same as the taskbar’s, in the same order. This replaces the ones in the Dock now.')}</small></span>
    <button class="btn" id="dockFromTaskbar">${fa('thumbtack')} ${_t('Copy from the taskbar')}</button></div>`;
  const b = $('#dockFromTaskbar', el);
  b.onclick = async () => {
    b.disabled = true;
    const n = await api.svc('dock', 'fromTaskbar').catch(() => 0);
    b.innerHTML = n ? `${fa('check')} ${_t('Copied {n} apps', { n })}` : `${fa('circle-exclamation')} ${_t('No pinned apps found')}`;
    setTimeout(() => { b.disabled = false; b.innerHTML = `${fa('thumbtack')} ${_t('Copy from the taskbar')}`; }, 2500);
  };
}

// Dock → Style (`dockStyle`): six looks, each with a small preview of the bar over a colourful wallpaper. Dark
// and Glass, saved before there were five, are Black and Frosted Glass. Wallpaper color's preview takes the colour
// main takes from the wallpaper (kept for the next time the page is drawn).
let dockWallPrev = '#3a3a3c';
function renderDockStyle(el) {
  const looks = [
    ['black', _t('Black'), 'background:linear-gradient(180deg,#36363e,#1c1c22);border-color:rgba(255,255,255,.18)'],
    ['white', _t('White'), 'background:linear-gradient(180deg,#fdfdfe,#e6e6eb);border-color:rgba(0,0,0,.12)'],
    ['clear', _t('Clear Glass'), 'background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.05));border-color:rgba(255,255,255,.7);box-shadow:inset 0 0 6px rgba(255,255,255,.3)'],
    ['frosted', _t('Frosted Glass'), 'background:rgba(36,36,44,.4);border-color:rgba(255,255,255,.35);backdrop-filter:blur(5px)'],
    ['midnight', _t('Midnight'), 'background:linear-gradient(180deg,#1c2746,#0b1124);border-color:rgba(130,160,255,.35)'],
    // (in the colour main takes from the wallpaper, the primary display's, once it comes)
    ['wallpaper', _t('Wallpaper color'), `background:${dockWallPrev};border-color:rgba(255,255,255,.2)`],
  ];
  const cur = { dark: 'black', glass: 'frosted' }[S.dockStyle] || (looks.some(([k]) => k === S.dockStyle) ? S.dockStyle : 'black');
  const row = SECTIONS.find((s) => s.id === 'dock').rows.find((r) => r.render === renderDockStyle);
  const dots = ['#ff9f0a', '#30d158', '#0a84ff'].map((c) => `<i style="width:9px;height:9px;border-radius:2.5px;background:${c}"></i>`).join('');
  el.innerHTML = `<div class="row cursor-preview"><span class="lbl">${_t('Style')}<small>${row.sub}</small></span></div>
    <div class="cursor-roles" style="grid-template-columns:repeat(6,minmax(0,1fr))">${looks.map(([k, name, bar]) => `<button class="cur-role ${k === cur ? 'on' : ''}" data-look="${k}">
      <span style="display:flex;align-items:flex-end;justify-content:center;width:100%;max-width:88px;height:42px;padding-bottom:5px;border-radius:7px;background:linear-gradient(135deg,#2f6fd6,#9b4dca 50%,#f0a030)">
        <span style="display:flex;gap:4px;padding:4px 7px;border-radius:6px;border:1px solid;${bar}">${dots}</span></span>
      <span class="cr-name">${name}</span></button>`).join('')}</div>`;
  $$('[data-look]', el).forEach((b) => { b.onclick = () => api.setSettings({ dockStyle: b.dataset.look }); });
  api.svc('wallcolor', 'get', '').then((c) => {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c.color || '') || c.color === dockWallPrev) return;
    dockWallPrev = c.color;
    const bar = $('[data-look="wallpaper"] > span > span', el);
    if (bar) bar.style.background = c.color;
  }).catch(() => {});
}

// Dock: the displays that get one (`dockDisplays`): Sympony's display, all of them, or the ones ticked (at least one
// stays ticked; a picked display that isn't connected stays picked for when it's back). The list comes fresh from
// main each time (displays come and go), named as for General → Show Sympony on; the last one shows until it comes.
let dockDisps = null;
async function renderDockDisplays(el) {
  const v = S.dockDisplays;
  const mode = Array.isArray(v) ? 'chosen' : v === 'all' ? 'all' : 'sympony';
  const picked = Array.isArray(v) ? v.map(String) : [];
  const draw = (list) => {
    const ids = list.map((d) => String(d.id));
    const away = picked.filter((id) => !ids.includes(id)).length;
    const sub = mode === 'chosen' && away ? ` ${away > 1 ? _t('{n} picked displays aren’t connected now.', { n: away }) : _t('{n} picked display isn’t connected now.', { n: away })} ${_t('With none of the picked ones connected, the Dock shows on Sympony’s display.')}` : '';
    el.innerHTML = `<label class="row"><span class="lbl">${_t('Show the Dock on')}<small>${_t('Sympony’s display is the one picked in General → Show Sympony on (the primary display when Sympony is on all of them or follows the mouse).')}${sub}</small></span>
      <select id="dockOn">${[['sympony', _t('Sympony’s display')], ['all', _t('All displays')], ['chosen', _t('Chosen displays')]].map(([k, l]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
      + (mode === 'chosen' ? list.map((d) => `<label class="row" style="padding-left:32px"><span class="lbl">${esc(d.label)}</span><input type="checkbox" data-disp="${esc(d.id)}" ${picked.includes(String(d.id)) ? 'checked' : ''}></label>`).join('') : '');
    $('#dockOn', el).onchange = (e) => {
      const m = e.target.value;
      if (m !== 'chosen') { api.setSettings({ dockDisplays: m }); return; }
      // Chosen starts from the displays that have a Dock now
      const now = list.filter((d) => d.on).map((d) => String(d.id));
      api.setSettings({ dockDisplays: now.length ? now : ids.slice(0, 1) });
    };
    $$('[data-disp]', el).forEach((c) => {
      c.onchange = () => {
        const ticked = $$('[data-disp]', el).filter((x) => x.checked).map((x) => x.dataset.disp);
        if (!ticked.length) { c.checked = true; return; }
        api.setSettings({ dockDisplays: [...picked.filter((id) => !ids.includes(id)), ...ticked] });
      };
    });
  };
  draw(dockDisps || (info.displays || []).map((d) => ({ ...d, on: false })));
  const fresh = await api.svc('dock', 'displays').catch(() => null);
  if (Array.isArray(fresh)) { dockDisps = fresh; if (el.isConnected) draw(fresh); }
}

function renderWelcome(el) {
  el.innerHTML += `<p class="lead">${LINUX ? _t('Sympony is an interactive notch for your desktop. It lives at the top centre of your screen, under a panel at the top if you have one. Hover over it to open it, or drag files onto it.')
    : _t('Sympony is an interactive notch for your Windows PC. It lives at the top centre of your screen. Hover over it to open it, drag files onto it, or press <kbd>{key}</kbd>.', { key: esc(S.toggleShortcut || 'Alt+N') })}</p>
    <div class="cards">${[
      ['music', '#ff2d55', _t('Music'), _t('Album art glow, visualizer, controls and lyrics')], ['calendar-days', '#ff3b30', _t('Calendar'), _t('Google, Outlook or iCal: the month, your day and meeting reminders')],
      ['wand-magic-sparkles', '#bf5af2', _t('Pony'), _t('Ask anything. Pony knows your day, sets reminders and repeating todos, and sends you a brief')],
      ['list-check', '#ff9f0a', _t('Todo & Notes'), _t('Tasks with reminders that can repeat, quick notes')], ['mosque', '#30d158', _t('Prayer Times'), _t('Kemenag RI in Indonesia, the local authority elsewhere, with your own adhan')],
      ['stopwatch', '#ff6b4a', _t('Pomodoro'), _t('Focus sessions, a timer and a stopwatch')], ['cloud-sun', '#32ade6', _t('Weather'), _t('Live forecast, no API key')],
      ['bell', '#ff3b30', _t('Notifications'), _t('Windows and browser notifications, right in Sympony')], ['sliders', '#8e8e93', _t('Control'), _t('Volume, sound output, microphone and brightness in one tab')],
      ['heart-pulse', '#ff375f', _t('Health'), _t('Water, breaks, breathing, eye breaks')], ['hourglass-half', '#5856d6', _t('Screen Time'), _t('Where your time goes')],
      ['gauge-high', '#8e8e93', _t('System'), _t('CPU, memory, network, disk, temperature')], ['bluetooth-b', '#0a84ff', _t('Bluetooth & Wi-Fi'), _t('Devices, battery, join Wi-Fi networks')],
      ['hand-holding', '#ff9f0a', _t('Drop Actions'), _t('Zip, convert, copy, share, OneDrive')], ['table-columns', '#64d2ff', _t('Snap Zones'), _t('Drag a window to Sympony to tile it')],
      ['sliders', '#8e8e93', _t('HUD'), _t('Volume & brightness sliders')], ['language', '#bf5af2', _t('Translate'), _t('Gemini, Claude, any OpenAI-compatible API, or Ollama')],
      ['arrow-pointer', '#ff9f0a', _t('Cute cursors'), _t('Cat-paw mouse pointers in every app')],
    ].filter(([ic]) => !OFF || !OFF.cards.includes(ic)).map(([ic, c, t, d]) => `<div class="card"><b><i class="fa-${brands.has(ic) ? 'brands' : 'solid'} fa-${ic}" style="color:${c}"></i>${t}</b><span>${d}</span></div>`).join('')}</div>
    <p class="hint">${_t('Turn modules on/off and reorder them in <b>Modules</b>. Want Sympony out of the way for a moment? Click the eye button at the top of the open Sympony (or right-click it twice). For good: turn on <b>Auto-hide</b> in General, and let it come down when you’re idle. Right-click the tray icon for Snooze, Hide and Quit.')}</p>`;
}

// Drag the rows of a list (each `.li` with data-i) into a new order. A mouse can grab a row anywhere and
// starts after a few pixels of movement; a finger uses the row's handle (the rest of the row still scrolls
// the page). The row moves between the others as the pointer passes their middle; done(order of the
// original indexes) on release.
function sortable(list, done) {
  let drag = null; let wait = null;
  const start = (row, e) => {
    drag = { row, id: e.pointerId };
    row.classList.add('dragging'); list.classList.add('sorting');
    try { row.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };
  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.li');
    if (!row || e.button > 0 || e.target.closest('button, input, select, a')) return;
    if (e.pointerType === 'touch') { if (e.target.closest('.grip')) start(row, e); return; }
    wait = { row, x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  list.addEventListener('pointermove', (e) => {
    if (wait && wait.id === e.pointerId && Math.hypot(e.clientX - wait.x, e.clientY - wait.y) > 5) { const r = wait.row; wait = null; start(r, e); }
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    const rows = [...list.querySelectorAll('.li')].filter((r) => r !== drag.row);
    const before = rows.find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    if (before) { if (drag.row.nextElementSibling !== before) list.insertBefore(drag.row, before); } else if (list.lastElementChild !== drag.row) list.appendChild(drag.row);
  });
  const end = (e) => {
    if (wait && wait.id === e.pointerId) wait = null;
    if (!drag || drag.id !== e.pointerId) return;
    drag.row.classList.remove('dragging'); list.classList.remove('sorting'); drag = null;
    const order = [...list.querySelectorAll('.li')].map((r) => +r.dataset.i);
    if (order.some((v, k) => v !== k)) done(order);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

function renderModules(el) {
  // on a Mac (and Linux) the tabs that need Windows aren't listed; saving keeps them, at the end
  const every = S.modules || [];
  const mods = OFF ? every.filter((m) => !OFF.tabs.includes(m.id)) : every;
  el.innerHTML += `<p class="lead">${_t('Each ON module is a page in the notch; this order is the swipe order.')}</p>
    <div class="group"><div class="row" data-k="notchView"><span class="lbl">${_t('Notch view')}</span><div class="seg" id="notchViewSeg"><button type="button" data-nv="modules" class="${S.notchView !== 'dashboard' ? 'on' : ''}">${_t('Per module')}</button><button type="button" data-nv="dashboard" class="${S.notchView === 'dashboard' ? 'on' : ''}">${_t('Dashboard')}</button></div></div></div>
    <div class="list" id="modList">${mods.map((m, i) => {
      const [ic, title, sub] = MODULE_META[m.id] || ['cube', m.id, ''];
      return `<div class="li ${m.on ? '' : 'off'}" data-i="${i}"><span class="grip" title="${_t('Drag to reorder')}">${fa('grip-vertical')}</span><span class="ico">${fa(ic, brands.has(ic) ? 'brands' : 'solid')}</span><div class="grow"><b>${title}</b><small>${sub}</small></div>
        <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="${_t('Move up')}">${fa('chevron-up')}</button>
        <button class="icon-btn" data-down="${i}" ${i === mods.length - 1 ? 'disabled' : ''} title="${_t('Move down')}">${fa('chevron-down')}</button>
        <input type="checkbox" data-on="${i}" ${m.on ? 'checked' : ''}></div>`;
    }).join('')}</div>
    <h2>${_t('Default')}</h2><div class="group"><label class="row"><span class="lbl">${_t('Open this module by default')}</span><select id="defTab">${mods.filter((m) => m.on).map((m) => `<option value="${m.id}" ${S.defaultTab === m.id ? 'selected' : ''}>${(MODULE_META[m.id] || [])[1] || m.id}</option>`).join('')}</select></label>
    <label class="row"><span class="lbl">${_t('Remember the last module')}<small>${_t('Otherwise Sympony always opens on the default module')}</small></span><input type="checkbox" id="remTab" ${S.rememberTab ? 'checked' : ''}></label>
    <label class="row"><span class="lbl">${_t('Reopen on the last tab')}<small>${_t('The tab you left Sympony on comes back when it opens again, also after Sympony restarts')}</small></span><input type="checkbox" id="restoreTab" ${restoreTab() ? 'checked' : ''}></label></div>`;
  const save = (list) => api.setSettings({ modules: OFF ? [...list, ...every.filter((m) => !mods.includes(m))] : list });
  $$('#notchViewSeg [data-nv]', el).forEach((b) => { b.onclick = () => api.setSettings({ notchView: b.dataset.nv }); });
  $$('[data-on]', el).forEach((c) => { c.onchange = () => { const l = mods.map((m) => ({ ...m })); l[+c.dataset.on].on = c.checked; save(l); }; });
  $$('[data-up]', el).forEach((b) => { b.onclick = () => { const i = +b.dataset.up; const l = mods.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; save(l); }; });
  $$('[data-down]', el).forEach((b) => { b.onclick = () => { const i = +b.dataset.down; const l = mods.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; save(l); }; });
  sortable($('#modList', el), (order) => save(order.map((i) => mods[i])));
  $('#defTab', el).onchange = (e) => api.setSettings({ defaultTab: e.target.value });
  $('#remTab', el).onchange = (e) => api.setSettings({ rememberTab: e.target.checked });
  // (the notch reads it from the same storage: notch.js tabMemory)
  $('#restoreTab', el).onchange = (e) => { try { localStorage.setItem('sympony.restoreTab', e.target.checked ? '1' : '0'); } catch (err) { /* no storage */ } };
}
function restoreTab() { try { return localStorage.getItem('sympony.restoreTab') !== '0'; } catch (e) { return true; } }

function renderCalendar(el) {
  const sec = {
    rows: [
      { t: 'toggle', k: 'calendarEnabled', label: _t('Show calendar') },
      { t: 'range', k: 'meetingReminderMinutes', label: _t('Meeting reminder'), sub: _t('Sympony pops up this many minutes before an event (0 = off)'), min: 0, max: 30, step: 1, unit: _t('min') },
    ],
  };
  renderRows(sec, el);
  el.insertAdjacentHTML('beforeend', `
    <h2>${_t('Subscribed calendars (iCal / .ics)')}</h2>
    <p class="hint">${_t('<b>Google Calendar:</b> Settings → your calendar → <i>Integrate calendar</i> → copy <i>Secret address in iCal format</i>.')}<br>
      ${_t('<b>Outlook.com / Microsoft 365:</b> Settings → Calendar → Shared calendars → <i>Publish a calendar</i> → copy the ICS link.')}<br>
      ${_t('<b>iCloud:</b> share the calendar as <i>Public Calendar</i> and copy the webcal:// link.')}</p>
    <div id="feeds" class="list"></div>
    <div class="add-row"><input type="text" id="feedName" placeholder="${_t('Name (e.g. Work)')}" style="flex:0 0 150px"><input type="color" id="feedColor" value="#0a84ff">
      <input type="text" id="feedUrl" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"><button class="btn primary" id="feedAdd">${_t('Add')}</button></div>
    <div class="row-actions"><button class="btn" id="calRefresh">${fa('arrows-rotate')} ${_t('Refresh now')}</button><span id="calStatus" class="hint"></span></div>
    <h2>${_t('Local events')}</h2><div id="locals" class="list"></div>
    <div class="add-row"><input type="text" id="evTitle" placeholder="${_t('Event title')}"><input type="datetime-local" id="evStart">
      <input type="number" id="evDur" min="5" step="5" value="30" style="width:80px" title="${_t('Duration (minutes)')}"><span class="hint">${_t('min')}</span>
      <select id="evRepeat">${LocalEvents.repeats().map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <input type="text" id="evLoc" placeholder="${_t('Location or meeting link')}"><button class="btn primary" id="evAdd">${_t('Add event')}</button></div>`);
  $('#feeds', el).innerHTML = (S.icsFeeds || []).map((f, i) => `
    <div class="li"><span class="dot" style="background:${esc(f.color || '#0a84ff')}"></span>
      <div class="grow"><b>${esc(f.name || _t('Calendar'))}</b><small>${esc(f.url.replace(/(ical\/[^/]{6})[^/]*(.*)/, '$1…$2'))}</small>${calErrors[f.url] ? `<small class="err">⚠ ${esc(calErrors[f.url])}</small>` : ''}</div>
      <button class="icon-btn del" data-feed="${i}" title="${_t('Remove')}">${fa('xmark')}</button></div>`).join('');
  $$('[data-feed]', el).forEach((b) => { b.onclick = () => { const l = [...S.icsFeeds]; l.splice(+b.dataset.feed, 1); api.setSettings({ icsFeeds: l }); }; });
  $('#feedAdd', el).onclick = () => {
    const url = $('#feedUrl').value.trim();
    if (!/^(https?|webcal):\/\//i.test(url)) { $('#calStatus').textContent = _t('Paste a valid https:// or webcal:// link'); return; }
    $('#calStatus').textContent = _t('Loading…');
    api.setSettings({ icsFeeds: [...(S.icsFeeds || []), { url, name: $('#feedName').value.trim() || 'Calendar', color: $('#feedColor').value }] });
  };
  $('#calRefresh', el).onclick = async () => { $('#calStatus').textContent = _t('Refreshing…'); await api.refreshCalendar(); };
  const evs = [...(S.localEvents || [])].sort((a, b) => a.start - b.start);
  const repeats = { daily: _t('repeats daily'), weekly: _t('repeats weekly'), monthly: _t('repeats monthly'), yearly: _t('repeats yearly') };
  $('#locals', el).innerHTML = evs.map((e) => `<div class="li"><span class="dot" style="background:#a78bfa"></span>
    <div class="grow"><b>${esc(e.title)}</b><small>${new Date(e.start).toLocaleString(_tLocale(), { dateStyle: 'medium', timeStyle: 'short' })} · ${_t('{n} min', { n: Math.round((e.end - e.start) / 60000) })}${e.repeat && e.repeat !== 'none' ? ' · ' + (repeats[e.repeat] || _t('repeats {how}', { how: esc(e.repeat) })) : ''}${e.location ? ' · ' + esc(e.location) : ''}</small></div>
    <button class="icon-btn del" data-ev="${esc(e.id)}" title="${_t('Delete')}">${fa('xmark')}</button></div>`).join('');
  $$('[data-ev]', el).forEach((b) => { b.onclick = () => LocalEvents.remove(S.localEvents, b.dataset.ev); });
  const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('#evStart', el).value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  // checked and saved the same way as the Calendar tab's form (localevents.js)
  $('#evAdd', el).onclick = () => {
    const [day, time] = $('#evStart').value.split('T');
    const r = LocalEvents.save(S.localEvents, { title: $('#evTitle').value, day, time, minutes: $('#evDur').value, location: $('#evLoc').value, repeat: $('#evRepeat').value });
    if (r.bad) { $(r.bad === 'title' ? '#evTitle' : '#evStart').focus(); return; }
    // (the list is drawn again once nothing has the keyboard)
    if (document.activeElement) document.activeElement.blur();
  };
  $$('#evTitle, #evDur, #evLoc', el).forEach((f) => { f.onkeydown = (e) => { if (e.key === 'Enter') $('#evAdd', el).click(); }; });
}

// Detect my location (Weather, Prayer Times): Location Services is asked for the position once, on the click, and
// the place is saved as that page's city (services/location.rs). Finding it, and what came of it, stay up while the page is drawn again.
const locating = { busy: '', msg: {} };
function locateRow(which, cur) {
  const busy = locating.busy === which;
  // "Found: …" only while that's the page's city
  let m = busy ? null : locating.msg[which];
  if (m && m.at && (!cur || `${cur.lat},${cur.lon}` !== m.at)) m = null;
  const sub = busy ? _t('Finding your location…') : m ? m.text : MAC ? _t('Uses Location Services to find where this Mac is, once, and picks the city there') : _t('Uses Windows’ location service to find where this PC is, once, and picks the city there (its name from OpenStreetMap)');
  return `<div class="row"><span class="lbl">${_t('Detect my location')}<small>${sub}</small></span>
        <span style="display:flex;gap:6px">${m && m.settings ? `<button class="btn" data-locset>${_t('Open location settings')}</button>` : ''}<button class="btn" data-locate="${which}" ${locating.busy ? 'disabled' : ''}>${fa(busy ? 'spinner fa-spin' : 'location-crosshairs')} ${_t('Detect')}</button></span></div>`;
}
function wireLocate(el) {
  $$('[data-locset]', el).forEach((b) => { b.onclick = () => api.openExternal(MAC ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices' : 'ms-settings:privacy-location'); });
  $$('[data-locate]', el).forEach((b) => { b.onclick = () => detectLocation(b.dataset.locate); });
}
async function detectLocation(which) {
  if (locating.busy) return;
  locating.busy = which;
  delete locating.msg[which];
  refresh();
  const r = await api.svc('location', 'detect', which).catch(() => null);
  locating.busy = '';
  // (still looking from before Settings was opened again)
  if (r && r.reason === 'busy') { refresh(); return; }
  const how = MAC ? _t('Turn it on in System Settings → Privacy & Security → Location Services, then come back.') : _t('Turn on Location services, “Let apps access your location” and “Let desktop apps access your location” in Settings → Privacy & security → Location, then come back.');
  const p = r && r.place ? [r.place.name, r.place.admin, r.place.country].filter(Boolean).join(', ') : '';
  locating.msg[which] = r && r.ok ? { at: `${r.place.lat},${r.place.lon}`, text: r.named ? _t('Found: {place}', { place: esc(p) }) : _t('Saved your position, but couldn’t look up its name. Check the internet connection, or search for your city.') }
    : r && r.reason === 'off' ? { text: `${MAC ? _t('Location Services is off on this Mac.') : _t('Location services is off on this PC.')} ${how}`, settings: true }
    : r && r.reason === 'denied' ? { text: `${MAC ? _t('macOS doesn’t let Sympony use your location.') : _t('Windows doesn’t let Sympony use your location.')} ${how}`, settings: true }
    : { text: MAC ? _t('This Mac couldn’t find its location right now. Try again in a moment, or search for your city.') : _t('This PC couldn’t find its location right now. Try again in a moment, or search for your city.') };
  refresh();
}

function renderWeather(el) {
  const loc = S.weatherLocation;
  el.innerHTML += `<p class="lead">${_t("Live forecast from <b>Open-Meteo</b>, free and with no API key needed. Only the city's coordinates are sent.")}</p>
    <div class="group">
      <label class="row"><span class="lbl">${_t('Show weather')}</span><input type="checkbox" id="wxOn" ${S.weatherEnabled ? 'checked' : ''}></label>
      <div class="row"><span class="lbl">${_t('Location')}<small>${loc ? esc([loc.name, loc.admin, loc.country].filter(Boolean).join(', ')) : _t('Detected from your time zone')}</small></span>
        <span style="display:flex;gap:6px"><input type="text" id="wxQ" class="short" placeholder="${_t('Search a city…')}"><button class="btn" id="wxGo">${fa('magnifying-glass')}</button></span></div>
      <label class="row"><span class="lbl">${_t('Use my current location')}<small>${MAC ? _t('Follows this Mac: when it is more than 2 km from the city above, that becomes the new city. Picking a city turns this off.') : _t('Follows this PC: when it is more than 2 km from the city above, that becomes the new city. Picking a city turns this off.')}</small></span><input type="checkbox" id="wxAuto" ${S.locationAuto !== false ? 'checked' : ''}></label>
      ${locateRow('weather', loc)}
      <label class="row"><span class="lbl">${_t('Units')}</span><select id="wxUnit"><option value="c" ${S.weatherUnit !== 'f' ? 'selected' : ''}>°C, km/h</option><option value="f" ${S.weatherUnit === 'f' ? 'selected' : ''}>°F, mph</option></select></label>
    </div><div class="results" id="wxRes"></div>`;
  $('#wxOn', el).onchange = (e) => api.setSettings({ weatherEnabled: e.target.checked });
  $('#wxUnit', el).onchange = (e) => api.setSettings({ weatherUnit: e.target.value });
  $('#wxAuto', el).onchange = (e) => api.setSettings({ locationAuto: e.target.checked });
  wireLocate(el);
  const search = async () => {
    const q = $('#wxQ').value;
    $('#wxRes').innerHTML = `<span class="hint">${_t('Searching…')}</span>`;
    try {
      const r = await api.svc('weather', 'search', q);
      $('#wxRes').innerHTML = r.map((x, i) => `<button data-r="${i}">${fa('location-dot')} ${esc(x.name)}${x.admin ? ', ' + esc(x.admin) : ''} · ${esc(x.country)}</button>`).join('') || `<span class="hint">${_t('No matches')}</span>`;
      $$('[data-r]').forEach((b) => { b.onclick = () => { api.setSettings({ weatherLocation: r[+b.dataset.r], locationAuto: false }); $('#wxRes').innerHTML = ''; }; });
    } catch (e) { $('#wxRes').innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
  };
  $('#wxGo', el).onclick = search;
  suggestPlaces($('#wxQ', el), (q) => api.svc('weather', 'search', q),
    (x) => `${fa('location-dot')} ${esc(x.name)}${x.admin ? ', ' + esc(x.admin) : ''} · ${esc(x.country)}`,
    (x) => { api.setSettings({ weatherLocation: x, locationAuto: false }); $('#wxRes').innerHTML = ''; });
  $('#wxQ', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
}

// Prayer times: Kemenag RI's table for Indonesian regencies / cities, elsewhere Aladhan with the local
// authority's method (backend: prayer.rs). Today's times come in as the "prayer" helper event.
const PRAYER_METHODS = [['auto', _t('Automatic: the authority for your location')], ['20', _t('Kemenag RI (Indonesia)')], ['17', _t('JAKIM (Malaysia)')],
  ['11', _t('MUIS (Singapore)')], ['13', _t('Diyanet (Türkiye)')], ['4', _t('Umm al-Qura (Makkah)')], ['3', _t('Muslim World League')], ['2', _t('ISNA (North America)')],
  ['5', _t('Egyptian General Authority of Survey')], ['1', _t('University of Islamic Sciences, Karachi')], ['16', _t('Dubai')], ['8', _t('Gulf Region')], ['9', _t('Kuwait')],
  ['10', _t('Qatar')], ['12', _t('UOIF (France)')], ['14', _t('Spiritual Administration of Muslims of Russia')], ['21', _t('Morocco')], ['23', _t('Jordan')],
  ['18', _t('Tunisia')], ['19', _t('Algeria')], ['22', _t('Portugal')]];
// Places suggested under a location box as you type (Weather, Prayer Times): from 3 characters and a short
// pause the box's own search runs and up to 6 show in a list under it. Click one, or the arrows and Enter;
// Escape or a click elsewhere closes it, and a newer keystroke drops an older search's answer. Enter with
// none highlighted is still the box's own search (add its keydown after this).
function suggestPlaces(input, find, label, pick) {
  const wrap = document.createElement('span');
  wrap.className = 'suggest-wrap';
  input.replaceWith(wrap);
  const list = document.createElement('div');
  list.className = 'suggest';
  list.hidden = true;
  wrap.append(input, list);
  let timer = 0; let seq = 0; let found = []; let at = -1;
  const cancel = () => { clearTimeout(timer); seq++; };
  const close = () => { cancel(); found = []; at = -1; list.hidden = true; list.innerHTML = ''; };
  const choose = (x) => { close(); input.blur(); pick(x); };
  const paint = () => {
    list.hidden = !found.length;
    list.innerHTML = found.map((x, i) => `<button type="button" data-s="${i}" class="${i === at ? 'on' : ''}">${label(x)}</button>`).join('');
    $$('[data-s]', list).forEach((b) => { b.onclick = () => choose(found[+b.dataset.s]); });
  };
  // a click in the list keeps the box focused (losing focus closes the list)
  list.addEventListener('mousedown', (e) => e.preventDefault());
  input.addEventListener('blur', close);
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    cancel();
    const n = seq;
    timer = setTimeout(async () => {
      const r = await find(q).catch(() => []);
      if (n !== seq) return; // typed on, picked or closed meanwhile
      found = (Array.isArray(r) ? r : []).slice(0, 6);
      at = -1;
      paint();
    }, 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') { if (at >= 0) { e.preventDefault(); e.stopImmediatePropagation(); choose(found[at]); } else close(); return; }
    if (list.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    at = e.key === 'ArrowDown' ? (at + 1) % found.length : (at <= 0 ? found.length : at) - 1;
    paint();
  });
}
function renderPrayer(el) {
  const own = S.prayerLocation && S.prayerLocation.lat != null ? S.prayerLocation : null;
  const where = own || S.weatherLocation;
  const place = (l) => [l.name, l.admin, l.country].filter(Boolean).join(', ');
  const auto = (S.prayerMethod || 'auto') === 'auto';
  const indo = where && where.country === 'Indonesia';
  const list = S.prayerList || {};
  const opt = (v, cur, label) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  el.innerHTML += `<p class="lead">${_t('Reminders for the five daily prayers where you are. In Indonesia Sympony uses the official <b>Kemenag RI</b> schedule for your regency or city, the same table mosques use. Elsewhere the times come from <b>Aladhan</b> with the method of your country’s authority (JAKIM, MUIS, Diyanet, Umm al-Qura, ISNA…).')}</p>
    <div class="group">
      <label class="row"><span class="lbl">${_t('Prayer time reminders')}<small>${_t('A countdown in the closed Sympony before each prayer, and a reminder when it’s time')}</small></span><input type="checkbox" id="prOn" ${S.prayerEnabled ? 'checked' : ''}></label>
      <div id="prToday"></div>
    </div>
    <h2>${_t('Location')}</h2><div class="group">
      <div class="row"><span class="lbl">${_t('City')}<small>${where ? esc(place(where)) + (own ? '' : ' ' + _t('(same as Weather)')) : _t('Pick a city')}</small></span>
        <span style="display:flex;gap:6px">${own ? `<button class="btn" id="prUseWx">${_t('Use the Weather city')}</button>` : ''}<input type="text" id="prQ" class="short" placeholder="${_t('Search a city…')}"><button class="btn" id="prGo">${fa('magnifying-glass')}</button></span></div>
      ${locateRow('prayer', own)}
      ${indo && auto ? `<div class="row"><span class="lbl">${_t('Kemenag regency / city')}<small>${S.prayerKemenag ? esc(S.prayerKemenag.name) : where.kemenag ? esc(where.kemenag.name) : _t('Matched to your city automatically')}</small></span>
        <span style="display:flex;gap:6px">${S.prayerKemenag ? `<button class="btn" id="prKAuto">${_t('Automatic')}</button>` : ''}<input type="text" id="prKQ" class="short" placeholder="${_t('e.g. Bekasi, Sleman…')}"><button class="btn" id="prKGo">${fa('magnifying-glass')}</button></span></div>` : ''}
    </div><div class="results" id="prRes"></div>
    <h2>${_t('Calculation')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Method')}</span><select id="prMethod">${PRAYER_METHODS.map(([v, l]) => opt(v, S.prayerMethod || 'auto', l)).join('')}</select></label>
      <label class="row"><span class="lbl">${_t('Asr')}${indo && auto ? `<small>${_t('The Kemenag table already sets Asr; this applies to the other methods')}</small>` : ''}</span><select id="prSchool">${opt('standard', S.prayerSchool, _t('Standard (Shafi’i, Maliki, Hanbali)'))}${opt('hanafi', S.prayerSchool, _t('Hanafi'))}</select></label>
    </div>
    <h2>${_t('Reminders')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Count down before each prayer')}<small>${_t('Shown in the closed Sympony')}</small></span><select id="prBefore">${[[0, _t('Off')], [5, _t('5 minutes')], [10, _t('10 minutes')], [15, _t('15 minutes')], [30, _t('30 minutes')]].map(([v, l]) => opt(v, S.prayerBefore ?? 10, l)).join('')}</select></label>
      <label class="row"><span class="lbl">${_t('Sound when it’s time')}</span><input type="checkbox" id="prSound" ${S.prayerSound !== false ? 'checked' : ''}></label>
      ${[['fajr', _t('Subuh · Fajr')], ['sunrise', _t('Terbit · Sunrise (Syuruq)'), _t('The end of Subuh’s time: a countdown and a short reminder (the chime, never the adhan)')],
        ['dhuhr', _t('Dzuhur · Dhuhr')], ['asr', _t('Ashar · Asr')], ['maghrib', _t('Maghrib')], ['isha', _t('Isya · Isha')]]
        .map(([k, l, sub]) => `<label class="row"><span class="lbl">${l}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-pr="${k}" ${list[k] !== false ? 'checked' : ''}></label>`).join('')}
    </div>
    <h2>${_t('Adhan')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Play the adhan when it’s time')}<small>${_t('Sympony doesn’t come with a recording: choose your own audio file (MP3, M4A, WAV, OGG…). Without one, this stays off. It plays for the prayers ticked above, in place of the chime, and the closed Sympony shows a stop button meanwhile.')}</small></span><input type="checkbox" id="adOn" ${S.adhanOn && S.adhanFile ? 'checked' : ''}></label>
      ${[['default', _t('Adhan'), S.adhanFile, _t('No file chosen')], ['fajr', _t('Subuh adhan (optional)'), S.adhanFajrFile, _t('Uses the adhan above; pick another for Subuh (with “ash-shalatu khairun minan naum”)')]]
        .map(([w, label, file, none]) => `<div class="row"><span class="lbl">${label}<small>${file ? esc(file) : none}</small></span>
          <span style="display:flex;gap:6px">${file ? `<button class="btn" data-adtest="${w}" title="${_t('Play / stop')}">${fa('play')} ${_t('Test')}</button><button class="btn" data-adclear="${w}" title="${_t('Remove')}">${fa('trash-can', 'regular')}</button>` : ''}<button class="btn" data-adpick="${w}">${fa('folder-open')} ${_t('Choose file…')}</button></span></div>`).join('')}
      <label class="row"><span class="lbl">${_t('Volume')}</span><span class="range"><input type="range" id="adVol" min="10" max="100" step="5" value="${S.adhanVolume ?? 80}"><output>${S.adhanVolume ?? 80}</output>%</span></label>
      <label class="row"><span class="lbl">${_t('Pause music during the adhan')}<small>${_t('Music and videos that are playing pause while the adhan plays and continue after it.')}</small></span><input type="checkbox" id="adPause" ${S.adhanPauseMedia !== false ? 'checked' : ''}></label>
      <div class="row" id="adMsg" hidden></div>
    </div>
    <p class="hint">${_t('Only the city’s coordinates (or its Kemenag code) are sent to get the times. A month of times is kept on this PC, so the reminders keep working offline. The Dashboard has a Prayer times widget too.')}</p>`;
  $('#prOn', el).onchange = (e) => api.setSettings({ prayerEnabled: e.target.checked });
  $('#prMethod', el).onchange = (e) => api.setSettings({ prayerMethod: e.target.value });
  $('#prSchool', el).onchange = (e) => api.setSettings({ prayerSchool: e.target.value });
  $('#prBefore', el).onchange = (e) => api.setSettings({ prayerBefore: Number(e.target.value) });
  $('#prSound', el).onchange = (e) => api.setSettings({ prayerSound: e.target.checked });
  $$('[data-pr]', el).forEach((c) => { c.onchange = () => api.setSettings({ prayerList: { ...(S.prayerList || {}), [c.dataset.pr]: c.checked } }); });
  // the adhan: turning it on without a file asks for one (it stays off if none is picked)
  const adMsg = (t) => { const m = $('#adMsg', el); m.hidden = !t; m.innerHTML = t ? `<span class="lbl">${fa('circle-exclamation')} ${esc(t)}</span>` : ''; };
  const pickAdhan = async (which) => {
    const r = await api.svc('adhan', 'pick', which).catch(() => null);
    if (r && r.ok === false) adMsg(r.message);
    return !!(r && r.ok);
  };
  $('#adOn', el).onchange = async (e) => {
    if (!e.target.checked) return api.setSettings({ adhanOn: false });
    if (S.adhanFile) return api.setSettings({ adhanOn: true });
    if (!(await pickAdhan('default'))) e.target.checked = false;
  };
  $$('[data-adpick]', el).forEach((b) => { b.onclick = () => pickAdhan(b.dataset.adpick); });
  $$('[data-adclear]', el).forEach((b) => { b.onclick = () => { stopAdhanTest(); api.svc('adhan', 'clear', b.dataset.adclear); }; });
  $$('[data-adtest]', el).forEach((b) => { b.onclick = () => testAdhan(b.dataset.adtest, b); });
  $('#adVol', el).addEventListener('input', (e) => {
    e.target.nextElementSibling.textContent = e.target.value;
    if (adhanTest) adhanTest.volume = e.target.value / 100;
  });
  $('#adVol', el).addEventListener('change', (e) => api.setSettings({ adhanVolume: Number(e.target.value) }));
  $('#adPause', el).onchange = (e) => api.setSettings({ adhanPauseMedia: e.target.checked });
  wireLocate(el);
  const useWx = $('#prUseWx', el); if (useWx) useWx.onclick = () => api.setSettings({ prayerLocation: null, prayerKemenag: null });
  const kAuto = $('#prKAuto', el); if (kAuto) kAuto.onclick = () => api.setSettings({ prayerKemenag: null });
  const results = (html) => { $('#prRes').innerHTML = html; };
  const findCity = async () => {
    results(`<span class="hint">${_t('Searching…')}</span>`);
    const r = await api.svc('weather', 'search', $('#prQ').value).catch(() => []);
    results(r.map((x, i) => `<button data-c="${i}">${fa('location-dot')} ${esc(place(x))}</button>`).join('') || `<span class="hint">${_t('No matches')}</span>`);
    $$('[data-c]').forEach((b) => { b.onclick = () => { api.setSettings({ prayerLocation: r[+b.dataset.c], prayerKemenag: null }); results(''); }; });
  };
  const findKemenag = async () => {
    results(`<span class="hint">${_t('Searching…')}</span>`);
    const r = await api.svc('prayer', 'search', $('#prKQ').value).catch(() => []);
    results(r.map((x, i) => `<button data-k="${i}">${fa('mosque')} ${esc(x.name)}</button>`).join('') || `<span class="hint">${_t('No matches. Try the regency or city name without “Kota” / “Kab.”')}</span>`);
    $$('[data-k]').forEach((b) => { b.onclick = () => { api.setSettings({ prayerKemenag: r[+b.dataset.k] }); results(''); }; });
  };
  $('#prGo', el).onclick = findCity;
  suggestPlaces($('#prQ', el), (q) => api.svc('weather', 'search', q), (x) => `${fa('location-dot')} ${esc(place(x))}`,
    (x) => { api.setSettings({ prayerLocation: x, prayerKemenag: null }); results(''); });
  $('#prQ', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') findCity(); });
  if ($('#prKGo', el)) {
    $('#prKGo', el).onclick = findKemenag;
    suggestPlaces($('#prKQ', el), (q) => api.svc('prayer', 'search', q), (x) => `${fa('mosque')} ${esc(x.name)}`,
      (x) => { api.setSettings({ prayerKemenag: x }); results(''); });
    $('#prKQ', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') findKemenag(); });
  }
  paintPrayer();
}
// Settings' Test button plays the chosen adhan here (press again to stop)
let adhanTest = null;
function stopAdhanTest() { if (adhanTest) { adhanTest.pause(); adhanTest = null; } }
async function testAdhan(which, btn) {
  if (adhanTest) { stopAdhanTest(); btn.innerHTML = `${fa('play')} ${_t('Test')}`; return; }
  const r = await api.svc('adhan', 'data', which).catch(() => null);
  if (!r || !r.ok) return;
  adhanTest = new Audio(r.url);
  adhanTest.volume = (S.adhanVolume ?? 80) / 100;
  adhanTest.addEventListener('ended', () => { adhanTest = null; btn.innerHTML = `${fa('play')} ${_t('Test')}`; });
  adhanTest.play().catch(() => { adhanTest = null; });
  btn.innerHTML = `${fa('stop')} ${_t('Stop')}`;
}
// today's times under the switch
function paintPrayer() {
  const box = $('#prToday'); const p = helper.prayer;
  if (!box) return;
  if (!S.prayerEnabled || !p || !p.enabled) { box.innerHTML = ''; return; }
  if (!p.ok) { box.innerHTML = `<div class="row"><span class="lbl">${fa('circle-exclamation')} ${esc(p.error || _t('Getting the times…'))}</span></div>`; return; }
  const d = p.days[0] || {};
  const t = (ms) => new Date(ms).toLocaleTimeString(_tLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: S.clock24h === false ? 'h12' : 'h23' });
  box.innerHTML = `<div class="row"><span class="lbl">${_t('Today')} · ${esc(p.place)}<small>${_t('Source: {source}', { source: esc(p.source) })}</small></span>
    <span class="pr-today">${['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].filter((k) => d[k]).map((k) => `<span><small>${esc(p.names[k])}</small><b>${t(d[k])}</b></span>`).join('')}</span></div>`;
}

async function renderDropActions(el) {
  const cat = await api.svc('actions', 'catalog');
  const order = S.dropActions || [];
  const all = [...order.map((id) => cat.find((c) => c.id === id)).filter(Boolean), ...cat.filter((c) => !order.includes(c.id))];
  const desc = { shelf: _t('Keep files on Sympony’s Shelf'), share: _t('Windows Share: Nearby sharing, Mail, apps'), zip: _t('Make a .zip next to the files'), unzip: _t('Extract a .zip into a folder'), convert: _t('PNG ⇄ JPG next to the original'), copy: _t('Copy into a folder you pick'), move: _t('Move into a folder you pick'), onedrive: _t('Copy into {folder} (syncs to the cloud)', { folder: 'OneDrive\\Sympony' }), openwith: _t('Choose an app to open the file with'), trash: _t('Move to the Recycle Bin'), eject: _t('Safely remove a drive (drop {drive} from This PC)', { drive: 'E:\\' }) };
  el.innerHTML += `<p class="lead">${_t('Drag files onto Sympony and drop them on a tile. Dropping anywhere else puts them on the Shelf.')}</p>
    <div class="group"><label class="row"><span class="lbl">${_t('Drop actions')}</span><input type="checkbox" id="daOn" ${S.dropActionsEnabled ? 'checked' : ''}></label></div>
    <h2>${_t('Tiles')}</h2><div class="list">${all.map((a, i) => `<div class="li ${order.includes(a.id) ? '' : 'off'}"><span class="ico"><i class="${esc(a.icon)}"></i></span><div class="grow"><b>${esc(a.label)}</b><small>${desc[a.id] || ''}</small></div>
      <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''}>${fa('chevron-up')}</button><button class="icon-btn" data-down="${i}" ${i === all.length - 1 ? 'disabled' : ''}>${fa('chevron-down')}</button>
      <input type="checkbox" data-on="${esc(a.id)}" ${order.includes(a.id) ? 'checked' : ''}></div>`).join('')}</div>
    <h2>${_t('Shelf')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Shelf tab')}</span><input type="checkbox" data-k="shelfEnabled" ${S.shelfEnabled ? 'checked' : ''}></label>
      <label class="row"><span class="lbl">${_t('Open the shelf when dragging files (if drop actions are off)')}</span><input type="checkbox" data-k="shelfOpenOnDrag" ${S.shelfOpenOnDrag ? 'checked' : ''}></label>
      <label class="row"><span class="lbl">${_t('Remove from shelf after dragging out')}</span><input type="checkbox" data-k="shelfRemoveAfterDrag" ${S.shelfRemoveAfterDrag ? 'checked' : ''}></label></div>
    <p class="hint">${_t("The shelf only remembers where files are, so nothing is uploaded or copied. It's saved in <i>shelf.json</i>.")}</p>
    <h2>${_t('Phone')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Send and receive with your phone')}<small>${_t('The Shelf gets a Phone button: scan its QR code with your phone to send files, photos, texts and links both ways. Nothing listens until you press it.')} ${_t('Use it only on a Wi-Fi you trust, not on public Wi-Fi.')}</small></span><input type="checkbox" data-k="phoneShare" ${S.phoneShare !== false ? 'checked' : ''}></label>
      <div class="row"><span class="lbl">${_t('Save files from your phone in')}<small id="phoneFolderInfo">${esc(S.phoneFolder || '')}</small></span>
        <span style="display:flex;gap:6px">${S.phoneFolder ? `<button class="btn" id="phoneFolderReset" title="${MAC || LINUX ? _t('Back to Downloads/Sympony') : _t('Back to Downloads\\Sympony')}">${fa('rotate-left')}</button>` : ''}<button class="btn" id="phoneFolderPick">${fa('folder-open')} ${_t('Choose folder…')}</button></span></div></div>
    <p class="hint">${MAC ? _t('Files go straight between your phone and this Mac over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard. With the macOS firewall on, it may ask to allow Sympony to accept incoming connections the first time.')
      : LINUX ? _t('Files go straight between your phone and this PC over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard.')
      : _t('Files go straight between your phone and this PC over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard. Windows may ask to allow Sympony on private networks the first time.')}</p>
    ${LINUX ? '' : `<h2>${_t('Clipboard')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Remember what you copy')}<small>${_t('Texts, links and pictures you copy show on the Shelf: switch it to Clipboard and click one to copy it again. Turning this off clears all but the pinned ones.')}</small></span><input type="checkbox" data-k="clipboardHistory" ${S.clipboardHistory ? 'checked' : ''}></label>
      <label class="row"><span class="lbl">${_t('Keep the last')}<small>${_t('Pinned ones don’t count (5 to 100)')}</small></span><span class="num"><input type="number" class="short" id="clipMax" min="5" max="100" step="1" value="${esc(S.clipboardMax ?? 30)}">${_t('copies')}</span></label></div>
    <p class="hint">${MAC ? _t('Kept only on this Mac (<i>clipboard.json</i> and the <i>clipboard</i> folder), never in a backup. Copies that password managers mark as private are skipped, and so are files copied in Finder.')
      : _t('Kept only on this PC (<i>clipboard.json</i> and the <i>clipboard</i> folder), never in a backup. Copies that password managers mark as private are skipped, and so are files copied in File Explorer.')}</p>`}
    <h2>${_t('App launcher')}</h2><div class="list" id="launchList"></div>
    <div class="row-actions"><button class="btn" id="addApp">${fa('plus')} ${_t('Add app or file')}</button><button class="btn" id="addFolder">${fa('folder-plus')} ${_t('Add folder')}</button></div>
    ${OFF ? '' : `<p class="hint">${_t('Tip: apps live in <i>{path}</i>, so pick their shortcut (.lnk) there.', { path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs' })}</p>`}`;
  const enabledOrder = (list) => list.filter((a) => order.includes(a.id)).map((a) => a.id);
  $('#daOn', el).onchange = (e) => api.setSettings({ dropActionsEnabled: e.target.checked });
  $$('[data-on]', el).forEach((c) => { c.onchange = () => api.setSettings({ dropActions: c.checked ? [...order, c.dataset.on] : order.filter((x) => x !== c.dataset.on) }); });
  const move = (i, d) => { const l = all.slice(); [l[i + d], l[i]] = [l[i], l[i + d]]; api.setSettings({ dropActions: enabledOrder(l) }); };
  $$('[data-up]', el).forEach((b) => { b.onclick = () => move(+b.dataset.up, -1); });
  $$('[data-down]', el).forEach((b) => { b.onclick = () => move(+b.dataset.down, 1); });
  $$('[data-k]', el).forEach((c) => { c.onchange = () => api.setSettings({ [c.dataset.k]: c.checked }); });
  // Phone: where its files go (Downloads\Sympony until a folder is picked; main says where that is on this PC)
  $('#phoneFolderPick', el).onclick = () => api.svc('phone', 'pickFolder');
  if ($('#phoneFolderReset', el)) $('#phoneFolderReset', el).onclick = () => api.setSettings({ phoneFolder: '' });
  api.svc('phone', 'folder').then((f) => { const i = $('#phoneFolderInfo', el); if (f && i) i.textContent = f.path; }).catch(() => {});
  if ($('#clipMax', el)) $('#clipMax', el).onchange = (e) => {
    const n = Math.round(Number(e.target.value));
    if (!Number.isFinite(n) || e.target.value === '') { e.target.value = S.clipboardMax ?? 30; return; }
    e.target.value = Math.min(100, Math.max(5, n));
    api.setSettings({ clipboardMax: Number(e.target.value) });
  };
  const drawLauncher = (items) => {
    const listEl = $('#launchList', el);
    if (!listEl) return;
    listEl.innerHTML = (items || []).map((it, i) => `<div class="li"><span class="ico">${it.iconUrl ? `<img src="${esc(it.iconUrl)}" alt="">` : `<i class="${esc(it.icon || 'fa-solid fa-cube')}"></i>`}</span>
      <div class="grow"><b>${esc(it.name)}</b><small>${esc(it.path)}</small></div><button class="icon-btn del" data-rm="${i}" title="${_t('Remove')}">${fa('xmark')}</button></div>`).join('');
    $$('[data-rm]', listEl).forEach((b) => { b.onclick = async () => drawLauncher(await api.svc('launcher', 'remove', +b.dataset.rm)); });
  };
  drawLauncher(await api.svc('launcher', 'list').catch(() => []));
  $('#addApp', el).onclick = async () => drawLauncher(await api.svc('launcher', 'add', 'file'));
  $('#addFolder', el).onclick = async () => drawLauncher(await api.svc('launcher', 'add', 'folder'));
}

function renderSnap(el) {
  const on = new Set(S.snapLayouts || []);
  el.innerHTML += `<p class="lead">${_t('Start dragging any window and move the mouse onto Sympony: layout tiles appear. Release over a tile to snap the window into it.')}</p>
    ${info.win11 ? `<div class="note">${fa('circle-info')} ${_t('Windows 11 also shows its own snap bar when you drag a window to the top edge. To use Sympony\'s Snap Zones instead, turn off <b>Settings → System → Multitasking → Snap windows → "Show snap layouts when I drag a window to the top of my screen"</b>.')}</div>` : ''}
    <div class="group"><label class="row"><span class="lbl">${_t('Snap Zones')}</span><input type="checkbox" id="snOn" ${S.snapEnabled ? 'checked' : ''}></label></div>
    <h2>${_t('Layouts')}</h2><div class="group"><div class="check-grid">${SNAP.map(([id, l]) => `<label><input type="checkbox" data-l="${id}" ${on.has(id) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>`;
  $('#snOn', el).onchange = (e) => api.setSettings({ snapEnabled: e.target.checked });
  $$('[data-l]', el).forEach((c) => { c.onchange = () => api.setSettings({ snapLayouts: SNAP.map(([id]) => id).filter((id) => (id === c.dataset.l ? c.checked : on.has(id))) }); });
}

function renderHud(el) {
  // a Mac: the volume and the microphone (one that can be muted); macOS shows its own volume pop-up as well
  const style = { t: 'select', k: 'hudStyle', label: _t('Style'), options: [['inline', _t('Inline (in Sympony)')], ['panel', _t('Panel with slider (below)')]] };
  // …and Linux: the volume and the microphone too (no keyboard language yet); the desktop's own volume pop-up stays
  if (MAC || LINUX) {
    renderRows({
      rows: [
        LINUX ? { t: 'lead', html: _t('Shows the volume in Sympony when it changes: the volume keys, the sound menu or an app. Your desktop shows its own volume pop-up as well.') }
          : { t: 'lead', html: _t('Shows the volume in Sympony when it changes: the volume keys, Control Center or an app. macOS shows its own volume pop-up as well.') },
        { t: 'toggle', k: 'hudEnabled', label: _t('Enable HUD') },
        { t: 'toggle', k: 'hudMic', label: _t('Microphone on / off'), sub: _t('Shows when the microphone is muted or back on (a microphone that has a mute switch)') },
        // the input source macOS has selected (inputlang_mac.rs)
        ...(MAC ? [
          { t: 'toggle', k: 'hudInputLang', label: _t('Keyboard language'), sub: _t('Shows the new input source for a moment when you switch (Control + Space or the Globe key)') },
          { t: 'toggle', k: 'langMark', label: _t('Show the keyboard language in the closed Sympony'), sub: _t('A small EN at the right, only when you have more than one input source') },
        ] : []),
        style,
      ],
    }, el);
    el.insertAdjacentHTML('beforeend', `<h2>${_t('Try it')}</h2><div class="group">
      <label class="row"><span class="lbl">${_t('Volume')}</span><span class="range"><input type="range" min="0" max="100" id="tryVol"><output id="tryVolOut"></output></span></label></div>`);
    $('#tryVol', el).addEventListener('input', (e) => api.helper({ cmd: 'volume.set', value: Number(e.target.value) }));
    paintHelper();
    return;
  }
  renderRows({
    rows: [
      { t: 'lead', html: _t('Replaces the standard Windows volume flyout with sliders that blend into Sympony.') },
      { t: 'toggle', k: 'hudEnabled', label: _t('Enable HUD') },
      { t: 'toggle', k: 'hudOverFullscreen', label: _t('Show over fullscreen apps'), sub: _t('While Sympony hides for a fullscreen game or video, volume, brightness and the other pop-ups still show for a moment. Games in exclusive fullscreen draw over every window, so there they can’t show.') },
      { t: 'toggle', k: 'hudOverrideVolumeKeys', label: _t('Take over volume keys'), sub: _t('Hides the Windows volume flyout. Sympony changes the volume in 2% steps.') },
      { t: 'toggle', k: 'hudBrightness', label: _t('Brightness HUD'), sub: _t('Laptop screens (WMI) and DDC/CI monitors') },
      { t: 'toggle', k: 'hudHideWindowsOsd', label: _t('Hide Windows’ own brightness pop-up'), sub: _t('Experimental. A laptop’s brightness keys always make Windows show its pop-up too; Sympony finds it the first time it shows and hides it from then on.') },
      { t: 'toggle', k: 'hudHideMakerOsd', label: _t('Hide the laptop maker’s pop-ups'), sub: _t('Experimental. The boxes your laptop’s own app shows for the mic, airplane or Caps Lock key (Lenovo, ASUS, HP…) are hidden while Sympony shows the same thing. Ones Sympony can’t show, like some touchpad keys, still appear.') },
      { t: 'toggle', k: 'hudLockKeys', label: _t('Caps Lock, Num Lock and Scroll Lock'), sub: _t('Shows On or Off for a moment when you press one') },
      { t: 'toggle', k: 'hudInputLang', label: _t('Keyboard language'), sub: _t('Shows the new language for a moment when you switch (Windows + Space)') },
      { t: 'toggle', k: 'hudMic', label: _t('Microphone on / off'), sub: _t('Shows when the microphone is muted or back on: a laptop’s mic key, Windows + Alt + K, an app') },
      { t: 'toggle', k: 'hudTouchpad', label: _t('Touchpad on / off'), sub: _t('Shows when a laptop’s touchpad key turns the touchpad off or on (when the key tells Windows; some makers’ keys don’t)') },
      { t: 'toggle', k: 'hudAirplane', label: _t('Airplane mode'), sub: _t('Shows On or Off for a moment when it’s switched, also with a laptop’s airplane key, and whether Wi-Fi and Bluetooth went with it') },
      { t: 'toggle', k: 'capsLockMark', label: _t('Keep a mark while Caps Lock is on'), sub: _t('A small A at the left of the closed Sympony, so you notice before you type') },
      { t: 'toggle', k: 'langMark', label: _t('Show the keyboard language in the closed Sympony'), sub: _t('A small ENG at the right, only when you have more than one keyboard language') },
      style,
    ],
  }, el);
  el.insertAdjacentHTML('beforeend', `<h2>${_t('Try it')}</h2><div class="group">
    <label class="row"><span class="lbl">${_t('Volume')}</span><span class="range"><input type="range" min="0" max="100" id="tryVol"><output id="tryVolOut"></output></span></label>
    <label class="row"><span class="lbl">${_t('Brightness')}</span><span class="range"><input type="range" min="0" max="100" id="tryBri"><output id="tryBriOut"></output></span></label></div>`);
  $('#tryVol', el).addEventListener('input', (e) => api.helper({ cmd: 'volume.set', value: Number(e.target.value) }));
  $('#tryBri', el).addEventListener('input', (e) => api.helper({ cmd: 'brightness.set', value: Number(e.target.value) }));
  paintHelper();
}

// how a saved key is kept: encrypted for this Windows account, or with Sympony's key in the Mac's Keychain (secrets.rs);
// on Linux in Sympony's own folder, for this user
const keptHow = () => (MAC ? _t('(encrypted, in a file only your account can read)') : LINUX ? _t('(kept on this PC only)') : _t('(encrypted with Windows DPAPI)'));

// AI Chat & Translate: the AI agents installed on this Mac (agents.rs), one card each with its icon and state; a click
// picks the one AI Chat uses. No API keys: each agent answers with its own sign-in and plan, read-only.
let aiAgents = null;
async function renderAi(el, refresh = false) {
  renderAi.el = el;
  // (under the page's title)
  let body = $('.ai-body', el);
  if (!body) { el.insertAdjacentHTML('beforeend', '<div class="ai-body"></div>'); body = $('.ai-body', el); }
  if (!aiAgents || refresh) {
    body.innerHTML = `<p class="lead">${_t('Looking for AI agents on this Mac…')}</p>`;
    aiAgents = await api.svc('ai', 'agents', !!refresh).catch(() => []);
    if (renderAi.el !== el || !el.isConnected) return;
  }
  const usable = (a) => a.installed && !a.update && a.supported !== false && a.responding !== false;
  const ready = aiAgents.filter((a) => usable(a) && a.signedIn);
  const chatId = S.chatAgent || (ready[0] || {}).id || '';
  const trId = S.translateAgent || '';
  const chat = aiAgents.find((a) => a.id === chatId);
  const state = (a) => !a.installed ? ['off', _t('Not installed')]
    : a.supported === false ? ['off', _t('Not supported yet')]
    : a.responding === false ? ['warn', _t('Not responding')]
    : a.update ? ['warn', _t('Needs an update')]
      : a.signedIn ? ['ok', _t('Ready')] : ['warn', _t('Sign in first')];
  const icon = (a) => `<img src="vendor/ai-icons/${esc(a.icon)}.svg" class="${/-color$/.test(a.icon) ? '' : 'mono'}" alt="">`;
  const card = (a) => {
    const [cls, txt] = state(a);
    const roles = [a.id === chatId && usable(a) ? _t('Chat') : '', (trId ? a.id === trId : a.id === chatId) && usable(a) ? _t('Translate') : ''].filter(Boolean);
    return `<button class="ag-card ${a.id === chatId && usable(a) ? 'on' : ''} ${usable(a) ? '' : 'dim'}" data-ag="${esc(a.id)}">
      <span class="ag-ic">${icon(a)}</span>
      <span class="ag-txt"><b>${esc(a.name)}</b><small class="ag-${cls}"><i></i>${esc(txt)}${a.installed && a.version ? ` · ${esc(a.version.replace(/\s*\(.*\)$/, ''))}` : ''}</small>
        ${roles.length ? `<span class="ag-roles">${roles.map((r) => `<em>${esc(r)}</em>`).join('')}</span>` : ''}</span>
    </button>`;
  };
  const help = (a) => !a.installed ? `<a data-ext="${esc(a.install)}">${_t('How to install {name}', { name: esc(a.name) })}</a>`
    : a.responding === false ? _t('{name} didn’t answer when Sympony checked it. Run it once in Terminal (it may want you to sign in or update), then Refresh.', { name: esc(a.name) })
    : a.supported === false ? _t('{name} has no read-only mode Sympony can rely on yet, so it isn’t used.', { name: esc(a.name) })
    : a.update ? _t('This {name} is too old to answer for Sympony: update it, then Refresh.', { name: esc(a.name) })
      : !a.signedIn ? _t('Open Terminal, run <code>{cmd}</code> once and sign in, then Refresh.', { cmd: esc((a.path || '').split('/').pop()) }) : '';
  const opts = (list, cur, first) => (first ? `<option value="" ${!cur ? 'selected' : ''}>${first}</option>` : '')
    + list.map((a) => `<option value="${esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${esc(a.name)}${a.signedIn ? '' : ` (${_t('not signed in')})`}</option>`).join('');
  const models = S.agentModels || {};
  body.innerHTML = `<p class="lead">${_t('Pony and Translate answer through an AI agent already on this Mac, with your own sign-in and plan: no API keys. Pick one below.')}</p>
    <div class="ag-head"><span class="hint">${ready.length ? _t('{n} ready on this Mac', { n: ready.length }) : _t('None ready yet: install one and sign in')}</span>
      <button class="btn" id="agRefresh">${fa('arrows-rotate')} ${_t('Refresh')}</button></div>
    <div class="ag-grid">${aiAgents.map(card).join('')}</div>
    ${chat && help(chat) ? `<p class="hint">${fa('circle-info')} ${help(chat)}</p>` : ''}
    <div class="group">
      <label class="row"><span class="lbl">${_t('Pony uses')}</span><select id="agChat">${opts(aiAgents.filter(usable), chatId)}</select></label>
      <label class="row"><span class="lbl">${_t('Translate uses')}<small>${_t('Also the lyrics’ romanization and translation')}</small></span><select id="agTr">${opts(aiAgents.filter(usable), trId, _t('Same as Pony'))}</select></label>
      ${chat ? `<label class="row"><span class="lbl">${_t('Model for {name}', { name: esc(chat.name) })}<small>${_t('Empty: the agent’s own default. Any model name it knows (e.g. opus, gpt-5, gemini-3-pro).')}</small></span><input type="text" id="agModel" class="short" value="${esc(models[chat.id] || '')}" placeholder="${_t('default')}"></label>` : ''}
      <label class="row"><span class="lbl">${_t('Let Pony search the web')}<small>${_t('With Claude Code, its own web search; the other agents search when they see fit.')}</small></span><input type="checkbox" id="chWeb" ${S.chatWebSearch ? 'checked' : ''}></label>
      <label class="row"><span class="lbl">${_t('Share my day with Pony')}<small>${_t('The next 7 days of your calendar, open todos, weather, prayer times, Pomodoro and the stopwatch, today’s water, your launcher apps, how your Mac is doing and your sound and screen settings go with each message, so you can ask “what’s on today?”. They go to the agent you picked.')}</small></span><input type="checkbox" id="chCtx" ${S.chatContext !== false ? 'checked' : ''}></label>
    </div>
    <h2>${_t('Scheduled briefs')}</h2>
    <div class="group" id="briefs"></div>
    <p class="hint">${_t('On the days and at the time you pick, Sympony asks Pony your message by itself and opens Pony with the answer. If the Mac was asleep, the brief comes when it wakes, up to an hour late.')}</p>
    <p class="hint">${fa('lock')} ${_t('Your messages go to the agent you pick and, through it, to its company under your account. Sympony starts it in an empty folder in its read-only or plan mode, without your MCP servers, plugins or extensions, and keeps your chats on this Mac only. The agent may still read files on this Mac.')}</p>`;
  $$('[data-ag]', el).forEach((b) => {
    b.onclick = () => {
      const a = aiAgents.find((x) => x.id === b.dataset.ag);
      if (a && usable(a)) api.setSettings({ chatAgent: a.id });
      else if (a && !a.installed) api.openExternal(a.install);
    };
  });
  $$('[data-ext]', el).forEach((x) => { x.onclick = () => api.openExternal(x.dataset.ext); });
  $('#agRefresh', el).onclick = () => renderAi(el, true);
  $('#agChat', el).onchange = (e) => api.setSettings({ chatAgent: e.target.value });
  $('#agTr', el).onchange = (e) => api.setSettings({ translateAgent: e.target.value });
  const m = $('#agModel', el); if (m) m.onchange = (e) => api.setSettings({ agentModels: { ...models, [chat.id]: e.target.value.trim() } });
  $('#chCtx', el).onchange = (e) => api.setSettings({ chatContext: e.target.checked });
  $('#chWeb', el).onchange = (e) => api.setSettings({ chatWebSearch: e.target.checked });
  renderBriefs($('#briefs', el));
}

function renderGithub(el) {
  el.innerHTML += `<p class="lead">${_t('See pull requests waiting for your review (and optionally your own) right in Sympony.')}</p>
    <div class="group">
      <label class="row"><span class="lbl">${_t('GitHub module')}</span><input type="checkbox" id="ghOn" ${S.githubEnabled ? 'checked' : ''}></label>
      <div class="row"><span class="lbl">${_t('Personal access token')}<small>${S.has_githubToken ? `<span class="ok">● ${_t('Saved')}</span> ${keptHow()}` : _t('github.com → Settings → Developer settings → Fine-grained tokens. Read-only access to Pull requests is enough.')}</small></span>
        <span style="display:flex;gap:6px"><input type="password" id="ghTok" class="short" placeholder="${S.has_githubToken ? '••••••••••••' : 'github_pat_…'}"><button class="btn" id="ghSave">${_t('Save')}</button>${S.has_githubToken ? `<button class="btn danger" id="ghDel">${fa('trash-can')}</button>` : ''}</span></div>
      <label class="row"><span class="lbl">${_t('Also show pull requests I opened')}</span><input type="checkbox" id="ghMine" ${S.githubIncludeMine ? 'checked' : ''}></label>
    </div><p class="hint">${_t('Remember to enable the GitHub tab in <b>Modules</b>.')}</p>`;
  $('#ghOn', el).onchange = (e) => api.setSettings({ githubEnabled: e.target.checked });
  $('#ghMine', el).onchange = (e) => api.setSettings({ githubIncludeMine: e.target.checked });
  bindSecret(el, 'githubToken', 'ghTok', 'ghSave', 'ghDel');
}

// Settings → Media → VLC: the web interface's password, kept like the API keys
function renderVlcPassword(el) {
  el.innerHTML = `<div class="row"><span class="lbl">${_t('Password')}<small>${S.has_vlcPassword ? `<span class="ok">● ${_t('Saved')}</span> ${keptHow()}` : _t('The one set in VLC under Main interfaces → Lua')}</small></span>
    <span style="display:flex;gap:6px"><input type="password" id="vlcPw" class="short" placeholder="${S.has_vlcPassword ? '••••••••••••' : _t('password')}"><button class="btn" id="vlcPwSave">${_t('Save')}</button>${S.has_vlcPassword ? `<button class="btn danger" id="vlcPwDel">${fa('trash-can')}</button>` : ''}</span></div>`;
  bindSecret(el, 'vlcPassword', 'vlcPw', 'vlcPwSave', 'vlcPwDel');
}

// …and whether VLC answers with that password and port
async function renderVlcStatus(el) {
  if (!S.vlcWeb || !S.has_vlcPassword) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="row"><span class="lbl">${_t('Checking VLC…')}</span></div>`;
  const st = await api.svc('vlc', 'status').catch(() => null);
  if (!st || !el.isConnected) return;
  let msg;
  if (!st.open) msg = `${_t('VLC isn’t open')}<small>${_t('Open VLC to check the connection.')}</small>`;
  else if (st.ok) msg = _t('<span class="ok">● Connected</span> to VLC {version}', { version: esc(String(st.version || '').split(' ')[0]) });
  else if (st.reason === 'password') msg = `${_t('VLC turned the password down')}<small>${_t('Enter the one set in VLC under Main interfaces → Lua.')}</small>`;
  else if (st.reason === 'noanswer') msg = `${_t('No answer from VLC on port {port}', { port: esc(st.port) })}<small>${_t('Tick Web in VLC (see above) and restart VLC, or check the port.')}</small>`;
  else msg = `${_t('VLC’s web interface didn’t answer as expected')}<small>${esc(st.error || '')}</small>`;
  el.innerHTML = `<div class="row"><span class="lbl">${msg}</span><button class="btn" id="vlcCheck">${_t('Check again')}</button></div>`;
  $('#vlcCheck', el).onclick = () => renderVlcStatus(el);
}

// Settings → Todo → Sync with: the account, the list and how the last sync went (tasksync.rs). The state comes
// with the "todosync" event; the lists are asked for once per account.
let tsState = null;
let tsLists = { key: '', items: null, error: '' };
async function renderTodoSync(el) {
  renderTodoSync.el = el;
  if (!S.todoSync || S.todoSync === 'off') { el.innerHTML = ''; return; }
  if (!tsState || tsState.provider !== S.todoSync) tsState = await api.svc('todosync', 'state').catch(() => null);
  paintTodoSync();
}
function paintTodoSync() {
  const el = renderTodoSync.el;
  const p = S.todoSync;
  if (!el || !el.isConnected) return;
  if (!p || p === 'off' || !tsState) { el.innerHTML = ''; return; }
  const st = tsState;
  const name = p === 'google' ? 'Google Tasks' : 'Microsoft To Do';
  const red = (t) => `<span style="color:#ff453a">${esc(t)}</span>`;
  // a build without its own app registration: paste a client ID here to try one (shown while there's none, or
  // to change the one pasted)
  const keys = p === 'google' ? ['todoSyncGoogleClientId', 'todoSyncGoogleClientSecret'] : ['todoSyncMsClientId'];
  const idRow = (k, label, sub, ph) => `<label class="row"><span class="lbl">${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="text" class="wide" data-ts="${k}" value="${esc(S[k] || '')}" placeholder="${esc(ph)}"></label>`;
  const ids = (st.builtIn || {})[p] || ((st.ready || {})[p] && !keys.some((k) => S[k])) ? '' : p === 'google'
    ? idRow(keys[0], _t('Client ID'), _t('From the “Desktop app” OAuth client in Google Cloud'), '….apps.googleusercontent.com') + idRow(keys[1], _t('Client secret'), '', 'GOCSPX-…')
    : idRow(keys[0], _t('Application (client) ID'), _t('From the app registration in Microsoft Entra (Azure)'), '00000000-0000-0000-0000-000000000000');
  let html;
  let lists = [];
  if (!(st.ready || {})[p]) html = `<div class="row"><span class="lbl">${_t('{name} isn’t set up in this build', { name })}<small>${_t('It needs an app registration (a client ID) first.')}</small></span></div>`;
  else if (st.signingIn) html = `<div class="row"><span class="lbl">${_t('Waiting for the browser…')}<small>${_t('Sign in there and let Sympony see and edit your tasks.')}</small></span><button class="btn" id="tsCancel">${_t('Cancel')}</button></div>`;
  else if (!st.signedIn) html = `<div class="row"><span class="lbl">${_t('Account')}<small>${st.error ? red(st.error) : _t('Sign in to {name} in your browser.', { name })}</small></span><button class="btn primary" id="tsIn">${_t('Sign in')}</button></div>`;
  else {
    const key = `${p}|${st.account || ''}`;
    if (tsLists.key !== key) {
      tsLists = { key, items: null, error: '' };
      api.svc('todosync', 'lists').then((l) => { if (tsLists.key === key) { tsLists.items = l; paintTodoSync(); } })
        .catch((e) => { if (tsLists.key === key) { tsLists.error = String(e); paintTodoSync(); } });
    }
    const cur = st.list || null;
    lists = tsLists.items || [];
    const opts = (cur ? '' : `<option value="" selected>${_t('Choose a list…')}</option>`)
      + lists.map((l) => `<option value="${esc(l.id)}" ${cur && cur.id === l.id ? 'selected' : ''}>${esc(l.name || _t('Untitled'))}</option>`).join('')
      + (cur && !lists.some((l) => l.id === cur.id) ? `<option value="${esc(cur.id)}" selected>${esc(cur.name)}</option>` : '')
      + (tsLists.items && !tsLists.items.some((l) => l.name === 'Sympony') ? `<option value="+">${_t('New list “Sympony”')}</option>` : '');
    const last = st.last ? new Date(st.last) : null;
    const when = last ? (last.toDateString() === new Date().toDateString() ? '' : last.toLocaleDateString(_tLocale(), { day: 'numeric', month: 'short' }) + ' ')
      + last.toLocaleTimeString(_tLocale(), { hour: '2-digit', minute: '2-digit', hour12: !S.clock24h }) : '';
    html = `<div class="row"><span class="lbl">${_t('Account')}<small>${esc(st.account || _t('Signed in'))}</small></span><button class="btn" id="tsOut">${_t('Sign out')}</button></div>
      <label class="row"><span class="lbl">${_t('List')}<small>${tsLists.error ? red(tsLists.error) : tsLists.items ? _t('Your tasks here and this list are kept the same.') : _t('Loading your lists…')}</small></span><select id="tsList">${opts}</select></label>
      ${cur ? `<div class="row"><span class="lbl">${st.syncing ? _t('Syncing…') : st.error ? _t('The last sync didn’t work') : when ? _t('Synced {when}', { when }) : _t('Not synced yet')}<small>${st.error ? red(st.error) : _t('Every 5 minutes, and soon after you change a task.')}</small></span><button class="btn" id="tsNow" ${st.syncing ? 'disabled' : ''}>${fa('arrows-rotate')} ${_t('Sync now')}</button></div>` : ''}`;
  }
  el.innerHTML = html + ids;
  const run = (m, ...a) => api.svc('todosync', m, ...a).then((v) => { tsState = v; paintTodoSync(); })
    .catch((e) => { tsState = { ...tsState, error: String(e) }; paintTodoSync(); });
  const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
  on('tsIn', () => run('signIn'));
  on('tsCancel', () => run('cancel'));
  on('tsOut', () => { tsLists = { key: '', items: null, error: '' }; run('signOut'); });
  on('tsNow', () => run('syncNow'));
  const sel = $('#tsList', el);
  if (sel) sel.onchange = () => {
    if (sel.value === '+') { tsLists = { key: '', items: null, error: '' }; run('newList'); return; }
    const l = lists.find((x) => x.id === sel.value);
    if (sel.value) run('setList', sel.value, l ? l.name : '');
  };
  $$('[data-ts]', el).forEach((i) => { i.onchange = () => api.setSettings({ [i.dataset.ts]: i.value.trim() }); });
}

// API key / token fields. The value is saved as soon as you leave the field or press Enter, not only on
// Save: changing another field re-renders the page, and a re-render between the Save button's mousedown
// and click used to drop both the typed key and the click.
function bindSecret(el, key, inputId, saveId, delId) {
  const input = $('#' + inputId, el);
  const save = () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    input.placeholder = `•••••••••••• ${_t('(saved)')}`;
    api.setSecret(key, v);
  };
  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  $('#' + saveId, el).onclick = save;
  const del = $('#' + delId, el); if (del) del.onclick = () => api.setSecret(key, '');
}

// Release notes ("- New: …" lines, as the releases carry them) as a list, the kind of change in bold
const RELEASE_NOTES_URL = 'https://github.com/rheynoapria/sympony-ai/releases';
const ENLABS_URL = 'https://enlabs.my.id';
const REPO_URL = 'https://github.com/rheynoapria/sympony-ai';
function notesHtml(md) {
  return String(md || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => {
    const t = l.slice(2); const m = t.match(/^(New|Changed|Fixed|Improved|Removed):\s*/i);
    return `<li>${m ? `<b>${esc(m[1])}</b> ` : ''}${esc(m ? t.slice(m[0].length) : t)}</li>`;
  }).join('');
}

// What's new in the version that's running (the notch points here after an update), with a quiet line about
async function renderWhatsNew(box) {
  const w = await api.svc('update', 'whatsNew').catch(() => null);
  if (!w || !box.isConnected) return;
  const list = notesHtml(w.notes);
  box.innerHTML = `<h2>${_t('What’s new in v{version}', { version: esc(w.version) })}</h2><div class="group whats-new">
      ${list ? `<div class="row notes-row"><ul class="notes">${list}</ul></div>` : ''}
      <div class="row"><span class="lbl">${_t('All changes')}<small>${list ? _t('Every version’s notes on GitHub') : _t('This version’s notes are on GitHub')}</small></span><button class="btn" id="wnAll">${fa('up-right-from-square')} ${_t('Release notes')}</button></div>
    </div>`;
  $('#wnAll', box).onclick = () => api.openExternal(RELEASE_NOTES_URL);
}

function renderAbout(el) {
  el.innerHTML += `<p class="lead">${_t('Your desktop notch AI companion.')} — ${_t('A product by Enlabs')} · © 2026 Enlabs</p><div id="whatsNew"></div>`;
  el.innerHTML += `<h2>${_t('Info')}</h2>
    <div class="group">
      <div class="row"><span class="lbl">${_t('Version')}</span><span>v${esc(info.version)}</span></div>
      <div class="row"><span class="lbl">${_t('Publisher')}<small>© 2026 Enlabs</small></span><button class="btn" id="enlabsWeb">${fa('up-right-from-square')} enlabs.my.id</button></div>
      <div class="row"><span class="lbl">${_t('License')}<small>GPL-3.0-only</small></span><button class="btn" id="sympRepo">${fa('up-right-from-square')} GitHub</button></div>
      <div class="row"><span class="lbl">${_t('Data folder')}<small>${_t('settings, shelf, todo, notes, health, screen time')}</small></span><span class="hint">${esc(info.userData)}</span></div>
      <div class="row"><span class="lbl">${_t('Icons')}</span><span class="hint">${_t('Font Awesome Free 6 & Fluent UI Icons, bundled locally')}</span></div>
      <div class="row"><span class="lbl">${_t('Weather data')}</span><span class="hint">Open-Meteo.com (CC BY 4.0)</span></div>
    </div>
    <div class="row-actions"><button class="btn" id="reset">${fa('rotate-left')} ${_t('Reset all settings')}</button><button class="btn danger" id="quit">${fa('power-off')} ${_t('Quit Sympony')}</button></div>`;
  renderBackup(el);
  $('#enlabsWeb', el).onclick = () => api.openExternal(ENLABS_URL);
  $('#sympRepo', el).onclick = () => api.openExternal(REPO_URL);
  $('#reset', el).onclick = async () => { if (confirm(_t('Reset all settings to defaults? Calendars, local events and API keys will be removed.'))) { S = await api.resetSettings(); refresh(); } };
  $('#quit', el).onclick = () => api.quit();
  renderWhatsNew($('#whatsNew', el));
}

// ------------------------------------------------------------------ back up and restore (backup.rs)
// Export writes one .sympony file; Import shows what a file holds and asks before it replaces anything (then
// Sympony restarts, and opens About again with the line about the last import).
// (kept outside the page, which is drawn again whenever a setting changes)
const bk = { saved: null, saveError: '', peek: null, error: '', busy: false, done: null };
function renderBackup(el) {
  el.insertAdjacentHTML('beforeend', `<h2>${_t('Back up and restore')}</h2><div class="group" id="bkGroup"></div>`);
  const g = $('#bkGroup', el);
  const size = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const when = (ms) => new Date(ms).toLocaleString(_tLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  const holds = (c) => [
    [c.tasks, _t('{n} task', { n: c.tasks }), _t('{n} tasks', { n: c.tasks })], [c.notes, _t('{n} note', { n: c.notes }), _t('{n} notes', { n: c.notes })],
    [c.chats, _t('{n} AI chat', { n: c.chats }), _t('{n} AI chats', { n: c.chats })], [c.bookmarks, _t('{n} bookmark', { n: c.bookmarks }), _t('{n} bookmarks', { n: c.bookmarks })],
    [c.radio, _t('{n} radio favourite', { n: c.radio }), _t('{n} radio favourites', { n: c.radio })], [c.dock, _t('{n} Dock item', { n: c.dock }), _t('{n} Dock items', { n: c.dock })],
    [c.launcher, _t('{n} launcher app', { n: c.launcher }), _t('{n} launcher apps', { n: c.launcher })], [c.events, _t('{n} event', { n: c.events }), _t('{n} events', { n: c.events })],
    [c.calendars, _t('{n} calendar link', { n: c.calendars }), _t('{n} calendar links', { n: c.calendars })], [c.briefs, _t('{n} scheduled brief', { n: c.briefs }), _t('{n} scheduled briefs', { n: c.briefs })], [c.files, _t('{n} file', { n: c.files }), _t('{n} files', { n: c.files })],
  ].filter(([n]) => n > 0).map(([n, one, many]) => (n === 1 ? one : many)).concat(_t('all settings')).join(' · ');
  const paint = () => {
    if (bk.done) { g.innerHTML = `<div class="row"><span class="lbl">${_t('Imported. Sympony is restarting…')}<small>${_t('The data from before is in {path}', { path: esc(bk.done.copy) })}</small></span></div>`; return; }
    const last = S.backupImported;
    const exportSub = bk.saved ? _t('Saved <b>{name}</b> ({size}).', { name: esc(bk.saved.name), size: size(bk.saved.size) })
      : bk.saveError ? `<span class="err">${esc(bk.saveError)}</span>`
      : MAC ? _t('Settings, tasks, notes, AI chats, bookmarks, radio favourites, launcher items, your own events and calendar links, scheduled briefs, health, Pomodoro and screen time history, Teleprompter scripts and the adhan you picked, in one .sympony file. Not in it: API keys and passwords (they’re locked to this Mac, so enter them again on the other one), Todo sync’s sign-in, the Shelf, the clipboard history and the notification history. The file isn’t encrypted, so keep it to yourself.')
      : _t('Settings, tasks, notes, AI chats, bookmarks, radio favourites, Dock and launcher items, your own events and calendar links, health, Pomodoro and screen time history, and the adhan and Dock icons you picked, in one .sympony file. Not in it: API keys and passwords (they’re locked to this PC, so enter them again on the other one), Todo sync’s sign-in, the Shelf and the notification history. The file isn’t encrypted, so keep it to yourself.');
    let importRow;
    if (bk.peek) {
      const from = bk.peek.pc ? _t('From {date} on {pc}', { date: esc(when(bk.peek.created)), pc: esc(bk.peek.pc) }) : _t('From {date}', { date: esc(when(bk.peek.created)) });
      importRow = `<div class="row"><span class="lbl">${_t('Import this backup?')}<small>${from}${bk.peek.app ? `, Sympony ${esc(bk.peek.app)}` : ''}: ${esc(holds(bk.peek.counts || {}))}.<br>
        ${_t('It replaces Sympony’s settings and data on this PC. A copy of the current data is kept first (a before-import folder in the data folder), API keys on this PC stay, and Sympony restarts.')}</small></span>
        <span style="display:flex;gap:6px"><button class="btn" id="bkNo" ${bk.busy ? 'disabled' : ''}>${_t('Cancel')}</button><button class="btn primary" id="bkYes" ${bk.busy ? 'disabled' : ''}>${fa(bk.busy ? 'spinner fa-spin' : 'rotate')} ${_t('Import and restart')}</button></span></div>`;
    } else {
      importRow = `<div class="row"><span class="lbl">${_t('Import')}<small>${bk.error ? `<span class="err">${esc(bk.error)}</span>` : _t('Puts a backup’s settings and data in place of this PC’s, for example on a new PC. You see what’s in it and confirm first.')}</small></span>
        <button class="btn" id="bkImport">${fa('file-import')} ${_t('Import…')}</button></div>`;
    }
    const lastMade = last && last.at ? (last.pc ? _t('The backup was made {date} on {pc}.', { date: esc(when(last.created || last.at)), pc: esc(last.pc) }) : _t('The backup was made {date}.', { date: esc(when(last.created || last.at)) })) : '';
    g.innerHTML = `<div class="row"><span class="lbl">${_t('Export')}<small>${exportSub}</small></span><span style="display:flex;gap:6px">${bk.saved ? `<button class="btn" id="bkShow">${fa('folder-open')} ${_t('Show in folder')}</button>` : ''}<button class="btn" id="bkExport">${fa('file-export')} ${_t('Export…')}</button></span></div>
      ${importRow}
      ${last && last.at ? `<div class="row"><span class="lbl">${_t('Last import: {date}', { date: esc(when(last.at)) })}<small>${lastMade} ${_t('Sympony’s data from before the import is in {path}', { path: esc(last.copy || '') })}</small></span>${last.copy ? `<button class="btn" id="bkCopy">${fa('folder-open')} ${_t('Show')}</button>` : ''}</div>` : ''}`;
    const on = (id, fn) => { const b = $(id, g); if (b) b.onclick = fn; };
    on('#bkExport', async () => {
      // (one at a time)
      if (bk.exporting) return;
      bk.exporting = true;
      bk.saveError = '';
      const r = await api.svc('backup', 'export').catch((e) => ({ ok: false, message: String(e) }));
      bk.exporting = false;
      if (r && r.ok) bk.saved = r; else if (r) { bk.saved = null; bk.saveError = r.message || _t('Couldn’t save the backup'); }
      paint();
    });
    on('#bkShow', () => api.svc('actions', 'reveal', bk.saved.path));
    on('#bkCopy', () => api.svc('actions', 'reveal', last.copy));
    on('#bkImport', async () => {
      bk.error = '';
      const r = await api.svc('backup', 'open').catch((e) => ({ ok: false, message: String(e) }));
      if (r && r.ok) bk.peek = r; else if (r && !r.cancelled) bk.error = r.message || _t('That file can’t be read');
      paint();
    });
    on('#bkNo', () => { bk.peek = null; paint(); });
    on('#bkYes', async () => {
      bk.busy = true; paint();
      const r = await api.svc('backup', 'import', bk.peek.path).catch((e) => ({ ok: false, message: String(e) }));
      bk.busy = false;
      // done: Sympony restarts in a moment (this window with it)
      if (r && r.ok) { bk.done = r; bk.peek = null; paint(); return; }
      bk.peek = null; bk.error = (r && r.message) || _t('The import didn’t work');
      paint();
    });
  };
  paint();
}

// ------------------------------------------------------------------ live helper data (HUD, battery, bluetooth)
function paintHelper() {
  const v = helper.volume; const b = helper.brightness;
  const tv = $('#tryVol'); const tb = $('#tryBri');
  if (tv && v) { if (document.activeElement !== tv) tv.value = v.level; $('#tryVolOut').textContent = v.muted ? _t('muted') : v.level; }
  if (tb && b) { tb.disabled = !b.supported; if (document.activeElement !== tb) tb.value = Math.max(0, b.level); $('#tryBriOut').textContent = b.supported ? b.level : _t('n/a'); }
  renderBattery();
  renderBt();
}
function renderBattery() {
  const el = $('#batteryInfo'); const p = helper.power;
  if (!el || !p) return;
  el.textContent = p.hasBattery ? `${_t('Battery: {level}%', { level: p.level })} · ${p.pluggedIn ? _t('plugged in') : _t('on battery')}${p.saver ? ' · ' + _t('battery saver on') : ''}` : _t('No battery detected (desktop PC). The battery indicator stays hidden.');
}
function renderBt() {
  const el = $('#btList'); const b = helper.bluetooth;
  if (!el) return;
  const devs = (b && b.devices) || [];
  el.innerHTML = devs.map((d) => `<div class="li ${d.connected ? '' : 'off'}"><span class="ico">${fa('bluetooth-b', 'brands')}</span><div class="grow"><b>${esc(d.name)}</b><small>${d.connected ? _t('Connected') : _t('Not connected')} · ${esc(d.kind)}</small></div><span>${d.battery >= 0 ? d.battery + '%' : ''}</span></div>`).join('')
    || `<p class="hint">${_t('No paired devices found.')}</p>`;
}

api.onHelper((m) => { helper[m.type] = m; paintHelper(); if (m.type === 'prayer') paintPrayer(); });
api.onCalendar(({ errors }) => { calErrors = errors || {}; const st = $('#calStatus'); if (st) st.textContent = Object.keys(calErrors).length ? _t('{n} feed error(s)', { n: Object.keys(calErrors).length }) : _t('Up to date'); });
api.onSettingsSection((sec) => { show.keepScroll = false; show(sec); });
// (while Detect is finding the place, the page is drawn once when it's done, not also for the settings it saves)
// settings a row shows the change of itself (smoothly): saving one of them doesn't draw the page again
const QUIET_KEYS = new Set(['mediaColors']);
api.onSettings((s) => {
  const quiet = Object.keys(s).every((k) => QUIET_KEYS.has(k) || JSON.stringify(s[k]) === JSON.stringify(S[k]));
  S = s;
  // (a moment later, once: a switch finishes sliding before the page is drawn again, and changes in a row are one)
  if (!locating.busy && !quiet) { clearTimeout(refresh.timer); refresh.timer = setTimeout(refresh, 260); }
});
api.on('todosync', (v) => { tsState = v; paintTodoSync(); });

(async () => {
  S = await api.getSettings();
  info = await api.appInfo();
  info.displays = await api.listDisplays();
  $('#ver').textContent = 'v' + info.version;
  buildNav();
  initSearch();
  show(location.hash.slice(1) || 'general');
  helper = await api.helperState();
  paintHelper();
  paintPrayer();
  api.requestCalendar();
  api.log(`settings page ready (${document.querySelectorAll('#nav a').length} sections, showing ${current})`);
})();
