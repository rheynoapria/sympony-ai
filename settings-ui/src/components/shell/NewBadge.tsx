import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";

export interface NewBadgeProps {
  size?: "xs" | "sm";
  className?: string;
}

export function NewBadge({ size = "sm", className }: NewBadgeProps) {
  const label = t("New");
  return (
    <span
      data-new-badge=""
      aria-label={label}
      className={cn(
        "sy-new-badge inline-flex shrink-0 items-center rounded-full font-semibold tracking-[0.02em] select-none",
        size === "xs"
          ? "gap-1 px-1.5 py-px text-[9.5px] leading-[13px]"
          : "gap-1 px-1.5 py-[1.5px] text-[10px] leading-[13.5px]",
        className
      )}
    >
      <svg
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden="true"
        className={cn(
          "shrink-0 opacity-90",
          size === "xs" ? "size-2.5" : "size-2.5"
        )}
      >
        <path d="M6 0.75L7.32 4.68L11.25 6L7.32 7.32L6 11.25L4.68 7.32L0.75 6L4.68 4.68L6 0.75Z" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
