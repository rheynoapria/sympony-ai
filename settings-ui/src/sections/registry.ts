import { t } from "../lib/i18n.ts";
import { plainText } from "../rows/logic.ts";
import { applyOs } from "../rows/os.ts";
import type { Row } from "../rows/types.ts";
import { GENERAL_ROWS } from "./general.rows.ts";
import { VOICE_ROWS } from "./voice.rows.ts";
import { AI_ROWS, AIUSAGE_ROWS, INTEGRATIONS_ROWS } from "./ai.rows.ts";
import {
  CURSOR_ROWS,
  EFFECTS_ROWS,
  GITHUB_ROWS,
  LIVE_ROWS,
  WALLPAPER_ROWS,
} from "./core.rows.ts";
import { MEDIA_ROWS, NOTIFICATIONS_ROWS } from "./media.rows.ts";
import {
  BLUETOOTH_ROWS,
  CALENDAR_ROWS,
  DAYPROGRESS_ROWS,
  HEALTH_ROWS,
  POMODORO_ROWS,
  PRAYER_ROWS,
  SCREENTIME_ROWS,
  TODO_ROWS,
  WEATHER_ROWS,
} from "./features.rows.ts";
import {
  BATTERY_ROWS,
  DOCK_ROWS,
  dropActionsRows,
  hudRows,
  MIRROR_ROWS,
  SNAP_ROWS,
  STATS_ROWS,
} from "./system.rows.ts";

export type OS = "macos" | "windows" | "linux";
export type SectionGroup = "sympony" | "ai" | "features" | "system" | "app";

export interface SectionMeta {
  id: string;
  group: SectionGroup;
  title: string;
  subtitle: string;
  /** The subtitle on a Mac, where it names the computer (`subtitle` is the PC's). */
  macSubtitle?: string;
  icon: string;
  tint?: string;
  words?: string[];
}

export interface SearchHit {
  section: string;
  label: string;
  sub?: string;
  row?: string;
  part?: string;
}

export const GROUP_META: Record<
  SectionGroup,
  { label: string; defaultExpanded: boolean }
> = {
  sympony: { label: "Sympony", defaultExpanded: true },
  ai: { label: "AI & Integrations", defaultExpanded: true },
  features: { label: "Features", defaultExpanded: false },
  system: { label: "System & Window", defaultExpanded: false },
  app: { label: "App", defaultExpanded: true },
};

const HIDDEN_BY_OS: Record<OS, ReadonlySet<string>> = {
  macos: new Set(["cursor", "dock", "snap", "wallpaper"]),
  linux: new Set([
    "cursor",
    "dock",
    "snap",
    "bluetooth",
    "screentime",
    "wallpaper",
    "notifications",
  ]),
  windows: new Set(),
};

export const SECTIONS: readonly SectionMeta[] = [
  // Sympony (core)
  {
    id: "welcome",
    group: "sympony",
    title: "Welcome",
    subtitle: "Overview, quick start, and Sympony essentials.",
    icon: "Sparkles",
    tint: "#f59e0b",
    words: ["start", "overview", "home", "tour"],
  },
  {
    id: "general",
    group: "sympony",
    title: "General",
    subtitle: "Notch behavior, display placement, language, and shortcuts.",
    icon: "LayoutGrid",
    tint: "var(--primary)",
    words: ["display", "monitor", "language", "shortcut", "look", "theme", "color", "position"],
  },
  {
    id: "modules",
    group: "sympony",
    title: "Modules",
    subtitle: "Enable, reorder, and choose default notch tabs.",
    icon: "Boxes",
    tint: "#6366f1",
    words: ["tabs", "order", "teleprompter", "notes", "bookmarks"],
  },
  {
    id: "live",
    group: "sympony",
    title: "Live Activities",
    subtitle: "Live pills and dynamic status in the closed notch.",
    icon: "Activity",
    tint: "#f43f5e",
    words: ["pill", "closed", "slots", "status"],
  },
  {
    id: "cursor",
    group: "sympony",
    title: "Cursor",
    subtitle: "Custom pointer themes and cursor packs.",
    icon: "MousePointer2",
    tint: "#f59e0b",
    words: ["pointer", "mouse", "pack"],
  },
  {
    id: "effects",
    group: "sympony",
    title: "Animations",
    subtitle: "Motion, visual polish, and celebration effects.",
    icon: "Wand2",
    tint: "#a855f7",
    words: ["effects", "motion", "glow", "confetti", "bounce"],
  },
  {
    id: "wallpaper",
    group: "sympony",
    title: "Wallpaper",
    subtitle: "Live desktop wallpapers and playback rules.",
    icon: "Image",
    tint: "#06b6d4",
    words: ["background", "desktop", "video", "live"],
  },

  // AI & Integrations
  {
    id: "ai",
    group: "ai",
    title: "Pony Assistant",
    subtitle: "Brain, abilities, persona, appearance, skills, memory, and scheduled briefs.",
    icon: "Smile",
    tint: "#8b5cf6",
    words: ["pony", "chat", "ai chat", "obrolan", "translate", "agents", "claude", "codex", "gemini", "briefs", "persona", "skills", "memory"],
  },
  {
    id: "aiusage",
    group: "ai",
    title: "AI Usage",
    subtitle: "Session and weekly quota meters for AI providers.",
    icon: "Gauge",
    tint: "#d97757",
    words: ["limits", "quota", "plan", "session", "weekly"],
  },
  {
    id: "integrations",
    group: "ai",
    title: "Integrations",
    subtitle: "Human-in-the-loop approvals for Claude Code and Paseo.",
    icon: "Plug",
    tint: "#10b981",
    words: ["hooks", "claude code", "paseo", "hitl", "permissions"],
  },
  {
    id: "github",
    group: "ai",
    title: "GitHub",
    subtitle: "Pull requests, repositories, and activity.",
    icon: "GitBranch",
    tint: "#64748b",
    words: ["token", "pull requests", "pr", "repo", "repositories"],
  },

  // Features
  {
    id: "voice",
    group: "features",
    title: "Voice",
    subtitle: "Speak Indonesian anywhere on your PC, completely on-device",
    macSubtitle: "Speak Indonesian anywhere on your Mac, completely on-device",
    icon: "Mic",
    tint: "#ef4444",
    words: ["voice", "suara", "dikte", "dictation", "stt", "mikrofon", "kamus", "dictionary"],
  },
  {
    id: "todo",
    group: "features",
    title: "Todo",
    subtitle: "Tasks, lists, and Google Tasks synchronization.",
    icon: "CheckSquare",
    tint: "#f59e0b",
    words: ["tasks", "google tasks", "sync", "checklist"],
  },
  {
    id: "media",
    group: "features",
    title: "Media",
    subtitle: "Now Playing controls, palettes, and synced lyrics.",
    icon: "Music",
    tint: "#f43f5e",
    words: ["music", "song", "lyrics", "spotify", "radio", "now playing"],
  },
  {
    id: "calendar",
    group: "features",
    title: "Calendar",
    subtitle: "Calendars, ICS feeds, and meeting reminders.",
    icon: "Calendar",
    tint: "#ef4444",
    words: ["events", "ics", "ical", "google", "icloud", "outlook", "meetings"],
  },
  {
    id: "weather",
    group: "features",
    title: "Weather",
    subtitle: "Location, temperature units, and forecast display.",
    icon: "CloudSun",
    tint: "#0ea5e9",
    words: ["city", "location", "gps", "celsius", "fahrenheit", "forecast"],
  },
  {
    id: "prayer",
    group: "features",
    title: "Prayer Times",
    subtitle: "Calculation method, countdowns, and adhan audio.",
    icon: "MoonStar",
    tint: "#10b981",
    words: ["adhan", "sholat", "salat", "kemenag", "fajr", "maghrib", "isha"],
  },
  {
    id: "pomodoro",
    group: "features",
    title: "Pomodoro",
    subtitle: "Focus sessions, breaks, and ambient sounds.",
    icon: "Timer",
    tint: "#f97316",
    words: ["focus", "timer", "ambient", "noise", "rain", "breaks"],
  },
  {
    id: "health",
    group: "features",
    title: "Health",
    subtitle: "Breaks, water and mindful minutes, with reminders and eye breaks.",
    icon: "HeartPulse",
    tint: "#10b981",
    words: ["water", "drink", "eye break", "breaks", "mindful"],
  },
  {
    id: "screentime",
    group: "features",
    title: "Screen Time",
    subtitle: "Time in the foreground app, idle cutoff and excluded apps.",
    icon: "Hourglass",
    tint: "#6366f1",
    words: ["usage", "apps", "time"],
  },
  {
    id: "dayprogress",
    group: "features",
    title: "Day Progress",
    subtitle: "Today’s timeline from waking up to bedtime.",
    icon: "GanttChart",
    tint: "#3b82f6",
    words: ["timeline", "wake", "bedtime", "today"],
  },
  {
    id: "bluetooth",
    group: "features",
    title: "Bluetooth & Wi-Fi",
    subtitle: "Wireless devices, networks, and speed test.",
    icon: "Bluetooth",
    tint: "#0ea5e9",
    words: ["wifi", "wi-fi", "speed test", "network", "airpods", "headphones"],
  },

  // System & Window
  {
    id: "dock",
    group: "system",
    title: "Dock",
    subtitle: "Floating dock layout, pinning, and glass style.",
    icon: "PanelBottom",
    tint: "#3b82f6",
    words: ["taskbar", "pin", "glass", "launcher"],
  },
  {
    id: "notifications",
    group: "system",
    title: "Notifications",
    subtitle: "OS alerts, stacked cards, and quiet summaries.",
    icon: "Bell",
    tint: "#f59e0b",
    words: ["alerts", "banners", "dnd", "focus", "stacked"],
  },
  {
    id: "dropactions",
    group: "system",
    title: "Drop Actions & Shelf",
    subtitle: "Drag-and-drop shelf, clipboard history, phone share, and app launcher.",
    icon: "Inbox",
    tint: "#f59e0b",
    words: ["shelf", "clipboard", "files", "share", "qr", "phone", "launcher", "apps"],
  },
  {
    id: "snap",
    group: "system",
    title: "Snap Zones",
    subtitle: "Window tiling layouts and drag zones.",
    icon: "Columns2",
    tint: "#38bdf8",
    words: ["window", "tiling", "layouts", "halves", "thirds"],
  },
  {
    id: "control",
    group: "system",
    title: "Control",
    subtitle: "Control center layout styles, quick toggles, brightness, volume, and sound output.",
    icon: "LayoutDashboard",
    tint: "#3b82f6",
    words: ["control", "control center", "quick settings", "wifi", "bluetooth", "focus", "brightness", "volume", "sound", "output", "sliders", "style", "layout", "minimal", "compact", "macos", "mixer", "bento"],
  },
  {
    id: "hud",
    group: "system",
    title: "HUD",
    subtitle: "Volume, brightness, and system key overlays.",
    icon: "SlidersHorizontal",
    tint: "#64748b",
    words: ["volume", "brightness", "caps lock", "osd", "overlay"],
  },
  {
    id: "battery",
    group: "system",
    title: "Battery",
    subtitle: "Battery indicator, low-power warnings, and ring style.",
    icon: "BatteryCharging",
    tint: "#22c55e",
    words: ["power", "charge", "charging", "low battery", "ring"],
  },
  {
    id: "mirror",
    group: "system",
    title: "Mirror",
    subtitle: "Quick camera preview in the notch.",
    icon: "Video",
    tint: "#a855f7",
    words: ["camera", "webcam", "preview"],
  },
  {
    id: "stats",
    group: "system",
    title: "System Monitor",
    subtitle: "CPU, memory, disk, and network telemetry.",
    icon: "Activity",
    tint: "#64748b",
    words: ["cpu", "ram", "memory", "disk", "network", "stats"],
  },

  // App (sidebar footer)
  {
    id: "about",
    group: "app",
    title: "About & Updates",
    subtitle: "Version details, backups, data folder, and reset.",
    icon: "Info",
    tint: "#64748b",
    words: ["version", "backup", "restore", "export", "import", "reset", "data"],
  },
];

// Copied verbatim from frontend/settings.js:939-971
export const SEARCH_WORDS: Readonly<Record<string, string>> = {
  general: "color colour picker eyedropper pipette hex rgb hsl screen pixel ambil warna pipet",
  modules: "tabs order default module remember last turn on off teleprompter prompter autocue script read camera naskah glance ringkas notch view per modul dashboard tampilan style layout library bento compact minimal oled card size grid",
  calendar: "google outlook icloud ical ics link feeds local events meeting reminder show calendar refresh style layout compact today week strip",
  weather: "city location unit celsius fahrenheit forecast show weather detect my location gps lokasi style layout horizon minimal",
  prayer: "prayer times reminders city kemenag regency method asr hanafi count down sound adhan subuh fajr dhuhr maghrib isha volume detect my location gps lokasi sunrise terbit syuruq syuruk style layout timeline bento focus",
  dropactions: "drop actions shelf files convert compress image pdf share clipboard copy copied paste history pin remember salin tempel riwayat phone mobile qr code wi-fi wifi send receive hp ponsel kirim terima app launcher apps",
  snap: "snap zones window layouts drag halves thirds",
  control: "control center quick settings toggles wifi bluetooth focus keep awake brightness volume sliders sound output audio style layout minimal oled dock compact split macos glass deck studio mixer bento classic",
  hud: "volume brightness hud style panel caps num scroll lock keyboard indicator airplane microphone mic mute touchpad windows pop-up osd input language layout fullscreen full screen game games video",
  dock: "search button find magnifier magnifying glass windows+s cari pencarian calendar date today day icon tanggal hari ini",
  effects: "animation animations effects motion glow light outline border timer genie popup window minimize restore confetti celebrate karaoke lyrics swipe stack notifications bounce volume slide tabs shelf fly",
  wallpaper: "wallpaper background desktop live moving animated video mp4 mkv webm picture image photo lively wallpaper engine fit fill stretch center pause fullscreen game battery latar belakang bergerak",
  ai: "pony assistant ai chat obrolan translate agent agents claude code codex antigravity gemini cursor opencode qwen hermes model share my day scheduled briefs web search persona skills memory memori ingatan",
  integrations: "integration integrations connect hooks claude code paseo permission permissions allow deny question ask user hitl agent done notch request requests",
  aiusage: "ai usage limits limit plan claude code codex openai anthropic session 5-hour weekly week reset quota percent ring warn warning pemakaian kuota batas",
  pomodoro: "focus background sound noise white pink brown rain ocean waves sea wind fire fireplace ambient ambience music volume breaks",
  github: "github token pull requests repositories",
  voice: "voice suara dikte dictation stt mikrofon kamus dictionary qwen zipformer dashscope",
  about: "about version updates check install automatically data folder reset all settings backup restore export import move another new pc computer cadangan pindah",
};

export const SYNONYMS: Readonly<Record<string, string>> = {
  suara: "sound volume audio adhan voice",
  dikte: "voice dictation stt",
  kamus: "dictionary voice",
  mikrofon: "microphone voice",
  stt: "voice dictation",
  audio: "sound volume",
  adzan: "adhan",
  azan: "adhan",
  jam: "clock time",
  waktu: "time",
  baterai: "battery ring icon",
  gambar: "picture image",
  karakter: "character",
  pesawat: "airplane",
  notifikasi: "notification",
  notif: "notification",
  sembunyi: "hide",
  sembunyikan: "hide",
  kursor: "cursor",
  ukuran: "size",
  warna: "color colour",
  bahasa: "language",
  cuaca: "weather",
  sholat: "prayer",
  salat: "prayer",
  shalat: "prayer",
  pengingat: "reminder remind",
  minum: "water",
  air: "water",
  kalender: "calendar",
  layar: "display screen",
  tugas: "todo task",
  catatan: "notes",
  lirik: "lyrics",
  musik: "music media",
  lagu: "music song lyrics",
  suhu: "temperature",
  mulai: "launch start",
  pintasan: "shortcut",
  tombol: "button shortcut",
  istirahat: "break",
  mata: "eye",
  kecerahan: "brightness",
  jaringan: "network wifi",
  taskbar: "taskbar dock",
  otomatis: "automatically auto",
  selesai: "done",
  terlambat: "late",
  telat: "late",
  game: "fps game",
  permainan: "fps game",
  malam: "night",
  hangat: "warm warmer warmth",
  latar: "wallpaper",
  terbenam: "sunset",
  tampilan: "look style",
  dunia: "world",
  zona: "zone time",
  kota: "city",
  lonceng: "chime bell",
  bel: "chime bell",
  setiap: "every",
  besar: "large size",
  timezone: "time zone",
  hujan: "rain",
  ombak: "wave waves ocean",
  laut: "ocean sea",
  angin: "wind",
  perapian: "fireplace",
  derau: "noise",
  fokus: "focus",
  modul: "module modules tab",
  obrolan: "chat pony",
  asisten: "assistant pony",
  memori: "memory",
  ingatan: "memory",
  keahlian: "skills skill",
  kepribadian: "persona",
  kontrol: "control",
};

export type RowsFor = readonly Row[] | ((os: OS) => readonly Row[]);

const REGISTERED_ROWS = new Map<string, RowsFor>([
  ["general", GENERAL_ROWS],
  ["voice", VOICE_ROWS],
  ["ai", AI_ROWS],
  ["aiusage", AIUSAGE_ROWS],
  ["integrations", INTEGRATIONS_ROWS],
  ["media", MEDIA_ROWS],
  ["notifications", NOTIFICATIONS_ROWS],
  ["todo", TODO_ROWS],
  ["pomodoro", POMODORO_ROWS],
  ["health", HEALTH_ROWS],
  ["screentime", SCREENTIME_ROWS],
  ["dayprogress", DAYPROGRESS_ROWS],
  ["bluetooth", BLUETOOTH_ROWS],
  ["calendar", CALENDAR_ROWS],
  ["weather", WEATHER_ROWS],
  ["prayer", PRAYER_ROWS],
  ["dropactions", dropActionsRows],
  ["hud", hudRows],
  ["battery", BATTERY_ROWS],
  ["mirror", MIRROR_ROWS],
  ["stats", STATS_ROWS],
  ["snap", SNAP_ROWS],
  ["dock", DOCK_ROWS],
  ["live", LIVE_ROWS],
  ["effects", EFFECTS_ROWS],
  ["cursor", CURSOR_ROWS],
  ["wallpaper", WALLPAPER_ROWS],
  ["github", GITHUB_ROWS],
]);

export function registerSectionRows(sectionId: string, rows: RowsFor): void {
  REGISTERED_ROWS.set(sectionId, rows);
}

export function sectionRows(id: string, os: OS): Row[] {
  const raw = REGISTERED_ROWS.get(id);
  if (!raw) return [];
  const resolved = typeof raw === "function" ? raw(os) : raw;
  return applyOs(id, resolved, os);
}

export function sectionsFor(os: OS): SectionMeta[] {
  const hidden = HIDDEN_BY_OS[os];
  return SECTIONS.filter((s) => !hidden.has(s.id)).map((s) =>
    os === "macos" && s.macSubtitle ? { ...s, subtitle: s.macSubtitle } : s
  );
}

export function resolveSection(id: string | null | undefined, os: OS): string {
  if (!id) return "general";
  const [secId, spot] = String(id).split("/");
  const visible = sectionsFor(os);
  if (!visible.some((s) => s.id === secId)) return "general";
  return spot ? `${secId}/${spot}` : secId;
}

export function searchSections(q: string, os: OS): SectionMeta[] {
  const visible = sectionsFor(os);
  const needle = q.trim().toLowerCase();
  if (!needle) return visible;

  const prefix: SectionMeta[] = [];
  const substr: SectionMeta[] = [];

  for (const sec of visible) {
    const title = sec.title.toLowerCase();
    const id = sec.id.toLowerCase();
    const words = (sec.words ?? []).map((w) => w.toLowerCase());
    if (
      title.startsWith(needle) ||
      id.startsWith(needle) ||
      words.some((w) => w.startsWith(needle))
    ) {
      prefix.push(sec);
    } else if (
      title.includes(needle) ||
      id.includes(needle) ||
      words.some((w) => w.includes(needle))
    ) {
      substr.push(sec);
    }
  }

  return [...prefix, ...substr];
}

interface IndexedEntry extends SearchHit {
  text: string;
}

function buildSearchEntries(os: OS): IndexedEntry[] {
  const out: IndexedEntry[] = [];
  for (const s of sectionsFor(os)) {
    const secTitle = t(s.title);
    const words = [s.title, secTitle, s.id, ...(s.words ?? []), SEARCH_WORDS[s.id] ?? ""].join(" ");
    out.push({
      section: s.id,
      label: secTitle,
      sub: "",
      text: words,
    });
    const rows = sectionRows(s.id, os);
    if (rows.length === 0) continue;
    let h2 = "";
    for (const r of rows) {
      if (r.t === "h2") {
        h2 = `${r.text} ${t(r.text)}`;
        continue;
      }
      if (!("label" in r) || !r.label) continue;
      const lblEn = plainText(r.label);
      const lblLoc = plainText(t(r.label));
      const subEn = plainText(r.sub);
      const subLoc = r.sub ? plainText(t(r.sub)) : "";
      const extra = r.words ?? "";
      out.push({
        section: s.id,
        label: lblLoc,
        sub: subLoc,
        ...(r.t === "custom" && r.tab ? { part: r.tab } : {}),
        text: [s.title, secTitle, h2, lblEn, lblLoc, subEn, subLoc, extra].join(" "),
      });
      for (const [alsoLabel, part] of r.also ?? []) {
        const aEn = plainText(alsoLabel);
        const aLoc = plainText(t(alsoLabel));
        out.push({
          section: s.id,
          label: aLoc,
          sub: lblLoc,
          row: lblLoc,
          part,
          text: [s.title, secTitle, h2, aEn, aLoc, lblEn, lblLoc].join(" "),
        });
      }
    }
  }
  return out;
}

export function searchAll(q: string, os: OS): SearchHit[] {
  const trimmed = q.trim();
  const entries = buildSearchEntries(os);
  if (!trimmed) {
    return sectionsFor(os).map((s) => ({ section: s.id, label: t(s.title), sub: t(s.subtitle) }));
  }
  const re = (w: string) =>
    new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const words = trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [w, ...(SYNONYMS[w] || "").split(" ").filter(Boolean)].map(re));

  return entries
    .filter((e) => {
      const txt = e.text.toLowerCase();
      return words.every((alts) => alts.some((r) => r.test(txt)));
    })
    .map(({ section, label, sub, row, part }) => ({
      section,
      label,
      ...(sub ? { sub } : {}),
      ...(row ? { row } : {}),
      ...(part ? { part } : {}),
    }));
}
