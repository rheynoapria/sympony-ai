import { beforeEach, describe, expect, test } from "bun:test";
import {
  flushSectionItemsSeen,
  groupHasUnseenNew,
  innerNewKeysForSection,
  isNewKeyUnseen,
  markNewKeysSeen,
  markSectionOpened,
  resetWhatsNewForTests,
  SEEN_NEW_STORAGE_KEY,
  sectionHasUnseenNew,
} from "./whatsNew";

describe("whatsNew dismissible badges", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          },
          removeItem: (k: string) => {
            store.delete(k);
          },
        },
      },
      configurable: true,
      writable: true,
    });
    resetWhatsNewForTests();
  });

  test("new sections and collapsed parent groups show New until opened", () => {
    expect(sectionHasUnseenNew("feed", "macos")).toBe(true);
    expect(sectionHasUnseenNew("voice", "macos")).toBe(true);
    expect(groupHasUnseenNew("features", "macos")).toBe(true);
    expect(isNewKeyUnseen("v0.2b5:mod:feed")).toBe(true);

    // Opening Feed & RSS immediately clears its Sidebar badge and module badge,
    // while keeping inner Feed rows visible until the user leaves or interacts.
    markSectionOpened("feed", "macos");
    expect(sectionHasUnseenNew("feed", "macos")).toBe(false);
    expect(isNewKeyUnseen("v0.2b5:mod:feed")).toBe(false);
    expect(isNewKeyUnseen("v0.2b5:item:feed:feedAutoSummary")).toBe(true);

    // Voice in Features is still unseen, so Features group still has unseen New.
    expect(groupHasUnseenNew("features", "macos")).toBe(true);

    // Leaving Feed & RSS flushes its inner row badges permanently.
    flushSectionItemsSeen("feed", "macos");
    expect(isNewKeyUnseen("v0.2b5:item:feed:feedAutoSummary")).toBe(false);
    expect(isNewKeyUnseen("v0.2b5:item:feed:feedSummaryModel")).toBe(false);

    // Opening Voice clears the remaining Features group New indicator.
    markSectionOpened("voice", "macos");
    flushSectionItemsSeen("voice", "macos");
    expect(sectionHasUnseenNew("voice", "macos")).toBe(false);
    expect(groupHasUnseenNew("features", "macos")).toBe(false);

    const persisted = JSON.parse(
      window.localStorage.getItem(SEEN_NEW_STORAGE_KEY) || "[]"
    ) as string[];
    expect(persisted).toContain("v0.2b5:sec:feed");
    expect(persisted).toContain("v0.2b5:mod:feed");
    expect(persisted).toContain("v0.2b5:sec:voice");
  });

  test("Modules section surfaces new modules & style library and dismisses on interaction or leave", () => {
    expect(sectionHasUnseenNew("modules", "macos")).toBe(true);
    const inner = innerNewKeysForSection("modules", "macos");
    expect(inner).toContain("v0.2b5:item:modules:styleLibrary");
    expect(inner).toContain("v0.2b5:mod:feed");

    markSectionOpened("modules", "macos");
    expect(sectionHasUnseenNew("modules", "macos")).toBe(false);
    expect(isNewKeyUnseen("v0.2b5:item:modules:styleLibrary")).toBe(true);

    markNewKeysSeen(["v0.2b5:item:modules:styleLibrary"]);
    expect(isNewKeyUnseen("v0.2b5:item:modules:styleLibrary")).toBe(false);

    flushSectionItemsSeen("modules", "macos");
    expect(isNewKeyUnseen("v0.2b5:mod:feed")).toBe(false);
  });
});
