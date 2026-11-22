import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { placeName, showKemenag, type PlaceLike } from "./logic";
import { PlaceSearch } from "./PlaceSearch";

interface PrayerPlace extends PlaceLike {
  lat?: number;
  lon?: number;
  kemenag?: { name?: string };
}

interface KemenagPlace {
  id?: string;
  name: string;
}

export function PrayerCityPart({ settings, set }: CustomPartProps) {
  const rawOwn = settings.prayerLocation as PrayerPlace | null | undefined;
  const own = rawOwn && rawOwn.lat != null ? rawOwn : null;
  const wx = (settings.weatherLocation as PrayerPlace | null | undefined) ?? null;
  const where = own || wx;
  const kemenag = (settings.prayerKemenag as KemenagPlace | null | undefined) ?? null;
  const hasKemenag = showKemenag(where, settings.prayerMethod);

  return (
    <div className="divide-y divide-border/80">
      <div className="pb-3 last:pb-0">
        <PlaceSearch<PrayerPlace>
          dataK="prayerLocation"
          rowLabel={t("City")}
          rowSub={
            where
              ? `${placeName(where)}${own ? "" : ` ${t("(same as Weather)")}`}`
              : t("Pick a city")
          }
          before={
            own ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void set({ prayerLocation: null, prayerKemenag: null })}
              >
                {t("Use the Weather city")}
              </Button>
            ) : undefined
          }
          find={async (q) => {
            const r = await notch.svc("weather", "search", q);
            return Array.isArray(r) ? (r as PrayerPlace[]) : [];
          }}
          label={(x) => placeName(x)}
          pick={(x) => void set({ prayerLocation: x, prayerKemenag: null })}
          placeholder={t("Search a city…")}
          ariaLabel={t("City")}
        />
      </div>

      {hasKemenag && (
        <div className="pt-3">
          <PlaceSearch<KemenagPlace>
            dataK="prayerKemenag"
            rowLabel={t("Kemenag regency / city")}
            rowSub={
              kemenag?.name ||
              where?.kemenag?.name ||
              t("Matched to your city automatically")
            }
            before={
              kemenag ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void set({ prayerKemenag: null })}
                >
                  {t("Automatic")}
                </Button>
              ) : undefined
            }
            find={async (q) => {
              const r = await notch.svc("prayer", "search", q);
              return Array.isArray(r) ? (r as KemenagPlace[]) : [];
            }}
            label={(x) => x.name}
            pick={(x) => void set({ prayerKemenag: x })}
            placeholder={t("e.g. Bekasi, Sleman…")}
            noMatch={t(
              "No matches. Try the regency or city name without “Kota” / “Kab.”"
            )}
            ariaLabel={t("Kemenag regency / city")}
          />
        </div>
      )}
    </div>
  );
}
