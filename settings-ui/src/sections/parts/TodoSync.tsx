import { useEffect, useRef, useState } from "react";
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

interface TodoSyncList {
  id: string;
  name?: string;
}

interface TodoSyncState {
  provider?: string;
  builtIn?: Record<string, boolean>;
  ready?: Record<string, boolean>;
  signingIn?: boolean;
  signedIn?: boolean;
  hasTasksScope?: boolean;
  hasCalendarScope?: boolean;
  account?: string;
  list?: { id: string; name?: string } | null;
  last?: string | number | null;
  syncing?: boolean;
  error?: string;
}

function ClientIdInput({
  k,
  value,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  k: string;
  value: string;
  placeholder: string;
  ariaLabel: string;
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
    <div data-k={k}>
      <input
        type="text"
        value={draft}
        aria-label={ariaLabel}
        placeholder={placeholder}
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

export function TodoSyncPart({ settings, set }: CustomPartProps) {
  const provider =
    settings.todoSync === "google" || settings.todoSync === "microsoft"
      ? settings.todoSync
      : null;

  const [tsState, setTsState] = useState<TodoSyncState | null>(null);
  const [listsState, setListsState] = useState<{
    key: string;
    items: TodoSyncList[] | null;
    error: string;
  }>({ key: "", items: null, error: "" });
  const listsKeyRef = useRef("");

  useEffect(() => {
    const unsub = notch.on("todosync", (v) => {
      setTsState((v as TodoSyncState) ?? null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!provider) return;
    let alive = true;
    notch
      .svc("todosync", "state")
      .then((v) => {
        if (alive) setTsState((v as TodoSyncState) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider]);

  const accountKey =
    provider && tsState?.signedIn ? `${provider}|${tsState.account || ""}` : "";

  useEffect(() => {
    if (!accountKey) {
      listsKeyRef.current = "";
      setListsState({ key: "", items: null, error: "" });
      return;
    }
    if (listsKeyRef.current === accountKey) return;
    listsKeyRef.current = accountKey;
    setListsState({ key: accountKey, items: null, error: "" });
    notch
      .svc("todosync", "lists")
      .then((l) => {
        if (listsKeyRef.current === accountKey) {
          setListsState({
            key: accountKey,
            items: Array.isArray(l) ? (l as TodoSyncList[]) : [],
            error: "",
          });
        }
      })
      .catch((e) => {
        if (listsKeyRef.current === accountKey) {
          setListsState({ key: accountKey, items: null, error: String(e) });
        }
      });
  }, [accountKey]);

  if (!provider || !tsState) return null;

  const name = provider === "google" ? "Google Tasks" : "Microsoft To Do";
  const st = tsState;
  const idKeys = syncIdFields(st, provider, settings);

  const run = (method: string, ...args: unknown[]) => {
    notch
      .svc("todosync", method, ...args)
      .then((v) => setTsState((v as TodoSyncState) ?? null))
      .catch((e) => setTsState((prev) => ({ ...(prev ?? {}), error: String(e) })));
  };

  const cur = st.list || null;
  const lists = listsState.items || [];
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
      {!(st.ready || {})[provider] ? (
        <SettingsRow
          label={t("{name} isn’t set up in this build", { name })}
          description={t("It needs an app registration (a client ID) first.")}
        >
          <span />
        </SettingsRow>
      ) : st.signingIn ? (
        <SettingsRow
          label={t("Waiting for the browser…")}
          description={t("Sign in there and let Sympony see and edit your tasks.")}
        >
          <Button size="sm" variant="secondary" onClick={() => run("cancel")}>
            {t("Cancel")}
          </Button>
        </SettingsRow>
      ) : !st.signedIn ? (
        <SettingsRow
          label={t("Account")}
          description={
            st.error ? (
              <span className="text-destructive">{st.error}</span>
            ) : (
              t("Sign in to {name} in your browser.", { name })
            )
          }
        >
          <Button size="sm" variant="primary" onClick={() => run("signIn")}>
            {provider === "google" ? t("Sign in with Google") : t("Sign in")}
          </Button>
        </SettingsRow>
      ) : (
        <>
          <SettingsRow
            label={t("Account")}
            description={
              provider === "google" && st.account
                ? t("Connected to {account} (shared with Google Calendar). Disconnect anytime.", { account: st.account })
                : st.account || t("Signed in")
            }
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                listsKeyRef.current = "";
                setListsState({ key: "", items: null, error: "" });
                run("signOut");
              }}
            >
              {provider === "google" ? t("Disconnect") : t("Sign out")}
            </Button>
          </SettingsRow>

          {provider === "google" && st.hasTasksScope === false && (
            <SettingsRow
              label={t("Google Tasks permission needed")}
              description={t("Your current Google sign-in doesn’t include Google Tasks access. Reconnect to sync tasks.")}
            >
              <Button size="sm" variant="primary" onClick={() => run("signIn")}>
                {t("Reconnect Google")}
              </Button>
            </SettingsRow>
          )}

          <SettingsRow
            label={t("List")}
            description={
              listsState.error ? (
                <span className="text-destructive">{listsState.error}</span>
              ) : listsState.items ? (
                t("Your tasks here and this list are kept the same.")
              ) : (
                t("Loading your lists…")
              )
            }
          >
            <select
              aria-label={t("List")}
              value={cur?.id ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "+") {
                  listsKeyRef.current = "";
                  setListsState({ key: "", items: null, error: "" });
                  run("newList");
                  return;
                }
                const found = lists.find((x) => x.id === val);
                if (val) run("setList", val, found?.name ?? "");
              }}
              className="h-8 min-w-44 max-w-64 rounded-[var(--control-radius)] border border-input bg-background px-2.5 pe-7 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            >
              {!cur && <option value="">{t("Choose a list…")}</option>}
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || t("Untitled")}
                </option>
              ))}
              {cur && !lists.some((l) => l.id === cur.id) && (
                <option value={cur.id}>{cur.name || cur.id}</option>
              )}
              {listsState.items && !listsState.items.some((l) => l.name === "Sympony") && (
                <option value="+">{t("New list “Sympony”")}</option>
              )}
            </select>
          </SettingsRow>

          {cur && (
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
                  t("Every 5 minutes, and soon after you change a task.")
                )
              }
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(st.syncing)}
                icon={<RefreshCw className={st.syncing ? "size-3.5 animate-spin" : "size-3.5"} />}
                onClick={() => run("syncNow")}
              >
                {t("Sync now")}
              </Button>
            </SettingsRow>
          )}
        </>
      )}

      {idKeys.includes("todoSyncGoogleClientId") && (
        <SettingsRow
          label={t("Client ID")}
          description={t("From the “Desktop app” OAuth client in Google Cloud")}
        >
          <ClientIdInput
            k="todoSyncGoogleClientId"
            value={String(settings.todoSyncGoogleClientId ?? "")}
            placeholder="….apps.googleusercontent.com"
            ariaLabel={t("Client ID")}
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

      {idKeys.includes("todoSyncMsClientId") && (
        <SettingsRow
          label={t("Application (client) ID")}
          description={t("From the app registration in Microsoft Entra (Azure)")}
        >
          <ClientIdInput
            k="todoSyncMsClientId"
            value={String(settings.todoSyncMsClientId ?? "")}
            placeholder="00000000-0000-0000-0000-000000000000"
            ariaLabel={t("Application (client) ID")}
            onCommit={(v) => void set({ todoSyncMsClientId: v })}
          />
        </SettingsRow>
      )}
    </div>
  );
}
