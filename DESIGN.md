# DESIGN.md

Sympony's design system (pure 2D OLED notch + carousel), written down from what `frontend/*.css`, `notchkit.js`, `carousel.js`, and `notch.js` implement. New UI follows this. If the code and this file disagree, the code wins: fix this file.

Look: pure OLED black (`#000`), flat 2D surfaces (`#0f0f12` tiles, `#17171c` pills), rounded tabular numerals, crisp hierarchy. No glass, no backdrop blur, no inner shadows, no decorative glows (Pony's cyan eyes in idle are the sole glow exception; media waves stay only on the Musik page behind the notch).

## 1. Tokens

Defined on `:root` in `notch.css` (the notch, carousel, and modules) and `dock.css` (the dock). Use the variable, never the literal value. Default Settings lives in `settings-ui/` (Light / Dark / System themes, built to `frontend/settings-dist/`); `settings.css` styles the classic fallback (`SYMPONY_SETTINGS_UI=classic`).

### Color: `notch.css`

| Token | Value | Use |
|---|---|---|
| `--oled` | `#000` | notch shell fill (OLED-only; old Look values migrate to `black`) |
| `--tile` | `#0f0f12` | card / tile surface (`border-radius: 22px`) |
| `--pill` | `#17171c` | inset blocks, sliders, secondary buttons, code pills |
| `--pill-hi` | `#1f1f27` | elevated pill / hover surface |
| `--text` | `#ffffff` | primary text |
| `--dim` | `#868692` | secondary text, labels, icons at rest |
| `--mute` | `#52525c` | tertiary hints, shortcut badges |
| `--klein` | `#4361ff` | Sympony brand accent (active toggles, links) |
| `--lav` | `#8fa2ff` | soft brand lavender (focus/today/AI highlights) |
| `--sky` | `#60a5fa` | tasks, water, links |
| `--emerald` | `#4ade80` | prayer, battery healthy, phone transfer |
| `--amber` | `#fbbf24` | weather sun, pending HITL count, calendar |
| `--red` | `#ff6b5e` | focus timer, destructive, high-load alert |
| `--lilac` | `#c9b6ff` | day progress, design files |
| `--accent`, `--accent2` | `67, 97, 255` / `143, 162, 255` | **RGB triplets** from album art at runtime (warmed at night) for waves/progress |

### Capacity Meter Scale (`NotchKit.meter(pct, inverse)`)

Used for every capacity/health gauge (CPU, memory, disk, temperature as % of 100 °C, AI usage, battery inverse):

| Token | Value | Normal load | Inverse (battery) |
|---|---|---|---|
| `--m1` | `#4ade80` | `< 50 %` | `>= 50 %` |
| `--m2` | `#facc15` | `50–69 %` | `31–49 %` |
| `--m3` | `#fb923c` | `70–84 %` | `16–30 %` |
| `--m4` | `#ff6b5e` | `>= 85 %` | `<= 15 %` |

Progress toward a goal (tasks, water, pomodoro, day progress) uses its feature color (`--sky`, `--red`, `--lilac`), not the meter scale.

### Color: `dock.css`

The dock has its own set (`--bar*`, `--pop*`, `--tile-*`, `--plate*`, `--dot*`, `--mark*`), with a light block below it. Use the dock's own tokens in the dock, and don't import the notch's.

### Typography

- Body family: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Inter", system-ui, sans-serif`.
- Numerals (`.n`, `.clk`): `--round` (`"SF Pro Rounded", ui-rounded, ...`) with `font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em`.
- Code/commands (`.mc-code`): `ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`.
- Base size: `13px`. Hero stats `20–44px`, card titles `13–14px`, body `12–13px`, meta `.sub` / `.lbl` `11–11.5px`.

### Spacing & Radius

- Outer carousel view inset: `14px` sides, `40px` top row, `14px` bottom padding (`272px` open height). Separate floating menu notch (`#pill`) sits `8px` below `#notch` (`40px` tall, `22px` radius). Grid gaps: `10px`.
- Shell radius: `38px` open (top notch), `28px` open (island / drawer), `16–18px` closed pill, `26px` closed alert, `3px` hairline tuck (`120×5`) & drawer handle (`5×64`).
- Nested radii: `22px` (`.tile` cards, `#pill`), `16–18px` (compact rows, drop tiles), `10–13px` (buttons, code pills, toggles), `50%` (rings, circular icon buttons).

### Motion

| Token | Value | Use |
|---|---|---|
| `--spring` | 49-pt `linear()` from `NotchKit.springCurve()` (`--spring-dur`, ~0.68s) | opening shell, pop-ins, bubble snap (falls back to `--smooth` under `prefers-reduced-motion`) |
| `--smooth` | `cubic-bezier(.32, .72, 0, 1)` | closing shell (`0.4s`), dashboard pages, dashboard ⇄ section & section ⇄ section slides (`0.5s`), no overshoot |

- Strict motion rule: inside the open notch, **transitions are slides only** (`transform` only, `0.5s`, `--smooth`, never fades/scale/stagger). Sliders use `scaleX(var(--v))`, carousel track uses `translate3d`. Never animate `filter`, `blur`, `width`, `height`, or CSS gradients inside cards.

## 2. Components

### Open Notch Views, Sections & Floating Menu Notch (`notchkit.js`, `carousel.js`, `carousel.css`)
- **Fixed open height (`272 px`)**: `40 px` top row + `218 px` stage (`#stage`, width `--sw = expandedWidth − 28`) + `14 px` bottom padding (bottom radius `38 px`). Never resizes between pages or sections.
- **Floating menu notch (`#pill`, outside `#notch`)**:
  - Separate `40 px`-tall pill, `8 px` below `#notch`, `22 px` radius, pure `#000`, `box-shadow: 0 12px 34px rgba(0, 0, 0, .5)`, centred on `#notch`, `width: max-content` (horizontal scroll inside `#dock` if wider than the main notch).
  - Contains the ON module icon dock (`#dock`, `34×30` hit targets, white `#fff`/`#000` pill on active module) in BOTH `"modules"` and `"dashboard"` views (click opens/slides to that module's section).
  - Hidden by default (`opacity: 0; transform: translateX(-50%) translateY(-14px) scale(.94); pointer-events: none`); springs in (`transform .45s cubic-bezier(.34,1.2,.5,1), opacity .2s ease`) when the pointer enters the bottom ~`36 px` of `#notch` (`#hotzone`) or `#pill`, hides `280 ms` after leaving both; keyboard focus inside `#pill` keeps it visible; pressing `1–9` / `←` / `→` reveals it briefly (`1.2 s`).
  - **Hit-test & click-through**: `notch.js` `layout()` includes `#pill` (plus an `8 px` gap bridge so moving from `#notch` to `#pill` never triggers mouse-leave close) in `vis` **only while `#pill` is shown**; when hidden, clicks below the `272 px` notch pass through.
  - Tooltip (`#dockTip`): pure `#000` pill with `#262630` border, positioned below `#pill` (or above if near the window bottom), clamped inside window bounds.
- **Default view (`notchView: "modules"`, one module = one page)**:
  - Horizontal carousel of full-width `--sw × 218` sections, one per ON module in `Settings → Modules` order (`NotchKit.sectionOrder(enabledIds, { hitl })`, keeping `home` in its position and prepending `hitl` first while agent approvals are pending).
  - Top row: battery ring + date + time on the left with a small dim active-module icon + name right next to the time (no back button); music bars, collapse chevron, Settings gear on the right.
  - Navigation: 1:1 pointer drag, horizontal trackpad swipe, side hover arrows, `←/→` keys, `1–9` number keys, `#pill` icon clicks (sliding in module order, `0.5s var(--smooth)`). Opening the notch restores the last viewed module in session memory (defaulting to the first ON module). `Esc` leaves a focused input first, then closes the notch.
- **Optional Dashboard view (`notchView: "dashboard"`, selectable in Settings → Modules)**:
  - Keeps the `4×2` packed card grid (`NotchKit.CARD_SIZES`, `NotchKit.packCards`, flat `--tile` `#0f0f12` cards with `10 px` `--card-gap`), click-to-open `#sec` sections with `‹` back, and the same floating `#pill` module icon dock (`Esc` steps `input → section → dashboard → close`).
- **Overflow discipline**: every list inside a section either caps rows to what fits (e.g. Weather: 24h chart + 5 daily rows) or scrolls cleanly inside its tile (`grid-template-rows: minmax(0, 1fr)`, `.sc-y` with hidden scrollbar) so nothing ever clips beneath the tile edge.

### Rings, Meters, App Icons & Split Bubble (`notch.js`, `notchkit.js`, `notch.css`)
- **SVG Rings (`N.ring(pct, color, size, sw, inner)`)**: flat stroke SVG (`track #1e1e25`, `stroke-linecap: round`, `pathLength="100"`), rotated `-90deg`.
- **Real App Icons (`N.appIconImg(src, size, radius, fallback)`)**: loads genuine macOS app icons via `notch.appIcon(bundleId)` (music source chips, calendar meeting apps, HITL agents via `NotchKit.agentBundle`, notification history); falls back cleanly to a monochrome glyph badge if missing.
- **Split Bubble (`#bubble`)**: 34×32 OLED pill (36×36 round `.isl` on Island form) beside the closed notch for the 2nd persistent live activity (`NotchKit.splitActivities`); clicking swaps main and bubble activities.
- **Shell Forms (`NotchKit.shellState`)**: single visibility/form state (`pill`, `alert`, `open`, `summoned`, `tuck` 120×5 hairline, `handle` 5×64 drawer edge, `aside` step-aside, `hidden` off-screen). Supports `notch`, `notch + reserveTop`, `island`, `drawer`, and `hidden` (shortcut summon flow).
- **Pony Face, Moods & Peek (`pony.js`, `notchkit.js`, `notch.js`, `notch.css`)**:
  - **Mood precedence (`NotchKit.ponyMood`)**: `attention` (Pony asking or any card waiting) > `think` (turn running) > `done` (4.5 s after reply) > `music` (media playing) > `sleep` (idle ≥ 10 min or locked) > `idle`.
  - **Idle-notch eyes (`ponyFace`, default `true`)**: glowing cyan eyes beside the camera when closed and idle — default blink in `idle`, squinted up-right in `think`, widened in `attention`, curved smile arcs (`^ ^`) in `done`/`music`, shut arcs (`◡ ◡ z`) in `sleep`.
  - **Peek body (`#ponyPeek`, `ponyPeek`, default `true`)**: `76×58` canvas host rendered by `window.Pony` below the closed notch. Triggers on cursor within `60 px` of the closed notch's lower edge, on `done`, and on `attention` only when no card is showing (a showing card suppresses the peek). Hides after `3 s` or on pointer leave. Hit rect (`layout()`) grows **only while shown**; off under `prefers-reduced-motion` or `ponyPeek: false`.
  - **Motion & idle budget**: DOM transitions use `transform` / `opacity` only; `window.Pony.mount()` stops `requestAnimationFrame` completely once springs settle at rest (`≤ 2` rAF calls over 2 s), waking only on blink timers or state/cursor changes. Under `prefers-reduced-motion`, hops/bounces and peek are disabled while glance/blink stay quiet.
- **Voice Listening Pill (`notch.js`, `notchkit.js`, `notch.css`)**:
  - Outranks music and timers in the closed notch (`hasVoice`) at a fixed `420 px` width across every voice state (no width jump between states).
  - **Listening**: pulsing red mic dot (`--red`, always visible in every capturing frame), `mm:ss` timer, centered clock, `ID`/`EN`/`AUTO` chip, 24 waveform bars driven by `NotchKit.voiceBars(rmsHistory, 24)` (`transform: scaleY` only), and a single scrolling live-text line (last ~48 chars, new words fade in via `opacity`/`transform`; hidden when `voiceLive` is off).
  - **Transcribing**: mic dot stops, shimmer line (`transform: translateX` only) + `"Menulis…"`, live text dimmed; Pony idle eyes switch to `think`.
  - **Done**: final inserted text shown on one line for `1.2 s`, then retracts.
  - **Error**: one-line error with optional inline action button (`Download` / `Open Settings`), `2.5 s` timeout.
  - **Cancel**: retracts immediately without waiting.
  - Under `prefers-reduced-motion: reduce`, dot pulse, shimmer sweep, and word fade animations disable cleanly while the mic dot, waveform bars, and text remain clear.

### Legacy / Full-View Shared Bits (`modules.css`)

Reuse these inside module full views before writing new CSS:

| Class | What it is |
|---|---|
| `.mod-page` | a module's full-view page; column, `gap: 12px` |
| `.card` + `.card-title` | grouped content block (`--tile`, `r22`) with an uppercase dim title (icon + text) |
| `.btn` / `.pill-btn` | rounded buttons (`.primary` = white fill, black ink) |
| `.seg` | segmented control (`--pill` track; `button.on` active) |
| `.field` | text input / textarea (`--pill` surface, Klein focus outline) |
| `.empty-state` | centered icon (22px) + one line of dim text; every list needs one |
| `.scroll` | vertical scroll area with a thin scrollbar |
| `.muted`, `.small`, `.n` | text & rounded tabular numeral helpers |

Icons: Font Awesome 6 Free through `N.fa(name, style)`, `'solid'` by default and `'regular'` for outlined or idle states. Special glyphs live in `icons.js` (`ICONS.*`).
Feedback: `N.toast(iconHtml, text, { color, ms })` (open header pill, closed HUD). Don't build a custom toast.

## 3. Module pattern

Each feature is one IIFE in `modules/<id>.js`, loaded by a `<script>` in `notch.html`, styled in `modules.css`
under a prefix of its own.

```js
(function () {
  const { st, api, $, $$, esc, fa } = N;
  let page;
  function render() {
    $('.items', page).innerHTML = list().map((x) => `<div class="xx-li" data-id="${x.id}">${esc(x.name)}</div>`).join('')
      || `<div class="empty-state">${fa('inbox')}<span>${_t('Nothing yet')}</span></div>`;
    $$('.xx-li', page).forEach((el) => { el.onclick = () => open(el.dataset.id); });
  }
  N.register({
    id: 'xx',            // tab id; also the store name for N.saveStore('xx', …)
    init(p) { page = p; page.innerHTML = `…`; render(); },  // runs once, lazily, the first time the tab opens
    show() {}, hide() {},  // optional: tab shown / hidden
    update(data) {},       // optional: notch.js pushes fresh state (bluetooth, stats, notifs…) via callModule
    usesArrows() { return false }, // optional: true to claim ←/→ keys
  });
})();
```

Rules:
- **Class prefix per module**: a short prefix (`ch-` chat, `fc-` flashcards, `bm-` bookmarks, `rd-` radio…) on every
  class except the shared ones. Global CSS has no scoping, and the prefix is the only isolation.
- **`esc()` every external string** that goes into `innerHTML`, including song titles, notifications, event names, AI replies, and
  user notes. `_t()` strings are trusted.
- **Every visible string goes through `_t('English text')`** (`i18n.js`), and dates through `_tLocale()`.
- **User and app text gets `unicode-bidi: plaintext`**: add its selector to the list at the top of `notch.css`.
- Persist with `N.saveStore(id, value)` and read with `N.data[id]`. Save while typing behind a short debounce (see notes.js).
- Re-render the part that changed. Keep focused inputs out of re-rendered `innerHTML`, or call
  `N.focusField(el)` afterwards.

## 4. Constraints that shape design here

- **Slot budget**: keep edited frontend assets compact. New UI is paid for by
  trimming in the same file. Prefer reusing shared classes over new CSS, and no new files or libraries.
- **Size of the open notch**: content lives in a small dark rounded panel at the top of the screen. Design for one glance:
  one primary action per view, with secondary actions in hover or context menus.
- **Click-through**: the notch window only takes the mouse inside the hit-rect it reports. Anything drawn outside
  the shell (popovers, bubbles) must go through `N.layout()` so its area is included.
