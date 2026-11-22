// Drop-down choices drawn inside the notch. A native <select> opens WebView2's own popup window, which can land
// behind other always-on-top windows (the cat, for one); this list is part of the page, so it can't.
// N.pick(button, { options: [[value, label]], value, onChange(value), icon }) turns a button into one.
(function () {
  const { $, esc, fa } = N;
  let open = null; // { menu, button, watch }

  function close() {
    if (!open) return;
    open.watch.disconnect();
    open.menu.remove();
    open.button.classList.remove('open');
    open.button.setAttribute('aria-expanded', 'false');
    open = null;
  }

  function show(button, cfg) {
    close();
    const host = $('#notch');
    const same = (v) => String(v) === String(cfg.value);
    const menu = document.createElement('div');
    menu.className = 'pick-menu scroll';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = cfg.options.map(([v, l]) => `<button type="button" role="option" data-v="${esc(String(v))}" class="${same(v) ? 'on' : ''}"><span>${esc(l)}</span>${same(v) ? fa('check') : ''}</button>`).join('');
    host.appendChild(menu);
    // Inside the notch (outside it, the mouse would count as leaving Sympony and close it): under the button, else
    // above it, else moved up over the button so every choice shows; it only scrolls when Sympony is too short.
    const h = host.getBoundingClientRect(); const b = button.getBoundingClientRect(); const pad = 8;
    const full = menu.scrollHeight; const room = h.height - 2 * pad;
    const below = h.bottom - b.bottom - pad - 4; const above = b.top - h.top - pad - 4;
    const height = Math.min(full, room);
    let top;
    if (full <= below) top = b.bottom - h.top + 4;
    else if (full <= above) top = b.top - h.top - 4 - full;
    else top = Math.max(pad, Math.min(b.bottom - h.top + 4, h.height - pad - height));
    menu.style.maxHeight = height + 'px';
    menu.style.minWidth = b.width + 'px';
    menu.style.top = top + 'px';
    menu.style.left = Math.max(pad, Math.min(b.left - h.left, h.width - menu.offsetWidth - pad)) + 'px';
    const on = $('.on', menu); if (on) on.scrollIntoView({ block: 'nearest' });
    menu.onclick = (e) => {
      const it = e.target.closest('[data-v]'); if (!it) return;
      const opt = cfg.options.find(([v]) => String(v) === it.dataset.v);
      close();
      if (opt && !same(opt[0])) cfg.onChange(opt[0]);
    };
    button.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    // Sympony closing, or the button going away (another tab), takes the list with it; a page that re-renders
    // (Prayer Times every minute) gets a new button with the same id, and the list stays with that one
    const watch = new MutationObserver(() => {
      if (!open) return;
      if (!N.st.open) { close(); return; }
      if (open.button.isConnected) return;
      const again = button.id && document.getElementById(button.id);
      if (!again || !again.offsetParent) { close(); return; }
      again.classList.add('open'); again.setAttribute('aria-expanded', 'true');
      open.button = again;
    });
    watch.observe(host, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    open = { menu, button, watch };
  }

  document.addEventListener('mousedown', (e) => { if (open && !open.menu.contains(e.target) && !open.button.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }, true);

  N.pick = function (button, cfg) {
    const cur = cfg.options.find(([v]) => String(v) === String(cfg.value));
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `${cfg.icon || ''}<span>${esc(cur ? cur[1] : String(cfg.value))}</span>${fa('chevron-down')}`;
    button.onclick = (e) => { e.stopPropagation(); if (open && open.button === button) close(); else show(button, cfg); };
    if (open && open.button === button) { button.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
  };
})();
