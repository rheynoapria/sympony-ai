import { useEffect, useMemo, useState } from "react";
import { notch, type DisplayInfo } from "@/lib/notch";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, Opt, Row, SectionBody } from "@/rows/types";
import { GENERAL_ROWS } from "./general.rows";
import { ClosedSlotsPart } from "./parts/ClosedSlots";
import { HourChimePart } from "./parts/HourChime";
import { LanguagePart } from "./parts/Language";
import { NotchColorPart } from "./parts/NotchColor";
import { PositionPart } from "./parts/Position";
import { WorldClocksPart } from "./parts/WorldClocks";

const CUSTOMS: Record<string, CustomPart> = {
  language: LanguagePart,
  position: PositionPart,
  closedSlots: ClosedSlotsPart,
  worldClocks: WorldClocksPart,
  hourChime: HourChimePart,
  notchColor: NotchColorPart,
};

function GeneralSection(props: CustomPartProps) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    let alive = true;
    notch
      .listDisplays()
      .then((list) => {
        if (alive && Array.isArray(list)) setDisplays(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rows: Row[] = useMemo(
    () =>
      GENERAL_ROWS.map((r) => {
        if (r.t === "select" && r.k === "display") {
          const baseOpts: Opt[] = [
            ["primary", "Primary display"],
            ["all", "All displays"],
            ["cursor", "Display with the mouse cursor"],
            ...displays.map(
              (d): Opt => [String(d.id), d.label || d.name || String(d.id)]
            ),
          ];
          return { ...r, options: baseOpts };
        }
        return r;
      }),
    [displays]
  );

  return (
    <Rows
      sectionId="general"
      rows={rows}
      customs={CUSTOMS}
      settings={props.settings}
      set={props.set}
      os={props.os}
      part={props.part}
      onNavigate={props.onNavigate}
    />
  );
}

export const general: SectionBody = {
  id: "general",
  rows: [...GENERAL_ROWS],
  customs: CUSTOMS,
  render: GeneralSection,
};
