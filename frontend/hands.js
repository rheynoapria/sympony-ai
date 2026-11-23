// Pony's Hands overlay (hands.html): src-tauri/src/hands.rs sends one event, `hands`, with
// {do: 'show' | 'move' | 'tap' | 'point' | 'hide', x, y, kind, label, status (the app's name)}. Coordinates are this
// window's (points).
(function () {
  const $ = (id) => document.getElementById(id);
  const cur = $('cur');
  const label = $('label');
  const t = (s, v) => (typeof window._t === 'function' ? window._t(s, v) : s.replace(/\{(\w+)\}/g, (_, k) => (v && v[k]) || ''));
  const VERB = { click: 'Clicking {x}', double_click: 'Opening {x}', fill: 'Typing in {x}', choose: 'Choosing in {x}', slide: 'Sliding {x}', drag: 'Dragging {x}', scroll: 'Scrolling' };
  const words = (d) => (d.kind === 'point' || !VERB[d.kind] ? d.label || '' : t(VERB[d.kind], { x: d.label ? `“${d.label}”` : '' }).trim());
  let pony = null;
  let hideTimer = 0;

  function ensurePony(settings) {
    if (pony || !window.Pony) return;
    const s = settings || {};
    pony = window.Pony.mount($('pony'), { scale: 0.95, floorFrac: 0.92, hop: 0.3, shape: s.shape || 'Classic', color: s.color || 'Lavender', mood: 'working' });
  }

  function ring(x, y, cls) {
    const r = document.createElement('div');
    r.className = 'ring' + (cls ? ' ' + cls : '');
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), cls === 'point' ? 4000 : 800);
  }

  const handlers = {
    show(d) {
      clearTimeout(hideTimer);
      ensurePony(d);
      $('status-t').textContent = d.status ? t('Pony is using {app}', { app: d.status }) : t('Pony is using your screen');
      document.body.classList.add('on');
      if (pony) pony.setMood('working');
    },
    move(d) {
      cur.style.transform = `translate(${Math.round(d.x)}px, ${Math.round(d.y)}px)`;
      const w = words(d);
      label.textContent = w;
      label.classList.toggle('on', !!w);
    },
    tap(d) {
      ring(d.x, d.y);
      if (pony) pony.hop && pony.hop(0.5);
    },
    point(d) {
      handlers.move(d);
      setTimeout(() => ring(d.x, d.y, 'point'), 600);
      if (pony) pony.setMood('attention');
    },
    hide() {
      label.classList.remove('on');
      document.body.classList.remove('on');
      if (pony) pony.setMood('done');
    },
  };

  const T = window.__TAURI__;
  if (T && T.webviewWindow) {
    T.webviewWindow.getCurrentWebviewWindow().listen('hands', (e) => {
      const d = e.payload || {};
      const f = handlers[d.do];
      if (f) f(d);
    });
  }
})();
