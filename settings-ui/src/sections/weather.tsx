import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { WEATHER_ROWS } from "./features.rows";
import { LocatePart } from "./parts/Locate";
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

function WeatherLocatePart({ settings }: CustomPartProps) {
  const loc = (settings.weatherLocation as WeatherPlace | null | undefined) ?? null;
  return (
    <LocatePart
      which="weather"
      cur={loc && loc.lat != null && loc.lon != null ? { lat: loc.lat, lon: loc.lon } : null}
    />
  );
}

export const weather: SectionBody = {
  id: "weather",
  rows: [...WEATHER_ROWS],
  customs: {
    wxLocation: WeatherLocationPart,
    locate: WeatherLocatePart,
  },
};
