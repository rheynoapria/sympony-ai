import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { onboardingApi, onMac, type PermId, type PermStatusMap } from "../api";
import { copy, type CopyKey } from "../copy";
import { OnboardingIcon, type OnboardingIconName, TickIcon } from "../icons";

interface PermMeta {
  id: PermId;
  icon: OnboardingIconName;
  color: string;
  titleKey: CopyKey;
  whyKey: CopyKey;
}

export const PERM_META: Record<PermId, PermMeta> = {
  fulldisk: {
    id: "fulldisk",
    icon: "bell",
    color: "#2f7cf6",
    titleKey: "perm.fulldisk.title",
    whyKey: "perm.fulldisk.why",
  },
  accessibility: {
    id: "accessibility",
    icon: "hand",
    color: "#6e6e78",
    titleKey: "perm.accessibility.title",
    whyKey: "perm.accessibility.why",
  },
  microphone: {
    id: "microphone",
    icon: "mic",
    color: "#5e5ce6",
    titleKey: "perm.microphone.title",
    whyKey: "perm.microphone.why",
  },
  calendars: {
    id: "calendars",
    icon: "cal",
    color: "#ff5a4e",
    titleKey: "perm.calendars.title",
    whyKey: "perm.calendars.why",
  },
  automation: {
    id: "automation",
    icon: "play",
    color: "#ff375f",
    titleKey: "perm.automation.title",
    whyKey: "perm.automation.why",
  },
  location: {
    id: "location",
    icon: "pin",
    color: "#1fb855",
    titleKey: "perm.location.title",
    whyKey: "perm.location.why",
  },
};

export function permEffectiveState(
  id: PermId,
  status: PermStatusMap | null
): "granted" | "denied" | "notAsked" | "notRunning" {
  if (!status) return "notAsked";
  switch (id) {
    case "calendars":
      return status.calendars;
    case "location":
      return status.location;
    case "fulldisk":
      return status.fullDisk;
    case "accessibility":
      return status.accessibility;
    case "microphone":
      return status.microphone ?? "notAsked";
    case "automation": {
      const m = status.automation.music;
      const s = status.automation.spotify;
      if (m === "notAsked" || s === "notAsked") return "notAsked";
      if (m === "denied" || s === "denied") return "denied";
      if (m === "granted" || s === "granted") return "granted";
      return "notRunning";
    }
  }
}

export function isPermDone(
  id: PermId,
  status: PermStatusMap | null,
  laterIds: Set<PermId>
): boolean {
  const st = permEffectiveState(id, status);
  if (st === "granted") return true;
  if (id === "automation" && (st === "notRunning" || laterIds.has(id))) return true;
  return false;
}

export function PermsStep({
  lang,
  perms,
  status,
  laterIds,
  returnedDenied,
  noDialogIds,
  busyPerm,
  onAllow,
  required,
  withAi = false,
}: {
  lang: string;
  perms: PermId[];
  status: PermStatusMap | null;
  laterIds: Set<PermId>;
  returnedDenied: Set<PermId>;
  noDialogIds: Set<PermId>;
  busyPerm: PermId | null;
  onAllow: (id: PermId, forcePane?: boolean) => void;
  required: PermId[];
  withAi?: boolean;
}) {
  return (
    <>
      <h2 className="x">{copy("permsTitle", undefined, lang)}</h2>
      <p className="lead x" style={{ "--i": 1 } as CSSProperties}>
        {copy(onMac() ? "permsSub" : "permsSubPc", undefined, lang)}
      </p>
      <div className="list" id="perms">
        {perms.length === 0 && !withAi ? (
          <p className="lead x" style={{ "--i": 2 } as CSSProperties}>
            {copy("permsNone", undefined, lang)}
          </p>
        ) : (
          perms.map((k, i) => {
            const meta = PERM_META[k];
            const eff = permEffectiveState(k, status);
            const done = isPermDone(k, status, laterIds);
            const isLaterOnPlay =
              k === "automation" && (eff === "notRunning" || laterIds.has(k));
            const isNoDialog = !done && noDialogIds.has(k);
            const needsPane =
              returnedDenied.has(k) ||
              ((k === "calendars" || k === "location" || k === "automation") &&
                eff === "denied");
            const firstExtra = !required.includes(k) && (i === 0 || required.includes(perms[i - 1]));
            return (
              <Fragment key={k}>
              {firstExtra && (
                <p className="perm-group x" style={{ "--i": 2 + i * 0.6 } as CSSProperties}>
                  {copy("permsMore", undefined, lang)}
                </p>
              )}
              <div
                className={`item x${done ? " ok" : ""}${isNoDialog ? " nodialog" : ""}`}
                style={{ "--i": 2 + i * 0.6, "--c": meta.color } as CSSProperties}
                data-k={k}
              >
                <span className="ico">
                  <OnboardingIcon name={meta.icon} />
                </span>
                <div className="perm-body">
                  <b>
                    {copy(meta.titleKey, undefined, lang)}
                    {!required.includes(k) && (
                      <span className="tag">{copy("optional", undefined, lang)}</span>
                    )}
                  </b>
                  <small className={isNoDialog ? "warn-msg" : undefined}>
                    {isLaterOnPlay
                      ? copy("askOnFirstPlay", undefined, lang)
                      : isNoDialog
                        ? copy("noDialog", undefined, lang)
                        : copy(meta.whyKey, undefined, lang)}
                  </small>
                </div>
                <div className="end">
                  {isNoDialog ? (
                    <div className="perm-actions">
                      <button
                        type="button"
                        className="allow secondary"
                        disabled={busyPerm !== null}
                        onClick={() => onAllow(k, false)}
                      >
                        {copy("tryAgain", undefined, lang)}
                      </button>
                      <button
                        type="button"
                        className="allow"
                        disabled={busyPerm !== null}
                        onClick={() => onAllow(k, true)}
                      >
                        {copy("openSystemSettings", undefined, lang)}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="allow"
                      disabled={busyPerm !== null}
                      onClick={() => onAllow(k, needsPane)}
                    >
                      {needsPane
                        ? copy("openSystemSettings", undefined, lang)
                        : copy("allow", undefined, lang)}
                    </button>
                  )}
                  <span className="done-mark">
                    <TickIcon color="#fff" />
                  </span>
                </div>
              </div>
              </Fragment>
            );
          })
        )}
        {withAi && <SymponyAiRow lang={lang} i={2 + perms.length * 0.6} />}
      </div>
    </>
  );
}

type Svc = (s: string, m: string, ...a: unknown[]) => Promise<unknown>;
const bridge = () =>
  (window as unknown as { notch?: { svc: Svc; getSettings: () => Promise<Record<string, unknown>> } }).notch;

/**
 * Sympony AI (when AI was picked): sign in with Google in the browser so Pony can think, right here. Optional: the
 * card steps aside for the browser and comes back when the sign-in is done.
 */
function SymponyAiRow({ lang, i }: { lang: string; i: number }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const n = bridge();
  const live = Boolean(n && document.body.dataset.tauri === "true");

  useEffect(() => {
    if (!live) {
      setOpen(true); // (browser preview)
      return;
    }
    void (n!.svc("brain", "info") as Promise<{ sympony?: boolean }>).then((r) => setOpen(Boolean(r?.sympony)));
    void n!.getSettings().then((st) => {
      const a = (st.symponyAccount || null) as { email?: string; name?: string } | null;
      if (st.has_symponyAiKey) setWho(a?.email || a?.name || "");
    });
  }, []);

  // (a click on the notch's hint while the browser is up stops waiting)
  useEffect(() => {
    if (!waiting || !live) return;
    return onboardingApi.onCancelWait(() => void n!.svc("brain", "cancel"));
  }, [waiting]);

  if (!open) return null;

  const signIn = async () => {
    setErr("");
    setWaiting(true);
    if (!live) {
      window.setTimeout(() => {
        setWaiting(false);
        setWho("you@gmail.com");
      }, 1200);
      return;
    }
    await onboardingApi.lower(true);
    void onboardingApi.hint("ask", copy("aiWaiting", undefined, lang));
    const r = (await n!.svc("brain", "signIn", "onboarding")) as { ok: boolean; error?: string; account?: { email?: string; name?: string } };
    void onboardingApi.hint("clear", "");
    await onboardingApi.lower(false);
    setWaiting(false);
    if (r.ok) setWho(r.account?.email || r.account?.name || "");
    else if (r.error) setErr(r.error);
  };
  const cancel = () => {
    if (live) void n!.svc("brain", "cancel");
    else setWaiting(false);
  };

  const done = who !== null;
  return (
    <div className={`item x ai${done ? " ok" : ""}`} style={{ "--i": i, "--c": "#7c5cff" } as CSSProperties} data-k="ai">
      <span className="ico">
        <OnboardingIcon name="pony" />
      </span>
      <div className="perm-body">
        <b>
          {copy("aiTitle", undefined, lang)}
          <span className="tag">{copy("optional", undefined, lang)}</span>
        </b>
        <small className={err ? "warn-msg" : undefined}>
          {done
            ? copy("aiSignedAs", { who: who || "Google" }, lang)
            : err || (waiting ? copy("aiWaiting", undefined, lang) : copy("aiWhy", undefined, lang))}
        </small>
      </div>
      <div className="end">
        {waiting ? (
          <button type="button" className="allow secondary" onClick={cancel}>
            {copy("cancel", undefined, lang)}
          </button>
        ) : (
          <button type="button" className="allow google" onClick={() => void signIn()}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.96 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
            </svg>
            {copy("aiSignIn", undefined, lang)}
          </button>
        )}
        <span className="done-mark">
          <TickIcon color="#fff" />
        </span>
      </div>
    </div>
  );
}
