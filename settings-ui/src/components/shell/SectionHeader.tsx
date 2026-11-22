import type { CSSProperties, ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { SectionMeta } from "@/sections/registry";
import { SectionIcon } from "./icons";
import { iconTint } from "@/components/icons";

export function SectionHeader({
  section,
  action,
}: {
  section: SectionMeta;
  action?: ReactNode;
}) {
  const medallionStyle = {
    "--sec-tint": section.tint ?? iconTint(section.icon),
  } as CSSProperties;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <div
          className="section-medallion grid size-11 shrink-0 place-items-center rounded-[12px] text-foreground"
          style={medallionStyle}
        >
          <SectionIcon name={section.icon} className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.025em] leading-tight text-foreground">
            {t(section.title)}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t(section.subtitle)}
          </p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
