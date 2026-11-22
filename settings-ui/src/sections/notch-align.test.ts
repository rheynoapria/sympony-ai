import assert from "node:assert/strict";
import test from "node:test";
import { offSlotIds } from "../rows/os.ts";
import { GENERAL_ROWS, IDLE_SLOTS } from "./general.rows.ts";
import { MEDIA_ROWS } from "./media.rows.ts";
import { searchAll } from "./registry.ts";

test("General drops the Look picker and adds Notch form after Height", () => {
  const ks = GENERAL_ROWS.filter((r) => "k" in r).map((r) => (r as { k: string }).k);
  assert.ok(!ks.includes("notchLook"));
  assert.ok(!GENERAL_ROWS.some((r) => r.t === "custom" && r.id === "notchColor"));
  assert.equal(ks[ks.indexOf("notchHeight") + 1], "shellForm");
});

test("Media has Wave style after Color glow", () => {
  const ks = MEDIA_ROWS.filter((r) => "k" in r).map((r) => (r as { k: string }).k);
  assert.equal(ks[ks.indexOf("colorGlow") + 1], "waveStyle");
});

test("Battery stays a closed-slot choice on every OS", () => {
  assert.ok(IDLE_SLOTS.some(([v]) => v === "battery"));
  for (const os of ["macos", "linux", "windows"] as const) {
    assert.ok(!offSlotIds(os, "idleRight").includes("battery"));
  }
});

test("search finds the new rows", () => {
  assert.ok(
    searchAll("notch form", "macos").some(
      (h) => h.section === "general" && h.label === "Notch form"
    )
  );
  assert.ok(
    searchAll("wave", "macos").some(
      (h) => h.section === "media" && h.label === "Wave style"
    )
  );
});
