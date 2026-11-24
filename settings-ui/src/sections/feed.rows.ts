import type { Row } from "../rows/types.ts";

export const FEED_KEYS = [
  "feedEnabled",
  "feedSources",
  "feedGoogleTopics",
  "feedCustomUrls",
  "feedRefreshMinutes",
  "feedPonySummary",
] as const;

export const FEED_ROWS: readonly Row[] = [
  {
    t: "toggle",
    k: "feedEnabled",
    label: "Enable Feed & RSS",
    sub: "Fetch headlines from your chosen sources and show them in the Feed module",
  },
  { t: "h2", text: "Built-in sources" },
  {
    t: "custom",
    id: "feedSources",
    label: "Preset news & tech feeds",
    sub: "Pick from Hacker News, GitHub Trending, Google News Indonesia, Indonesian news portals, and global tech feeds.",
    words: "hacker news github trending google news cnn tempo antara techcrunch verge dev lobsters bbc npr berita indonesia",
  },
  { t: "h2", text: "Google News topics" },
  {
    t: "custom",
    id: "feedGoogleTopics",
    label: "Custom keyword topics",
    sub: "Follow any topic via Google News Indonesia search RSS (e.g. AI & LLM, Rust & Tauri, Startup Indonesia).",
    words: "google news topic keyword topik kata kunci",
  },
  { t: "h2", text: "Custom RSS & Atom feeds" },
  {
    t: "custom",
    id: "feedCustomUrls",
    label: "Add your own RSS or Atom link",
    sub: "Supports RSS 2.0 and Atom 1.0 blogs, newsletters, and YouTube channel feeds. Favicons are fetched directly from the publisher.",
    words: "rss atom xml url blog newsletter custom feed",
  },
  { t: "h2", text: "Sync & Pony summary" },
  {
    t: "select",
    k: "feedRefreshMinutes",
    label: "Auto-refresh interval",
    sub: "How often Sympony checks your enabled feeds in the background",
    options: [
      [15, "Every 15 minutes"],
      [30, "Every 30 minutes"],
      [60, "Every hour"],
      [0, "Manual only"],
    ],
  },
  {
    t: "toggle",
    k: "feedPonySummary",
    label: "Summarize with Pony",
    sub: "Show a one-click Pony Summary panel with 3 key takeaways for any story (cached locally so re-opening costs zero tokens)",
  },
];
