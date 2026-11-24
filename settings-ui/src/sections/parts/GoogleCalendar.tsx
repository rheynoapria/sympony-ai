import { useEffect, useState } from "react";
import { RefreshCw } from "@/components/icons";
import { SecretField } from "@/components/shell/SecretField";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { syncIdFields } from "./logic";

const INPUT_CLASS =
  "h-8 w-64 max-w-full rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

interface GCalCalendar {
  id: string;
  summary: string;
  color?: string;
  primary?: boolean;
  accessRole?: string;
  selected?: boolean;
  writable?: boolean;
}

interface GCalState {
  ready?: boolean;
  builtIn?: boolean;
  signingIn?: boolean;
  signedIn?: boolean;
  account?: string;
  hasCalendarScope?: boolean;
  hasCalendarListScope?: boolean;
  hasTasksScope?: boolean;
  calendars?: GCalCalendar[];
  defaultCalendarId?: string | null;
  syncing?: boolean;
  last?: number | null;
  error?: string;
}

function ClientIdInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (val: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
  };

  return (
    <div data-k="todoSyncGoogleClientId">
      <input
        type="text"
        value={draft}
        aria-label={t("Client ID")}
        placeholder="….apps.googleusercontent.com"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={INPUT_CLASS}
      />
    </div>
  );
}

export function GoogleCalendarPart({ settings, set }: CustomPartProps) {
  const [gc, setGc] = useState<GCalState | null>(null);

  useEffect(() => {
    let alive = true;
    const unsub = notch.on("pony:gcal", (v) => {
      if (alive) setGc((v as GCalState) ?? null);
    });
    notch
      .svc("pony", "gcalState")
      .then((v) => {
        if (alive) setGc((v as GCalState) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const run = (method: string, ...args: unknown[]) => {
    notch
      .svc("pony", method, ...args)
      .then((v) => {
        if (v && typeof v === "object") setGc(v as GCalState);
      })
      .catch((e) => setGc((prev) => ({ ...(prev ?? {}), error: String(e) })));
  };

  const st: GCalState = gc ?? {};
  const idKeys = syncIdFields(
    { builtIn: { google: Boolean(st.builtIn) }, ready: { google: Boolean(st.ready) } },
    "google",
    settings
  );

  const calendars = Array.isArray(st.calendars) ? st.calendars : [];
  const selectedIds = calendars.filter((c) => c.selected).map((c) => c.id);
  const writableSelected = calendars.filter((c) => c.selected && c.writable);

  const toggleCalendar = (id: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedIds, id])]
      : selectedIds.filter((x) => x !== id);
    run("gcalSetCalendars", next);
  };

  const setDefaultCalendar = (calId: string) => {
    run("gcalSetCalendars", selectedIds, calId);
  };

  const locale = typeof window !== "undefined" ? window._tLocale?.() : undefined;
  const last = st.last ? new Date(st.last) : null;
  const when = last
    ? (last.toDateString() === new Date().toDateString()
        ? ""
        : `${last.toLocaleDateString(locale, { day: "numeric", month: "short" })} `) +
      last.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: !settings.clock24h,
      })
    : "";

  return (
    <div className="divide-y divide-border/80">
      {!st.ready ? (
        <SettingsRow
          label={t("Google sign-in isn’t set up in this build")}
          description={t("Add a Desktop OAuth client ID below, or build with .signing/oauth.env.")}
        >
          <span />
        </SettingsRow>
      ) : st.signingIn ? (
        <SettingsRow
          label={t("Waiting for the browser…")}
          description={t("Sign in to Google in your browser and allow Sympony to access your calendars and tasks.")}
        >
          <Button size="sm" variant="secondary" onClick={() => run("gcalCancel")}>
            {t("Cancel")}
          </Button>
        </SettingsRow>
      ) : !st.signedIn ? (
        <SettingsRow
          label={t("Google account")}
          description={
            st.error ? (
              <span className="text-destructive">{st.error}</span>
            ) : (
              t("Sign in with Google directly from this device. Your calendars and tasks are never routed through a third-party server.")
            )
          }
        >
          <Button size="sm" variant="primary" onClick={() => run("gcalSignIn")}>
            {t("Sign in with Google")}
          </Button>
        </SettingsRow>
      ) : (
        <>
          <SettingsRow
            label={t("Google account")}
            description={st.account || t("Signed in")}
          >
            <Button size="sm" variant="secondary" onClick={() => run("gcalSignOut")}>
              {t("Disconnect")}
            </Button>
          </SettingsRow>

          {!st.hasCalendarScope ? (
            <SettingsRow
              label={t("Google Calendar permission needed")}
              description={t("Your current Google sign-in doesn’t include Calendar access yet. Reconnect to enable Google Calendar.")}
            >
              <Button size="sm" variant="primary" onClick={() => run("gcalSignIn")}>
                {t("Reconnect Google")}
              </Button>
            </SettingsRow>
          ) : (
            <>
              <div className="py-3">
                <div className="mb-1 text-[13.5px] font-medium text-foreground">
                  {t("Calendars to use")}
                </div>
                <div className="mb-2.5 text-[12.5px] text-muted-foreground">
                  {t("Choose which Google calendars appear in Sympony and in Pony’s context.")}
                </div>
                {calendars.length === 0 ? (
                  <div className="text-[12.5px] text-muted-foreground">
                    {st.syncing
                      ? t("Loading your calendars…")
                      : t("No calendars found in this Google account.")}
                  </div>
                ) : (
                  <div className="divide-y divide-border/70 rounded-[var(--control-radius)] border border-border bg-muted/20 px-3">
                    {calendars.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2.5 py-2 text-[13px] text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(c.selected)}
                          onChange={(e) => toggleCalendar(c.id, e.target.checked)}
                          className="size-4 accent-primary"
                        />
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.color || "#4285f4" }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.summary}
                        </span>
                        {c.primary && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            {t("Primary")}
                          </span>
                        )}
                        {!c.writable && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {t("Read-only")}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {writableSelected.length > 1 && (
                <SettingsRow
                  label={t("Default calendar for new events")}
                  description={t("Where Sympony and Pony create new Google Calendar events.")}
                >
                  <select
                    aria-label={t("Default calendar for new events")}
                    value={st.defaultCalendarId ?? writableSelected[0]?.id ?? ""}
                    onChange={(e) => setDefaultCalendar(e.target.value)}
                    className="h-8 min-w-44 max-w-64 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                  >
                    {writableSelected.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.summary}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
              )}

              <SettingsRow
                label={
                  st.syncing
                    ? t("Syncing…")
                    : st.error
                      ? t("The last sync didn’t work")
                      : when
                        ? t("Synced {when}", { when })
                        : t("Not synced yet")
                }
                description={
                  st.error ? (
                    <span className="text-destructive">{st.error}</span>
                  ) : (
                    t("Direct Google Calendar sync every 5 minutes, and immediately when you create, move, or delete an event.")
                  )
                }
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(st.syncing)}
                  icon={<RefreshCw className={st.syncing ? "size-3.5 animate-spin" : "size-3.5"} />}
                  onClick={() => run("gcalRefresh")}
                >
                  {t("Sync now")}
                </Button>
              </SettingsRow>
            </>
          )}
        </>
      )}

      {idKeys.includes("todoSyncGoogleClientId") && (
        <SettingsRow
          label={t("Client ID")}
          description={t("From the “Desktop app” OAuth client in Google Cloud")}
        >
          <ClientIdInput
            value={String(settings.todoSyncGoogleClientId ?? "")}
            onCommit={(v) => void set({ todoSyncGoogleClientId: v })}
          />
        </SettingsRow>
      )}

      {idKeys.includes("todoSyncGoogleClientSecret") && (
        <SettingsRow label={t("Client secret")}>
          <SecretField
            secretKey="todoSyncGoogleClientSecret"
            hasValue={Boolean(settings.has_todoSyncGoogleClientSecret)}
            placeholder="GOCSPX-…"
            ariaLabel={t("Client secret")}
          />
        </SettingsRow>
      )}
    </div>
  );
}
