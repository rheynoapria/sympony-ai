import { useSyncExternalStore } from "react";
import { notch } from "./notch";

export type HelperState = Record<string, Record<string, unknown>>;

export function mergeHelper(
  state: HelperState,
  msg: Record<string, unknown> | null | undefined
): HelperState {
  if (!msg || typeof msg.type !== "string" || !msg.type) return state;
  return { ...state, [msg.type]: msg };
}

let store: HelperState = {};
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function ensureStarted() {
  if (started) return;
  started = true;
  notch.onHelper((msg) => {
    const next = mergeHelper(store, msg);
    if (next !== store) {
      store = next;
      emit();
    }
  });
  notch
    .helperState()
    .then((init) => {
      if (init && typeof init === "object") {
        store = { ...init, ...store };
        emit();
      }
    })
    .catch(() => {});
}

function subscribe(fn: () => void) {
  ensureStarted();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): HelperState {
  return store;
}

export function useHelper<T = Record<string, unknown>>(type: string): T | undefined {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return all[type] as T | undefined;
}
