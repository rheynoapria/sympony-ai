import { t } from "../../lib/i18n.ts";
import type { Settings } from "../../lib/mock.ts";
import type { OS } from "../registry.ts";

export interface PlaceLike {
  name?: string;
  admin?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

export interface LocateMsg {
  text: string;
  at?: string;
  settings?: true;
}

export interface LocateState {
  busy: string;
  msg: Record<string, LocateMsg>;
}

export function nextIndex(
  at: number,
  len: number,
  key: "ArrowDown" | "ArrowUp"
): number {
  if (len <= 0) return -1;
  return key === "ArrowDown" ? (at + 1) % len : (at <= 0 ? len : at) - 1;
}

export function placeName(l: PlaceLike | null | undefined): string {
  if (!l) return "";
  return [l.name, l.admin, l.country].filter(Boolean).join(", ");
}

export function locateMessage(r: unknown): LocateMsg {
  const res = r as {
    ok?: boolean;
    named?: boolean;
    reason?: string;
    place?: { name?: string; admin?: string; country?: string; lat?: number; lon?: number };
  } | null;
  const how = t(
    "Turn it on in System Settings → Privacy & Security → Location Services, then come back."
  );
  if (res && res.ok && res.place) {
    const p = placeName(res.place);
    return {
      at: `${res.place.lat},${res.place.lon}`,
      text: res.named
        ? t("Found: {place}", { place: p })
        : t(
            "Saved your position, but couldn’t look up its name. Check the internet connection, or search for your city."
          ),
    };
  }
  if (res && res.reason === "off") {
    return {
      text: `${t("Location Services is off on this Mac.")} ${how}`,
      settings: true,
    };
  }
  if (res && res.reason === "denied") {
    return {
      text: `${t("macOS doesn’t let Sympony use your location.")} ${how}`,
      settings: true,
    };
  }
  return {
    text: t(
      "This Mac couldn’t find its location right now. Try again in a moment, or search for your city."
    ),
  };
}

export function locateSub(
  st: LocateState,
  which: string,
  cur: { lat: number; lon: number } | null
): string {
  const busy = st.busy === which;
  let m: LocateMsg | null = busy ? null : (st.msg[which] ?? null);
  if (m && m.at && (!cur || `${cur.lat},${cur.lon}` !== m.at)) m = null;
  return busy
    ? t("Finding your location…")
    : m
      ? m.text
      : t(
          "Uses Location Services to find where this Mac is, once, and picks the city there"
        );
}

export function keptHow(os: OS): string {
  return os === "macos"
    ? t("(encrypted, in a file only your account can read)")
    : os === "linux"
      ? t("(kept on this PC only)")
      : t("(encrypted with Windows DPAPI)");
}

export function cleanPresets(l: unknown): number[] {
  const nums = (Array.isArray(l) ? l : [])
    .map((m) => Math.round(Number(m)))
    .filter((m) => Number.isFinite(m) && m >= 1 && m <= 600);
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, 8);
}

export function syncIdFields(
  st: { builtIn?: Record<string, boolean>; ready?: Record<string, boolean> } | null,
  p: "google" | "microsoft",
  s: Settings
): string[] {
  const keys =
    p === "google"
      ? ["todoSyncGoogleClientId", "todoSyncGoogleClientSecret"]
      : ["todoSyncMsClientId"];
  if (st?.builtIn?.[p]) return [];
  if (
    st?.ready?.[p] &&
    !keys.some((k) => Boolean(s[k]) || Boolean(s[`has_${k}`]))
  ) {
    return [];
  }
  return keys;
}

export function validFeedUrl(url: string): boolean {
  return /^(https?|webcal):\/\//i.test(url.trim());
}

export function shortFeedUrl(url: string): string {
  return url.replace(/(ical\/[^/]{6})[^/]*(.*)/, "$1…$2");
}

export function defaultEventStart(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 3600000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function showKemenag(
  where: { country?: string } | null | undefined,
  method: unknown
): boolean {
  return Boolean(where && where.country === "Indonesia" && (method || "auto") === "auto");
}

export function tileList(
  catalog: readonly string[],
  order: readonly string[]
): string[] {
  const inCat = new Set(catalog);
  const enabled = order.filter((id) => inCat.has(id));
  const rest = catalog.filter((id) => !enabled.includes(id));
  return [...enabled, ...rest];
}

export function moveTile(
  all: readonly string[],
  order: readonly string[],
  i: number,
  d: -1 | 1
): string[] {
  const j = i + d;
  if (i < 0 || i >= all.length || j < 0 || j >= all.length) return [...order];
  const list = all.slice();
  [list[j], list[i]] = [list[i], list[j]];
  const enabled = new Set(order);
  return list.filter((id) => enabled.has(id));
}

export function toggleTile(
  order: readonly string[],
  id: string,
  on: boolean
): string[] {
  return on
    ? order.includes(id)
      ? [...order]
      : [...order, id]
    : order.filter((x) => x !== id);
}
