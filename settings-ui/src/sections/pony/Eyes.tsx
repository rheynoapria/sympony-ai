import { useEffect, useState } from "react";
import { BrandIcon, X, tileStyle } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { Ability } from "./Ability";

type Props = Pick<CustomPartProps, "settings" | "set">;
type AppItem = { id: string; name: string };

/** Eyes (M3) and Hands (M4): Pony reads the window you're looking at when you ask, and can act in it. */
export function PonyEyes({ settings, set }: Props) {
  const on = settings.ponyEyes === true;
  const skip = Array.isArray(settings.ponyEyesSkip) ? (settings.ponyEyesSkip as string[]) : [];
  const [perm, setPerm] = useState<string | null>(null);
  const [screenPerm, setScreenPerm] = useState<string | null>(null);
  const [apps, setApps] = useState<{ open: AppItem[]; never: AppItem[] }>({ open: [], never: [] });

  const check = () =>
    void (notch.svc("perm", "status") as Promise<Record<string, string>>)
      .then((s) => {
        setPerm(s?.accessibility ?? null);
        setScreenPerm(s?.screenRecording ?? null);
      })
      .catch(() => {
        setPerm(null);
        setScreenPerm(null);
      });
  useEffect(() => {
    if (!on) return;
    check();
    void (notch.svc("pony", "eyesApps") as Promise<{ open: AppItem[]; never: AppItem[] }>).then((a) => a && setApps(a)).catch(() => {});
    // (back from System Settings: the permission row follows)
    const again = () => check();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [on]);

  const nameOf = (id: string) => apps.open.find((a) => a.id === id)?.name ?? id.split(".").pop() ?? id;
  const allowed = perm === "granted" || perm === "authorized";
  const screenAllowed = screenPerm === "granted" || screenPerm === "authorized";

  return (
    <Ability
      k="ponyEyes"
      icon="Eye"
      tone="cyan"
      title={t("Eyes")}
      summary={t("Reads the window you're looking at, only when you ask")}
      tryIt={[t("summarize this page"), t("reply to this email")]}
      safe={t("Never in the background; password apps and fields are never read")}
      control={<Switch checked={on} aria-label={t("Eyes")} onCheckedChange={(checked) => void set({ ponyEyes: checked })} />}
    >
      {on && (
        <>
          {perm !== null && !allowed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300">
              <span>{t("Pony needs Accessibility to read other apps’ windows.")}</span>
              <Button size="xs" variant="secondary" onClick={() => void notch.svc("perm", "request", "accessibility", true).catch(() => {})}>
                {t("Allow")}
              </Button>
            </div>
          )}
          {allowed && screenPerm !== null && !screenAllowed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
              <span>{t("Optional: allow Screen Recording for OCR and visual screenshots (canvases, charts, unlabeled icons).")}</span>
              <Button size="xs" variant="secondary" onClick={() => void notch.svc("perm", "request", "screenRecording", true).catch(() => {})}>
                {t("Allow")}
              </Button>
            </div>
          )}
          {/* Hands: acting on what Eyes see */}
          <div className="flex items-start gap-3" data-k="ponyHands">
            <span className="icon-tile mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px]" style={tileStyle("MousePointerClick")} aria-hidden="true">
              <BrandIcon name="MousePointerClick" className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="text-[13px] font-medium text-foreground">{t("Hands")}</div>
              <div className="text-[12px] leading-snug text-muted-foreground">{t("Also clicks, types, picks and scrolls there for you; the edges of the screen glow while it works")}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] text-muted-foreground/80">{t("Try:")}</span>
                <span className="rounded-full bg-background px-2 py-0.5 text-[11.5px] text-foreground/85">“{t("fill this form with my details")}”</span>
              </div>
            </div>
            <Switch checked={settings.ponyHands === true} aria-label={t("Hands")} onCheckedChange={(checked) => void set({ ponyHands: checked })} />
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 text-[12px] text-muted-foreground" data-k="ponyEyesSkip">
            <span>{t("Never read:")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {apps.never.map((a) => (
                <span key={a.id} className="rounded-md bg-background px-1.5 py-0.5 text-[11.5px] text-foreground/80">
                  {a.name}
                </span>
              ))}
              {skip.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-md bg-background py-0.5 ps-1.5 pe-0.5 text-[11.5px] text-foreground">
                  {nameOf(id)}
                  <button
                    type="button"
                    aria-label={t("Remove {name}", { name: nameOf(id) })}
                    className="grid size-4 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    onClick={() => void set({ ponyEyesSkip: skip.filter((x) => x !== id) })}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <select
                aria-label={t("Add an app Pony never reads")}
                value=""
                onChange={(e) => e.target.value && void set({ ponyEyesSkip: [...skip, e.target.value] })}
                className="h-6 rounded-md border border-input bg-background px-1.5 text-[11.5px] text-foreground outline-none focus:border-ring"
              >
                <option value="">{t("Add app…")}</option>
                {apps.open
                  .filter((a) => !skip.includes(a.id) && !apps.never.some((n) => n.id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </>
      )}
    </Ability>
  );
}
