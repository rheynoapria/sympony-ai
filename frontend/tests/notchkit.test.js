import { describe, expect, test } from 'bun:test';

const K = require('../notchkit.js');

describe('meterLevel and meter', () => {
  test('maps load thresholds <50, <70, <85, >=85', () => {
    expect(K.meterLevel(49)).toBe(1);
    expect(K.meterLevel(50)).toBe(2);
    expect(K.meterLevel(69)).toBe(2);
    expect(K.meterLevel(70)).toBe(3);
    expect(K.meterLevel(84)).toBe(3);
    expect(K.meterLevel(85)).toBe(4);
  });

  test('maps inverse battery levels and CSS var helper', () => {
    expect(K.meterLevel(86, true)).toBe(1);
    expect(K.meterLevel(45, true)).toBe(2);
    expect(K.meterLevel(18, true)).toBe(3);
    expect(K.meterLevel(8, true)).toBe(4);
    expect(K.meter(23)).toBe('var(--m1)');
    expect(K.meter(8, true)).toBe('var(--m4)');
  });
});

describe('springCurve', () => {
  test('returns 49-point linear() spring curve with overshoot and settling duration', () => {
    const s = K.springCurve();
    expect(s.css.startsWith('linear(0,')).toBe(true);
    expect(s.css.endsWith(', 1)')).toBe(true);
    const body = s.css.slice('linear('.length, -1);
    const nums = body.split(',').map((p) => parseFloat(p.trim()));
    expect(nums.length).toBe(49);
    expect(nums[0]).toBe(0);
    expect(nums[nums.length - 1]).toBe(1);
    expect(s.dur).toBeGreaterThan(0.5);
    expect(s.dur).toBeLessThan(0.8);
    expect(nums.some((n) => n > 1)).toBe(true);
  });
});

describe('CARD_SIZES and packCards', () => {
  test('declares exact grid footprints for all 24 modules plus hitl', () => {
    expect(K.CARD_SIZES.home).toEqual([4, 2]);
    expect(K.CARD_SIZES.prayer).toEqual([1, 2]);
    expect(K.CARD_SIZES.calendar).toEqual([2, 2]);
    for (const id of ['chat', 'todo', 'control', 'shelf', 'stats', 'translate', 'notifs', 'launcher', 'hitl']) {
      expect(K.CARD_SIZES[id]).toEqual([2, 1]);
    }
    for (const id of ['notes', 'pomodoro', 'weather', 'health', 'dayprogress', 'aiusage', 'screentime', 'bluetooth', 'github', 'radio', 'bookmarks', 'worldclock', 'teleprompter']) {
      expect(K.CARD_SIZES[id]).toEqual([1, 1]);
    }
  });

  test('packs the owner ON order into 4 exact pages with backfilling and home on its own page', () => {
    const order = [
      'prayer', 'home', 'calendar', 'chat', 'todo', 'notes', 'control',
      'shelf', 'pomodoro', 'weather', 'health', 'dayprogress', 'aiusage',
      'screentime', 'stats',
    ];
    const pages = K.packCards(order);
    expect(pages.map((p) => p.cards.map((c) => c.id))).toEqual([
      ['prayer', 'calendar', 'notes', 'pomodoro'],
      ['home'],
      ['chat', 'todo', 'control', 'shelf'],
      ['weather', 'health', 'dayprogress', 'aiusage', 'screentime', 'stats'],
    ]);
    expect(pages[0].cards).toEqual([
      { id: 'prayer', x: 0, y: 0, w: 1, h: 2 },
      { id: 'calendar', x: 1, y: 0, w: 2, h: 2 },
      { id: 'notes', x: 3, y: 0, w: 1, h: 1 },
      { id: 'pomodoro', x: 3, y: 1, w: 1, h: 1 },
    ]);
    expect(pages[1].cards).toEqual([{ id: 'home', x: 0, y: 0, w: 4, h: 2 }]);
  });

  test('puts hitl 2x1 first when pending, handles empty and duplicates', () => {
    expect(K.packCards([])).toEqual([]);
    const withHitl = K.packCards(['prayer', 'notes', 'notes'], { hitl: true });
    expect(withHitl[0].cards[0]).toEqual({ id: 'hitl', x: 0, y: 0, w: 2, h: 1 });
    expect(withHitl[0].cards.map((c) => c.id)).toEqual(['hitl', 'prayer', 'notes']);
  });
});

describe('sectionOrder', () => {
  test('preserves ON order including home, prepends hitl when pending, deduplicates', () => {
    expect(K.sectionOrder([])).toEqual([]);
    expect(K.sectionOrder([], { hitl: true })).toEqual(['hitl']);
    expect(K.sectionOrder(['prayer', 'home', 'calendar', 'home', 'todo'])).toEqual([
      'prayer', 'home', 'calendar', 'todo',
    ]);
    expect(K.sectionOrder(['prayer', 'home', 'calendar'], { hitl: true })).toEqual([
      'hitl', 'prayer', 'home', 'calendar',
    ]);
  });
});

describe('splitActivities', () => {
  test('pins list[1] to bubble and rotates main across [list[0], ...list.slice(2)]', () => {
    expect(K.splitActivities([], 0)).toEqual({ main: null, bubble: null });
    expect(K.splitActivities(['music'], 3)).toEqual({ main: 'music', bubble: null });
    expect(K.splitActivities(['music', 'timer'], 1)).toEqual({ main: 'music', bubble: 'timer' });
    expect(K.splitActivities(['music', 'timer', 'prayer'], 1)).toEqual({ main: 'prayer', bubble: 'timer' });
    expect(K.splitActivities(['music', 'timer', 'prayer'], 0)).toEqual({ main: 'music', bubble: 'timer' });
  });
});

describe('shellState', () => {
  test('evaluates precedence order accurately', () => {
    expect(K.shellState({ alert: true, form: 'hidden' })).toBe('alert');
    expect(K.shellState({ open: true, fg: 'full', win: true })).toBe('open');
    expect(K.shellState({ summoned: true, form: 'hidden' })).toBe('summoned');
    expect(K.shellState({ form: 'hidden' })).toBe('hidden');
    expect(K.shellState({ win: true, fg: 'max', form: 'notch' })).toBe('tuck');
    expect(K.shellState({ win: true, fg: 'max', form: 'notch', reserveTop: true })).toBe('pill');
    expect(K.shellState({ win: true, fg: 'full', form: 'drawer' })).toBe('handle');
    expect(K.shellState({ fg: 'full', hideInFullscreen: true, form: 'notch' })).toBe('hidden');
    expect(K.shellState({ fg: 'full', form: 'notch' })).toBe('pill');
    expect(K.shellState({ autoHidden: true })).toBe('tuck');
    expect(K.shellState({ tucked: true })).toBe('tuck');
    expect(K.shellState({ form: 'drawer' })).toBe('handle');
    expect(K.shellState({ stepAside: true })).toBe('aside');
    expect(K.shellState({})).toBe('pill');
  });
});

describe('WAVES, waveTune, and agentBundle', () => {
  test('waveTune falls back to WAVES.tide and agentBundle maps agents to bundle ids', () => {
    expect(K.waveTune('x')).toEqual(K.WAVES.tide);
    expect(K.waveTune('horizon')).toEqual(K.WAVES.horizon);
    expect(K.waveTune('classic')).toEqual(K.WAVES.classic);
    expect(K.agentBundle('Claude Code')).toBe('com.anthropic.claudefordesktop');
    expect(K.agentBundle('OpenAI Codex')).toBe('com.openai.codex');
    expect(K.agentBundle('unknown-cli')).toBe('com.apple.Terminal');
  });
});

describe('ponyMood', () => {
  test('enforces precedence attention > listening > think > done > music > sleep > idle and handles reduced input', () => {
    const now = 10_000;
    // attention > listening > think (both asking and cardWaiting)
    expect(K.ponyMood({ asking: true, listening: true, thinking: true, doneUntil: now + 5000, now, playing: true, idleMs: 900_000, locked: true })).toBe('attention');
    expect(K.ponyMood({ cardWaiting: true, listening: true, thinking: true, now })).toBe('attention');
    // listening > think
    expect(K.ponyMood({ listening: true, thinking: true, doneUntil: now + 5000, now, playing: true })).toBe('listening');
    // think > done
    expect(K.ponyMood({ thinking: true, doneUntil: now + 5000, now, playing: true, idleMs: 900_000 })).toBe('think');
    // done > music
    expect(K.ponyMood({ doneUntil: now + 1000, now, playing: true, idleMs: 900_000 })).toBe('done');
    // music > sleep
    expect(K.ponyMood({ doneUntil: now - 1, now, playing: true, idleMs: 900_000, locked: true })).toBe('music');
    // sleep > idle (via idleMs >= 600000 or locked)
    expect(K.ponyMood({ now, idleMs: 600_000 })).toBe('sleep');
    expect(K.ponyMood({ now, locked: true })).toBe('sleep');
    // idle fallback and reduced input
    expect(K.ponyMood({ now, idleMs: 599_999 })).toBe('idle');
    expect(K.ponyMood({})).toBe('idle');
    expect(K.ponyMood()).toBe('idle');
  });
});

describe('voiceBars', () => {
  test('returns 24 bars with 0.08 floor on silence and clamps loud input to 1', () => {
    const silent = K.voiceBars([0, 0, 0, 0], 24);
    expect(silent.length).toBe(24);
    for (const v of silent) expect(v).toBeCloseTo(0.08, 4);

    const empty = K.voiceBars([], 24);
    expect(empty.length).toBe(24);
    for (const v of empty) expect(v).toBeCloseTo(0.08, 4);

    const loud = K.voiceBars(Array(30).fill(5.0));
    expect(loud.length).toBe(24);
    for (const v of loud) expect(v).toBe(1);

    const mid = K.voiceBars([0.05, 0.1, 0.2], 24);
    expect(mid.length).toBe(24);
    expect(mid[23]).toBeGreaterThan(mid[0]);
    expect(mid[23]).toBeLessThanOrEqual(1);
  });
});

describe('YouTube video mode', () => {
  test('ytView', () => {
    const m = { active: true, video: 'VgSWAOb7JTQ' };
    expect(K.ytView(m, {}, new Set(), new Set())).toBe(true);
    expect(K.ytView(m, { ytVideo: false }, new Set(), new Set())).toBe(false);
    expect(K.ytView(m, {}, new Set(['VgSWAOb7JTQ']), new Set())).toBe(false);
    expect(K.ytView(m, {}, new Set(), new Set(['VgSWAOb7JTQ']))).toBe(false);
    expect(K.ytView({ active: true, video: null }, {}, new Set(), new Set())).toBe(false);
    expect(K.ytView({ active: false, video: 'VgSWAOb7JTQ' }, {}, new Set(), new Set())).toBe(false);
  });
  test('sync_paused_pauses_and_no_seek_under_threshold', () => {
    expect(K.ytSync({ t: 40.5, d: 267, target: 40, npDur: 267, playing: false })).toEqual({ ad: false, seek: null, play: false });
    expect(K.ytSync({ t: 40, d: 267, target: 42, npDur: 267, playing: true })).toEqual({ ad: false, seek: 42.5, play: true });
    expect(K.ytSync({ t: 40, d: 267, target: 41.4, npDur: 267, playing: true }).seek).toBe(null);
  });
  test('ytSync spots an ad in the tab', () => {
    expect(K.ytSync({ t: 40, d: 267, target: 5, npDur: 15, playing: true })).toEqual({ ad: true, seek: null, play: false });
    expect(K.ytSync({ t: 40, d: 0, target: 5, npDur: 15, playing: true }).ad).toBe(false); // embed not loaded yet
  });
});

describe('ytCover', () => {
  test('the thumbnail covers YouTube\'s own title and pause screens', () => {
    expect(K.ytCover(-1, 0)).toBe(true);     // loading
    expect(K.ytCover(1, 1000)).toBe(true);   // playing, but YouTube still shows its title
    expect(K.ytCover(1, 2500)).toBe(false);  // playing steadily: the video
    expect(K.ytCover(2, 60000)).toBe(true);  // paused: YouTube's pause screen
    expect(K.ytCover(3, 9000)).toBe(false);  // buffering after a seek: no flash
    expect(K.ytCover(0, 9000)).toBe(true);   // ended: YouTube's end screen
    expect(K.ytCover(5, 0)).toBe(true);      // cued
  });
});

describe('ytSync while the copy settles', () => {
  test('no seek while it buffers or just after a seek (that loop never let it play)', () => {
    expect(K.ytSync({ t: 40, d: 267, target: 50, npDur: 267, playing: true, settling: true }).seek).toBe(null);
    expect(K.ytSync({ t: 40, d: 267, target: 50, npDur: 267, playing: true, settling: false }).seek).toBe(50.5);
  });
  test('a long buffer is covered, a short one is not', () => {
    expect(K.ytCover(3, 9000, 300)).toBe(false);
    expect(K.ytCover(3, 9000, 700)).toBe(true);
  });
});

describe('final review fixes', () => {
  test('ytCommand reconciles with what the player does, not the last command (I6)', () => {
    expect(K.ytCommand({ wantPlay: false, state: 1, sinceCmdMs: 5000 })).toBe('pause'); // a pause YouTube dropped
    expect(K.ytCommand({ wantPlay: true, state: 2, sinceCmdMs: 5000 })).toBe('play');
    expect(K.ytCommand({ wantPlay: true, state: 3, sinceCmdMs: 5000 })).toBe(null);  // buffering towards playing
    expect(K.ytCommand({ wantPlay: true, state: 2, sinceCmdMs: 300 })).toBe(null);   // just asked: give it time
    expect(K.ytCommand({ wantPlay: false, state: 5, sinceCmdMs: 5000 })).toBe(null); // cued, not playing
  });
  test('ytGrace keeps the player through the moment between two videos (I5)', () => {
    expect(K.ytGrace(true, 1000)).toBe(true);
    expect(K.ytGrace(true, 3500)).toBe(false);
    expect(K.ytGrace(false, 0)).toBe(false);
  });
});

describe('closed notch sizing (13-inch MacBook camera + non-camera)', () => {
  test('only playback and timer activities keep the clock beside them', () => {
    for (const k of ['music', 'pomodoro', 'timer', 'stopwatch']) {
      expect(K.isClockActivity(k)).toBe(true);
    }
    for (const k of ['event-soon', 'todo-due', 'prayer-soon', 'sys', 'fps', 'hud-volume']) {
      expect(K.isClockActivity(k)).toBe(false);
    }
  });

  test('places clock on empty side instead of adding side + clock on both wings', () => {
    // Default idle: right=battery (46px), middle=time (40px), left=empty on 220px MacBook camera
    const r = K.camClosedLayout({ camW: 220, leftW: 0, rightW: 46, clockW: 40, pad: 8, notchWidth: 200, maxW: 480 });
    expect(r.showClock).toBe(true);
    expect(r.clockRight).toBe(false);
    expect(r.width).toBe(328); // was 426px before fix!
    expect(r.clockL).toBe(8);
    expect(r.clockW).toBeGreaterThanOrEqual(40);
  });

  test('places clock on narrower side when both wings have content', () => {
    // Left=prayer (85px), right=battery (46px), middle=time (40px)
    const r = K.camClosedLayout({ camW: 220, leftW: 85, rightW: 46, clockW: 40, pad: 8, notchWidth: 200, maxW: 480 });
    expect(r.showClock).toBe(true);
    expect(r.clockRight).toBe(true);
    expect(r.width).toBe(424); // was 504px before fix!
    expect(r.clockW).toBeGreaterThanOrEqual(40);
  });

  test('keeps pomodoro/music + clock compact using actual per-side widths', () => {
    // Pomodoro: 20px ring on left, 42px timer on right, 40px clock
    const pomo = K.camClosedLayout({ camW: 220, leftW: 20, rightW: 42, clockW: 40, pad: 8, notchWidth: 200, maxW: 480 });
    expect(pomo.showClock).toBe(true);
    expect(pomo.clockRight).toBe(false);
    expect(pomo.width).toBe(372); // was 482px before fix!
    expect(pomo.clockL).toBe(34);
    expect(pomo.clockW).toBeGreaterThanOrEqual(40);

    // Music with hover controls (70px on right, 24px album art on left, 40px clock)
    const music = K.camClosedLayout({ camW: 220, leftW: 24, rightW: 70, clockW: 40, pad: 8, notchWidth: 200, maxW: 480 });
    expect(music.showClock).toBe(true);
    expect(music.clockRight).toBe(false);
    expect(music.width).toBe(380); // was 504px before fix!
  });

  test('drops clock if adding it exceeds maxW budget on compact screens', () => {
    const r = K.camClosedLayout({ camW: 220, leftW: 110, rightW: 100, clockW: 90, pad: 8, notchWidth: 200, maxW: 480 });
    expect(r.showClock).toBe(false);
    expect(r.width).toBe(456);
  });

  test('hugs camera when all closed slots are empty', () => {
    const r = K.camClosedLayout({ camW: 220, leftW: 0, rightW: 0, clockW: 0, pad: 0, notchWidth: 80, maxW: 480 });
    expect(r.width).toBe(220);
    expect(r.showClock).toBe(false);
  });

  test('closedWidthNoCam does not stack empty notchWidth on top of side * 2', () => {
    // notchWidth=200, battery=46px, time=40px (+24 gap) + 28 pad => fits inside 200px!
    expect(K.closedWidthNoCam({ notchWidth: 200, midNeed: 64, side: 46, pad: 28, maxW: 460 })).toBe(200);
    // Wider side (85px prayer): expands only to fit content cleanly (262px instead of 370px)
    expect(K.closedWidthNoCam({ notchWidth: 200, midNeed: 64, side: 85, pad: 28, maxW: 460 })).toBe(262);
  });
});

describe('Module Styling Library (resolveModuleFrame & custom Dashboard grid sizes)', () => {
  test('auto size uses style natural height and global expandedWidth', () => {
    const f = K.resolveModuleFrame({
      styleDef: { id: 'timeline', height: 188, surface: 'borderless' },
      pref: { style: 'timeline', size: 'auto' },
      expandedWidth: 660,
      maxW: 780,
      maxH: 340,
    });
    expect(f).toEqual({
      styleId: 'timeline',
      sizeMode: 'auto',
      width: 660,
      height: 188,
      stageH: 134,
      surface: 'borderless',
    });
  });

  test('size presets and custom W×H clamp safely to screen bounds', () => {
    const compact = K.resolveModuleFrame({
      styleDef: { id: 'bento', height: 272, surface: 'oled' },
      pref: { size: 'compact', surface: 'outline' },
      expandedWidth: 700,
    });
    expect(compact.height).toBe(148);
    expect(compact.stageH).toBe(98);
    expect(compact.surface).toBe('outline');

    const slim = K.resolveModuleFrame({
      styleDef: { id: 'strip', height: 124, surface: 'borderless' },
      pref: { style: 'strip', size: 'auto' },
      expandedWidth: 660,
    });
    expect(slim.height).toBe(124);
    expect(slim.stageH).toBe(74);

    const custom = K.resolveModuleFrame({
      styleDef: { id: 'timeline', height: 160, surface: 'borderless' },
      pref: { size: 'custom', width: 999, height: 90 },
      expandedWidth: 660,
      maxW: 740,
      maxH: 300,
    });
    expect(custom.width).toBe(740);
    expect(custom.height).toBe(116);
    expect(custom.stageH).toBe(66);
  });

  test('packCards respects custom per-module gridSize overrides', () => {
    const pages = K.packCards(['weather', 'prayer'], {
      sizes: { weather: '2x2', prayer: '2x1' },
    });
    expect(pages.length).toBe(1);
    expect(pages[0].cards).toEqual([
      { id: 'weather', x: 0, y: 0, w: 2, h: 2 },
      { id: 'prayer', x: 2, y: 0, w: 2, h: 1 },
    ]);
  });
});
