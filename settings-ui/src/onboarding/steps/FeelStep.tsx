import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeelInput } from "../api";
import { copy } from "../copy";

const LOOKS: { value: FeelInput["look"]; key: "lookBlack" | "lookGlass" | "lookColor" }[] = [
  { value: "black", key: "lookBlack" },
  { value: "glass", key: "lookGlass" },
  { value: "color", key: "lookColor" },
];

export function FeelStep({
  lang,
  feel,
  showPrayer,
  prayerCity,
  onChange,
}: {
  lang: string;
  feel: FeelInput;
  showPrayer: boolean;
  prayerCity?: string | null;
  onChange: (next: FeelInput) => void;
}) {
  const segRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 2, width: 52 });

  const measureThumb = () => {
    const idx = Math.max(
      0,
      LOOKS.findIndex((l) => l.value === feel.look)
    );
    const btn = btnRefs.current[idx];
    if (btn) {
      setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  };

  useLayoutEffect(() => {
    measureThumb();
  }, [feel.look, lang]);

  useEffect(() => {
    const t = setTimeout(measureThumb, 120);
    return () => clearTimeout(t);
  }, [feel.look, lang]);

  const prayerSub = prayerCity
    ? copy("prayerCitySet", { city: prayerCity }, lang)
    : copy("prayerCityAuto", undefined, lang);

  return (
    <>
      <h2 className="x">{copy("feelTitle", undefined, lang)}</h2>
      <p className="lead x" style={{ "--i": 1 } as CSSProperties}>
        {copy("feelSub", undefined, lang)}
      </p>
      <div className="list group x" style={{ "--i": 2 } as CSSProperties}>
        <div className="item">
          <div>
            <b>{copy("look", undefined, lang)}</b>
            <small>{copy("lookSub", undefined, lang)}</small>
          </div>
          <div className="end">
            <div className="seg" ref={segRef} role="radiogroup" aria-label={copy("look", undefined, lang)}>
              <span
                className="thumb"
                style={{ left: `${thumb.left}px`, width: `${thumb.width}px` }}
              />
              {LOOKS.map((opt, idx) => (
                <button
                  key={opt.value}
                  ref={(el) => {
                    btnRefs.current[idx] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={feel.look === opt.value}
                  className={feel.look === opt.value ? "on" : undefined}
                  onClick={() => onChange({ ...feel, look: opt.value })}
                >
                  {copy(opt.key, undefined, lang)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="item">
          <div>
            <b>{copy("openOnHover", undefined, lang)}</b>
            <small>{copy("openOnHoverSub", undefined, lang)}</small>
          </div>
          <div className="end">
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={feel.openOnHover}
              aria-label={copy("openOnHover", undefined, lang)}
              onClick={() => onChange({ ...feel, openOnHover: !feel.openOnHover })}
            />
          </div>
        </div>

        {showPrayer && (
          <div className="item" id="prayerRow">
            <div>
              <b>{copy("prayerTimes", undefined, lang)}</b>
              <small>{prayerSub}</small>
            </div>
          </div>
        )}

        <div className="item">
          <div>
            <b>{copy("launchAtLogin", undefined, lang)}</b>
            <small>{copy("launchAtLoginSub", undefined, lang)}</small>
          </div>
          <div className="end">
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={feel.launchAtLogin}
              aria-label={copy("launchAtLogin", undefined, lang)}
              onClick={() => onChange({ ...feel, launchAtLogin: !feel.launchAtLogin })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
