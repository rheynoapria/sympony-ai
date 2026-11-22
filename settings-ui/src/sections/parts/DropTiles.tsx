import { useEffect, useState } from "react";
import {
  Archive,
  Box,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  ExternalLink,
  FolderInput,
  FolderOpen,
  HardDriveUpload,
  Image,
  Inbox,
  Share2,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { moveTile, tileList, toggleTile } from "./logic";

interface ActionItem {
  id: string;
  label: string;
  icon?: string;
}

function TileIcon({ id }: { id: string }) {
  const cls = "size-4";
  switch (id) {
    case "shelf":
      return <Inbox className={cls} />;
    case "share":
      return <Share2 className={cls} />;
    case "zip":
      return <Archive className={cls} />;
    case "unzip":
      return <FolderOpen className={cls} />;
    case "convert":
      return <Image className={cls} />;
    case "copy":
      return <Copy className={cls} />;
    case "move":
      return <FolderInput className={cls} />;
    case "onedrive":
      return <Cloud className={cls} />;
    case "openwith":
      return <ExternalLink className={cls} />;
    case "trash":
      return <Trash2 className={cls} />;
    case "eject":
      return <HardDriveUpload className={cls} />;
    default:
      return <Box className={cls} />;
  }
}

function tileDesc(id: string): string {
  switch (id) {
    case "shelf":
      return t("Keep files on Sympony’s Shelf");
    case "share":
      return t("Windows Share: Nearby sharing, Mail, apps");
    case "zip":
      return t("Make a .zip next to the files");
    case "unzip":
      return t("Extract a .zip into a folder");
    case "convert":
      return t("PNG ⇄ JPG next to the original");
    case "copy":
      return t("Copy into a folder you pick");
    case "move":
      return t("Move into a folder you pick");
    case "onedrive":
      return t("Copy into {folder} (syncs to the cloud)", {
        folder: "OneDrive\\Sympony",
      });
    case "openwith":
      return t("Choose an app to open the file with");
    case "trash":
      return t("Move to the Recycle Bin");
    case "eject":
      return t("Safely remove a drive (drop {drive} from This PC)", {
        drive: "E:\\",
      });
    default:
      return "";
  }
}

export function DropTilesPart({ settings, set }: CustomPartProps) {
  const [catalog, setCatalog] = useState<ActionItem[]>([]);

  useEffect(() => {
    let alive = true;
    notch
      .svc("actions", "catalog")
      .then((res) => {
        if (alive && Array.isArray(res)) setCatalog(res as ActionItem[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const order = (Array.isArray(settings.dropActions) ? settings.dropActions : []) as string[];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const allIds = tileList(
    catalog.map((c) => c.id),
    order
  );

  return (
    <div className="divide-y divide-border/70" data-k="dropActions">
      {allIds.map((id, i) => {
        const item = byId.get(id);
        if (!item) return null;
        const on = order.includes(id);
        const desc = tileDesc(id);
        return (
          <div
            key={id}
            className={cn(
              "flex items-center gap-3 py-2.5 first:pt-0 last:pb-0",
              !on && "opacity-55"
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <TileIcon id={id} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                {item.label}
              </div>
              {desc && (
                <div className="truncate text-[12px] text-muted-foreground">
                  {desc}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={i === 0}
                icon={<ChevronUp />}
                aria-label={t("Move up")}
                onClick={() =>
                  void set({ dropActions: moveTile(allIds, order, i, -1) })
                }
              />
              <Button
                size="xs"
                variant="ghost"
                disabled={i === allIds.length - 1}
                icon={<ChevronDown />}
                aria-label={t("Move down")}
                onClick={() =>
                  void set({ dropActions: moveTile(allIds, order, i, 1) })
                }
              />
            </div>
            <Switch
              checked={on}
              aria-label={item.label}
              onCheckedChange={(checked) =>
                void set({ dropActions: toggleTile(order, id, checked) })
              }
            />
          </div>
        );
      })}
    </div>
  );
}
