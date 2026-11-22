import { useMemo } from "react";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, SectionBody } from "@/rows/types";
import { TryVolumePart } from "./parts/TryVolume";
import { hudRows } from "./system.rows";

const CUSTOMS: Record<string, CustomPart> = {
  tryVolume: TryVolumePart,
};

function HudSection(props: CustomPartProps) {
  const rows = useMemo(() => hudRows(props.os), [props.os]);
  return (
    <Rows
      sectionId="hud"
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

export const hud: SectionBody = {
  id: "hud",
  customs: CUSTOMS,
  render: HudSection,
};
