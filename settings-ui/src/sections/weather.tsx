import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { Rows } from "@/rows/Rows";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { WEATHER_ROWS } from "./features.rows";
import { LocatePart } from "./parts/Locate";
import { ModuleStyleCard } from "./parts/ModuleStyleCard";
import { placeName, type PlaceLike } from "./parts/logic";
import { PlaceSearch } from "./parts/PlaceSearch";

interface WeatherPlace extends PlaceLike {
  lat: number;
  lon: number;
}

function WeatherLocationPart({ settings, set }: CustomPartProps) {
  const loc = (settings.weatherLocation as WeatherPlace | null | undefined) ?? null;
  return (
    <PlaceSearch<WeatherPlace>
      dataK="weatherLocation"
      rowLabel={t("Location")}
      rowSub={loc ? placeName(loc) : t("Detected from your time zone")}
      find={async (q) => {
        const r = await notch.svc("weather", "search", q);
        return Array.isArray(r) ? (r as WeatherPlace[]) : [];
      }}
      label={(x) => `${x.name}${x.admin ? `, ${x.admin}` : ""} · ${x.country}`}
      pick={(x) => void set({ weatherLocation: x, locationAuto: false })}
      placeholder={t("Search a city…")}
      ariaLabel={t("Location")}
    />
  );
}

function WeatherLocatePart({ settings, os }: CustomPartProps) {
  const loc = (settings.weatherLocation as WeatherPlace | null | undefined) ?? null;
  return (
    <LocatePart
      which="weather"
      cur={loc && loc.lat != null && loc.lon != null ? { lat: loc.lat, lon: loc.lon } : null}
      os={os}
    />
  );
}

const CUSTOMS = {
  wxLocation: WeatherLocationPart,
  locate: WeatherLocatePart,
};

export const weather: SectionBody = {
  id: "weather",
  rows: [...WEATHER_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <div className="flex flex-col gap-4">
      <ModuleStyleCard moduleId="weather" settings={props.settings} set={props.set} />
      <Rows
        sectionId="weather"
        rows={WEATHER_ROWS}
        customs={CUSTOMS}
        settings={props.settings}
        set={props.set}
        os={props.os}
        part={props.part}
        onNavigate={props.onNavigate}
      />
    </div>
  ),
};
