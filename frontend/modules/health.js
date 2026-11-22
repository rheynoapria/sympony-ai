// Health: 1×1 triple-rings card + 632×218 3-tile section (Water, Movement/Eye Break, Guided Breathing).
(function () {
  const { api, $, $$, esc, fa } = N;
  let page;
  let guide = null; // { kind, step, started, timer }

  const RING = [['breaks', '#4ade80'], ['water', '#60a5fa'], ['mindful', '#c9b6ff']];
  N.healthRings = (h, size = 66) => {
    const today = (h && h.today) || { water: 0, breaks: 0, mindful: 0 };
    const goals = (h && h.goals) || { water: 8, breaks: 5, mindful: 5 };
    // Three concentric stroke-only rings: equal stroke-width (9), 3.5-unit gaps, empty center (r=18 inner edge at 13.5)
    const rings = [
      [Math.min(100, ((today.water || 0) / Math.max(1, goals.water || 8)) * 100), '#60a5fa', 43],
      [Math.min(100, ((today.breaks || 0) / Math.max(1, goals.breaks || 5)) * 100), '#4ade80', 30.5],
      [Math.min(100, ((today.mindful || 0) / Math.max(1, goals.mindful || 5)) * 100), '#c9b6ff', 18],
    ];
    const sw = 9;
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 100 100">${rings.map(([p, c, r]) => {
      const arc = p > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" pathLength="100" stroke-dasharray="${p.toFixed(1)} 100"/>` : '';
      return `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${c}" stroke-opacity="0.18" stroke-width="${sw}"/>${arc}`;
    }).join('')}</svg></div>`;
  };

  const STRETCHES = [
    [_t('Neck rolls'), _t('Slowly roll your head in a circle, 5 times each way.')],
    [_t('Shoulder shrugs'), _t('Lift your shoulders to your ears, hold 2 seconds, release. Repeat 10×.')],
    [_t('Chest opener'), _t('Clasp hands behind your back, straighten arms and lift gently.')],
    [_t('Seated twist'), _t('Sit tall, turn your upper body to the right, hold 15s. Then left.')],
    [_t('Wrist stretch'), _t('Arm forward, palm up, gently pull fingers back. Switch hands.')],
    [_t('Stand & walk'), _t('Stand up, walk around and get a glass of water 💧')],
  ];
  const BREATH = [[_t('Breathe in'), 4, 1.35], [_t('Hold'), 4, 1.35], [_t('Breathe out'), 6, 0.72], [_t('Hold'), 2, 0.72]];

  function nextBreakMins(h) {
    const iv = (N.st.settings && N.st.settings.healthBreakInterval) || 50;
    const last = (h && h.lastBreakAt) || Date.now();
    const left = Math.max(0, iv - Math.floor((Date.now() - last) / 60000));
    return left;
  }

  function render() {
    const h = N.data.health || {};
    const today = h.today || {};
    const goals = h.goals || {};
    if (!page) return;
    if (guide) return;
    const water = today.water || 0; const waterG = Math.max(1, goals.water || 8);
    const brk = today.breaks || 0; const brkG = Math.max(1, goals.breaks || 5);
    const waterPct = Math.min(100, (water / waterG) * 100);
    const brkLeft = nextBreakMins(h);

    page.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
      + `<div class="c">${N.hd('drop', _t('Water'), '', '#60a5fa')}`
      + `<div style="margin:6px auto 0">${N.ring(waterPct, '#60a5fa', 92, 9, `<div><b class="n" style="font-size:22px">${water}</b><span class="dim n">/${waterG}</span></div>`)}</div>`
      + `<div class="row" style="gap:6px;margin-top:auto"><button type="button" class="sbtn" data-w="-1" style="flex:1">−</button><button type="button" class="sbtn p" data-w="1" style="flex:2">${esc(_t('+ 1 glass'))}</button></div></div>`
      + `<div class="c">${N.hd('day', _t('Break'), '', '#4ade80')}`
      + `<div class="big" style="font-size:30px;margin-top:8px">${brkLeft}<span style="font-size:14px;color:var(--dim)"> ${esc(_t('min'))}</span></div>`
      + `<div class="sub">${esc(_t('until next break'))}</div>`
      + `<div class="row" style="gap:4px;margin-top:8px">${Array.from({ length: Math.min(8, brkG) }, (_, k) => `<i style="flex:1;height:5px;border-radius:3px;background:${k < brk ? '#4ade80' : '#24242c'}"></i>`).join('')}</div>`
      + `<div class="row" style="gap:6px;margin-top:auto"><button type="button" class="sbtn" data-g="stretch" style="flex:1;padding:0 8px">${esc(_t('Break now'))}</button><button type="button" class="sbtn" data-g="eye" title="${esc(_t('Eye break'))}" style="padding:0 9px">${fa('eye')}</button></div></div>`
      + `<div class="c">${N.hd('heart', _t('Calm'), '', '#c9b6ff')}`
      + `<div style="margin:8px auto 0;width:84px;height:84px;border-radius:50%;border:2px solid #c9b6ff55;display:grid;place-items:center"><div class="breathe" style="width:56px;height:56px;border-radius:50%;background:#c9b6ff"></div></div>`
      + `<div class="sub" style="text-align:center;margin-top:4px">${esc(_t('Breathe in…'))}</div>`
      + `<button type="button" class="sbtn p" data-g="breath" style="margin-top:auto">${esc(_t('Start 1 min'))}</button></div></div>`;

    $$('[data-w]', page).forEach((b) => { b.onclick = () => api.svc('health', 'water', +b.dataset.w); });
    $$('[data-g]', page).forEach((b) => { b.onclick = () => startGuide(b.dataset.g); });
  }

  function startGuide(kind) {
    if (kind === 'eye') { api.svc('health', 'eyeBreakNow'); return; }
    stopGuide();
    guide = { kind, step: 0, started: Date.now() };
    page.innerHTML = `<div class="c" style="flex-direction:row;align-items:center;gap:20px;padding:18px 22px;height:100%;width:100%">`
      + `<div style="width:120px;height:120px;border-radius:50%;border:2px solid ${kind === 'breath' ? '#c9b6ff55' : '#4ade8055'};display:grid;place-items:center;flex:none">`
      + (kind === 'breath' ? `<div class="orb" style="width:68px;height:68px;border-radius:50%;background:#c9b6ff;transition:transform 4s ease-in-out"></div>` : `<span style="font-size:40px;color:#4ade80">${fa('person-walking')}</span>`)
      + `</div>`
      + `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">`
      + `<b id="gTitle" style="font-size:20px"></b>`
      + `<div id="gStep" class="sub" style="font-size:13px"></div>`
      + `<div class="bar" style="height:6px;margin-top:4px"><i id="gBar" style="background:${kind === 'breath' ? '#c9b6ff' : '#4ade80'};transform:scaleX(0)"></i></div>`
      + `<div style="margin-top:auto"><button type="button" class="sbtn" id="gStop">${esc(_t('End'))}</button></div></div></div>`;
    $('#gStop', page).onclick = () => { stopGuide(); render(); };
    if (kind === 'breath') runBreath(); else runStretch();
  }

  function runBreath() {
    const total = 60000;
    let i = 0;
    const phase = () => {
      if (!guide) return;
      const elapsed = Date.now() - guide.started;
      if (elapsed >= total) { finish('mindful'); return; }
      const [label, secs, scale] = BREATH[i % BREATH.length];
      const tEl = $('#gTitle', page); if (tEl) tEl.textContent = label;
      const sEl = $('#gStep', page); if (sEl) sEl.textContent = _t('{n}s left · follow the circle', { n: Math.ceil((total - elapsed) / 1000) });
      const orb = $('.orb', page);
      if (orb) { orb.style.transitionDuration = secs + 's'; orb.style.transform = `scale(${scale})`; }
      const bEl = $('#gBar', page); if (bEl) bEl.style.transform = `scaleX(${Math.min(1, elapsed / total)})`;
      i++;
      guide.timer = setTimeout(phase, secs * 1000);
    };
    phase();
  }

  function runStretch() {
    const per = 20000;
    const step = () => {
      if (!guide) return;
      if (guide.step >= STRETCHES.length) { finish('break'); return; }
      const [t, d] = STRETCHES[guide.step];
      const tEl = $('#gTitle', page); if (tEl) tEl.textContent = `${guide.step + 1}. ${t}`;
      const sEl = $('#gStep', page); if (sEl) sEl.textContent = d;
      const bEl = $('#gBar', page); if (bEl) bEl.style.transform = `scaleX(${(guide.step + 1) / STRETCHES.length})`;
      guide.step++;
      guide.timer = setTimeout(step, per);
    };
    step();
  }

  function finish(kind) {
    stopGuide();
    if (kind === 'mindful') api.svc('health', 'mindful', 1); else api.svc('health', 'breakDone');
    N.chime('done');
    N.toast(fa('circle-check'), kind === 'mindful' ? _t('Nice — 1 mindful minute') : _t('Break logged. Well done!'), { color: '#30d158' });
    render();
  }

  function stopGuide() { if (guide && guide.timer) clearTimeout(guide.timer); guide = null; }

  // ------------------------------------------------------------ 1×1 Triple-ring Health Card
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('health', () => refreshCards());
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#f472b6');
    el.style.flexDirection = 'row';
    el.style.alignItems = 'center';
    el.style.gap = '10px';
    const h = N.data.health || { today: { water: 0, breaks: 0, mindful: 0 }, goals: { water: 8, breaks: 5, mindful: 5 } };
    const t = h.today || {}; const g = h.goals || {};
    const rows = [
      ['#60a5fa', `${t.water || 0}/${g.water || 8}`],
      ['#4ade80', `${t.breaks || 0}/${g.breaks || 5}`],
      ['#c9b6ff', `${t.mindful || 0}m`],
    ];
    el.innerHTML = `${N.healthRings(h, 66)}`
      + `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px">`
      + rows.map(([col, val]) => `<span class="row" style="gap:5px"><i style="width:6px;height:6px;border-radius:3px;background:${col};flex:none"></i><b class="n" style="font-size:11.5px">${esc(val)}</b></span>`).join('')
      + `</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'health',
    tall: true,
    init(p) { page = p; N.watch('health', render); },
    show() { render(); },
    hide() {},
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('health'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
