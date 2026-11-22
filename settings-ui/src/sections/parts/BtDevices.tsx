import { Bluetooth } from "@/components/icons";
import { useHelper } from "@/lib/helper";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";

interface BtDevice {
  name: string;
  kind?: string;
  connected?: boolean;
  battery?: number;
}

export function BtDevicesPart() {
  const bt = useHelper<{ devices?: BtDevice[] }>("bluetooth");
  const devs = bt?.devices ?? [];

  if (devs.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {t("No paired devices found.")}
      </p>
    );
  }

  return (
    <div className="divide-y divide-border/70">
      {devs.map((d, i) => (
        <div
          key={`${d.name}-${i}`}
          className={cn(
            "flex items-center gap-3 py-2 first:pt-0 last:pb-0",
            !d.connected && "opacity-60"
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Bluetooth className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">
              {d.name}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {d.connected ? t("Connected") : t("Not connected")}
              {d.kind ? ` · ${d.kind}` : ""}
            </div>
          </div>
          {typeof d.battery === "number" && d.battery >= 0 && (
            <span className="text-[12.5px] font-medium tabular-nums text-foreground">
              {d.battery}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
