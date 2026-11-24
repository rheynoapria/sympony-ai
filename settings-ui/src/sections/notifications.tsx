import { useCallback, useEffect, useState } from "react";
import {
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  Info,
  LockOpen,
  Send,
  Trash2,
} from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { onMac } from "@/lib/platform";
import { notch } from "@/lib/notch";
import { LeadText, Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, SectionBody } from "@/rows/types";
import { NOTIFICATIONS_ROWS } from "./media.rows";

interface NotifAccessStatus {
  ok?: boolean;
  reason?: string;
  banners?: boolean;
}

function NotifAccessPart({ settings }: CustomPartProps) {
  const [access, setAccess] = useState<NotifAccessStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings.notifEnabled) {
      setAccess(null);
      return;
    }
    let alive = true;
    let timer = 0;

    const poll = async () => {
      const a = (await notch
        .svc("notif", "access")
        .catch(() => null)) as NotifAccessStatus | null;
      if (!alive) return;
      setAccess(a);
      if (a) {
        const delay = a.ok && a.banners ? 10000 : 3000;
        timer = window.setTimeout(() => {
          if (alive) void poll();
        }, delay);
      }
    };

    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [settings.notifEnabled]);

  if (!settings.notifEnabled || !access) return null;

  const axBlock = !access.banners ? (
    <div className="pt-3">
      <SettingsRow
        label={
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>{t("Allow Accessibility for instant notifications")}</span>
          </span>
        }
        description={t(
          "With it Sympony reads each banner the moment macOS shows it (without it, a few seconds later) and can close macOS’s own banner. In System Settings → Privacy & Security → Accessibility, turn Sympony on (add it with + if it’s not listed)."
        )}
      >
        <Button
          size="sm"
          variant="secondary"
          icon={<Accessibility />}
          onClick={() => void notch.svc("notif", "grantBanners")}
        >
          {t("Open Accessibility")}
        </Button>
      </SettingsRow>
    </div>
  ) : null;

  if (access.ok) {
    return (
      <div className="divide-y divide-border/80">
        <div className={axBlock ? "pb-3" : ""}>
          <SettingsRow
            label={
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span>{t("Sympony can read your notifications")}</span>
              </span>
            }
            description={
              access.banners
                ? t(
                    "Full Disk Access and Accessibility are on: notifications show under the notch the moment they arrive."
                  )
                : t("Full Disk Access is on.")
            }
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={testing}
              icon={testing ? <Hourglass /> : <Send />}
              onClick={() => {
                setTesting(true);
                void notch.svc("notif", "test");
              }}
            >
              {testing ? t("Coming in a few seconds…") : t("Send a test")}
            </Button>
          </SettingsRow>
        </div>
        {axBlock}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/80">
      <div className={axBlock ? "pb-3" : ""}>
        {access.reason === "fullDiskAccess" ? (
          <SettingsRow
            label={
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {t("Sympony needs Full Disk Access to read notifications")}
                </span>
              </span>
            }
            description={t(
              "macOS keeps your notifications in a protected place. In System Settings → Privacy & Security → Full Disk Access, add Sympony with the + button (it’s in Applications) and turn it on. If macOS offers Quit & Reopen, click it."
            )}
          >
            <Button
              size="sm"
              variant="secondary"
              icon={<LockOpen />}
              onClick={() => void notch.svc("notif", "grant")}
            >
              {t("Open Full Disk Access")}
            </Button>
          </SettingsRow>
        ) : (
          <div className="flex items-start gap-2 rounded-[9px] border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{onMac() ? t("Sympony can’t find macOS’s notifications on this Mac.") : t("Sympony can’t read Windows’ notifications on this PC.")}</span>
          </div>
        )}
      </div>
      {axBlock}
    </div>
  );
}

function TelegramHintPart({ settings }: CustomPartProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!settings.notifEnabled) {
      setShow(false);
      return;
    }
    let alive = true;
    notch
      .svc("notif", "telegram")
      .then((res) => {
        if (alive && res && typeof res === "object" && "show" in res) {
          setShow(Boolean((res as { show?: boolean }).show));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.notifEnabled]);

  if (!settings.notifEnabled || !show) return null;

  return (
    <div className="flex items-start gap-2 rounded-[9px] border border-border bg-muted/40 px-3 py-2.5">
      <Info
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <LeadText html="Telegram shows its own pop-ups, so Sympony can’t see them. In Telegram, open Settings → Notifications and turn on <b>Use Windows notifications</b>." />
    </div>
  );
}

function NotifClearPart({ settings }: CustomPartProps) {
  const [count, setCount] = useState<number>(0);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const h = (await notch.svc("notif", "history").catch(() => null)) as
      | { items?: unknown[] }
      | null;
    setCount(Array.isArray(h?.items) ? h.items.length : 0);
  }, []);

  useEffect(() => {
    if (settings.notifHistory === false) return;
    void load();
  }, [settings.notifHistory, load]);

  if (settings.notifHistory === false) return null;

  const description = count
    ? count === 1
      ? t("{n} notification kept now", { n: count })
      : t("{n} notifications kept now", { n: count })
    : t("Nothing kept yet");

  return (
    <SettingsRow label={t("Clear history")} description={description}>
      {count > 0 ? (
        confirming ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirming(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              icon={<Trash2 />}
              onClick={async () => {
                await notch.svc("notif", "clear").catch(() => {});
                setConfirming(false);
                await load();
              }}
            >
              {t("Clear {n}", { n: count })}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            icon={<Trash2 />}
            onClick={() => setConfirming(true)}
          >
            {t("Clear")}
          </Button>
        )
      ) : (
        <span />
      )}
    </SettingsRow>
  );
}

const CUSTOMS: Record<string, CustomPart> = {
  notifAccess: NotifAccessPart,
  telegramHint: TelegramHintPart,
  notifClear: NotifClearPart,
};

export const notifications: SectionBody = {
  id: "notifications",
  rows: [...NOTIFICATIONS_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <Rows
      sectionId="notifications"
      rows={NOTIFICATIONS_ROWS}
      customs={CUSTOMS}
      settings={props.settings}
      set={props.set}
      os={props.os}
      part={props.part}
      onNavigate={props.onNavigate}
    />
  ),
};
