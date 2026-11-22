import { useEffect, useRef, useState } from "react";
import { Cpu, ExternalLink, Eye, Globe, KeyRound, TerminalSquare, LogIn, LogOut, MessageCircleHeart, Server, Sparkles, Wand2, Zap } from "@/components/icons";
import { Aurora } from "@/components/ui/knowns/blocks/backgrounds/aurora";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Skeleton } from "@/components/ui/knowns/skeleton";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { cn } from "@/lib/knowns/utils";
import type { CustomPartProps } from "@/rows/types";
import { Ability } from "./Ability";

type Props = Pick<CustomPartProps, "settings" | "set">;
export type BrainMode = "sympony" | "agent" | "api";

interface PonyHandle {
  setMood: (m: string) => void;
  lookAt: (x: number, y: number) => void;
  poke: () => void;
  destroy: () => void;
}
type PonyGlobal = {
  mount: (c: HTMLCanvasElement, o: Record<string, unknown>) => PonyHandle | null;
};

interface ServerModel {
  id: string;
  display_name?: string;
  description?: string;
  default?: boolean;
  context_window?: number;
  capabilities?: { vision?: boolean };
}
interface Me {
  plan?: string;
  quota?: { unit?: string; period?: string; used?: number; limit?: number | null; resets_at?: string };
  dashboard_url?: string;
  features?: { web_search?: boolean; web_fetch?: boolean };
  web?: { searches_used?: number; searches_limit?: number | null; fetches_used?: number; fetches_limit?: number | null };
}
interface Account {
  email?: string;
  name?: string;
  picture?: string;
  plan?: string;
}

const lang = () => (typeof window !== "undefined" && (window as { SYMPONY_LANG?: string }).SYMPONY_LANG) || undefined;

/** Pony's three possible brains, as one choice. */
export function BrainChoice({ value, onChange }: { value: BrainMode; onChange: (m: BrainMode) => void }) {
  const options: { id: BrainMode; icon: typeof Sparkles; title: string; text: string }[] = [
    { id: "sympony", icon: Sparkles, title: t("Sympony AI"), text: t("Ready after one sign-in, nothing to install") },
    { id: "agent", icon: Cpu, title: t("An agent on this Mac"), text: t("Claude Code, Codex… with your own plan") },
    { id: "api", icon: Server, title: t("Your own server"), text: t("Any OpenAI-compatible server and key") },
  ];
  return (
    <div role="radiogroup" aria-label={t("Pony thinks with")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const on = o.id === value;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`brain-${o.id}`}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              on ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "border-border hover:bg-muted/40"
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-foreground">{o.title}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{o.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The plan's usage: the notch's meter colours (amber from 70 %, red from 90 %). */
function Quota({ q, plan }: { q: NonNullable<Me["quota"]>; plan: string }) {
  const used = q.used ?? 0;
  const limit = q.limit ?? 0; // (null: no limit for this user)
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const nf = new Intl.NumberFormat(lang(), { notation: "compact", maximumFractionDigits: 1 });
  // (a reset within a day: a daily quota, told as "today" and the time it resets)
  const at = q.resets_at ? new Date(q.resets_at) : null;
  const daily = q.period === "day" || (!!at && at.getTime() - Date.now() <= 24 * 3600e3);
  const reset = !at
    ? ""
    : daily
      ? t("Resets at {time}", { time: at.toLocaleTimeString(lang(), { hour: "2-digit", minute: "2-digit" }) })
      : t("Resets {date}", { date: at.toLocaleDateString(lang(), { day: "numeric", month: "long" }) });
  const tone = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-border px-4 py-3" data-testid="sympony-quota">
      <div className="shrink-0 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">{limit ? `${pct}%` : "∞"}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="truncate text-foreground">
            {limit
              ? t(daily ? "{used} of {limit} {unit} used today" : "{used} of {limit} {unit} used", { used: nf.format(used), limit: nf.format(limit), unit: t(q.unit || "tokens") })
              : t(daily ? "{used} {unit} used today, no limit" : "{used} {unit} used, no limit", { used: nf.format(used), unit: t(q.unit || "tokens") })}
            {plan ? <span className="text-muted-foreground"> · {t("{plan} plan", { plan })}</span> : null}
          </span>
          {reset && <span className="shrink-0 text-[11.5px] text-muted-foreground">{reset}</span>}
        </div>
        {limit ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The notch, small, with Pony just dropped out of it: Sympony AI's mark on the stage. */
function NotchPony({ canvasRef, big, onPoke }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; big: boolean; onPoke: () => void }) {
  return (
    <div className={cn("flex shrink-0 flex-col items-center self-stretch", big ? "w-[136px]" : "w-[100px]")}>
      <div className={cn("rounded-b-[12px] bg-[#0b0b0f] shadow-[0_6px_18px_-6px_rgba(99,102,241,0.55)]", big ? "h-[20px] w-[92px]" : "h-[16px] w-[70px]")} />
      <canvas
        ref={canvasRef}
        width={big ? 136 : 100}
        height={big ? 116 : 84}
        onClick={onPoke}
        className={cn("cursor-pointer", big ? "h-[116px] w-[136px]" : "h-[84px] w-[100px]")}
        aria-hidden="true"
      />
    </div>
  );
}

/** Sympony AI: Pony under its notch on an aurora (sign in, or who is signed in), then the plan's usage and models. */
export function SymponyAi({ settings, set }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ponyRef = useRef<PonyHandle | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [models, setModels] = useState<ServerModel[] | null>(null);
  const signedIn = Boolean(settings.has_symponyAiKey);
  const account = (settings.symponyAccount || null) as Account | null;
  const chosen = String(settings.symponyModel || "");

  useEffect(() => {
    void (notch.svc("brain", "info") as Promise<{ sympony?: boolean }>).then((r) => setOpen(Boolean(r?.sympony)));
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const P = (window as { Pony?: PonyGlobal }).Pony;
    if (!cv || !P) return;
    const h = P.mount(cv, {
      scale: 0.92,
      shape: String(settings.ponyShape || "Classic"),
      color: String(settings.ponyColor || "Lavender"),
      mood: signedIn ? "happy" : "idle",
      floorFrac: 0.84,
    });
    ponyRef.current = h;
    return () => {
      h?.destroy();
      ponyRef.current = null;
    };
  }, [signedIn, settings.ponyShape, settings.ponyColor]);

  useEffect(() => {
    ponyRef.current?.setMood(waiting ? "think" : signedIn ? "happy" : err ? "attention" : "idle");
  }, [waiting, signedIn, err]);

  useEffect(() => {
    setMe(null);
    setModels(null);
    if (!signedIn) return;
    const loadMe = () =>
      void (notch.svc("brain", "me") as Promise<{ ok: boolean; me?: Me; error?: string }>).then((r) => {
        if (r.ok) setMe(r.me || {});
        else setErr(r.error || "");
      });
    loadMe();
    // live usage: again after each of Pony's answers, and every minute while Settings is in view (other Macs count too)
    const off = notch.on("brain:used", loadMe);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") loadMe();
    }, 60_000);
    const back = () => document.visibilityState === "visible" && loadMe();
    document.addEventListener("visibilitychange", back);
    void (notch.svc("brain", "models") as Promise<{ ok: boolean; models?: ServerModel[] }>).then((r) => {
      if (r.ok) setModels(r.models || []);
    });
    return () => {
      off();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  }, [signedIn]);

  const signIn = async () => {
    setErr("");
    setWaiting(true);
    const r = (await notch.svc("brain", "signIn")) as { ok: boolean; error?: string };
    setWaiting(false);
    if (!r.ok && r.error) setErr(r.error);
    if (r.ok) setTimeout(() => ponyRef.current?.setMood("done"), 50);
  };

  const look = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    ponyRef.current?.lookAt((e.clientX - r.left - 70) / (r.width * 0.35), (e.clientY - r.top - r.height / 2) / r.height);
  };

  const selected = models?.find((m) => m.id === chosen) ?? models?.find((m) => m.default) ?? models?.[0];
  const who = account?.email || account?.name || "";
  const plan = me?.plan || account?.plan || "";
  const planName = plan ? t(plan.charAt(0).toUpperCase() + plan.slice(1)) : "";
  const perks = [
    { icon: MessageCircleHeart, text: t("Chats, remembers you and uses your skills") },
    { icon: Wand2, text: t("Sets reminders, todos and music on this Mac") },
    { icon: KeyRound, text: t("No apps to install, no API keys") },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="sympony-ai">
      <Aurora
        color={["primary", "#8b5cf6", "#22d3ee"]}
        mask="none"
        speed={0.5}
        intensity={0.85}
        className="rounded-[14px] border border-border bg-card"
      >
        <div onMouseMove={look} className="flex items-stretch gap-4 pe-5" data-testid={signedIn ? "sympony-signed-in" : "sympony-signed-out"}>
          <NotchPony canvasRef={canvasRef} big={!signedIn} onPoke={() => ponyRef.current?.poke()} />
          {signedIn ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {account?.picture && (
                    <img src={account.picture} alt="" referrerPolicy="no-referrer" className="size-6 shrink-0 rounded-full ring-1 ring-border" />
                  )}
                  <span className="truncate text-[15px] font-semibold text-foreground">{who || t("Signed in")}</span>
                  {planName && (
                    <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">{planName}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted-foreground">{t("Pony thinks with Sympony AI on this Mac")}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {me?.dashboard_url && (
                  <Button size="sm" variant="secondary" icon={<ExternalLink />} onClick={() => void notch.openExternal(me.dashboard_url!)}>
                    {t("Manage account")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => void notch.svc("brain", "signOut")}>
                  {t("Sign out")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1 py-5">
              <div className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">
                {open === false ? t("Sympony AI opens soon") : t("Sign in to Sympony AI")}
              </div>
              <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-muted-foreground">
                {open === false
                  ? t("Until then, Pony can think with an agent on this Mac or your own server.")
                  : t("Pony’s own brain, made for Sympony. Your browser opens once to sign in.")}
              </p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {perks.map((p) => (
                  <li key={p.text} className="flex items-center gap-2 text-[12.5px] text-foreground/85">
                    <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-primary/10 text-primary">
                      <p.icon className="size-3.5" aria-hidden="true" />
                    </span>
                    {p.text}
                  </li>
                ))}
              </ul>
              {open !== false && (
                <div className="mt-4 flex items-center gap-3">
                  {waiting ? (
                    <>
                      <span className="text-[12.5px] text-muted-foreground">{t("Waiting for the browser…")}</span>
                      <Button size="sm" variant="secondary" onClick={() => void notch.svc("brain", "cancel")}>
                        {t("Cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="primary" icon={<LogIn />} disabled={!open} onClick={() => void signIn()} data-testid="sympony-sign-in">
                      {t("Sign in with your browser")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Aurora>

      {err && <p className="text-[12px] text-destructive">{err}</p>}

      {signedIn && me?.quota && <Quota q={me.quota} plan={planName} />}
      {/* (the plan's usage comes from the server: its shape waits for it, so nothing jumps) */}
      {signedIn && !me && !err && <Skeleton className="h-[76px] w-full" rounded="rounded-[14px]" />}

      {/* (one model, as now: nothing to pick) */}
      {signedIn && models && models.length > 1 && (
        <div className="flex flex-col gap-2" data-k="symponyModel">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-foreground">{t("Model")}</span>
            <span className="text-[11.5px] text-muted-foreground">{t("Only the models in your plan are listed.")}</span>
          </div>
          <div role="radiogroup" aria-label={t("Model")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {models.map((m) => {
              const on = m.id === selected?.id;
              const Icon = m.capabilities?.vision ? Eye : Zap;
              const nf = new Intl.NumberFormat(lang(), { notation: "compact" });
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void set({ symponyModel: m.default ? "" : m.id })}
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-[12px] border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    on ? "border-primary bg-primary/[0.05] ring-1 ring-primary/30" : "border-border hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-[9px]", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-foreground">{m.display_name || m.id}</span>
                      {m.description && <span className="block truncate text-[12px] text-muted-foreground">{m.description}</span>}
                    </span>
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-primary" : "border-muted-foreground/40")} aria-hidden="true">
                      {on && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 ps-[42px]">
                    {m.context_window ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t("{n} context", { n: nf.format(m.context_window) })}
                      </span>
                    ) : null}
                    {m.capabilities?.vision && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("Sees images")}</span>
                    )}
                    {m.default && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("Default")}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Web search on Sympony AI, with today's use from the account (the Abilities tab). */
export function SymponyWeb({ settings, set }: Props) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void (notch.svc("brain", "me") as Promise<{ ok: boolean; me?: Me }>).then((r) => r?.ok && setMe(r.me || {}));
  }, []);
  const off = me?.features?.web_search === false;
  return (
    <Ability
      k="symponyWeb"
      icon="Globe"
      tone="sky"
      title={t("Search the web")}
      summary={off ? t("Web search is off for your account") : t("Fresh news, prices and facts, with the sources")}
      meta={
        me?.web && !off
          ? t("Today: {s} searches, {p} pages", {
              s: `${me.web.searches_used ?? 0}${me.web.searches_limit != null ? `/${me.web.searches_limit}` : ""}`,
              p: `${me.web.fetches_used ?? 0}${me.web.fetches_limit != null ? `/${me.web.fetches_limit}` : ""}`,
            })
          : undefined
      }
      tryIt={[t("AI news today"), t("gold price now")]}
      control={
        <Switch
          checked={settings.symponyWeb !== false && !off}
          disabled={off}
          aria-label={t("Search the web")}
          onCheckedChange={(checked) => void set({ symponyWeb: checked })}
        />
      }
    />
  );
}

/** Commands & files (own engine): Pony runs commands and edits files like a coding agent, asking before each change. */
export function PonyHands({ settings, set }: Props) {
  const allowed = Array.isArray(settings.ponyExecAllow) ? (settings.ponyExecAllow as string[]) : [];
  const mode = settings.ponyExecMode === "yolo" ? "yolo" : "ask";
  const on = settings.ponyExec === true;
  return (
    <Ability
      k="ponyExec"
      icon="TerminalSquare"
      tone="emerald"
      title={t("Commands & files")}
      summary={t("Runs commands and edits files on this Mac, like a coding agent")}
      tryIt={[t("tidy up my Downloads folder"), t("what's using my disk?")]}
      safe={t("Never sudo, erasing disks, keys or passwords")}
      control={<Switch checked={on} aria-label={t("Commands & files")} onCheckedChange={(checked) => void set({ ponyExec: checked })} />}
    >
      {on && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3" data-k="ponyExecMode">
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
              {mode === "yolo"
                ? t("Runs everything without asking, except deleting files, which always asks.")
                : t("Asks before each command or change; anything that only looks runs right away.")}
            </span>
            <SegmentedControl
              aria-label={t("Commands & files")}
              size="sm"
              value={mode}
              options={[
                { value: "ask", label: t("Ask first") },
                { value: "yolo", label: t("YOLO") },
              ]}
              onValueChange={(v) => void set({ ponyExecMode: v })}
            />
          </div>
          {mode === "ask" && allowed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground" data-k="ponyExecAllow">
              <span>{t("Always allowed:")}</span>
              {allowed.map((a) => (
                <code key={a} className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
                  {a}
                </code>
              ))}
              <Button size="sm" variant="ghost" onClick={() => void notch.svc("pony", "execForget")}>
                {t("Forget these")}
              </Button>
            </div>
          )}
        </>
      )}
    </Ability>
  );
}
