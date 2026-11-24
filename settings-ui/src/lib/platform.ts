import type { OS } from "@/sections/registry";

/** The OS Settings runs on: `?os=` in the browser preview, else what Sympony tells the page, else the browser's own. */
export function detectOS(): OS {
  if (typeof window !== "undefined" && !window.notch) {
    const q = new URLSearchParams(window.location.search).get("os");
    if (q === "macos" || q === "windows" || q === "linux") return q;
  }
  const fromHost = typeof window !== "undefined" ? window.SYMPONY_OS : undefined;
  if (fromHost === "macos" || fromHost === "windows" || fromHost === "linux") {
    return fromHost;
  }
  if (typeof navigator !== "undefined") {
    const plat = navigator.platform || "";
    if (/Win/i.test(plat)) return "windows";
    if (/Linux/i.test(plat)) return "linux";
  }
  return "macos";
}

/** On a Mac (the browser preview counts as one): for the words that name the computer, "this Mac" or "this PC". */
export function onMac(): boolean {
  return detectOS() === "macos";
}
