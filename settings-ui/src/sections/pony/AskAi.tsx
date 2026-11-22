import { useEffect, useState } from "react";
import { MessagesSquare, TriangleAlert } from "@/components/icons";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { Ability } from "./Ability";

type Props = Pick<CustomPartProps, "settings" | "set">;
type Profile = { dir: string; name: string; account: string };
type Browser = { id: string; name: string; profiles: Profile[]; last: string };

const selectCls =
  "h-8 min-w-40 max-w-56 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[12.5px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

/** Ask other AIs (Stage B): Pony types a prompt into Claude, ChatGPT or Gemini in your browser and brings the answer back. */
export function PonyAskAi({ settings, set }: Props) {
  const on = settings.ponyAskAi === true;
  const [info, setInfo] = useState<{ default: string; browsers: Browser[] } | null>(null);
  useEffect(() => {
    if (!on) return;
    void (notch.svc("pony", "askBrowsers") as Promise<{ default: string; browsers: Browser[] }>).then((r) => r && setInfo(r)).catch(() => {});
  }, [on]);

  const picked = typeof settings.ponyAskBrowser === "string" ? settings.ponyAskBrowser : "";
  const browsers = info?.browsers ?? [];
  const def = browsers.find((b) => b.id === info?.default);
  const current = browsers.find((b) => b.id === (picked || info?.default));
  const profile = typeof settings.ponyAskProfile === "string" ? settings.ponyAskProfile : "";
  const lastName = current?.profiles.find((p) => p.dir === current.last)?.name;

  return (
    <Ability
      k="ponyAskAi"
      icon="MessagesSquare"
      tone="violet"
      title={t("Ask other AIs")}
      summary={t("Asks Claude, ChatGPT or Gemini with your own accounts and tells you their answer")}
      tryIt={[t("ask Gemini what the capital of Australia is")]}
      control={<Switch checked={on} aria-label={t("Ask other AIs")} onCheckedChange={(checked) => void set({ ponyAskAi: checked })} />}
    >
      {on && (
        <>
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("Claude, ChatGPT and Gemini don’t allow scripts to use their apps. Your account could be flagged.")}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-muted-foreground">{t("Browser")}</span>
            <select aria-label={t("Browser")} value={picked} onChange={(e) => void set({ ponyAskBrowser: e.target.value, ponyAskProfile: "" })} className={selectCls}>
              <option value="">{def ? t("System default ({name})", { name: def.name }) : t("System default")}</option>
              {browsers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {current && current.profiles.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">{t("Profile")}</span>
              <select aria-label={t("Profile")} value={profile} onChange={(e) => void set({ ponyAskProfile: e.target.value })} className={selectCls}>
                <option value="">{lastName ? t("Last used ({name})", { name: lastName }) : t("Last used")}</option>
                {current.profiles.map((p) => (
                  <option key={p.dir} value={p.dir}>
                    {p.account ? `${p.name} · ${p.account}` : p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {current && current.id === "com.apple.Safari" && <p className="text-[12px] text-muted-foreground">{t("Safari uses the profile of its front window.")}</p>}
        </>
      )}
    </Ability>
  );
}
