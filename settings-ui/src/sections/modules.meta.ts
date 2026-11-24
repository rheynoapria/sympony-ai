import type { OS } from "./registry.ts";

export const MODULES_KEYS = ["notchView", "modules", "defaultTab", "rememberTab", "cardStyle", "moduleStyles"] as const;

export interface ModuleMeta {
  icon: string;
  title: string;
  sub: string;
}

export const MODULE_META: Readonly<Record<string, ModuleMeta>> = {
  home: { icon: "Home", title: "Home", sub: "Music, calendar and mirror" },
  calendar: {
    icon: "Calendar",
    title: "Calendar",
    sub: "The whole month, with your events and tasks",
  },
  prayer: {
    icon: "MoonStar",
    title: "Prayer Times",
    sub: "Today’s prayers with a countdown. Shows while Prayer Times is on",
  },
  control: {
    icon: "SlidersHorizontal",
    title: "Control",
    sub: "Volume, sound output and input, brightness, quick toggles",
  },
  shelf: { icon: "Inbox", title: "Shelf", sub: "Temporary spot for files" },
  todo: { icon: "CheckSquare", title: "Todo", sub: "Tasks with trash & restore" },
  notes: { icon: "StickyNote", title: "Notes", sub: "Scratchpad" },
  pomodoro: {
    icon: "Timer",
    title: "Pomodoro",
    sub: "Focus sessions, timer & stopwatch",
  },
  weather: { icon: "CloudSun", title: "Weather", sub: "Open-Meteo forecast" },
  health: {
    icon: "HeartPulse",
    title: "Health",
    sub: "Water, breaks, breathing",
  },
  screentime: {
    icon: "Hourglass",
    title: "Screen Time",
    sub: "Where your time goes",
  },
  dayprogress: {
    icon: "GanttChart",
    title: "Day Progress",
    sub: "Timeline of today",
  },
  bluetooth: {
    icon: "Bluetooth",
    title: "Bluetooth & Wi-Fi",
    sub: "Devices, battery, Wi-Fi networks and a speed test",
  },
  stats: { icon: "Gauge", title: "System", sub: "CPU, RAM, network, disk" },
  translate: {
    icon: "Languages",
    title: "Translate",
    sub: "LLM translation (Gemini / Claude / OpenAI-compatible / Ollama)",
  },
  chat: {
    icon: "Sparkles",
    title: "Pony",
    sub: "Your assistant with persona, skills, memory, and scheduled briefs",
  },
  github: {
    icon: "GitBranch",
    title: "GitHub",
    sub: "Pull requests to review",
  },
  feed: {
    icon: "BookOpenText",
    title: "Feed & RSS",
    sub: "Hacker News, GitHub Trending, Google News, Indonesian news and custom RSS",
  },
  radio: {
    icon: "Radio",
    title: "Radio",
    sub: "Internet radio stations from Radio Browser",
  },
  bookmarks: {
    icon: "Bookmark",
    title: "Bookmarks",
    sub: "Links you save, in categories of your own",
  },
  aiusage: {
    icon: "Gauge",
    title: "AI usage",
    sub: "Claude and Codex plan limits. Shows while a service is on in AI usage",
  },
  worldclock: {
    icon: "Globe",
    title: "World clock",
    sub: "The time in other places, with a meeting planner",
  },
  teleprompter: {
    icon: "ScrollText",
    title: "Teleprompter",
    sub: "Your script scrolls right under the camera while you talk",
  },
  launcher: {
    icon: "Rocket",
    title: "Launcher",
    sub: "Quick access to your favourite apps and folders",
  },
  notifs: {
    icon: "Bell",
    title: "Notifications",
    sub: "Recent notifications from your Mac and browser",
  },
};

export function moduleMetaFor(id: string, os: OS): ModuleMeta {
  if (id === "bluetooth" && (os === "macos" || os === "linux")) {
    return {
      icon: "Gauge",
      title: "Speed test",
      sub: "Ping, download and upload, against Cloudflare’s speed test",
    };
  }
  return MODULE_META[id] ?? { icon: "Boxes", title: id, sub: "" };
}

export interface WelcomeCard {
  faKey: string;
  icon: string;
  color: string;
  title: string;
  desc: string;
}

export const WELCOME_CARDS: readonly WelcomeCard[] = [
  { faKey: "music", icon: "Music", color: "#ff2d55", title: "Music", desc: "Album art glow, visualizer, controls and lyrics" },
  { faKey: "calendar-days", icon: "Calendar", color: "#ff3b30", title: "Calendar", desc: "Google, Outlook or iCal: the month, your day and meeting reminders" },
  { faKey: "wand-magic-sparkles", icon: "Wand2", color: "#bf5af2", title: "Pony", desc: "Ask anything. Pony knows your day, sets reminders and repeating todos, and sends you a brief" },
  { faKey: "list-check", icon: "CheckSquare", color: "#ff9f0a", title: "Todo & Notes", desc: "Tasks with reminders that can repeat, quick notes" },
  { faKey: "mosque", icon: "MoonStar", color: "#30d158", title: "Prayer Times", desc: "Kemenag RI in Indonesia, the local authority elsewhere, with your own adhan" },
  { faKey: "stopwatch", icon: "Timer", color: "#ff6b4a", title: "Pomodoro", desc: "Focus sessions, a timer and a stopwatch" },
  { faKey: "cloud-sun", icon: "CloudSun", color: "#32ade6", title: "Weather", desc: "Live forecast, no API key" },
  { faKey: "bell", icon: "Bell", color: "#ff3b30", title: "Notifications", desc: "Windows and browser notifications, right in Sympony" },
  { faKey: "sliders", icon: "SlidersHorizontal", color: "#8e8e93", title: "Control", desc: "Volume, sound output, microphone and brightness in one tab" },
  { faKey: "heart-pulse", icon: "HeartPulse", color: "#ff375f", title: "Health", desc: "Water, breaks, breathing, eye breaks" },
  { faKey: "hourglass-half", icon: "Hourglass", color: "#5856d6", title: "Screen Time", desc: "Where your time goes" },
  { faKey: "gauge-high", icon: "Gauge", color: "#8e8e93", title: "System", desc: "CPU, memory, network, disk, temperature" },
  { faKey: "bluetooth-b", icon: "Bluetooth", color: "#0a84ff", title: "Bluetooth & Wi-Fi", desc: "Devices, battery, join Wi-Fi networks" },
  { faKey: "hand-holding", icon: "Inbox", color: "#ff9f0a", title: "Drop Actions", desc: "Zip, convert, copy, share, OneDrive" },
  { faKey: "table-columns", icon: "Columns2", color: "#64d2ff", title: "Snap Zones", desc: "Drag a window to Sympony to tile it" },
  { faKey: "sliders", icon: "SlidersHorizontal", color: "#8e8e93", title: "HUD", desc: "Volume & brightness sliders" },
  { faKey: "language", icon: "Languages", color: "#bf5af2", title: "Translate", desc: "Gemini, Claude, any OpenAI-compatible API, or Ollama" },
  { faKey: "arrow-pointer", icon: "MousePointer2", color: "#ff9f0a", title: "Cute cursors", desc: "Cat-paw mouse pointers in every app" },
];
