import type { ReactNode } from "react";
import { cn } from "@/lib/knowns/utils";

export interface PanelCardProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PanelCard({
  title,
  description,
  icon,
  action,
  children,
  className,
}: PanelCardProps) {
  return (
    <section
      className={cn(
        "panel-surface overflow-hidden border border-border",
        className
      )}
      style={{ borderRadius: "var(--card-radius)" }}
    >
      {(title || description || action) && (
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className="card-ico-well grid size-8 shrink-0 place-items-center overflow-hidden rounded-[9px] text-muted-foreground [&_svg]:size-4">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
