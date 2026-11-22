import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { PickId } from "./api";
import { copy } from "./copy";
import { OnboardingIcon } from "./icons";
import { PICK_ITEMS } from "./steps/PickStep";

export type StageStep = "try" | "pick" | "perms" | "tune";

function currentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}.${mm}`;
}

export function Stage({
  step,
  lang,
  tried,
  picks,
  permOk,
  permTotal,
  look,
}: {
  step: StageStep;
  lang: string;
  tried: boolean;
  picks: PickId[];
  permOk: number;
  permTotal: number;
  look: "black" | "glass" | "color";
}) {
  const [timeStr, setTimeStr] = useState(currentTimeStr);
  const [displayCap, setDisplayCap] = useState("");
  const [swapping, setSwapping] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTimeStr(currentTimeStr()), 15000);
    return () => clearInterval(id);
  }, []);

  const targetCap =
    step === "try"
      ? tried
        ? copy("tryYes", undefined, lang)
        : copy("stageTry", undefined, lang)
      : step === "pick"
        ? copy("stagePick", { n: picks.length }, lang)
        : step === "perms"
          ? permTotal > 0
            ? copy("stagePerms", { a: permOk, b: permTotal }, lang)
            : copy("stageNone", undefined, lang)
          : copy("stageTune", undefined, lang);

  useEffect(() => {
    if (!displayCap) {
      setDisplayCap(targetCap);
      return;
    }
    if (displayCap === targetCap) return;
    setSwapping(true);
    const t = setTimeout(() => {
      setDisplayCap(targetCap);
      setSwapping(false);
    }, 160);
    return () => clearTimeout(t);
  }, [targetCap, displayCap]);

  const pickedItems = PICK_ITEMS.filter((m) => picks.includes(m.id));
  const shownItems = pickedItems.slice(0, 6);
  const pickWidth =
    step === "pick"
      ? `${Math.max(72, 30 + shownItems.length * 25 + (pickedItems.length > 6 ? 24 : 0))}px`
      : undefined;

  const permFrac = permTotal > 0 ? permOk / permTotal : 1;

  return (
    <div
      className={`stage${step === "try" && tried ? " hit" : ""}`}
      id="stage"
      data-s={step}
      data-look={step === "tune" ? look : "black"}
    >
      <div className="mn" style={pickWidth ? { width: pickWidth } : undefined}>
        <div className="mn-part mn-try">
          <span className="mn-dot" />
        </div>

        <div className="mn-part mn-peek">
          <span className="mn-art" />
          <span>
            <b>Midnight City</b>
            <small>M83</small>
          </span>
          <span className="mn-bars">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>

        <div className="mn-part mn-pick" id="mnPick">
          {shownItems.map((m, k) => (
            <span
              key={m.id}
              className="mi"
              style={{ "--c": m.color, "--k": k } as CSSProperties}
            >
              <OnboardingIcon name={m.icon} />
            </span>
          ))}
          {pickedItems.length > 6 && (
            <span className="more">+{pickedItems.length - 6}</span>
          )}
        </div>

        <div className="mn-part mn-perms">
          <svg className="ring" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="bg" cx="9" cy="9" r="7" />
            <circle
              className="fg"
              cx="9"
              cy="9"
              r="7"
              style={{ "--pf": permFrac } as CSSProperties}
            />
          </svg>
          <span id="mnPerm">
            {permTotal > 0 ? `${permOk}/${permTotal}` : "✓"}
          </span>
        </div>

        <div className="mn-part mn-tune">
          <span className="mn-time">{timeStr}</span>
          <span className="mn-bars">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>

      <svg className="mn-cursor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 2l15 9-6.5 1.6L9.4 19z"
          fill="#fff"
          stroke="#000"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>

      <div className={`stage-cap${swapping ? " swap" : ""}`} id="stageCap">
        {displayCap}
      </div>
    </div>
  );
}
