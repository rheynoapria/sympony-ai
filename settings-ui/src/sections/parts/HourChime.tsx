import { useRef } from "react";
import { Play } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import type { CustomPartProps } from "@/rows/types";

export function HourChimePart({ settings, set, row }: CustomPartProps) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mode = String(settings.hourChime || "off");
  if (!["sound", "light", "both"].includes(mode)) return null;

  const quiet = settings.hourChimeQuiet !== false;
  const from = String(settings.hourChimeFrom || "22:00");
  const to = String(settings.hourChimeTo || "06:00");
  const quietLabel = row && "label" in row && row.label ? t(row.label) : t("Quiet hours");
  const quietSub =
    row && "sub" in row && row.sub
      ? t(row.sub)
      : t("No chime from the first time until the second");

  const saveTime = (k: "hourChimeFrom" | "hourChimeTo", val: string) => {
    if (window.SymponyClock && window.SymponyClock.minutes(val) != null) {
      void set({ [k]: val });
    }
  };

  return (
    <div className="divide-y divide-border/80">
      <div className="pb-3" data-k="hourChimeHalf">
        <SettingsRow
          label={t("On the half hour too")}
          description={t("One note at half past, two on the hour")}
        >
          <Switch
            checked={Boolean(settings.hourChimeHalf)}
            aria-label={t("On the half hour too")}
            onCheckedChange={(checked) => void set({ hourChimeHalf: checked })}
          />
        </SettingsRow>
      </div>

      <div className="py-3" data-k="hourChimeQuiet">
        <SettingsRow label={quietLabel} description={quietSub}>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label={t("Quiet hours start")}
              disabled={!quiet}
              value={from}
              data-k="hourChimeFrom"
              onChange={(e) => saveTime("hourChimeFrom", e.target.value)}
              className="h-8 w-28 rounded-[var(--control-radius)] border border-input bg-background px-2 text-[12.5px] tabular-nums text-foreground disabled:opacity-50"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="time"
              aria-label={t("Quiet hours end")}
              disabled={!quiet}
              value={to}
              data-k="hourChimeTo"
              onChange={(e) => saveTime("hourChimeTo", e.target.value)}
              className="h-8 w-28 rounded-[var(--control-radius)] border border-input bg-background px-2 text-[12.5px] tabular-nums text-foreground disabled:opacity-50"
            />
            <Switch
              checked={quiet}
              aria-label={quietLabel}
              onCheckedChange={(checked) => void set({ hourChimeQuiet: checked })}
            />
          </div>
        </SettingsRow>
      </div>

      {mode !== "light" && (
        <div className="pt-3">
          <SettingsRow
            label={t("The bell")}
            description={t("As it sounds on the hour")}
          >
            <Button
              size="sm"
              variant="secondary"
              icon={<Play />}
              onClick={() => {
                try {
                  ctxRef.current = ctxRef.current ?? new AudioContext();
                  window.SymponyClock?.bell(ctxRef.current, false);
                } catch {
                  /* no sound here */
                }
              }}
            >
              {t("Try")}
            </Button>
          </SettingsRow>
        </div>
      )}
    </div>
  );
}
