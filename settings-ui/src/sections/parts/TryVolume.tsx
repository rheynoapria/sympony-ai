import { useState } from "react";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Slider } from "@/components/ui/knowns/slider";
import { useHelper } from "@/lib/helper";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";

export function TryVolumePart() {
  const vol = useHelper<{ level?: number; muted?: boolean }>("volume");
  const [drag, setDrag] = useState<number | null>(null);

  const liveLevel = typeof vol?.level === "number" ? vol.level : 0;
  const shown = drag ?? liveLevel;
  const label = vol?.muted && drag === null ? t("muted") : String(shown);

  return (
    <SettingsRow label={t("Volume")}>
      <div className="flex w-52 items-center gap-3">
        <Slider
          value={shown}
          min={0}
          max={100}
          step={1}
          size="sm"
          hideValue
          aria-label={t("Volume")}
          onValueChange={(next) => {
            setDrag(next);
            notch.helper({ cmd: "volume.set", value: next });
          }}
          onValueCommit={() => setDrag(null)}
          className="flex-1"
        />
        <span className="min-w-14 shrink-0 rounded-[7px] border border-border bg-muted/60 px-2 py-0.5 text-center text-[12px] font-medium tabular-nums text-foreground">
          {label}
        </span>
      </div>
    </SettingsRow>
  );
}
