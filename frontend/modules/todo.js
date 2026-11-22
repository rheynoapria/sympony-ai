// Todo: add, complete, delete (to Trash), restore. Trash is emptied after N days (Settings).
// A task can have a due time: pick one (on any day) with the clock button, or say it in the text ("besok jam 3",
// "fri 3pm", "15m"; nlp.js), shown as a chip under the field while typing. The picker's choice wins over the text.
// It can also repeat on chosen days at a time (the picker, or "tiap senin 8.00"); ticking it off brings the next one (N.todoDone).
// While closed, the notch counts down the next one and alerts when it's due (notch.js).
(function () {
  const { st, $, $$, esc, fa } = N;
  let page;
  let view = 'active';
  let pendingDue = null; // due time picked for the task being typed
  let pendingRepeat = null; // or the repeat picked for it: { days, time }
  let pendingLate = null; // and how long it may stay late (minutes, 0: never); null follows Settings → Todo
  let nlpOff = false; // the chip's ×: this task's text is kept as typed, no time read from it
  let picking = null; // what the time picker sets: 'new' or an item id
  let dayField; let timeField; let repTimeField; // its day and time fields (datetime.js: drawn inside the notch)
  // [letter, name]: the letter is the name's first one, so it follows the language (one-letter keys would clash)
  const DAYS = [_t('Sunday'), _t('Monday'), _t('Tuesday'), _t('Wednesday'), _t('Thursday'), _t('Friday'), _t('Saturday')].map((name) => [name.charAt(0), name]);
  let tick;
  let sync = null; // Todo sync's state (Settings → Todo → Sync with), for the mark after the counts
  const MIN = 60000;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const items = () => ((N.data.todo || {}).items || []);
  const save = (list) => N.saveStore('todo', { items: list });

  function purge(list) {
    const keepMs = (st.settings.todoTrashDays || 7) * 86400000;
    return list.filter((t) => !t.deletedAt || Date.now() - t.deletedAt < keepMs);
  }

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return _t('now');
    if (m < 60) return _t('{n}m', { n: m });
    if (m < 1440) return _t('{n}h', { n: Math.round(m / 60) });
    return _t('{n}d', { n: Math.round(m / 1440) });
  }

  // Next time it's h:mm (today, or tomorrow if that has passed), or that time `days` from today.
  function at(h, m, days) {
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (days) d.setDate(d.getDate() + days); else if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // "2026-10-26" for the day field (local day)
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // The picker's day + time: today (its default) works like a time alone, a time that has passed is tomorrow;
  // another day is that day at the time, or 09:00 without one. null when it won't do (no time, or in the past).
  function pickedDue(day, time) {
    if (!day || day === isoDay(new Date())) { if (!time) return null; const [h, m] = time.split(':').map(Number); return at(h, m); }
    const [y, mo, d] = day.split('-').map(Number);
    const [h, m] = (time || '09:00').split(':').map(Number);
    const due = new Date(y, mo - 1, d, h, m).getTime();
    return due > Date.now() ? due : null;
  }

  // What the typed text says about time (nlp.js), unless the picker has a choice (it wins) or × was clicked
  const typedWhen = (raw) => (!raw || nlpOff || pendingDue || pendingRepeat ? null : N.nlp.parse(raw));
  function paintNlp() {
    const box = $('.todo-nlp', page);
    const r = typedWhen($('#todoInput', page).value.trim());
    box.hidden = !r;
    if (!r) return;
    const when = N.nlp.label(r, Date.now(), N.hm);
    $('.nlp-ico', box).innerHTML = fa(r.repeat ? 'repeat' : 'clock', r.repeat ? 'solid' : 'regular');
    $('.nlp-when', box).textContent = when;
    $('.nlp-chip', box).title = r.repeat ? _t('Adds “{text}”, repeating {when}', { text: r.text, when }) : _t('Adds “{text}”, due {when}', { text: r.text, when });
  }

  // "in 4m", "Now", "5m late", "14:30", "Tomorrow 09:00", "Fri 10:00", "5 Nov 09:00" (a week or more away)
  function dueLabel(due) {
    const left = due - Date.now();
    if (left < 0) { const m = Math.round(-left / MIN); return m < 1 ? _t('Now') : m < 60 ? _t('{n}m late', { n: m }) : m < 1440 ? _t('{n}h late', { n: Math.round(m / 60) }) : _t('Overdue'); }
    if (left < 60 * MIN) return _t('in {n}m', { n: Math.max(1, Math.ceil(left / MIN)) });
    const d = new Date(due);
    const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return N.hm(due);
    if (days === 1) return _t('Tomorrow {time}', { time: N.hm(due) });
    if (days <= 6) return d.toLocaleDateString(_tLocale(), { weekday: 'short' }) + ' ' + N.hm(due);
    return d.toLocaleDateString(_tLocale('en-GB'), { day: 'numeric', month: 'short', ...(days > 300 ? { year: 'numeric' } : {}) }) + ' ' + N.hm(due);
  }
  const dueClass = (due) => (due - Date.now() < 0 ? 'late' : due - Date.now() <= 15 * MIN ? 'soon' : '');
  // "Done if late" choices: minutes after its time (0: keep it until ticked off)
  const LATE = [[0, _t('Never')], [1, _t('{n}m', { n: 1 })], [3, _t('{n}m', { n: 3 })], [5, _t('{n}m', { n: 5 })], [10, _t('{n}m', { n: 10 })],
    [30, _t('{n}m', { n: 30 })], [60, _t('{n}h', { n: 1 })]];
  const lateText = (m) => (!m ? _t('kept until you tick it off') : m < 60 ? _t('ticked off {n} min after its time if still open', { n: m })
    : _t('ticked off {n} h after its time if still open', { n: m / 60 }));

  // its own "Done if late" (null: follow Settings → Todo again). Leaves the picker open.
  function setLate(min) {
    if (picking === 'new') { pendingLate = min; paintDueBtn(); } else if (picking) {
      save(items().map((t) => {
        if (t.id !== picking) return t;
        const n = { ...t };
        if (min == null) delete n.lateMin; else n.lateMin = min;
        return n;
      }));
    }
    paintLate();
  }
  function paintLate() {
    const p = $('.due-pick', page);
    const t = picking && picking !== 'new' && items().find((x) => x.id === picking);
    const own = picking === 'new' ? pendingLate : t && t.lateMin != null ? t.lateMin : null;
    const all = +st.settings.todoLateMinutes || 0;
    const def = $('.late-opts [data-late=""]', p);
    def.textContent = _t('Default ({value})', { value: (LATE.find(([m]) => m === all) || [0, _t('{n}m', { n: all })])[1] });
    def.title = _t('Follow Settings → Todo: {what}', { what: lateText(all) });
    $$('.late-opts button', p).forEach((b) => b.classList.toggle('on', b.dataset.late === (own == null ? '' : String(own))));
  }

  function setDue(due) {
    if (picking === 'new') {
      pendingDue = due;
      pendingRepeat = null;
      paintDueBtn();
      N.focusField($('#todoInput', page));
    } else if (picking) {
      save(items().map((t) => {
        if (t.id !== picking) return t;
        const n = { ...t, due: due || undefined, alerted: undefined };
        delete n.repeat; // a one-off time replaces the repeat
        return n;
      }));
    }
    closePicker();
  }

  // repeat on these days at this time (null: no repeat; the task keeps its next time as a one-off)
  function setRepeat(rep) {
    if (picking === 'new') {
      pendingRepeat = rep;
      pendingDue = null;
      paintDueBtn();
      N.focusField($('#todoInput', page));
    } else if (picking) {
      save(items().map((t) => {
        if (t.id !== picking) return t;
        const n = { ...t, alerted: undefined };
        if (rep) { n.repeat = rep; n.due = N.nextRepeat(rep); } else delete n.repeat;
        return n;
      }));
    }
    closePicker();
  }

  function paintDueBtn() {
    const b = $('#todoDueBtn', page);
    b.classList.toggle('set', !!(pendingDue || pendingRepeat || pendingLate != null));
    b.innerHTML = (pendingRepeat ? `${fa('repeat')}<span>${esc(N.repeatLabel(pendingRepeat))}</span>`
      : `${fa('clock', 'regular')}${pendingDue ? `<span>${esc(dueLabel(pendingDue))}</span>` : ''}`)
      + (pendingLate != null ? `<i class="own-late">${fa('flag-checkered')}</i>` : '');
    b.title = (pendingRepeat ? _t('Repeats {when}', { when: N.repeatLabel(pendingRepeat) }) : pendingDue ? _t('Due {when}', { when: new Date(pendingDue).toLocaleString() }) : _t('Add a time or a repeat'))
      + (pendingLate != null ? ` · ${lateText(pendingLate)}` : '');
    paintNlp(); // the chip steps aside while the picker has a choice
  }

  function openPicker(target) {
    picking = target;
    const p = $('.due-pick', page);
    const t = target !== 'new' && items().find((x) => x.id === target);
    $('.due-clear', p).style.display = (target === 'new' ? pendingDue : t && t.due && !t.repeat) ? '' : 'none';
    // the day starts at today (no days that have passed)
    const today = isoDay(new Date());
    dayField.set(today, today);
    // the repeat row starts from the task's repeat, else every weekday at the next round hour
    const rep = (target === 'new' ? pendingRepeat : t && t.repeat) || null;
    const days = rep ? rep.days : [1, 2, 3, 4, 5];
    $$('.rep-days button', p).forEach((b) => b.classList.toggle('on', days.includes(+b.dataset.day)));
    repTimeField.set(rep ? rep.time : `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`);
    $('.rep-off', p).style.display = rep ? '' : 'none';
    paintLate();
    p.hidden = false;
  }
  function closePicker() { picking = null; $('.due-pick', page).hidden = true; }

  // Todo sync on: a small mark after the counts, its tooltip says when it last synced (or what went wrong)
  function syncMark(after) {
    const s = sync;
    if (!s || !s.signedIn || !s.list || !s.name) return '';
    const tip = s.error ? `${s.name}: ${s.error}` : s.syncing ? _t('Syncing with {name}…', { name: s.name })
      : s.last ? _t('Synced with {name} ({list}) at {time}', { name: s.name, list: s.list.name, time: N.hm(s.last) }) : _t('Syncing with {name} ({list})', { name: s.name, list: s.list.name });
    return `${after ? ' · ' : ''}<span title="${esc(tip)}"${s.error ? ' style="color:var(--orange)"' : ''}>${fa(s.error ? 'triangle-exclamation' : 'arrows-rotate')}</span>`;
  }

  function dueColor(t) {
    if (!t || !t.due) return '#4a4a52';
    const cls = dueClass(t.due);
    if (cls === 'late') return '#f87171';
    if (cls === 'soon') return '#fb923c';
    return '#8fa2ff';
  }

  function render() {
    if (!page) return;
    const all = items();
    const list = all.filter((t) => (view === 'trash' ? t.deletedAt : !t.deletedAt && (view === 'done' ? t.done : !t.done)))
      .sort((a, b) => (view === 'done' ? (b.doneAt || 0) - (a.doneAt || 0)
        : view === 'active' ? ((a.due || Infinity) - (b.due || Infinity)) || (b.created || 0) - (a.created || 0)
          : (b.created || 0) - (a.created || 0)));
    const counts = { active: all.filter((t) => !t.deletedAt && !t.done).length, done: all.filter((t) => !t.deletedAt && t.done).length, trash: all.filter((t) => t.deletedAt).length };
    $('.todo-list', page).innerHTML = list.length ? list.map((t) => {
      const col = t.done ? '#4ade80' : dueColor(t);
      return `<div class="trow todo-item${t.done ? ' done' : ''}" data-id="${esc(t.id)}">`
        + (view === 'trash'
          ? `<span class="mute">${fa('trash-can', 'regular')}</span>`
          : `<button type="button" class="chk" style="border-color:${col};${t.done ? 'background:#4ade80;color:#000' : ''}">${t.done ? '✓' : ''}</button>`)
        + `<span class="t1" style="flex:1;font-size:13px;font-weight:500" title="${esc(t.text)}">${esc(t.text)}</span>`
        + (t.due && view === 'active'
          ? `<button type="button" class="pill n due" style="background:${col}22;color:${col};cursor:pointer">${t.repeat ? '↻ ' : ''}${esc(dueLabel(t.due))}</button>`
          : '')
        + `<span class="acts row" style="gap:4px;flex:none">${view === 'trash'
          ? `<button type="button" class="restore" title="${esc(_t('Restore'))}" style="color:var(--dim);cursor:pointer">${fa('rotate-left')}</button><button type="button" class="del purge" title="${esc(_t('Delete forever'))}" style="color:var(--dim);cursor:pointer">${fa('xmark')}</button>`
          : `${view === 'active' ? `<button type="button" class="set-due" title="${esc(_t('Set a time'))}" style="color:var(--mute);cursor:pointer">${fa('clock', 'regular')}</button>` : ''}<button type="button" class="del" title="${esc(_t('Move to Trash'))}" style="color:var(--mute);cursor:pointer">${fa('trash-can', 'regular')}</button>`}</span>`
        + `</div>`;
    }).join('')
      : `<div class="sub" style="margin:auto;text-align:center;padding:16px">${view === 'active' ? _t('Nothing to do. Add a task above.') : view === 'done' ? _t('No completed tasks yet') : _t('Trash is empty')}</div>`;
    $$('.seg2 button', page).forEach((b) => {
      b.classList.toggle('on', b.dataset.v === view);
      b.textContent = `${b.dataset.label}${counts[b.dataset.v] ? ' ' + counts[b.dataset.v] : ''}`;
    });
    const left = view === 'done' && counts.done ? '' : _t('{open} open · {done} done', { open: counts.active, done: counts.done });
    const footLeft = $('.todo-foot .left', page);
    if (footLeft) footLeft.innerHTML = esc(left) + syncMark(left);
    const clr = $('.todo-foot .clear', page);
    if (clr) {
      clr.style.display = (view === 'done' && counts.done) || (view === 'trash' && counts.trash) ? '' : 'none';
      clr.textContent = view === 'trash' ? _t('Empty Trash') : _t('Clear completed');
    }
    $$('.todo-item', page).forEach((el) => {
      const id = el.dataset.id;
      const upd = (fn) => save(items().map((t) => (t.id === id ? fn({ ...t }) : t)));
      const toggle = () => {
        const t = items().find((x) => x.id === id);
        if (t && !t.done) save(N.todoDone(items(), id)); else upd((x) => { x.done = false; x.doneAt = null; delete x.autoDone; return x; });
      };
      const chk = $('.chk', el); if (chk) chk.onclick = (e) => { e.stopPropagation(); toggle(); };
      el.onclick = (e) => { if (view !== 'trash' && !e.target.closest('button')) toggle(); };
      const del = $('.del:not(.purge)', el); if (del) del.onclick = (e) => { e.stopPropagation(); upd((t) => { t.deletedAt = Date.now(); return t; }); };
      const res = $('.restore', el); if (res) res.onclick = (e) => { e.stopPropagation(); upd((t) => { t.deletedAt = null; return t; }); };
      const pur = $('.purge', el); if (pur) pur.onclick = (e) => { e.stopPropagation(); save(items().filter((t) => t.id !== id)); };
      $$('.due, .set-due', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openPicker(id); }; });
    });
    if (pendingDue) paintDueBtn();
  }

  // ------------------------------------------------------------ 2×1 Todo card (matches modules.html)
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('todo', () => refreshCards());
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#60a5fa');
    el.style.flexDirection = 'row';
    el.style.gap = '14px';
    el.style.alignItems = 'center';
    const all = items().filter((t) => !t.deletedAt);
    const active = all.filter((t) => !t.done);
    const doneCount = all.length - active.length;
    const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;

    const sorted = [...active].sort((a, b) => {
      if (a.due && b.due) return a.due - b.due;
      if (a.due) return -1;
      if (b.due) return 1;
      return (b.created || 0) - (a.created || 0);
    });
    const top = sorted.slice(0, 2);
    const rowsHtml = top.length
      ? top.map((t) => {
        const col = dueColor(t);
        const duePill = t.due ? `<span class="pill n" style="background:${col}22;color:${col}">${esc(dueLabel(t.due))}</span>` : '';
        return `<div class="row" style="gap:8px"><button type="button" class="chk" data-tid="${esc(t.id)}" style="border-color:${col}" title="${esc(_t('Mark done'))}"></button><span class="t1" style="flex:1;font-size:12.5px;font-weight:500">${esc(t.text)}</span>${duePill}</div>`;
      }).join('')
      : `<div class="sub">${esc(_t('All done'))}</div>`;

    const rightLbl = active.length ? _t('{n} active', { n: active.length }) : _t('Done');
    el.innerHTML = `${N.ring(pct, '#60a5fa', 66, 10, `<div><span class="n" style="font-size:17px">${doneCount}</span><span class="n dim" style="font-size:12px">/${all.length}</span></div>`)}`
      + `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px">${N.hd('todo', _t('Todo'), rightLbl)}${rowsHtml}</div>`;

    $$('[data-tid]', el).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        save(N.todoDone(items(), b.dataset.tid));
      };
    });
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'todo',
    tall: true,
    init(p) {
      page = p;
      page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%;position:relative">`
        + `<div class="row" style="gap:8px;flex:none">`
        + `<div class="sinp" style="flex:1"><input id="todoInput" type="text" placeholder="${esc(_t('Add a task… “besok jam 3”, “every Mon 9”'))}" maxlength="300">`
        + `<button type="button" class="due-btn" id="todoDueBtn" style="flex:none;color:var(--dim);cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:11px"></button>`
        + `<span style="font-size:10.5px;font-weight:700;color:var(--mute)">⏎</span></div>`
        + `<div class="seg2"><button type="button" data-v="active" data-label="${esc(_t('Active'))}"></button><button type="button" data-v="done" data-label="${esc(_t('Done'))}"></button><button type="button" data-v="trash" data-label="${esc(_t('Trash'))}"></button></div>`
        + `</div>`
        + `<div class="todo-nlp" hidden style="flex:none"><span class="nlp-chip"><span class="nlp-ico"></span><span class="nlp-when"></span><button type="button" class="nlp-x" title="${esc(_t('Not a time: keep the text as typed'))}">${fa('xmark')}</button></span></div>`
        + `<div class="due-pick" hidden>`
        + `<span class="muted small">${_t('Remind me')}</span>`
        + `<button data-in="5">${_t('{n}m', { n: 5 })}</button><button data-in="15">${_t('{n}m', { n: 15 })}</button><button data-in="30">${_t('{n}m', { n: 30 })}</button><button data-in="60">${_t('{n}h', { n: 1 })}</button><button data-in="120">${_t('{n}h', { n: 2 })}</button>`
        + `<button data-at="20:00">${_t('Tonight {time}', { time: '20:00' })}</button><button data-at="09:00" data-days="1">${_t('Tomorrow {time}', { time: '09:00' })}</button>`
        + `<input class="field due-date" placeholder="${_t('Day')}"><input class="field due-time" placeholder="${_t('Time')}"><button class="due-ok">${_t('Set')}</button><button class="due-clear">${_t('No time')}</button>`
        + `<div class="rep-row"><span class="muted small">${_t('Repeat')}</span><span class="rep-days">${DAYS.map(([d, name], i) => `<button data-day="${i}" title="${name}">${d}</button>`).join('')}</span>`
        + `<input class="field rep-time" placeholder="${_t('Time')}"><button class="rep-ok">${fa('repeat')} ${_t('Repeat')}</button><button class="rep-off">${_t('No repeat')}</button></div>`
        + `<div class="late-row"><span class="muted small">${_t('Done if late')}</span><span class="late-opts"><button data-late=""></button>${LATE.map(([m, l]) => `<button data-late="${m}" title="${lateText(m)}">${l}</button>`).join('')}</span></div>`
        + `</div>`
        + `<div class="c grow sc-y" style="padding:8px 10px"><div class="todo-list" style="display:flex;flex-direction:column;gap:2px"></div></div>`
        + `<div class="todo-foot row" style="justify-content:space-between;font-size:10.5px;color:var(--mute);flex:none;display:none"><span class="left"></span><button type="button" class="sbtn clear" style="height:22px;padding:0 8px;font-size:10.5px"></button></div>`
        + `</div>`;
      paintDueBtn();
      const input = $('#todoInput', page);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const raw = e.target.value.trim();
        if (!raw) return;
        // the picker's choice, else what the text says (cut out of it), else no time
        const p = typedWhen(raw);
        const repeat = pendingRepeat || (p && p.repeat) || null;
        const text = p ? p.text : raw;
        const due = repeat ? N.nextRepeat(repeat) : pendingDue || (p && p.due) || null;
        save([{ id: uid(), text, done: false, created: Date.now(), ...(due ? { due } : {}), ...(repeat ? { repeat } : {}),
          ...(pendingLate != null ? { lateMin: pendingLate } : {}) }, ...items()]);
        e.target.value = '';
        pendingDue = null;
        pendingRepeat = null;
        pendingLate = null;
        nlpOff = false;
        paintDueBtn();
        view = 'active';
      });
      input.addEventListener('input', () => { if (!input.value.trim()) nlpOff = false; paintNlp(); });
      $('.nlp-x', page).onclick = () => { nlpOff = true; paintNlp(); N.focusField(input); };
      $('#todoDueBtn', page).onclick = () => { if (picking === 'new') closePicker(); else openPicker('new'); };
      const pick = $('.due-pick', page);
      // Sympony's own day and time pickers, inside the notch (a native one pops up in its own window, which ended
      // up behind the notch)
      dayField = N.dateField($('.due-date', pick), { accent: 'var(--orange)' });
      timeField = N.timeField($('.due-time', pick), { accent: 'var(--orange)' });
      repTimeField = N.timeField($('.rep-time', pick), { accent: 'var(--orange)' });
      $$('[data-in]', pick).forEach((b) => { b.onclick = () => setDue(Date.now() + +b.dataset.in * MIN); });
      $$('[data-at]', pick).forEach((b) => { b.onclick = () => { const [h, m] = b.dataset.at.split(':').map(Number); setDue(at(h, m, +(b.dataset.days || 0))); }; });
      $('.due-ok', pick).onclick = () => {
        const day = dayField.value; const time = timeField.value;
        const due = pickedDue(day, time);
        if (due) { setDue(due); return; }
        // nothing to set: the field to fix blinks (a time for today, else a day that has passed)
        const el = !day || day === isoDay(new Date()) ? timeField.input : dayField.input;
        el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad');
      };
      $$('.due-date, .due-time, .rep-time', pick).forEach((el) => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $(el.classList.contains('rep-time') ? '.rep-ok' : '.due-ok', pick).click(); });
        el.addEventListener('animationend', () => el.classList.remove('bad'));
      });
      $('.due-clear', pick).onclick = () => setDue(null);
      $$('.rep-days button', pick).forEach((b) => { b.onclick = () => b.classList.toggle('on'); });
      $('.rep-ok', pick).onclick = () => {
        const days = $$('.rep-days button.on', pick).map((b) => +b.dataset.day);
        const time = repTimeField.value;
        if (days.length && time) setRepeat({ days, time });
        else if (!time) { const el = repTimeField.input; el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); }
      };
      $('.rep-off', pick).onclick = () => setRepeat(null);
      $$('.late-opts button', pick).forEach((b) => { b.onclick = () => setLate(b.dataset.late === '' ? null : +b.dataset.late); });
      page.addEventListener('mousedown', (e) => { if (!pick.hidden && !e.target.closest('.due-pick, .due-btn, .due, .set-due')) closePicker(); });
      $$('.seg2 button', page).forEach((b) => { b.onclick = () => { view = b.dataset.v; render(); }; });
      $('.todo-foot .clear', page).onclick = () => {
        if (view === 'trash') save(items().filter((t) => !t.deletedAt));
        else save(items().map((t) => (t.done && !t.deletedAt ? { ...t, deletedAt: Date.now() } : t)));
      };
      N.watch('todo', (d) => {
        const purged = purge(d.items || []);
        if (purged.length !== (d.items || []).length) save(purged); else render();
      });
      N.api.svc('todosync', 'state').then((v) => { sync = v; render(); }).catch(() => {});
      N.api.on('todosync', (v) => { sync = v; render(); });
    },
    show() { render(); clearInterval(tick); tick = setInterval(render, 15000); },
    hide() { clearInterval(tick); if (page) closePicker(); },
    // ← / → don't switch tabs while the time picker is open (notch.js)
    usesArrows() { return picking != null; },
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('todo'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
