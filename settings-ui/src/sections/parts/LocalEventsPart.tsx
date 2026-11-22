import { useRef, useState } from "react";
import { X } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import type { LocalEvent } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { defaultEventStart } from "./logic";

const INPUT_CLASS =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

const FALLBACK_REPEATS: [string, string][] = [
  ["none", "Once"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];

export function LocalEventsPart({ settings, set }: CustomPartProps) {
  const events = (
    Array.isArray(settings.localEvents) ? settings.localEvents : []
  ) as LocalEvent[];
  const sorted = [...events].sort((a, b) => a.start - b.start);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => defaultEventStart());
  const [dur, setDur] = useState("30");
  const [repeat, setRepeat] = useState("none");
  const [loc, setLoc] = useState("");

  const titleRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);

  const repeatOpts: [string, string][] =
    typeof window !== "undefined" && window.LocalEvents
      ? window.LocalEvents.repeats()
      : FALLBACK_REPEATS.map(([v, l]) => [v, t(l)]);

  const repeatLabels: Record<string, string> = {
    daily: t("repeats daily"),
    weekly: t("repeats weekly"),
    monthly: t("repeats monthly"),
    yearly: t("repeats yearly"),
  };

  const locale = typeof window !== "undefined" ? window._tLocale?.() : undefined;

  const removeEvent = (id: string) => {
    if (typeof window !== "undefined" && window.LocalEvents && window.notch) {
      window.LocalEvents.remove(events, id);
    } else {
      void set({ localEvents: events.filter((e) => e.id !== id) });
    }
  };

  const addEvent = () => {
    const [day = "", time = ""] = start.split("T");
    const form = { title, day, time, minutes: dur, location: loc, repeat };
    if (typeof window !== "undefined" && window.LocalEvents && window.notch) {
      const r = window.LocalEvents.save(events, form);
      if (r.bad) {
        (r.bad === "title" ? titleRef.current : startRef.current)?.focus();
        return;
      }
    } else {
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        titleRef.current?.focus();
        return;
      }
      const d = new Date(start);
      if (Number.isNaN(d.getTime())) {
        startRef.current?.focus();
        return;
      }
      const mins = Math.max(5, Math.round(Number(dur)) || 30);
      const ev: LocalEvent = {
        id: "l" + Date.now().toString(36),
        title: cleanTitle,
        start: d.getTime(),
        end: d.getTime() + mins * 60000,
        location: loc.trim(),
        repeat,
      };
      void set({ localEvents: [...events, ev] });
    }
    setTitle("");
    setLoc("");
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  return (
    <div className="space-y-3" data-k="localEvents">
      {sorted.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
          {sorted.map((e) => (
            <div key={e.id} className="flex items-center gap-2.5 py-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: "#a78bfa" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {e.title}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {new Date(e.start).toLocaleString(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {" · "}
                  {t("{n} min", { n: Math.round((e.end - e.start) / 60000) })}
                  {e.repeat && e.repeat !== "none"
                    ? ` · ${repeatLabels[e.repeat] || t("repeats {how}", { how: e.repeat })}`
                    : ""}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
              </div>
              <Button
                size="xs"
                variant="ghost"
                icon={<X />}
                aria-label={t("Delete")}
                title={t("Delete")}
                onClick={() => removeEvent(e.id)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEvent();
          }}
          placeholder={t("Event title")}
          aria-label={t("Event title")}
          className={`${INPUT_CLASS} min-w-40 flex-1`}
        />
        <input
          ref={startRef}
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-label={t("Start")}
          className={`${INPUT_CLASS} tabular-nums`}
        />
        <div className="inline-flex items-center gap-1.5">
          <input
            type="number"
            min={5}
            step={5}
            value={dur}
            onChange={(e) => setDur(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addEvent();
            }}
            title={t("Duration (minutes)")}
            aria-label={t("Duration (minutes)")}
            className={`${INPUT_CLASS} w-20 tabular-nums`}
          />
          <span className="text-[12.5px] text-muted-foreground">{t("min")}</span>
        </div>
        <select
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-label={t("Repeat")}
          className={`${INPUT_CLASS} pe-7`}
        >
          {repeatOpts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEvent();
          }}
          placeholder={t("Location or meeting link")}
          aria-label={t("Location or meeting link")}
          className={`${INPUT_CLASS} min-w-44 flex-1`}
        />
        <Button size="sm" variant="primary" onClick={addEvent}>
          {t("Add event")}
        </Button>
      </div>
    </div>
  );
}
