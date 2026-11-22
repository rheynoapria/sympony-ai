import { AlertCircle } from "@/components/icons";
import { useHelper } from "@/lib/helper";
import { t } from "@/lib/i18n";
import type { CustomPartProps } from "@/rows/types";

interface PrayerHelper {
  enabled?: boolean;
  ok?: boolean;
  error?: string;
  place?: string;
  source?: string;
  days?: Record<string, number>[];
  names?: Record<string, string>;
}

const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

export function PrayerTodayPart({ settings }: CustomPartProps) {
  const p = useHelper<PrayerHelper>("prayer");

  if (!settings.prayerEnabled || !p || !p.enabled) return null;

  if (!p.ok) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <AlertCircle className="size-4 shrink-0" />
        <span>{p.error || t("Getting the times…")}</span>
      </div>
    );
  }

  const day = p.days?.[0] ?? {};
  const names = p.names ?? {};
  const locale = typeof window !== "undefined" ? window._tLocale?.() : undefined;
  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: settings.clock24h === false ? "h12" : "h23",
    });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-foreground">
          {t("Today")} · {p.place}
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {t("Source: {source}", { source: p.source ?? "" })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRAYERS.filter((k) => Boolean(day[k])).map((k) => (
          <div
            key={k}
            className="flex flex-col items-center rounded-[var(--control-radius)] border border-border bg-muted/40 px-2.5 py-1"
          >
            <span className="text-[11px] text-muted-foreground">
              {names[k] ?? k}
            </span>
            <span className="text-[12.5px] font-semibold tabular-nums text-foreground">
              {fmt(day[k])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
