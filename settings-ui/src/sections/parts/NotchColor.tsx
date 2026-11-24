import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import type { CustomPartProps } from "@/rows/types";

export const NOTCH_COLORS: readonly [string, string][] = [
  ["#1c2b4d", "Navy"],
  ["#3649c9", "Indigo"],
  ["#3b1f5e", "Plum"],
  ["#0f4a46", "Teal"],
  ["#5c1a24", "Wine"],
  ["#2c2c2e", "Graphite"],
  ["#f2f2f7", "White"],
  ["#f6c1d0", "Pink"],
  ["#ffd166", "Sun|color"],
];

function validHex(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/.test(s) ? s : "#1c2b4d";
}

export function NotchColorPart({ settings, set, row }: CustomPartProps) {
  if (settings.notchLook !== "color") return null;

  const cur = validHex(settings.notchColor);
  const label = row && "label" in row && row.label ? t(row.label) : t("Notch color");
  const sub =
    row && "sub" in row && row.sub
      ? t(row.sub)
      : t("Pick a preset or any custom color.");

  return (
    <SettingsRow label={label} description={sub}>
      <div
        className="flex flex-wrap items-center justify-end gap-2"
        data-k="notchColor"
      >
        {NOTCH_COLORS.map(([hex, name]) => {
          const active = cur === hex;
          return (
            <button
              key={hex}
              type="button"
              aria-label={t(name)}
              aria-pressed={active}
              title={t(name)}
              onClick={() => void set({ notchColor: hex })}
              style={{ backgroundColor: hex }}
              className={cn(
                "size-6 cursor-pointer rounded-full border border-white/20 transition-transform hover:scale-110",
                active && "ring-2 ring-primary ring-offset-2 ring-offset-card"
              )}
            />
          );
        })}
        <label
          title={t("Any color")}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 text-[11.5px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <input
            type="color"
            aria-label={t("Any color")}
            value={cur}
            onChange={(e) => void set({ notchColor: e.target.value.toLowerCase() })}
            className="size-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <span className="uppercase">{cur}</span>
        </label>
      </div>
    </SettingsRow>
  );
}
