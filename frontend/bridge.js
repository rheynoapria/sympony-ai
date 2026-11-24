// Tauri bridge: implements the `window.notch` IPC API on top of Tauri commands and events.
(function () {
  const T = window.__TAURI__;
  if (!T || !T.core) return;
  const invoke = T.core.invoke;
  // Extended commands & events kept outside the core IPC contract (tools/extract_contract.py scans `invoke('…')` and `on('…')`).
  const symponyInvoke = (cmd, args) => T.core.invoke(cmd, args);
  const symponyListen = (channel, fn) => on(channel, fn);
  const me = T.webviewWindow.getCurrentWebviewWindow();

  // Window-scoped listeners get events targeted at this window plus broadcasts.
  const on = (channel, fn) => {
    let unlisten = null;
    let dead = false;
    me.listen(channel, (e) => fn(e.payload)).then((u) => { if (dead) u(); else unlisten = u; });
    return () => { dead = true; if (unlisten) unlisten(); };
  };
  const fire = (cmd, args) => { invoke(cmd, args).catch((e) => console.warn(cmd, e)); };
  const svc = (name, method, ...args) => invoke('svc', { name, method, args });
  let seq = 0;
  const hit = { latest: null, last: null, queued: false };
  // Self-heal: re-send the current hover area every second.
  setInterval(() => { if (hit.last) fire('notch_hitrect', { r: { ...hit.last, seq: ++seq } }); }, 1000);

  window.notch = {
    engine: 'rust',
    on,
    svc,

    // settings
    getSettings: () => invoke('settings_get'),
    setSettings: (patch) => invoke('settings_set', { patch }),
    setSecret: (key, value) => invoke('settings_secret', { key, value: value || '' }),
    resetSettings: () => invoke('settings_reset'),
    openSettings: (section) => invoke('settings_open', { section: section || null }),
    listDisplays: () => invoke('displays_list'),
    appInfo: () => invoke('app_info'),
    onSettings: (fn) => on('settings', fn),
    onSettingsSection: (fn) => on('settings:section', fn),

    // native watchers (media / volume / brightness / bluetooth …)
    helperState: () => invoke('helper_state'),
    helper: (cmd) => fire('helper_cmd', { cmd }),
    onHelper: (fn) => on('helper', fn),

    // notch window
    // Tauri invokes are independent requests and can arrive out of order, so the hover area is
    // coalesced to one call per tick and stamped with a sequence number (Rust drops stale ones).
    setHitRect: (r) => {
      hit.latest = r;
      if (hit.queued) return;
      hit.queued = true;
      queueMicrotask(() => { hit.queued = false; hit.last = hit.latest; fire('notch_hitrect', { r: { ...hit.latest, seq: ++seq } }); });
    },
    setOpened: (open) => fire('notch_opened', { open, seq: ++seq }),
    setFocus: (want) => fire('notch_focus', { want }),
    setArrows: (want) => fire('notch_arrows', { want }),
    drag: (action) => fire('notch_drag', { action }),
    // a HUD shows for `ms`: over a fullscreen app main may bring Sympony in for it (Settings → HUD → Show over fullscreen apps)
    hud: (ms) => fire('notch_hud', { ms }),
    log: (msg) => fire('log', { msg: String(msg) }),
    onHover: (fn) => on('notch:hover', fn),
    onToggle: (fn) => on('notch:toggle', fn),

    // calendar
    refreshCalendar: () => invoke('calendar_refresh'),
    requestCalendar: () => invoke('calendar_get'),
    onCalendar: (fn) => on('calendar', fn),
    openExternal: (url) => invoke('open_external', { url }),
    openCalendarApp: () => invoke('open_calendar_app'),

    // stats
    onStats: (fn) => on('stats', fn),

    // shelf
    shelfList: () => svc('shelf', 'list'),
    shelfAdd: (items) => svc('shelf', 'add', items),
    shelfRemove: (ids) => svc('shelf', 'remove', ids),
    shelfClear: () => svc('shelf', 'clear'),
    shelfOpen: (id) => svc('shelf', 'open', id),
    shelfReveal: (id) => svc('shelf', 'reveal', id),
    shelfCopy: (id) => svc('shelf', 'copy', id),
    shelfShare: (ids) => svc('shelf', 'share', ids),
    shelfPick: () => svc('shelf', 'pick'),
    shareFiles: (paths) => invoke('share_files', { files: paths }),
    shelfStartDrag: (ids) => fire('shelf_start_drag', { ids }),
    onShelfChanged: (fn) => on('shelf:changed', fn),

    // Files dragged in from Explorer: Tauri gives real paths + a position (physical px).
    onFileDrag: (fn) => {
      const wv = T.webview.getCurrentWebview();
      wv.onDragDropEvent((e) => {
        const p = e.payload;
        const scale = window.devicePixelRatio || 1;
        const pos = p.position ? { x: p.position.x / scale, y: p.position.y / scale } : null;
        fn({ type: p.type, paths: p.paths || [], pos });
      });
    },

    updateState: () => invoke('update_state'),
    updateCheck: (install) => invoke('update_check', { install: !!install }),
    updatePage: () => invoke('update_page'),
    onUpdate: (fn) => symponyListen('update:state', fn),
    appIcon: (bundleId) => symponyInvoke('app_icon', { bundleId: bundleId || '' }),
    onShellFg: (fn) => symponyListen('shell:fg', fn),
    openFloatingChat: () => symponyInvoke('floating_chat_open'),
    closeFloatingChat: () => symponyInvoke('floating_chat_close'),
    toggleFloatingChat: () => symponyInvoke('floating_chat_toggle'),
    setFloatingChatPin: (pinned) => symponyInvoke('floating_chat_pin', { pinned: !!pinned }),
    floatingChatState: () => symponyInvoke('floating_chat_state'),
    dockFloatingChat: () => symponyInvoke('floating_chat_dock'),
    openNotchModule: (module) => symponyInvoke('floating_chat_open_module', { module: String(module || 'chat') }),
    onFloatingChatState: (fn) => symponyListen('floating-chat:state', fn),
    onFloatingChatFocus: (fn) => symponyListen('floating-chat:focus', fn),
    onNotchYield: (fn) => symponyListen('notch:yield', fn),
    onNotchOpenMod: (fn) => symponyListen('notch:openMod', fn),
    onNotchDisplay: (fn) => symponyListen('notch:display', fn),
    onFeedSumDelta: (fn) => symponyListen('feed:sumDelta', fn),
    startDragging: () => (me && typeof me.startDragging === 'function' ? me.startDragging() : Promise.resolve()),
    quit: () => invoke('app_quit'),
    version: () => invoke('app_info').then((i) => i.version),
  };
})();
