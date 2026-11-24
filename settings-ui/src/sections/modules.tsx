import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Palette } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Switch } from "@/components/ui/knowns/switch";
import { NewBadge } from "@/components/shell/NewBadge";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { SectionIcon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import { isNewKeyUnseen, markNewKeysSeen, useWhatsNew } from "@/lib/whatsNew";
import {
  activeStyleOption,
  ALLOWED_GRID_SIZES,
  defaultGridSize,
  MODULE_STYLES,
  MODULE_TO_SETTINGS_SECTION,
  QUICK_PACKS,
  readCardStyle,
  readModulePref,
  readModuleStyles,
  type CardDensity,
  type CardRadius,
  type CardSurface,
  type GridSize,
  type ModuleSizeMode,
} from "@/lib/stylelib";
import { LeadText } from "@/rows/Rows";
import { offTabs } from "@/rows/os";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { moduleMetaFor } from "./modules.meta";

interface ModuleEntry {
  id: string;
  on: boolean;
}

function readRestoreTab(): boolean {
  try {
    return localStorage.getItem("sympony.restoreTab") !== "0";
  } catch {
    return true;
  }
}

const STYLE_LIBRARY_NEW_KEY = "v0.2b5:item:modules:styleLibrary";

function ModulesSection({ settings, set, os, onNavigate }: CustomPartProps) {
  useWhatsNew();
  const every = (Array.isArray(settings.modules) ? settings.modules : []) as ModuleEntry[];
  const hiddenIds = new Set(offTabs(os));
  const mods = os === "windows" ? every : every.filter((m) => !hiddenIds.has(m.id));
  const hiddenMods = os === "windows" ? [] : every.filter((m) => hiddenIds.has(m.id));

  const [restoreTab, setRestoreTab] = useState<boolean>(readRestoreTab);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragList, setDragList] = useState<ModuleEntry[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    idx: number;
    active: boolean;
    curList: ModuleEntry[];
  } | null>(null);

  const displayed = dragList ?? mods;

  const save = (next: ModuleEntry[]) => {
    void set({
      modules: os === "windows" ? next : [...next, ...hiddenMods],
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= mods.length || from === to) return;
    const next = mods.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    save(next);
  };

  const toggle = (i: number, on: boolean) => {
    const mod = mods[i];
    if (mod) {
      const meta = moduleMetaFor(mod.id, os);
      if (meta.newKey) markNewKeysSeen([meta.newKey]);
    }
    const next = mods.map((m, idx) => (idx === i ? { ...m, on } : m));
    save(next);
  };

  const onRowPointerDown = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, a, [role='switch']")) return;
    if (e.pointerType === "touch" && !target.closest("[data-grip]")) return;

    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      idx: i,
      active: e.pointerType === "touch",
      curList: mods.slice(),
    };
    if (e.pointerType === "touch") {
      setDragIdx(i);
      setDragList(mods.slice());
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onListPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragState.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 5) return;
      d.active = true;
      setDragIdx(d.idx);
      setDragList(d.curList);
      try {
        listRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    e.preventDefault();
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-mod-row]") ?? []
    );
    let targetIdx = d.curList.length - 1;
    for (let k = 0; k < rows.length; k++) {
      const box = rows[k].getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        targetIdx = k;
        break;
      }
    }
    if (targetIdx !== d.idx) {
      const next = d.curList.slice();
      const [moved] = next.splice(d.idx, 1);
      next.splice(targetIdx, 0, moved);
      d.curList = next;
      d.idx = targetIdx;
      setDragIdx(targetIdx);
      setDragList(next);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragState.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragState.current = null;
    if (d.active) {
      const changed = d.curList.some((m, idx) => m.id !== mods[idx]?.id);
      setDragIdx(null);
      setDragList(null);
      if (changed) save(d.curList);
    }
  };

  const enabledMods = mods.filter((m) => m.on);
  const notchView = settings.notchView === "dashboard" ? "dashboard" : "modules";
  const cardStyle = readCardStyle(settings);
  const allModStyles = readModuleStyles(settings);

  const updateCardStyle = (patch: Partial<typeof cardStyle>) => {
    void set({ cardStyle: { ...cardStyle, ...patch } });
  };

  const applyQuickPack = (packId: "bento" | "compact" | "minimal") => {
    const pack = QUICK_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const nextStyles = { ...allModStyles };
    for (const [modId, styleId] of Object.entries(pack.styles)) {
      nextStyles[modId] = {
        ...(nextStyles[modId] ?? {}),
        style: styleId,
        size: "auto",
        surface: "auto",
      };
    }
    void set({
      cardStyle: pack.cardStyle,
      moduleStyles: nextStyles,
    });
  };

  const setGridSize = (modId: string, gridSize: GridSize) => {
    const nextStyles = {
      ...allModStyles,
      [modId]: {
        ...(allModStyles[modId] ?? {}),
        gridSize,
      },
    };
    void set({ moduleStyles: nextStyles });
  };

  const setNotchSize = (modId: string, size: ModuleSizeMode) => {
    const nextStyles = {
      ...allModStyles,
      [modId]: {
        ...(allModStyles[modId] ?? {}),
        size,
      },
    };
    void set({ moduleStyles: nextStyles });
  };

  const activePackId =
    QUICK_PACKS.find((pack) =>
      Object.entries(pack.styles).every(
        ([modId, styleId]) => (activeStyleOption(settings, modId)?.id ?? "bento") === styleId
      )
    )?.id ?? null;

  return (
    <div className="flex flex-col gap-5">
      <LeadText html="Each ON module is a page in the notch; this order is the swipe order." />

      <PanelCard
        title={
          isNewKeyUnseen(STYLE_LIBRARY_NEW_KEY) ? (
            <span className="inline-flex items-center gap-2">
              <span>{t("Module Style Library")}</span>
              <NewBadge />
            </span>
          ) : (
            t("Module Style Library")
          )
        }
        icon={groupIcon("Module Style Library")}
      >
        <div
          className="divide-y divide-border/80"
          data-k="cardStyle"
          onPointerDown={() => markNewKeysSeen([STYLE_LIBRARY_NEW_KEY])}
        >
          <div className="pb-3.5">
            <div className="text-[13px] font-medium text-foreground">{t("Quick style presets")}</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t("Apply a cohesive OLED layout look across styled modules in one click, or customize each module individually.")}
            </p>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {QUICK_PACKS.map((pack) => {
                const on = activePackId === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => applyQuickPack(pack.id)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 text-start transition-all",
                      on
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-muted/25 hover:bg-muted/50"
                    )}
                  >
                    <span className="text-[12.5px] font-semibold text-foreground">{t(pack.title)}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{t(pack.sub)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="py-3">
            <SettingsRow
              label={t("Dashboard card surface")}
              description={t("Surface style for cards in Dashboard 4×2 view.")}
            >
              <SegmentedControl
                tone="neutral"
                size="sm"
                aria-label={t("Dashboard card surface")}
                value={cardStyle.surface}
                options={[
                  { value: "oled", label: t("OLED") },
                  { value: "borderless", label: t("Borderless") },
                  { value: "outline", label: t("Outline") },
                  { value: "glass", label: t("Glass") },
                  { value: "tinted", label: t("Tinted") },
                ]}
                onValueChange={(next) => updateCardStyle({ surface: next as CardSurface })}
              />
            </SettingsRow>
          </div>

          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-medium text-foreground">{t("Corner radius")}</span>
              <SegmentedControl
                tone="neutral"
                size="sm"
                aria-label={t("Corner radius")}
                value={cardStyle.radius}
                options={[
                  { value: "sharp", label: t("Sharp") },
                  { value: "rounded", label: t("Rounded") },
                  { value: "soft", label: t("Soft") },
                ]}
                onValueChange={(next) => updateCardStyle({ radius: next as CardRadius })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-medium text-foreground">{t("Density")}</span>
              <SegmentedControl
                tone="neutral"
                size="sm"
                aria-label={t("Density")}
                value={cardStyle.density}
                options={[
                  { value: "compact", label: t("Compact") },
                  { value: "balanced", label: t("Balanced") },
                  { value: "airy", label: t("Airy") },
                ]}
                onValueChange={(next) => updateCardStyle({ density: next as CardDensity })}
              />
            </div>
          </div>
        </div>
      </PanelCard>

      <PanelCard>
        <div data-k="notchView">
          <SettingsRow label={t("Notch view")}>
            <div
              role="radiogroup"
              aria-label={t("Notch view")}
              className="inline-flex rounded-[var(--control-radius)] border border-input bg-muted/60 p-0.5"
            >
              {(
                [
                  ["modules", "Per module"],
                  ["dashboard", "Dashboard"],
                ] as const
              ).map(([val, lbl]) => {
                const active = notchView === val;
                return (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => void set({ notchView: val })}
                    className={cn(
                      "h-7 rounded-[calc(var(--control-radius)-2px)] px-3 text-[12.5px] font-medium transition-colors",
                      active
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t(lbl)}
                  </button>
                );
              })}
            </div>
          </SettingsRow>
        </div>
      </PanelCard>

      <PanelCard>
        <div
          ref={listRef}
          data-k="modules"
          onPointerMove={onListPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          className={cn("divide-y divide-border/80", dragIdx !== null && "select-none")}
        >
          {displayed.map((m, i) => {
            const meta = moduleMetaFor(m.id, os);
            const dragging = dragIdx === i;
            return (
              <div
                key={m.id}
                data-mod-row={m.id}
                onPointerDown={(e) => onRowPointerDown(i, e)}
                className={cn(
                  "flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition-opacity",
                  !m.on && "opacity-55",
                  dragging && "rounded-[8px] bg-accent/70 px-2 ring-1 ring-primary/40"
                )}
              >
                <span
                  data-grip
                  title={t("Drag to reorder")}
                  className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </span>
                <div className="card-ico-well grid size-8 shrink-0 place-items-center rounded-[8px] text-foreground">
                  <SectionIcon name={meta.icon} className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {t(meta.title)}
                    </span>
                    {isNewKeyUnseen(meta.newKey) && <NewBadge />}
                    {(() => {
                      const opt = activeStyleOption(settings, m.id);
                      const secId = MODULE_TO_SETTINGS_SECTION[m.id];
                      if (!opt || !secId) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (meta.newKey) markNewKeysSeen([meta.newKey]);
                            onNavigate?.(secId);
                          }}
                          title={t("Customize style & layout")}
                          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                        >
                          <Palette className="size-2.5" aria-hidden="true" />
                          <span>{t(opt.title)}</span>
                        </button>
                      );
                    })()}
                  </div>
                  {meta.sub && (
                    <div className="truncate text-[12px] text-muted-foreground">
                      {t(meta.sub)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {notchView === "dashboard" && (ALLOWED_GRID_SIZES[m.id]?.length ?? 0) > 1 && (
                    <select
                      aria-label={`${t(meta.title)} ${t("Card size")}`}
                      title={t("Dashboard card size")}
                      value={readModulePref(settings, m.id).gridSize ?? defaultGridSize(m.id)}
                      onChange={(e) => setGridSize(m.id, e.target.value as GridSize)}
                      className="me-1 h-7 rounded-[7px] border border-input bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                    >
                      {(ALLOWED_GRID_SIZES[m.id] ?? []).map((sz) => (
                        <option key={sz} value={sz}>
                          {sz.replace("x", "×")}
                        </option>
                      ))}
                    </select>
                  )}
                  {notchView === "modules" && (() => {
                    const pref = readModulePref(settings, m.id);
                    const curSz: ModuleSizeMode = pref.size ?? "auto";
                    const hasStyles = (MODULE_STYLES[m.id]?.length ?? 0) > 0;
                    return (
                      <select
                        aria-label={`${t(meta.title)} ${t("Notch size")}`}
                        title={t("Notch size")}
                        value={curSz}
                        onChange={(e) => setNotchSize(m.id, e.target.value as ModuleSizeMode)}
                        className="me-1 h-7 rounded-[7px] border border-input bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
                      >
                        <option value="auto">{t("Default")}</option>
                        {hasStyles && <option value="fit">{t("Fit")}</option>}
                        <option value="compact">{t("Compact")}</option>
                        <option value="standard">{t("Standard")}</option>
                        <option value="tall">{t("Tall")}</option>
                        {curSz === "custom" && <option value="custom">{t("Custom")}</option>}
                      </select>
                    );
                  })()}
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<ChevronUp />}
                    disabled={i === 0}
                    title={t("Move up")}
                    aria-label={t("Move up")}
                    onClick={() => move(i, i - 1)}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<ChevronDown />}
                    disabled={i === displayed.length - 1}
                    title={t("Move down")}
                    aria-label={t("Move down")}
                    onClick={() => move(i, i + 1)}
                  />
                  <div className="ms-1.5">
                    <Switch
                      checked={Boolean(m.on)}
                      aria-label={t(meta.title)}
                      onCheckedChange={(checked) => toggle(i, checked)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </PanelCard>

      <PanelCard title={t("Default")} icon={groupIcon("Default")}>
        <div className="divide-y divide-border/80">
          <div className="pb-3" data-k="defaultTab">
            <SettingsRow label={t("Open this module by default")}>
              <select
                aria-label={t("Open this module by default")}
                value={String(settings.defaultTab || "home")}
                onChange={(e) => void set({ defaultTab: e.target.value })}
                className="h-8 min-w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
              >
                {enabledMods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(moduleMetaFor(m.id, os).title)}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </div>

          <div className="py-3" data-k="rememberTab">
            <SettingsRow
              label={t("Remember the last module")}
              description={t("Otherwise Sympony always opens on the default module")}
            >
              <Switch
                checked={Boolean(settings.rememberTab)}
                aria-label={t("Remember the last module")}
                onCheckedChange={(checked) => void set({ rememberTab: checked })}
              />
            </SettingsRow>
          </div>

          <div className="pt-3">
            <SettingsRow
              label={t("Reopen on the last tab")}
              description={t(
                "The tab you left Sympony on comes back when it opens again, also after Sympony restarts"
              )}
            >
              <Switch
                checked={restoreTab}
                aria-label={t("Reopen on the last tab")}
                onCheckedChange={(checked) => {
                  setRestoreTab(checked);
                  try {
                    localStorage.setItem("sympony.restoreTab", checked ? "1" : "0");
                  } catch {
                    /* no storage */
                  }
                }}
              />
            </SettingsRow>
          </div>
        </div>
      </PanelCard>
    </div>
  );
}

export const modules: SectionBody = {
  id: "modules",
  render: ModulesSection,
};
