import { useEffect, useState } from "react";
import { Plus, RefreshCw, X } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

interface PresetItem {
  id: string;
  name: string;
  short: string;
  category: string;
  brand: string;
  color: string;
  siteUrl: string;
  description: string;
}

interface CustomFeed {
  id: string;
  name: string;
  url: string;
  color?: string;
  icon?: string;
}

interface FeedTestResult {
  ok?: boolean;
  title?: string;
  host?: string;
  count?: number;
  sample?: string;
  icon?: string | null;
  error?: string;
}

const INPUT_CLASS =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

// Authentic vector brand marks matching frontend/modules/feed.js
const BRAND_SVGS: Record<string, string> = {
  hn: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#FF6600"/><path d="M6.8 6.2h2.6l2.6 5.3 2.6-5.3h2.6l-4 7.7v4h-2.4v-4l-4-7.7z" fill="#fff"/></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#24292F"/><path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M12 4.6a7.4 7.4 0 0 0-2.34 14.42c.37.07.5-.16.5-.36v-1.27c-2.06.45-2.49-.99-2.49-.99-.34-.85-.82-1.08-.82-1.08-.67-.46.05-.45.05-.45.74.05 1.13.76 1.13.76.66 1.13 1.73.8 2.15.61.07-.48.26-.8.47-.99-1.64-.19-3.37-.82-3.37-3.65 0-.81.29-1.47.76-1.99-.08-.19-.33-.94.07-1.96 0 0 .62-.2 2.03.76a7.1 7.1 0 0 1 3.7 0c1.41-.96 2.03-.76 2.03-.76.4 1.02.15 1.77.07 1.96.47.52.76 1.18.76 1.99 0 2.84-1.73 3.46-3.38 3.64.27.23.5.68.5 1.37v2.03c0 .2.13.43.51.36A7.4 7.4 0 0 0 12 4.6z"/></svg>',
  gnews: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#1F2430"/><rect x="4" y="4.5" width="16" height="4.5" rx="1.2" fill="#4285F4"/><rect x="4" y="9" width="7.5" height="10.5" rx="1.2" fill="#EA4335"/><rect x="11.5" y="9" width="8.5" height="5.2" fill="#FBBC05"/><rect x="11.5" y="14.2" width="8.5" height="5.3" rx="1" fill="#34A853"/><rect x="6" y="11" width="3.8" height="3.8" rx=".8" fill="#fff" opacity=".92"/><path d="M13 11.2h5.2M13 16.5h5.2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>',
  techcrunch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#0A9E01"/><path d="M4.5 7.5h8.2v2.7h-2.7v6.3H7.2v-6.3H4.5V7.5zm8.5 0h6.5v2.7H13V7.5zm0 3.6h2.7v2.7h3.8v2.7H13v-5.4z" fill="#fff"/></svg>',
  verge: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#E5127D"/><path d="M5.5 6.8h3.4l3.1 7.6 3.1-7.6h3.4L13.4 18h-2.8L5.5 6.8z" fill="#fff"/></svg>',
  devto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B" stroke="#3F3F46"/><path d="M5 9.2h2.1c1.3 0 2.1.8 2.1 2.8s-.8 2.8-2.1 2.8H5V9.2zm1.5 1.3v3h.6c.4 0 .7-.4.7-1.5s-.3-1.5-.7-1.5h-.6zm3.7-1.3h3.2v1.3h-1.8v.8h1.5v1.3h-1.5v.9h1.8v1.3h-3.2V9.2zm3.9 0h1.5l.9 3.6.9-3.6H19l-1.7 5.6h-1.5l-1.7-5.6z" fill="#fff"/></svg>',
  lobsters: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#AC130D"/><path d="M12 5.2c1.6 0 2.6 1.5 2.6 3.7 0 2.4-1 5.3-1.5 7.4h-2.2c-.5-2.1-1.5-5-1.5-7.4 0-2.2 1-3.7 2.6-3.7zm-4.9 1.6c1.1.3 1.7 1.3 1.4 2.4l-1.3.4c-.9-.5-1.4-1.5-1.1-2.5l1-.3zm9.8 0 1 .3c.3 1-.2 2-1.1 2.5l-1.3-.4c-.3-1.1.3-2.1 1.4-2.4zM9.2 17.3h5.6l1 1.7H8.2l1-1.7z" fill="#fff"/></svg>',
  producthunt: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="#DA552F"/><path d="M13.3 12H10.5V8.8h2.8a1.6 1.6 0 0 1 0 3.2zm0-5.4H8.3v10.8h2.2v-3.2h2.8a3.8 3.8 0 0 0 0-7.6z" fill="#fff"/></svg>',
  bbc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#BB1919"/><rect x="3.2" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="9.4" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><rect x="15.6" y="8.2" width="5.2" height="7.6" rx=".8" fill="#fff"/><path d="M4.8 10.2h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H4.8v-3.1zm6.2 0h1.6c.5 0 .8.3.8.7 0 .3-.2.6-.5.7.4.1.6.4.6.8 0 .5-.4.9-1 .9H11v-3.1zm7.9.8a.9.9 0 0 0-.8-.5c-.6 0-1 .5-1 1.2s.4 1.2 1 1.2c.4 0 .6-.2.8-.5l.6.5a1.7 1.7 0 0 1-1.4.8c-1.1 0-1.8-.8-1.8-2s.7-2 1.8-2c.6 0 1.1.3 1.4.8l-.6.5z" fill="#BB1919"/></svg>',
  npr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#18181B"/><rect x="2.6" y="7.8" width="6" height="8.4" rx=".8" fill="#D62021"/><rect x="9" y="7.8" width="6" height="8.4" rx=".8" fill="#111113" stroke="#52525B" stroke-width=".7"/><rect x="15.4" y="7.8" width="6" height="8.4" rx=".8" fill="#237BBD"/><path d="M4.4 14v-3.8h1l1.2 2v-2h.9V14h-1l-1.2-2v2h-.9zm6.3 0v-3.8h1.7c.8 0 1.3.4 1.3 1.2s-.5 1.2-1.3 1.2h-.7V14h-1zm1-2.1h.6c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-.6v1zm5.4 2.1v-3.8h1.8c.8 0 1.2.4 1.2 1.1 0 .5-.2.9-.7 1.1l.8 1.6h-1.1l-.7-1.4h-.4V14h-.9zm.9-2.1h.7c.3 0 .5-.2.5-.5s-.2-.4-.5-.4H18v.9z" fill="#fff"/></svg>',
  rss: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.5" fill="#F59E0B"/><circle cx="7.5" cy="16.5" r="2" fill="#fff"/><path d="M5.5 10.5a8 8 0 0 1 8 8M5.5 5.8a12.7 12.7 0 0 1 12.7 12.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const FALLBACK_PRESETS: readonly PresetItem[] = [
  { id: "hn", name: "Hacker News", short: "HN", category: "tech", brand: "hn", color: "#ff6600", siteUrl: "https://news.ycombinator.com", description: "Top engineering, startup, and tech stories with scores" },
  { id: "github_trending", name: "GitHub Trending", short: "GitHub", category: "tech", brand: "github", color: "#e6edf3", siteUrl: "https://github.com/trending", description: "Daily trending open-source repositories and languages" },
  { id: "gnews_id", name: "Google News Indonesia", short: "Google News", category: "indonesia", brand: "gnews", color: "#4285f4", siteUrl: "https://news.google.com", description: "Top Indonesian headlines aggregated by Google News" },
  { id: "gnews_id_tech", name: "Google News Tech (ID)", short: "GNews Tech", category: "indonesia", brand: "gnews", color: "#34a853", siteUrl: "https://news.google.com", description: "Technology headlines in Bahasa Indonesia via Google News" },
  { id: "cnn_id", name: "CNN Indonesia", short: "CNN ID", category: "indonesia", brand: "favicon", color: "#cc0000", siteUrl: "https://www.cnnindonesia.com", description: "Breaking national and tech news from CNN Indonesia" },
  { id: "tempo_id", name: "Tempo.co", short: "Tempo", category: "indonesia", brand: "favicon", color: "#e11d48", siteUrl: "https://www.tempo.co", description: "Indonesian journalism and current affairs from Tempo" },
  { id: "antara_id", name: "Antara News", short: "Antara", category: "indonesia", brand: "favicon", color: "#dc2626", siteUrl: "https://www.antaranews.com", description: "Latest Indonesian news wire from LKBN Antara" },
  { id: "techcrunch", name: "TechCrunch", short: "TC", category: "tech", brand: "techcrunch", color: "#0a9e01", siteUrl: "https://techcrunch.com", description: "Startups, AI launches, and venture news" },
  { id: "theverge", name: "The Verge", short: "Verge", category: "tech", brand: "verge", color: "#e5127d", siteUrl: "https://www.theverge.com", description: "Consumer tech, software, and AI coverage" },
  { id: "devto", name: "DEV Community", short: "DEV", category: "tech", brand: "devto", color: "#6366f1", siteUrl: "https://dev.to", description: "Developer tutorials, posts, and deep dives" },
  { id: "lobsters", name: "Lobste.rs", short: "Lobsters", category: "tech", brand: "lobsters", color: "#ac130d", siteUrl: "https://lobste.rs", description: "Focused computing and systems engineering links" },
  { id: "producthunt", name: "Product Hunt", short: "PH", category: "tech", brand: "producthunt", color: "#da552f", siteUrl: "https://www.producthunt.com", description: "New products, indie tools, and daily launches" },
  { id: "bbc_world", name: "BBC World News", short: "BBC", category: "world", brand: "bbc", color: "#bb1919", siteUrl: "https://www.bbc.com/news", description: "Global headlines from BBC News" },
  { id: "npr_news", name: "NPR News", short: "NPR", category: "world", brand: "npr", color: "#2c639c", siteUrl: "https://www.npr.org", description: "World and US reporting from NPR" },
];

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function SourceBadge({ brand, favicon }: { brand: string; favicon?: string }) {
  if (favicon && brand === "favicon") {
    return (
      <span className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-white p-0.5 shadow-xs">
        <img src={favicon} alt="" className="size-full object-contain" />
      </span>
    );
  }
  const svg = BRAND_SVGS[brand] ?? BRAND_SVGS.rss;
  return (
    <span
      className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] [&>svg]:block [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const GROUPS: readonly { id: string; label: string }[] = [
  { id: "tech", label: "Tech & Developer" },
  { id: "indonesia", label: "Indonesia" },
  { id: "world", label: "World News" },
];

export function FeedSourcesPart({ settings, set }: CustomPartProps) {
  const [presets, setPresets] = useState<readonly PresetItem[]>(FALLBACK_PRESETS);
  const [favicons, setFavicons] = useState<Record<string, string>>({});
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = new Set(
    Array.isArray(settings.feedSources) ? (settings.feedSources as string[]) : []
  );

  useEffect(() => {
    void notch
      .svc("feed", "presets")
      .then((res) => {
        if (Array.isArray(res) && res.length) setPresets(res as PresetItem[]);
      })
      .catch(() => {});
    void notch
      .svc("feed", "get")
      .then((res) => {
        const d = res as { items?: unknown[]; favicons?: Record<string, string> } | null;
        if (d?.favicons) setFavicons(d.favicons);
        if (Array.isArray(d?.items)) setItemCount(d.items.length);
      })
      .catch(() => {});
    const unsub = notch.on("feed", (payload) => {
      const d = payload as { items?: unknown[]; favicons?: Record<string, string> } | null;
      if (d?.favicons) setFavicons(d.favicons);
      if (Array.isArray(d?.items)) setItemCount(d.items.length);
    });
    return unsub;
  }, []);

  const toggleSource = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    void set({ feedSources: [...next] });
  };

  const refreshNow = async () => {
    setBusy(true);
    try {
      const d = (await notch.svc("feed", "refresh")) as {
        items?: unknown[];
        favicons?: Record<string, string>;
      } | null;
      if (d?.favicons) setFavicons(d.favicons);
      if (Array.isArray(d?.items)) setItemCount(d.items.length);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-k="feedSources">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">
          {itemCount !== null
            ? t("{n} stories loaded · {s} sources active", { n: itemCount, s: selected.size })
            : t("{s} sources active", { s: selected.size })}
        </span>
        <Button
          size="xs"
          variant="secondary"
          icon={<RefreshCw className={busy ? "animate-spin" : ""} />}
          disabled={busy}
          onClick={() => void refreshNow()}
        >
          {busy ? t("Refreshing…") : t("Refresh feeds")}
        </Button>
      </div>

      {GROUPS.map((grp) => {
        const rows = presets.filter((p) => p.category === grp.id);
        if (!rows.length) return null;
        return (
          <div key={grp.id} className="space-y-1.5">
            <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t(grp.label)}
            </div>
            <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
              {rows.map((p) => {
                const host = hostOf(p.siteUrl);
                const on = selected.has(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-3 py-2">
                    <SourceBadge brand={p.brand} favicon={favicons[host]} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {p.name}
                      </div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {t(p.description)}
                      </div>
                    </div>
                    <Switch
                      checked={on}
                      aria-label={p.name}
                      onCheckedChange={(v) => toggleSource(p.id, v)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SUGGESTED_TOPICS = ["AI & LLM", "Rust & Tauri", "Startup Indonesia", "Cybersecurity", "Open Source"];

export function FeedGoogleTopicsPart({ settings, set }: CustomPartProps) {
  const topics = (Array.isArray(settings.feedGoogleTopics) ? settings.feedGoogleTopics : []) as string[];
  const [draft, setDraft] = useState("");

  const addTopic = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (topics.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    void set({ feedGoogleTopics: [...topics, clean] });
    setDraft("");
  };

  const removeTopic = (idx: number) => {
    const next = [...topics];
    next.splice(idx, 1);
    void set({ feedGoogleTopics: next });
  };

  return (
    <div className="space-y-3" data-k="feedGoogleTopics">
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((topic, idx) => (
            <span
              key={`${topic}-${idx}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[12px] font-medium text-foreground"
            >
              <span>{topic}</span>
              <button
                type="button"
                aria-label={t("Remove")}
                onClick={() => removeTopic(idx)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTopic(draft);
            }
          }}
          placeholder={t("Add topic (e.g. Startup Indonesia)")}
          aria-label={t("Add topic (e.g. Startup Indonesia)")}
          className={`${INPUT_CLASS} flex-1`}
        />
        <Button size="sm" icon={<Plus />} onClick={() => addTopic(draft)}>
          {t("Add")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-muted-foreground">{t("Suggestions")}:</span>
        {SUGGESTED_TOPICS.filter((s) => !topics.some((x) => x.toLowerCase() === s.toLowerCase())).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => addTopic(s)}
            className="rounded-full border border-border/80 bg-background px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
          >
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedCustomUrlsPart({ settings, set }: CustomPartProps) {
  const list = (Array.isArray(settings.feedCustomUrls) ? settings.feedCustomUrls : []) as CustomFeed[];
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [statusErr, setStatusErr] = useState(false);
  const [testing, setTesting] = useState(false);
  const [favicons, setFavicons] = useState<Record<string, string>>({});

  useEffect(() => {
    void notch
      .svc("feed", "get")
      .then((res) => {
        const d = res as { favicons?: Record<string, string> } | null;
        if (d?.favicons) setFavicons(d.favicons);
      })
      .catch(() => {});
  }, []);

  const testAndAdd = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setStatusErr(true);
      setStatus(t("Paste a valid https:// RSS or Atom feed URL."));
      return;
    }
    if (list.some((f) => f.url.toLowerCase() === trimmed.toLowerCase())) {
      setStatusErr(true);
      setStatus(t("That feed URL is already added."));
      return;
    }
    setTesting(true);
    setStatusErr(false);
    setStatus(t("Testing feed…"));
    try {
      const res = (await notch.svc("feed", "test", trimmed)) as FeedTestResult | null;
      if (!res || !res.ok) {
        setStatusErr(true);
        setStatus(res?.error || t("Couldn’t read that RSS/Atom feed."));
        return;
      }
      const label = name.trim() || res.title || hostOf(trimmed) || "RSS Feed";
      const entry: CustomFeed = {
        id: `custom-${Date.now().toString(36)}`,
        name: label,
        url: trimmed,
        color: "#f59e0b",
        ...(res.icon ? { icon: res.icon } : {}),
      };
      if (res.icon && res.host) {
        setFavicons((prev) => ({ ...prev, [res.host!]: res.icon! }));
      }
      await set({ feedCustomUrls: [...list, entry] });
      setName("");
      setUrl("");
      setStatusErr(false);
      setStatus(t("Added {name} ({n} items found)", { name: label, n: res.count ?? 0 }));
    } catch {
      setStatusErr(true);
      setStatus(t("Couldn’t read that RSS/Atom feed."));
    } finally {
      setTesting(false);
    }
  };

  const removeCustom = (idx: number) => {
    const next = [...list];
    next.splice(idx, 1);
    void set({ feedCustomUrls: next });
  };

  return (
    <div className="space-y-3" data-k="feedCustomUrls">
      {list.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
          {list.map((f, i) => {
            const ico = f.icon || favicons[hostOf(f.url)];
            return (
              <div key={`${f.url}-${i}`} className="flex items-center gap-2.5 py-2">
                <SourceBadge brand={ico ? "favicon" : "rss"} favicon={ico} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{f.name}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">{f.url}</div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<X />}
                  aria-label={t("Remove")}
                  title={t("Remove")}
                  onClick={() => removeCustom(i)}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Name (optional)")}
          aria-label={t("Name (optional)")}
          className={`${INPUT_CLASS} w-36`}
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void testAndAdd();
            }
          }}
          placeholder={t("https://example.com/rss.xml")}
          aria-label={t("RSS or Atom URL")}
          className={`${INPUT_CLASS} min-w-[200px] flex-1`}
        />
        <Button size="sm" disabled={testing} onClick={() => void testAndAdd()}>
          {testing ? t("Testing…") : t("Test & Add")}
        </Button>
      </div>

      {status && (
        <div className={`text-[12px] ${statusErr ? "text-destructive" : "text-muted-foreground"}`}>
          {status}
        </div>
      )}
    </div>
  );
}
