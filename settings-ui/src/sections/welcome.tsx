import { Fragment } from "react";
import { Kbd } from "@/components/ui/knowns/kbd";
import { SectionIcon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { LeadText } from "@/rows/Rows";
import { offCards } from "@/rows/os";
import type { CustomPartProps, SectionBody } from "@/rows/types";
import { WELCOME_CARDS } from "./modules.meta";

function WelcomeLead({
  os,
  shortcut,
}: {
  os: CustomPartProps["os"];
  shortcut: string;
}) {
  if (os === "linux") {
    return (
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {t(
          "Sympony is an interactive notch for your desktop. It lives at the top centre of your screen, under a panel at the top if you have one. Hover over it to open it, or drag files onto it."
        )}
      </p>
    );
  }
  const raw = t(
    os === "macos"
      ? "Sympony is an interactive notch for your Mac. It lives at the top centre of your screen. Hover over it to open it, drag files onto it, or press <kbd>{key}</kbd>."
      : "Sympony is an interactive notch for your Windows PC. It lives at the top centre of your screen. Hover over it to open it, drag files onto it, or press <kbd>{key}</kbd>.",
    { key: shortcut }
  );
  const parts = raw.split(/(<kbd>[\s\S]*?<\/kbd>)/g);
  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      {parts.map((part, i) => {
        const m = /^<kbd>([\s\S]*?)<\/kbd>$/.exec(part);
        if (m) {
          return (
            <Kbd key={i} size="sm" className="mx-0.5 align-baseline">
              {m[1]}
            </Kbd>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

function WelcomeSection({ settings, os }: CustomPartProps) {
  const hidden = new Set(offCards(os));
  const cards = WELCOME_CARDS.filter((c) => !hidden.has(c.faKey));
  const shortcut = String(settings.toggleShortcut || "Alt+N");

  return (
    <div className="flex flex-col gap-5">
      <WelcomeLead os={os} shortcut={shortcut} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <div
            key={`${c.faKey}-${i}`}
            className="panel-surface flex items-start gap-3 border border-border p-3.5"
            style={{ borderRadius: "var(--card-radius)" }}
          >
            <div
              className="card-ico-well grid size-8 shrink-0 place-items-center rounded-[8px]"
              style={{ color: c.color }}
            >
              <SectionIcon name={c.icon} className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground">
                {t(c.title)}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {t(c.desc)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <LeadText html="Turn modules on/off and reorder them in <b>Modules</b>. Want Sympony out of the way for a moment? Click the eye button at the top of the open Sympony (or right-click it twice). For good: turn on <b>Auto-hide</b> in General, and let it come down when you’re idle. Right-click the tray icon for Snooze, Hide and Quit." />
    </div>
  );
}

export const welcome: SectionBody = {
  id: "welcome",
  render: WelcomeSection,
};
