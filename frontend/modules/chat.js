// AI Chat: talk to Gemini (a free API key from Google AI Studio), Claude, any OpenAI-compatible API or a
// local Ollama model, right in Sympony. Conversations stay on this PC (chats.json); "New chat" starts another
// one and History opens the earlier ones. The Cat Buddy's bubble talks in the same conversation (N.chat).
(function () {
  const { api, st, $, $$, esc, fa } = N;
  /* global MODULE_TITLES */
  const MAX_CHATS = 40;
  const me = Math.random().toString(36).slice(2); // this window, to skip our own saves coming back
  let page;
  let chats = { current: null, list: [] }; // list: [{ id, title, updated, msgs }]
  let msgs = []; // the open conversation: { role: 'user' | 'assistant', content, error?, actions? }
  let pending = false;
  let searching = ''; // what Sympony is searching the web for, while an answer waits on it
  let history = false; // the History list is showing
  let activeAsk = null; // Pony ask_user card item waiting on an answer
  let queuedAnswer = null; // { text, qa } if answered while the asking turn is still closing
  let lastRenderSig = '';
  const listeners = new Set(); // the cat's bubble
  const changed = () => { render(); for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const titleOf = (list) => ((list.find((m) => m.role === 'user') || {}).content || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60);

  function clearActiveAsk() {
    if (!activeAsk) return;
    const oldId = activeAsk.id;
    activeAsk = null;
    queuedAnswer = null;
    if (N.removePonyAsk) N.removePonyAsk(oldId);
  }

  function save() {
    const keep = msgs.filter((m) => !m.error).slice(-80);
    let c = chats.list.find((x) => x.id === chats.current);
    if (!c && keep.length) { c = { id: newId(), title: '', updated: 0, msgs: [] }; chats.list.unshift(c); chats.current = c.id; }
    if (c) { c.msgs = keep; c.updated = Date.now(); c.title = titleOf(keep); }
    chats.list = chats.list.filter((x) => x.msgs && x.msgs.length).sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
    api.svc('store', 'set', 'chats', { ...chats, by: me });
  }
  function open(id) {
    clearActiveAsk();
    chats.current = id;
    msgs = ((chats.list.find((x) => x.id === id) || {}).msgs || []).slice();
    history = false;
    api.svc('store', 'set', 'chats', { ...chats, by: me });
    changed();
  }
  function newChat() {
    clearActiveAsk();
    chats.current = null;
    msgs = [];
    history = false;
    api.svc('store', 'set', 'chats', { ...chats, by: me });
    changed();
  }
  // The conversation just deleted: its row in History says so with an Undo for a few seconds (until the list closes)
  let deleted = null; // { chat, at (its place in the list), current (it was the open one), timer }
  function removeChat(id) {
    const at = chats.list.findIndex((x) => x.id === id);
    if (at < 0) return;
    dropDeleted();
    // gone after 6 s: just that row, so the list stays scrolled where it is
    const timer = setTimeout(() => { dropDeleted(); const row = page && $('.ch-hist-row.gone', page); if (row) row.remove(); }, 6000);
    deleted = { chat: chats.list[at], at, current: chats.current === id, timer };
    chats.list = chats.list.filter((x) => x.id !== id);
    if (chats.current === id) { chats.current = null; msgs = []; }
    api.svc('store', 'set', 'chats', { ...chats, by: me });
    changed();
  }
  // Undo: back in its place in the list (and the open one again if it was, unless another one was started), saved
  function undoRemove() {
    const d = deleted;
    if (!d) return;
    dropDeleted();
    if (!chats.list.some((x) => x.id === d.chat.id)) chats.list.splice(Math.min(d.at, chats.list.length), 0, d.chat);
    if (d.current && !chats.current && !pending) { chats.current = d.chat.id; msgs = (d.chat.msgs || []).slice(); }
    api.svc('store', 'set', 'chats', { ...chats, by: me });
    changed();
  }
  function dropDeleted() { if (deleted) { clearTimeout(deleted.timer); deleted = null; } }
  // History's rows, with the Undo row of the one just deleted in its place
  function withUndo(rows) {
    if (deleted) rows.splice(Math.min(deleted.at, rows.length), 0, `<div class="ch-hist-row gone"><span class="t">${_t('Conversation deleted')}</span><button data-restore>${_t('Undo')}</button></div>`);
    return rows;
  }
  // Load the saved conversations (and the single chat earlier test builds kept in localStorage).
  (async () => {
    const v = await api.svc('store', 'get', 'chats').catch(() => null);
    if (v && Array.isArray(v.list)) chats = { current: v.current, list: v.list };
    try {
      const old = JSON.parse(localStorage.getItem('sympony.chat') || '[]').filter((m) => m && m.content && !m.error);
      if (old.length && !chats.list.length) { msgs = old; save(); }
      localStorage.removeItem('sympony.chat');
    } catch (e) { /* storage off */ }
    if (!pending) msgs = ((chats.list.find((x) => x.id === chats.current) || {}).msgs || []).slice();
    changed();
  })();
  // another window (notch or floating chat) saved: follow it (unless this one is waiting for an answer)
  api.on('store:chats', (v) => {
    if (!v || v.by === me || pending) return;
    const list = Array.isArray(v.list) ? v.list : [];
    const cur = v.current !== undefined ? v.current : chats.current;
    chats = { current: cur, list };
    msgs = ((chats.list.find((x) => x.id === chats.current) || {}).msgs || []).slice();
    lastRenderSig = '';
    changed();
  });
  // main is searching the web before it answers (Settings → Let AI Chat search the web): the window that asked says so
  api.on('chat:searching', (q) => {
    if (!pending) return;
    searching = String(q || '');
    changed();
  });

  const SUGGEST = [
    ['calendar-day', _t('What’s on today, and when am I free?'), 'var(--amber)'],
    ['bell', _t('Remind me in 15 minutes to stretch'), 'var(--lav)'],
    ['cloud-sun', _t('Will it rain this afternoon?'), 'var(--sky)'],
    ['envelope', _t('Write a short, polite email asking for a meeting next week'), 'var(--lilac)'],
  ];

  const isLocalServerUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(String(u || '').trim());

  // What the chat is using, and whether it's ready (a key / server set).
  function provider() {
    const s = st.settings || {};
    if (s.ponyBrain === 'sympony') return s.has_symponyAiKey ? { label: _t('Sympony AI'), ready: true } : { label: _t('Sympony AI'), ready: false, need: _t('a sign-in to Sympony AI') };
    if (s.ponyBrain === 'api') {
      const local = isLocalServerUrl(s.brainUrl);
      return s.brainUrl && (s.has_brainKey || local)
        ? { label: s.brainModel || (local ? _t('Local AI') : _t('AI server')), ready: true }
        : { label: _t('AI server'), ready: false, need: _t('your AI server and its key') };
    }
    const a = N.aiAgent('chatAgent');
    if (a === undefined) { N.loadAgents().then(changed); return { label: '…', ready: true }; }
    return a ? { label: N.aiLabel(a), ready: true } : { label: _t('No AI agent'), ready: false, need: N.MAC ? _t('an AI agent on this Mac (Claude Code, Codex, Antigravity…)') : _t('an AI agent on this PC (Claude Code, Codex, Antigravity…)') };
  }

  // ---- what the assistant knows about your day: sent along with each message (Settings → AI can turn it
  // off). Plain lines, 24-hour times, a few items each, so it stays small.
  let launcher = null;
  async function dayContext() {
    const s = st.settings;
    if (s.chatContext === false) return '';
    // the PC's numbers (below), asked for first: read fresh when nothing shows the stats, which takes a moment
    const pcNow = api.svc('stats', 'now').catch(() => null);
    const now = Date.now();
    const t24 = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const day = (t) => {
      const d = new Date(t); const tom = new Date(); tom.setDate(tom.getDate() + 1);
      return d.toDateString() === new Date().toDateString() ? 'today' : d.toDateString() === tom.toDateString() ? 'tomorrow'
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    const lines = [];
    if (s.calendarEnabled) {
      const end = new Date(); end.setDate(end.getDate() + 7); end.setHours(0, 0, 0, 0);
      const evs = (st.events || []).filter((e) => e.end > now && e.start < end.getTime()).slice(0, 20);
      lines.push('Calendar, now until the end of the next 7 days: ' + (evs.length
        ? evs.map((e) => `${day(e.start)} ${e.allDay ? 'all day' : `${t24(e.start)}-${t24(e.end)}`} ${e.title}${e.location ? ` (${e.location})` : ''}`).join('; ')
        : 'nothing'));
    }
    // the ones with a time still to come first, soonest first (a reminder weeks ahead is still listed, so the model has
    // its ID and doesn't make one up), then the rest, newest first
    const open = ((N.data.todo || {}).items || []).filter((t) => !t.done && !t.deletedAt);
    const todos = [...open.filter((t) => t.due > now).sort((a, b) => a.due - b.due), ...open.filter((t) => !(t.due > now))];
    const lateLimit = (m) => (m ? `ticked off by itself ${m}m after its time` : 'kept until ticked off');
    lines.push('Open todos: ' + (todos.length ? todos.slice(0, 40).map((t) => `[${t.id}] ${t.text}${t.due ? ` (due ${day(t.due)} ${t24(t.due)})` : ''}${t.repeat ? ` (repeats ${N.repeatLabel(t.repeat)})` : ''}${t.lateMin != null ? ` (if late: ${lateLimit(+t.lateMin)})` : ''}`).join('; ') : 'none')
      + `. Late tasks without their own choice: ${lateLimit(+s.todoLateMinutes || 0)}`);
    const mine = (s.localEvents || []).filter((e) => (e.end || e.start) > now).sort((a, b) => a.start - b.start).slice(0, 30);
    if (mine.length) lines.push('Events added in Sympony (these can be changed): ' + mine.map((e) => `[${e.id}] ${day(e.start)} ${t24(e.start)} ${e.title} (${Math.round((e.end - e.start) / 60000)}m)`).join('; '));
    const w = N.data.weather;
    if (s.weatherEnabled && w && w.current) {
      const label = (c) => (window.weatherLabel ? window.weatherLabel(c) : '');
      const u = w.unit || '°';
      const rain = (pop) => (pop != null ? `, rain chance ${pop}%` : '');
      const today = (w.daily || [])[0]; const tom = (w.daily || [])[1];
      lines.push(`Weather in ${(w.location || {}).name || 'their city'}: now ${Math.round(w.current.temp)}${u} ${label(w.current.code)}`
        + (today ? `; today ${Math.round(today.min)}-${Math.round(today.max)}${u}${rain(today.pop)}` : '')
        + ((w.hourly || []).length ? `; next hours ${w.hourly.slice(0, 6).map((h) => `${t24(h.time)} ${Math.round(h.temp)}°${h.pop != null ? ` ${h.pop}% rain` : ''}`).join(', ')}` : '')
        + (tom ? `; tomorrow ${label(tom.code)} ${Math.round(tom.min)}-${Math.round(tom.max)}${u}${rain(tom.pop)}` : ''));
    }
    if (s.prayerEnabled && N.prayerTimes) {
      const pr = N.prayerTimes().filter((t) => t.at > now - 3 * 3600000).slice(0, 6);
      if (pr.length) lines.push(`Prayer times (${(st.prayer || {}).source || ''}): ${pr.map((t) => `${t.name} ${day(t.at)} ${t24(t.at)}`).join(', ')}`);
    } else if (!s.prayerEnabled) {
      // off by default: without this the model guesses times when asked for today's prayer schedule
      // (the page's name as their Settings shows it)
      lines.push(`Prayer times: Sympony’s Prayer Times feature is off, so today’s times aren’t known here. If asked about prayer times (jadwal shalat), say so and that they can turn it on in ${_t('Settings')} → ${_t('Prayer Times')} and pick their city there to see today’s times and get reminders; don’t guess or make up times.`);
    }
    const p = st.pomodoro;
    if (p) lines.push(`Pomodoro: ${p.running ? `${p.phase === 'work' ? 'focus' : 'break'} running, ${Math.max(1, Math.ceil((p.endsAt - now) / 60000))} min left` : 'not running'}; focus ${s.pomoWork} min, break ${s.pomoShort} min`);
    if (N.swElapsed && N.swElapsed() > 0) {
      const sec = Math.floor(N.swElapsed() / 1000);
      const hms = `${Math.floor(sec / 3600) ? Math.floor(sec / 3600) + 'h ' : ''}${Math.floor(sec / 60) % 60}m ${sec % 60}s`;
      lines.push(`Stopwatch (Pomodoro tab): ${N.swRunning() ? 'running' : 'paused'} at ${hms}`);
    }
    const h = N.data.health;
    if (s.healthEnabled !== false && h && h.today) {
      const g = h.goals || {};
      lines.push(`Health today: ${h.today.water || 0} of ${g.water || 8} glasses of water, ${h.today.breaks || 0} of ${g.breaks || 6} breaks; `
        + `water reminders ${s.healthWaterReminders ? `on, every ${s.healthWaterInterval || 60} min at the PC` : 'off'}`);
    }
    if (!launcher) launcher = await api.svc('launcher', 'list').catch(() => []);
    if ((launcher || []).length) lines.push('Apps in the launcher: ' + launcher.map((a) => a.name).join(', '));
    // the Bookmarks tab: how many, and its categories (for [[bookmark: …]])
    if (N.bookmarks && (s.modules || []).some((m) => m.id === 'bookmarks' && m.on)) {
      const cs = N.bookmarks.cats();
      lines.push(`Bookmarks: ${N.bookmarks.items().length} saved; categories: ${cs.length ? cs.join(', ') : 'none yet'}`);
    }
    // the PC itself, as the System tab shows it (the temperature is the sensor Windows shares, Settings →
    // System Monitor picks which). Main hands out its latest reading, or reads once when nothing shows the stats.
    const ps = (await pcNow) || st.stats;
    if (ps) {
      const gb = (b) => (b / 1e9).toFixed(1) + ' GB';
      const parts = [`CPU ${Math.round(ps.cpu * 100)}% busy${ps.cpuModel ? ` (${ps.cpuModel.replace(/\((R|TM)\)/g, '').replace(/\s+/g, ' ').trim()})` : ''}`];
      if (ps.memTotal) parts.push(`memory ${Math.round((1 - ps.memFree / ps.memTotal) * 100)}% used (${gb(ps.memTotal - ps.memFree)} of ${gb(ps.memTotal)})`);
      if (ps.disk) parts.push(`system disk ${gb(ps.disk.free)} free of ${gb(ps.disk.total)}`);
      parts.push(ps.temp ? `CPU-area temperature ${Math.round(ps.temp.c)} °C (from a board / CPU-area sensor Windows shares, not a per-core reading)` : 'CPU temperature: this PC shares none with apps');
      if (ps.gpu) parts.push(`GPU ${Math.round(ps.gpu.use * 100)}% busy${ps.gpu.c ? `, ${Math.round(ps.gpu.c)} °C` : ', no GPU temperature shared'}`);
      if (ps.fps) parts.push(`the game in front runs at ${Math.round(ps.fps.fps)} FPS (${ps.fps.app || 'game'})`);
      parts.push(ps.wifi ? `Wi-Fi "${ps.wifi.ssid || '?'}", signal ${ps.wifi.quality}%` : st.wired ? 'on a network cable (LAN)' : 'not on Wi-Fi');
      if (st.radios && st.radios.airplane === true) parts.push('airplane mode is on');
      lines.push('This PC right now: ' + parts.join('; '));
    }
    const pw = st.power;
    if (pw && pw.hasBattery) lines.push(`Battery: ${pw.level}%${pw.pluggedIn ? ', plugged in' : ''}`);
    // sound and screen, as the Control tab shows them
    const sound = [];
    if (st.volume) sound.push(`volume ${st.volume.level}%${st.volume.muted ? ' (muted)' : ''}`);
    const [outs, mics] = await Promise.all([api.svc('audio', 'devices', false).catch(() => []), api.svc('audio', 'devices', true).catch(() => [])]);
    const cur = (l) => ((l || []).find((d) => d.default) || {}).name;
    if (cur(outs)) sound.push(`sound plays on "${cur(outs)}"`);
    if (cur(mics)) sound.push(`microphone "${cur(mics)}"${st.mic && st.mic.muted ? ' (muted)' : ''}`);
    if (st.brightness) sound.push(st.brightness.supported ? `screen brightness ${st.brightness.level}%` : 'brightness can\'t be changed from apps on this screen');
    if (sound.length) lines.push('Sound and screen: ' + sound.join('; '));
    if (s.dockEnabled) lines.push(`Sympony's Dock is on${s.dockHideTaskbar ? ' and the Windows taskbar is hidden' : ''}`);
    return lines.join('\n');
  }

  // ---- actions: an answer can end with lines like "[[todo: Bayar listrik]]" (the backend tells the model
  // which). Sympony runs each one once, when the answer arrives, and shows a chip; things it created can be undone.
  const ACTION = /\[\[\s*(remind|todo|repeat|note|event|pomodoro|open|update|done|remove|bookmark|music|volume|stopwatch|link)\s*:\s*([\s\S]*?)\s*\]\]/gi;
  // "daily", "weekdays", "weekends", "mon,wed,fri" (Indonesian day names too) → [0-6], Sunday first
  function daysOf(s) {
    const w = (s || '').trim().toLowerCase();
    if (/^(daily|every ?day|each day|setiap hari|tiap hari|harian)$/.test(w)) return [0, 1, 2, 3, 4, 5, 6];
    if (/^(weekdays?|hari kerja)$/.test(w)) return [1, 2, 3, 4, 5];
    if (/^(weekends?|akhir pekan)$/.test(w)) return [0, 6];
    const names = [['sun', 'min', 'ming', 'ahad'], ['mon', 'sen'], ['tue', 'sel'], ['wed', 'rab'], ['thu', 'kam'], ['fri', 'jum'], ['sat', 'sab']];
    const days = w.split(/[\s,/&+]+|\band\b|\bdan\b/).filter(Boolean)
      .map((p) => names.findIndex((alts) => alts.some((a) => p.startsWith(a)))).filter((i) => i >= 0);
    return days.length ? [...new Set(days)].sort() : null;
  }
  const timeOf = (s) => { const m = (s || '').trim().match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function dueOf(when) {
    const w = when.trim().toLowerCase();
    let m = w.match(/^(\d{1,4})\s*(?:m|min|mins|minutes?|menit)$/);
    if (m) return Date.now() + +m[1] * 60000;
    m = w.match(/^(\d{1,3})\s*(?:h|hr|hrs|hours?|jam)$/);
    if (m) return Date.now() + +m[1] * 3600000;
    m = w.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ t]+([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    // a day without a time ("ingetin tanggal 8 …"): that morning at 09:00
    m = w.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 9, 0).getTime();
    m = w.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    if (m) { const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
    return null;
  }
  function minutesOf(s) {
    const m = (s || '').trim().toLowerCase().match(/^(\d{1,4})\s*(m|min|mins|minutes?|menit|h|hr|hrs|hours?|jam)?$/);
    return m ? +m[1] * (/^(h|hr|hrs|hour|hours|jam)$/.test(m[2] || '') ? 60 : 1) : null;
  }
  const todos = () => ((N.data && N.data.todo) || {}).items || [];
  const notes = () => ((N.data && N.data.notes) || {}).notes || [];
  const norm = (t) => t.trim().toLowerCase().replace(/\s+/g, ' ');

  async function run(kind, args) {
    const a = args.split('|').map((x) => x.trim());
    switch (kind) {
      case 'remind': case 'todo': {
        const text = kind === 'remind' ? a.slice(1).join(' | ') : args.trim();
        const due = kind === 'remind' ? dueOf(a[0]) : null;
        if (kind === 'remind' && due && due <= Date.now() - 60000) return { kind, ok: false, text: text || args, why: 'past', due };
        if (!text || (kind === 'remind' && !due)) return { kind, ok: false, text: text || args };
        const same = todos().find((t) => !t.done && !t.deletedAt && norm(t.text) === norm(text) && (due ? t.due && Math.abs(t.due - due) < 60000 : !t.due));
        if (same) return { kind, ok: true, text, due, existed: true };
        const id = uid();
        N.saveStore('todo', { items: [{ id, text, done: false, created: Date.now(), ...(due ? { due } : {}) }, ...todos()] });
        return { kind, ok: true, text, due, id };
      }
      case 'repeat': {
        // [[repeat: DAYS | HH:MM | WHAT]] a new one; [[repeat: ID | DAYS | HH:MM]] changes one; [[repeat: ID | none]] stops it
        const t = todos().find((x) => x.id === a[0]);
        if (t) {
          const next = { ...t };
          delete next.alerted;
          if (/^(none|no|off|stop)$/i.test(a[1] || '')) delete next.repeat;
          else {
            const days = daysOf(a[1]); const time = timeOf(a[2]);
            if (!days || !time) return { kind, ok: false, text: t.text };
            next.repeat = { days, time }; next.due = N.nextRepeat(next.repeat);
          }
          N.saveStore('todo', { items: todos().map((x) => (x.id === t.id ? next : x)) });
          return { kind, ok: true, target: 'todo', id: t.id, text: t.text, repeat: next.repeat, prev: t };
        }
        const days = daysOf(a[0]); const time = timeOf(a[1]); const text = a.slice(2).join(' | ').trim();
        if (!days || !time || !text) return { kind, ok: false, text: text || args };
        const repeat = { days, time };
        const same = todos().find((x) => !x.done && !x.deletedAt && norm(x.text) === norm(text) && x.repeat);
        if (same) return { kind, ok: true, text, repeat: same.repeat, existed: true };
        const id = uid();
        N.saveStore('todo', { items: [{ id, text, done: false, created: Date.now(), repeat, due: N.nextRepeat(repeat) }, ...todos()] });
        return { kind, ok: true, text, repeat, id };
      }
      case 'note': {
        const body = args.trim();
        if (!body) return { kind, ok: false, text: '' };
        const id = uid();
        N.saveStore('notes', { notes: [{ id, body, updated: Date.now() }, ...notes()] });
        return { kind, ok: true, text: body.split('\n')[0].slice(0, 80), id };
      }
      case 'event': {
        const start = dueOf(a[0] || '');
        const mins = a.length > 2 ? minutesOf(a[1]) || 60 : 60;
        const title = (a.length > 2 ? a.slice(2) : a.slice(1)).join(' | ');
        if (!start || !title) return { kind, ok: false, text: title || args };
        const id = 'l' + uid();
        api.setSettings({ localEvents: [...(st.settings.localEvents || []), { id, title, start, end: start + mins * 60000, location: '', repeat: 'none' }] });
        return { kind, ok: true, text: title, due: start, mins, id };
      }
      case 'pomodoro': {
        const cmd = args.trim().toLowerCase();
        if (/^(stop|pause|end)$/.test(cmd)) {
          const r = await api.svc('pomodoro', 'pause');
          return { kind, ok: !!r && !r.running, text: _t('Pomodoro paused') };
        }
        const phase = /^(break|rest|istirahat)$/.test(cmd) ? 'short' : 'work';
        const p = st.pomodoro || {};
        if (p.phase !== phase) await api.svc('pomodoro', 'setPhase', phase);
        // the backend answers with the new state
        const r = await api.svc('pomodoro', 'start');
        return { kind, ok: !!(r && r.running), text: phase === 'work' ? _t('Focus started · {n}m', { n: st.settings.pomoWork }) : _t('Break started · {n}m', { n: st.settings.pomoShort }) };
      }
      case 'open': {
        const want = args.trim().toLowerCase();
        if (!launcher) launcher = await api.svc('launcher', 'list').catch(() => []);
        const list = launcher || [];
        let i = list.findIndex((x) => (x.name || '').toLowerCase() === want);
        if (i < 0) i = list.findIndex((x) => (x.name || '').toLowerCase().includes(want) || want.includes((x.name || '').toLowerCase()));
        if (i < 0 || !want) return { kind, ok: false, text: args.trim() };
        api.svc('launcher', 'open', i);
        return { kind, ok: true, text: list[i].name };
      }
      case 'update': case 'done': case 'remove': {
        const id = a[0];
        const when = (a[1] || '-').trim().toLowerCase();
        const newText = a.slice(2).join(' | ').trim();
        const t = todos().find((x) => x.id === id);
        if (t) {
          let next = { ...t };
          if (kind === 'done') {
            // a repeating one comes back for its next time (undo puts the list back as it was)
            const before = todos();
            N.saveStore('todo', { items: N.todoDone(before, id) });
            return { kind, ok: true, target: 'todo', id, text: t.text, prevList: before };
          }
          if (kind === 'remove') next = { ...t, deletedAt: Date.now() };
          else {
            if (when && when !== '-') {
              if (/^(none|no|off|-)$/.test(when)) delete next.due;
              else { const due = dueOf(when); if (!due) return { kind, ok: false, text: t.text }; next.due = due; }
              delete next.alerted;
            }
            if (newText && newText !== '-') next.text = newText;
          }
          N.saveStore('todo', { items: todos().map((x) => (x.id === id ? next : x)) });
          return { kind, ok: true, target: 'todo', id, text: next.text, due: next.due, prev: t };
        }
        const list = st.settings.localEvents || [];
        const ev = list.find((e) => e.id === id);
        if (ev && kind !== 'done') {
          if (kind === 'remove') {
            api.setSettings({ localEvents: list.filter((e) => e.id !== id) });
            return { kind, ok: true, target: 'event', id, text: ev.title, prev: ev };
          }
          const start = when && when !== '-' ? dueOf(when) : ev.start;
          if (!start) return { kind, ok: false, text: ev.title };
          const next = { ...ev, start, end: start + ((ev.end || ev.start + 3600000) - ev.start), title: newText && newText !== '-' ? newText : ev.title };
          api.setSettings({ localEvents: list.map((e) => (e.id === id ? next : e)) });
          return { kind, ok: true, target: 'event', id, text: next.title, due: next.start, prev: ev };
        }
        // an ID that isn't there (the model made one up, or the item went) with a time and a text: most likely it
        // meant one more reminder ("remind me again on the 27th"), so that's what it gets, with Undo
        if (kind === 'update' && when && !/^(-|none|no|off)$/.test(when) && newText && newText !== '-') {
          const r = await run('remind', `${a[1]} | ${newText}`);
          if (r.ok) return { ...r, instead: true };
        }
        return { kind, ok: false, text: id };
      }
      case 'bookmark': {
        // [[bookmark: URL | CATEGORY]] into the Bookmarks tab (bookmarks.js fetches its title and icon)
        const r = N.bookmarks ? await N.bookmarks.add(a[0], a.slice(1).join(' | ')) : { ok: false };
        if (!r.ok) return { kind, ok: false, text: a[0] || args.trim() };
        return { kind, ok: true, text: N.bookmarks.host(r.item.url), cat: r.item.cat, ...(r.existed ? { existed: true } : { id: r.item.id }) };
      }
      case 'music': {
        // [[music: play | pause | next | previous]] what's playing, like the player's buttons on Home
        const w = args.trim().toLowerCase();
        const action = /^(play|resume)$/.test(w) ? 'play' : /^(pause|stop)$/.test(w) ? 'pause' : /^(next|skip)$/.test(w) ? 'next' : /^(prev|previous|back)$/.test(w) ? 'prev' : '';
        const m = st.media || {};
        if (!action || !m.active) return { kind, ok: false, why: action ? 'idle' : '', text: args.trim() };
        api.helper({ cmd: 'media', action });
        return { kind, ok: true, action, text: [m.title, m.artist].filter(Boolean).join(' — ') };
      }
      case 'volume': {
        // [[volume: 40]] (percent), [[volume: mute]], [[volume: unmute]]; Undo puts the level back
        const w = args.trim().toLowerCase();
        const v = st.volume;
        const prev = v ? { level: v.level, muted: !!v.muted } : null;
        if (/^(mute|off)$/.test(w) || /^(unmute|on)$/.test(w)) {
          const mute = /^(mute|off)$/.test(w);
          if (!v) return { kind, ok: false, text: args.trim() }; // not known whether it's muted now
          if (!!v.muted !== mute) api.helper({ cmd: 'volume.mute' });
          return { kind, ok: true, muted: mute, level: v.level, ...(!!v.muted !== mute ? { id: 'volume', prev } : {}) };
        }
        const n = w.match(/^(\d{1,3})\s*%?$/);
        if (!n) return { kind, ok: false, text: args.trim() };
        const level = Math.min(100, +n[1]);
        api.helper({ cmd: 'volume.set', value: level });
        return { kind, ok: true, level, ...(prev ? { id: 'volume', prev } : {}) };
      }
      case 'stopwatch': {
        // [[stopwatch: start | stop | reset]] the Pomodoro tab's stopwatch (the shared "stopwatch" store, data.js)
        const w = args.trim().toLowerCase();
        const s = (N.data && N.data.stopwatch) || { running: false, elapsed: 0, laps: [] };
        const ms = N.swElapsed();
        if (/^(start|resume|go)$/.test(w)) {
          if (!s.running) N.saveStore('stopwatch', { ...s, running: true, startedAt: Date.now() });
          return { kind, ok: true, op: 'start', ms, already: !!s.running };
        }
        if (/^(stop|pause)$/.test(w)) {
          if (s.running) N.saveStore('stopwatch', { ...s, running: false, elapsed: ms, startedAt: null });
          return { kind, ok: true, op: 'stop', ms };
        }
        if (/^(reset|clear)$/.test(w)) {
          N.saveStore('stopwatch', { running: false, elapsed: 0, laps: [], startedAt: null });
          return { kind, ok: true, op: 'reset', ms, ...(ms ? { id: 'stopwatch', prev: s } : {}) };
        }
        return { kind, ok: false, text: args.trim() };
      }
      case 'link': {
        // [[link: URL | LABEL]] a button under the answer. It only opens when it's clicked, never by itself: a page a
        // web search found could ask for one.
        let u = null;
        try { u = new URL(a[0]); } catch (e) { /* not a web address */ }
        if (!u || !/^https?:$/.test(u.protocol)) return { kind, ok: false, text: a[0] || args.trim() };
        return { kind, ok: true, url: u.href, host: u.host.replace(/^www\./, ''), text: a.slice(1).join(' | ').trim() };
      }
      default: return { kind, ok: false, text: args };
    }
  }

  // The [id] tags the day's context gives the model for its action lines, should one slip into the words it shows
  // ("Bayar listrik ([mvrz70rezl6w]), due …"): only the ids of todos and Sympony's own events, so a [1] citation stays.
  function dropIds(text) {
    const ids = new Set([...((N.data.todo || {}).items || []).map((t) => t.id), ...(st.settings.localEvents || []).map((e) => e.id)].filter(Boolean));
    if (!ids.size) return text;
    return text.replace(/[ \t]*\(?\[([A-Za-z0-9_-]{4,40})\]\)?[ \t]*/g, (all, id) => (ids.has(id) ? (/^[ \t]/.test(all) && /[ \t]$/.test(all) ? ' ' : '') : all));
  }

  async function takeActions(text) {
    const found = [];
    const content = dropIds(text.replace(ACTION, (all, kind, args) => { found.push([kind.toLowerCase(), args]); return ''; })).trim();
    const actions = [];
    for (const [kind, args] of found) {
      try { actions.push(await run(kind, args)); } catch (e) { actions.push({ kind, ok: false, text: args }); }
    }
    return { content: content || _t('Done.'), actions };
  }

  function undo(act) {
    if (act.prevList) {
      // ticked off: put that task back, and drop the next one a repeating task left
      const back = act.prevList.find((t) => t.id === act.id);
      const added = todos().filter((t) => !act.prevList.some((p) => p.id === t.id)).map((t) => t.id);
      N.saveStore('todo', { items: todos().filter((t) => !added.includes(t.id)).map((t) => (t.id === act.id && back ? back : t)) });
    } else if (act.prev && act.target === 'todo') N.saveStore('todo', { items: todos().map((t) => (t.id === act.id ? act.prev : t)) });
    else if (act.prev && act.target === 'event') {
      const list = st.settings.localEvents || [];
      api.setSettings({ localEvents: list.some((e) => e.id === act.id) ? list.map((e) => (e.id === act.id ? act.prev : e)) : [...list, act.prev] });
    } else if (act.kind === 'remind' || act.kind === 'todo' || act.kind === 'repeat') N.saveStore('todo', { items: todos().filter((t) => t.id !== act.id) });
    else if (act.kind === 'note') N.saveStore('notes', { notes: notes().filter((n) => n.id !== act.id) });
    else if (act.kind === 'event') api.setSettings({ localEvents: (st.settings.localEvents || []).filter((e) => e.id !== act.id) });
    else if (act.kind === 'bookmark' && N.bookmarks) N.bookmarks.remove(act.id);
    else if (act.kind === 'stopwatch' && act.prev) N.saveStore('stopwatch', act.prev);
    else if (act.kind === 'volume' && act.prev) {
      // muted or unmuted: switch it back; a new level: the one before
      if (act.muted !== undefined) api.helper({ cmd: 'volume.mute' });
      else api.helper({ cmd: 'volume.set', value: act.prev.level });
    }
    act.undone = true;
  }

  function whenLabel(due) {
    const mins = Math.round((due - Date.now()) / 60000);
    const d = new Date(due);
    if (d.toDateString() === new Date().toDateString()) return mins > 0 && mins < 60 ? _t('{time} (in {n}m)', { time: N.hm(due), n: mins }) : N.hm(due);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + N.hm(due);
  }
  const ICON = { remind: 'bell', todo: 'list-check', repeat: 'repeat', note: 'note-sticky', event: 'calendar-plus', pomodoro: 'stopwatch', open: 'rocket', update: 'pen', done: 'check', remove: 'trash-can', bookmark: 'bookmark',
    music: 'music', volume: 'volume-high', stopwatch: 'stopwatch', link: 'link' };
  const TAB = { remind: 'todo', todo: 'todo', repeat: 'todo', note: 'notes', pomodoro: 'pomodoro', bookmark: 'bookmarks', stopwatch: 'pomodoro' };
  // a page's site: its own favicon (asked of that site only, no referrer; no third party learns what you read), over a
  // letter on the site's colour that shows when it has none
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  function fav(u) {
    const h = host(u);
    let hue = 0;
    for (const c of h) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    let origin = '';
    try { origin = new URL(u).origin; } catch { /* not a URL */ }
    const img = /^https:/.test(origin) ? `<img src="${esc(origin)}/favicon.ico" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<span class="ch-fav" style="--h:${hue}">${esc((h[0] || '?').toUpperCase())}${img}</span>`;
  }
  // the pages a web search used, as Affect UI's AI Answer shows them: cards over the answer (three, then "+N more")
  const webSrc = (m) => (m.sources || []).filter((s) => /^https?:/i.test(s.url || ''));
  function sourceCards(m, i) {
    const src = webSrc(m);
    if (!src.length) return '';
    const shown = m.srcAll ? src : src.slice(0, 3);
    const searched = (m.searched || []).map((q) => `“${q}”`).join(', ');
    return `<div class="ch-cards" title="${esc(searched ? _t('Searched the web for {query}', { query: searched }) : '')}">`
      + shown.map((s) => `<a class="ch-card" data-href="${esc(s.url)}" title="${esc(s.url)}${s.date ? ` · ${esc(s.date)}` : ''}"><span class="hd">${fav(s.url)}<span class="hs">${esc(host(s.url))}</span>${s.n ? `<span class="n">${s.n}</span>` : ''}</span><span class="tt">${esc(s.title || s.url)}</span></a>`).join('')
      + (src.length > shown.length ? `<button type="button" class="ch-card more" data-srcall="${i}"><b>+${src.length - shown.length}</b><span>${esc(_t('more'))}</span></button>` : '')
      + '</div>';
  }
  // why it answered without searching when that didn't work, and Google's suggestions (under the answer)
  function sourceLinks(m) {
    const note = m.searchNote ? `<div class="ch-note">${fa('circle-info')}<span>${esc(m.searchNote)}</span>${m.searchFix ? `<button data-ai>${_t('Settings')}</button>` : ''}</div>` : '';
    return suggestFrame(m) + note;
  }
  // Google's search suggestions under an answer Gemini found with Google Search. Google's terms want them shown with
  // that answer as they come, so it's Google's own snippet (m.suggest), in a frame where no script runs (sandboxed
  // without allow-scripts); Sympony opens its chips in the browser (bindSuggest)
  const suggestFrame = (m) => (m.suggest ? `<iframe class="ch-gs" sandbox="allow-same-origin" title="${_t('Google Search suggestions')}"
    srcdoc="${esc('<style>html { overflow: hidden; } body { margin: 0; padding: 1px; }</style>' + m.suggest)}"></iframe>` : '');
  // a chip clicked in that frame: Google Search in the browser, never inside Sympony (the frame's own height, once it's in)
  function bindSuggest(root) {
    $$('iframe.ch-gs', root).forEach((f) => {
      const hook = () => {
        const d = f.contentDocument;
        if (!d || !d.body || d.symponyBound) return;
        d.symponyBound = true;
        const h = Math.ceil(d.body.getBoundingClientRect().height);
        if (h) f.style.height = h + 'px';
        d.addEventListener('click', (e) => {
          const a = e.target.closest && e.target.closest('a[href]');
          if (!a) return;
          e.preventDefault();
          if (/^https:\/\//i.test(a.href)) api.openExternal(a.href);
        }, true);
      };
      f.addEventListener('load', hook);
      if (f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.URL === 'about:srcdoc') hook();
    });
  }
  // [2] or [1][3] in an answer that searched the web: a chip with the first page's site and "+1" for the others,
  // opening it (not inside code or a tag)
  function cites(html, m) {
    const src = m.sources || [];
    if (!src.length) return html;
    return html.split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>|<[^>]+>)/).map((part, i) => (i % 2 ? part
      : part.replace(/(?:\s?\[\d{1,2}(?:\s*,\s*\d{1,2})*\])+/g, (all) => {
        const ns = [...new Set((all.match(/\d{1,2}/g) || []).map(Number))];
        const hit = ns.map((n) => src.find((x) => x.n === n)).filter(Boolean);
        if (!hit.length) return all;
        const first = hit[0];
        return ` <a class="ch-cite" data-href="${esc(first.url)}" title="${esc(hit.map((s) => s.title || s.url).join('\n'))}">${esc(host(first.url))}${hit.length > 1 ? `<span>+${hit.length - 1}</span>` : ''}</a>`;
      }))).join('');
  }
  // an answer as the chat and the Buddy's bubble show it: its sources, the text and what it did
  const answerHtml = (m, i) => sourceCards(m, i) + cites(markdown(m.content), m) + sourceLinks(m) + actionChips(m);

  function actionChips(m) {
    // answers from before actions existed kept their reminders as m.reminders
    const acts = m.actions || (m.reminders || []).map((r) => ({ kind: 'remind', ok: !!r.due, text: r.text, due: r.due }));
    const tabOn = (id) => (st.settings.modules || []).some((x) => x.id === id && x.on);
    return acts.map((a, i) => {
      if (!a.ok) {
        const past = a.why === 'past' && a.due ? _t('“{text}” would be on {date}, which has passed. Ask again with a date still to come.', { text: a.text, date: new Date(a.due).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) }) : '';
        const why = past || { remind: _t('Couldn’t set the reminder “{text}”. Try a time like 15m, 14:30 or a date like 1 November 09:00.', { text: a.text }), event: _t('Couldn’t add “{text}” to the calendar. Try a time like 14:30 or a date like 1 November 09:00.', { text: a.text }),
          open: _t('“{text}” isn’t in your launcher apps (Settings → Drop Actions & Shelf).', { text: a.text }), pomodoro: _t('Couldn’t start or stop Pomodoro.'),
          update: _t('Couldn’t find that item to change. Ask again with its name, or ask for a new reminder.'), done: _t('Couldn’t find that todo.'), remove: _t('Couldn’t find that item to remove.'),
          repeat: _t('Couldn’t set “{text}” to repeat. Try days like weekdays or mon,wed and a time like 08:00.', { text: a.text }),
          bookmark: _t('Couldn’t save “{text}” as a bookmark: it isn’t a web address.', { text: a.text }),
          music: a.why === 'idle' ? _t('Nothing is playing right now.') : _t('Couldn’t do that with the music. Try play, pause, next or previous.'),
          volume: _t('Couldn’t change the volume. Try a level like 40%, mute or unmute.'),
          stopwatch: _t('Couldn’t do that with the stopwatch. Try start, stop or reset.'),
          link: _t('“{text}” isn’t a web address, so there’s no link to open.', { text: a.text }) }[a.kind] || _t('Couldn’t do that ({kind}).', { kind: a.kind });
        return `<div class="ch-rem bad">${fa('circle-exclamation')}<span>${esc(why)}</span></div>`;
      }
      // a link opens only when it's clicked (data-href: the same click path as links in the text)
      if (a.kind === 'link') {
        return `<div class="ch-rem link">${fa('link')}<span>${a.text ? `<b>${esc(a.text)}</b> · ` : ''}${esc(a.host || a.url)}</span>
          <a href="#" class="ch-go" data-href="${esc(a.url)}" title="${esc(a.url)}">${_t('Open')}</a></div>`;
      }
      if (a.existed && a.kind === 'bookmark') return `<div class="ch-rem">${fa('bookmark')}<span>${_t('Already in Bookmarks:')} <b>${esc(a.text)}</b>${a.cat ? ` · ${esc(a.cat)}` : ''}</span></div>`;
      if (a.existed) return `<div class="ch-rem">${fa('list-check')}<span>${_t('Already in Todo:')} <b>${esc(a.text)}</b>${a.repeat ? ` · ${esc(N.repeatLabel(a.repeat))}` : a.due ? ` · ${esc(whenLabel(a.due))}` : ''}</span></div>`;
      const what = {
        remind: `${a.instead ? _t('Couldn’t find the one to change, so added a new reminder:') : _t('Reminder set:')} <b>${esc(a.text)}</b> · ${esc(whenLabel(a.due))}`,
        todo: `${_t('Added to Todo:')} <b>${esc(a.text)}</b>`,
        repeat: a.repeat ? `${_t('Repeats {when}:', { when: esc(N.repeatLabel(a.repeat)) })} <b>${esc(a.text)}</b>` : `${_t('No longer repeats:')} <b>${esc(a.text)}</b>`,
        update: `${a.target === 'event' ? _t('Event moved:') : _t('Updated:')} <b>${esc(a.text)}</b>${a.due ? ` · ${esc(whenLabel(a.due))}` : a.target === 'todo' ? ` · ${_t('no time')}` : ''}`,
        done: `${_t('Marked done:')} <b>${esc(a.text)}</b>`,
        remove: a.target === 'event' ? `${_t('Removed from your calendar:')} <b>${esc(a.text)}</b>` : `${_t('Moved to Trash:')} <b>${esc(a.text)}</b>`,
        note: `${_t('Saved to Notes:')} <b>${esc(a.text)}</b>`,
        event: `${_t('Added to your calendar:')} <b>${esc(a.text)}</b> · ${esc(whenLabel(a.due))}${a.mins ? ` · ${_t('{n}m', { n: a.mins })}` : ''}`,
        pomodoro: esc(a.text),
        open: `${_t('Opened')} <b>${esc(a.text)}</b>`,
        bookmark: `${_t('Saved to Bookmarks:')} <b>${esc(a.text)}</b>${a.cat ? ` · ${esc(a.cat)}` : ''}`,
        music: { play: _t('Playing'), pause: _t('Paused'), next: _t('Next song'), prev: _t('Previous song') }[a.action] + (a.text && /^(play|pause)$/.test(a.action) ? `: <b>${esc(a.text)}</b>` : ''),
        volume: a.muted === true ? _t('Sound muted') : a.muted === false ? _t('Sound on · {n}%', { n: a.level }) : _t('Volume set to {n}%', { n: a.level }),
        stopwatch: a.op === 'start' ? (a.already ? _t('The stopwatch is already running: {time}', { time: `<b>${esc(N.swText(a.ms, false))}</b>` }) : _t('Stopwatch started'))
          : a.op === 'stop' ? _t('Stopwatch stopped at {time}', { time: `<b>${esc(N.swText(a.ms))}</b>` }) : _t('Stopwatch reset'),
      }[a.kind];
      const canUndo = a.id && !a.undone;
      const icon = a.kind === 'volume' && (a.muted || a.level === 0) ? 'volume-xmark' : ICON[a.kind] || 'check';
      return `<div class="ch-rem ${a.undone ? 'undone' : ''}">${fa(icon)}<span>${a.undone ? `<s>${what}</s> · ${_t('undone')}` : what}</span>
        ${canUndo ? `<button data-undo="${i}">${_t('Undo')}</button>` : ''}${!a.undone && (TAB[a.kind] || (a.target === 'todo' && 'todo')) && tabOn(TAB[a.kind] || 'todo') ? `<button data-tab="${TAB[a.kind] || 'todo'}">${esc(MODULE_TITLES[TAB[a.kind] || 'todo'] || _t('Todo'))}</button>` : ''}</div>`;
    }).join('');
  }

  // ---- Full, XSS-safe GitHub-Flavored Markdown renderer (shared with NotchKit for unit testing)
  function markdown(src) {
    if (window.NotchKit && typeof window.NotchKit.renderMarkdown === 'function') {
      return window.NotchKit.renderMarkdown(src, {
        copyTitle: _t('Copy code'),
        copyIcon: fa('copy', 'regular'),
      });
    }
    return `<p>${esc(src).replace(/\n/g, '<br>')}</p>`;
  }

  function copyBtn(i) {
    return `<button type="button" class="ch-act" data-copy="${i}" title="${esc(_t('Copy'))}" aria-label="${esc(_t('Copy'))}">${fa('copy', 'regular')}</button>`;
  }

  function copyMessageText(m) {
    if (!m) return '';
    if (m.role === 'user' && m.kind === 'answer') {
      if (Array.isArray(m.qa) && m.qa.length) {
        return m.qa.map((r) => `${r.question ? `${r.question}: ` : (r.header ? `${r.header}: ` : '')}${r.answer || _t('Skipped')}`).join('\n');
      }
      return String(m.content || '').replace(/^(?:Answers to your question|Question & answer):\n/, '');
    }
    return String(m.content || '');
  }

  function renderAnswerBubble(m, i) {
    const copy = copyMessageText(m).trim() ? copyBtn(i) : '';
    if (Array.isArray(m.qa) && m.qa.length) {
      return `<div class="ch-msg me" data-i="${i}">${copy}<div class="ch-qa-ans" dir="auto">${m.qa.map((row) => {
        const qLine = row.question ? `<div class="ch-qa-q">${esc(row.question)}</div>` : '';
        const aLine = row.header
          ? `<div class="ch-qa-row"><span class="cc-tag">${esc(row.header)}</span><span>${esc(row.answer || _t('Skipped'))}</span></div>`
          : `<div class="ch-qa-row"><span>${esc(row.answer || _t('Skipped'))}</span></div>`;
        return `<div class="ch-qa-pair">${qLine}${aLine}</div>`;
      }).join('')}</div></div>`;
    }
    const clean = String(m.content || '').replace(/^(?:Answers to your question|Question & answer):\n/, '');
    if (clean === '(the user skipped your question)') {
      return `<div class="ch-msg me" data-i="${i}"><div class="ch-qa-ans"><div class="ch-qa-row"><span>${esc(_t('Skipped'))}</span></div></div></div>`;
    }
    return `<div class="ch-msg me" data-i="${i}">${copy}<div class="ch-qa-ans" dir="auto">${esc(clean).replace(/\n/g, '<br>')}</div></div>`;
  }

  function userBubble(m, i) {
    const files = m.files || [];
    const body = esc(m.content).replace(/\n/g, '<br>');
    const copy = String(m.content || '').trim() ? copyBtn(i) : '';
    // (a message written while Pony worked: "Sends when Pony is done" when the run can't take it now)
    const note = m.later ? `<div class="ch-later">${fa('clock', 'regular')} ${esc(_t('Sends when Pony is done'))}</div>` : '';
    if (!files.length) return `<div class="ch-msg me" data-i="${i}">${copy}<div class="ch-me"><div class="ch-me-bub" dir="auto">${body}</div>${note}</div></div>`;
    const pics = files.filter((f) => f.kind === 'image' && f.thumb);
    const docs = files.filter((f) => f.kind !== 'image').map((f) => { const [ic, c] = fileLook(f.name); return `<div class="ch-att-file sent" style="--c:${c}"><span class="ic">${fa(ic)}</span><span class="nm"><b>${esc(f.name)}</b><span>${esc(f.size ? kb(f.size) : '')}</span></span></div>`; }).join('');
    return `<div class="ch-msg me" data-i="${i}">${copy}<div class="ch-me">${pics.length ? `<div class="ch-me-pics">${pics.map((f) => `<img src="${esc(f.thumb)}" alt="" title="${esc(f.name)}">`).join('')}</div>` : ''}<div class="ch-me-bub" dir="auto">${docs}${body}</div>${note}</div></div>`;
  }
  function seenLine(s) {
    const bits = [s.img ? _t('looked at {n} pictures', { n: s.img }) : '', s.txt ? _t('read {n} files', { n: s.txt }) : ''].filter(Boolean).join(' · ');
    return `<div class="ch-seen">${fa('eye', 'regular')} ${esc(bits.charAt(0).toUpperCase() + bits.slice(1))}</div>`;
  }

  // Pony's face as a small static avatar (the composer has the live, moving one)
  // Pony as a still avatar, drawn by the composer's own renderer (same shape, colour, proportions)
  function ponyAva(size) {
    const sset = st.settings || {};
    const url = window.Pony && window.Pony.snapshot
      ? window.Pony.snapshot({ shape: sset.ponyShape || 'Classic', color: sset.ponyColor || 'Lavender', size })
      : '';
    return url
      ? `<img class="ch-ava" src="${url}" alt="" width="${size}" height="${size}">`
      : `<span class="ch-ava" style="width:${size}px;height:${size}px">${fa('wand-magic-sparkles')}</span>`;
  }

  // What Pony is doing while a long answer is on its way: the time so far and each tool it calls, live
  const STEP = {
    context: ['calendar-check', 'var(--amber)', 'Looking at your day'],
    remind: ['bell', 'var(--lav)', 'Setting a reminder'],
    todo: ['square-check', 'var(--sky)', 'Adding a task'],
    repeat: ['repeat', 'var(--sky)', 'Setting a repeat'],
    update: ['pen', 'var(--sky)', 'Changing an item'],
    done: ['check', 'var(--emerald)', 'Ticking off a task'],
    remove: ['trash', 'var(--red)', 'Removing an item'],
    note: ['note-sticky', 'var(--lilac)', 'Saving a note'],
    event: ['calendar-plus', 'var(--amber)', 'Adding an event'],
    pomodoro: ['stopwatch', 'var(--red)', 'Pomodoro'],
    stopwatch: ['stopwatch', 'var(--red)', 'Stopwatch'],
    music: ['music', 'var(--lilac)', 'Music'],
    volume: ['volume-high', 'var(--lav)', 'Setting the volume'],
    open: ['arrow-up-right-from-square', 'var(--lav)', 'Opening an app'],
    link: ['link', 'var(--sky)', 'Preparing a link'],
    skill: ['wand-magic-sparkles', 'var(--lilac)', 'Reading a skill'],
    skill_file: ['book-open', 'var(--lilac)', 'Reading a skill file'],
    save_skill: ['floppy-disk', 'var(--lilac)', 'Saving a skill'],
    remember: ['brain', 'var(--lav)', 'Remembering'],
    recall: ['clock-rotate-left', 'var(--lav)', 'Looking through past chats'],
    mcp: ['plug', 'var(--sky)', 'Using'],
    agent: ['robot', 'var(--emerald)', 'Working with an agent'],
    forget: ['eraser', 'var(--dim)', 'Forgetting'],
    ask: ['circle-question', 'var(--amber)', 'Preparing a question'],
    see: ['eye', 'var(--lav)', 'Looking at'],
    screen: ['eye', 'var(--sky)', 'Reading'],
    hands: ['hand-pointer', 'var(--lilac)', 'Working in'],
    watch: ['eye', 'var(--lav)', 'Watching'],
    web: ['magnifying-glass', 'var(--sky)', 'Searching the web for'],
    page: ['globe', 'var(--sky)', 'Reading a page on'],
    read: ['file-lines', 'var(--sky)', 'Reading'],
    run: ['terminal', 'var(--emerald)', 'Running'],
    steer: ['comment', 'var(--sky)', 'Reading your message'],
    list: ['folder-open', 'var(--amber)', 'Looking in'],
    write: ['file-circle-plus', 'var(--lilac)', 'Writing'],
    edit: ['pen-to-square', 'var(--lilac)', 'Editing'],
  };
  // Commands & files: Pony waits on this card for the user's OK (src-tauri/src/exec.rs, pony:approve)
  const AP = {
    run_command: ['terminal', 'Run this command?'], write_file: ['file-circle-plus', 'Create this file?'],
    overwrite_file: ['file-pen', 'Replace this file?'], edit_file: ['pen-to-square', 'Change this file?'],
    read_file: ['file-lines', 'Read this file?'], list_dir: ['folder-open', 'Look in this folder?'],
    delete: ['trash', 'Delete this?'], mcp: ['plug', 'Use this tool?'], mcp_delete: ['trash', 'Delete with this tool?'],
    ask_ai: ['comments', 'Ask this AI?'],
    hands: ['hand-pointer', 'Let Pony do this?'],
    remember: ['brain', 'Remember this?'],
    save_skill: ['wand-magic-sparkles', 'Save this skill?'],
    agent_start: ['robot', 'Start an agent on this?'], agent_send: ['paper-plane', 'Send this to the agent?'], agent_stop: ['circle-stop', 'Stop this agent?'],
  };
  // The notch is closed when Pony finishes, needs an OK or asks something: it comes down open on Pony (as a scheduled
  // brief does) and goes back up by itself after a while if the mouse never comes
  function showInNotch() {
    if (N.isFloatingChat) {
      if (api.openFloatingChat) api.openFloatingChat();
      return;
    }
    if (st.open || !N.openNotch) return;
    N.openNotch('chat');
    st.openedByShortcut = true;
    if (N.later) N.later('close', 120000, () => { if (st.openedByShortcut && !st.hover && !st.typing && N.closeNotch) N.closeNotch(); });
  }
  let approval = null; // { session, id, tool, detail, cwd?, prefix?, canAlways? }
  // Another AI's answer stands still because its browser window is hidden (src-tauri/src/askai.rs): id → its name
  const peeks = {};
  function peekHtml() {
    return Object.entries(peeks).map(([id, name]) => `<div class="ch-approve" data-peek-id="${esc(id)}">`
      + `<div class="ap-head"><span class="ap-face">${fa('comments')}</span><b>${esc(_t('{name} is answering in the browser', { name }))}</b></div>`
      + `<div class="ap-note">${esc(_t('The browser waits while its window is hidden. Pony shows it for a moment to bring the answer here.'))}</div>`
      + `<div class="ap-foot"><span class="ap-where"></span><button type="button" class="ap-btn pri" data-peek="${esc(id)}">${esc(_t('Show for a moment'))}</button></div></div>`).join('');
  }
  // what Pony wants to do, shown as a terminal line, a diff or the new file's first lines
  function approveBody(a) {
    const d = String(a.detail || '');
    // (an outside tool: its server and name, then what goes in)
    // (an outside tool or another agent: where it goes, then what goes in)
    if (/^(mcp|agent_|ask_ai|hands|remember|save_skill)/.test(a.tool)) {
      const [who, ...args] = d.split('\n');
      const lines = args.join('\n').split('\n').slice(0, 14).map((l) => `<span class="ln">${esc(l) || ' '}</span>`).join('');
      const note = a.tool === 'ask_ai' ? `<div class="ap-note">${esc(_t('Pony types it with your keyboard for a few seconds; switching apps stops it.'))}</div>` : '';
      const ico = a.tool.startsWith('mcp') ? 'plug' : a.tool === 'ask_ai' ? 'comments' : a.tool === 'hands' ? 'hand-pointer' : a.tool === 'remember' ? 'brain' : a.tool === 'save_skill' ? 'wand-magic-sparkles' : 'folder';
      return `<div class="ap-file">${fa(ico)}<span dir="ltr">${esc(who)}</span></div>${lines ? `<div class="ap-code ap-lines">${lines}</div>` : ''}${note}`;
    }
    if (a.tool === 'run_command' || a.tool === 'delete') return `<div class="ap-code"><span class="pr">$</span><span class="ln">${esc(d)}</span></div>`;
    const [path, ...rest] = d.split('\n');
    const body = rest.join('\n').replace(/^\n+/, '');
    const file = `<div class="ap-file">${fa('file-lines')}<span dir="ltr">${esc(path)}</span></div>`;
    if (!body) return file;
    const lines = body.split('\n').map((l) => {
      const k = a.tool === 'edit_file' ? (l.startsWith('- ') ? 'del' : l.startsWith('+ ') ? 'add' : '') : '';
      return `<span class="ln ${k}">${esc(k ? l.slice(2) : l) || ' '}</span>`;
    }).join('');
    return file + `<div class="ap-code ap-lines">${lines}</div>`;
  }
  function approveHtml() {
    if (!approval) return '';
    const a = approval;
    const [, q] = AP[a.tool] || ['gear', 'Allow this?'];
    const del = a.tool === 'delete' || a.tool === 'mcp_delete';
    const name = (window.Pony && window.Pony.look ? window.Pony.look(st.settings).name : 'Pony');
    const face = window.Pony && window.Pony.snapshot
      ? `<img src="${window.Pony.snapshot({ shape: st.settings.ponyShape || 'Classic', color: st.settings.ponyColor || 'Lavender', mood: 'attention', size: 28 })}" alt="">`
      : '';
    return `<div class="ch-approve${del ? ' del' : ''}" data-ap-id="${esc(a.id)}">`
      + `<div class="ap-head"><span class="ap-face">${face}</span><b>${esc(_t(q))}</b><span class="ap-who">${esc(name)}</span></div>`
      + approveBody(a)
      + `<div class="ap-foot">${a.cwd ? `<span class="ap-where" title="${esc(a.cwd)}">${fa('folder')}<span>${esc(a.cwd)}</span></span>` : '<span class="ap-where"></span>'}`
      + `<button type="button" class="ap-btn ghost" data-ap="deny">${esc(_t('Decline'))}</button>`
      + (a.canAlways ? `<button type="button" class="ap-btn" data-ap="always">${esc(_t('Always allow'))} <code>${esc(a.prefix)}</code></button>` : '')
      + `<button type="button" class="ap-btn pri${del ? ' danger' : ''}" data-ap="once">${esc(_t(del ? 'Delete' : 'Allow'))}</button></div>`
      + `</div>`;
  }

  // What Pony is doing, as a timeline (Affect UI's Thinking State): a 3×3 grid that ripples while it works, the label
  // with a light sweeping over it, the time; then each step on a thin line, the current one shimmering. Once the
  // answer is being written it reads "Worked for 7 s", and the answer streams in word by word below it.
  function stepLi(s, now) {
    const [ic, c, label0] = STEP[s.kind] || ['gear', 'var(--dim)', 'Working'];
    const found = (s.sources || []).filter((x) => /^https?:/i.test(x.url || ''));
    // (a search that came back reads "Searched" and lists what it found, four, then "+N more")
    const label = s.kind === 'web' && s.sources ? 'Searched the web for' : label0;
    const chips = found.length ? `<div class="ch-chips">${found.slice(0, 4).map((x) => `<a class="ch-chip" data-href="${esc(x.url)}" title="${esc(x.url)}">${fav(x.url)}<span>${esc(x.title || host(x.url))}</span></a>`).join('')}${found.length > 4 ? `<span class="ch-chip more">+${found.length - 4} ${esc(_t('more'))}</span>` : ''}</div>` : '';
    return `<li class="${now ? 'now' : 'done'}${now && s.fresh ? ' new' : ''}"><span class="mk"></span><div class="tx">`
      + `<span class="t1${now ? ' shimmer' : ''}"><i class="fa-solid fa-${ic}" style="--c:${c}"></i>${esc(_t(label))}${s.detail ? ` <b>${esc(s.detail)}</b>` : ''}</span>${chips}</div></li>`;
  }
  // the pages this run's searches found, numbered as the engine numbers them for the model ([1] onwards)
  const liveSources = (cur) => cur.steps.flatMap((s) => s.sources || []).filter((x) => /^https?:/i.test(x.url || '')).map((x, i) => ({ ...x, n: i + 1 }));
  function thinkHtml() {
    const cur = tool || { steps: [], start: Date.now() };
    const secs = Math.max(0, Math.round((Date.now() - cur.start) / 1000));
    const name = (st.settings && st.settings.ponyName) || 'Pony';
    const live = cur.live && cur.live.text;
    const worked = !!live;
    const head = worked ? _t('Worked for {n} s', { n: Math.max(1, secs) })
      : secs >= 20 ? _t('Still working on it…') : cur.steps.length ? _t('{name} is working', { name }) : _t('{name} is thinking', { name });
    const shown = cur.steps.slice(-5);
    const steps = shown.map((s, i) => stepLi(s, !worked && i === shown.length - 1)).join('')
      + (worked && cur.steps.length ? `<li class="fin"><span class="mk">${fa('check')}</span><span class="t1">${esc(_t('Finished thinking'))}</span></li>` : '');
    return `<div class="ch-wk-head${worked ? ' worked' : ''}"><span class="t1${worked ? '' : ' shimmer'}">${esc(head)}</span>${worked ? '' : `<span class="ch-think-t">${esc(_t('{n} s', { n: secs }))}</span>`}</div>`
      + (steps ? `<ul class="ch-tl">${steps}</ul>` : '')
      + (live ? `<div class="ch-ans"><div class="ch-ans-h"><span class="sp">${fa('wand-magic-sparkles')}</span><span class="shimmer">${esc(_t('Writing'))}</span></div><div class="ch-live" dir="auto">${cites(markdown(live), { sources: liveSources(cur) })}</div></div>` : '');
  }
  // the streamed answer's words: the ones already there stay still, the new ones come in from a blur (AI Answer)
  function wordsIn(el, from) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('pre, code, a.ch-cite, .md-code-hd, .md-chk, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    let k = 0;
    for (const n of nodes) {
      const parts = n.nodeValue.split(/(\s+)/);
      if (parts.length < 2 && !parts[0]) continue;
      const frag = document.createDocumentFragment();
      for (const w of parts) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); continue; }
        const span = document.createElement('span');
        span.textContent = w;
        if (k >= from) { span.className = 'nw'; span.style.animationDelay = `${Math.min(k - from, 12) * 28}ms`; }
        frag.appendChild(span);
        k++;
      }
      n.parentNode.replaceChild(frag, n);
    }
    return k;
  }
  // what a finished answer keeps of the work: "Worked for 7 s ›", the steps open on a click
  function workHtml(m, i) {
    const w = m.work;
    if (!w || !(w.steps || []).length) return '';
    return `<button type="button" class="ch-worked${m.workOpen ? ' open' : ''}" data-work="${i}"><span>${esc(_t('Worked for {n} s', { n: w.secs }))}</span>${fa('chevron-right')}</button>`
      + (m.workOpen ? `<ul class="ch-tl static">${w.steps.map((s) => stepLi(s, false)).join('')}<li class="fin"><span class="mk">${fa('check')}</span><span class="t1">${esc(_t('Finished thinking'))}</span></li></ul>` : '');
  }
  let thinkTimer = 0;
  function syncThink() {
    const box = page && $('.ch-think', page);
    if (!box || !pending) { clearInterval(thinkTimer); thinkTimer = 0; return; }
    box.innerHTML = thinkHtml();
    box.classList.toggle('live', !!(tool && tool.live && tool.live.text));
    avaMood();
    $$('a[data-href]', box).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.href); }; });
    $$('.ch-copy', box).forEach((b) => { b.onclick = () => { const c = b.closest('.md-code, pre')?.querySelector('code'); if (c) { navigator.clipboard.writeText(c.textContent); N.toast(fa('copy', 'regular'), _t('Code copied')); } }; });
    const lv = $('.ch-live', box);
    if (lv && tool && tool.live) tool.live.words = wordsIn(lv, tool.live.words || 0);
    if (tool) tool.steps.forEach((s) => { s.fresh = false; });
    const list = $('.ch-msgs', page); if (list) list.scrollTop = list.scrollHeight;
    if (!thinkTimer) thinkTimer = setInterval(() => { const t = page && $('.ch-think-t', page); if (!t || !pending || !tool) { clearInterval(thinkTimer); thinkTimer = 0; return; } t.textContent = _t('{n} s', { n: Math.round((Date.now() - tool.start) / 1000) }); const h = $('.ch-wk-head:not(.worked) .t1', page); if (h && Date.now() - tool.start >= 20000) h.textContent = _t('Still working on it…'); }, 1000);
  }

  // Pony thinking, alive, beside the "…" while an answer is on its way (the answers' avatars stay still)
  let liveAva = null;
  function dropLiveAva() { if (liveAva) { liveAva.destroy(); liveAva = null; } }
  // Pony's face says where the work is: thinking, at a step, waiting on your OK, writing the answer
  let avaWas = '';
  function avaMood() {
    if (!liveAva || !tool) return;
    const last = tool.steps[tool.steps.length - 1];
    const m = approval ? 'attention' : tool.live && tool.live.text ? 'happy' : last && last.kind === 'screen' ? 'looking' : tool.steps.length ? 'working' : 'think';
    if (m === avaWas) return;
    // (a little hop when it starts writing, and when a card needs you)
    if (avaWas && (m === 'happy' || m === 'attention')) liveAva.hop(0.5);
    avaWas = m;
    liveAva.setMood(m);
  }
  function mountLiveAva(box) {
    dropLiveAva();
    const cv = $('.ch-ava-live', box);
    if (!cv || !window.Pony || !window.Pony.mount) return;
    const sset = st.settings || {};
    liveAva = window.Pony.mount(cv, { scale: 1, floorFrac: 0.76, hop: 0.4, shape: sset.ponyShape || 'Classic', color: sset.ponyColor || 'Lavender', mood: 'think' });
    avaWas = '';
    avaMood();
  }

  // The empty chat: Pony alive on a small stage, a greeting for the time of day and four things to try
  let emptyPony = null;
  function dropEmptyPony() { if (emptyPony) { emptyPony.destroy(); emptyPony = null; } }
  function greeting() {
    const h = new Date().getHours();
    return h >= 4 && h < 11 ? _t('Good morning') : h >= 11 && h < 15 ? _t('Good afternoon') : h >= 15 && h < 18 ? _t('Good evening!|afternoon, 15–18') : _t('Good night!|evening, after 18');
  }
  function renderEmpty(box, p) {
    const name = (st.settings && st.settings.ponyName) || 'Pony';
    const sig = JSON.stringify([p.ready, p.need, name, greeting(), (st.settings || {}).ponyShape, (st.settings || {}).ponyColor]);
    if (box.firstElementChild && box.firstElementChild.dataset.sig === sig && emptyPony) return;
    dropEmptyPony();
    box.innerHTML = `<div class="ch-hello${p.ready ? '' : ' off'}" data-sig="${esc(sig)}">`
      + `<div class="ch-empty-stage"><canvas id="chEmptyPony" width="104" height="104" title="${esc(name)}"></canvas></div>`
      + (p.ready
        ? `<div class="ch-empty-main"><div class="ch-empty-hi">${esc(greeting().replace(/!$/, ''))}!</div>`
          + `<div class="ch-empty-sub">${esc(_t('I’m {name}. What can I help with?', { name }))}</div>`
          + `<div class="ch-empty-grid">${SUGGEST.map(([ic, t, c]) => `<button type="button" class="ch-sugg" data-sugg="${esc(t)}"><span class="ic" style="--c:${c}">${fa(ic)}</span><span class="t1">${esc(t)}</span></button>`).join('')}</div></div>`
        : `<div class="ch-empty-main"><div class="ch-empty-hi">${esc(_t('{name} is asleep', { name }))}</div>`
          + `<div class="ch-empty-sub">${esc(_t('Add {need} to start chatting', { need: p.need }))}</div>`
          + `<button type="button" class="sbtn p" id="chSetup" style="margin-top:10px;align-self:flex-start">${esc(_t('Open Settings'))}</button></div>`)
      + `</div>`;
    const cv = $('#chEmptyPony', box);
    if (cv && window.Pony && window.Pony.mount) {
      const sset = st.settings || {};
      emptyPony = window.Pony.mount(cv, { scale: 0.88, floorFrac: 0.84, hop: 0.6, shape: sset.ponyShape || 'Classic', color: sset.ponyColor || 'Lavender', mood: p.ready ? 'idle' : 'sleep' });
      cv.onclick = () => { if (emptyPony) emptyPony.poke(); };
    }
    const wrap = $(".ch-hello", box);
    // (Pony watches the pointer, and smiles at the idea under it)
    wrap.onmousemove = (ev) => {
      if (!emptyPony || !cv) return;
      const r = cv.getBoundingClientRect();
      const k = (v) => Math.max(-1, Math.min(1, v));
      emptyPony.lookAt(k((ev.clientX - (r.left + r.width / 2)) / 220), k((ev.clientY - (r.top + r.height / 2)) / 90));
    };
    $$('[data-sugg]', box).forEach((b) => {
      b.onmouseenter = () => { if (emptyPony) emptyPony.setMood('happy'); };
      b.onmouseleave = () => { if (emptyPony) emptyPony.setMood('idle'); };
      b.onclick = () => { const i = $('#chIn', page); i.value = b.dataset.sugg; N.focusField(i); };
    });
    const s2 = $('#chSetup', box); if (s2) s2.onclick = () => { api.openSettings('ai'); if (!N.isFloatingChat && N.closeNotch) N.closeNotch(); };
  }

  function render() {
    if (!page) return;
    const p = provider();
    const provEl = $('.ch-prov', page);
    if (provEl) provEl.textContent = (st.settings && st.settings.ponyName) || 'Pony';
    if (provEl) provEl.title = p.label || '';
    const box = $('.ch-msgs', page);
    const histBtn = $('#chHist', page);
    if (histBtn) {
      histBtn.classList.toggle('on', history);
      histBtn.disabled = !chats.list.length && !history;
    }
    if (!history) dropDeleted();
    const agentName = p.label || 'Claude';
    const agentIco = ponyAva(30);
    const thinkingIco = '<canvas class="ch-ava ch-ava-live" width="30" height="30" style="width:30px;height:30px"></canvas>';
    if (history) {
      lastRenderSig = '';
      dropLiveAva();
      dropEmptyPony();
      const when = (t) => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? N.hm(t) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
      const keep = $('.ch-hist', box) ? box.scrollTop : 0;
      box.innerHTML = `<div class="c grow sc-y ch-hist" style="padding:10px 12px;gap:4px"><div class="row" style="justify-content:space-between;margin-bottom:4px"><b>${esc(_t('Conversations'))}</b><span class="sub" style="font-size:10.5px">${esc(_t('{n} saved on this PC', { n: chats.list.length }))}</span></div>`
        + (withUndo(chats.list.map((c) => `<div class="nrow${c.id === chats.current ? ' on' : ''}" data-open="${esc(c.id)}" style="flex-direction:row;align-items:center;gap:8px"><span class="t1" style="flex:1;font-size:12.5px;font-weight:600">${esc(c.title || _t('Chat'))}</span><span class="sub" style="font-size:10.5px;flex:none">${esc(when(c.updated))}</span><button type="button" data-del="${esc(c.id)}" title="${esc(_t('Delete this conversation'))}" style="color:var(--mute);cursor:pointer;flex:none">${N.ic('trash', 'width:12px;height:12px')}</button></div>`)).join('')
          || `<span class="sub">${esc(_t('No conversations yet'))}</span>`) + `</div>`;
      $$('[data-open]', box).forEach((r) => { r.onclick = (e) => { if (!e.target.closest('[data-del]')) open(r.dataset.open); }; });
      $$('[data-del]', box).forEach((b) => { b.onclick = () => removeChat(b.dataset.del); });
      $$('[data-restore]', box).forEach((b) => { b.onclick = undoRemove; });
      box.scrollTop = keep;
    } else if (!msgs.length && !pending && !activeAsk) {
      lastRenderSig = '';
      renderEmpty(box, p);
    } else {
      dropEmptyPony();
      const renderSig = JSON.stringify([msgs.length, msgs.map((m) => [m.role, m.kind, m.error, m.later, m.content && m.content.length, (m.actions || []).map((a) => !!a.undone)]), pending, searching, activeAsk ? activeAsk.id : null, p.label, approval ? approval.id : null, Object.keys(peeks)]);
      const existingAsk = $('.ch-ask-wrap', box);
      if (renderSig === lastRenderSig && existingAsk && activeAsk && existingAsk.dataset.askId === activeAsk.id) {
        if (N.ccSyncContainer && N.ccGetSel) N.ccSyncContainer(existingAsk, activeAsk, N.ccGetSel(activeAsk.id));
      } else {
        lastRenderSig = renderSig;
        const askHtml = activeAsk && N.ccCard && N.ccGetSel
          ? `<div class="ch-ask-wrap" data-ask-id="${esc(activeAsk.id)}">${N.ccCard(activeAsk, N.ccGetSel(activeAsk.id), null, { inline: true })}</div>`
          : '';
        box.innerHTML = msgs.map((m, i) => (m.role === 'user'
          ? (m.kind === 'answer'
            ? renderAnswerBubble(m, i)
            : userBubble(m, i))
          : `<div class="row ch-msg ai${m.error ? ' err' : ''}" data-i="${i}" style="align-items:flex-start;gap:8px;max-width:95%">${agentIco}<div class="bub" dir="auto">${m.error ? `${fa('circle-exclamation')} ${esc(m.content)}` : workHtml(m, i) + (m.seen ? seenLine(m.seen) : '') + (m.stopped && m.content === _t('Stopped') ? '' : answerHtml(m, i)) + (m.stopped ? `<div class="ch-stopped">${fa('circle-stop')} ${esc(_t('Stopped'))}</div>` : '')}</div>`
            + `${m.error ? '' : copyBtn(i)}</div>`)).join('')
          + (pending && searching ? `<div class="row" style="gap:8px">${thinkingIco}<div style="padding:8px 12px;border-radius:14px;background:var(--tile);font-size:12px;color:var(--dim)">${fa('globe')} ${esc(_t('Searching the web for “{query}”…', { query: searching }))}</div></div>`
            : pending ? `<div class="row" style="gap:8px;align-items:flex-start">${thinkingIco}<div class="ch-think">${thinkHtml()}</div></div>` : '')
          + approveHtml()
          + peekHtml()
          + askHtml;
        $$('[data-copy]', box).forEach((b) => {
          b.onclick = () => {
            const txt = copyMessageText(msgs[+b.dataset.copy]);
            if (!txt) return;
            navigator.clipboard.writeText(txt);
            N.toast(fa('copy', 'regular'), _t('Copied'));
          };
        });
        $$('.ch-copy', box).forEach((b) => { b.onclick = () => { const c = b.closest('.md-code, pre')?.querySelector('code'); if (c) { navigator.clipboard.writeText(c.textContent); N.toast(fa('copy', 'regular'), _t('Code copied')); } }; });
        $$('a[data-href]', box).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.href); }; });
        bindSuggest(box);
        $$('[data-tab]', box).forEach((b) => { b.onclick = () => N.openModule(b.dataset.tab); });
        $$('[data-ai]', box).forEach((b) => { b.onclick = () => { api.openSettings('ai'); if (!N.isFloatingChat && N.closeNotch) N.closeNotch(); }; });
        $$('[data-srcall]', box).forEach((b) => { b.onclick = () => { msgs[+b.dataset.srcall].srcAll = true; lastRenderSig = ''; render(); }; });
        $$('a.ch-card[data-href]', box).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.href); }; });
        $$('[data-work]', box).forEach((b) => { b.onclick = () => { const m = msgs[+b.dataset.work]; m.workOpen = !m.workOpen; lastRenderSig = ''; render(); }; });
        $$('[data-undo]', box).forEach((b) => {
          const m = msgs[+b.closest('.ch-msg').dataset.i];
          b.onclick = () => { undo(m.actions[+b.dataset.undo]); save(); changed(); };
        });
        $$('[data-ap]', box).forEach((b) => {
          b.onclick = () => {
            if (!approval) return;
            const id = approval.id;
            approval = null;
            api.svc('pony', 'approve', id, b.dataset.ap);
            render();
          };
        });
        $$('[data-peek]', box).forEach((b) => {
          b.onclick = () => { api.svc('pony', 'aiPeek', b.dataset.peek); delete peeks[b.dataset.peek]; render(); };
        });
        const askWrap = $('.ch-ask-wrap', box);
        if (askWrap && activeAsk && N.ccWireContainer) N.ccWireContainer(askWrap, activeAsk);
        if (pending) { mountLiveAva(box); syncThink(); } else dropLiveAva();
        box.scrollTop = box.scrollHeight;
      }
    }
    syncSend();
    syncAutoUi();
    const newBtn = $('#chNew', page); if (newBtn) newBtn.disabled = (!msgs.length && !history) || pending;
    refreshCards();
  }

  // empty: back to one line (a placeholder wrapped while the notch is still opening would count otherwise)
  function grow(el) { el.style.height = 'auto'; el.style.height = el.value ? Math.min(78, el.scrollHeight) + 'px' : ''; }

  // ---- attachments: pictures (shrunk here, sent to the model) and text files (their text goes with the message).
  // At most 4. The chat keeps a small thumbnail of each picture and the file's name, never the full image.
  const MAX_ATT = 4;
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|toml|ini|html?|css|m?js|tsx?|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql)$/i;
  const IMG_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
  let attach = []; // { id, kind: 'image'|'text'|'bad', name, size, data?, thumb?, text?, why? }
  const canSee = () => {
    const s = st.settings || {};
    if (['sympony', 'api'].includes(s.ponyBrain)) return true;
    const a = N.aiAgent ? N.aiAgent('chatAgent') : null;
    return !!(a && a.id === 'claude');
  };
  const kb = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  function fileLook(name) {
    const ext = ((String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (/^(csv|tsv)$/.test(ext)) return ['table', 'var(--emerald)'];
    if (/^(md|markdown|txt|log)$/.test(ext)) return ['file-lines', 'var(--sky)'];
    if (ext === 'pdf') return ['file-pdf', 'var(--amber)'];
    if (TEXT_EXT.test('.' + ext)) return ['code', 'var(--lilac)'];
    return ['file', 'var(--amber)'];
  }
  // a picture → { data: what the model gets (≤1568 px, JPEG), thumb: what the chat keeps (≤120 px) }
  function shrink(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const out = (max, q) => {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', q);
        };
        const r = { data: out(1568, 0.85), thumb: out(120, 0.7) };
        URL.revokeObjectURL(url);
        resolve(r);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }
  async function addAttachment(name, size, get) {
    if (attach.filter((a) => a.kind !== 'bad').length >= MAX_ATT) { N.toast(fa('paperclip'), _t('Up to {n} attachments per message', { n: MAX_ATT })); return; }
    const item = { id: uid(), name: name || _t('Pasted image'), size: size || 0 };
    try { Object.assign(item, await get()); } catch { Object.assign(item, { kind: 'bad', why: _t('Couldn’t read it') }); }
    if (item.kind === 'image' && !canSee()) Object.assign(item, { kind: 'bad', why: _t('Pictures need Sympony AI') });
    attach.push(item);
    renderTray();
  }
  function addFile(file) {
    const name = file.name || '';
    if ((file.type || '').startsWith('image/') || IMG_EXT.test(name)) {
      return addAttachment(name, file.size, async () => (file.size > 20 << 20 ? { kind: 'bad', why: _t('Too big') } : { kind: 'image', ...(await shrink(file)) }));
    }
    if (TEXT_EXT.test(name) || (file.type || '').startsWith('text/')) {
      return addAttachment(name, file.size, async () => (file.size > 200 << 10 ? { kind: 'bad', why: _t('Too big') } : { kind: 'text', text: await file.text() }));
    }
    return addAttachment(name, file.size, async () => ({ kind: 'bad', why: /\.pdf$/i.test(name) ? _t('PDF coming soon') : _t('Not supported yet') }));
  }
  function addPath(path) {
    return addAttachment(path.split('/').pop(), 0, async () => {
      const r = await api.svc('pony', 'file', path);
      if (!r || !r.ok) return { kind: 'bad', why: _t('Couldn’t read it') };
      const base = { size: r.size || 0 };
      if (r.big) return { ...base, kind: 'bad', why: _t('Too big') };
      if (r.kind === 'image') {
        const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
        return { ...base, kind: 'image', ...(await shrink(new Blob([bin], { type: r.mime || 'image/png' }))) };
      }
      if (r.kind === 'text') return { ...base, kind: 'text', text: r.text || '' };
      return { ...base, kind: 'bad', why: /\.pdf$/i.test(path) ? _t('PDF coming soon') : _t('Not supported yet') };
    });
  }
  function renderTray() {
    const tray = page && $('#chTray', page);
    if (!tray) return;
    const ok = attach.filter((a) => a.kind !== 'bad').length;
    const bad = attach.find((a) => a.kind === 'bad');
    tray.hidden = !attach.length;
    page.classList.toggle('has-att', !!attach.length);
    tray.innerHTML = attach.map((a) => {
      const x = `<button type="button" class="x" data-unattach="${esc(a.id)}" title="${esc(_t('Remove'))}">${fa('xmark')}</button>`;
      if (a.kind === 'image') return `<div class="ch-att-img" title="${esc(a.name)}"><img src="${esc(a.thumb)}" alt="">${x}</div>`;
      const [ic, c] = fileLook(a.name);
      return `<div class="ch-att-file${a.kind === 'bad' ? ' bad' : ''}" style="--c:${a.kind === 'bad' ? 'var(--amber)' : c}" title="${esc(a.name)}"><span class="ic">${fa(ic)}</span><span class="nm"><b>${esc(a.name)}</b><span>${esc(a.kind === 'bad' ? a.why : kb(a.size))}</span></span>${x}</div>`;
    }).join('')
      + (bad ? `<span class="ch-att-note">${fa('circle-info')} ${esc(ok ? _t('{what}: the rest still goes', { what: bad.why }) : bad.why)}</span>` : `<span class="ch-att-count">${ok} / ${MAX_ATT}</span>`);
    $$('[data-unattach]', tray).forEach((b) => { b.onclick = () => { attach = attach.filter((a) => a.id !== b.dataset.unattach); renderTray(); }; });
  }
  function dropZone(on) {
    const z = page && $('#chDrop', page);
    if (z) z.hidden = !on;
    if (emptyPony) emptyPony.setMood(on ? 'attention' : 'idle');
    if (ponyHeaderHandle) ponyHeaderHandle.setMood(on ? 'attention' : (N.pony && N.pony.mood ? N.pony.mood() : 'idle'));
  }

  async function send(text, opts = {}) {
    if (!text || pending) return null;
    if (!provider().ready) { changed(); return { role: 'assistant', content: _t('Add {need} in Settings → Pony Assistant first.', { need: provider().need }), error: true }; }
    const brief = !!(opts && opts.brief);
    const hidden = !!(opts && opts.hidden);
    const qa = opts && opts.qa ? opts.qa : null;
    if (!hidden && activeAsk) clearActiveAsk();
    history = false;
    // a failed answer isn't part of the conversation the model sees
    msgs = msgs.filter((m) => !m.error);
    const att = (opts && opts.attach) || [];
    const imgs = att.filter((a) => a.kind === 'image');
    const txts = att.filter((a) => a.kind === 'text');
    const files = att.map((a) => (a.kind === 'image' ? { kind: 'image', name: a.name, thumb: a.thumb } : { kind: 'text', name: a.name, size: a.size }));
    if (!opts.existing) msgs.push(hidden
      ? { role: 'user', content: text, kind: 'answer', ...(qa ? { qa } : {}) }
      : { role: 'user', content: text, ...(files.length ? { files } : {}) });
    pending = true;
    save(); changed();
    if (N.pony && N.pony.sync) N.pony.sync();
    const dayCtx = await dayContext().catch(() => '');
    const extraCtx = opts && opts.screenContext ? String(opts.screenContext) : '';
    const context = [dayCtx, extraCtx].filter(Boolean).join('\n');
    // this run's id: the agent's calls to Sympony's tools come back to this window with it (agent:tool below)
    const session = uid().replace(/[^a-z0-9]/gi, '');
    tool = { session, actions: [], steps: [], start: Date.now() };
    syncSend();
    if (imgs.length) tool.steps.push({ kind: 'see', detail: _t('{n} pictures', { n: imgs.length }) });
    if (txts.length) tool.steps.push({ kind: 'read', detail: txts.length === 1 ? txts[0].name : _t('{n} files', { n: txts.length }) });
    if (imgs.length || txts.length) { tool.steps.forEach((x) => { x.fresh = true; }); syncThink(); }
    // (a text file's text goes with this message only; the chat keeps just its name)
    const fileText = txts.map((a) => `\n\n[Attached file: ${a.name}]\n` + '```\n' + a.text + '\n```').join('');
    const wire = msgs.map(({ role, content }, i) => ({ role, content: i === msgs.length - 1 && fileText ? content + fileText : content }));
    const autoOverride = typeof opts.autoUi === 'boolean' ? opts.autoUi : null;
    const r = await api.svc('chat', 'send', wire, context, session, brief, imgs.map((a) => a.data), chats.current || '', autoOverride);
    const done = tool.actions;
    const wasStopped = !!tool.stopped;
    const work = tool.steps.length ? { secs: Math.max(1, Math.round((Date.now() - tool.start) / 1000)), steps: tool.steps.map(({ kind, detail, sources }) => ({ kind, detail, ...(sources ? { sources } : {}) })) } : null;
    tool = null;
    approval = null;
    pending = false;
    searching = '';
    // a web search's pages, what it searched for, Google's search suggestions and why it answered without a search
    // (kept in History with the answer, which shows them with it)
    const web = r && r.ok ? {
      ...((r.sources || []).length ? { sources: r.sources } : {}), ...((r.searched || []).length ? { searched: r.searched } : {}),
      ...(r.suggest ? { suggest: r.suggest } : {}),
      ...(r.searchNote ? { searchNote: r.searchNote, ...(r.searchFix ? { searchFix: true } : {}) } : {}),
    } : {};
    const seen = { ...(imgs.length || txts.length ? { seen: { img: imgs.length, txt: txts.length } } : {}), ...(work ? { work } : {}), ...(wasStopped ? { stopped: true } : {}) };
    const answer = r && r.ok ? (await (async () => { const a = { role: 'assistant', ...(await takeActions(r.text)), ...web, ...seen }; a.actions = [...done, ...(a.actions || [])]; return a; })())
      // (an error after the agent already did something: what it did stays, with its Undo)
      : done.length ? { role: 'assistant', content: r && r.error === 'stopped' ? _t('Stopped') : `${(r && r.error) || _t('No answer')}`, actions: done, ...(r && r.error === 'stopped' ? { stopped: true } : {}) }
        : r && r.error === 'stopped' ? { role: 'assistant', content: _t('Stopped'), stopped: true }
        : { role: 'assistant', content: (r && r.error) || _t('No answer'), error: true };
    // (steering the run ended before reading: those messages move after the answer and go as the next turn)
    const unread = [...((r && r.unread) || []), ...later];
    later = [];
    if (unread.length) {
      const moved = msgs.filter((m) => m.steer && (m.later || unread.includes(m.content)));
      msgs = msgs.filter((m) => !moved.includes(m));
      moved.forEach((m) => { delete m.later; delete m.steer; });
      msgs.push(answer, ...moved);
    } else msgs.push(answer);
    if (unread.length) setTimeout(() => send(unread.join('\n\n'), { existing: true }), 0);
    showInNotch();
    save(); changed();
    if (N.pony && N.pony.sync) N.pony.sync();
    if (queuedAnswer) {
      const next = queuedAnswer;
      queuedAnswer = null;
      send(next.text, { hidden: true, qa: next.qa });
    }
    return answer;
  }
  // Stop, from the composer's button while Pony works: the run ends, what it wrote stays, an open card says no
  function stopRun() {
    if (!pending || !tool) return;
    if (approval) { api.svc('pony', 'approve', approval.id, 'deny'); approval = null; }
    tool.stopped = true;
    api.svc('chat', 'stop', tool.session);
    syncSend();
  }
  // Auto UI pill: quick toggle inside the composer when Eyes & Hands are on
  function syncAutoUi() {
    const b = page && $('#chAutoUi', page);
    if (!b) return;
    const s = st.settings || {};
    const avail = !!(s.ponyEyes && s.ponyHands);
    b.hidden = !avail;
    if (!avail) return;
    const on = !!s.ponyAutoUi;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on
      ? _t('Auto UI: On — Pony operates UI, watches until responses finish, and continues automatically (financial/destructive actions still ask)')
      : _t('Auto UI: Off — click to let Pony run full multi-step UI automation and watch until responses finish');
  }
  function toggleAutoUi(e) {
    if (e) e.stopPropagation();
    const next = !(st.settings && st.settings.ponyAutoUi);
    if (st.settings) st.settings.ponyAutoUi = next;
    syncAutoUi();
    api.setSettings({ ponyAutoUi: next });
  }
  // the composer's round button: send (white arrow), or Stop (red square) while an answer is on its way
  function syncSend() {
    const b = page && $('#chSend', page);
    if (!b) return;
    const typed = !!($('#chIn', page) && $('#chIn', page).value.trim());
    const stop = pending && !!tool && !typed;
    b.classList.toggle('stop', stop);
    b.disabled = stop && !!tool.stopped;
    b.title = stop ? _t('Stop') : _t('Send');
    b.innerHTML = stop ? '<span class="sq"></span>' : N.ic('up', 'width:12px;height:12px;stroke-width:3');
  }
  // Steering: what the user writes or speaks while Pony works goes into the chat now and into the run at its next step
  // (Pony's own engine); a CLI agent, or a run that ends first, gets it as the next message
  let later = [];
  async function steerSend(text, opts = {}) {
    const cur = tool;
    const m = { role: 'user', content: text, steer: true };
    msgs.push(m);
    save(); changed();
    if (opts && opts.alreadySent && (!opts.session || (cur && cur.session === opts.session))) {
      return true;
    }
    const r = cur ? await api.svc('chat', 'steer', cur.session, text).catch(() => null) : null;
    if (!(r && r.ok)) { m.later = true; later.push(text); save(); changed(); return false; }
    return true;
  }
  function sendInput() {
    if (pending) {
      const input = $('#chIn', page);
      const t = input.value.trim();
      if (!t) { stopRun(); return; }
      input.value = ''; grow(input);
      steerSend(t);
      syncSend();
      return;
    }
    const input = $('#chIn', page);
    const ready = attach.filter((a) => a.kind !== 'bad');
    const text = input.value.trim() || (ready.length ? _t('Have a look at this') : '');
    if (!text || pending) return;
    input.value = ''; grow(input);
    attach = []; renderTray();
    send(text, ready.length ? { attach: ready } : {});
  }

  function normalizeAskQuestions(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { return []; }
    }
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.questions) ? parsed.questions : []);
    return list.map((q) => {
      const rawOpts = Array.isArray(q.options) ? q.options : (Array.isArray(q.o) ? q.o : []);
      const opts = rawOpts
        .map((o) => (typeof o === 'string' ? { l: o, d: '' } : { l: String(o.label || o.l || ''), d: String(o.description || o.d || '') }))
        .filter((o) => o.l);
      return {
        q: String(q.question || q.q || ''),
        header: String(q.header || q.h || ''),
        o: opts,
        m: !!(q.multiSelect || q.m),
        allowOther: q.allowOther !== false,
        allowEmpty: !!q.allowEmpty,
        placeholder: q.placeholder ? String(q.placeholder) : '',
      };
    }).filter((q) => q.q || q.o.length);
  }

  function answerAsk(id, answers, skipped) {
    const asked = activeAsk && (!id || activeAsk.id === id) ? activeAsk : null;
    if (asked) activeAsk = null;
    if (N.removePonyAsk && id) N.removePonyAsk(id);
    const qs = asked && Array.isArray(asked.questions) ? asked.questions : [];
    let text;
    let qa;
    if (skipped) {
      qa = qs.length
        ? qs.map((q) => ({ header: q.header || '', question: q.q || '', answer: _t('Skipped') }))
        : [{ header: '', question: '', answer: _t('Skipped') }];
      text = qs.length
        ? 'Question & answer:\n' + qs.map((q) => `- ${q.header ? `[${q.header}] ` : ''}${q.q || ''}: (the user skipped your question)`).join('\n')
        : '(the user skipped your question)';
    } else {
      const ansMap = answers || {};
      if (qs.length) {
        qa = qs.map((q, idx) => {
          const key = q.header || q.q || String(idx);
          const val = ansMap[key] != null ? ansMap[key] : (Object.values(ansMap)[idx] || '');
          return { header: q.header || '', question: q.q || '', answer: String(val) };
        });
      } else {
        qa = Object.entries(ansMap).map(([k, v]) => ({ header: k, question: '', answer: String(v) }));
      }
      text = 'Question & answer:\n' + qa.map((r) => {
        const prefix = r.header ? `[${r.header}] ` : '';
        const qText = r.question ? `${r.question} -> ` : '';
        return `- ${prefix}${qText}${r.answer || '(skipped)'}`;
      }).join('\n');
    }
    if (pending) {
      queuedAnswer = { text, qa };
      changed();
    } else {
      send(text, { hidden: true, qa });
    }
  }

  function dismissAsk(id) {
    if (!activeAsk || (id && activeAsk.id !== id)) return;
    clearActiveAsk();
    changed();
  }

  // ---- Sympony's tools (mcp.rs): the agent of the run this window waits on calls one; it's AI Chat's own action
  // (the chips and their Undo as for a [[…]] line), and what came of it goes back to the agent
  let tool = null; // { session, actions } while a send waits
  const said = (a) => {
    if (!a.ok) return `Not done${a.why === 'past' ? ': that time has passed' : ''} (${a.kind}: ${a.text || ''})`;
    const when = a.due ? ` for ${new Date(a.due).toLocaleString()}` : '';
    return `Done: ${a.kind}${a.text ? ` “${a.text}”` : ''}${when}${a.existed ? ' (it was already there)' : ''}${a.id ? ` [${a.id}]` : ''}`;
  };
  api.on('pony:approve', (d) => {
    if (!tool || !d || d.session !== tool.session) return;
    approval = d;
    render();
    avaMood();
    // (the notch is closed: say so, a click opens the chat with the card)
    showInNotch();
  });
  // An agent Pony started finished: a line in the chat, and the notch comes down on Pony when it's closed
  api.on('pony:agentDone', (d) => {
    if (!d) return;
    const head = d.ai
      ? _t(d.failed ? 'Couldn’t get an answer from {p}:' : '{p} answered:', { p: d.project || '' })
      : _t(d.failed ? 'The agent in {p} stopped with an error.' : 'The agent in {p} finished.', { p: d.project || '' });
    if (d.id) delete peeks[d.id];
    msgs.push({ role: 'assistant', content: d.text ? `${head}\n\n${d.text}` : head });
    save(); changed();
    showInNotch();
  });
  api.on('pony:aiPeek', (d) => {
    if (!d || !d.id) return;
    peeks[d.id] = d.name || '';
    render();
    showInNotch();
  });
  api.on('pony:aiPeeked', (d) => {
    if (d && peeks[d.id] !== undefined) { delete peeks[d.id]; render(); }
  });
  api.on('pony:approved', (d) => {
    if (approval && d && approval.id === d.id) { approval = null; render(); }
  });
  api.on('agent:delta', (d) => {
    if (!tool || !d || d.session !== tool.session || typeof d.text !== 'string') return;
    // (a newer round starts over: what came before a tool call was only the lead-up)
    if (tool.live && d.round < tool.live.round) return;
    // (the words already shown stay still: only the ones after them come in)
    const words = tool.live && tool.live.round === d.round ? tool.live.words || 0 : 0;
    tool.live = { round: d.round, text: d.text, words };
    syncThink();
  });
  api.on('agent:step', (d) => {
    if (!tool || !d || d.session !== tool.session) return;
    // (a search's results: under the step that searched)
    if (d.update && d.sources) {
      const s = [...tool.steps].reverse().find((x) => x.kind === d.kind && x.detail === d.detail) || [...tool.steps].reverse().find((x) => x.kind === d.kind);
      if (s) { s.sources = d.sources; syncThink(); return; }
    }
    // A new tool step started after any preamble text: clear live text so the UI stays in active working state.
    if (tool.live) tool.live = null;
    tool.steps.push({ kind: d.kind, detail: d.detail || '', fresh: true });
    syncThink();
  });
  api.on('agent:tool', async (t) => {
    const cur = tool; // (this run's, even if it ends while the action runs)
    if (!cur || !t || t.session !== cur.session) return; // (another window's run, or one that ended)
    let res;
    try {
      if (t.kind === 'context') {
        res = st.settings.chatContext === false ? { ok: true, text: 'The user turned off sharing their day with Pony.' }
          : { ok: true, text: (await dayContext()) || 'Nothing to share right now.' };
      } else if (t.kind === 'ask') {
        const questions = normalizeAskQuestions(t.args);
        if (!questions.length) {
          res = { ok: false, text: 'ask_user requires at least one question' };
        } else {
          const ponyName = (window.Pony && window.Pony.look ? window.Pony.look(st.settings).name : 'Pony');
          const item = {
            id: `pony:${cur.session}`,
            source: 'pony',
            kind: 'question',
            agent: ponyName,
            questions,
            answer: true,
          };
          activeAsk = item;
          showInNotch();
          res = { ok: true, text: 'asked' };
          api.svc('agent', 'result', t.call, res).catch(() => {});
          if (N.addPonyAsk) N.addPonyAsk(item);
          changed();
          return;
        }
      } else {
        const a = await run(t.kind, String(t.args || ''));
        cur.actions.push(a);
        res = { ok: !!a.ok, text: said(a) };
      }
    } catch (e) { res = { ok: false, text: String(e) }; }
    api.svc('agent', 'result', t.call, res).catch(() => {});
  });

  // for Pony ask_user cards, notch and floating chat integration
  N.chat = {
    send, steer: steerSend, stop: stopRun, markdown, actionChips, answerAsk, dismissAsk, newChat,
    provider,
    toggleHistory: () => { history = !history; changed(); },
    isHistory: () => history,
    hasHistory: () => chats.list.length > 0,
    hasMessages: () => msgs.length > 0,
    activeAsk: () => activeAsk,
    answer: answerHtml, // the text with its sources and what it did
    ready: () => provider().ready,
    pending: () => pending,
    searching: () => (pending ? searching : ''),
    last: () => msgs.slice(-2),
    onChange: (f) => listeners.add(f),
    undo: (m, i) => { undo(m.actions[i]); save(); changed(); },
  };

  const cards = new Set();

  function paintCard(el) {
    el.style.setProperty('--tint', '#d97757');
    el.style.flexDirection = 'row';
    el.style.gap = '12px';
    const p = provider();
    const agentName = p.label || 'Claude';
    const ico = ponyAva(38);
    const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant' && !m.error);
    const bubbleText = (lastAsst && lastAsst.content ? lastAsst.content.replace(/\s+/g, ' ').trim() : '') || _t('Ask anything about your day, tasks, or notes.');
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:none">${ico}<span style="font-size:9.5px;color:var(--mute);font-weight:700">${N.MAC ? '⌘K' : 'Ctrl K'}</span></div>`
      + `<div style="flex:1;min-width:0;display:flex;flex-direction:column">`
      + `<div class="t1" style="align-self:flex-start;max-width:100%;padding:6px 10px;border-radius:12px 12px 12px 4px;background:var(--pill-hi);font-size:12px" dir="auto">${esc(bubbleText)}</div>`
      + `<div class="row" style="margin-top:auto;height:30px;padding:0 4px 0 11px;border-radius:15px;background:var(--pill);color:var(--mute);font-size:12px">`
      + `<span style="flex:1">${esc(_t('Ask anything…'))}</span>`
      + `<span class="mini-btn w" style="width:22px;height:22px">${N.ic('up', 'width:11px;height:11px;stroke-width:3')}</span></div></div>`;
  }

  function refreshCards() {
    for (const el of cards) {
      if (!el.isConnected) { cards.delete(el); continue; }
      paintCard(el);
    }
  }

  let ponyHeaderHandle = null;

  // the composer's Pony is alive: it takes the notch's mood as it changes, looks toward the cursor while the
  // notch is open, and a click pokes it
  window.addEventListener('pony:mood', (e) => { if (ponyHeaderHandle) ponyHeaderHandle.setMood(e.detail); });
  let lookRaf = 0;
  function ponyLookAt(ev) {
    if (!ponyHeaderHandle || lookRaf) return;
    lookRaf = requestAnimationFrame(() => {
      lookRaf = 0;
      const cv = page && $('#chPony', page);
      if (!cv || !ponyHeaderHandle) return;
      const r = cv.getBoundingClientRect();
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      ponyHeaderHandle.lookAt(clamp((ev.clientX - (r.left + r.width / 2)) / 160), clamp((ev.clientY - (r.top + r.height / 2)) / 90));
    });
  }

  function syncHeaderPony() {
    if (!ponyHeaderHandle) return;
    const s = st.settings || {};
    ponyHeaderHandle.setLook(s.ponyShape || 'Classic', s.ponyColor || 'Lavender');
    if (N.pony && N.pony.mood) ponyHeaderHandle.setMood(N.pony.mood());
  }

  N.register({
    id: 'chat',
    tall: true,
    init(p) {
      page = p;
      const prov = provider();
      page.innerHTML = `<div class="ch-shell" style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%;position:relative">`
        + `<div class="ch-msgs sc-y" style="flex:1;display:flex;flex-direction:column;gap:7px"></div>`
        + `<div class="ch-drop" id="chDrop" hidden><span class="ic">${fa('paperclip')}</span><span><b>${esc(_t('Drop to attach'))}</b><span>${esc(_t('Pictures or text files, up to {n}', { n: MAX_ATT }))}</span></span></div>`
        + `<div class="ch-tray" id="chTray" hidden></div>`
        + `<div class="row ch-foot" style="gap:6px;flex:none">`
        + (N.isFloatingChat ? '' : `<button type="button" class="mini-btn" id="chNew" title="${esc(_t('New chat (this one stays in History)'))}" style="width:34px;height:34px;border-radius:17px">${N.ic('plus', 'width:13px;height:13px')}</button>`
          + `<button type="button" class="mini-btn" id="chHist" title="${esc(_t('History'))}" style="width:34px;height:34px;border-radius:17px">${fa('clock-rotate-left')}</button>`
          + `<button type="button" class="mini-btn" id="chFloat" title="${esc(_t('Pop out floating chat'))}" style="width:34px;height:34px;border-radius:17px">${fa('up-right-from-square')}</button>`)
        + `<div class="ch-bar"><span class="ch-who" title="${esc(((st.settings && st.settings.ponyName) || 'Pony') + (prov.label ? ' · ' + prov.label : ''))}"><canvas class="ch-pony-canvas" id="chPony" width="34" height="58"></canvas></span>`
        + `<input id="chIn" type="text" placeholder="${esc(_t('Ask anything…'))}" spellcheck="false">`
        + `<button type="button" id="chAutoUi" class="ch-autoui" hidden aria-pressed="false" title="${esc(_t('Auto UI'))}">${fa('wand-magic-sparkles')}<span>${esc(_t('Auto UI'))}</span></button>`
        + `<button type="button" id="chClip" class="ch-clip" title="${esc(N.MAC ? _t('Attach a picture or a file (⌘V pastes a screenshot)') : _t('Attach a picture or a file (Ctrl+V pastes a screenshot)'))}">${fa('paperclip')}</button>`
        + `<input id="chPick" type="file" multiple hidden accept="image/*,.txt,.md,.csv,.tsv,.json,.log,.xml,.yaml,.yml,.toml,.ini,.html,.css,.js,.mjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.sh,.sql,.pdf">`
        + `<button type="button" id="chSend" class="mini-btn w" style="width:28px;height:28px" title="${esc(_t('Send'))}">${N.ic('up', 'width:12px;height:12px;stroke-width:3')}</button></div>`
        + `</div></div>`;
      page.addEventListener('mousemove', ponyLookAt);
      const ponyCv = $('#chPony', page);
      if (ponyCv) ponyCv.addEventListener('click', () => { if (ponyHeaderHandle) ponyHeaderHandle.poke(); });
      if (ponyCv && window.Pony) {
        const s = st.settings || {};
        ponyHeaderHandle = window.Pony.mount(ponyCv, {
          scale: 1,
          shape: s.ponyShape || 'Classic',
          color: s.ponyColor || 'Lavender',
          floorFrac: 0.86,
          hop: 0.55,
        });
      }
      const input = $('#chIn', page);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendInput(); } });
      input.addEventListener('input', syncSend);
      $('#chSend', page).onclick = sendInput;
      const autoBtn = $('#chAutoUi', page);
      if (autoBtn) autoBtn.onclick = toggleAutoUi;
      const pick = $('#chPick', page);
      $('#chClip', page).onclick = () => pick.click();
      pick.onchange = () => { [...pick.files].forEach(addFile); pick.value = ''; N.focusField(input); };
      // ⌘V: a screenshot (or a copied picture) becomes an attachment; text pastes as usual
      input.addEventListener('paste', (e) => {
        const files = [...((e.clipboardData && e.clipboardData.items) || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
        if (!files.length) return;
        e.preventDefault();
        files.forEach(addFile);
      });
      const newBtn = $('#chNew', page);
      if (newBtn) newBtn.onclick = () => { newChat(); N.focusField(input); };
      const histBtn = $('#chHist', page);
      if (histBtn) histBtn.onclick = () => { history = !history; render(); };
      const floatBtn = $('#chFloat', page);
      if (floatBtn) {
        floatBtn.onclick = () => {
          if (api.openFloatingChat) api.openFloatingChat();
          if (N.closeNotch) N.closeNotch();
        };
      }
      render();
    },
    show() { if (ponyHeaderHandle && ponyHeaderHandle.resume) ponyHeaderHandle.resume(); if (liveAva && liveAva.resume) liveAva.resume(); if (emptyPony && emptyPony.resume) emptyPony.resume(); N.loadAgents().then(render); syncHeaderPony(); render(); },
    hide() { if (ponyHeaderHandle && ponyHeaderHandle.pause) ponyHeaderHandle.pause(); if (liveAva && liveAva.pause) liveAva.pause(); if (emptyPony && emptyPony.pause) emptyPony.pause(); },
    onSettings() { launcher = null; syncHeaderPony(); syncAutoUi(); N.loadAgents().then(render); },
    takeFiles(type, paths) {
      if (history) return false;
      if (type === 'enter' || type === 'over') { dropZone(true); return true; }
      dropZone(false);
      if (type === 'drop') (paths || []).forEach(addPath);
      return true;
    },
    card(el) {
      cards.add(el);
      N.cardClick(el, () => {
        N.openModule('chat');
        const inp = $('#chIn');
        if (inp) N.focusField(inp);
      });
      paintCard(el);
    },
    refreshCards,
  });
})();
