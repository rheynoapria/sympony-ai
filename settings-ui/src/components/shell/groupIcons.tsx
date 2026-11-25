import type { CSSProperties, ReactNode } from "react";
import { BrandIcon, iconTint } from "@/components/icons";

const app = (src: string) => <img src={src} alt="" className="size-4 object-contain" />;
// (its Fluent Color icon on a soft wash of the icon's own colour; the filled glyph in that colour where there's no
// colour icon)
const tint = (name: string, c: string) => (
  <span className="icon-tile grid size-full place-items-center rounded-[inherit]" style={{ "--ic": iconTint(name) ?? c } as CSSProperties}>
    <BrandIcon name={name} tint={c} className="size-[62%]" />
  </span>
);

// Each settings card's icon, by its (English) title: one look for every section, so a card says what it is at a glance
const ICONS: Record<string, () => ReactNode> = {
  // integrations & AI
  "Requests under the notch": () => tint("BellDot", "#f59e0b"),
  "Claude Code": () => app("./ai-icons/claudecode-color.svg"),
  Paseo: () => app("./ai-icons/paseo.png"),
  Brain: () => tint("BrainCircuit", "#8b5cf6"),
  Persona: () => tint("UserRound", "#ec4899"),
  Abilities: () => tint("Hammer", "#f59e0b"),
  "Outside tools (MCP)": () => tint("Plug", "#0ea5e9"),
  Skills: () => tint("Wand2", "#a855f7"),
  Memory: () => tint("Brain", "#6366f1"),
  Appearance: () => tint("Palette", "#f472b6"),
  "Style & Layout": () => tint("Palette", "#ec4899"),
  "Control behavior": () => tint("SlidersHorizontal", "#3b82f6"),
  "Module Style Library": () => tint("LayoutGrid", "#8b5cf6"),
  "Custom Modules": () => tint("Boxes", "#10b981"),
  "Scheduled briefs": () => tint("CalendarClock", "#0ea5e9"),
  // voice
  "Voice setup": () => tint("AudioWaveform", "#ec4899"),
  Engine: () => tint("Cpu", "#64748b"),
  Trigger: () => tint("Keyboard", "#3b82f6"),
  Language: () => tint("Languages", "#14b8a6"),
  Output: () => tint("TextCursorInput", "#8b5cf6"),
  Dictionary: () => tint("BookA", "#f59e0b"),
  Microphone: () => tint("Mic", "#ef4444"),
  Permissions: () => tint("ShieldCheck", "#22c55e"),
  // notch & system
  "Closed Sympony": () => tint("PanelTopClose", "#3b82f6"),
  Opening: () => tint("DoorOpen", "#6366f1"),
  Size: () => tint("Ruler", "#64748b"),
  Layouts: () => tint("PanelsTopLeft", "#0ea5e9"),
  Tiles: () => tint("LayoutGrid", "#8b5cf6"),
  Clock: () => tint("Clock", "#f59e0b"),
  "Keyboard shortcuts": () => tint("Command", "#64748b"),
  "App launcher": () => tint("Rocket", "#f97316"),
  Shelf: () => tint("Archive", "#a16207"),
  Clipboard: () => tint("Clipboard", "#0ea5e9"),
  Phone: () => tint("Smartphone", "#22c55e"),
  "Try it": () => tint("MousePointerClick", "#3b82f6"),
  Default: () => tint("Star", "#f59e0b"),
  Info: () => tint("Info", "#3b82f6"),
  Updates: () => tint("Download", "#0ea5e9"),
  "Back up and restore": () => tint("DatabaseBackup", "#14b8a6"),
  // features
  Reminders: () => tint("BellRing", "#ef4444"),
  Timer: () => tint("Timer", "#f97316"),
  Pause: () => tint("CirclePause", "#64748b"),
  "Background sound": () => tint("AudioLines", "#14b8a6"),
  Lyrics: () => tint("MicVocal", "#ec4899"),
  YouTube: () => tint("MonitorPlay", "#ef4444"),
  VLC: () => tint("Clapperboard", "#f97316"),
  "Google Calendar": () => tint("Calendar", "#4285f4"),
  "Subscribed calendars (iCal / .ics)": () => tint("CalendarPlus", "#ef4444"),
  "Local events": () => tint("CalendarDays", "#f43f5e"),
  Location: () => tint("MapPin", "#22c55e"),
  Calculation: () => tint("Calculator", "#6366f1"),
  Adhan: () => tint("MoonStar", "#10b981"),
  "What’s new": () => tint("Gift", "#ec4899"),
  Guide: () => tint("BookOpenText", "#3b82f6"),
  // feed & rss
  "Built-in sources": () => tint("BookOpenText", "#f59e0b"),
  "Google News topics": () => tint("Search", "#4285f4"),
  "Custom RSS & Atom feeds": () => tint("Globe", "#0ea5e9"),
  "Sync & Pony summary": () => tint("Sparkles", "#8b5cf6"),
};

/** The icon for a card titled `title` (its English text, before translation); a neutral one when none fits. */
export function groupIcon(title?: string): ReactNode {
  if (!title) return undefined;
  const f = ICONS[title];
  return f ? f() : tint("AppWindow", "#6366f1");
}

/** Titles that have their own icon (for the test that every card has one). */
export const GROUP_ICON_TITLES = Object.keys(ICONS);
