import type { ReactNode } from "react";
import { BrandIcon, ShieldCheck, tileStyle } from "@/components/icons";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";

/** (kept for callers; the tile takes the icon's own colour now) */
export type Tone = "sky" | "amber" | "cyan" | "violet" | "emerald" | "indigo" | "rose";

/** A group of abilities by where Pony works: what it knows, on your screen, on your Mac. */
export function AbilityGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex flex-col divide-y divide-border/70 overflow-hidden rounded-[14px] border border-border bg-card">{children}</div>
    </section>
  );
}

type AbilityProps = {
  /** the icon's name (lucide's, as everywhere in Settings): shown in Fluent Color */
  icon: string;
  tone: Tone;
  title: string;
  /** what it does, in a few words */
  summary: string;
  /** a small live status under the summary (today's usage) */
  meta?: string;
  /** things the user could say, so its purpose is plain */
  tryIt?: string[];
  /** a short safety note under it */
  safe?: string;
  /** the switch (or a status) on the right */
  control?: ReactNode;
  /** extra settings, shown when it's on */
  children?: ReactNode;
  k?: string;
};

/** One ability: an icon, a name, one line on what it does, things to try, its switch; its settings under it. */
export function Ability({ icon, title, summary, meta, tryIt, safe, control, children, k }: AbilityProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5" data-k={k}>
      <div className="flex items-start gap-3">
        <span className="icon-tile mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px]" style={tileStyle(icon)} aria-hidden="true">
          <BrandIcon name={icon} className="size-[22px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-[13.5px] font-medium leading-tight text-foreground">{title}</div>
          <div className="text-[12.5px] leading-snug text-muted-foreground">{summary}</div>
          {meta && <div className="text-[11.5px] tabular-nums text-muted-foreground/80">{meta}</div>}
          {tryIt && tryIt.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-muted-foreground/80">{t("Try:")}</span>
              {tryIt.map((s) => (
                <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-foreground/85">
                  “{s}”
                </span>
              ))}
            </div>
          )}
          {safe && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600/80 dark:text-emerald-400/80" aria-hidden="true" />
              {safe}
            </div>
          )}
        </div>
        {control && <div className="shrink-0 pt-1.5">{control}</div>}
      </div>
      {children && <div className="ms-12 flex flex-col gap-2.5 rounded-[12px] bg-muted/45 px-3.5 py-3">{children}</div>}
    </div>
  );
}
