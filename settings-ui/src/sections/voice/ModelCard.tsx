import { Download, RotateCcw, Trash2, X } from "@/components/icons";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";

export interface VoiceModelInfo {
  id: string;
  file: string;
  size: number;
  tier: string;
  licence: string;
  downloaded: boolean;
  offered: boolean;
}

export interface DownloadProgress {
  id: string;
  done: number;
  total: number;
  phase?: "downloading" | "verifying" | "done" | string;
  status: string;
  queued?: string[];
  error?: string;
  seq?: number;
}

export function fmtModelSize(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 10 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function modelTitle(id: string): string {
  if (id === "zf-id") return "Zipformer2-id (int8)";
  if (id === "1.7b") return "Qwen3-ASR 1.7B (Q4_K_M)";
  return "Qwen3-ASR 0.6B (Q4_K_M)";
}

export function ModelCard({
  model,
  progress,
  error,
  onDownload,
  onCancel,
  onDelete,
}: {
  model: VoiceModelInfo;
  progress: DownloadProgress | null;
  error?: string | null;
  onDownload: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}) {
  const isDownloading = Boolean(
    progress && progress.id === model.id && progress.status === "downloading"
  );
  const isQueued = Boolean(
    !isDownloading &&
      !model.downloaded &&
      progress?.status === "downloading" &&
      progress.queued?.includes(model.id)
  );
  const effectiveTotal =
    isDownloading && progress && progress.total > 0 ? progress.total : model.size;
  const clampedDone =
    isDownloading && progress ? Math.min(effectiveTotal, Math.max(0, progress.done)) : 0;
  const pct =
    isDownloading && effectiveTotal > 0
      ? Math.min(100, Math.round((clampedDone / effectiveTotal) * 100))
      : 0;
  const isVerifying =
    isDownloading && (progress?.phase === "verifying" || (effectiveTotal > 0 && clampedDone >= effectiveTotal));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {modelTitle(model.id)}
            </span>
            <Badge
              variant={model.downloaded || isDownloading || isQueued ? "soft" : "outline"}
              tone={
                model.downloaded
                  ? "success"
                  : isDownloading || isQueued
                    ? "info"
                    : error
                      ? "danger"
                      : "neutral"
              }
              className="text-[11px] tabular-nums"
            >
              {isVerifying
                ? t("Verifying…")
                : isDownloading
                  ? t("Downloading…")
                  : isQueued
                    ? t("Queued")
                    : model.downloaded
                      ? `${t("Downloaded")} · ${fmtModelSize(model.size)}`
                      : `${t("Not downloaded")} · ${fmtModelSize(model.size)}`}
            </Badge>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {model.file} · {model.licence}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isDownloading ? (
            <Button size="sm" variant="secondary" icon={<X />} onClick={onCancel}>
              {t("Cancel")}
            </Button>
          ) : isQueued ? (
            <Button size="sm" variant="secondary" icon={<X />} onClick={onCancel}>
              {t("Cancel")}
            </Button>
          ) : model.downloaded ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("Delete model")}
              icon={<Trash2 className="text-destructive" />}
              onClick={() => onDelete(model.id)}
            />
          ) : error ? (
            <Button size="sm" variant="secondary" icon={<RotateCcw />} onClick={() => onDownload(model.id)}>
              {t("Retry")}
            </Button>
          ) : (
            <Button size="sm" icon={<Download />} onClick={() => onDownload(model.id)}>
              {t("Download")}
            </Button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(pct, clampedDone > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="w-10 text-right text-[11px] font-medium tabular-nums text-foreground">
              {pct}%
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>
              {isVerifying
                ? t("Verifying…")
                : `${fmtModelSize(clampedDone)} / ${fmtModelSize(effectiveTotal)}`}
            </span>
            {progress?.queued && progress.queued.length > 0 && (
              <span>
                +{progress.queued.length} {t("Queued").toLowerCase()}
              </span>
            )}
          </div>
        </div>
      )}

      {!isDownloading && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
          {t("Download failed")}: {error}
        </div>
      )}
    </div>
  );
}
