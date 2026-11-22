import type { Row } from "../rows/types.ts";

export const LIVE_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "What Sympony shows while it’s closed. When several things are going on, they take turns.",
  },
  {
    t: "toggle",
    k: "liveActivity",
    label: "Live activities while Sympony is closed",
  },
  {
    t: "toggle",
    k: "liveRotate",
    label: "Rotate between activities",
    sub: "Every 6 seconds",
  },
  {
    t: "toggle",
    k: "liveSources.music",
    label: "Music",
    sub: "Album art + visualizer while playing",
  },
  {
    t: "toggle",
    k: "liveSources.pomodoro",
    label: "Pomodoro, timer and stopwatch",
  },
  {
    t: "toggle",
    k: "liveSources.system",
    label: "System summary now and then",
    sub: "CPU and GPU (with their temperatures when the PC shares them), memory, disk, network speed and Wi-Fi signal pop up for a few seconds, like a notification, then whatever was showing comes back",
  },
  {
    t: "select",
    k: "sysPeekEvery",
    label: "Show the System summary every",
    options: [
      [30, "30 seconds"],
      [60, "1 minute"],
      [120, "2 minutes"],
      [300, "5 minutes"],
      [600, "10 minutes"],
      [1800, "30 minutes"],
    ],
  },
  {
    t: "toggle",
    k: "liveSources.calendar",
    label: "Events starting within 15 minutes",
  },
  {
    t: "toggle",
    k: "liveSources.bluetooth",
    label: "Bluetooth connect / disconnect / low battery",
  },
  {
    t: "toggle",
    k: "liveSources.todo",
    label: "Todo deadlines",
    sub: "Counts down the next task due within an hour. The alert when a task is due always shows.",
  },
  {
    t: "toggle",
    k: "sneakPeek",
    label: "Sneak peek on song change",
    sub: "Briefly shows the title under Sympony",
  },
  {
    t: "toggle",
    k: "hoverMediaControls",
    label: "Hover-reveal ⏮ ⏯ ⏭ while Sympony is closed",
    sub: 'Works when "Open on hover" is off',
  },
];

export const EFFECTS_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Little animations around Sympony and the Dock. Turn each one on or off here; they don’t follow Windows’ animation effects.",
  },
  {
    t: "toggle",
    k: "fxGlow",
    label: "Glowing outline for alerts",
    sub: "A thin light runs round the closed Sympony for reminders, events, charging, Pony answers and low battery, in their color",
  },
  {
    t: "toggle",
    k: "fxTimerLine",
    label: "Timer outline",
    sub: "While a Timer or Pomodoro runs, a light round the closed Sympony shortens with the time left",
  },
  {
    t: "toggle",
    k: "fxGenie",
    label: "Windows and popups come out of their Dock icon",
    sub: "A window minimized or brought back with a click on its Dock icon, an app’s window list, the tray icons and the menus stretch out of the icon and back into it",
  },
  {
    t: "toggle",
    k: "fxShelfFly",
    label: "Files fly into the Shelf",
    sub: "A file you drop on Sympony shrinks into the Shelf",
  },
  {
    t: "toggle",
    k: "fxNotifStack",
    label: "Stacked notifications",
    sub: "Notifications pile up under Sympony; swipe one sideways to dismiss it",
  },
  {
    t: "toggle",
    k: "fxTabSlide",
    label: "Tabs slide in from their side",
    sub: "Picking a tab to the right slides it in from the right, and the other way round",
  },
  {
    t: "toggle",
    k: "fxHudBounce",
    label: "Volume bar bounces at the ends",
    sub: "A volume key pressed at 0% or 100% stretches the bar a little (with HUD → Take over volume keys)",
  },
  {
    t: "toggle",
    k: "fxKaraoke",
    label: "Karaoke lyrics",
    sub: "The line being sung fills with color as it goes (timed lyrics only)",
  },
  {
    t: "toggle",
    k: "fxCelebrate",
    label: "Celebrate a done day",
    sub: "Confetti from Sympony when the last task due today is ticked off",
  },
];

export const CURSOR_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Cute mouse pointers in every app: a paw arrow, a paw for links, a ball of yarn while something loads, and the rest of the set to match. Or use a cursor pack you downloaded. Your own Windows pointers come back when you turn this off or quit Sympony.",
  },
  {
    t: "select",
    k: "cursorTheme",
    label: "Pointers",
    options: [
      ["off", "Windows (off)"],
      ["ginger", "Ginger paws"],
      ["black", "Black paws"],
      ["white", "White paws"],
      ["gray", "Gray paws"],
      ["calico", "Calico paws"],
      ["pink", "Pink paws"],
      ["mint", "Mint paws"],
      ["custom", "My own cursor pack"],
    ],
  },
  {
    t: "range",
    k: "cursorScale",
    label: "Size",
    sub: "Of the pointer size set in Windows (Settings → Accessibility → Mouse pointer). Windows draws every pointer at that size, so Sympony’s stay sharp up to 100%; for bigger ones, make them bigger there.",
    min: 40,
    max: 100,
    step: 5,
    unit: "%",
  },
  { t: "custom", id: "cursor", windowsOnly: true },
];

export const WALLPAPER_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "A moving wallpaper behind your desktop icons: a video (MP4, MKV, WebM) or a picture, on every display. It plays without sound on the graphics card.",
  },
  {
    t: "custom",
    id: "wallpaper",
    label: "Moving wallpaper",
    sub: "Turning it off brings back your Windows wallpaper.",
    windowsOnly: true,
  },
  {
    t: "select",
    k: "wallpaperFit",
    label: "Fit",
    options: [
      ["fill", "Fill"],
      ["fit", "Fit"],
      ["stretch", "Stretch"],
      ["center", "Center"],
    ],
  },
  { t: "h2", text: "Pause" },
  {
    t: "lead",
    html: "It always stops while the PC is locked or the screen is off, and goes on where it was.",
  },
  {
    t: "toggle",
    k: "wallpaperPauseFullscreen",
    label: "While an app is fullscreen",
    sub: "Stops while a game, a video or another fullscreen app runs.",
  },
  {
    t: "toggle",
    k: "wallpaperPauseCovered",
    label: "While a window covers the screen",
    sub: "A maximized window hides it anyway.",
  },
  {
    t: "toggle",
    k: "wallpaperPauseBattery",
    label: "On battery",
    sub: "Plays again when the PC is plugged in.",
  },
];

export const GITHUB_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "See pull requests waiting for your review (and optionally your own) right in Sympony.",
  },
  { t: "toggle", k: "githubEnabled", label: "GitHub module" },
  { t: "custom", id: "githubToken", label: "Personal access token" },
  {
    t: "toggle",
    k: "githubIncludeMine",
    label: "Also show pull requests I opened",
  },
  {
    t: "lead",
    html: "Remember to enable the GitHub tab in <b>Modules</b>.",
  },
];
