import type { Row } from "../rows/types.ts";
import { AI_KEYS, AIUSAGE_ROWS, INTEGRATIONS_ROWS } from "./ai.rows.ts";
import {
  CURSOR_ROWS,
  EFFECTS_ROWS,
  GITHUB_ROWS,
  LIVE_ROWS,
  WALLPAPER_ROWS,
} from "./core.rows.ts";
import {
  BLUETOOTH_ROWS,
  CALENDAR_KEYS,
  CALENDAR_ROWS,
  DAYPROGRESS_ROWS,
  HEALTH_ROWS,
  POMODORO_KEYS,
  POMODORO_ROWS,
  PRAYER_KEYS,
  PRAYER_ROWS,
  SCREENTIME_ROWS,
  TODO_KEYS,
  TODO_ROWS,
  WEATHER_KEYS,
  WEATHER_ROWS,
} from "./features.rows.ts";
import { GENERAL_ROWS } from "./general.rows.ts";
import { VOICE_KEYS } from "./voice.rows.ts";
import { MEDIA_ROWS, NOTIFICATIONS_ROWS } from "./media.rows.ts";
import { MODULES_KEYS } from "./modules.meta.ts";
import type { OS, RowsFor } from "./registry.ts";
import {
  BATTERY_ROWS,
  DOCK_ROWS,
  DROPACTIONS_KEYS,
  dropActionsRows,
  hudRows,
  MIRROR_ROWS,
  SNAP_ROWS,
  STATS_ROWS,
} from "./system.rows.ts";

const ALL_OS: readonly OS[] = ["macos", "linux", "windows"];

export function rowKeys(rows: RowsFor, extra: readonly string[] = []): string[] {
  const out = new Set<string>();
  const lists: readonly (readonly Row[])[] =
    typeof rows === "function" ? ALL_OS.map((os) => rows(os)) : [rows];
  for (const list of lists) {
    for (const r of list) {
      if ("k" in r && r.k) out.add(r.k);
    }
  }
  for (const k of extra) out.add(k);
  return [...out];
}

export const SECTION_KEYS: Record<string, readonly string[]> = {
  general: rowKeys(GENERAL_ROWS, [
    "language",
    "notchPosition",
    "notchColor",
    "idleLeft",
    "idleClock",
    "clockSize",
    "idleRight",
    "worldClocks",
    "hourChimeHalf",
    "hourChimeQuiet",
    "hourChimeFrom",
    "hourChimeTo",
  ]),
  modules: [...MODULES_KEYS],
  ai: [...AI_KEYS],
  voice: [...VOICE_KEYS],
  aiusage: rowKeys(AIUSAGE_ROWS, ["aiUsageClaude", "aiUsageCodex"]),
  integrations: rowKeys(INTEGRATIONS_ROWS),
  media: rowKeys(MEDIA_ROWS, ["mediaColors"]),
  notifications: rowKeys(NOTIFICATIONS_ROWS),
  todo: rowKeys(TODO_ROWS, TODO_KEYS),
  pomodoro: rowKeys(POMODORO_ROWS, POMODORO_KEYS),
  health: rowKeys(HEALTH_ROWS),
  screentime: rowKeys(SCREENTIME_ROWS),
  dayprogress: rowKeys(DAYPROGRESS_ROWS),
  bluetooth: rowKeys(BLUETOOTH_ROWS),
  calendar: rowKeys(CALENDAR_ROWS, CALENDAR_KEYS),
  weather: rowKeys(WEATHER_ROWS, WEATHER_KEYS),
  prayer: rowKeys(PRAYER_ROWS, PRAYER_KEYS),
  dropactions: rowKeys(dropActionsRows, DROPACTIONS_KEYS),
  hud: rowKeys(hudRows),
  battery: rowKeys(BATTERY_ROWS),
  mirror: rowKeys(MIRROR_ROWS),
  stats: rowKeys(STATS_ROWS),
  snap: rowKeys(SNAP_ROWS),
  dock: rowKeys(DOCK_ROWS),
  live: rowKeys(LIVE_ROWS),
  effects: rowKeys(EFFECTS_ROWS),
  cursor: rowKeys(CURSOR_ROWS),
  wallpaper: rowKeys(WALLPAPER_ROWS),
  github: rowKeys(GITHUB_ROWS),
};
