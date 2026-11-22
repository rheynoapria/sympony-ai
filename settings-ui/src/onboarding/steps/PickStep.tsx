import type { CSSProperties } from "react";
import type { PickId } from "../api";
import { copy, type CopyKey } from "../copy";
import { OnboardingIcon, type OnboardingIconName, TickIcon } from "../icons";

export interface PickMeta {
  id: PickId;
  icon: OnboardingIconName;
  color: string;
  labelKey: CopyKey;
  subKey: CopyKey;
}

export const PICK_ITEMS: PickMeta[] = [
  { id: "music", icon: "music", color: "#ff375f", labelKey: "mod.music", subKey: "modsub.music" },
  { id: "calendar", icon: "cal", color: "#ff6b5e", labelKey: "mod.calendar", subKey: "modsub.calendar" },
  { id: "prayer", icon: "moon", color: "#30d158", labelKey: "mod.prayer", subKey: "modsub.prayer" },
  { id: "ai", icon: "pony", color: "#7c5cff", labelKey: "mod.ai", subKey: "modsub.ai" },
  { id: "focus", icon: "timer", color: "#ff9f0a", labelKey: "mod.focus", subKey: "modsub.focus" },
  { id: "notifications", icon: "bell", color: "#409cff", labelKey: "mod.notifications", subKey: "modsub.notifications" },
  { id: "weather", icon: "cloud", color: "#32ade6", labelKey: "mod.weather", subKey: "modsub.weather" },
  { id: "todo", icon: "check", color: "#f5a300", labelKey: "mod.todo", subKey: "modsub.todo" },
];

export function PickStep({
  lang,
  picks,
  onToggle,
}: {
  lang: string;
  picks: PickId[];
  onToggle: (id: PickId) => void;
}) {
  return (
    <>
      <h2 className="x">{copy("pickTitle", undefined, lang)}</h2>
      <p className="lead x" style={{ "--i": 1 } as CSSProperties}>
        {copy("pickSub", undefined, lang)}
      </p>
      <div className="opts" id="opts">
        {PICK_ITEMS.map((item, i) => {
          const on = picks.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`opt x${on ? " on" : ""}`}
              style={
                {
                  "--i": 2 + i * 0.4,
                  "--c": item.color,
                } as CSSProperties
              }
              aria-pressed={on}
              onClick={() => onToggle(item.id)}
            >
              <span className="oi">
                <OnboardingIcon name={item.icon} />
              </span>
              <span className="tx">
                <span className="nm">{copy(item.labelKey, undefined, lang)}</span>
                <span className="sb">{copy(item.subKey, undefined, lang)}</span>
              </span>
              <i className="box">
                <TickIcon color="#fff" />
              </i>
            </button>
          );
        })}
      </div>
    </>
  );
}
