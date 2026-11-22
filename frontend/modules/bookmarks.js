// Bookmarks: links kept in Sympony, in categories of your own. Paste one (or take the one on the clipboard), or ask
// AI Chat. Main fetches each link's title and the site's own icon once
// (bookmarks.rs); a click opens it in the default browser. Kept in bookmarks.json:
// { items: [{ id, url, title, cat, icon, added, auto (the title is still the site's name), metaAt }], cats: [names] }
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let filter = '';        // the chip picked: '' all, NONE the ones without a category, else a category
  let query = '';
  let newCat = null;      // the category new links go to (null: the chip picked)
  let editing = null;     // id of the link in the editor, or null
  let editCat = '';
  let renaming = null;    // the category whose chip is being renamed
  let clip = null;        // a link on the clipboard that isn't saved yet
  // (not NUL: the page's HTML would turn that into another character)
  const NONE = '\u0001'; // the Unsorted chip
  const NEW = '\u0002';  // "New category…" in the pickers
  const fetching = new Set();

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const data = () => N.data.bookmarks || { items: [], cats: [] };
  const items = () => data().items || [];
  const cats = () => data().cats || [];
  const save = (v) => N.saveStore('bookmarks', { items: v.items, cats: v.cats });
  const key = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };

  // The link as typed or copied, made whole (like bookmarks.rs link_of): "https://…" as it is, "www.site.com" and,
  // when `bare`, "site.com/page" get https://. Anything else is null.
  function normalize(text, bare) {
    const t = String(text || '').trim().replace(/^<|>$/g, '');
    if (!t || t.length > 2048 || /\s/.test(t)) return null;
    if (/^https?:\/\//i.test(t)) { try { const u = new URL(t); return u.hostname ? t : null; } catch (e) { return null; } }
    if (!(/^www\./i.test(t) || bare)) return null;
    const name = t.split(/[/?#]/)[0].split(':')[0];
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(name) ? 'https://' + t : null;
  }

  // the list as saved (read once if it isn't loaded yet, so AI Chat never saves over it)
  async function loaded() {
    if (N.data.bookmarks) return;
    const v = await api.svc('store', 'get', 'bookmarks').catch(() => null);
    N.setData('bookmarks', v && Array.isArray(v.items) ? v : { items: [], cats: [] });
  }

  // Save a link: { ok, item, existed } (ok false: not a web address). Its title and icon come a moment later.
  // Without `cat`, it goes where the page would put a pasted one.
  async function add(text, cat) {
    await loaded();
    const url = normalize(text, true);
    if (!url) return { ok: false };
    const same = items().find((b) => key(b.url) === key(url));
    if (same) return { ok: true, item: same, existed: true };
    const c = String(cat === undefined ? targetCat() : cat || '').trim().slice(0, 40);
    const item = { id: uid(), url, title: host(url), cat: c, icon: null, added: Date.now(), auto: true };
    const cs = c && !cats().some((x) => x.toLowerCase() === c.toLowerCase()) ? [...cats(), c] : cats();
    // an existing category keeps its own spelling
    item.cat = cs.find((x) => x.toLowerCase() === c.toLowerCase()) || '';
    save({ items: [item, ...items()], cats: cs });
    fetchMeta(item.id);
    return { ok: true, item };
  }

  function remove(id) { save({ items: items().filter((b) => b.id !== id), cats: cats() }); }
  function update(id, fn) { save({ items: items().map((b) => (b.id === id ? fn({ ...b }) : b)), cats: cats() }); }

  // the page's title (unless it was given one) and the site's icon, asked once per link
  async function fetchMeta(id) {
    const b = items().find((x) => x.id === id);
    if (!b || fetching.has(id)) return;
    fetching.add(id);
    const m = await api.svc('bookmarks', 'meta', b.url).catch(() => null);
    fetching.delete(id);
    if (!items().some((x) => x.id === id)) return;
    update(id, (x) => {
      x.metaAt = Date.now();
      if (m && m.icon) x.icon = m.icon;
      // the page's own title; without one, the site's name stays
      if (m && x.auto && m.found && m.title) { x.title = m.title; delete x.auto; }
      return x;
    });
  }

  N.bookmarks = { add, remove, normalize, cats, items, host };

  // ------------------------------------------------------------------ the list
  const visible = () => {
    const q = query.toLowerCase();
    return items().filter((b) => (filter === '' || (filter === NONE ? !b.cat : b.cat === filter))
      && (!q || [b.title, b.url, b.cat].some((s) => String(s || '').toLowerCase().includes(q))));
  };
  const iconOf = (b) => (b.icon ? `<img src="${esc(b.icon)}" alt="">` : fa('globe'));

  function bmIcon(b, size) {
    if (b.icon) return `<img class="appic" src="${esc(b.icon)}" style="width:${size}px;height:${size}px;background:#fff" alt="">`;
    return N.realAppIcon ? N.realAppIcon(host(b.url), size, fa('globe')) : `<span class="appic-fb" style="width:${size}px;height:${size}px">${fa('globe')}</span>`;
  }

  function renderList() {
    const el = $('#bmList', page);
    if (!el) return;
    const list = visible();
    if (!list.length) {
      el.innerHTML = `<div class="sub" style="margin:auto;text-align:center;padding:12px">${esc(items().length ? (query ? _t('No bookmarks match') : _t('Nothing in this category yet')) : _t('Paste a link above to save it'))}</div>`;
      return;
    }
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px 6px;align-content:start">`
      + list.map((b) => `<button type="button" class="bm-tile" data-id="${esc(b.id)}" title="${esc(b.title || host(b.url))}&#10;${esc(b.url)}" style="display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;padding:4px 2px;border-radius:10px;cursor:pointer">`
        + `${bmIcon(b, 32)}<span class="t1" style="font-size:10.5px;color:var(--dim);max-width:100%">${esc(b.title || host(b.url))}</span></button>`).join('')
      + `</div>`;
    $$('.bm-tile', el).forEach((row) => {
      const b = items().find((x) => x.id === row.dataset.id);
      row.onclick = (e) => open(b, e.ctrlKey);
      row.onauxclick = (e) => { if (e.button === 1) open(b, true); };
      row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(e, b); };
    });
  }
  // a broken icon: the globe instead (error events don't bubble, so caught on the way down)
  function onIconError(e) { if (e.target.tagName === 'IMG' && e.target.closest('.bm-ico')) e.target.outerHTML = fa('globe'); }

  function open(b, keepOpen) {
    if (!b) return;
    api.openExternal(b.url);
    if (!keepOpen) N.closeNotch();
  }
  function act(what, b) {
    if (!b) return;
    if (what === 'edit') openEditor(b.id);
    else if (what === 'copy') { navigator.clipboard.writeText(b.url).then(() => N.toast(fa('copy', 'regular'), _t('Link copied')), () => N.toast(fa('copy', 'regular'), _t('Couldn’t copy the link'))); }
    else if (what === 'del') {
      remove(b.id);
      N.toast(fa('trash-can', 'regular'), _t('Bookmark deleted'), { sub: host(b.url), ms: 2500, side: 150 });
    }
  }

  // ------------------------------------------------------------------ the right-click menu (Sympony's own, like the Shelf's)
  function menu(e, entries) {
    const m = $('#ctxMenu');
    m.innerHTML = entries.map(([ic, label, , cls], i) => (ic === '-' ? `<div class="bm-note">${esc(label)}</div>` : `<button data-i="${i}" class="${cls || ''}">${fa(ic)}${esc(label)}</button>`)).join('');
    $$('button', m).forEach((btn) => {
      btn.onclick = () => {
        const keep = entries[+btn.dataset.i][2]();
        if (keep !== true) { m.classList.remove('show'); st.ctxOpen = false; }
      };
    });
    const nb = $('#notch').getBoundingClientRect();
    m.classList.add('show');
    m.style.left = Math.max(6, Math.min(e.clientX - nb.left, nb.width - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(6, Math.min(e.clientY - nb.top, nb.height - m.offsetHeight - 6)) + 'px';
    st.ctxOpen = true;
  }
  function rowMenu(e, b) {
    if (!b) return;
    const moves = [['', _t('No category')], ...cats().map((c) => [c, c])].filter(([c]) => c !== (b.cat || '')).slice(0, 6)
      .map(([c, l]) => ['folder', c ? _t('Move to {name}', { name: l }) : _t('Move out of its category'), () => update(b.id, (x) => { x.cat = c; return x; })]);
    menu(e, [
      ['up-right-from-square', _t('Open'), () => open(b)],
      ['pen', _t('Edit…'), () => act('edit', b)],
      ['copy', _t('Copy link'), () => act('copy', b)],
      ...moves,
      ['trash-can', _t('Delete'), () => act('del', b), 'danger'],
    ]);
  }
  function catMenu(e, c) {
    const n = items().filter((b) => b.cat === c).length;
    menu(e, [
      ['pen', _t('Rename…'), () => { renaming = c; renderChips(); }],
      ['trash-can', _t('Delete category…'), () => {
        menu(e, [
          ['-', n ? (n === 1 ? _t('Its {n} link stays, without a category', { n }) : _t('Its {n} links stay, without a category', { n })) : _t('It has no links')],
          ['trash-can', _t('Delete “{name}”', { name: c }), () => deleteCat(c), 'danger'],
          ['xmark', _t('Cancel'), () => {}],
        ]);
        return true;
      }, 'danger'],
    ]);
  }

  // ------------------------------------------------------------------ categories
  function renameCat(from, to) {
    to = String(to || '').trim().slice(0, 40);
    renaming = null;
    if (!to || to === from) { renderChips(); return; }
    // the name of another category: the two become one
    const other = cats().find((c) => c !== from && c.toLowerCase() === to.toLowerCase());
    const name = other || to;
    save({
      items: items().map((b) => (b.cat === from ? { ...b, cat: name } : b)),
      cats: other ? cats().filter((c) => c !== from) : cats().map((c) => (c === from ? name : c)),
    });
    if (filter === from) filter = name;
    if (newCat === from) newCat = name;
  }
  function deleteCat(c) {
    save({ items: items().map((b) => (b.cat === c ? { ...b, cat: '' } : b)), cats: cats().filter((x) => x !== c) });
    if (filter === c) filter = '';
    if (newCat === c) newCat = null;
  }
  function addCat(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) return '';
    const have = cats().find((c) => c.toLowerCase() === n.toLowerCase());
    if (have) return have;
    save({ items: items(), cats: [...cats(), n] });
    return n;
  }

  // The chips: All, each category with its count, Unsorted. A chip being renamed (`renaming`: its name) or the
  // new one after + (`renaming` ''), is a field instead; what's typed there survives the list changing meanwhile.
  function renderChips() {
    const el = $('#bmChips', page);
    if (!el) return;
    const old = $('.bm-ren', el);
    const typed = old ? { v: old.value, focus: document.activeElement === old } : null;
    const all = items();
    const loose = all.filter((b) => !b.cat).length;
    const chips = [['', _t('All'), all.length], ...cats().map((c) => [c, c, all.filter((b) => b.cat === c).length])];
    if (cats().length && loose) chips.push([NONE, _t('Unsorted'), loose]);
    if (filter && !chips.some(([v]) => v === filter)) filter = '';
    const field = (v, ph) => `<input class="bm-ren" value="${esc(v)}" placeholder="${ph}" maxlength="40" spellcheck="false">`;
    el.innerHTML = chips.map(([v, l, n]) => (renaming && v === renaming
      ? field(typed ? typed.v : l, _t('Category name'))
      : `<button class="bm-chip ${v === filter ? 'on' : ''}" data-v="${esc(v)}" title="${v && v !== NONE ? _t('Right-click to rename or delete') : ''}">${esc(l)}<i>${n}</i></button>`)).join('')
      + (renaming === '' ? field(typed ? typed.v : '', _t('New category')) : `<button class="bm-chip add" id="bmNewCatChip" title="${_t('New category')}">${fa('plus')}</button>`);
    $$('.bm-chip[data-v]', el).forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => { filter = v; renderChips(); renderList(); paintCat(); };
      if (v && v !== NONE) b.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); catMenu(e, v); };
    });
    const plus = $('#bmNewCatChip', el);
    if (plus) plus.onclick = () => { renaming = ''; renderChips(); };
    const ren = $('.bm-ren', el);
    if (ren) {
      if (!typed || typed.focus) { N.focusField(ren); if (!typed) setTimeout(() => ren.select(), 40); }
      const done = (ok) => {
        if (renaming === null) return;
        const from = renaming;
        if (from === '') {
          renaming = null;
          const n = ok ? addCat(ren.value) : '';
          if (n) { filter = n; newCat = null; }
          renderChips(); renderList(); paintCat();
        } else if (ok) renameCat(from, ren.value);
        else { renaming = null; renderChips(); }
      };
      ren.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      // (not when the chips were drawn again: the new field carries on)
      ren.onblur = () => setTimeout(() => { if (ren.isConnected) done(true); }, 0);
    }
    // the chip picked (or the field) in view, when there are more than fit
    const on = ren || $('.bm-chip.on', el);
    if (on) {
      const l = on.offsetLeft; const r = l + on.offsetWidth; // (.bm-chips is positioned, so relative to it)
      if (l < el.scrollLeft) el.scrollLeft = l - 8; else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
    }
  }

  // ------------------------------------------------------------------ adding
  // where new links go: the category picked here, else the chip picked
  const targetCat = () => (newCat !== null ? newCat : filter && filter !== NONE ? filter : '');
  function catOptions(extra) {
    return [['', _t('No category')], ...cats().map((c) => [c, c]), ...(extra ? [[NEW, _t('New category…')]] : [])];
  }
  function paintCat() {
    const b = $('#bmCat', page);
    if (!b) return;
    N.pick(b, {
      options: catOptions(true), value: targetCat(), icon: fa('folder', 'regular'),
      onChange: (v) => {
        if (v === NEW) { $('#bmCatNew', page).hidden = false; b.hidden = true; N.focusField($('#bmCatNew', page)); return; }
        newCat = v; paintCat();
      },
    });
    b.title = _t('Category for new links');
  }

  async function addTyped() {
    const input = $('#bmUrl', page);
    const r = await add(input.value, targetCat());
    if (!r.ok) { input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); return; }
    input.value = '';
    if (r.existed) N.toast(fa('bookmark'), _t('Already saved'), { sub: host(r.item.url), ms: 2200, side: 130 });
    paintClip();
  }

  // the clipboard holds a link that isn't saved: offer it
  async function checkClip() {
    const u = await api.svc('bookmarks', 'clipboard').catch(() => null);
    clip = typeof u === 'string' && u && !items().some((b) => key(b.url) === key(u)) ? u : null;
    paintClip();
  }
  function paintClip() {
    const b = $('#bmClip', page);
    if (!b) return;
    const show = !!clip && !items().some((x) => key(x.url) === key(clip));
    b.hidden = !show;
    if (show) { $('span', b).textContent = host(clip); b.title = _t('Save the link on the clipboard: {url}', { url: clip }); }
  }

  // ------------------------------------------------------------------ the editor
  function openEditor(id) {
    const b = items().find((x) => x.id === id);
    if (!b) return;
    editing = id;
    editCat = b.cat || '';
    const ed = $('#bmEdit', page);
    $('.bm-e-title', ed).value = b.title || '';
    $('.bm-e-url', ed).value = b.url;
    $('#bmECatNew', ed).hidden = true;
    paintEditCat();
    ed.hidden = false;
    N.focusField($('.bm-e-title', ed));
  }
  function paintEditCat() {
    const b = $('#bmECat', page);
    b.hidden = false;
    N.pick(b, {
      options: catOptions(true), value: editCat, icon: fa('folder', 'regular'),
      onChange: (v) => {
        if (v === NEW) { const f = $('#bmECatNew', page); f.hidden = false; f.value = ''; b.hidden = true; N.focusField(f); return; }
        editCat = v; paintEditCat();
      },
    });
  }
  function closeEditor() { editing = null; const ed = $('#bmEdit', page); if (ed) ed.hidden = true; }
  function saveEditor() {
    const ed = $('#bmEdit', page);
    const b = items().find((x) => x.id === editing);
    if (!b) { closeEditor(); return; }
    const url = normalize($('.bm-e-url', ed).value, true);
    if (!url) { const f = $('.bm-e-url', ed); f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad'); return; }
    const nf = $('#bmECatNew', ed);
    const cat = !nf.hidden && nf.value.trim() ? addCat(nf.value) : editCat;
    const title = $('.bm-e-title', ed).value.trim();
    const moved = key(url) !== key(b.url);
    update(b.id, (x) => {
      x.url = url; x.cat = cat;
      if (title && title !== x.title) { x.title = title; delete x.auto; }
      if (!title) { x.title = host(url); x.auto = true; }
      // another address: its icon (and title, if it wasn't given one) are fetched again
      if (moved) { x.icon = null; delete x.metaAt; }
      return x;
    });
    closeEditor();
    if (moved) fetchMeta(b.id);
  }

  // ------------------------------------------------------------------ the page (632×218)
  function build() {
    page.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;height:100%;width:100%;position:relative">`
      + `<div class="row" style="gap:6px;flex:none">`
      + `<div class="sinp" style="flex:1;height:30px">${N.ic('star', 'width:12px;height:12px;color:var(--mute)')}<input type="text" id="bmUrl" placeholder="${esc(_t('Search or paste a link to save…'))}" spellcheck="false" maxlength="2048"></div>`
      + `<button type="button" class="sbtn" id="bmCat" style="height:30px;padding:0 10px" hidden></button>`
      + `<input class="field bm-newcat" id="bmCatNew" placeholder="${esc(_t('New category'))}" maxlength="40" spellcheck="false" hidden>`
      + `<button type="button" class="sbtn" id="bmClip" style="height:30px" hidden>${fa('paste')}<span></span></button>`
      + `<button type="button" class="sbtn" id="bmSave" style="height:30px">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('Add'))}</button>`
      + `</div>`
      + `<div class="bm-chips sc-x row" id="bmChips" style="gap:4px;flex:none;display:none"></div>`
      + `<div class="c grow sc-y" id="bmList" style="padding:12px 14px"></div>`
      + `<div class="bm-edit" id="bmEdit" hidden style="position:absolute;inset:0;background:var(--tile);border-radius:20px;padding:12px 14px;z-index:4">`
      + `<input class="field bm-e-title" placeholder="${esc(_t('Title (empty: the page’s own)'))}" maxlength="200" spellcheck="false">`
      + `<input class="field bm-e-url" placeholder="https://…" maxlength="2048" spellcheck="false">`
      + `<div class="row" style="gap:6px;margin-top:auto"><button type="button" class="sbtn" id="bmECat"></button><input class="field bm-newcat" id="bmECatNew" placeholder="${esc(_t('New category'))}" maxlength="40" spellcheck="false" hidden>`
      + `<button type="button" class="sbtn bm-e-del">${esc(_t('Delete'))}</button><span class="grow"></span>`
      + `<button type="button" class="sbtn bm-e-cancel">${esc(_t('Cancel'))}</button><button type="button" class="sbtn p bm-e-save">${esc(_t('Save'))}</button></div></div></div>`;
    const input = $('#bmUrl', page);
    input.oninput = () => {
      const v = input.value.trim();
      if (!normalize(v, true)) { query = v; renderList(); }
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') { query = ''; addTyped(); } };
    input.addEventListener('animationend', () => input.classList.remove('bad'));
    $('#bmSave', page).onclick = () => { query = ''; addTyped(); };
    $('#bmClip', page).onclick = async () => {
      if (!clip) return;
      const r = await add(clip, targetCat());
      clip = null; paintClip();
      if (r.ok && r.existed) N.toast(fa('bookmark'), _t('Already saved'), { sub: host(r.item.url), ms: 2200, side: 130 });
    };
    const nc = $('#bmCatNew', page);
    const ncDone = (ok) => {
      if (nc.hidden) return;
      const n = ok ? addCat(nc.value) : '';
      if (n) newCat = n;
      nc.hidden = true; nc.value = '';
      paintCat();
    };
    nc.onkeydown = (e) => { if (e.key === 'Enter') ncDone(true); if (e.key === 'Escape') { e.stopPropagation(); ncDone(false); } };
    nc.onblur = () => ncDone(true);
    const ed = $('#bmEdit', page);
    $('.bm-e-save', ed).onclick = saveEditor;
    $('.bm-e-cancel', ed).onclick = closeEditor;
    $('.bm-e-del', ed).onclick = () => { const b = items().find((x) => x.id === editing); closeEditor(); act('del', b); };
    $$('.bm-e-title, .bm-e-url, #bmECatNew', ed).forEach((f) => {
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEditor(); if (e.key === 'Escape') { e.stopPropagation(); closeEditor(); } });
      f.addEventListener('animationend', () => f.classList.remove('bad'));
    });
    page.addEventListener('mousedown', (e) => { if (editing && !e.target.closest('.bm-edit, .pick-menu')) closeEditor(); });
    page.addEventListener('error', onIconError, true);
  }

  function paint() {
    if (!page || !page.firstChild) return;
    const ch = $('#bmChips', page);
    if (ch) ch.style.display = cats().length ? 'flex' : 'none';
    renderChips();
    renderList();
    paintCat();
    paintClip();
    if (editing && !items().some((b) => b.id === editing)) closeEditor();
  }

  // ------------------------------------------------------------ 1×1 Bookmarks 4×2 icon grid card (matches modules.html)
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('bookmarks', () => refreshCards());
    loaded().then(refreshCards);
  }

  function paintCard(slot) {
    const { el } = slot;
    const list = items().slice(0, 8);
    el.innerHTML = `${N.hd('star', _t('Bookmarks'))}`
      + (list.length
        ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:auto;justify-items:center">${list.map((b) => `<button type="button" data-bmurl="${esc(b.url)}" title="${esc(b.title || host(b.url))}" style="cursor:pointer">${bmIcon(b, 24)}</button>`).join('')}</div>`
        : `<div class="sub" style="margin-top:auto">${esc(_t('No bookmarks yet'))}</div>`);
    $$('[data-bmurl]', el).forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); api.openExternal(b.dataset.bmurl); N.closeNotch(); };
    });
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'bookmarks',
    tall: true,
    init(p) {
      page = p;
      build();
      N.watch('bookmarks', paint);
      loaded().then(paint);
    },
    show() {
      paint();
      checkClip();
      // links saved while the title fetch couldn't finish (Sympony closed, offline): asked once more
      items().filter((b) => !b.metaAt).slice(0, 5).forEach((b) => fetchMeta(b.id));
    },
    hide() { closeEditor(); if (renaming !== null) { renaming = null; renderChips(); } },
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('bookmarks'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
