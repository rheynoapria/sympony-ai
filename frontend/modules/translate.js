// Translate: 2×1 card (language pills + last phrase) + 632×218 2-pane translation section.
(function () {
  const { api, st, $, esc, fa } = N;
  let page;
  let lastSrc = '';
  let lastOut = '';
  const LANGS = ['English', 'Indonesian', 'Javanese', 'Sundanese', 'Malay', 'Arabic', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Thai', 'Vietnamese', 'Hindi', 'French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Russian', 'Turkish'];
  const LANG_LABEL = {
    English: _t('English'), Indonesian: _t('Indonesian'), Javanese: _t('Javanese'), Sundanese: _t('Sundanese'), Malay: _t('Malay'),
    Arabic: _t('Arabic'), 'Chinese (Simplified)': _t('Chinese (Simplified)'), Japanese: _t('Japanese'), Korean: _t('Korean'), Thai: _t('Thai'),
    Vietnamese: _t('Vietnamese'), Hindi: _t('Hindi'), French: _t('French'), German: _t('German'), Spanish: _t('Spanish'),
    Portuguese: _t('Portuguese'), Italian: _t('Italian'), Dutch: _t('Dutch'), Russian: _t('Russian'), Turkish: _t('Turkish'),
  };
  const FLAGS = { English: '🇬🇧', Indonesian: '🇮🇩', Malay: '🇲🇾', Arabic: '🇸🇦', 'Chinese (Simplified)': '🇨🇳', Japanese: '🇯🇵', Korean: '🇰🇷', Thai: '🇹🇭', Vietnamese: '🇻🇳', Hindi: '🇮🇳', French: '🇫🇷', German: '🇩🇪', Spanish: '🇪🇸', Portuguese: '🇵🇹', Italian: '🇮🇹', Dutch: '🇳🇱', Russian: '🇷🇺', Turkish: '🇹🇷' };
  const flagOf = (k) => (FLAGS[k] ? `${FLAGS[k]} ` : '');
  const options = (withAuto) => (withAuto ? [['auto', _t('Detect language')]] : []).concat(LANGS.map((l) => [l, LANG_LABEL[l] || l]));

  async function run() {
    const inp = $('#trIn', page);
    const out = $('#trOut', page);
    const text = inp ? inp.value : '';
    if (!text.trim()) { out.style.color = 'var(--mute)'; out.textContent = _t('Translation appears here'); return; }
    lastSrc = text.trim();
    out.style.color = 'var(--dim)';
    out.textContent = _t('Translating…');
    const r = await api.svc('translate', 'translate', text, st.settings.translateFrom || 'auto', st.settings.translateTo || 'English');
    if (r && r.ok) {
      lastOut = r.text;
      out.style.color = '#fff';
      out.textContent = r.text;
      refreshCards();
    } else {
      out.style.color = '#f87171';
      out.textContent = (r && r.error) || _t('Couldn’t translate');
    }
  }

  function providerLabel() {
    const a = N.aiAgent('translateAgent');
    if (a === undefined) { N.loadAgents().then(() => { const l = $('#trProv', page); if (l) l.textContent = providerLabel(); }); return '…'; }
    return a ? N.aiLabel(a) : _t('No AI agent on this Mac');
  }

  const cards = new Set();

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#8fa2ff');
    const s = st.settings || {};
    const fromKey = s.translateFrom || 'auto';
    const toKey = s.translateTo || 'English';
    const fromLbl = fromKey !== 'auto' ? `${flagOf(fromKey)}${LANG_LABEL[fromKey] || fromKey}` : _t('Detect language');
    const toLbl = `${flagOf(toKey)}${LANG_LABEL[toKey] || toKey}`;
    el.innerHTML = `<div class="row" style="gap:6px"><span class="pill" style="background:#1d1d24;color:#fff">${esc(fromLbl)}</span>${N.ic('next', 'width:10px;height:10px;color:var(--mute)')}<span class="pill" style="background:#8fa2ff26;color:#8fa2ff">${esc(toLbl)}</span></div>`
      + `<div class="t1" style="font-size:12.5px;margin-top:8px;color:var(--dim)">${esc(lastSrc || _t('Type or paste text to translate'))}</div>`
      + `<div class="t1" style="font-size:16px;font-weight:700;margin-top:auto">${esc(lastOut || `${fromLbl} → ${toLbl}`)}</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'translate',
    tall: true,
    init(p) {
      page = p;
      page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%">`
        + `<div class="row" style="gap:8px;flex:none">`
        + `<button type="button" class="pill" id="trFrom" style="height:28px;padding:0 12px;background:var(--pill-hi);color:#fff;cursor:pointer"></button>`
        + `<button type="button" class="mini-btn" id="trSwap" style="width:28px;height:28px" title="${esc(_t('Swap'))}">${N.ic('lang', 'width:12px;height:12px')}</button>`
        + `<button type="button" class="pill" id="trTo" style="height:28px;padding:0 12px;background:var(--pill-hi);color:#fff;cursor:pointer"></button>`
        + `<span class="sub t1" id="trProv" style="margin-inline-start:auto"></span>`
        + `<button type="button" class="sbtn p" id="trGo" style="height:28px">${esc(_t('Translate'))}</button></div>`
        + `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;flex:1;min-height:0">`
        + `<div class="c" style="padding:12px 14px"><textarea id="trIn" spellcheck="false" maxlength="2000" placeholder="${esc(_t('Type or paste text… (Ctrl+Enter to translate)'))}" class="sc-y" style="font-size:14.5px;line-height:1.45;background:none;border:0;outline:none;resize:none;flex:1;color:#fff;width:100%"></textarea>`
        + `<div class="sub" id="trCount" style="font-size:10.5px;margin-top:4px">0 / 2000</div></div>`
        + `<div class="c" style="padding:12px 14px"><div id="trOut" class="sc-y" style="font-size:14.5px;line-height:1.45;font-weight:600;flex:1;color:var(--mute)">${esc(_t('Translation appears here'))}</div>`
        + `<div class="row" style="gap:6px;justify-content:flex-end;margin-top:6px"><button type="button" class="sbtn" id="trCopy" style="height:26px">${esc(_t('Copy'))}</button></div></div>`
        + `</div></div>`;
      const inp = $('#trIn', page);
      inp.addEventListener('input', () => { $('#trCount', page).textContent = `${inp.value.length} / 2000`; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
      $('#trGo', page).onclick = run;
      $('#trSwap', page).onclick = () => {
        const f = st.settings.translateFrom || 'auto'; const t = st.settings.translateTo || 'English';
        if (f === 'auto') return;
        api.setSettings({ translateFrom: t, translateTo: f });
        if (lastOut) { inp.value = lastOut; $('#trCount', page).textContent = `${inp.value.length} / 2000`; }
      };
      $('#trCopy', page).onclick = () => {
        if (lastOut) { navigator.clipboard.writeText(lastOut); N.toast(fa('copy', 'regular'), _t('Copied')); }
      };
      this.onSettings(st.settings);
    },
    onSettings(s) {
      refreshCards();
      if (!page) return;
      N.pick($('#trFrom', page), { options: options(true), value: s.translateFrom || 'auto', onChange: (v) => api.setSettings({ translateFrom: v }) });
      N.pick($('#trTo', page), { options: options(false), value: s.translateTo || 'English', onChange: (v) => api.setSettings({ translateTo: v }) });
      $('#trProv', page).textContent = providerLabel();
    },
    show() { if (page) $('#trProv', page).textContent = providerLabel(); },
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => {
        N.openModule('translate');
        const inp = $('#trIn');
        if (inp) N.focusField(inp);
      });
      paintCard(slot);
    },
    refreshCards,
  });
})();
