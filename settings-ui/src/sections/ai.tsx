import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, CalendarDays, Globe, Info, Lock, Plus, RefreshCw, Send, Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/knowns/badge";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { StatusDot } from "@/components/ui/knowns/status-dot";
import { Switch } from "@/components/ui/knowns/switch";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { useAgents } from "@/lib/agents";
import { SkeletonCard } from "@/components/ui/knowns/skeleton";
import { cn } from "@/lib/knowns/utils";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { SkillsManager } from "./pony/SkillsManager";
import { MemoryList } from "./pony/MemoryList";
import { ServerBrain } from "./pony/ServerBrain";
import { BrainChoice, PonyHands, SymponyAi, SymponyWeb, type BrainMode } from "./pony/Brain";
import { PersonaTemplates } from "./pony/PersonaTemplates";
import { McpServers } from "./pony/McpServers";
import { PonyEyes } from "./pony/Eyes";
import { PonyAskAi } from "./pony/AskAi";
import { Ability, AbilityGroup } from "./pony/Ability";

export interface AgentInfo {
  id: string;
  name: string;
  icon?: string;
  path?: string;
  version?: string;
  install?: string;
  installed?: boolean;
  signedIn?: boolean;
  update?: boolean;
  supported?: boolean;
  responding?: boolean;
  tools?: boolean;
}

interface PonyHandle {
  setMood: (m: string) => void;
  setLook: (shape?: string, color?: string) => void;
  lookAt: (x: number, y: number) => void;
  hop: (power?: number) => void;
  poke: () => void;
  destroy: () => void;
}

interface WindowWithPony extends Window {
  Pony?: {
    mount: (
      canvas: HTMLCanvasElement,
      opts?: { scale?: number; shape?: string; color?: string; mood?: string; floorFrac?: number }
    ) => PonyHandle | null;
    SHAPES: string[];
    COLORS: string[];
    COLOR_STOPS: Record<string, [string, string, string]>;
  };
}

const PONY_DEFAULTS = {
  shape: "Classic",
  color: "Lavender",
  name: "Pony",
  persona: "friendly",
} as const;

function ponyDefaults(settings: CustomPartProps["settings"]) {
  // (Pony's own check: a look saved before the 2026-11 character falls back to its defaults)
  const look = typeof window !== "undefined" ? (window as unknown as { Pony?: { look: (s: unknown) => { shape: string; color: string } } }).Pony?.look(settings) : undefined;
  return {
    shape: look?.shape ?? String(settings.ponyShape || PONY_DEFAULTS.shape),
    color: look?.color ?? String(settings.ponyColor || PONY_DEFAULTS.color),
    name: String(settings.ponyName || PONY_DEFAULTS.name),
    persona: String(settings.ponyPersona || PONY_DEFAULTS.persona),
    personaText: String(settings.ponyPersonaText || ""),
  };
}

const DEFAULT_SHAPES = ["Classic", "Soft", "Pro"];
const SHAPE_LABELS: Record<string, string> = {
  Classic: "Classic",
  Soft: "Fluffy",
  Pro: "Headset",
};
// (the fringe's colour)
const DEFAULT_COLORS: Record<string, [string, string, string]> = {
  Lavender: ["#c6bbff", "#8f7bff", "#5a42df"],
  Berry: ["#ffc6e3", "#f06fb4", "#b8357f"],
  Mint: ["#bff5df", "#4fcfa3", "#1d9672"],
  Sky: ["#c6e6ff", "#5aaef7", "#2c6fd0"],
  Peach: ["#ffd8c2", "#ff9a6b", "#d4602f"],
  Midnight: ["#9096bd", "#43486e", "#1f2140"],
};

function PonyAppearance({
  settings,
  set,
}: {
  settings: CustomPartProps["settings"];
  set: CustomPartProps["set"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<PonyHandle | null>(null);
  const { shape, color } = ponyDefaults(settings);
  const ponyGlobal = (typeof window !== "undefined" ? (window as WindowWithPony).Pony : undefined);
  const shapes = ponyGlobal?.SHAPES ?? DEFAULT_SHAPES;
  const colorStops = ponyGlobal?.COLOR_STOPS ?? DEFAULT_COLORS;
  const colors = ponyGlobal?.COLORS ?? Object.keys(colorStops);

  useEffect(() => {
    const cv = canvasRef.current;
    const pony = (window as WindowWithPony).Pony;
    if (!cv || !pony) return;
    const h = pony.mount(cv, { scale: 0.72, shape, color, floorFrac: 0.8 });
    handleRef.current = h;
    return () => {
      h?.destroy();
      handleRef.current = null;
    };
    // Mount once; updates flow through setLook below so shape morphs smoothly via spring
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setLook(shape, color);
  }, [shape, color]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-[12px] border border-border bg-[#0f1017] py-3">
        <canvas
          ref={canvasRef}
          width={220}
          height={124}
          onClick={() => handleRef.current?.poke()}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            handleRef.current?.lookAt(
              (e.clientX - r.left - r.width / 2) / (r.width * 0.35),
              (e.clientY - r.top - r.height * 0.45) / (r.height * 0.45)
            );
          }}
          className="h-[124px] w-[220px] cursor-pointer"
        />
        <span className="text-[11px] text-white/55">{t("Click Pony to poke")}</span>
      </div>

      <div className="divide-y divide-border/80">
        <div className="pb-3" data-k="ponyFace">
          <SettingsRow
            label={t("Show eyes in closed notch")}
            description={t("Glowing eyes beside the camera when Sympony is idle")}
          >
            <Switch
              checked={settings.ponyFace !== false}
              aria-label={t("Show eyes in closed notch")}
              onCheckedChange={(checked) => void set({ ponyFace: checked })}
            />
          </SettingsRow>
        </div>

        <div className="py-3" data-k="ponyPeek">
          <SettingsRow
            label={t("Peek below notch")}
            description={t("Pony peeks out when your cursor nears the notch, or on done and attention")}
          >
            <Switch
              checked={settings.ponyPeek !== false}
              aria-label={t("Peek below notch")}
              onCheckedChange={(checked) => void set({ ponyPeek: checked })}
            />
          </SettingsRow>
        </div>

        <div className="py-3" data-k="ponyShape">
          <SettingsRow label={t("Shape")}>
            <div className="flex flex-wrap justify-end gap-1.5">
              {shapes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void set({ ponyShape: s })}
                  className={cn(
                    "cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                    shape === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(SHAPE_LABELS[s] ?? s)}
                </button>
              ))}
            </div>
          </SettingsRow>
        </div>

        <div className="pt-3" data-k="ponyColor">
          <SettingsRow label={t("Color")}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {colors.map((c) => {
                const stops = colorStops[c] ?? DEFAULT_COLORS.Lavender;
                const label = t(c);
                return (
                  <button
                    key={c}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={color === c}
                    onClick={() => void set({ ponyColor: c })}
                    className={cn(
                      "size-6.5 cursor-pointer rounded-full border-2 transition-transform hover:scale-105",
                      color === c
                        ? "border-primary ring-2 ring-primary/35"
                        : "border-transparent"
                    )}
                    style={{
                      background: `radial-gradient(circle at 35% 30%, ${stops[0]}, ${stops[1]} 55%, ${stops[2]})`,
                    }}
                  />
                );
              })}
            </div>
          </SettingsRow>
        </div>
      </div>
    </div>
  );
}

interface BriefEntry {
  id: string;
  on?: boolean;
  time?: string;
  days?: number[];
  text?: string;
}

const DAY_KEYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function isUsable(a: AgentInfo): boolean {
  return Boolean(
    a.installed && !a.update && a.supported !== false && a.responding !== false
  );
}

function agentStatus(a: AgentInfo): { tone: "ok" | "warn" | "off"; label: string } {
  if (!a.installed) return { tone: "off", label: t("Not installed") };
  if (a.supported === false) return { tone: "off", label: t("Not supported yet") };
  if (a.responding === false) return { tone: "warn", label: t("Not responding") };
  if (a.update) return { tone: "warn", label: t("Needs an update") };
  return a.signedIn
    ? { tone: "ok", label: t("Ready") }
    : { tone: "warn", label: t("Sign in first") };
}

function BriefsList({
  settings,
  set,
}: {
  settings: CustomPartProps["settings"];
  set: CustomPartProps["set"];
}) {
  const list: BriefEntry[] = Array.isArray(settings.chatBriefs)
    ? (settings.chatBriefs as BriefEntry[]).map((b) => ({
        ...b,
        days: Array.isArray(b.days) ? [...b.days] : [],
      }))
    : [];

  const save = (next: BriefEntry[]) => void set({ chatBriefs: next });

  return (
    <div className="divide-y divide-border/80" data-k="chatBriefs">
      {list.map((b, i) => {
        const days = b.days ?? [];
        return (
          <div key={b.id || i} className="flex flex-col gap-2.5 py-3 first:pt-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <Switch
                checked={b.on !== false}
                aria-label={t("On")}
                onCheckedChange={(checked) => {
                  const next = list.slice();
                  next[i] = { ...b, on: checked };
                  save(next);
                }}
              />
              <input
                type="time"
                value={b.time || "07:30"}
                aria-label={t("Time")}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const next = list.slice();
                  next[i] = { ...b, time: e.target.value };
                  save(next);
                }}
                className="h-7.5 w-28 rounded-[var(--control-radius)] border border-input bg-background px-2 text-[12.5px] tabular-nums text-foreground"
              />
              <div className="flex items-center gap-1">
                {DAY_KEYS.map((dayName, n) => {
                  const fullName = t(dayName);
                  const letter = fullName.charAt(0).toUpperCase();
                  const on = days.includes(n);
                  return (
                    <button
                      key={dayName}
                      type="button"
                      title={fullName}
                      aria-label={fullName}
                      aria-pressed={on}
                      onClick={() => {
                        const nextDays = on
                          ? days.filter((x) => x !== n)
                          : [...days, n].sort((x, y) => x - y);
                        const next = list.slice();
                        next[i] = { ...b, days: nextDays };
                        save(next);
                      }}
                      className={cn(
                        "grid size-6.5 cursor-pointer place-items-center rounded-full text-[11px] font-medium transition-colors",
                        on
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              <div className="ms-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  icon={<Send />}
                  title={t("Ask it now")}
                  onClick={() => {
                    const txt = (b.text || "").trim();
                    if (txt) void notch.svc("brief", "now", txt);
                  }}
                >
                  {t("Try")}
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  icon={<Trash2 />}
                  title={t("Remove")}
                  aria-label={t("Remove")}
                  onClick={() => save(list.filter((_, idx) => idx !== i))}
                />
              </div>
            </div>
            <input
              type="text"
              defaultValue={b.text || ""}
              placeholder={t("What to ask, e.g. Brief me on today")}
              aria-label={t("What to ask, e.g. Brief me on today")}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val === (b.text || "")) return;
                const next = list.slice();
                next[i] = { ...b, text: val };
                save(next);
              }}
              className="h-8 w-full rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </div>
        );
      })}

      <div className="pt-3 first:pt-0">
        <SettingsRow
          label={
            list.length
              ? t("Another one, e.g. a wrap-up in the evening")
              : t("A brief every morning, a wrap-up in the evening…")
          }
        >
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus />}
            onClick={() => {
              const next: BriefEntry = {
                id: Date.now().toString(36),
                on: true,
                time: list.length ? "18:00" : "07:30",
                days: [1, 2, 3, 4, 5],
                text: list.length
                  ? "Wrap up my day: what got done, what is still open, and what is on tomorrow."
                  : "Brief me on today: my events, open todos, the weather and prayer times. Short and friendly.",
              };
              save([...list, next]);
            }}
          >
            {t("Add a brief")}
          </Button>
        </SettingsRow>
      </div>
    </div>
  );
}

/** The page's tabs: one subject each, so nothing gets long (outside tools join Abilities). */
const PONY_TABS = [
  { id: "brain", label: "Brain", icon: "Brain" },
  { id: "abilities", label: "Abilities", icon: "Abilities" },
  { id: "persona", label: "Persona", icon: "Persona" },
  { id: "look", label: "Appearance", icon: "Appearance" },
  { id: "skills", label: "Skills", icon: "Skills" },
  { id: "memory", label: "Memory", icon: "Memory" },
  { id: "briefs", label: "Briefs", icon: "Scheduled briefs" },
] as const;
type PonyTab = (typeof PONY_TABS)[number]["id"];
const TAB_KEY = "sympony.ponyTab";
const isTab = (x: unknown): x is PonyTab => PONY_TABS.some((p) => p.id === x);

/** Abilities → Other agents: how Pony reaches coding agents (Paseo, else Claude Code), read-only. */
function OtherAgents() {
  const [info, setInfo] = useState<{ paseo?: boolean; claude?: boolean } | null>(null);
  useEffect(() => {
    void (notch.svc("pony", "bridgeInfo") as Promise<{ paseo?: boolean; claude?: boolean }>).then((r) => setInfo(r || {})).catch(() => setInfo({}));
  }, []);
  const how = !info
    ? t("Looking for Paseo and Claude Code…")
    : info.paseo
      ? t("Starts and messages coding agents, and tells you when they finish")
      : info.claude
        ? t("Starts a coding agent in a project and tells you when it finishes")
        : t("Install Paseo or Claude Code to let Pony hand work to coding agents.");
  const via = info?.paseo ? "Paseo" : info?.claude ? "Claude Code" : "";
  return (
    <Ability
      k="ponyAgents"
      icon="Bot"
      tone="indigo"
      title={t("Other agents")}
      summary={how}
      tryIt={via ? [t("have the agent in Sympony fix the build")] : undefined}
      control={
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <StatusDot tone={via ? "success" : "neutral"} label={false} />
          {via || t("Not found")}
        </span>
      }
    />
  );
}

/** A tab's one-line intro, above its card. */
function TabLead({ text }: { text: string }) {
  return <p className="-mb-2 px-1 text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>;
}

function PonyTabs({ tab, onTab }: { tab: PonyTab; onTab: (t: PonyTab) => void }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = PONY_TABS[(i + d + PONY_TABS.length) % PONY_TABS.length].id;
    onTab(next);
    document.getElementById(`pony-tab-${next}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("Pony Assistant")}
      className="sticky -top-6 z-20 -mx-1 flex gap-0.5 overflow-x-auto border-b border-border/80 px-1 pt-1 [scrollbar-width:none]"
      style={{ background: "var(--pane-bg)" }}
    >
      {PONY_TABS.map((p, i) => {
        const on = p.id === tab;
        return (
          <button
            key={p.id}
            id={`pony-tab-${p.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`pony-panel-${p.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onTab(p.id)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[8px] px-2.5 pt-1.5 pb-2.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground [&>span:first-child]:opacity-80"
            )}
          >
            <span className="grid size-5 place-items-center rounded-[6px] [&_svg]:size-3.5">{groupIcon(p.icon)}</span>
            {t(p.label)}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary transition-opacity",
                on ? "opacity-100" : "opacity-0"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function AiSection({ settings, set, part }: CustomPartProps) {
  // (the tab: a search hit's, else the last one open in this window, else Brain)
  const [tab, setTab] = useState<PonyTab>(() => {
    if (isTab(part)) return part;
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (isTab(saved)) return saved;
    } catch {
      /* ignore */
    }
    return "brain";
  });
  useEffect(() => {
    if (isTab(part)) setTab(part);
  }, [part]);
  const tabsTop = useRef<HTMLDivElement | null>(null);
  const pick = (next: PonyTab) => {
    setTab(next);
    try {
      sessionStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignore */
    }
    // (a new tab starts at its top, the tabs still in view)
    const main = tabsTop.current?.closest("main");
    const anchor = tabsTop.current;
    if (main && anchor && main.scrollTop > anchor.offsetTop) main.scrollTop = anchor.offsetTop;
  };
  // (the page shows at once; only the agents' cards wait, as skeletons, for the first check of the CLIs)
  const { agents, loading, refresh } = useAgents();

  const list = agents ?? [];
  const usable = list.filter(isUsable);
  const ready = usable.filter((a) => a.signedIn);
  const chatId = String(settings.chatAgent || ready[0]?.id || "");
  const trId = String(settings.translateAgent || "");
  const chat = list.find((a) => a.id === chatId);
  const models =
    settings.agentModels && typeof settings.agentModels === "object"
      ? (settings.agentModels as Record<string, string>)
      : {};

  const renderHelp = (a: AgentInfo) => {
    if (!a.installed) {
      return (
        <button
          type="button"
          onClick={() => a.install && void notch.openExternal(a.install)}
          className="cursor-pointer text-primary underline underline-offset-2"
        >
          {t("How to install {name}", { name: a.name })}
        </button>
      );
    }
    if (a.responding === false) {
      return t(
        "{name} didn’t answer when Sympony checked it. Run it once in Terminal (it may want you to sign in or update), then Refresh.",
        { name: a.name }
      );
    }
    if (a.supported === false) {
      return t(
        "{name} has no read-only mode Sympony can rely on yet, so it isn’t used.",
        { name: a.name }
      );
    }
    if (a.update) {
      return t(
        "This {name} is too old to answer for Sympony: update it, then Refresh.",
        { name: a.name }
      );
    }
    if (!a.signedIn) {
      const cmd = (a.path || "").split("/").pop() || a.id;
      const msg = t("Open Terminal, run <code>{cmd}</code> once and sign in, then Refresh.", {
        cmd,
      });
      const parts = msg.split(/(<code>[\s\S]*?<\/code>)/g);
      return parts.map((p, idx) => {
        const m = /^<code>([\s\S]*?)<\/code>$/.exec(p);
        return m ? (
          <code
            key={idx}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground"
          >
            {m[1]}
          </code>
        ) : (
          <span key={idx}>{p}</span>
        );
      });
    }
    return null;
  };

  const chatHelp = chat ? renderHelp(chat) : null;
  const mode: BrainMode = settings.ponyBrain === "sympony" || settings.ponyBrain === "api" ? settings.ponyBrain : "agent";
  const api = mode !== "agent";
  const { name: ponyName, persona: ponyPersona, personaText: ponyPersonaText } = ponyDefaults(settings);

  const tabBody: Record<PonyTab, ReactNode> = {
    brain: (
      <>
      <TabLead text={t("Where Pony thinks, and with which account")} />
      <PanelCard>
        <div className="flex flex-col gap-4">
          <div data-k="ponyBrain">
            <BrainChoice value={mode} onChange={(m) => void set({ ponyBrain: m })} />
          </div>
          {mode === "sympony" && <SymponyAi settings={settings} set={set} />}
          {mode === "api" && <ServerBrain settings={settings} set={set} />}
          {!api && (
          <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t(
              "Pony and Translate answer through an AI agent already on this Mac, with your own sign-in and plan: no API keys. Pick one below."
            )}
          </p>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted-foreground">
              {agents === null
                ? t("Looking for AI agents on this Mac…")
                : ready.length
                ? t("{n} ready on this Mac", { n: ready.length })
                : t("None ready yet: install one and sign in")}
            </span>
            <Button
              size="xs"
              variant="secondary"
              disabled={loading}
              icon={<RefreshCw className={loading ? "animate-spin" : undefined} />}
              onClick={refresh}
            >
              {t("Refresh")}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {agents === null && [0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
            {list.map((a) => {
              const ok = isUsable(a);
              const selected = a.id === chatId && ok;
              const st = agentStatus(a);
              const roles = [
                selected ? t("Pony") : "",
                (trId ? a.id === trId : a.id === chatId) && ok ? t("Translate") : "",
              ].filter(Boolean);
              const isMono = a.icon ? !/-color$/.test(a.icon) : true;
              const ver = a.installed && a.version ? a.version.replace(/\s*\(.*\)$/, "") : "";

              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    if (ok) void set({ chatAgent: a.id });
                    else if (!a.installed && a.install) void notch.openExternal(a.install);
                  }}
                  className={cn(
                    "panel-surface flex cursor-pointer items-center gap-3 border p-3 text-start transition-colors",
                    selected
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-border hover:bg-muted/40",
                    !ok && "opacity-60"
                  )}
                  style={{ borderRadius: "var(--card-radius)" }}
                >
                  <div className="card-ico-well grid size-9 shrink-0 place-items-center rounded-[9px]">
                    <img
                      src={`./ai-icons/${a.icon || "openai"}.svg`}
                      alt=""
                      className={cn("size-5 object-contain", isMono && "dark:invert")}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {a.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {a.supported !== false && (
                          <Badge size="sm" variant="soft">
                            {a.tools ? t("✓ tools") : t("actions only")}
                          </Badge>
                        )}
                        {roles.map((r) => (
                          <Badge key={r} size="sm" variant="soft">
                            {r}
                          </Badge>
                        ))}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <StatusDot
                        tone={
                          st.tone === "ok"
                            ? "success"
                            : st.tone === "warn"
                              ? "warning"
                              : "neutral"
                        }
                      />
                      <span className="truncate">
                        {st.label}
                        {ver ? ` · ${ver}` : ""}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {chatHelp && (
            <div className="flex items-start gap-2 rounded-[10px] border border-border bg-muted/40 px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-foreground/70" aria-hidden="true" />
              <div>{chatHelp}</div>
            </div>
          )}

          <div className="divide-y divide-border/80">
            <div className="pb-3" data-k="chatAgent">
              <SettingsRow label={t("Pony uses")}>
                <select
                  aria-label={t("Pony uses")}
                  value={chatId}
                  onChange={(e) => void set({ chatAgent: e.target.value })}
                  className="h-8 min-w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                >
                  {usable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.signedIn ? "" : ` (${t("not signed in")})`}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            </div>

            <div className="py-3" data-k="translateAgent">
              <SettingsRow
                label={t("Translate uses")}
                description={t("Also the lyrics’ romanization and translation")}
              >
                <select
                  aria-label={t("Translate uses")}
                  value={trId}
                  onChange={(e) => void set({ translateAgent: e.target.value })}
                  className="h-8 min-w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                >
                  <option value="">{t("Same as Pony")}</option>
                  {usable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.signedIn ? "" : ` (${t("not signed in")})`}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            </div>

            {chat && (
              <div className="py-3" data-k="agentModels">
                <SettingsRow
                  label={t("Model for {name}", { name: chat.name })}
                  description={t(
                    "Empty: the agent’s own default. Any model name it knows (e.g. opus, gpt-5, gemini-3-pro)."
                  )}
                >
                  <input
                    key={chat.id}
                    type="text"
                    defaultValue={models[chat.id] || ""}
                    placeholder={t("default")}
                    aria-label={t("Model for {name}", { name: chat.name })}
                    onBlur={(e) =>
                      void set({
                        agentModels: { ...models, [chat.id]: e.target.value.trim() },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="h-8 w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                  />
                </SettingsRow>
              </div>
            )}

          </div>
          </>
          )}


          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <p>
              {t(
                mode === "sympony"
                  ? "Your messages, persona, active skills, memory facts, and tool results go to Sympony AI with your account. Everything else stays in ~/.sympony on this Mac."
                  : api
                  ? "Your messages, persona, active skills, memory facts, and tool results go to the AI server above, with your account. Everything else stays in ~/.sympony on this Mac."
                  : "Your messages, persona, active skills, memory facts, and tool results go to the chosen AI CLI under your own account. Everything stays in ~/.sympony on this Mac."
              )}
            </p>
          </div>
        </div>
      </PanelCard>
      </>
    ),
    abilities: (
      <>
      <TabLead text={t("Turn on what Pony may do for you. Each one shows something you can say to it.")} />
      <AbilityGroup title={t("What Pony knows")} hint={t("so its answers fit you")}>
        {mode === "sympony" && settings.has_symponyAiKey ? <SymponyWeb settings={settings} set={set} /> : null}
        {mode === "agent" && (
          <Ability
            k="chatWebSearch"
            icon="Globe"
            tone="sky"
            title={t("Search the web")}
            summary={t("With Claude Code, its own web search; the other agents search when they see fit.")}
            tryIt={[t("AI news today")]}
            control={<Switch checked={Boolean(settings.chatWebSearch)} aria-label={t("Search the web")} onCheckedChange={(checked) => void set({ chatWebSearch: checked })} />}
          />
        )}
        <Ability
          k="chatContext"
          icon="CalendarDays"
          tone="amber"
          title={t("Knows your day")}
          summary={t("Your calendar, todos, weather and your Mac go along with each message")}
          tryIt={[t("what's on today?"), t("am I free at 3?")]}
          control={<Switch checked={settings.chatContext !== false} aria-label={t("Knows your day")} onCheckedChange={(checked) => void set({ chatContext: checked })} />}
        />
      </AbilityGroup>
      <AbilityGroup title={t("On your screen")} hint={t("the window you're looking at")}>
        <PonyEyes settings={settings} set={set} />
        <PonyAskAi settings={settings} set={set} />
      </AbilityGroup>
      <AbilityGroup title={t("On your Mac")} hint={t("work Pony does or hands off")}>
        {api ? (
          <PonyHands settings={settings} set={set} />
        ) : (
          <p className="px-4 py-3.5 text-[12px] leading-relaxed text-muted-foreground">
            {t("Commands & files work when Pony thinks with Sympony AI or your own server (Brain tab).")}
          </p>
        )}
        <OtherAgents />
      </AbilityGroup>
      <McpServers settings={settings} set={set} api={api} />
      </>
    ),
    persona: (
      <>
      <TabLead text={t("Pony’s name and how it talks to you")} />
      <PanelCard>
        <div className="divide-y divide-border/80">
          <div className="pb-3" data-k="ponyName">
            <SettingsRow label={t("Name")}>
              <input
                type="text"
                defaultValue={ponyName}
                key={ponyName}
                aria-label={t("Name")}
                maxLength={40}
                placeholder="Pony"
                onBlur={(e) => {
                  const val = e.target.value.trim() || "Pony";
                  if (val !== ponyName) void set({ ponyName: val });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-8 w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
              />
            </SettingsRow>
          </div>

          <div className="py-3" data-k="ponyPersona">
            <SettingsRow label={t("Style")}>
              <SegmentedControl
                size="sm"
                aria-label={t("Style")}
                value={ponyPersona}
                onValueChange={(v) => void set({ ponyPersona: v })}
                options={[
                  { value: "friendly", label: t("Friendly") },
                  { value: "focused", label: t("Focused") },
                  { value: "playful", label: t("Playful") },
                  { value: "custom", label: t("Custom") },
                ]}
              />
            </SettingsRow>
          </div>

          <div className="py-3" data-k="ponyPersonaTemplates">
            <PersonaTemplates
              persona={ponyPersona}
              text={ponyPersonaText}
              onApply={(style, text) => void set({ ponyPersona: style, ponyPersonaText: text })}
            />
          </div>

          <div className="flex flex-col gap-1.5 pt-3" data-k="ponyPersonaText">
            <div className="flex items-center justify-between">
              <label
                htmlFor="pony-persona-text"
                className="text-[13px] font-medium text-foreground"
              >
                {t("Extra instructions")}
              </label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {[...ponyPersonaText].length} / 2000
              </span>
            </div>
            <textarea
              id="pony-persona-text"
              rows={5}
              maxLength={2000}
              defaultValue={ponyPersonaText}
              key={ponyPersonaText}
              placeholder={t("For example:\nCall me Dina.\nUse relaxed, everyday language.\nAnswer briefly; use bullet points for more than 3 things.\nDon't use emoji.")}
              onBlur={(e) => {
                const val = e.target.value.slice(0, 2000);
                if (val !== ponyPersonaText) void set({ ponyPersonaText: val });
              }}
              className="w-full resize-y rounded-[var(--control-radius)] border border-input bg-background px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {t("Write it like a note to a new assistant: what to call you, which language, how long answers should be, and what to avoid. One line each is enough.")}
            </p>
          </div>
        </div>
      </PanelCard>
      </>
    ),
    look: (
      <>
      <TabLead text={t("How Pony looks in the notch")} />
      <PanelCard>
        <PonyAppearance settings={settings} set={set} />
      </PanelCard>
      </>
    ),
    skills: (
      <>
      <TabLead text={t("Instructions Pony follows for a kind of task")} />
      <SkillsManager settings={settings} set={set} />
      </>
    ),
    memory: (
      <>
      <TabLead text={t("What Pony remembers about you between chats")} />
      <PanelCard>
        <div className="mb-3 border-b border-border/80 pb-3" data-k="ponyLearn">
          <SettingsRow
            label={t("Learn from chats")}
            description={t("After a few messages Pony notes lasting things you said, like how you like answers. They show here marked Learned; edit or forget any.")}
          >
            <Switch
              checked={settings.ponyLearn !== false}
              aria-label={t("Learn from chats")}
              onCheckedChange={(checked) => void set({ ponyLearn: checked })}
            />
          </SettingsRow>
        </div>
        <MemoryList />
      </PanelCard>
      </>
    ),
    briefs: (
      <>
      <TabLead text={t("On the days and at the time you pick, Sympony asks Pony your message by itself and opens Pony with the answer. If the Mac was asleep, the brief comes when it wakes, up to an hour late.")} />
      <PanelCard>
        <BriefsList settings={settings} set={set} />
      </PanelCard>
      </>
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <div ref={tabsTop} aria-hidden="true" className="-mb-4 h-0" />
      <PonyTabs tab={tab} onTab={pick} />
      <div role="tabpanel" id={`pony-panel-${tab}`} aria-labelledby={`pony-tab-${tab}`} key={tab} className="flex flex-col gap-5 animate-[kn-fade-in_180ms_ease-out] motion-reduce:animate-none">
        {tabBody[tab]}
      </div>
    </div>
  );
}

export const ai: SectionBody = {
  id: "ai",
  render: AiSection,
};
