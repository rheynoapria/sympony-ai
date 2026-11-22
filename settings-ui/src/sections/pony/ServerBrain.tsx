import { useEffect, useState } from "react";
import { Button } from "@/components/ui/knowns/button";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

interface ServerModel {
  id: string;
  display_name?: string;
}

const field =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

/** Pony's brain on a server of the user's own: its address, their key, a model it offers. */
export function ServerBrain({ settings, set }: Pick<CustomPartProps, "settings" | "set">) {
  const url = String(settings.brainUrl || "");
  const hasKey = Boolean(settings.has_brainKey);
  const [err, setErr] = useState("");
  const [models, setModels] = useState<ServerModel[] | null>(null);
  const [key, setKey] = useState("");

  useEffect(() => {
    setModels(null);
    setErr("");
    if (!hasKey || !url) return;
    void (notch.svc("brain", "models") as Promise<{ ok: boolean; models?: ServerModel[]; error?: string }>).then((r) => {
      if (r.ok) setModels(r.models || []);
      else setErr(r.error || "");
    });
  }, [hasKey, url]);

  return (
    <div className="divide-y divide-border/80">
      <div className="pb-3" data-k="brainUrl">
        <SettingsRow label={t("Server address")} description={t("An OpenAI-compatible server, like your own router or a local model")}>
          <input
            key={url}
            type="url"
            defaultValue={url}
            placeholder="https://…"
            spellCheck={false}
            aria-label={t("Server address")}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== url) void set({ brainUrl: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={`${field} w-60`}
          />
        </SettingsRow>
      </div>

      <div className="py-3" data-k="brainKey">
        <SettingsRow label={t("API key")} description={hasKey ? t("Saved on this Mac, encrypted") : t("The key your server gave you")}>
          {hasKey ? (
            <Button size="sm" variant="secondary" onClick={() => void notch.setSecret("brainKey", "")}>
              {t("Remove")}
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-…"
                aria-label={t("API key")}
                className={`${field} w-44`}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!key.trim()}
                onClick={() => void notch.setSecret("brainKey", key.trim()).then(() => setKey(""))}
              >
                {t("Save")}
              </Button>
            </span>
          )}
        </SettingsRow>
      </div>

      {hasKey && (
        <div className="pt-3" data-k="brainModel">
          <SettingsRow label={t("Model")} description={t("One of the models your server offers")}>
            <select
              aria-label={t("Model")}
              value={String(settings.brainModel || "")}
              disabled={!models?.length}
              onChange={(e) => void set({ brainModel: e.target.value })}
              className={`${field} min-w-44 pe-7`}
            >
              <option value="">{t("Server’s default")}</option>
              {(models || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.id}
                </option>
              ))}
            </select>
          </SettingsRow>
        </div>
      )}

      {err && <p className="pt-3 text-[12px] text-destructive">{err}</p>}
    </div>
  );
}
