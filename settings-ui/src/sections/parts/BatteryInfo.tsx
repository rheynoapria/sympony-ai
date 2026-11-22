import { useHelper } from "@/lib/helper";
import { t } from "@/lib/i18n";

interface PowerHelper {
  hasBattery?: boolean;
  level?: number;
  pluggedIn?: boolean;
  saver?: boolean;
}

export function BatteryInfoPart() {
  const p = useHelper<PowerHelper>("power");
  if (!p) return null;

  const text = p.hasBattery
    ? `${t("Battery: {level}%", { level: p.level ?? 0 })} · ${
        p.pluggedIn ? t("plugged in") : t("on battery")
      }${p.saver ? ` · ${t("battery saver on")}` : ""}`
    : t("No battery detected (desktop PC). The battery indicator stays hidden.");

  return <p className="text-[12.5px] text-muted-foreground">{text}</p>;
}
