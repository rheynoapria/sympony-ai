import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "@/components/icons";
import iconUrl from "../../../../frontend/icon.png";
import {
  CommandMenu,
  type CommandItem,
} from "@/components/ui/knowns/command-menu/command-menu";
import { Kbd } from "@/components/ui/knowns/kbd";
import {
  ThemeToggle,
  type Theme,
} from "@/components/ui/knowns/theme-toggle";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import {
  GROUP_META,
  searchAll,
  sectionsFor,
  type OS,
  type SearchHit,
  type SectionGroup,
  type SectionMeta,
} from "@/sections/registry";
import { SectionIcon } from "./icons";

const NAV_GROUPS: readonly SectionGroup[] = [
  "sympony",
  "ai",
  "features",
  "system",
];

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export interface SidebarProps {
  os: OS;
  version: string;
  activeId: string;
  onSelect: (id: string, opts?: { row?: string; part?: string }) => void;
  theme: Theme;
  onThemeChange: (next: Theme) => void;
}

export function Sidebar({
  os,
  version,
  activeId,
  onSelect,
  theme,
  onThemeChange,
}: SidebarProps) {
  const isMac = os === "macos";
  const [cmdOpen, setCmdOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const visible = useMemo(() => sectionsFor(os), [os]);
  const sectionMap = useMemo(
    () => new Map(visible.map((s) => [s.id, s])),
    [visible]
  );

  const byGroup = useMemo(() => {
    const map: Record<SectionGroup, SectionMeta[]> = {
      sympony: [],
      ai: [],
      features: [],
      system: [],
      app: [],
    };
    for (const sec of visible) {
      map[sec.group].push(sec);
    }
    return map;
  }, [visible]);

  const [expanded, setExpanded] = useState<Record<SectionGroup, boolean>>(() => {
    const active = visible.find((s) => s.id === activeId);
    return {
      sympony: GROUP_META.sympony.defaultExpanded,
      ai: GROUP_META.ai.defaultExpanded,
      features:
        GROUP_META.features.defaultExpanded || active?.group === "features",
      system: GROUP_META.system.defaultExpanded || active?.group === "system",
      app: true,
    };
  });

  useEffect(() => {
    const active = visible.find((s) => s.id === activeId);
    if (!active) return;
    setExpanded((prev) =>
      prev[active.group] ? prev : { ...prev, [active.group]: true }
    );
    requestAnimationFrame(() => {
      navRef.current
        ?.querySelector<HTMLElement>('button[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [activeId, visible]);

  const toggleGroup = (g: SectionGroup) => {
    setExpanded((prev) => ({ ...prev, [g]: !prev[g] }));
  };

  // Root section items shown when search input is empty
  const rootItems: CommandItem[] = useMemo(
    () =>
      visible.map((sec) => ({
        id: `sec:${sec.id}`,
        label: t(sec.title),
        description: t(sec.subtitle),
        group: t(GROUP_META[sec.group].label),
        icon: <SectionIcon name={sec.icon} className="size-4" />,
        keywords: [sec.id, sec.title, ...(sec.words ?? [])],
        onSelect: () => onSelect(sec.id),
      })),
    [visible, onSelect]
  );

  // Async/live search loader using searchAll (supports migrated rows, also, SEARCH_WORDS, and Indonesian SYNONYMS)
  const loadSearch = useMemo(
    () => async (query: string): Promise<CommandItem[]> => {
      const q = query.trim();
      if (!q) return [];
      const hits: SearchHit[] = searchAll(q, os).slice(0, 60);
      return hits.map((h, i) => {
        const sec = sectionMap.get(h.section);
        const secTitle = sec ? t(sec.title) : h.section;
        const isPage = h.label === secTitle;
        return {
          id: `hit:${h.section}:${i}:${h.label}`,
          label: h.label,
          description: isPage
            ? t("Page")
            : h.sub
              ? `${secTitle} · ${h.sub.length > 110 ? `${h.sub.slice(0, 110)}…` : h.sub}`
              : secTitle,
          group: sec ? t(GROUP_META[sec.group].label) : t("Results"),
          icon: sec ? <SectionIcon name={sec.icon} className="size-4" /> : undefined,
          keywords: [q],
          onSelect: () =>
            onSelect(h.section, isPage ? undefined : { row: h.row ?? h.label, part: h.part }),
        };
      });
    },
    [os, sectionMap, onSelect]
  );

  const commandGroups = useMemo(
    () =>
      (["sympony", "ai", "features", "system", "app"] as const).map((g) =>
        t(GROUP_META[g].label)
      ),
    []
  );

  const renderItem = (sec: SectionMeta) => {
    const on = sec.id === activeId;
    return (
      <button
        key={sec.id}
        type="button"
        aria-current={on ? "page" : undefined}
        onClick={() => onSelect(sec.id)}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-[6.5px] text-start text-[13px] transition-colors",
          on
            ? "bg-accent font-medium text-foreground shadow-[inset_0_1px_0_var(--hairline-top)] ring-1 ring-border"
            : "font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <span
          className={cn(
            "shrink-0 transition-colors",
            on
              ? "text-foreground"
              : "text-muted-foreground/80 group-hover:text-foreground"
          )}
        >
          <SectionIcon name={sec.icon} className="size-4" />
        </span>
        <span className="truncate">{t(sec.title)}</span>
      </button>
    );
  };

  return (
    <>
      <aside
        className="sidebar-inset flex min-h-0 flex-col overflow-hidden border border-border"
        style={{ borderRadius: "var(--pane-radius)" }}
      >
        {/* Top drag strip (reserves space for native macOS overlay traffic lights) */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex shrink-0 items-center gap-2.5 px-3.5 pb-3 select-none",
            isMac ? "pt-[52px]" : "pt-3.5"
          )}
        >
          <img
            src={iconUrl}
            alt="Sympony"
            draggable={false}
            data-tauri-drag-region
            className="size-8 shrink-0 object-contain"
          />
          <div data-tauri-drag-region className="min-w-0 leading-tight">
            <div
              data-tauri-drag-region
              className="truncate text-[14px] font-semibold tracking-[-0.015em] text-foreground"
            >
              Sympony
            </div>
            <div
              data-tauri-drag-region
              className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
            >
              {version ? `v${version}` : "…"}
            </div>
          </div>
        </div>

        {/* Search trigger */}
        <div className="shrink-0 px-2.5 pb-2">
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="flex w-full cursor-pointer items-center gap-2 border border-border bg-muted/55 px-2.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            style={{ borderRadius: "var(--control-radius)" }}
          >
            <Search className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
            <span className="truncate">{t("Search")}</span>
            <span className="ms-auto inline-flex shrink-0 items-center gap-0.5">
              <Kbd size="sm">{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd size="sm">K</Kbd>
            </span>
          </button>
        </div>

        {/* Scrollable navigation groups */}
        <nav
          ref={navRef}
          aria-label={t("Settings sections")}
          className="kn-scroll flex-1 overflow-y-auto px-2 py-1"
        >
          {NAV_GROUPS.map((g, idx) => {
            const items = byGroup[g];
            if (!items.length) return null;
            const open = expanded[g];
            return (
              <div key={g} className={cn(idx > 0 && "mt-3.5")}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleGroup(g)}
                  className="flex w-full cursor-pointer items-center justify-between gap-1 rounded-[7px] px-2.5 py-1 text-[10.5px] font-medium tracking-[0.04em] text-muted-foreground/80 uppercase transition-colors hover:text-foreground"
                >
                  <span className="truncate">{t(GROUP_META[g].label)}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-3 shrink-0 opacity-70 transition-transform",
                      !open && "-rotate-90 rtl:rotate-90"
                    )}
                  />
                </button>
                {open && (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Pinned footer: About & ThemeToggle */}
        <div className="shrink-0 border-t border-border/75 px-2 py-2">
          {byGroup.app.length > 0 && (
            <div className="mb-1.5 flex flex-col gap-0.5">
              {byGroup.app.map(renderItem)}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 pt-1">
            <span className="truncate text-[11.5px] font-medium text-muted-foreground">
              {t("Theme")}: {t(THEME_LABELS[theme])}
            </span>
            <ThemeToggle
              theme={theme}
              onThemeChange={onThemeChange}
              cycle
              variant="circle"
              size="sm"
            />
          </div>
        </div>
      </aside>

      <CommandMenu
        items={rootItems}
        load={loadSearch}
        debounce={50}
        groups={commandGroups}
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        hotkey="mod+k"
        placeholder={t("Search settings…")}
        aria-label={t("Search settings")}
      />
    </>
  );
}
