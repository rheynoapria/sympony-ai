import defaults from "../../../crates/contract/defaults/settings.json";
import { createMock, type DisplayInfo, type Notch, type Settings } from "./mock.ts";

export type { DisplayInfo, Notch, Settings };
export { createMock };

export interface SymponyPalette {
  name: string;
  c: [[number, number, number], [number, number, number], [number, number, number]];
}

export interface SymponyWaveHandle {
  colors(
    c1: [number, number, number],
    c2: [number, number, number],
    c3: [number, number, number]
  ): void;
  playing?(on: boolean): void;
  wake?(): void;
}

export interface ClockPlace {
  name: string;
  tz: string;
}

export interface ClockInfo {
  night: boolean;
  offsetMin?: number;
  diffMin?: number;
}

export interface SymponyClockAPI {
  MAX: number;
  valid(tz: string): boolean;
  info(tz: string, now: number): ClockInfo;
  time(tz: string, now: number, h24?: boolean): string;
  diffLine(info: ClockInfo): string;
  cityOf(tz: string): string;
  places(s: Settings): ClockPlace[];
  search(q: string, n?: number): ClockPlace[];
  minutes(hhmm: string): number | null;
  bell(ctx: AudioContext, half?: boolean): void;
}

export interface LocalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  location?: string;
  repeat?: string;
}

export interface LocalEventForm {
  title: string;
  day: string;
  time: string;
  minutes: number | string;
  location?: string;
  repeat?: string;
}

export interface LocalEventsAPI {
  repeats(): [string, string][];
  fields(e: LocalEvent): {
    title: string;
    day: string;
    time: string;
    minutes: number;
    location: string;
    repeat: string;
  };
  make(f: LocalEventForm, prev?: LocalEvent): { event?: LocalEvent; bad?: "title" | "day" | "time" };
  save(
    list: LocalEvent[] | undefined,
    f: LocalEventForm,
    prev?: LocalEvent
  ): { event?: LocalEvent; bad?: "title" | "day" | "time" };
  remove(list: LocalEvent[] | undefined, id: string): void;
}

export interface CustomModPillEval {
  slug: string;
  id: string;
  name: string;
  icon: string;
  accent: string;
  text: string;
  right: string;
  tone: string;
}

export interface CustomModPreviewHandle {
  rec: { state: Record<string, unknown> };
  rerender: () => void;
  trigger: (actionName: string, payload?: Record<string, unknown>) => Promise<void> | void;
  destroy: () => void;
}

export interface CustomModEngineAPI {
  iconSvg: (name: string, style?: string) => string;
  accentColor: (accent?: string) => string;
  evalPill: (
    manifest: unknown,
    state?: Record<string, unknown>,
    config?: Record<string, unknown>,
    data?: Record<string, unknown>
  ) => CustomModPillEval | null;
  renderPreview: (
    host: HTMLElement,
    manifest: unknown,
    opts?: {
      mode?: "compact" | "expanded";
      state?: Record<string, unknown>;
      config?: Record<string, unknown>;
      data?: Record<string, unknown>;
      hideFooter?: boolean;
      onStateChange?: (nextState: Record<string, unknown>) => void;
    }
  ) => CustomModPreviewHandle | null;
}

declare global {
  interface Window {
    notch?: Notch;
    _t?: (s: string, vars?: Record<string, unknown>) => string;
    _tLocale?: (en?: string) => string;
    SYMPONY_OS?: string;
    SYMPONY_DIR?: string;
    SYMPONY_LANG?: string;
    SYMPONY_LANGS?: [string, string, boolean?][];
    SYMPONY_PALETTES?: Record<string, SymponyPalette>;
    makeWaves?: (box: HTMLElement, shown: () => boolean) => SymponyWaveHandle | null;
    SymponyClock?: SymponyClockAPI;
    LocalEvents?: LocalEventsAPI;
    CustomModEngine?: CustomModEngineAPI;
  }
}

export const notch: Notch =
  typeof window !== "undefined" && window.notch
    ? window.notch
    : createMock(defaults as Settings);
