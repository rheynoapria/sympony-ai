import type { Settings } from "../lib/mock.ts";
import type { OS } from "../sections/registry.ts";
import type { Opt, Row } from "./types.ts";

interface OsOff {
  keys: readonly string[];
  options: Readonly<Record<string, readonly (string | number)[]>>;
  cards: readonly string[];
  tabs: readonly string[];
}

export const MAC_OFF: OsOff = {
  keys: [
    "hideInFullscreen",
    "touchMode",
    "reserveTop",
    "reserveBlur",
    "reserveMatch",
    "snoozeShortcut",
    "snoozeMinutes",
    "fpsCounter",
    "realVisualizer",
    "vlcWeb",
    "vlcPort",
    "notifFollowDnd",
    "notifDndPeek",
    "colorPickShortcut",
    "colorPickFormat",
    "fxGenie",
  ],
  options: {
    idleLeft: ["temp", "wifi"],
    idleRight: ["temp", "wifi"],
    // Stands for classic's inline SYMPONY_OS === 'windows' check on shellForm (settings.js:460)
    shellForm: ["island", "drawer"],
  },
  cards: ["bell", "sliders", "table-columns", "arrow-pointer"],
  tabs: [],
};

export const LINUX_OFF: OsOff = {
  keys: [
    "hideInFullscreen",
    "touchMode",
    "reserveTop",
    "reserveBlur",
    "reserveMatch",
    "showInScreenshots",
    "toggleShortcut",
    "moduleShortcuts",
    "snoozeShortcut",
    "snoozeMinutes",
    "liveSources.bluetooth",
    "realVisualizer",
    "vlcWeb",
    "vlcPort",
    "colorPickShortcut",
    "colorPickFormat",
    "fxGenie",
    "fpsCounter",
  ],
  options: {
    // Stands for classic's inline SYMPONY_OS === 'windows' check on shellForm (settings.js:460)
    shellForm: ["island", "drawer"],
  },
  cards: ["bell", "hourglass-half", "bluetooth-b", "table-columns", "arrow-pointer"],
  tabs: ["screentime", "radio"],
};

function offFor(os: OS): OsOff | null {
  return os === "macos" ? MAC_OFF : os === "linux" ? LINUX_OFF : null;
}

const MAC_ROWS: Record<string, (rows: Row[]) => Row[]> = {
  general: (rows) =>
    rows.map((r) => {
      if ("k" in r && r.k === "toggleShortcut") {
        return {
          ...r,
          sub: "e.g. Option+N, Cmd+Shift+Space. Also brings Sympony back when tucked/hidden.",
        };
      }
      if ("k" in r && r.k === "moduleShortcuts") {
        return {
          ...r,
          sub: "While Sympony is open with the mouse on it, or opened with the shortcut.",
        };
      }
      if ("k" in r && r.k === "clock24h") {
        return { ...r, sub: "" };
      }
      return r;
    }),
  aiusage: (rows) =>
    rows.map((r) => {
      if (r.t === "lead") {
        return {
          ...r,
          html: "How much of your Claude and Codex plan limits you’ve used, in a tab of its own: the 5-hour session and the week. Sympony reads them on this Mac. For Claude it asks Anthropic with Claude Code’s own sign-in, as Claude Code’s /usage does; Codex’s come from its logs, offline. Nothing else is sent anywhere.",
        };
      }
      if (r.t === "custom" && r.id === "claude") {
        return { ...r, sub: "Reads Claude Code’s sign-in on this Mac" };
      }
      if (r.t === "custom" && r.id === "codex") {
        return { ...r, sub: "Reads Codex CLI’s logs on this Mac" };
      }
      return r;
    }),
  integrations: (rows) =>
    rows.map((r) =>
      "k" in r && r.k === "paseoEnabled"
        ? {
            ...r,
            sub: "The agents you run in Paseo (Claude Code, Antigravity, Codex…): Sympony asks Paseo’s app on this Mac every second, with the command or the question in full. Allow, Deny and your answers go back to Paseo; a plan opens Paseo.",
          }
        : r
    ),
  media: (rows) =>
    rows.map((r) => {
      if ("k" in r && r.k === "ytVideo") {
        return {
          ...r,
          sub: "While a video plays on youtube.com in Brave, Chrome, Edge, Arc, Vivaldi, Opera or Safari, the Music section plays it too, muted and in step with the tab. Sympony reads the browser’s tab addresses to find it (macOS asks once). YouTube Music stays the music view.",
        };
      }
      if ("k" in r && r.k === "lyricsExtra") {
        return {
          ...r,
          sub: "Korean, Japanese and Chinese lyrics in Latin letters, the lyrics translated, or both. Shown in the player on Home and under the line in the closed Sympony. Both go through the AI agent picked in Pony Assistant: each song is sent once (lyrics already in Latin letters aren’t) and the result is kept on this Mac.",
        };
      }
      return r.t === "lead"
        ? {
            ...r,
            html: "Works with whatever plays on this Mac: browsers (YouTube, SoundCloud…), Spotify, the Music app and other players. For Spotify and Music, macOS asks once whether Sympony may control them: click <b>OK</b> (or later: System Settings → Privacy & Security → Automation → Sympony). Music shows on the <b>Home</b> tab and in the closed Sympony; it has no tab of its own.",
          }
        : r;
    }),
  notifications: (rows) => {
    const out = rows.map((r) => {
      if (r.t === "lead") {
        return {
          ...r,
          html: "Notifications from your apps (messages, mail, calendars, sites you allowed) show in Sympony as they arrive: the app, the title and the text, stacked under the closed Sympony. Click one to open its app. Sympony reads them from macOS on this Mac; nothing is sent anywhere.",
        };
      }
      if ("k" in r && r.k === "notifEnabled") {
        return { ...r, label: "Show Mac notifications in Sympony" };
      }
      if ("k" in r && r.k === "notifHideBanners") {
        return {
          ...r,
          sub: "Sympony reads each of macOS’s notification banners the moment it shows and closes it, so notifications appear only in Sympony, stacked under the notch. Needs Accessibility (below).",
        };
      }
      if ("k" in r && r.k === "notifHistory") {
        return {
          ...r,
          sub: "Keeps the notifications Sympony shows on this Mac (encrypted). Turning it off deletes them.",
        };
      }
      return r;
    });
    const idx = out.findIndex((r) => "k" in r && r.k === "notifEnabled");
    if (idx !== -1) {
      out.splice(idx + 1, 0, { t: "custom", id: "notifAccess" });
    }
    return out;
  },
  voice: (rows) =>
    rows.map((r) =>
      "k" in r && r.k === "voiceEnabled" ? { ...r, sub: "Speak Indonesian anywhere on your Mac, completely on-device" } : r
    ),
  screentime: (rows) =>
    rows.map((r) =>
      "k" in r && r.k === "screenTimeExcluded"
        ? { ...r, sub: "Comma-separated app names, e.g. Steam, 1Password" }
        : r
    ),
  weather: (rows) =>
    rows.map((r) =>
      "k" in r && r.k === "locationAuto"
        ? {
            ...r,
            sub: "Follows this Mac: when it is more than 2 km from the city above, that becomes the new city. Picking a city turns this off.",
          }
        : r
    ),
  stats: (rows) =>
    rows.map((r) =>
      "k" in r && r.k === "statsEnabled"
        ? { ...r, sub: "CPU, memory, network and disk" }
        : r
    ),
  effects: (rows) =>
    rows.map((r) => {
      if (r.t === "lead") {
        return {
          ...r,
          html: "Little animations around Sympony. Turn each one on or off here.",
        };
      }
      if ("k" in r && r.k === "fxGlow") {
        return {
          ...r,
          sub: "A thin glowing light runs round the closed Sympony for reminders, events, notifications, charging, Pony answers and low battery, in their color",
        };
      }
      if ("k" in r && r.k === "fxHudBounce") {
        return {
          ...r,
          sub: "When the volume reaches 0% or 100%, the HUD bar stretches a little and springs back",
        };
      }
      return r;
    }),
};

const LINUX_ROWS: Record<string, (rows: Row[]) => Row[]> = {
  media: (rows) =>
    rows.map((r) =>
      r.t === "lead"
        ? {
            ...r,
            html: "Works with the players your desktop’s media controls show (MPRIS): Spotify, VLC, Rhythmbox, Firefox, Chrome and more. Music shows on the <b>Home</b> tab and in the closed Sympony; it has no tab of its own.",
          }
        : r
    ),
  general: (rows) =>
    rows.map((r) => ("k" in r && r.k === "clock24h" ? { ...r, sub: "" } : r)),
};

export function applyOs(sectionId: string, rows: readonly Row[], os: OS): Row[] {
  const off = offFor(os);
  if (!off) return [...rows];

  const osRows = os === "macos" ? MAC_ROWS : LINUX_ROWS;
  let out: Row[] = osRows[sectionId] ? osRows[sectionId]([...rows]) : [...rows];

  out = out.filter((r) => {
    if (r.t === "custom" && r.windowsOnly) return false;
    if ("k" in r && off.keys.includes(r.k)) return false;
    return true;
  });

  // A heading left with nothing under it goes too (settings.js:836)
  out = out.filter((r, j, arr) => r.t !== "h2" || (arr[j + 1] != null && arr[j + 1].t !== "h2"));
  return out;
}

export function optionsFor(row: Row, s: Settings, os: OS): Opt[] {
  if (row.t !== "select") return [];
  const raw =
    typeof row.options === "function" ? row.options(s) : row.options ?? [];
  const off = offFor(os)?.options[row.k];
  if (!off) return raw;
  return raw.filter(([v]) => !off.includes(v));
}

export function offCards(os: OS): string[] {
  const off = offFor(os);
  return off ? [...off.cards] : [];
}

export function offTabs(os: OS): string[] {
  const off = offFor(os);
  return off ? [...off.tabs] : [];
}

export function offSlotIds(os: OS, side: "idleLeft" | "idleRight"): readonly (string | number)[] {
  return offFor(os)?.options[side] ?? [];
}
