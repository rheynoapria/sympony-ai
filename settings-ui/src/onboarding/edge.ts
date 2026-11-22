import type { WindowFrame } from "./api";

export interface EdgeController {
  show(): void;
  hide(): void;
  read(windows: WindowFrame[], delayMs?: number): void;
  clearOutlines(): void;
  destroy(): void;
}

const SCAN_MS = 2200;
const OUTLINE_HOLD_MS = 1100;

/** Cubic-bezier(.45, .05, .25, 1) matching the CSS #scan.go keyframe curve. */
function scanEase(t: number): number {
  const c = [0.45, 0.05, 0.25, 1];
  let x = t;
  for (let i = 0; i < 6; i++) {
    const bx =
      3 * c[0] * x * (1 - x) ** 2 +
      3 * c[2] * x * x * (1 - x) +
      x ** 3 -
      t;
    const d =
      3 * c[0] * (1 - x) ** 2 +
      6 * (c[2] - c[0]) * x * (1 - x) +
      3 * (1 - c[2]) * x * x;
    x -= bx / (d || 1);
  }
  return (
    3 * c[1] * x * (1 - x) ** 2 +
    3 * c[3] * x * x * (1 - x) +
    x ** 3
  );
}

/**
 * Plain-TS controller for v6.3's compositor-only opening backdrop (spec §3.5):
 * - #read-veil: radial veil deepest behind the white opening type (opacity only)
 * - #edges: four 20vmin edge strips whose 200%-long gradient children move via transform: translate (no filter blur, no clip-path)
 * - #scan: 26vh light band sweeping down from the notch via transform
 * - #win-outlines: positioned frames matching real on-screen windows + Dock that light up via opacity as the sweep crosses them
 */
export function createEdge(
  container: HTMLElement,
  reduceMotion: boolean
): EdgeController {
  container.innerHTML = `
    <div id="read-veil" aria-hidden="true"></div>
    <div id="edges" aria-hidden="true">
      <div class="strip t"><i class="flow"></i></div>
      <div class="strip r"><i class="flow"></i></div>
      <div class="strip b"><i class="flow"></i></div>
      <div class="strip l"><i class="flow"></i></div>
    </div>
    <div id="win-outlines" aria-hidden="true"></div>
    <div id="scan" aria-hidden="true"></div>
  `;

  const scanEl = container.querySelector("#scan") as HTMLElement;
  const outlinesEl = container.querySelector("#win-outlines") as HTMLElement;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };

  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers = [];
  };

  const clearOutlines = () => {
    clearTimers();
    scanEl.classList.remove("go");
    outlinesEl.innerHTML = "";
  };

  const show = () => {
    document.body.classList.add("overlay");
  };

  const hide = () => {
    document.body.classList.remove("overlay");
    clearOutlines();
  };

  const read = (windows: WindowFrame[], delayMs = 1000) => {
    if (reduceMotion) return;
    clearOutlines();
    later(delayMs, () => {
      outlinesEl.innerHTML = "";
      const items: { el: HTMLElement; top: number }[] = [];
      for (const w of windows) {
        const el = document.createElement("div");
        el.className = w.kind === "dock" ? "win-outline dock" : "win-outline";
        el.style.left = `${w.x}px`;
        el.style.top = `${w.y}px`;
        el.style.width = `${w.w}px`;
        el.style.height = `${w.h}px`;
        outlinesEl.appendChild(el);
        items.push({ el, top: w.y });
      }

      scanEl.classList.remove("go");
      void scanEl.offsetWidth;
      scanEl.classList.add("go");

      const H = window.innerHeight || 900;
      const from = -0.3 * H;
      const to = 1.02 * H;

      for (const item of items) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 20; i++) {
          const m = (lo + hi) / 2;
          if (from + (to - from) * scanEase(m) + 0.26 * H < item.top) {
            lo = m;
          } else {
            hi = m;
          }
        }
        later(lo * SCAN_MS, () => {
          item.el.classList.add("read");
          later(OUTLINE_HOLD_MS, () => {
            item.el.classList.remove("read");
          });
        });
      }
    });
  };

  const destroy = () => {
    clearOutlines();
    container.innerHTML = "";
  };

  return { show, hide, read, clearOutlines, destroy };
}
