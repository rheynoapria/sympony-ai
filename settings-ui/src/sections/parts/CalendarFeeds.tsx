import { useEffect, useState } from "react";
import { RefreshCw, X } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { shortFeedUrl, validFeedUrl } from "./logic";

interface IcsFeed {
  url: string;
  name?: string;
  color?: string;
}

const INPUT_CLASS =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

export function CalendarFeedsPart({ settings, set }: CustomPartProps) {
  const feeds = (Array.isArray(settings.icsFeeds) ? settings.icsFeeds : []) as IcsFeed[];
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0a84ff");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsub = notch.onCalendar((p) => {
      const errs = p?.errors ?? {};
      setErrors(errs);
      const count = Object.keys(errs).length;
      setStatus(count ? t("{n} feed error(s)", { n: count }) : t("Up to date"));
    });
    void notch.requestCalendar().catch(() => {});
    return unsub;
  }, []);

  const addFeed = () => {
    const trimmed = url.trim();
    if (!validFeedUrl(trimmed)) {
      setStatus(t("Paste a valid https:// or webcal:// link"));
      return;
    }
    setStatus(t("Loading…"));
    void set({
      icsFeeds: [
        ...feeds,
        { url: trimmed, name: name.trim() || "Calendar", color },
      ],
    });
    setName("");
    setUrl("");
  };

  const removeFeed = (idx: number) => {
    const next = [...feeds];
    next.splice(idx, 1);
    void set({ icsFeeds: next });
  };

  const refreshNow = async () => {
    setStatus(t("Refreshing…"));
    await notch.refreshCalendar().catch(() => {});
  };

  return (
    <div className="space-y-3" data-k="icsFeeds">
      {feeds.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
          {feeds.map((f, i) => (
            <div key={`${f.url}-${i}`} className="flex items-center gap-2.5 py-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: f.color || "#0a84ff" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {f.name || t("Calendar")}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {shortFeedUrl(f.url)}
                </div>
                {errors[f.url] && (
                  <div className="text-[12px] text-destructive">
                    ⚠ {errors[f.url]}
                  </div>
                )}
              </div>
              <Button
                size="xs"
                variant="ghost"
                icon={<X />}
                aria-label={t("Remove")}
                title={t("Remove")}
                onClick={() => removeFeed(i)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Name (e.g. Work)")}
          aria-label={t("Name (e.g. Work)")}
          className={`${INPUT_CLASS} w-36`}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={t("Color")}
          className="h-8 w-10 cursor-pointer rounded-[var(--control-radius)] border border-input bg-background p-0.5"
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFeed();
          }}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          aria-label="iCal URL"
          className={`${INPUT_CLASS} min-w-56 flex-1`}
        />
        <Button size="sm" variant="primary" onClick={addFeed}>
          {t("Add")}
        </Button>
      </div>

      <div className="flex items-center gap-2.5">
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw />}
          onClick={() => void refreshNow()}
        >
          {t("Refresh now")}
        </Button>
        {status && (
          <span className="text-[12.5px] text-muted-foreground">{status}</span>
        )}
      </div>
    </div>
  );
}
