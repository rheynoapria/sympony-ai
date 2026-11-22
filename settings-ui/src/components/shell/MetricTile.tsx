import type { ReactNode } from "react";
import { cn } from "@/lib/knowns/utils";

export interface MetricTileProps {
  label: string;
  value: ReactNode;
  sub: string;
  icon: ReactNode;
  statusDot?: string;
}

export function MetricTile({
  label,
  value,
  sub,
  icon,
  statusDot,
}: MetricTileProps) {
  return (
    <div
      className="panel-surface flex items-start justify-between gap-3 border border-border p-4"
      style={{ borderRadius: "var(--card-radius)" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          {statusDot && (
            <span className={cn("size-1.5 rounded-full", statusDot)} />
          )}
          <span>{label}</span>
        </div>
        <div className="mt-1.5 text-[20px] font-semibold tracking-[-0.025em] tabular-nums text-foreground">
          {value}
        </div>
        <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
          {sub}
        </div>
      </div>
      <div className="card-ico-well grid size-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground">
        {icon}
      </div>
    </div>
  );
}
