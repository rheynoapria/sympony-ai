import assert from "node:assert/strict";
import test from "node:test";
import {
  registerSectionRows,
  resolveSection,
  searchAll,
  searchSections,
  sectionRows,
  sectionsFor,
} from "./registry.ts";

test("sectionsFor filters per OS and excludes cat and mochi", () => {
  assert.ok(!sectionsFor("macos").some((s) => s.id === "dock"));
  assert.ok(!sectionsFor("macos").some((s) => ["cursor", "dock", "snap", "wallpaper"].includes(s.id)));
  assert.ok(sectionsFor("windows").some((s) => s.id === "dock"));
  assert.ok(!sectionsFor("linux").some((s) => s.id === "notifications"));
  assert.ok(
    !sectionsFor("linux").some((s) =>
      ["cursor", "dock", "snap", "bluetooth", "screentime", "wallpaper", "notifications"].includes(s.id)
    )
  );
  assert.ok(!sectionsFor("windows").some((s) => s.id === "cat" || s.id === "mochi"));
  assert.ok(!sectionsFor("macos").some((s) => s.id === "cat" || s.id === "mochi"));
  assert.equal(sectionsFor("macos").at(-1)!.id, "about");
});

test("resolveSection falls back to general for hidden, unknown, or empty ids and keeps spots", () => {
  assert.equal(resolveSection("dock", "macos"), "general");
  assert.equal(resolveSection("dock/x", "macos"), "general");
  assert.equal(resolveSection("cat", "windows"), "general");
  assert.equal(resolveSection("mochi", "macos"), "general");
  assert.equal(resolveSection("nope", "macos"), "general");
  assert.equal(resolveSection(null, "macos"), "general");
  assert.equal(resolveSection(undefined, "macos"), "general");
  assert.equal(resolveSection("media", "macos"), "media");
  assert.equal(resolveSection("dock", "windows"), "dock");
  assert.equal(resolveSection("pomodoro/timer", "macos"), "pomodoro/timer");
});

test("searchSections ranks prefix matches before substrings and matches words", () => {
  assert.equal(searchSections("blue", "macos")[0].id, "bluetooth");
  assert.equal(searchSections("BATT", "macos")[0].id, "battery");
  assert.ok(searchSections("speed test", "macos").some((s) => s.id === "bluetooth"));
  assert.ok(!searchSections("dock", "macos").some((s) => s.id === "dock"));
});

test("searchAll searches sections and migrated rows with Indonesian synonyms", () => {
  assert.ok(searchAll("jam", "macos").some((h) => h.label === "24-hour time"));
  assert.ok(searchAll("lirik", "macos").some((h) => h.section === "media"));
});

test("registerSectionRows accepts per-OS functions resolved by sectionRows", () => {
  registerSectionRows("x-test", (os) =>
    os === "linux" ? [] : [{ t: "toggle", k: "haptics", label: "Zebra row" }]
  );
  assert.deepEqual(sectionRows("x-test", "linux"), []);
  assert.equal(sectionRows("x-test", "macos").length, 1);
});
