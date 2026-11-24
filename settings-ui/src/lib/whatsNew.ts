import { useSyncExternalStore } from "react";
import { MODULE_TO_SETTINGS_SECTION } from "@/lib/stylelib";
import { offTabs } from "@/rows/os";
import { MODULE_META } from "@/sections/modules.meta";
import {
  sectionRows,
  sectionsFor,
  type OS,
  type SectionGroup,
} from "@/sections/registry";

export const SEEN_NEW_STORAGE_KEY = "sympony.seenNew.v1";

/** Custom section-interior feature keys that aren't driven by `*.rows.ts` (e.g. custom cards). */
export const EXTRA_SECTION_ITEMS: Readonly<Record<string, readonly string[]>> = {
  modules: ["v0.2b5:item:modules:styleLibrary"],
};

let cachedSeen: Set<string> | null = null;
let snapshotVersion = 0;
const openedSectionsSession = new Set<string>();
const listeners = new Set<() => void>();

function loadSeenSet(): Set<string> {
  if (cachedSeen) return cachedSeen;
  const set = new Set<string>();
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(SEEN_NEW_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === "string" && k) set.add(k);
          }
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
  }
  cachedSeen = set;
  return set;
}

function persistSeenSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SEEN_NEW_STORAGE_KEY,
      JSON.stringify(Array.from(set))
    );
  } catch {
    /* ignore storage quota/privacy mode */
  }
}

function emitChange(): void {
  snapshotVersion += 1;
  for (const fn of listeners) fn();
}

export function subscribeWhatsNew(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWhatsNewSnapshot(): number {
  loadSeenSet();
  return snapshotVersion;
}

/** Reset in-memory + storage state (used by unit tests). */
export function resetWhatsNewForTests(): void {
  cachedSeen = new Set<string>();
  openedSectionsSession.clear();
  persistSeenSet(cachedSeen);
  emitChange();
}

export function isNewKeyUnseen(key: string | undefined | null): boolean {
  if (!key) return false;
  return !loadSeenSet().has(key);
}

export function markNewKeysSeen(keys: readonly (string | undefined | null)[]): void {
  const seen = loadSeenSet();
  let changed = false;
  for (const k of keys) {
    if (k && !seen.has(k)) {
      seen.add(k);
      changed = true;
    }
  }
  if (changed) {
    persistSeenSet(seen);
    emitChange();
  }
}

/** Collects all inner item/module `newKey`s displayed inside `sectionId` for a given OS. */
export function innerNewKeysForSection(sectionId: string, os: OS): string[] {
  const out: string[] = [];
  const extra = EXTRA_SECTION_ITEMS[sectionId];
  if (extra) out.push(...extra);

  if (sectionId === "modules") {
    const hidden = os === "windows" ? new Set<string>() : new Set(offTabs(os));
    for (const [modId, meta] of Object.entries(MODULE_META)) {
      if (!hidden.has(modId) && meta.newKey) {
        out.push(meta.newKey);
      }
    }
  }

  for (const r of sectionRows(sectionId, os)) {
    if ("newKey" in r && r.newKey) {
      out.push(r.newKey);
    }
  }
  return out;
}

/**
 * Called as soon as a section becomes active in Settings:
 * - Immediately marks the section-level badge (and matching module badge, e.g. opening `feed` marks `mod:feed`)
 *   so the Sidebar `New` pill disappears right when the user opens it.
 * - Keeps inner row/card `newKey`s visible during this visit so the user can spot what's new on the page,
 *   then `flushSectionItemsSeen` persists them when switching sections or closing Settings.
 */
export function markSectionOpened(sectionId: string, os: OS): void {
  const seen = loadSeenSet();
  let changed = false;

  if (!openedSectionsSession.has(sectionId)) {
    openedSectionsSession.add(sectionId);
    changed = true;
  }

  const sec = sectionsFor(os).find((s) => s.id === sectionId);
  if (sec?.newKey && !seen.has(sec.newKey)) {
    seen.add(sec.newKey);
    changed = true;
  }

  // If this Settings section is a dedicated page for a notch module (e.g. `feed`), mark its module badge seen too.
  for (const [modId, targetSec] of Object.entries(MODULE_TO_SETTINGS_SECTION)) {
    if (targetSec === sectionId) {
      const modKey = MODULE_META[modId]?.newKey;
      if (modKey && !seen.has(modKey)) {
        seen.add(modKey);
        changed = true;
      }
    }
  }
  const directModKey = MODULE_META[sectionId]?.newKey;
  if (directModKey && !seen.has(directModKey)) {
    seen.add(directModKey);
    changed = true;
  }

  if (changed) {
    persistSeenSet(seen);
    emitChange();
  }
}

/** Marks all inner row/card/module `newKey`s inside `sectionId` as seen (on section leave or window close). */
export function flushSectionItemsSeen(sectionId: string, os: OS): void {
  markNewKeysSeen(innerNewKeysForSection(sectionId, os));
}

/** Whether the Sidebar item for `sectionId` should show a `New` badge right now. */
export function sectionHasUnseenNew(sectionId: string, os: OS): boolean {
  if (openedSectionsSession.has(sectionId)) return false;
  const sec = sectionsFor(os).find((s) => s.id === sectionId);
  if (!sec) return false;
  if (isNewKeyUnseen(sec.newKey)) return true;
  return innerNewKeysForSection(sectionId, os).some((k) => isNewKeyUnseen(k));
}

/** Whether a Sidebar group (useful when collapsed, like `Features`) contains any unseen `New` section. */
export function groupHasUnseenNew(group: SectionGroup, os: OS): boolean {
  return sectionsFor(os).some(
    (s) => s.group === group && sectionHasUnseenNew(s.id, os)
  );
}

/** Subscribes a React component to live `whatsNew` state transitions. */
export function useWhatsNew(): number {
  return useSyncExternalStore(
    subscribeWhatsNew,
    getWhatsNewSnapshot,
    getWhatsNewSnapshot
  );
}
