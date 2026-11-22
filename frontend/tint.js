// Two looks that come from main, for the notch's and the Dock's pages (loaded after bridge.js):
// Wallpaper color (Settings → General → Look, Dock → Style): main (wallcolor.rs) works out the main colour of the
// wallpaper on this window's display. Asked for when a page turns the look on, then told when the wallpaper (or the
// accent colour it falls back to) changes ('look:wall').
// Warmer colors at night (Settings → General): main (warmth.rs) says how warm Sympony's own colours are now, 0 to 1
// ('look:warm'). It goes on <html> as --warm, with the class "warm" while it's above 0, for the pages' CSS (the
// surfaces), and Tint.warmRgb warms the accent colours notch.js sets.
(function () {
  const api = window.notch;
  const root = document.documentElement;
  let label = '';
  try { label = window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label || ''; } catch (e) { /* not in Sympony */ }
  const st = { wall: null, want: false, warm: 0, fns: [] };
  const tell = (what) => st.fns.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

  function setWall(v) {
    const c = v && /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color.toLowerCase() : null;
    if (!c || c === st.wall) return;
    st.wall = c;
    tell('wall');
  }
  function setWarm(v) {
    const w = Math.max(0, Math.min(1, Number(v) || 0));
    if (w === st.warm) return;
    st.warm = w;
    root.style.setProperty('--warm', String(w));
    root.classList.toggle('warm', w > 0);
    tell('warm');
  }

  window.Tint = {
    // this display's wallpaper colour ("#rrggbb"; null until main says), asked for each time a page turns the look on
    wall(want) {
      if (want && !st.want) api.svc('wallcolor', 'get', label).then(setWall).catch(() => {});
      st.want = !!want;
      return st.wall;
    },
    warm: () => st.warm,
    // an accent colour ([r, g, b]) as warm as it is now: up to a third of the way to a warm amber
    warmRgb: (rgb) => (st.warm ? rgb.map((v, i) => Math.round(v + ([255, 166, 87][i] - v) * st.warm * 0.35)) : rgb),
    // dark text reads better than white on this colour ([r, g, b]; the contrast as WCAG counts it, as notch.js darkInk)
    darkInk(rgb) {
      const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      return (L + 0.05) / 0.062 > 1.05 / (L + 0.05);
    },
    // fn('wall') / fn('warm') when either changes
    onChange(fn) { st.fns.push(fn); },
  };
  api.on('look:wall', setWall);
  api.on('look:warm', setWarm);
  api.svc('warmth', 'get').then(setWarm).catch(() => {});
})();
