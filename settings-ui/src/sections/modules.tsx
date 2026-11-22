import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { SectionIcon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
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

function ModulesSection({ settings, set, os }: CustomPartProps) {
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

  return (
    <div className="flex flex-col gap-5">
      <LeadText html="Each ON module is a page in the notch; this order is the swipe order." />

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
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {t(meta.title)}
                  </div>
                  {meta.sub && (
                    <div className="truncate text-[12px] text-muted-foreground">
                      {t(meta.sub)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
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
