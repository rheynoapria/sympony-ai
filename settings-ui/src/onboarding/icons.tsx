import { useEffect, useRef } from "react";
export type OnboardingIconName =
  | "music"
  | "cal"
  | "moon"
  | "spark"
  | "timer"
  | "bell"
  | "cloud"
  | "check"
  | "pin"
  | "hand"
  | "play"
  | "mic"
  | "pony";

/** Pony's silhouette (the menu bar's icon), in the text colour, drawn by ../pony.js. */
function PonyGlyph() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    const P = (window as unknown as { Pony?: { glyph: (c: CanvasRenderingContext2D, s: number, col: string) => void } }).Pony;
    const ctx = cv?.getContext("2d");
    if (!cv || !P || !ctx) return;
    const css = cv.getBoundingClientRect().width || 18;
    const px = Math.round(css * Math.min(3, window.devicePixelRatio || 1));
    cv.width = cv.height = px;
    P.glyph(ctx, px, getComputedStyle(cv).color || "#fff");
  }, []);
  return <canvas ref={ref} className="pony-glyph" aria-hidden="true" />;
}

/** Filled glyphs (holes cut with even-odd), for colour tiles like app icons and for the notch preview. */
const GLYPHS: Record<Exclude<OnboardingIconName, "pony">, string[]> = {
  music: ["M20 3.2v12.3a3.2 3.2 0 1 1-2-2.96V7.1l-8 1.6v8.8a3.2 3.2 0 1 1-2-2.96V5.6a1 1 0 0 1 .8-.98l10-2a1 1 0 0 1 1.2.98z"],
  cal: [
    "M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1z" +
      "M3.6 9h16.8v1.4H3.6z M6.5 13h3v2.6h-3z M10.5 13h3v2.6h-3z M14.5 13h3v2.6h-3z",
  ],
  moon: ["M20.5 14.5A9 9 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"],
  spark: ["M12 2.5l2.1 6.1 6.4 2.4-6.4 2.4L12 19.5l-2.1-6.1L3.5 11l6.4-2.4z M18.5 16l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"],
  timer: [
    "M12 4.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0-17z M11 8.5h2v4.6l2.6 1.7-1.1 1.6-3.5-2.3z",
    "M9.5 1.5h5a1 1 0 0 1 0 2h-5a1 1 0 0 1 0-2z",
  ],
  bell: [
    "M12 2a6.5 6.5 0 0 0-6.5 6.5c0 5.2-2.2 7.4-2.9 8.1A.8.8 0 0 0 3.2 18h17.6a.8.8 0 0 0 .6-1.4c-.7-.7-2.9-2.9-2.9-8.1A6.5 6.5 0 0 0 12 2z",
    "M9.3 19.4h5.4a2.7 2.7 0 0 1-5.4 0z",
  ],
  cloud: ["M17.5 19.5a4.8 4.8 0 1 0-1.2-9.5A6.3 6.3 0 0 0 4.3 12.8 3.6 3.6 0 0 0 6 19.5z"],
  check: ["M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z M7.2 12.3l1.5-1.4 2.3 2.4 4.8-5.5 1.5 1.3-6.2 7.1z"],
  pin: ["M12 22.5s7.5-6.4 7.5-12.5a7.5 7.5 0 0 0-15 0c0 6.1 7.5 12.5 7.5 12.5z M12 7.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6z"],
  hand: [
    "M7 6a1.6 1.6 0 0 1 3.2 0v6H7z",
    "M10.6 3.6a1.6 1.6 0 0 1 3.2 0V12h-3.2z",
    "M14.2 5.2a1.6 1.6 0 0 1 3.2 0V12h-3.2z",
    "M17.8 8.4a1.6 1.6 0 0 1 3.2 0v5.6h-3.2z",
    "M7 11.2h14v3.3a7.5 7.5 0 0 1-7.5 7.5h-.8a7 7 0 0 1-5.8-3.1L3.4 14.6a1.7 1.7 0 0 1 2.7-2z",
  ],
  mic: [
    "M12 1.8a3.6 3.6 0 0 1 3.6 3.6v6a3.6 3.6 0 0 1-7.2 0v-6A3.6 3.6 0 0 1 12 1.8z",
    "M5 10.4h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V20h3v2H8v-2h3v-2.7a7 7 0 0 1-6-6.9z",
  ],
  play: ["M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19z M10 8.1v7.8l6.3-3.9z"],
};

export function OnboardingIcon({ name }: { name: OnboardingIconName }) {
  if (name === "pony") return <PonyGlyph />;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} fillRule="evenodd" />
      ))}
    </svg>
  );
}

export function TickIcon({ color = "#fff" }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6l6 6-6 6" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg
      className="arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 19V5m0 0l-6 6m6-6l6 6" />
    </svg>
  );
}

