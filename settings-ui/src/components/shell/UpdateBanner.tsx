import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  RotateCw,
  Sparkles,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import {
  formatBytes,
  parseReleaseBullets,
  shouldShowBanner,
  type UpdateState,
} from "@/lib/update";

export interface UpdateBannerProps {
  update: UpdateState | null;
  onInstall: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onOpenPage: () => void;
}

export function UpdateBanner({
  update,
  onInstall,
  onDismiss,
  onRetry,
  onOpenPage,
}: UpdateBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!shouldShowBanner(update) || !update) return null;

  const isBeta = update.availableChannel === "beta";
  const isError = update.status === "error";
  const isDownloading = update.status === "downloading";
  const isInstalling = update.status === "installing";
  const isReady = update.status === "ready";
  const version = update.availableVersion ?? "";
  const bullets = parseReleaseBullets(update.notes);

  const percent =
    typeof update.percent === "number"
      ? Math.max(0, Math.min(100, update.percent))
      : null;
  const sizeProgress =
    update.downloaded > 0
      ? update.total
        ? `${formatBytes(update.downloaded)} / ${formatBytes(update.total)}`
        : formatBytes(update.downloaded)
      : "";

  const containerTone = isError
    ? "border-destructive/35 bg-destructive/[0.07] dark:bg-destructive/[0.12]"
    : isBeta
      ? "border-amber-500/35 bg-amber-500/[0.08] dark:border-amber-400/30 dark:bg-amber-500/[0.11]"
      : "border-sky-500/35 bg-sky-500/[0.08] dark:border-sky-400/30 dark:bg-sky-500/[0.11]";

  const badgeTone = isError
    ? "bg-destructive/15 text-destructive"
    : isBeta
      ? "bg-amber-500/18 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300"
      : "bg-sky-500/18 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300";

  const barTone = isBeta
    ? "bg-amber-500 dark:bg-amber-400"
    : "bg-sky-500 dark:bg-sky-400";

  const title = isError
    ? t("Update failed")
    : isReady
      ? isBeta
        ? t("Sympony v{version} (Beta) is ready to install", { version })
        : t("Sympony v{version} is ready to install", { version })
      : isBeta
        ? t("Sympony v{version} (Beta) is available", { version })
        : t("Sympony v{version} is available", { version });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "shrink-0 border-b px-5 py-3 transition-colors",
        containerTone
      )}
    >
      <div className="mx-auto flex max-w-[740px] flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase",
                badgeTone
              )}
            >
              {isError ? (
                <AlertTriangle className="size-3" />
              ) : isBeta ? (
                <Sparkles className="size-3" />
              ) : (
                <Download className="size-3" />
              )}
              {isError ? t("Update failed") : isBeta ? t("Beta") : t("New Release")}
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <span className="truncate">{title}</span>
                {isBeta && !isError && (
                  <span className="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80">
                    · {t("Early preview")}
                  </span>
                )}
                {update.preview && (
                  <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                    {t("Preview")}
                  </span>
                )}
              </div>

              {isError && update.error && (
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {update.error}
                </p>
              )}

              {!isError && !isDownloading && !isInstalling && bullets.length > 0 && (
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {bullets[0]}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!isError && bullets.length > 1 && !isDownloading && !isInstalling && (
              <Button
                size="sm"
                variant="ghost"
                icon={expanded ? <ChevronUp /> : <ChevronDown />}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t("Hide details") : t("What’s new")}
              </Button>
            )}

            {isError ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCw />}
                  onClick={onRetry}
                >
                  {t("Retry")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink />}
                  onClick={onOpenPage}
                >
                  {t("Download manually")}
                </Button>
              </>
            ) : isDownloading || isInstalling ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-background/60 px-2.5 py-1 text-[12px] font-medium tabular-nums text-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {isInstalling
                  ? t("Installing update…")
                  : percent != null
                    ? t("Downloading {percent}%", { percent })
                    : t("Downloading update…")}
              </span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={isReady ? <RotateCw /> : <Download />}
                  onClick={onInstall}
                  className={cn(
                    isBeta &&
                      "!bg-amber-500 !text-zinc-950 hover:!bg-amber-400 dark:!bg-amber-400 dark:hover:!bg-amber-300"
                  )}
                >
                  {isReady
                    ? isBeta
                      ? t("Restart & Install Beta")
                      : t("Restart & Install")
                    : isBeta
                      ? t("Install Beta")
                      : t("Update & Restart")}
                </Button>
                {!isReady && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X />}
                    onClick={onDismiss}
                  >
                    {isBeta ? t("Skip") : t("Later")}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {(isDownloading || isInstalling) && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200 ease-out",
                  barTone
                )}
                style={{
                  width: `${isInstalling ? 100 : percent ?? 15}%`,
                }}
              />
            </div>
            {sizeProgress && (
              <div className="flex justify-end text-[11px] tabular-nums text-muted-foreground">
                {sizeProgress}
              </div>
            )}
          </div>
        )}

        {expanded && bullets.length > 0 && !isError && (
          <ul className="list-disc space-y-1 border-t border-border/50 pt-2 ps-5 text-[12px] leading-relaxed text-muted-foreground">
            {bullets.slice(0, 6).map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
