import { cn } from "@/lib/knowns/utils";

/**
 * A placeholder while something loads: a soft block with a light sweeping across it (transform only, kn-sweep; still
 * under reduced motion). Give it the size of what will come so nothing jumps when it arrives.
 */
export function Skeleton({ className, rounded = "rounded-md" }: { className?: string; rounded?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative block overflow-hidden bg-muted/70", rounded, className)}
    >
      <span className="absolute inset-y-0 left-0 w-1/2 animate-[kn-sweep_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent motion-reduce:hidden" />
    </span>
  );
}

/** A card-shaped placeholder: an icon, a title and a line, as the agent and integration cards are laid out. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3", className)} aria-busy="true">
      <Skeleton className="size-9 shrink-0" rounded="rounded-[10px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-40 max-w-full" />
      </div>
    </div>
  );
}
