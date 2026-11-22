import { useEffect, useRef, useState } from "react";
import { copy } from "./copy";

type PonyHandle = {
  hop: (p?: number) => void;
  poke: () => void;
  lookAt: (x: number, y: number) => void;
  setMood: (m: string) => void;
  setHands: (pose: "none" | "rest" | "grip" | "up" | "wave", gripY?: number) => void;
  destroy: () => void;
};
type PonyApi = { mount: (c: HTMLCanvasElement, o: Record<string, unknown>) => PonyHandle | null };

const W = 200;
const H = 170;
const FLOOR = 0.9; // (Pony stands at 90 % of the canvas)

interface Pos {
  x: number;
  y: number;
  ms: number;
  ease: string;
}

const EASE = {
  peek: "cubic-bezier(.2,.9,.3,1.15)",
  fall: "cubic-bezier(.55,0,.85,.36)",
};

/**
 * Pony's opening story, over the first screens of the onboarding: it peeks out from under the notch, looks
 * around, spots you, drops out and lands on its spot, says hi; then it lives there (looks at the pointer, plays a
 * little now and then, giggles when poked), moves to the Welcome screen with you, gets excited over "Set up", and
 * goes back up into the notch when setup starts. Pony is under the notch (z-index), so it can hide inside it.
 */
export function PonyStory({
  step,
  leaving,
  reduceMotion,
  lang,
}: {
  step: string;
  leaving: string | null;
  reduceMotion: boolean;
  lang: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const actor = useRef<HTMLDivElement | null>(null);
  const flight = useRef<Animation | null>(null);
  const pony = useRef<PonyHandle | null>(null);
  const lastPointer = useRef(0);
  const busy = useRef(true); // (a scene is playing: no idle play over it)
  const [pos, setPosState] = useState<Pos>({ x: window.innerWidth / 2 - W / 2, y: -H, ms: 0, ease: "linear" });
  const at = useRef(pos); // (where Pony is now, for jumps)
  const setPos = (p: Pos) => {
    flight.current?.cancel();
    flight.current = null;
    at.current = p;
    setPosState(p);
  };
  const [bubble, setBubble] = useState<{ text: string; shown: number } | null>(null);

  // where things are
  const notchBottom = () => {
    const n = document.getElementById("notch");
    const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wake-h")) || 0;
    return Math.max(n ? n.getBoundingClientRect().bottom : 0, css) || 32;
  };
  const notchX = () => {
    const n = document.getElementById("notch");
    const r = n?.getBoundingClientRect();
    return r ? r.left + r.width / 2 : window.innerWidth / 2;
  };
  const slot = (name: string): Pos | null => {
    const el = document.querySelector<HTMLElement>(`.pony-slot[data-slot="${name}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - W / 2, y: r.bottom - H * FLOOR, ms: 0, ease: "linear" };
  };
  const moveTo = (p: Pos | null, ms: number, ease: string) => p && setPos({ ...p, ms: reduceMotion ? 0 : ms, ease });

  // a jump along an arc (up `lift` px over the straight line), arms up, landing with a squash
  const jumpTo = (p: Pos | null, ms: number, lift: number) => {
    const el = actor.current;
    const h = pony.current;
    if (!p) return;
    if (reduceMotion || !el || !el.animate) {
      setPos({ ...p, ms: 0, ease: "" });
      return;
    }
    const from = at.current;
    // (the arc's top stays below the notch, so Pony never vanishes into it on the way)
    const roof = notchBottom() + 8 - H * 0.2;
    if (p.y > -H * 0.5) lift = Math.max(18, Math.min(lift, Math.min(from.y, p.y) - roof)); // (not when going up into it)
    h?.lookAt(Math.max(-1, Math.min(1, (p.x - from.x) / 200)), 0.2);
    h?.poke(); // (the push off)
    h?.setHands("up");
    const frames = Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      const ex = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // (x: ease in-out)
      const y = from.y + (p.y - from.y) * t - lift * 4 * t * (1 - t); // (y: a throw)
      return { transform: `translate3d(${from.x + (p.x - from.x) * ex}px, ${y}px, 0)` };
    });
    setPos({ ...from, ms: 0, ease: "" });
    const anim = el.animate(frames, { duration: ms, easing: "linear", fill: "forwards" });
    flight.current = anim;
    anim.onfinish = () => {
      if (flight.current !== anim) return;
      flight.current = null;
      at.current = { ...p, ms: 0, ease: "" };
      setPosState(at.current);
      requestAnimationFrame(() => anim.cancel());
      h?.poke(); // (the landing)
      h?.setHands("rest");
    };
  };

  // say something, typed out
  const say = (text: string, holdMs = 2600) => {
    if (reduceMotion) {
      setBubble({ text, shown: text.length });
      return () => undefined;
    }
    let n = 0;
    setBubble({ text, shown: 0 });
    const id = window.setInterval(() => {
      n += 1;
      setBubble({ text, shown: n });
      if (n >= text.length) window.clearInterval(id);
    }, 38);
    const off = window.setTimeout(() => setBubble(null), text.length * 38 + holdMs);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(off);
    };
  };

  // the character
  useEffect(() => {
    const cv = canvas.current;
    const P = (window as unknown as { Pony?: PonyApi }).Pony;
    if (!cv || !P) return;
    pony.current = P.mount(cv, { scale: 0.92, floorFrac: FLOOR, mood: "idle", shadow: true, hop: 0.7 });
    const look = (e: PointerEvent) => {
      const h = pony.current;
      if (!h) return;
      lastPointer.current = performance.now();
      const r = cv.getBoundingClientRect();
      const k = (v: number) => Math.max(-1, Math.min(1, v));
      h.lookAt(k((e.clientX - (r.left + r.width / 2)) / 320), k((e.clientY - (r.top + r.height * 0.55)) / 240));
    };
    window.addEventListener("pointermove", look);
    return () => {
      window.removeEventListener("pointermove", look);
      pony.current?.destroy();
      pony.current = null;
    };
  }, []);

  // the scenes: each plays once (the screens' leaving flags come and go around them)
  const scene = (step === "intro" || step === "welcome") && leaving !== "welcome" ? step : "bye";
  useEffect(() => {
    const h = () => pony.current;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    let stopSay: (() => void) | null = null;

    if (scene === "bye") {
      // setup starts: a wave goodbye, then a jump back up into the notch
      busy.current = true;
      h()?.setMood("happy");
      h()?.setHands("wave");
      at(reduceMotion ? 0 : 480, () => jumpTo({ x: notchX() - W / 2, y: -H, ms: 0, ease: "" }, 640, 50));
    } else if (scene === "intro") {
      busy.current = true;
      const home = () => slot("intro");
      if (reduceMotion) {
        at(50, () => {
          moveTo(home(), 0, "");
          h()?.setHands("rest");
        });
        at(400, () => {
          stopSay = say(copy("ponyHi", undefined, lang), 4000);
          busy.current = false;
        });
      } else {
        const peekY = () => notchBottom() + 14 - H * 0.6;
        const rim = (y: number) => notchBottom() - y; // (the notch's lower edge, in the canvas)
        at(20, () => {
          setPos({ x: notchX() - W / 2, y: -H, ms: 0, ease: "linear" });
          h()?.setHands("none");
        });
        // 1. peeks out from under the notch, both paws on its edge
        at(700, () => {
          moveTo({ x: notchX() - W / 2, y: peekY(), ms: 0, ease: "" }, 760, EASE.peek);
          h()?.setHands("grip", rim(peekY()));
        });
        // 2. looks around…
        at(1500, () => h()?.lookAt(-1, 0.2));
        at(2100, () => h()?.lookAt(1, 0.2));
        // 3. …and spots you
        at(2700, () => {
          h()?.lookAt(0, 0.8);
          h()?.setMood("attention");
        });
        // 4. pulls up a little, lets go, falls with its arms up, and lands on its spot
        at(3260, () => {
          moveTo({ x: notchX() - W / 2, y: peekY() - 10, ms: 0, ease: "" }, 220, "cubic-bezier(.3,0,.4,1)");
          h()?.setHands("grip", rim(peekY() - 10));
        });
        at(3500, () => {
          h()?.setHands("up");
          moveTo(home(), 620, EASE.fall);
        });
        at(4120, () => {
          h()?.poke();
          h()?.hop(0.55);
          h()?.setMood("happy");
          h()?.setHands("rest");
        });
        // 5. says hi, with a wave
        at(4600, () => {
          stopSay = say(copy("ponyHi", undefined, lang), 2400);
          h()?.setHands("wave");
        });
        at(6500, () => h()?.setHands("rest"));
        at(7200, () => {
          h()?.setMood("idle");
          busy.current = false;
        });
      }
    } else if (scene === "welcome") {
      busy.current = true;
      // hops over to its new spot
      at(reduceMotion ? 0 : 60, () => jumpTo(slot("welcome"), 720, 90));
      at(reduceMotion ? 0 : 900, () => h()?.setMood("happy"));
      at(reduceMotion ? 100 : 1200, () => {
        stopSay = say(copy("ponyWelcome", undefined, lang), 2800);
        h()?.setHands("wave");
      });
      at(reduceMotion ? 150 : 3000, () => h()?.setHands("rest"));
      at(reduceMotion ? 200 : 3400, () => {
        h()?.setMood("idle");
        busy.current = false;
      });
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
      stopSay?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, reduceMotion, lang]);

  // living there: now and then, when you're not moving the pointer, a little something
  useEffect(() => {
    if (reduceMotion) return;
    let id = 0;
    const next = () => {
      id = window.setTimeout(() => {
        const h = pony.current;
        if (h && !busy.current && performance.now() - lastPointer.current > 2500) {
          const r = Math.random();
          if (r < 0.3) {
            h.lookAt(-0.9, 0.1);
            window.setTimeout(() => h.lookAt(0.9, 0.1), 600);
            window.setTimeout(() => h.lookAt(0, 0.4), 1200);
          } else if (r < 0.55) {
            h.hop(0.45);
          } else if (r < 0.75) {
            h.setMood("music");
            window.setTimeout(() => !busy.current && h.setMood("idle"), 2200);
          } else {
            h.setMood("happy");
            h.setHands("wave");
            window.setTimeout(() => {
              if (busy.current) return;
              h.setMood("idle");
              h.setHands("rest");
            }, 1600);
          }
        }
        next();
      }, 4200 + Math.random() * 3000);
    };
    next();
    return () => window.clearTimeout(id);
  }, [reduceMotion]);

  // the Set up button: excited when you're about to press it
  useEffect(() => {
    const on = () => {
      pony.current?.setMood("done");
      pony.current?.setHands("up"); // (a cheer)
    };
    const off = () => {
      if (flight.current) return; // (mid-jump: arms stay up)
      pony.current?.setMood("idle");
      pony.current?.setHands("rest");
    };
    window.addEventListener("pony-begin-hover", on);
    window.addEventListener("pony-begin-leave", off);
    return () => {
      window.removeEventListener("pony-begin-hover", on);
      window.removeEventListener("pony-begin-leave", off);
    };
  }, []);

  const poke = () => {
    pony.current?.poke();
    if (!busy.current && !bubble) say(copy("ponyPoke", undefined, lang), 1400);
  };

  return (
    <div
      id="pony-actor"
      ref={actor}
      aria-hidden="true"
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        transition: pos.ms ? `transform ${pos.ms}ms ${pos.ease}` : "none",
      }}
    >
      <canvas ref={canvas} width={W} height={H} onPointerDown={poke} />
      {bubble && (
        <div className={`pony-bubble${bubble.shown >= bubble.text.length ? " done" : ""}`}>
          {bubble.text.slice(0, bubble.shown)}
          <span className="caret" />
        </div>
      )}
    </div>
  );
}
