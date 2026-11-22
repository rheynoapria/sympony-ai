// Weather (Open-Meteo): 1×1 sparkline card + 3-tile section (Hero now | 24-hour temp & rain chart | 5 days + sunrise/sunset).
(function () {
  const { api, $, esc } = N;
  let page;
  const cards = new Set();
  let watching = false;

  function ensureWatch() {
    if (watching) return;
    watching = true;
    N.watch('weather', (w) => { render(w); renderCards(w); });
  }

  function wxColor(code, day = true) {
    if (code >= 51) return '#60a5fa';
    if (!day && code <= 2) return '#c9b6ff';
    return '#fbbf24';
  }

  function wxSvg(code, day, size = 16) {
    const col = wxColor(code, day);
    const ico = code >= 51 ? 'drop' : (!day && code <= 2) ? 'moonz' : code === 0 ? 'sun' : 'cloudsun';
    return `<span style="color:${col};display:inline-flex;flex:none">${N.ic(ico, `width:${size}px;height:${size}px`)}</span>`;
  }

  // Open-Meteo returns local ISO times ("2026-11-20T17:00"): keep the place's own wall-clock hour/minute.
  function hourOf(val) {
    if (typeof val === 'string') {
      const m = val.match(/T(\d{2}):/);
      if (m) return m[1];
    }
    const d = new Date(val);
    return Number.isFinite(d.getTime()) ? String(d.getHours()).padStart(2, '0') : '';
  }

  function hhmmOf(val) {
    if (!val) return '';
    if (typeof val === 'string') {
      const m = val.match(/T(\d{2}):(\d{2})/);
      if (m) return N.hm(new Date(2000, 0, 1, +m[1], +m[2]).getTime());
    }
    const d = new Date(val);
    return Number.isFinite(d.getTime()) ? N.hm(d.getTime()) : '';
  }

  // Sample up to 13 points every 2 hours across the 24-hour forecast (matching modules.html).
  function sample24h(hourly, fallbackTemp) {
    const src = Array.isArray(hourly) ? hourly.filter((h) => h && Number.isFinite(Number(h.temp))) : [];
    if (src.length >= 13) {
      const out = [];
      for (let i = 0; i < src.length && out.length < 12; i += 2) out.push(src[i]);
      out.push(src[Math.min(src.length - 1, 23)]);
      return out;
    }
    if (src.length >= 2) return src;
    const t = Number.isFinite(Number(fallbackTemp)) ? Number(fallbackTemp) : 25;
    return [
      { time: Date.now(), temp: t, pop: 0 },
      { time: Date.now() + 4 * 3600000, temp: t, pop: 0 },
    ];
  }

  function paintCard(slot, w) {
    const { el } = slot;
    el.style.setProperty('--tint', '#60a5fa');
    if (!w || !w.current) {
      el.innerHTML = `${N.hd('cloudsun', _t('Weather'))}<div class="big" style="font-size:28px;margin-top:auto">--°</div><div class="sub t1">${esc((w && w.error) || _t('Choose city'))}</div>`;
      return;
    }
    const c = w.current;
    const city = ((w.location && w.location.name) || _t('Weather')).split(',')[0].trim();
    const pts24 = sample24h(w.hourly, c.temp);
    const temps = pts24.map((h) => Number(h.temp));
    const mn = Math.min(...temps);
    const mx = Math.max(...temps);
    const span = (mx - mn) || 4;
    const W = 122;
    const pts = temps.map((v, k) => `${((k / Math.max(1, temps.length - 1)) * W).toFixed(1)},${(16 - ((v - mn) / span) * 12).toFixed(1)}`).join(' ');
    const y0 = (16 - ((temps[0] - mn) / span) * 12).toFixed(1);

    el.innerHTML = `${N.hd('cloudsun', city)}`
      + `<span style="position:absolute;right:11px;top:9px">${wxSvg(c.code, c.day !== false, 30)}</span>`
      + `<div class="row" style="align-items:baseline;gap:6px;margin-top:4px"><div class="big" style="font-size:30px">${Math.round(c.temp)}°</div><span class="sub t1">${esc(window.weatherLabel(c.code))}</span></div>`
      + `<svg viewBox="0 0 ${W} 20" style="width:100%;height:auto;max-height:22px;margin-top:auto;display:block;overflow:visible"><polyline points="${pts}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="0" cy="${y0}" r="3" fill="#fff"/></svg>`;
  }

  function renderCards(w) {
    const cur = w !== undefined ? w : N.data.weather;
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot, cur);
    }
  }

  function render(w) {
    if (!page) return;
    if (!w || !w.current) {
      page.innerHTML = `<div class="c" style="flex:1;justify-content:center;align-items:center;gap:10px;text-align:center">`
        + `<span style="color:#60a5fa">${N.ic('cloudsun', 'width:26px;height:26px')}</span>`
        + `<span class="sub">${esc((w && w.error) || _t('Loading weather…'))}</span>`
        + `<button type="button" class="sbtn p" id="wxSet">${esc(_t('Choose city'))}</button></div>`;
      const b = $('#wxSet', page); if (b) b.onclick = () => api.openSettings('weather');
      return;
    }

    const c = w.current;
    const allDaily = Array.isArray(w.daily) ? w.daily : [];
    const today = allDaily[0] || null;
    const next5 = allDaily.length > 1 ? allDaily.slice(1, 6) : allDaily.slice(0, 5);
    const allHourly = Array.isArray(w.hourly) ? w.hourly : [];
    const series = sample24h(allHourly, c.temp);

    // Tile 1: Hero stats
    const hi = today && Number.isFinite(Number(today.max)) ? Math.round(today.max) : Math.round(Math.max(...series.map((h) => Number(h.temp))));
    const lo = today && Number.isFinite(Number(today.min)) ? Math.round(today.min) : Math.round(Math.min(...series.map((h) => Number(h.temp))));
    const feels = Math.round(Number.isFinite(Number(c.feels)) ? Number(c.feels) : Number(c.temp));
    const rangeLine = _t('H {max}° · L {min}° · feels {feels}°', { max: hi, min: lo, feels });

    const chips = [];
    if (c.wind != null && Number.isFinite(Number(c.wind))) {
      const unit = w.windUnit === 'km/h' && window.SYMPONY_LANG === 'id' ? 'km/j' : (w.windUnit || 'km/h');
      chips.push([_t('Wind'), `${Math.round(Number(c.wind))} ${unit}`, '#fff']);
    }
    if (c.humidity != null && Number.isFinite(Number(c.humidity))) {
      chips.push([_t('Humidity|short'), `${Math.round(Number(c.humidity))}%`, '#fff']);
    }
    if (c.uv != null && Number.isFinite(Number(c.uv))) {
      const uv = Math.max(0, Number(c.uv));
      chips.push(['UV', String(Math.round(uv)), N.meter(uv * 10)]);
    }
    const chipsHtml = chips.length
      ? `<div class="row" style="gap:5px;margin-top:8px">${chips.map(([lbl, val, col]) => `<div style="flex:1;padding:4px 6px;border-radius:9px;background:#16161c;min-width:0"><div class="t1" style="font-size:9px;color:var(--mute);font-weight:600">${esc(lbl)}</div><b class="n t1" style="font-size:11.5px;color:${col};display:block">${esc(val)}</b></div>`).join('')}</div>`
      : '';

    // Tile 2: 24-hour temperature line + rain probability bars (constant aspect ratio SVG)
    let rainPeak = null;
    for (const h of allHourly) {
      const p = Number(h && h.pop);
      if (Number.isFinite(p) && (!rainPeak || p > rainPeak.pop)) {
        rainPeak = { pop: p, time: h.time };
      }
    }
    const rainPill = rainPeak && rainPeak.pop >= 30
      ? `<span class="pill" style="background:#60a5fa22;color:#60a5fa">${N.ic('drop', 'width:10px;height:10px;margin-inline-end:3px')}${Math.round(rainPeak.pop)}% · ${esc(hhmmOf(rainPeak.time))}</span>`
      : '';

    const W = 226;
    const H = 116;
    const temps = series.map((h) => Number(h.temp));
    const mn = Math.min(...temps) - 1;
    const mx = Math.max(...temps) + 1;
    const tSpan = Math.max(2, mx - mn);
    const px = (k) => 12 + (k * (W - 24)) / Math.max(1, series.length - 1);
    const py = (v) => 16 + (1 - (v - mn) / tSpan) * (H - 46);
    const linePts = series.map((h, k) => `${px(k).toFixed(1)},${py(Number(h.temp)).toFixed(1)}`).join(' ');
    const labelStep = series.length >= 9 ? 2 : 1;
    const barsHtml = series.map((h, k) => {
      const r = Math.max(0, Math.min(100, Number(h.pop) || 0));
      if (!r) return '';
      const bh = Math.max(2, r * 0.26);
      const op = Math.min(0.95, 0.25 + r / 140).toFixed(2);
      return `<rect x="${(px(k) - 4).toFixed(1)}" y="${(H + 4 - bh).toFixed(1)}" width="8" height="${bh.toFixed(1)}" rx="2" fill="#60a5fa" fill-opacity="${op}"/>`;
    }).join('');
    const markersHtml = series.map((h, k) => {
      if (k % labelStep !== 0) return '';
      const x = px(k).toFixed(1);
      const y = py(Number(h.temp));
      const hr = k === 0 ? _t('Now|short') : hourOf(h.time);
      return `<circle cx="${x}" cy="${y.toFixed(1)}" r="${k ? 2.5 : 4}" fill="${k ? '#fbbf24' : '#fff'}"/>`
        + `<text x="${x}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="ui-rounded,-apple-system,system-ui">${Math.round(Number(h.temp))}°</text>`
        + `<text x="${x}" y="${H + 20}" text-anchor="middle" font-size="9.5" fill="#6b6b74" font-family="-apple-system,system-ui">${esc(hr)}</text>`;
    }).join('');

    // Tile 3: Next 5 days + sunrise / sunset
    const dMin = Math.min(...next5.map((d) => Number(d.min)), 100);
    const dMax = Math.max(...next5.map((d) => Number(d.max)), dMin + 4);
    const dRange = Math.max(1, dMax - dMin);
    const daysHtml = next5.map((d) => {
      const dayStr = new Date(d.date + 'T12:00').toLocaleDateString(_tLocale(), { weekday: 'short' });
      const col = wxColor(d.code, true);
      const leftPct = Math.max(0, Math.min(82, ((Number(d.min) - dMin) / dRange) * 100));
      const widthPct = Math.max(14, Math.min(100 - leftPct, ((Number(d.max) - Number(d.min)) / dRange) * 100));
      return `<div style="padding:2px 0"><div class="row" style="gap:6px;font-size:12px"><span style="width:28px;font-weight:600;flex:none">${esc(dayStr)}</span>${wxSvg(d.code, true, 13)}<span class="n dim" style="margin-inline-start:auto">${Math.round(Number(d.min))}°</span><b class="n">${Math.round(Number(d.max))}°</b></div>`
        + `<div class="bar" style="height:3px;margin-top:3px;position:relative"><i style="position:absolute;top:0;bottom:0;left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${col};transform:none"></i></div></div>`;
    }).join('');

    const sr = today && today.sunrise ? hhmmOf(today.sunrise) : '';
    const ss = today && today.sunset ? hhmmOf(today.sunset) : '';
    const sunRowHtml = (sr || ss)
      ? `<div class="row" style="justify-content:space-between;margin-top:auto;padding-top:6px;border-top:1px solid #1d1d24;font-size:11px">`
        + `<span class="row" style="gap:4px;color:#fbbf24">${N.ic('sun', 'width:12px;height:12px')}<b class="n" style="color:#fff">${esc(sr || '--.--')}</b></span>`
        + `<span class="row" style="gap:4px;color:#c9b6ff">${N.ic('moonz', 'width:12px;height:12px')}<b class="n" style="color:#fff">${esc(ss || '--.--')}</b></span></div>`
      : '';

    const cityTitle = ((w.location && w.location.name) || _t('Weather')).split(',')[0].trim();

    page.innerHTML = `<div style="display:grid;grid-template-columns:200px minmax(0,1fr) 168px;grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c" id="wxCityTile" style="padding:12px;cursor:pointer" title="${esc(_t('Choose city'))}">`
      + `${N.hd('cloudsun', cityTitle)}`
      + `<span style="position:absolute;right:12px;top:30px">${wxSvg(c.code, c.day !== false, 44)}</span>`
      + `<div class="big" style="font-size:58px;margin-top:auto;line-height:0.95">${Math.round(c.temp)}°</div>`
      + `<div class="t1" dir="auto" style="font-weight:700;font-size:13px;margin-top:4px">${esc(window.weatherLabel(c.code))}</div>`
      + `<div class="sub t1" style="font-size:11px">${esc(rangeLine)}</div>`
      + `${chipsHtml}</div>`
      + `<div class="c" style="padding:10px 12px">`
      + `<div class="row" style="justify-content:space-between;gap:6px;flex:none"><span class="hd" style="color:var(--dim)">${N.ic('day', 'width:12px;height:12px')}<span>${esc(_t('24 hours'))}</span></span>${rainPill}</div>`
      + `<svg viewBox="0 0 ${W} ${H + 26}" style="width:100%;height:auto;max-height:172px;display:block;margin-top:auto;overflow:visible">`
      + `${barsHtml}<line x1="0" y1="${H + 4}" x2="${W}" y2="${H + 4}" stroke="#24242c"/>`
      + `<polyline points="${linePts}" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
      + `${markersHtml}</svg></div>`
      + `<div class="c" style="padding:10px 12px;gap:1px">${daysHtml}${sunRowHtml}</div>`
      + `</div>`;

    const ct = $('#wxCityTile', page);
    if (ct) ct.onclick = () => api.openSettings('weather');
  }

  N.register({
    id: 'weather',
    tall: true,
    init(p) { page = p; ensureWatch(); render(N.data.weather); },
    show() { render(N.data.weather); if (N.data.weather && Date.now() - (N.data.weather.updatedAt || 0) > 30 * 60000) api.svc('weather', 'refresh'); },
    card(el, size) {
      ensureWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('weather'));
      paintCard(slot, N.data.weather);
    },
    refreshCards() { renderCards(N.data.weather); },
  });
})();
