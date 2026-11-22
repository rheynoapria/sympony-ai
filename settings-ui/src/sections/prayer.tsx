import { useMemo } from "react";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, Row, SectionBody } from "@/rows/types";
import { PRAYER_ROWS } from "./features.rows";
import { AdhanPart } from "./parts/Adhan";
import { LocatePart } from "./parts/Locate";
import { showKemenag } from "./parts/logic";
import { PrayerCityPart } from "./parts/PrayerCity";
import { PrayerTodayPart } from "./parts/PrayerToday";

function PrayerLocatePart({ settings }: CustomPartProps) {
  const own = settings.prayerLocation as { lat?: number; lon?: number } | null | undefined;
  return (
    <LocatePart
      which="prayer"
      cur={own && own.lat != null && own.lon != null ? { lat: own.lat, lon: own.lon } : null}
    />
  );
}

const CUSTOMS: Record<string, CustomPart> = {
  prayerToday: PrayerTodayPart,
  prayerCity: PrayerCityPart,
  locate: PrayerLocatePart,
  adhan: AdhanPart,
};

function PrayerSection(props: CustomPartProps) {
  const own = props.settings.prayerLocation as
    | { lat?: number; country?: string }
    | null
    | undefined;
  const wx = props.settings.weatherLocation as { country?: string } | null | undefined;
  const where = own && own.lat != null ? own : wx;
  const kemenagOn = showKemenag(where, props.settings.prayerMethod);

  const rows: Row[] = useMemo(
    () =>
      PRAYER_ROWS.map((r) => {
        if ("k" in r && r.k === "prayerSchool" && kemenagOn) {
          return {
            ...r,
            sub: "The Kemenag table already sets Asr; this applies to the other methods",
          };
        }
        return r;
      }),
    [kemenagOn]
  );

  return (
    <Rows
      sectionId="prayer"
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

export const prayer: SectionBody = {
  id: "prayer",
  rows: [...PRAYER_ROWS],
  customs: CUSTOMS,
  render: PrayerSection,
};
