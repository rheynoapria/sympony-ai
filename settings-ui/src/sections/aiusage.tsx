import { useEffect, useState } from "react";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { Rows } from "@/rows/Rows";
import type { CustomPart, CustomPartProps, SectionBody } from "@/rows/types";
import { AIUSAGE_ROWS } from "./ai.rows";

interface ServiceStatus {
  found?: boolean;
  denied?: boolean;
  asked?: boolean;
  expired?: boolean;
  plan?: string;
}

interface AiUsageStatus {
  claude?: ServiceStatus;
  codex?: ServiceStatus;
}

function makeServicePart(svc: "claude" | "codex"): CustomPart {
  return function AiUsageServicePart({ settings, set, row, os }: CustomPartProps) {
    const [status, setStatus] = useState<AiUsageStatus | null>(null);
    const key = svc === "claude" ? "aiUsageClaude" : "aiUsageCodex";

    useEffect(() => {
      let alive = true;
      const pull = () => {
        notch
          .svc("aiusage", "status")
          .then((res) => {
            if (alive && res && typeof res === "object") {
              setStatus(res as AiUsageStatus);
            }
          })
          .catch(() => {});
      };
      pull();
      const unsub = notch.on("aiusage", pull);
      return () => {
        alive = false;
        unsub();
      };
    }, [settings[key]]);

    const mac = os === "macos";
    const s = status?.[svc];
    let statusLine: React.ReactNode = null;

    if (s && svc === "claude") {
      if (!s.found) {
        if (mac) {
          statusLine = s.denied ? (
            <span className="text-amber-500">
              ●{" "}
              {t(
                "Not connected: macOS didn’t let Sympony read Claude Code’s sign-in in the Keychain. Turn this off and on to be asked again, then click Always Allow"
              )}
            </span>
          ) : !s.asked ? (
            t(
              "Sympony reads Claude Code’s sign-in from the Keychain: macOS asks once, click Always Allow"
            )
          ) : (
            t("Not found: sign in to Claude Code on this Mac first")
          );
        } else {
          statusLine = t("Not found: sign in to Claude Code on this PC first");
        }
      } else if (s.expired) {
        statusLine = (
          <span className="text-amber-500">
            ●{" "}
            {t("Found, but its sign-in has expired: open Claude Code to refresh it")}
          </span>
        );
      } else {
        statusLine = (
          <span className="text-emerald-600 dark:text-emerald-400">
            ●{" "}
            {s.plan
              ? t("Found: {plan} plan", { plan: s.plan })
              : mac
                ? t("Found on this Mac")
                : t("Found on this PC")}
          </span>
        );
      }
    } else if (s) {
      statusLine = s.found ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          ● {mac ? t("Found on this Mac") : t("Found on this PC")}
        </span>
      ) : mac ? (
        t("Not found: use Codex CLI on this Mac first")
      ) : (
        t("Not found: use Codex CLI on this PC first")
      );
    }

    const label = row && "label" in row && row.label ? t(row.label) : svc;
    const sub = row && "sub" in row && row.sub ? t(row.sub) : "";

    return (
      <div data-k={key}>
        <SettingsRow
          label={label}
          description={
            <>
              <span>{sub}</span>
              {statusLine && (
                <>
                  <br />
                  <span>{statusLine}</span>
                </>
              )}
            </>
          }
        >
          <Switch
            checked={Boolean(settings[key])}
            aria-label={label}
            onCheckedChange={(checked) => void set({ [key]: checked })}
          />
        </SettingsRow>
      </div>
    );
  };
}

const CUSTOMS: Record<string, CustomPart> = {
  claude: makeServicePart("claude"),
  codex: makeServicePart("codex"),
};

export const aiusage: SectionBody = {
  id: "aiusage",
  rows: [...AIUSAGE_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <Rows
      sectionId="aiusage"
      rows={AIUSAGE_ROWS}
      customs={CUSTOMS}
      settings={props.settings}
      set={props.set}
      os={props.os}
      part={props.part}
      onNavigate={props.onNavigate}
    />
  ),
};
