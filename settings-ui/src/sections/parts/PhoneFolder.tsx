import { useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

export function PhoneFolderPart({ settings, set, os }: CustomPartProps) {
  const saved = typeof settings.phoneFolder === "string" ? settings.phoneFolder : "";
  const [resolvedPath, setResolvedPath] = useState(saved);

  useEffect(() => {
    let alive = true;
    notch
      .svc("phone", "folder")
      .then((res) => {
        const f = res as { path?: string } | null;
        if (alive && f?.path) setResolvedPath(f.path);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [saved]);

  const resetTitle =
    os === "macos" || os === "linux"
      ? t("Back to Downloads/Sympony")
      : t("Back to Downloads\\Sympony");

  return (
    <SettingsRow
      label={t("Save files from your phone in")}
      description={resolvedPath || saved}
    >
      <div className="flex items-center gap-1.5" data-k="phoneFolder">
        {saved && (
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCcw />}
            aria-label={resetTitle}
            title={resetTitle}
            onClick={() => void set({ phoneFolder: "" })}
          />
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={<FolderOpen />}
          onClick={() => void notch.svc("phone", "pickFolder")}
        >
          {t("Choose folder…")}
        </Button>
      </div>
    </SettingsRow>
  );
}
