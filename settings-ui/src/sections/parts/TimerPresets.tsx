import { useState } from "react";
import { Plus, X } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import type { CustomPartProps } from "@/rows/types";
import { cleanPresets } from "./logic";

export function TimerPresetsPart({ settings, set, row }: CustomPartProps) {
  const [draft, setDraft] = useState("");
  const list = cleanPresets(settings.timerPresets);
  const full = list.length >= 8;

  const save = (next: number[]) => {
    void set({ timerPresets: cleanPresets(next) });
  };

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const v = Math.round(Number(trimmed));
    if (!Number.isFinite(v)) return;
    save([...list, Math.min(600, Math.max(1, v))]);
    setDraft("");
  };

  const label = row && "label" in row && row.label ? t(row.label) : t("Presets");
  const sub =
    full
      ? t("Up to 8. Remove one to add another.")
      : row && "sub" in row && row.sub
        ? t(row.sub)
        : undefined;

  return (
    <div data-k="timerPresets">
      <SettingsRow label={label} description={sub}>
        {full ? (
          <span />
        ) : (
          <div className="inline-flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={600}
              step={1}
              placeholder="45"
              aria-label={label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              className="h-8 w-20 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] tabular-nums text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
            <span className="text-[12.5px] text-muted-foreground">{t("min")}</span>
            <Button size="sm" variant="secondary" icon={<Plus />} onClick={add}>
              {t("Add")}
            </Button>
          </div>
        )}
      </SettingsRow>
      {list.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {list.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 ps-2.5 pe-1.5 py-0.5 text-[12px] font-medium tabular-nums text-foreground"
            >
              <span>{t("{n} min", { n: m })}</span>
              <button
                type="button"
                aria-label={t("Remove")}
                title={t("Remove")}
                onClick={() => save(list.filter((x) => x !== m))}
                className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
