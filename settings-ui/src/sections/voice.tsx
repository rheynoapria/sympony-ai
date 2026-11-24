import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Mic, ShieldCheck, Trash2, X } from "@/components/icons";
import { Badge } from "@/components/ui/knowns/badge";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { StatusDot } from "@/components/ui/knowns/status-dot";
import { Switch } from "@/components/ui/knowns/switch";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { VOICE_ROWS } from "./voice.rows";
import { DictionaryManager } from "./voice/DictionaryManager";
import { KeyPicker } from "./voice/KeyPicker";
import {
  ModelCard,
  type DownloadProgress,
  type VoiceModelInfo,
} from "./voice/ModelCard";
import type { UserDict } from "./voice/dictionary";

interface VoiceStatus {
  enabled: boolean;
  state: string;
  tier: string;
  live: boolean;
  ramGb: number;
  lightSuggested: boolean;
  models: VoiceModelInfo[];
  vocabMissing: string[];
  permissions: {
    microphone: string;
    accessibility: string;
  };
  activeDownload: DownloadProgress | null;
}

const DEFAULT_DICT: UserDict = { version: 1, terms: [], replacements: [] };

export function mergeDownloadProgress(
  prev: DownloadProgress | null,
  incoming: DownloadProgress,
  fallbackSize: number
): DownloadProgress {
  const total = incoming.total > 0 ? incoming.total : prev?.id === incoming.id && prev.total > 0 ? prev.total : fallbackSize;
  const sameId = prev && prev.id === incoming.id && prev.status === "downloading";
  const done = sameId ? Math.max(prev.done, incoming.done) : incoming.done;
  return {
    ...incoming,
    total,
    done: total > 0 ? Math.min(total, Math.max(0, done)) : Math.max(0, done),
  };
}

function VoiceBody({ settings, set, os }: CustomPartProps) {
  // (Windows has no Accessibility permission: its step and row aren't shown there)
  const win = os === "windows";
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [dict, setDict] = useState<UserDict>(DEFAULT_DICT);
  const [downloadProg, setDownloadProg] = useState<DownloadProgress | null>(null);
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [liveState, setLiveState] = useState<string>("idle");
  const [livePartial, setLivePartial] = useState<string>("");
  const [rms, setRms] = useState<number>(0);
  const [cloudKey, setCloudKey] = useState<string>("");
  const [showSetup, setShowSetup] = useState<boolean>(false);
  const [historyCleared, setHistoryCleared] = useState<boolean>(false);

  const lastSeqRef = useRef<number>(0);
  const modelsRef = useRef<VoiceModelInfo[]>([]);
  modelsRef.current = status?.models ?? [];

  const applyStatusSnapshot = useCallback((st: VoiceStatus | null | undefined) => {
    if (!st || typeof st !== "object") return;
    setStatus(st);
    const active = st.activeDownload;
    if (active && active.status === "downloading") {
      const incomingSeq = typeof active.seq === "number" ? active.seq : 0;
      // Only hydrate from status polling if we haven't already seen a newer live event.
      if (incomingSeq === 0 || incomingSeq > lastSeqRef.current) {
        if (incomingSeq > 0) lastSeqRef.current = incomingSeq;
        const size = st.models?.find((m) => m.id === active.id)?.size ?? 0;
        setDownloadProg((prev) => {
          if (incomingSeq === 0 && prev !== null) return prev;
          return mergeDownloadProgress(prev, active, size);
        });
      }
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const st = (await notch.svc("voice", "status")) as VoiceStatus;
      applyStatusSnapshot(st);
    } catch {
      /* mock or offline */
    }
  }, [applyStatusSnapshot]);

  const refresh = useCallback(async () => {
    try {
      const [st, devs, d] = await Promise.all([
        notch.svc("voice", "status") as Promise<VoiceStatus>,
        notch.svc("voice", "devices") as Promise<string[]>,
        notch.svc("voice", "dict") as Promise<UserDict>,
      ]);
      applyStatusSnapshot(st);
      if (Array.isArray(devs)) setDevices(devs);
      if (d && Array.isArray(d.terms)) {
        setDict({
          version: d.version ?? 1,
          terms: d.terms,
          replacements: d.replacements ?? [],
        });
      }
    } catch {
      /* mock or offline */
    }
  }, [applyStatusSnapshot]);

  useEffect(() => {
    refresh();
    const u1 = notch.on("voice:download", (p) => {
      const info = p as DownloadProgress | null;
      if (!info) return;
      if (typeof info.seq === "number" && info.seq > 0) {
        if (info.seq < lastSeqRef.current) return;
        lastSeqRef.current = info.seq;
      }
      if (info.status === "downloading") {
        setDownloadErrors((prev) => {
          if (!(info.id in prev)) return prev;
          const next = { ...prev };
          delete next[info.id];
          return next;
        });
        const fallback = modelsRef.current.find((m) => m.id === info.id)?.size ?? 0;
        setDownloadProg((prev) => mergeDownloadProgress(prev, info, fallback));
      } else if (info.status === "error") {
        setDownloadErrors((prev) => ({
          ...prev,
          [info.id]: info.error || t("Download failed"),
        }));
        setDownloadProg(null);
        void refreshStatus();
      } else if (info.status === "done") {
        setDownloadErrors((prev) => {
          if (!(info.id in prev)) return prev;
          const next = { ...prev };
          delete next[info.id];
          return next;
        });
        const nextId = info.queued?.[0];
        if (nextId) {
          const nextSize = modelsRef.current.find((m) => m.id === nextId)?.size ?? 0;
          setDownloadProg({
            id: nextId,
            done: 0,
            total: nextSize,
            phase: "downloading",
            status: "downloading",
            queued: info.queued?.slice(1) ?? [],
            seq: info.seq,
          });
        } else {
          setDownloadProg(null);
        }
        void refreshStatus();
      } else {
        setDownloadProg(null);
        void refreshStatus();
      }
    });
    const u2 = notch.on("voice:state", (p) => {
      const info = p as { state?: string; text?: string } | null;
      if (info?.state) setLiveState(info.state);
      if (info?.state === "idle" || info?.state === "cancelled") {
        setLivePartial("");
        setRms(0);
      }
    });
    const u3 = notch.on("voice:partial", (p) => {
      const info = p as { text?: string } | null;
      if (info?.text) setLivePartial(info.text);
    });
    const u4 = notch.on("voice:level", (p) => {
      const info = p as { rms?: number } | null;
      if (typeof info?.rms === "number") setRms(info.rms);
    });
    const u5 = notch.on("voice:perm", () => {
      void refreshStatus();
    });
    const onFocus = () => {
      void refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, refreshStatus]);

  const isAnyDownloading = downloadProg?.status === "downloading";

  useEffect(() => {
    const micOk = status?.permissions?.microphone === "granted";
    const axOk = status?.permissions?.accessibility === "granted";
    if ((micOk && axOk) || isAnyDownloading) return;
    const iv = window.setInterval(refreshStatus, 2000);
    return () => window.clearInterval(iv);
  }, [status?.permissions?.microphone, status?.permissions?.accessibility, isAnyDownloading, refreshStatus]);

  const enabled = Boolean(settings.voiceEnabled);
  const tierRaw = String(settings.voiceTier || "auto");
  const tier = tierRaw === "auto" ? "hybrid" : tierRaw;
  const live = settings.voiceLive !== false;
  const keepLoaded = Boolean(settings.voiceKeepLoaded);
  const threads = String(settings.voiceThreads ?? 0);
  const cloudRegion = String(settings.voiceCloudRegion || "intl");
  const hasCloudKey = Boolean(settings.has_voiceCloudKey);
  const voiceKey = String(settings.voiceKey || "right_option");
  const commandKey = String(settings.voiceCommandKey || "");
  const lang = String(settings.voiceLanguage || "id");
  const insertMode = String(settings.voiceInsert || "auto");
  const units = String(settings.voiceUnits || "symbols");
  const spokenPunct = settings.voiceSpokenPunct !== false;
  const jargon = Boolean(settings.voiceJargon);
  const history = Boolean(settings.voiceHistory);
  const device = String(settings.voiceDevice || "");

  const models = status?.models ?? [];
  const offer17b = models.some((m) => m.id === "1.7b" && m.offered);
  const qwenModel = models.find((m) => m.id === (tier === "1.7b" ? "1.7b" : "0.6b"));
  const zfModel = models.find((m) => m.id === "zf-id");
  const needsSetup =
    !zfModel?.downloaded ||
    (tier !== "light" && tier !== "cloud" && !qwenModel?.downloaded) ||
    status?.permissions?.microphone !== "granted" ||
    status?.permissions?.accessibility !== "granted";

  const handleToggleEnabled = async (next: boolean) => {
    await set({ voiceEnabled: next });
    if (next && needsSetup) {
      setShowSetup(true);
    } else if (!next) {
      setShowSetup(false);
    }
  };

  const handleDownload = async (id: string) => {
    setDownloadErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const size = models.find((m) => m.id === id)?.size ?? 0;
    setDownloadProg((prev) => {
      if (prev && prev.status === "downloading") {
        if (prev.id === id || prev.queued?.includes(id)) return prev;
        return { ...prev, queued: [...(prev.queued ?? []), id] };
      }
      return { id, done: 0, total: size, phase: "downloading", status: "downloading", queued: [] };
    });
    await notch.svc("voice", "download", id);
  };

  const handleDownloadAllMissing = async (missing: VoiceModelInfo[]) => {
    if (missing.length === 0) return;
    setDownloadErrors({});
    const [first, ...rest] = missing;
    setDownloadProg((prev) => {
      if (prev && prev.status === "downloading") return prev;
      return {
        id: first.id,
        done: 0,
        total: first.size,
        phase: "downloading",
        status: "downloading",
        queued: rest.map((m) => m.id),
      };
    });
    for (const m of missing) {
      await notch.svc("voice", "download", m.id);
    }
  };

  const handleCancelDownload = async () => {
    await notch.svc("voice", "cancelDownload");
    setDownloadProg(null);
  };

  const handleDeleteModel = async (id: string) => {
    await notch.svc("voice", "deleteModel", id);
    await refreshStatus();
  };

  const handleSaveDict = async (next: UserDict) => {
    setDict(next);
    await notch.svc("voice", "dictSave", next);
  };

  const handleFixPerm = async (kind: "microphone" | "accessibility") => {
    await notch.svc("perm", "request", kind);
    window.setTimeout(refresh, 900);
  };

  const saveCloudKey = async () => {
    await notch.setSecret("voiceCloudKey", cloudKey.trim());
    setCloudKey("");
    await refresh();
  };

  const tierOptions = [
    { value: "hybrid", label: t("Hybrid (recommended)") },
    { value: "light", label: t("Light (Zipformer only)") },
    ...(offer17b ? [{ value: "1.7b", label: t("More accurate (1.7B)") }] : []),
    { value: "cloud", label: t("Cloud (DashScope)") },
  ];

  const neededModels = models.filter((m) => {
    if (tier === "light") return m.id === "zf-id";
    if (tier === "1.7b") return (live && m.id === "zf-id") || m.id === "1.7b";
    if (tier === "cloud") return live && m.id === "zf-id";
    return (live && m.id === "zf-id") || m.id === "0.6b";
  });

  const micGranted = status?.permissions?.microphone === "granted";
  const axGranted = status?.permissions?.accessibility === "granted";
  const missingModels = neededModels.filter((m) => !m.downloaded);
  const modelsReady = neededModels.length > 0 ? missingModels.length === 0 : false;
  const activeSetupPct =
    isAnyDownloading && downloadProg && downloadProg.total > 0
      ? Math.min(100, Math.round((downloadProg.done / downloadProg.total) * 100))
      : 0;
  const levelPct = Math.min(100, Math.round(Math.pow(Math.min(1, rms * 4.5), 0.65) * 100));

  return (
    <div className="flex flex-col gap-5">
      {/* Master toggle */}
      <PanelCard>
        <div className="px-5 py-1">
          <SettingsRow
            label={t("Voice dictation")}
            description={win ? t("Speak Indonesian anywhere on your PC, completely on-device") : t("Speak Indonesian anywhere on your Mac, completely on-device")}
          >
            <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
          </SettingsRow>
        </div>
      </PanelCard>

      {/* First-time 3-step setup flow */}
      {(showSetup || (enabled && needsSetup)) && (
        <PanelCard title={t("Voice setup")} icon={groupIcon("Voice setup")}>
          <div className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                <StatusDot
                  state={isAnyDownloading ? "busy" : "idle"}
                  tone={modelsReady ? "success" : isAnyDownloading ? "accent" : "warning"}
                />
                <span>{t("Step 1: Download speech models")}</span>
              </div>
              {modelsReady ? (
                <Badge variant="soft" tone="success">
                  <Check className="mr-1 size-3" />
                  {t("Done")}
                </Badge>
              ) : isAnyDownloading ? (
                <div className="flex items-center gap-2">
                  <Badge variant="soft" tone="info" className="tabular-nums">
                    {downloadProg?.phase === "verifying"
                      ? t("Verifying…")
                      : `${t("Downloading…")} ${activeSetupPct}%`}
                  </Badge>
                  <Button size="sm" variant="secondary" icon={<X />} onClick={handleCancelDownload}>
                    {t("Cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    void handleDownloadAllMissing(missingModels);
                  }}
                >
                  {t("Download")}
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                <StatusDot tone={micGranted ? "success" : "warning"} />
                <span>{t("Step 2: Allow Microphone access")}</span>
              </div>
              {micGranted ? (
                <Badge variant="soft" tone="success">
                  <Check className="mr-1 size-3" />
                  {t("Granted")}
                </Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => handleFixPerm("microphone")}>
                  {t("Allow")}
                </Button>
              )}
            </div>

            {!win && (
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                <StatusDot tone={axGranted ? "success" : "warning"} />
                <span>{t("Step 3: Allow Accessibility for trigger and paste")}</span>
              </div>
              {axGranted ? (
                <Badge variant="soft" tone="success">
                  <Check className="mr-1 size-3" />
                  {t("Granted")}
                </Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => handleFixPerm("accessibility")}>
                  {t("Allow")}
                </Button>
              )}
            </div>
            )}

            {modelsReady && micGranted && axGranted && (
              <div className="flex justify-end pt-1">
                <Button size="sm" onClick={() => setShowSetup(false)}>
                  {t("Finish setup")}
                </Button>
              </div>
            )}
          </div>
        </PanelCard>
      )}

      {/* 1. Engine */}
      <PanelCard title={t("Engine")} icon={groupIcon("Engine")}>
        <div className="flex flex-col divide-y divide-border/70 px-5">
          <div className="flex flex-col gap-2.5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-foreground">{t("Mode")}</span>
              <SegmentedControl
                aria-label={t("Mode")}
                size="sm"
                value={tier}
                options={tierOptions}
                onValueChange={(v) => set({ voiceTier: v === "hybrid" ? "auto" : v })}
              />
            </div>

            {status?.lightSuggested && tier !== "light" && (
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                <Info className="size-4 shrink-0" />
                <span>{win ? t("Light mode is suggested for this PC to keep dictation smooth.") : t("Light mode is suggested for this Mac to keep dictation smooth.")}</span>
              </div>
            )}

            {neededModels.length > 0 && (
              <div className="flex flex-col gap-2 pt-1">
                {neededModels.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    progress={downloadProg}
                    error={downloadErrors[m.id] ?? null}
                    onDownload={handleDownload}
                    onCancel={handleCancelDownload}
                    onDelete={handleDeleteModel}
                  />
                ))}
              </div>
            )}

            {tier === "cloud" && (
              <div className="mt-1 flex flex-col gap-2.5 rounded-lg border border-border/80 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium">{t("Cloud region")}</span>
                  <SegmentedControl
                    aria-label={t("Cloud region")}
                    size="sm"
                    value={cloudRegion}
                    options={[
                      { value: "intl", label: t("International (Singapore)") },
                      { value: "cn", label: t("Mainland China") },
                    ]}
                    onValueChange={(v) => set({ voiceCloudRegion: v })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={cloudKey}
                    onChange={(e) => setCloudKey(e.target.value)}
                    placeholder={hasCloudKey ? "••••••••••••••••" : t("DashScope API key")}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
                  />
                  <Button size="sm" onClick={saveCloudKey} disabled={!cloudKey.trim()}>
                    {t("Save")}
                  </Button>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  {cloudRegion === "cn"
                    ? t("Audio is sent to Alibaba Cloud (China) for transcription.")
                    : t("Audio is sent to Alibaba Cloud (Singapore) for transcription.")}
                </p>
              </div>
            )}
          </div>

          <SettingsRow
            label={t("Show live text")}
            description={t("Stream words in the notch while you speak")}
          >
            <Switch checked={live} onCheckedChange={(v) => set({ voiceLive: v })} />
          </SettingsRow>

          <SettingsRow
            label={t("Keep model loaded")}
            description={t("Avoid reload delay; uses extra RAM when idle")}
          >
            <Switch checked={keepLoaded} onCheckedChange={(v) => set({ voiceKeepLoaded: v })} />
          </SettingsRow>

          <SettingsRow label={t("CPU threads")}>
            <select
              value={threads}
              onChange={(e) => set({ voiceThreads: Number(e.target.value) })}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
            >
              <option value="0">{t("Auto (recommended)")}</option>
              <option value="2">{t("2 threads")}</option>
              <option value="3">{t("3 threads")}</option>
              <option value="4">{t("4 threads")}</option>
            </select>
          </SettingsRow>
        </div>
      </PanelCard>

      {/* 2. Trigger */}
      <PanelCard title={t("Trigger")} icon={groupIcon("Trigger")}>
        <div className="flex flex-col divide-y divide-border/70 px-5">
          <SettingsRow
            label={t("Dictation key")}
            description={t(
              "Hold for 250 ms to dictate; double-tap for hands-free; press Esc to cancel."
            )}
          >
            <KeyPicker
              value={voiceKey}
              mode="dictate"
              os={os}
              onChange={(v) => set({ voiceKey: v })}
            />
          </SettingsRow>
          <SettingsRow
            label={t("Talk to Pony with it too")}
            description={t("When you're not typing in a text field, what you say goes to Pony, which answers in the notch.")}
          >
            <Switch
              checked={settings.voiceAgentAuto !== false}
              aria-label={t("Talk to Pony with it too")}
              onCheckedChange={(v) => set({ voiceAgentAuto: v })}
            />
          </SettingsRow>
          <SettingsRow label={t("Command key (Pony)")}>
            <KeyPicker
              value={commandKey}
              mode="command"
              os={os}
              onChange={(v) => set({ voiceCommandKey: v })}
            />
          </SettingsRow>
          {settings.ponyEyes === true && settings.ponyHands === true && (
            <SettingsRow
              label={t("Voice Auto UI")}
              description={t(
                "Control whether voice commands to Pony run in Auto UI mode or follow the chat toggle."
              )}
            >
              <SegmentedControl
                size="sm"
                aria-label={t("Voice Auto UI")}
                value={String(settings.voiceAutoUi || "follow")}
                onValueChange={(v) => set({ voiceAutoUi: v })}
                options={[
                  { value: "follow", label: t("Follow chat") },
                  { value: "on", label: t("Always on") },
                  { value: "off", label: t("Always off") },
                ]}
              />
            </SettingsRow>
          )}
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-foreground">{t("Test trigger")}</div>
              <div className="truncate text-[11.5px] text-muted-foreground">
                {livePartial || t("Hold your dictation key to see live state updates here.")}
              </div>
            </div>
            <Badge
              variant="soft"
              tone={liveState === "listening" ? "accent" : "neutral"}
              className="shrink-0"
            >
              {liveState === "listening"
                ? t("Listening")
                : liveState === "transcribing"
                  ? t("Transcribing")
                  : t("Idle")}
            </Badge>
          </div>
        </div>
      </PanelCard>

      {/* 3. Language */}
      <PanelCard title={t("Language")} icon={groupIcon("Language")}>
        <div className="px-5">
          <SettingsRow label={t("Language")}>
            <SegmentedControl
              aria-label={t("Language")}
              size="sm"
              value={lang}
              options={[
                { value: "id", label: t("Indonesian") },
                { value: "en", label: t("English") },
                { value: "auto", label: t("Auto") },
              ]}
              onValueChange={(v) => set({ voiceLanguage: v })}
            />
          </SettingsRow>
        </div>
      </PanelCard>

      {/* 4. Output */}
      <PanelCard title={t("Output")} icon={groupIcon("Output")}>
        <div className="flex flex-col divide-y divide-border/70 px-5">
          <SettingsRow label={t("Insert method")}>
            <select
              value={insertMode}
              onChange={(e) => set({ voiceInsert: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
            >
              <option value="auto">{t("Auto (paste and restore clipboard)")}</option>
              <option value="copy">{t("Always copy to clipboard")}</option>
            </select>
          </SettingsRow>
          <SettingsRow label={t("Units style")}>
            <SegmentedControl
              aria-label={t("Units style")}
              size="sm"
              value={units}
              options={[
                { value: "symbols", label: t("Symbols (8%, Rp25.000)") },
                { value: "words", label: t("Words (8 persen)") },
              ]}
              onValueChange={(v) => set({ voiceUnits: v })}
            />
          </SettingsRow>
          <SettingsRow
            label={t("Spoken punctuation")}
            description={t("Turn “koma”, “tanda tanya”, “baris baru” into punctuation")}
          >
            <Switch checked={spokenPunct} onCheckedChange={(v) => set({ voiceSpokenPunct: v })} />
          </SettingsRow>
          <SettingsRow
            label={t("Work jargon boost")}
            description={t("Send common office and tech words to the engine prompt")}
          >
            <Switch checked={jargon} onCheckedChange={(v) => set({ voiceJargon: v })} />
          </SettingsRow>
          <SettingsRow
            label={t("Keep local history")}
            description={t("Save recent transcripts in ~/.sympony/voice-history.jsonl")}
          >
            <div className="flex items-center gap-2">
              {historyCleared && (
                <span className="text-[11.5px] text-muted-foreground">
                  {t("History cleared")}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={<Trash2 />}
                onClick={async () => {
                  await notch.svc("voice", "clearHistory");
                  setHistoryCleared(true);
                  window.setTimeout(() => setHistoryCleared(false), 2000);
                }}
              >
                {t("Clear history")}
              </Button>
              <Switch checked={history} onCheckedChange={(v) => set({ voiceHistory: v })} />
            </div>
          </SettingsRow>
        </div>
      </PanelCard>

      {/* 5. Dictionary */}
      <PanelCard title={t("Dictionary")} icon={groupIcon("Dictionary")}>
        <div className="p-4">
          <DictionaryManager dict={dict} jargon={jargon} onSave={handleSaveDict} />
        </div>
      </PanelCard>

      {/* 6. Microphone */}
      <PanelCard title={t("Microphone")} icon={groupIcon("Microphone")}>
        <div className="flex flex-col divide-y divide-border/70 px-5">
          <SettingsRow label={t("Input device")}>
            <select
              value={device}
              onChange={(e) => set({ voiceDevice: e.target.value })}
              className="h-8 max-w-[260px] rounded-md border border-input bg-background px-2.5 text-[12.5px]"
            >
              <option value="">{t("System default")}</option>
              {devices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label={t("Live level")}>
            <div className="flex w-44 items-center gap-2">
              <Mic className="size-3.5 text-muted-foreground" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                  style={{ width: `${levelPct}%` }}
                />
              </div>
            </div>
          </SettingsRow>
        </div>
      </PanelCard>

      {/* 7. Permissions */}
      <PanelCard title={t("Permissions")} icon={groupIcon("Permissions")}>
        <div className="flex flex-col divide-y divide-border/70 px-5">
          <SettingsRow label={t("Microphone")}>
            <div className="flex items-center gap-2">
              <Badge variant={micGranted ? "soft" : "outline"} tone={micGranted ? "success" : "warning"}>
                {micGranted ? t("Granted") : t("Required")}
              </Badge>
              {!micGranted && (
                <Button size="sm" variant="secondary" icon={<ShieldCheck />} onClick={() => handleFixPerm("microphone")}>
                  {t("Fix")}
                </Button>
              )}
            </div>
          </SettingsRow>
          {!win && (
          <SettingsRow
            label={t("Accessibility")}
            description={
              !axGranted
                ? t(
                    "If Sympony is already toggled ON in System Settings, select it, click − to remove the old entry, then click + to add /Applications/Sympony.app again."
                  )
                : undefined
            }
          >
            <div className="flex items-center gap-2">
              <Badge variant={axGranted ? "soft" : "outline"} tone={axGranted ? "success" : "warning"}>
                {axGranted ? t("Granted") : t("Required")}
              </Badge>
              {!axGranted && (
                <Button size="sm" variant="secondary" icon={<ShieldCheck />} onClick={() => handleFixPerm("accessibility")}>
                  {t("Fix")}
                </Button>
              )}
            </div>
          </SettingsRow>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

export const voice: SectionBody = {
  id: "voice",
  rows: [...VOICE_ROWS],
  render: VoiceBody,
};
