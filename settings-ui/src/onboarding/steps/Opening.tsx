import type { CSSProperties } from "react";
import { copy, echo } from "../copy";
import { ArrowRightIcon } from "../icons";

function SplitWords({
  lines,
  softSecondLine = false,
}: {
  lines: string[];
  softSecondLine?: boolean;
}) {
  let idx = 0;
  return (
    <>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {line.split(/(\s+)/).map((tok, ti) => {
            if (!tok) return null;
            if (/^\s+$/.test(tok)) return " ";
            const j = idx++;
            return (
              <span className="w" key={`${li}-${ti}`}>
                <span
                  className={softSecondLine && li === 1 ? "wi soft" : "wi"}
                  style={{ "--j": j } as CSSProperties}
                >
                  {tok}
                </span>
              </span>
            );
          })}
        </span>
      ))}
    </>
  );
}

export function IntroSection({
  active,
  leaving,
  lang,
}: {
  active: boolean;
  leaving: boolean;
  lang: string;
}) {
  const echoText = echo("introSub", lang);
  return (
    <section
      className={`open${active ? " on" : ""}${leaving ? " leaving" : ""}`}
      id="s-intro"
      aria-hidden={!active}
    >
      <div>
        {/* (Pony lands here: PonyStory) */}
        <div className="pony-slot" data-slot="intro" />
        <h1 className="display">
          <SplitWords lines={["Sympony"]} />
        </h1>
        <p className="sub r">{copy("introSub", undefined, lang)}</p>
        {echoText && (
          <p className="echo r" style={{ "--i": 1 } as CSSProperties}>
            {echoText}
          </p>
        )}
      </div>
    </section>
  );
}

export function WelcomeSection({
  active,
  leaving,
  lang,
  imported,
  onBegin,
}: {
  active: boolean;
  leaving: boolean;
  lang: string;
  imported: boolean;
  onBegin: () => void;
}) {
  const echoText = echo("welcomeTitlePlain", lang);
  return (
    <section
      className={`open${active ? " on" : ""}${leaving ? " leaving" : ""}`}
      id="s-welcome"
      aria-hidden={!active}
    >
      <div>
        <div className="pony-slot sm" data-slot="welcome" />
        <div className="kicker r" style={{ "--d1": "80ms" } as CSSProperties}>
          {copy("welcomeKicker", undefined, lang)}
        </div>
        <h1 className="display">
          <SplitWords
            lines={[
              copy("welcomeTitle1", undefined, lang),
              copy("welcomeTitle2", undefined, lang),
            ]}
            softSecondLine
          />
        </h1>
        {echoText && (
          <p
            className="echo r"
            style={{ "--i": 0, "--d1": "420ms" } as CSSProperties}
          >
            {echoText}
          </p>
        )}
        <p className="sub r" style={{ "--i": 1 } as CSSProperties}>
          {copy("welcomeSub", undefined, lang)}
        </p>
        <button
          type="button"
          className="begin r"
          style={{ "--i": 2 } as CSSProperties}
          id="begin"
          onClick={onBegin}
          onMouseEnter={() => window.dispatchEvent(new Event("pony-begin-hover"))}
          onMouseLeave={() => window.dispatchEvent(new Event("pony-begin-leave"))}
        >
          <span>{copy("begin", undefined, lang)}</span>
          <ArrowRightIcon />
        </button>
        {imported && (
          <div className="r" style={{ "--i": 3 } as CSSProperties}>
            <span className="import-line">{copy("settingsImported", undefined, lang)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
