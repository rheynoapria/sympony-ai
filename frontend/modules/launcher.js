// Launcher module: 2×1 6-icon grid card + 632×218 full app/folder launcher section.
(function () {
  const { api, $, $$, esc, fa } = N;
  let page;
  let items = [];
  let loaded = false;
  const cards = new Set();

  async function load() {
    loaded = true;
    const list = await api.svc('launcher', 'list').catch(() => []);
    if (Array.isArray(list)) items = list;
    renderSection();
    refreshCards();
  }

  function itemIcon(it, size) {
    if (it.iconUrl) {
      return `<img class="appic" src="${esc(it.iconUrl)}" style="width:${size}px;height:${size}px" alt="">`;
    }
    const guessed = N.realAppIcon ? N.realAppIcon(it.name || it.path, size, it.icon ? `<i class="${esc(it.icon)}"></i>` : fa('cube')) : '';
    return guessed || `<span class="appic-fb" style="width:${size}px;height:${size}px">${it.icon ? `<i class="${esc(it.icon)}"></i>` : fa('cube')}</span>`;
  }

  function paintCard(el) {
    const shown = items.slice(0, 6);
    el.style.justifyContent = 'center';
    if (!shown.length) {
      el.innerHTML = `${N.hd('rocket', _t('Launcher'))}`
        + `<div class="row" style="margin-top:auto;justify-content:space-between"><span class="sub">${esc(_t('Add your favourite apps'))}</span>`
        + `<button type="button" class="sbtn" data-ladd="file" style="height:26px;padding:0 10px">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('Add'))}</button></div>`;
    } else {
      el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;justify-items:center;width:100%">`
        + shown.map((a, i) => `<button type="button" data-launch="${i}" title="${esc(a.name)}" style="display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;max-width:100%;cursor:pointer">`
          + `${itemIcon(a, 38)}<span class="t1" style="font-size:10px;color:var(--dim);max-width:100%">${esc(a.name)}</span></button>`).join('')
        + `</div>`;
    }
    $$('[data-launch]', el).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        api.svc('launcher', 'open', +b.dataset.launch);
        N.closeNotch();
      };
    });
    const addBtn = $('[data-ladd]', el);
    if (addBtn) {
      addBtn.onclick = async (e) => {
        e.stopPropagation();
        const list = await api.svc('launcher', 'add', 'file').catch(() => null);
        if (Array.isArray(list)) { items = list; renderSection(); refreshCards(); }
      };
    }
  }

  function refreshCards() {
    for (const el of cards) {
      if (!el.isConnected) { cards.delete(el); continue; }
      paintCard(el);
    }
  }

  function renderSection() {
    if (!page) return;
    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%">`
      + `<div class="row" style="justify-content:space-between">`
      + `<span class="sub">${esc(_t('Click to open · right-click to remove'))}</span>`
      + `<div class="row" style="gap:6px">`
      + `<button type="button" class="sbtn" data-ladd="file" style="height:28px">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('Add app'))}</button>`
      + `<button type="button" class="sbtn" data-ladd="folder" style="height:28px">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('Add folder'))}</button>`
      + `</div></div>`
      + `<div class="c grow sc-y" style="padding:12px 14px">`
      + (items.length
        ? `<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px 6px;align-content:start">`
          + items.map((a, i) => `<button type="button" data-launch="${i}" title="${esc(a.path || a.name)}" style="display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;position:relative;padding:4px 2px;border-radius:10px;cursor:pointer">`
            + `${itemIcon(a, 38)}<span class="t1" style="font-size:10.5px;color:var(--dim);max-width:100%">${esc(a.name)}</span></button>`).join('')
          + `</div>`
        : `<div class="sub" style="margin:auto;text-align:center">${esc(_t('No apps yet. Add an app or folder to launch it from the notch.'))}</div>`)
      + `</div></div>`;

    $$('[data-ladd]', page).forEach((b) => {
      b.onclick = async () => {
        const list = await api.svc('launcher', 'add', b.dataset.ladd).catch(() => null);
        if (Array.isArray(list)) { items = list; renderSection(); refreshCards(); }
      };
    });
    $$('[data-launch]', page).forEach((b) => {
      b.onclick = () => {
        api.svc('launcher', 'open', +b.dataset.launch);
        N.closeNotch();
      };
      b.oncontextmenu = async (e) => {
        e.preventDefault();
        const list = await api.svc('launcher', 'remove', +b.dataset.launch).catch(() => null);
        if (Array.isArray(list)) { items = list; renderSection(); refreshCards(); }
      };
    });
  }

  N.register({
    id: 'launcher',
    init(p) { page = p; renderSection(); },
    show() { load(); },
    update() { load(); },
    card(el) {
      cards.add(el);
      N.cardClick(el, () => N.openModule('launcher'));
      paintCard(el);
      if (!loaded) load();
    },
    refreshCards() {
      if (!loaded) load();
      else refreshCards();
    },
  });
})();
