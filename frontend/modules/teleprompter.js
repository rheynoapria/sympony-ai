// Teleprompter: scripts kept in Sympony, read from a strip the notch grows into right under the camera, so your eyes stay
// near the lens on a call or a recording (and with Show Sympony in screenshots & recordings off, the script never shows in
// a screen share). The tab keeps the scripts (typed, pasted, or a .txt dropped on it) with Speed, Text size and the
// countdown; Start closes Sympony into the strip: a 3-2-1, then the text glides up, the line being read at the top by the
// orange ▸ on a soft band, brighter and a little bigger, read lines dim above it. Lines (or bits) in [brackets] are
// cues: small and orange, not read and not counted. While it reads, main grabs Ctrl+Alt+Space / PageUp / PageDown /
// Backspace and Esc for this window (hotkeys.rs; no arrows, Intel's graphics hotkeys turn the screen with them), so it
// runs from the app in front, which keeps the keyboard; minimized it waits paused in the closed notch (notch.js teleMode).
// Kept in teleprompter.json: { scripts: [{ id, name, body, updated }], last (the one picked last) }
(function () {
  const { st, api, $, $$, esc, fa } = N;
  const WPM = 140;                  // words a minute at 1.0×
  const STRIP = { w: 520, h: 176 }; // the strip, CSS px (within Sympony's window, wm.rs WIN_W / WIN_H)
  const PAD = 46;                   // the text's room from the strip's sides (the ▸ sits in it)
  const LH = 1.32;                  // the strip's line height, × the text size
  const CUE_SECS = 1.2;             // a cue line goes by in this long at 1.0×
  const MIN_SECS = 0.45;            // and a line of a word or two no faster
  const CUE = /\[[^\]\n]*\]/g;
  // right-to-left letters (Hebrew, Arabic, Syriac, Thaana, N’Ko, …) and the marks that change the order
  const RTL = /[֐-ࣿיִ-﷿ﹰ-﻾‏‪-‮⁦-⁩\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
  const SPEED = [0.1, 2]; const SIZE = [16, 32];
  const me = (() => { try { return window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label || ''; } catch (e) { return ''; } })();

  let page; let ta; let mirror;
  let data = null;      // the store, once read
  let current = null;   // the script in the editor
  let saveTimer = 0;
  let renaming = null;  // the script whose name is being edited
  let delArm = null;    // the script whose delete was clicked once (a second click deletes it)
  let drop = null;      // a .txt dragged over the tab: its path
  const prefs = { speed: 1, size: 22, countdown: true };
  let prefsTimer = 0;   // a change to them waiting to be saved

  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const scripts = () => (data && data.scripts) || [];
  const isWord = (w) => /[\p{L}\p{N}]/u.test(w);
  const cueLine = (l) => !!l.trim() && !l.replace(CUE, '').trim();
  function stats(body) {
    let words = 0; let cues = 0;
    for (const l of String(body || '').split('\n')) {
      if (cueLine(l)) cues++;
      else words += l.replace(CUE, ' ').split(/\s+/).filter(isWord).length;
    }
    return { words, cues };
  }
  // "75 words · ±0:32" at the speed picked (a cue line takes a moment too)
  function estimate(body) {
    const { words, cues } = stats(body);
    const secs = (words * 60 / WPM + cues * CUE_SECS) / prefs.speed;
    return `${words === 1 ? _t('{n} word', { n: words }) : _t('{n} words', { n: words })} · ±${N.fmt(Math.round(secs))}`;
  }
  const speedText = () => `${prefs.speed.toFixed(1)}×`;

  // ---- the scripts
  function save() { if (data) api.svc('store', 'set', 'teleprompter', data).catch(() => {}); }
  async function load() {
    const v = await api.svc('store', 'get', 'teleprompter').catch(() => null);
    if (data) return; // one came from another window meanwhile (and was picked from)
    data = v && Array.isArray(v.scripts) ? v : { scripts: [], last: null };
    pickFirst();
  }
  // the one picked last, else the newest
  function pickFirst() { select(scripts().some((s) => s.id === data.last) ? data.last : (scripts()[0] || {}).id || null); }
  // saved here or in another display's Sympony
  api.on('store:teleprompter', (v) => {
    if (!v || !Array.isArray(v.scripts)) return;
    data = v;
    if (!page) return;
    if (!scripts().some((s) => s.id === current)) { current = (scripts()[0] || {}).id || null; select(current); return; }
    const s = scripts().find((x) => x.id === current);
    if (!saveTimer && ta.value !== (s.body || s.text || '')) { ta.value = s.body || s.text || ''; paintEditor(); }
    renderList();
  });

  function newName() {
    const taken = new Set(scripts().map((s) => s.name));
    for (let i = 1; ; i++) { const n = _t('Script {n}', { n: i }); if (!taken.has(n)) return n; }
  }
  function add(name, body) {
    flush();
    const s = { id: uid(), name: name || newName(), body: body || '', updated: Date.now() };
    data = { ...data, scripts: [s, ...scripts()], last: s.id };
    save();
    select(s.id);
    return s;
  }
  function select(id) {
    flush();
    current = id;
    renaming = null; delArm = null;
    if (data && id && data.last !== id) { data = { ...data, last: id }; save(); }
    const s = scripts().find((x) => x.id === id);
    if (ta) { ta.value = s ? (s.body || s.text || '') : ''; ta.scrollTop = 0; paintEditor(); }
    renderList();
  }
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = 0;
    data = { ...data, scripts: scripts().map((s) => (s.id === current ? { ...s, body: ta.value, updated: Date.now() } : s)) };
    save();
  }
  function rename(id, name) {
    const n = String(name || '').trim().slice(0, 60);
    renaming = null;
    if (n) { data = { ...data, scripts: scripts().map((s) => (s.id === id ? { ...s, name: n } : s)) }; save(); }
    renderList();
  }
  function remove(id) {
    if (saveTimer && id === current) { clearTimeout(saveTimer); saveTimer = 0; }
    const rest = scripts().filter((s) => s.id !== id);
    data = { ...data, scripts: rest, last: id === current ? (rest[0] || {}).id || null : data.last };
    save();
    if (id === current) select((rest[0] || {}).id || null); else renderList();
  }

  // ---- the tab
  function renderList() {
    if (!page) return;
    // (a name being typed stays as typed when the list is drawn again: saved in another window, say)
    const live = renaming && $('.tlp-ren', page);
    const typed = live ? live.value : null;
    $('.tlp-items', page).innerHTML = scripts().map((s) => {
      const armed = delArm === s.id;
      const name = renaming === s.id ? `<input type="text" class="tlp-ren" maxlength="60" value="${esc(s.name)}" spellcheck="false">` : `<b>${esc(s.name)}</b>`;
      return `<div class="tlp-li ${s.id === current ? 'on' : ''}" data-id="${esc(s.id)}">${name}<small>${esc(estimate(s.id === current && ta ? ta.value : s.body))}</small>
        <span class="tlp-acts"><button data-a="ren" title="${_t('Rename')}">${fa('pen')}</button><button data-a="del" class="${armed ? 'arm' : ''}" title="${armed ? _t('Click again to delete') : _t('Delete')}">${armed ? fa('check') : fa('trash-can', 'regular')}</button></span></div>`;
    }).join('') || `<div class="empty-state">${fa('scroll')}<span>${_t('No scripts yet')}</span></div>`;
    const input = $('.tlp-ren', page);
    if (input && typed != null) { input.value = typed; input.focus(); } else if (input) { N.focusField(input); setTimeout(() => input.select(), 40); }
  }
  // each script's estimate again (the speed changed)
  function paintEstimates() {
    $$('.tlp-li', page).forEach((li) => {
      const s = scripts().find((x) => x.id === li.dataset.id);
      if (s) $('small', li).textContent = estimate(s.id === current ? ta.value : s.body);
    });
  }
  // the editor shows cues in orange: the text is drawn by a copy under the (see-through) field, wrapped the same way
  function paintEditor() {
    mirror.innerHTML = ta.value.split('\n').map((l) => esc(l).replace(CUE, (m) => `<span class="cue">${m}</span>`)).join('\n') + '\n ';
    mirror.scrollTop = ta.scrollTop;
    paintCount();
  }
  function paintCount() {
    const { words } = stats(ta.value);
    $('.tlp-count', page).textContent = estimate(ta.value);
    $('.tlp-start', page).disabled = !words;
    const li = $('.tlp-li.on small', page);
    if (li) li.textContent = estimate(ta.value);
  }
  function paintBar() {
    if (!page) return;
    $('.tlp-chip[data-k=speed] b', page).textContent = speedText();
    $('.tlp-chip[data-k=size] b', page).textContent = prefs.size;
    const cd = $('.tlp-cd', page);
    cd.classList.toggle('off', !prefs.countdown);
    cd.title = prefs.countdown ? _t('A 3-2-1 countdown before the text starts moving (click to turn off)') : _t('No countdown: the text starts moving at once (click to turn on)');
    $('.tlp-private', page).hidden = !!(st.settings && st.settings.showInScreenshots !== false);
    if (ta) { paintCount(); paintEstimates(); }
  }

  // Speed (0.1–2.0×), text size (16–32) and the countdown: shown at once, saved a moment after the last click
  function setPref(k, v) {
    prefs[k] = v;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => { prefsTimer = 0; api.setSettings({ teleSpeed: prefs.speed, teleSize: prefs.size, teleCountdown: prefs.countdown }); }, 700);
    paintBar();
  }
  function stepSpeed(d) { setPref('speed', clamp(Math.round(prefs.speed * 10 + d) / 10, SPEED)); if (rd) paintStrip(); }
  function stepSize(d) { const v = clamp(prefs.size + d * 2, SIZE); if (v === prefs.size) return; setPref('size', v); if (rd) rebuild(); }
  function readPrefs(s) {
    if (prefsTimer || !s) return; // a change of ours is on its way
    prefs.speed = clamp(Math.round((Number(s.teleSpeed) || 1) * 10) / 10, SPEED);
    const size = clamp(Math.round((Number(s.teleSize) || 22) / 2) * 2, SIZE);
    const resize = size !== prefs.size;
    prefs.size = size;
    prefs.countdown = s.teleCountdown !== false;
    if (rd && resize) rebuild(); else if (rd) paintStrip();
  }

  // ---- a .txt dropped on the tab: a new script with its name and text (or into the empty one picked)
  function takeFiles(type, paths) {
    if (type === 'enter') {
      drop = paths.length === 1 && /\.txt$/i.test(paths[0]) ? paths[0] : null;
      page.classList.toggle('drop-over', !!drop);
      return !!drop;
    }
    if (!drop) return false;
    if (type === 'over') return true;
    const path = (type === 'drop' && paths[0]) || drop;
    drop = null;
    page.classList.remove('drop-over');
    if (type === 'drop') loadFile(path);
    return true;
  }
  async function loadFile(path) {
    const r = await api.svc('teleprompter', 'read', path).catch(() => null);
    if (!r || !r.ok) { N.toast(fa('triangle-exclamation'), r && r.big ? _t('That file is too big for a script') : _t('Couldn’t read that file'), { color: 'var(--orange)' }); return; }
    const text = String(r.text || '').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
    const name = String(r.name || '').trim().slice(0, 60);
    const cur = scripts().find((s) => s.id === current);
    if (cur && !(saveTimer ? ta.value : cur.body).trim()) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
      data = { ...data, scripts: scripts().map((s) => (s.id === cur.id ? { ...s, name: name || s.name, body: text, updated: Date.now() } : s)) };
      save();
      select(cur.id);
    } else add(name, text);
  }

  // ================================================================== reading
  // rd: { body, lines: [{ el (its box, or its whole line's), y, h, words, w0 (words before it), t (when it starts, in
  //   seconds at 1.0×), d (how long) }], end (where the last line stops), total, t (how far, in seconds at 1.0×),
  //   playing, count (3-2-1), min (minimized), raf, last (the frame before), mark (the reading line's place in the
  //   strip), left (the time left shown), cur (the line drawn as the one being read) }
  let rd = null;
  let strip; let text; let el = {};
  const keySeq = { n: 0 };
  // main grabs the reading keys for this window while it reads (Esc only while the strip is up), and gives them back
  function keys(on, withEsc) {
    // (the asks can arrive out of order: each with a number that only grows)
    keySeq.n = Math.max(keySeq.n + 0.001, performance.timeOrigin + performance.now());
    api.svc('teleprompter', 'keys', me, on, !!withEsc, keySeq.n).catch(() => {});
  }
  const changed = () => window.dispatchEvent(new Event('sympony:tele'));

  function ensureStrip() {
    if (strip) return;
    $('#notch').insertAdjacentHTML('beforeend', `<div class="tele-strip">
      <i class="tls-band"></i>
      <div class="tls-view"><div class="tls-text"></div></div>
      <i class="tls-mark">${fa('caret-right')}</i>
      <div class="tls-count"></div>
      <div class="tls-ctl">
        <button data-t="back" title="${_t('Back one line')} (Ctrl+Alt+Backspace)">${fa('backward-step')}</button>
        <button data-t="play" class="tls-play"></button>
        <span class="tls-grp"><button data-t="slower" title="${_t('Slower')} (Ctrl+Alt+PageDown)">${fa('minus')}</button><b class="tls-speed"></b><button data-t="faster" title="${_t('Faster')} (Ctrl+Alt+PageUp)">${fa('plus')}</button></span>
        <span class="tls-grp"><button data-t="smaller" title="${_t('Smaller text')}">A−</button><button data-t="bigger" title="${_t('Bigger text')}">A+</button></span>
        <div class="tls-prog"><i></i></div>
        <span class="tls-left"></span>
        <button data-t="min" title="${_t('Minimize to the notch')}">${fa('down-left-and-up-right-to-center')}</button>
        <button data-t="stop" title="${_t('Stop')} (Esc)">${fa('xmark')}</button>
      </div></div>`);
    strip = $('#notch .tele-strip');
    text = $('.tls-text', strip);
    el = { prog: $('.tls-prog i', strip), left: $('.tls-left', strip), speed: $('.tls-speed', strip), play: $('.tls-play', strip), count: $('.tls-count', strip) };
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b || !rd) return;
      const t = b.dataset.t;
      if (t === 'back') back();
      else if (t === 'play') play(!rd.playing);
      else if (t === 'slower' || t === 'faster') stepSpeed(t === 'faster' ? 1 : -1);
      else if (t === 'smaller' || t === 'bigger') stepSize(t === 'bigger' ? 1 : -1);
      else if (t === 'min') minimize();
      else if (t === 'stop') stop();
    });
    // the mouse wheel moves the text by hand (a wheel notch is about a line), playing or not
    strip.addEventListener('wheel', (e) => {
      if (!rd || rd.min) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * STRIP.h : e.deltaY;
      rd.t = tAt(yAt(rd.t) + (px / 100) * prefs.size * LH);
      paintStrip();
    }, { passive: false });
  }

  // The script in the strip: a paragraph per line, each word its own span (to find where the lines wrap), cues small;
  // then each line as wrapped in a box of its own, so the one being read can be drawn brighter and a little bigger.
  // Not a line with right-to-left letters (or marks that change the order) in it: a box of its own lays a line out as
  // if alone, which could put a number or a comma at its other end; that one stays whole, drawn as one.
  function build() {
    text.style.width = STRIP.w - PAD * 2 + 'px';
    text.style.fontSize = prefs.size + 'px';
    const words = (s) => s.split(/(\s+)/).map((w) => (!w ? '' : /^\s+$/.test(w) ? ' ' : `<span${isWord(w) ? ' class="tlw"' : ''}>${esc(w)}</span>`)).join('');
    text.innerHTML = rd.body.replace(/\r\n?/g, '\n').split('\n').map((l) => {
      if (!l.trim()) return '<p class="gap"></p>';
      if (cueLine(l)) return `<p class="cue">${esc(l.trim())}</p>`;
      let html = ''; let at = 0;
      l.replace(CUE, (m, i) => { html += words(l.slice(at, i)) + `<span class="cue">${esc(m)}</span>`; at = i + m.length; return m; });
      return `<p${/\p{L}/u.test(l) && !RTL.test(l) ? ' dir="ltr"' : ''}>${html + words(l.slice(at))}</p>`;
    }).join('');
    boxRows();
    measure();
  }
  // a left-to-right line's words grouped by the row they fell on, each row a box (a space goes with the word before
  // it; a word too long for a row, broken over two, keeps both in one box)
  function boxRows() {
    const lh = prefs.size * LH;
    const paras = [...text.children].filter((p) => p.dir);
    // (where every word is, read first: the boxes then go in without the text laid out again in between; the rows
    // counted in layout px, whatever scale the notch is drawn at)
    const rowsOf = paras.map((p) => {
      const pr = p.getBoundingClientRect(); const f = pr.height ? p.offsetHeight / pr.height : 1;
      const row = (r) => Math.max(0, Math.floor(((r.top + r.height / 2 - pr.top) * f) / lh));
      return [...p.childNodes].map((n) => { const rs = n.nodeType === 1 ? n.getClientRects() : []; return rs.length ? [row(rs[0]), row(rs[rs.length - 1])] : null; });
    });
    paras.forEach((p, i) => {
      const boxes = [[]]; let to = -1; let filled = false;
      [...p.childNodes].forEach((n, j) => {
        const r = rowsOf[i][j];
        if (r && r[0] > to && filled) { boxes.push([]); filled = false; }
        if (r) { to = Math.max(to, r[1]); filled = true; }
        boxes[boxes.length - 1].push(n);
      });
      p.replaceChildren(...boxes.map((ns) => { const b = document.createElement('span'); b.className = 'tlr'; b.append(...ns); return b; }));
    });
  }
  // Where each line of the strip is (as wrapped) and how long it takes: its words at 140 a minute (1.0×)
  function measure() {
    const lh = prefs.size * LH;
    const lines = [];
    let w = 0; let end = 0;
    for (const p of text.children) {
      end = p.offsetTop + p.offsetHeight;
      if (p.classList.contains('gap')) continue;
      if (p.classList.contains('cue')) { lines.push({ el: p, y: p.offsetTop, h: p.offsetHeight, words: 0, w0: w }); continue; }
      if (p.dir) {
        for (const box of p.children) {
          const words = box.getElementsByClassName('tlw').length;
          lines.push({ el: box, y: box.offsetTop, h: box.offsetHeight, words, w0: w });
          w += words;
        }
        continue;
      }
      // (a line left whole: its rows by where its words are, each drawn as the line)
      const rows = [];
      for (const sp of p.children) {
        const k = Math.max(0, Math.floor((sp.offsetTop + sp.offsetHeight / 2 - p.offsetTop) / lh));
        const row = rows[k] || (rows[k] = { el: p, y: p.offsetTop + k * lh, h: lh, words: 0, w0: 0 });
        if (sp.classList.contains('tlw')) row.words++;
      }
      for (const row of rows) if (row) { row.w0 = w; w += row.words; lines.push(row); }
    }
    let t = 0;
    for (const l of lines) { l.t = t; l.d = l.words ? Math.max(MIN_SECS, (l.words * 60) / WPM) : CUE_SECS; t += l.d; }
    rd.lines = lines; rd.end = end; rd.total = t; rd.lh = lh; rd.cur = -1;
    // the line being read crosses this height of the strip half way through its time (nearest the camera, with room
    // above it for the one just read, fading out)
    rd.mark = Math.round(lh + 6);
    strip.style.setProperty('--tls-mark', rd.mark + 'px');
    strip.style.setProperty('--tls-lh', lh + 'px');
  }
  // the text box's offset for a time: each line's top glides to the mark over its time, the next one after it
  function lineAt(t) {
    const L = rd.lines; let lo = 0; let hi = L.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m].t <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  function yAt(t) {
    const L = rd.lines;
    if (!L.length) return 0;
    const i = lineAt(t); const l = L[i];
    const next = L[i + 1] ? L[i + 1].y : rd.end;
    return l.y + Math.max(0, Math.min(1, (t - l.t) / l.d)) * (next - l.y);
  }
  function tAt(y) {
    const L = rd.lines;
    if (!L.length) return 0;
    y = Math.max(L[0].y, Math.min(rd.end, y));
    let i = 0;
    while (i < L.length - 1 && L[i + 1].y <= y) i++;
    const next = L[i + 1] ? L[i + 1].y : rd.end;
    return Math.min(rd.total, L[i].t + (next > L[i].y ? (y - L[i].y) / (next - L[i].y) : 0) * L[i].d);
  }
  const secsLeft = () => (rd ? Math.ceil(Math.max(0, rd.total - rd.t) / prefs.speed) : 0);
  // the line at the ▸ (from when its top reaches it until the next one's does): full strength and a little bigger, the
  // ones read dimmer, the ones to come a little less (modules.css eases each change); only the lines from the one
  // highlighted before to this one change
  function paintNow() {
    const L = rd.lines;
    const i = L.length ? lineAt(rd.t) : -1;
    const was = rd.cur;
    if (i === was) return;
    if (L[was]) L[was].el.classList.remove('now');
    for (let k = Math.max(0, Math.min(was, i)); k < Math.max(was, i); k++) L[k].el.classList.toggle('read', k < i);
    if (L[i]) { L[i].el.classList.remove('read'); L[i].el.classList.add('now'); }
    rd.cur = i;
  }

  function paintStrip() {
    if (!rd || !strip) return;
    text.style.transform = `translate3d(-50%, ${(rd.mark - yAt(rd.t)).toFixed(2)}px, 0)`;
    paintNow();
    el.prog.style.transform = `scaleX(${rd.total ? (rd.t / rd.total).toFixed(4) : 0})`;
    const left = secsLeft();
    if (left !== rd.left) { rd.left = left; el.left.textContent = N.fmt(left); }
    const sp = speedText();
    if (el.speed.textContent !== sp) el.speed.textContent = sp;
    const ended = !rd.playing && rd.t >= rd.total;
    const btn = el.play;
    const icon = rd.playing ? 'pause' : ended ? 'rotate-left' : 'play';
    if (btn.dataset.icon !== icon) {
      btn.dataset.icon = icon;
      btn.innerHTML = fa(icon);
      btn.title = `${rd.playing ? _t('Pause') : ended ? _t('From the top') : _t('Play')} (Ctrl+Alt+Space)`;
    }
    strip.classList.toggle('paused', !rd.playing && !rd.count);
    strip.classList.toggle('counting', !!rd.count);
  }
  // one frame a frame while it plays, none otherwise
  function frame(now) {
    rd.raf = 0;
    if (!rd.playing) return;
    rd.t = Math.min(rd.total, rd.t + (Math.min(100, now - rd.last) / 1000) * prefs.speed);
    rd.last = now;
    if (rd.t >= rd.total) { play(false); return; }
    paintStrip();
    rd.raf = requestAnimationFrame(frame);
  }
  function play(on) {
    if (!rd) return;
    N.cancel('teleCount');
    rd.count = 0;
    el.count.innerHTML = '';
    if (on && rd.t >= rd.total) rd.t = 0; // at the end: from the top again
    rd.playing = !!on && rd.total > 0;
    if (rd.playing && !rd.raf) { rd.last = performance.now(); rd.raf = requestAnimationFrame(frame); }
    if (!rd.playing && rd.raf) { cancelAnimationFrame(rd.raf); rd.raf = 0; }
    paintStrip();
  }
  function countdown(n) {
    rd.count = n;
    el.count.innerHTML = `<b>${n}</b>`;
    paintStrip();
    N.later('teleCount', 1000, () => { if (!rd || rd.min || rd.count !== n) return; if (n > 1) countdown(n - 1); else play(true); });
  }
  // back to the start of the line before the one being read
  function back() {
    if (!rd || !rd.lines.length) return;
    rd.t = rd.lines[Math.max(0, lineAt(rd.t) - 1)].t;
    paintStrip();
    if (rd.min) changed();
  }
  // the text size changed: drawn again, at the same word
  function rebuild() {
    const L = rd.lines; const i = lineAt(rd.t); const l = L[i];
    const at = l ? l.w0 + Math.max(0, Math.min(1, (rd.t - l.t) / l.d)) * l.words : 0;
    build();
    const n = rd.lines.find((x) => x.words && x.w0 + x.words > at) || rd.lines[rd.lines.length - 1];
    rd.t = n ? Math.min(rd.total, n.t + (n.words ? Math.max(0, at - n.w0) / n.words : 0) * n.d) : 0;
    rd.left = -1;
    paintStrip();
  }

  function start() {
    flush();
    const s = scripts().find((x) => x.id === current);
    if (!s || !stats(s.body).words) return;
    ensureStrip();
    stop(true);
    rd = { id: s.id, body: s.body, lines: [], end: 0, total: 0, t: 0, playing: false, count: 0, min: false, raf: 0, last: 0, mark: 0, left: -1, cur: -1 };
    build();
    paintStrip();
    keys(true, true);
    N.closeNotch(); // (layout makes the closed notch the strip)
    changed();
    if (prefs.countdown) countdown(3); else play(true);
  }
  function stop(quiet) {
    if (!rd) return;
    N.cancel('teleCount');
    if (rd.raf) cancelAnimationFrame(rd.raf);
    rd = null;
    if (quiet) return;
    keys(false);
    text.innerHTML = '';
    changed();
  }
  // down into the closed notch, paused ("Paused · 0:32 ▶"; a click brings it back): Esc is given back meanwhile
  function minimize() {
    if (!rd || rd.min) return;
    play(false);
    rd.min = true;
    keys(true, false);
    changed();
  }
  function resume() {
    if (!rd || !rd.min) return;
    rd.min = false;
    keys(true, true);
    changed();
    play(true);
  }

  // main: a reading key was pressed (in whatever app is in front)
  api.on('tele:key', (k) => {
    if (!rd) return;
    if (k === 'stop') stop();
    else if (k === 'pause') { if (rd.min) resume(); else play(!rd.playing); }
    else if (k === 'faster' || k === 'slower') { stepSpeed(k === 'faster' ? 1 : -1); if (rd.min) changed(); }
    else if (k === 'back') back();
  });
  // Sympony goes up for a fullscreen app (or is hidden from the tray): the strip goes with it, so it waits paused below
  api.on('notch:leaving', (out) => { if (out) minimize(); });

  N.tele = {
    mode: () => (!rd ? '' : rd.min ? 'paused' : 'strip'),
    size: () => STRIP,
    left: secsLeft,
    minimize,
    resume,
  };

  // ------------------------------------------------------------ 1×1 Teleprompter card (matches modules.html)
  const cards = new Set();
  let cardLoaded = false;

  function paintCard(slot) {
    const { el } = slot;
    el.style.setProperty('--tint', '#fbbf24');
    if (!data && !cardLoaded) {
      cardLoaded = true;
      load().then(refreshCards).catch(() => {});
    }
    const list = scripts();
    const cur = list.find((s) => s.id === (data && data.last)) || list[0];
    const rawLines = cur && cur.body ? cur.body.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    const l1 = rawLines[0] || _t('Type or paste your script…');
    const l2 = rawLines[1] || (cur ? estimate(cur.body) : _t('No scripts yet'));
    const l3 = rawLines[2] || '';
    el.innerHTML = `${N.hd('tele', (cur && cur.name) || _t('Teleprompter'))}`
      + `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;font-size:10.5px;line-height:1.25">`
      + `<span class="mute t1">${esc(l1)}</span><b class="t1" style="color:#fff">${esc(l2)}</b>${l3 ? `<span class="mute t1">${esc(l3)}</span>` : ''}</div>`
      + `<button type="button" class="mini-btn w" data-tpgo="1" style="position:absolute;right:10px;bottom:10px" title="${esc(_t('Start'))}">${N.ic('play')}</button>`;
    const go = $('[data-tpgo]', el);
    if (go) go.onclick = (e) => {
      e.stopPropagation();
      if (cur && stats(cur.body).words) { current = cur.id; start(); }
      else N.openModule('teleprompter');
    };
  }

  function refreshCards() {
    for (const slot of cards) {
      if (!slot.el.isConnected) { cards.delete(slot); continue; }
      paintCard(slot);
    }
  }

  N.register({
    id: 'teleprompter',
    tall: true,
    init(p) {
      page = p;
      page.innerHTML = `<div style="display:grid;grid-template-columns:170px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:10px;height:100%;width:100%">`
        + `<div class="c" style="padding:10px;gap:6px">${N.hd('tele', _t('Scripts'))}`
        + `<div class="tlp-items sc-y" style="display:flex;flex-direction:column;gap:3px;flex:1"></div>`
        + `<button type="button" class="sbtn tlp-new" style="height:28px;margin-top:auto">${N.ic('plus', 'width:11px;height:11px')}${esc(_t('New script'))}</button></div>`
        + `<div class="c" style="padding:12px 14px;gap:8px">`
        + `<div class="tlp-area" style="position:relative;flex:1;min-height:0;overflow:hidden"><div class="tlp-mirror" aria-hidden="true" style="display:none"></div>`
        + `<textarea class="sc-y" spellcheck="false" placeholder="${esc(_t('Type or paste your script, or drop a .txt file here. Lines in [brackets] are cues.'))}" style="width:100%;height:100%;background:none;border:0;outline:none;resize:none;color:#fff;font-size:14px;line-height:1.45"></textarea></div>`
        + `<div class="row" style="gap:8px;flex:none">`
        + `<button type="button" class="tlp-start" title="${esc(_t('Start'))}" style="width:36px;height:36px;border-radius:50%;background:#fff;color:#000;display:grid;place-items:center;cursor:pointer;flex:none">${N.ic('play', 'width:14px;height:14px')}</button>`
        + `<span class="tlp-chip row" data-k="speed" style="gap:4px;background:var(--pill);padding:3px 7px;border-radius:9px;font-size:11px"><button type="button" data-d="-1" style="cursor:pointer">−</button><b class="n">1.0×</b><button type="button" data-d="1" style="cursor:pointer">+</button></span>`
        + `<span class="tlp-chip row" data-k="size" style="gap:4px;background:var(--pill);padding:3px 7px;border-radius:9px;font-size:11px"><button type="button" data-d="-1" style="cursor:pointer">A−</button><b class="n">22</b><button type="button" data-d="1" style="cursor:pointer">A+</button></span>`
        + `<button type="button" class="sbtn tlp-cd" style="height:26px;padding:0 9px;font-size:11px">3s</button>`
        + `<span class="tlp-count sub t1" style="margin-inline-start:auto;font-size:10.5px"></span>`
        + `<span class="tlp-private" hidden></span>`
        + `</div></div></div>`;
      ta = $('textarea', page);
      mirror = $('.tlp-mirror', page);
      $('.tlp-new', page).onclick = () => { add(); N.focusField(ta); };
      $('.tlp-items', page).addEventListener('click', (e) => {
        const li = e.target.closest('.tlp-li');
        if (!li || e.target.closest('.tlp-ren')) return;
        const a = e.target.closest('[data-a]');
        const id = li.dataset.id;
        if (a && a.dataset.a === 'ren') { renaming = id; delArm = null; renderList(); return; }
        if (a && a.dataset.a === 'del') {
          if (delArm === id) { delArm = null; remove(id); return; }
          delArm = id; renderList();
          N.later('teleDel', 3000, () => { if (delArm === id) { delArm = null; renderList(); } });
          return;
        }
        if (id !== current) select(id);
      });
      // the name: Enter or a click elsewhere keeps it, Esc leaves it as it was (and doesn't close Sympony)
      $('.tlp-items', page).addEventListener('keydown', (e) => {
        if (!e.target.classList.contains('tlp-ren')) return;
        if (e.key === 'Enter') { e.preventDefault(); rename(renaming, e.target.value); }
        else if (e.key === 'Escape') { e.stopPropagation(); renaming = null; renderList(); }
      });
      $('.tlp-items', page).addEventListener('focusout', (e) => {
        // (not when the list is drawn again under it)
        if (e.target.classList.contains('tlp-ren') && e.target.isConnected && renaming) rename(renaming, e.target.value);
      });
      ta.addEventListener('input', () => {
        if (!current) { // typing into the empty editor starts a script
          const s = { id: uid(), name: newName(), body: ta.value, updated: Date.now() };
          data = { ...data, scripts: [s, ...scripts()], last: s.id };
          current = s.id;
          save();
          renderList();
        } else { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
        paintEditor();
      });
      ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; });
      $$('.tlp-chip[data-k] button', page).forEach((b) => {
        b.onclick = () => { const d = Number(b.dataset.d); if (b.parentElement.dataset.k === 'speed') stepSpeed(d); else stepSize(d); };
      });
      $('.tlp-cd', page).onclick = () => setPref('countdown', !prefs.countdown);
      $('.tlp-start', page).onclick = start;
      readPrefs(st.settings);
      paintBar();
      if (data) pickFirst(); else load();
    },
    show() { if (data) { if (!scripts().some((s) => s.id === current)) current = (scripts()[0] || {}).id || null; select(current); } paintBar(); },
    hide() {
      flush();
      // Sympony closing on a name being typed keeps it
      const input = renaming && $('.tlp-ren', page);
      if (input) rename(renaming, input.value);
      renaming = null; delArm = null;
    },
    onSettings(s) {
      readPrefs(s);
      paintBar();
      refreshCards();
      // turned off in Settings → Modules while it reads
      if (rd && !(s.modules || []).some((m) => m.id === 'teleprompter' && m.on)) stop();
    },
    takeFiles,
    card(el, size) {
      const slot = { el, size };
      cards.add(slot);
      N.cardClick(el, () => N.openModule('teleprompter'));
      paintCard(slot);
    },
    refreshCards,
  });
})();
