// Shared data cache for modules: one subscription per source, many listeners.
(function () {
  const { api } = N;
  const data = (N.data = {});
  const subs = {};
  N.watch = (key, fn) => {
    (subs[key] = subs[key] || []).push(fn);
    if (data[key] !== undefined) fn(data[key]);
  };
  const set = (key, v) => {
    data[key] = v;
    for (const f of subs[key] || []) { try { f(v); } catch (e) { console.error(key, e); } }
  };
  N.setData = set;
  for (const ch of ['weather', 'health', 'github', 'feed']) api.on(ch, (v) => set(ch, v));
  api.on('store:todo', (v) => set('todo', v));
  api.on('store:notes', (v) => set('notes', v));
  api.on('store:stopwatch', (v) => set('stopwatch', v));
  api.on('store:bookmarks', (v) => set('bookmarks', v));
  N.saveStore = (name, v) => { set(name, v); return api.svc('store', 'set', name, v); };

  // ---- the stopwatch (Pomodoro tab): { running, startedAt, elapsed (ms before startedAt), laps: [ms at each lap] }
  N.swElapsed = () => { const s = data.stopwatch || {}; return (s.elapsed || 0) + (s.running ? Date.now() - s.startedAt : 0); };
  N.swRunning = () => !!(data.stopwatch && data.stopwatch.running);

  // ---- todos that repeat: { repeat: { days: [0-6, Sunday first], time: 'HH:MM' } }, `due` is the next time
  const DAY = [_t('Sun'), _t('Mon'), _t('Tue'), _t('Wed'), _t('Thu'), _t('Fri'), _t('Sat')];
  N.nextRepeat = (rep, after = Date.now()) => {
    const [h, m] = (rep.time || '08:00').split(':').map(Number);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(after); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
      if ((rep.days || []).includes(d.getDay()) && d.getTime() > after) return d.getTime();
    }
    return null;
  };
  N.repeatLabel = (rep) => {
    const days = [...(rep.days || [])].sort();
    const which = days.length === 7 ? _t('Every day') : days.join() === '1,2,3,4,5' ? _t('Weekdays') : days.join() === '0,6' ? _t('Weekends')
      : days.map((d) => DAY[d]).join(', ');
    return `${which} ${rep.time}`;
  };
  // How long a task may stay late before it's ticked off by itself (0: never): its own choice (`lateMin`, the
  // clock picker's "Done if late"), else Settings → Todo's for all tasks.
  N.todoLateMin = (t) => (t.lateMin != null ? +t.lateMin : +(N.st.settings || {}).todoLateMinutes || 0);
  // Marks a task done (auto: because it stayed late too long). A repeating one hands its
  // repeat to a fresh copy for its next time, so the done one stays in Done like any other.
  N.todoDone = (list, id, auto) => {
    const t = list.find((x) => x.id === id);
    if (!t || t.done) return list;
    const now = Date.now();
    const done = { ...t, done: true, doneAt: now, ...(auto ? { autoDone: true } : {}) };
    delete done.repeat;
    if (!t.repeat) return list.map((x) => (x.id === id ? done : x));
    const next = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text: t.text, done: false, created: now,
      repeat: t.repeat, due: N.nextRepeat(t.repeat, Math.max(now, t.due || 0)), ...(t.lateMin != null ? { lateMin: t.lateMin } : {}) };
    return [next, ...list.map((x) => (x.id === id ? { ...done, repeated: true } : x))];
  };
  // ---- the AI agents on this Mac (agents.rs): which one AI Chat and Translate answer through, for their labels
  let agents = null;
  let loading = null; // (one request at a time)
  N.loadAgents = () => loading || (loading = api.svc('ai', 'agents').then((v) => { agents = Array.isArray(v) ? v : []; return agents; })
    .catch(() => { agents = []; return agents; }).finally(() => { loading = null; }));
  // No agent ready yet (the first check can run while a CLI is still starting: Claude Code's first cold start on
  // Windows takes longer than its time to answer): checked again, forced, at most every 15 s; true when that changed
  // which agent is ready
  let rechecked = 0;
  let rechecking = null;
  const agentsSig = () => JSON.stringify((agents || []).map((a) => [a.id, a.installed, a.responding, a.signedIn]));
  N.recheckAgents = () => {
    if (rechecking || loading || Date.now() - rechecked < 15000) return Promise.resolve(false);
    rechecked = Date.now();
    const was = agentsSig();
    return (rechecking = api.svc('ai', 'agents', true)
      .then((v) => { if (Array.isArray(v)) agents = v; return agentsSig() !== was; })
      .catch(() => false)
      .finally(() => { rechecking = null; }));
  };
  // the agent `key` (chatAgent / translateAgent) names, else the first ready one, as agents.rs picks it; undefined
  // while the list hasn't come yet
  N.aiAgent = (key) => {
    if (!agents) return undefined;
    const s = N.st.settings || {};
    const want = s[key] || s.chatAgent || '';
    const usable = (a) => a.installed && !a.update && a.supported !== false && a.responding !== false;
    return agents.find((a) => a.id === want && usable(a)) || agents.find((a) => usable(a) && a.signedIn) || null;
  };
  N.aiLabel = (a) => (a ? `${a.name}${((N.st.settings || {}).agentModels || {})[a.id] ? ` · ${N.st.settings.agentModels[a.id]}` : ''}` : '');
  N.loadData = async () => {
    set('weather', await api.svc('weather', 'get'));
    set('health', await api.svc('health', 'get'));
    set('todo', (await api.svc('store', 'get', 'todo')) || { items: [] });
    set('notes', (await api.svc('store', 'get', 'notes')) || { notes: [] });
    set('stopwatch', (await api.svc('store', 'get', 'stopwatch')) || { running: false, elapsed: 0, laps: [] });
    set('bookmarks', (await api.svc('store', 'get', 'bookmarks')) || { items: [], cats: [] });
    set('github', await api.svc('github', 'get'));
    set('feed', await api.svc('feed', 'get').catch(() => ({ items: [] })));
  };
})();
