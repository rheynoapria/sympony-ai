import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, Row, SectionBody } from "@/rows/types";
import { DropTilesPart } from "./parts/DropTiles";
import { LauncherPart } from "./parts/Launcher";
import { PhoneFolderPart } from "./parts/PhoneFolder";
import {
  dropActionsRows,
  PHONE_SHARE_SUB_A,
  PHONE_SHARE_SUB_B,
} from "./system.rows";

const CUSTOMS: Record<string, CustomPart> = {
  dropTiles: DropTilesPart,
  phoneFolder: PhoneFolderPart,
  launcher: LauncherPart,
};

function DropActionsSection(props: CustomPartProps) {
  const rows: Row[] = useMemo(
    () =>
      dropActionsRows(props.os).map((r) =>
        "k" in r && r.k === "phoneShare"
          ? { ...r, sub: `${t(PHONE_SHARE_SUB_A)} ${t(PHONE_SHARE_SUB_B)}` }
          : r
      ),
    [props.os]
  );

  return (
    <Rows
      sectionId="dropactions"
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

export const dropactions: SectionBody = {
  id: "dropactions",
  customs: CUSTOMS,
  render: DropActionsSection,
};
