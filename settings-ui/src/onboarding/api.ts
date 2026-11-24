export type PickId =
  | "music"
  | "calendar"
  | "prayer"
  | "ai"
  | "focus"
  | "notifications"
  | "weather"
  | "todo";

export type PermId = "fulldisk" | "accessibility" | "calendars" | "automation" | "location" | "microphone";

export type PermState = "granted" | "denied" | "notAsked" | "notRunning";

export interface PermStatusMap {
  calendars: PermState;
  location: PermState;
  automation: {
    music: PermState;
    spotify: PermState;
  };
  fullDisk: PermState;
  accessibility: PermState;
  microphone?: PermState;
}

export interface CameraRect {
  x: number;
  w: number;
  h: number;
}

export interface WindowFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "win" | "dock";
}

export interface DisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OnboardingState {
  picks: PickId[];
  perms: PermId[];
  display?: DisplayRect | null;
  camera: CameraRect | null;
  windows: WindowFrame[];
  imported: boolean;
  lang: string;
  version: string;
  prayerCity?: string | null;
  look?: "black" | "glass" | "color";
  openOnHover?: boolean;
  launchAtLogin?: boolean;
}

export interface FeelInput {
  look: "black" | "glass" | "color";
  openOnHover: boolean;
  launchAtLogin: boolean;
}

interface TauriCore {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

function tauriInvoke(): TauriCore["invoke"] | null {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__;
  return t?.core?.invoke ?? null;
}

export function isTauri(): boolean {
  return tauriInvoke() !== null;
}

/** These permissions are macOS's (the browser preview counts as a Mac). */
export const onMac = () => {
  const os = typeof window === "undefined" ? undefined : (window as unknown as { SYMPONY_OS?: string }).SYMPONY_OS;
  return !os || os === "macos";
};

/** What the picked modules can't work without (the step waits for these). */
export function requiredPerms(picks: PickId[]): PermId[] {
  if (!onMac()) return [];
  const has = (id: PickId) => picks.includes(id);
  const out: PermId[] = [];
  if (has("notifications")) out.push("fulldisk");
  if (has("calendar")) out.push("calendars");
  if (has("music")) out.push("automation");
  if (has("prayer") || has("weather")) out.push("location");
  return out;
}

const ALL_PERMS: PermId[] = ["fulldisk", "calendars", "automation", "location", "accessibility", "microphone"];

/** Every permission Sympony uses, so they're all settled here once: the picks' own first, then the rest. */
export function permsForPicks(picks: PickId[]): PermId[] {
  // ponytail: macOS's privacy switches only; Windows (microphone, notification access) gets rows with its backend
  if (!onMac()) return [];
  const req = requiredPerms(picks);
  return [...req, ...ALL_PERMS.filter((p) => !req.includes(p))];
}

// Browser-dev mock state (used when running `bun run --cwd settings-ui dev` outside Tauri)
const mockPermGranted = new Set<PermId>();

function mockQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export const onboardingApi = {
  async state(): Promise<OnboardingState> {
    const inv = tauriInvoke();
    if (inv) {
      const s = await inv<OnboardingState>("onboarding_state");
      return { ...s, windows: Array.isArray(s.windows) ? s.windows : [] };
    }
    const langParam =
      mockQueryParam("lang") ||
      (window as unknown as { SYMPONY_LANG?: string }).SYMPONY_LANG ||
      "id";
    const flat = mockQueryParam("device") === "flat";
    const imported = mockQueryParam("imported") === "1";
    const picks: PickId[] = ["music", "calendar", "prayer"];
    const W = window.innerWidth || 1440;
    const H = window.innerHeight || 900;
    return {
      picks,
      perms: permsForPicks(picks),
      display: { x: 0, y: 0, w: W, h: H },
      camera: flat ? null : { x: Math.round(W / 2 - 100), w: 200, h: 32 },
      windows: [
        { x: Math.round(W * 0.07), y: Math.round(H * 0.13), w: Math.round(W * 0.46), h: Math.round(H * 0.58), kind: "win" },
        { x: Math.round(W * 0.48), y: Math.round(H * 0.3), w: Math.round(W * 0.4), h: Math.round(H * 0.52), kind: "win" },
        { x: Math.round(W * 0.5 - 165), y: H - 76, w: 330, h: 66, kind: "dock" },
      ],
      imported,
      lang: langParam,
      version: "0.1.0",
      prayerCity: "Jakarta",
      look: "black",
      openOnHover: true,
      launchAtLogin: true,
    };
  },

  async phase(
    phase: "opening" | "card",
    rect?: { x?: number; y?: number; w?: number; h?: number }
  ): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_phase", {
      phase,
      x: rect?.x,
      y: rect?.y,
      w: rect?.w,
      h: rect?.h,
    });
  },

  async lower(lower: boolean): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_lower", { lower });
  },

  async cancelWait(): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_cancel_wait");
  },

  async hint(state: "ask" | "ok" | "ready" | "clear", text: string): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_hint", { state, text });
  },

  async finish(picks: PickId[], feel: FeelInput): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_finish", { picks, feel });
  },

  async skip(): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_skip");
  },

  async open(): Promise<void> {
    const inv = tauriInvoke();
    if (!inv) return;
    await inv("onboarding_open");
  },

  async permStatus(): Promise<PermStatusMap> {
    const n = (
      window as unknown as {
        notch?: { svc: (s: string, m: string, ...a: unknown[]) => Promise<unknown> };
      }
    ).notch;
    if (n && isTauri()) {
      return (await n.svc("perm", "status")) as PermStatusMap;
    }
    return {
      calendars: mockPermGranted.has("calendars") ? "granted" : "notAsked",
      location: mockPermGranted.has("location") ? "granted" : "notAsked",
      automation: {
        music: mockPermGranted.has("automation") ? "granted" : "notAsked",
        spotify: "notRunning",
      },
      fullDisk: mockPermGranted.has("fulldisk") ? "granted" : "denied",
      accessibility: mockPermGranted.has("accessibility") ? "granted" : "denied",
      microphone: mockPermGranted.has("microphone") ? "granted" : "notAsked",
    };
  },

  async permRequest(
    kind: PermId,
    forcePane = false
  ): Promise<{ action: "dialog" | "pane" | "done" | "later" }> {
    const n = (
      window as unknown as {
        notch?: { svc: (s: string, m: string, ...a: unknown[]) => Promise<unknown> };
      }
    ).notch;
    if (n && isTauri()) {
      return (await n.svc("perm", "request", kind, forcePane)) as {
        action: "dialog" | "pane" | "done" | "later";
      };
    }
    if (!forcePane && mockQueryParam("mockNoDialog") === "1") {
      return { action: "dialog" };
    }
    setTimeout(() => {
      mockPermGranted.add(kind);
    }, 1200);
    return {
      action: forcePane || kind === "fulldisk" || kind === "accessibility" ? "pane" : "dialog",
    };
  },

  onTried(fn: () => void): () => void {
    const n = (
      window as unknown as {
        notch?: { on?: (ch: string, cb: (p: unknown) => void) => () => void };
      }
    ).notch;
    if (n?.on && isTauri()) {
      return n.on("onboard:tried", () => fn());
    }
    return () => {};
  },

  onCancelWait(fn: () => void): () => void {
    const n = (
      window as unknown as {
        notch?: { on?: (ch: string, cb: (p: unknown) => void) => () => void };
      }
    ).notch;
    if (n?.on && isTauri()) {
      return n.on("onboard:cancel-wait", () => fn());
    }
    return () => {};
  },
};
