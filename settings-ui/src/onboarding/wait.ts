export type PermWaitState = "granted" | "denied" | "notAsked" | "notRunning";
export type PermWaitAction = "dialog" | "pane";
export type WaitOutcome = "granted" | "denied" | "noDialog" | "wait";

export const DIALOG_TIMEOUT_MS = 6000;
export const PANE_TIMEOUT_MS = 60000;

/**
 * Pure decision function evaluated on each permission status poll while waiting for macOS.
 */
export function waitOutcome(
  before: PermWaitState,
  now: PermWaitState,
  elapsedMs: number,
  action: PermWaitAction
): WaitOutcome {
  if (now === "granted") return "granted";
  if (action === "pane") return "wait";
  if (before === "notAsked" && now === "denied") return "denied";
  if (now === "notAsked" && elapsedMs >= DIALOG_TIMEOUT_MS) return "noDialog";
  return "wait";
}
