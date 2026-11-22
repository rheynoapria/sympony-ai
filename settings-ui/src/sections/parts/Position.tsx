import { AlignCenter, AlignLeft, AlignRight } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { Slider } from "@/components/ui/knowns/slider";
import { t } from "@/lib/i18n";
import type { CustomPartProps } from "@/rows/types";

export function PositionPart({ settings, set }: CustomPartProps) {
  const pos = typeof settings.notchPosition === "number" ? settings.notchPosition : 0.5;
  const pct = Math.round(pos * 100);

  return (
    <SettingsRow
      label={t("Position along the top")}
      description={t(
        "Or just drag Sympony left/right (when it’s open: drag its top bar). It snaps to the centre."
      )}
    >
      <div className="flex items-center gap-2.5" dir="ltr" data-k="notchPosition">
        <div className="inline-flex items-center gap-1">
          <Button
            size="xs"
            variant="secondary"
            icon={<AlignLeft />}
            title={t("Left")}
            aria-label={t("Left")}
            onClick={() => void set({ notchPosition: 0.06 })}
          />
          <Button
            size="xs"
            variant="secondary"
            icon={<AlignCenter />}
            title={t("Centre")}
            aria-label={t("Centre")}
            onClick={() => void set({ notchPosition: 0.5 })}
          />
          <Button
            size="xs"
            variant="secondary"
            icon={<AlignRight />}
            title={t("Right")}
            aria-label={t("Right")}
            onClick={() => void set({ notchPosition: 0.94 })}
          />
        </div>
        <Slider
          value={pct}
          min={0}
          max={100}
          step={1}
          size="sm"
          hideValue
          aria-label={t("Position along the top")}
          onValueChange={(next) => void set({ notchPosition: next / 100 })}
          className="w-36"
        />
        <span className="min-w-12 rounded-[7px] border border-border bg-muted/60 px-2 py-0.5 text-center text-[12px] font-medium tabular-nums text-foreground">
          {pct}%
        </span>
      </div>
    </SettingsRow>
  );
}
