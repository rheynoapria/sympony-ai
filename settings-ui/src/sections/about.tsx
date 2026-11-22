import { Fragment, useEffect, useState } from "react";
import {
  ExternalLink,
  FileDown,
  FileUp,
  FolderOpen,
  Loader2,
  Power,
  RotateCcw,
  RotateCw,
  Sparkles,
} from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { onboardingApi } from "@/onboarding/api";
import { leadNodes } from "@/rows/logic";
import type { CustomPartProps, SectionBody } from "@/rows/types";

const RELEASE_NOTES_URL = "https://github.com/rheynoapria/sympony-ai/releases";
const ENLABS_URL = "https://enlabs.my.id";
const REPO_URL = "https://github.com/rheynoapria/sympony-ai";

function EnlabsMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="256" height="256" rx="48" fill="#000000" />
      <g transform="translate(40 40) scale(0.6875)">
        <path
          fill="#f1efe9"
          d="M 128 192 L 128 256 L 64.5 256 L 32 223 L 0 192 L 0 128 L 64 128 Z M 256 192 L 256 256 L 192.5 256 L 160 223 L 128 192 L 128 128 L 192 128 Z M 128 64 L 128 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 Z M 256 64 L 256 128 L 192.5 128 L 160 95 L 128 64 L 128 0 L 192 0 Z"
        />
      </g>
    </svg>
  );
}

interface WhatsNewData {
  version: string;
  notes?: string;
}

interface BackupCounts {
  tasks?: number;
  notes?: number;
  chats?: number;
  bookmarks?: number;
  radio?: number;
  dock?: number;
  launcher?: number;
  events?: number;
  calendars?: number;
  briefs?: number;
  files?: number;
}

interface BackupSaved {
  ok: boolean;
  path: string;
  name: string;
  size: number;
}

interface BackupPeek {
  ok: boolean;
  path: string;
  created: number;
  pc?: string;
  app?: string;
  counts?: BackupCounts;
}

interface BackupImported {
  at?: number;
  created?: number;
  pc?: string;
  copy?: string;
}

function locale(): string | undefined {
  if (typeof window !== "undefined" && typeof window._tLocale === "function") {
    return window._tLocale();
  }
  return undefined;
}

function formatSize(n: number): string {
  return n < 1048576
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1048576).toFixed(1)} MB`;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(locale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatHolds(c: BackupCounts): string {
  const entries: [number, string, string][] = [
    [c.tasks ?? 0, t("{n} task", { n: c.tasks ?? 0 }), t("{n} tasks", { n: c.tasks ?? 0 })],
    [c.notes ?? 0, t("{n} note", { n: c.notes ?? 0 }), t("{n} notes", { n: c.notes ?? 0 })],
    [c.chats ?? 0, t("{n} AI chat", { n: c.chats ?? 0 }), t("{n} AI chats", { n: c.chats ?? 0 })],
    [c.bookmarks ?? 0, t("{n} bookmark", { n: c.bookmarks ?? 0 }), t("{n} bookmarks", { n: c.bookmarks ?? 0 })],
    [c.radio ?? 0, t("{n} radio favourite", { n: c.radio ?? 0 }), t("{n} radio favourites", { n: c.radio ?? 0 })],
    [c.dock ?? 0, t("{n} Dock item", { n: c.dock ?? 0 }), t("{n} Dock items", { n: c.dock ?? 0 })],
    [c.launcher ?? 0, t("{n} launcher app", { n: c.launcher ?? 0 }), t("{n} launcher apps", { n: c.launcher ?? 0 })],
    [c.events ?? 0, t("{n} event", { n: c.events ?? 0 }), t("{n} events", { n: c.events ?? 0 })],
    [c.calendars ?? 0, t("{n} calendar link", { n: c.calendars ?? 0 }), t("{n} calendar links", { n: c.calendars ?? 0 })],
    [c.briefs ?? 0, t("{n} scheduled brief", { n: c.briefs ?? 0 }), t("{n} scheduled briefs", { n: c.briefs ?? 0 })],
    [c.files ?? 0, t("{n} file", { n: c.files ?? 0 }), t("{n} files", { n: c.files ?? 0 })],
  ];
  return entries
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => (n === 1 ? one : many))
    .concat(t("all settings"))
    .join(" · ");
}

function parseNotesLines(md?: string): string[] {
  return String(md || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const body = l.slice(2);
      const m = body.match(/^(New|Changed|Fixed|Improved|Removed):\s*/i);
      return m ? `<b>${m[1]}</b> ${body.slice(m[0].length)}` : body;
    });
}

function InlineRich({ text }: { text: string }) {
  return (
    <>
      {leadNodes(text).map((part, i) => {
        if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>;
        if ("b" in part) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.b}
            </strong>
          );
        }
        if ("i" in part) {
          return (
            <em key={i} className="italic">
              {part.i}
            </em>
          );
        }
        if ("code" in part) {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground"
            >
              {part.code}
            </code>
          );
        }
        return <br key={i} />;
      })}
    </>
  );
}

function AboutSection({ settings, os }: CustomPartProps) {
  const [info, setInfo] = useState<{ version?: string; userData?: string }>({});
  const [whatsNew, setWhatsNew] = useState<WhatsNewData | null>(null);
  const [saved, setSaved] = useState<BackupSaved | null>(null);
  const [saveError, setSaveError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [peek, setPeek] = useState<BackupPeek | null>(null);
  const [importError, setImportError] = useState("");
  const [busyImport, setBusyImport] = useState(false);
  const [importedDone, setImportedDone] = useState<{ copy?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    notch
      .appInfo()
      .then((res) => {
        if (alive && res) {
          setInfo({
            version: typeof res.version === "string" ? res.version : undefined,
            userData:
              typeof res.userData === "string"
                ? res.userData
                : typeof res.dataDir === "string"
                  ? res.dataDir
                  : undefined,
          });
        }
      })
      .catch(() => {});
    notch
      .svc("update", "whatsNew")
      .then((res) => {
        if (alive && res && typeof res === "object" && "version" in res) {
          setWhatsNew(res as WhatsNewData);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setSaveError("");
    const r = (await notch
      .svc("backup", "export")
      .catch((e) => ({ ok: false, message: String(e) }))) as
      | (BackupSaved & { message?: string })
      | null;
    setExporting(false);
    if (r && r.ok) {
      setSaved(r);
    } else if (r) {
      setSaved(null);
      setSaveError(r.message || t("Couldn’t save the backup"));
    }
  };

  const handleOpenBackup = async () => {
    setImportError("");
    const r = (await notch
      .svc("backup", "open")
      .catch((e) => ({ ok: false, message: String(e) }))) as
      | (BackupPeek & { cancelled?: boolean; message?: string })
      | null;
    if (r && r.ok) {
      setPeek(r);
    } else if (r && !r.cancelled) {
      setImportError(r.message || t("That file can’t be read"));
    }
  };

  const handleConfirmImport = async () => {
    if (!peek || busyImport) return;
    setBusyImport(true);
    const r = (await notch
      .svc("backup", "import", peek.path)
      .catch((e) => ({ ok: false, message: String(e) }))) as
      | { ok?: boolean; copy?: string; message?: string }
      | null;
    setBusyImport(false);
    if (r && r.ok) {
      setImportedDone(r);
      setPeek(null);
      return;
    }
    setPeek(null);
    setImportError((r && r.message) || t("The import didn’t work"));
  };

  const notesLines = whatsNew ? parseNotesLines(whatsNew.notes) : [];
  const last = settings.backupImported as BackupImported | undefined;
  const lastMade =
    last && last.at
      ? last.pc
        ? t("The backup was made {date} on {pc}.", {
            date: formatWhen(last.created || last.at),
            pc: last.pc,
          })
        : t("The backup was made {date}.", {
            date: formatWhen(last.created || last.at),
          })
      : "";

  const exportDefaultSub =
    os === "macos"
      ? t(
          "Settings, tasks, notes, AI chats, bookmarks, radio favourites, launcher items, your own events and calendar links, scheduled briefs, health, Pomodoro and screen time history, Teleprompter scripts and the adhan you picked, in one .sympony file. Not in it: API keys and passwords (they’re locked to this Mac, so enter them again on the other one), Todo sync’s sign-in, the Shelf, the clipboard history and the notification history. The file isn’t encrypted, so keep it to yourself."
        )
      : t(
          "Settings, tasks, notes, AI chats, bookmarks, radio favourites, Dock and launcher items, your own events and calendar links, health, Pomodoro and screen time history, and the adhan and Dock icons you picked, in one .sympony file. Not in it: API keys and passwords (they’re locked to this PC, so enter them again on the other one), Todo sync’s sign-in, the Shelf and the notification history. The file isn’t encrypted, so keep it to yourself."
        );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-card/60 p-4">
        <div className="flex items-center gap-3.5">
          <img
            src="../icon.png"
            alt="Sympony"
            className="h-12 w-12 shrink-0 rounded-xl shadow-sm"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                Sympony
              </h2>
              {info.version && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  v{info.version}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t("Your desktop notch AI companion.")}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <EnlabsMark className="h-4 w-4 shrink-0 rounded-[4px]" />
              <span>{t("A product by Enlabs")}</span>
              <span aria-hidden="true">·</span>
              <span>© 2026 Enlabs</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<ExternalLink />}
            onClick={() => void notch.openExternal(ENLABS_URL)}
          >
            enlabs.my.id
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<ExternalLink />}
            onClick={() => void notch.openExternal(REPO_URL)}
          >
            GitHub
          </Button>
        </div>
      </div>

      {whatsNew && (
        <PanelCard
          title={t("What’s new in v{version}", { version: whatsNew.version })}
          icon={groupIcon("What’s new")}
        >
          <div className="divide-y divide-border/80">
            {notesLines.length > 0 && (
              <ul className="list-disc space-y-1.5 pb-3 ps-5 text-[12.5px] leading-relaxed text-muted-foreground">
                {notesLines.map((line, i) => (
                  <li key={i}>
                    <InlineRich text={line} />
                  </li>
                ))}
              </ul>
            )}
            <div className={notesLines.length > 0 ? "pt-3" : ""}>
              <SettingsRow
                label={t("All changes")}
                description={
                  notesLines.length > 0
                    ? t("Every version’s notes on GitHub")
                    : t("This version’s notes are on GitHub")
                }
              >
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink />}
                  onClick={() => void notch.openExternal(RELEASE_NOTES_URL)}
                >
                  {t("Release notes")}
                </Button>
              </SettingsRow>
            </div>
          </div>
        </PanelCard>
      )}

      <PanelCard title={t("Info")} icon={groupIcon("Info")}>
        <div className="divide-y divide-border/80">
          <div className="pb-3">
            <SettingsRow label={t("Version")}>
              <span className="text-[13px] font-medium tabular-nums text-foreground">
                {info.version ? `v${info.version}` : "…"}
              </span>
            </SettingsRow>
          </div>
          <div className="py-3">
            <SettingsRow
              label={t("Publisher")}
              description="© 2026 Enlabs"
            >
              <button
                type="button"
                onClick={() => void notch.openExternal(ENLABS_URL)}
                className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                <EnlabsMark className="h-4 w-4 shrink-0 rounded-[4px]" />
                <span>Enlabs</span>
              </button>
            </SettingsRow>
          </div>
          <div className="py-3">
            <SettingsRow
              label={t("License")}
              description={t("Source code")}
            >
              <button
                type="button"
                onClick={() => void notch.openExternal(REPO_URL)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>GPL-3.0-only</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </SettingsRow>
          </div>
          <div className="py-3">
            <SettingsRow
              label={t("Data folder")}
              description={t("settings, shelf, todo, notes, health, screen time")}
            >
              <span className="block max-w-80 truncate text-[12px] text-muted-foreground">
                {info.userData || "—"}
              </span>
            </SettingsRow>
          </div>
          <div className="py-3">
            <SettingsRow label={t("Icons")}>
              <span className="text-[12px] text-muted-foreground">
                {t("Font Awesome Free 6 & Fluent UI Icons, bundled locally")}
              </span>
            </SettingsRow>
          </div>
          <div className="pt-3">
            <SettingsRow label={t("Weather data")}>
              <span className="text-[12px] text-muted-foreground">
                Open-Meteo.com (CC BY 4.0)
              </span>
            </SettingsRow>
          </div>
        </div>
      </PanelCard>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant="secondary"
          icon={<Sparkles />}
          onClick={() => void onboardingApi.open()}
        >
          {typeof window !== "undefined" &&
          (window as unknown as { SYMPONY_LANG?: string }).SYMPONY_LANG === "id"
            ? "Tampilkan sambutan lagi"
            : t("Show welcome again")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<RotateCcw />}
          onClick={() => {
            if (
              window.confirm(
                t(
                  "Reset all settings to defaults? Calendars, local events and API keys will be removed."
                )
              )
            ) {
              void notch.resetSettings();
            }
          }}
        >
          {t("Reset all settings")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          icon={<Power />}
          onClick={() => void notch.quit()}
        >
          {t("Quit Sympony")}
        </Button>
      </div>

      <PanelCard title={t("Back up and restore")} icon={groupIcon("Back up and restore")}>
        {importedDone ? (
          <SettingsRow
            label={t("Imported. Sympony is restarting…")}
            description={t("The data from before is in {path}", {
              path: importedDone.copy || "",
            })}
          >
            <span />
          </SettingsRow>
        ) : (
          <div className="divide-y divide-border/80">
            <div className="pb-3">
              <SettingsRow
                label={t("Export")}
                description={
                  saved ? (
                    <InlineRich
                      text={t("Saved <b>{name}</b> ({size}).", {
                        name: saved.name,
                        size: formatSize(saved.size),
                      })}
                    />
                  ) : saveError ? (
                    <span className="text-destructive">{saveError}</span>
                  ) : (
                    exportDefaultSub
                  )
                }
              >
                <div className="flex items-center gap-2">
                  {saved && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<FolderOpen />}
                      onClick={() => void notch.svc("actions", "reveal", saved.path)}
                    >
                      {t("Show in folder")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={exporting}
                    icon={exporting ? <Loader2 className="animate-spin" /> : <FileUp />}
                    onClick={() => void handleExport()}
                  >
                    {t("Export…")}
                  </Button>
                </div>
              </SettingsRow>
            </div>

            <div className={last && last.at ? "py-3" : "pt-3"}>
              {peek ? (
                <SettingsRow
                  label={t("Import this backup?")}
                  description={
                    <>
                      <span>
                        {peek.pc
                          ? t("From {date} on {pc}", {
                              date: formatWhen(peek.created),
                              pc: peek.pc,
                            })
                          : t("From {date}", { date: formatWhen(peek.created) })}
                        {peek.app ? `, Sympony ${peek.app}` : ""}:{" "}
                        {formatHolds(peek.counts || {})}.
                      </span>
                      <br />
                      <span>
                        {t(
                          "It replaces Sympony’s settings and data on this PC. A copy of the current data is kept first (a before-import folder in the data folder), API keys on this PC stay, and Sympony restarts."
                        )}
                      </span>
                    </>
                  }
                >
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyImport}
                      onClick={() => setPeek(null)}
                    >
                      {t("Cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyImport}
                      icon={
                        busyImport ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RotateCw />
                        )
                      }
                      onClick={() => void handleConfirmImport()}
                    >
                      {t("Import and restart")}
                    </Button>
                  </div>
                </SettingsRow>
              ) : (
                <SettingsRow
                  label={t("Import")}
                  description={
                    importError ? (
                      <span className="text-destructive">{importError}</span>
                    ) : (
                      t(
                        "Puts a backup’s settings and data in place of this PC’s, for example on a new PC. You see what’s in it and confirm first."
                      )
                    )
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<FileDown />}
                    onClick={() => void handleOpenBackup()}
                  >
                    {t("Import…")}
                  </Button>
                </SettingsRow>
              )}
            </div>

            {last && last.at && (
              <div className="pt-3">
                <SettingsRow
                  label={t("Last import: {date}", { date: formatWhen(last.at) })}
                  description={`${lastMade} ${t(
                    "Sympony’s data from before the import is in {path}",
                    { path: last.copy || "" }
                  )}`}
                >
                  {last.copy ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<FolderOpen />}
                      onClick={() => void notch.svc("actions", "reveal", last.copy)}
                    >
                      {t("Show")}
                    </Button>
                  ) : (
                    <span />
                  )}
                </SettingsRow>
              </div>
            )}
          </div>
        )}
      </PanelCard>
    </div>
  );
}

export const about: SectionBody = {
  id: "about",
  render: AboutSection,
};
