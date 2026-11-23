import type { Settings } from "./notch";

export type CardSurface = "oled" | "borderless" | "outline" | "glass" | "tinted";
export type CardRadius = "sharp" | "rounded" | "soft";
export type CardDensity = "compact" | "balanced" | "airy";
export type ModuleSizeMode = "auto" | "fit" | "compact" | "standard" | "tall" | "custom";
export type ModuleSurfaceOverride = "auto" | "oled" | "borderless" | "outline" | "glass";
export type GridSize = "1x1" | "2x1" | "1x2" | "2x2" | "4x2";

export interface CardStyleConfig {
  surface: CardSurface;
  radius: CardRadius;
  density: CardDensity;
}

export interface ModuleStylePref {
  style?: string;
  size?: ModuleSizeMode;
  width?: number;
  height?: number;
  surface?: ModuleSurfaceOverride;
  gridSize?: GridSize;
}

export interface StyleOption {
  id: string;
  title: string;
  sub: string;
  height: number;
  surface: "oled" | "borderless" | "outline" | "glass";
  pack: "bento" | "compact" | "minimal";
}

export const ALLOWED_GRID_SIZES: Readonly<Record<string, readonly GridSize[]>> = {
  home: ["4x2", "2x2"],
  prayer: ["1x2", "2x1", "1x1", "2x2"],
  calendar: ["2x2", "2x1", "1x2"],
  chat: ["2x1", "2x2", "1x1"],
  todo: ["2x1", "2x2", "1x2", "1x1"],
  control: ["2x1", "2x2", "1x1"],
  shelf: ["2x1", "2x2", "1x1"],
  stats: ["2x1", "2x2", "1x1"],
  translate: ["2x1", "2x2", "1x1"],
  notifs: ["2x1", "2x2", "1x2", "1x1"],
  launcher: ["2x1", "2x2", "1x1"],
  hitl: ["2x1", "2x2"],
  notes: ["1x1", "2x1", "1x2", "2x2"],
  pomodoro: ["1x1", "2x1", "1x2", "2x2"],
  weather: ["1x1", "2x1", "1x2", "2x2"],
  health: ["1x1", "2x1", "2x2"],
  dayprogress: ["1x1", "2x1"],
  aiusage: ["1x1", "2x1"],
  screentime: ["1x1", "2x1", "2x2"],
  bluetooth: ["1x1", "2x1", "2x2"],
  github: ["1x1", "2x1", "2x2"],
  radio: ["1x1", "2x1", "2x2"],
  bookmarks: ["1x1", "2x1", "2x2"],
  worldclock: ["1x1", "2x1", "2x2"],
  teleprompter: ["1x1", "2x1"],
};

export const MODULE_STYLES: Readonly<Record<string, readonly StyleOption[]>> = {
  prayer: [
    {
      id: "bento",
      title: "Bento Sun-Arc",
      sub: "Sun-path arc, Qibla compass and full 5-prayer list",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "timeline",
      title: "Compact Timeline",
      sub: "Countdown left with a 5-point horizontal timeline right",
      height: 160,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "focus",
      title: "Minimal Countdown",
      sub: "Giant centered countdown with a slim 5-prayer strip below",
      height: 144,
      surface: "borderless",
      pack: "minimal",
    },
  ],
  home: [
    {
      id: "bento",
      title: "Album Wave Studio",
      sub: "Artwork, 3-line lyrics, audio output and gradient waves",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "strip",
      title: "Compact Strip",
      sub: "Single-row player with scrubber, controls and equalizer",
      height: 132,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "cover",
      title: "Cover Focus",
      sub: "Hero album artwork with bold editorial typography",
      height: 212,
      surface: "oled",
      pack: "minimal",
    },
  ],
  weather: [
    {
      id: "bento",
      title: "3-Tile Forecast",
      sub: "Hero temperature, 24-hour curve and 5-day outlook",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "horizon",
      title: "Compact Horizon",
      sub: "Current weather left with a horizontal forecast ribbon right",
      height: 156,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "minimal",
      title: "Big Temp Minimal",
      sub: "Oversized temperature, high/low and conditions on one canvas",
      height: 136,
      surface: "borderless",
      pack: "minimal",
    },
  ],
  calendar: [
    {
      id: "bento",
      title: "Month + Agenda",
      sub: "Full monthly calendar left with selected day agenda right",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "today",
      title: "Compact Today",
      sub: "Large calendar date badge left with today’s events right",
      height: 164,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "week",
      title: "Week Strip",
      sub: "Interactive 7-day strip across the top with agenda below",
      height: 172,
      surface: "borderless",
      pack: "minimal",
    },
  ],
  pomodoro: [
    {
      id: "bento",
      title: "Ring Studio",
      sub: "Progress ring, mode switcher, presets and focus sound",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "digital",
      title: "OLED Digital",
      sub: "Bold digital timer left with progress bar and quick controls",
      height: 152,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "strip",
      title: "Minimal Focus Strip",
      sub: "Ultra-slim single-row focus timer with play and skip controls",
      height: 124,
      surface: "borderless",
      pack: "minimal",
    },
  ],
  control: [
    {
      id: "minimal",
      title: "Minimal OLED",
      sub: "Compact icon toggles, output switcher pill and sleek horizontal sliders",
      height: 140,
      surface: "borderless",
      pack: "minimal",
    },
    {
      id: "pill",
      title: "Ultra-Slim Dock",
      sub: "Single-row bar with core toggles, inline sliders and output switcher",
      height: 118,
      surface: "borderless",
      pack: "minimal",
    },
    {
      id: "compact",
      title: "Compact Split",
      sub: "2×2 quick toggles left with horizontal sliders and output strip right",
      height: 168,
      surface: "borderless",
      pack: "compact",
    },
    {
      id: "macos",
      title: "macOS Glass Deck",
      sub: "Connectivity stack, labeled Display & Sound sliders and 2×2 quick tiles",
      height: 196,
      surface: "glass",
      pack: "compact",
    },
    {
      id: "mixer",
      title: "Studio Mixer",
      sub: "Audio-first dual sliders with live output switcher chips and bottom toggles",
      height: 184,
      surface: "oled",
      pack: "bento",
    },
    {
      id: "bento",
      title: "Classic Control",
      sub: "Full toggle tiles, vertical sliders and inline sound output list",
      height: 272,
      surface: "oled",
      pack: "bento",
    },
  ],
};

export const MODULE_TO_SETTINGS_SECTION: Readonly<Record<string, string>> = {
  home: "media",
  prayer: "prayer",
  weather: "weather",
  calendar: "calendar",
  pomodoro: "pomodoro",
  control: "control",
};

export const QUICK_PACKS: readonly {
  id: "bento" | "compact" | "minimal";
  title: string;
  sub: string;
  cardStyle: CardStyleConfig;
  styles: Readonly<Record<string, string>>;
}[] = [
  {
    id: "bento",
    title: "Bento Studio",
    sub: "Rich multi-card layouts (272 px)",
    cardStyle: { surface: "oled", radius: "rounded", density: "balanced" },
    styles: { prayer: "bento", home: "bento", weather: "bento", calendar: "bento", pomodoro: "bento", control: "bento" },
  },
  {
    id: "compact",
    title: "Compact OLED",
    sub: "Sleek borderless horizontal strips (~152 px)",
    cardStyle: { surface: "borderless", radius: "rounded", density: "compact" },
    styles: { prayer: "timeline", home: "strip", weather: "horizon", calendar: "today", pomodoro: "digital", control: "compact" },
  },
  {
    id: "minimal",
    title: "Minimal Focus",
    sub: "Big typography, low clutter (~136 px)",
    cardStyle: { surface: "outline", radius: "soft", density: "balanced" },
    styles: { prayer: "focus", home: "cover", weather: "minimal", calendar: "week", pomodoro: "strip", control: "minimal" },
  },
];

export function readCardStyle(settings: Settings): CardStyleConfig {
  const raw = (settings.cardStyle ?? {}) as Partial<CardStyleConfig>;
  return {
    surface: raw.surface ?? "oled",
    radius: raw.radius ?? "rounded",
    density: raw.density ?? "balanced",
  };
}

export function readModuleStyles(settings: Settings): Record<string, ModuleStylePref> {
  const raw = settings.moduleStyles;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, ModuleStylePref>)
    : {};
}

export function readModulePref(settings: Settings, modId: string): ModuleStylePref {
  return readModuleStyles(settings)[modId] ?? {};
}

export function activeStyleOption(settings: Settings, modId: string): StyleOption | null {
  const list = MODULE_STYLES[modId];
  if (!list || list.length === 0) return null;
  const want = readModulePref(settings, modId).style;
  return list.find((x) => x.id === want) ?? list[0];
}

export function defaultGridSize(modId: string): GridSize {
  return ALLOWED_GRID_SIZES[modId]?.[0] ?? "1x1";
}
