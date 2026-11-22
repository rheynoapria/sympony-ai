// Cute cursors (Settings → Cursor): a cat-themed set of Windows pointers drawn here as SVG (32×32 units,
// hotspot in the same units), in a few fur colours. The notch page renders them at the size asked and hands
// them to main as PNGs (cursor.rs puts them in place for every app); Settings shows them as a preview.
(function () {
  // F fill, L outline, D lines inside a shape, B toe beans, H halo (keeps them visible on any background)
  const PALETTES = {
    ginger: { F: '#f4a142', L: '#7a4310', D: '#7a4310', B: '#ff9db0', H: '#ffffff' },
    black: { F: '#2b2b33', L: '#0c0c10', D: '#a3a3b3', B: '#ff8fae', H: '#ffffff' },
    pink: { F: '#ffb8d2', L: '#a8325f', D: '#c2457a', B: '#ff6f9e', H: '#ffffff' },
    mint: { F: '#93e6cb', L: '#1d7259', D: '#2f8f74', B: '#ff9db0', H: '#ffffff' },
    white: { F: '#f7f7fa', L: '#5f6470', D: '#8e93a0', B: '#ffb3c1', H: '#1c1c22' },
    gray: { F: '#a2a9b2', L: '#33383f', D: '#454b53', B: '#ffb3c0', H: '#ffffff' },
    calico: { F: '#faf5ee', L: '#5d4b3b', D: '#e3923f', B: '#ffb3b8', H: '#2a2420' },
  };
  // Fallback to ginger for retired cursor theme keys
  const palette = (theme) => PALETTES[theme] || PALETTES.ginger;

  // the shapes: outline under the fill, a halo under both
  const shape = (d, p, extra = '') => `<path d="${d}" fill="none" stroke="${p.H}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"${extra}/>`
    + `<path d="${d}" fill="${p.F}" stroke="${p.L}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"${extra}/>`;
  const line = (d, p, extra = '') => `<path d="${d}" fill="none" stroke="${p.H}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
    + `<path d="${d}" fill="none" stroke="${p.L}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
    + `<path d="${d}" fill="none" stroke="${p.F}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  const ARROW = 'M4 3 L4 23.5 L9.2 18.7 L12.6 26.4 L16.3 24.8 L12.9 17.2 L19.8 17.2 Z';
  // a little paw print on the arrow
  const arrowPaw = (p) => `<g fill="${p.B}"><ellipse cx="8.4" cy="15.2" rx="1.9" ry="1.5"/><circle cx="6.5" cy="12.6" r=".8"/><circle cx="8.1" cy="11.6" r=".8"/><circle cx="9.8" cy="11.9" r=".8"/><circle cx="11" cy="13.3" r=".75"/></g>`;
  const arrow = (p) => shape(ARROW, p) + arrowPaw(p);
  const yarn = (p, cx, cy, r) => {
    const k = r / 9.5; const t = (x, y) => `${(cx + (x - 16) * k).toFixed(2)} ${(cy + (y - 16) * k).toFixed(2)}`;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.H}" stroke-width="3.4"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.F}" stroke="${p.L}" stroke-width="1.5"/>`
      + `<g fill="none" stroke="${p.D}" stroke-width="${(1.1 * Math.max(k, 0.7)).toFixed(2)}" stroke-linecap="round">`
      + `<path d="M${t(8.5, 12)} C${t(13, 15)} ${t(19, 15)} ${t(23.5, 12)}"/><path d="M${t(7.6, 18)} C${t(13, 21)} ${t(20, 21)} ${t(24.5, 17.5)}"/>`
      + `<path d="M${t(12, 7.4)} C${t(15, 12)} ${t(15, 20)} ${t(12, 24.8)}"/><path d="M${t(20, 7.4)} C${t(17.4, 12)} ${t(17.4, 20)} ${t(20, 24.8)}"/></g>`;
  };
  const toe = (cx, cy, rx, ry, rot, p) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="${p.F}" stroke="${p.L}" stroke-width="1.5"/>`
    + `<ellipse cx="${cx}" cy="${cy + 0.3}" rx="${(rx * 0.55).toFixed(2)}" ry="${(ry * 0.55).toFixed(2)}" transform="rotate(${rot} ${cx} ${cy})" fill="${p.B}"/>`;
  const toeHalo = (cx, cy, rx, ry, rot, p) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="none" stroke="${p.H}" stroke-width="3.4"/>`;
  const PAD = 'M16 15.6 C20.6 15.6 23.6 19.4 23.6 22.6 C23.6 25.4 21 26.8 16 26.8 C11 26.8 8.4 25.4 8.4 22.6 C8.4 19.4 11.4 15.6 16 15.6 Z';
  const TOES = [[9.2, 13.4, 2.6, 3.1, -22], [13.6, 8.8, 2.6, 3.4, -6], [18.4, 8.8, 2.6, 3.4, 6], [22.8, 13.4, 2.6, 3.1, 22]];
  const DOUBLE = 'M3 16 L9 10.5 L9 13.6 L23 13.6 L23 10.5 L29 16 L23 21.5 L23 18.4 L9 18.4 L9 21.5 Z';
  const FOUR = 'M16 2 L21 7.5 L18 7.5 L18 14 L24.5 14 L24.5 11 L30 16 L24.5 21 L24.5 18 L18 18 L18 24.5 L21 24.5 L16 30 L11 24.5 L14 24.5 L14 18 L7.5 18 L7.5 21 L2 16 L7.5 11 L7.5 14 L14 14 L14 7.5 L11 7.5 Z';

  // role: [svg body, hotspot x, hotspot y]
  const ROLES = {
    arrow: (p) => [arrow(p), 4, 3],
    hand: (p) => [shape(PAD, p) + TOES.map(([x, y, rx, ry, r]) => toeHalo(x, y, rx, ry, r, p)).join('') + TOES.map(([x, y, rx, ry, r]) => toe(x, y, rx, ry, r, p)).join('')
      + `<path d="M16 18.6 C18.6 18.6 20.4 20.8 20.4 22.6 C20.4 24 19 24.6 16 24.6 C13 24.6 11.6 24 11.6 22.6 C11.6 20.8 13.4 18.6 16 18.6 Z" fill="${p.B}"/>`, 14, 5],
    ibeam: (p) => [line('M11.5 5 L14.6 5 Q16 5 16 6.4 Q16 5 17.4 5 L20.5 5 M16 6.4 L16 25.6 M11.5 27 L14.6 27 Q16 27 16 25.6 Q16 27 17.4 27 L20.5 27', p), 16, 16],
    wait: (p) => [yarn(p, 16, 15, 9.5) + line('M23.6 21.6 C26.5 23.5 27.6 26.4 25 28.6', p), 16, 15],
    working: (p) => [arrow(p) + yarn(p, 23, 23.5, 5.6), 4, 3],
    no: (p) => [`<circle cx="16" cy="16" r="9.6" fill="none" stroke="${p.H}" stroke-width="6.4"/><circle cx="16" cy="16" r="9.6" fill="none" stroke="${p.L}" stroke-width="5"/><circle cx="16" cy="16" r="9.6" fill="none" stroke="${p.F}" stroke-width="2.8"/>`
      + line('M9.4 22.6 L22.6 9.4', p), 16, 16],
    cross: (p) => [line('M16 4 L16 12.5 M16 19.5 L16 28 M4 16 L12.5 16 M19.5 16 L28 16', p) + `<circle cx="16" cy="16" r="1.6" fill="${p.B}" stroke="${p.L}" stroke-width=".8"/>`, 16, 16],
    move: (p) => [shape(FOUR, p), 16, 16],
    we: (p) => [shape(DOUBLE, p), 16, 16],
    ns: (p) => [shape(DOUBLE, p, ' transform="rotate(90 16 16)"'), 16, 16],
    nwse: (p) => [shape(DOUBLE, p, ' transform="rotate(45 16 16)"'), 16, 16],
    nesw: (p) => [shape(DOUBLE, p, ' transform="rotate(-45 16 16)"'), 16, 16],
    help: (p) => [arrow(p) + `<circle cx="23" cy="22.5" r="6.2" fill="${p.F}" stroke="${p.H}" stroke-width="3.4"/><circle cx="23" cy="22.5" r="6.2" fill="${p.F}" stroke="${p.L}" stroke-width="1.5"/>`
      + `<text x="23" y="26.2" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="9.5" fill="${p.L}">?</text>`, 4, 3],
  };

  const svg = (role, theme) => {
    const [body, x, y] = ROLES[role](palette(theme));
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${body}</svg>`, x, y };
  };

  // every role (or the ones asked for) as a PNG with its hotspot, for main: the image is `px` square, the size
  // Windows draws pointers at (anything else it stretches, blurry), and the shape `scale` of it from the top left
  async function render(theme, px, scale = 1, roles = Object.keys(ROLES)) {
    const out = {};
    const s = Math.max(8, Math.round(px * scale));
    for (const role of roles.filter((r) => ROLES[r])) {
      const { svg: body, x, y } = svg(role, theme);
      const img = new Image();
      img.src = 'data:image/svg+xml,' + encodeURIComponent(body.replace('width="32" height="32"', `width="${s}" height="${s}"`));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = px; c.height = px;
      c.getContext('2d').drawImage(img, 0, 0, s, s);
      out[role] = { png: c.toDataURL('image/png').split(',')[1], x: Math.round((x * s) / 32), y: Math.round((y * s) / 32) };
    }
    return out;
  }

  // what Windows calls each pointer (Settings → Cursor lists them)
  const NAMES = {
    arrow: _t('Normal'), hand: _t('Link'), ibeam: _t('Text'), wait: _t('Busy'), working: _t('Working in background'), no: _t('Unavailable'), cross: _t('Precision'),
    move: _t('Move'), we: _t('Resize ↔'), ns: _t('Resize ↕'), nwse: _t('Resize ⤡'), nesw: _t('Resize ⤢'), help: _t('Help'),
  };

  // small data-URL pictures for the Settings preview
  const previews = (theme) => Object.keys(ROLES).map((role) => ({ role, url: 'data:image/svg+xml,' + encodeURIComponent(svg(role, theme).svg) }));

  window.SymponyCursors = { THEMES: Object.keys(PALETTES), ROLES: Object.keys(ROLES), NAMES, render, previews };
})();
