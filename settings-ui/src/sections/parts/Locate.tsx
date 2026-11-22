import { useSyncExternalStore } from "react";
import { Crosshair, Loader2 } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { locateMessage, locateSub, type LocateState } from "./logic";

let state: LocateState = { busy: "", msg: {} };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): LocateState {
  return state;
}

async function detectLocation(which: "weather" | "prayer") {
  if (state.busy) return;
  const nextMsg = { ...state.msg };
  delete nextMsg[which];
  state = { busy: which, msg: nextMsg };
  emit();

  const r = await notch.svc("location", "detect", which).catch(() => null);
  const res = r as { reason?: string } | null;
  if (res && res.reason === "busy") {
    state = { ...state, busy: "" };
    emit();
    return;
  }
  state = {
    busy: "",
    msg: { ...state.msg, [which]: locateMessage(r) },
  };
  emit();
}

export function LocatePart({
  which,
  cur,
}: {
  which: "weather" | "prayer";
  cur: { lat: number; lon: number } | null;
}) {
  const st = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const busy = st.busy === which;
  const msg = busy ? null : (st.msg[which] ?? null);
  const showSettings = Boolean(msg?.settings);

  return (
    <SettingsRow label={t("Detect my location")} description={locateSub(st, which, cur)}>
      <div className="flex flex-wrap items-center gap-2">
        {showSettings && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void notch.openExternal(
                "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices"
              )
            }
          >
            {t("Open location settings")}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(st.busy)}
          icon={
            busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Crosshair className="size-3.5" />
            )
          }
          onClick={() => void detectLocation(which)}
        >
          {t("Detect")}
        </Button>
      </div>
    </SettingsRow>
  );
}
