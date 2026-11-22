// Sympony's own calendar events (settings.localEvents: { id, title, start, end, location, repeat }; calendar.rs turns
// them into the calendar's events, repeats included). Added in Settings → Calendar → Local events and in the
// Calendar tab's form, changed and removed there too: both check and save them here, so both save the same thing.
window.LocalEvents = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  // [value, label] for a repeat picker
  const repeats = () => [['none', _t('Once')], ['daily', _t('Daily')], ['weekly', _t('Weekly')], ['monthly', _t('Monthly')], ['yearly', _t('Yearly')]];

  // a saved event as a form shows it: its day 'YYYY-MM-DD', time 'HH:MM' and length in minutes
  function fields(e) {
    const d = new Date(e.start);
    return {
      title: e.title || '', day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      minutes: Math.max(5, Math.round(((e.end || e.start + 3600000) - e.start) / 60000)), location: e.location || '', repeat: e.repeat || 'none',
    };
  }

  // What a form says ({ title, day, time, minutes, location, repeat }) → { event } to save (`prev`: the event it
  // changes, which keeps its id), or { bad } with the field to fix: 'title' (empty), 'day' or 'time' (not one).
  // At least 5 minutes long, 30 without a length.
  function make(f, prev) {
    const title = String(f.title || '').trim();
    if (!title) return { bad: 'title' };
    const day = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(f.day || '').trim());
    if (!day) return { bad: 'day' };
    const time = /^(\d{1,2}):(\d{2})$/.exec(String(f.time || '').trim());
    if (!time || +time[1] > 23 || +time[2] > 59) return { bad: 'time' };
    const start = new Date(+day[1], +day[2] - 1, +day[3], +time[1], +time[2]).getTime();
    if (!Number.isFinite(start)) return { bad: 'day' };
    const mins = Math.max(5, Math.round(Number(f.minutes)) || 30);
    const event = { ...(prev || {}), id: prev ? prev.id : 'l' + Date.now().toString(36), title, start, end: start + mins * 60000,
      location: String(f.location || '').trim(), repeat: repeats().some(([v]) => v === f.repeat) ? f.repeat : 'none' };
    delete event.allDay; // the form gives it a time
    return { event };
  }

  // Checks the form and saves it (`list`: settings.localEvents now): a new event at the end, or `prev` changed in
  // its place. Returns what make() does.
  function save(list, f, prev) {
    const r = make(f, prev);
    if (!r.event) return r;
    const l = list || [];
    window.notch.setSettings({ localEvents: l.some((e) => e.id === r.event.id) ? l.map((e) => (e.id === r.event.id ? r.event : e)) : [...l, r.event] });
    return r;
  }

  // the whole event goes, with its repeats
  function remove(list, id) { window.notch.setSettings({ localEvents: (list || []).filter((e) => e.id !== id) }); }

  return { repeats, fields, make, save, remove };
})();
