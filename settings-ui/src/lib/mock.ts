export type Settings = Record<string, unknown>;

export interface DisplayInfo {
  id: number;
  label?: string;
  name?: string;
  primary?: boolean;
  width?: number;
  height?: number;
}

export interface Notch {
  getSettings(): Promise<Settings>;
  setSettings(patch: Settings): Promise<Settings>;
  setSecret(key: string, value: string): Promise<unknown>;
  resetSettings(): Promise<Settings>;
  listDisplays(): Promise<DisplayInfo[]>;
  onSettings(fn: (s: Settings) => void): () => void;
  onSettingsSection(fn: (id: string) => void): () => void;
  version(): Promise<string>;
  appInfo(): Promise<Record<string, unknown>>;
  svc(name: string, method: string, ...args: unknown[]): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  helperState(): Promise<Record<string, Record<string, unknown>>>;
  helper(cmd: Record<string, unknown>): void;
  onHelper(fn: (msg: Record<string, unknown>) => void): () => void;
  refreshCalendar(): Promise<unknown>;
  requestCalendar(): Promise<unknown>;
  onCalendar(fn: (p: { errors?: Record<string, string> }) => void): () => void;
  updateState(): Promise<Record<string, unknown> | null>;
  updateCheck(install?: boolean): Promise<Record<string, unknown> | null>;
  updatePage(): Promise<unknown>;
  onUpdate?(fn: (state: Record<string, unknown>) => void): () => void;
  quit(): Promise<unknown>;
  log(msg: string): void;
  on(channel: string, fn: (payload: unknown) => void): () => void;
}

export function createMock(
  defaults: Settings
): Notch & { emitSection(id: string): void; emit(channel: string, payload: unknown): void } {
  const initial: Settings = structuredClone(defaults);
  let state: Settings = structuredClone(defaults);
  const settingsListeners = new Set<(s: Settings) => void>();
  const sectionListeners = new Set<(id: string) => void>();
  const helperListeners = new Set<(msg: Record<string, unknown>) => void>();
  const channelListeners = new Map<string, Set<(payload: unknown) => void>>();

  const notifySettings = () => {
    const snap = { ...state };
    for (const fn of settingsListeners) fn(snap);
    return snap;
  };

  return {
    async getSettings() {
      return { ...state };
    },
    async setSettings(patch: Settings) {
      state = { ...state, ...patch };
      return notifySettings();
    },
    async setSecret(key: string, value: string) {
      const flag = `has_${key}`;
      state = { ...state, [flag]: Boolean(value) };
      notifySettings();
      return { ok: true };
    },
    async resetSettings() {
      state = structuredClone(initial);
      return notifySettings();
    },
    async listDisplays() {
      return [
        {
          id: 1,
          label: "Built-in Retina Display (built-in)",
          name: "Built-in Retina Display",
          primary: true,
          width: 1800,
          height: 1169,
        },
      ];
    },
    onSettings(fn) {
      settingsListeners.add(fn);
      return () => {
        settingsListeners.delete(fn);
      };
    },
    onSettingsSection(fn) {
      sectionListeners.add(fn);
      return () => {
        sectionListeners.delete(fn);
      };
    },
    emitSection(id: string) {
      for (const fn of sectionListeners) fn(id);
    },
    emit(channel: string, payload: unknown) {
      const set = channelListeners.get(channel);
      if (set) for (const fn of set) fn(payload);
    },
    async version() {
      return "0.0.0-dev";
    },
    async appInfo() {
      return { version: "0.0.0-dev", dataDir: "~/Library/Application Support/Sympony" };
    },
    async svc(name: string, method: string) {
      if (name === "custommod") {
        if (method === "list") return { ok: true, modules: [] };
        return { ok: true };
      }
      if (name === "perm" && method === "status") {
        return {
          calendars: "notAsked",
          location: "notAsked",
          automation: { music: "notRunning", spotify: "notRunning" },
          fullDisk: "denied",
          accessibility: "denied",
          microphone: "notAsked",
        };
      }
      if (name === "voice") {
        if (method === "status") {
          return {
            enabled: Boolean(state.voiceEnabled),
            state: "idle",
            tier: "hybrid",
            live: state.voiceLive !== false,
            ramGb: 16,
            lightSuggested: false,
            models: [
              { id: "zf-id", file: "zipformer2-id", size: 70908694, tier: "light", licence: "MIT", downloaded: true, offered: true },
              { id: "0.6b", file: "Qwen3-ASR-0.6B-Q4_K_M.gguf", size: 589560480, tier: "hybrid", licence: "Apache-2.0", downloaded: true, offered: true },
              { id: "1.7b", file: "Qwen3-ASR-1.7B-Q4_K_M.gguf", size: 1319830496, tier: "1.7b", licence: "Apache-2.0", downloaded: false, offered: true },
            ],
            vocabMissing: [],
            permissions: { microphone: "granted", accessibility: "granted" },
            activeDownload: null,
          };
        }
        if (method === "devices") return ["MacBook Pro Microphone", "AirPods Pro"];
        if (method === "dict") {
          return {
            version: 1,
            terms: [{ text: "Rheyno", prompt: true }, { text: "Sympony", prompt: true }],
            replacements: [{ from: "kemipnya", to: "commit-nya" }],
            promptUsed: 2,
            promptCap: 150,
          };
        }
        if (method === "test") {
          return {
            text: "Terbang ke Casablanca Rp20.000.",
            corrections: [{ from: "kasa belangka", to: "Casablanca", category: "PlaceId" }],
          };
        }
        if (method === "dictExport") return "type,text,to,prompt\nterm,Rheyno,,true\n";
        return { ok: true };
      }
      if (name === "perm" && method === "request") {
        return { action: "dialog" };
      }
      if (name === "pony" && method === "gcalState") {
        return {
          ready: true,
          builtIn: true,
          signingIn: false,
          signedIn: false,
          account: "",
          hasCalendarScope: false,
          hasCalendarListScope: false,
          hasTasksScope: false,
          calendars: [],
          defaultCalendarId: null,
          syncing: false,
          last: null,
          error: "",
        };
      }
      return null;
    },
    async openExternal() {
      return null;
    },
    async helperState() {
      return {
        power: { hasBattery: true, level: 82, pluggedIn: false, saver: false },
        bluetooth: { devices: [] },
        volume: { level: 40, muted: false },
      };
    },
    helper(cmd) {
      if (cmd.cmd === "volume.set" && typeof cmd.value === "number") {
        const msg = { type: "volume", level: cmd.value, muted: false };
        for (const fn of helperListeners) fn(msg);
      }
    },
    onHelper(fn) {
      helperListeners.add(fn);
      return () => {
        helperListeners.delete(fn);
      };
    },
    async refreshCalendar() {
      return null;
    },
    async requestCalendar() {
      return null;
    },
    onCalendar(fn) {
      let set = channelListeners.get("calendar");
      if (!set) {
        set = new Set();
        channelListeners.set("calendar", set);
      }
      const wrapped = (payload: unknown) => {
        fn((payload as { errors?: Record<string, string> }) ?? {});
      };
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
      };
    },
    async updateState() {
      return {
        status: "upToDate",
        currentVersion: "0.0.0-dev",
        currentChannel: "beta",
        watchBeta: typeof state.updateBeta === "boolean" ? state.updateBeta : true,
        availableVersion: null,
        availableChannel: null,
        notes: "",
        pubDate: null,
        downloaded: 0,
        total: null,
        percent: null,
        dismissedVersion: typeof state.dismissedUpdateVersion === "string" ? state.dismissedUpdateVersion : "",
        lastChecked: null,
        error: null,
        preview: false,
      };
    },
    async updateCheck() {
      return {
        status: "upToDate",
        currentVersion: "0.0.0-dev",
        currentChannel: "beta",
        watchBeta: typeof state.updateBeta === "boolean" ? state.updateBeta : true,
        availableVersion: null,
        availableChannel: null,
        notes: "",
        pubDate: null,
        downloaded: 0,
        total: null,
        percent: null,
        dismissedVersion: typeof state.dismissedUpdateVersion === "string" ? state.dismissedUpdateVersion : "",
        lastChecked: Date.now(),
        error: null,
        preview: false,
      };
    },
    async updatePage() {
      return null;
    },
    onUpdate(fn) {
      let set = channelListeners.get("update:state");
      if (!set) {
        set = new Set();
        channelListeners.set("update:state", set);
      }
      const wrapped = (payload: unknown) => {
        fn((payload as Record<string, unknown>) ?? {});
      };
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
      };
    },
    async quit() {
      return null;
    },
    log() {
      /* noop in mock */
    },
    on(channel, fn) {
      let set = channelListeners.get(channel);
      if (!set) {
        set = new Set();
        channelListeners.set(channel, set);
      }
      set.add(fn);
      return () => {
        set?.delete(fn);
      };
    },
  };
}
