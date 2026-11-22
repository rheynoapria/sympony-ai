import { useEffect, useRef, useState } from "react";
import { AlertCircle, FolderOpen, Play, Square, Trash2 } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { Slider } from "@/components/ui/knowns/slider";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

type AdhanSlot = "default" | "fajr";

export function AdhanPart({ settings, set }: CustomPartProps) {
  const adhanFile = typeof settings.adhanFile === "string" ? settings.adhanFile : "";
  const adhanFajrFile =
    typeof settings.adhanFajrFile === "string" ? settings.adhanFajrFile : "";
  const savedVol =
    typeof settings.adhanVolume === "number" ? settings.adhanVolume : 80;

  const [dragVol, setDragVol] = useState<number | null>(null);
  const [playing, setPlaying] = useState<AdhanSlot | null>(null);
  const [message, setMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopTest = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(null);
  };

  useEffect(() => () => stopTest(), []);

  const pickAdhan = async (which: AdhanSlot): Promise<boolean> => {
    const r = (await notch.svc("adhan", "pick", which).catch(() => null)) as {
      ok?: boolean;
      message?: string;
    } | null;
    if (r && r.ok === false) {
      setMessage(r.message ?? "");
    } else if (r && r.ok) {
      setMessage("");
    }
    return Boolean(r && r.ok);
  };

  const toggleAdhan = async (checked: boolean) => {
    if (!checked) {
      await set({ adhanOn: false });
      return;
    }
    if (adhanFile) {
      await set({ adhanOn: true });
      return;
    }
    // Backend saves adhanOn on a successful pick; cancelled pick saves nothing
    await pickAdhan("default");
  };

  const clearAdhan = (which: AdhanSlot) => {
    stopTest();
    void notch.svc("adhan", "clear", which);
  };

  const toggleTest = async (which: AdhanSlot) => {
    if (audioRef.current) {
      const wasSame = playing === which;
      stopTest();
      if (wasSame) return;
    }
    const r = (await notch.svc("adhan", "data", which).catch(() => null)) as {
      ok?: boolean;
      url?: string;
    } | null;
    if (!r || !r.ok || !r.url) return;
    const audio = new Audio(r.url);
    audio.volume = (dragVol ?? savedVol) / 100;
    audio.addEventListener("ended", () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlaying(null);
      }
    });
    audioRef.current = audio;
    setPlaying(which);
    audio.play().catch(() => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlaying(null);
      }
    });
  };

  const shownVol = dragVol ?? savedVol;

  const fileRows: {
    slot: AdhanSlot;
    k: string;
    label: string;
    file: string;
    none: string;
  }[] = [
    {
      slot: "default",
      k: "adhanFile",
      label: t("Adhan"),
      file: adhanFile,
      none: t("No file chosen"),
    },
    {
      slot: "fajr",
      k: "adhanFajrFile",
      label: t("Subuh adhan (optional)"),
      file: adhanFajrFile,
      none: t(
        "Uses the adhan above; pick another for Subuh (with “ash-shalatu khairun minan naum”)"
      ),
    },
  ];

  return (
    <div className="divide-y divide-border/80">
      <SettingsRow
        label={t("Play the adhan when it’s time")}
        description={t(
          "Sympony doesn’t come with a recording: choose your own audio file (MP3, M4A, WAV, OGG…). Without one, this stays off. It plays for the prayers ticked above, in place of the chime, and the closed Sympony shows a stop button meanwhile."
        )}
      >
        <div data-k="adhanOn">
          <Switch
            checked={Boolean(settings.adhanOn && adhanFile)}
            aria-label={t("Play the adhan when it’s time")}
            onCheckedChange={(checked) => void toggleAdhan(checked)}
          />
        </div>
      </SettingsRow>

      {fileRows.map((item) => (
        <SettingsRow
          key={item.slot}
          label={item.label}
          description={item.file || item.none}
        >
          <div className="flex flex-wrap items-center gap-1.5" data-k={item.k}>
            {item.file && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={playing === item.slot ? <Square /> : <Play />}
                  title={t("Play / stop")}
                  onClick={() => void toggleTest(item.slot)}
                >
                  {playing === item.slot ? t("Stop") : t("Test")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  icon={<Trash2 />}
                  aria-label={t("Remove")}
                  title={t("Remove")}
                  onClick={() => clearAdhan(item.slot)}
                />
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderOpen />}
              onClick={() => void pickAdhan(item.slot)}
            >
              {t("Choose file…")}
            </Button>
          </div>
        </SettingsRow>
      ))}

      <SettingsRow label={t("Volume")}>
        <div className="flex w-52 items-center gap-3" data-k="adhanVolume">
          <Slider
            value={shownVol}
            min={10}
            max={100}
            step={5}
            size="sm"
            hideValue
            aria-label={t("Volume")}
            onValueChange={(next) => {
              setDragVol(next);
              if (audioRef.current) audioRef.current.volume = next / 100;
            }}
            onValueCommit={(next) => {
              setDragVol(null);
              void set({ adhanVolume: next });
            }}
            className="flex-1"
          />
          <span className="min-w-14 shrink-0 rounded-[7px] border border-border bg-muted/60 px-2 py-0.5 text-center text-[12px] font-medium tabular-nums text-foreground">
            {shownVol}%
          </span>
        </div>
      </SettingsRow>

      {message && (
        <div className="flex items-center gap-2 pt-3 text-[12.5px] text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
