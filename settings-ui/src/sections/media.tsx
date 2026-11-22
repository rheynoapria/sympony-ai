import { useEffect, useRef } from "react";
import { Music } from "@/components/icons";
import { t } from "@/lib/i18n";
import type { SymponyPalette, SymponyWaveHandle } from "@/lib/notch";
import { cn } from "@/lib/knowns/utils";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, SectionBody } from "@/rows/types";
import { MEDIA_ROWS } from "./media.rows";
import { YtStatusPart } from "./parts/YtStatus";

const FALLBACK_PALETTES: Record<string, SymponyPalette> = {
  white: { name: "White", c: [[245, 245, 247], [245, 245, 247], [245, 245, 247]] },
  blue: { name: "Blue", c: [[10, 132, 255], [10, 132, 255], [10, 132, 255]] },
  purple: { name: "Purple", c: [[175, 82, 222], [175, 82, 222], [175, 82, 222]] },
  pink: { name: "Pink", c: [[255, 55, 95], [255, 55, 95], [255, 55, 95]] },
  green: { name: "Green", c: [[48, 209, 88], [48, 209, 88], [48, 209, 88]] },
  orange: { name: "Orange", c: [[255, 159, 10], [255, 159, 10], [255, 159, 10]] },
  ocean: { name: "Ocean", c: [[99, 102, 241], [59, 130, 246], [45, 212, 191]] },
  aurora: { name: "Aurora", c: [[139, 92, 246], [34, 211, 238], [52, 211, 153]] },
  sunset: { name: "Sunset", c: [[244, 114, 182], [251, 146, 60], [250, 204, 21]] },
  fire: { name: "Fire", c: [[239, 68, 68], [249, 115, 22], [250, 204, 21]] },
  forest: { name: "Forest", c: [[22, 163, 74], [132, 204, 22], [45, 212, 191]] },
  candy: { name: "Candy", c: [[236, 72, 153], [168, 85, 247], [96, 165, 250]] },
  neon: { name: "Neon", c: [[217, 70, 239], [59, 130, 246], [16, 185, 129]] },
};

const isSolid = (p: SymponyPalette) => p.c[0].join() === p.c[2].join();
const swatchBg = (p: SymponyPalette) =>
  isSolid(p)
    ? `rgb(${p.c[0].join(",")})`
    : `linear-gradient(135deg, rgb(${p.c[0].join(",")}), rgb(${p.c[1].join(",")}), rgb(${p.c[2].join(",")}))`;

function MediaColorsPart({ settings, set }: CustomPartProps) {
  const P =
    (typeof window !== "undefined" && window.SYMPONY_PALETTES) ||
    FALLBACK_PALETTES;
  const keys = Object.keys(P);
  const activeKey =
    typeof settings.mediaColors === "string" && P[settings.mediaColors]
      ? settings.mediaColors
      : "ocean";
  const activePal = P[activeKey] ?? P.ocean;

  const waveBoxRef = useRef<HTMLDivElement>(null);
  const waveHandleRef = useRef<SymponyWaveHandle | null>(null);

  useEffect(() => {
    const box = waveBoxRef.current;
    if (!box || typeof window === "undefined" || !window.makeWaves) return;
    let alive = true;
    const handle = window.makeWaves(box, () => alive && box.isConnected);
    waveHandleRef.current = handle;
    if (handle) {
      const c = activePal.c;
      handle.colors(c[0], c[1], c[2]);
    }
    return () => {
      alive = false;
      waveHandleRef.current = null;
      box.replaceChildren();
    };
    // Mount WebGL context once per mount; colors update smoothly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = activePal.c;
    waveHandleRef.current?.colors(c[0], c[1], c[2]);
  }, [activePal]);

  const solidKeys = keys.filter((k) => isSolid(P[k]));
  const gradKeys = keys.filter((k) => !isSolid(P[k]));

  const c1 = `rgb(${activePal.c[0].join(",")})`;
  const c2 = `rgb(${activePal.c[1].join(",")})`;
  const c3 = `rgb(${activePal.c[2].join(",")})`;

  const renderSwatch = (k: string) => {
    const on = k === activeKey;
    return (
      <button
        key={k}
        type="button"
        title={t(P[k].name)}
        aria-label={t(P[k].name)}
        aria-pressed={on}
        onClick={() => void set({ mediaColors: k })}
        className={cn(
          "size-6 cursor-pointer rounded-full border-0 p-0 transition-transform hover:scale-105",
          on
            ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
            : "ring-1 ring-black/20 dark:ring-white/20"
        )}
        style={{ background: swatchBg(P[k]) }}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3" data-k="mediaColors">
      <div>
        <div className="text-[13.5px] font-medium text-foreground">
          {t("Colors without album art")}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {t(
            "When the song has no album art. With album art, the colours always come from the art."
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        {/* Live waves preview */}
        <div
          dir="ltr"
          className="relative flex h-20 items-center gap-3 overflow-hidden rounded-[12px] bg-black px-3.5 text-white ring-1 ring-white/10"
        >
          <div
            ref={waveBoxRef}
            className="pointer-events-none absolute inset-0 [&>canvas]:size-full"
          />
          <div
            className="relative z-10 grid size-11 shrink-0 place-items-center rounded-[10px] text-white shadow-sm"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            <Music className="size-5" aria-hidden="true" />
          </div>
          <div className="relative z-10 min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">
              {t("A song without art")}
            </div>
            <div className="truncate text-[11.5px] text-white/75">
              {t(activePal.name)}
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full w-3/5 rounded-full"
                style={{ background: `linear-gradient(90deg, ${c1}, ${c3})` }}
              />
            </div>
          </div>
          <div className="relative z-10 flex h-6 items-end gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="sy-eq-bar w-1 rounded-full"
                style={{
                  height: `${12 + ((i * 7) % 12)}px`,
                  backgroundColor: i % 2 === 0 ? c1 : c3,
                  animationDelay: `${-i * 0.17}s`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Swatches split into Solid / Gradient */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11.5px] font-medium text-muted-foreground">
              {t("Solid")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {solidKeys.map(renderSwatch)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11.5px] font-medium text-muted-foreground">
              {t("Gradient")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {gradKeys.map(renderSwatch)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CUSTOMS: Record<string, CustomPart> = {
  mediaColors: MediaColorsPart,
  ytStatus: YtStatusPart,
};

export const media: SectionBody = {
  id: "media",
  rows: [...MEDIA_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <Rows
      sectionId="media"
      rows={MEDIA_ROWS}
      customs={CUSTOMS}
      settings={props.settings}
      set={props.set}
      os={props.os}
      part={props.part}
      onNavigate={props.onNavigate}
    />
  ),
};
