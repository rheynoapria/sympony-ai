import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  BatteryCharging,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Clock,
  CloudSun,
  Cpu,
  Globe,
  HardDrive,
  MemoryStick,
  MoonStar,
  Plus,
  Thermometer,
  Wifi,
} from "@/components/icons";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import { offSlotIds } from "@/rows/os";
import type { CustomPartProps } from "@/rows/types";
import { CLOCK_MODES, CLOCK_SIZES, IDLE_SLOTS } from "../general.rows";

type SlotPart = "left" | "middle" | "right";

function SlotIcon({ kind, className = "size-3.5" }: { kind: string; className?: string }) {
  switch (kind) {
    case "none":
    case "off":
      return <Ban className={className} aria-hidden="true" />;
    case "weather":
      return <CloudSun className={className} aria-hidden="true" />;
    case "battery":
      return <BatteryCharging className={className} aria-hidden="true" />;
    case "date":
      return <CalendarDays className={className} aria-hidden="true" />;
    case "prayer":
      return <MoonStar className={className} aria-hidden="true" />;
    case "event":
      return <CalendarCheck className={className} aria-hidden="true" />;
    case "todo":
      return <CheckSquare className={className} aria-hidden="true" />;
    case "time":
      return <Clock className={className} aria-hidden="true" />;
    case "temp":
      return <Thermometer className={className} aria-hidden="true" />;
    case "cpu":
      return <Cpu className={className} aria-hidden="true" />;
    case "ram":
      return <MemoryStick className={className} aria-hidden="true" />;
    case "disk":
      return <HardDrive className={className} aria-hidden="true" />;
    case "wifi":
      return <Wifi className={className} aria-hidden="true" />;
    case "net":
      return <ArrowUpDown className={className} aria-hidden="true" />;
    case "netDown":
      return <ArrowDown className={cn(className, "text-emerald-400")} aria-hidden="true" />;
    case "netUp":
      return <ArrowUp className={cn(className, "text-amber-400")} aria-hidden="true" />;
    case "world":
      return <Globe className={className} aria-hidden="true" />;
    default:
      return <Clock className={className} aria-hidden="true" />;
  }
}

function locale(): string | undefined {
  if (typeof window !== "undefined" && typeof window._tLocale === "function") {
    return window._tLocale();
  }
  return undefined;
}

function SlotSample({
  kind,
  settings,
}: {
  kind: string;
  settings: CustomPartProps["settings"];
}): ReactNode {
  const h24 = settings.clock24h !== false;
  const hm = (d: Date) =>
    d.toLocaleTimeString(locale(), {
      hour: h24 ? "2-digit" : "numeric",
      minute: "2-digit",
      hourCycle: h24 ? "h23" : "h12",
    });
  const at = (h: number, m: number) => hm(new Date(2026, 0, 1, h, m));

  switch (kind) {
    case "weather":
      return (
        <span className="inline-flex items-center gap-1">
          <SlotIcon kind="weather" className="size-3" />
          <b className="font-semibold">31°</b>
        </span>
      );
    case "battery":
      return (
        <span className="inline-flex items-center gap-1">
          {Boolean(settings.showBatteryPercent) && <b className="font-semibold">66%</b>}
          <SlotIcon kind="battery" className="size-3.5 text-emerald-400" />
        </span>
      );
    case "date":
      return (
        <b className="font-semibold">
          {new Date().toLocaleDateString(locale(), { weekday: "short", day: "numeric" })}
        </b>
      );
    case "prayer":
      return (
        <span className="inline-flex items-center gap-1">
          <b className="font-semibold">{t("Asr")}</b>
          <span className="opacity-70">{at(15, 12)}</span>
        </span>
      );
    case "event":
      return (
        <span className="inline-flex items-center gap-1">
          <SlotIcon kind="event" className="size-3" />
          <span className="opacity-80">{at(14, 30)}</span>
        </span>
      );
    case "todo":
      return (
        <span className="inline-flex items-center gap-1">
          <SlotIcon kind="todo" className="size-3" />
          <span className="opacity-80">{at(16, 0)}</span>
        </span>
      );
    case "time":
      return <b className="font-semibold tabular-nums">{hm(new Date())}</b>;
    case "temp":
      return (
        <span className="inline-flex items-center gap-1">
          <SlotIcon kind="temp" className="size-3 text-emerald-400" />
          <b className="font-semibold">48°</b>
        </span>
      );
    case "cpu":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-65">CPU</span>
          <b className="font-semibold">23%</b>
        </span>
      );
    case "ram":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-65">RAM</span>
          <b className="font-semibold">54%</b>
        </span>
      );
    case "disk":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-65">{t("Disk")}</span>
          <b className="font-semibold">61%</b>
        </span>
      );
    case "wifi":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-65">Wi-Fi</span>
          <b className="font-semibold">82%</b>
        </span>
      );
    case "net":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] tabular-nums">
          <span className="text-emerald-400">↓24M</span>
          <span className="text-amber-400">↑640K</span>
        </span>
      );
    case "netDown":
      return <span className="text-emerald-400 tabular-nums">↓24 Mbps</span>;
    case "netUp":
      return <span className="text-amber-400 tabular-nums">↑640 Kbps</span>;
    case "world": {
      const p = window.SymponyClock?.places(settings)?.[0];
      return p ? (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-70">{p.name}</span>
          <b className="font-semibold tabular-nums">
            {window.SymponyClock?.time(p.tz, Date.now(), h24)}
          </b>
        </span>
      ) : (
        <SlotIcon kind="world" className="size-3" />
      );
    }
    default:
      return null;
  }
}

export function ClosedSlotsPart({ settings, set, row, os, part }: CustomPartProps) {
  const [openPart, setOpenPart] = useState<SlotPart | null>(
    part === "left" || part === "middle" || part === "right" ? part : null
  );

  useEffect(() => {
    if (part === "left" || part === "middle" || part === "right") {
      setOpenPart(part);
    }
  }, [part]);

  const idleLeft = String(settings.idleLeft || "none");
  const idleRight = String(settings.idleRight || "none");
  const idleClock = String(settings.idleClock || "time");
  const clockSize = String(settings.clockSize || "normal");
  const h = Math.max(28, Math.min(44, Number(settings.notchHeight) || 32));
  const notchLook = String(settings.notchLook || "black");
  const notchColor =
    typeof settings.notchColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.notchColor)
      ? settings.notchColor
      : "#1c2b4d";
  const isLightColor =
    notchLook === "color" &&
    (() => {
      const n = parseInt(notchColor.slice(1), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65;
    })();
  const previewStyle =
    notchLook === "glass"
      ? {
          height: `${h + 8}px`,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06)), rgba(22,24,32,0.72)",
          backdropFilter: "blur(14px)",
        }
      : notchLook === "color"
        ? { height: `${h + 8}px`, background: notchColor }
        : { height: `${h + 8}px` };
  const scale = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 }[clockSize] ?? 1;
  const baseFs = Math.max(10, Math.min(14, h * 0.38));
  const clockFs =
    scale > 1
      ? Math.round(Math.min(h * 0.7, baseFs * scale) * 4) / 4
      : scale < 1
        ? Math.max(9, Math.round(baseFs * scale * 4) / 4)
        : baseFs;

  const middleContent: ReactNode =
    idleClock === "off" ? null : (
      <span
        className="inline-flex items-center gap-1.5"
        style={{ fontSize: `${clockFs}px` }}
      >
        {idleClock === "date" && (
          <span className="text-[11px] opacity-70">
            {new Date().toLocaleDateString(locale(), { weekday: "short", day: "numeric" })}
          </span>
        )}
        <SlotSample kind="time" settings={settings} />
      </span>
    );

  const leftContent = idleLeft !== "none" ? <SlotSample kind={idleLeft} settings={settings} /> : null;
  const rightContent =
    idleRight !== "none" ? <SlotSample kind={idleRight} settings={settings} /> : null;

  const partsMeta: Record<SlotPart, { title: string; content: ReactNode }> = {
    left: { title: t("Left side"), content: leftContent },
    middle: { title: t("Middle"), content: middleContent },
    right: { title: t("Right side"), content: rightContent },
  };

  const label =
    row && "label" in row && row.label
      ? t(row.label)
      : t("What the closed Sympony shows");
  const sub =
    row && "sub" in row && row.sub
      ? t(row.sub)
      : t("Shown while nothing else is going on. Music, timers and alerts take over when they come.");

  const sideKey = openPart === "left" ? "idleLeft" : "idleRight";
  const hiddenSlots = openPart && openPart !== "middle" ? offSlotIds(os, sideKey) : [];
  const sideChoices = IDLE_SLOTS.filter(([v]) => !hiddenSlots.includes(v));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[13.5px] font-medium text-foreground">{label}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{sub}</p>
      </div>

      {/* Drawn closed notch stage */}
      <div
        dir="ltr"
        className="flex flex-col items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-4 py-4"
      >
        <div
          className={cn(
            "inline-flex items-center gap-1 rounded-b-[16px] rounded-t-[8px] px-2 text-[11.5px] shadow-sm transition-colors",
            notchLook === "glass"
              ? "text-white ring-1 ring-white/25"
              : notchLook === "color"
                ? isLightColor
                  ? "text-zinc-900 ring-1 ring-black/15"
                  : "text-white ring-1 ring-white/15"
                : "bg-black text-white ring-1 ring-white/10"
          )}
          style={previewStyle}
        >
          {(["left", "middle", "right"] as const).map((p) => {
            const active = openPart === p;
            const meta = partsMeta[p];
            return (
              <button
                key={p}
                type="button"
                aria-expanded={active}
                title={meta.title}
                onClick={() => setOpenPart((cur) => (cur === p ? null : p))}
                className={cn(
                  "inline-flex h-7 min-w-12 cursor-pointer items-center justify-center rounded-[7px] px-2.5 transition-colors",
                  active
                    ? isLightColor
                      ? "bg-primary/20 text-zinc-900 ring-1 ring-primary"
                      : "bg-primary/25 text-white ring-1 ring-primary"
                    : isLightColor
                      ? "text-zinc-900/90 hover:bg-black/10"
                      : "text-white/90 hover:bg-white/10",
                  !meta.content && (isLightColor ? "text-zinc-900/40" : "text-white/40")
                )}
              >
                {meta.content ?? <Plus className="size-3.5" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {!openPart && (
          <p className="text-[11.5px] text-muted-foreground">
            {t("Click the left, middle or right part, then pick what it shows.")}
          </p>
        )}
      </div>

      {/* Active part picker */}
      {openPart && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-muted/30 p-3.5">
          <div className="text-[12px] font-semibold text-foreground">
            {partsMeta[openPart].title}
          </div>

          {openPart === "middle" ? (
            <>
              <div
                className="grid grid-cols-3 gap-2"
                data-k="idleClock"
              >
                {CLOCK_MODES.map(([v, lbl]) => {
                  const val = String(v);
                  const on = idleClock === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        if (!on) void set({ idleClock: val });
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-2 text-start text-[12.5px] transition-colors",
                        on
                          ? "border-primary bg-primary/10 font-medium text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <SlotIcon kind={val} className="size-3.5 shrink-0" />
                      <span className="truncate">{t(lbl)}</span>
                    </button>
                  );
                })}
              </div>

              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3"
                data-k="clockSize"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-foreground">
                    {t("Clock size")}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    {t(
                      "The time in the middle. It grows with the Height below; Large and Extra large make Sympony a little wider where they need the room."
                    )}
                  </p>
                </div>
                <SegmentedControl
                  tone="neutral"
                  size="sm"
                  aria-label={t("Clock size")}
                  disabled={idleClock === "off"}
                  value={clockSize}
                  options={CLOCK_SIZES.map(([v, short]) => ({
                    value: v,
                    label: short,
                  }))}
                  onValueChange={(next) => void set({ clockSize: next })}
                />
              </div>
            </>
          ) : (
            <div
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
              data-k={sideKey}
            >
              {sideChoices.map(([v, lbl]) => {
                const val = String(v);
                const cur = openPart === "left" ? idleLeft : idleRight;
                const on = cur === val;
                return (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      if (!on) void set({ [sideKey]: val });
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-2 text-start text-[12px] transition-colors",
                      on
                        ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <SlotIcon kind={val} className="size-3.5 shrink-0" />
                    <span className="truncate">{t(lbl)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
