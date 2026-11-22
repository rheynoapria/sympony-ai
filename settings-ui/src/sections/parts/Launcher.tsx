import { useEffect, useState } from "react";
import { Box, FolderPlus, Plus, X } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

interface LauncherItem {
  name: string;
  path: string;
  iconUrl?: string;
  icon?: string;
}

export function LauncherPart({ settings }: CustomPartProps) {
  const [items, setItems] = useState<LauncherItem[]>([]);

  useEffect(() => {
    let alive = true;
    notch
      .svc("launcher", "list")
      .then((res) => {
        if (alive && Array.isArray(res)) setItems(res as LauncherItem[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.launcherItems]);

  const applyList = (res: unknown) => {
    if (Array.isArray(res)) setItems(res as LauncherItem[]);
  };

  const add = async (kind: "file" | "folder") => {
    const res = await notch.svc("launcher", "add", kind).catch(() => null);
    applyList(res);
  };

  const remove = async (idx: number) => {
    const res = await notch.svc("launcher", "remove", idx).catch(() => null);
    applyList(res);
  };

  return (
    <div className="space-y-3" data-k="launcherItems">
      {items.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
          {items.map((it, i) => (
            <div key={`${it.path}-${i}`} className="flex items-center gap-2.5 py-2">
              <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                {it.iconUrl ? (
                  <img
                    src={it.iconUrl}
                    alt=""
                    className="size-5 object-contain"
                  />
                ) : (
                  <Box className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {it.name}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {it.path}
                </div>
              </div>
              <Button
                size="xs"
                variant="ghost"
                icon={<X />}
                aria-label={t("Remove")}
                title={t("Remove")}
                onClick={() => void remove(i)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus />}
          onClick={() => void add("file")}
        >
          {t("Add app or file")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<FolderPlus />}
          onClick={() => void add("folder")}
        >
          {t("Add folder")}
        </Button>
      </div>
    </div>
  );
}
