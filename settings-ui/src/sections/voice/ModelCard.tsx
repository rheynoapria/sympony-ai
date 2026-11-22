import { Download, Trash2, X } from "@/components/icons";
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
  status: string;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function modelTitle(id: string): string {
  if (id === "zf-id") return "Zipformer2-id (int8)";
  if (id === "1.7b") return "Qwen3-ASR 1.7B (Q4_K_M)";
  return "Qwen3-ASR 0.6B (Q4_K_M)";
}

export function ModelCard({
  model,
  progress,
  onDownload,
  onCancel,
  onDelete,
}: {
  model: VoiceModelInfo;
  progress: DownloadProgress | null;
  onDownload: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}) {
  const isDownloading = Boolean(progress && progress.id === model.id && progress.status === "downloading");
  const pct =
    isDownloading && progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {modelTitle(model.id)}
            </span>
            <Badge
              variant={model.downloaded ? "soft" : "outline"}
              tone={model.downloaded ? "success" : "neutral"}
              className="text-[11px]"
            >
              {isDownloading
                ? t("Downloading…")
                : model.downloaded
                  ? `${t("Downloaded")} · ${fmtSize(model.size)}`
                  : `${t("Not downloaded")} · ${fmtSize(model.size)}`}
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
          ) : model.downloaded ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("Delete model")}
              icon={<Trash2 className="text-destructive" />}
              onClick={() => onDelete(model.id)}
            />
          ) : (
            <Button size="sm" icon={<Download />} onClick={() => onDownload(model.id)}>
              {t("Download")}
            </Button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
}
