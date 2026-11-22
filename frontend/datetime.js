// Date and time fields drawn inside the notch. A native <input type="date"> or "time" opens WebView2's own
// popup window, which hangs below the notch window: once the mouse goes down onto it, Sympony is raised over it again
// and the calendar's top rows disappear behind the notch. These are plain text fields (type "30/10", "besok",
// "fri", "14.30", "2pm"; ↑ / ↓ step a day or 5 minutes, with Shift a week or an hour) with a small calendar, or
// columns of hours and minutes, that open inside the notch: under the field, above it, or beside it.
// N.dateField(input, { value: 'YYYY-MM-DD', min: 'YYYY-MM-DD', accent }) and N.timeField(input, { value: 'HH:MM', accent })
// return { value, set(value, min) }; `value` is '' while the field is empty or doesn't read as a date / time.
(function () {
  const { $, $$, esc, fa } = N;
  let open = null; // { pop, ctl, watch, month: [y, m] }

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayOf = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const h24 = () => !N.st.settings || N.st.settings.clock24h !== false;

  // ------------------------------------------------------------------ reading what was typed
  const MONTHS = [['jan'], ['feb', 'peb'], ['mar'], ['apr'], ['may', 'mei'], ['jun'], ['jul'], ['aug', 'agu', 'agt'], ['sep'], ['oct', 'okt'], ['nov', 'nop'], ['dec', 'des']];
  const WEEKDAYS = [['sun', 'min', 'ahad'], ['mon', 'sen'], ['tue', 'sel'], ['wed', 'rab'], ['thu', 'kam'], ['fri', 'jum'], ['sat', 'sab']];
  const month = (w) => MONTHS.findIndex((alts) => alts.some((a) => w.startsWith(a)));
  const weekday = (w) => (w.length < 3 ? -1 : WEEKDAYS.findIndex((alts) => alts.some((a) => w.startsWith(a))));
  // does this PC write the month before the day (10/30)?
  const monthFirst = (() => {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2000, 10, 22));
      return parts.findIndex((p) => p.type === 'month') < parts.findIndex((p) => p.type === 'day');
    } catch (e) { return false; }
  })();

  // a real day (no 31 Feb); without a year, the next time that day comes
  function makeDay(y, m, d) {
    const noYear = y == null;
    if (noYear) y = new Date().getFullYear(); else if (y < 100) y += 2000;
    let dt = new Date(y, m, d);
    if (dt.getMonth() !== m || dt.getDate() !== d) return null;
    if (noYear && dt < today()) { dt = new Date(y + 1, m, d); if (dt.getMonth() !== m) return null; }
    return iso(dt);
  }

  function parseDate(text) {
    let s = String(text || '').trim().toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
    if (!s) return null;
    const t = today();
    // the field shows these two in Sympony's language (showDate), so they must read back
    if (s === _t('Today').toLowerCase()) return iso(t);
    if (s === _t('Tomorrow').toLowerCase()) return iso(addDays(t, 1));
    if (/^(today|tdy|hari ini|hr ini|now|sekarang)$/.test(s)) return iso(t);
    if (/^(tomorrow|tmr|tmrw|besok|bsk)$/.test(s)) return iso(addDays(t, 1));
    if (/^lusa$/.test(s)) return iso(addDays(t, 2));
    // "fri", "jumat": the next one (today when it's that day)
    if (/^[a-z']+$/.test(s) && weekday(s) >= 0) return iso(addDays(t, (weekday(s) - t.getDay() + 7) % 7));
    // "Thu 30 Oct" (how the field shows it): the weekday in front changes nothing
    s = s.replace(/^[a-z']+\.? (?=\d)/, (w) => (weekday(w.trim().replace('.', '')) >= 0 ? '' : w));
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return makeDay(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})(?:[/.\- ](\d{2}|\d{4}))?$/);
    if (m) {
      // the way this PC writes dates first; "30/10" is a day either way
      const [a, b, y] = [+m[1], +m[2], m[3] ? +m[3] : null];
      const [mo, d] = monthFirst ? [a, b] : [b, a];
      return makeDay(y, mo - 1, d) || makeDay(y, d - 1, mo);
    }
    m = s.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/);
    if (m && month(m[2]) >= 0) return makeDay(m[3] ? +m[3] : null, month(m[2]), +m[1]);
    m = s.match(/^([a-z]+)\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/);
    if (m && month(m[1]) >= 0) return makeDay(m[3] ? +m[3] : null, month(m[1]), +m[2]);
    // just a day of the month: this month's, or next month's when it has passed
    m = s.match(/^(\d{1,2})$/);
    if (m) {
      const d = +m[1];
      for (let k = 0; k < 3; k++) {
        const dt = new Date(t.getFullYear(), t.getMonth() + k, d);
        if (dt.getDate() === d && dt >= t) return iso(dt);
      }
    }
    return null;
  }

  function parseTime(text) {
    const s = String(text || '').trim().toLowerCase().replace(/^(at|jam|pukul|pkl\.?) /, '').replace(/\s+/g, ' ');
    if (!s) return null;
    if (/^(noon|tengah hari)$/.test(s)) return '12:00';
    if (/^midnight$/.test(s)) return '00:00';
    const m = s.match(/^(\d{1,2})(?:[:.h ]?(\d{2}))? ?(am|pm|a\.m\.|p\.m\.|a|p)?$/);
    if (!m) return null;
    let h = +m[1]; const min = m[2] ? +m[2] : 0;
    if (min > 59) return null;
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      const pm = m[3].startsWith('p');
      h = (h % 12) + (pm ? 12 : 0);
    } else if (h > 23) return null;
    return `${pad2(h)}:${pad2(min)}`;
  }

  // ------------------------------------------------------------------ showing it
  function showDate(v) {
    const d = dayOf(v); const t = today();
    if (+d === +t) return _t('Today');
    if (+d === +addDays(t, 1)) return _t('Tomorrow');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
  }
  // "14:30", or "2:30 PM" with Sympony's 24-hour setting off
  const showTime = (v) => { const [h, m] = v.split(':').map(Number); return h24() ? v : `${h % 12 || 12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`; };

  // ------------------------------------------------------------------ the pop-up
  function close() {
    if (!open) return;
    open.watch.disconnect();
    open.pop.remove();
    open.ctl.input.classList.remove('open');
    open = null;
  }

  // Inside the notch (outside it, the mouse would count as leaving Sympony): under the field, else above it, else
  // beside it as high as it fits
  function place(pop, input) {
    const host = $('#notch'); const h = host.getBoundingClientRect(); const b = input.getBoundingClientRect();
    const pad = 8; const gap = 4; const W = pop.offsetWidth; const H = pop.offsetHeight;
    let top; let left = b.left - h.left;
    if (H <= h.bottom - b.bottom - pad - gap) top = b.bottom - h.top + gap;
    else if (H <= b.top - h.top - pad - gap) top = b.top - h.top - gap - H;
    else {
      top = Math.max(pad, Math.min(b.top - h.top + (b.height - H) / 2, h.height - pad - H));
      left = h.right - b.right - pad - gap >= W ? b.right - h.left + gap : b.left - h.left - gap - W;
    }
    pop.style.top = top + 'px';
    pop.style.left = Math.max(pad, Math.min(left, h.width - W - pad)) + 'px';
  }

  function draw() {
    if (!open) return;
    const { ctl, pop } = open;
    const typed = ctl.kind === 'date' ? parseDate(ctl.input.value) : parseTime(ctl.input.value);
    if (ctl.kind === 'date') {
      const [y, mo] = open.month;
      const first = new Date(y, mo, 1);
      const lead = (first.getDay() + 6) % 7; // weeks start on Monday, like the Calendar tab
      const t = iso(today());
      let html = `<div class="dtp-head"><button data-nav="-1" title="${_t('Previous month')}">${fa('chevron-left')}</button>`
        + `<b>${esc(first.toLocaleDateString(undefined, { month: 'long' }))} <em>${y}</em></b>`
        + `<button data-nav="1" title="${_t('Next month')}">${fa('chevron-right')}</button></div><div class="dtp-grid">`;
      for (let i = 0; i < 7; i++) html += `<span class="dtp-wd">${esc(new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }))}</span>`;
      for (let i = 0; i < 42; i++) {
        const d = new Date(y, mo, 1 - lead + i); const v = iso(d);
        const cls = [d.getMonth() !== mo && 'out', v === t && 'today', v === typed && 'sel'].filter(Boolean).join(' ');
        html += `<button class="dtp-d ${cls}" data-d="${v}" ${ctl.min && v < ctl.min ? 'disabled' : ''}>${d.getDate()}</button>`;
      }
      pop.innerHTML = html + '</div>';
    } else {
      const [th, tm] = typed ? typed.split(':').map(Number) : [-1, -1];
      const ampm = !h24();
      const hours = ampm ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [...Array(24).keys()];
      const hourOn = (h) => (ampm ? th >= 0 && (th % 12 || 12) === h : th === h);
      const col = (name, items) => `<div class="dtp-col" data-col="${name}">${items.join('')}</div>`;
      pop.innerHTML = '<div class="dtp-cols">'
        + col('h', hours.map((h) => `<button data-h="${h}" class="${hourOn(h) ? 'sel' : ''}">${ampm ? h : pad2(h)}</button>`))
        + col('m', [...Array(12).keys()].map((i) => i * 5).map((m) => `<button data-m="${m}" class="${tm === m ? 'sel' : ''}">${pad2(m)}</button>`))
        + (ampm ? col('ap', ['AM', 'PM'].map((a, i) => `<button data-ap="${i}" class="${th >= 0 && (th >= 12) === !!i ? 'sel' : ''}">${a}</button>`)) : '')
        + '</div>';
      // the chosen hour and minute in view (with none yet, the hour it is now)
      $$('.dtp-col', pop).forEach((c) => {
        const now = new Date().getHours();
        const on = $('.sel', c) || (c.dataset.col === 'h' && $(`[data-h="${ampm ? now % 12 || 12 : now}"]`, c));
        if (on) c.scrollTop = on.offsetTop - (c.clientHeight - on.offsetHeight) / 2;
      });
    }
  }

  function show(ctl) {
    if (open && open.ctl === ctl) return;
    close();
    const host = $('#notch');
    const pop = document.createElement('div');
    pop.className = `dtp dtp-${ctl.kind}`;
    if (ctl.accent) pop.style.setProperty('--dtp-accent', ctl.accent);
    host.appendChild(pop);
    const typed = ctl.kind === 'date' && (parseDate(ctl.input.value) || ctl.min);
    const start = typed ? dayOf(typed) : today();
    // Sympony closing, the field going away or hiding (the todo's picker closed) takes the pop-up with it
    const watch = new MutationObserver(() => { if (open && (!N.st.open || !ctl.input.isConnected || !ctl.input.offsetParent)) close(); });
    watch.observe(host, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: true });
    open = { pop, ctl, watch, month: [start.getFullYear(), start.getMonth()] };
    draw();
    place(pop, ctl.input);
    ctl.input.classList.add('open');
    // a click in here keeps the keyboard in the field
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.nav) { const [y, m] = open.month; const d = new Date(y, m + +b.dataset.nav, 1); open.month = [d.getFullYear(), d.getMonth()]; draw(); return; }
      if (b.dataset.d) { ctl.set(b.dataset.d); close(); return; }
      // a time: the hour keeps the minutes (and AM / PM), the minutes finish it
      const cur = parseTime(ctl.input.value);
      let [h, m] = cur ? cur.split(':').map(Number) : [9, 0];
      if (b.dataset.h) {
        const n = +b.dataset.h;
        // with AM / PM and no time yet: 7 to 11 in the morning, 12 to 6 in the afternoon
        h = h24() ? n : (n % 12) + ((cur ? h >= 12 : n === 12 || n < 7) ? 12 : 0);
      }
      if (b.dataset.m) m = +b.dataset.m;
      if (b.dataset.ap) h = (h % 12) + (+b.dataset.ap ? 12 : 0);
      ctl.set(`${pad2(h)}:${pad2(m)}`);
      if (b.dataset.m) close(); else draw();
    });
  }

  document.addEventListener('mousedown', (e) => { if (open && !open.pop.contains(e.target) && e.target !== open.ctl.input) close(); }, true);
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }, true);

  // ------------------------------------------------------------------ the field
  function field(input, kind, cfg) {
    const parse = kind === 'date' ? parseDate : parseTime;
    const fmt = kind === 'date' ? showDate : showTime;
    const ctl = {
      kind, input, min: cfg.min || '', cur: '', accent: cfg.accent,
      // what the field says now (typed, not yet left), else ''
      get value() { return parse(input.value) || ''; },
      set(v, min) {
        if (min !== undefined) ctl.min = min || '';
        ctl.cur = v || '';
        input.value = ctl.cur ? fmt(ctl.cur) : '';
        if (open && open.ctl === ctl) {
          if (kind === 'date' && ctl.cur) { const d = dayOf(ctl.cur); open.month = [d.getFullYear(), d.getMonth()]; }
          draw();
        }
      },
    };
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('mousedown', () => show(ctl));
    input.addEventListener('focus', () => { show(ctl); setTimeout(() => input.select(), 0); });
    // the calendar follows what's typed
    input.addEventListener('input', () => {
      if (!open || open.ctl !== ctl) return;
      const v = parse(input.value);
      if (kind === 'date' && v) { const d = dayOf(v); open.month = [d.getFullYear(), d.getMonth()]; }
      draw();
    });
    // leaving the field: what was typed, written the usual way; something that isn't a date / time goes back
    input.addEventListener('blur', () => {
      const v = parse(input.value);
      if (v) { ctl.set(v); return; }
      if (input.value.trim() && ctl.cur) { input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); }
      ctl.set(ctl.cur);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        const v = parse(input.value) || ctl.cur;
        if (kind === 'date') {
          const next = iso(addDays(v ? dayOf(v) : today(), v ? dir * (e.shiftKey ? 7 : 1) : 0));
          ctl.set(!ctl.min || next >= ctl.min ? next : ctl.min);
        } else {
          // to the next round step that way, then step by step; with no time yet, the next whole hour
          const step = e.shiftKey ? 60 : 5;
          let t;
          if (!v) t = (new Date().getHours() + 1) * 60;
          else {
            const [h, m] = v.split(':').map(Number); const cur = h * 60 + m;
            t = cur % step ? (dir > 0 ? Math.ceil(cur / step) : Math.floor(cur / step)) * step : cur + dir * step;
          }
          t = (t + 1440) % 1440;
          ctl.set(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
        }
        input.select();
      } else if (e.key === 'Enter') {
        const v = parse(input.value);
        if (v) ctl.set(v);
        close();
      } else if (e.key === 'Tab') close();
    });
    ctl.set(cfg.value || '');
    return ctl;
  }

  N.dateField = (input, cfg = {}) => field(input, 'date', cfg);
  N.timeField = (input, cfg = {}) => field(input, 'time', cfg);
  N.closeDateTime = close;
  // for the review harness / quick checks
  N.dateTimeParse = { date: parseDate, time: parseTime };
})();
