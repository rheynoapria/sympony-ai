import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Globe,
  KeyRound,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
} from "@/components/icons";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import { notch, type CustomModPillEval, type CustomModPreviewHandle } from "@/lib/notch";

function ThumbtackIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

const ACCENT_HEX: Record<string, string> = {
  emerald: "#10b981",
  sky: "#0ea5e9",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
  lime: "#84cc16",
  neutral: "#64748b",
};

const ICON_PATHS: Record<string, string> = {
  Boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/>',
  Sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  TrendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  Activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  Flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  Heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  Zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  Globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  Clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  CheckCircle2: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  Server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/>',
  Database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  Terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  Code2: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  Coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>',
  DollarSign: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  Wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  Rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  Cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  Sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  Moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  Music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  Coffee: '<path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
  Dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/>',
  Droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/>',
  BookOpen: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  Target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  Bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  Shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  Cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>',
  Wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
  Gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  Star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  Rocket: '<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
  Calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  Timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/>',
  ListTodo: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  Bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  Compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
};

function resolveAccentHex(accent?: string): string {
  if (!accent) return ACCENT_HEX.emerald;
  const k = accent.trim().toLowerCase();
  if (ACCENT_HEX[k]) return ACCENT_HEX[k];
  if (/^#[0-9a-f]{6}$/i.test(k)) return k;
  return ACCENT_HEX.emerald;
}

export function CustomModuleBadgeIcon({
  icon,
  accent,
  size = "md",
}: {
  icon?: string;
  accent?: string;
  size?: "sm" | "md";
}) {
  const hex = resolveAccentHex(accent);
  const paths = ICON_PATHS[icon || "Boxes"] ?? ICON_PATHS.Boxes;
  const style: CSSProperties = {
    color: hex,
    backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 26%, transparent), 0 1px 2px color-mix(in srgb, ${hex} 12%, transparent)`,
  };
  return (
    <div
      style={style}
      className={cn(
        "grid shrink-0 place-items-center",
        size === "sm" ? "size-7 rounded-[8px]" : "size-8 rounded-[9px]"
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === "sm" ? "size-3.5" : "size-4"}
        dangerouslySetInnerHTML={{ __html: paths }}
      />
    </div>
  );
}

export interface CustomConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "toggle" | "select" | "secret";
  default?: unknown;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface CustomModuleManifest {
  slug: string;
  id?: string;
  name: string;
  description: string;
  icon: string;
  accent?: string;
  defaultSize?: string;
  permissions?: { httpDomains?: string[] };
  dataSources?: { id: string; kind?: string }[];
  configSchema?: CustomConfigField[];
  initialState?: Record<string, unknown>;
  actions?: Record<string, { kind?: string; [k: string]: unknown }>;
  view?: { compact?: unknown; expanded?: unknown; pill?: unknown };
}

export interface CustomModuleSummary {
  slug: string;
  id: string;
  manifest: CustomModuleManifest;
  approvedDomains: string[];
  missingDomains: string[];
  secretKeysConfigured: string[];
  config: Record<string, unknown>;
  state?: Record<string, unknown>;
  pinnedPill?: boolean;
}

const STARTER_META: Record<string, { desc: string }> = {
  "mochi-pet": { desc: "Animated pixel Tamagotchi pet" },
  "daily-habits": { desc: "Ring progress, steppers & checklist" },
  "crypto-pulse": { desc: "Live BTC & ETH prices with 24h delta" },
};

const STARTER_FALLBACK = [
  { slug: "mochi-pet", name: "Mochi Pet", size: "2×2", desc: "Animated pixel Tamagotchi pet", icon: "Heart", accent: "sky" },
  { slug: "daily-habits", name: "Daily Habits", size: "2×2", desc: "Ring progress, steppers & checklist", icon: "Flame", accent: "sky" },
  { slug: "crypto-pulse", name: "Crypto Pulse", size: "2×1", desc: "Live BTC & ETH prices with 24h delta", icon: "TrendingUp", accent: "emerald" },
] as const;

const SAMPLE_PREVIEW_DATA: Record<string, Record<string, unknown>> = {
  "crypto-pulse": {
    mkt: { btc: 97420, btcChg: 3.42, eth: 3420, ethChg: 1.85 },
  },
};

const STARTERS = [
  {
    label: "Animated OLED Pet",
    prompt: "Create a 2x2 animated OLED pixel Tamagotchi pet module I can feed, pet, and play with (with bounce/walk motion and heart particles).",
  },
  {
    label: "Crypto & FX ticker",
    prompt: "Create a 2x1 OLED custom module that shows live BTC, ETH, and USD/IDR prices with 24h change badges.",
  },
  {
    label: "Daily habit tracker",
    prompt: "Create a 2x1 local OLED custom module to track daily water intake, push-ups, and a reading checklist (no internet needed).",
  },
  {
    label: "API status monitor",
    prompt: "Create a 2x1 OLED custom module that checks my public HTTPS status endpoint every minute and shows uptime & latency.",
  },
] as const;

const INPUT_BASE =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";
const INPUT_CLASS = `${INPUT_BASE} w-56 max-w-full`;

type PreviewMode = "compact" | "expanded" | "pill";

function pillToneColor(tone: string, accent: string): string {
  if (tone === "ok") return "#4ade80";
  if (tone === "warn") return "#fbbf24";
  if (tone === "err" || tone === "rose") return "#fb7185";
  return accent;
}

function localTestActions(manifest: CustomModuleManifest): { name: string; label: string }[] {
  const acts = manifest.actions;
  if (!acts || typeof acts !== "object") return [];
  const out: { name: string; label: string }[] = [];
  for (const [name, def] of Object.entries(acts)) {
    if (!def || typeof def !== "object") continue;
    const kind = String(def.kind || "");
    if (["multi", "setState", "increment", "toggleState"].includes(kind)) {
      const label = name.charAt(0).toUpperCase() + name.slice(1).replace(/[_-]+/g, " ");
      out.push({ name, label });
    }
    if (out.length >= 3) break;
  }
  return out;
}

function cardWidthClass(defaultSize?: string): string {
  switch (defaultSize) {
    case "1x1":
      return "w-[186px]";
    case "1x2":
      return "w-[206px]";
    case "2x1":
      return "w-full max-w-[336px]";
    default:
      return "w-full max-w-[346px]";
  }
}

function CustomSecretInput({
  hasValue,
  label,
  placeholder,
  onSave,
}: {
  hasValue: boolean;
  label: string;
  placeholder?: string;
  onSave: (val: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    void onSave(v);
  };
  return (
    <div className="flex w-56 max-w-full items-center gap-1.5">
      <div className="relative flex min-w-0 flex-1 items-center">
        <KeyRound className="pointer-events-none absolute start-2.5 size-3.5 text-muted-foreground/70" aria-hidden="true" />
        <input
          type="password"
          aria-label={label}
          value={draft}
          placeholder={hasValue ? "••••••••••••" : placeholder || t("Enter secret")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className={`${INPUT_BASE} w-full ps-7`}
        />
      </div>
      {hasValue && (
        <Button
          size="xs"
          variant="ghost"
          icon={<Trash2 />}
          title={t("Clear")}
          aria-label={t("Clear")}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void onSave("")}
        />
      )}
    </div>
  );
}

export function useCustomModules(): {
  items: CustomModuleSummary[];
  templates: CustomModuleManifest[];
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<CustomModuleSummary[]>([]);
  const [templates, setTemplates] = useState<CustomModuleManifest[]>([]);

  const refresh = async () => {
    try {
      const res = (await notch.svc("custommod", "list")) as {
        ok?: boolean;
        modules?: CustomModuleSummary[];
      } | null;
      if (res && res.ok && Array.isArray(res.modules)) {
        setItems(res.modules);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const res = (await notch.svc("custommod", "templates")) as {
          ok?: boolean;
          templates?: CustomModuleManifest[];
        } | null;
        if (res && res.ok && Array.isArray(res.templates)) {
          setTemplates(res.templates);
        }
      } catch {
        /* ignore */
      }
    })();
    const off = notch.on("custommod:changed", () => {
      void refresh();
    });
    return off;
  }, []);

  return { items, templates, refresh };
}

function CustomModulePreviewStage({
  manifest,
  isInstalled,
  installedItem,
  liveConfig,
  busy,
  onInstallTemplate,
  onOpenCreator,
}: {
  manifest: CustomModuleManifest;
  isInstalled: boolean;
  installedItem?: CustomModuleSummary;
  liveConfig: Record<string, unknown>;
  busy: boolean;
  onInstallTemplate: (slug: string) => Promise<void>;
  onOpenCreator: (prompt: string) => void;
}) {
  const hasPill = Boolean(manifest.view?.pill);
  const [mode, setMode] = useState<PreviewMode>("compact");
  const [resetTick, setResetTick] = useState(0);
  const [previewState, setPreviewState] = useState<Record<string, unknown>>(() => ({
    ...(manifest.initialState ?? {}),
    ...(installedItem?.state ?? {}),
  }));
  const [liveData, setLiveData] = useState<{ data: Record<string, unknown>; isSample: boolean }>({
    data: SAMPLE_PREVIEW_DATA[manifest.slug] ?? {},
    isSample: Boolean(SAMPLE_PREVIEW_DATA[manifest.slug]),
  });

  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CustomModPreviewHandle | null>(null);
  const stateRef = useRef<Record<string, unknown>>(previewState);
  stateRef.current = previewState;

  // Keep valid mode when switching between modules
  useEffect(() => {
    if (mode === "pill" && !hasPill) setMode("compact");
  }, [hasPill, mode]);

  // Reset sandbox state when active module or reset button changes
  useEffect(() => {
    const base = {
      ...(manifest.initialState ?? {}),
      ...(isInstalled && installedItem?.state && resetTick === 0 ? installedItem.state : {}),
    };
    setPreviewState(base);
  }, [manifest.slug, isInstalled, resetTick]);

  // Fetch live data for installed HTTP-backed modules when domains are approved, otherwise fallback to realistic sample data
  useEffect(() => {
    let alive = true;
    const sample = SAMPLE_PREVIEW_DATA[manifest.slug] ?? {};
    setLiveData({ data: sample, isSample: Object.keys(sample).length > 0 });
    const hasSources = (manifest.dataSources?.length ?? 0) > 0;
    if (isInstalled && hasSources && (installedItem?.missingDomains.length ?? 0) === 0) {
      void (async () => {
        try {
          const r = (await notch.svc("custommod", "fetch", manifest.slug, false)) as {
            ok?: boolean;
            data?: Record<string, unknown>;
          } | null;
          if (alive && r && r.ok && r.data && Object.keys(r.data).length > 0) {
            setLiveData({ data: r.data, isSample: false });
          }
        } catch {
          /* keep sample fallback */
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [manifest.slug, isInstalled, installedItem?.approvedDomains.join(","), manifest.dataSources?.length]);

  // Mount real declarative OLED engine (`window.CustomModEngine.renderPreview`) for compact & expanded modes
  const configKey = JSON.stringify(liveConfig);
  const dataKey = JSON.stringify(liveData.data);
  useEffect(() => {
    const host = hostRef.current;
    handleRef.current?.destroy();
    handleRef.current = null;
    if (!host || mode === "pill") return;
    const eng = typeof window !== "undefined" ? window.CustomModEngine : undefined;
    if (!eng || typeof eng.renderPreview !== "function") return;
    const h = eng.renderPreview(host, manifest, {
      mode: mode === "expanded" ? "expanded" : "compact",
      state: stateRef.current,
      config: liveConfig,
      data: liveData.data,
      hideFooter: true,
      onStateChange: (next) => {
        setPreviewState({ ...next });
      },
    });
    handleRef.current = h;
    return () => {
      h?.destroy();
      handleRef.current = null;
    };
  }, [manifest, mode, resetTick, configKey, dataKey]);

  const pillEval: CustomModPillEval | null = useMemo(() => {
    if (!hasPill) return null;
    const eng = typeof window !== "undefined" ? window.CustomModEngine : undefined;
    if (!eng || typeof eng.evalPill !== "function") return null;
    return eng.evalPill(manifest, previewState, liveConfig, liveData.data);
  }, [hasPill, manifest, previewState, configKey, dataKey]);

  const accent = resolveAccentHex(manifest.accent);
  const sizeLabel = (manifest.defaultSize || "2x1").replace("x", "×");
  const pillActions = useMemo(() => localTestActions(manifest), [manifest]);
  const hasEngine = typeof window !== "undefined" && Boolean(window.CustomModEngine?.renderPreview);

  const runPillTestAction = (actionName: string) => {
    const eng = typeof window !== "undefined" ? window.CustomModEngine : undefined;
    if (!eng) return;
    // Apply local action identically to the Notch preview engine
    const anyEng = eng as unknown as {
      applyActionLocal?: (
        m: CustomModuleManifest,
        st: Record<string, unknown>,
        act: string,
        payload?: Record<string, unknown>
      ) => { state: Record<string, unknown> };
    };
    if (typeof anyEng.applyActionLocal === "function") {
      const res = anyEng.applyActionLocal(manifest, stateRef.current, actionName, {});
      setPreviewState({ ...res.state });
    }
  };

  const modeOptions = [
    { value: "compact", label: t("Dashboard") },
    { value: "expanded", label: t("Full Notch") },
    ...(hasPill ? [{ value: "pill", label: t("Closed Pill") }] : []),
  ];

  return (
    <div className="space-y-3">
      {/* Mode bar & active module info */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CustomModuleBadgeIcon icon={manifest.icon} accent={manifest.accent} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-foreground">{manifest.name}</span>
              <span className="shrink-0 rounded border border-border/80 bg-muted/70 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
                {sizeLabel}
              </span>
              {!isInstalled && (
                <span className="shrink-0 rounded-full border border-amber-500/35 bg-amber-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-amber-700 dark:text-amber-300">
                  {t("Template")}
                </span>
              )}
              {liveData.isSample && (manifest.dataSources?.length ?? 0) > 0 && (
                <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.2 text-[9.5px] font-medium text-sky-700 dark:text-sky-300">
                  {t("Sample data preview")}
                </span>
              )}
            </div>
          </div>
        </div>
        <SegmentedControl
          tone="neutral"
          size="sm"
          aria-label={t("Live Preview")}
          value={mode}
          options={modeOptions}
          onValueChange={(next) => setMode(next as PreviewMode)}
        />
      </div>

      {/* Authentic Dark OLED Hardware Stage */}
      <div
        data-preview-stage={manifest.slug}
        data-preview-mode={mode}
        style={{
          backgroundImage: `radial-gradient(ellipse 68% 58% at 50% 0%, color-mix(in srgb, ${accent} 18%, transparent), transparent 72%)`,
        }}
        className="relative flex min-h-[218px] w-full flex-col items-center justify-center overflow-hidden rounded-[14px] border border-black/15 bg-[#06070b] px-5 py-5 shadow-[0_14px_34px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] dark:border-white/[0.09] dark:shadow-[0_16px_38px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        {!hasEngine ? (
          <div key="preview-none" className="text-[12px] text-white/55">{t("Preview unavailable")}</div>
        ) : mode === "pill" ? (
          <div key="preview-pill" className="flex w-full max-w-[460px] flex-col items-center gap-4">
            {/* Simulated MacBook screen top bezel with authentic curved notch pill */}
            <div className="relative flex h-[96px] w-full flex-col items-center overflow-hidden rounded-[13px] border border-white/[0.08] bg-gradient-to-b from-[#171b26] via-[#0e1118] to-[#080a0f] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
              {/* Subtle macOS menubar row flanking the closed notch */}
              <div className="pointer-events-none absolute inset-x-3.5 top-2 flex items-center justify-between text-[10px] font-medium text-white/45 select-none">
                <span>Sympony</span>
                <span className="tabular-nums">9:41</span>
              </div>
              {/* Pure-black curved closed notch pill */}
              <div
                data-preview-pill
                className="notch-ears-sm relative z-10 inline-flex h-[32px] items-center rounded-b-[13px] bg-black px-3 shadow-[0_8px_22px_rgba(0,0,0,0.7)]"
              >
                <div className="flex min-w-[68px] items-center gap-1.5 pe-2">
                  {pillEval && (
                    <span
                      style={{ color: pillEval.accent }}
                      className="inline-flex size-3.5 shrink-0 items-center justify-center"
                      dangerouslySetInnerHTML={{
                        __html: window.CustomModEngine?.iconSvg(pillEval.icon, "width:12px;height:12px") ?? "",
                      }}
                    />
                  )}
                  <span className="max-w-[96px] truncate text-[11px] font-semibold tracking-[-0.01em] text-white/95">
                    {pillEval?.text ?? manifest.name}
                  </span>
                </div>
                {/* Camera cutout gap */}
                <div className="flex w-[64px] shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full bg-[#10131d] ring-1 ring-white/[0.1]" aria-hidden="true" />
                </div>
                <div className="flex min-w-[68px] items-center justify-end ps-2">
                  {pillEval?.right ? (
                    <span
                      style={{ color: pillToneColor(pillEval.tone, pillEval.accent) }}
                      className="max-w-[96px] truncate text-[11px] font-semibold tabular-nums"
                    >
                      {pillEval.right}
                    </span>
                  ) : (
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: accent }} />
                  )}
                </div>
              </div>
            </div>

            {pillActions.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span className="me-1 text-[10.5px] text-white/55">
                  {t("Try actions live on the closed notch pill:")}
                </span>
                {pillActions.map((act) => (
                  <button
                    key={act.name}
                    type="button"
                    onClick={() => runPillTestAction(act.name)}
                    className="cursor-pointer rounded-[8px] border border-white/[0.12] bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/90 transition-colors hover:bg-white/[0.16] active:scale-[0.97]"
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : mode === "expanded" ? (
          <div key="preview-expanded" className="relative flex w-full max-w-[560px] flex-col items-center overflow-hidden rounded-[14px] border border-white/[0.08] bg-gradient-to-b from-[#171b26] via-[#0e1118] to-[#080a0f] px-4 pb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
            <div className="notch-ears w-full max-w-[500px] rounded-b-[22px] border-x border-b border-white/[0.11] bg-black px-5 pt-4 pb-4 shadow-[0_18px_42px_rgba(0,0,0,0.78)]">
              <div ref={hostRef} className="w-full" />
            </div>
          </div>
        ) : (
          <div
            key="preview-compact"
            className={cn(
              "rounded-[18px] border border-white/[0.09] bg-[#0d0e13] p-3.5 shadow-[0_14px_34px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)]",
              cardWidthClass(manifest.defaultSize)
            )}
          >
            <div ref={hostRef} className="w-full" />
          </div>
        )}
      </div>

      {/* Interactive footer bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              liveData.isSample && (manifest.dataSources?.length ?? 0) > 0
                ? "bg-sky-500 shadow-[0_0_7px_rgba(14,165,233,0.75)]"
                : "bg-emerald-500 shadow-[0_0_7px_rgba(16,185,129,0.75)]"
            )}
            aria-hidden="true"
          />
          <span>
            {liveData.isSample && (manifest.dataSources?.length ?? 0) > 0
              ? t("Sample data preview · Install for live HTTPS updates")
              : t("Click controls above to interact live")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            icon={<RotateCw />}
            onClick={() => setResetTick((n) => n + 1)}
          >
            {t("Reset preview")}
          </Button>
          {isInstalled ? (
            <>
              <Button
                size="xs"
                variant="secondary"
                icon={<ExternalLink />}
                onClick={() => void notch.svc("custommod", "openInNotch", manifest.slug)}
              >
                {t("Open in Notch")}
              </Button>
              <Button
                size="xs"
                variant="secondary"
                icon={<Sparkles />}
                onClick={() => onOpenCreator(`Edit custom module custom:${manifest.slug}: `)}
              >
                {t("Edit with Pony")}
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="primary"
              disabled={busy}
              className="bg-gradient-to-b from-blue-500 to-blue-600 shadow-[0_1px_2px_rgba(37,99,235,0.34),inset_0_1px_0_rgba(255,255,255,0.22)] hover:from-blue-500/95 hover:to-blue-600/95"
              onClick={() => void onInstallTemplate(manifest.slug)}
            >
              {t("Install")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomModulesStudio({
  items,
  templates,
  onChanged,
}: {
  items: CustomModuleSummary[];
  templates: CustomModuleManifest[];
  onChanged: () => Promise<void>;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const importRef = useRef<HTMLInputElement>(null);
  const previewCardRef = useRef<HTMLDivElement>(null);

  const installedBySlug = useMemo(() => new Map(items.map((x) => [x.slug, x])), [items]);
  const templateBySlug = useMemo(() => new Map(templates.map((x) => [x.slug, x])), [templates]);

  // Auto-select first installed module, or Mochi Pet / first starter template when none installed
  useEffect(() => {
    if (selectedSlug && (installedBySlug.has(selectedSlug) || templateBySlug.has(selectedSlug))) return;
    if (items.length > 0) {
      setSelectedSlug(items[0].slug);
    } else if (templates.length > 0) {
      setSelectedSlug(templates[0].slug);
    }
  }, [selectedSlug, items, templates, installedBySlug, templateBySlug]);

  const activeInstalled = installedBySlug.get(selectedSlug);
  const activeManifest = activeInstalled?.manifest ?? templateBySlug.get(selectedSlug) ?? items[0]?.manifest ?? templates[0] ?? null;

  const activeLiveConfig = useMemo(() => {
    if (!activeInstalled) return {};
    return { ...(activeInstalled.config ?? {}), ...(drafts[activeInstalled.slug] ?? {}) };
  }, [activeInstalled, drafts]);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 3200);
  };

  const openCreator = (prompt = "") => {
    void notch.svc("custommod", "openCreator", prompt);
  };

  const selectPreview = (slug: string, scrollUp = false) => {
    setSelectedSlug(slug);
    if (scrollUp) {
      previewCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const getDraft = (m: CustomModuleSummary, key: string, fallback: unknown) => {
    const map = drafts[m.slug];
    if (map && key in map) return map[key];
    if (m.config && key in m.config) return m.config[key];
    return fallback ?? "";
  };

  const setDraft = (slug: string, key: string, val: unknown) => {
    setDrafts((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] ?? {}), [key]: val },
    }));
  };

  const saveConfig = async (m: CustomModuleSummary, patch: Record<string, unknown>, secretPatch?: Record<string, string>) => {
    setBusySlug(m.slug);
    try {
      await notch.svc("custommod", "configSet", m.slug, patch, secretPatch ?? {});
      await onChanged();
    } finally {
      setBusySlug(null);
    }
  };

  const toggleDomain = async (m: CustomModuleSummary, domain: string, allow: boolean) => {
    const cur = new Set(m.approvedDomains.map((d) => d.toLowerCase()));
    if (allow) cur.add(domain.toLowerCase());
    else cur.delete(domain.toLowerCase());
    setBusySlug(m.slug);
    try {
      await notch.svc("custommod", "approveDomains", m.slug, Array.from(cur));
      await onChanged();
    } finally {
      setBusySlug(null);
    }
  };

  const resetState = async (slug: string) => {
    setBusySlug(slug);
    try {
      await notch.svc("custommod", "resetState", slug);
      await onChanged();
    } finally {
      setBusySlug(null);
    }
  };

  const removeMod = async (slug: string) => {
    setBusySlug(slug);
    try {
      await notch.svc("custommod", "delete", slug);
      if (openSlug === slug) setOpenSlug(null);
      await onChanged();
    } finally {
      setBusySlug(null);
    }
  };

  const togglePinPill = async (m: CustomModuleSummary) => {
    setBusySlug(m.slug);
    try {
      await notch.svc("custommod", "pinPill", m.pinnedPill ? "" : m.slug);
      await onChanged();
    } finally {
      setBusySlug(null);
    }
  };

  const exportMod = async (slug: string) => {
    setBusySlug(slug);
    try {
      const res = (await notch.svc("custommod", "export", slug)) as { ok?: boolean; bundle?: unknown } | null;
      if (res && res.ok && res.bundle) {
        const text = JSON.stringify(res.bundle, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          flashNotice(t("Exported JSON copied to clipboard"));
        }
      }
    } finally {
      setBusySlug(null);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setBusySlug("__import");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = (await notch.svc("custommod", "import", parsed, true)) as {
        ok?: boolean;
        slug?: string;
        error?: string;
      } | null;
      if (res && res.ok) {
        await onChanged();
        if (res.slug) setSelectedSlug(res.slug);
        flashNotice(t("Imported custom module"));
      } else if (res && res.error) {
        flashNotice(res.error);
      }
    } catch (e) {
      flashNotice(String(e instanceof Error ? e.message : e));
    } finally {
      setBusySlug(null);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const installTemplate = async (slug: string) => {
    setBusySlug(slug);
    try {
      const res = (await notch.svc("custommod", "installTemplate", slug)) as { ok?: boolean } | null;
      if (res && res.ok) {
        await onChanged();
        setSelectedSlug(slug);
      }
    } finally {
      setBusySlug(null);
    }
  };

  // Unified switcher chips: installed modules first, then uninstalled starter templates
  const switcherEntries = useMemo(() => {
    const list: { slug: string; name: string; accent?: string; isTemplate: boolean }[] = [];
    for (const m of items) {
      list.push({ slug: m.slug, name: m.manifest.name, accent: m.manifest.accent, isTemplate: false });
    }
    for (const tpl of templates) {
      if (!installedBySlug.has(tpl.slug)) {
        list.push({ slug: tpl.slug, name: tpl.name, accent: tpl.accent, isTemplate: true });
      }
    }
    return list;
  }, [items, templates, installedBySlug]);

  const galleryItems = useMemo(() => {
    if (templates.length > 0) {
      return templates.map((tpl) => ({
        slug: tpl.slug,
        name: tpl.name,
        size: (tpl.defaultSize || "2x1").replace("x", "×"),
        desc: STARTER_META[tpl.slug]?.desc ?? tpl.description,
        icon: tpl.icon,
        accent: tpl.accent,
        hasManifest: true,
      }));
    }
    return STARTER_FALLBACK.map((tpl) => ({ ...tpl, hasManifest: false }));
  }, [templates]);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Live Interactive OLED Preview Studio */}
      <div ref={previewCardRef}>
        <PanelCard
          title={t("Live Preview")}
          icon={groupIcon("Live Preview")}
          description={t("Pick any installed module or starter template to preview live with animations, particles, and closed-notch pill.")}
        >
          {switcherEntries.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {switcherEntries.map((entry) => {
                const on = activeManifest?.slug === entry.slug;
                const dotHex = resolveAccentHex(entry.accent);
                return (
                  <button
                    key={entry.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => selectPreview(entry.slug)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all",
                      on
                        ? "border-primary/60 bg-primary/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-primary/25"
                        : "border-border/80 bg-muted/35 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: dotHex }}
                      aria-hidden="true"
                    />
                    <span className="max-w-[140px] truncate">{entry.name}</span>
                    {entry.isTemplate && (
                      <span className="rounded bg-background/80 px-1 py-px text-[9px] font-medium text-muted-foreground">
                        {t("Template")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {activeManifest ? (
            <CustomModulePreviewStage
              manifest={activeManifest}
              isInstalled={Boolean(activeInstalled)}
              installedItem={activeInstalled}
              liveConfig={activeLiveConfig}
              busy={busySlug === activeManifest.slug}
              onInstallTemplate={installTemplate}
              onOpenCreator={openCreator}
            />
          ) : (
            <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border/80 bg-muted/20 p-5 text-center">
              <div className="text-[12.5px] text-muted-foreground">
                {t("No custom modules installed yet. Turn on Creator mode in Pony Chat or start from an idea below:")}
              </div>
            </div>
          )}
        </PanelCard>
      </div>

      {/* 2. Installed Custom Modules Management */}
      <PanelCard
        title={t("Installed Modules")}
        icon={groupIcon("Installed Modules")}
        description={t("Local OLED widgets created by Pony. Built-in modules stay protected and unchanged.")}
        action={
          <div className="flex items-center gap-1.5">
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void handleImportFile(e.target.files?.[0])}
            />
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload />}
              disabled={busySlug === "__import"}
              onClick={() => importRef.current?.click()}
            >
              {t("Import JSON")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Sparkles />}
              className="bg-gradient-to-b from-blue-500 to-blue-600 shadow-[0_1px_2px_rgba(37,99,235,0.34),inset_0_1px_0_rgba(255,255,255,0.22)] hover:from-blue-500/95 hover:to-blue-600/95"
              onClick={() => openCreator("")}
            >
              {t("Create with Pony")}
            </Button>
          </div>
        }
      >
        {notice && (
          <div className="mb-3 rounded-[9px] border border-primary/25 bg-primary/[0.07] px-3 py-1.5 text-[12px] font-medium text-foreground">
            {notice}
          </div>
        )}
        {items.length === 0 ? (
          <div className="space-y-3 py-1">
            <div className="text-[12.5px] text-muted-foreground">
              {t("No custom modules installed yet. Turn on Creator mode in Pony Chat or start from an idea below:")}
            </div>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Button
                  key={s.label}
                  size="xs"
                  variant="secondary"
                  icon={<Sparkles />}
                  onClick={() => openCreator(s.prompt)}
                >
                  {t(s.label)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/80">
            {items.map((m) => {
              const expanded = openSlug === m.slug;
              const isPreviewing = activeManifest?.slug === m.slug;
              const fields = m.manifest.configSchema ?? [];
              const domains = m.manifest.permissions?.httpDomains ?? [];
              const busy = busySlug === m.slug;
              return (
                <div
                  key={m.slug}
                  className={cn(
                    "py-2.5 first:pt-0 last:pb-0 transition-colors",
                    isPreviewing && "rounded-[10px]"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenSlug(expanded ? null : m.slug)}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={expanded ? t("Collapse") : t("Expand")}
                    >
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPreview(m.slug, true)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-start"
                    >
                      <CustomModuleBadgeIcon icon={m.manifest.icon} accent={m.manifest.accent} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {m.manifest.name}
                          </span>
                          <span className="rounded-md border border-border/80 bg-muted/75 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                            {m.id}
                          </span>
                          {isPreviewing && (
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.2 text-[9.5px] font-semibold text-primary">
                              {t("Previewing")}
                            </span>
                          )}
                          {m.missingDomains.length > 0 && (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                              {t("Needs HTTPS approval")}
                            </span>
                          )}
                        </div>
                        <div className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                          {m.manifest.description}
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="xs"
                        variant={isPreviewing ? "secondary" : "ghost"}
                        icon={<Eye />}
                        title={t("Preview")}
                        aria-label={t("Preview")}
                        className={isPreviewing ? "border-primary/35 bg-primary/10 text-primary" : "text-muted-foreground dark:text-zinc-300/80"}
                        onClick={() => selectPreview(m.slug, true)}
                      />
                      {Boolean(m.manifest.view?.pill) && (
                        <Button
                          size="xs"
                          variant={m.pinnedPill ? "secondary" : "ghost"}
                          icon={<ThumbtackIcon />}
                          disabled={busy}
                          title={m.pinnedPill ? t("Pinned in closed notch") : t("Pin to closed notch")}
                          aria-label={m.pinnedPill ? t("Pinned in closed notch") : t("Pin to closed notch")}
                          className={m.pinnedPill ? "border-primary/35 bg-primary/10 text-primary" : "text-muted-foreground dark:text-zinc-300/80"}
                          onClick={() => void togglePinPill(m)}
                        />
                      )}
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<ExternalLink />}
                        disabled={busy}
                        title={t("Open in Notch")}
                        aria-label={t("Open in Notch")}
                        className="text-muted-foreground dark:text-zinc-300/80"
                        onClick={() => void notch.svc("custommod", "openInNotch", m.slug)}
                      />
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={<Sparkles />}
                        disabled={busy}
                        className="shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                        onClick={() => openCreator(`Edit custom module ${m.id}: `)}
                      >
                        {t("Edit with Pony")}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Download />}
                        disabled={busy}
                        title={t("Export JSON")}
                        aria-label={t("Export JSON")}
                        onClick={() => void exportMod(m.slug)}
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<RotateCw />}
                        disabled={busy}
                        title={t("Reset saved state")}
                        aria-label={t("Reset saved state")}
                        onClick={() => void resetState(m.slug)}
                      />
                      <span className="mx-0.5 h-4 w-px bg-border/80" aria-hidden="true" />
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Trash2 />}
                        disabled={busy}
                        title={t("Delete custom module")}
                        aria-label={t("Delete custom module")}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void removeMod(m.slug)}
                      />
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 ms-8 space-y-3.5 rounded-[11px] border border-border/75 bg-muted/25 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-none">
                      {domains.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
                            {t("HTTPS network permissions")}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {domains.map((dom) => {
                              const allowed = m.approvedDomains.some(
                                (a) => a.toLowerCase() === dom.toLowerCase()
                              );
                              return (
                                <div
                                  key={dom}
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                                    allowed
                                      ? "border-primary/35 bg-primary/[0.06]"
                                      : "border-border/80 bg-background"
                                  )}
                                >
                                  <Globe
                                    className={cn("size-3 shrink-0", allowed ? "text-primary" : "text-muted-foreground/70")}
                                    aria-hidden="true"
                                  />
                                  <span className="font-mono text-foreground">{dom}</span>
                                  <Switch
                                    checked={allowed}
                                    aria-label={dom}
                                    onCheckedChange={(checked) => void toggleDomain(m, dom, checked)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {fields.length > 0 ? (
                        <div className={domains.length > 0 ? "space-y-2.5 border-t border-border/60 pt-3.5" : "space-y-2.5"}>
                          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
                            {t("Module configuration")}
                          </div>
                          {fields.map((f) => {
                            if (f.type === "secret") {
                              const hasSecret = m.secretKeysConfigured.includes(f.key);
                              return (
                                <div key={f.key} className="flex items-center justify-between gap-3">
                                  <span className="text-[12.5px] text-foreground">{f.label}</span>
                                  <CustomSecretInput
                                    hasValue={hasSecret}
                                    label={f.label}
                                    placeholder={f.placeholder}
                                    onSave={(val) => saveConfig(m, {}, { [f.key]: val })}
                                  />
                                </div>
                              );
                            }
                            if (f.type === "toggle") {
                              const checked = Boolean(getDraft(m, f.key, f.default));
                              return (
                                <div key={f.key} className="flex items-center justify-between gap-3">
                                  <span className="text-[12.5px] text-foreground">{f.label}</span>
                                  <Switch
                                    checked={checked}
                                    aria-label={f.label}
                                    onCheckedChange={(v) => {
                                      setDraft(m.slug, f.key, v);
                                      void saveConfig(m, { [f.key]: v });
                                    }}
                                  />
                                </div>
                              );
                            }
                            if (f.type === "select") {
                              const val = String(getDraft(m, f.key, f.default ?? ""));
                              return (
                                <div key={f.key} className="flex items-center justify-between gap-3">
                                  <span className="text-[12.5px] text-foreground">{f.label}</span>
                                  <select
                                    aria-label={f.label}
                                    value={val}
                                    onChange={(e) => {
                                      setDraft(m.slug, f.key, e.target.value);
                                      void saveConfig(m, { [f.key]: e.target.value });
                                    }}
                                    className={INPUT_CLASS}
                                  >
                                    {(f.options ?? []).map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            }
                            const val = String(getDraft(m, f.key, f.default ?? ""));
                            return (
                              <div key={f.key} className="flex items-center justify-between gap-3">
                                <span className="text-[12.5px] text-foreground">{f.label}</span>
                                <input
                                  type={f.type === "number" ? "number" : "text"}
                                  aria-label={f.label}
                                  placeholder={f.placeholder ?? ""}
                                  value={val}
                                  onChange={(e) => setDraft(m.slug, f.key, e.target.value)}
                                  onBlur={() => {
                                    const next = f.type === "number" ? Number(val) || 0 : val.trim();
                                    void saveConfig(m, { [f.key]: next });
                                  }}
                                  className={INPUT_CLASS}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : domains.length === 0 ? (
                        <div className="text-[12px] text-muted-foreground">
                          {t("This module runs locally with no extra configuration required.")}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PanelCard>

      {/* 3. Starter Templates Gallery with 1-Click Live Preview & Install */}
      <PanelCard
        title={t("Starter Templates")}
        icon={groupIcon("Starter Templates")}
        description={t("Preview any template live before installing in one click.")}
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {galleryItems.map((tpl) => {
            const installed = installedBySlug.has(tpl.slug);
            const previewing = activeManifest?.slug === tpl.slug;
            return (
              <div
                key={tpl.slug}
                className={cn(
                  "flex flex-col justify-between gap-3 rounded-[11px] border p-3 transition-colors",
                  previewing
                    ? "border-primary/45 bg-primary/[0.04] ring-1 ring-primary/20"
                    : "border-border/75 bg-muted/25 hover:bg-muted/40"
                )}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <CustomModuleBadgeIcon icon={tpl.icon} accent={tpl.accent} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-foreground">
                          {tpl.name}
                        </span>
                        <span className="shrink-0 rounded border border-border/80 bg-background/80 px-1 py-0.2 font-mono text-[9.5px] text-muted-foreground">
                          {tpl.size}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                    {t(tpl.desc)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 border-t border-border/60 pt-2.5">
                  <Button
                    size="xs"
                    variant={previewing ? "secondary" : "ghost"}
                    icon={<Eye />}
                    disabled={!tpl.hasManifest && !installed}
                    className={previewing ? "border-primary/35 bg-primary/10 text-primary" : ""}
                    onClick={() => selectPreview(tpl.slug, true)}
                  >
                    {previewing ? t("Previewing") : t("Preview")}
                  </Button>
                  {installed ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                      <Check className="size-3" aria-hidden="true" />
                      {t("Installed")}
                    </span>
                  ) : (
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busySlug === tpl.slug}
                      onClick={() => void installTemplate(tpl.slug)}
                    >
                      {t("Install")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PanelCard>
    </div>
  );
}
