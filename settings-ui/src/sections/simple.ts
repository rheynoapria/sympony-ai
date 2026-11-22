import type { Row, SectionBody } from "@/rows/types";
import {
  CURSOR_ROWS,
  EFFECTS_ROWS,
  LIVE_ROWS,
  WALLPAPER_ROWS,
} from "./core.rows";
import { DAYPROGRESS_ROWS, HEALTH_ROWS, SCREENTIME_ROWS } from "./features.rows";
import { DOCK_ROWS, MIRROR_ROWS, SNAP_ROWS, STATS_ROWS } from "./system.rows";

export function simpleSection(id: string, rows: readonly Row[]): SectionBody {
  return { id, rows: [...rows] };
}

export const live = simpleSection("live", LIVE_ROWS);
export const effects = simpleSection("effects", EFFECTS_ROWS);
export const cursor = simpleSection("cursor", CURSOR_ROWS);
export const wallpaper = simpleSection("wallpaper", WALLPAPER_ROWS);
export const health = simpleSection("health", HEALTH_ROWS);
export const screentime = simpleSection("screentime", SCREENTIME_ROWS);
export const dayprogress = simpleSection("dayprogress", DAYPROGRESS_ROWS);
export const mirror = simpleSection("mirror", MIRROR_ROWS);
export const stats = simpleSection("stats", STATS_ROWS);
export const snap = simpleSection("snap", SNAP_ROWS);
export const dock = simpleSection("dock", DOCK_ROWS);
