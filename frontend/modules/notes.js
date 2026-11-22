// Notes: a scratchpad in the notch. First line is the title. Saved as you type.
// Cards (the switch on top): each note is a deck, its lines written "question :: answer" are the cards. The New card
// form writes those lines for you, and Tab after a question in a note types the " :: ".
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  let current = null;
  let saveTimer;
  let mode = 'notes'; // 'notes' | 'cards'

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const notes = () => ((N.data.notes || {}).notes || []);
  const titleOf = (n) => (n.body || '').split('\n').find((l) => l.trim()) || _t('New note');
  const previewOf = (n) => (n.body || '').split('\n').filter((l) => l.trim()).slice(1).join(' ') || _t('No additional text');

  function save(list) { N.saveStore('notes', { notes: list }); }

  let searchQ = '';

  function renderList() {
    const q = searchQ.toLowerCase();
    const list = notes().slice().sort((a, b) => b.updated - a.updated)
      .filter((n) => !q || (n.body || '').toLowerCase().includes(q));
    $('.items', page).innerHTML = list.map((n) => {
      const ts = n.updated || n.updatedAt;
      const when = ts ? new Date(ts).toLocaleDateString(_tLocale(), { day: 'numeric', month: 'short' }) : '';
      return `<div class="nrow${n.id === current ? ' on' : ''}" data-id="${esc(n.id)}"><b class="t1">${esc(titleOf(n))}</b><span class="t1">${esc(when)} · ${esc(previewOf(n))}</span></div>`;
    }).join('') || `<div class="sub" style="margin:auto;text-align:center;padding:8px">${esc(_t('No notes yet'))}</div>`;
    $$('.items .nrow', page).forEach((el) => { el.onclick = () => select(el.dataset.id); });
  }

  function select(id) {
    flush();
    current = id;
    const n = notes().find((x) => x.id === id);
    const titleInp = $('#noteTitle', page);
    const ta = $('textarea', page);
    const lines = (n && n.body ? n.body : '').split('\n');
    if (titleInp) titleInp.value = lines[0] || '';
    ta.value = lines.slice(1).join('\n');
    const words = (n && n.body ? n.body : '').trim().split(/\s+/).filter(Boolean).length;
    const ts = n && (n.updated || n.updatedAt);
    const when = ts ? new Date(ts).toLocaleTimeString(_tLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
    $('.foot .when', page).textContent = n ? `${_t('Auto-saved')} · ${when}` : '';
    const wc = $('.foot .wc', page);
    if (wc) wc.textContent = words === 1 ? _t('{n} word', { n: 1 }) : _t('{n} words', { n: words });
    renderList();
  }

  function composeBody() {
    const t = ($('#noteTitle', page) || {}).value || '';
    const b = ($('textarea', page) || {}).value || '';
    return b ? `${t}\n${b}` : t;
  }

  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    const body = composeBody();
    save(notes().map((n) => (n.id === current ? { ...n, body, updated: Date.now() } : n)));
  }

  function newNote() {
    flush();
    const n = { id: uid(), body: '', updated: Date.now() };
    save([n, ...notes()]);
    current = n.id;
    select(n.id);
    N.focusField($('#noteTitle', page) || $('textarea', page));
  }

  // Tab on a line with text that isn't a card yet types " :: " at the caret, so the answer follows (undo takes it
  // back); on any other line, with a selection, or with Shift, Tab does what it always did.
  function tabToCard(e) {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const ta = e.target; const v = ta.value; const at = ta.selectionStart;
    if (at !== ta.selectionEnd) return;
    const start = v.lastIndexOf('\n', at - 1) + 1; let end = v.indexOf('\n', at); if (end < 0) end = v.length;
    const line = v.slice(start, end);
    if (!line.trim() || /(^|\s)::(\s|$)/.test(line)) return;
    e.preventDefault();
    const before = v.slice(start, at); const after = v.slice(at, end);
    const text = `${/\s$/.test(before) ? '' : ' '}::${/^\s/.test(after) ? '' : ' '}`;
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, at, at, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (/^\s/.test(after)) ta.setSelectionRange(ta.selectionEnd + 1, ta.selectionEnd + 1);
  }

  // ---- Cards
  // A round goes through every card of the deck: Got it counts a card as known, Again sends it to the end of the
  // round, so it comes back until it's known. A deck keeps its last whole round on its note (`study`: right the
  // first time, of how many, when) and its Shuffle; edits, AI Chat and the Notes list keep the field as it is.
  let run = null; // { id, cards: [{ q, a }], queue: [card index], done, missed: Set, flipped, part, end, shuffle, prev }
  let anim = '';
  let pick = 0; let kbPick = false; // the deck ↑ / ↓ point at
  // The New card form takes the card's place (a round going on waits behind it): { id: the deck's note, or null for
  // a new deck (its note is made with the first card), q, a, name: what's typed, last: the question just added }
  let add = null;

  const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
  function cardsOf(n) {
    const out = [];
    for (const line of (n.body || '').split('\n')) {
      // " :: " first, so "std::vector :: a growable array" keeps the colons of its question
      const m = line.match(/^(.*?)\s+::\s+(.*)$/) || line.match(/^(.*?)::(.*)$/);
      if (!m) continue;
      const q = m[1].replace(BULLET, '').trim(); const a = m[2].trim();
      if (q && a) out.push({ q, a });
    }
    return out;
  }
  const decks = () => notes().map((n) => ({ n, cards: cardsOf(n) })).filter((d) => d.cards.length).sort((a, b) => b.n.updated - a.n.updated);
  const mix = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cardCount = (n) => (n === 1 ? _t('{n} card', { n }) : _t('{n} cards', { n }));
  // long text a size smaller, so a card fits Sympony's height
  const sizeOf = (t) => (t.length > 140 ? ' xs' : t.length > 70 ? ' sm' : '');
  // what was typed into the New card form stays one card: one line, without a "::" standing on its own (that's
  // the separator; "std::vector" keeps its colons)
  const clean = (t) => (t || '').replace(/\s+/g, ' ').replace(/(^| )::(?= |$)/g, '$1').replace(/ {2,}/g, ' ').trim();
  // a new deck nobody named: "Cards", "Cards 2", …
  function deckName() {
    const taken = new Set(notes().map(titleOf));
    let name = _t('Cards');
    for (let i = 2; taken.has(name); i++) name = `${_t('Cards')} ${i}`;
    return name;
  }

  function saveStudy(id, patch) {
    flush();
    save(notes().map((n) => (n.id === id ? { ...n, study: { ...(n.study || {}), ...patch } } : n)));
  }

  function setMode(m) {
    if (m === mode) return;
    flush();
    mode = m;
    paintMode();
  }
  function paintMode() {
    page.classList.toggle('cards', mode === 'cards');
    $$('.notes-mode button', page).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const nb = $('#noteNew', page);
    if (nb) {
      nb.title = mode === 'cards' ? _t('New deck') : _t('New note');
      nb.innerHTML = `${N.ic('plus', 'width:12px;height:12px')}${esc(mode === 'cards' ? _t('New deck') : _t('New note'))}`;
    }
    const ed = $('.note-edit', page);
    const fc = $('.fc', page);
    const itemsEl = $('.items', page);
    const decksEl = $('.decks', page);
    const srch = $('#noteSearchWrap', page);
    if (ed) ed.style.display = mode === 'cards' ? 'none' : 'flex';
    if (fc) fc.style.display = mode === 'cards' ? 'flex' : 'none';
    if (itemsEl) itemsEl.style.display = mode === 'cards' ? 'none' : 'flex';
    if (decksEl) decksEl.style.display = mode === 'cards' ? 'flex' : 'none';
    if (srch) srch.style.display = mode === 'cards' ? 'none' : 'flex';
    if (mode === 'cards') { renderDecks(); renderPane(); }
  }

  function renderDecks() {
    const list = decks();
    pick = Math.max(0, Math.min(pick, list.length - 1));
    const on = add ? add.id : run && run.id;
    $('.decks', page).innerHTML = list.map((d, i) => {
      const s = d.n.study || {};
      const last = s.of ? ` · ${_t('last {got}/{of}', { got: s.got, of: s.of })}` : '';
      const tip = s.of ? _t('Last round {date}: {got} of {of} right the first time', { date: new Date(s.at).toLocaleDateString(_tLocale(), { day: 'numeric', month: 'short' }), got: s.got, of: s.of }) : '';
      return `<div class="note-li ${on === d.n.id ? 'on' : ''} ${kbPick && !run && !add && i === pick ? 'kb' : ''}" data-id="${d.n.id}" title="${esc(tip)}"><b>${esc(titleOf(d.n))}</b><small>${cardCount(d.cards.length)}${last}</small>
        <button class="fc-row-add" title="${_t('Add cards')} (A)">${fa('plus')}</button></div>`;
    }).join('') || `<div class="empty-state">${fa('clone', 'regular')}<span>${_t('No cards yet')}</span></div>`;
    $$('.decks .note-li', page).forEach((el) => {
      el.onclick = () => { kbPick = false; startDeck(el.dataset.id); };
      $('.fc-row-add', el).onclick = (e) => { e.stopPropagation(); kbPick = false; openAdd(el.dataset.id); };
    });
  }

  // the card being studied, the end of a round, the New card form, or how cards are made
  function renderPane() {
    const fc = $('.fc', page);
    if (add) { renderAdd(fc); return; }
    if (!run) {
      const any = decks().length > 0;
      const fmt = `<code>${esc(_t('question'))} :: ${esc(_t('answer'))}</code>`;
      const key = (k, label) => `<span><kbd>${k}</kbd>${label}</span>`;
      fc.className = 'fc intro';
      fc.innerHTML = `<div class="fc-how">${any
        ? `<b>${_t('Pick a deck to study')}</b>
          <span class="muted">${_t('Each line written {fmt} in a note is a card (Tab after the question types the ::). + on a deck adds cards to it, + on top starts a new deck. Again brings a card back later in the round, Got it counts it as known.', { fmt })}</span>
          <div class="fc-keys">${key(_t('Space'), _t('Show answer'))}${key('1', _t('Again'))}${key('2', _t('Got it'))}${key('S', _t('Shuffle'))}${key('A', _t('Add cards'))}${key('Esc', _t('Decks'))}</div>`
        : `<b>${_t('Make cards from your notes')}</b>
          <span class="muted">${_t('Start a deck and type each question and its answer, or write lines as {fmt} in any note (Tab after the question types the ::). Each line is a card, each note a deck.', { fmt })}</span>
          <div class="fc-new"><button class="pill-btn primary" data-a="newdeck">${fa('plus')} ${_t('New deck')}</button><button class="pill-btn" data-a="new">${fa('pen-to-square')} ${_t('New note')}</button></div>
          <div class="fc-ex"><b>${esc(_t('Biology'))}</b><span>${esc(_t('Powerhouse of the cell'))} <em>::</em> ${esc(_t('Mitochondria'))}</span><span>${esc(_t('Plants make food by'))} <em>::</em> ${esc(_t('Photosynthesis'))}</span></div>`}</div>`;
      return;
    }
    const total = run.cards.length;
    const top = `<div class="fc-top"><span class="fc-num">${run.done}/${total}</span><div class="bar-track"><div style="width:${Math.round((run.done / total) * 100)}%"></div></div>
      ${!run.end && run.missed.size ? `<span class="fc-again" title="${_t('Cards to see again this round')}">${fa('rotate-left')} ${run.queue.filter((x) => run.missed.has(x)).length}</span>` : ''}
      <button class="fc-ic" data-a="add" title="${_t('Add cards')} (A)">${fa('plus')}</button>
      <button class="fc-ic ${run.shuffle ? 'on' : ''}" data-a="shuffle" title="${_t('Shuffle')} (S)">${fa('shuffle')}</button>
      <button class="fc-ic" data-a="close" title="${_t('Back to the decks')} (Esc)">${fa('xmark')}</button></div>`;
    if (run.end) {
      const n = run.missed.size; const got = total - n;
      fc.className = 'fc end';
      fc.innerHTML = `${top}
        <div class="fc-card fc-done"><div class="fc-in">
          <div class="fc-big">${fa('circle-check')} ${_t('Round done')}</div>
          <div class="fc-sum">${n ? _t('{got} of {total} right the first time', { got, total }) : _t('All {total} right the first time', { total })}</div>
          ${run.prev ? `<small class="muted">${_t('Last time {got}/{of}', { got: run.prev.got, of: run.prev.of })}</small>` : ''}
        </div></div>
        <div class="fc-acts"><button class="pill-btn" data-a="restart">${fa('rotate-right')} ${_t('Study again')} <kbd>Enter</kbd></button>${n
          ? `<button class="pill-btn" data-a="missed">${n === 1 ? _t('Only the missed one') : _t('Only the {n} missed', { n })} <kbd>M</kbd></button>` : ''}</div>`;
      return;
    }
    const c = run.cards[run.queue[0]];
    fc.className = `fc study${run.flipped ? ' flipped' : ''}`;
    fc.innerHTML = `${top}
      <div class="fc-card ${anim}" data-a="flip"><div class="fc-in">${run.flipped
        ? `<div class="fc-q">${esc(c.q)}</div><div class="fc-big${sizeOf(c.a)}">${esc(c.a)}</div>`
        : `<div class="fc-big${sizeOf(c.q)}">${esc(c.q)}</div>`}</div></div>
      <div class="fc-acts">${run.flipped
        ? `<button class="pill-btn fc-no" data-a="again">${_t('Again')} <kbd>1</kbd></button><button class="pill-btn fc-yes" data-a="got">${_t('Got it')} <kbd>2</kbd></button>`
        : `<button class="pill-btn" data-a="flip">${_t('Show answer')} <kbd>${_t('Space')}</kbd></button>`}</div>`;
    anim = '';
  }

  // The New card form: the deck on top (a name for a new one), Question, Answer and Add. Enter in the question goes
  // to the answer, Enter there adds the card and goes back to the question for the next one; Esc closes it.
  function renderAdd(fc) {
    const n = add.id && notes().find((x) => x.id === add.id);
    fc.className = 'fc adding';
    fc.innerHTML = `<div class="fc-top"><span class="fc-head">${n ? ''
      : `<span class="fc-to">${_t('New deck')}</span><input type="text" class="field fc-name" data-f="name" value="${esc(add.name)}" placeholder="${esc(deckName())}" title="${_t('The deck’s name, the first line of its note')}" maxlength="80" spellcheck="false">`}</span>
        <button class="fc-ic" data-a="addclose" title="${_t('Done')} (Esc)">${fa('xmark')}</button></div>
      <div class="fc-add">
        <input type="text" class="field fc-qin" data-f="q" value="${esc(add.q)}" placeholder="${_t('Question')}" spellcheck="false">
        <div class="fc-add-row"><input type="text" class="field fc-ain" data-f="a" value="${esc(add.a)}" placeholder="${_t('Answer')}" spellcheck="false"><button class="pill-btn primary" data-a="addcard">${fa('plus')} ${_t('Add')}</button></div>
        <small class="fc-add-note"></small>
        <div class="fc-list scroll"></div>
      </div>`;
    $$('.fc-add input, .fc-name', fc).forEach((f) => f.addEventListener('animationend', () => f.classList.remove('bad')));
    paintAdd();
  }
  // the deck and its count, the card just added and the deck's cards, newest first (the fields are left as they are)
  function paintAdd() {
    const head = $('.fc-head', page);
    if (!add || !head) return;
    const n = add.id && notes().find((x) => x.id === add.id);
    // the deck's note was deleted meanwhile: what's typed goes to a new deck (the field typed in keeps the keyboard)
    if (add.id && !n) {
      const f = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : '';
      add.id = null; add.last = '';
      renderAdd($('.fc', page));
      if (f) $(`.fc [data-f=${f}]`, page).focus();
      return;
    }
    if (n) head.innerHTML = `<span class="fc-to">${_t('Add to')}</span><b class="fc-deck">${esc(titleOf(n))}</b><span class="fc-count">${cardCount(cardsOf(n).length)}</span>`;
    $('.fc-add-note', page).innerHTML = add.last
      ? `${fa('check')}<span>${_t('Added: {card}', { card: esc(add.last) })}</span>`
      : `<span>${_t('{enter} goes to the answer, then adds the card. {esc} when done.', { enter: '<kbd>Enter</kbd>', esc: '<kbd>Esc</kbd>' })}</span>`;
    $('.fc-list', page).innerHTML = n
      ? cardsOf(n).reverse().map((c) => `<div class="fc-li"><span>${esc(c.q)}</span><em>::</em><span>${esc(c.a)}</span></div>`).join('')
      : `<span class="muted">${_t('Each card is a line in the deck’s note, so you can edit it there.')}</span>`;
  }
  function openAdd(id) {
    add = { id: id || null, q: '', a: '', name: '', last: '' };
    renderDecks(); renderPane();
    N.focusField($(add.id ? '.fc-qin' : '.fc-name', page));
  }
  // back to the round going on, or to the decks with this one pointed at (Enter studies it)
  function closeAdd(byKey) {
    const id = add.id;
    add = null;
    if (!run) { const i = decks().findIndex((d) => d.n.id === id); if (i >= 0) { pick = i; kbPick = !!byKey; } }
    renderDecks(); renderPane();
    focusPane();
  }
  const shake = (f) => { f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad'); f.focus(); };
  function addCard() {
    const q = clean(add.q); const a = clean(add.a);
    const qi = $('.fc-qin', page); const ai = $('.fc-ain', page);
    if (!q || !a) { shake(q ? ai : qi); return; }
    flush();
    const line = `${q} :: ${a}`;
    const n = add.id && notes().find((x) => x.id === add.id);
    add.q = ''; add.a = ''; add.last = q;
    if (n) {
      const body = (n.body || '').replace(/\n+$/, '');
      save(notes().map((x) => (x.id === n.id ? { ...x, body: body ? `${body}\n${line}` : line, updated: Date.now() } : x)));
    } else {
      // a new deck: a note with the name on its first line
      const fresh = { id: uid(), body: `${clean(add.name) || deckName()}\n${line}`, updated: Date.now() };
      add.id = fresh.id;
      save([fresh, ...notes()]);
    }
    // a round of this deck going on gets the card at its end
    const card = cardsOf({ body: line })[0];
    if (card && run && run.id === add.id && !run.end) { run.cards.push(card); run.queue.push(run.cards.length - 1); }
    qi.value = ''; ai.value = '';
    qi.focus();
  }

  // the keyboard comes to the card (like clicking into a note), for Space, 1, 2, …
  function focusPane() {
    const fc = $('.fc', page);
    if (st.typing) fc.focus({ preventScroll: true }); else N.focusField(fc);
  }

  function begin(id, cards, part) {
    const n = notes().find((x) => x.id === id) || {};
    const s = n.study || {};
    const queue = cards.map((c, i) => i);
    run = { id, cards, queue: s.shuffle ? mix(queue) : queue, done: 0, missed: new Set(), flipped: false, part, end: false, shuffle: !!s.shuffle, prev: !part && s.of ? s : null };
    anim = 'in';
    renderDecks(); renderPane();
  }
  function startDeck(id) {
    const n = notes().find((x) => x.id === id);
    // a deck clicked while the New card form is open: the form makes way
    if (add) { add = null; renderDecks(); renderPane(); }
    if (n && !(run && run.id === id && !run.end)) begin(id, cardsOf(n), false); // the deck already going: carry on
    focusPane();
  }
  function flip() {
    run.flipped = !run.flipped;
    anim = 'flip';
    renderPane();
  }
  function grade(ok) {
    if (!run.flipped) { flip(); return; }
    const i = run.queue.shift();
    if (ok) run.done++; else { run.missed.add(i); run.queue.push(i); }
    run.flipped = false;
    if (run.queue.length) { anim = 'in'; renderPane(); return; }
    run.end = true;
    // a round of only the missed ones isn't the deck's result
    if (!run.part) saveStudy(run.id, { got: run.cards.length - run.missed.size, of: run.cards.length, at: Date.now() });
    renderPane();
  }
  // On: the cards still to come in a random order (the one showing stays, the Again ones stay last); off: in the
  // note's order. Kept for the deck.
  function shuffle() {
    run.shuffle = !run.shuffle;
    if (!run.end) {
      const rest = run.queue.slice(1);
      const fresh = rest.filter((i) => !run.missed.has(i));
      run.queue = [run.queue[0], ...(run.shuffle ? mix(fresh) : fresh.sort((a, b) => a - b)), ...rest.filter((i) => run.missed.has(i))];
    }
    saveStudy(run.id, { shuffle: run.shuffle });
    renderPane();
  }
  function closeRun() {
    const list = decks();
    const i = list.findIndex((d) => d.n.id === run.id);
    if (i >= 0) pick = i;
    run = null;
    renderDecks(); renderPane();
  }
  function act(a) {
    if (a === 'new') { setMode('notes'); newNote(); return; }
    if (a === 'newdeck') { openAdd(null); return; }
    if (a === 'addcard') { if (add) addCard(); return; }
    if (a === 'addclose') { if (add) closeAdd(false); return; }
    if (!run) return;
    if (a === 'add') { openAdd(run.id); return; }
    if (a === 'flip' && !run.end) flip();
    else if (a === 'again' || a === 'got') grade(a === 'got');
    else if (a === 'shuffle') shuffle();
    else if (a === 'close') closeRun();
    else if (a === 'restart') { const n = notes().find((x) => x.id === run.id); begin(run.id, n ? cardsOf(n) : run.cards, false); }
    else if (a === 'missed') begin(run.id, [...run.missed].map((i) => run.cards[i]), true);
  }

  // Keys while the card has the keyboard: Space / Enter show the answer (and back), 1 or ← Again, 2 or → Got it,
  // S shuffles, A adds cards to the deck, Esc goes back to the decks (before notch.js closes Sympony with it); at the end
  // Enter studies again and M only the missed ones; with no deck going ↑ / ↓ and Enter pick one, A adds to it. The
  // New card form's fields keep their keys (Esc there closes the form).
  function onKey(e) {
    if (mode !== 'cards' || !st.open || st.page !== 'notes' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const go = k === ' ' || k === 'Enter';
    if (add) {
      if (k !== 'Escape') return;
      e.stopPropagation(); closeAdd(true);
    } else if (!run) {
      const list = decks();
      if ((k === 'ArrowDown' || k === 'ArrowUp') && list.length) {
        pick = kbPick ? Math.max(0, Math.min(list.length - 1, pick + (k === 'ArrowDown' ? 1 : -1))) : pick;
        kbPick = true;
        renderDecks();
      } else if (go && kbPick && list[pick]) startDeck(list[pick].n.id);
      else if (k === 'a' && kbPick && list[pick]) openAdd(list[pick].n.id);
      else return;
    } else if (k === 'Escape') { e.stopPropagation(); kbPick = true; closeRun(); }
    else if (k === 'a') openAdd(run.id);
    else if (run.end) {
      if (go) act('restart');
      else if (k === 'm' && run.missed.size) act('missed');
      else return;
    } else if (go) flip();
    else if (k === '1' || k === '2') grade(k === '2');
    else if (k === 'ArrowLeft' || k === 'ArrowRight') grade((k === 'ArrowRight') !== (document.documentElement.dir === 'rtl'));
    else if (k === 's') shuffle();
    else return;
    e.preventDefault();
  }

  // ------------------------------------------------------------ 1×1 Notes card (matches modules.html)
  const cards = new Set();
  let cardWatch = false;

  function ensureCardWatch() {
    if (cardWatch) return;
    cardWatch = true;
    N.watch('notes', () => refreshCards());
  }

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#facc15');
    const list = notes().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const latest = list[0];
    const title = latest ? titleOf(latest) : _t('No notes yet');
    el.innerHTML = `${N.hd('note', _t('Notes'), list.length ? String(list.length) : '')}`
      + `<div class="t1" style="font-size:13px;font-weight:700;margin-top:7px">${esc(title)}</div>`
      + `<div style="margin-top:4px;display:flex;flex-direction:column;gap:5px">${[92, 74, 40].map((w) => `<i style="height:4px;width:${w}%;border-radius:2px;background:#23232a"></i>`).join('')}</div>`;
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'notes',
    tall: true,
    init(p) {
      page = p;
      page.innerHTML = `<div style="display:grid;grid-template-columns:186px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
        + `<div class="c" style="padding:10px;gap:6px">`
        + `<div class="row" style="gap:4px"><div class="seg2 notes-mode" style="flex:1"><button type="button" data-mode="notes" style="flex:1;height:22px;padding:0 6px;font-size:11px">${esc(_t('Notes'))}</button><button type="button" data-mode="cards" style="flex:1;height:22px;padding:0 6px;font-size:11px">${esc(_t('Cards'))}</button></div></div>`
        + `<div id="noteSearchWrap" class="row" style="height:26px;padding:0 9px;border-radius:9px;background:var(--pill);color:var(--mute);font-size:11.5px;gap:6px;flex:none">${N.ic('note', 'width:11px;height:11px')}<input id="noteSearch" type="text" placeholder="${esc(_t('Search notes…'))}" style="flex:1;min-width:0;background:none;border:0;outline:none;color:#fff;font-size:11.5px"></div>`
        + `<div class="items sc-y" style="display:flex;flex-direction:column;gap:2px;flex:1"></div>`
        + `<div class="decks sc-y" style="display:none;flex-direction:column;gap:2px;flex:1"></div>`
        + `<button type="button" class="sbtn" id="noteNew" style="height:28px;margin-top:auto"></button>`
        + `</div>`
        + `<div class="c note-edit" style="padding:14px 16px;gap:6px">`
        + `<input id="noteTitle" type="text" placeholder="${esc(_t('New note'))}" spellcheck="false" style="font-size:17px;font-weight:700;background:none;border:0;outline:none;color:#fff;width:100%">`
        + `<textarea placeholder="${esc(_t('Start typing…'))}" spellcheck="false" class="sc-y" style="font-size:13px;line-height:1.5;color:#d6d6dc;background:none;border:0;outline:none;resize:none;flex:1;width:100%"></textarea>`
        + `<div class="foot row" style="justify-content:space-between;font-size:10.5px;color:var(--mute);flex:none"><span class="when"></span><div class="row" style="gap:8px"><span class="wc"></span><button type="button" id="noteDel" title="${esc(_t('Delete note'))}" style="color:var(--mute);cursor:pointer">${N.ic('trash', 'width:12px;height:12px')}</button></div></div>`
        + `</div>`
        + `<div class="c fc" tabindex="-1" style="display:none;padding:12px 14px"></div>`
        + `</div>`;
      $$('.notes-mode button', page).forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
      $('#noteNew', page).onclick = () => { if (mode === 'cards') openAdd(null); else newNote(); };
      $('#noteSearch', page).addEventListener('input', (e) => { searchQ = e.target.value.trim(); renderList(); });
      $('#noteDel', page).onclick = () => {
        if (!current) return;
        clearTimeout(saveTimer); saveTimer = null;
        const rest = notes().filter((n) => n.id !== current);
        save(rest);
        select(rest[0] ? rest[0].id : null);
      };
      const onEditInput = () => {
        const body = composeBody();
        const words = body.trim().split(/\s+/).filter(Boolean).length;
        const wc = $('.foot .wc', page);
        if (wc) wc.textContent = words === 1 ? _t('{n} word', { n: 1 }) : _t('{n} words', { n: words });
        if (!current) {
          const n = { id: uid(), body, updated: Date.now() };
          current = n.id;
          save([n, ...notes()]);
          return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 400);
      };
      $('#noteTitle', page).addEventListener('input', onEditInput);
      $('#noteTitle', page).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('textarea', page).focus(); } });
      $('textarea', page).addEventListener('input', onEditInput);
      $('textarea', page).addEventListener('keydown', tabToCard);
      const fc = $('.fc', page);
      // a click on the card or its buttons keeps the keyboard on the card (a focused button would take Space), and
      // in the New card form on its field
      fc.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      fc.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (b) act(b.dataset.a);
        if (run && !add) focusPane();
      });
      fc.addEventListener('input', (e) => { const f = e.target.dataset.f; if (add && f) add[f] = e.target.value; });
      fc.addEventListener('keydown', (e) => {
        if (!add || !e.target.dataset.f) return;
        if (e.key === 'Escape') { e.stopPropagation(); closeAdd(true); return; }
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        const f = e.target.dataset.f;
        if (f === 'name') $('.fc-qin', page).focus();
        else if (f === 'q') { if (clean(add.q)) $('.fc-ain', page).focus(); else shake(e.target); }
        else addCard();
      });
      window.addEventListener('keydown', onKey, true);
      // main's ← / → while Sympony is open without the keyboard: Again / Got it (the first one shows the answer)
      api.on('notch:arrow', (dir) => {
        if (!st.typing && mode === 'cards' && run && !run.end && !add && st.open && st.page === 'notes') grade((dir > 0) !== (document.documentElement.dir === 'rtl'));
      });
      N.watch('notes', () => {
        if (!current || !notes().some((n) => n.id === current)) current = (notes()[0] || {}).id || null;
        if (!saveTimer) select(current); else renderList();
        // a round going on keeps its cards, the New card form what's typed in it; the decks and how-to follow the notes
        if (mode === 'cards') { renderDecks(); if (add) paintAdd(); else if (!run) renderPane(); }
      });
      paintMode();
    },
    show() { select(current || (notes()[0] || {}).id || null); if (mode === 'cards') { renderDecks(); renderPane(); } },
    hide() { flush(); kbPick = false; },
    // ← / → are Again / Got it while a round goes on
    usesArrows() { return mode === 'cards' && !!run && !run.end && !add; },
    card(el, size) {
      ensureCardWatch();
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('notes'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
