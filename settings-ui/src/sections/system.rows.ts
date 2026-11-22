import type { Row } from "../rows/types.ts";
import type { OS } from "./registry.ts";

export const DROPACTIONS_KEYS: readonly string[] = [
  "dropActions",
  "phoneFolder",
  "launcherItems",
];

export const PHONE_SHARE_SUB_A =
  "The Shelf gets a Phone button: scan its QR code with your phone to send files, photos, texts and links both ways. Nothing listens until you press it.";
export const PHONE_SHARE_SUB_B =
  "Use it only on a Wi-Fi you trust, not on public Wi-Fi.";

export function dropActionsRows(os: OS): Row[] {
  const phoneLead =
    os === "macos"
      ? "Files go straight between your phone and this Mac over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard. With the macOS firewall on, it may ask to allow Sympony to accept incoming connections the first time."
      : os === "linux"
        ? "Files go straight between your phone and this PC over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard."
        : "Files go straight between your phone and this PC over the same Wi-Fi, never through the internet, and they go on the Shelf at once. Texts and links go on the clipboard. Windows may ask to allow Sympony on private networks the first time.";

  const clipboardLead =
    os === "macos"
      ? "Kept only on this Mac (<i>clipboard.json</i> and the <i>clipboard</i> folder), never in a backup. Copies that password managers mark as private are skipped, and so are files copied in Finder."
      : "Kept only on this PC (<i>clipboard.json</i> and the <i>clipboard</i> folder), never in a backup. Copies that password managers mark as private are skipped, and so are files copied in File Explorer.";

  const rows: Row[] = [
    {
      t: "lead",
      html: "Drag files onto Sympony and drop them on a tile. Dropping anywhere else puts them on the Shelf.",
    },
    { t: "toggle", k: "dropActionsEnabled", label: "Drop actions" },
    { t: "h2", text: "Tiles" },
    { t: "custom", id: "dropTiles", label: "Tiles" },
    { t: "h2", text: "Shelf" },
    { t: "toggle", k: "shelfEnabled", label: "Shelf tab" },
    {
      t: "toggle",
      k: "shelfOpenOnDrag",
      label: "Open the shelf when dragging files (if drop actions are off)",
    },
    {
      t: "toggle",
      k: "shelfRemoveAfterDrag",
      label: "Remove from shelf after dragging out",
    },
    {
      t: "lead",
      html: "The shelf only remembers where files are, so nothing is uploaded or copied. It's saved in <i>shelf.json</i>.",
    },
    { t: "h2", text: "Phone" },
    {
      t: "toggle",
      k: "phoneShare",
      label: "Send and receive with your phone",
      sub: `${PHONE_SHARE_SUB_A} ${PHONE_SHARE_SUB_B}`,
      unset: true,
    },
    {
      t: "custom",
      id: "phoneFolder",
      label: "Save files from your phone in",
    },
    { t: "lead", html: phoneLead },
  ];

  if (os !== "linux") {
    rows.push(
      { t: "h2", text: "Clipboard" },
      {
        t: "toggle",
        k: "clipboardHistory",
        label: "Remember what you copy",
        sub: "Texts, links and pictures you copy show on the Shelf: switch it to Clipboard and click one to copy it again. Turning this off clears all but the pinned ones.",
      },
      {
        t: "number",
        k: "clipboardMax",
        label: "Keep the last",
        sub: "Pinned ones don’t count (5 to 100)",
        min: 5,
        max: 100,
        step: 1,
        unit: "copies",
        unset: 30,
      },
      { t: "lead", html: clipboardLead }
    );
  }

  rows.push(
    { t: "h2", text: "App launcher" },
    { t: "custom", id: "launcher", label: "App launcher" },
    { t: "custom", id: "launcherTip", windowsOnly: true }
  );

  return rows;
}

const HUD_STYLE_ROW: Row = {
  t: "select",
  k: "hudStyle",
  label: "Style",
  options: [
    ["inline", "Inline (in Sympony)"],
    ["panel", "Panel with slider (below)"],
  ],
};

export function hudRows(os: OS): Row[] {
  if (os === "macos" || os === "linux") {
    const rows: Row[] = [
      {
        t: "lead",
        html:
          os === "linux"
            ? "Shows the volume in Sympony when it changes: the volume keys, the sound menu or an app. Your desktop shows its own volume pop-up as well."
            : "Shows the volume in Sympony when it changes: the volume keys, Control Center or an app. macOS shows its own volume pop-up as well.",
      },
      { t: "toggle", k: "hudEnabled", label: "Enable HUD" },
      {
        t: "toggle",
        k: "hudMic",
        label: "Microphone on / off",
        sub: "Shows when the microphone is muted or back on (a microphone that has a mute switch)",
      },
    ];
    if (os === "macos") {
      rows.push(
        {
          t: "toggle",
          k: "hudInputLang",
          label: "Keyboard language",
          sub: "Shows the new input source for a moment when you switch (Control + Space or the Globe key)",
        },
        {
          t: "toggle",
          k: "langMark",
          label: "Show the keyboard language in the closed Sympony",
          sub: "A small EN at the right, only when you have more than one input source",
        }
      );
    }
    rows.push(
      HUD_STYLE_ROW,
      { t: "h2", text: "Try it" },
      { t: "custom", id: "tryVolume", label: "Volume" }
    );
    return rows;
  }

  return [
    {
      t: "lead",
      html: "Replaces the standard Windows volume flyout with sliders that blend into Sympony.",
    },
    { t: "toggle", k: "hudEnabled", label: "Enable HUD" },
    {
      t: "toggle",
      k: "hudOverFullscreen",
      label: "Show over fullscreen apps",
      sub: "While Sympony hides for a fullscreen game or video, volume, brightness and the other pop-ups still show for a moment. Games in exclusive fullscreen draw over every window, so there they can’t show.",
    },
    {
      t: "toggle",
      k: "hudOverrideVolumeKeys",
      label: "Take over volume keys",
      sub: "Hides the Windows volume flyout. Sympony changes the volume in 2% steps.",
    },
    {
      t: "toggle",
      k: "hudBrightness",
      label: "Brightness HUD",
      sub: "Laptop screens (WMI) and DDC/CI monitors",
    },
    {
      t: "toggle",
      k: "hudHideWindowsOsd",
      label: "Hide Windows’ own brightness pop-up",
      sub: "Experimental. A laptop’s brightness keys always make Windows show its pop-up too; Sympony finds it the first time it shows and hides it from then on.",
    },
    {
      t: "toggle",
      k: "hudHideMakerOsd",
      label: "Hide the laptop maker’s pop-ups",
      sub: "Experimental. The boxes your laptop’s own app shows for the mic, airplane or Caps Lock key (Lenovo, ASUS, HP…) are hidden while Sympony shows the same thing. Ones Sympony can’t show, like some touchpad keys, still appear.",
    },
    {
      t: "toggle",
      k: "hudLockKeys",
      label: "Caps Lock, Num Lock and Scroll Lock",
      sub: "Shows On or Off for a moment when you press one",
    },
    {
      t: "toggle",
      k: "hudInputLang",
      label: "Keyboard language",
      sub: "Shows the new language for a moment when you switch (Windows + Space)",
    },
    {
      t: "toggle",
      k: "hudMic",
      label: "Microphone on / off",
      sub: "Shows when the microphone is muted or back on: a laptop’s mic key, Windows + Alt + K, an app",
    },
    {
      t: "toggle",
      k: "hudTouchpad",
      label: "Touchpad on / off",
      sub: "Shows when a laptop’s touchpad key turns the touchpad off or on (when the key tells Windows; some makers’ keys don’t)",
    },
    {
      t: "toggle",
      k: "hudAirplane",
      label: "Airplane mode",
      sub: "Shows On or Off for a moment when it’s switched, also with a laptop’s airplane key, and whether Wi-Fi and Bluetooth went with it",
    },
    {
      t: "toggle",
      k: "capsLockMark",
      label: "Keep a mark while Caps Lock is on",
      sub: "A small A at the left of the closed Sympony, so you notice before you type",
    },
    {
      t: "toggle",
      k: "langMark",
      label: "Show the keyboard language in the closed Sympony",
      sub: "A small ENG at the right, only when you have more than one keyboard language",
    },
    HUD_STYLE_ROW,
    { t: "h2", text: "Try it" },
    { t: "custom", id: "tryVolume", label: "Volume" },
    { t: "custom", id: "tryBrightness", label: "Brightness", windowsOnly: true },
  ];
}

export const BATTERY_ROWS: readonly Row[] = [
  { t: "toggle", k: "batteryEnabled", label: "Show battery" },
  {
    t: "toggle",
    k: "showBatteryPercent",
    label: "Show percentage",
    sub: "Next to the battery in the open Sympony’s top bar and on the closed Sympony’s side",
  },
  {
    t: "select",
    k: "batteryStyle",
    label: "Icon",
    options: [
      ["bar", "Bar"],
      ["ring", "Ring"],
    ],
  },
  {
    t: "toggle",
    k: "chargingActivity",
    label: "Charging animation",
    sub: "When you plug in or unplug the charger",
  },
  {
    t: "range",
    k: "lowBatteryThreshold",
    label: "Low battery warning at",
    min: 5,
    max: 50,
    step: 1,
    unit: "%",
  },
  { t: "custom", id: "batteryInfo" },
];

export const MIRROR_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "A tiny mirror in Sympony. The camera only turns on when you click the mirror tile and turns off as soon as Sympony closes.",
  },
  { t: "toggle", k: "mirrorEnabled", label: "Show mirror" },
  {
    t: "select",
    k: "mirrorShape",
    label: "Shape",
    options: [
      ["rounded", "Rounded square"],
      ["circle", "Circle"],
    ],
  },
];

export const STATS_ROWS: readonly Row[] = [
  {
    t: "toggle",
    k: "statsEnabled",
    label: "Show the System tab",
    sub: "CPU, memory, network, disk and temperature",
  },
  { t: "custom", id: "tempZone", label: "Temperature sensor", windowsOnly: true },
  {
    t: "toggle",
    k: "fpsCounter",
    label: "FPS counter",
    sub: "While a game is in front, the closed notch shows how many frames per second it draws, with CPU and GPU. For DirectX games (most Windows games); nothing is added to the game, so anti-cheat has nothing to object to.",
  },
  { t: "custom", id: "fps", windowsOnly: true },
];

export const SNAP_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Start dragging any window and move the mouse onto Sympony: layout tiles appear. Release over a tile to snap the window into it.",
  },
  { t: "custom", id: "win11Note", windowsOnly: true },
  { t: "toggle", k: "snapEnabled", label: "Snap Zones" },
  { t: "h2", text: "Layouts" },
  { t: "custom", id: "snapLayouts", label: "Layouts", windowsOnly: true },
];

export const DOCK_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "A Dock at the bottom of the screen: the apps you pin and the ones that are open, with icons that grow as the mouse passes over them. Click an app to open it or switch to it (click the one in front to minimize it), right-click for more, drag an icon along the Dock to move it or up out of it to remove it, and drop an app, shortcut, file or folder on it to pin it. Right-click → Change icon to use your own PNG.",
  },
  { t: "toggle", k: "dockEnabled", label: "Show the Dock" },
  {
    t: "custom",
    id: "dockDisplays",
    label: "Show the Dock on",
    sub: "Sympony’s display, all displays, or the displays you choose",
    windowsOnly: true,
  },
  {
    t: "select",
    k: "dockAppsOn",
    label: "Open apps on each Dock",
    sub: "With a Dock on more than one display: all open apps on every Dock, or on each Dock only the apps with a window on its display. The pinned apps are on every Dock either way.",
    options: [
      ["all", "All open apps"],
      ["own", "Only the ones on its display"],
    ],
  },
  { t: "custom", id: "dockPins", label: "Pinned apps", windowsOnly: true },
  {
    t: "toggle",
    k: "dockTrash",
    label: "Recycle Bin",
    sub: "At the end of the Dock. Right-click it → Remove from Dock takes it off; this brings it back",
  },
  {
    t: "custom",
    id: "dockStyle",
    label: "Style",
    sub: "Black or White: a solid bar. Clear Glass: see-through with a bright edge, no blur. Frosted Glass: blurs what’s behind it; while Windows’ transparency effects are off or energy saver is on it looks like Clear Glass. Midnight: a solid deep blue bar. Wallpaper color: a solid bar in the main color of the wallpaper behind it.",
    windowsOnly: true,
  },
  {
    t: "toggle",
    k: "dockUniformIcons",
    label: "Same shape for every icon",
    sub: "Every icon in the same rounded square. An icon of another shape sits on a small plate that follows the Style",
  },
  {
    t: "toggle",
    k: "dockIconTint",
    label: "Tint icons",
    sub: "Every app icon in one colour that follows the Style",
  },
  {
    t: "toggle",
    k: "dockCalendarDate",
    label: "Show today’s date on calendar icons",
    sub: "A calendar app in the Dock (Windows Calendar, Outlook’s calendar, Google Calendar…) shows the month and today’s date on its icon. An icon you changed yourself stays",
  },
  {
    t: "select",
    k: "dockRunMark",
    label: "Open-app marker",
    sub: "How the Dock marks the apps that are open: a dot under the icon for each window, a dot in its top corner (with the number of windows when there’s more than one), a short line inside the icon, or nothing",
    options: [
      ["dot", "Dot under the icon"],
      ["corner", "Dot in the top corner"],
      ["line", "Line inside the icon"],
      ["none", "None"],
    ],
  },
  { t: "range", k: "dockSize", label: "Icon size", min: 16, max: 80, step: 2, unit: "px" },
  {
    t: "range",
    k: "dockGap",
    label: "Space between icons",
    min: 0,
    max: 20,
    step: 1,
    unit: "px",
  },
  {
    t: "range",
    k: "dockMagnify",
    label: "Magnification",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    t: "range",
    k: "dockLift",
    label: "Gap from the bottom edge",
    sub: "Raise the Dock above the bottom of the screen. Maximized windows still fill the screen behind it, so an app’s status bar shows under the raised Dock",
    min: 0,
    max: 60,
    step: 2,
    unit: "px",
  },
  {
    t: "toggle",
    k: "dockShowRunning",
    label: "Show open apps that aren’t pinned",
    sub: "After a divider; open apps are marked as chosen in Open-app marker",
  },
  {
    t: "toggle",
    k: "dockEndTask",
    label: "End task in the right-click menu",
    sub: "Ends an app that stopped responding, like Task Manager does. Anything unsaved in it is lost",
  },
  {
    t: "toggle",
    k: "dockAutoHide",
    label: "Hide the Dock until the mouse reaches the bottom",
    sub: "Always, on every display with a Dock. Maximized windows fill the whole screen behind the Dock in any case",
  },
  {
    t: "toggle",
    k: "dockHideMaximized",
    label: "Hide while a window is maximized",
    sub: "Only on the display with the maximized window. Move the mouse to the bottom edge to bring the Dock up. Not used while Keep windows above the Dock is on",
  },
  {
    t: "toggle",
    k: "dockStandby",
    label: "Come up when you’re idle",
    sub: "While the Dock is hidden (until the mouse reaches the bottom, or for a maximized window): after a few seconds without the mouse or keyboard, it comes up to show the time and your apps, and goes down again as soon as you move the mouse or type. Not over fullscreen apps, nor while a video or music plays with a window maximized on that display.",
  },
  {
    t: "number",
    k: "dockStandbySecs",
    label: "Idle for",
    sub: "Seconds without the mouse or keyboard before the Dock comes up (1 to 3600)",
    min: 1,
    max: 3600,
    unit: "seconds",
  },
  {
    t: "range",
    k: "dockHoverDelay",
    label: "Hover delay",
    sub: "How long the mouse stays at the bottom edge before the hidden Dock comes up. 0 brings it up at once",
    min: 0,
    max: 800,
    step: 10,
    unit: "ms",
  },
  {
    t: "range",
    k: "dockCloseDelay",
    label: "Close delay",
    sub: "While the Dock hides: how long it stays up after the mouse leaves it",
    min: 0,
    max: 1500,
    step: 50,
    unit: "ms",
  },
  {
    t: "toggle",
    k: "dockReserve",
    label: "Keep windows above the Dock",
    sub: "Maximized windows stop above the Dock, as they do above the taskbar, so it never covers their bottom. Uses a strip as tall as the Dock at the bottom of each display with a Dock; the desktop shows beside the Dock. Not used while the Dock hides until the mouse reaches the bottom",
  },
  {
    t: "toggle",
    k: "dockHideInFullscreen",
    label: "Hide when an app is fullscreen",
    sub: "Games, videos and presentations (the Docks on other displays stay). Apart from Sympony’s own choice in General, so Sympony can stay over a game (for its FPS) while the Dock hides",
  },
  {
    t: "toggle",
    k: "dockHideTaskbar",
    label: "Hide the Windows taskbar",
    sub: "Takes the taskbar off the displays that have a Dock while the Dock is on, and each Dock gets a Start button (right-click it for the power and system menu). The Windows key, Windows + A (quick settings) and Windows + N (notifications) still work. Displays without a Dock keep their taskbar, set to auto-hide meanwhile (Windows has one auto-hide switch for all taskbars): it slides up when the mouse reaches the bottom of the screen. The taskbar comes back when you turn this or the Dock off, while Sympony is snoozed or hidden, and when you quit Sympony.",
  },
  {
    t: "toggle",
    k: "dockSearch",
    label: "Search button",
    sub: "While the taskbar is hidden: a button after Start that opens Windows search (like Windows + S).",
  },
  {
    t: "toggle",
    k: "dockTaskView",
    label: "Task View button",
    sub: "While the taskbar is hidden: a button after Start that shows your windows and desktops (like Windows + Tab), with the number of the desktop you’re on when there’s more than one. Right-click it to switch to another desktop, add one or close this one; scroll over it for the next or previous desktop.",
  },
  {
    t: "toggle",
    k: "dockShowDesktop",
    label: "Show desktop button",
    sub: "While the taskbar is hidden: a small desktop button at the very end of the Dock, after the time. Click it to show the desktop, and again to bring your windows back. Right-click an empty spot on the Dock for the same.",
  },
  {
    t: "toggle",
    k: "dockStatus",
    label: "Time and status on the Dock",
    sub: "While the taskbar is hidden: the input language, network, volume, battery, time and date at the right end of the Dock. Click them for Windows’ own panels: switch the language, Quick Settings, or notifications and the calendar.",
  },
  {
    t: "toggle",
    k: "dockPrayer",
    label: "Next prayer on the Dock",
    sub: "While Prayer Times is on: the next prayer and its time near the right end of the Dock, counting down in the minutes before it (as set under Prayer Times) and lit up when it’s time. Click it to open Sympony on Prayer Times.",
  },
  {
    t: "toggle",
    k: "dockTray",
    label: "Other apps’ tray icons on the Dock",
    sub: "While the taskbar is hidden: an arrow at the right end of the Dock opens the icons of the notification area (WhatsApp, OneDrive, Steam…). Click one as you would on the taskbar, or right-click it for the app’s own menu, which may open at the bottom of the screen. The taskbar comes back for a moment while Sympony clicks it there.",
  },
  {
    t: "select",
    k: "dockTraySize",
    label: "Tray icon size",
    sub: "The icons in the grid the arrow opens",
    options: [
      ["small", "Small"],
      ["medium", "Medium"],
      ["large", "Large"],
    ],
  },
];
