// The world clock and the hourly chime (Settings → General → Clock). The time in other places comes from the PC's own
// time zone data (Intl, nothing from the internet); the chime's times from this PC's clock. Shared by the notch (its
// side slot, the Dashboard widget, the chime) and Settings (picking places, trying the sound): window.SymponyClock.
(function () {
  // Places people look for, by the city they know them by (several cities can share a zone). Every other zone Windows
  // knows can be found too, by its own city (Intl.supportedValuesOf), or typed as it is ("Europe/Vilnius").
  const CITIES = [
    ['Jakarta', 'Asia/Jakarta'], ['Bandung', 'Asia/Jakarta'], ['Surabaya', 'Asia/Jakarta'], ['Medan', 'Asia/Jakarta'], ['Pontianak', 'Asia/Pontianak'],
    ['Bali', 'Asia/Makassar'], ['Makassar', 'Asia/Makassar'], ['Jayapura', 'Asia/Jayapura'], ['Kuala Lumpur', 'Asia/Kuala_Lumpur'],
    ['Singapore', 'Asia/Singapore'], ['Bangkok', 'Asia/Bangkok'], ['Hanoi', 'Asia/Ho_Chi_Minh'], ['Ho Chi Minh City', 'Asia/Ho_Chi_Minh'],
    ['Manila', 'Asia/Manila'], ['Hong Kong', 'Asia/Hong_Kong'], ['Taipei', 'Asia/Taipei'], ['Beijing', 'Asia/Shanghai'], ['Shanghai', 'Asia/Shanghai'],
    ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'], ['Osaka', 'Asia/Tokyo'], ['New Delhi', 'Asia/Kolkata'], ['Mumbai', 'Asia/Kolkata'],
    ['Bengaluru', 'Asia/Kolkata'], ['Karachi', 'Asia/Karachi'], ['Dhaka', 'Asia/Dhaka'], ['Kathmandu', 'Asia/Kathmandu'], ['Colombo', 'Asia/Colombo'],
    ['Yangon', 'Asia/Yangon'], ['Dubai', 'Asia/Dubai'], ['Abu Dhabi', 'Asia/Dubai'], ['Doha', 'Asia/Qatar'], ['Riyadh', 'Asia/Riyadh'],
    ['Mecca', 'Asia/Riyadh'], ['Makkah', 'Asia/Riyadh'], ['Medina', 'Asia/Riyadh'], ['Jeddah', 'Asia/Riyadh'], ['Kuwait', 'Asia/Kuwait'],
    ['Tehran', 'Asia/Tehran'], ['Kabul', 'Asia/Kabul'], ['Tashkent', 'Asia/Tashkent'], ['Almaty', 'Asia/Almaty'], ['Baghdad', 'Asia/Baghdad'],
    ['Jerusalem', 'Asia/Jerusalem'], ['Amman', 'Asia/Amman'], ['Beirut', 'Asia/Beirut'], ['Brunei', 'Asia/Brunei'], ['Phnom Penh', 'Asia/Phnom_Penh'],
    ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'], ['Lisbon', 'Europe/Lisbon'], ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'],
    ['Amsterdam', 'Europe/Amsterdam'], ['Brussels', 'Europe/Brussels'], ['Madrid', 'Europe/Madrid'], ['Barcelona', 'Europe/Madrid'], ['Rome', 'Europe/Rome'],
    ['Milan', 'Europe/Rome'], ['Zurich', 'Europe/Zurich'], ['Vienna', 'Europe/Vienna'], ['Prague', 'Europe/Prague'], ['Warsaw', 'Europe/Warsaw'],
    ['Stockholm', 'Europe/Stockholm'], ['Oslo', 'Europe/Oslo'], ['Copenhagen', 'Europe/Copenhagen'], ['Helsinki', 'Europe/Helsinki'],
    ['Athens', 'Europe/Athens'], ['Istanbul', 'Europe/Istanbul'], ['Kyiv', 'Europe/Kyiv'], ['Moscow', 'Europe/Moscow'], ['Bucharest', 'Europe/Bucharest'],
    ['Budapest', 'Europe/Budapest'], ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'], ['Nairobi', 'Africa/Nairobi'], ['Johannesburg', 'Africa/Johannesburg'],
    ['Casablanca', 'Africa/Casablanca'], ['Accra', 'Africa/Accra'], ['Addis Ababa', 'Africa/Addis_Ababa'],
    ['New York', 'America/New_York'], ['Washington, D.C.', 'America/New_York'], ['Toronto', 'America/Toronto'], ['Chicago', 'America/Chicago'],
    ['Denver', 'America/Denver'], ['Phoenix', 'America/Phoenix'], ['Los Angeles', 'America/Los_Angeles'], ['San Francisco', 'America/Los_Angeles'],
    ['Seattle', 'America/Los_Angeles'], ['Vancouver', 'America/Vancouver'], ['Anchorage', 'America/Anchorage'], ['Honolulu', 'Pacific/Honolulu'],
    ['Mexico City', 'America/Mexico_City'], ['Bogotá', 'America/Bogota'], ['Lima', 'America/Lima'], ['Santiago', 'America/Santiago'],
    ['Buenos Aires', 'America/Argentina/Buenos_Aires'], ['São Paulo', 'America/Sao_Paulo'], ['Rio de Janeiro', 'America/Sao_Paulo'],
    ['Caracas', 'America/Caracas'], ['Halifax', 'America/Halifax'], ['St. John’s', 'America/St_Johns'],
    ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Brisbane', 'Australia/Brisbane'], ['Adelaide', 'Australia/Adelaide'],
    ['Perth', 'Australia/Perth'], ['Darwin', 'Australia/Darwin'], ['Auckland', 'Pacific/Auckland'], ['Chatham Islands', 'Pacific/Chatham'],
    ['Fiji', 'Pacific/Fiji'], ['Tonga', 'Pacific/Tongatapu'], ['Samoa', 'Pacific/Apia'], ['Kiritimati', 'Pacific/Kiritimati'], ['Guam', 'Pacific/Guam'],
    ['Marquesas Islands', 'Pacific/Marquesas'], ['UTC', 'UTC'],
  ];
  const MAX = 8; // places at most (the Dashboard widget shows the first 4, a side of the closed Sympony the first one)
  const MIN = 60000;
  // Sympony's _t where i18n.js is loaded (the pages), the text as it is elsewhere (the tests); named _t so
  // scripts/i18n.js finds these texts
  const _t = (s, v) => (typeof globalThis._t === 'function' ? globalThis._t(s, v) : s);
  // for searching: lower case, without accents (Bogota finds Bogotá), spaces for the zone's _ and /
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_/]+/g, ' ');

  // one formatter per zone (making one is the slow part): the date and time there, in numbers
  const fmts = new Map();
  function fmt(tz) {
    let f = fmts.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      if (fmts.size > 40) fmts.clear();
      fmts.set(tz, f);
    }
    return f;
  }
  // a zone Intl knows (Windows' own data); old names ("Asia/Calcutta") count too
  function valid(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try { fmt(tz); return true; } catch (e) { return false; }
  }
  // the wall clock in a zone at `t`: year, month (1-12), day, hour, minute
  function wall(tz, t) {
    const o = {};
    for (const p of fmt(tz).formatToParts(t)) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute };
  }
  // …and on this PC
  function here(t) { const d = new Date(t); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() }; }
  // how far a zone is ahead of UTC at `t`, in minutes (this PC's own zone without one)
  function offset(tz, t) {
    if (!tz) return -new Date(t).getTimezoneOffset();
    const w = wall(tz, t);
    return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(t / MIN) * MIN) / MIN);
  }
  // A place at `t`, next to this PC's clock: its hour and minute, night (before 6 or from 18 there), how many minutes
  // it's ahead (behind: below 0) and whether its date is a day ahead (1) or behind (-1)
  function info(tz, t) {
    const w = wall(tz, t); const l = here(t);
    const day = Math.sign(Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(l.y, l.mo - 1, l.d));
    return { h: w.h, mi: w.mi, night: w.h < 6 || w.h >= 18, diff: offset(tz, t) - offset('', t), day };
  }
  // the time there as Sympony writes times (Settings → 24-hour time)
  function time(tz, t, h24) {
    return new Date(t).toLocaleTimeString(typeof _tLocale === 'function' ? _tLocale() : undefined,
      { timeZone: tz, hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12' });
  }
  // "+5 h", "−2 h", "+5:30 h"; the same time as here: "Same time"
  function diffText(min) {
    if (!min) return _t('Same time');
    const a = Math.abs(min);
    const n = `${min > 0 ? '+' : '−'}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
    return _t('{n} h', { n });
  }
  // the difference, and the day when it isn't today there: "+5 h · tomorrow"
  function diffLine(i) {
    return [diffText(i.diff), i.day > 0 ? _t('tomorrow') : i.day < 0 ? _t('yesterday') : ''].filter(Boolean).join(' · ');
  }
  // the zone's own city: "America/Argentina/Buenos_Aires" → "Buenos Aires"; the time zone data still calls a few by
  // their old names (Asia/Calcutta)
  const RENAMED = { Calcutta: 'Kolkata', Katmandu: 'Kathmandu', Rangoon: 'Yangon', Saigon: 'Ho Chi Minh City', Kiev: 'Kyiv', Godthab: 'Nuuk', Asmera: 'Asmara', Ulan_Bator: 'Ulaanbaatar' };
  const cityOf = (tz) => { const c = String(tz).split('/').pop(); return (RENAMED[c] || c).replace(/_/g, ' '); };

  // the places from the settings, cleaned up: a name and a zone each, zones this PC knows, at most eight
  function places(s) {
    const l = Array.isArray(s && s.worldClocks) ? s.worldClocks : [];
    return l.filter((p) => p && valid(p.tz)).slice(0, MAX).map((p) => ({ name: String(p.name || '').trim().slice(0, 30) || cityOf(p.tz), tz: p.tz }));
  }

  // Everything that can be picked: the cities above, then every zone by its own city (Kolkata as well as Mumbai),
  // each once, sorted
  let all = null;
  function zones() {
    if (all) return all;
    const out = CITIES.filter(([, tz]) => valid(tz)).map(([name, tz]) => ({ name, tz }));
    // (Kyiv's zone has its new name only in newer time zone data)
    if (!out.some((z) => z.name === 'Kyiv') && valid('Europe/Kiev')) out.push({ name: 'Kyiv', tz: 'Europe/Kiev' });
    const known = new Set(out.map((z) => fold(z.name)));
    let more = [];
    try { more = Intl.supportedValuesOf('timeZone'); } catch (e) { /* older engines: the list above */ }
    for (const tz of more) {
      const name = cityOf(tz);
      if (known.has(fold(name)) || !tz.includes('/') || /^Etc\//.test(tz)) continue;
      known.add(fold(name)); out.push({ name, tz });
    }
    for (const z of out) z.key = fold(`${z.name} ${z.tz}`);
    all = out.sort((a, b) => a.name.localeCompare(b.name));
    return all;
  }
  // what a search box finds: names that start with it first, then any that have it; a zone typed as it is too
  function search(q, n = 6) {
    const f = fold(q).trim();
    if (!f) return [];
    const list = zones();
    const starts = list.filter((z) => fold(z.name).startsWith(f));
    const has = list.filter((z) => !starts.includes(z) && z.key.includes(f));
    const out = [...starts, ...has];
    const typed = String(q).trim();
    if (!out.some((z) => z.tz.toLowerCase() === typed.toLowerCase()) && /[/]|^utc$/i.test(typed) && valid(typed)) out.unshift({ name: cityOf(typed), tz: typed });
    return out.slice(0, n);
  }

  // ------------------------------------------------------------------ hourly chime
  // The next chime after `t` (ms): the next full hour on this PC's clock, or half hour with `half`. Counted on the
  // clock as it is at `t` (summer time changes on a full hour almost everywhere; where it doesn't, the chime finds
  // with lastChime that it's no full hour after all and waits for the next).
  function nextChime(t, half) {
    const step = (half ? 30 : 60) * MIN;
    const off = offset('', t) * MIN;
    return Math.floor((t + off) / step) * step + step - off;
  }
  // the full (or half) hour at `t` or the last one before it
  function lastChime(t, half) {
    const step = (half ? 30 : 60) * MIN;
    const off = offset('', t) * MIN;
    return Math.floor((t + off) / step) * step - off;
  }
  // "22:00" → minutes into the day; null when it isn't a time
  function minutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
  }
  // Quiet hours: is `t` from `from` up to (not at) `to` on this PC's clock? Over midnight when `to` comes first
  // (22:00 to 06:00); the same time twice is no quiet hours.
  function quietAt(t, from, to) {
    const a = minutes(from); const b = minutes(to);
    if (a == null || b == null || a === b) return false;
    const d = new Date(t); const m = d.getHours() * 60 + d.getMinutes();
    return a < b ? m >= a && m < b : m >= a || m < b;
  }
  // The bell: two soft notes falling a third on the hour, one on the half hour; a quiet higher partial makes it ring
  // like a small bell rather than beep. Played on `ctx` (the notch's own AudioContext, or Settings' for Try).
  function bell(ctx, half) {
    const notes = half ? [659.25] : [659.25, 523.25];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + 0.02 + i * 0.36;
      [[f, 0.09, 1.7], [f * 2.76, 0.018, 0.6]].forEach(([hz, peak, len]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = hz;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + len + 0.05);
      });
    });
  }

  window.SymponyClock = { MAX, valid, offset, info, time, diffText, diffLine, cityOf, places, zones, search, nextChime, lastChime, minutes, quietAt, bell };
})();
