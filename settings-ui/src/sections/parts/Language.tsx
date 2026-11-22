import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RotateCw } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

interface LangEntry {
  code: string;
  name: string;
  have: boolean;
}

interface LangJob {
  code?: string;
  state?: string;
  error?: string;
  missing?: boolean;
}

interface LangState {
  using: string;
  want?: string;
  windows?: string;
  langs: LangEntry[];
  job?: LangJob;
}

interface LangPick {
  code: string;
  value: string;
  busy?: boolean;
  saved?: boolean;
  error?: string;
  missing?: boolean;
}

function initialLangState(): LangState {
  return {
    using: (typeof window !== "undefined" && window.SYMPONY_LANG) || "en",
    langs: ((typeof window !== "undefined" && window.SYMPONY_LANGS) || []).map(
      ([code, name, have]) => ({ code, name, have: have !== false })
    ),
  };
}

export function LanguagePart({ settings, set, row, os }: CustomPartProps) {
  const [st, setSt] = useState<LangState>(initialLangState);
  const [pick, setPick] = useState<LangPick | null>(null);

  useEffect(() => {
    let alive = true;
    notch
      .svc("lang", "state")
      .then((res) => {
        if (alive && res && typeof res === "object" && "langs" in res) {
          setSt(res as LangState);
        }
      })
      .catch(() => {});

    const unsub = notch.on("lang", (payload) => {
      if (alive && payload && typeof payload === "object" && "langs" in payload) {
        setSt(payload as LangState);
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const pickLanguage = useCallback(
    async (v: string) => {
      if (pick?.busy) return;
      const target = v === "auto" ? st.windows || "en" : v;
      const entry = st.langs.find((x) => x.code === target);
      if (entry && !entry.have) {
        setPick({ code: target, value: v, busy: true });
      } else {
        setPick(null);
      }
      const r = (await notch
        .svc("lang", "prepare", v)
        .catch((e) => ({ ok: false, error: String(e) }))) as
        | { ok?: boolean; code?: string; missing?: boolean; error?: string }
        | null;

      const fresh = (await notch.svc("lang", "state").catch(() => null)) as
        | LangState
        | null;
      if (fresh && fresh.langs) setSt(fresh);

      if (r && r.ok) {
        const cur = String(settings.language || "auto");
        if (v !== cur) {
          setPick({ code: target, value: v, saved: true });
          await set({ language: v });
        } else {
          setPick(null);
        }
      } else {
        setPick({
          code: (r && r.code) || target,
          value: v,
          missing: Boolean(r && r.missing),
          error: (r && r.error) || "",
        });
      }
    },
    [pick?.busy, st, settings.language, set]
  );

  const langInfo = (c: string): LangEntry =>
    st.langs.find((l) => l.code === c) ?? { code: c, name: c, have: true };
  const why = (x: { missing?: boolean; error?: string }) =>
    x.missing ? t("it isn’t available for this version yet") : x.error || "";

  const busy = Boolean(pick?.busy);
  const label = row && "label" in row && row.label ? t(row.label) : t("Language");
  const defaultSub =
    row && "sub" in row && row.sub
      ? t(row.sub)
      : t("Sympony restarts to switch. Words not translated yet stay in English.");

  let description: React.ReactNode = defaultSub;
  let action: React.ReactNode = null;

  if (busy && pick) {
    description = (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span>{t("Downloading {lang}…", { lang: langInfo(pick.code).name })}</span>
      </span>
    );
  } else if (pick && !pick.saved) {
    description = (
      <span className="text-destructive">
        {t("Couldn’t download {lang} ({error}). The language stays as it was.", {
          lang: langInfo(pick.code).name,
          error: why(pick),
        })}
      </span>
    );
  } else if (st.want && st.want !== st.using) {
    const w = langInfo(st.want);
    const job = st.job && st.job.code === st.want ? st.job : {};
    if (w.have) {
      description = t("{lang} is downloaded. Sympony shows it from the next start.", {
        lang: w.name,
      });
      action = (
        <Button
          size="sm"
          variant="primary"
          icon={<RotateCw />}
          onClick={() => void notch.svc("lang", "restart")}
        >
          {t("Restart now")}
        </Button>
      );
    } else if (job.state === "downloading") {
      description = (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          <span>{t("Downloading {lang}…", { lang: w.name })}</span>
        </span>
      );
    } else {
      description =
        job.state === "failed"
          ? t(
              "Couldn’t download {lang} ({error}). Sympony shows English for now and tries again later.",
              { lang: w.name, error: why(job) }
            )
          : t("{lang} isn’t downloaded yet. Sympony shows English until it is.", {
              lang: w.name,
            });
      action = (
        <Button
          size="sm"
          variant="secondary"
          icon={<Download />}
          onClick={() => void pickLanguage(String(settings.language || "auto"))}
        >
          {t("Download")}
        </Button>
      );
    }
  }

  const value = busy && pick ? pick.value : String(settings.language || "auto");
  const autoLabel =
    os === "macos" || os === "linux"
      ? t("Same as the system")
      : t("Same as Windows");
  const opts: [string, string][] = [
    ["auto", autoLabel],
    ["en", "English"],
    ...st.langs.map((l): [string, string] => [
      l.code,
      l.have ? l.name : t("{lang} (download)", { lang: l.name }),
    ]),
  ];

  return (
    <SettingsRow label={label} description={description}>
      <div className="flex items-center gap-2" data-k="language">
        {action}
        <select
          aria-label={label}
          disabled={busy}
          value={value}
          onChange={(e) => void pickLanguage(e.target.value)}
          className="h-8 min-w-44 max-w-64 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-50"
        >
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
    </SettingsRow>
  );
}
