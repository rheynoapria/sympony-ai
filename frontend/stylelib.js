// Sympony Module Styling Library — declarative layout templates, quick packs, surface tokens,
// and allowed Dashboard 4×2 grid sizes shared across the notch runtime and modules.
(function () {
  const CARD_SURFACES = ['oled', 'borderless', 'outline', 'glass', 'tinted'];
  const CARD_RADII = ['sharp', 'rounded', 'soft'];
  const CARD_DENSITIES = ['compact', 'balanced', 'airy'];

  const SIZE_HEIGHTS = {
    compact: 148,
    standard: 204,
    tall: 272,
  };

  // Allowed Dashboard 4×2 grid sizes per module (first entry is the default from NotchKit.CARD_SIZES).
  const ALLOWED_GRID_SIZES = {
    home: ['4x2', '2x2'],
    prayer: ['1x2', '2x1', '1x1', '2x2'],
    calendar: ['2x2', '2x1', '1x2'],
    chat: ['2x1', '2x2', '1x1'],
    todo: ['2x1', '2x2', '1x2', '1x1'],
    control: ['2x1', '2x2', '1x1'],
    shelf: ['2x1', '2x2', '1x1'],
    stats: ['2x1', '2x2', '1x1'],
    translate: ['2x1', '2x2', '1x1'],
    notifs: ['2x1', '2x2', '1x2', '1x1'],
    launcher: ['2x1', '2x2', '1x1'],
    feed: ['2x1', '2x2', '1x1'],
    hitl: ['2x1', '2x2'],
    notes: ['1x1', '2x1', '1x2', '2x2'],
    pomodoro: ['1x1', '2x1', '1x2', '2x2'],
    weather: ['1x1', '2x1', '1x2', '2x2'],
    health: ['1x1', '2x1', '2x2'],
    dayprogress: ['1x1', '2x1'],
    aiusage: ['1x1', '2x1'],
    screentime: ['1x1', '2x1', '2x2'],
    bluetooth: ['1x1', '2x1', '2x2'],
    github: ['1x1', '2x1', '2x2'],
    radio: ['1x1', '2x1', '2x2'],
    bookmarks: ['1x1', '2x1', '2x2'],
    worldclock: ['1x1', '2x1', '2x2'],
    teleprompter: ['1x1', '2x1'],
  };

  // Phase 1 pilot modules with 3 genuinely distinct visual layouts each.
  const MODULE_STYLES = {
    prayer: [
      {
        id: 'bento',
        title: 'Bento Sun-Arc',
        sub: 'Sun-path arc, Qibla compass and full 5-prayer list',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'timeline',
        title: 'Compact Timeline',
        sub: 'Sleek countdown left with a 5-point horizontal prayer timeline',
        height: 160,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'focus',
        title: 'Minimal Countdown',
        sub: 'Giant centered countdown with a slim 5-prayer strip below',
        height: 144,
        surface: 'borderless',
        pack: 'minimal',
      },
    ],
    home: [
      {
        id: 'bento',
        title: 'Album Wave Studio',
        sub: 'Artwork, 3-line lyrics, audio output and gradient waves',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'strip',
        title: 'Compact Strip',
        sub: 'Single-row sleek player with scrubber, controls and equalizer',
        height: 132,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'cover',
        title: 'Cover Focus',
        sub: 'Hero album artwork with bold editorial typography',
        height: 212,
        surface: 'oled',
        pack: 'minimal',
      },
    ],
    weather: [
      {
        id: 'bento',
        title: '3-Tile Forecast',
        sub: 'Hero temperature, 24-hour curve and 5-day outlook',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'horizon',
        title: 'Compact Horizon',
        sub: 'Current weather left with a horizontal forecast ribbon right',
        height: 156,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'minimal',
        title: 'Big Temp Minimal',
        sub: 'Oversized temperature, high/low and conditions on one canvas',
        height: 136,
        surface: 'borderless',
        pack: 'minimal',
      },
    ],
    calendar: [
      {
        id: 'bento',
        title: 'Month + Agenda',
        sub: 'Full monthly calendar left with selected day agenda right',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'today',
        title: 'Compact Today',
        sub: 'Large calendar date badge left with today’s events right',
        height: 164,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'week',
        title: 'Week Strip',
        sub: 'Interactive 7-day strip across the top with agenda below',
        height: 172,
        surface: 'borderless',
        pack: 'minimal',
      },
    ],
    pomodoro: [
      {
        id: 'bento',
        title: 'Ring Studio',
        sub: 'Progress ring, mode switcher, presets and focus sound',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'digital',
        title: 'OLED Digital',
        sub: 'Bold digital timer left with progress bar and quick controls',
        height: 152,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'strip',
        title: 'Minimal Focus Strip',
        sub: 'Ultra-slim single-row focus timer with play and skip controls',
        height: 124,
        surface: 'borderless',
        pack: 'minimal',
      },
    ],
    control: [
      {
        id: 'bento',
        title: 'Classic Control',
        sub: 'Full toggle tiles, vertical sliders and inline sound output list',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'minimal',
        title: 'Minimal OLED',
        sub: 'Compact icon toggles, output switcher pill and sleek horizontal sliders',
        height: 140,
        surface: 'borderless',
        pack: 'minimal',
      },
      {
        id: 'pill',
        title: 'Ultra-Slim Dock',
        sub: 'Single-row bar with core toggles, inline sliders and output switcher',
        height: 118,
        surface: 'borderless',
        pack: 'minimal',
      },
      {
        id: 'compact',
        title: 'Compact Split',
        sub: '2×2 quick toggles left with horizontal sliders and output strip right',
        height: 168,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'macos',
        title: 'macOS Glass Deck',
        sub: 'Connectivity stack, labeled Display & Sound sliders and 2×2 quick tiles',
        height: 196,
        surface: 'glass',
        pack: 'compact',
      },
      {
        id: 'mixer',
        title: 'Studio Mixer',
        sub: 'Audio-first dual sliders with live output switcher chips and bottom toggles',
        height: 184,
        surface: 'oled',
        pack: 'bento',
      },
    ],
    feed: [
      {
        id: 'bento',
        title: 'Reader + Pony',
        sub: 'Two-column live feed stream with filter chips and Pony Summary panel',
        height: 272,
        surface: 'oled',
        pack: 'bento',
      },
      {
        id: 'headlines',
        title: 'Compact Ticker',
        sub: 'Borderless 2-column headline cards with quick inline Pony summaries',
        height: 162,
        surface: 'borderless',
        pack: 'compact',
      },
      {
        id: 'focus',
        title: 'Briefing Spotlight',
        sub: 'Hero story and 3-bullet Pony briefing left with Next Up queue right',
        height: 192,
        surface: 'borderless',
        pack: 'minimal',
      },
    ],
  };

  const QUICK_PACKS = {
    bento: {
      title: 'Bento Studio',
      sub: 'Rich multi-card layouts (272 px)',
      cardStyle: { surface: 'oled', radius: 'rounded', density: 'balanced' },
      styles: { prayer: 'bento', home: 'bento', weather: 'bento', calendar: 'bento', pomodoro: 'bento', control: 'bento', feed: 'bento' },
    },
    compact: {
      title: 'Compact OLED',
      sub: 'Sleek borderless horizontal strips (~152 px)',
      cardStyle: { surface: 'borderless', radius: 'rounded', density: 'compact' },
      styles: { prayer: 'timeline', home: 'strip', weather: 'horizon', calendar: 'today', pomodoro: 'digital', control: 'compact', feed: 'headlines' },
    },
    minimal: {
      title: 'Minimal Focus',
      sub: 'Big typography, low clutter (~136 px)',
      cardStyle: { surface: 'outline', radius: 'soft', density: 'balanced' },
      styles: { prayer: 'focus', home: 'cover', weather: 'minimal', calendar: 'week', pomodoro: 'strip', control: 'minimal', feed: 'focus' },
    },
  };

  function stylesFor(modId) {
    return MODULE_STYLES[modId] || [];
  }

  function prefFor(settings, modId) {
    const map = settings && settings.moduleStyles && typeof settings.moduleStyles === 'object' ? settings.moduleStyles : {};
    const raw = map[modId];
    return raw && typeof raw === 'object' ? raw : {};
  }

  function styleDefFor(settings, modId) {
    const list = stylesFor(modId);
    if (!list.length) return { id: 'bento', height: 272, surface: 'oled' };
    const want = prefFor(settings, modId).style;
    return list.find((x) => x.id === want) || list[0];
  }

  function styleIdFor(settings, modId) {
    return styleDefFor(settings, modId).id;
  }

  function cardStyleOf(settings) {
    const raw = settings && settings.cardStyle && typeof settings.cardStyle === 'object' ? settings.cardStyle : {};
    return {
      surface: CARD_SURFACES.includes(raw.surface) ? raw.surface : 'oled',
      radius: CARD_RADII.includes(raw.radius) ? raw.radius : 'rounded',
      density: CARD_DENSITIES.includes(raw.density) ? raw.density : 'balanced',
    };
  }

  function gridSizesMap(settings) {
    const map = settings && settings.moduleStyles && typeof settings.moduleStyles === 'object' ? settings.moduleStyles : {};
    const out = {};
    for (const [id, pref] of Object.entries(map)) {
      if (!pref || typeof pref !== 'object' || typeof pref.gridSize !== 'string') continue;
      const allowed = ALLOWED_GRID_SIZES[id];
      if (allowed && allowed.includes(pref.gridSize)) out[id] = pref.gridSize;
    }
    return out;
  }

  const api = {
    CARD_SURFACES,
    CARD_RADII,
    CARD_DENSITIES,
    SIZE_HEIGHTS,
    ALLOWED_GRID_SIZES,
    MODULE_STYLES,
    QUICK_PACKS,
    stylesFor,
    prefFor,
    styleDefFor,
    styleIdFor,
    cardStyleOf,
    gridSizesMap,
  };

  if (typeof window !== 'undefined') window.StyleLib = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
