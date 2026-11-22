import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  isTauri,
  onboardingApi,
  permsForPicks,
  requiredPerms,
  type FeelInput,
  type OnboardingState,
  type PermId,
  type PermStatusMap,
  type PickId,
} from "./api";
import { activeLang, copy } from "./copy";
import { createEdge, type EdgeController } from "./edge";
import { ArrowRightIcon } from "./icons";
import { Stage, type StageStep } from "./Stage";
import { FeelStep } from "./steps/FeelStep";
import { IntroSection, WelcomeSection } from "./steps/Opening";
import { PonyStory } from "./PonyStory";
import { isPermDone, PERM_META, permEffectiveState, PermsStep } from "./steps/PermsStep";
import { PickStep } from "./steps/PickStep";
import { TryStep } from "./steps/TryStep";
import { PANE_TIMEOUT_MS, waitOutcome } from "./wait";

type Step = "intro" | "welcome" | "try" | "pick" | "perms" | "feel" | "done";
const CARD_STEPS: Step[] = ["try", "pick", "perms", "feel"];
const SHADOW_MARGIN = 40;

function readInitialStep(): Step {
  if (typeof window === "undefined") return "intro";
  const q = new URLSearchParams(window.location.search).get("step");
  if (q && (["intro", "welcome", "try", "pick", "perms", "feel"] as string[]).includes(q)) {
    return q as Step;
  }
  return "intro";
}

function readThemeOverride(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("theme");
  return q === "dark" || q === "light" ? q : null;
}

export function App() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<Step>(readInitialStep);
  const [leavingOpen, setLeavingOpen] = useState<"intro" | "welcome" | null>(null);
  const [phase, setPhase] = useState<"opening" | "card">(() =>
    CARD_STEPS.includes(readInitialStep()) ? "card" : "opening"
  );
  const [dir, setDir] = useState<1 | -1>(1);
  const [notchMode, setNotchMode] = useState<"" | "wake">("");
  const [sheenTick, setSheenTick] = useState(0);
  const [tried, setTried] = useState(false);
  const [picks, setPicks] = useState<PickId[]>(["music", "calendar", "prayer"]);
  const [feel, setFeel] = useState<FeelInput>({
    look: "black",
    openOnHover: true,
    launchAtLogin: true,
  });
  const [permStatus, setPermStatus] = useState<PermStatusMap | null>(null);
  const [laterPerms, setLaterPerms] = useState<Set<PermId>>(new Set());
  const [returnedDenied, setReturnedDenied] = useState<Set<PermId>>(new Set());
  const [noDialogIds, setNoDialogIds] = useState<Set<PermId>>(new Set());
  const [busyPerm, setBusyPerm] = useState<PermId | null>(null);
  const [skipPrompt, setSkipPrompt] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [prevCardIdx, setPrevCardIdx] = useState(-1);

  const edgeContainerRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<EdgeController | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelWaitRef = useRef<(() => void) | null>(null);
  const handOverStartedRef = useRef(false);
  const lastWinHeightRef = useRef<number>(0);
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const lang = state?.lang ?? activeLang();
  const activePerms = useMemo(() => permsForPicks(picks), [picks]);
  const reqPerms = useMemo(() => requiredPerms(picks), [picks]);

  // Body mode flags & live macOS light/dark appearance tracking
  useEffect(() => {
    if (isTauri()) {
      document.body.dataset.tauri = "true";
    } else {
      document.body.dataset.browserDev = "true";
    }
    const override = readThemeOverride();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const paintTheme = () => {
      const dark = override ? override === "dark" : mq.matches;
      document.body.classList.toggle("sys-dark", dark);
    };
    paintTheme();
    mq.addEventListener("change", paintTheme);
    return () => mq.removeEventListener("change", paintTheme);
  }, []);

  // Load initial state from Rust (or browser mock)
  useEffect(() => {
    let alive = true;
    onboardingApi.state().then((s) => {
      if (!alive) return;
      setState(s);
      document.documentElement.lang = s.lang;
      document.body.dataset.lang = s.lang;
      setPicks(s.picks.length > 0 ? s.picks : ["music", "calendar", "prayer"]);
      setFeel({
        look: s.look ?? "black",
        openOnHover: s.openOnHover ?? true,
        launchAtLogin: s.launchAtLogin ?? true,
      });

      const root = document.documentElement;
      if (s.camera) {
        document.body.dataset.device = "notch";
        const cx = s.camera.x + s.camera.w / 2;
        root.style.setProperty("--cut-x", `${cx}px`);
        root.style.setProperty("--cut-w", `${s.camera.w}px`);
        root.style.setProperty("--cut-h", `${s.camera.h}px`);
        root.style.setProperty("--n-w", `${s.camera.w}px`);
        root.style.setProperty("--n-h", `${s.camera.h}px`);
        root.style.setProperty("--wake-w", `${Math.max(330, s.camera.w + 130)}px`);
        root.style.setProperty("--wake-h", `${s.camera.h + 20}px`);
      } else {
        document.body.dataset.device = "flat";
        root.style.setProperty("--cut-x", "50%");
      }
    });
    onboardingApi.permStatus().then((ps) => {
      if (alive) setPermStatus(ps);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Initialize v6.3 four-strip compositor edge controller
  useEffect(() => {
    const el = edgeContainerRef.current;
    if (!el) return;
    const ctrl = createEdge(el, reduceMotion);
    edgeRef.current = ctrl;
    return () => {
      ctrl.destroy();
      edgeRef.current = null;
    };
  }, [reduceMotion]);

  // Listen for real notch hover ("onboard:tried") from Rust shell
  useEffect(() => {
    return onboardingApi.onTried(() => {
      setTried(true);
    });
  }, []);

  // Listen for notch-hint click cancellation ("onboard:cancel-wait") from Rust
  useEffect(() => {
    return onboardingApi.onCancelWait(() => {
      cancelWaitRef.current?.();
    });
  }, []);

  // Opening choreography: Intro (5.6s auto-advance + sweep at 1.0s) -> Welcome
  useEffect(() => {
    if (!state) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    };

    if (step === "intro") {
      document.body.classList.remove("setup", "finale");
      edgeRef.current?.show();
      edgeRef.current?.read(state.windows, 1000);
      setNotchMode("");
      later(400, () => {
        setNotchMode("wake");
        setSheenTick((t) => t + 1);
      });
      // (Pony's opening story plays first: PonyStory)
      later(9000, () => {
        setLeavingOpen("intro");
        later(350, () => setStep("welcome"));
        later(520, () => setLeavingOpen(null));
      });
    } else if (step === "welcome") {
      document.body.classList.remove("setup", "finale");
      edgeRef.current?.show();
      setNotchMode("wake");
      // If opened straight at welcome (e.g. dev preview), run a lighter sweep
      if (leavingOpen !== "intro") {
        edgeRef.current?.read(state.windows, 300);
      }
    }

    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [step, state]);

  // Measure card viewport height and keep shrunk Tauri window synced without clipping or jumping
  const syncCardSize = useCallback(
    (targetPageH?: number) => {
      const vp = viewportRef.current;
      const page = pageRef.current;
      const card = cardRef.current;
      if (!vp || !page) return;
      const headEl = card?.querySelector(".head") as HTMLElement | null;
      const stageEl = card?.querySelector(".stage") as HTMLElement | null;
      const footEl = card?.querySelector(".foot") as HTMLElement | null;
      const chromeH =
        (headEl?.offsetHeight ?? 32) +
        (stageEl ? stageEl.offsetHeight + 12 : 124) +
        (footEl?.offsetHeight ?? 68);
      // (taller than the screen, e.g. every permission on a 13" Mac: the page scrolls inside the card)
      const disp = state?.display;
      const room = (isTauri() && disp ? disp.h : window.innerHeight) - chromeH - SHADOW_MARGIN * 2 - 24;
      const fullH = targetPageH ?? page.scrollHeight;
      const pageH = Math.min(fullH, Math.max(160, room));
      vp.classList.toggle("scroll", fullH > pageH + 1);
      if (pageH > 0) {
        vp.style.setProperty("--h", `${pageH}px`);
      }

      if (phase !== "card" || !card || !isTauri()) return;
      if (!disp) return;

      const targetCardH = chromeH + pageH;
      const winW = 480 + SHADOW_MARGIN * 2;
      const winH = Math.ceil(targetCardH) + SHADOW_MARGIN * 2;
      const winX = disp.x + Math.round((disp.w - winW) / 2);
      const winY = disp.y + Math.round((disp.h - winH) / 2);

      if (shrinkTimerRef.current !== null) {
        clearTimeout(shrinkTimerRef.current);
        shrinkTimerRef.current = null;
      }

      if (winH >= lastWinHeightRef.current || lastWinHeightRef.current === 0) {
        lastWinHeightRef.current = winH;
        void onboardingApi.phase("card", { x: winX, y: winY, w: winW, h: winH });
      } else {
        shrinkTimerRef.current = setTimeout(() => {
          shrinkTimerRef.current = null;
          lastWinHeightRef.current = winH;
          void onboardingApi.phase("card", { x: winX, y: winY, w: winW, h: winH });
        }, reduceMotion ? 180 : 650);
      }
    },
    [phase, state, reduceMotion]
  );

  useLayoutEffect(() => {
    if (!CARD_STEPS.includes(step)) return;
    document.body.classList.add("setup");
    syncCardSize();
    const raf = requestAnimationFrame(() => syncCardSize());
    // (and whenever the page itself grows or shrinks: a row that shows up late, a longer line after a sign-in)
    const page = pageRef.current;
    const ro = page && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => syncCardSize()) : null;
    if (page) ro?.observe(page);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [step, activePerms.length, picks.length, noDialogIds.size, skipPrompt, syncCardSize]);

  // Refresh permStatus whenever entering Permissions step
  useEffect(() => {
    if (step === "perms") {
      onboardingApi.permStatus().then(setPermStatus);
    }
  }, [step]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const goCardStep = useCallback(
    (target: Step, direction: 1 | -1) => {
      if (autoAdvanceRef.current !== null) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
      setPrevCardIdx(CARD_STEPS.indexOf(step));
      setDir(direction);
      setStep(target);
    },
    [step]
  );

  // Auto-advance Permissions after 900ms when all required permissions are green
  useEffect(() => {
    if (step !== "perms" || !permStatus || busyPerm) return;
    // (all of them, the optional ones too: settled here, nothing asks later)
    // (not with nothing to settle, nor over the Sympony AI sign-in: there you press Next yourself)
    if (activePerms.length > 0 && !picks.includes("ai") && activePerms.every((p) => isPermDone(p, permStatus, laterPerms))) {
      autoAdvanceRef.current = setTimeout(() => {
        goCardStep("feel", 1);
      }, 900);
      return () => {
        if (autoAdvanceRef.current !== null) {
          clearTimeout(autoAdvanceRef.current);
          autoAdvanceRef.current = null;
        }
      };
    }
  }, [step, permStatus, busyPerm, activePerms, laterPerms, goCardStep, picks]);

  // Spec §5.2 Phase A -> B hand-over (no box, no jump):
  // 1. Window stays fullscreen while opening layers fade out AND card fades in at center.
  // 2. Only after #edges & #read-veil finish transitioning (transitionend, fallback 1200ms)
  //    do we unmount opening layers and shrink window to exact card rect + 40px shadow margin.
  const beginSetup = useCallback(() => {
    if (step !== "welcome" || handOverStartedRef.current) return;
    handOverStartedRef.current = true;
    setLeavingOpen("welcome");
    edgeRef.current?.hide();
    setNotchMode("");
    setPrevCardIdx(-1);
    setDir(1);
    setStep("try");
    document.body.classList.add("setup");

    let committed = false;
    const commitShrink = () => {
      if (committed) return;
      committed = true;
      setLeavingOpen(null);
      // Unmount opening layers BEFORE shrinking so zero opening pixels ever appear in shrunk window
      setPhase("card");
      requestAnimationFrame(() => {
        const card = cardRef.current;
        const disp = state?.display;
        if (card && disp && isTauri()) {
          const r = card.getBoundingClientRect();
          const winW = Math.round(r.width) + SHADOW_MARGIN * 2;
          const winH = Math.round(r.height) + SHADOW_MARGIN * 2;
          const winX = disp.x + Math.round(r.left) - SHADOW_MARGIN;
          const winY = disp.y + Math.round(r.top) - SHADOW_MARGIN;
          lastWinHeightRef.current = winH;
          void onboardingApi.phase("card", { x: winX, y: winY, w: winW, h: winH });
        } else {
          void onboardingApi.phase("card");
        }
      });
    };

    if (reduceMotion) {
      setTimeout(commitShrink, 200);
      return;
    }

    const container = edgeContainerRef.current;
    const veilEl = container?.querySelector("#read-veil") as HTMLElement | null;
    const edgesEl = container?.querySelector("#edges") as HTMLElement | null;
    let veilDone = !veilEl;
    let edgesDone = !edgesEl;

    const cleanupListeners = () => {
      veilEl?.removeEventListener("transitionend", onVeilEnd);
      edgesEl?.removeEventListener("transitionend", onEdgesEnd);
    };

    const maybeCommit = () => {
      if (veilDone && edgesDone) {
        clearTimeout(fallbackTimer);
        cleanupListeners();
        commitShrink();
      }
    };

    const onVeilEnd = (e: TransitionEvent) => {
      if (e.target === veilEl && e.propertyName === "opacity") {
        veilDone = true;
        maybeCommit();
      }
    };

    const onEdgesEnd = (e: TransitionEvent) => {
      if (e.target === edgesEl && e.propertyName === "opacity") {
        edgesDone = true;
        maybeCommit();
      }
    };

    veilEl?.addEventListener("transitionend", onVeilEnd);
    edgesEl?.addEventListener("transitionend", onEdgesEnd);
    const fallbackTimer = setTimeout(() => {
      cleanupListeners();
      commitShrink();
    }, 1200);
  }, [step, state, reduceMotion]);

  // Handle permission Allow click (spec §5.4 + waitOutcome bugfix + escape hatches)
  const handleAllowPerm = useCallback(
    async (id: PermId, forcePane = false) => {
      if (busyPerm) return;
      const meta = PERM_META[id];
      const permName = copy(meta.titleKey, undefined, lang);
      const beforeStatus = permStatus ?? (await onboardingApi.permStatus());
      const beforeEff = permEffectiveState(id, beforeStatus);

      // Clear previous noDialog notice when retrying
      setNoDialogIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      const res = await onboardingApi.permRequest(id, forcePane);

      if (res.action === "done") {
        const st = await onboardingApi.permStatus();
        setPermStatus(st);
        return;
      }
      if (res.action === "later") {
        setLaterPerms((prev) => new Set(prev).add(id));
        return;
      }

      const waitAction: "dialog" | "pane" = res.action;
      const startedAt = Date.now();

      setBusyPerm(id);
      document.body.classList.add("away");
      await onboardingApi.lower(true);
      const askText =
        waitAction === "dialog"
          ? copy("chooseAllow", undefined, lang)
          : copy("turnOn", { name: permName }, lang);
      await onboardingApi.hint("ask", askText);

      let finished = false;
      let focusTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        stopPolling();
        window.removeEventListener("focus", onReturn);
        cancelWaitRef.current = null;
        if (focusTimer !== null) {
          clearTimeout(focusTimer);
          focusTimer = null;
        }
      };

      const restoreCard = async (mode: "cancel" | "denied" | "noDialog") => {
        if (finished) return;
        finished = true;
        cleanup();
        await onboardingApi.hint("clear", "");
        await onboardingApi.lower(false);
        document.body.classList.remove("away");
        if (mode === "denied") {
          setReturnedDenied((prev) => new Set(prev).add(id));
        } else if (mode === "noDialog") {
          setNoDialogIds((prev) => new Set(prev).add(id));
        }
        setBusyPerm(null);
      };

      const completeGranted = async () => {
        if (finished) return;
        finished = true;
        cleanup();
        setNoDialogIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await onboardingApi.hint("ok", copy("permIsOn", { name: permName }, lang));
        setTimeout(async () => {
          await onboardingApi.lower(false);
          document.body.classList.remove("away");
          setBusyPerm(null);
        }, 650);
      };

      // Allow Esc or clicking the real notch hint to cancel immediately
      cancelWaitRef.current = () => {
        void restoreCard("cancel");
      };

      const pollNow = async (): Promise<boolean> => {
        if (finished) return true;
        const st = await onboardingApi.permStatus();
        setPermStatus(st);
        const nowEff = permEffectiveState(id, st);
        const elapsedMs = Date.now() - startedAt;

        if (isPermDone(id, st, laterPerms)) {
          await completeGranted();
          return true;
        }

        const outcome = waitOutcome(beforeEff, nowEff, elapsedMs, waitAction);
        if (outcome === "granted") {
          await completeGranted();
          return true;
        }
        if (outcome === "denied") {
          await restoreCard("denied");
          return true;
        }
        if (outcome === "noDialog") {
          await restoreCard("noDialog");
          return true;
        }
        if (waitAction === "pane" && elapsedMs >= PANE_TIMEOUT_MS) {
          await restoreCard("denied");
          return true;
        }
        return false;
      };

      const onReturn = () => {
        if (finished || focusTimer !== null) return;
        focusTimer = setTimeout(async () => {
          focusTimer = null;
          const settled = await pollNow();
          if (!settled && !finished) {
            await restoreCard("denied");
          }
        }, 650);
      };

      window.addEventListener("focus", onReturn);
      pollRef.current = setInterval(() => {
        void pollNow();
      }, 500);
    },
    [busyPerm, lang, permStatus, laterPerms, stopPolling]
  );

  // Finale: fly card up into notch (720ms), then save once & close
  const runFinale = useCallback(() => {
    if (finishing) return;
    setFinishing(true);
    document.body.classList.add("finale");
    const dur = reduceMotion ? 180 : 720;
    setTimeout(() => {
      setStep("done");
      void onboardingApi.finish(picks, feel);
    }, dur);
  }, [finishing, picks, feel, reduceMotion]);

  // Card step primary & back actions
  const cardIdx = CARD_STEPS.indexOf(step);
  const permOkCount = reqPerms.filter((p) => isPermDone(p, permStatus, laterPerms)).length;
  const hasPendingRequiredPerm = step === "perms" && permOkCount < reqPerms.length;

  const primaryDisabled =
    finishing || (step === "pick" && picks.length === 0) || busyPerm !== null;

  const primaryLabel =
    step === "try"
      ? copy(tried ? "continue" : "skip", undefined, lang)
      : step === "perms"
        ? copy(hasPendingRequiredPerm ? "later" : "continue", undefined, lang)
        : step === "feel"
          ? copy("finish", undefined, lang)
          : copy("continue", undefined, lang);

  const handlePrimary = useCallback(() => {
    if (primaryDisabled) return;
    if (step === "try") goCardStep("pick", 1);
    else if (step === "pick") goCardStep("perms", 1);
    else if (step === "perms") goCardStep("feel", 1);
    else if (step === "feel") runFinale();
  }, [primaryDisabled, step, goCardStep, runFinale]);

  const handleBack = useCallback(() => {
    if (cardIdx <= 0 || finishing) return;
    goCardStep(CARD_STEPS[cardIdx - 1], -1);
  }, [cardIdx, finishing, goCardStep]);

  const confirmSkip = useCallback(() => {
    cancelWaitRef.current?.();
    stopPolling();
    setSkipPrompt(false);
    void onboardingApi.skip();
  }, [stopPolling]);

  // Keyboard shortcuts: Esc cancels active permission wait first, otherwise toggles skip confirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (busyPerm !== null) {
          cancelWaitRef.current?.();
          return;
        }
        if (step === "done") return;
        setSkipPrompt((v) => !v);
        return;
      }
      if (skipPrompt) {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmSkip();
        }
        return;
      }
      if (e.key === "Enter") {
        if (step === "welcome") {
          e.preventDefault();
          beginSetup();
        } else if (CARD_STEPS.includes(step) && !primaryDisabled) {
          e.preventDefault();
          handlePrimary();
        }
      } else if (e.key === "ArrowLeft" && CARD_STEPS.includes(step) && cardIdx > 0) {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    step,
    busyPerm,
    skipPrompt,
    primaryDisabled,
    cardIdx,
    beginSetup,
    handlePrimary,
    handleBack,
    confirmSkip,
  ]);

  const togglePick = (id: PickId) => {
    setPicks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const stageStep: StageStep =
    step === "feel" ? "tune" : step === "pick" || step === "perms" ? step : "try";

  return (
    <>
      <div
        id="edge-root"
        ref={edgeContainerRef}
        data-hidden={phase === "card" ? "true" : "false"}
        aria-hidden="true"
      />

      {/* Opening notch shape: drawn ONLY during Phase A opening, never inside camera cutout */}
      {phase === "opening" && (
        <>
          <PonyStory step={step} leaving={leavingOpen} reduceMotion={reduceMotion} lang={lang} />
          <div className="ears" data-mode={notchMode} aria-hidden="true" />
          <div id="notch" data-mode={notchMode} aria-hidden="true">
            <div className="part p-wake">
              <span className="dot" />
            </div>
            <div key={sheenTick} className={sheenTick > 0 ? "sheen go" : "sheen"} />
          </div>
        </>
      )}

      {/* Phase A opening screens */}
      <IntroSection
        active={step === "intro"}
        leaving={leavingOpen === "intro"}
        lang={lang}
      />
      <WelcomeSection
        active={step === "welcome"}
        leaving={leavingOpen === "welcome"}
        lang={lang}
        imported={Boolean(state?.imported)}
        onBegin={beginSetup}
      />

      {/* Phase B setup card */}
      <div
        id="card"
        ref={cardRef}
        role="dialog"
        aria-label="Sympony onboarding"
        aria-hidden={!CARD_STEPS.includes(step)}
      >
        <div className="head">
          <span className="count" id="count">
            {cardIdx >= 0 ? copy("stepOf", { n: cardIdx + 1 }, lang) : ""}
          </span>
          <span className="segs" aria-hidden="true">
            {CARD_STEPS.map((s, j) => (
              <i
                key={s}
                style={
                  {
                    "--f": j <= cardIdx ? 1 : 0,
                    "--fd": `${Math.max(0, j - Math.max(prevCardIdx, 0)) * 90}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </div>

        <Stage
          step={stageStep}
          lang={lang}
          tried={tried}
          picks={picks}
          permOk={permOkCount}
          permTotal={reqPerms.length}
          look={feel.look}
        />

        <div className="viewport" ref={viewportRef}>
          {CARD_STEPS.includes(step) && (
            <div
              key={step}
              ref={pageRef}
              className="page on"
              style={{ "--dir": dir } as CSSProperties}
            >
              {step === "try" && <TryStep lang={lang} />}
              {step === "pick" && (
                <PickStep lang={lang} picks={picks} onToggle={togglePick} />
              )}
              {step === "perms" && (
                <PermsStep
                  lang={lang}
                  perms={activePerms}
                  status={permStatus}
                  laterIds={laterPerms}
                  returnedDenied={returnedDenied}
                  noDialogIds={noDialogIds}
                  busyPerm={busyPerm}
                  onAllow={handleAllowPerm}
                  required={reqPerms}
                  withAi={picks.includes("ai")}
                />
              )}
              {step === "feel" && (
                <FeelStep
                  lang={lang}
                  feel={feel}
                  showPrayer={picks.includes("prayer")}
                  prayerCity={state?.prayerCity}
                  onChange={setFeel}
                />
              )}
            </div>
          )}
        </div>

        <div className="foot">
          <span className="hint">{copy("enterHint", undefined, lang)}</span>
          <button
            type="button"
            className="ghost-btn"
            id="back"
            style={{ visibility: step === "try" ? "hidden" : "visible" }}
            onClick={handleBack}
          >
            {copy("back", undefined, lang)}
          </button>
          <button
            type="button"
            className="go-btn"
            id="next"
            disabled={primaryDisabled}
            onClick={handlePrimary}
          >
            <span className="label">{primaryLabel}</span>
            <ArrowRightIcon className="arr" />
          </button>
        </div>

        {skipPrompt && CARD_STEPS.includes(step) && (
          <div className="skip-bar" role="alertdialog" aria-label={copy("skip", undefined, lang)}>
            <span className="skip-msg">{copy("skipConfirm", undefined, lang)}</span>
            <button
              type="button"
              className="ghost-btn"
              style={{ marginInlineStart: 0 }}
              onClick={() => setSkipPrompt(false)}
            >
              {copy("cancel", undefined, lang)}
            </button>
            <button type="button" className="go-btn" onClick={confirmSkip}>
              {copy("skip", undefined, lang)}
            </button>
          </div>
        )}
      </div>

      {skipPrompt && !CARD_STEPS.includes(step) && (
        <div className="skip-overlay" role="alertdialog" aria-label={copy("skip", undefined, lang)}>
          <span>{copy("skipConfirm", undefined, lang)}</span>
          <button type="button" className="cancel" onClick={() => setSkipPrompt(false)}>
            {copy("cancel", undefined, lang)}
          </button>
          <button type="button" className="confirm" onClick={confirmSkip}>
            {copy("skip", undefined, lang)}
          </button>
        </div>
      )}
    </>
  );
}
