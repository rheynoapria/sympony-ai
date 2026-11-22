// Bluetooth & Wi-Fi: radio switches, paired devices with connection state and battery, connect /
// disconnect for audio devices (headphones, speakers), Wi-Fi networks to join right from Sympony, and a speed test
// (ping, download, upload against Cloudflare's speed test, run by main when Start is clicked: speedtest.rs).
// On Linux it's the Speed test alone (Sympony has no Bluetooth or Wi-Fi there), named so in the tabs (icons.js); on a Mac
// all three (watchers.rs: IOBluetooth, CoreWLAN), with macOS's settings where Windows' are linked.
(function () {
  const { api, st, $, $$, esc, fa } = N;
  let page;
  let view = N.LINUX ? 'speed' : 'bluetooth'; // which list shows: 'bluetooth' | 'wifi' | 'speed'
  const busy = new Map(); // device id -> 'connect' | 'disconnect' while a request runs
  const wifi = { data: null, scanning: false, joining: null, ask: null, error: '', errorFor: null }; // ask: ssid waiting for a password
  // main's speed test: { running, phase: 'ping' | 'down' | 'up' | 'done' | 'error' | '', ping, jitter, down, up (so far),
  // progress 0-1 of the part running, error, last: { at, ping, jitter, down, up, colo, used } | null }
  let speed = null;
  api.on('speedtest', (s) => { speed = s; render(); });

  function radioBtn(kind, label, icon) {
    const s = (st.radios || {})[kind];
    if (s == null) return '';
    const on = s === 'on';
    return `<button class="bt-radio ${on ? 'on' : ''}" data-radio="${kind}" ${s === 'disabled' ? 'disabled' : ''} title="${on ? _t('Turn {name} off', { name: label }) : _t('Turn {name} on', { name: label })}">
      ${icon}<span><b>${label}</b><small>${s === 'disabled' ? _t('Unavailable') : on ? _t('On') : _t('Off')}</small></span></button>`;
  }

  // Signal strength as 3 arcs over a dot, lit by Windows' 0-4 signal bars.
  function signal(bars) {
    const lit = bars >= 4 ? 3 : bars >= 3 ? 2 : bars >= 2 ? 1 : 0;
    const arc = (r, i) => {
      const d = r * Math.SQRT1_2;
      return `<path d="M${(9 - d).toFixed(2)} ${(14 - d).toFixed(2)} A${r} ${r} 0 0 1 ${(9 + d).toFixed(2)} ${(14 - d).toFixed(2)}" stroke="${i < lit ? 'currentColor' : 'rgba(255,255,255,.22)'}"/>`;
    };
    return `<svg class="wf-sig" viewBox="0 0 18 16" fill="none" stroke-width="1.9" stroke-linecap="round">${arc(4.2, 0)}${arc(7.7, 1)}${arc(11.2, 2)}<circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none"/></svg>`;
  }

  // Windows often lists one device twice (its classic and its Low Energy side, like a mouse or a phone):
  // keep the entry that tells the most (connected, can be connected from here, battery, a known kind).
  function devices() {
    const score = (d) => (d.connected ? 8 : 0) + (d.audio ? 4 : 0) + (d.battery >= 0 ? 2 : 0) + ((window.DEVICE_ICONS || {})[d.kind] ? 1 : 0);
    const byName = new Map();
    for (const d of st.bluetooth || []) {
      const k = (d.name || '').trim().toLowerCase();
      const had = byName.get(k);
      if (!had || score(d) > score(had)) byName.set(k, d);
    }
    // connected first, then headphones and speakers (they connect from here), then the rest, by name
    return [...byName.values()].sort((a, b) => (b.connected - a.connected) || (!!b.audio - !!a.audio) || a.name.localeCompare(b.name));
  }

  function renderBluetooth() {
    const btOn = !st.radios || st.radios.bluetooth !== 'off';
    const devs = devices();
    const low = st.settings.bluetoothLowBattery || 20;
    $('.bt-grid', page).innerHTML = !btOn
      ? `<div class="empty-state" style="grid-column:1/-1">${fa('bluetooth-b', 'brands')}<span>${_t('Bluetooth is off')}</span></div>`
      : devs.map((d) => {
        const b = busy.get(d.id);
        const act = d.audio ? `<button class="bt-act ${d.connected ? '' : 'go'}" data-dev="${esc(d.id)}" data-on="${d.connected ? 0 : 1}" ${b ? 'disabled' : ''}>${b
          ? `${fa('spinner fa-spin')} ${b === 'connect' ? _t('Connecting') : _t('Disconnecting')}`
          : d.connected ? _t('Disconnect') : _t('Connect')}</button>` : '';
        return `
      <div class="bt-card ${d.connected ? '' : 'off'}">
        <div class="top">${(window.DEVICE_ICONS || {})[d.kind] || fa('bluetooth-b', 'brands')}<span class="nm" title="${esc(d.name)}">${esc(d.name)}</span></div>
        ${d.battery >= 0 ? `<div class="bar-track ${d.battery <= low ? 'low' : ''}"><div style="width:${d.battery}%"></div></div>` : '<div class="bar-track"></div>'}
        <div class="st"><span>${d.connected ? _t('Connected') : _t('Not connected')}</span><b>${d.battery >= 0 ? d.battery + '%' : ''}</b></div>
        ${act}
      </div>`;
      }).join('') || `<div class="empty-state" style="grid-column:1/-1">${fa('bluetooth-b', 'brands')}<span>${_t('No paired Bluetooth devices')}</span></div>`;
    const n = devs.filter((d) => d.connected).length;
    $('.bt-foot .count', page).textContent = btOn ? _t('{n} connected · {total} paired', { n, total: devs.length }) : ''; fitFoot();
    $$('[data-dev]', page).forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.dev; const on = b.dataset.on === '1';
        busy.set(id, on ? 'connect' : 'disconnect');
        render();
        const r = await api.svc('bluetooth', on ? 'connect' : 'disconnect', id);
        // the device list event follows when Windows reports the new state (a headset can take 10-15 s to
        // bring its audio back); don't spin forever if it never does
        N.later('bt-busy-' + id, r && r.ok ? (on ? 20000 : 8000) : 0, () => { busy.delete(id); render(); });
        if (r && !r.ok) N.toast(fa('circle-exclamation'), r.message || _t('Couldn’t connect'), { color: '#ff453a' });
      };
    });
  }

  function renderWifi() {
    const box = $('.wf-list', page);
    const off = st.radios && st.radios.wifi === 'off';
    const d = wifi.data;
    $('.bt-foot .count', page).textContent = off || !d || !d.ok ? '' : d.connected ? _t('Connected to {name}', { name: d.connected }) : _t('Not connected'); fitFoot();
    if (off) { box.innerHTML = `<div class="empty-state">${fa('wifi')}<span>${_t('Wi-Fi is off')}</span></div>`; return; }
    if (!d) { box.innerHTML = `<div class="empty-state">${fa('spinner fa-spin')}<span>${_t('Looking for networks…')}</span></div>`; return; }
    if (!d.ok) {
      const loc = d.reason === 'location';
      box.innerHTML = `<div class="empty-state">${fa(loc ? 'location-dot' : 'wifi')}<span>${esc(loc ? (N.MAC ? _t('macOS only tells Wi-Fi network names to apps allowed to use your location.') : _t('Windows only lists Wi-Fi networks to apps that may use your location.')) : d.message || _t('Couldn’t list networks'))}</span>
        ${loc ? `<button class="pill-btn" id="wfLoc">${_t('Open location settings')}</button><span class="small">${N.MAC ? _t('Turn on Location Services for Sympony, then come back.') : _t('Turn on Location services and “Let desktop apps access your location”, then come back.')}</span>` : ''}</div>`;
      const b = $('#wfLoc', page); if (b) b.onclick = () => { api.openExternal(N.MAC ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices' : 'ms-settings:privacy-location'); N.closeNotch(); };
      return;
    }
    if (!d.networks.length) { box.innerHTML = `<div class="empty-state">${fa('wifi')}<span>${_t('No networks found')}</span></div>`; return; }
    // a re-render (Bluetooth and radio events come any time) must not lose a half-typed password
    const typed = $('.wf-row.asking .wf-pw', page);
    const kept = typed ? typed.value : '';
    box.innerHTML = d.networks.map((n) => {
      const joining = wifi.joining === n.ssid;
      const asking = wifi.ask === n.ssid;
      const btn = joining ? `<button class="bt-act" disabled>${fa('spinner fa-spin')} ${n.connected ? _t('Disconnecting') : _t('Connecting')}</button>`
        : n.connected ? `<button class="bt-act" data-wf="off">${_t('Disconnect')}</button>`
          : asking ? '' : `<button class="bt-act go" data-wf="join">${_t('Connect')}</button>`;
      return `<div class="wf-row ${n.connected ? 'on' : ''} ${asking ? 'asking' : ''}" data-ssid="${esc(n.ssid)}">
        ${signal(n.bars)}
        <span class="wf-name"><b title="${esc(n.ssid)}">${esc(n.ssid)}</b>${wifi.error && wifi.errorFor === n.ssid
          ? `<small class="bad">${esc(wifi.error)}</small>`
          : `<small>${n.connected ? _t('Connected') : n.saved ? _t('Saved') : n.secure ? _t('Secured') : _t('Open|Wi-Fi without a password')}${n.band ? ' · ' + esc(n.band) : ''}</small>`}</span>
        ${n.secure ? `<span class="wf-lock">${fa('lock')}</span>` : ''}
        ${asking ? `<span class="wf-pass"><input type="password" class="wf-pw" placeholder="${_t('Password')}">
          <button class="bt-act go" data-wf="pw">${_t('Join')}</button><button class="bt-act" data-wf="cancel" title="${_t('Cancel')}">${fa('xmark')}</button></span>` : btn}
      </div>`;
    }).join('') + (wifi.error && !d.networks.some((n) => n.ssid === wifi.errorFor) ? `<div class="wf-err">${fa('circle-exclamation')} ${esc(wifi.error)}</div>` : '');
    $$('.wf-row [data-wf]', page).forEach((b) => {
      const row = b.closest('.wf-row');
      const net = d.networks.find((n) => n.ssid === row.dataset.ssid);
      b.onclick = (e) => { e.stopPropagation(); act(b.dataset.wf, net, row); };
    });
    const pw = $('.wf-row.asking .wf-pw', page);
    if (pw) {
      pw.value = kept;
      N.focusField(pw);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') act('pw', d.networks.find((n) => n.ssid === wifi.ask), pw.closest('.wf-row')); });
    }
  }

  async function act(what, net, row) {
    if (!net) return;
    wifi.error = '';
    if (what === 'cancel') { wifi.ask = null; render(); return; }
    // work / school networks (802.1X sign-in) are joined in Windows' own Wi-Fi list
    if (what === 'join' && net.enterprise && !net.saved) { openWindowsList(); return; } // (System Settings on a Mac)
    if (what === 'join' && net.secure && !net.saved) { wifi.ask = net.ssid; render(); return; }
    let pass = '';
    if (what === 'pw') {
      pass = $('.wf-pw', row).value;
      if (!pass) return;
    }
    wifi.ask = null;
    wifi.joining = net.ssid;
    render();
    const r = what === 'off' ? await api.svc('wifi', 'disconnect') : await api.svc('wifi', 'connect', net.ssid, pass);
    wifi.joining = null;
    if (r && !r.ok) {
      if (r.windows) { openWindowsList(); return; }
      if (r.needPassword) wifi.ask = net.ssid;
      wifi.error = r.message || _t('Couldn’t connect');
      wifi.errorFor = net.ssid;
    }
    // Windows reports the new connection a moment after it's made
    await new Promise((res) => setTimeout(res, what === 'off' ? 600 : 1200));
    await load(false);
    // the connected network is listed first
    if (r && r.ok) $('.wf-list', page).scrollTop = 0;
  }

  function openWindowsList() { api.openExternal(N.MAC ? MAC_WIFI : 'ms-availablenetworks:'); N.closeNotch(); }
  const MAC_WIFI = 'x-apple.systempreferences:com.apple.wifi-settings-extension';
  const MAC_BT = 'x-apple.systempreferences:com.apple.BluetoothSettings';

  async function load(scan) {
    if (scan) { wifi.scanning = true; paintRefresh(); }
    const r = await api.svc('wifi', 'list', !!scan);
    wifi.scanning = false;
    if (r) wifi.data = r;
    paintRefresh();
    if (view === 'wifi') render();
  }

  // ---- the speed test: three tiles (ping, download, upload), Start / Cancel, the last test, and what it uses
  const SPEED = [
    ['ping', _t('Ping'), 'stopwatch', '#ffd60a'],
    ['down', _t('Download'), 'arrow-down', '#64d2ff'],
    ['up', _t('Upload'), 'arrow-up', '#bf5af2'],
  ];
  const ORDER = ['ping', 'down', 'up'];
  // 8.4 / 94 / 940 Mbps; 4.2 / 23 ms
  const num = (v) => (v == null || !Number.isFinite(+v) ? '–' : +v < 10 ? (+v).toFixed(1) : String(Math.round(+v)));
  const when = (t) => {
    const d = new Date(t);
    return d.toDateString() === new Date().toDateString() ? N.hm(t) : `${d.toLocaleDateString(_tLocale(), { day: 'numeric', month: 'short' })} ${N.hm(t)}`;
  };
  function renderSpeed() {
    const box = $('.st-wrap', page);
    if (!box) return;
    if (!box.firstChild) {
      box.innerHTML = `<div class="st-tiles">${SPEED.map(([k, l, ic, c]) => `<div class="st-tile" data-k="${k}" style="--st:${c}">
          <span class="st-lbl">${fa(ic)} ${l}</span><b class="st-val"><em></em><small>${k === 'ping' ? 'ms' : 'Mbps'}</small></b>
          <span class="st-sub"></span><i class="st-bar"><u></u></i></div>`).join('')}</div>
        <div class="st-go"><button class="pill-btn" id="stGo"></button><span class="st-status"></span></div>
        <div class="st-note">${_t('Uses Cloudflare’s speed test (speed.cloudflare.com). A test uses up to about 100 MB of data, less on slower connections.')}</div>`;
      $('#stGo', box).onclick = async () => {
        const run = speed && speed.running;
        const r = await api.svc('speedtest', run ? 'cancel' : 'start').catch(() => null);
        if (r) { speed = r; renderSpeed(); }
      };
    }
    const s = speed || {};
    const run = !!s.running;
    const last = s.last || null;
    // while it runs: what it has so far; else the last test's
    const val = run ? s : last || {};
    const at = ORDER.indexOf(s.phase);
    for (const [k] of SPEED) {
      const tile = $(`.st-tile[data-k="${k}"]`, box);
      const i = ORDER.indexOf(k);
      const active = run && i === at;
      tile.classList.toggle('active', active);
      tile.classList.toggle('wait', run && i > at);
      tile.classList.toggle('old', !run && s.phase === 'error');
      const v = num(val[k]);
      const em = $('em', tile);
      if (em.textContent !== v) em.textContent = v;
      $('.st-sub', tile).textContent = k === 'ping' && val.jitter != null && val.ping != null ? _t('Jitter {n} ms', { n: num(val.jitter) }) : '';
      $('.st-bar u', tile).style.width = `${active ? Math.round((s.progress || 0) * 100) : run && i < at ? 100 : 0}%`;
    }
    const go = $('#stGo', box);
    const html = run ? `${fa('xmark')} ${_t('Cancel')}` : `${fa('play')} ${last ? _t('Test again') : _t('Start test')}`;
    if (go.dataset.html !== html) { go.dataset.html = html; go.innerHTML = html; }
    go.classList.toggle('primary', !run);
    const status = $('.st-status', box);
    status.classList.toggle('bad', s.phase === 'error');
    status.textContent = run ? { ping: _t('Measuring the ping…'), down: _t('Measuring the download…'), up: _t('Measuring the upload…') }[s.phase] || ''
      : s.phase === 'error' ? s.error || _t('The test didn’t finish')
        : !last ? ''
          : last.colo ? _t('Last test {time} · {mb} MB · Cloudflare {place}', { time: when(last.at), mb: Math.round((last.used || 0) / 1e6), place: last.colo })
            : _t('Last test {time} · {mb} MB', { time: when(last.at), mb: Math.round((last.used || 0) / 1e6) });
  }

  function paintRefresh() {
    const b = $('#btRefresh', page);
    if (b) b.innerHTML = `${fa('arrows-rotate' + (wifi.scanning && view === 'wifi' ? ' fa-spin' : ''))}<span>${_t('Refresh')}</span>`;
  }

  // the count cut short (… at its end): Add device and Refresh show only their icons, which gives it its line back
  function fitFoot() {
    const foot = $('.bt-foot', page); const c = $('.count', foot);
    if (!foot.offsetWidth) return;
    foot.classList.remove('slim');
    if (c.scrollWidth > c.clientWidth + 1) foot.classList.add('slim');
  }

  function devSvgName(kind) {
    if (kind === 'headphones' || kind === 'speaker') return 'pods';
    if (kind === 'keyboard') return 'sliders';
    return 'cpu';
  }

  function render() {
    if (!page) return;
    const btOn = !st.radios || st.radios.bluetooth !== 'off';
    const devs = devices();
    const conn = devs.filter((d) => d.connected);
    const s = speed || {};
    const run = !!s.running;
    const last = s.last || null;
    const val = run ? s : (last || {});
    const downV = num(val.down);
    const upV = num(val.up);
    const pingV = num(val.ping);
    const wfName = (st.stats && st.stats.wifi && st.stats.wifi.ssid) || (wifi.data && wifi.data.connected) || 'Wi‑Fi';

    const btState = st.radios && st.radios.bluetooth;
    const wfState = st.radios && st.radios.wifi;
    const radioToggle = !N.LINUX && (view === 'wifi' ? wfState != null : btState != null)
      ? `<button type="button" class="sw ${(view === 'wifi' ? wfState : btState) === 'on' ? 'on' : ''}" data-radio="${view === 'wifi' ? 'wifi' : 'bluetooth'}" title="${esc(view === 'wifi' ? 'Wi-Fi' : 'Bluetooth')}"><i></i></button>`
      : '';
    const leftHeader = N.LINUX
      ? `${N.hd('wifi', _t('Speed test'))}`
      : `<div class="row" style="justify-content:space-between;gap:6px">`
        + `${N.hd(view === 'wifi' ? 'wifi' : 'bt', view === 'wifi' ? _t('Wi-Fi networks') : _t('Bluetooth devices'), view === 'wifi' ? '' : _t('{n} connected', { n: conn.length }))}`
        + `<div class="row" style="gap:6px;flex:none">${radioToggle}<div class="seg2"><button type="button" data-btv="bluetooth" class="${view !== 'wifi' ? 'on' : ''}" style="height:20px;padding:0 7px;font-size:10px">BT</button><button type="button" data-btv="wifi" class="${view === 'wifi' ? 'on' : ''}" style="height:20px;padding:0 7px;font-size:10px">Wi‑Fi</button></div></div></div>`;

    let leftBody = '';
    if (view === 'wifi' && !N.LINUX) {
      const off = st.radios && st.radios.wifi === 'off';
      const d = wifi.data;
      if (off) leftBody = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('Wi-Fi is off'))}</div>`;
      else if (!d) leftBody = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('Looking for networks…'))}</div>`;
      else if (!d.ok) leftBody = `<div class="sub" style="margin:auto;text-align:center">${esc(d.message || _t('Couldn’t list networks'))}</div>`;
      else {
        leftBody = `<div class="sc-y" style="display:flex;flex-direction:column;gap:5px;margin-top:8px;flex:1">`
          + (d.networks || []).slice(0, 10).map((n) => {
            const asking = wifi.ask === n.ssid;
            return `<div class="row wf-row" data-ssid="${esc(n.ssid)}" style="gap:8px;padding:5px 8px;border-radius:11px;background:rgba(255,255,255,0.035)">`
              + `${signal(n.bars)}<span class="t1" style="flex:1;font-size:12px;font-weight:600">${esc(n.ssid)}</span>`
              + (asking
                ? `<input type="password" class="wf-pw" placeholder="${esc(_t('Password'))}" style="width:84px;height:22px;border-radius:6px;background:var(--pill);border:0;padding:0 6px;font-size:11px"><button type="button" class="sbtn p" data-wf="pw" style="height:22px;padding:0 8px;font-size:10.5px">${esc(_t('Join'))}</button>`
                : `<button type="button" class="sbtn${n.connected ? '' : ' p'}" data-wf="${n.connected ? 'off' : 'join'}" style="height:22px;padding:0 8px;font-size:10.5px">${esc(n.connected ? _t('Disconnect') : _t('Connect'))}</button>`)
              + `</div>`;
          }).join('') + `</div>`;
      }
    } else if (!btOn) {
      leftBody = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('Bluetooth is off'))}</div>`;
    } else if (!devs.length) {
      leftBody = `<div class="sub" style="margin:auto;text-align:center">${esc(_t('No paired Bluetooth devices'))}</div>`;
    } else {
      leftBody = `<div class="sc-y" style="display:flex;flex-direction:column;gap:5px;margin-top:8px;flex:1;min-height:0">`
        + devs.map((d) => {
          const b = busy.get(d.id);
          const bat = typeof d.battery === 'number' && d.battery >= 0 ? Math.round(d.battery) : null;
          const col = bat != null ? N.meter(bat, true) : 'var(--dim)';
          const batHtml = bat != null
            ? `<span class="row" style="gap:4px;flex:none"><span style="width:22px;height:9px;border-radius:3px;border:1.5px solid #3a3a44;position:relative;overflow:hidden;display:inline-block"><i style="position:absolute;left:1px;top:1px;bottom:1px;width:calc(${bat}% - 2px);border-radius:1px;background:${col}"></i></span><b class="n" style="font-size:11px;color:${col}">${bat}</b></span>`
            : '';
          const actBtn = d.audio
            ? `<button type="button" class="sbtn" data-dev="${esc(d.id)}" data-on="${d.connected ? 0 : 1}" ${b ? 'disabled' : ''} style="height:22px;padding:0 8px;font-size:10.5px">${esc(b ? '…' : d.connected ? _t('Disconnect') : _t('Connect'))}</button>`
            : '';
          return `<div class="row" style="gap:10px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,0.035);opacity:${d.connected ? 1 : 0.65}">`
            + `<span class="mini-btn" style="width:28px;height:28px">${N.ic(devSvgName(d.kind), 'width:13px;height:13px')}</span>`
            + `<span class="t1" style="flex:1;font-size:12.5px;font-weight:600">${esc(d.name)}</span>${batHtml}${actBtn}</div>`;
        }).join('') + `</div>`;
    }

    const speedStatus = run
      ? esc({ ping: _t('Measuring ping…'), down: _t('Download…'), up: _t('Upload…') }[s.phase] || _t('Testing…'))
      : s.phase === 'error' ? esc(s.error || _t('Test failed'))
      : last ? `${esc(_t('Ping'))} <b class="n" style="color:#fff">${esc(pingV)} ms</b> · ${esc(when(last.at))}`
      : esc(_t('Cloudflare speed test'));

    page.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c">${leftHeader}${leftBody}</div>`
      + `<div class="c">${N.hd('wifi', `${_t('Speed test')} · ${wfName}`)}`
      + `<div class="row" style="gap:16px;margin-top:12px">`
      + `<div><div class="sub" style="font-size:10.5px">${esc(_t('Download'))}</div><div class="big" style="font-size:28px;color:#4ade80">${esc(downV)}</div><div class="sub" style="font-size:10px">Mbps</div></div>`
      + `<div><div class="sub" style="font-size:10.5px">${esc(_t('Upload'))}</div><div class="big" style="font-size:28px;color:#60a5fa">${esc(upV)}</div><div class="sub" style="font-size:10px">Mbps</div></div>`
      + `</div>`
      + (run ? `<div class="bar" style="height:4px;margin-top:10px"><i style="background:#4ade80;transform:scaleX(${Math.max(0.05, s.progress || 0)})"></i></div>` : '')
      + `<div class="row" style="justify-content:space-between;margin-top:auto;gap:6px"><span class="sub t1" style="font-size:11px">${speedStatus}</span>`
      + `<button type="button" class="sbtn p" id="stGo" style="height:26px">${esc(run ? _t('Cancel') : last ? _t('Test again') : _t('Start test'))}</button></div>`
      + `</div></div>`;

    $$('[data-btv]', page).forEach((b) => { b.onclick = () => setView(b.dataset.btv); });
    $$('[data-radio]', page).forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.radio;
        const on = (st.radios || {})[k] === 'on';
        api.svc('radios', 'set', k, !on).catch(() => {});
      };
    });
    $$('[data-dev]', page).forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.dev; const on = b.dataset.on === '1';
        busy.set(id, on ? 'connect' : 'disconnect');
        render();
        const r = await api.svc('bluetooth', on ? 'connect' : 'disconnect', id).catch(() => null);
        N.later('bt-busy-' + id, r && r.ok ? (on ? 20000 : 8000) : 0, () => { busy.delete(id); render(); });
      };
    });
    $$('.wf-row [data-wf]', page).forEach((b) => {
      const row = b.closest('.wf-row');
      const net = wifi.data && (wifi.data.networks || []).find((n) => n.ssid === row.dataset.ssid);
      b.onclick = (e) => { e.stopPropagation(); act(b.dataset.wf, net, row); };
    });
    const pw = $('.wf-pw', page);
    if (pw) {
      N.focusField(pw);
      pw.onkeydown = (e) => { if (e.key === 'Enter') act('pw', wifi.data.networks.find((n) => n.ssid === wifi.ask), pw.closest('.wf-row')); };
    }
    const stBtn = $('#stGo', page);
    if (stBtn) stBtn.onclick = async () => {
      const r = await api.svc('speedtest', run ? 'cancel' : 'start').catch(() => null);
      if (r) { speed = r; render(); }
    };
  }

  async function refresh() {
    await load(false);
    if (wifi.data && wifi.data.ok) await load(true);
  }

  function setView(v) {
    view = v;
    wifi.error = '';
    render();
    if (v === 'wifi') refresh();
    loadSpeed();
  }
  function loadSpeed() { api.svc('speedtest', 'get').then((s) => { if (s) { speed = s; render(); } }).catch(() => {}); }

  // ------------------------------------------------------------ 1×1 Bluetooth battery-bar card (matches modules.html)
  const cards = new Set();

  function paintCard(slot) {
    const { el } = slot;
    const btOn = !st.radios || st.radios.bluetooth !== 'off';
    const devs = devices();
    const conn = devs.filter((d) => d.connected);
    const primary = conn[0] || devs[0] || null;
    if (!btOn || !primary) {
      el.innerHTML = `${N.hd('bt', 'Bluetooth')}<div class="sub" style="margin-top:auto">${esc(!btOn ? _t('Bluetooth is off') : _t('No paired devices'))}</div>`;
      return;
    }
    // Up to 3 vertical battery bars: earbuds L/R/Case if available, else top 3 devices with battery
    let bars = [];
    if (primary.left != null || primary.right != null || primary.case != null) {
      if (primary.left != null) bars.push([_t('Left'), Math.round(primary.left)]);
      if (primary.right != null) bars.push([_t('Right'), Math.round(primary.right)]);
      if (primary.case != null) bars.push([_t('Case'), Math.round(primary.case)]);
    } else {
      bars = (conn.length ? conn : devs).slice(0, 3).map((d) => [d.name.split(/\s+/)[0].slice(0, 6), d.battery >= 0 ? Math.round(d.battery) : 100]);
    }
    el.innerHTML = `${N.hd(devSvgName(primary.kind), primary.name)}`
      + `<div style="display:grid;grid-template-columns:repeat(${Math.max(1, bars.length)},1fr);gap:6px;margin-top:auto;text-align:center">`
      + bars.map(([lbl, pct]) => `<div><div style="height:30px;width:12px;margin:0 auto;border-radius:4px;background:#24242c;position:relative;overflow:hidden"><i style="position:absolute;left:0;right:0;bottom:0;height:${pct}%;background:${N.meter(pct, true)}"></i></div><div class="n" style="font-size:10.5px;margin-top:3px">${pct}</div><div class="t1" style="font-size:9px;color:var(--mute)">${esc(lbl)}</div></div>`).join('')
      + `</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'bluetooth',
    tall: true,
    init(p) { page = p; },
    show() {
      render();
      loadSpeed();
      if (!N.MAC && !N.LINUX) api.helper({ cmd: 'bluetooth.refresh' });
      if (view === 'wifi') refresh();
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (view === 'wifi' && !wifi.joining && !wifi.ask && $('#page-bluetooth.active')) load(true); }, 20000);
    },
    hide() { clearInterval(this.timer); wifi.ask = null; wifi.error = ''; },
    update(devs) {
      if (devs) for (const d of devs) if (busy.has(d.id) && (busy.get(d.id) === 'connect') === !!d.connected) { busy.delete(d.id); N.cancel('bt-busy-' + d.id); }
      const radio = st.radios && st.radios.wifi;
      if (radio !== wifi.radio) { if (view === 'wifi' && radio === 'on' && wifi.radio) refresh(); wifi.radio = radio; }
      render();
      refreshCards();
    },
    showWifi() { setView('wifi'); },
    showDevices() { setView('bluetooth'); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('bluetooth'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
