import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import {
  ALLOWED_GRID_SIZES,
  defaultGridSize,
  readModulePref,
  readModuleStyles,
  type GridSize,
} from "@/lib/stylelib";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { ModuleStyleCard } from "./parts/ModuleStyleCard";

interface ModuleEntry {
  id: string;
  on?: boolean;
}

function ControlSection({ settings, set, onNavigate }: CustomPartProps) {
  const mods = Array.isArray(settings.modules) ? (settings.modules as ModuleEntry[]) : [];
  const controlEntry = mods.find((m) => m && m.id === "control");
  const controlOn = controlEntry ? controlEntry.on !== false : true;
  const pref = readModulePref(settings, "control");
  const gridOptions = ALLOWED_GRID_SIZES.control ?? (["2x1", "2x2", "1x1"] as const);
  const gridSize = (pref.gridSize && gridOptions.includes(pref.gridSize)
    ? pref.gridSize
    : defaultGridSize("control")) as GridSize;

  const toggleModule = (on: boolean) => {
    const next = mods.some((m) => m && m.id === "control")
      ? mods.map((m) => (m && m.id === "control" ? { ...m, on } : m))
      : [...mods, { id: "control", on }];
    void set({ modules: next });
  };

  const setGridSize = (next: string) => {
    const all = readModuleStyles(settings);
    void set({
      moduleStyles: {
        ...all,
        control: { ...pref, gridSize: next as GridSize },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <ModuleStyleCard moduleId="control" settings={settings} set={set} />

      <PanelCard title={t("Control behavior")} icon={groupIcon("Control behavior")}>
        <div className="divide-y divide-border/80">
          <div className="pb-3" data-k="modules">
            <SettingsRow
              label={t("Show Control in notch")}
              description={t("Enable the Control tab and dashboard card for quick toggles, sliders and sound output.")}
            >
              <Switch
                checked={controlOn}
                aria-label={t("Show Control in notch")}
                onCheckedChange={toggleModule}
              />
            </SettingsRow>
          </div>

          <div className="py-3" data-k="moduleStyles">
            <SettingsRow
              label={t("Dashboard card size")}
              description={t("Choose how much space the Control tile occupies on your 4×2 dashboard grid.")}
            >
              <SegmentedControl
                tone="neutral"
                size="sm"
                aria-label={t("Dashboard card size")}
                value={gridSize}
                options={gridOptions.map((g) => ({
                  value: g,
                  label: g.replace("x", "×"),
                }))}
                onValueChange={setGridSize}
              />
            </SettingsRow>
          </div>

          <div className="py-3" data-k="keepAwake">
            <SettingsRow
              label={t("Keep awake")}
              description={t("Prevent the display from sleeping while toggled on in Control.")}
            >
              <Switch
                checked={Boolean(settings.keepAwake)}
                aria-label={t("Keep awake")}
                onCheckedChange={(checked) => void set({ keepAwake: checked })}
              />
            </SettingsRow>
          </div>

          {onNavigate && (
            <div className="pt-3">
              <SettingsRow
                label={t("Related system settings")}
                description={t("Configure on-screen volume/brightness overlays or wireless devices.")}
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button size="xs" variant="secondary" onClick={() => onNavigate("hud")}>
                    {t("HUD")}
                  </Button>
                  <Button size="xs" variant="secondary" onClick={() => onNavigate("bluetooth")}>
                    {t("Bluetooth & Wi-Fi")}
                  </Button>
                </div>
              </SettingsRow>
            </div>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

export const control: SectionBody = {
  id: "control",
  render: ControlSection,
};
