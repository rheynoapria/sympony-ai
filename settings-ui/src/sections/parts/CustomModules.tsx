import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe, KeyRound, RotateCw, Sparkles, Trash2 } from "@/components/icons";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";

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
}: {
  icon?: string;
  accent?: string;
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
      className="grid size-8 shrink-0 place-items-center rounded-[9px]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
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
  id: string;
  name: string;
  description: string;
  icon: string;
  accent?: string;
  defaultSize?: string;
  permissions?: { httpDomains?: string[] };
  configSchema?: CustomConfigField[];
}

export interface CustomModuleSummary {
  slug: string;
  id: string;
  manifest: CustomModuleManifest;
  approvedDomains: string[];
  missingDomains: string[];
  secretKeysConfigured: string[];
  config: Record<string, unknown>;
}

const STARTERS = [
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
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<CustomModuleSummary[]>([]);

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
    const off = notch.on("custommod:changed", () => {
      void refresh();
    });
    return off;
  }, []);

  return { items, refresh };
}

export function CustomModulesPanel({
  items,
  onChanged,
}: {
  items: CustomModuleSummary[];
  onChanged: () => Promise<void>;
}) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});

  const openCreator = (prompt = "") => {
    void notch.svc("custommod", "openCreator", prompt);
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

  return (
    <PanelCard
      title={t("Custom Modules")}
      icon={groupIcon("Custom Modules")}
      description={t("Local OLED widgets created by Pony. Built-in modules stay protected and unchanged.")}
      action={
        <Button
          size="sm"
          variant="primary"
          icon={<Sparkles />}
          className="bg-gradient-to-b from-blue-500 to-blue-600 shadow-[0_1px_2px_rgba(37,99,235,0.34),inset_0_1px_0_rgba(255,255,255,0.22)] hover:from-blue-500/95 hover:to-blue-600/95"
          onClick={() => openCreator("")}
        >
          {t("Create with Pony")}
        </Button>
      }
    >
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
            const fields = m.manifest.configSchema ?? [];
            const domains = m.manifest.permissions?.httpDomains ?? [];
            const busy = busySlug === m.slug;
            return (
              <div key={m.slug} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setOpenSlug(expanded ? null : m.slug)}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={expanded ? t("Collapse") : t("Expand")}
                  >
                    {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                  <CustomModuleBadgeIcon icon={m.manifest.icon} accent={m.manifest.accent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {m.manifest.name}
                      </span>
                      <span className="rounded-md border border-border/80 bg-muted/75 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                        {m.id}
                      </span>
                      {m.missingDomains.length > 0 && (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                          {t("Needs HTTPS approval")}
                        </span>
                      )}
                    </div>
                    <div className="line-clamp-2 text-[12px] text-muted-foreground">
                      {m.manifest.description}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<ExternalLink />}
                      disabled={busy}
                      title={t("Open in Notch")}
                      aria-label={t("Open in Notch")}
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
                  <div className="mt-3 ms-9 space-y-3.5 rounded-[11px] border border-border/75 bg-muted/25 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-none">
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
                                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                                  allowed
                                    ? "border-primary/35 bg-primary/[0.06]"
                                    : "border-border/80 bg-background"
                                }`}
                              >
                                <Globe className={`size-3 shrink-0 ${allowed ? "text-primary" : "text-muted-foreground/70"}`} aria-hidden="true" />
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
                                  const next =
                                    f.type === "number" ? Number(val) || 0 : val.trim();
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
  );
}
