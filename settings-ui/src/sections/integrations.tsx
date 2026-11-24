import { useEffect, useState } from "react";
import { ExternalLink } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { StatusDot } from "@/components/ui/knowns/status-dot";
import { t } from "@/lib/i18n";
import { onMac } from "@/lib/platform";
import { notch } from "@/lib/notch";
import { cn } from "@/lib/knowns/utils";
import { useAgents } from "@/lib/agents";
import { Skeleton } from "@/components/ui/knowns/skeleton";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, SectionBody } from "@/rows/types";
import type { AgentInfo } from "./ai";
import { INTEGRATIONS_ROWS } from "./ai.rows";

interface ClaudeStatus {
  state: string;
  file?: string;
  line?: number;
}

interface PaseoStatus {
  found?: boolean;
  running?: boolean;
  reached?: boolean;
  pending?: number;
}

// Claude Code's hooks and Paseo, as one live state for the page: read every second while it's in view (both are
// cheap: a file and Sympony's own last look at Paseo), and again right after Install / Remove
interface Live {
  claude: ClaudeStatus | null;
  paseo: PaseoStatus | null;
  loaded: boolean;
}
let live: Live = { claude: null, paseo: null, loaded: false };
const liveSubs = new Set<() => void>();
let liveTimer = 0;
async function refreshLive() {
  const [c, p] = await Promise.all([
    notch.svc("claude", "status").catch(() => null),
    notch.svc("paseo", "status").catch(() => null),
  ]);
  const next = { claude: (c as ClaudeStatus | null) ?? null, paseo: (p as PaseoStatus | null) ?? null, loaded: true };
  if (JSON.stringify(next) === JSON.stringify(live)) return;
  live = next;
  liveSubs.forEach((f) => f());
}
function useLive(): Live {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    liveSubs.add(f);
    void refreshLive();
    if (!liveTimer) {
      liveTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void refreshLive();
      }, 1000);
    }
    return () => {
      liveSubs.delete(f);
      if (!liveSubs.size) {
        window.clearInterval(liveTimer);
        liveTimer = 0;
      }
    };
  }, []);
  return live;
}

/** A settings row's shape while its state loads. */
function RowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 py-1" aria-busy="true">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-3 w-full max-w-md" />
      </div>
      <Skeleton className="h-7 w-20 shrink-0" rounded="rounded-[8px]" />
    </div>
  );
}

function IntegrationsOverview({ settings }: CustomPartProps) {
  const { claude: c, paseo: p, loaded } = useLive();
  const { agents } = useAgents();
  const ag = (id: string) => (agents ?? []).find((a) => a.id === id) ?? ({} as AgentInfo);

  const cc: ["ok" | "warn" | "off", string] = !c
    ? ["off", t("Unknown")]
    : c.state === "installed"
      ? settings.claudeHooks
        ? ["ok", t("Connected")]
        : ["warn", t("Connected · requests hidden")]
      : c.state === "nodir"
        ? ["off", onMac() ? t("Not on this Mac") : t("Not on this PC")]
        : c.state === "bad"
          ? ["warn", t("Settings file has an error")]
          : ["warn", t("Not connected: Install below")];

  const ps: ["ok" | "warn" | "off", string] =
    !p || !p.found
      ? ["off", onMac() ? t("Not on this Mac") : t("Not on this PC")]
      : !p.running
        ? ["warn", t("Paseo isn’t running")]
        : settings.paseoEnabled === false || !settings.claudeHooks
          ? ["warn", t("Found · off")]
          : [
              "ok",
              p.pending
                ? t("Watching · {n} waiting", { n: p.pending })
                : t("Watching"),
            ];

  const cards: {
    key: string;
    name: string;
    iconSrc: string;
    mono?: boolean;
    tone: "ok" | "warn" | "off";
    text: string;
    pending?: boolean;
  }[] = [
    {
      key: "claude",
      name: "Claude Code",
      iconSrc: "./ai-icons/claudecode-color.svg",
      tone: cc[0],
      text: cc[1],
      pending: !loaded,
    },
    {
      key: "paseo",
      name: "Paseo",
      iconSrc: "./ai-icons/paseo.png",
      tone: ps[0],
      text: ps[1],
      pending: !loaded,
    },
  ];

  const NAMES: Record<string, [string, string]> = {
    antigravity: ["Antigravity", "antigravity-color"],
    codex: ["Codex", "codex-color"],
    gemini: ["Gemini CLI", "geminicli-color"],
    cursor: ["Cursor", "cursor"],
  };
  const later = (id: string, why: string) => {
    const a = ag(id);
    const iconName = a.icon || NAMES[id]?.[1] || "openai";
    cards.push({
      key: id,
      name: a.name || NAMES[id]?.[0] || id,
      iconSrc: `./ai-icons/${iconName}.svg`,
      mono: !/-color$/.test(iconName),
      tone: "off",
      text: a.installed ? why : t("Not installed"),
      pending: agents === null,
    });
  };

  later("antigravity", t("Has no hooks to ask through"));
  later("codex", ag("codex").update ? t("Update it for hooks") : t("Coming"));
  later("gemini", t("Coming: sign in to it first"));
  later("cursor", t("Coming: sign in to it first"));

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {cards.map((item) => (
        <div
          key={item.key}
          className={cn(
            "flex items-center gap-3 rounded-[10px] border border-border p-3",
            item.tone === "off" ? "bg-muted/25" : "bg-muted/45"
          )}
        >
          <div className="card-ico-well grid size-8 shrink-0 place-items-center rounded-[8px]">
            <img
              src={item.iconSrc}
              alt=""
              className={cn("size-4.5 object-contain", item.mono && "dark:invert")}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {item.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {item.pending ? (
                <Skeleton className="my-[3px] h-2.5 w-24" />
              ) : (
                <>
                  <StatusDot
                    tone={
                      item.tone === "ok"
                        ? "success"
                        : item.tone === "warn"
                          ? "warning"
                          : "neutral"
                    }
                  />
                  <span className="truncate">{item.text}</span>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClaudeHooksPart({ settings }: CustomPartProps) {
  const { claude: status, loaded } = useLive();
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loaded) return <RowSkeleton />;
  if (!status) return null;

  const file = status.file || "";
  let title = "";
  let sub = "";
  let showInstall = false;
  let showRemove = false;

  if (status.state === "installed") {
    title = t("Connected to Claude Code");
    sub = t(
      "Sympony’s hooks are in {file}. A Claude Code session already running may need a restart to use them.",
      { file }
    );
    if (!settings.claudeHooks) {
      sub +=
        " " +
        t("Turn on Show Claude Code’s requests to see them in Sympony.");
    }
    showRemove = true;
  } else if (status.state === "partial" || status.state === "other") {
    title =
      status.state === "other"
        ? t("Connected to a Sympony in another folder")
        : t("Partly connected");
    sub = t(
      "Install points Claude Code at this Sympony, with all of its hooks ({file}).",
      { file }
    );
    showInstall = true;
    showRemove = true;
  } else if (status.state === "bad") {
    title = t("Claude Code’s settings file has an error");
    sub = status.line
      ? t(
          "{file} isn’t valid JSON (line {line}), so Sympony leaves it alone. Fix it in an editor, then come back.",
          { file, line: status.line }
        )
      : t(
          "{file} isn’t valid JSON, so Sympony leaves it alone. Fix it in an editor, then come back.",
          { file }
        );
  } else if (status.state === "nodir") {
    title = t("Claude Code isn’t set up here");
    sub = t(
      "Its settings folder wasn’t found ({file}). Start Claude Code once, then come back.",
      { file: file.replace(/[\\/]settings\.json$/, "") }
    );
  } else {
    title = t("Not connected");
    sub = t(
      "Install adds Sympony’s hooks to Claude Code’s settings ({file}) and keeps a copy of the file first; nothing else there changes. Remove takes out only Sympony’s.",
      { file }
    );
    showInstall = true;
  }

  const run = async (action: "install" | "remove") => {
    setBusy(true);
    const r = (await notch.svc("claude", action).catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    const whyMap: Record<string, string> = {
      write: t("Sympony couldn’t write the file."),
      bad: t("Sympony can’t read the hooks in that file, so it left the file alone."),
    };
    setSaid(r && r.ok ? "" : (r?.error && whyMap[r.error]) || t("That didn’t work."));
    // (the cards above and this row change now, not on the next look)
    await refreshLive();
    setBusy(false);
  };

  return (
    <SettingsRow
      label={title}
      description={
        <>
          {said && <strong className="font-semibold text-foreground">{said} </strong>}
          <span>{sub}</span>
        </>
      }
    >
      <div className="flex items-center gap-2">
        {showInstall && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void run("install")}
          >
            {t("Install")}
          </Button>
        )}
        {showRemove && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void run("remove")}
          >
            {t("Remove")}
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}

function PaseoPart({ settings }: CustomPartProps) {
  const { paseo: p, loaded } = useLive();

  if (!loaded) return <RowSkeleton />;

  const text =
    !p || !p.found
      ? onMac() ? t("Paseo isn’t installed on this Mac.") : t("Paseo isn’t installed on this PC.")
      : !p.running
        ? t("Paseo is installed but its daemon isn’t running: open Paseo.")
        : settings.paseoEnabled === false || !settings.claudeHooks
          ? t("Paseo runs; its requests aren’t shown (turn on the switches above).")
          : p.reached === false
            ? t(
                "Paseo runs but didn’t answer Sympony (its local sign-in may have changed): restart Paseo."
              )
            : `${
                p.pending
                  ? t("{n} waiting now.", { n: p.pending })
                  : t("Nothing waiting.")
              } ${t("Checking every second.")}`;

  return (
    <SettingsRow label={t("State")} description={text}>
      <Button
        size="sm"
        variant="secondary"
        icon={<ExternalLink />}
        onClick={() => void notch.svc("paseo", "open")}
      >
        {t("Open Paseo")}
      </Button>
    </SettingsRow>
  );
}

const CUSTOMS: Record<string, CustomPart> = {
  overview: IntegrationsOverview,
  claudeHooksCtrl: ClaudeHooksPart,
  paseoState: PaseoPart,
};

export const integrations: SectionBody = {
  id: "integrations",
  rows: [...INTEGRATIONS_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <Rows
      sectionId="integrations"
      rows={INTEGRATIONS_ROWS}
      customs={CUSTOMS}
      settings={props.settings}
      set={props.set}
      os={props.os}
      part={props.part}
      onNavigate={props.onNavigate}
    />
  ),
};
