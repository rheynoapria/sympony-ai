import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveTheme,
  type Theme,
} from "@/components/ui/knowns/theme-toggle";
import { ToastProvider } from "@/components/ui/knowns/toast";
import { t } from "@/lib/i18n";
import { notch, type Settings } from "@/lib/notch";
import { Rows } from "@/rows/Rows";
import type { SectionBody } from "@/rows/types";
import {
  resolveSection,
  sectionsFor,
  type OS,
} from "@/sections/registry";
import { general } from "@/sections/general";
import { welcome } from "@/sections/welcome";
import { modules } from "@/sections/modules";
import { about } from "@/sections/about";
import { ai } from "@/sections/ai";
import { aiusage } from "@/sections/aiusage";
import { integrations } from "@/sections/integrations";
import { media } from "@/sections/media";
import { notifications } from "@/sections/notifications";
import { todo } from "@/sections/todo";
import { pomodoro } from "@/sections/pomodoro";
import { bluetooth } from "@/sections/bluetooth";
import { calendar } from "@/sections/calendar";
import { weather } from "@/sections/weather";
import { prayer } from "@/sections/prayer";
import { dropactions } from "@/sections/dropactions";
import { control } from "@/sections/control";
import { hud } from "@/sections/hud";
import { battery } from "@/sections/battery";
import { github } from "@/sections/github";
import { feed } from "@/sections/feed";
import { voice } from "@/sections/voice";
import {
  cursor,
  dayprogress,
  dock,
  effects,
  health,
  live,
  mirror,
  screentime,
  snap,
  stats,
  wallpaper,
} from "@/sections/simple";
import { Placeholder } from "@/components/shell/Placeholder";
import { SectionHeader } from "@/components/shell/SectionHeader";
import { Sidebar } from "@/components/shell/Sidebar";
import { UpdateBanner } from "@/components/shell/UpdateBanner";
import { SectionIcon } from "@/components/shell/icons";
import { hasPendingBadge, useUpdateState } from "@/lib/update";

const THEME_STORAGE_KEY = "sympony.settingsTheme";

export const BODIES: Record<string, SectionBody> = {
  welcome,
  general,
  modules,
  live,
  cursor,
  effects,
  wallpaper,
  ai,
  aiusage,
  integrations,
  github,
  feed,
  voice,
  media,
  notifications,
  todo,
  calendar,
  weather,
  prayer,
  pomodoro,
  health,
  screentime,
  dayprogress,
  bluetooth,
  dock,
  dropactions,
  snap,
  control,
  hud,
  battery,
  mirror,
  stats,
  about,
};

function detectOS(): OS {
  if (typeof window !== "undefined" && !window.notch) {
    const q = new URLSearchParams(window.location.search).get("os");
    if (q === "macos" || q === "windows" || q === "linux") return q;
  }
  const fromHost = typeof window !== "undefined" ? window.SYMPONY_OS : undefined;
  if (fromHost === "macos" || fromHost === "windows" || fromHost === "linux") {
    return fromHost;
  }
  if (typeof navigator !== "undefined") {
    const plat = navigator.platform || "";
    if (/Win/i.test(plat)) return "windows";
    if (/Linux/i.test(plat)) return "linux";
  }
  return "macos";
}

function readInitialTheme(): Theme {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("theme");
    if (q === "light" || q === "dark" || q === "system") return q;
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        return saved;
      }
    } catch {
      /* ignore */
    }
  }
  return "system";
}

function flashElement(el: HTMLElement) {
  el.classList.remove("row-flash");
  void el.offsetWidth;
  el.classList.add("row-flash");
  window.setTimeout(() => el.classList.remove("row-flash"), 1600);
}

function SettingsShell() {
  const os = useMemo(detectOS, []);
  const visible = useMemo(() => sectionsFor(os), [os]);
  const mainRef = useRef<HTMLElement>(null);

  const [section, setSection] = useState<string>(() =>
    resolveSection(
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("section")
        : null,
      os
    )
  );
  const [revealRow, setRevealRow] = useState<{ label: string; nonce: number } | null>(null);
  const [activePart, setActivePart] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [version, setVersion] = useState<string>("");
  const {
    update,
    check: checkUpdate,
    install: installUpdate,
    dismiss: dismissUpdate,
    openPage: openUpdatePage,
  } = useUpdateState();
  const updateBadge = useMemo(() => hasPendingBadge(update), [update]);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  const [secId, spot] = section.split("/");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.platform = os === "macos" ? "macos" : "windows";
    const effective = resolveTheme(theme, systemDark);
    root.classList.toggle("dark", effective === "dark");
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute("content", effective);
    }
  }, [os, theme, systemDark]);

  useEffect(() => {
    let alive = true;
    notch.getSettings().then((s) => {
      if (alive && s) setSettings(s);
    });
    notch.version().then((v) => {
      if (alive && v) setVersion(v);
    });
    const unsubSettings = notch.onSettings((s) => {
      if (alive && s) setSettings(s);
    });
    const unsubSection = notch.onSettingsSection((id) => {
      if (alive) {
        setRevealRow(null);
        setActivePart(null);
        setSection(resolveSection(id, os));
      }
    });
    return () => {
      alive = false;
      unsubSettings();
      unsubSection();
    };
  }, [os]);

  // Spot deep-link scroll + flash (e.g. openSettings('pomodoro/timer'))
  useEffect(() => {
    if (!spot) return;
    const timer = window.setTimeout(() => {
      const root = mainRef.current;
      if (!root) return;
      const target = root.querySelector<HTMLElement>(`[data-spot="${CSS.escape(spot)}"]`);
      const card = target?.closest("section");
      if (!card) return;
      card.scrollIntoView({ block: "start", behavior: "smooth" });
      card.querySelectorAll<HTMLElement>("[data-row-label]").forEach(flashElement);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [secId, spot]);

  // Search hit row scroll + flash
  useEffect(() => {
    if (!revealRow) return;
    const timer = window.setTimeout(() => {
      const root = mainRef.current;
      if (!root) return;
      const target = Array.from(
        root.querySelectorAll<HTMLElement>("[data-row-label]")
      ).find((el) => el.dataset.rowLabel === revealRow.label);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      flashElement(target);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [secId, revealRow]);

  const handleThemeChange = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const handlePatch = useCallback(async (patch: Settings) => {
    const updated = await notch.setSettings(patch);
    if (updated) setSettings(updated);
    return updated;
  }, []);

  const handleSelectSection = useCallback(
    (id: string, opts?: { row?: string; part?: string }) => {
      setSection(resolveSection(id, os));
      setActivePart(opts?.part ?? null);
      if (opts?.row) {
        setRevealRow({ label: opts.row, nonce: Date.now() });
      } else {
        setRevealRow(null);
      }
      if (!opts?.row && mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    },
    [os]
  );

  const activeSection = useMemo(
    () => visible.find((s) => s.id === secId) ?? visible[0],
    [visible, secId]
  );

  const body = BODIES[activeSection.id];

  return (
    <div
      className="grid h-screen w-screen grid-cols-[236px_minmax(0,1fr)] gap-2 overflow-hidden p-2"
      style={{ background: "var(--shell-bg)" }}
    >
      <Sidebar
        os={os}
        version={version}
        activeId={activeSection.id}
        onSelect={handleSelectSection}
        theme={theme}
        onThemeChange={handleThemeChange}
        updateBadge={updateBadge}
      />

      <div
        className="flex min-h-0 flex-col overflow-hidden border border-border"
        style={{
          background: "var(--pane-bg)",
          borderRadius: "var(--pane-radius)",
        }}
      >
        <header
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/80 px-5 select-none"
        >
          <div
            data-tauri-drag-region
            className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-muted-foreground"
          >
            <SectionIcon
              name={activeSection.icon}
              className="size-3.5 shrink-0 opacity-80"
            />
            <span className="shrink-0">{t("Settings")}</span>
            <span className="shrink-0 opacity-40">/</span>
            <span className="truncate text-foreground">
              {t(activeSection.title)}
            </span>
          </div>
        </header>

        <UpdateBanner
          update={update}
          onInstall={() => void installUpdate()}
          onDismiss={() => void dismissUpdate()}
          onRetry={() => void checkUpdate(false)}
          onOpenPage={() => void openUpdatePage()}
        />

        <main ref={mainRef} className="kn-scroll flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex max-w-[740px] flex-col gap-5">
            <SectionHeader section={activeSection} />
            {body ? (
              body.render ? (
                <body.render
                  settings={settings}
                  set={handlePatch}
                  os={os}
                  part={activePart}
                  onNavigate={handleSelectSection}
                />
              ) : (
                <Rows
                  sectionId={activeSection.id}
                  rows={body.rows ?? []}
                  customs={body.customs}
                  settings={settings}
                  set={handlePatch}
                  os={os}
                  part={activePart}
                  onNavigate={handleSelectSection}
                />
              )
            ) : (
              <Placeholder />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <SettingsShell />
    </ToastProvider>
  );
}
