import { useEffect, useState } from "react";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";

// Settings → Media → YouTube: whether Sympony may read the playing browser's tabs (youtube.rs yt.status)
interface YtStatus {
  browser: string | null;
  automation: "granted" | "denied" | "notAsked" | "notRunning" | null;
}

const NAMES: Record<string, string> = {
  "com.brave.Browser": "Brave",
  "com.google.Chrome": "Chrome",
  "com.microsoft.edgemac": "Edge",
  "company.thebrowser.Browser": "Arc",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "com.operasoftware.Opera": "Opera",
  "com.apple.Safari": "Safari",
};

export function YtStatusPart() {
  const [st, setSt] = useState<YtStatus | null>(null);
  useEffect(() => {
    let alive = true;
    notch
      .svc("yt", "status")
      .then((v) => alive && setSt(v as YtStatus))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!st || !st.browser) return null;
  const name = NAMES[st.browser] ?? st.browser;
  if (st.automation === "denied") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
        <span>{t("Sympony isn’t allowed to read {browser}’s tabs.", { browser: name })}</span>
        <Button size="sm" variant="secondary" onClick={() => notch.svc("perm", "request", "automation", true).catch(() => {})}>
          {t("Open System Settings")}
        </Button>
      </div>
    );
  }
  if (st.automation === "notAsked") {
    return <p className="text-[12.5px] text-muted-foreground">{t("macOS will ask the first time you open Music while a video plays.")}</p>;
  }
  return null;
}
